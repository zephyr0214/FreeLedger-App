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

/** 读系统当前是否深色 */
export function isSystemDark() {
  try {
    const info = uni.getSystemInfoSync()
    return info.theme === 'dark'
  } catch (e) {
    return false
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

  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')
}

/** 组件库主题变量（只覆盖主色，其余用默认） */
export function buildWotThemeVars(presetKey) {
  const p = getPreset(presetKey)
  return {
    colorTheme: p.primary,
    colorPrimary: p.primary
  }
}

/** 切换原生 tabBar 配色（不支持 CSS 变量） */
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
