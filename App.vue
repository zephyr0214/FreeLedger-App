<script>
import { useSettingStore } from '@/stores/setting.js'
import { openDb } from '@/api/db/index.js'
import { seedDefaultCategories } from '@/api/category.js'
import { writeAllTodaySnapshots } from '@/api/account.js'
import { getAllSettings, setSettings } from '@/api/settings.js'
import { autoBackup } from '@/api/backup.js'
import { toDayKey } from '@/utils/date.js'
import { enableNativeFollowSystem } from '@/utils/theme.js'
import { confirmDialog } from '@/utils/dialog.js'
import { catchUpCycles } from '@/api/cycle.js'
import { showDbDiagnostics } from '@/api/db/diagnose.js'

export default {
  data() {
    return {
      themeListener: null
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

    // 6) 监听系统主题变化
    //    setUIStyle('auto') 已在前面调过（它同时是收到事件的前提）
    this.bindThemeListener()
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
 */
.bottom-space {
  height: calc(env(safe-area-inset-bottom) + 40rpx);
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

/* 过渡动画 */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
