/**
 * 周期管理 —— 周期性记账规则
 *
 * 一个「周期」是一笔会重复发生的交易模板：
 *   - 每天 / 每周周几 / 每月几号 触发一次
 *   - 类型可以是 支出 / 收入 / 转账
 *   - 每次触发会往 txn 表里记一笔，txn.cycle_id 指向这个周期
 *
 * ★ 不是「自动生成流水」★
 *   周期只是模板；用户点「记一笔」才落一笔（创建周期时会先记第一笔）。
 *   这样用户对「什么时候记、记几次」有完全控制权。
 */

import { query, queryOne, execute, transaction } from './db/index.js'
import { createTransaction, listTransactions } from './transaction.js'
import { prefixedId } from '../utils/id.js'
import { toDayKey, parseDayKey, clampDayOfMonth, toMonthKey } from '../utils/date.js'

export const CYCLE_RECURRENCES = [
  { key: 'daily', name: '每天' },
  { key: 'weekly', name: '每周' },
  { key: 'monthly', name: '每月' }
]

/** 周几中文（1=周一 … 7=周日） */
const WEEKDAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

export async function listCycles() {
  const rows = await query('SELECT * FROM cycle WHERE deleted_at IS NULL ORDER BY created_at ASC')
  return rows.map(normalizeCycle)
}

export async function getCycle(id) {
  const row = await queryOne('SELECT * FROM cycle WHERE id = ? AND deleted_at IS NULL', [id])
  return row ? normalizeCycle(row) : null
}

function normalizeCycle(row) {
  return {
    ...row,
    amount_cents: Number(row.amount_cents) || 0,
    weekday: row.weekday ? Number(row.weekday) : null,
    day_of_month: row.day_of_month ? Number(row.day_of_month) : null
  }
}

/** 周期的触发描述，如「每天」「每周三」「每月15号」 */
export function recurrenceLabel(cycle) {
  if (!cycle) return ''
  if (cycle.recurrence === 'daily') return '每天'
  if (cycle.recurrence === 'weekly') {
    const w = Number(cycle.weekday) || 1
    return `每周${WEEKDAY_NAMES[w] || '一'}`
  }
  const d = Number(cycle.day_of_month) || 1
  return `每月${d}号`
}

/**
 * 校验周期输入
 */
function validateCycle(input) {
  if (!['expense', 'income', 'transfer'].includes(input.type)) throw new Error('周期类型不正确')
  if (!(Number(input.amount_cents) > 0)) throw new Error('周期金额必须大于 0')
  if (!input.account_id) throw new Error('周期必须指定账户')
  if (input.type === 'transfer') {
    if (!input.to_account_id) throw new Error('转账周期必须指定转入账户')
    if (input.to_account_id === input.account_id) throw new Error('转入账户不能与转出相同')
  } else if (!input.category_id) {
    throw new Error('周期必须指定分类')
  }
  if (!['daily', 'weekly', 'monthly'].includes(input.recurrence)) throw new Error('周期规则不正确')
  if (input.recurrence === 'weekly' && !(Number(input.weekday) >= 1 && Number(input.weekday) <= 7)) {
    throw new Error('每周周期必须指定周几')
  }
  if (input.recurrence === 'monthly' && !(Number(input.day_of_month) >= 1 && Number(input.day_of_month) <= 31)) {
    throw new Error('每月周期必须指定几号')
  }
}

/**
 * 新建周期，并记下第一笔流水。
 *
 * @returns {{ cycle: object, txn: object }}
 */
