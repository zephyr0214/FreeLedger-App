/**
 * 批量操作 / 右滑快捷操作 / 徽标顺序 的测试
 *
 *   node scripts/test-txn-batch-ops.mjs
 *
 * 覆盖本轮用户提的五条：
 *   1. 「不计预算」作为灰色 tag，和不计收支同级
 *   2. 筛选面板分类筛选失效（categoryIds 字符串 vs 数组）
 *   3. 记账面板选账户不该改写手动设置的默认账户
 *   4/5. 右滑快捷删除+标签、多选批量操作
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { buildTxnBadges } from '../utils/txnBadges.js'

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

const names = (t) => buildTxnBadges(t).map((b) => b.name)

console.log('=== 1.「不计预算」灰色 tag ===')

{
  /*
   * ★ 用户原话 ★
   *   「将不计预算也作为一个灰色 tag 添加到交易流水中，和不计收支同级」。
   *
   * 「同级」有两层含义，都要钉住：
   *   · 位置：跟在不计收支后面（同一段末尾）
   *   · 样式：同一个灰色，不是各用各的颜色
   */
  check('只有不计预算时显示它', names({ exclude_from_budget: 1 }), ['不计预算'])
  check('只有不计收支时显示它', names({ exclude_from_stats: 1 }), ['不计收支'])

  /*
   * ★ 两个都有时只显示「不计收支」（用户本轮要求）★
   *   用户原话：「如果这个东西显示了不是「不计收支」的 tag，
   *   那他既然就不计入预算了，就不需要两个都显示了。
   *   在这种情况下，就只显示「不计收支」。
   *   如果仅仅是不计预算的话，要显示不计预算的 tag」。
   *
   *   → 两个徽标互斥：不计收支优先，不计预算只在它单独为 1 时出现。
   */
  check(
    '两个都有时只显示不计收支',
    names({ exclude_from_stats: 1, exclude_from_budget: 1 }),
    ['不计收支']
  )
  check(
    '两个都有时不出现不计预算',
    names({ exclude_from_stats: 1, exclude_from_budget: 1 }).includes('不计预算'),
    false
  )

  const onlyStats = buildTxnBadges({ exclude_from_stats: 1 })
  check('不计收支是灰色', onlyStats[0].color, '#969799')
  const onlyBudget = buildTxnBadges({ exclude_from_budget: 1 })
  check('不计预算也是灰色', onlyBudget[0].color, '#969799')
  check('两个状态的 key 不同', onlyStats[0].key !== onlyBudget[0].key, true)

  // 都没勾时不出现
  check('两个都没勾：没有徽标', names({}), [])
}

console.log('=== 2. 筛选面板分类筛选（字符串入参）===')

{
  /*
   * import 这个模块会拉起 SQLite 链路，所以这里只做源码级断言；
   * 真正的 SQL 行为在 scripts/test-txn-filter.mjs 里用真库验证。
   */
  const api = read('api/transaction.js')
  check('buildFilterWhere 已导出（可单测）', /export function buildFilterWhere/.test(api), true)
  check(
    '同时接受数组与逗号串',
    /Array\.isArray\(categoryIds\)[\s\S]{0,120}?String\(categoryIds \|\| ''\)\.split\(','\)/.test(api),
    true
  )
  /*
   * ★ 断言「旧写法不存在」前必须剥注释 ★
   *   api/transaction.js 里专门写了一段说明「旧的这一行长什么样」，
   *   不剥注释就会把那段说明当成实现。
   */
  const apiNoComment = api
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(String.fromCharCode(10))
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join(String.fromCharCode(10))
  check(
    '旧的一行式 Array.isArray 兜底已不存在',
    /const multiCats = Array\.isArray\(categoryIds\) \? categoryIds\.filter\(Boolean\) : \[\]/.test(apiNoComment),
    false
  )
}

console.log('=== 3. 选账户不改写默认账户 ===')

