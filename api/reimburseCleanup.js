/**
 * 删除报销单里的流水时，把整张单退回到「未报销」
 *
 * ★ 为什么要和借入借出同一套逻辑 ★
 *   一张报销单 = 一次结清：
 *     · 原始支出（本金）
 *     · 报销到账（真实资金流入）
 *     · 报销坏账 / 报销盈余（差额，只计收支）
 *   删掉「报销到账」或任意一笔原始支出后，这张单已经不再成立：
 *     · 到账 / 坏账 / 盈余必须一起删；
 *     · 其余原始支出退回「待报销」；
 *     · 单头软删除，已报销列表不再显示它。
 *   否则统计里会留下无主的损益，余额也会和报销状态对不上。
 *
 * ★ 为什么单独一个文件 ★
 *   api/transaction.js 不能 import api/reimburse.js（reimburse 反过来依赖它）。
 *   这里只依赖 db/index 与 schema。
 */

import { query } from './db/index.js'
import { REIMBURSE_CATEGORY_NAMES } from './db/schema.js'

const ARRIVAL = REIMBURSE_CATEGORY_NAMES.income.name
const ADJUSTMENTS = [
  REIMBURSE_CATEGORY_NAMES.badDebt.name,
  REIMBURSE_CATEGORY_NAMES.surplus.name
]

/**
 * 纯函数：根据单内全部流水，算出删除某一笔时要连带处理什么
 *
 * @param {object} txn 被删除的流水（至少 id / category_name / reimburse_status）
 * @param {Array<object>} rows 同一 batch 下未删除的流水
 * @returns {{deleteIds:string[], revertIds:string[], arrivalAccountId:string}|null}
 */
export function reimburseDeletePlan(txn, rows) {
  if (!txn || !txn.batch_id) return null
  const list = Array.isArray(rows) ? rows : []

  const isArrival = String(txn.category_name || '') === ARRIVAL
  const isOriginal = Number(txn.reimburse_status) === 2
  if (!isArrival && !isOriginal) return null

  const arrivals = list.filter((r) => String(r.category_name || '') === ARRIVAL)
  const adjustments = list.filter((r) => ADJUSTMENTS.includes(String(r.category_name || '')))
  const originals = list.filter((r) => Number(r.reimburse_status) === 2)

  const deleteIds = arrivals
    .map((r) => r.id)
    .concat(adjustments.map((r) => r.id))
    .filter((id) => id && id !== txn.id)

  const revertIds = originals
    .map((r) => r.id)
    .filter((id) => id && id !== txn.id)

  return {
    deleteIds: Array.from(new Set(deleteIds)),
    revertIds: Array.from(new Set(revertIds)),
    arrivalAccountId: arrivals.length > 0 ? (arrivals[0].account_id || '') : ''
  }
}

/**
 * 查询一张报销单，返回删除计划
 *
 * @param {object} txn getTransaction() 返回的行
 * @returns {Promise<{deleteIds:string[], revertIds:string[], arrivalAccountId:string}|null>}
 */
export async function findReimburseDeletePlan(txn) {
  if (!txn || !txn.batch_id) return null

  /*
   * 不依赖 reimburse_batch 单头是否存在：
   *   历史脏数据可能 batch_id 还在、单头已被删/迁移失败。
   *   只要流水还挂在这个 batch 上，就按同一套规则退回，
   *   单头 UPDATE 对不存在的行是 no-op。
   */
  const rows = await query(
    `SELECT t.id, t.account_id, t.reimburse_status, c.name AS category_name
     FROM txn t
     LEFT JOIN category c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL AND t.batch_id = ?`,
    [txn.batch_id]
  )

  return reimburseDeletePlan(txn, rows)
}
