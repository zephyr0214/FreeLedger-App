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
 * ★ 这一节在改成「自绘圆角悬浮底栏」后语义变了 ★
 *   原生 tabBar 已经被 uni.hideTabBar 藏起来，视觉全部由
 *   components/AppTabBar.vue 负责（图标 44rpx ≈ 22px）。
 *   pages.json 里这些值仍然保留，但**不再影响显示** ——
 *   它们只是给「万一自绘栏加载失败、原生栏露出来」留的兜底值。
 *   所以这里不再死锁具体数值，只校验它们存在且格式合理，
 *   免得用户每次微调视觉都要改测试。
 */
{
  const pagesJson = JSON.parse(
    readFileSync(join(process.cwd(), 'pages.json'), 'utf-8')
      .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  )
  const tb = pagesJson.tabBar || {}
  check('tabBar 有 fontSize', /^\d+px$/.test(String(tb.fontSize)), true)
  check('tabBar 有 iconWidth', /^\d+px$/.test(String(tb.iconWidth)), true)

  // 真正的视觉尺寸在自绘组件里，这条必须盯着
  const tabbarCode = readFileSync(join(process.cwd(), 'components/AppTabBar.vue'), 'utf-8')
  check('自绘底栏图标 48rpx', /\.tab-icon\s*\{[^}]*width:\s*48rpx/.test(tabbarCode), true)
  check('自绘底栏高度 128rpx', /\.tabbar\s*\{[^}]*height:\s*128rpx/.test(tabbarCode), true)

  /* ★ 圆角统一：pill 与 + 圆按钮必须是同一曲率 ★
   *   + 按钮是正圆（border-radius:50%，半径 = 高度的一半 = 54rpx）。
   *   pill 若用 36rpx 这种固定值，两端就比圆按钮「方」，看着不统一；
   *   必须用 999rpx 封顶，让半径自动等于高度的一半。
   */
  check('pill 圆角是全圆角', /\.tabbar\s*\{[^}]*border-radius:\s*999rpx/.test(tabbarCode), true)
  check('+ 按钮是正圆', /\.tab-add\s*\{[^}]*border-radius:\s*50%/.test(tabbarCode), true)

  /* ★ 横向不撑满 ★
   *   pill 若用 flex:1 会被拉成通到底的横条，失去悬浮感。
   *   必须给固定宽度 + 外层居中。
   */
  check('pill 不再 flex:1 拉满', /\.tabbar\s*\{[^}]*flex:\s*1/.test(tabbarCode), false)
  check('pill 有固定宽度', /\.tabbar\s*\{[^}]*width:\s*\d+rpx/.test(tabbarCode), true)
  check('外层内容居中', /\.tabbar-host\s*\{[^}]*justify-content:\s*center/.test(tabbarCode), true)

  /* ★ 底栏与 + 按钮必须分离 ★ */
  check('两块之间有 gap', /\.tabbar-row\s*\{[^}]*gap:\s*\d+rpx/.test(tabbarCode), true)

  /* ★ 选中滑块：全圆角 + 浅主题色 + 平滑过渡 ★
   *   用户要求「图标下方加一个全圆角的浅主题色滑块，切换过渡自然」。
   *   三条缺一不可：
   *     · 圆角 999rpx（全圆角，和底栏曲率一致）
   *     · 背景取 store 的 primaryLight（浅主题色）
   *     · 用 transform 位移 + transition（能滑过去，不是跳过去）
   */
  check('有选中滑块', /class="tab-slider"/.test(tabbarCode), true)
  // 圆角与上色都在 ::after 上：外层保持「正好一格宽」，
  // 位移基准才准确；色块比格子小一圈由伪元素负责。
  check('滑块色块是全圆角', /\.tab-slider::after\s*\{[^}]*border-radius:\s*999rpx/.test(tabbarCode), true)
  check('滑块用 transform 位移', /transform:\s*`translateX\(/.test(tabbarCode), true)
  check('滑块有过渡动画', /\.tab-slider\s*\{[^}]*transition:\s*transform/.test(tabbarCode), true)
  check('滑块用浅主题色', /primaryLight/.test(tabbarCode), true)
  check('store 有 primaryLight', /primaryLight\(state\)\s*\{/.test(
    readFileSync(join(process.cwd(), 'stores/setting.js'), 'utf-8')), true)

  /* ★ 高度要够，不能扁 ★
   *   96rpx 那版用户反馈「有点丑」，要求高一些。
   *   这里锁一个下限，防止后续被改回扁的。
   */
  const pillH = (tabbarCode.match(/\.tabbar\s*\{[^}]*height:\s*(\d+)rpx/) || [])[1]
  check('胶囊高度 >= 120rpx', Number(pillH) >= 120, true)
}

/* ------------- 冷启动时原生 tabBar 要自己补藏，不能等用户点 tab -------------
 *
 * 改造后的 bug 形态变了：
 *   以前是「颜色/图标停在默认值」，现在是「原生 tabBar 没藏掉，
 *   和自绘圆角底栏叠在一起，出现两条底栏」。
 * 根因相同：首个 tab 页的首次 onShow 常常赶在原生 tabBar 创建之前，
 *      那一轮 hideTabBar 静默失效，之后没有第二次机会。
 * 期望：refreshTabBar() 之后，即使第一轮失效，
 *      stores/setting.js 也会在启动窗口内自己补藏几次。
 *
 * ★ 这里只做源码层面的结构断言 ★
 *   store 依赖 pinia + setTimeout，在 node 里跑真实 store 成本高、
 *   收益低；而这条逻辑的关键就是「有没有补藏」这件事本身，
 *   用源码断言足够挡住「有人把补藏删了」的回归。
 */
{
  const storeSrc = readFileSync(join(process.cwd(), 'stores/setting.js'), 'utf-8')

  check('refreshTabBar 里排了补藏', /refreshTabBar\(\)\s*\{[\s\S]*?_scheduleTabBarRetry\(/.test(storeSrc), true)
  check('有补藏实现 _scheduleTabBarRetry', /_scheduleTabBarRetry\(\)\s*\{/.test(storeSrc), true)
  check('补藏用 setTimeout 延迟重试', /_scheduleTabBarRetry[\s\S]*?setTimeout\(/.test(storeSrc), true)
  check('补藏有启动窗口限制', /TABBAR_BOOT_WINDOW_MS/.test(storeSrc), true)
  check('补藏有防重入标记', /_tabBarRetrying/.test(storeSrc), true)
  // load() 读完设置要重置补藏窗口：启动窗口必须从「设置就绪」起算
  check('load() 重置补藏窗口', /async load\(\)\s*\{[\s\S]*?_tabBarBootAt = Date\.now\(\)/.test(storeSrc), true)
  // 实际动作必须是「隐藏原生栏」，不能再是刷配色
  check('动作是隐藏原生 tabBar', /hideNativeTabBar\(\)/.test(storeSrc), true)

  // 自绘底栏的宿主必须压得住页面内容
  const tabbarCode = readFileSync(join(process.cwd(), 'components/AppTabBar.vue'), 'utf-8')
  check('自绘底栏是 fixed 定位', /\.tabbar-host\s*\{[^}]*position:\s*fixed/.test(tabbarCode), true)
  check('自绘底栏有安全区适配', /env\(safe-area-inset-bottom\)/.test(tabbarCode), true)
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
