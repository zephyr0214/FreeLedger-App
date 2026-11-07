/**
 * 报销台账 —— 待报销 / 已报销
 *
 * ★ 状态存在哪 ★
 *   txn.reimburse_status：0 不报销 / 1 待报销 / 2 已报销
 *   配套三列：reimburse_day（报销日期）、reimburse_amount_cents（实报金额）、
 *   reimburse_account_id（报销到账账户）。
 *
 * ★ 为什么待报销要同时改两个 exclude 标记 ★
 *   待报销的含义是「这笔钱还没回来」：
 *     · 不能计入收支 —— 我还没真的花掉它（能报回来）
 *     · 不能占预算   —— 同上
 *   所以 status=1 时把 exclude_from_budget / exclude_from_stats 都置 1。
 *   统计层因此一行都不用改（它只认这两个标记），
 *   报销完成后也不用把支出重新放开 —— 支出从来不进收支，
 *   真正的损益由「报销坏账 / 报销盈余」两笔表达。
 *
 * ★ 报销时写哪几笔 ★
 *   设原支出金额 A（分）、实报金额 R（分）：
 *     1) 报销到账   income  R   → 进报销账户（exclude_from_stats=1，不重复计收支）
 *     2) 报销坏账   expense A-R → 仅当 A > R（我的损失，计入收支）
 *     3) 报销盈余   income  R-A → 仅当 R > A（多拿到的，计入收支）
 *   差额为 0 时只记账 1。
 */

import { query, queryOne, execute, transaction } from './db/index.js'
import { prefixedId } from '../utils/id.js'
import { toDayKey, makeDateKeys } from '../utils/date.js'
import { ensurePresetCategories } from './category.js'
import { INTERNAL_ONLY_CATEGORY_NAMES } from './db/schema.js'
import { recalcBalance, writeTodaySnapshot } from './account.js'

/** 报销状态常量 */
export const REIMBURSE_STATUS = {
  NONE: 0,
  PENDING: 1,
  DONE: 2
}

/**
 * 这几个分类是「报销台账自己写」的内部口径，用户与 AI 都不能手动选。
 *
 * ★ 用户要求的第 9 条 ★
 *   借入利息 / 借出坏账 / 借出利息 / 借入未还 / 报销坏账 / 报销盈余
 *   不可以被 AI 记账和手动记账面板选择。
 *   这条函数把「六类结清/报销派生分类」一次性列出来，
 *   面板与 AI 侧都调它来过滤。
 *
 * @param {string} name 分类名
 * @returns {boolean}
 */
export function isInternalOnlyCategory(name) {
  return INTERNAL_ONLY_CATEGORY_NAMES.includes(String(name || ''))
}

/**
 * 待报销 / 已报销列表（按时间倒序，带分类与账户信息）。
 *
 * @param {'pending'|'done'} status
 * @param {{limit?:number}} [opt]
 */
export async function listReimburseTxns(status = 'pending', opt = {}) {
  const { limit = 500 } = opt
  const w = status === 'done'
    ? 't.reimburse_status = 2'
    : 't.reimburse_status = 1'

  const rows = await query(
    `SELECT t.*,
            c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            a.name AS account_name,
            ra.name AS reimburse_account_name
     FROM txn t
     LEFT JOIN category c  ON c.id = t.category_id
     LEFT JOIN account  a  ON a.id = t.account_id
     LEFT JOIN account  ra ON ra.id = t.reimburse_account_id
     WHERE t.deleted_at IS NULL AND ${w}
     ORDER BY ${status === 'done' ? 't.reimburse_day DESC, t.occurred_at DESC' : 't.occurred_at DESC, t.created_at DESC'}
     LIMIT ?`,
    [Number(limit) || 500]
  )

  return rows.map((r) => ({
    ...r,
    amount_cents: Number(r.amount_cents) || 0,
    reimburse_status: Number(r.reimburse_status) || 0,
    reimburse_amount_cents: r.reimburse_amount_cents === null || r.reimburse_amount_cents === undefined
      ? null
      : Number(r.reimburse_amount_cents),
    exclude_from_budget: Number(r.exclude_from_budget) === 1,
    exclude_from_stats: Number(r.exclude_from_stats) === 1
  }))
}

