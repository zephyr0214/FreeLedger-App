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

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildCssVars, buildWotCssVars, wotThemeClass, refreshTabBarTheme, THEME_PRESETS,
  isSystemDark, resolveDark, watchSystemTheme, THEME_MODE, applyNativeTheme,
  TABBAR_FONT_COLOR_LIGHT, TABBAR_FONT_COLOR_DARK
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
})(), 'static/tabbar/home-dark-v2.png')
check('浅色时图标不带后缀', (() => {
  calls.length = 0
  refreshTabBarTheme('green', false, false)
  const item = calls.find((c) => c.type === 'item')
  return item.opt.iconPath
})(), 'static/tabbar/home-v2.png')
check('选中图标按主题色', (() => {
  calls.length = 0
  refreshTabBarTheme('purple', false, false)
  const item = calls.find((c) => c.type === 'item')
  return item.opt.selectedIconPath
})(), 'static/tabbar/home-active-purple-v2.png')

/* ---------------- tabBar 文字色：未选中态要比最早的 #969799 深 ----------------
 * 原来浅色用 #969799，白底上几乎糊成一片，
 * 未选中 / 选中的对比太弱，切换 tab 时体感不明显。
 * 现在浅色 #646566、深色 #A1A1A6。
 *
 * ★ 注意：颜色深浅和线条粗细是两回事 ★
 * 用户说「太粗」说的是图标的线条，颜色没被抱怨，
 * 所以深浅维持在第一版的水平，没有继续往正文色加深。
 */
check('浅色下 tabBar 文字色加深', TABBAR_FONT_COLOR_LIGHT, '#646566')
check('深色下 tabBar 文字色', TABBAR_FONT_COLOR_DARK, '#A1A1A6')

calls.length = 0
refreshTabBarTheme('green', false, false)
check('setTabBarStyle 用的是加深的浅色文字色', calls.find((c) => c.type === 'style').opt.color, '#646566')

calls.length = 0
refreshTabBarTheme('green', true, false)
check('深色下 setTabBarStyle 用深色文字色', calls.find((c) => c.type === 'style').opt.color, '#A1A1A6')

/* --------------- 选中态必须是主题色（与未选中态拉开的对比）--------------- */
calls.length = 0
refreshTabBarTheme('red', false, false)
check('选中色是主题色', calls.find((c) => c.type === 'style').opt.selectedColor, '#EE0A24')

/* ---------------- tabBar 字号 / 图标尺寸 ----------------
 * ★ 这两个值必须与 scripts/gen-tabbar-icons.py 的 STROKE_WIDTH 一起看 ★
 *   用户看到的图标粗细 = 描边宽度 × (iconWidth / 画布尺寸)，记作 onScreen。
 *   描边 2 / 画布 81 / iconWidth 22px -> onScreen 0.543。
 *   历史：
 *     2.0 + 81px + 24px -> onScreen 0.593，用户认可这一版的粗细；
 *     之后用户又说「图标适当缩小一些些」，
 *     于是在**不改 PNG** 的前提下把 iconWidth 24 -> 22（小 8%），
 *     图标整体变小，线条也跟着略细一点，仍接近 0.593 的手感。
 *   fontSize 用整数 11px：uni-app 的原生 tabBar 对小数 px 的支持没有把握，
 *   宁可用整数值也不要冒「配了不生效」的风险。
 */
{
  const pagesJson = JSON.parse(
    readFileSync(join(process.cwd(), 'pages.json'), 'utf-8')
      .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  )
  const tb = pagesJson.tabBar || {}
  check('tabBar 字号 11px', tb.fontSize, '11px')
  check('tabBar 图标宽 22px', tb.iconWidth, '22px')
}

