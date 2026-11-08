/**
 * 「全部交易」页筛选面板的形态检查
 *
 *   node scripts/test-txn-list-panel.mjs
 *
 * 背景（用户反馈）
 *   6. 筛选面板全部变成下拉框的形式，不然显得很拥挤；
 *   7. 标签直接显示标签名字即可，而且目前看起来标签显示的高度略高。
 *
 * 这些是「形态」要求，编译期和运行时都查不出来，
 * 所以做成一个静态检查脚本，防止以后改样式时又退回 chip。
 *
 * 检查项：
 *   1. 筛选面板里不能再有 chip（胶囊按钮）布局
 *   2. 账户 / 分类 / 标签 这几项必须都是「下拉行」
 *      （分类原来是「一级 + 二级」两行，v1.18.0 起合成一行多选，见第 3.1 节）
 *   3. 四个下拉必须共用同一个 wd-action-sheet
 *   4. 列表行的标签必须是纯文字（不能有背景块样式）
 *   5. 标签文字样式里不能有 background-color / border
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const FILE = join(ROOT, 'pages', 'txn', 'list.vue')

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

const code = readFileSync(FILE, 'utf-8')

const template = (code.match(/<template>([\s\S]*)<\/template>/) || [])[1] || ''
const style = (code.match(/<style[^>]*>([\s\S]*)<\/style>/) || [])[1] || ''

/* ------------------------------------------- 1. 不再有 chip 布局 */

check('模板里没有 chip 类名', /class="[^"]*\bchip\b/.test(template), false)
check('样式里没有 .chip 规则', /\.chip[\s-]/.test(style), false)
check('样式里没有 .chip-wrap 规则', /\.chip-wrap/.test(style), false)
check('样式里没有 .chip-sub 规则', /\.chip-sub/.test(style), false)

/* ------------------------------------ 2. 每项都是「下拉行」 */

/*
 * ★ 分类从「一级 + 二级」两级联动单选改成单行多选 ★
 *   用户要求「筛选时删除单选的一级和二级分类，同时其他页面跳转过来的效果
 *   保持不变（也就是修改为使用多选分类的逻辑实现）」。
 *   所以这里不再有「二级分类」这一行，分类只剩一行，点开是多选弹层
 *   （见下方第 3 节与 3.1 节）。
 */
for (const label of ['账户', '分类', '标签']) {
  check(`「${label}」是下拉行`, template.includes(`>${label}</text>`), true)
}
check('不再有「二级分类」筛选行', template.includes('>二级分类</text>'), false)
check('分类行点开的是多选弹层', /class="filter-row" @click="openMultiCatPicker"/.test(template), true)

