/**
 * 设置 / 主题 store
 *
 * 负责：
 *   1. 设置项的读取与持久化
 *   2. 主题三态解析（跟随系统 / 浅 / 深）
 *   3. 把 CSS 变量注入到根节点（通过 rootStyle 给页面使用）
 */

import { defineStore } from 'pinia'
import { getAllSettings, setSettings } from '@/api/settings.js'
import {
  THEME_PRESETS, THEME_MODE, resolveDark, buildCssVars, buildWotThemeVars,
  buildWotCssVars, wotThemeClass, applyTabBarTheme, refreshTabBarTheme,
  applyNavigationBarTheme, isSystemDark, getPreset
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
    /** 重新读取系统深浅色（onShow 兜底） */
    syncSystemTheme() {
      const sys = isSystemDark()
      if (sys !== this.systemDark) {
        this.systemDark = sys
        if (this.settings.themeMode === THEME_MODE.SYSTEM) {
          this.applyTheme()
          // 系统深浅色变了，tabBar 也要跟着刷
          this.markTabBarThemeDirty()
        }
      }
    },

    applyTheme() {
      this.systemDark = isSystemDark()
      this.isDark = resolveDark(this.settings.themeMode)
      applyNavigationBarTheme(this.isDark)
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
    }
  }
})
