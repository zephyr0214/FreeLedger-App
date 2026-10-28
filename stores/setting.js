/**
 * 设置 / 主题 store
 *
 * 负责：
 *   1. 设置项的读取与持久化
 *   2. 主题三态解析（跟随系统 / 浅 / 深）
 *   3. 把 CSS 变量注入到根节点（通过 rootStyle 给页面使用）
 */

import { defineStore } from 'pinia'
import { getAllSettings, setSettings, normalizeQuickAddAction } from '@/api/settings.js'
import {
  THEME_PRESETS, THEME_MODE, resolveDark, buildCssVars, buildWotThemeVars,
  buildWotCssVars, wotThemeClass, applyTabBarTheme, refreshTabBarTheme,
  applyNavigationBarTheme, isSystemDark, getPreset, watchSystemTheme,
  applyNativeTheme
} from '@/utils/theme.js'

export const useSettingStore = defineStore('setting', {
  state: () => ({
    loaded: false,
    settings: {
      nickname: '',
      avatar: '',
      signature: '',
      defaultAccountId: '',
      monthStartDay: 1,
      currencySymbol: '¥',
      firstRunDone: false,
      themeMode: THEME_MODE.SYSTEM,
      themePreset: 'green',
      privacyMode: false,
      quickAddHoldAction: 'manual',
      quickAddTapAction: 'ai',
      ai: { baseUrl: '', apiKey: '', model: 'deepseek-chat', temperature: 0.3, timeoutMs: 20000, quickFallback: false },
      autoBackup: true,
      lastExportAt: 0
    },
    isDark: false,
    systemDark: false,
    /**
     * 主题刚变过时置位：下次 tabBar 刷新要用「强制」模式冲缓存。
     * 部分 Android ROM 会缓存 tabBar 的图标与配色，
     * 只传新值不立刻重绘，需要先刷一遍默认色再刷目标色。
     */
    tabBarThemeDirty: false
  }),

  getters: {
    /** 注入页面的 CSS 变量串 */
    cssVars(state) {
      return buildCssVars(state.settings.themePreset, state.isDark)
    },
    /** 传给 wd-config-provider 的主题 */
    wotTheme(state) {
      return state.isDark ? 'dark' : 'light'
    },
    wotThemeVars(state) {
      return buildWotThemeVars(state.settings.themePreset)
    },
    /**
     * 组件库深色模式需要的 class。
     * 库的深色样式是 `.wot-theme-dark .wd-button {...}` 这种后代选择器，
     * 必须有祖先带这个类才生效，所以要加到页面根节点上。
     */
    wotClass(state) {
      return wotThemeClass(state.isDark)
    },
    preset(state) {
      return getPreset(state.settings.themePreset)
    },
    primaryColor(state) {
      return getPreset(state.settings.themePreset).primary
    },
    currencySymbol(state) {
      return state.settings.currencySymbol || '¥'
    },
    privacyMode(state) {
      return !!state.settings.privacyMode
    },
    nickname(state) {
      return state.settings.nickname || '记账人'
    },
    avatar(state) {
      return state.settings.avatar || ''
    },
    /**
     * 悬浮「+」按钮长按触发什么
     * ai | manual | none
     */
    quickAddHoldAction(state) {
      return normalizeQuickAddAction(state.settings.quickAddHoldAction, 'manual')
    },
    /**
     * 悬浮「+」按钮短按触发什么
     * ai | manual | none
     */
    quickAddTapAction(state) {
      return normalizeQuickAddAction(state.settings.quickAddTapAction, 'ai')
    }
  },

  actions: {
    async load() {
      const s = await getAllSettings()
      this.settings = { ...this.settings, ...s }
      this.loaded = true
      this.applyTheme()
      // 首屏刷一次 tabBar：pages.json 里写死的是绿色浅色，
      // 用户可能存的是别的配色。
      // 此时还没有 tabBar 实例，调用会失败并被忽略；
      // 真正生效的是各 tab 页 onShow 里的那次。
      this.refreshTabBar()
      return this.settings
    },
    /**
     * 重新读取系统深浅色（onShow 兜底 + 系统事件触发时用）。
     *
     * ★ 关键：isDark 要重新算一遍，不能只看 systemDark 变没变 ★
     *   用户可能把「跟随系统」改成了「始终浅色」，
     *   这时系统再变深色，App 不该跟着变。
     */
    syncSystemTheme() {
      const sys = isSystemDark()
      const wasDark = this.isDark
      this.systemDark = sys

      // 重新按 mode 解析出最终是否深色
      const nextDark = resolveDark(this.settings.themeMode)
      this.isDark = nextDark

      if (nextDark !== wasDark) {
        // 页面内容要立刻变
        applyNavigationBarTheme(nextDark)
        // tabBar 也要跟着刷
        this.markTabBarThemeDirty()
      }

      // ★ 原生层始终跟着当前模式走 ★
      //   mode='system' 时样式是 'auto'（原生层自己跟系统），
      //   这里调用会被 lastNativeStyle 去重挡掉，不会重复设置。
      //   但如果用户刚从「深色」切到「跟随系统」，这里能保证原生层也切回 auto。
      applyNativeTheme(this.isDark, this.settings.themeMode)
    },

    /**
     * 订阅系统深浅色变化。
     * 幂等：重复调用只会订阅一次。
     */
    watchSystemTheme() {
      if (this._themeWatchOff) return
      this._themeWatchOff = watchSystemTheme(() => {
        this.syncSystemTheme()
      })
    },

    applyTheme() {
      this.systemDark = isSystemDark()
      this.isDark = resolveDark(this.settings.themeMode)
      applyNavigationBarTheme(this.isDark)
      // ★ 原生层也要跟着变 ★
      //   否则 App 内容是深色、状态栏/原生 tabBar 还是浅色，
      //   或者反过来 —— 切回浅色时就会看着「没生效」。
      applyNativeTheme(this.isDark, this.settings.themeMode)
    },

    /**
     * 重刷原生 tabBar 的配色与图标。
     *
     * ★ 只能由「有 tabBar 的页面」调用 ★
     *   主题设置页是 navigateTo 过去的子页面，没有 tabBar 实例，
     *   uni.setTabBarStyle / setTabBarItem 在那里是无效的
     *   （App 端这两个接口只对 tabBar 页面生效）——
     *   这正是「切换主题后 tabBar 不变」的原因。
     *   所以 4 个 tab 页的 onShow 都要调这个方法。
     */
    refreshTabBar() {
      // tabBarThemeDirty 表示「主题刚变过，需要冲一下缓存」。
      // 由 setThemeMode / setThemePreset 设置，这里消费掉。
      const force = this.tabBarThemeDirty
      this.tabBarThemeDirty = false
      refreshTabBarTheme(this.settings.themePreset, this.isDark, force)
    },

    /** 标记主题变了：下次 tabBar 刷新时用「强制」模式冲缓存 */
    markTabBarThemeDirty() {
      this.tabBarThemeDirty = true
    },

    async setThemeMode(mode) {
      this.settings.themeMode = mode
      // ★ 先更新 UI，再写库 ★
      //   写库是异步的，放在前面会让主题切换慢一拍。
      this.applyTheme()
      // 标记 tabBar 需要「强制」刷新
      this.markTabBarThemeDirty()
      await setSettings({ themeMode: mode })
    },

    async setThemePreset(key) {
      this.settings.themePreset = key
      this.applyTheme()
      this.markTabBarThemeDirty()
      await setSettings({ themePreset: key })
    },

    async update(patch) {
      this.settings = { ...this.settings, ...patch }
      // 主题相关的设置需要立即生效
      if ('themeMode' in patch || 'themePreset' in patch) {
        this.applyTheme()
        this.markTabBarThemeDirty()
      }
      await setSettings(patch)
    },

    async setAi(patch) {
      const ai = { ...this.settings.ai, ...patch }
      this.settings.ai = ai
      await setSettings({ ai })
    },

    async setPrivacyMode(on) {
      this.settings.privacyMode = !!on
      await setSettings({ privacyMode: !!on })
    },

    /**
     * 设置悬浮「+」按钮的触发方式
     *
     * @param {'hold'|'tap'} which hold = 长按，tap = 短按
     * @param {string} action ai | manual | none
     */
    async setQuickAddAction(which, action) {
      const key = which === 'hold' ? 'quickAddHoldAction' : 'quickAddTapAction'
      const fallback = which === 'hold' ? 'manual' : 'ai'
      const value = normalizeQuickAddAction(action, fallback)
      this.settings[key] = value
      await setSettings({ [key]: value })
      return value
    }
  }
})
