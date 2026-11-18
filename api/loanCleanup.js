/**
 * 删除「借款收回 / 借款归还」时，连带清理同一结清批次的差额流水
 *
 * ★ 为什么需要它 ★
 *   借出坏账 / 借出利息 / 借入未还 / 借入利息 是「手动结清」时
 *   按差额自动写的一笔。它们和报销单的坏账/盈余一样，
 *   只计收支、不计余额，并且在所有流水列表里隐藏。
 *
 *   用户删掉一笔借款收回/借款归还后，那一轮结清已经不成立了：
 *   · 余额不会再归零；
 *   · 但坏账/利息流水还留在库里，统计里会凭空多一笔损益。
 *   所以删除还款时必须把同一结清批次里的差额一起软删除。
 *
 * ★ 为什么按「批次」而不是按人员全删 ★
 *   同一个人可能先借后还、结清，过一阵又借 ——
 *   删最新一次的还款，不能把上一轮历史坏账也删掉。
 *   这里用和 splitLoanEpisodes 相同的「余额回到 0」边界找批次，
 *   只清理被删还款所在那一段里的差额。
 *
 * ★ 为什么单独一个文件 ★
 *   api/transaction.js 不能 import api/loan.js（loan.js 反过来 import 它）。
 *   这里只依赖 db/index 与 schema，两个方向都能安全引用。
 */

import { query } from './db/index.js'
import { LOAN_CATEGORY_NAMES, LOAN_SETTLE_CATEGORY_NAMES } from './db/schema.js'

/**
 * 被删除的流水 -> 对应方向的主/反/正差/负差分类名
 *
 *   借出方向：借出 / 借款收回 / 借出坏账 / 借出利息
 *   借入方向：借入 / 借款归还 / 借入未还 / 借入利息
 *
 * ★ 主方向和反方向都要映射 ★
 *   用户要求：
 *     · 删「借款收回/借款归还」→ 删本单差额，本金保持（本单变未结清）
 *     · 删「借出/借入」→ 连本单的收回/归还与差额一起删，剩余本金变未结清
 *   所以两边的分类名都要能进同一套批次计算。
 */
const LEND_PAIR = {
  main: LOAN_CATEGORY_NAMES.lendOut.name,
  back: LOAN_CATEGORY_NAMES.lendBack.name,
  positive: LOAN_SETTLE_CATEGORY_NAMES.badDebt.name,
  negative: LOAN_SETTLE_CATEGORY_NAMES.interest.name
}
const BORROW_PAIR = {
  main: LOAN_CATEGORY_NAMES.borrowIn.name,
  back: LOAN_CATEGORY_NAMES.borrowBack.name,
  positive: LOAN_SETTLE_CATEGORY_NAMES.borrowWaived.name,
  negative: LOAN_SETTLE_CATEGORY_NAMES.borrowInterest.name
}
const PAIRS = {
  [LEND_PAIR.main]: LEND_PAIR,
  [LEND_PAIR.back]: LEND_PAIR,
  [BORROW_PAIR.main]: BORROW_PAIR,
  [BORROW_PAIR.back]: BORROW_PAIR
}

function compareAsc(a, b) {
  const ao = Number(a && a.occurred_at) || 0
  const bo = Number(b && b.occurred_at) || 0
  if (ao !== bo) return ao - bo
  const ac = Number(a && a.created_at) || 0
  const bc = Number(b && b.created_at) || 0
  if (ac !== bc) return ac - bc
  return String((a && a.id) || '').localeCompare(String((b && b.id) || ''))
}

/**
 * 从某个人的全部借入借出流水里，找出被删流水所在结清批次中要连带删除的行
 *
 * ★ 删反方向（借款收回/归还）★
 *   只删本批次的差额（坏账/利息），本金保留 → 本批次自然变成未结清。
 *
 * ★ 删主方向（借出/借入）★
 *   除本批次差额外，**本批次的全部收回/归还也要删**，
 *   剩余的主方向流水归为未结清。
 *   如果这是本批次唯一一笔本金，删完后整单消失，
 *   组头的「最近结清日期」自然回退到上一次结清。
 *
 * 纯函数，不碰数据库。
 *
 * @param {Array<object>} txns 该人员、该方向四类分类下的全部流水（可乱序）
 * @param {{mainId:string, backId:string, positiveId:string, negativeId:string}} pair
 * @param {string} deletedId 被删除的流水 id
 * @returns {Array<object>} 需要一起软删除的流水行
 */
