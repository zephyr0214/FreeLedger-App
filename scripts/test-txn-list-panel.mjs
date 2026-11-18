/**
 * 「全部交易」筛选面板 + 标签徽标形态检查
 *
 *   node scripts/test-txn-list-panel.mjs
 *
 * ★ 本轮结构调整 ★
 *   筛选面板从 pages/txn/list.vue 抽到了 components/TxnFilterSheet.vue，
 *   统计页的「更多筛选」复用同一份。断言因此分两处读：
 *     · 筛选面板形态 → 组件
 *     · 筛选条件生成 → utils/txnFilter.js（纯函数直接测）
 *     · 列表行的标签徽标 → 页面
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  createEmptyTxnFilter, countActiveFilters, expandCategoryIds, buildTxnFilterQuery
} from '../utils/txnFilter.js'

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

const listCode = read('pages/txn/list.vue')
const filterCode = read('components/TxnFilterSheet.vue')
const statsCode = read('pages/stats/index.vue')

const listTemplate = (listCode.match(/<template>([\s\S]*)<\/template>/) || [])[1] || ''
const listStyle = (listCode.match(/<style[^>]*>([\s\S]*)<\/style>/) || [])[1] || ''
const filterTemplate = (filterCode.match(/<template>([\s\S]*)<\/template>/) || [])[1] || ''
const filterStyle = (filterCode.match(/<style[^>]*>([\s\S]*)<\/style>/) || [])[1] || ''

/* ------------------------------------------- 1. 不再有 chip 布局 */

check('筛选面板没有 chip 类名', /class="[^"]*\bchip\b/.test(filterTemplate), false)
check('筛选面板样式没有 .chip 规则', /\.chip[\s-]/.test(filterStyle), false)

/* ------------------------------------ 2. 每项都是「下拉行」 */

for (const label of ['账户', '分类', '标签', '周期']) {
  check(`「${label}」是下拉行`, filterTemplate.includes(`>${label}</text>`), true)
}
check('不再有「二级分类」筛选行', filterTemplate.includes('>二级分类</text>'), false)
check('分类行点开的是多选弹层', /@click="openMultiCatPicker"/.test(filterTemplate), true)

