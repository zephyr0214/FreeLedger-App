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

export async function getBudget(id) {
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
