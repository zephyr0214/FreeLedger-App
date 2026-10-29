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

/**
 * 启动后多久之内还要「补刷」tabBar（毫秒）。
 *
 * 冷启动时首个 tab 页的 onShow 常常赶在原生 tabBar 创建之前，
 * 那次 setTabBarStyle / setTabBarItem 静默失效，
 * 于是首屏停在 pages.json 写死的绿色默认图标上，用户点一下才变。
 * 这段时间内每次 refreshTabBar 都会顺手排几轮补刷把落花补上。
 *
 * 2.5 秒足够覆盖冷启动的建表、读设置、写快照这些耗时，
 * 又不会长到让「切 tab 的 onShow」也白排定时器。
 */
const TABBAR_BOOT_WINDOW_MS = 2500

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
      lastBackupAt: 0
    },
    isDark: false,
    systemDark: false,
    /**
     * 主题刚变过时置位：下次 tabBar 刷新要用「强制」模式冲缓存。
     * 部分 Android ROM 会缓存 tabBar 的图标与配色，
     * 只传新值不立刻重绘，需要先刷一遍默认色再刷目标色。
     */
    tabBarThemeDirty: false,

    /**
     * 启动时刻（首次 refreshTabBar 时打点）。
     * 只在启动窗口（TABBAR_BOOT_WINDOW_MS）内做补刷，见 _scheduleTabBarRetry。
     */
    _tabBarBootAt: 0,

    /** 补刷是否已在进行中，防止 4 个 tab 页各排一串定时器 */
    _tabBarRetrying: false
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
      //
      // ★ 这一轮大概率还是会「太早」★
      //   此时原生 tabBar 往往还没建好，setTabBarStyle / setTabBarItem
      //   静默失效。真正把它补上的是 refreshTabBar() 里的补刷逻辑
      //   （见 _scheduleTabBarRetry）：设置读完之后重新起算启动窗口，
      //   保证补刷覆盖到「tabBar 建成」的那一刻。
      this._tabBarBootAt = Date.now()
      this._tabBarRetrying = false
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
     *
     * ★ 冷启动为什么要补刷几轮 ★
     *   冷启动时第一轮调用总是「太早」：App.onLaunch 里 tabBar 还没建好，
     *   首个 tab 页的首次 onShow 也常常赶在原生 tabBar 创建之前。
     *   那一轮 setTabBarStyle / setTabBarItem 静默失效，
     *   首屏就停在 pages.json 里写死的绿色默认图标上，
     *   用户点一下 tab 触发下一次 onShow 才变 —— 即「点击才刷新」。
     *   现在启动后的一小段时间内会自己补刷几轮，不依赖用户点击。
     */
    refreshTabBar() {
      // tabBarThemeDirty 表示「主题刚变过，需要冲一下缓存」。
      // 由 setThemeMode / setThemePreset 设置，这里消费掉。
      const force = this.tabBarThemeDirty
      this.tabBarThemeDirty = false

      this._applyTabBar(force)
      this._scheduleTabBarRetry(force)
    },

    /**
     * 真正落地一次 tabBar 主题。
     *
     * ★ 不看返回值判断成功与否 ★
     *   原生 tabBar 还没建好时，这两个接口既可能抛错，
     *   也可能「不抛错但什么也没做」，没有可靠的就绪信号。
     *   所以失败与否都交给 _scheduleTabBarRetry 用「多刷几轮」兜住。
     *
     * @param {boolean} force 是否「冲缓存」
     */
    _applyTabBar(force) {
      try {
        refreshTabBarTheme(this.settings.themePreset, this.isDark, force)
      } catch (e) {
        // 原生 tabBar 尚未就绪，交给补刷逻辑
      }
    },

    /**
     * 冷启动兜底：启动后的一小段时间内补刷几次。
     *
     * 为什么是「无条件补刷」而不是「失败才补刷」：
     *   原生接口在 tabBar 未就绪时不会给明确失败信号（见 _applyTabBar）。
     *   重复刷同样的值是无害的（force=false 不会先刷默认色，不会闪），
     *   所以宁可多刷两次。
     *
     * 只在启动窗口内生效：过了 TABBAR_BOOT_WINDOW_MS 就不再排，
     * 否则每次切 tab 的 onShow 都排一串定时器，纯属浪费。
     *
     * ★ 只有第一轮补刷带 force ★
     *   force 会「先刷一遍默认绿再刷目标色」。
     *   冷启动时首屏本来就是默认绿，这么冲一下正好；
     *   但要是每轮都冲，切主题后就会连闪四次，
     *   所以第二轮起都按普通模式刷。
     *
     * @param {boolean} force 是否「冲缓存」
     */
    _scheduleTabBarRetry(force) {
      // 只在启动窗口内补刷
      if (!this._tabBarBootAt) this._tabBarBootAt = Date.now()
      if (Date.now() - this._tabBarBootAt > TABBAR_BOOT_WINDOW_MS) return
      // 已经在补刷了就别再排一串
      if (this._tabBarRetrying) return
      this._tabBarRetrying = true

      // 累计约 80 / 330 / 930 / 2130ms 各补刷一次
      const steps = [80, 250, 600, 1200]
      let i = 0
      let nextForce = force

      const step = () => {
        if (i >= steps.length) {
          this._tabBarRetrying = false
          return
        }
        const delay = steps[i]
        i += 1
        const f = nextForce
        // 只有第一次补刷保留 force，之后都普通刷，避免反复闪默认色
        nextForce = false
        setTimeout(() => {
          this._applyTabBar(f)
          step()
        }, delay)
      }

      step()
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