export async function createCycle(input) {
  validateCycle(input)

  const now = Date.now()
  const id = input.id || prefixedId('cyc')

  await execute(
    `INSERT INTO cycle (
      id, type, amount_cents, account_id, to_account_id, category_id, note,
      recurrence, weekday, day_of_month, created_at, updated_at, deleted_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
    [
      id,
      input.type,
      Math.round(Number(input.amount_cents)),
      input.account_id,
      input.type === 'transfer' ? input.to_account_id : null,
      input.type === 'transfer' ? null : (input.category_id || null),
      input.note || '',
      input.recurrence,
      input.recurrence === 'weekly' ? (Number(input.weekday) || 1) : null,
      input.recurrence === 'monthly' ? (Number(input.day_of_month) || 1) : null,
      now,
      now
    ]
  )

  const txn = await recordCycle(id)
  return { cycle: await getCycle(id), txn }
}

/**
 * 更新周期（只改规则，不动已产生的流水）。
 */
export async function updateCycle(id, patch) {
  const existing = await getCycle(id)
  if (!existing) throw new Error('周期不存在')

  const merged = { ...existing, ...patch }
  validateCycle(merged)

  const fields = []
  const params = []
  const assign = (col, val) => { fields.push(`${col} = ?`); params.push(val) }

  if (patch.type !== undefined) assign('type', patch.type)
  if (patch.amount_cents !== undefined) assign('amount_cents', Math.round(Number(patch.amount_cents)))
  if (patch.account_id !== undefined) assign('account_id', patch.account_id)
  if (patch.to_account_id !== undefined) assign('to_account_id', patch.type === 'transfer' ? patch.to_account_id : null)
  if (patch.category_id !== undefined) assign('category_id', patch.type === 'transfer' ? null : patch.category_id)
  if (patch.note !== undefined) assign('note', patch.note || '')
  if (patch.recurrence !== undefined) assign('recurrence', patch.recurrence)
  if (patch.weekday !== undefined) assign('weekday', patch.recurrence === 'weekly' ? (Number(patch.weekday) || 1) : null)
  if (patch.day_of_month !== undefined) assign('day_of_month', patch.recurrence === 'monthly' ? (Number(patch.day_of_month) || 1) : null)
  assign('updated_at', Date.now())
  params.push(id)

  await execute(`UPDATE cycle SET ${fields.join(', ')} WHERE id = ?`, params)
  return getCycle(id)
}

/**
 * 删除周期（软删除）。已产生的流水保留，只是不再关联新流水。
 */
export async function deleteCycle(id) {
  await execute('UPDATE cycle SET deleted_at = ?, updated_at = ? WHERE id = ?', [Date.now(), Date.now(), id])
  return true
}

/**
 * 记一笔：按周期规则生成一笔流水，日期落在「下一次触发日」（今天算起）。
 *
 * ★ 日期只精确到「日」★
 *   周期是「每天 / 每周几 / 每月几号」这类规则，没有具体时刻，
 *   所以流水时刻用当天的中午 12:00（和「只传日期」的记账规则一致）。
 */
export async function recordCycle(id) {
  const c = await getCycle(id)
  if (!c) throw new Error('周期不存在')

  const day = nextOccurrence(c)
  return createTransaction({
    type: c.type,
    amount_cents: c.amount_cents,
    account_id: c.account_id,
    to_account_id: c.type === 'transfer' ? c.to_account_id : null,
    category_id: c.type === 'transfer' ? null : c.category_id,
    note: c.note || '',
    occurred_day: day,
    source: 'cycle',
    cycle_id: id
  })
}

/**
 * 下一次触发日（从今天起，含今天）。
 * 返回 YYYY-MM-DD。
 */
export function nextOccurrence(cycle) {
  const today = parseDayKey(toDayKey())
  const y = today.getFullYear()
  const m = today.getMonth()
  const d = today.getDate()

  if (cycle.recurrence === 'daily') return toDayKey(today)

  if (cycle.recurrence === 'weekly') {
    const target = (Number(cycle.weekday) || 1) % 7 // 1=周一…7=周日 → JS getDay 0=周日
    let diff = (target - today.getDay() + 7) % 7
    const next = new Date(y, m, d + diff)
    return toDayKey(next)
  }

  // monthly
  const dayOfMonth = clampDayOfMonth(y, m + 1, Number(cycle.day_of_month) || 1)
  if (dayOfMonth >= d) return toDayKey(new Date(y, m, dayOfMonth))
  // 下个月
  const ny = m === 11 ? y + 1 : y
  const nm = m === 11 ? 0 : m + 1
  return toDayKey(new Date(ny, nm, clampDayOfMonth(ny, nm + 1, Number(cycle.day_of_month) || 1)))
}

/**
 * 每个周期的已记笔数（用于列表展示「N 笔」）。
 *
 * @returns {Promise<Record<string, number>>} cycleId -> 笔数
 */
export async function listCycleCounts() {
  const rows = await query(
    `SELECT cycle_id, COUNT(*) AS c FROM txn
     WHERE deleted_at IS NULL AND cycle_id IS NOT NULL
     GROUP BY cycle_id`
  )
  const map = {}
  rows.forEach((r) => { map[r.cycle_id] = Number(r.c) })
  return map
}

/**
 * 某周期的全部流水（按时间倒序）。
 */
export async function listCycleTxns(cycleId, opt = {}) {
  return listTransactions({ cycleId, ...opt })
}

/**
 * 某周期最近的流水（详情页用，默认 10 条）。
 */
export async function listRecentCycleTxns(cycleId, limit = 10) {
  return listTransactions({ cycleId, limit })
}

/**
 * 某周期已记流水的总笔数（详情页「已记 N 笔」用，避免拉全量）。
 */
export async function countCycleTxns(cycleId) {
  const row = await queryOne(
    'SELECT COUNT(*) AS c FROM txn WHERE deleted_at IS NULL AND cycle_id = ?',
    [cycleId]
  )
  return row ? Number(row.c) : 0
}

export { toMonthKey }