/* ------------- 冷启动时 tabBar 要自己补刷，不能等用户点 tab -------------
 *
 * bug：刚进 App 时 tabBar 还是 pages.json 写死的绿色默认图标和默认色，
 *      点一下 tab 才刷新。
 * 根因：首个 tab 页的首次 onShow 常常赶在原生 tabBar 创建之前，
 *      那一轮 setTabBarStyle / setTabBarItem 静默失效，
 *      之后没有第二次机会（除非用户点 tab）。
 * 期望：refreshTabBar() 之后，即使第一轮失效，
 *      stores/setting.js 也会在启动窗口内自己补刷几轮。
 *
 * ★ 这里只做源码层面的结构断言 ★
 *   store 依赖 pinia + setTimeout，在 node 里跑真实 store 成本高、
 *   收益低；而这条逻辑的关键就是「有没有补刷」这件事本身，
 *   用源码断言足够挡住「有人把补刷删了」的回归。
 */
{
  const storeSrc = readFileSync(join(process.cwd(), 'stores/setting.js'), 'utf-8')

  check('refreshTabBar 里排了补刷', /refreshTabBar\(\)\s*\{[\s\S]*?_scheduleTabBarRetry\(/.test(storeSrc), true)
  check('有补刷实现 _scheduleTabBarRetry', /_scheduleTabBarRetry\(force\)\s*\{/.test(storeSrc), true)
  check('补刷用 setTimeout 延迟重试', /_scheduleTabBarRetry[\s\S]*?setTimeout\(/.test(storeSrc), true)
  check('补刷有启动窗口限制', /TABBAR_BOOT_WINDOW_MS/.test(storeSrc), true)
  check('补刷有防重入标记', /_tabBarRetrying/.test(storeSrc), true)

  // applyTabBarTheme 必须把成败报出来，补刷才可能是「失败才补」
  const themeSrc = readFileSync(join(process.cwd(), 'utils/theme.js'), 'utf-8')
  check('applyTabBarTheme 返回是否成功', /function applyTabBarTheme\(presetKey, dark\)\s*\{[\s\S]*?return ok/.test(themeSrc), true)
  check('refreshTabBarTheme 透传返回值', /function refreshTabBarTheme\([\s\S]*?return applyTabBarTheme\(/.test(themeSrc), true)
}

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

console.log('=== 原生层主题跟随 ===')

/**
 * ★ 这是「跟随系统 → 深色 → 浅色，切回浅色没生效」那个 bug 的回归测试 ★
 *
 * 根因
 *   原生层（状态栏 / 原生 tabBar / 窗口背景）只在启动时设过一次
 *   setUIStyle('auto')，之后就再也不管了。
 *   于是用户手动选「深色」时，App 内容变深了但原生层还跟着系统；
 *   再切回「浅色」，App 内容变浅了、原生层还是原来的深色 ——
 *   两边不一致，看上去就像「浅色没生效」。
 *
 * 修法
 *   applyNativeTheme(dark, mode) 按模式把原生层设成
 *   system→'auto' / light→'light' / dark→'dark'。
 */
{
  const calls = []
  globalThis.uni = {
    getSystemInfoSync: () => ({ osTheme: 'dark' }),
    setStatusBarStyle: (opt) => calls.push({ type: 'statusbar', opt })
  }
  globalThis.plus = {
    nativeUI: {
      setUIStyle: (style) => calls.push({ type: 'uistyle', style })
    },
    navigator: {
      setStatusBarStyle: (style) => calls.push({ type: 'statusbar', style })
    }
  }

  const uis = () => calls.filter((c) => c.type === 'uistyle').map((c) => c.style)

  // 跟随系统 → 原生层 auto
  applyNativeTheme(true, THEME_MODE.SYSTEM)
  check('跟随系统 -> 原生 auto', uis().includes('auto'), true)

  // 手动深色 → 原生层必须变成 dark（不能还停在 auto）
  calls.length = 0
  applyNativeTheme(true, THEME_MODE.DARK)
  check('手动深色 -> 原生 dark', uis().includes('dark'), true)

  // ★ 手动浅色 → 原生层必须变成 light ★
  //   这正是「切回浅色没生效」那一步
  calls.length = 0
  applyNativeTheme(false, THEME_MODE.LIGHT)
  check('手动浅色 -> 原生 light', uis().includes('light'), true)

  // 状态栏文字色也要跟着：深色背景用浅色文字
  calls.length = 0
  applyNativeTheme(true, THEME_MODE.DARK)
  const sb = calls.find((c) => c.type === 'statusbar')
  check('深色时状态栏用浅色文字', sb ? sb.opt.style : null, 'light')

  calls.length = 0
  applyNativeTheme(false, THEME_MODE.LIGHT)
  const sb2 = calls.find((c) => c.type === 'statusbar')
  check('浅色时状态栏用深色文字', sb2 ? sb2.opt.style : null, 'dark')

  // 重复设置同一种样式不应该重复调（避免原生层反复重绘）
  calls.length = 0
  applyNativeTheme(false, THEME_MODE.LIGHT)
  check('重复设置不重复调原生 API', calls.filter((c) => c.type === 'uistyle').length, 0)

  delete globalThis.uni
  delete globalThis.plus
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
