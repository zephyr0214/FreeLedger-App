/**
 * 结算差额流水（报销 / 借入借出）的口径测试
 *
 *   node scripts/test-settlement-adjustments.mjs
 *
 * 需求：
 *   报销坏账 / 报销盈余、借出坏账 / 借出利息、借入未还 / 借入利息
 *   这六类：
 *     · 计入收支与统计
 *     · 不计入账户余额（现金已经由本金/到账/收回/归还记过）
 *     · 在所有流水列表和详情里隐藏
 *   报销单头显示年月日、应报、多/少报；
 *   借入借出人名下方显示坏账/利息金额；已结清大字下方显示最近结清日期。
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  SETTLEMENT_ADJUSTMENT_CATEGORY_NAMES
} from '../api/db/schema.js'
import {
  isSettlementAdjustmentName, notSettlementAdjustmentSql
} from '../api/txnFilter.js'
import { buildFilterWhere } from '../api/transaction.js'
import { DEFAULT_SETTINGS } from '../api/settings.js'
import { splitLoanEpisodes, buildLoanEpisodeView, buildLoanOrderEpisodes, chooseLoanEpisodes, filterLoanBoundaryRows } from '../api/loan.js'
import { episodeCleanupIds, LOAN_BOUNDARY_MARK } from '../api/loanCleanup.js'
import { reimburseDeletePlan } from '../api/reimburseCleanup.js'

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

const ROOT = path.resolve(import.meta.dirname, '..')
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

console.log('=== 六类名单 ===')

check('名单正好六类', SETTLEMENT_ADJUSTMENT_CATEGORY_NAMES, [
  '借出坏账', '借出利息', '借入未还', '借入利息', '报销坏账', '报销盈余'
])
for (const name of SETTLEMENT_ADJUSTMENT_CATEGORY_NAMES) {
  check(`${name} 是结算差额`, isSettlementAdjustmentName(name), true)
}
check('报销到账不是差额（真实现金）', isSettlementAdjustmentName('报销到账'), false)
check('借出本金不是差额', isSettlementAdjustmentName('借出'), false)
check('借款收回不是差额', isSettlementAdjustmentName('借款收回'), false)
check('空名不是差额', isSettlementAdjustmentName(''), false)

console.log('=== SQL 过滤 ===')

const sql = notSettlementAdjustmentSql('t')
for (const name of SETTLEMENT_ADJUSTMENT_CATEGORY_NAMES) {
  check(`SQL 含 ${name}`, sql.includes(`'${name}'`), true)
}
check('允许无分类流水', sql.includes('t.category_id IS NULL'), true)
check('使用传入别名', notSettlementAdjustmentSql('x').includes('x.category_id'), true)

const defaultWhere = buildFilterWhere({})
check('默认不排除差额（统计要用）', defaultWhere.where.some((w) => w.includes('结算差额') || w.includes('借出坏账')), false)
const hiddenWhere = buildFilterWhere({ hideAdjustments: true })
check('显式隐藏时排除差额', hiddenWhere.where.some((w) => w.includes('借出坏账') && w.includes('报销盈余')), true)

console.log('=== 列表 / 详情 / 余额接线 ===')

const txnSrc = read('api/transaction.js')
const accountSrc = read('api/account.js')
const appSrc = read('App.vue')

check('listTransactions 隐藏差额', /listTransactions[\s\S]{0,400}?hideAdjustments:\s*true/.test(txnSrc), true)
check('sumTransactions 默认包含差额', /hideAdjustments = false/.test(txnSrc) && /buildFilterWhere\(\{ \.\.\.rest, hideAdjustments \}\)/.test(txnSrc), true)
check('账户详情合计按现金口径隐藏差额', /hideAdjustments: true/.test(read('pages/account/detail.vue')), true)
check('sumByDay 每日小计包含差额', /sumByDay[\s\S]{0,900}?buildFilterWhere\(opt\)/.test(txnSrc), true)
check('全部交易页每日小计用 sumByDay', /sumByDay/.test(read('pages/txn/list.vue')), true)
check('countTransactions 隐藏差额', /countTransactions[\s\S]{0,400}?hideAdjustments:\s*true/.test(txnSrc), true)
check('交易详情也过滤差额', /getTransaction[\s\S]{0,900}?notSettlementAdjustmentSql\('t'\)/.test(txnSrc), true)
check('删除借款收回/归还时连带清理差额', /findLoanCascade/.test(txnSrc), true)
check('删除借款流水时写边界标记', /LOAN_BOUNDARY_MARK/.test(txnSrc), true)
check('恢复借款流水时清掉边界标记', /via_combo_id = CASE WHEN via_combo_id = \? THEN NULL/.test(txnSrc), true)
check('删除报销流水时整单退回', /findReimburseDeletePlan/.test(txnSrc), true)
check('统计页不隐藏差额', /buildFilterWhere\(r\)/.test(read('api/stats.js')), true)
check('余额重算排除差额', /recalcBalance[\s\S]{0,1200}?notSettlementAdjustmentSql\('t'\)/.test(accountSrc), true)
check('直接改余额也排除差额', /setAccountBalanceDirect[\s\S]{0,1200}?notSettlementAdjustmentSql\('t'\)/.test(accountSrc), true)
check('启动时一次性重算历史余额', /settlementBalanceFixed/.test(appSrc) && /recalcAllBalances\(\)/.test(appSrc), true)
check('修复标记默认 false', DEFAULT_SETTINGS.settlementBalanceFixed, false)

console.log('=== 借入借出分段：明细隐藏、余额仍算 ===')

const LEND = {
  mainId: 'm', backId: 'b', positiveId: 'p', negativeId: 'n'
}
const mk = (id, cat, yuan, name) => ({
  id,
  category_id: cat,
  category_name: name,
  amount_cents: yuan * 100,
  occurred_day: '2026-01-05',
  occurred_at: new Date('2026-01-05T12:00:00').getTime(),
  created_at: new Date('2026-01-05T12:00:00').getTime()
})

const episodes = splitLoanEpisodes([
  mk('l1', LEND.mainId, 500, '借出'),
  mk('l2', LEND.backId, 400, '借款收回'),
  mk('l3', LEND.positiveId, 100, '借出坏账')
], LEND)

check('分段仍然结算', episodes.map((e) => e.settled), [true])
check('完整流水保留 3 笔（余额要用）', episodes[0].txns.map((t) => t.id), ['l1', 'l2', 'l3'])
check('展示流水去掉坏账', episodes[0].displayTxns.map((t) => t.id), ['l1', 'l2'])

const view = buildLoanEpisodeView(episodes, { status: 'open' })
check('折叠条按可见笔数计数', /已结清 2 笔/.test(view[0].collapseText), true)
check('折叠条不显示坏账笔数', /已结清 3 笔/.test(view[0].collapseText), false)

console.log('=== 删除借款收回/归还时连带删差额 ===')

const PAIR = { mainId: 'm', backId: 'b', positiveId: 'p', negativeId: 'n' }
const loanRow = (id, cat, yuan, day, hour = 12) => ({
  id,
  category_id: cat,
  amount_cents: yuan * 100,
  occurred_at: new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).getTime(),
  created_at: new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).getTime()
})

const ep1 = [
  loanRow('m1', 'm', 500, '2026-01-05'),
  loanRow('b1', 'b', 400, '2026-01-08', 11),
  loanRow('p1', 'p', 100, '2026-01-08', 12)
]
check('删少还的收回 -> 连带删坏账', episodeCleanupIds(ep1, PAIR, 'b1'), ['p1'])

const exact = [
  loanRow('m2', 'm', 500, '2026-02-01'),
  loanRow('b2', 'b', 500, '2026-02-02')
]
check('刚好还清 -> 没有差额可删', episodeCleanupIds(exact, PAIR, 'b2'), [])

const twoEpisodes = [
  // 第一轮：少还 100，结清
  loanRow('m3', 'm', 500, '2026-03-01'),
  loanRow('b3', 'b', 400, '2026-03-02', 11),
  loanRow('p3', 'p', 100, '2026-03-02', 12),
  // 第二轮：刚好还清
  loanRow('m4', 'm', 300, '2026-03-10'),
  loanRow('b4', 'b', 300, '2026-03-11')
]
check('删第一轮收回 -> 只删第一轮坏账', episodeCleanupIds(twoEpisodes, PAIR, 'b3'), ['p3'])
check('删第二轮收回 -> 不误删上一轮坏账', episodeCleanupIds(twoEpisodes, PAIR, 'b4'), [])

const open = [
  ...twoEpisodes,
  loanRow('m5', 'm', 200, '2026-03-20')
]
check('删历史单收回 -> 只删本单差额', episodeCleanupIds(open, PAIR, 'b4'), [])
check('最新未结清段删流水 -> 不做联动', episodeCleanupIds(open, PAIR, 'm5'), [])

/*
 * 历史单的边界要能保留：用包含软删除行的全部流水分段，
 * 第二单的收回被删后，第二单剩余本金应显示为未结清，
 * 第一、第三单仍各自结清并折叠。
 */
{
  const threeSettled = [
    loanRow('m3', 'm', 500, '2026-03-01'),
    loanRow('b3', 'b', 400, '2026-03-02', 11),
    loanRow('p3', 'p', 100, '2026-03-02', 12),
    loanRow('m4', 'm', 300, '2026-03-10'),
    loanRow('b4', 'b', 300, '2026-03-11'),
    loanRow('m5', 'm', 200, '2026-03-20'),
    loanRow('b5', 'b', 200, '2026-03-21')
  ]
  const withDeleted = threeSettled.map((t) => ({ ...t }))
  // 模拟删除第二单收回（软删）
  withDeleted.find((t) => t.id === 'b4').deleted_at = Date.now()
  const segments = buildLoanOrderEpisodes(withDeleted, PAIR)

  check('软删收回后仍切出三段', segments.length, 3)
  check(
    '第二单剩余本金为未结清，第一/三单仍结清',
    segments.map((ep) => ep.settled),
    [true, false, true]
  )
  check('只统计存活行', segments.map((ep) => ep.txns.length), [3, 1, 2])

  /*
   * 未结清页：第 2 单显示，第 1/3 单合成一个折叠条放在下面。
   * 未结清段永远排在已结清历史之前（用户本轮截图反馈）。
   */
  const view = buildLoanEpisodeView(segments, { status: 'open' }).filter((v) => !v.skip)
  check(
    '第 2 单在上显示、第 1/3 单折叠在下',
    view.map((v) => [v.rowIndex, v.collapsed]),
    [[0, false], [-1, true]]
  )
}

