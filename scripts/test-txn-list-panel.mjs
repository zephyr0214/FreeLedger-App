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
 *   2. 账户 / 分类 / 二级分类 / 标签 四项必须都是「下拉行」
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

/* ------------------------------------ 2. 四项都是「下拉行」 */

for (const label of ['账户', '分类', '二级分类', '标签']) {
  check(`「${label}」是下拉行`, template.includes(`>${label}</text>`), true)
}

check('下拉行有左标签样式', /\.filter-row-label\s*\{/.test(style), true)
check('下拉行有右侧当前值样式', /\.filter-row-value\s*\{/.test(style), true)
check('下拉行有箭头样式', /\.filter-row-arrow\s*\{/.test(style), true)
check('有占位文案样式', /\.filter-row-value\.placeholder\s*\{/.test(style), true)

/* -------------------------------- 3. 四个下拉共用一个 wd-action-sheet */

const actionSheets = (template.match(/<wd-action-sheet/g) || []).length
check('只有一个 wd-action-sheet', actionSheets, 1)
check('选项表由 pickerActions 驱动', template.includes(':actions="pickerActions"'), true)
check('每个下拉都有 openPicker 调用', (template.match(/openPicker\('/g) || []).length, 4)
check('pickerKind 区分四类下拉', (code.match(/kind === '(account|parent|sub|tag)'/g) || []).length >= 4, true)

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
const tagStyle = (style.match(/\.txn-tag\s*\{([^}]*)\}/) || [])[1] || ''
check('标签字号 20rpx', /font-size:\s*20rpx/.test(tagStyle), true)
check('标签上下 padding 2rpx', /padding:\s*2rpx/.test(tagStyle), true)
check('标签有淡背景', /background-color/.test(tagStyle), true)
check('标签文字用 --app-text-2', /var\(--app-text-2\)/.test(tagStyle), true)

// 高度：20rpx 行高 + 上下各 2rpx = 24rpx，不超过 28rpx
const lineHeight = (tagStyle.match(/line-height:\s*(\d+)rpx/) || [])[1]
check('标签行高 20rpx', lineHeight, '20')

/* ------------------------------------------- 5. 标签在分类名那一行 */

// 模板里：txn-name 与标签必须在同一个 .txn-name-row 容器里
const nameRow = (template.match(/<view class="txn-name-row">([\s\S]*?)<\/view>/) || [])[1] || ''
check('标签在 txn-name-row 里（跟在分类名后）', /txn-tag-list/.test(nameRow), true)
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
 */
check('标签背景用标签自己的颜色（内联样式）', /backgroundColor:\s*t\.bg/.test(template), true)
check('标签文字用标签本色（内联样式）', /color:\s*t\.color/.test(template), true)
check('txnTags 返回带 color 的对象', /color:\s*t\.color\s*\|\|/.test(code), true)
check('背景色带 12% 透明度后缀', /\+\s*'22'/.test(code), true)
// 兜底：标签没设颜色时 bg 传空串，回落到 CSS 里的 --app-card-2
check('无颜色时 bg 兜底为空串', /bg:\s*t\.color\s*\?\s*t\.color\s*\+\s*'22'\s*:\s*''/.test(code), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
