<script>
import { useSettingStore } from '@/stores/setting.js'
import { openDb } from '@/api/db/index.js'
import { seedDefaultCategories, syncDefaultCategories } from '@/api/category.js'
import { writeAllTodaySnapshots } from '@/api/account.js'
import { pruneOldRates } from '@/api/rateStore.js'
import { getAllSettings, setSettings } from '@/api/settings.js'
import { autoBackup } from '@/api/backup.js'
import { toDayKey } from '@/utils/date.js'
import { enableNativeFollowSystem } from '@/utils/theme.js'
import { confirmDialog } from '@/utils/dialog.js'
import { catchUpCycles } from '@/api/cycle.js'
import { showDbDiagnostics } from '@/api/db/diagnose.js'
import { useUpdateStore } from '@/stores/update.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { clearSettingsCache } from '@/api/settings.js'
import { handleExternalOpen, installIncomingListener } from '@/api/shareIntent.js'

export default {
  data() {
    return {
      themeListener: null,
      /** 取消 newintent 监听的函数（onHide 不用，App 生命周期比页面长） */
      offIncoming: null
    }
  },
  async onLaunch() {
    console.log('[app] launch')

    // 1) 打开数据库并执行迁移
    try {
      await openDb()
    } catch (e) {
      console.error('[app] 数据库打开失败:', e.message)
      /**
       * ★ App.vue 在 App 端没有 template（不渲染任何东西）★
       *   所以这里没法挂 <AppDialog />，
       *   confirmDialog() 会走 utils/dialog.js 里的兜底路径（退回原生弹窗）。
       *   启动期还没有任何页面，弹窗只能靠原生。
       */
      const runDiagnose = await confirmDialog({
        title: '创建数据库失败',
        content: e.message,
        confirmText: '运行自检',
        cancelText: '忽略'
      })
      if (runDiagnose) {
        showDbDiagnostics()
      }
      return
    }

    // 2) 开启原生 UI 跟随系统深浅色
    //    ★ 必须在 settingStore.load() 之前 ★
    //      setUIStyle('auto') 让原生层先进入「跟随系统」状态；
    //      紧接着 store.load() → applyTheme() → applyNativeTheme()
    //      会按用户实际选的模式（浅/深/跟随）再设一次，
    //      这次设的值才是最终生效的值。
    //    顺序反过来的话，load() 里设好的样式会被这里的 'auto' 覆盖掉，
    //    表现就是「选了浅色，但原生层还按系统走」。
    //
    //    另外 setUIStyle('auto') 是监听主题切换事件的前提
    //    （官方文档：「在 App 上需要先调用 plus.nativeUI.setUIStyle('auto')
    //    开启跟随系统主题切换的功能，才能监听到主题切换事件」）。
    try {
      enableNativeFollowSystem()
    } catch (e) {
      console.warn('[app] setUIStyle 失败:', e.message)
    }

    // 3) 加载设置
    const settingStore = useSettingStore()
    try {
      await settingStore.load()
    } catch (e) {
      console.error('[app] 设置加载失败:', e.message)
    }

    // 3) 首次启动：写入默认分类
    try {
      const n = await seedDefaultCategories()
      if (n > 0) console.log(`[app] 已初始化 ${n} 个默认分类`)
    } catch (e) {
      console.error('[app] 默认分类初始化失败:', e.message)
    }

    /*
     * 3b) 对齐「系统分类」组（幂等，只补不改）
     *
     * ★ 它跟 seedDefaultCategories 不是一回事 ★
     *   默认分类表（那 9 组支出 + 9 组收入）只服务三种场景：
     *   全新安装、清空数据、导入覆盖 —— 全都走上面的 seedDefaultCategories()。
     *   这里只负责维护「系统分类」这一个固定的组：
     *     1. 老库里的「系统预置分类」改名成「系统分类」；
     *     2. 补齐它下面的固定子类（借出/借款归还/对账支出、
     *        借入/借款收回/对账收入/报销收入）。
     *   **它一条默认分类都不会插** —— 用户自己把分类删光了也不会被塞回来，
     *   这一点是刻意的：分类是用户的，只有能删得掉才算真的属于他。
     *
     * ★ 为什么不在迁移里做 ★
     *   迁移是先判断 user_version 再跑的，只跑一次；
     *   而「系统分类」这个组以后还会继续加固定子类（报销收入就是新加的），
     *   每次都加一条迁移的话，版本号会被这些纯数据变更顶得飞快。
     *   做成「每次启动对一遍」最省事，而且天然幂等。
     *
     * ★ 为什么必须 try 住 ★
     *   它只是「锦上添花」，失败绝不能让 App 起不来。
     */
    try {
      const r = await syncDefaultCategories()
      if (r.parents || r.children || r.renamed) {
        console.log(
          `[app] 系统分类已对齐（新增组 ${r.parents}、固定子类 ${r.children}、改名 ${r.renamed}）`
        )
      }
    } catch (e) {
      console.error('[app] 系统分类对齐失败:', e.message)
    }

    // 4) 每日快照（资产趋势的数据源）
    try {
      await writeAllTodaySnapshots()
    } catch (e) {
      console.warn('[app] 快照写入失败:', e.message)
    }

    // 5) 自动备份（每天首次启动）
    try {
      const settings = await getAllSettings()
      const today = toDayKey()
      if (settings.autoBackup && settings.lastBackupDay !== today) {
        const res = await autoBackup('daily')
        if (res) await setSettings({ lastBackupDay: today })
      }
    } catch (e) {
      console.warn('[app] 自动备份失败:', e.message)
    }

    /*
     * 5b) 清理过期汇率（每天首次启动）
     *
     * ★ 为什么放这里而不是 openDb 里 ★
     *   清理是纯维护任务，不能拖慢启动关键路径
     *   （openDb 里有迁移要跑）。挂在「一天一次」这批任务里最合适，
     *   和自动备份同一时机。
     *
     * ★ 只保留最近 30 天 ★
     *   汇率表是按天 × 币种存的（每天 16 行），
     *   而打开记账面板就会落一份当日快照 ——
     *   不清的话一年 5,840 行、十年 5.8 万行。
     *   数据量本身不致命，但它是纯缓存，留着没价值。
     *
     * ★ 清理不影响已有账目 ★
     *   每笔交易的汇率快照存在 txn.exchange_rate 里，永久保存。
     *   这里删的只是「历史查询缓存」。
     *
     * ★ 用 lastRatePruneDay 做每日闸门 ★
     *   不加的话每次冷启动都会跑一次 DELETE 查询，
     *   虽然很快但没必要。
     */
    try {
      const settings = await getAllSettings()
      const today = toDayKey()
      if (settings.lastRatePruneDay !== today) {
        await pruneOldRates(today)
        await setSettings({ lastRatePruneDay: today })
      }
    } catch (e) {
      console.warn('[app] 清理汇率失败:', e.message)
    }

    // 6) 监听系统主题变化
    //    setUIStyle('auto') 已在前面调过（它同时是收到事件的前提）
    this.bindThemeListener()

    /*
     * 6b) 外部打开：微信 / 文件管理器「用其他应用打开」把 JSON 交给本应用
     *
     * ★ 为什么放在启动流程最后 ★
     *   导入会清库重写（覆盖模式），必须等 openDb 的迁移、默认分类、
     *   每日备份这些前置动作全部完成，否则会和它们抢事务。
     *
     * ★ 冷启动 + 热启动两条路都要接 ★
     *   · 冷启动：应用被文件拉起 → onLaunch 里读一次启动 Intent；
     *   · 热启动：应用在后台时被拉起 → 系统不会重跑 onLaunch，
     *     走 Activity 的 onNewIntent，DCloud 暴露成 plus.globalEvent 的
     *     'newintent' 事件。该事件在个别机型/时机不触发，
     *     所以 onShow 里还会再兜一次（见下面的 onShow），
     *     重复的靠 api/shareIntent.js 里的 uri 去重挡住。
     */
    // #ifdef APP-PLUS
    this.bindIncomingListener()
    this.consumeIncomingFile()
    // #endif

    // 7) 检查更新（静默）：每次开屏查一次 Gitee 最新发行版。
    //    有新版本时，更新弹窗会在首页出现（UpdateDialog 挂在首页/我的/更新日志）；
    //    无新版、网络失败一律静默，绝不在开屏时打扰用户。
    //    延迟几秒再查：启动阶段数据库迁移、周期补记在排队，
    //    别让一个更新检查挤占首屏资源。
    // #ifdef APP-PLUS
    setTimeout(() => {
      useUpdateStore().checkForUpdate(true)
    }, 3000)
    // #endif
  },

  onShow() {
    // 兜底：部分 Android 机型 uni.onThemeChange 不触发，每次回前台重读一次
    try {
      const settingStore = useSettingStore()
      if (settingStore.loaded) {
        settingStore.syncSystemTheme()
        // 回前台时也刷一次 tabBar：
        // 系统主题可能在后台变了，而事件没送达
        settingStore.refreshTabBar()
      }
    } catch (e) {}

    /*
     * 外部打开兜底（第 2 条通道）
     *
     * ★ 为什么 onShow 也要读一次 ★
     *   应用在后台时被「用其他应用打开」拉起，理论上走 newintent 事件，
     *   但该事件在部分机型/系统版本上不触发（社区反复提到）。
     *   onShow 一定会执行，所以在这里再读一次 Intent。
     *
     * ★ 不会重复导入 ★
     *   冷启动时 onLaunch 先读了同一个 uri，
     *   api/shareIntent.js 里有 8 秒同 uri 去重窗口，第二次直接返回 duplicate。
     *   延时 120ms 是为了等系统把 content:// 的临时读权限交过来。
     */
    // #ifdef APP-PLUS
    this.consumeIncomingFile(120)
    // #endif

    // 周期自动补记：每次进前台都跑一次。
    // 游标（last_caught_up_day）保证幂等——同一天重复进不会重复记、
    // 用户手删的账也不会被重建。冷启动后首次 onShow 与这里一并覆盖。
    this.runCycleCatchUp()
  },

  onHide() {
    console.log('[app] hide')
  },

  methods: {
    async runCycleCatchUp() {
      if (this._cycleCatchUpRunning) return
      this._cycleCatchUpRunning = true
      try {
        const added = await catchUpCycles()
        const total = added.reduce((s, r) => s + r.added, 0)
        if (total > 0) {
          console.log(`[app] 周期自动补记：${total} 笔（${added.length} 个周期）`)
          // 轻提示，不打断（用户在记账页/详情页会看到新流水）
          try { uni.showToast({ title: `已自动补记 ${total} 笔周期账`, icon: 'none' }) } catch (e) {}

          /*
           * ★ 补记完必须通知页面重新拉数据（用户反馈的 bug）★
           *   竞态：App.vue 的 onShow 和页面自己的 onShow 是两条独立的异步流。
           *   页面 onShow 里的 loadAll(true) 不会等补记写完库 ——
           *   它先查出旧数据、渲染完，补记才落库，
           *   于是「首页补齐周期记账之后不能立刻显示出来」，
           *   得等下一次刷新（切 tab / 再次回前台）才看得到。
           *
           *   这里补记成功、且确实新增了流水时发一个全局事件，
           *   各页面监听后主动 reload，把新流水立刻刷出来。
           *   ★ 只在 total > 0 时发 ★
           *     没有新增流水就不发，避免每次进前台都让所有页面白白重查一遍。
           */
          try { uni.$emit('cycle:caughtup', total) } catch (e) {}
        }
      } catch (e) {
        console.warn('[app] 周期补记失败:', e && e.message)
      } finally {
        this._cycleCatchUpRunning = false
      }
    },

    bindThemeListener() {
      // ★ 订阅交给 store 统一管理 ★
      //   之前这里自己监听 uni.onThemeChange，
      //   但回调里只比较 settingStore.systemDark，
      //   而 App 端 onThemeChange 在部分 Android 机型上不触发，
      //   加上读到的 theme 字段本身在 Android 上就常返回 light，
      //   结果系统切深色 App 完全没反应。
      //
      //   现在 store.watchSystemTheme() 走双保险通道
      //   （uni.onThemeChange + plus.globalEvent），
      //   并且用 osTheme 复核，onShow 再兜底重读一次。
      try {
        const settingStore = useSettingStore()
        settingStore.watchSystemTheme()
      } catch (e) {
        console.warn('[app] 主题监听失败，将依赖 onShow 兜底:', e.message)
      }
    },

    /* ------------------------------------------------ 外部打开导入 */

    /**
     * 注册「应用在后台时被文件唤醒」的监听（newintent）。
     *
     * 回调**没有参数**（官方事件原型 onTrig()），
     * 里面要自己再去读 Intent —— 这部分封装在
     * api/shareIntent.js 的 installIncomingListener 里。
     */
    bindIncomingListener() {
      if (this.offIncoming) return
      try {
        this.offIncoming = installIncomingListener({
          silent: true,
          /*
           * ★ 这里要自己刷新 + 自己提示 ★
           *   newintent 是从原生层直接进来的，不经过 consumeIncomingFile()，
           *   所以「导入后重载数据」和「告诉用户导了多少」都得在这里做，
           *   否则用户看到的是：弹了一下 → 页面还是旧数据。
           */
          onImported: async (report) => {
            await this.refreshAfterImport()
            this.reportImported(report)
          }
        })
      } catch (e) {
        console.warn('[app] newintent 监听失败，将依赖 onShow 兜底:', e && e.message)
      }
    },

    /**
     * 读一次当前 Intent，若带着文件就导入。
     *
     * @param {number} delay 延迟毫秒。冷启动用 0；onShow 用 120，
     *                       给系统把 content:// 的临时读权限交过来留点时间。
     */
    consumeIncomingFile(delay = 0) {
      const run = async () => {
        try {
          /*
           * ★ 这里不要用 onImported 做刷新 ★
           *   onImported 是导入流程内部的回调，它是**不 await** 的
           *   （见 api/shareIntent.js），如果在那里刷新，
           *   下面 reportImported 的 reLaunch 可能抢在刷新完成之前，
           *   页面重建时读到的仍是旧 store。
           *   所以放在 handleExternalOpen 返回之后，串行做。
           */
          const res = await handleExternalOpen({ silent: true })
          if (!res || !res.handled) return
          await this.refreshAfterImport()
          this.reportImported(res.report)
        } catch (e) {
          console.warn('[app] 外部打开处理失败:', e && e.message)
        }
      }
      if (delay > 0) setTimeout(run, delay)
      else run()
    },

    /**
     * 导入后刷新全局数据。
     *
     * 顺序照抄 pages/settings/data.vue 的导入流程：
     * 清 settings 缓存 → 重载设置 → 账户 → 首页交易。
     * 少任何一步都会出现「数据导进来了但界面还是旧的」。
     */
    async refreshAfterImport() {
      try {
        clearSettingsCache()
        await useSettingStore().load()
      } catch (e) {
        console.warn('[app] 导入后重载设置失败:', e && e.message)
      }
      try {
        await useAccountStore().refresh()
      } catch (e) {
        console.warn('[app] 导入后刷新账户失败:', e && e.message)
      }
      try {
        await useTransactionStore().loadHome(true)
      } catch (e) {
        console.warn('[app] 导入后刷新流水失败:', e && e.message)
      }
      // 通知各页面自己再拉一次（统计页的月视图、账户页的图表等）
      try { uni.$emit('data:imported') } catch (e) {}
    },

    /**
     * 导入成功的提示与跳转。
     *
     * ★ 为什么要跳首页 ★
     *   导入是覆盖，用户原来停在「统计 / 账户详情」这类页面上，
     *   数据已经整库换掉了，继续留在那页看到的很可能是空数据 / 错位数据。
     *   切回首页最稳。
     */
    reportImported(report) {
      const r = report || {}
      const text = `已导入 ${r.accounts || 0} 账户 / ${r.transactions || 0} 笔`
      try {
        uni.showToast({ title: text, icon: 'none', duration: 2500 })
      } catch (e) {}

      try {
        const pages = getCurrentPages()
        const top = pages[pages.length - 1]
        const route = top && top.route ? String(top.route) : ''
        // 已经在首页就不跳，避免无谓的闪一下
        if (route !== 'pages/index/index') {
          uni.reLaunch({ url: '/pages/index/index' })
        }
      } catch (e) {}
    }
  }
}
</script>