/**
 * 汇总：待报销笔数 / 待报销总额 / 已报销笔数 / 已报销总额。
 */
export async function getReimburseSummary() {
  const row = await queryOne(
    `SELECT
       SUM(CASE WHEN reimburse_status = 1 THEN 1 ELSE 0 END) AS pending_cnt,
       SUM(CASE WHEN reimburse_status = 1 THEN amount_cents ELSE 0 END) AS pending_amt,
       SUM(CASE WHEN reimburse_status = 2 THEN 1 ELSE 0 END) AS done_cnt,
       SUM(CASE WHEN reimburse_status = 2 THEN COALESCE(reimburse_amount_cents, amount_cents) ELSE 0 END) AS done_amt
     FROM txn WHERE deleted_at IS NULL`
  )
  return {
    pendingCount: Number(row ? row.pending_cnt : 0) || 0,
    pendingAmount: Number(row ? row.pending_amt : 0) || 0,
    doneCount: Number(row ? row.done_cnt : 0) || 0,
    doneAmount: Number(row ? row.done_amt : 0) || 0
  }
}

/**
 * 设置 / 取消「待报销」（只对支出生效）。
 *
 * ★ 勾上待报销时 ★
 *   reimburse_status = 1，同时把 exclude_from_budget / exclude_from_stats 置 1。
 * ★ 取消时 ★
 *   reimburse_status = 0，两个标记一起恢复成 0（前提是这笔不是借款类）。
 *
 * 借款类流水本来就不计收支，取消待报销不该把它们放回来 ——
 * 所以这里先查一下分类名，借款八类保持 exclude 不变。
 *
 * @param {string} id
 * @param {boolean} pending
 */
export async function setTxnPendingReimburse(id, pending) {
  const txn = await queryOne(
    `SELECT t.id, t.type, t.exclude_from_budget, t.exclude_from_stats, c.name AS category_name
     FROM txn t LEFT JOIN category c ON c.id = t.category_id
     WHERE t.id = ? AND t.deleted_at IS NULL`,
    [id]
  )
  if (!txn) throw new Error('交易不存在')
  if (txn.type !== 'expense') throw new Error('只有支出可以报销')

  /*
   * 借款类流水（借出 / 借出坏账…）本来就不计收支且不能报销了结，
   * 但它们是支出方向，用户可能在详情页误点。这里直接拒绝更清楚。
   */
  if (['借出', '借款归还', '借出坏账', '借入利息'].includes(txn.category_name)) {
    throw new Error('借款类的账不能走报销')
  }

  const now = Date.now()
  await execute(
    `UPDATE txn SET reimburse_status = ?, exclude_from_budget = ?, exclude_from_stats = ?,
       reimburse_day = NULL, reimburse_amount_cents = NULL, reimburse_account_id = NULL,
       updated_at = ?
     WHERE id = ?`,
    [
      pending ? REIMBURSE_STATUS.PENDING : REIMBURSE_STATUS.NONE,
      pending ? 1 : 0,
      pending ? 1 : 0,
      now,
      id
    ]
  )
  return getReimburseTxn(id)
}

/** 单笔（带分类/账户名） */
export async function getReimburseTxn(id) {
  return queryOne(
    `SELECT t.*,
            c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            a.name AS account_name
     FROM txn t
     LEFT JOIN category c ON c.id = t.category_id
     LEFT JOIN account  a ON a.id = t.account_id
     WHERE t.id = ? AND t.deleted_at IS NULL`,
    [id]
  )
}

/**
 * 执行报销（单笔或多笔一起）。
 *
 * @param {{ids:string[], totalCents:number, accountId:string, day?:string}} input
 *   ids        待报销的交易 id 列表
 *   totalCents 实际到账总额（分）—— 多选时是这一批的总数
 *   accountId  到账账户
 *   day        报销日期（默认今天）
 * @returns {Promise<{incomeCents:number, badDebtCents:number, surplusCents:number,
 *   incomeId:string}>}
 */
