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
  applyTabBarTheme, applyNavigationBarTheme, isSystemDark, getPreset
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
    systemDark: false
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
      return this.settings
    },

    /** 重新读取系统深浅色（onShow 兜底） */
    syncSystemTheme() {
      const sys = isSystemDark()
      if (sys !== this.systemDark) {
        this.systemDark = sys
        if (this.settings.themeMode === THEME_MODE.SYSTEM) {
          this.applyTheme()
        }
      }
    },

    applyTheme() {
      this.systemDark = isSystemDark()
      this.isDark = resolveDark(this.settings.themeMode)
      applyTabBarTheme(this.settings.themePreset, this.isDark)
      applyNavigationBarTheme(this.isDark)
    },

    async setThemeMode(mode) {
      this.settings.themeMode = mode
      await setSettings({ themeMode: mode })
      this.applyTheme()
    },

    async setThemePreset(key) {
      this.settings.themePreset = key
      await setSettings({ themePreset: key })
      this.applyTheme()
    },

    async update(patch) {
      this.settings = { ...this.settings, ...patch }
      await setSettings(patch)
      // 主题相关的设置需要立即生效
      if ('themeMode' in patch || 'themePreset' in patch) {
        this.applyTheme()
      }
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