export function episodeCleanupRows(txns, pair, deletedId) {
  const list = (Array.isArray(txns) ? txns : []).slice().sort(compareAsc)
  const p = pair || {}
  if (!p.mainId && !p.backId && !p.positiveId && !p.negativeId) return []

  const deleted = list.find((t) => t.id === deletedId)
  if (!deleted) return []

  const isMain = deleted.category_id === p.mainId
  const isBack = deleted.category_id === p.backId
  if (!isMain && !isBack) return []

  const deltaOf = (t) => {
    const amt = Number(t && t.amount_cents) || 0
    if (amt <= 0) return 0
    const cid = t && t.category_id
    if (cid === p.mainId) return amt
    if (cid === p.backId) return -amt
    if (cid === p.positiveId) return -amt
    if (cid === p.negativeId) return amt
    return 0
  }

  let balance = 0
  let start = 0
  for (let i = 0; i < list.length; i++) {
    if (balance === 0) start = i
    balance += deltaOf(list[i])
    if (balance !== 0) continue

    // 一段余额回到 0 的结清批次 [start, i]
    const seg = list.slice(start, i + 1)
    if (!seg.some((t) => t.id === deletedId)) continue

    const extras = seg.filter((t) => t.id !== deletedId)
    const isAdjustment = (t) => t.category_id === p.positiveId || t.category_id === p.negativeId
    if (isBack) return extras.filter(isAdjustment)
    // 删本金：本批次的收回/归还 + 差额一起删；其余本金保留
    return extras.filter((t) => t.category_id === p.backId || isAdjustment(t))
  }

  // 被删流水所在段没有归零（没结清）→ 没有需要连带清理的差额/收回
  return []
}

/** 只取 id 的便捷包装（测试与调用方读日志用） */
export function episodeCleanupIds(txns, pair, deletedId) {
  return episodeCleanupRows(txns, pair, deletedId).map((t) => t.id)
}

/**
 * 查询并返回要连带删除的流水
 *
 * @param {object} txn getTransaction() 返回的行（含 category_name / note / id）
 * @returns {Promise<{ids:string[], accountIds:string[]}>}
 */
export async function findLoanCascade(txn) {
  const name = String((txn && txn.category_name) || '')
  const def = PAIRS[name]
  if (!def) return { ids: [], accountIds: [] }

  const person = String((txn && txn.note) || '').trim()
  if (!person) return { ids: [], accountIds: [] }

  const names = [def.main, def.back, def.positive, def.negative]
  const cats = await query(
    `SELECT id, name FROM category WHERE deleted_at IS NULL AND name IN (?,?,?,?)`,
    names
  )
  const byName = {}
  for (const c of cats) byName[c.name] = c.id

  const pair = {
    mainId: byName[def.main] || '',
    backId: byName[def.back] || '',
    positiveId: byName[def.positive] || '',
    negativeId: byName[def.negative] || ''
  }
  const ids = [pair.mainId, pair.backId, pair.positiveId, pair.negativeId].filter(Boolean)
  if (!pair.mainId || !pair.backId) return { ids: [], accountIds: [] }

  const rows = await query(
    `SELECT id, category_id, amount_cents, occurred_at, created_at, account_id
     FROM txn
     WHERE deleted_at IS NULL AND TRIM(note) = ?
       AND category_id IN (${ids.map(() => '?').join(',')})`,
    [person, ...ids]
  )

  const cascade = episodeCleanupRows(rows, pair, txn.id)
  return {
    ids: cascade.map((t) => t.id),
    accountIds: Array.from(new Set(cascade.map((t) => t.account_id).filter(Boolean)))
  }
}
