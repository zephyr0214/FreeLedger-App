<script>
import { useSettingStore } from '@/stores/setting.js'
import { openDb } from '@/api/db/index.js'
import { seedDefaultCategories } from '@/api/category.js'
import { writeAllTodaySnapshots } from '@/api/account.js'
import { getAllSettings, setSettings } from '@/api/settings.js'
import { autoBackup } from '@/api/backup.js'
import { toDayKey } from '@/utils/date.js'

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
      uni.showModal({
        title: '创建数据库失败',
        content: e.message,
        confirmText: '运行自检',
        cancelText: '忽略',
        success: (res) => {
          if (res.confirm) {
            import('@/api/db/diagnose.js').then((m) => m.showDbDiagnostics())
          }
        }
      })
      return
    }

    // 2) 加载设置
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
    this.bindThemeListener()
  },

  onShow() {
    // 兜底：部分 Android 机型 uni.onThemeChange 不触发，每次回前台重读一次
    try {
      const settingStore = useSettingStore()
      if (settingStore.loaded) settingStore.syncSystemTheme()
    } catch (e) {}
  },

  onHide() {
    console.log('[app] hide')
  },

  methods: {
    bindThemeListener() {
      try {
        if (typeof uni.onThemeChange === 'function') {
          this.themeListener = (res) => {
            const settingStore = useSettingStore()
            settingStore.systemDark = res.theme === 'dark'
            if (settingStore.settings.themeMode === 'system') {
              settingStore.applyTheme()
            }
          }
          uni.onThemeChange(this.themeListener)
        }
      } catch (e) {
        console.warn('[app] onThemeChange 不可用，将依赖 onShow 兜底:', e.message)
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
  /* 高度由视口决定，页面内部用 flex 分配，不再靠 JS 算 */
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
