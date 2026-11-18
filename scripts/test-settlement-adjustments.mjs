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
 *   借入借出人名下方显示「借还已平」或坏账/利息金额。
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
import { splitLoanEpisodes, buildLoanEpisodeView } from '../api/loan.js'

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
check('sumTransactions 隐藏差额', /sumTransactions[\s\S]{0,400}?hideAdjustments:\s*true/.test(txnSrc), true)
check('countTransactions 隐藏差额', /countTransactions[\s\S]{0,400}?hideAdjustments:\s*true/.test(txnSrc), true)
check('交易详情也过滤差额', /getTransaction[\s\S]{0,900}?notSettlementAdjustmentSql\('t'\)/.test(txnSrc), true)
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

console.log('=== 页面接线 ===')

const loanPage = read('pages/loan/manage.vue')
const reimbursePage = read('pages/loan/reimburse.vue')
const loanSrc = read('api/loan.js')

check('借入借出组头用 personSub', /personSub\(g\)/.test(loanPage), true)
check('借还已平文案', /借还已平/.test(loanPage), true)
check('人名下方显示坏账/利息金额', /ADJUSTMENT_LABELS/.test(loanPage) && /adjustmentList/.test(loanPage), true)
check('借入借出明细优先 displayTxns', /Array\.isArray\(ep\.displayTxns\)/.test(loanPage), true)
check('API 生成 adjustmentList', /g\.adjustmentList\s*=/.test(loanSrc), true)
check('API 生成 displayTxns', /g\.displayTxns\s*=/.test(loanSrc), true)
check('报销单头显示完整年月日', /年\$\{Number\(m\)\}月\$\{Number\(d\)\}日/.test(reimbursePage), true)
check('报销单头显示多/少报', /batchDiff\(b\)\.label/.test(reimbursePage), true)
check('报销单只渲染非差额派生流水', /v-for="d in visibleDerived\(b\)"/.test(reimbursePage), true)
check('报销单不直接渲染全部派生流水', /v-for="d in b\.derived"/.test(reimbursePage), false)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