{
  /*
   * ★ 用户原话 ★
   *   「修复记账面板选择账户会修改手动设置的默认账户的 bug」。
   *
   * 根因：TxnPanel / CyclePanel 保存时把 form.account_id 写回 defaultAccountId。
   * 现在只保留两处「显式设定」：账户页长按设为默认、新建第一个真实账户时自动默认。
   */
  const panel = read('components/TxnPanel.vue')
  const cycle = read('components/CyclePanel.vue')

  check('TxnPanel 不再写 defaultAccountId', /defaultAccountId: form\.account_id/.test(panel), false)
  check('CyclePanel 不再写 defaultAccountId', /defaultAccountId: form\.account_id/.test(cycle), false)
  check('TxnPanel 仍在读默认账户（初始值用）', /settings\.defaultAccountId/.test(panel), true)

  // 显式设定的两处必须还在
  const accountPage = read('pages/account/index.vue')
  check('账户页长按「设为默认」还在', /defaultAccountId: acc\.id/.test(accountPage), true)
}

console.log('=== 4/5. 右滑快捷操作 + 多选批量 ===')

{
  const index = read('pages/index/index.vue')
  const list = read('pages/txn/list.vue')
  const swipe = read('components/TxnSwipeActions.vue')
  const batchBar = read('components/TxnBatchBar.vue')
  const sheet = read('components/TxnTagSheet.vue')
  const api = read('api/transaction.js')

  // 共用组件
  check('右滑操作组件存在', /name: 'TxnSwipeActions'/.test(swipe), true)
  check('标签弹层组件存在', /name: 'TxnTagSheet'/.test(sheet), true)
  check(
    '右滑组件有「编辑 / 标签 / 删除」三个按钮',
    /swipe-btn-face--edit[\s\S]{0,300}?swipe-btn-face--tag[\s\S]{0,300}?swipe-btn-face--del/.test(swipe),
    true
  )
  check('右滑组件声明 edit 事件', /emits: \['delete', 'edit', 'tag'\]/.test(swipe), true)
  check('编辑是灰色底', /\.swipe-btn-face--edit\s*\{[^}]*background-color:\s*var\(--app-text-3\)/.test(swipe), true)
  check('标签是蓝色底', /\.swipe-btn-face--tag\s*\{[^}]*background-color:\s*#1989FA/.test(swipe), true)
  /*
   * ★ 右滑按钮要有透明缓冲（bug 修复）★
   *   wd-swipe-action 靠 translate3d(100%) + overflow:hidden 裁切，
   *   2x/3x 屏上有亚像素误差，滚动时会渗出 1px 按钮底色
   *   （用户反馈「漏出来一点黑色竖线」）。
   *   外层 padding-left: 2rpx 让最靠左那一截是透明的，误差再大也看不见。
   */
  check('右滑按钮有透明缓冲层', /\.swipe-btn\s*\{[\s\S]{0,200}?padding-left:\s*2rpx/.test(swipe), true)
  check('底色画在内层', /\.swipe-btn-face\s*\{/.test(swipe), true)

  // 首页右滑
  check('首页包了 wd-swipe-action', /<wd-swipe-action[\s\S]{0,300}?v-for="txn in group\.list"/.test(index), true)
  check('首页用共用右滑按钮', /<TxnSwipeActions/.test(index), true)
  check('首页右滑删除有确认框', /onSwipeDelete[\s\S]{0,600}?confirmDialog/.test(index), true)
  check('首页有标签弹层', /<TxnTagSheet/.test(index), true)
  check('首页右滑有编辑入口', /@edit="onSwipeEdit\(txn\)"/.test(index), true)
  check('首页编辑面板绑定 editing', /<TxnPanel[\s\S]{0,180}?:editing="panelEditing"/.test(index), true)

  // 首页多选：长按进入，底部共用批量操作条，tabbar 同时收起
  check('首页有多选模式', /const selectMode = ref\(false\)/.test(index), true)
  check('首页长按进多选', /function onRowLongPress/.test(index), true)
  check('首页多选点击切换勾选', /function onRowClick[\s\S]{0,300}?toggleSelect/.test(index), true)
  check('首页多选禁用右滑', /:disabled="selectMode"/.test(index), true)
  check('首页多选时收起 tabbar', /showQuickAdd \|\| showPanel \|\| selectMode/.test(index), true)
  check('首页使用共用批量操作条', /<TxnBatchBar/.test(index), true)
  check('首页顶部多选态显示取消', /v-if="selectMode" @action-click="exitSelectMode"/.test(index), true)

  // 全部交易页
  check('全部交易也包了右滑', /<wd-swipe-action[\s\S]{0,300}?v-for="txn in group\.list"/.test(list), true)
  check('全部交易用同一套右滑按钮', /<TxnSwipeActions/.test(list), true)
  check('全部交易有标签弹层', /<TxnTagSheet/.test(list), true)

  // 多选
  check('有 selectMode', /const selectMode = ref\(false\)/.test(list), true)
  check('长按进入多选', /function onRowLongPress/.test(list), true)
  check('点行在多选态切换勾选', /function onRowClick[\s\S]{0,300}?toggleSelect/.test(list), true)
  check('多选态禁用右滑', /:disabled="selectMode"/.test(list), true)
  /*
   * ★ 右上角的全选已删除（用户本轮第 2 条）★
   *   用户原话：「删除交易多选时，右上角的全选功能按钮」。
   *   它和「取消」并排在导航右侧会把标题挤掉，且多选场景下少用。
   */
  check('不再有全选按钮', /toggleSelectAll/.test(list), false)
  check('不再有 allSelected 状态', /allSelected/.test(list), false)
  check('保留取消入口', /@click="exitSelectMode"/.test(list), true)

  // 底部悬浮操作条：抽成共用组件，两页同一份
  check('批量操作条组件存在', /name: 'TxnBatchBar'/.test(batchBar), true)
  check('全部交易使用共用操作条', /<TxnBatchBar/.test(list), true)
  check(
    '四个操作都在',
    ['删除', '标签', '不计预算', '待报销'].every((t) => new RegExp(`>${t}<`).test(batchBar)),
    true
  )
  check('不再有「不计收支」按钮', />不计收支</.test(batchBar), false)
  check('待报销走专用 API', /batchSetPendingReimburse/.test(list), true)
  check('操作条是自绘卡片', /class="batch-bar"[\s\S]{0,400}?class="batch-item"/.test(batchBar), true)
  check('删除用危险色', /batch-item-text--danger/.test(batchBar), true)
  check('按钮按内容自适应', /\.batch-item\s*\{[\s\S]{0,200}?flex-shrink:\s*0/.test(batchBar), true)
  check('整条不铺满屏宽（居中自适应）', /\.batch-inner\s*\{[\s\S]{0,300}?display:\s*inline-flex/.test(batchBar), true)
  check('磨砂玻璃复用 glassVars()', /glassVars\(/.test(batchBar), true)
  check('真·毛玻璃有 @supports 降级', /@supports \(\(-webkit-backdrop-filter/.test(batchBar), true)
  check('操作条 z-index 符合页面内浮层约定', /\.batch-bar\s*\{[\s\S]{0,300}?z-index:\s*9/.test(batchBar), true)

  // 批量 API
  check('导出 batchDeleteTransactions', /export async function batchDeleteTransactions/.test(api), true)
  check('导出 batchSetExcludeFlags', /export async function batchSetExcludeFlags/.test(api), true)
  check('导出 batchSetTxnTags', /export async function batchSetTxnTags/.test(api), true)
  check(
    '批量删除逐条走 deleteTransaction（复用余额重算/cycle_skip）',
    /batchDeleteTransactions[\s\S]{0,600}?await deleteTransaction\(id\)/.test(api),
    true
  )
  const reimb = read('api/reimburse.js')
  check('导出 batchSetPendingReimburse', /export async function batchSetPendingReimburse/.test(reimb), true)
  check(
    '批量待报销只处理支出',
    /batchSetPendingReimburse[\s\S]{0,1400}?r\.type !== 'expense'\) continue/.test(reimb),
    true
  )
  check(
    '借款类不可报销',
    /badLoanCats = \['借出', '借款归还'/.test(reimb),
    true
  )
  check(
    '已报销的不动',
    /Number\(r\.reimburse_status\) === 2\) continue/.test(reimb),
    true
  )
  check(
    '返回 changed / skipped 两个数',
    /return \{ changed: usable\.length, skipped: list\.length - usable\.length \}/.test(reimb),
    true
  )

  check(
    '批量标记走一条 IN UPDATE（不是逐条查改）',
    /batchSetExcludeFlags[\s\S]{0,1200}?UPDATE txn SET[^`]*IN \(/.test(api),
    true
  )
  check(
    '批量标签默认 add 语义（保留原有标签）',
    /batchSetTxnTags\(ids, tagIds, mode = 'add'\)/.test(api),
    true
  )
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