check('下拉行有左标签样式', /\.filter-row-label\s*\{/.test(style), true)
check('下拉行有右侧当前值样式', /\.filter-row-value\s*\{/.test(style), true)
check('下拉行有箭头样式', /\.filter-row-arrow\s*\{/.test(style), true)
check('有占位文案样式', /\.filter-row-value\.placeholder\s*\{/.test(style), true)

/* -------------------------------- 3. 四个下拉共用一个 wd-action-sheet */

const actionSheets = (template.match(/<wd-action-sheet/g) || []).length
check('只有一个 wd-action-sheet', actionSheets, 1)
check('选项表由 pickerActions 驱动', template.includes(':actions="pickerActions"'), true)
/*
 * 分类不再走 action-sheet（改成多选弹层），所以下拉只剩账户 / 标签 / 周期。
 * 数量从 5 变 3 是有意的，不是漏改。
 */
check('剩余下拉都有 openPicker 调用', (template.match(/openPicker\('/g) || []).length, 3)
check('pickerKind 区分下拉类别', (code.match(/kind === '(account|tag|cycle)'/g) || []).length >= 3, true)

/* ------------------------- 3.1 分类：单行多选弹层（v1.18.0 改） */

/*
 * ★ 为什么分类必须能多选 ★
 *   预算页的一条子预算可以挂多个类别，点「全部交易」跳过来时
 *   带的是 categoryIds（一组），单选装不下 —— 用户再点一次分类
 *   就会把整组条件覆盖掉，看到的流水比预算页算的少。
 */
check('用了多选弹层组件', /<CategoryMultiPickerSheet/.test(template), true)
check('多选弹层接 filter.categoryIds', /:selected-ids="filter.categoryIds"/.test(template), true)
check(
  '其他页面跳转的分类条件也走多选（URL 换算）',
  /function normalizeUrlCategory\(includeSub\)/.test(code),
  true
)
check(
  '一级分类按整支展开成二级',
  /function expandCategoryIds\(ids\)/.test(code) && /kids\.length === 0\) \{[\s\S]{0,40}?push\(id\)/.test(code),
  true
)
check(
  '查询统一拼 categoryIds',
  /q\.categoryIds = pickedCats\.join\(','\)/.test(code),
  true
)
// 旧的两级联动字段必须彻底撤掉
check('filter 里没有 parentCategoryId', /parentCategoryId:/.test(code), false)
check('filter 里没有 categoryId 单值字段', /^\s+categoryId: '',/m.test(code), false)
check('没有 includeSubcategories 状态', /includeSubcategories:/.test(code), false)

/* ------------------------------------------- 4. 标签是小 tag 胶囊 */

/**
 * ★ 形态要求（用户反馈「标签还是要 tag，跟在分类后，
 *   高度小一点，不要显示"1个标签"，要显示具体的标签名」）★
 *   - 必须是小 tag 胶囊（有淡背景 + 小圆角），不能是纯裸文字；
 *   - 高度要小：上下 padding 2rpx、字号 20rpx，整行不超过 28rpx；
 *   - 显示标签名字本身，不显示「N 个标签」这种计数；
 *   - 位置：跟在分类名（txnTitle）那一行后面，不在备注行。
 */
check('模板里没有 tag-mini 块', /class="tag-mini"/.test(template), false)
check('样式里没有 .tag-mini 规则', /\.tag-mini/.test(style), false)
check('标签用 .txn-tag 小胶囊', /\.txn-tag\s*\{/.test(style), true)
check('标签列表容器用 .txn-tag-list', /\.txn-tag-list\s*\{/.test(style), true)

// 标签字号与内边距：保证高度小
/*
 * ★ 具体数值变了，但「高度要小」这条要求没变 ★
 *   以前是 font-size 20rpx + padding 2rpx + line-height 20rpx（整行 24rpx）。
 *   后来把「周期 / 组合账户 / 标签」统一成同一种描边胶囊（.txn-tag），
 *   为了三种徽标看起来一样高，改成 font-size 18rpx + padding 4rpx +
 *   line-height 1（整行约 26rpx）—— 依然远小于 28rpx 的上限。
 *
 *   所以这里不再写死 20rpx，而是断言「字号不超过 20rpx、
 *   上下 padding 不超过 4rpx、没有撑高的写法」，
 *   这样只要还在「小胶囊」这个量级就不会误报，
 *   真有人把它调大（比如 font-size: 24rpx）依然能拦住。
 */
const tagStyle = (style.match(/\.txn-tag\s*\{([^}]*)\}/) || [])[1] || ''
const tagFontSize = Number((tagStyle.match(/font-size:\s*(\d+)rpx/) || [])[1]) || 0
const tagPadTop = Number((tagStyle.match(/padding:\s*(\d+)rpx/) || [])[1]) || 0
check('标签字号不超过 20rpx（保持小胶囊）', tagFontSize > 0 && tagFontSize <= 20, true)
check('标签上下 padding 不超过 4rpx', tagPadTop > 0 && tagPadTop <= 4, true)
check('标签有淡背景', /background-color/.test(tagStyle), true)
check('标签文字用 --app-text-2', /var\(--app-text-2\)/.test(tagStyle), true)

// 高度：line-height: 1（相对字号）+ 上下 padding 各 4rpx ≈ 26rpx，不超过 28rpx
const lineHeight = (tagStyle.match(/line-height:\s*(\d+)/) || [])[1]
check('标签行高不撑高（line-height 1）', lineHeight, '1')

/* ------------------------------------------- 5. 标签在分类名那一行 */

/*
 * ★ 位置：「跟在分类名后面」而不是「同一行」★
 *   用户原话是「标签还是要 tag，跟在分类后」。
 *   实测把胶囊塞进 .txn-name-row（和分类名同一行）时，
 *   分类名一长两样东西就会互相挤（分类名被 ellipsis 切掉、
 *   或者胶囊被顶到行尾换行），读起来很乱。
 *
 *   现在的做法是：分类名单独一行（.txn-name-row），
 *   徽标紧跟在它**下面**一行（.txn-tag-list），
 *   视觉上依然是「跟在分类名后面」，但不会被挤变形。
 *
 *   所以断言改成：徽标列表紧跟在 .txn-name-row 之后、
 *   且在备注行（.txn-sub）之前 —— 位置语义不变。
 */
check('徽标列表紧跟分类名之后', /<\/view>\s*<!--[^>]*-->\s*<view v-if="txnBadges\(txn\)\.length" class="txn-tag-list"/.test(template) || /txn-name-row[\s\S]{0,400}?txn-tag-list/.test(template), true)
check('徽标在备注行之前（不在备注行里）', /txn-tag-list[\s\S]{0,500}?class="txn-sub/.test(template), true)
check('标签不在备注行', /txn-sub-row/.test(template), false)
check('不再有 .txn-tags 纯文字样式', /\.txn-tags\s*\{/.test(style), false)

/* ------------------------------- 6. 不能出现「N 个标签」这种计数 */

// 去掉注释后再找计数文案（注释里提到「N 个标签」是允许的）
const codeNoComment = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
check('代码里没有「个标签」计数文案', /个标签/.test(codeNoComment), false)

/* ------------------------- 7. 标签用「自己的颜色」做背景 */

/**
 * ★ 用户反馈「标签的颜色作为 tag 背景颜色」★
 *   标签表有 color 字段（api/tag.js / tag 表）。
 *   每个标签的背景要用它自己的颜色，文字用标签本色。
 *   背景只用约 12% 透明度（颜色 + '22'），
 *   纯色背景配中文名太刺眼、可读性也差。
 *
 * ★ v13 起三种徽标统一走 txnBadges ★
 *   周期徽标和组合账户徽标没有用户指定的颜色，
 *   所以它们的 bg 用主题色 / 固定紫 + '22'，
 *   用户标签仍然用标签自己的颜色。
 */
check('标签背景用标签自己的颜色（内联样式）', /backgroundColor:\s*t\.bg/.test(template), true)
check('标签文字用标签本色（内联样式）', /color:\s*t\.color/.test(template), true)
/*
 * ★ 徽标构建已抽到 utils/txnBadges.js（用户第 1 条）★
 *   以前这些断言直接看 list.vue 的 txnBadges() 源码；
 *   现在顺序与颜色规则都在 utils/txnBadges.js 里，五个页面共用一份 ——
 *   断言跟着挪到那个文件，否则每次重构都会被「源码变了」这种假失败挡住。
 */
const BADGE_FILE = join(ROOT, 'utils', 'txnBadges.js')
const badgeCode = readFileSync(BADGE_FILE, 'utf-8')

check('徽标工厂返回带 color 的对象', /color:\s*tg\.color/.test(badgeCode), true)
check('背景色带 12% 透明度后缀', /\$\{color\}22/.test(badgeCode), true)
/*
 * 兜底：标签没设颜色时，bg 回落到 CSS 里的 --app-card-2。
 * 空串会让内联 backgroundColor 变成无效值，
 * 内联样式优先级高于 CSS，反而把 .txn-tag 的淡背景弄没了。
 */
check(
  '无颜色时 bg 有兜底（--app-card-2）',
  /bg:\s*'var\(--app-card-2\)'/.test(badgeCode),
  true
)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
