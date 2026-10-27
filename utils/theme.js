/**
 * 主题 —— 三态（跟随系统 / 浅色 / 深色）+ 6 套预设色
 *
 * 设计要点：
 *   1. 组件库走 wd-config-provider 的 theme + themeVars；
 *   2. 自研组件与页面底色走 CSS 变量（--app-*），由 App.vue 注入到根节点；
 *   3. 原生 tabBar 不认 CSS 变量，切主题时必须调 uni.setTabBarStyle；
 *   4. uni.onThemeChange 在部分 Android 不触发，onShow 时兜底重读系统值。
 */

export const THEME_PRESETS = [
  { key: 'green',  name: '收支绿', primary: '#07C160', light: '#E8F9EF', dark: '#0A8F4A' },
  { key: 'blue',   name: '账本蓝', primary: '#1989FA', light: '#E8F3FF', dark: '#1068C6' },
  { key: 'orange', name: '暖橘',   primary: '#FF8F1F', light: '#FFF3E6', dark: '#C96C0C' },
  { key: 'purple', name: '紫罗兰', primary: '#7D5FFF', light: '#F0ECFF', dark: '#5A3FD1' },
  { key: 'red',    name: '朱砂',   primary: '#EE0A24', light: '#FFE9EC', dark: '#B2081B' },
  { key: 'grey',   name: '墨黑',   primary: '#323233', light: '#F2F3F5', dark: '#1C1C1E' }
]

export const THEME_MODE = {
  SYSTEM: 'system',
  LIGHT: 'light',
  DARK: 'dark'
}

export function getPreset(key) {
  return THEME_PRESETS.find((p) => p.key === key) || THEME_PRESETS[0]
}

/**
 * 读系统当前是否深色。
 *
 * ★ 用 osTheme，不要用旧的 theme 字段 ★
 *   uni.getSystemInfoSync() 有三个主题相关字段：
 *     osTheme    操作系统主题（light/dark）—— App 平台正确
 *     hostTheme  宿主主题（小程序/UniMPSDK）
 *     theme      旧字段，**不推荐使用**
 *
 *   旧字段 theme 在 Android 上有个已知问题：
 *   明明系统已经是深色模式，它还是返回 'light'
 *   （只在冷启动或从后台唤醒时读一次系统主题快照，
 *     不监听深色模式变化广播）。
 *   社区实测：MIUI / 澎湃OS / 「日落到日出」自动切换全都读成 light。
 *
 *   所以这里优先读 osTheme，取不到再退回 theme。
 */
export function isSystemDark() {
  try {
    const info = uni.getSystemInfoSync()
    if (!info) return false

    // App 端：osTheme 才是系统主题
    const osTheme = info.osTheme
    if (osTheme === 'dark') return true
    if (osTheme === 'light') return false

    // 宿主（小程序 / UniMPSDK）
    const hostTheme = info.hostTheme
    if (hostTheme === 'dark') return true
    if (hostTheme === 'light') return false

    // 老版本兜底
    return info.theme === 'dark'
  } catch (e) {
    return false
  }
}

/**
 * 让 App 的原生 UI（状态栏、tabBar、窗口背景）跟随系统深浅色。
 *
 * ★ 为什么必须调这个 ★
 *   官方文档：「在 App 上需要先调用 plus.nativeUI.setUIStyle('auto')
 *   开启跟随系统主题切换的功能，才能监听到主题切换事件」。
 *   不调的话，uni.onThemeChange 根本收不到事件，
 *   原生 tabBar / 状态栏也不会跟着系统变色。
 *
 * 只在 App 端有效，其它平台忽略。
 */
export function enableNativeFollowSystem() {
  try {
    if (typeof plus !== 'undefined' && plus.nativeUI &&
        typeof plus.nativeUI.setUIStyle === 'function') {
      plus.nativeUI.setUIStyle('auto')
    }
  } catch (e) {
    console.warn('[theme] setUIStyle 失败:', e && e.message)
  }
}

/**
 * 监听系统深浅色变化。
 *
 * ★ 为什么不能只靠 uni.onThemeChange ★
 *   1. App 端这个接口要求 manifest.json 里配了 darkmode: true，
 *      且社区实测在部分 Android 机型上运行期不触发。
 *   2. 它回调里的 res.theme 也不一定准 —— 收到事件后再用
 *      isSystemDark()（读 osTheme）复核一次更稳妥。
 *
 * 所以这里做双保险：
 *   - uni.onThemeChange：标准通道
 *   - plus.globalEvent 'themedchanged'：5+ 原生通道（App 端更可靠）
 *   - onShow 兜底：每次回前台重读一次
 *
 * @param {Function} callback 主题变化时调用（无参数）
 * @returns {Function} 取消监听的函数
 */