/*
 * 三笔已结清的单，删掉中间那笔收回：
 * 只应让第 2 单本金显示为未结清，第 1/3 单继续折叠。
 * 再删第 3 单收回：只应让第 3 单显示，第 1/2 单折叠。
 *
 * 这是用户 2026-11-18 的验收场景（截图 1 -> 截图 2）。
 */
{
  const threeOrders = [
    // 第 1 单：借 200，收回 198，坏账 2
    loanRow('o1m', 'm', 200, '2026-07-01'),
    loanRow('o1b', 'b', 198, '2026-07-02'),
    loanRow('o1p', 'p', 2, '2026-07-02', 13),
    // 第 2 单：借 300，收回 300
    loanRow('o2m', 'm', 300, '2026-07-03'),
    loanRow('o2b', 'b', 300, '2026-07-04'),
    // 第 3 单：借 200，收回 202，利息 2
    loanRow('o3m', 'm', 200, '2026-07-05'),
    loanRow('o3b', 'b', 202, '2026-07-06'),
    loanRow('o3n', 'n', 2, '2026-07-06', 13)
  ]

  // 删第 2 单收回：带边界标记，即使删除时间早于后面的存活流水也必须保留
  const deletedMiddle = threeOrders.map((t) =>
    t.id === 'o2b'
      ? { ...t, deleted_at: 1000, via_combo_id: LOAN_BOUNDARY_MARK }
      : t
  )
  const middleLive = deletedMiddle.filter((t) => !t.deleted_at)
  const middleBoundary = filterLoanBoundaryRows(deletedMiddle)

  check('边界过滤保留带标记的已删收回', middleBoundary.some((t) => t.id === 'o2b'), true)
  const middleEpisodes = chooseLoanEpisodes(middleLive, middleBoundary, PAIR)
  check(
    '删第 2 单收回：第 1/3 单结清，第 2 单未结清',
    middleEpisodes.filter((ep) => ep.settled).map((ep) => ep.txns.map((t) => t.id)),
    [['o1m', 'o1b', 'o1p'], ['o3m', 'o3b', 'o3n']]
  )
  check(
    '删第 2 单收回：未结清段只剩第 2 单本金',
    middleEpisodes.filter((ep) => !ep.settled).map((ep) => ep.txns.map((t) => t.id)),
    [['o2m']]
  )
  check(
    '删第 2 单收回：未结清页第 2 单在上，第 1/3 单折叠在下',
    buildLoanEpisodeView(middleEpisodes, { status: 'open' })
      .filter((v) => !v.skip)
      .map((v) => [v.rowIndex, v.collapsed]),
    [[0, false], [-1, true]]
  )
  check(
    '删第 2 单收回：展开历史后已结清单也在当前流水下方',
    buildLoanEpisodeView(middleEpisodes, {
      status: 'open',
      isExpanded: (index) => index === -1
    }).map((v) => [v.rowIndex, !!v.showDividerBefore, !!v.showCollapseBtn]),
    [[0, false, false], [-1, true, false], [-1, true, true]]
  )

  /*
   * 没有任何边界软删行时（旧数据/噪声被过滤光）也要能修：
   * 存活行里第 3 单是完整收口的，从末尾把已结清后缀拆出来。
   */
  const liveOnlyEpisodes = chooseLoanEpisodes(middleLive, middleLive, PAIR)
  check(
    '无边界行：第 1/3 单仍结清，第 2 单变未结清',
    [
      liveOnlyEpisodes.filter((ep) => ep.settled).map((ep) => ep.txns.map((t) => t.id)),
      liveOnlyEpisodes.filter((ep) => !ep.settled).map((ep) => ep.txns.map((t) => t.id))
    ],
    [
      [['o1m', 'o1b', 'o1p'], ['o3m', 'o3b', 'o3n']],
      [['o2m']]
    ]
  )

  // 删第 3 单收回 + 利息：第 3 单本金变未结清，第 1/2 单折叠
  const deletedLast = threeOrders.map((t) =>
    t.id === 'o3b' || t.id === 'o3n'
      ? { ...t, deleted_at: 1000, via_combo_id: LOAN_BOUNDARY_MARK }
      : t
  )
  const lastLive = deletedLast.filter((t) => !t.deleted_at)
  const lastBoundary = filterLoanBoundaryRows(deletedLast)
  const lastEpisodes = chooseLoanEpisodes(lastLive, lastBoundary, PAIR)

  check(
    '删第 3 单收回：第 3 单未结清，第 1/2 单仍结清',
    lastEpisodes.map((ep) => ep.settled),
    [true, true, false]
  )
  check(
    '删第 3 单收回：未结清段只剩第 3 单本金',
    lastEpisodes.filter((ep) => !ep.settled).map((ep) => ep.txns.map((t) => t.id)),
    [['o3m']]
  )
  check(
    '删第 3 单收回：未结清页第 1/2 单折叠、第 3 单显示',
    buildLoanEpisodeView(lastEpisodes, { status: 'open' })
      .filter((v) => !v.skip)
      .map((v) => [v.rowIndex, v.collapsed]),
    [[0, false], [-1, true]]
  )

  /*
   * 后面那单本来就没结清时，也要把「中间单剩余本金」和「后面那单」
   * 分成两段未结清 —— 否则用户看到的是两单糊在一起。
   */
  const openThird = threeOrders
    .filter((t) => t.id !== 'o3b' && t.id !== 'o3n')
    .map((t) => t.id === 'o2b'
      ? { ...t, deleted_at: 1000, via_combo_id: LOAN_BOUNDARY_MARK }
      : t)
  const openThirdLive = openThird.filter((t) => !t.deleted_at)
  const openThirdEpisodes = chooseLoanEpisodes(
    openThirdLive,
    filterLoanBoundaryRows(openThird),
    PAIR
  )
  check(
    '删中间收回、第三单仍未结清：切出三段而不是两段',
    openThirdEpisodes.map((ep) => ep.settled),
    [true, false, false]
  )
  check(
    '删中间收回、第三单仍未结清：中间单和第三单各占一段',
    openThirdEpisodes.filter((ep) => !ep.settled).map((ep) => ep.txns.map((t) => t.id)),
    [['o2m'], ['o3m']]
  )
}