<style>
/* ============================================================
   全局样式 —— 所有颜色走 CSS 变量，由各页面根节点注入
   ============================================================ */

page {
  background-color: var(--app-bg, #f7f8fa);
  color: var(--app-text, #323233);
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica,
    'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-size: 28rpx;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  /**
   * 页面高度撑满可用区域。
   *
   * 软键盘「整页上移」的根治办法是两个配置叠加：
   *   1. pages.json → globalStyle.app-plus.softinputMode = "adjustResize"
   *      （uni-app 默认是 adjustPan，会把整个 webview 上推）
   *   2. 输入框 adjust-position="false"
   *      禁止框架把页面滚动到输入框可见
   *
   * 这两项关掉后，页面本身不会动；只有 QuickAddBar 这个 position:fixed
   * 的输入条根据键盘高度主动上移，视觉上就是「输入条浮起来，页面不动」。
   */
  height: 100%;
}

view, text, scroll-view, image {
  box-sizing: border-box;
}

/* 通用卡片 */
.app-card {
  background-color: var(--app-card, #ffffff);
  border-radius: 20rpx;
  padding: 32rpx;
  box-shadow: var(--app-shadow, 0 2rpx 16rpx rgba(0, 0, 0, 0.06));
}

/**
 * 通用页面容器
 *
 * ★ 高度必须用 flex 而不是 min-height:100vh ★
 *   之前用 min-height + padding-bottom，会出现两个问题：
 *     1. tabBar 页面的 100vh 已经包含了 tabBar 区域，再叠 padding 就多出空白
 *     2. scroll-view 没有父级 flex 约束，高度只能靠 JS 猜，必然算不准
 *
 *   现在：.app-page 撑满 page，纵向 flex；scroll-view 用 flex:1 吃满剩余空间。
 *   高度完全由渲染引擎计算，顶部状态栏、底部 tabBar、安全区都不用我们管。
 */
.app-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  /* 注意：这里不要加 transform / filter / perspective，
     它们会让 position:fixed 的子元素（如悬浮按钮）改为相对本容器定位 */
  position: relative;
  background-color: var(--app-bg, #f7f8fa);
  /* 纵向裁剪交给 scroll-view，本层不裁剪，避免 fixed 悬浮按钮被切 */
  overflow: visible;
}

/* 页面内的滚动区：自动占满 header / 导航之外的剩余高度 */
.app-page > .page-scroll,
.app-page > .list-scroll {
  flex: 1;
  height: 0;         /* 关键：让 flex:1 生效，否则内容会把容器撑高 */
  overflow: hidden;
}

/* 非滚动内容区（如引导页、全屏弹层） */
.app-page > .flex-fill {
  flex: 1;
  min-height: 0;
}

/**
 * 滚动内容末尾的留白。
 * 放在全局是因为 16 个页面都要用，且必须叠加安全区，
 * 否则最后一条内容会被 tabBar 或底部手势条压住。
 *
 * ★ 这个值只够「原生 tabBar 或手势条」★
 *   tab 页现在用的是悬浮圆角底栏（浮在内容之上，不占布局），
 *   需要更多留白，见下面的 .tabbar-space。
 */
.bottom-space {
  height: calc(env(safe-area-inset-bottom) + 40rpx);
}

/**
 * tab 页专用底部留白：给悬浮底栏让位。
 *
 * ★ 为什么需要单独一个类 ★
 *   原生 tabBar 会「占掉」页面底部高度，内容自然不会被挡；
 *   换成自绘悬浮栏后它浮在内容之上，不占布局 ——
 *   若还用 40rpx 的 .bottom-space，最后一条记录会被底栏压住。
 *
 * 数值来源：
 *   底栏高度 128rpx + 底边距 16rpx + 安全区，再留 24rpx 呼吸空间
 *   → 168rpx + 安全区。留多了页面底部会空一大截，留少了会压住内容。
 */
.tabbar-space {
  height: calc(env(safe-area-inset-bottom) + 168rpx);
}

/* 文本工具类 */
.t-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text, #323233);
}
.t-secondary {
  font-size: 26rpx;
  color: var(--app-text-2, #646566);
}
.t-tertiary {
  font-size: 24rpx;
  color: var(--app-text-3, #969799);
}

/* 分割线 */
.app-divider {
  height: 1rpx;
  background-color: var(--app-line, #ebedf0);
}

/* 单行省略 */
.ellipsis {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/**
 * ============================================================
   输入框（uni-input）兜底样式
   ============================================================

   ★ 为什么要全局补这一条 ★
     App 端 <input> 编译成 <uni-input> 包装元素，内部结构是
       uni-input > .uni-input-wrapper > .uni-input-input（真正的 <input>）
     框架默认样式里内部各层都是 width:100%，但 uni-input 自身没有
     min-width 约束 —— 放进 flex 行时默认 min-width:auto
     （最小宽度 = 内容宽度），文本一长就把整行撑开，
     可视宽度被内容撑满、按钮被挤出去，看起来就是
     「文本被遮住、还滑不动」（AI 速记输入条踩的就是这个坑）。

   ★ 为什么全局只写 flex / min-width，不写 width: 0 ★
     width: 0 是让 flex 项按容器分配空间的关键，但它**只在父级是
     flex 容器时才安全**。本项目有一批输入框的父容器是普通块级：
       · components/AppDialog.vue 的 prompt 输入框
         （.app-dialog__input-wrap 只有 padding，不是 flex）
       · pages/txn/list.vue 的关键词搜索
         （.filter-section 是普通块级）
     这类输入框靠「块级撑满」工作，全局写 width: 0 会把它们压成 0 宽、
     直接看不见。所以 width: 0 只写在**确认为 flex 行**的组件里
     （QuickAddBar 的 .bar-input、聊天页的 .chat-input）。

     而 flex / min-width 这两条是全局安全的：
       · flex  只对 flex 项生效，父级不是 flex 时被浏览器忽略；
       · min-width: 0 只是解除「最小宽度 = 内容宽度」，
         块级元素本来就会撑满，写了一点副作用都没有。
     所以这两条可以放心全局给，当作所有输入框的兜底。

   ★ 只针对 uni-input / .uni-input-* ★
     不写成 input / textarea 之类的宽泛选择器，
     免得波及 picker、textarea 等其它控件。
*/
uni-input {
  flex: 1;
  min-width: 0;
}

/* 内部输入区宽度跟随容器，溢出交给原生横向滚动 */
uni-input .uni-input-wrapper {
  width: 100%;
  overflow: hidden;
}

uni-input .uni-input-input {
  width: 100%;
}

/* 过渡动画 */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
