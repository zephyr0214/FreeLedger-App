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
import { toDayKey, parseDayKey, clampDayOfMonth, toMonthKey, shiftDay } from '../utils/date.js'

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
 * 新建周期。
 *
 * ★ 不立刻记第一笔 ★
 *   账户/用户可能只是先建好模板，当天（或这个月）并不想立刻落账。
 *   是否立刻记，由调用方（CyclePanel）按规则弹窗询问。
 *   游标初始化为今天 —— 创建当天按规则若「本就该发生」（如每天、或周/月恰好是当天），
 *   会在弹窗里询问用户；历史日期一概不回补。
 *
 * @returns {object} 新建的周期
 */
export async function createCycle(input) {
  validateCycle(input)

  const now = Date.now()
  const id = input.id || prefixedId('cyc')

  await execute(
    `INSERT INTO cycle (
      id, type, amount_cents, account_id, to_account_id, category_id, note,
      recurrence, weekday, day_of_month, created_at, updated_at, deleted_at,
      last_caught_up_day
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)`,
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
      now,
      toDayKey() // 游标初始化为今天：创建当天是否记，交给弹窗决定；历史不回补
    ]
  )

  return getCycle(id)
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

/**
 * 某个发生日是否落在该周期内（用于「新建/编辑时今天是否该记一笔」判断）。
 * @param {object} cycle 周期对象
 * @param {string} day YYYY-MM-DD
 * @returns {boolean}
 */
export function occursOnDay(cycle, day) {
  const days = occurrencesInRange(cycle, day, day)
  return days.length === 1 && days[0] === day
}

/**
 * 返回 YYYY-MM-DD 数组（升序）。
 *
 * ★ 纯本地日期运算，不碰数据库、不联网 ★
 *   daily   ：区间内每一天
 *   weekly  ：区间内所有 = 目标周几 的那天
 *   monthly ：区间内每个月的 day_of_month（用 clampDayOfMonth 兜 31 号）
 *
 * @param {object} cycle 周期对象（recurrence / weekday / day_of_month）
 * @param {string} startDay YYYY-MM-DD 含
 * @param {string} endDay   YYYY-MM-DD 含
 */
