/**
 * 预算服务
 */

import { query, queryOne, execute } from './db/index.js'
import { prefixedId } from '../utils/id.js'
import { toMonthKey } from '../utils/date.js'

export async function listBudgets() {
  const rows = await query('SELECT * FROM budget ORDER BY scope ASC, amount_cents DESC')
  return rows.map(normalizeBudget)
}

async function getBudget(id) {
  const row = await queryOne('SELECT * FROM budget WHERE id = ?', [id])
  return row ? normalizeBudget(row) : null
}

function normalizeBudget(row) {
  return {
    ...row,
    amount_cents: Number(row.amount_cents) || 0,
    rollover: Number(row.rollover) === 1
  }
}

export async function createBudget(input) {
  if (!(Number(input.amount_cents) > 0)) throw new Error('预算金额必须大于 0')
  if (input.scope === 'category' && !input.category_id) throw new Error('分类预算必须指定分类')

  const now = Date.now()
  const id = input.id || prefixedId('bud')
  const startMonth = input.start_month || toMonthKey()

  // 同类预算只保留一条，先删旧的
  if (input.scope === 'category') {
    await execute('DELETE FROM budget WHERE scope = ? AND category_id = ?', ['category', input.category_id])
  } else {
    await execute('DELETE FROM budget WHERE scope = ?', ['total'])
  }

  await execute(
    `INSERT INTO budget (id, scope, category_id, period, amount_cents, start_month, rollover, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.scope || 'total',
      input.category_id || null,
      input.period || 'month',
      Math.round(Number(input.amount_cents)),
      startMonth,
      input.rollover ? 1 : 0,
      now,
      now
    ]
  )
  return getBudget(id)
}

export async function updateBudget(id, patch) {
  const existing = await getBudget(id)
  if (!existing) throw new Error('预算不存在')

  const fields = []
  const params = []
  const assign = (col, val) => { fields.push(`${col} = ?`); params.push(val) }

  if (patch.amount_cents !== undefined) {
    if (!(Number(patch.amount_cents) > 0)) throw new Error('预算金额必须大于 0')
    assign('amount_cents', Math.round(Number(patch.amount_cents)))
  }
  if (patch.rollover !== undefined) assign('rollover', patch.rollover ? 1 : 0)
  if (patch.start_month !== undefined) assign('start_month', patch.start_month)
  assign('updated_at', Date.now())
  params.push(id)

  await execute(`UPDATE budget SET ${fields.join(', ')} WHERE id = ?`, params)
  return getBudget(id)
}

export async function deleteBudget(id) {
  await execute('DELETE FROM budget WHERE id = ?', [id])
  return true
}

/* ------------------------------------------------------------ 额度分配 */

/**
 * 算「总预算 → 分类预算」的额度分配情况。
 *
 * ★ 分类预算是总预算的子额度，不是独立的额度 ★
 *   用户反馈：「分类预算不是独立的啊，
 *   应该是本月总预算下设的分类预算」。
 *   也就是说分类预算的额度是从总预算里「分配」出去的，
 *   所以：
 *     - 已分配合计 = 所有分类预算的额度之和
 *     - 未分配额度 = 总预算 - 已分配合计
 *     - 已分配合计 > 总预算 -> 超额分配（红色提示）
 *
 * ★ 不改数据库结构 ★
 *   budget 表的 scope 字段本来就能区分 total / category，
 *   这里只是在内存里做一次汇总，不需要迁移。
 *
 * @param {Array<Object>} usages getBudgetUsage / getBudgetUsageRange 的返回值
 * @returns {{
 *   hasTotal: boolean,
 *   totalLimit: number,
 *   allocated: number,
 *   unallocated: number,
 *   overAllocated: boolean,
 *   allocatedPercent: number
 * }}
 */
export function summarizeAllocation(usages) {
  const list = Array.isArray(usages) ? usages : []

  const total = list.find((b) => b.scope === 'total') || null
  const categories = list.filter((b) => b.scope === 'category')

  const totalLimit = total ? Number(total.limit) || 0 : 0
  const allocated = categories.reduce((sum, b) => sum + (Number(b.limit) || 0), 0)

  // 没有总预算时，「未分配」无从谈起（没有可分配的池子）
  const unallocated = total ? totalLimit - allocated : 0
  const overAllocated = !!total && allocated > totalLimit
  const allocatedPercent = totalLimit > 0
    ? Math.round((allocated / totalLimit) * 1000) / 10
    : 0

  return {
    hasTotal: !!total,
    totalLimit,
    allocated,
    unallocated,
    overAllocated,
    allocatedPercent
  }
}

/**
 * 校验「新增 / 修改一个分类预算」会不会超出总预算。
 *
 * ★ 只提示，不硬拦 ★
 *   用户可能有自己的理由（比如先按旧额度设好，之后再调总预算），
 *   所以这里只算出「会不会超」，由 UI 弹窗问用户，
 *   用户确认后照样能保存。
 *
 * @param {Array<Object>} usages 当前的预算用量列表
 * @param {number} newLimit    这次要设的额度（分）
 * @param {string} [excludeId] 要排除的预算 id（修改已有预算时排除它自己）
 * @returns {{
 *   hasTotal: boolean,
 *   wouldOver: boolean,
 *   allocated: number,
 *   newTotal: number,
 *   totalLimit: number,
 *   overflow: number
 * }}
 */
export function checkCategoryAllocation(usages, newLimit, excludeId) {
  const list = (Array.isArray(usages) ? usages : []).filter(
    (b) => b.scope === 'category' && b.id !== excludeId
  )
  const total = (Array.isArray(usages) ? usages : []).find((b) => b.scope === 'total') || null

  const allocated = list.reduce((sum, b) => sum + (Number(b.limit) || 0), 0)
  const totalLimit = total ? Number(total.limit) || 0 : 0
  const amount = Number(newLimit) || 0
  const newTotal = allocated + amount

  return {
    hasTotal: !!total,
    wouldOver: !!total && newTotal > totalLimit,
    allocated,
    newTotal,
    totalLimit,
    overflow: total && newTotal > totalLimit ? newTotal - totalLimit : 0
  }
}