/*
 * 借入方向同一套展示规则：删中间那笔「借款归还」后，
 * 当前未结清的借入也要排在上面，已结清历史折叠在下面。
 */
{
  const BORROW = { mainId: 'bm', backId: 'bb', positiveId: 'bp', negativeId: 'bn' }
  const borrowRow = (id, cat, yuan, day, hour = 12) => ({
    ...loanRow(id, cat, yuan, day, hour),
    category_id: cat
  })
  const rows = [
    borrowRow('q1m', 'bm', 500, '2026-09-01'),
    borrowRow('q1b', 'bb', 500, '2026-09-02'),
    borrowRow('q2m', 'bm', 300, '2026-09-03'),
    borrowRow('q2b', 'bb', 300, '2026-09-04'),
    borrowRow('q3m', 'bm', 200, '2026-09-05'),
    borrowRow('q3b', 'bb', 200, '2026-09-06')
  ].map((t) => (t.id === 'q2b'
    ? { ...t, deleted_at: 1000, via_combo_id: LOAN_BOUNDARY_MARK }
    : t))
  const live = rows.filter((t) => !t.deleted_at)
  const eps = chooseLoanEpisodes(live, filterLoanBoundaryRows(rows), BORROW)
  check(
    '借入：删中间归还后第 1/3 单结清、第 2 单未结清',
    [
      eps.filter((ep) => ep.settled).map((ep) => ep.txns.map((t) => t.id)),
      eps.filter((ep) => !ep.settled).map((ep) => ep.txns.map((t) => t.id))
    ],
    [
      [['q1m', 'q1b'], ['q3m', 'q3b']],
      [['q2m']]
    ]
  )
  check(
    '借入：未结清流水在上、历史折叠在下',
    buildLoanEpisodeView(eps, { status: 'open' })
      .filter((v) => !v.skip)
      .map((v) => [v.rowIndex, v.collapsed]),
    [[0, false], [-1, true]]
  )
}

