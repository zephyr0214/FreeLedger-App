/**
 * 统计服务
 *
 * 所有查询遵循两条原则：
 *   1. 一次查询聚合完，不在 JS 里循环查询
 *   2. 二级分类向上归并到一级分类，避免统计口径碎片化
 *   3. transfer 不计入任何收支统计（它是账户间移动，不是消费）
 */

import { query, queryOne } from './db/index.js'
import { monthRange, toMonthKey, toDayKey, monthProgress, shiftMonth, shiftDay } from '../utils/date.js'

/* ------------------------------------------------------------ 总览卡片 */

/**
 * 最近 N 天各分类的使用次数（用于分类排序）。
 *
 * 统计的是「用了多少次」而不是「花了多少钱」——
 * 高频但便宜的分类（如早餐）也该排在前面。
 * 只统计支出和收入，转账不涉及分类。
 *
 * @param {number} days 回溯天数
 * @returns {Promise<Object>} { categoryId: count }
 */
export async function getCategoryUsageCounts(days = 30) {
  const from = shiftDay(toDayKey(), -(days - 1))
  const rows = await query(
    `SELECT category_id AS id, COUNT(*) AS c
     FROM txn
     WHERE deleted_at IS NULL
       AND category_id IS NOT NULL
       AND occurred_day >= ?
     GROUP BY category_id`,
    [from]
  )
  const map = {}
  for (const r of rows) {
    map[r.id] = Number(r.c) || 0
  }
  return map
}

/** 首页/统计页核心数字：本月支出、收入、结余、今日支出 */
export async function getOverview(monthKey) {
  const mk = monthKey || toMonthKey()
  const today = toDayKey()

  const row = await queryOne(
    `SELECT
       COALESCE(SUM(CASE WHEN type='expense' AND month_key=? THEN amount_cents ELSE 0 END),0) AS month_expense,
       COALESCE(SUM(CASE WHEN type='income'  AND month_key=? THEN amount_cents ELSE 0 END),0) AS month_income,
       COALESCE(SUM(CASE WHEN type='expense' AND occurred_day=? THEN amount_cents ELSE 0 END),0) AS today_expense,
       COALESCE(SUM(CASE WHEN type='income'  AND occurred_day=? THEN amount_cents ELSE 0 END),0) AS today_income
     FROM txn WHERE deleted_at IS NULL`,
    [mk, mk, today, today]
  )

  const monthExpense = Number(row ? row.month_expense : 0)
  const monthIncome = Number(row ? row.month_income : 0)

  return {
    monthKey: mk,
    monthExpense,
    monthIncome,
    monthBalance: monthIncome - monthExpense,
    todayExpense: Number(row ? row.today_expense : 0),
    todayIncome: Number(row ? row.today_income : 0)
  }
}

/** 与上月对比（用于趋势提示与 AI 洞察） */
export async function getMonthComparison(monthKey) {
  const mk = monthKey || toMonthKey()
  const prev = shiftMonth(mk, -1)

  const row = await queryOne(
    `SELECT
       COALESCE(SUM(CASE WHEN type='expense' AND month_key=? THEN amount_cents ELSE 0 END),0) AS cur_exp,
       COALESCE(SUM(CASE WHEN type='income'  AND month_key=? THEN amount_cents ELSE 0 END),0) AS cur_inc,
       COALESCE(SUM(CASE WHEN type='expense' AND month_key=? THEN amount_cents ELSE 0 END),0) AS prev_exp,
       COALESCE(SUM(CASE WHEN type='income'  AND month_key=? THEN amount_cents ELSE 0 END),0) AS prev_inc
     FROM txn WHERE deleted_at IS NULL`,
    [mk, mk, prev, prev]
  )

  const curExp = Number(row ? row.cur_exp : 0)
  const prevExp = Number(row ? row.prev_exp : 0)
  const curInc = Number(row ? row.cur_inc : 0)
  const prevInc = Number(row ? row.prev_inc : 0)

  const pct = (cur, prevVal) => {
    if (prevVal === 0) return cur === 0 ? 0 : null
    return Math.round(((cur - prevVal) / prevVal) * 1000) / 10
  }

  return {
    curExp, prevExp, curInc, prevInc,
    expenseChangePct: pct(curExp, prevExp),
    incomeChangePct: pct(curInc, prevInc),
    expenseDiff: curExp - prevExp,
    incomeDiff: curInc - prevInc
  }
}

