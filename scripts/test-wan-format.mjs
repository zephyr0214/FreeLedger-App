/**
 * 大额金额展示（W 单位）+ 图标预填名 + 借还意图 的测试
 *
 *   node scripts/test-wan-format.mjs
 *
 * 覆盖本轮用户提的几条：
 *   1. 金额 >= 100 万时用两位小数 + W
 *   2. 添加账户选图标时预填对应名称
 *   3. AI 记账「某某借给我」应识别为借入
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { formatCents, formatWanYuan, WAN_THRESHOLD_CENTS } from '../utils/money.js'
import { accountNameForIcon, ACCOUNT_ICONS } from '../utils/accountIcons.js'
import { detectLoanIntent } from '../api/aiParse.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8')

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

console.log('=== 1. 大额金额换算成 W ===')

{
  /*
   * ★ 用户原话 ★
   *   「一些没有考虑到金额过大的情况，把所有显示价签的地方，
   *   金额大于等于 100 万时使用两位小数加 W 为单位表示，也就是自动换算」。
   *
   * ★ 阈值为什么是 100 万 ★
   *   一万开始换算会让常见金额变得难读（「12345 元」→「1.23W」），
   *   而 100 万以上的数字本来就长（「1,234,567.89」一行放不下）。
   */
  check('阈值是 100 万元（分）', WAN_THRESHOLD_CENTS, 100 * 10000 * 100)

  // 未达阈值：保持原来的两位小数 + 千分位
  check('99,9999.99 元不换算', formatCents(99999999, { symbol: '' }), '999,999.99')
  check('刚好 99 万不换算', formatWanYuan(99000000), '990000.00')

  /*
   * ★ W 就是「万」，100 万元 = 100W ★
   *   这里极容易写错：把分除以「100 万的分值」会得到「1.00W」，
   *   听着像 1 万，实际是 100 万—— 用户会以为金额少了 100 倍。
   *   所以除数必须是「1 万元 = 1,000,000 分」。
   */
  check('刚好 100 万 → 100.00W', formatWanYuan(100000000), '100.00W')
  check('123 万 → 123.00W', formatWanYuan(123000000), '123.00W')
  check('123.46 万', formatWanYuan(123456789), '123.46W')
  check('1234.57 万', formatWanYuan(1234567890), '1234.57W')

  // formatCents 也默认启用
  check('formatCents 默认换算', formatCents(100000000, { symbol: '¥' }), '¥100.00W')
  check('formatCents 带符号', formatCents(100000000, { symbol: '¥', sign: true }), '+¥100.00W')
  check('formatCents 负数', formatCents(-100000000, { symbol: '¥' }), '-¥100.00W')

  // 可显式关闭（输入框回填要原始数字）
  // grouping 默认开，所以关闭 autoWan 后是带千分位的 「1,000,000.00」
  check('可关闭 autoWan', formatCents(100000000, { symbol: '', autoWan: false }), '1,000,000.00')
}

console.log('=== 2. 所有价签都走统一出口 ===')

{
  /*
   * 检查方式：源码里不该再有手写的「金额 / 100).toFixed(2)」展示。
   * 那种写法会绕开 W 换算，导致「这里换算了、那里没换算」。
   *
   * 允许的例外（它们不是「价签」）：
   *   · 输入框回填（要原始数字才能继续编辑）
   *   · 图表刻度（需要数值不必带 W，图表空间另有约束）
   */
  const files = [
    'pages/index/index.vue', 'pages/txn/list.vue', 'pages/stats/index.vue',
    'pages/settings/budget.vue', 'pages/settings/budget-detail.vue',
    'pages/loan/reimburse.vue', 'pages/loan/manage.vue'
  ]
  for (const f of files) {
    const src = read(f)
    const tpl = (src.match(/<template>([\s\S]*)<\/template>/) || [])[1] || ''
    // 模板里出现「/ 100).toFixed(2)」= 有价签绕过了 formatWanYuan
    const leftover = tpl.match(/\/\s*100\)\.toFixed\(2\)/g) || []
    check(`${f} 模板里没有手写的两位小数金额`, leftover.length, 0)
  }
}

console.log('=== 3. 选图标预填账户名 ===')

