/**
 * 统计服务
 *
 * 所有查询遵循两条原则：
 *   1. 一次查询聚合完，不在 JS 里循环查询
 *   2. 二级分类向上归并到一级分类，避免统计口径碎片化
 *   3. transfer 不计入任何收支统计（它是账户间移动，不是消费）
 *
 * 两种统计口径并存：
 *   1. 按月（历史接口，行为保持不变）
 *      getOverview(monthKey) / getCategoryStats(monthKey) / getBudgetUsage(monthKey) ...
 *   2. 按区间（统计页三级选择器用）
 *      getOverviewRange(range) / getCategoryStatsRange(range) / getBudgetUsageRange(range) ...
 *      区间对象 = { startDay, endDay, monthKey }，空串表示「不限」。
 *
 * 两套口径共用同一段 SQL 主体，区别只在 where 片段：
 *   - 按月   → t.month_key = ?
 *   - 按区间 → t.occurred_day >= ? / t.occurred_day <= ?
 *   （区间恰好是整月时仍走 month_key，与单月口径逐条一致）
 */

import { query, queryOne } from './db/index.js'
import { monthRange, toMonthKey, toDayKey, monthProgress, shiftMonth, shiftDay, parseDayKey } from '../utils/date.js'
import { ACCOUNT_TYPES } from './account.js'

/* ============================================================ 区间基础 */

/**
 * 归一化区间对象。空串统一表示「不限」。
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 */
function normalizeRange(range) {
  const r = range || {}
  return {
    startDay: r.startDay ? String(r.startDay) : '',
    endDay: r.endDay ? String(r.endDay) : '',
    monthKey: r.monthKey ? String(r.monthKey) : ''
  }
}

/**
 * 补全区间的具体起止日。
 * 只给了 monthKey 时，补成该月第一天与最后一天。
 */
function expandRange(range) {
  const r = normalizeRange(range)
  let startDay = r.startDay
  let endDay = r.endDay
  if (r.monthKey && (!startDay || !endDay)) {
    const y = Number(r.monthKey.split('-')[0]) || 0
    const m = Number(r.monthKey.split('-')[1]) || 0
    const last = y && m ? new Date(y, m, 0).getDate() : 0
    if (!startDay) startDay = `${r.monthKey}-01`
    if (!endDay) endDay = last ? `${r.monthKey}-${String(last).padStart(2, '0')}` : r.monthKey
  }
  return { startDay, endDay, monthKey: r.monthKey }
}

/** 区间是否完整覆盖某个自然月 */
function isWholeMonth(monthKey, startDay, endDay) {
  if (!monthKey || !startDay || !endDay) return false
  const y = Number(monthKey.split('-')[0]) || 0
  const m = Number(monthKey.split('-')[1]) || 0
  if (!y || !m) return false
  const last = new Date(y, m, 0).getDate()
  return startDay === `${monthKey}-01` && endDay === `${monthKey}-${String(last).padStart(2, '0')}`
}

/** 区间是否恰好是某个自然年（1/1 ~ 12/31） */
function isWholeYear(startDay, endDay) {
  if (!startDay || !endDay) return false
  if (!startDay.endsWith('-01-01') || !endDay.endsWith('-12-31')) return false
  return startDay.slice(0, 4) === endDay.slice(0, 4)
}

/**
 * 区间形态：
 *   all    全部（不限时间）
 *   year   整年
 *   month  整月
 *   day    单日
 *   custom 其它自定义区间
 */
function classifyRange(e) {
  if (!e.startDay && !e.endDay) return 'all'
  if (e.startDay && e.endDay && e.startDay === e.endDay) return 'day'
  if (e.monthKey && isWholeMonth(e.monthKey, e.startDay, e.endDay)) return 'month'
  if (!e.monthKey && isWholeYear(e.startDay, e.endDay)) return 'year'
  return 'custom'
}

/**
 * 区间 -> SQL 过滤片段（别名固定为 t）。
 * 返回 { where: 't.occurred_day >= ? AND t.occurred_day <= ?', params: [...] }
 */
function rangeScope(range) {
  const r = normalizeRange(range)
  const parts = []
  const params = []
  const wholeMonth = !!r.monthKey && (!r.startDay || !r.endDay || isWholeMonth(r.monthKey, r.startDay, r.endDay))
  if (wholeMonth) {
    parts.push('t.month_key = ?')
    params.push(r.monthKey)
  } else {
    if (r.startDay) {
      parts.push('t.occurred_day >= ?')
      params.push(r.startDay)
    }
    if (r.endDay) {
      parts.push('t.occurred_day <= ?')
      params.push(r.endDay)
    }
  }
  return { where: parts.join(' AND '), params }
}

/** 按月 -> SQL 过滤片段 */
function monthScope(monthKey) {
  return { where: 't.month_key = ?', params: [monthKey || toMonthKey()] }
}

