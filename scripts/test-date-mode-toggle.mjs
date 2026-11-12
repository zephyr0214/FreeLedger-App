/**
 * 时间筛选条（年月日筛选 ｜ 自定义筛选）的形态检查
 *
 *   node scripts/test-date-mode-toggle.mjs
 *
 * 用户需求（原话，分两次提的）：
 *   1.「在全部交易页面和统计页面上方，时间筛选面板上方新增一个 tab 切换按钮，
 *      类似于统计页面一级二级的切换 tab，分别为日月年筛选和自定义筛选，
 *      日月年下方使用当前逻辑，自定义支持选择开始日和结束日进行筛选」
 *   2.「两个页面的 tab 内容修改为"年月日筛选"、"自定义筛选"，自定义筛选下面的
 *      ui 优化，日期选择面板使用和记账面板日期选择一致」
 *   3.「你这样筛选太长了，只显示开始日期和结束日期，其他不要，显示在一行」
 *   4.「把年月日筛选组件和自定义筛选则组件做到高度一致，删除全部交易页面左上角
 *      的日期显示，保留笔数」
 *
 * ★ 为什么要静态检查 ★
 *   这套切换涉及「两套状态 + 两个查询分支 + 两个组件」，写错时编译不报、
 *   运行也不报，只在真机上表现为「切了没反应」「跨月只查得到一个月」
 *   「换个 tab 内容跳一下」—— 都很难从报错里看出来。
 *
 * ★ 现在检查的是「组件化之后」的形态 ★
 *   筛选条已经抽成 components/DateFilterBar.vue，两个页面只负责传值和重查。
 *   所以断言分两层：组件本身的实现，以及两个页面有没有正确接上。
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

let pass = 0
let fail = 0
const fails = []

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    fail++
    fails.push(`${name}\n      实际 ${a}\n      期望 ${e}`)
    console.log(`FAIL  ${name}\n      实际 ${a}\n      期望 ${e}`)
  }
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf-8')
}

/**
 * 去掉注释再断言。
 *
 * ★ 必须做 ★
 *   这些文件的注释里写了大量「monthKey」「dateMode」「原生 picker」这类词，
 *   直接在原文上正则匹配会大量误判 —— test-share-intent 就吃过这个亏。
 */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const BAR = 'components/DateFilterBar.vue'
const PAGES = [
  { name: '全部交易', file: 'pages/txn/list.vue', reload: 'loadFirstPage' },
  { name: '统计', file: 'pages/stats/index.vue', reload: 'loadAll' }
]

/* ================================ 1. 组件本身 ============================ */

console.log('=== 1. DateFilterBar 组件 ===')

const barRaw = read(BAR)
const barCode = stripComments(barRaw)
const barTpl = stripComments((barRaw.match(/<template>([\s\S]*)<\/template>/) || [])[1] || '')
const barStyle = (barRaw.match(/<style[^>]*>([\s\S]*)<\/style>/) || [])[1] || ''

// --- 文案（用户逐字指定）
check('有「年月日筛选」按钮', />年月日筛选</.test(barTpl), true)
check('有「自定义筛选」按钮', />自定义筛选</.test(barTpl), true)
check('不再用旧的「日/月/年」文案', /日\/月\/年/.test(barTpl), false)
check('不再用旧的「自定义」短文案', />自定义</.test(barTpl), false)

// --- toggle
check('用 .mode-toggle 包住两个按钮', /class="mode-toggle"/.test(barTpl), true)
check('按钮用 .mode-tag', (barTpl.match(/class="mode-tag"/g) || []).length >= 2, true)
check(
  '选中态按 mode 判断',
  /:class="\{ active: mode === 'period' \}"/.test(barTpl) &&
    /:class="\{ active: mode === 'custom' \}"/.test(barTpl),
  true
)
check(
  '点按钮会切模式',
  /@click="pickMode\('period'\)"/.test(barTpl) && /@click="pickMode\('custom'\)"/.test(barTpl),
  true
)

