/**
 * 交易服务
 *
 * ★ 核心约束 ★
 *   1. 金额恒为正数存 amount_cents，方向由 type 决定
 *   2. transfer 同时影响两个账户，必须在同一事务里 recalc 两端
 *   3. 信用卡还款必须记为 transfer（credit → debit），不能记为 expense
 *   4. 所有写操作都在事务内完成余额重算，绝不出现"交易写进去了余额没动"
 */

import { query, queryOne, execute, transaction } from './db/index.js'
import { prefixedId } from '../utils/id.js'
import { makeDateKeys, toDayKey, toMonthKey, monthRange } from '../utils/date.js'
import { recalcBalance, writeTodaySnapshot } from './account.js'

export const TXN_TYPES = [
  { key: 'expense',  name: '支出' },
  { key: 'income',   name: '收入' },
  { key: 'transfer', name: '转账' }
]

export const TXN_SOURCES = {
  manual: '手动',
  quick: '速记',
  import: '导入',
  recurring: '周期'
}

/** 用于「最近交易」等场景的最大返回数 */
const MAX_PAGE_SIZE = 500

/* ------------------------------------------------------------------ 查询 */

function normalizeTxn(row) {
  return {
    ...row,
    amount_cents: Number(row.amount_cents) || 0,
    occurred_at: Number(row.occurred_at) || 0,
    tz_offset: Number(row.tz_offset) || 480,
    /** 这笔是否不计入预算 */
    exclude_from_budget: Number(row.exclude_from_budget) === 1,
    tag_ids: row.tag_ids ? String(row.tag_ids).split(',').filter(Boolean) : []
  }
}

/**
 * 分类过滤条件
 *
 * 两种口径：
 *   1. 精确匹配（默认）    —— t.category_id = ?
 *   2. 含子分类（一级分类） —— t.category_id IN (SELECT id FROM category
 *                                          WHERE id = ? OR parent_id = ?)
 *
 * ★ 为什么用子查询而不是在 JS 里展开 id 列表 ★
 *   展开需要先查出所有二级 id 再拼 IN (?,?,?...)，
 *   SQL 文本会随分类数量变长，两级以外的层级将来还得改。
 *   子查询把「这个分类和它的直接子分类」交给数据库算。
 *
 * ★ SQLite 兼容性 ★
 *   只用了最基础的 SELECT + IN 子查询，
 *   没有 MySQL 方言（没有 DAY()/MONTH()/YEAR()），
 *   也不依赖 3.24+ 的特性，Android 各版本内置内核都能跑。
 *
 * @param {string} categoryId
 * @param {boolean} includeSubcategories
 * @returns {{sql:string, params:any[]}|null}
 */
export function buildCategoryCondition(categoryId, includeSubcategories) {
  if (!categoryId) return null
  if (includeSubcategories) {
    return {
      sql: 't.category_id IN (SELECT id FROM category WHERE id = ? OR parent_id = ?)',
      params: [categoryId, categoryId]
    }
  }
  return { sql: 't.category_id = ?', params: [categoryId] }
}

/**
 * 交易过滤条件 -> WHERE 片段
 *
 * listTransactions 与 sumTransactions 共用同一份，
 * 保证「列表」和「合计」口径永远一致（否则汇总数字会和列表对不上）。
 */