export function occurrencesInRange(cycle, startDay, endDay) {
  const out = []
  const start = parseDayKey(startDay)
  const end = parseDayKey(endDay)
  if (!start || !end || end < start) return out

  const rec = cycle.recurrence
  const weekday = (Number(cycle.weekday) || 1) % 7 // 1=周一…7=周日 → JS getDay 0=周日
  const dom = Number(cycle.day_of_month) || 1

  // 逐日扫描区间（区间最多几十/几百天，JS 循环成本可忽略）
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  while (cur <= end) {
    const y = cur.getFullYear()
    const m = cur.getMonth()
    const d = cur.getDate()
    let hit = false
    if (rec === 'daily') {
      hit = true
    } else if (rec === 'weekly') {
      hit = cur.getDay() === weekday
    } else if (rec === 'monthly') {
      hit = d === clampDayOfMonth(y, m + 1, dom)
    }
    if (hit) out.push(toDayKey(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

/**
 * 按指定发生日给周期记一笔（日期精确落到 day，而不是「今天」）。
 *
 * ★ 与 recordCycle 的区别 ★
 *   自动补记要把 occurred_day 设成「应该发生的那天」（比如 10-15 的房租，
 *   用户在 10-20 打开才补记，occurred_day 仍应是 2026-10-15，而非今天）。
 */
export async function recordCycleForDay(id, day) {
  const c = await getCycle(id)
  if (!c) throw new Error('周期不存在')
  return createTransaction({
    type: c.type,
    amount_cents: c.amount_cents,
    account_id: c.account_id,
    to_account_id: c.type === 'transfer' ? c.to_account_id : null,
    category_id: c.type === 'transfer' ? null : c.category_id,
    note: c.note || '',
    occurred_day: day,
    cycle_id: id
  })
}

/** 查询某周期在某天是否已记过（按 occurred_day 存在性，天然幂等） */
async function cycleHasTxnOn(cycleId, day) {
  const row = await queryOne(
    `SELECT 1 AS hit FROM txn
     WHERE deleted_at IS NULL AND cycle_id = ? AND occurred_day = ? LIMIT 1`,
    [cycleId, day]
  )
  return Boolean(row)
}

/**
 * 把某一天标记为「用户不要」。
 *
 * ★ 什么时候调用 ★
 *   1. 建周期时用户选「本天先不记一笔」
 *   2. 用户主动删掉某笔由周期产生的流水
 *   这两次都是明确表达「这一天不要再补」，记下来以后就永久跳过。
 *
 * ★ 为什么不用「查软删的 txn」代替 ★
 *   软删的 txn 在用户新建周期/改周期后可能被清理，
 *   而且「本天先不记」根本没有产生 txn 可以删。
 *   单独一张 cycle_skip 表语义更明确，也不会被别的清理逻辑误伤。
 *
 * @param {string} cycleId
 * @param {string} day YYYY-MM-DD
 */
export async function skipCycleDay(cycleId, day) {
  if (!cycleId || !day) return
  try {
    await execute(
      'INSERT OR IGNORE INTO cycle_skip (cycle_id, day, created_at) VALUES (?,?,?)',
      [cycleId, day, Date.now()]
    )
  } catch (e) {
    console.warn('[cycle] 记录跳过日失败:', cycleId, day, e && e.message)
  }
}

/** 某周期在某天是否被用户标记为「不要」 */
async function cycleSkippedOn(cycleId, day) {
  try {
    const row = await queryOne(
      'SELECT 1 AS hit FROM cycle_skip WHERE cycle_id = ? AND day = ? LIMIT 1',
      [cycleId, day]
    )
    return Boolean(row)
  } catch (e) {
    // 表还没建（老版本库）时按「没跳过」处理，不影响补记主流程
    return false
  }
}

/** 读取某周期的全部跳过日（补记时一次性取出来，避免逐日查库） */
async function listCycleSkips(cycleId) {
  try {
    const rows = await query(
      'SELECT day FROM cycle_skip WHERE cycle_id = ?',
      [cycleId]
    )
    return new Set(rows.map((r) => r.day))
  } catch (e) {
    return new Set()
  }
}

/**
 * 打开 App 时跑：把所有周期「漏掉的发生日」补齐。
 *
 * ★ 游标做法（幂等 + 不重建已删的账）★
 *   每个周期有 last_caught_up_day（游标），创建时初始化为今天、
 *   每次 catchUp 结束推到今天。
 *   本次处理区间 = (游标, 今天]，即「晚于游标、且含今天」的部分。
 *   这样：
 *     - 同一天多次进 app：第二次游标已是今天，区间为空，不重复记；
 *     - 用户手动删掉某条自动补的账：那天已 <= 游标，不会重建。
 *
 * ★ 补全部漏掉的（不是只补当前这次）★
 *   若 app 两个月没打开，每月周期会一次性补记那两个月里所有发生日；
 *   每天周期一周没打开，会补记 7 条。
 *
 * ★ 防重复的第二道保险 ★
 *   即便游标异常，写入前仍按 occurred_day 查重（cycleHasTxnOn），绝不产生重复账。
 *
 * ★ 安全上限 ★
 *   单个周期单次最多补 MAX_CATCHUP_PER_CYCLE 条，防止极端断更
 *   （如一年没开 + 每天周期）刷出几百条。达到上限后游标仍推到今天，
 *   剩余「历史空缺」不再追溯（极端情况，可接受）。
 *
 * @returns {{ cycleId: string, added: number }[]} 每个周期补记了几条
 */
export const MAX_CATCHUP_PER_CYCLE = 90

export async function catchUpCycles(today = toDayKey()) {
  const cycles = await listCycles()
  const result = []

  for (const c of cycles) {
    // 处理起点：游标次日（严格晚于游标），游标为空兜底为今天
    const start = c.last_caught_up_day && c.last_caught_up_day < today
      ? shiftDay(c.last_caught_up_day, 1)
      : today
    const days = occurrencesInRange(c, start, today)
    if (days.length === 0) {
      // 没有待处理的发生日，也要推进游标（避免空区间后游标永远滞后）
      await execute('UPDATE cycle SET last_caught_up_day = ? WHERE id = ?', [today, c.id])
      continue
    }

    let added = 0
    // 一次性取出该周期的跳过日，避免逐日查库
    const skipped = await listCycleSkips(c.id)
    for (const d of days) {
      if (added >= MAX_CATCHUP_PER_CYCLE) break
      /*
       * ★ 用户明确说过「这天不要」，就永远不补 ★
       *   两种情况会写进 cycle_skip：
       *     · 建周期时选「本天先不记」
       *     · 用户主动删掉了这天由周期产生的流水
       *   不加这个判断的话，用户删一次、下次进 App 又补回来，
       *   删多少次都没用 —— 这正是反馈里的 bug。
       */
      if (skipped.has(d)) continue
      const has = await cycleHasTxnOn(c.id, d)
      if (has) continue
      try {
        await recordCycleForDay(c.id, d)
        added++
      } catch (e) {
        console.warn('[cycle] catchUp 记一笔失败:', c.id, d, e && e.message)
      }
    }

    // 推进游标到今天
    await execute('UPDATE cycle SET last_caught_up_day = ? WHERE id = ?', [today, c.id])
    if (added > 0) result.push({ cycleId: c.id, added })
  }

  return result
}

export { toMonthKey }
