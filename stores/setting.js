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
  buildWotCssVars, wotThemeClass, themePrimaryLightDark,
  applyNavigationBarTheme, isSystemDark, getPreset, watchSystemTheme,
  applyNativeTheme
} from '@/utils/theme.js'
import { hideNativeTabBar } from '@/utils/tabBar.js'

/**
 * 启动后多久之内还要「补一次」隐藏原生 tabBar（毫秒）。
 *
 * ★ 冷启动时第一次 hideTabBar 总是「太早」★
 *   原生 tabBar 由系统在页面创建之前先画出来，
 *   但 App.onLaunch 阶段以及首个 tab 页的首次 onShow
 *   都可能赶在它真正可操作之前，那一轮 hideTabBar 静默失败。
 *   结果是：我们的自绘圆角底栏浮在上面，
 *   底下还压着一条系统原生 tabBar —— 两条栏叠在一起，非常难看。
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
      currencySymbol: '¥',
      firstRunDone: false,
      themeMode: THEME_MODE.SYSTEM,
      themePreset: 'green',
      privacyMode: false,
      quickAddHoldAction: 'manual',
      quickAddTapAction: 'ai',
      ai: { baseUrl: '', apiKey: '', model: 'deepseek-chat', timeoutMs: 30000 },
      aiChat: { temperature: 0.6, deepThinking: true, maxTokens: 8000, showCharts: true, timeoutMs: 120000 },
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
    /**
     * 主题色的浅色版（同一色相的淡底）。
     *
     * 用于需要「浅主题色背景」的地方，如 tabBar 的选中滑块。
     *
     * ★ 必须按深浅模式区分 ★
     *   浅色下用预设里的 light 值 —— 那是调过的浅色，饱和度比算出来的 rgba 更耐看；
     *   暗色下预设的 light（如 #E8F9EF 近白）太亮，直接铺在深色上会「发光」，
     *   而且原先暗色分支根本没用这个值（写死了纯白半透明，几乎看不出选中），
     *   所以这里改成返回带主题色相的半透明色，和高亮底色保持同一套观感。
     */
    primaryLight(state) {
      const p = getPreset(state.settings.themePreset)
      if (state.isDark) {
        return themePrimaryLightDark(p.primary, state.isDark)
      }
      return p.light
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
     * 隐藏原生 tabBar。
     *
     * ★ 为什么现在不只是「刷配色」，而是「藏起来」 ★
     *   底栏改成圆角悬浮后，原生 tabBar 已经不再承担显示职责
     *   （它由系统绘制，做不出圆角/悬浮/留白/阴影），
     *   视觉全部交给 components/AppTabBar.vue。
     *   但 pages.json 里的 tabBar 声明不能删 —— 它同时把 4 个页面
     *   注册成 tab 页，uni.switchTab 依赖这个注册。
     *   所以声明留着，只把系统画的那条藏掉，否则两条栏会叠在一起。
     *
     * ★ 只能由「tab 页」调用 ★
     *   uni.hideTabBar 只对 tabBar 页面生效，在 navigateTo 过去的
     *   子页面（如设置页）调用会失败。所以 4 个 tab 页的 onShow 都要调。
     *
     * ★ 冷启动要补几轮 ★
     *   见 TABBAR_BOOT_WINDOW_MS 的说明：第一轮多半「太早」，
     *   静默失败后原生栏会压在自绘栏底下。所以启动窗口内多藏几次。
     */
    refreshTabBar() {
      // tabBarThemeDirty 现在只用来提示「主题变过」，
      // 自绘底栏的颜色是响应式的，改完即生效，不需要冲缓存；
      // 这里仍然消费掉，避免这个标记一直挂着。
      this.tabBarThemeDirty = false

      this._applyTabBar()
      this._scheduleTabBarRetry()
    },

    /**
     * 真正执行一次「隐藏原生 tabBar」。
     *
     * ★ 不看返回值判断成功与否 ★
     *   原生 tabBar 还没建好时，hideTabBar 既可能抛错，
     *   也可能「不抛错但什么也没做」，没有可靠的就绪信号。
     *   所以失败与否都交给 _scheduleTabBarRetry 用「多藏几次」兜住。
     */
    _applyTabBar() {
      hideNativeTabBar()
    },

    /**
     * 冷启动兜底：启动后的一小段时间内多藏几次。
     *
     * 为什么是「无条件重复」而不是「失败才重试」：
     *   原生接口在 tabBar 未就绪时不会给明确失败信号（见 _applyTabBar）。
     *   hideTabBar 是幂等的 —— 已经藏好了再藏一次没有任何副作用，
     *   所以宁可多藏两次。
     *
     * 只在启动窗口内生效：过了 TABBAR_BOOT_WINDOW_MS 就不再排，
     * 否则每次切 tab 的 onShow 都排一串定时器，纯属浪费。
     */
    _scheduleTabBarRetry() {
      // 只在启动窗口内补
      if (!this._tabBarBootAt) this._tabBarBootAt = Date.now()
      if (Date.now() - this._tabBarBootAt > TABBAR_BOOT_WINDOW_MS) return
      // 已经在补了就别再排一串
      if (this._tabBarRetrying) return
      this._tabBarRetrying = true

      // 累计约 80 / 330 / 930 / 2130ms 各藏一次
      const steps = [80, 250, 600, 1200]
      let i = 0

      const step = () => {
        if (i >= steps.length) {
          this._tabBarRetrying = false
          return
        }
        const delay = steps[i]
        i += 1
        setTimeout(() => {
          this._applyTabBar()
          step()
        }, delay)
      }

      step()
    },

    /** 标记主题变了：自绘底栏会自己响应，这里只留个语义位 */
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

    /**
     * 改 AI 公共配置（接口地址 / Key / 模型 / 超时）。
     *
     * ★ 对话和记账共用这一份 ★
     *   两边用同一个模型服务，没必要配两遍。
     */
    async setAi(patch) {
      const ai = { ...this.settings.ai, ...patch }
      this.settings.ai = ai
      await setSettings({ ai })
    },

    /**
     * 改 AI 对话专属配置。
     *
     * ★ 和记账分开 ★
     *   对话要发散、开着深度思考、回答可以长；
     *   记账要稳定、temperature 固定 0、不思考。
     *   两边的诉求完全相反，所以配置分开存。
     */
    async setAiChat(patch) {
      const aiChat = { ...this.settings.aiChat, ...patch }
      this.settings.aiChat = aiChat
      await setSettings({ aiChat })
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
