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

/* ------------------------------------------- 4. 标签是纯文字 */

check('模板里没有 tag-mini 块', /class="tag-mini"/.test(template), false)
check('样式里没有 .tag-mini 规则', /\.tag-mini/.test(style), false)
check('标签用的是纯文字样式', /\.txn-tags\s*\{/.test(style), true)

/* ------------------------- 5. 标签文字样式不能带背景块 / 边框 */

// 取出 .txn-tags 的样式块
const tagStyle = (style.match(/\.txn-tags\s*\{([^}]*)\}/) || [])[1] || ''
check('标签没有背景色', /background/.test(tagStyle), false)
check('标签没有边框', /border/.test(tagStyle), false)
check('标签字号 22rpx', /font-size:\s*22rpx/.test(tagStyle), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
