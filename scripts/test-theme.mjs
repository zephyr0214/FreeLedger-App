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
  buildCssVars, buildWotCssVars, wotThemeClass, THEME_PRESETS,
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

console.log('=== tabBar 配色（自绘底栏）===')

/* ---------------- 原生 tabBar 刷新逻辑已整体删除 ----------------
 * 底栏改成自绘悬浮组件后，applyTabBarTheme / refreshTabBarTheme /
 * TABBAR_ITEMS 全都没有调用方了，已经删掉。
 * 这里改为断言「它们确实不在了」，防止有人凭记忆又加回来
 * （加回来会调 uni.showTabBar / setTabBarStyle，
 *   把已隐藏的原生栏重新显示，和自绘栏叠成两条）。
 */
{
  const themeSrc = readFileSync(join(process.cwd(), 'utils/theme.js'), 'utf-8')
  check('applyTabBarTheme 已删除', /function applyTabBarTheme/.test(themeSrc), false)
  check('refreshTabBarTheme 已删除', /function refreshTabBarTheme/.test(themeSrc), false)
  check('TABBAR_ITEMS 已删除', /const TABBAR_ITEMS/.test(themeSrc), false)
  // 只查「真实调用」，注释里提到这些 API 名字是允许的
  check('不再调 setTabBarStyle', /uni\.setTabBarStyle\(/.test(themeSrc), false)
  check('不再调 setTabBarItem', /uni\.setTabBarItem\(/.test(themeSrc), false)
}

/* --------------- tabBar 文字色常量仍然保留 ---------------
 * 自绘底栏直接用这两个值当未选中态文字色
 * （见 components/AppTabBar.vue 的 fontColor）。
 */
check('浅色下 tabBar 文字色加深', TABBAR_FONT_COLOR_LIGHT, '#646566')
check('深色下 tabBar 文字色', TABBAR_FONT_COLOR_DARK, '#A1A1A6')

/* --------------- 选中态必须是主题色 --------------- */
{
  const tabbarCode = readFileSync(join(process.cwd(), 'components/AppTabBar.vue'), 'utf-8')
  // 选中的 tab 文字用 primaryColor，未选中用 fontColor
  check('选中 tab 文字用主题色',
    /item\.active \? primaryColor : fontColor/.test(tabbarCode), true)
  check('未选中色是加深后的灰',
    /isDark \? '#A1A1A6' : '#646566'/.test(tabbarCode), true)
}

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

  /* ★ 玻璃质感 + 降级 ★
   *   用户要「苹果那种带点玻璃感」。
   *   backdrop-filter 在 App 端（尤其安卓 WebView）支持很差，
   *   所以必须「支持才模糊、不支持给高不透明底」，
   *   否则会出现「透出内容但没糊」的脏效果。
   */
  check('用了 backdrop-filter', /backdrop-filter:\s*saturate/.test(tabbarCode), true)
  check('毛玻璃包在 @supports 里', /@supports[^{]*backdrop-filter[\s\S]*?\.tabbar\s*\{/.test(tabbarCode), true)
  /*
   * ★ 变量名统一为 --glass-* ★
   *   tabbar 和 + 弹出的对话框共用同一套柔光玻璃（utils/theme.js 的 glassVars），
   *   所以变量从 --bar-* 改名成了 --glass-*。断言跟着改名，
   *   校验的仍然是「必须有降级底色 + 默认走降级 + 支持时才模糊」这套机制。
   */
  check('有降级底色变量', /--glass-bg-solid/.test(tabbarCode), true)
  check('默认走降级底色', /\.tabbar\s*\{[^}]*background-color:\s*var\(--glass-bg-solid/.test(tabbarCode), true)
  check('玻璃变量走公共工具', /glassVars/.test(tabbarCode), true)
  check('有玻璃内高光', /inset 0 1rpx 0/.test(tabbarCode), true)

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
  // 用户最终确认：全圆角胶囊（999rpx），不要圆角矩形
  check('滑块是全圆角', /\.tab-slider\s*\{[^}]*border-radius:\s*999rpx/.test(tabbarCode), true)
  check('滑块直接上色', /\.tab-slider\s*\{[^}]*background-color:\s*var\(--slider-color/.test(tabbarCode), true)
  // 定位用 left（transform 留给入场动画，两者会互相覆盖）
  check('滑块用 left 定位', /left:\s*`calc\(/.test(tabbarCode), true)
  check('滑块用 transform 位移', /transform:\s*`translateX\(/.test(tabbarCode), false)
  check('滑块用浅主题色', /primaryLight/.test(tabbarCode), true)
  check('store 有 primaryLight', /primaryLight\(state\)\s*\{/.test(
    readFileSync(join(process.cwd(), 'stores/setting.js'), 'utf-8')), true)

  /* ★ 滑块必须铺满整格，不能缩水 ★
   *   上一版套了 ::after 再内缩 10rpx/8rpx，实际只剩 119×88rpx，
   *   用户反馈「浅色圆角滑块收得太小」。
   *   这里锁高度：128 格高，滑块应 >= 110rpx（只留少量呼吸）。
   */
  const sliderH = (tabbarCode.match(/\.tab-slider\s*\{[^}]*height:\s*(\d+)rpx/) || [])[1]
  check('滑块高度 >= 110rpx（铺满整格）', Number(sliderH) >= 110, true)
  check('滑块不再套 ::after 内缩', /\.tab-slider::after/.test(tabbarCode), false)

  /* ★ 滑块：硬切，不要任何动效 ★
   *   4 个 tab 是不同 webview，切页时组件重新挂载，
   *   跨页位移不可观察（前几版验证过）。用户明确要求「硬切即可」。
   *   所以这些都得是空的：transition、animation、keyframes。
   */
  const sliderBlock = (tabbarCode.match(/\.tab-slider\s*\{[^}]*\}/) || [''])[0]
  check('滑块 transition 是 none', /transition:\s*none/.test(sliderBlock), true)
  check('滑块 animation 是 none', /animation:\s*none/.test(sliderBlock), true)
  check('滑块没有真实过渡时长', /transition:[^;]*\ds/.test(sliderBlock), false)
  check('滑块没有真实动画名', /animation:\s*(?!none)\w/.test(sliderBlock), false)
  check('没有 slider-pop 关键帧', /@keyframes slider-pop/.test(tabbarCode), false)
  check('图标没有 transition', /\.tab-icon\s*\{[^}]*transition:/.test(tabbarCode), false)
  check('文字没有 transition', /\.tab-text\s*\{[^}]*transition:/.test(tabbarCode), false)
  // 跨页位置记忆也一并删除（注释里说明历史是允许的，但不能有 state/action）
  const uiSrc = readFileSync(join(process.cwd(), 'stores/ui.js'), 'utf-8')
  check('store 没有 lastTabIndex 状态', /lastTabIndex:\s*-?\d/.test(uiSrc), false)
  check('store 没有 setLastTabIndex', /setLastTabIndex\s*\(/.test(uiSrc), false)

  /* ★ 弹层打开时底栏要一起收起 ★
   *   记账面板 / 速记输入条是全屏弹层，底栏留在遮罩边缘会露一角。
   */
  check('底栏有 hidden 开关', /hidden:\s*\{\s*type:\s*Boolean/.test(tabbarCode), true)
  const homeSrc = readFileSync(join(process.cwd(), 'pages/index/index.vue'), 'utf-8')
  check('首页把 hidden 接到两个弹层', /:hidden="showQuickAdd \|\| showPanel"/.test(homeSrc), true)

  /* ★ 旧的原生 tabBar 代码必须删干净 ★
   *   残留的 showTabBar() 会把隐藏的原生栏重新显示，
   *   和自绘底栏叠成两条 —— 这类残留极难排查，所以要锁住。
   */
  const cycleSrc = readFileSync(join(process.cwd(), 'components/CyclePanel.vue'), 'utf-8')
  check('CyclePanel 不再调 showTabBar', /uni\.showTabBar\(/.test(cycleSrc), false)
  check('CyclePanel 不再调 hideTabBar', /uni\.hideTabBar\(/.test(cycleSrc), false)
  const txnPanelSrc = readFileSync(join(process.cwd(), 'components/TxnPanel.vue'), 'utf-8')
  check('TxnPanel 不再调 showTabBar', /uni\.showTabBar\(/.test(txnPanelSrc), false)
  const quickAddSrc = readFileSync(join(process.cwd(), 'components/QuickAddBar.vue'), 'utf-8')
  check('QuickAddBar 不再调 showTabBar', /uni\.showTabBar\(/.test(quickAddSrc), false)
  // 全项目只允许 utils/tabBar.js 调 hideTabBar（唯一入口）
  check('hideTabBar 只出现在 utils/tabBar.js',
    /uni\.hideTabBar\(/.test(readFileSync(join(process.cwd(), 'utils/tabBar.js'), 'utf-8')), true)

  /* ★ 设置页顶部的说明块已按用户要求删除 ★
   *   用户：「删除标签管理和类似标签管理的所有页面的这种上面的这段提示语组件」
   *   涉及：标签管理 / 周期管理 / AI 大模型 / 记账按钮设置。
   *   这类「顶部一大段解释性文字」不要了，所以断言它们确实不存在，
   *   防止哪天又有人顺手加回来。
   */
  const HINT_PAGES = [
    'pages/settings/tag.vue',
    'pages/settings/cycle.vue',
    'pages/settings/ai.vue',
    'pages/settings/quick-add.vue'
  ]
  for (const rel of HINT_PAGES) {
    const code = readFileSync(join(process.cwd(), rel), 'utf-8')
    check(`${rel} 没有顶部提示块`, /class="hint-card"/.test(code), false)
  }

  /* ★ 关于页的说明段落要真的分行 ★
   *   bug：段落写在模板里，uni-app 的 <text> 编译期会把换行/缩进
   *   压成空格，white-space: pre-wrap 也救不了（换行符已不存在），
   *   结果整段挤成一坨。
   *   修法：文案放数组，v-for 渲染成多个 <text>，
   *   段落边界由 DOM 结构决定，与模板排版无关。
   */
  const aboutSrc = readFileSync(join(process.cwd(), 'pages/settings/about.vue'), 'utf-8')
  check('关于页用数组渲染段落', /v-for="\(p, i\) in privacyParas"/.test(aboutSrc), true)
  check('关于页有隐私段落数组', /const privacyParas = \[/.test(aboutSrc), true)
  check('关于页有安全段落数组', /const safetyParas = \[/.test(aboutSrc), true)
  check('关于页有功能段落数组', /const featureParas = \[/.test(aboutSrc), true)
  // 只查真实声明（注释里提及历史做法是允许的）
  check('不再依赖 pre-wrap', /white-space:\s*pre-wrap\s*;/.test(aboutSrc), false)

  /* ★ 有序列表 + 前两个字加粗 ★
   *   用户要求：
   *     1. 三段文字里的无序列表（· 开头）改成有序列表（1. 2. 3.）
   *     2. 「主要功能」每条的前两个字加粗
   *
   *   实现要点：
   *     · 序号用 CSS counter 生成，不在文案里手写编号
   *       （否则增删条目要手动重排序号）
   *     · 加粗范围由数据里的 lead 字段决定，不靠正则切前两个字
   */
  check('用 CSS counter 做有序列表', /counter-increment:\s*item/.test(aboutSrc), true)
  check('序号由 content 生成', /content:\s*counter\(item\)/.test(aboutSrc), true)
  check('每个卡片重置计数', /\.prose-card\s*\{[^}]*counter-reset:\s*item/.test(aboutSrc), true)
  check('有列表项样式', /\.prose-item\s*\{/.test(aboutSrc), true)
  check('有加粗前缀样式', /\.list-lead\s*\{[^}]*font-weight:\s*600/.test(aboutSrc), true)
  // lead 必须带冒号：原文是「记账：手动记账面板…」，
  // 冒号若留在 text 里会变成不加粗的普通字，看着像漏了冒号
  check('功能条 lead 带冒号', /\{ type: 'item', lead: '记账：'/.test(aboutSrc), true)
  check('所有功能条 lead 都以：结尾',
    (aboutSrc.match(/lead: '[^']*'/g) || []).every((s) => s.endsWith('：\'')), true)
  check('隐私条不带 lead', /type: 'item', text: '所有账户/.test(aboutSrc), true)
  // 文案里不应再残留「· 」前缀（会和 1. 2. 3. 重复）
  check('文案不再带·前缀', /'· /.test(aboutSrc), false)

  /* ★ 高度要够，不能扁 ★
   *   96rpx 那版用户反馈「有点丑」，要求高一些。
   *   这里锁一个下限，防止后续被改回扁的。
   */
  const pillH = (tabbarCode.match(/\.tabbar\s*\{[^}]*height:\s*(\d+)rpx/) || [])[1]
  check('胶囊高度 >= 120rpx', Number(pillH) >= 120, true)

  /* ★ 4 个 tab 页必须给悬浮底栏留出底部空间 ★
   *   原生 tabBar 会占掉布局高度，内容自然不被挡；
   *   换成悬浮栏后它浮在内容之上，必须靠 padding/占位补回来，
   *   否则最后一条记录会被底栏压住。
   *   这里断言用的是 .tabbar-space（比 .bottom-space 高），
   *   挡住「哪天有人把它换回 bottom-space」的回归。
   */
  const TAB_PAGES = [
    'pages/index/index.vue',
    'pages/account/index.vue',
    'pages/stats/index.vue',
    'pages/mine/index.vue'
  ]
  for (const rel of TAB_PAGES) {
    const code = readFileSync(join(process.cwd(), rel), 'utf-8')
    check(`${rel} 有 tabbar-space 留白`, /class="tabbar-space"/.test(code), true)
  }
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