function buildFilterWhere(opt = {}) {
  const {
    monthKey, startDay, endDay, type, accountId, categoryId,
    includeSubcategories, tagId, keyword, minCents, maxCents
  } = opt

  const where = ['t.deleted_at IS NULL']
  const params = []

  if (monthKey) { where.push('t.month_key = ?'); params.push(monthKey) }
  if (startDay) { where.push('t.occurred_day >= ?'); params.push(startDay) }
  if (endDay) { where.push('t.occurred_day <= ?'); params.push(endDay) }
  if (type && type !== 'all') { where.push('t.type = ?'); params.push(type) }
  if (accountId) {
    where.push('(t.account_id = ? OR t.to_account_id = ?)')
    params.push(accountId, accountId)
  }
  const catCond = buildCategoryCondition(categoryId, includeSubcategories)
  if (catCond) {
    where.push(catCond.sql)
    params.push(...catCond.params)
  }
  if (keyword) {
    where.push('(t.note LIKE ? OR t.raw_text LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`)
  }
  if (minCents !== undefined && minCents !== null) { where.push('t.amount_cents >= ?'); params.push(Number(minCents)) }
  if (maxCents !== undefined && maxCents !== null) { where.push('t.amount_cents <= ?'); params.push(Number(maxCents)) }

  // 标签过滤需要子查询
  if (tagId) {
    where.push('EXISTS (SELECT 1 FROM txn_tag tt WHERE tt.txn_id = t.id AND tt.tag_id = ?)')
    params.push(tagId)
  }

  return { where, params }
}

/**
 * URL query -> 交易列表的筛选条件
 *
 * ★ 页面参数全是字符串 ★
 *   uni-app 的 onLoad(options) 里每个值都是字符串，
 *   "1" !== true、"" !== undefined，
 *   所以这里统一做类型转换与合法性校验，
 *   非法值一律当作「没传」，不把脏数据带进查询。
 *
 * 契约（账户详情 / 分类 / 标签 / 预算页点「全部」时带上）：
 *   accountId            按账户筛选
 *   categoryId           按分类筛选（一级或二级都行）
 *   includeSubcategories "1" 时表示 categoryId 是一级分类，匹配其所有二级
 *   tagId                按标签筛选
 *   monthKey             按月份筛选，YYYY-MM
 *   day                  按某一天筛选，YYYY-MM-DD（首页日历深链）
 *   type                 expense | income | transfer
 *
 * @param {object} options
 * @returns {object} 归一化后的筛选条件
 */
export function parseTxnQueryOptions(options = {}) {
  const opt = options || {}

  const str = (v) => (v === undefined || v === null ? '' : String(v).trim())

  const typeRaw = str(opt.type).toLowerCase()
  const type = ['expense', 'income', 'transfer'].includes(typeRaw) ? typeRaw : 'all'

  const accountId = str(opt.accountId)
  const categoryId = str(opt.categoryId)
  const tagId = str(opt.tagId)

  const monthKeyRaw = str(opt.monthKey)
  // 月份必须是真实的月份（01-12），'2026-13' 这种要被挡掉
  const monthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthKeyRaw) ? monthKeyRaw : ''

  const dayRaw = str(opt.day)
  // 日期要存在且格式正确
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayRaw) && isRealDay(dayRaw) ? dayRaw : ''

  const includeSubcategories = parseBoolFlag(opt.includeSubcategories)

  return {
    type,
    accountId,
    categoryId,
    tagId,
    monthKey,
    day,
    includeSubcategories,
    /**
     * 是否带了「筛选类」参数。
     * 带了就说明是从详情页跳进来的（要的是「该筛选条件下的全部流水」），
     * 页面据此把时间范围放宽到全部时间，
     * 否则用户会只看到当月那几笔。
     */
    hasFilter: Boolean(accountId || categoryId || tagId || type !== 'all')
  }
}