/*
 * 没有边界标记的旧删除：
 *   · 删除时间早于最后一笔存活流水 → 当作历史实验噪声剔除；
 *   · 删除时间晚于最后一笔存活流水 → 视为用户刚做的那次删除，保留。
 */
{
  const rows = [
    { ...loanRow('x1', 'm', 100, '2026-08-01'), created_at: 1000 },
    { ...loanRow('x2', 'b', 100, '2026-08-02'), created_at: 2000 },
    { ...loanRow('x3', 'm', 300, '2026-08-03'), created_at: 3000 },
    { ...loanRow('xnoise', 'm', 50, '2026-08-01'), created_at: 1500, deleted_at: 2500 },
    { ...loanRow('xrecent', 'b', 300, '2026-08-04'), created_at: 4000, deleted_at: 5000 }
  ]
  const filtered = filterLoanBoundaryRows(rows)
  check('旧删除实验噪声被剔除', filtered.some((t) => t.id === 'xnoise'), false)
  check('晚于最后一笔存活流水的旧删除被保留', filtered.some((t) => t.id === 'xrecent'), true)
}

/*
 * 旧单还没收回时，新借一笔并马上收回：
 * 新借 + 新还应该独立成一单，不能和旧单糊在一起。
 * 这是用户 2026-11-18 第二张截图（旧 200 未还，新 100 借还）的场景。
 */
{
  const at = (id, cat, yuan, time) => ({
    id,
    category_id: cat,
    amount_cents: yuan * 100,
    occurred_day: '2026-11-18',
    occurred_at: new Date(`2026-11-18T${time}`).getTime(),
    created_at: new Date(`2026-11-18T${time}`).getTime()
  })
  const rows = [
    // 第一单：借 200，收回 198，坏账 2
    at('n1m', 'm', 200, '21:48:00'),
    at('n1b', 'b', 198, '21:48:10'),
    at('n1p', 'p', 2, '21:48:20'),
    // 第二单：借 200（旧单，先挂着）
    at('n2m', 'm', 200, '21:49:00'),
    // 第三单：借 100，马上收回 100
    at('n3m', 'm', 100, '21:53:00'),
    at('n3b', 'b', 100, '21:53:10'),
    // 第二单最后收回 198 + 坏账 2
    at('n2b', 'b', 198, '22:07:00'),
    at('n2p', 'p', 2, '22:07:10')
  ]

  const eps = splitLoanEpisodes(rows, PAIR)
  check(
    '旧单未还时新借新还独立成一单',
    eps.map((ep) => ep.txns.map((t) => t.id)),
    [
      ['n1m', 'n1b', 'n1p'],
      ['n3m', 'n3b'],
      ['n2m', 'n2b', 'n2p']
    ]
  )

  // 已结清页按收口时间倒序：旧 200（22:07 收口）在上，新 100 在下
  check(
    '旧单与新单各自带自己的已结清日期',
    buildLoanEpisodeView(eps, { status: 'settled' }).map((v) => v.txns.map((t) => t.id)),
    [
      ['n2m', 'n2b', 'n2p'],
      ['n3m', 'n3b'],
      ['n1m', 'n1b', 'n1p']
    ]
  )

  /*
   * 删除联动也要按单走：
   * 删新单的收回只影响新单；删旧单的收回才清理旧单的坏账。
   */
  check('删新单收回不误删旧单坏账', episodeCleanupIds(rows, PAIR, 'n3b'), [])
  check('删新单本金连带删新单收回', episodeCleanupIds(rows, PAIR, 'n3m'), ['n3b'])
  check('删旧单收回只删旧单坏账', episodeCleanupIds(rows, PAIR, 'n2b'), ['n2p'])
  check('删旧单本金连带删旧单收回和坏账', episodeCleanupIds(rows, PAIR, 'n2m'), ['n2b', 'n2p'])
}