/* ------------------------------------------------------------ 分类统计 */

/**
 * 按一级分类聚合支出/收入
 * @param {string} monthKey
 * @param {'expense'|'income'} type
 * @param {object} range 可选 { startDay, endDay } 自定义区间
 */
export async function getCategoryStats(monthKey, type = 'expense', range = null) {
  const where = ["t.deleted_at IS NULL", "t.type = ?"]
  const params = [type]

  if (range && range.startDay) {
    where.push('t.occurred_day >= ?')
    params.push(range.startDay)
  } else {
    where.push('t.month_key = ?')
    params.push(monthKey || toMonthKey())
  }
  if (range && range.endDay) {
    where.push('t.occurred_day <= ?')
    params.push(range.endDay)
  }

  const rows = await query(
    `SELECT COALESCE(c.parent_id, c.id) AS root_id,
            SUM(t.amount_cents) AS amt,
            COUNT(*) AS cnt
     FROM txn t
     LEFT JOIN category c ON c.id = t.category_id
     WHERE ${where.join(' AND ')}
     GROUP BY root_id
     ORDER BY amt DESC`,
    params
  )

  if (rows.length === 0) return []

  // 取一级分类名称与图标
  const ids = rows.map((r) => r.root_id).filter(Boolean)
  let cats = []
  if (ids.length > 0) {
    cats = await query(
      `SELECT id, name, icon, color FROM category WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    )
  }
  const catMap = {}
  cats.forEach((c) => { catMap[c.id] = c })

  return rows.map((r) => {
    const meta = catMap[r.root_id] || {}
    return {
      id: r.root_id,
      name: meta.name || '未分类',
      icon: meta.icon || 'more',
      color: meta.color || '#969799',
      amount: Number(r.amt) || 0,
      count: Number(r.cnt) || 0
    }
  })
}

/** 二级分类明细（点开一级分类时用） */
export async function getSubCategoryStats(parentId, monthKey, type = 'expense') {
  const rows = await query(
    `SELECT t.category_id AS id, c.name, c.icon, c.color,
            SUM(t.amount_cents) AS amt, COUNT(*) AS cnt
     FROM txn t
     LEFT JOIN category c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL AND t.type = ? AND t.month_key = ?
       AND (t.category_id = ? OR c.parent_id = ?)
     GROUP BY t.category_id
     ORDER BY amt DESC`,
    [type, monthKey || toMonthKey(), parentId, parentId]
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name || '未分类',
    icon: r.icon || 'more',
    color: r.color || '#969799',
    amount: Number(r.amt) || 0,
    count: Number(r.cnt) || 0
  }))
}

/* ------------------------------------------------------------ 账户统计 */

/** 各账户支出/收入汇总 */
export async function getAccountStats(monthKey, type = 'expense') {
  const mk = monthKey || toMonthKey()
  const rows = await query(
    `SELECT t.account_id AS id, a.name, a.icon, a.color, a.type AS account_type,
            SUM(t.amount_cents) AS amt, COUNT(*) AS cnt
     FROM txn t
     LEFT JOIN account a ON a.id = t.account_id
     WHERE t.deleted_at IS NULL AND t.type = ? AND t.month_key = ?
     GROUP BY t.account_id
     ORDER BY amt DESC`,
    [type, mk]
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name || '已删除账户',
    icon: r.icon || 'wallet',
    color: r.color || '#1989FA',
    accountType: r.account_type,
    amount: Number(r.amt) || 0,
    count: Number(r.cnt) || 0
  }))
}

/* ------------------------------------------------------- 标签（项目）统计 */

export async function getTagStats(monthKey, type = 'expense') {
  const mk = monthKey || toMonthKey()
  const rows = await query(
    `SELECT tg.id, tg.name, tg.color, SUM(t.amount_cents) AS amt, COUNT(DISTINCT t.id) AS cnt
     FROM txn t
     JOIN txn_tag tt ON tt.txn_id = t.id
     JOIN tag tg ON tg.id = tt.tag_id
     WHERE t.deleted_at IS NULL AND t.type = ? AND t.month_key = ? AND tg.deleted_at IS NULL
     GROUP BY tg.id
     ORDER BY amt DESC`,
    [type, mk]
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name || '未命名',
    color: r.color || '#1989FA',
    amount: Number(r.amt) || 0,
    count: Number(r.cnt) || 0
  }))
}

/** 未打标签的支出合计（提示用户补标签用） */
export async function getUntaggedAmount(monthKey) {
  const row = await queryOne(
    `SELECT COALESCE(SUM(t.amount_cents),0) AS amt
     FROM txn t
     WHERE t.deleted_at IS NULL AND t.type='expense' AND t.month_key = ?
       AND NOT EXISTS (SELECT 1 FROM txn_tag tt WHERE tt.txn_id = t.id)`,
    [monthKey || toMonthKey()]
  )
  return Number(row ? row.amt : 0)
}

/* ------------------------------------------------------------ 日趋势 */

export async function getDailyTrend(monthKey) {
  const mk = monthKey || toMonthKey()
  // occurred_day 是 'YYYY-MM-DD' 文本，用 SUBSTR 取第 9~10 位即「日」。
  // 不用 DAY()（那是 MySQL 的），也不用 strftime（部分 Android 内核缺日期扩展）。
  const rows = await query(
    `SELECT CAST(SUBSTR(occurred_day, 9, 2) AS INTEGER) AS d,
            COALESCE(SUM(CASE WHEN type='expense' THEN amount_cents ELSE 0 END),0) AS exp,
            COALESCE(SUM(CASE WHEN type='income'  THEN amount_cents ELSE 0 END),0) AS inc
     FROM txn
     WHERE month_key = ? AND deleted_at IS NULL
     GROUP BY d
     ORDER BY d ASC`,
    [mk]
  )

  const map = {}
  rows.forEach((r) => {
    map[Number(r.d)] = { expense: Number(r.exp) || 0, income: Number(r.inc) || 0 }
  })

  // 补全整月，图表需要连续数据
  const [y, m] = mk.split('-').map(Number)
  const total = new Date(y, m, 0).getDate()
  const out = []
  for (let d = 1; d <= total; d++) {
    const item = map[d] || { expense: 0, income: 0 }
    out.push({ day: d, ...item })
  }
  return out
}

/* ------------------------------------------------------------ 平均值 */

export async function getAverages(monthKey) {
  const mk = monthKey || toMonthKey()
  const { passed } = monthProgress(mk)

  const row = await queryOne(
    `SELECT COALESCE(SUM(amount_cents),0) AS total, COUNT(*) AS cnt
     FROM txn WHERE deleted_at IS NULL AND type='expense' AND month_key = ?`,
    [mk]
  )
  const total = Number(row ? row.total : 0)
  const cnt = Number(row ? row.cnt : 0)

  // 最高单日
  const maxDay = await queryOne(
    `SELECT occurred_day AS day, SUM(amount_cents) AS amt
     FROM txn WHERE deleted_at IS NULL AND type='expense' AND month_key = ?
     GROUP BY occurred_day ORDER BY amt DESC LIMIT 1`,
    [mk]
  )

  return {
    total,
    count: cnt,
    avgPerDay: passed > 0 ? Math.round(total / passed) : 0,
    avgPerTxn: cnt > 0 ? Math.round(total / cnt) : 0,
    daysPassed: passed,
    maxDay: maxDay ? { day: maxDay.day, amount: Number(maxDay.amt) || 0 } : null
  }
}

/* ---------------------------------------------------------- Top N 消费 */

export async function getTopExpenses(monthKey, limit = 10) {
  const mk = monthKey || toMonthKey()
  const rows = await query(
    `SELECT t.id, t.amount_cents, t.note, t.occurred_day, t.occurred_at,
            c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            a.name AS account_name, a.icon AS account_icon
     FROM txn t
     LEFT JOIN category c ON c.id = t.category_id
     LEFT JOIN account  a ON a.id = t.account_id
     WHERE t.deleted_at IS NULL AND t.type='expense' AND t.month_key = ?
     ORDER BY t.amount_cents DESC
     LIMIT ?`,
    [mk, Number(limit) || 10]
  )
  return rows.map((r) => ({
    ...r,
    amount_cents: Number(r.amount_cents) || 0,
    occurred_at: Number(r.occurred_at) || 0
  }))
}

/* ------------------------------------------------------------ 预算情况 */

export async function getBudgetUsage(monthKey) {
  const mk = monthKey || toMonthKey()

  const budgets = await query(
    'SELECT * FROM budget WHERE start_month <= ? ORDER BY scope ASC',
    [mk]
  )
  if (budgets.length === 0) return []

  const { passed, total, remain } = monthProgress(mk)

  // 总支出
  const totalRow = await queryOne(
    `SELECT COALESCE(SUM(amount_cents),0) AS amt FROM txn
     WHERE deleted_at IS NULL AND type='expense' AND month_key = ?`,
    [mk]
  )
  const monthExpense = Number(totalRow ? totalRow.amt : 0)

  // 分类支出
  const catRows = await query(
    `SELECT COALESCE(c.parent_id, c.id) AS root_id, SUM(t.amount_cents) AS amt
     FROM txn t LEFT JOIN category c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL AND t.type='expense' AND t.month_key = ?
     GROUP BY root_id`,
    [mk]
  )
  const catMap = {}
  catRows.forEach((r) => { catMap[r.root_id] = Number(r.amt) || 0 })

  // 分类名称
  const catIds = budgets.filter((b) => b.scope === 'category' && b.category_id).map((b) => b.category_id)
  let catNames = {}
  if (catIds.length > 0) {
    const list = await query(
      `SELECT id, name, icon FROM category WHERE id IN (${catIds.map(() => '?').join(',')})`,
      catIds
    )
    list.forEach((c) => { catNames[c.id] = c })
  }

  return budgets.map((b) => {
    const limit = Number(b.amount_cents) || 0
    const used = b.scope === 'total' ? monthExpense : (catMap[b.category_id] || 0)
    const pct = limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0
    const remaining = limit - used
    const dailyAvailable = remain > 0 ? Math.max(Math.round(remaining / remain), 0) : 0

    return {
      id: b.id,
      scope: b.scope,
      categoryId: b.category_id,
      name: b.scope === 'total' ? '总预算' : ((catNames[b.category_id] || {}).name || '已删除分类'),
      icon: b.scope === 'total' ? 'chart' : ((catNames[b.category_id] || {}).icon || 'more'),
      limit,
      used,
      remaining,
      percent: pct,
      over: used > limit,
      dailyAvailable,
      remainDays: remain,
      totalDays: total,
      passedDays: passed
    }
  })
}

/* ---------------------------------------------------- AI 用的紧凑摘要 */

/**
 * 给大模型的紧凑数据包。
 * 关键：不传原始明细，只传聚合结果，Token 少一个数量级且结论更准。
 */
export async function getAiSummary(monthKey) {
  const mk = monthKey || toMonthKey()

  const [overview, comparison, cats, accounts, averages, top, budgets] = await Promise.all([
    getOverview(mk),
    getMonthComparison(mk),
    getCategoryStats(mk, 'expense'),
    getAccountStats(mk, 'expense'),
    getAverages(mk),
    getTopExpenses(mk, 5),
    getBudgetUsage(mk)
  ])

  return {
    month: mk,
    expense: Math.round(overview.monthExpense / 100),
    income: Math.round(overview.monthIncome / 100),
    balance: Math.round(overview.monthBalance / 100),
    expenseChangePct: comparison.expenseChangePct,
    categories: cats.slice(0, 6).map((c) => ({ name: c.name, amount: Math.round(c.amount / 100) })),
    accounts: accounts.slice(0, 4).map((a) => ({ name: a.name, amount: Math.round(a.amount / 100) })),
    avgPerDay: Math.round(averages.avgPerDay / 100),
    avgPerTxn: Math.round(averages.avgPerTxn / 100),
    txnCount: averages.count,
    top: top.map((t) => ({ amount: Math.round(t.amount_cents / 100), cat: t.category_name, note: t.note })),
    budgets: budgets.map((b) => ({ name: b.name, percent: b.percent, over: b.over }))
  }
}