/** 把过滤片段拼到基础 where 后面 */
function withScope(base, scope) {
  return base + (scope && scope.where ? ` AND ${scope.where}` : '')
}

/** 两个 YYYY-MM-DD 之间相差的自然天数（含首尾） */
function dayDiffInclusive(a, b) {
  const da = parseDayKey(a)
  const db = parseDayKey(b)
  return Math.round((db.getTime() - da.getTime()) / 86400000) + 1
}

/** 闰年判断 */
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** 某年某月 -> 'YYYY-MM' 列表 */
function monthListOfYear(year) {
  const out = []
  for (let m = 1; m <= 12; m++) out.push(`${year}-${String(m).padStart(2, '0')}`)
  return out
}

/** 从 startMonth 到 endMonth（含）的 'YYYY-MM' 列表 */
function monthRangeList(startMonth, endMonth) {
  const out = []
  if (!startMonth || !endMonth || startMonth > endMonth) return out
  let y = Number(startMonth.split('-')[0]) || 0
  let m = Number(startMonth.split('-')[1]) || 0
  const ey = Number(endMonth.split('-')[0]) || 0
  const em = Number(endMonth.split('-')[1]) || 0
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

/** 区间的展示文案，格式与 utils/date.js 的 selectionLabel 对齐 */
function rangeLabel(range) {
  const e = expandRange(range)
  if (!e.startDay && !e.endDay) return '全部年'
  if (e.startDay && e.startDay === e.endDay) {
    const p = e.startDay.split('-')
    return `${p[0]}年${Number(p[1])}月${Number(p[2])}日`
  }
  if (e.monthKey) {
    const p = e.monthKey.split('-')
    return `${p[0]}年${Number(p[1])}月`
  }
  if (isWholeYear(e.startDay, e.endDay)) return `${e.startDay.slice(0, 4)}年`
  return `${e.startDay} ~ ${e.endDay}`
}

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

/**
 * 总览聚合（区间版与按月版共用主体）。
 * count 为区间内全部交易笔数（含 transfer）；expense/income 不计 transfer。
 */
async function overviewByScope(scope) {
  const row = await queryOne(
    `SELECT COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount_cents ELSE 0 END),0) AS exp,
            COALESCE(SUM(CASE WHEN t.type='income'  THEN t.amount_cents ELSE 0 END),0) AS inc,
            COUNT(*) AS cnt
     FROM txn t
     WHERE t.deleted_at IS NULL${withScope('', scope)}`,
    scope.params
  )
  const expense = Number(row ? row.exp : 0)
  const income = Number(row ? row.inc : 0)
  return { expense, income, balance: income - expense, count: Number(row ? row.cnt : 0) }
}

/** 今日收支（与区间无关，始终按今天算） */
async function todayTotals() {
  const today = toDayKey()
  const row = await queryOne(
    `SELECT COALESCE(SUM(CASE WHEN type='expense' AND occurred_day=? THEN amount_cents ELSE 0 END),0) AS exp,
            COALESCE(SUM(CASE WHEN type='income'  AND occurred_day=? THEN amount_cents ELSE 0 END),0) AS inc
     FROM txn WHERE deleted_at IS NULL`,
    [today, today]
  )
  return {
    todayExpense: Number(row ? row.exp : 0),
    todayIncome: Number(row ? row.inc : 0)
  }
}

/** 首页/统计页核心数字：本月支出、收入、结余、今日支出 */
export async function getOverview(monthKey) {
  const mk = monthKey || toMonthKey()
  const agg = await overviewByScope(monthScope(mk))
  const today = await todayTotals()

  return {
    monthKey: mk,
    monthExpense: agg.expense,
    monthIncome: agg.income,
    monthBalance: agg.balance,
    todayExpense: today.todayExpense,
    todayIncome: today.todayIncome
  }
}

/**
 * 按任意日期区间的总览。
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range 空串 = 不限
 * @returns {Promise<{expense:number,income:number,balance:number,count:number,todayExpense:number,todayIncome:number}>}
 */
export async function getOverviewRange(range) {
  const agg = await overviewByScope(rangeScope(range))
  const today = await todayTotals()
  return {
    expense: agg.expense,
    income: agg.income,
    balance: agg.balance,
    count: agg.count,
    todayExpense: today.todayExpense,
    todayIncome: today.todayIncome
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

/** 分类聚合主体（区间版与按月版共用） */
async function categoryStatsByScope(scope, type) {
  const rows = await query(
    `SELECT COALESCE(c.parent_id, c.id) AS root_id,
            SUM(t.amount_cents) AS amt,
            COUNT(*) AS cnt
     FROM txn t
     LEFT JOIN category c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL AND t.type = ?${withScope('', scope)}
     GROUP BY root_id
     ORDER BY amt DESC`,
    [type].concat(scope.params)
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

/**
 * 按一级分类聚合支出/收入
 * @param {string} monthKey
 * @param {'expense'|'income'} type
 * @param {object} range 可选 { startDay, endDay } 自定义区间
 */
export async function getCategoryStats(monthKey, type = 'expense', range = null) {
  // 按月版的 where 拼法保持原样（含只给 endDay 时仍按月过滤的老行为）
  const where = []
  const params = []
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
  return categoryStatsByScope({ where: where.join(' AND '), params }, type)
}

/**
 * 按任意日期区间的分类统计（结构与 getCategoryStats 相同）
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @param {'expense'|'income'} type
 */
export async function getCategoryStatsRange(range, type = 'expense') {
  return categoryStatsByScope(rangeScope(range), type)
}

/**
 * 二级分类统计（按任意日期区间）
 *
 * 统计页的「分类统计」要展示**二级分类**（午餐、外卖、房租…），
 * 而不是一级分类（餐饮、居住…）——
 * 一级是统计口径，二级才是用户实际记的东西。
 *
 * 没有二级分类的交易归到它自己的一级分类下
 * （用 COALESCE 保证不会漏掉）。
 *
 * ★ 二级分类的配色 ★
 *   种子里二级分类继承父级颜色（分类管理页显示的是父级色），
 *   但统计页的饼图要按二级分块 —— 全用父级色就分不开了。
 *   这里**不用父级色**，而是从一个高区分度的调色板里按序取色：
 *   每一块的颜色都不同，饼图上一眼能分清。
 *   （之前用「父级色按序号变深浅」，同色系的深浅太接近，
 *    看上去跟没区分一样。）
 *
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @param {'expense'|'income'} type
 * @returns {Promise<Array<{id:string,name:string,icon:string,color:string,
 *   parentName:string,amount:number,count:number}>>}
 */
export async function getSubCategoryStatsRange(range, type = 'expense') {
  const rows = await query(
    `SELECT t.category_id AS id,
            c.name, c.icon, c.color,
            c.parent_id AS parent_id,
            COALESCE(p.name, '未分类') AS parent_name,
            COALESCE(p.color, c.color) AS parent_color,
            SUM(t.amount_cents) AS amt, COUNT(*) AS cnt
     FROM txn t
     LEFT JOIN category c ON c.id = t.category_id
     LEFT JOIN category p ON p.id = c.parent_id
     WHERE t.deleted_at IS NULL AND t.type = ?${withScope('', rangeScope(range))}
     GROUP BY t.category_id
     ORDER BY amt DESC`,
    [type].concat(rangeScope(range).params)
  )

  // 按调色板顺序取色：每块颜色都不同
  return rows.map((r, i) => ({
    id: r.id,
    name: r.name || '未分类',
    icon: r.icon || 'more',
    color: PIE_PALETTE[i % PIE_PALETTE.length],
    parentName: r.parent_name || '未分类',
    amount: Number(r.amt) || 0,
    count: Number(r.cnt) || 0
  }))
}

/**
 * 饼图调色板
 *
 * ★ 每两种颜色都要差得开 ★
 *   相邻两块如果只是「同一个色相的不同深浅」，
 *   肉眼几乎分不开，饼图就白画了。
 *   这组是 Material 500 色阶里挑出来的 10 个**色相分散**的颜色，
 *   任意两块之间的 RGB 距离都 >= 77，一眼能分出边界。
 *
 *   （之前那版混进了深绿/绿、深蓝/蓝、浅橙/粉、洋红/粉这些近似色，
 *    看上去「颜色没区分」就是这个原因。）
 */
export const PIE_PALETTE = [
  '#1E88E5', // 蓝
  '#FB8C00', // 橙
  '#43A047', // 绿
  '#E53935', // 红
  '#8E24AA', // 紫
  '#F06292', // 粉
  '#6D4C41', // 棕
  '#9E9D24', // 黄绿
  '#26A69A', // 青
  '#5C6BC0'  // 靛
]

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

/** 账户聚合主体 */
async function accountStatsByScope(scope, type) {
  const rows = await query(
    `SELECT t.account_id AS id, a.name, a.icon, a.color, a.type AS account_type,
            SUM(t.amount_cents) AS amt, COUNT(*) AS cnt
     FROM txn t
     LEFT JOIN account a ON a.id = t.account_id
     WHERE t.deleted_at IS NULL AND t.type = ?${withScope('', scope)}
     GROUP BY t.account_id
     ORDER BY amt DESC`,
    [type].concat(scope.params)
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

/** 各账户支出/收入汇总 */
export async function getAccountStats(monthKey, type = 'expense') {
  return accountStatsByScope(monthScope(monthKey), type)
}

/**
 * 按任意日期区间的账户统计（结构与 getAccountStats 相同）
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @param {'expense'|'income'} type
 */
export async function getAccountStatsRange(range, type = 'expense') {
  return accountStatsByScope(rangeScope(range), type)
}

/**
 * 按**账户类别**（网络支付/信用卡/储蓄卡/现金/充值卡）统计
 *
 * 账户统计饼图要分两层：
 *   - 按具体账户分（每个账户一块）
 *   - 按账户类别分（网络支付一块、信用卡一块…）
 *
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @param {'expense'|'income'} type
 * @returns {Promise<Array<{key:string,name:string,icon:string,color:string,amount:number,count:number}>>}
 */
export async function getAccountTypeStatsRange(range, type = 'expense') {
  const rows = await query(
    `SELECT a.type AS account_type,
            SUM(t.amount_cents) AS amt, COUNT(*) AS cnt
     FROM txn t
     LEFT JOIN account a ON a.id = t.account_id
     WHERE t.deleted_at IS NULL AND t.type = ?${withScope('', rangeScope(range))}
     GROUP BY a.type
     ORDER BY amt DESC`,
    [type].concat(rangeScope(range).params)
  )

  // 按 ACCOUNT_TYPES 的顺序输出，颜色用类型自己的颜色
  const order = ACCOUNT_TYPES.map((t) => t.key)
  const rowMap = {}
  for (const r of rows) {
    rowMap[r.account_type || 'other'] = r
  }

  return ACCOUNT_TYPES
    .filter((t) => rowMap[t.key])
    .map((t) => ({
      key: t.key,
      name: t.name,
      icon: t.icon,
      color: ACCOUNT_TYPE_COLORS[t.key] || '#1989FA',
      amount: Number(rowMap[t.key].amt) || 0,
      count: Number(rowMap[t.key].cnt) || 0
    }))
}

/**
 * 账户类别配色（饼图用）
 * 取自 PIE_PALETTE 的前几个色位，和分类统计的饼图是同一套视觉语言。
 */
const ACCOUNT_TYPE_COLORS = {
  online: PIE_PALETTE[0],   // 蓝
  credit: PIE_PALETTE[3],   // 红
  debit: PIE_PALETTE[2],    // 绿
  cash: PIE_PALETTE[1],     // 橙
  prepaid: PIE_PALETTE[4]   // 紫
}

/* ------------------------------------------------------- 标签（项目）统计 */

/** 标签聚合主体 */
async function tagStatsByScope(scope, type) {
  const rows = await query(
    `SELECT tg.id, tg.name, tg.color, SUM(t.amount_cents) AS amt, COUNT(DISTINCT t.id) AS cnt
     FROM txn t
     JOIN txn_tag tt ON tt.txn_id = t.id
     JOIN tag tg ON tg.id = tt.tag_id
     WHERE t.deleted_at IS NULL AND t.type = ?${withScope('', scope)} AND tg.deleted_at IS NULL
     GROUP BY tg.id
     ORDER BY amt DESC`,
    [type].concat(scope.params)
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name || '未命名',
    color: r.color || '#1989FA',
    amount: Number(r.amt) || 0,
    count: Number(r.cnt) || 0
  }))
}

export async function getTagStats(monthKey, type = 'expense') {
  return tagStatsByScope(monthScope(monthKey), type)
}

/**
 * 按任意日期区间的标签统计（结构与 getTagStats 相同）
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @param {'expense'|'income'} type
 */
export async function getTagStatsRange(range, type = 'expense') {
  return tagStatsByScope(rangeScope(range), type)
}

/** 未打标签的支出合计（提示用户补标签用） */
export async function getUntaggedAmount(monthKey) {
  return untaggedAmountByScope(monthScope(monthKey))
}

async function untaggedAmountByScope(scope) {
  const row = await queryOne(
    `SELECT COALESCE(SUM(t.amount_cents),0) AS amt
     FROM txn t
     WHERE t.deleted_at IS NULL AND t.type='expense'${withScope('', scope)}
       AND NOT EXISTS (SELECT 1 FROM txn_tag tt WHERE tt.txn_id = t.id)`,
    scope.params
  )
  return Number(row ? row.amt : 0)
}

/**
 * 按任意日期区间的未打标签支出合计
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @returns {Promise<number>} 分
 */
export async function getUntaggedAmountRange(range) {
  return untaggedAmountByScope(rangeScope(range))
}

/* ------------------------------------------------------------ 日趋势 */

/**
 * 按天聚合（区间版与按月版共用主体）
 * occurred_day 是 'YYYY-MM-DD' 文本，用 SUBSTR 取第 9~10 位即「日」。
 * 不用 DAY()（那是 MySQL 的），也不用 strftime（部分 Android 内核缺日期扩展）。
 */
async function trendByDay(scope) {
  return query(
    `SELECT t.occurred_day AS day_key,
            CAST(SUBSTR(t.occurred_day, 9, 2) AS INTEGER) AS d,
            COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount_cents ELSE 0 END),0) AS exp,
            COALESCE(SUM(CASE WHEN t.type='income'  THEN t.amount_cents ELSE 0 END),0) AS inc
     FROM txn t
     WHERE t.deleted_at IS NULL${withScope('', scope)}
     GROUP BY t.occurred_day
     ORDER BY t.occurred_day ASC`,
    scope.params
  )
}

/** 按月聚合 */
async function trendByMonth(scope) {
  return query(
    `SELECT t.month_key AS mk,
            COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount_cents ELSE 0 END),0) AS exp,
            COALESCE(SUM(CASE WHEN t.type='income'  THEN t.amount_cents ELSE 0 END),0) AS inc
     FROM txn t
     WHERE t.deleted_at IS NULL${withScope('', scope)}
     GROUP BY t.month_key
     ORDER BY t.month_key ASC`,
    scope.params
  )
}

export async function getDailyTrend(monthKey) {
  const mk = monthKey || toMonthKey()
  const rows = await trendByDay(monthScope(mk))

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

/**
 * 按任意日期区间的趋势分桶
 *
 *   整月  → 按天分桶，label 为「日」号（如 '15'）
 *   整年  → 按月分桶，12 项，label 为月份号（如 '1'…'12'）
 *   单日  → 1 项，label 为该日的日号（如 '15'）
 *   全部  → 按月分桶，只输出有交易的月份，label 为月份号（无交易返回空数组）
 *
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @returns {Promise<Array<{bucket:'day'|'month',label:string,expense:number,income:number}>>}
 */
export async function getDailyTrendRange(range) {
  const e = expandRange(range)
  const kind = classifyRange(e)
  const scope = rangeScope(range)

  if (kind === 'day') {
    const rows = await trendByDay(scope)
    const r = rows[0]
    const d = e.startDay ? Number(e.startDay.slice(8, 10)) : 0
    return [{
      bucket: 'day',
      label: d ? String(d) : 'D',
      expense: r ? Number(r.exp) || 0 : 0,
      income: r ? Number(r.inc) || 0 : 0
    }]
  }

  if (kind === 'month') {
    const rows = await trendByDay(scope)
    const map = {}
    rows.forEach((r) => {
      map[Number(r.d)] = { expense: Number(r.exp) || 0, income: Number(r.inc) || 0 }
    })
    const [y, m] = e.monthKey.split('-').map(Number)
    const total = new Date(y, m, 0).getDate()
    const out = []
    for (let d = 1; d <= total; d++) {
      const item = map[d] || { expense: 0, income: 0 }
      out.push({ bucket: 'day', label: String(d), expense: item.expense, income: item.income })
    }
    return out
  }

  // 整年 / 全部 / 自定义区间 → 按月分桶
  const rows = await trendByMonth(scope)

  if (kind === 'year') {
    const year = e.startDay.slice(0, 4)
    const map = {}
    rows.forEach((r) => { map[r.mk] = r })
    const out = []
    for (const mk of monthListOfYear(year)) {
      const item = map[mk]
      out.push({
        bucket: 'month',
        label: String(Number(mk.slice(5, 7))),
        expense: item ? Number(item.exp) || 0 : 0,
        income: item ? Number(item.inc) || 0 : 0
      })
    }
    return out
  }

  // 全部（不限时间）/ 自定义区间：只输出有交易的月份
  return rows.map((r) => ({
    bucket: 'month',
    label: String(Number(r.mk.slice(5, 7))),
    expense: Number(r.exp) || 0,
    income: Number(r.inc) || 0
  }))
}

/* ------------------------------------------------------------ 平均值 */

/** 平均值聚合主体（daysPassed 由调用方给，两套口径的「已过天数」定义不同） */
async function averagesByScope(scope, daysPassed, type = 'expense') {
  const row = await queryOne(
    `SELECT COALESCE(SUM(t.amount_cents),0) AS total, COUNT(*) AS cnt
     FROM txn t WHERE t.deleted_at IS NULL AND t.type = ?${withScope('', scope)}`,
    [type].concat(scope.params)
  )
  const total = Number(row ? row.total : 0)
  const cnt = Number(row ? row.cnt : 0)

  // 最高单日
  const maxDay = await queryOne(
    `SELECT t.occurred_day AS day, SUM(t.amount_cents) AS amt
     FROM txn t WHERE t.deleted_at IS NULL AND t.type = ?${withScope('', scope)}
     GROUP BY t.occurred_day ORDER BY amt DESC LIMIT 1`,
    [type].concat(scope.params)
  )

  return {
    total,
    count: cnt,
    avgPerDay: daysPassed > 0 ? Math.round(total / daysPassed) : 0,
    avgPerTxn: cnt > 0 ? Math.round(total / cnt) : 0,
    daysPassed,
    maxDay: maxDay ? { day: maxDay.day, amount: Number(maxDay.amt) || 0 } : null
  }
}

export async function getAverages(monthKey) {
  const mk = monthKey || toMonthKey()
  const { passed } = monthProgress(mk)
  return averagesByScope(monthScope(mk), passed)
}

/**
 * 区间内的已过天数
 *   整月 → 该月到今天为止的天数（未来月为 0）
 *   整年 → 该年 1/1 到今天的天数（过去年为全年）
 *   单日 → 1（未来日为 0）
 *   全部 → 库里最早交易 ~ 今天（无数据为 0）
 */
async function rangeDaysPassed(range) {
  const e = expandRange(range)
  const kind = classifyRange(e)
  const today = toDayKey()

  // 不限时间：库里最早交易 ~ 今天；无数据则 0
  if (kind === 'all') {
    const row = await queryOne(`SELECT MIN(t.occurred_day) AS d FROM txn t WHERE t.deleted_at IS NULL`)
    const first = row && row.d ? String(row.d) : ''
    if (!first || first > today) return 0
    return dayDiffInclusive(first, today)
  }

  // 整年：实际有数据的最早一天 ~ 今天（不超出该年）
  if (kind === 'year') {
    const scope = rangeScope(range)
    const row = await queryOne(
      `SELECT MIN(t.occurred_day) AS d FROM txn t WHERE t.deleted_at IS NULL${withScope('', scope)}`,
      scope.params
    )
    const first = row && row.d ? String(row.d) : ''
    if (!first) return 0
    const end = e.endDay < today ? e.endDay : today
    if (end < first) return 0
    return dayDiffInclusive(first, end)
  }

  // 整月 / 单日 / 自定义：区间起止与今天的交集
  const start = e.startDay
  const end = e.endDay || e.startDay
  const effEnd = end < today ? end : today
  if (effEnd < start) return 0
  return dayDiffInclusive(start, effEnd)
}

/**
 * 按任意日期区间的平均值
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @param {'expense'|'income'} type 统计支出还是收入
 * @returns {Promise<{total:number,count:number,avgPerDay:number,avgPerTxn:number,daysPassed:number,maxDay:object|null}>}
 */
export async function getAveragesRange(range, type = 'expense') {
  const daysPassed = await rangeDaysPassed(range)
  return averagesByScope(rangeScope(range), daysPassed, type)
}

/**
 * 各分类的平均值
 *
 * 用户要求「平均值要显示各个类别的平均值」——
 * 光有总体的日均/笔均不够，还要看每个分类各自的平均值，
 * 才能知道「餐饮平均花多少」还是「购物平均花多少」。
 *
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @param {'expense'|'income'} type
 * @returns {Promise<Array<{id:string,name:string,icon:string,color:string,
 *   amount:number,count:number,avgPerTxn:number,avgPerDay:number,totalDays:number}>>}
 */
export async function getCategoryAveragesRange(range, type = 'expense') {
  const scope = rangeScope(range)
  const daysPassed = await rangeDaysPassed(range)

  const rows = await query(
    `SELECT COALESCE(c.parent_id, c.id) AS root_id,
            SUM(t.amount_cents) AS amt, COUNT(*) AS cnt
     FROM txn t
     LEFT JOIN category c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL AND t.type = ?${withScope('', scope)}
     GROUP BY root_id
     ORDER BY amt DESC`,
    [type].concat(scope.params)
  )

  if (rows.length === 0) return []

  // 取一级分类的名称、图标、颜色
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
    const amount = Number(r.amt) || 0
    const count = Number(r.cnt) || 0
    return {
      id: r.root_id,
      name: meta.name || '未分类',
      icon: meta.icon || 'more',
      color: meta.color || '#969799',
      amount,
      count,
      // 笔均：该分类平均每笔花多少
      avgPerTxn: count > 0 ? Math.round(amount / count) : 0,
      // 日均：该分类平均每天花多少
      avgPerDay: daysPassed > 0 ? Math.round(amount / daysPassed) : 0,
      totalDays: daysPassed
    }
  })
}

/* ---------------------------------------------------------- Top N 消费 */

/** Top N 主体 */
async function topExpensesByScope(scope, limit) {
  const rows = await query(
    `SELECT t.id, t.amount_cents, t.note, t.occurred_day, t.occurred_at,
            c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            a.name AS account_name, a.icon AS account_icon
     FROM txn t
     LEFT JOIN category c ON c.id = t.category_id
     LEFT JOIN account  a ON a.id = t.account_id
     WHERE t.deleted_at IS NULL AND t.type='expense'${withScope('', scope)}
     ORDER BY t.amount_cents DESC
     LIMIT ?`,
    scope.params.concat([Number(limit) || 10])
  )
  return rows.map((r) => ({
    ...r,
    amount_cents: Number(r.amount_cents) || 0,
    occurred_at: Number(r.occurred_at) || 0
  }))
}

export async function getTopExpenses(monthKey, limit = 10) {
  return topExpensesByScope(monthScope(monthKey), limit)
}

/**
 * 按任意日期区间的 Top N 消费（结构与 getTopExpenses 相同）
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @param {number} limit
 */
export async function getTopExpensesRange(range, limit = 10) {
  return topExpensesByScope(rangeScope(range), limit)
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

  // ★ 排除标记了「不计入预算」的交易 ★
  //   （一次性大额购物、退款、报销这类不该占预算额度）

  // 总支出
  const totalRow = await queryOne(
    `SELECT COALESCE(SUM(amount_cents),0) AS amt FROM txn
     WHERE deleted_at IS NULL AND type='expense' AND month_key = ?
       AND COALESCE(exclude_from_budget, 0) = 0`,
    [mk]
  )
  const monthExpense = Number(totalRow ? totalRow.amt : 0)

  // 分类支出
  const catRows = await query(
    `SELECT COALESCE(c.parent_id, c.id) AS root_id, SUM(t.amount_cents) AS amt
     FROM txn t LEFT JOIN category c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL AND t.type='expense' AND t.month_key = ?
       AND COALESCE(t.exclude_from_budget, 0) = 0
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

/**
 * 区间预算口径下的「候选月份」—— 某预算只可能在这些月份里生效。
 * 具体生效月份还要再按 budget.start_month 过滤。
 */
async function budgetCandidateMonths(kind, e) {
  if (kind === 'day') {
    const mk = e.monthKey || (e.startDay ? e.startDay.slice(0, 7) : '')
    return mk ? [mk] : []
  }
  if (kind === 'month') return e.monthKey ? [e.monthKey] : []
  if (kind === 'year') {
    const year = Number(e.startDay.slice(0, 4)) || 0
    return year ? monthListOfYear(year) : []
  }
  if (kind === 'custom') {
    if (!e.startDay || !e.endDay) return []
    return monthRangeList(e.startDay.slice(0, 7), e.endDay.slice(0, 7))
  }
  // 全部（不限时间）：最早有交易的月份 ~ 今天
  const row = await queryOne(`SELECT MIN(t.occurred_day) AS d FROM txn t WHERE t.deleted_at IS NULL`)
  const first = row && row.d ? String(row.d) : ''
  const todayMonth = toMonthKey()
  if (!first) return [todayMonth]
  const firstMonth = first.slice(0, 7)
  if (firstMonth > todayMonth) return [todayMonth]
  return monthRangeList(firstMonth, todayMonth)
}

/** 区间口径下的自然日进度（totalDays / passedDays / remainDays） */
function rangeCalendar(kind, e, firstDay) {
  const today = toDayKey()
  if (kind === 'day') {
    const mk = e.monthKey || (e.startDay ? e.startDay.slice(0, 7) : toMonthKey())
    return monthProgress(mk)
  }
  if (kind === 'year') {
    const year = Number(e.startDay.slice(0, 4)) || 0
    const total = isLeapYear(year) ? 366 : 365
    let passed = 0
    const todayYear = today.slice(0, 4)
    if (todayYear === String(year)) {
      passed = dayDiffInclusive(`${year}-01-01`, today)
    } else if (todayYear < String(year)) {
      passed = total
    }
    return { total, passed, remain: Math.max(total - passed, 0) }
  }
  if (kind === 'all') {
    if (!firstDay) {
      const mp = monthProgress(toMonthKey())
      return mp
    }
    const total = firstDay > today ? 0 : dayDiffInclusive(firstDay, today)
    return { total, passed: total, remain: 0 }
  }
  // custom
  const total = dayDiffInclusive(e.startDay, e.endDay)
  let passed = 0
  if (today >= e.endDay) passed = total
  else if (today >= e.startDay) passed = dayDiffInclusive(e.startDay, today)
  return { total, passed, remain: Math.max(total - passed, 0) }
}

/**
 * 按任意日期区间的预算使用情况
 *
 *   单月 → 与 getBudgetUsage(monthKey) 完全一致
 *   单日 → 按该日所属月计算（月度额度），used 只算区间内的支出
 *   整年 → 预算按月展开：limit = 月额度 × 生效月份数，used = 生效月份的支出合计
 *   全部 → 最早有交易的月份 ~ 今天，逐月展开
 *
 * 生效月份 = 区间月份中 start_month <= 该月的那些月；一个都没有则该预算不返回。
 *
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 */
export async function getBudgetUsageRange(range) {
  const e = expandRange(range)
  const kind = classifyRange(e)

  // 单月：与现有单月口径逐条一致
  if (kind === 'month') return getBudgetUsage(e.monthKey)

  // 单日 / 整年 / 全部 / 自定义：走下面的通用路径。
  // 通用路径用 rangeScope(range) 直接按区间聚合，
  // 所以单日区间的 used 天然只含这一天的支出，额度仍是月度额度。

  const budgets = await query('SELECT * FROM budget ORDER BY scope ASC')
  if (budgets.length === 0) return []

  const months = await budgetCandidateMonths(kind, e)
  if (months.length === 0) return []

  const scope = rangeScope(range)

  // 区间内的月度支出（总支出 + 分类支出）
  // ★ 排除标记了「不计入预算」的交易 ★
  const monthRows = await query(
    `SELECT t.month_key AS mk, COALESCE(c.parent_id, c.id) AS root_id,
            COALESCE(SUM(t.amount_cents),0) AS amt
     FROM txn t LEFT JOIN category c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL AND t.type='expense'
       AND COALESCE(t.exclude_from_budget, 0) = 0${withScope('', scope)}
     GROUP BY t.month_key, root_id`,
    scope.params
  )
  const totalByMonth = {}
  const catByMonth = {}
  monthRows.forEach((r) => {
    const mk = r.mk
    const amt = Number(r.amt) || 0
    totalByMonth[mk] = (totalByMonth[mk] || 0) + amt
    if (!catByMonth[mk]) catByMonth[mk] = {}
    catByMonth[mk][r.root_id] = amt
  })

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

  // 最早有交易的日期（全部口径下算自然日进度用）
  let firstDay = ''
  if (kind === 'all') {
    const row = await queryOne(`SELECT MIN(t.occurred_day) AS d FROM txn t WHERE t.deleted_at IS NULL`)
    firstDay = row && row.d ? String(row.d) : ''
  }
  const cal = rangeCalendar(kind, e, firstDay)

  const out = []
  for (const b of budgets) {
    const startMonth = b.start_month || ''

    // 生效月份 = 区间月份中，预算已经「开始」的那些月。
    // start_month 是「预算从哪个月开始生效」，
    // 所以 2025-06 建的预算在 2026 年整年视角下 12 个月全都生效（2025-06 <= 2026-01）。
    // 只有 start_month 落在所选区间之后（如预算 2026-06，看 2026 全年）才只算部分月份。
    const effective = months.filter((m) => !startMonth || m >= startMonth)
    if (effective.length === 0) continue

    const monthly = Number(b.amount_cents) || 0
    const limit = monthly * effective.length

    let used = 0
    if (b.scope === 'total') {
      for (const m of effective) used += totalByMonth[m] || 0
    } else {
      for (const m of effective) used += (catByMonth[m] && catByMonth[m][b.category_id]) || 0
    }

    const pct = limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0
    const remaining = limit - used

    // 剩余天数 = 生效月份里还没过的天数；都已过则用生效月份总数
    let remainDaysSum = 0
    for (const m of effective) remainDaysSum += monthProgress(m).remain
    const denom = remainDaysSum > 0 ? remainDaysSum : effective.length
    const dailyAvailable = remaining > 0 ? Math.max(Math.round(remaining / denom), 0) : 0

    out.push({
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
      remainDays: cal.remain,
      totalDays: cal.total,
      passedDays: cal.passed
    })
  }
  return out
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

/**
 * 任意区间的紧凑摘要（金额单位统一为「元」）
 *
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @param {string} label 可选，展示文案；缺省时按区间推导（格式同 selectionLabel）
 * @returns {Promise<{label:string,expense:number,income:number,balance:number,
 *   categories:Array<{name:string,amount:number}>,accounts:Array<{name:string,amount:number}>,
 *   avgPerDay:number,avgPerTxn:number,txnCount:number,
 *   top:Array<{amount:number,cat:string,note:string}>,budgets:Array<{name:string,percent:number,over:boolean}>}>}
 */
export async function getAiSummaryRange(range, label = '') {
  const [overview, cats, accounts, averages, top, budgets] = await Promise.all([
    getOverviewRange(range),
    getCategoryStatsRange(range, 'expense'),
    getAccountStatsRange(range, 'expense'),
    getAveragesRange(range),
    getTopExpensesRange(range, 5),
    getBudgetUsageRange(range)
  ])

  return {
    label: label || rangeLabel(range),
    expense: Math.round(overview.expense / 100),
    income: Math.round(overview.income / 100),
    balance: Math.round(overview.balance / 100),
    categories: cats.slice(0, 6).map((c) => ({ name: c.name, amount: Math.round(c.amount / 100) })),
    accounts: accounts.slice(0, 4).map((a) => ({ name: a.name, amount: Math.round(a.amount / 100) })),
    avgPerDay: Math.round(averages.avgPerDay / 100),
    avgPerTxn: Math.round(averages.avgPerTxn / 100),
    txnCount: averages.count,
    top: top.map((t) => ({ amount: Math.round(t.amount_cents / 100), cat: t.category_name, note: t.note })),
    budgets: budgets.map((b) => ({ name: b.name, percent: b.percent, over: b.over }))
  }
}