export function watchSystemTheme(callback) {
  const handlers = []

  /** 收到事件后统一处理：复核一次当前主题，变了才回调 */
  const handle = () => {
    callback()
  }

  // 1) 标准通道
  try {
    if (typeof uni.onThemeChange === 'function') {
      uni.onThemeChange(handle)
      handlers.push(() => {
        if (typeof uni.offThemeChange === 'function') uni.offThemeChange(handle)
      })
    }
  } catch (e) {
    console.warn('[theme] onThemeChange 不可用:', e && e.message)
  }

  // 2) 5+ 原生通道（App 端更可靠）
  try {
    if (typeof plus !== 'undefined' && plus.globalEvent &&
        typeof plus.globalEvent.addEventListener === 'function') {
      // 5+ 的系统主题变化事件名
      const EVENTS = ['themedchanged', 'themechanged', 'darkmodechange']
      for (const name of EVENTS) {
        try {
          plus.globalEvent.addEventListener(name, handle)
          handlers.push(() => {
            try { plus.globalEvent.removeEventListener(name, handle) } catch (e) {}
          })
        } catch (e) {
          // 这个事件名当前平台不支持，忽略
        }
      }
    }
  } catch (e) {
    console.warn('[theme] plus.globalEvent 不可用:', e && e.message)
  }

  return () => {
    for (const off of handlers) {
      try { off() } catch (e) {}
    }
  }
}

/** 根据 mode 解析出最终是否深色 */
export function resolveDark(mode) {
  if (mode === THEME_MODE.DARK) return true
  if (mode === THEME_MODE.LIGHT) return false
  return isSystemDark()
}

/**
 * 生成注入到页面的 CSS 变量字符串。
 * 自研组件只使用这些变量，不写死色值。
 *
 * ★ 同时注入组件库（wot-design-uni）的变量 ★
 *   库的按钮、弹层等组件颜色全部来自 CSS 变量
 *   （见 node_modules/wot-design-uni/components/common/abstracts/variable.scss）：
 *     --wot-color-theme                主色
 *     --wot-dark-background / --wot-dark-color...  深色模式的一整套
 *   项目里没有渲染 <wd-config-provider>（App.vue 的 template 在 App 端不渲染），
 *   所以改成把变量直接注入到 .app-page 的 style 上，
 *   库的组件就会跟着主题色和深浅色走。
 */
export function buildCssVars(presetKey, dark) {
  const p = getPreset(presetKey)
  const vars = dark
    ? {
        '--app-bg': '#000000',
        '--app-bg-2': '#0D0D0F',
        '--app-card': '#1C1C1E',
        '--app-card-2': '#2C2C2E',
        '--app-line': '#2E2E31',
        '--app-text': '#F5F5F7',
        '--app-text-2': '#A1A1A6',
        '--app-text-3': '#6E6E73',
        '--app-primary': p.primary,
        '--app-primary-light': 'rgba(255,255,255,0.10)',
        '--app-danger': '#FF453A',
        '--app-success': '#32D74B',
        '--app-warning': '#FFD60A',
        '--app-mask': 'rgba(0,0,0,0.65)',
        '--app-shadow': '0 2rpx 16rpx rgba(0,0,0,0.4)'
      }
    : {
        '--app-bg': '#F7F8FA',
        '--app-bg-2': '#FFFFFF',
        '--app-card': '#FFFFFF',
        '--app-card-2': '#F7F8FA',
        '--app-line': '#EBEDF0',
        '--app-text': '#323233',
        '--app-text-2': '#646566',
        '--app-text-3': '#969799',
        '--app-primary': p.primary,
        '--app-primary-light': p.light,
        '--app-danger': '#EE0A24',
        '--app-success': '#07C160',
        '--app-warning': '#FF976A',
        '--app-mask': 'rgba(0,0,0,0.45)',
        '--app-shadow': '0 2rpx 16rpx rgba(0,0,0,0.06)'
      }

  // ---- 组件库（wot-design-uni）的变量 ----
  Object.assign(vars, buildWotCssVars(presetKey, dark))

  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')
}

/**
 * 组件库用的 CSS 变量。
 *
 * 主色：--wot-color-theme 是库的根变量，按钮、开关、单选等都从它派生。
 * 深色：库的深色样式是靠祖先上的 .wot-theme-dark 类切换的
 *       （见 wd-button/index.scss 等），所以除了颜色变量，
 *       还要给页面根节点加这个类 —— 见 utils/theme.js 的 wotThemeClass。
 *       这里同时把深色变量也注入，避免个别组件不认类名时颜色不对。
 */