{
  /*
   * ★ 用户原话 ★
   *   「添加账户时，我希望用户选择那个图标的时侯，名字那里就预填一个
   *   该图标对应的名字」。
   */
  check('微信 → 微信', accountNameForIcon('wechat'), '微信')
  check('支付宝 → 支付宝', accountNameForIcon('alipay'), '支付宝')
  check('建行 → 中国建设银行', accountNameForIcon('zjsy'), '中国建设银行')
  check('中行 → 中国银行', accountNameForIcon('zy'), '中国银行')
  check('农行 → 中国农业银行', accountNameForIcon('znyy'), '中国农业银行')
  check('工行 → 中国工商银行', accountNameForIcon('zgsy'), '中国工商银行')
  check('邮储 → 邮政储蓄银行', accountNameForIcon('googlepay'), '邮政储蓄银行')
  check('招商 → 招商银行', accountNameForIcon('paypal'), '招商银行')
  check('花呗 → 花呗', accountNameForIcon('saving'), '花呗')
  check('投资 → 投资账户', accountNameForIcon('invest'), '投资账户')
  check('未知 key 返回空串', accountNameForIcon('__nope__'), '')
  check('空 key 返回空串', accountNameForIcon(''), '')

  // 每个可选图标都要有名字（不能有漏的）
  const missing = ACCOUNT_ICONS.filter((ic) => !accountNameForIcon(ic.key)).map((ic) => ic.key)
  check('所有可选图标都有默认名', missing, [])

  // 页面接线
  const edit = read('pages/account/edit.vue')
  check('图标点击走 onPickIcon', /@click="onPickIcon\(ic\)"/.test(edit), true)
  check('onPickIcon 用了 accountNameForIcon', /accountNameForIcon\(ic\.key\)/.test(edit), true)
  check('不覆盖用户自己输入的名字', /currentName === prevDefault/.test(edit), true)
}

console.log('=== 4. AI 记账借还方向 ===')

{
  /*
   * ★ 用户原话 ★
   *   「比如『某某某借给我』，应该是『借入』，它就会识别为『借出』，
   *   而且金额又识别成了正数，非常滑稽」。
   */
  check('张三借给我30 → 借入', detectLoanIntent('张三借给我30').categoryName, '借入')
  check('张三借给我30 是收入', detectLoanIntent('张三借给我30').type, 'income')
  check('李四借给我500元 → 借入', detectLoanIntent('李四借给我500元').categoryName, '借入')
  check('张三借了30给我 → 借入', detectLoanIntent('张三借了30给我').categoryName, '借入')
  check('张三借钱给我 → 借入', detectLoanIntent('张三借钱给我').categoryName, '借入')

  // 反向不能搞错
  check('我借给张三30 → 仍是借出', detectLoanIntent('我借给张三30').categoryName, '借出')
  check('借给张三30 → 仍是借出', detectLoanIntent('借给张三30').categoryName, '借出')
  check('借钱给朋友500 → 仍是借出', detectLoanIntent('借钱给朋友500').categoryName, '借出')
  check('向张三借了30 → 借入', detectLoanIntent('向张三借了30').categoryName, '借入')
  check('张三还我30 → 借款收回', detectLoanIntent('张三还我30').categoryName, '借款收回')
  check('还给张三30 → 借款归还', detectLoanIntent('还给张三30').categoryName, '借款归还')

  // 方向以原句为准，不只纠正 transfer
  const parse = read('api/aiParse.js')
  check(
    '方向无条件按原句纠正（不只 transfer）',
    /if \(loanIntent && type !== loanIntent\.type\)/.test(parse),
    true
  )
  check('旧的「只在 transfer 时纠正」已移除', /loanIntent && type === 'transfer'/.test(parse), false)
}

console.log('=== 5. 月历：色块只包日期，金额加回来 ===')