export async function reimburseTxns(input) {
  const ids = Array.isArray(input.ids) ? input.ids.filter(Boolean) : []
  if (ids.length === 0) throw new Error('没有选中要报销的流水')

  const totalCents = Math.max(0, Math.round(Number(input.totalCents) || 0))
  if (!totalCents) throw new Error('请输入报销金额')
  if (!input.accountId) throw new Error('请选择报销账户')

  // 选出这批待报销流水的原金额合计
  const placeholders = ids.map(() => '?').join(',')
  const rows = await query(
    `SELECT id, amount_cents, reimburse_status FROM txn
     WHERE deleted_at IS NULL AND id IN (${placeholders})`,
    ids
  )
  if (rows.length === 0) throw new Error('选中的流水不存在')
  const notPending = rows.find((r) => Number(r.reimburse_status) !== REIMBURSE_STATUS.PENDING)
  if (notPending) throw new Error('选中的流水里有不是「待报销」的，请刷新后重试')

  const originCents = rows.reduce((a, r) => a + (Number(r.amount_cents) || 0), 0)
  const day = input.day || toDayKey()

  const cats = await ensurePresetCategories()
  const now = Date.now()

  /*
   * ★ 三笔的顺序不重要，但必须在同一个事务里 ★
   *   中途失败会留下「状态已改、钱没记」的脏数据 ——
   *   用户看到已报销，账户余额却没变。
   */
  return transaction(async () => {
    // 1) 报销到账：实报金额进报销账户，不计收支
    const incomeId = prefixedId('txn')
    const keys = makeDateKeys(new Date(`${day}T12:00:00`).getTime())
    await execute(
      `INSERT INTO txn (
        id, type, amount_cents, account_id, to_account_id, category_id, note,
        occurred_at, occurred_day, month_key, year_key, tz_offset,
        created_at, updated_at, deleted_at, cycle_id, via_combo_id,
        original_currency, original_amount_cents, exchange_rate,
        exclude_from_budget, exclude_from_stats, reimburse_status
      ) VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,1,1,0)`,
      [
        incomeId, 'income', totalCents, input.accountId,
        cats.reimburseIncomeId || null,
        `报销到账 ${ids.length} 笔`,
        keys.occurred_at, keys.occurred_day, keys.month_key, keys.year_key, keys.tz_offset,
        now, now
      ]
    )

    // 2) 差额 → 坏账 / 盈余
    let badDebtCents = 0
    let surplusCents = 0
    const diff = totalCents - originCents
    if (diff !== 0) {
      const isBadDebt = diff < 0
      const amount = Math.abs(diff)
      if (isBadDebt) badDebtCents = amount
      else surplusCents = amount

      await execute(
        `INSERT INTO txn (
          id, type, amount_cents, account_id, to_account_id, category_id, note,
          occurred_at, occurred_day, month_key, year_key, tz_offset,
          created_at, updated_at, deleted_at, cycle_id, via_combo_id,
          original_currency, original_amount_cents, exchange_rate,
          exclude_from_budget, exclude_from_stats, reimburse_status
        ) VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,1,0,0)`,
        [
          prefixedId('txn'),
          isBadDebt ? 'expense' : 'income',
          amount,
          input.accountId,
          isBadDebt ? (cats.reimburseBadDebtId || null) : (cats.reimburseSurplusId || null),
          isBadDebt ? '报销坏账' : '报销盈余',
          keys.occurred_at, keys.occurred_day, keys.month_key, keys.year_key, keys.tz_offset,
          now, now
        ]
      )
    }

    // 3) 把这批流水标成已报销
    for (const id of ids) {
      await execute(
        `UPDATE txn SET reimburse_status = ?, reimburse_day = ?, reimburse_amount_cents = ?,
           reimburse_account_id = ?, updated_at = ?
         WHERE id = ?`,
        [REIMBURSE_STATUS.DONE, day, totalCents, input.accountId, now, id]
      )
    }

    // 4) 重算报销账户余额（到账与差额都记在它上面）
    await recalcBalance(input.accountId)
    await writeTodaySnapshot(input.accountId)

    return { incomeCents: totalCents, badDebtCents, surplusCents, incomeId }
  })
}