/** URL 上的布尔标记：1 / true / yes / on 都算真 */
function parseBoolFlag(v) {
  if (v === undefined || v === null) return false
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

/** YYYY-MM-DD 是不是一个真实存在的日期（挡掉 2026-02-30 这种） */
function isRealDay(dayKey) {
  const [y, m, d] = String(dayKey).split('-').map(Number)
  if (!y || !m || !d) return false
  if (m < 1 || m > 12) return false
  if (d < 1 || d > 31) return false
  return d <= new Date(y, m, 0).getDate()
}

/**
 * 通用列表查询
 * @param {object} opt
 *   monthKey / startDay / endDay / type / accountId / categoryId / tagId
 *   includeSubcategories / keyword / minCents / maxCents / limit / offset / withTags
 */
export async function listTransactions(opt = {}) {
  const { limit = 50, offset = 0, withTags = true } = opt

  const { where, params } = buildFilterWhere(opt)

  const size = Math.min(Number(limit) || 50, MAX_PAGE_SIZE)
  params.push(size, Number(offset) || 0)

  const sql = `
    SELECT t.*,
           a.name  AS account_name,
           a.icon  AS account_icon,
           a.color AS account_color,
           a.type  AS account_type,
           ta.name AS to_account_name,
           c.name  AS category_name,
           c.icon  AS category_icon,
           c.color AS category_color,
           c.parent_id AS category_parent_id,
           ${withTags ? "(SELECT GROUP_CONCAT(tt.tag_id) FROM txn_tag tt WHERE tt.txn_id = t.id)" : "''"} AS tag_ids
    FROM txn t
    LEFT JOIN account  a  ON a.id = t.account_id
    LEFT JOIN account  ta ON ta.id = t.to_account_id
    LEFT JOIN category c  ON c.id = t.category_id
    WHERE ${where.join(' AND ')}
    ORDER BY t.occurred_at DESC, t.created_at DESC
    LIMIT ? OFFSET ?`

  const rows = await query(sql, params)
  return rows.map(normalizeTxn)
}

/**
 * 当前筛选条件下的合计（笔数 + 收支）
 *
 * 与 listTransactions 共用 buildFilterWhere，
 * 所以「含子分类」这类条件两边口径完全一致。
 */
export async function sumTransactions(opt = {}) {
  const { where, params } = buildFilterWhere(opt)

  const row = await queryOne(
    `SELECT COUNT(*) AS cnt,
            COALESCE(SUM(CASE WHEN t.type='expense'  THEN t.amount_cents ELSE 0 END),0) AS expense,
            COALESCE(SUM(CASE WHEN t.type='income'   THEN t.amount_cents ELSE 0 END),0) AS income,
            COALESCE(SUM(CASE WHEN t.type='transfer' THEN t.amount_cents ELSE 0 END),0) AS transfer
     FROM txn t WHERE ${where.join(' AND ')}`,
    params
  )

  return {
    count: Number(row ? row.cnt : 0),
    expense: Number(row ? row.expense : 0),
    income: Number(row ? row.income : 0),
    transfer: Number(row ? row.transfer : 0)
  }
}

export async function getTransaction(id) {
  const rows = await query(
    `SELECT t.*,
            a.name AS account_name, a.icon AS account_icon, a.type AS account_type,
            ta.name AS to_account_name,
            c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            (SELECT GROUP_CONCAT(tt.tag_id) FROM txn_tag tt WHERE tt.txn_id = t.id) AS tag_ids
     FROM txn t
     LEFT JOIN account  a  ON a.id = t.account_id
     LEFT JOIN account  ta ON ta.id = t.to_account_id
     LEFT JOIN category c  ON c.id = t.category_id
     WHERE t.id = ? AND t.deleted_at IS NULL`,
    [id]
  )
  return rows.length > 0 ? normalizeTxn(rows[0]) : null
}

/** 今日交易（首页最近交易） */
export async function listTodayTransactions(limit = 20) {
  return listTransactions({ startDay: toDayKey(), endDay: toDayKey(), limit })
}

/** 最近 N 笔（今日为空时的回退） */
export async function listRecentTransactions(limit = 5) {
  return listTransactions({ limit })
}

/** 某月按天聚合（月历用，一次查询） */
export async function getDailyTotals(monthKey) {
  const rows = await query(
    `SELECT occurred_day,
            COALESCE(SUM(CASE WHEN type='expense' THEN amount_cents ELSE 0 END),0) AS exp,
            COALESCE(SUM(CASE WHEN type='income'  THEN amount_cents ELSE 0 END),0) AS inc,
            COUNT(*) AS cnt
     FROM txn
     WHERE month_key = ? AND deleted_at IS NULL
     GROUP BY occurred_day
     ORDER BY occurred_day ASC`,
    [monthKey]
  )
  const map = {}
  for (const r of rows) {
    map[r.occurred_day] = {
      expense: Number(r.exp) || 0,
      income: Number(r.inc) || 0,
      count: Number(r.cnt) || 0
    }
  }
  return map
}

/* ------------------------------------------------------------------ 写入 */

/**
 * 决定一笔交易的实际发生时刻
 *
 * ★ 为什么不再用 T12:00:00 ★
 *   之前只传日期时写死当天 12:00，结果所有记录的时间都显示「12:00」，
 *   看不出哪笔先哪笔后。现在改成：
 *   - 传了 occurred_at      → 用它（精确到分）
 *   - 只传 occurred_day     → 当天的**当前时刻**（今天记就是此刻）
 *   - 两者都没传            → 此刻
 *
 * 只有当 occurred_day 是过去的日子时，才没有「当前时刻」可言，
 * 这时取当天 12:00 作为中性值（不会因为时区/夏令时偏移到前后一天）。
 *
 * @param {object} input
 * @param {number} fallbackMs 兜底时刻
 * @returns {Date}
 */
export function resolveOccurredTime(input = {}, fallbackMs = Date.now()) {
  if (input.occurred_at !== undefined && input.occurred_at !== null && input.occurred_at !== '') {
    const t = Number(input.occurred_at)
    if (Number.isFinite(t) && t > 0) return new Date(t)
  }

  if (input.occurred_day) {
    const day = String(input.occurred_day).slice(0, 10)
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    if (day === today) {
      // 今天 → 用此刻，保留时分
      return new Date(now.getTime())
    }
    // 过去/未来的日期 → 当天中午
    return new Date(`${day}T12:00:00`)
  }

  return new Date(fallbackMs)
}

/**
 * 新增交易
 * @param {object} input
 *   type, amount_cents, account_id, to_account_id, category_id, note,
 *   occurred_at (ms) | occurred_day, tag_ids[], source, raw_text
 */
export async function createTransaction(input) {
  validate(input)

  const id = input.id || prefixedId('txn')
  const now = Date.now()
  // ★ 时间：优先用用户给的时刻 ★
  //   occurred_at  > 精确到时分（手动/AI 记账都走这条）
  //   occurred_day > 只有日期时，取当天的**当前时刻**（不是固定 12:00）
  //   都没有       > 用此刻
  const keys = makeDateKeys(resolveOccurredTime(input, now))

  const amount = Math.abs(Math.round(Number(input.amount_cents) || 0))

  await transaction(async () => {
    await execute(
      `INSERT INTO txn (
        id, type, amount_cents, account_id, to_account_id, category_id, note,
        occurred_at, occurred_day, month_key, year_key, tz_offset,
        source, raw_text, created_at, updated_at, deleted_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
      [
        id,
        input.type,
        amount,
        input.account_id,
        input.type === 'transfer' ? input.to_account_id : null,
        input.type === 'transfer' ? null : (input.category_id || null),
        input.note || '',
        keys.occurred_at,
        keys.occurred_day,
        keys.month_key,
        keys.year_key,
        keys.tz_offset,
        input.source || 'manual',
        input.raw_text || null,
        now,
        now
      ]
    )

    if (Array.isArray(input.tag_ids) && input.tag_ids.length > 0) {
      await syncTags(id, input.tag_ids)
    }

    // 重算受影响账户（转账要两端）
    await recalcBalance(input.account_id)
    if (input.type === 'transfer' && input.to_account_id) {
      await recalcBalance(input.to_account_id)
      await writeTodaySnapshot(input.to_account_id)
    }
    await writeTodaySnapshot(input.account_id)
  })

  return { id, ...keys }
}

/**
 * 更新交易 —— 注意账户可能被改，需要同时重算旧账户与新账户
 */
export async function updateTransaction(id, patch) {
  const existing = await getTransaction(id)
  if (!existing) throw new Error('交易不存在')

  const merged = { ...existing, ...patch }
  validate(merged)

  const amount = Math.abs(Math.round(Number(merged.amount_cents) || 0))
  // ★ 改了日期就重算时刻：只有日期时按 resolveOccurredTime 的规则取
  const occurredAt = (patch.occurred_at !== undefined || patch.occurred_day !== undefined)
    ? resolveOccurredTime(
        {
          occurred_at: patch.occurred_at,
          occurred_day: patch.occurred_day !== undefined ? patch.occurred_day : existing.occurred_day
        },
        existing.occurred_at
      ).getTime()
    : existing.occurred_at
  const keys = makeDateKeys(new Date(occurredAt))
  const now = Date.now()

  // 需要重算的账户合集（旧的两个 + 新的两个）
  const affected = new Set([existing.account_id, patch.account_id, existing.to_account_id, patch.to_account_id])
  affected.delete(null)
  affected.delete(undefined)

  await transaction(async () => {
    await execute(
      `UPDATE txn SET
        type = ?, amount_cents = ?, account_id = ?, to_account_id = ?, category_id = ?, note = ?,
        occurred_at = ?, occurred_day = ?, month_key = ?, year_key = ?,
        source = ?, raw_text = ?, updated_at = ?
       WHERE id = ?`,
      [
        merged.type,
        amount,
        merged.account_id,
        merged.type === 'transfer' ? merged.to_account_id : null,
        merged.type === 'transfer' ? null : (merged.category_id || null),
        merged.note || '',
        keys.occurred_at,
        keys.occurred_day,
        keys.month_key,
        keys.year_key,
        merged.source || 'manual',
        merged.raw_text || null,
        now,
        id
      ]
    )

    if (patch.tag_ids !== undefined) {
      await syncTags(id, patch.tag_ids || [])
    }

    for (const accId of affected) {
      await recalcBalance(accId)
      await writeTodaySnapshot(accId)
    }
  })

  return getTransaction(id)
}

/**
 * 设置/取消「这笔不计入预算」
 *
 * ★ 只改标记，不动余额 ★
 *   这个标记只影响预算统计（api/stats.js 的 getBudgetUsage），
 *   账户余额照旧计算 —— 这笔钱确实花出去了，只是不占预算额度。
 *
 * @param {string} id 交易 id
 * @param {boolean} exclude true = 不计入预算
 * @returns {Promise<object>} 更新后的交易
 */
export async function setExcludeFromBudget(id, exclude) {
  const existing = await getTransaction(id)
  if (!existing) throw new Error('交易不存在')

  const flag = exclude ? 1 : 0
  await execute(
    'UPDATE txn SET exclude_from_budget = ?, updated_at = ? WHERE id = ?',
    [flag, Date.now(), id]
  )
  return getTransaction(id)
}

/** 软删除（撤销用） */
export async function deleteTransaction(id) {
  const existing = await getTransaction(id)
  if (!existing) return false

  await transaction(async () => {
    await execute('UPDATE txn SET deleted_at = ?, updated_at = ? WHERE id = ?', [Date.now(), Date.now(), id])
    await recalcBalance(existing.account_id)
    if (existing.to_account_id) await recalcBalance(existing.to_account_id)
    await writeTodaySnapshot(existing.account_id)
    if (existing.to_account_id) await writeTodaySnapshot(existing.to_account_id)
  })
  return true
}

/** 恢复软删除（撤销） */
export async function restoreTransaction(id) {
  const row = await queryOne('SELECT * FROM txn WHERE id = ?', [id])
  if (!row) return false
  await transaction(async () => {
    await execute('UPDATE txn SET deleted_at = NULL, updated_at = ? WHERE id = ?', [Date.now(), id])
    await recalcBalance(row.account_id)
    if (row.to_account_id) await recalcBalance(row.to_account_id)
  })
  return true
}

/* ------------------------------------------------------------------ 标签 */

async function syncTags(txnId, tagIds) {
  await execute('DELETE FROM txn_tag WHERE txn_id = ?', [txnId])
  for (const tagId of tagIds) {
    await execute('INSERT OR IGNORE INTO txn_tag (txn_id, tag_id) VALUES (?, ?)', [txnId, tagId])
  }
}

export async function getTxnTags(txnId) {
  const rows = await query(
    `SELECT tg.* FROM tag tg JOIN txn_tag tt ON tt.tag_id = tg.id
     WHERE tt.txn_id = ? AND tg.deleted_at IS NULL`,
    [txnId]
  )
  return rows
}

/* ------------------------------------------------------------------ 校验 */

function validate(t) {
  if (!t || !t.type) throw new Error('缺少交易类型')
  if (!['expense', 'income', 'transfer'].includes(t.type)) throw new Error(`未知交易类型: ${t.type}`)
  if (!(Number(t.amount_cents) > 0)) throw new Error('金额必须大于 0')
  if (!t.account_id) throw new Error('必须选择账户')
  if (t.type === 'transfer') {
    if (!t.to_account_id) throw new Error('转账必须选择目标账户')
    if (t.to_account_id === t.account_id) throw new Error('转出与转入账户不能相同')
  } else {
    if (!t.category_id) throw new Error('必须选择分类')
  }
}