// --- 年月日筛选分支仍是原来那套三级联动
check('period 分支渲染 DateRangePicker', /v-if="mode === 'period'"/.test(barTpl), true)
check('DateRangePicker 仍被引入', /import DateRangePicker from '@\/components\/DateRangePicker.vue'/.test(barCode), true)
check('有 periodRef 以便透传 collapse', /const periodRef = ref\(null\)/.test(barCode), true)

// --- 自定义筛选：必须只有一行起止日，不能有多余内容
console.log('\n--- 自定义筛选只保留一行起止日 ---')

check('custom 分支是 v-else 的单行容器', /v-else class="custom-row"/.test(barTpl), true)

/*
 * ★ 两个日期格合成一个区间格（用户本轮第 5 条）★
 *   用户原话：「我希望像订酒店那样，他是选择一个区间的起末」。
 *   所以不再有「开始日期」「结束日期」两个独立入口，
 *   只有一个显示「M/D → M/D」的格子。
 */
check('只有一个区间入口', /openCalendar\(\)/.test(barTpl), true)
check('不再有独立的开始日期入口', /openCalendar\('start'\)/.test(barTpl), false)
check('不再有独立的结束日期入口', /openCalendar\('end'\)/.test(barTpl), false)
check('区间格绑了 rangeText', /\{\{ rangeText \}\}/.test(barTpl), true)
check('rangeText 是 computed', /const rangeText = computed\(/.test(barCode), true)
check('空态文案是「选择日期区间」', /选择日期区间/.test(barCode), true)

// ★ 用户说过「其他不要」：一排 chip、天数提示、重置按钮都不许回来
check('没有一排快捷 chip', /quick-chip|quick-row/.test(barRaw), false)
check('没有「共 N 天」提示', /共 \{\{|dayCount/.test(barRaw), false)
check('没有重置按钮', /resetCustom|hint-reset/.test(barRaw), false)
check('没有中间的长破折号分隔', /custom-sep/.test(barRaw), false)

// --- 预设下拉（用户第二批要求：最左侧一个下拉框）
console.log('\n--- 最左侧预设下拉 ---')

check('用原生 picker mode="selector" 做预设下拉', /<picker[\s\S]{0,240}?mode="selector"/.test(barTpl), true)
check('预设下拉绑了 range', /:range="PRESET_LABELS"/.test(barTpl), true)
check('预设下拉绑了 value', /:value="presetIndex"/.test(barTpl), true)
check('预设下拉有 change 处理', /@change="onPresetChange"/.test(barTpl), true)

// 六项，顺序照用户说的
const presetBlock = (barCode.match(/const PRESETS = \[([\s\S]*?)\n\]/) || [])[1] || ''
for (const label of ['自定义', '近一周', '近一月', '近半年', '近一年', '近五年']) {
  check(`预设里有「${label}」`, new RegExp(`label: '${label}'`).test(presetBlock), true)
}
check('预设正好六项', (presetBlock.match(/key: '/g) || []).length, 6)
check(
  '预设顺序：自定义在最前',
  presetBlock.indexOf("'自定义'") < presetBlock.indexOf("'近一周'"),
  true
)

/*
 * ★ 预设为什么不能自己存一个变量 ★
 *   如果额外存 activePreset，手动改日期时就必须记得同步它 ——
 *   两处状态一定会漏。这里要求它是 computed 反推出来的。
 */
check('当前预设是反推出来的（computed）', /const activePresetKey = computed\(/.test(barCode), true)
check(
  '反推依据是起止日与预设区间的比较',
  /r\.startDay === props\.startDay && r\.endDay === props\.endDay/.test(barCode),
  true
)
check('对不上就落回自定义', /return 'custom'/.test(barCode), true)
/*
 * ★ 选「自定义」要能真的选中（bug 修复）★
 *   用户反馈：「在自定义筛选左边，无法选中「自定义」这一栏」。
 *   旧写法对 custom 直接 return，什么都不发生，看起来就像选项坏了。
 *   现在改成：选中自定义 → 立即弹出区间日历让用户手动选。
 */
check(
  '选「自定义」会弹出区间日历',
  /preset\.key === 'custom'\) \{\s*openCalendar\(\)/.test(barCode),
  true
)
check('选「自定义」不清空已选日期', /commit\(r\.startDay, r\.endDay\)/.test(barCode), true)

// --- 预设区间的算法
check('近一周按 7 天算（含今天）', /shiftDay\(todayKey, -6\)/.test(barCode), true)
check('近一月按 30 天算（含今天）', /shiftDay\(todayKey, -29\)/.test(barCode), true)
check(
  '半年/一年/五年用日历回退而不是天数乘法',
  /getMonth\(\) - 6/.test(barCode) && /getFullYear\(\) - 1/.test(barCode) && /getFullYear\(\) - 5/.test(barCode),
  true
)

/*
 * ★ 两格布局：预设下拉 + 一个区间格（用户本轮第 5 条）★
 *   之前是三格（预设 + 开始 + 结束），
 *   合成一个区间格后就是两格 —— 区间格变宽，
 *   「10/1 → 10/31」这种完整区间也放得下。
 */
check(
  '两格在同一行（预设 + 区间）',
  /custom-preset/.test(barTpl) && (barTpl.match(/class="custom-cell/g) || []).length === 1,
  true
)
check(
  '预设格固定宽度、不与日期平分',
  /\.custom-preset \{[^}]*flex: none/.test(barStyle) && /width: 168rpx/.test(barStyle),
  true
)
check(
  '预设格与日期格之间有分隔线',
  (barStyle.match(/border-right: 1rpx solid var\(--app-line\)/g) || []).length >= 2,
  true
)

// --- 日期面板必须与记账面板一致（wd-calendar，不是原生 picker）
console.log('\n--- 日期面板用 wd-calendar（与记账面板一致）---')

/*
 * ★ 只用一个 wd-calendar，且 type="daterange"（用户本轮第 5 条）★
 *   两个单日历→一个区间日历，一䬡面板里先点起点、再点讫点。
 */
check(
  '只用一个 wd-calendar',
  (barTpl.match(/<wd-calendar/g) || []).length === 1,
  true
)
check('日历用 type="daterange"', /type="daterange"/.test(barTpl), true)
check('没用原生 picker mode="date"', /<picker mode="date"/.test(barTpl), false)
check('日历有 ref（要靠 open() 打开）', /ref="rangeCalRef"/.test(barTpl), true)
check('日历 with-cell=false（不额外渲染一行）', (barTpl.match(/:with-cell="false"/g) || []).length === 1, true)

/*
 * ★ min-date 必须显式给 ★
 *   wd-calendar 默认 minDate 是「6 个月前」，只给 max-date 时
 *   月份会被限制在极窄范围（记账面板踩过，见 TxnPanel 的注释）。
 *   而且预设里有「近五年」，下界必须盖得住它。
 */
check('显式给了 min-date', (barTpl.match(/:min-date="minDate"/g) || []).length === 1, true)
check('显式给了 max-date', (barTpl.match(/:max-date="maxDate"/g) || []).length === 1, true)
check('minDate 覆盖五年', /getFullYear\(\) - 5, 0, 1\)\.getTime\(\)/.test(barCode), true)
check('maxDate 截到今天 23:59:59', /23, 59, 59\)\.getTime\(\)/.test(barCode), true)

// ★ 打开前必须先喂当前区间，否则会停在今天
check(
  'openCalendar 先赋值再 open',
  /function openCalendar\(\)[\s\S]{0,600}?rangeValue\.value = [\s\S]{0,300}?\.open\(\)/.test(barCode),
  true
)
check('open() 有存在性检查', /typeof rangeCalRef\.value\.open === 'function'/.test(barCode), true)
check('没选日期时给一个合理默认区间', /getMonth\(\) - 1/.test(barCode), true)

// ★ 区间日历的 confirm 回传长度 2 的数组
check('confirm 收 value 并取两端', /function onRangeConfirm\(\{ value \}\)[\s\S]{0,300}?arr\[0\][\s\S]{0,120}?arr\[1\]/.test(barCode), true)
check('区间不完整时不提交', /if \(arr\.length < 2/.test(barCode), true)
check('用 toDayKey 转（不是 toISOString）', /tsToDay\(ts\)[\s\S]{0,120}?toDayKey\(new Date\(ts\)\)/.test(barCode), true)
check('没直接用 toISOString', /toISOString/.test(barCode), false)

// --- 起止颠倒只在组件里纠正一次
check(
  'commit 里交换起止',
  /function commit\(start, end\)[\s\S]{0,320}?a > b[\s\S]{0,160}?a = b/.test(barCode),
  true
)

// --- 事件名不能撞原生事件（check-events 会拦）
check('emits 声明了 custom-change', /'custom-change'/.test(barCode), true)
check('emits 里没有 change（撞原生）', /\bemits:[\s\S]{0,300}?'change'/.test(barCode), false)
check('emits 里没有 confirm（撞原生）', /\bemits:[\s\S]{0,300}?'confirm'/.test(barCode), false)

// --- 两个 tab 高度必须一致
console.log('\n--- 两个 tab 高度一致 ---')

/*
 * ★ 对齐依据是 DateRangePicker 的 .drp-bar ★
 *   .drp-cell 的 height 是 72rpx、flex:1、居中、右边框 1rpx 分隔。
 *   自定义那行必须抄同一组数值，否则切 tab 时下面的内容会上下跳一下。
 */
const drpRaw = read('components/DateRangePicker.vue')
const drpStyle = (drpRaw.match(/<style[^>]*>([\s\S]*)<\/style>/) || [])[1] || ''
const drpCellHeight = (drpStyle.match(/\.drp-cell\s*\{[^}]*height:\s*(\d+)rpx/) || [])[1]
/*
 * ★ 高度基准从 72rpx 改成 60rpx（用户本轮第 2 条）★
 *   用户原话：「希望年月日筛选和自定义筛选这个组件
 *   它高度能稍微矮一点，两个页面同步修改一下」。
 *
 *   这条断言不是在“锁死 72”，而是在验证「两个 tab 的高度取值相同」。
 *   所以不写死数字，而是先取 .drp-cell 的实际值，
 *   再拿它去比对自定义那一行——以后再调高度时只要两处同步，测试仍然成立。
 */
check('.drp-cell 存在高度声明', Boolean(drpCellHeight), true)
check('.drp-cell 高度在合理范围内（50~72rpx）', Number(drpCellHeight) >= 50 && Number(drpCellHeight) <= 72, true)

/*
 * ★ 高度写在合并规则里 ★
 *   `.custom-preset, .custom-cell { ... height: 72rpx ... }` 是共享布局，
 *   后面 `.custom-cell { flex:1; min-width:0; ... }` 只补差异部分。
 *   所以按「所有 .custom-cell 相关规则」判断，不能只取最后一条。
 */
const cellRuleGroup = (barStyle.match(/(?:\.custom-preset,\s*\.custom-cell|\.custom-cell)\s*\{[^}]*\}/g) || []).join('\n')
/*
 * 取「最后一条」.custom-cell 规则：
 *   合并规则 `.custom-preset, .custom-cell {...}` 也会被正则命中，
 *   但它只是共享的布局部分（高度/居中），差异（flex/min-width）在后面那条。
 */
const cellAll = barStyle.match(/\.custom-cell\s*\{[^}]*\}/g) || []
const cellFlexRule = cellAll[cellAll.length - 1] || ''
const cellBaseRule = (barStyle.match(/\.custom-preset,\s*\.custom-cell\s*\{[^}]*\}/) || [])[0] || ''
/*
 * ★ 两个 tab 必须同高 ★
 *   直接比两个源码里的高度值，而不是写死一个数字。
 *   这样「改一个忘改另一个」会立刻被抓到。
 */
const customCellHeight = (cellRuleGroup.match(/height:\s*(\d+)rpx/) || [])[1]
check('自定义格高度与 .drp-cell 完全一致', customCellHeight, drpCellHeight)
check('自定义格 flex:1（与日期格一致）', /flex:\s*1/.test(cellFlexRule), true)
check('自定义格 min-width:0（长日期不会撑破）', /min-width:\s*0/.test(cellFlexRule), true)
check('基础布局规则同时作用于预设格与日期格', cellBaseRule.length > 0, true)
check('自定义容器圆角与 .drp-bar 一致', /border-radius:\s*16rpx/.test((barStyle.match(/\.custom-row\s*\{[^}]*\}/) || [])[0] || ''), true)

/* ---------------------------------------------------- 弹层层级（用户报告） */

console.log('\n--- 日历弹层不能被底栏和「+」压住 ---')

/*
 * ★ 这个 bug 的表现和根因（踩过两轮）★
 *   第一轮：wd-calendar 内部是 wd-action-sheet，默认层级只有 15；
 *          而统计页的悬浮底栏是 300、「+」记账按钮是 600，弹层被压住。
 *          解法是把 :z-index 传到 wd-calendar 上。
 *   第二轮（用户仍然反馈「还是在下层」）：真正的元凶是**祖先创建了层叠上下文**。
 *          `.range-picker-bar` / `.month-bar` / `.dfb` 都写过
 *          `position: relative; z-index: 5`，于是日历的 1100 只是这个 5
 *          的上下文里的老大，跟页面级的 300 / 600 比，整棵子树还是 5。
 *          所以那几个祖先容器的 z-index 必须删掉。
 */
check('日历传了 :z-index', (barTpl.match(/:z-index="CALENDAR_Z_INDEX"/g) || []).length === 1, true)
check('定义了 CALENDAR_Z_INDEX', /const CALENDAR_Z_INDEX = \d+/.test(barCode), true)

const calZ = Number((barCode.match(/const CALENDAR_Z_INDEX = (\d+)/) || [])[1] || 0)
check('日历层级高于 AppTabBar(300)', calZ > 300, true)
check('日历层级高于 QuickAddBar(600)', calZ > 600, true)
check('日历层级高于 AppDialog(1000)', calZ > 1000, true)
check('CALENDAR_Z_INDEX 在 return 里（模板要用）', /return \{[\s\S]{0,300}?CALENDAR_Z_INDEX/.test(barCode), true)

/* ---------------------------------- 祖先容器不能创建层叠上下文（最关键） */

console.log('\n--- 祖先容器不许带 z-index（否则弹层永远在底下）---')

/*
 * 判据：去掉注释后，这三个容器的 CSS 规则里不允许出现 z-index。
 * 只查注释外的真实声明 —— 注释里为了写清来历会提到这些数字。
 */
function ruleWithoutZIndex(src, selector) {
  const code = stripComments(src)
  const style = (code.match(/<style[^>]*>([\s\S]*)<\/style>/) || [])[1] || ''
  const rule = (style.match(new RegExp(`\\${selector}\\s*\\{[^}]*\\}`)) || [])[0] || ''
  return { rule, hasZ: /z-index:/.test(rule) }
}

const dfbRule = ruleWithoutZIndex(barRaw, '.dfb')
check('.dfb 规则存在', dfbRule.rule.length > 0, true)
check('.dfb 不带 z-index', dfbRule.hasZ, false)

for (const [name, file, sel] of [
  ['统计页', 'pages/stats/index.vue', '.range-picker-bar'],
  ['全部交易页', 'pages/txn/list.vue', '.month-bar']
]) {
  const r = ruleWithoutZIndex(read(file), sel)
  check(`${name}的 ${sel} 规则存在`, r.rule.length > 0, true)
  check(`${name}的 ${sel} 不带 z-index`, r.hasZ, false)
}

// 交叉校验：这两个层级来自真实组件，不能凭记忆写
const tabBarStyle = (read('components/AppTabBar.vue').match(/<style[^>]*>([\s\S]*)<\/style>/) || [])[1] || ''
const quickAddStyle = (read('components/QuickAddBar.vue').match(/<style[^>]*>([\s\S]*)<\/style>/) || [])[1] || ''
const tabZ = Number((tabBarStyle.match(/\.tabbar-host\s*\{[^}]*z-index:\s*(\d+)/) || [])[1] || 0)
const quickZ = Number((quickAddStyle.match(/z-index:\s*(\d+)/) || [])[1] || 0)
check('AppTabBar 的层级确实是 300', tabZ, 300)
check('QuickAddBar 的层级确实是 600', quickZ, 600)
check('日历层级高于这两个（真实值比较）', calZ > Math.max(tabZ, quickZ), true)

/* ------------------------------------------------------------------ 默认值 */

console.log('\n--- 默认显示「近一月」 ---')

/*
 * ★ 默认值必须和组件的「近一月」预设算得一模一样 ★
 *   否则左边的下拉会显示成「自定义」，用户会以为默认没生效。
 *   这里直接 import 真的函数来比，不靠读源码。
 */
const { defaultCustomRange, shiftDay, toDayKey, parseDayKey } = await import('../utils/date.js')
const dcr = defaultCustomRange()
check('默认结束日是今天', dcr.endDay, toDayKey())
check('默认开始日是 29 天前（共 30 天）', dcr.startDay, shiftDay(toDayKey(), -29))
check('默认区间跨度为 29 天', Math.round((parseDayKey(dcr.endDay) - parseDayKey(dcr.startDay)) / 86400000), 29)

/* ============================== 2. 两个页面 ============================== */

for (const page of PAGES) {
  const raw = read(page.file)
  const code = stripComments(raw)
  const template = stripComments((raw.match(/<template>([\s\S]*)<\/template>/) || [])[1] || '')
  const style = (raw.match(/<style[^>]*>([\s\S]*)<\/style>/) || [])[1] || ''

  console.log(`\n=== 2. ${page.name}页（${page.file}）===`)

  // --- 用的是共用组件
  check(`${page.name}页引入 DateFilterBar`, /import DateFilterBar from '@\/components\/DateFilterBar.vue'/.test(code), true)
  check(`${page.name}页注册 DateFilterBar`, /components:\s*\{[^}]*DateFilterBar[^}]*\}/.test(code), true)
  check(`${page.name}页不再直接用 DateRangePicker`, /<DateRangePicker/.test(template), false)
  check(`${page.name}页不再 import DateRangePicker`, /import DateRangePicker/.test(code), false)

  // --- 传值
  for (const [attr, val] of [
    ['mode', 'dateMode'],
    ['model-value', 'dateRange'],
    ['start-day', 'customStart'],
    ['end-day', 'customEnd']
  ]) {
    check(`${page.name}页传了 ${attr}`, new RegExp(`:${attr}="${val}"`).test(template), true)
  }

  // --- 事件
  check(`${page.name}页接 mode 切换`, /@update:mode="onModeChange"/.test(template), true)
  check(`${page.name}页接自定义区间`, /@custom-change="onCustomChange"/.test(template), true)

  // --- 切模式就重查
  check(
    `${page.name}页切模式立刻重查`,
    new RegExp(`function onModeChange\\(mode\\)[\\s\\S]{0,260}?${page.reload}\\(\\)`).test(code),
    true
  )
  check(
    `${page.name}页改起止日会重查`,
    new RegExp(`function onCustomChange\\(\\{ startDay, endDay \\}\\)[\\s\\S]{0,300}?${page.reload}\\(\\)`).test(code),
    true
  )

  /*
   * ★ 颠倒纠正不该在页面里再做一遍 ★
   *   组件 commit() 已经交换过了，页面再判一次就是两份逻辑，
   *   以后改一处漏一处必然出问题。
   */
  check(
    `${page.name}页不再自己做颠倒纠正`,
    /customStart\.value > customEnd\.value/.test(code),
    false
  )

  // --- 旧的一次性实现必须清干净（否则两套东西并存，改哪套都不知道）
  check(`${page.name}页没有旧的 switchDateMode`, /switchDateMode/.test(code), false)
  check(`${page.name}页没有旧的 onCustomStart`, /onCustomStart/.test(code), false)
  check(`${page.name}页没有旧的 onCustomEnd`, /onCustomEnd/.test(code), false)
  check(`${page.name}页没有旧的 .mode-toggle 样式`, /\.mode-toggle\s*\{/.test(style), false)
  check(`${page.name}页没有旧的 .custom-bar 样式`, /\.custom-bar\s*\{/.test(style), false)

  // --- 模板引用的东西都从 setup 返回
  for (const key of ['dateMode', 'customStart', 'customEnd', 'dateRange']) {
    check(`${page.name}页 return 里有 ${key}`, new RegExp(`return \\{[\\s\\S]*?\\b${key}\\b`).test(code), true)
  }
  check(`${page.name}页 return 里有 onModeChange`, /return \{[\s\S]*?onModeChange/.test(code), true)
  check(`${page.name}页 return 里有 onCustomChange`, /return \{[\s\S]*?onCustomChange/.test(code), true)
}

/* ========================= 3. 全部交易页汇总条 ========================== */

console.log('\n=== 3. 全部交易页汇总条只保留笔数 ===')

const listTpl = stripComments((read('pages/txn/list.vue').match(/<template>([\s\S]*)<\/template>/) || [])[1] || '')

/*
 * 用户原话：「删除全部交易页面左上角的日期显示，保留笔数」。
 * 判据：.summary-text 里不能再出现 rangeLabel，但「共 N 笔」要在。
 */
const summaryRule = (listTpl.match(/<text class="summary-text">([\s\S]*?)<\/text>/) || [])[1] || ''
check('汇总条还显示笔数', /共 \{\{ summary\.count \}\} 笔/.test(listTpl), true)
check('汇总条不再显示日期范围', /rangeLabel/.test(summaryRule), false)

/* ============================ 4. 删除后要刷新 ============================ */

console.log('\n=== 4. 删除交易后列表会刷新 ===')

const listCode = stripComments(read('pages/txn/list.vue'))

/*
 * ★ 「删了但没消失」的根因 ★
 *   detail 页删完 navigateBack 回到列表，而列表页的 onShow 以前只同步主题、
 *   不重查数据，所以还是离开前的旧列表。
 */
check(
  '列表页 onShow 里会重新查询',
  /onShow\(\(\) => \{[\s\S]{0,600}?loadFirstPage\(\)/.test(listCode),
  true
)
check('重查前先跳过首次 onShow（避免与 onMounted 重复）', /shownOnce/.test(listCode), true)

/* ======================== 5. 账户名在备注左边（旧需求）=================== */

console.log('\n=== 5. 账户名显示在备注左边 ===')

for (const file of ['pages/txn/list.vue', 'pages/index/index.vue', 'components/RecentTxnList.vue']) {
  const code = stripComments(read(file))
  const body = (code.match(/function txnSub\(txn\)[\s\S]*?\n    \}/) || [])[0] || ''
  const iAcc = body.indexOf('account_name')
  const iNote = body.indexOf('txn.note')
  check(`${file} 的 txnSub 里账户名在备注之前`, iAcc > 0 && iNote > 0 && iAcc < iNote, true)
}

const statsTpl = stripComments(read('pages/stats/index.vue'))
check('统计页 Top10 副标题账户名在前', /t\.account_name \|\| t\.note/.test(statsTpl), true)

/* ================================ 收尾 ================================== */

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) {
  console.log('\n失败项：')
  for (const f of fails) console.log('  · ' + f.split('\n')[0])
  process.exit(1)
}