{
  /*
   * ★ 用户两次反馈合起来才是完整需求 ★
   *   1. 「月历上的主题色遮挡了，任何绿色的收入支出就不太显眼了。
   *      我想让它只包括日期的数字，不要包括下面的收入支出数字」
   *   2. 「我指的是月历上的那个色块缩小，只包含那个日期数字，
   *      没说让你把我的手指给去掉！」
   *   3. 「月历上我的收支没加回来啊」
   *
   * → 结论：色块（.day-inner）缩成小圆块、只包日期；
   *   金额行（.day-expense / .day-income）**必须存在**，只是不在圆块里面。
   *
   * ★ 这段断言的意义 ★
   *   上一版我误把用户的第 1 条理解成「删掉金额」，
   *   这里同时验证「圆块小」和「金额在」两个特征，
   *   任一个被改回去都会立刻报错。
   */
  const cal = read('components/CalendarGrid.vue')
  const calStyle = (cal.match(/<style[^>]*>([\s\S]*)<\/style>/) || [])[1] || ''
  const calTpl = (cal.match(/<template>([\s\S]*)<\/template>/) || [])[1] || ''

  // 日期数字与圆块
  check('格子里有日期数字', /class="day-num"/.test(calTpl), true)
  check(
    '日期数字被包在 .day-inner 圆块里',
    /*
     * ★ 宽容到 600 字符 ★
     *   .day-inner 的开标签后面跟着一段多行的
     *   :style 三元表达式（热力底色），就占了 200 多字符，
     *   只给 220 会截断在中间。
     */
    /\.day-inner[\s\S]{0,600}?class="day-num"/.test(calTpl),
    true
  )
  check('圆块是固定尺寸（不再铺满整个方格）', /width: 44rpx/.test(calStyle) && /height: 44rpx/.test(calStyle), true)
  check('圆块是圆形', /\.day-inner \{[^}]*border-radius: 50%/.test(calStyle), true)
  check('圆块不再 width: 100%', /\.day-inner \{[^}]*width: 100%/.test(calStyle), false)

  // 金额必须在（用户明确要求加回来）
  check('支出金额行存在', /day-amount day-expense/.test(calTpl), true)
  check('收入金额行存在', /day-amount day-income/.test(calTpl), true)
  check('金额格式化函数存在', /function formatAmount/.test(cal), true)
  check('金额配色函数存在', /function expenseColor/.test(cal) && /function incomeColor/.test(cal), true)
  check('收入金额仍用主题绿', new RegExp(String.raw`var\(--app-success\)`).test(cal), true)
  // ★ 支出改用正文色（用户本轮第 4 条）：浅色黑、深色白，不再是红
check('支出金额用支出红', /return 'var\(--app-danger\)'/.test(cal), true)

  // 金额不能再被塞回圆块里（否则又是“彩色字压彩色底”）
  const innerBlock = (calTpl.match(/<view[^>]*class="day-inner"[\s\S]*?<\/view>/) || [])[0] || ''
  check('圆块里只有日期、没有金额', /day-amount/.test(innerBlock), false)

  check('热力度仍保留（圆块底色表达花多少）', /function heatLevel/.test(cal), true)
}

console.log('=== 5b. 月历对齐与占位 ===')

{
  /*
   * ★ 用户本���第 1、2 条 ★
   *   1.「这个月历上这个色块和下面的收支金额相隔得太近了，你稍微空一丝丝的距离」
   *   2.「现在下面加一条金额和加两条金额时，色块的横向包括金额的横向都不对齐。
   *      在没有收入、没有支出或者收支都没有的时候，你添加一点占位符，
   *      让它的高度保持一致」
   *
   * ★ 为什么会不齐 ★
   *   旧写法用 v-if：没有支出就不渲染那一行 <text>。
   *   .day-cell 是 justify-content: center，内容矮一点就整体偏下一点 ——
   *   于是「只有支出」的日期和「支出+收入」的日期，圆块不在同一水平线上。
   *   修法：两个槽位永远渲染，没值时留空但不删元素（visibility: hidden）。
   */
  const cal = read('components/CalendarGrid.vue')
  const RE_TPL = new RegExp(String.raw`<template>([\s\S]*)<\/template>`)
  const calTpl = (cal.match(RE_TPL) || [])[1] || ''
  const RE_STYLE = new RegExp(String.raw`<style[^>]*>([\s\S]*)<\/style>`)
  const calStyle = (cal.match(RE_STYLE) || [])[1] || ''

  // 两个金额槽位不能再用 v-if（否则高度会变）
  check('支出槽位不再用 v-if', /v-if="[^"]*dayData.expense/.test(calTpl), false)
  check('收入槽位不再用 v-if', /v-if="[^"]*dayData.income/.test(calTpl), false)
  check('支出槽位改用 is-blank 类控制显隐', new RegExp(String.raw`day-expense[\s\S]{0,200}?is-blank`).test(calTpl), true)
  check('收入槽位改用 is-blank 类控制显隐', new RegExp(String.raw`day-income[\s\S]{0,200}?is-blank`).test(calTpl), true)

  // 空槽位要占位而不是消失
  check('空槽位用 visibility: hidden（保留盒子尺寸）', /.day-amount.is-blank {[^}]*visibility: hidden/.test(calStyle), true)
  check('空槽位没用 display: none（那就不占位了）', /.day-amount.is-blank {[^}]*display: none/.test(calStyle), false)

  // 金额定高 + 居中，横向对齐
  check('金额行定高', /.day-amount {[^}]*height: 20rpx/.test(calStyle), true)
  check('金额行占满格宽', /.day-amount {[^}]*width: 100%/.test(calStyle), true)
  check('金额行水平居中', /.day-amount {[^}]*text-align: center/.test(calStyle), true)

  // 色块与金额之间留一丝距离
  check('色块下方留了间距', /.day-inner {[^}]*margin-bottom: 4rpx/.test(calStyle), true)
  check('间距不是加在金额上（会变成两段）', /.day-amount {[^}]*margin-top/.test(calStyle), false)
}