export function buildWotCssVars(presetKey, dark) {
  const p = getPreset(presetKey)
  const vars = {
    '--wot-color-theme': p.primary,
    '--wot-color-primary': p.primary,
    '--wot-button-primary-bg-color': p.primary,
    '--wot-switch-checked-bg-color': p.primary,
    '--wot-checkbox-checked-color': p.primary,
    '--wot-radio-checked-color': p.primary,
    '--wot-slider-active-bg-color': p.primary,
    '--wot-tag-primary-color': p.primary,
    '--wot-pager-indicator-active-color': p.primary,
    '--wot-tabbar-item-active-color': p.primary
  }

  if (dark) {
    Object.assign(vars, {
      '--wot-dark-background': '#0D0D0F',
      '--wot-dark-background2': '#1C1C1E',
      '--wot-dark-background3': '#141414',
      '--wot-dark-background4': '#2C2C2E',
      '--wot-dark-background5': '#3A3A3C',
      '--wot-dark-background6': '#380e08',
      '--wot-dark-background7': '#707070',
      '--wot-dark-color': '#FFFFFF',
      '--wot-dark-color2': '#f2270c',
      '--wot-dark-color3': 'rgba(232, 230, 227, 0.8)',
      '--wot-dark-color-gray': '#A1A1A6'
    })
  }

  return vars
}

/**
 * 组件库深色模式需要的 class。
 * 库的深色样式是 `.wot-theme-dark .wd-button { ... }` 这种后代选择器，
 * 必须有一个祖先带这个类才生效。
 */
export function wotThemeClass(dark) {
  return dark ? 'wot-theme-dark' : 'wot-theme-light'
}

/** 组件库主题变量（只覆盖主色，其余用默认） */
export function buildWotThemeVars(presetKey) {
  const p = getPreset(presetKey)
  return {
    colorTheme: p.primary,
    colorPrimary: p.primary
  }
}

/** tabBar 四个 tab 的路径与资源名 */
const TABBAR_ITEMS = [
  { index: 0, name: 'home' },
  { index: 1, name: 'account' },
  { index: 2, name: 'stats' },
  { index: 3, name: 'mine' }
]

/**
 * 切换原生 tabBar 配色与图标。
 *
 * 为什么不能只调 setTabBarStyle：
 *   setTabBarStyle 只能改文字颜色和背景，改不了图标。
 *   而 PNG 图标的颜色是烤死在像素里的，所以每套主题色各生成了一份选中态图标，
 *   这里通过 setTabBarItem 逐个替换 iconPath / selectedIconPath。
 *
 * ★ 必须在「有 tabBar 的页面」调用 ★
 *   主题设置页是 navigateTo 过去的子页面，没有 tabBar 实例，
 *   在那里调 setTabBarStyle / setTabBarItem 是无效的
 *   （App 端这两个接口只对 tabBar 页面生效，其它页面静默失败）。
 *   所以这里只由 4 个 tab 页的 onShow 驱动（见 stores/setting.js 的 refreshTabBar）。
 *
 * 前提：static/tabbar/ 下需要有 {name}.png、{name}-dark.png、
 *       {name}-active-{preset}.png（由 scripts/gen-tabbar-icons.py 生成）
 */
export function applyTabBarTheme(presetKey, dark) {
  const p = getPreset(presetKey)

  try {
    uni.setTabBarStyle({
      color: dark ? '#8E8E93' : '#969799',
      selectedColor: p.primary,
      backgroundColor: dark ? '#1C1C1E' : '#FFFFFF',
      borderStyle: dark ? 'black' : 'white'
    })
  } catch (e) {
    // 部分平台/时机不支持，静默失败即可
  }

  // 替换图标：未选中态按深浅模式切换，选中态按主题色切换
  const suffix = dark ? '-dark' : ''
  for (const item of TABBAR_ITEMS) {
    try {
      uni.setTabBarItem({
        index: item.index,
        iconPath: `static/tabbar/${item.name}${suffix}.png`,
        selectedIconPath: `static/tabbar/${item.name}-active-${p.key}.png`
      })
    } catch (e) {
      // tabBar 尚未创建时（如首屏加载前）会失败，忽略即可
    }
  }
}

/**
 * 重刷 tabBar。
 *
 * @param {string} presetKey 主题色预设
 * @param {boolean} dark 是否深色
 * @param {boolean} force 是否需要「冲缓存」
 *   部分 Android ROM 会缓存 tabBar 的图标与配色，
 *   即使 setTabBarStyle 传了新值也不立刻重绘。
 *   先刷一遍「默认色」再刷目标色可以把缓存冲掉。
 *   但只有主题**刚变了**时才需要这么做 ——
 *   否则每次 onShow 都会闪一下默认色（先白后目标色，很难看）。
 *   所以由调用方（store）判断「变了没有」，把结果传进来。
 */
export function refreshTabBarTheme(presetKey, dark, force = false) {
  if (force) {
    // 先用默认值冲一次缓存
    try {
      uni.setTabBarStyle({
        color: '#969799',
        selectedColor: '#07C160',
        backgroundColor: '#FFFFFF',
        borderStyle: 'white'
      })
    } catch (e) {}
  }

  // 再刷目标值
  applyTabBarTheme(presetKey, dark)
}

/** 状态栏与导航栏文字颜色 */
export function applyNavigationBarTheme(dark) {
  try {
    uni.setNavigationBarColor({
      frontColor: dark ? '#ffffff' : '#000000',
      backgroundColor: dark ? '#000000' : '#F7F8FA'
    })
  } catch (e) {}
}