/*
 * 借入方向同理：旧借入还没归还时，新借入一笔并马上归还，
 * 新借入 + 新归还应独立成一单，不能并进旧单。
 */
{
  const at = (id, cat, yuan, time) => ({
    id,
    category_id: cat,
    amount_cents: yuan * 100,
    occurred_day: '2026-11-18',
    occurred_at: new Date(`2026-11-18T${time}`).getTime(),
    created_at: new Date(`2026-11-18T${time}`).getTime()
  })
  const BORROW = { mainId: 'bm', backId: 'bb', positiveId: 'bp', negativeId: 'bn' }
  const rows = [
    at('r1m', 'bm', 200, '21:48:00'),
    at('r1b', 'bb', 198, '21:48:10'),
    at('r1p', 'bp', 2, '21:48:20'),
    at('r2m', 'bm', 200, '21:49:00'),
    at('r3m', 'bm', 100, '21:53:00'),
    at('r3b', 'bb', 100, '21:53:10'),
    at('r2b', 'bb', 198, '22:07:00'),
    at('r2p', 'bp', 2, '22:07:10')
  ]
  const eps = splitLoanEpisodes(rows, BORROW)
  check(
    '借入：旧单未还时新借新还独立成一单',
    eps.map((ep) => ep.txns.map((t) => t.id)),
    [
      ['r1m', 'r1b', 'r1p'],
      ['r3m', 'r3b'],
      ['r2m', 'r2b', 'r2p']
    ]
  )
  check('借入：删新单归还不误删旧单未还差额', episodeCleanupIds(rows, BORROW, 'r3b'), [])
  check('借入：删旧单归还只删旧单未还差额', episodeCleanupIds(rows, BORROW, 'r2b'), ['r2p'])
}

