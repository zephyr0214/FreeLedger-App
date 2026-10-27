/**
 * 主题相关的纯函数测试
 *
 *   node scripts/test-theme.mjs
 *
 * 覆盖：
 *   1. buildCssVars 注入的组件库主色变量
 *   2. 深色模式下的 --wot-dark-* 变量
 *   3. wotThemeClass 返回的 class
 *   4. refreshTabBarTheme 的「冲缓存」逻辑
 */

import {
  buildCssVars, buildWotCssVars, wotThemeClass, refreshTabBarTheme, THEME_PRESETS,
  isSystemDark, resolveDark, watchSystemTheme, THEME_MODE
} from '../utils/theme.js'

let pass = 0
let fail = 0

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    fail++
    console.log(`FAIL  ${name}\n      实际 ${a}\n      期望 ${e}`)
  }
}

/** 把 "k:v;k2:v2" 解析成对象 */
function parseVars(css) {
  const out = {}
  for (const part of String(css).split(';')) {
    const i = part.indexOf(':')
    if (i === -1) continue
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

console.log('=== 浅色模式的变量 ===')

const lightVars = parseVars(buildCssVars('blue', false))

check('主色变量存在', typeof lightVars['--wot-color-theme'], 'string')
check('主色是蓝色', lightVars['--wot-color-theme'], '#1989FA')
check('primary 变量是蓝色', lightVars['--wot-color-primary'], '#1989FA')
check('按钮主色变量', lightVars['--wot-button-primary-bg-color'], '#1989FA')
check('开关主色变量', lightVars['--wot-switch-checked-bg-color'], '#1989FA')
check('单选主色变量', lightVars['--wot-radio-checked-color'], '#1989FA')
check('app 主色', lightVars['--app-primary'], '#1989FA')
check('app 底色是浅色', lightVars['--app-bg'], '#F7F8FA')
check('浅色不含深色背景变量', lightVars['--wot-dark-background'], undefined)

console.log('=== 深色模式的变量 ===')

const darkVars = parseVars(buildCssVars('green', true))

check('深色背景变量存在', typeof darkVars['--wot-dark-background'], 'string')
check('深色颜色变量存在', typeof darkVars['--wot-dark-color'], 'string')
check('app 底色是黑色', darkVars['--app-bg'], '#000000')
check('app 卡片是深灰', darkVars['--app-card'], '#1C1C1E')
check('深色下主色仍是绿色', darkVars['--wot-color-theme'], '#07C160')

console.log('=== 主题色预设 ===')

for (const p of THEME_PRESETS) {
  const v = parseVars(buildCssVars(p.key, false))
  check(`${p.key} 主色`, v['--wot-color-theme'], p.primary)
  check(`${p.key} app 主色`, v['--app-primary'], p.primary)
}

console.log('=== 深色 class ===')

check('深色 class', wotThemeClass(true), 'wot-theme-dark')
check('浅色 class', wotThemeClass(false), 'wot-theme-light')

console.log('=== tabBar 冲缓存逻辑 ===')

// 装一个假的 uni，记录调用
const calls = []
globalThis.uni = {
  setTabBarStyle: (opt) => calls.push({ type: 'style', opt }),
  setTabBarItem: (opt) => calls.push({ type: 'item', opt })
}

// force=false：只刷一次样式（不冲缓存）
calls.length = 0
refreshTabBarTheme('green', false, false)
const styleCalls = calls.filter((c) => c.type === 'style')
check('不冲缓存时只刷一次样式', styleCalls.length, 1)
check('刷的是目标色', styleCalls[0].opt.selectedColor, '#07C160')
check('换了 4 个图标', calls.filter((c) => c.type === 'item').length, 4)

// force=true：先冲缓存（默认色）再刷目标色
calls.length = 0
refreshTabBarTheme('blue', false, true)
const styleCalls2 = calls.filter((c) => c.type === 'style')
check('冲缓存时刷两次样式', styleCalls2.length, 2)
check('第一次是默认色（冲缓存）', styleCalls2[0].opt.selectedColor, '#07C160')
check('第二次是目标色', styleCalls2[1].opt.selectedColor, '#1989FA')
check('深色时图标带 -dark 后缀', (() => {
  calls.length = 0
  refreshTabBarTheme('green', true, false)
  const item = calls.find((c) => c.type === 'item')
  return item.opt.iconPath
})(), 'static/tabbar/home-dark.png')
check('浅色时图标不带后缀', (() => {
  calls.length = 0
  refreshTabBarTheme('green', false, false)
  const item = calls.find((c) => c.type === 'item')
  return item.opt.iconPath
})(), 'static/tabbar/home.png')
check('选中图标按主题色', (() => {
  calls.length = 0
  refreshTabBarTheme('purple', false, false)
  const item = calls.find((c) => c.type === 'item')
  return item.opt.selectedIconPath
})(), 'static/tabbar/home-active-purple.png')

delete globalThis.uni

console.log('=== 系统深浅色检测 ===')

/**
 * 装一个假的 uni.getSystemInfoSync
 * @param {object} info 返回的系统信息
 */
function fakeSystemInfo(info) {
  globalThis.uni = {
    getSystemInfoSync: () => info,
    onThemeChange: () => {},
    offThemeChange: () => {}
  }
}

// osTheme 是正确的字段 —— 优先用它
fakeSystemInfo({ osTheme: 'dark', theme: 'light' })
check('osTheme=dark 识别为深色', isSystemDark(), true)

// ★ 旧字段 theme 在 Android 上总是 light，即使系统是深色 ★
// 这正是原来「不跟随系统」的原因
fakeSystemInfo({ theme: 'light' })
check('只有 theme=light -> 浅色', isSystemDark(), false)

// osTheme 优先于 theme
fakeSystemInfo({ osTheme: 'light', theme: 'dark' })
check('osTheme 优先于 theme', isSystemDark(), false)

// hostTheme（小程序 / UniMPSDK）
fakeSystemInfo({ hostTheme: 'dark' })
check('hostTheme=dark 识别为深色', isSystemDark(), true)

// 什么都没有 -> 浅色
fakeSystemInfo({})
check('没有主题字段 -> 浅色', isSystemDark(), false)

// 抛异常 -> 浅色，不崩
globalThis.uni = { getSystemInfoSync: () => { throw new Error('boom') } }
check('读取异常 -> 浅色', isSystemDark(), false)

console.log('=== resolveDark ===')

fakeSystemInfo({ osTheme: 'dark' })
check('system 模式跟随系统', resolveDark(THEME_MODE.SYSTEM), true)
check('light 模式强制浅色', resolveDark(THEME_MODE.LIGHT), false)
check('dark 模式强制深色', resolveDark(THEME_MODE.DARK), true)

fakeSystemInfo({ osTheme: 'light' })
check('system 模式（系统浅色）', resolveDark(THEME_MODE.SYSTEM), false)
check('light 模式（系统深色时也浅色）', resolveDark(THEME_MODE.LIGHT), false)
check('dark 模式（系统浅色时也深色）', resolveDark(THEME_MODE.DARK), true)

console.log('=== 系统主题监听 ===')

{
  let fired = 0
  const off = watchSystemTheme(() => { fired++ })
  // watchSystemTheme 应该正常返回取消函数
  check('返回取消函数', typeof off, 'function')
  off()
  delete globalThis.uni
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