console.log('=== 5c. 暗色下小标题栏不再带主题色 ===')

{
  /*
   * ★ 用户本轮第 3 条 ★
   *   「我不希望在『借入借出』这个名字背后，或者说报销单头部金额这个位置，
   *   在深色状态下也显示这个渐变色；我之前让你跟他和下面的颜色稍微区分开，
   *   我指的是在暗色模式下，你可以比如说让它稍微变灰一点」
   *
   * ★ 旧值为什么不对 ★
   *   mixHex('#2C2C2E', p.primary, 0.16) —— 卡片次层色混 16% 主题色。
   *   绿主题下发绿、蓝主题下发蓝，用户要的只是「稍微变灰一点」。
   */
  const theme = read('utils/theme.js')
  check('暗色小标题栏是纯色（不是渐变）', new RegExp(String.raw`'--app-subhead-bg': '#2C2C2E'`).test(theme), true)
  check('暗色小标题栏比明细底色亮一档', new RegExp(String.raw`'--app-card': '#1C1C1E'`).test(theme), true)
  check('浅色小标题栏仍是渐变', /--app-subhead-bg': `linear-gradient/.test(theme), true)
  check('暗色 hero-soft 不再混主题色', new RegExp(String.raw`--app-hero-soft-from': mixHex\('#2C2C2E'`).test(theme), false)

  /*
   * 浅色不受影响：那里本来就该是「白底泛一点主题色」，
   * 用户只提了暗色模式的问题。
   */
  check('浅色 hero-soft 仍然混主题色', new RegExp(String.raw`--app-hero-soft-from': mixHex\('#FFFFFF', p\.primary, 0\.08\)`).test(theme), true)

  // 两个使用点都要还在（别把渐变整个删掉，用户要的是「变灰」不是「去掉」）
  check('借入借出小标题栏走新变量', new RegExp(String.raw`var\(--app-subhead-bg\)`).test(read('pages/loan/manage.vue')), true)
  check('借入借出小标题栏不再写死渐变色', new RegExp(String.raw`gradient\(135deg, var\(--app-hero-soft-from\)`).test(read('pages/loan/manage.vue')), false)
  check('报销单卡头走新变量', new RegExp(String.raw`var\(--app-subhead-bg\)`).test(read('pages/loan/reimburse.vue')), true)
  check('报销单卡头不再写死渐变色', new RegExp(String.raw`gradient\(135deg, var\(--app-hero-soft-from\)`).test(read('pages/loan/reimburse.vue')), false)
}

console.log('=== 5d. 记账面板标签格文案 ===')

{
  /*
   * ★ 用户明确要求 ★
   *   「如果选择一个，就显示标签名，显示不下就用省略号；
   *   选择两个及以上的时候，显示『已选择两项』」。
   *
   * ★ 为什么不是「显示选中的两个标签」★
   *   上一版拼成「标签A、标签B」，但标签名长短不一，
   *   两个四字标签就把那一行挤满截断；
   *   而且选三个时只显示两个名字，用户会以为只选了两个。
   *
   * ★ 这里用 includes() 而不是正则 ★
   *   这些断言要查的字符串里全是括号、方括号、竖线、花括号，
   *   写成正则每次都要数一层转义，已经在这里翻车过。
   *   纯文本查找直接、不会错。
   */
  const panel = read('components/TxnPanel.vue')
  check('标签格用 selectedTagDisplay', panel.includes("selectedTagDisplay || '请选择'"), true)
  check('selectedTagDisplay 是 computed', panel.includes('const selectedTagDisplay = computed('), true)
  check('单个标签直接显示名字', panel.includes('if (list.length === 1) return list[0].name'), true)
  check('多个标签显示「已选择N项」', panel.includes('已选择${nText}项'), true)
  check('用中文数字', panel.includes("['零', '一', '两'"), true)
  check('已暴露到模板作用域', panel.includes('selectedTagDisplay,'), true)
  check('名字用省略号截断', panel.includes('text-overflow: ellipsis'), true)
}


console.log('=== 5e. 回到本月按钮的位置 ===')

{
  /*
   * ★ 用户纠正过一次 ★
   *   我先做成了「月历正中间浮一个」，用户说：
   *   「我指的不是在日历正中间掐一个『回到本月』，
   *   而是在年月显示和左右切换的中间加一个『回到本月』」。
   *
   *   → 它属于月份导航那一行，不属于月历格子。
   */
  const idxPage = read('pages/index/index.vue')
  check('按钮在月份导航行里', idxPage.includes('class="ov-month-left"'), true)
  check('按钮不再包在月历外面', idxPage.includes('class="cal-wrap"'), false)
  check('月历居中按钮已删除', idxPage.includes('cal-back-today'), false)
  check('非本月才显示', idxPage.includes('v-if="!isCurrentMonth"'), true)
  check('按钮在箭头前面（源码顺序）',
    idxPage.indexOf('class="ov-month-today"') < idxPage.indexOf('class="ov-month-btns"'), true)
  check('文案是「回到本月」', idxPage.includes('回到本月'), true)
  check('点击调 backToCurrentMonth', idxPage.includes('@click="backToCurrentMonth"'), true)
  check('左侧分组用 gap 紧挨排列', idxPage.includes('.ov-month-left {'), true)
  check('左侧分组有 gap: 12rpx', idxPage.includes('gap: 12rpx'), true)
}

console.log('=== 5f. 筛选条第二轮变矮 ===')

{
  /*
   * ★ 用户原话 ★
   *   「我并没有觉得你把『年月日筛选』和『自定义筛选』这个 tab 切换栏
   *   及下面的组件的高度缩短了，你缩短一点，
   *   我感觉它在全部交易页面和这个统计页面占的位置有点多了」。
   *
   *   上一版 72 → 60 用户没看出来。这一轮：
   *     · 下面两行 60 → 52rpx
   *     · tab 格子 62 → 42rpx（+ 底槽 10rpx = 52rpx，正好与下面等高）
   *     · tab 字号 26 → 24rpx
   */
  const drp = read('components/DateRangePicker.vue')
  const bar2 = read('components/DateFilterBar.vue')
  const appCss = read('App.vue')

  check('下面两行是 52rpx', drp.includes('height: 52rpx;'), true)
  check('自定义行也是 52rpx', bar2.includes('height: 52rpx;'), true)
  check('tab 格子是 42rpx', appCss.includes('height: 42rpx;'), true)
  check('tab 行高与格子同值', appCss.includes('line-height: 42rpx;'), true)
  check('tab 字号收到 24rpx', appCss.includes('font-size: 24rpx;'), true)
}

console.log('=== 5g. AI 记账草稿保留 ===')

{
  /*
   * ★ 用户原话 ★
   *   「我希望在我 AI 记账的时候，我不小心退出这个输入框，
   *   再次点进去时，我输入的东西能保留」。
   *
   * ★ 关键约束 ★
   *   close() 不能清草稿（误关要能接着写），
   *   但提交成功后必须清（否则手一抖重复记账）。
   */
  const qa = read('components/QuickAddBar.vue')
  const closeStart = qa.indexOf('function close() {')
  const closeBody = qa.slice(closeStart, closeStart + 3000)

  check('close() 不再清空草稿', closeBody.includes("draft.value = ''"), false)
  check('close() 仍清待报销', closeBody.includes('pendingReimburse.value = false'), true)
  check('close() 仍清不计预算', closeBody.includes('excludeBudget.value = false'), true)
  check('提交成功后清草稿', qa.includes('if (failures.length === 0 && rateErrors.length === 0) {'), true)
  check('草稿清空只出现一次', (qa.match(/draft\.value = ''/g) || []).length, 1)
}


console.log('=== 5h. 首页流水显示时间 ===')

{
  /*
   * ★ 用户原话 ★
   *   「首页流水也要跟其他页面的流水一样，在价钱下面显示时间」。
   *
   * ★ 为什么原来没有 ★
   *   首页按日期分组、分组头已写「今天 / 昨天 / 10月3日」，
   *   当时判断时间重复。但其他页面（全部交易 / 账户详情…）
   *   都在金额下面带 HH:mm —— 同一笔账两个页面长得不一样。
   */
  const idxPage = read('pages/index/index.vue')
  check('首页金额块里有时间行', idxPage.includes('<text class="txn-time">{{ timeLabel(txn.occurred_at) }}</text>'), true)
  check('timeLabel 已定义', idxPage.includes('function timeLabel(ts) {'), true)
  check('timeLabel 已暴露到模板', idxPage.includes('txnBadges, timeLabel,'), true)
  check('导入了 formatTime', idxPage.includes('relativeDayLabel, formatTime'), true)
  check('时间字号 20rpx（与全部交易页一致）', idxPage.includes('.txn-time {'), true)
}

console.log('=== 5i. 借款/报销页日期带年份 ===')

{
  /*
   * ★ 用户原话 ★
   *   「在借出借入报销页面的交易中，账户后面只显示日期，格式为年/月/日」。
   */
  const datejs = read('utils/date.js')
  check('新增 shortDateWithYear', datejs.includes('export function shortDateWithYear(ts)'), true)
  check('格式是年/月/日', datejs.includes('${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}'), true)

  for (const f of ['pages/loan/manage.vue', 'pages/loan/reimburse.vue']) {
    const src = read(f)
    check(`${f} 用带年份版`, src.includes('shortDateWithYear(t.occurred_at)'), true)
    check(`${f} 不再用无年份版`, /[^h]shortDate(t.occurred_at)/.test(src), false)
    check(`${f} 副标题里不再有时间`, /formatTime(t.occurred_at)/.test(src), false)
  }
}

console.log('=== 5j. 流水行更紧凑 ===')

{
  /*
   * ★ 用户原话 ★
   *   「我希望各个页面的流水都能够显示得紧凑一点，但是不要改变现有的布局」。
   *
   * ★ 只改内边距和间距，不动字号与图标尺寸 ★
   *   字号一变，整个页面的字号层级（分组头 30 / 正文 28 / 副标题 22）
   *   就得重排，那就是「改布局」了。图标直径决定左侧栏宽度，同理。
   */
  const pages = [
    ['pages/index/index.vue', '18rpx 24rpx'],
    ['pages/txn/list.vue', '18rpx 24rpx'],
    ['components/RecentTxnList.vue', '18rpx 24rpx'],
    ['pages/loan/manage.vue', '16rpx 24rpx'],
    ['pages/loan/reimburse.vue', '16rpx 24rpx']
  ]
  for (const [f, pad] of pages) {
    const src = read(f)
    check(`${f} 用紧凑内边距`, src.includes(pad), true)
    check(`${f} 不再用 24rpx 上下内边距`, src.includes('padding: 24rpx 28rpx'), false)
  }

  // 字号与图标尺寸不能被改动（否则就是改布局了）
  const idxP = read('pages/index/index.vue')
  check('首页流水名字仍是 28rpx', idxP.includes('font-size: 28rpx;'), true)
  check('首页流水图标仍是 76rpx', idxP.includes('width: 76rpx;'), true)
}


console.log('=== 5k. 账户选择弹层 ===')

{
  /*
   * ★ 用户原话 ★
   *   「现在只重写一下这个账户选择的面板，单选，显示图标和金额，用在：
   *   1. 筛选面板的账户选择 2. 记账面板的账户选择 3. 报销弹层的账户选择」
   *
   * ★ 为什么原来的不统一 ★
   *   三处都用 wd-action-sheet，它是组件库的系统控件：
   *   行内只有 name + subname 纯文字，**没有图标**；
   *   行高、字号、底部按钮全是库自己的，和 App 其它弹层不是一套。
   *   而账户在 App 里是有视觉身份的（账户页/流水行都是
   *   「圆角方框 + 账户色浅底 + 图标」），选择器里只剩名字。
   */
  const sheet = read('components/AccountPickerSheet.vue')

  check('组件存在且名字正确', sheet.includes("name: 'AccountPickerSheet'"), true)
  check('是单选（没有 multiple 开关）', sheet.includes('multiple'), false)
  check('每行渲染 AccountIcon', sheet.includes('<AccountIcon'), true)
  check('金额走 MoneyText（全 App 统一规则）', sheet.includes('<MoneyText'), true)
  check('余额按 balance 变体着色', sheet.includes('variant="balance"'), true)
  check('不计入资产的账户用浅灰', sheet.includes(':muted="!acc.include_in_total"'), true)
  check('选中值打对勾', sheet.includes('acc-tick'), true)
  check('对勾不画方框（方框会被误读成多选）', sheet.includes('acc-box'), false)
  check('事件名用 picked（不撞原生 select）', sheet.includes("emits: ['update:modelValue', 'picked']"), true)
  check('接入弹层栈', sheet.includes('pushLayer'), true)
  check('层级默认 120（要盖住筛选面板 100）', sheet.includes('zIndex: { type: Number, default: 120 }'), true)

  // 三处接线
  const listPage = read('pages/txn/list.vue')
  check('筛选面板用它', listPage.includes('<AccountPickerSheet'), true)
  check('筛选面板传 filterAccountList', listPage.includes(':accounts="filterAccountList"'), true)
  check('筛选账户排除组合账户', listPage.includes('accountStore.list.filter((a) => !a.isCombo)'), true)

  const panel = read('components/TxnPanel.vue')
  check('记账面板源账户用它', panel.includes(':accounts="sourceAccountList"'), true)
  check('记账面板转入账户用它', panel.includes(':accounts="toAccountList"'), true)
  check('记账面板不再用 wd-action-sheet 选账户', panel.includes(':actions="accountActions"'), false)

  const reimburse = read('pages/loan/reimburse.vue')
  check('报销弹层用它', reimburse.includes('<AccountPickerSheet'), true)
  check('报销到账账户排除组合', reimburse.includes('reimburseAccountList'), true)
  check('报销不再用 wd-action-sheet 选账户', reimburse.includes(':actions="accountActions"'), false)
  check('报销弹层层级高于自身（100）', reimburse.includes(':z-index="200"'), true)

  const cycle = read('components/CyclePanel.vue')
  check('周期面板源账户用它', cycle.includes(':accounts="sourceAccountList"'), true)
  check('周期面板转入账户用它', cycle.includes(':accounts="toAccountList"'), true)
  check('周期面板不再用 wd-action-sheet 选账户', cycle.includes(':actions="accountActions"'), false)

  // ★ 「全部账户」只在筛选面板启用 ★
  check('筛选面板启用全部', listPage.includes('allow-all'), true)
  check('记账面板不启用全部', panel.includes('allow-all'), false)
  check('报销弹层不启用全部', reimburse.includes('allow-all'), false)
  check('周期面板不启用全部', cycle.includes('allow-all'), false)
}


console.log('=== 6. 自定义筛选：区间选择 + 能选中 ===')

{
  /*
   * ★ 用户原话两条 ★
   *   「在自定义筛选左边，无法选中『自定义』这一栏」
   *   「选择自定义的时候，它是手动选择了两个日期；我希望像订酒店那样，
   *   它是选择一个区间的起末」
   */
  const bar = read('components/DateFilterBar.vue')
  check('用区间日历 type="daterange"', /type="daterange"/.test(bar), true)
  check('只有一个日历实例', (bar.match(/<wd-calendar/g) || []).length, 1)
  check('选「自定义」会弹出日历', /preset\.key === 'custom'\) \{\s*openCalendar\(\)/.test(bar), true)
  check('区间回传取两端', /arr\[0\][\s\S]{0,120}?arr\[1\]/.test(bar), true)
  check('区间不完整不提交', /if \(arr\.length < 2/.test(bar), true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