/* 补记的新借款即使业务日期更早，也不该插到旧结清的坏账之前 */{
  const rows = [
    { ...loanRow('k1', 'm', 100, '2026-05-01'), created_at: new Date('2026-05-01T10:00:00').getTime() },
    { ...loanRow('k2', 'b', 98, '2026-05-01'), created_at: new Date('2026-05-02T10:00:00').getTime() },
    { ...loanRow('k3', 'p', 2, '2026-05-02'), created_at: new Date('2026-05-03T10:00:00').getTime() },
    // 新借出补记到 5/1，但实际是 5/4 才录入
    { ...loanRow('k4', 'm', 200, '2026-05-01'), created_at: new Date('2026-05-04T10:00:00').getTime() }
  ]
  const eps = buildLoanOrderEpisodes(rows, PAIR)
  check('补记新借款仍单独成未结清单', eps.map((ep) => ep.settled), [true, false])
  check('旧单坏账日期保留', eps[0] ? eps[0].closingDay : '', '2026-05-02')
}

/*
 * 历史删除实验留下的软删行不能污染当前账单：
 * 存活行本身能切出两个已结清单 + 一个新未结清单，
 * 含软删行会被噪声拖成一整段未结清，应选存活行那套。
 */
{
  const live = [
    { ...loanRow('z1', 'm', 100, '2026-06-01'), created_at: 1000 },
    { ...loanRow('z2', 'b', 98, '2026-06-01'), created_at: 2000 },
    { ...loanRow('z3', 'p', 2, '2026-06-01'), created_at: 3000 },
    { ...loanRow('z4', 'm', 300, '2026-06-02'), created_at: 4000 },
    { ...loanRow('z5', 'b', 300, '2026-06-02'), created_at: 5000 },
    { ...loanRow('z6', 'm', 100, '2026-06-03'), created_at: 6000 }
  ]
  const noise = {
    ...loanRow('znoise', 'm', 200, '2026-06-01'),
    created_at: 2500,
    deleted_at: Date.now()
  }
  const eps = chooseLoanEpisodes(live, [...live, noise], PAIR)
  check('选存活行分段：两张旧单结清、新单未结清', eps.map((ep) => ep.settled), [true, true, false])
  check('软删噪声不参与最终分段', eps.some((ep) => ep.txns.some((t) => t.id === 'znoise')), false)
}