check('下拉行有左标签样式', /\.filter-row-label\s*\{/.test(filterStyle), true)
check('下拉行有右侧当前值样式', /\.filter-row-value\s*\{/.test(filterStyle), true)
check('下拉行有箭头样式', /\.filter-row-arrow\s*\{/.test(filterStyle), true)
check('有占位文案样式', /\.filter-row-value\.placeholder\s*\{/.test(filterStyle), true)

/* -------------------------------- 3. 子弹层复用 */

check('只有一个 wd-action-sheet', (filterTemplate.match(/<wd-action-sheet/g) || []).length, 1)
check('选项表由 pickerActions 驱动', filterTemplate.includes(':actions="pickerActions"'), true)
check('标签筛选用 TxnTagSheet', /<TxnTagSheet/.test(filterTemplate), true)
check('账户筛选用自绘面板', /<AccountPickerSheet/.test(filterTemplate), true)
check('用了分类多选弹层', /<CategoryMultiPickerSheet/.test(filterTemplate), true)
check('分类多选接 draft.categoryIds', /:selected-ids="draft\.categoryIds"/.test(filterTemplate), true)

/* ------------------------- 3.1 分类展开与查询生成 */

const categories = [
  { id: 'food', parent_id: '', name: '餐饮食品' },
  { id: 'lunch', parent_id: 'food', name: '午餐' },
  { id: 'dinner', parent_id: 'food', name: '晚餐' },
  { id: 'fun', parent_id: '', name: '娱乐' }
]

check('一级分类展开为自己 + 所有二级', expandCategoryIds(['food'], categories), ['food', 'lunch', 'dinner'])
check('没有二级的一级分类保持原样', expandCategoryIds(['fun'], categories), ['fun'])
check('重复 id 去重', expandCategoryIds(['food', 'lunch'], categories), ['food', 'lunch', 'dinner'])

const filter = createEmptyTxnFilter()
filter.accountId = 'acc_1'
filter.categoryIds = ['food']
filter.tagIds = ['tag_1', 'tag_2']
filter.cycleId = 'cyc_1'
filter.keyword = '午饭'
filter.minYuan = '10'
filter.maxYuan = '100'

const q = buildTxnFilterQuery(filter, categories)
check('账户条件', q.accountId, 'acc_1')
check('分类条件已展开', q.categoryIds, ['food', 'lunch', 'dinner'])
check('标签条件', q.tagIds, ['tag_1', 'tag_2'])
check('周期条件', q.cycleId, 'cyc_1')
check('关键词条件', q.keyword, '午饭')
check('最小金额换算成分', q.minCents, 1000)
check('最大金额换算成分', q.maxCents, 10000)
check('条件计数（金额区间算一项）', countActiveFilters(filter), 6)

check('全部交易页用共享筛选组件', /<TxnFilterSheet/.test(listTemplate), true)
check('全部交易页用共享查询生成', /buildTxnFilterQuery\(appliedFilter/.test(listCode), true)
check('统计页复用同一个筛选面板', /<TxnFilterSheet/.test(statsCode), true)
check('统计页隐藏全局类型行', /:show-type="false"/.test(statsCode), true)
check('统计页筛选层级高于底栏', /:z-index="500"/.test(statsCode), true)

const statsApi = read('api/stats.js')
check('统计 API 复用 buildFilterWhere', /buildFilterWhere/.test(statsApi), true)
check('rangeScope 透传筛选字段', /const built = buildFilterWhere\(r\)/.test(statsApi), true)
check('同比环比也带筛选', /rangeScope\(\{ \.\.\.range, startDay, endDay, monthKey: '' \}\)/.test(statsApi), true)
check('预算执行不跟随筛选', /getBudgetExecution\(\{\s*startDay: r\.startDay, endDay: r\.endDay, monthKey: r\.monthKey\s*\}\)/.test(statsCode), true)

/* ------------------------- 3.2 分类 emoji 图标选择页保留旧断言 */

check('多选分类弹层有全选入口', /toggleGroup\(g\)/.test(read('components/CategoryMultiPickerSheet.vue')), true)

/* ------------------------------------------- 4. 标签是小 tag 胶囊 */

check('列表模板里没有 tag-mini 块', /class="tag-mini"/.test(listTemplate), false)
check('列表样式里没有 .tag-mini 规则', /\.tag-mini/.test(listStyle), false)
check('标签用 .txn-tag 小胶囊', /\.txn-tag\s*\{/.test(listStyle), true)
check('标签列表容器用 .txn-tag-list', /\.txn-tag-list\s*\{/.test(listStyle), true)

const tagStyle = (listStyle.match(/\.txn-tag\s*\{([^}]*)\}/) || [])[1] || ''
const tagFontSize = Number((tagStyle.match(/font-size:\s*(\d+)rpx/) || [])[1]) || 0
const tagPadTop = Number((tagStyle.match(/padding:\s*(\d+)rpx/) || [])[1]) || 0
check('标签字号不超过 20rpx（保持小胶囊）', tagFontSize > 0 && tagFontSize <= 20, true)
check('标签上下 padding 不超过 4rpx', tagPadTop > 0 && tagPadTop <= 4, true)
check('标签有淡背景', /background-color/.test(tagStyle), true)
check('标签文字用 --app-text-2', /var\(--app-text-2\)/.test(tagStyle), true)

const lineHeight = (tagStyle.match(/line-height:\s*(\d+)/) || [])[1]
check('标签行高不撑高（line-height 1）', lineHeight, '1')

/* ------------------------------------------- 5. 标签在分类名下面 */

check('徽标列表紧跟分类名之后', /txn-name-row[\s\S]{0,400}?txn-tag-list/.test(listTemplate), true)
check('徽标在备注行之前（不在备注行里）', /txn-tag-list[\s\S]{0,500}?class="txn-sub/.test(listTemplate), true)
check('标签不在备注行', /txn-sub-row/.test(listTemplate), false)
check('不再有 .txn-tags 纯文字样式', /\.txn-tags\s*\{/.test(listStyle), false)

/* ------------------------------------------- 6. 筛选文案 */

check('筛选面板有「已选中 N 个标签」文案', /个标签/.test(filterCode), true)
check('只选一个时显示标签名', /ids\.length === 1[\s\S]{0,160}?return t \? t\.name/.test(filterCode), true)

/* ------------------------- 7. 标签用「自己的颜色」做背景 */

const BADGE_FILE = join(ROOT, 'utils', 'txnBadges.js')
const badgeCode = readFileSync(BADGE_FILE, 'utf-8')
check('徽标工厂返回带 color 的对象', /color:\s*tg\.color/.test(badgeCode), true)
check('背景色带 12% 透明度后缀', /\$\{color\}22/.test(badgeCode), true)
check('无颜色时 bg 有兜底（--app-card-2）', /bg:\s*'var\(--app-card-2\)'/.test(badgeCode), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