/* 软删行导致原始段未收口、但存活行刚好归零时，日期要能兜底 */
{
  const rows = [
    loanRow('m6', 'm', 500, '2026-04-01'),
    loanRow('b6', 'b', 500, '2026-04-02'),
    { ...loanRow('m7', 'm', 100, '2026-04-03'), deleted_at: Date.now() }
  ]
  const eps = buildLoanOrderEpisodes(rows, PAIR)
  check('存活行刚好归零时仍给出结清日期', eps[0] ? eps[0].closingDay : '', '2026-04-02')
}

/*
 * 删本金：本单的收回/归还 + 差额一起删，剩余本金变为未结清。
 */
check('删唯一本金 -> 本单收回和坏账一起删', episodeCleanupIds(ep1, PAIR, 'm1'), ['b1', 'p1'])

const multiMain = [
  loanRow('mm1', 'm', 300, '2026-04-01'),
  loanRow('mm2', 'm', 200, '2026-04-01', 13),
  loanRow('mb1', 'b', 500, '2026-04-02')
]
check('删部分本金 -> 收回一起删，其余本金保留', episodeCleanupIds(multiMain, PAIR, 'mm1'), ['mb1'])
check('删另一笔部分本金 -> 同样清本单收回', episodeCleanupIds(multiMain, PAIR, 'mm2'), ['mb1'])

console.log('=== 删除报销单流水时整单退回 ===')

const BATCH_ROWS = [
  { id: 'r1', batch_id: 'bt1', account_id: 'acc1', reimburse_status: 2, category_name: '餐饮' },
  { id: 'r2', batch_id: 'bt1', account_id: 'acc1', reimburse_status: 2, category_name: '打车' },
  { id: 'r3', batch_id: 'bt1', account_id: 'acc1', reimburse_status: 0, category_name: '报销到账' },
  { id: 'r4', batch_id: 'bt1', account_id: 'acc1', reimburse_status: 0, category_name: '报销坏账' }
]
const original1 = BATCH_ROWS[0]
const arrival = BATCH_ROWS[2]

const plan1 = reimburseDeletePlan(original1, BATCH_ROWS)
check('删原始支出：删到账+坏账', plan1.deleteIds.sort(), ['r3', 'r4'])
check('删原始支出：其余原始支出退回待报销', plan1.revertIds, ['r2'])
check('删原始支出：到账账户带回', plan1.arrivalAccountId, 'acc1')

const plan2 = reimburseDeletePlan(arrival, BATCH_ROWS)
check('删到账：删坏账', plan2.deleteIds, ['r4'])
check('删到账：全部原始支出退回待报销', plan2.revertIds.sort(), ['r1', 'r2'])

check('普通无单流水不做整单退回', reimburseDeletePlan({
  id: 'x', batch_id: null, reimburse_status: 2, category_name: '餐饮'
}, []), null)
check('单内非到账/非原始流水不做整单退回', reimburseDeletePlan({
  id: 'r4', batch_id: 'bt1', reimburse_status: 0, category_name: '报销坏账'
}, BATCH_ROWS), null)

console.log('=== 页面接线 ===')

const loanPage = read('pages/loan/manage.vue')
const loanPageNoComments = loanPage
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
const reimbursePage = read('pages/loan/reimburse.vue')
const loanSrc = read('api/loan.js')

check('借入借出组头用 personSub', /personSub\(g\)/.test(loanPage), true)
check('已结清不再写「借还已平」', /借还已平/.test(loanPageNoComments), false)
check('已结清不再写「账目已平」', /账目已平/.test(loanPageNoComments), false)
check('已结清大字下方显示最近结清日期', /lastClosingDay/.test(loanPage) && /person-settled-date/.test(loanPage), true)
check('日期前不写「最近结清」', /最近结清/.test(loanPageNoComments), false)
check('人名下方显示坏账/利息金额', /loanAdjustmentText/.test(loanPage) && /adjustmentList/.test(loanPage), true)
check('API 分段标注可追加差额金额', /adjustmentTextOfTxns/.test(loanSrc), true)
check('借入借出明细优先 displayTxns', /Array\.isArray\(ep\.displayTxns\)/.test(loanPage), true)
check('API 生成 adjustmentList', /g\.adjustmentList\s*=/.test(loanSrc), true)
check('API 生成最近结清日期', /g\.lastClosingDay\s*=/.test(loanSrc), true)
check('分组用存活行/软删行两套分段择优', /chooseLoanEpisodes\(g\.txns, g\.allTxns, pair\)/.test(loanSrc), true)
check('分组前过滤历史删除噪声', /g\.allTxns = filterLoanBoundaryRows\(g\.allTxns\)/.test(loanSrc), true)
check('边界过滤保留标记行/近期删除', /LOAN_BOUNDARY_MARK/.test(loanSrc) && /deleted_at\) >= latestLiveAt/.test(loanSrc), true)
check('软删除行只参与分段不参与汇总', /if \(r\.deleted_at\) continue/.test(loanSrc), true)
check('借出借入右上角快捷按钮', /HeaderAction/.test(loanPage) && /openBackPanel/.test(loanPage), true)
check('快捷按钮文案随方向切换', /isIncome \? '借款归还' : '借款收回'/.test(loanPage), true)
check('借出借入页挂记账面板', /<TxnPanel/.test(loanPage), true)
check('快捷记账预置收回/归还分类', /borrowBackId/.test(loanPage) && /lendBackId/.test(loanPage), true)
check('已结清后再借会重新折叠旧单', /historyIsExpanded\(g\)/.test(loanPage) && /latestTxnCreatedAt\(g\)/.test(loanPage), true)
check('每次加载都恢复历史折叠', /for \(const g of open\)[\s\S]{0,200}?delete episodeOpen\[key\]/.test(loanPage), true)
check('流水变更事件会刷新借入借出页', /txn:changed/.test(loanPage) && /txn:changed/.test(read('stores/transaction.js')), true)
check('API 生成 displayTxns', /g\.displayTxns\s*=/.test(loanSrc), true)
check('报销单头显示完整年月日', /年\$\{Number\(m\)\}月\$\{Number\(d\)\}日/.test(reimbursePage), true)
check('报销单头显示多/少报', /batchDiff\(b\)\.label/.test(reimbursePage), true)
check('报销单只渲染非差额派生流水', /v-for="d in visibleDerived\(b\)"/.test(reimbursePage), true)
check('报销单不直接渲染全部派生流水', /v-for="d in b\.derived"/.test(reimbursePage), false)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
