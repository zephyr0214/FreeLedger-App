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
import { monthRange, toMonthKey, toDayKey, monthProgress, shiftMonth, shiftDay, parseDayKey, monthSpan, TREND_DAY_MAX_MONTHS } from '../utils/date.js'
/*
 * 同比窗口的换算统一收在 utils/compareRange.js
 *
 * ★ 为什么不在本文件里算 ★
 *   「本月到现在 → 上月同期」有月末夹取、闰年、跨年、整年、
 *   超长自定义区间五六个分支，是纯日期算术，和 SQL 一点关系都没有。
 *   抽成纯函数后可以拿固定日期把每个分支钉死（scripts/test-compare-range.mjs），
 *   页面文案也能复用同一份 label 生成逻辑。
 */
import { buildCompareRange, changePercent } from '../utils/compareRange.js'
import { ACCOUNT_TYPES } from './account.js'
// 结转口径只定义在 api/budget.js 一处，统计层复用同一个纯函数 ——
// 两边各写一遍算法，迟早会出现「预算页说到这月还剩 100、详情页说 90」。
import { computeMonthAvailability } from './budget.js'

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

/**
 * 「不计入收支」的 SQL 片段（v19）
 *
 * ★ 为什么所有收支统计都要带它 ★
 *   借入 / 借出 / 借款归还 / 借款收回是资金往来，不是消费也不是收入：
 *   借给姐姐 500，我的「本月支出」不该多 500；姐姐还我 500，
 *   我也没赚 500。少了这个条件，统计页的分类占比、趋势、日均
 *   全部会被借款流水带偏，而这笔钱在账户页的余额里是对的。
 *
 * ★ 为什么用 COALESCE 而不是直接 = 0 ★
 *   v19 之前建的库在迁移跑完前可能有 NULL（理论上不会，ALTER 时
 *   已经 DEFAULT 0 回填了，但导入的老备份 JSON 里可能缺这一列），
 *   用 COALESCE 兜一下，宁可多算不漏算。
 */
const NOT_EXCLUDED_STATS = 'COALESCE(t.exclude_from_stats, 0) = 0'

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
       AND COALESCE(exclude_from_stats, 0) = 0
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
     WHERE t.deleted_at IS NULL AND ${NOT_EXCLUDED_STATS}${withScope('', scope)}`,
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
     FROM txn WHERE deleted_at IS NULL AND COALESCE(exclude_from_stats, 0) = 0`,
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
     FROM txn WHERE deleted_at IS NULL AND COALESCE(exclude_from_stats, 0) = 0`,
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
     WHERE t.deleted_at IS NULL AND t.type = ? AND ${NOT_EXCLUDED_STATS}${withScope('', scope)}
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
      // ★ 分类被删除后，交易的 category_id 变成 NULL，
      //   COALESCE 之后 root_id 也是 NULL —— 给个非空 id 给列表 key 用。
      id: r.root_id || 'none',
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
     WHERE t.deleted_at IS NULL AND t.type = ? AND ${NOT_EXCLUDED_STATS}${withScope('', rangeScope(range))}
     GROUP BY t.category_id
     ORDER BY amt DESC`,
    [type].concat(rangeScope(range).params)
  )

  // 按调色板顺序取色：每块颜色都不同
  return rows.map((r, i) => ({
    // ★ 分类被删除后，交易的 category_id 变成 NULL ★
    //   给个非空 id 给列表的 v-for key 用，名字显示「未分类」。
    id: r.id || 'none',
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
       AND ${NOT_EXCLUDED_STATS}
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
     WHERE t.deleted_at IS NULL AND t.type = ? AND ${NOT_EXCLUDED_STATS}${withScope('', scope)}
     GROUP BY t.account_id
     ORDER BY amt DESC`,
    [type].concat(scope.params)
  )
  return rows.map((r) => ({
    // ★ 账户被删除后，交易的 account_id 变成空字符串 ★
    //   这里给个非空的 id（列表的 v-for key 用），
    //   名字显示「无账户」，和用户删除账户后的预期一致。
    id: r.id || 'none',
    name: r.id ? (r.name || '已删除账户') : '无账户',
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
    `SELECT COALESCE(a.type, 'other') AS account_type,
            SUM(t.amount_cents) AS amt, COUNT(*) AS cnt
     FROM txn t
     LEFT JOIN account a ON a.id = t.account_id
     WHERE t.deleted_at IS NULL AND t.type = ? AND ${NOT_EXCLUDED_STATS}${withScope('', rangeScope(range))}
     GROUP BY COALESCE(a.type, 'other')
     ORDER BY amt DESC`,
    [type].concat(rangeScope(range).params)
  )

  // 按 ACCOUNT_TYPES 的顺序输出，颜色用类型自己的颜色
  const order = ACCOUNT_TYPES.map((t) => t.key)
  const rowMap = {}
  for (const r of rows) {
    rowMap[r.account_type || 'other'] = r
  }

  const out = ACCOUNT_TYPES
    .filter((t) => rowMap[t.key])
    .map((t) => ({
      key: t.key,
      name: t.name,
      icon: t.icon,
      color: ACCOUNT_TYPE_COLORS[t.key] || '#1989FA',
      amount: Number(rowMap[t.key].amt) || 0,
      count: Number(rowMap[t.key].cnt) || 0
    }))

  // ★ 「无账户」也要显示出来 ★
  //   账户被删除后，它名下的交易变成「无账户」（account_id = ''）。
  //   这些金额如果不单独列一块，环形图上的合计会比实际支出少一块 ——
  //   表现为「支出总额和图表对不上」。
  if (rowMap['other']) {
    out.push({
      key: 'other',
      name: '无账户',
      icon: 'wallet',
      color: ACCOUNT_TYPE_COLORS.other || '#969799',
      amount: Number(rowMap['other'].amt) || 0,
      count: Number(rowMap['other'].cnt) || 0
    })
  }

  return out
}

/**
 * 账户类别配色（饼图用）
 * 取自 PIE_PALETTE 的前几个色位，和分类统计的饼图是同一套视觉语言。
 *
 * ★ 欠钱的两个类型故意用邻近的红/粉 ★
 *   信用卡和网络借贷在概念上是一类（都是负债），
 *   分到完全不相关的颜色会让人以为是两种毫不相干的账户；
 *   红配粉既能区分，又能一眼看出「这俩都在负债那边」。
 *   电话卡用青色：它是储蓄卡之外最常见的「存钱的卡」，
 *   取一个和绿色（储蓄卡）区分度高、又不抢眼的色位。
 *
 * ★ 别漏 ★
 *   ACCOUNT_TYPES 里每加一个真实类型，这里要补一个色位，
 *   否则饼图会掉到兜底色 '#1989FA'，和「网络支付」撞成同一个蓝。
 */
const ACCOUNT_TYPE_COLORS = {
  online: PIE_PALETTE[0],   // 蓝
  credit: PIE_PALETTE[3],   // 红
  loan: PIE_PALETTE[5],     // 粉（和信用卡同属负债）
  debit: PIE_PALETTE[2],    // 绿
  phone: PIE_PALETTE[8],    // 青
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
     WHERE t.deleted_at IS NULL AND t.type = ? AND ${NOT_EXCLUDED_STATS}${withScope('', scope)} AND tg.deleted_at IS NULL
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
     WHERE t.deleted_at IS NULL AND t.type='expense' AND ${NOT_EXCLUDED_STATS}${withScope('', scope)}
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
     WHERE t.deleted_at IS NULL AND ${NOT_EXCLUDED_STATS}${withScope('', scope)}
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
     WHERE t.deleted_at IS NULL AND ${NOT_EXCLUDED_STATS}${withScope('', scope)}
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
 *   自定义 → 看跨了几个月（见下）
 *   全部  → 按月分桶，只输出有交易的月份（无交易返回空数组）
 *
 * ★ 自定义区间的分桶规则（用户指定）★
 *   跨 1~2 个自然月 → 按天分桶（近一周、近一月都落在这里）；
 *   跨 3 个月以上   → 按月分桶（近半年、近一年、近五年）。
 *   判据用 utils/date.js 的 monthSpan，不是写死多少天 ——
 *   写死 62 天会让「7/1~8/31」（正好两个整月、62 天）卡在边界上，
 *   相邻两个月来回点会看到图表在日/月之间跳。
 *
 * ★ 自定义区间的天/月桶要「连续」★
 *   以前只输出有交易的那些桶，于是「近半年」画出来可能只有 2 根柱子，
 *   时间轴被压缩，看着像统计漏了月份。现在按区间补全空桶。
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

  // 整年 → 固定 12 个月，不足补 0
  if (kind === 'year') {
    const rows = await trendByMonth(scope)
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

  // 自定义区间：按跨月数决定日/月分桶
  if (kind === 'custom') {
    const span = monthSpan(e.startDay, e.endDay)

    /*
     * 跨 1~2 个月 → 按天连续补全。
     * label 在跨月时写成「M/D」：两段里都有 15 号，只写「15」分不清是哪个月。
     */
    if (span > 0 && span <= TREND_DAY_MAX_MONTHS) {
      const rows = await trendByDay(scope)
      const map = {}
      rows.forEach((r) => {
        map[String(r.day_key)] = { expense: Number(r.exp) || 0, income: Number(r.inc) || 0 }
      })
      const crossMonth = e.startDay.slice(0, 7) !== e.endDay.slice(0, 7)
      const out = []
      let cur = e.startDay
      // 上限兜底：区间再长也不会超过 62 天（两个月），循环不可能爆
      for (let guard = 0; guard < 400; guard++) {
        const item = map[cur] || { expense: 0, income: 0 }
        const dayNum = String(Number(cur.slice(8, 10)))
        out.push({
          bucket: 'day',
          label: crossMonth ? `${Number(cur.slice(5, 7))}/${dayNum}` : dayNum,
          expense: item.expense,
          income: item.income
        })
        if (cur === e.endDay) break
        cur = shiftDay(cur, 1)
      }
      return out
    }

    // 跨 3 个月以上 → 按月连续补全（近半年 6 根、近一年 12 根，不是只画有数据的月份）
    const rows = await trendByMonth(scope)
    const map = {}
    rows.forEach((r) => { map[r.mk] = r })
    const out = []
    for (const mk of monthRangeList(e.startDay.slice(0, 7), e.endDay.slice(0, 7))) {
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

  // 全部（不限时间）：只输出有交易的月份 —— 全量可能横跨好几年，补全没意义
  const rows = await trendByMonth(scope)
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
     FROM txn t WHERE t.deleted_at IS NULL AND t.type = ? AND ${NOT_EXCLUDED_STATS}${withScope('', scope)}`,
    [type].concat(scope.params)
  )
  const total = Number(row ? row.total : 0)
  const cnt = Number(row ? row.cnt : 0)

  // 最高单日
  const maxDay = await queryOne(
    `SELECT t.occurred_day AS day, SUM(t.amount_cents) AS amt
     FROM txn t WHERE t.deleted_at IS NULL AND t.type = ? AND ${NOT_EXCLUDED_STATS}${withScope('', scope)}
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

  // 自定义区间：用区间内「最早一笔 ~ 最晚一笔」的实际跨度（用户指定）
  //
  // ★ 为什么不再用「区间起止与今天的交集」★
  //   用户选「近一月」时可能只有 3 天有账，按 30 天算日均会把数字压得很小，
  //   看着像「这个月花得很少」，其实是分母被空白天数摊薄了。
  //   改成真实记账跨度后，日均表达的是「有账的那几天平均花了多少」。
  //
  // ★ 为什么是「含首尾的天数」而不是纯差值 ★
  //   只有一笔时最早 == 最晚，纯差值是 0，日均就成了 0（除零保护生效）；
  //   dayDiffInclusive 是含首尾的算法，单笔正好得到 1，日均就等于这笔钱本身。
  //
  // ★ 一笔都没有时返回 0 ★
  //   调用方 getAveragesRange 里是 daysPassed > 0 ? total / daysPassed : 0，
  //   所以给 0 就是「日均 0」，不会出 NaN。
  if (kind === 'custom') {
    const scope = rangeScope(range)
    const row = await queryOne(
      `SELECT MIN(t.occurred_day) AS first_day, MAX(t.occurred_day) AS last_day
       FROM txn t WHERE t.deleted_at IS NULL${withScope('', scope)}`,
      scope.params
    )
    const firstDay = row && row.first_day ? String(row.first_day) : ''
    const lastDay = row && row.last_day ? String(row.last_day) : ''
    if (!firstDay || !lastDay) return 0
    return dayDiffInclusive(firstDay, lastDay)
  }

  // 整月 / 单日：区间起止与今天的交集
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
     WHERE t.deleted_at IS NULL AND t.type = ? AND ${NOT_EXCLUDED_STATS}${withScope('', scope)}
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
      // ★ 分类被删除后 root_id 为 NULL —— 给个非空 id 给列表 key 用
      id: r.root_id || 'none',
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

/**
 * 各二级分类的平均值（平均值面板的下拉可选「二级分类」）
 *
 * 统计页「平均值」面板默认显示一级分类（getCategoryAveragesRange），
 * 但用户要能切到二级分类（午餐、外卖、房租…）。
 * 二级聚合按 t.category_id 分组，配色沿用 PIE_PALETTE（与分类统计饼图一致）。
 *
 * ★ 与 getCategoryAveragesRange 的结构保持一致 ★
 *   这样页面拿到数据后，渲染逻辑可以复用同一段模板。
 *
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @param {'expense'|'income'} type
 * @returns {Promise<Array<{id:string,name:string,icon:string,color:string,
 *   parentName:string,amount:number,count:number,avgPerTxn:number,avgPerDay:number,totalDays:number}>>}
 */
export async function getSubCategoryAveragesRange(range, type = 'expense') {
  const scope = rangeScope(range)
  const daysPassed = await rangeDaysPassed(range)

  const rows = await query(
    `SELECT t.category_id AS id,
            c.name, c.icon, c.color,
            COALESCE(p.name, '未分类') AS parent_name,
            SUM(t.amount_cents) AS amt, COUNT(*) AS cnt
     FROM txn t
     LEFT JOIN category c ON c.id = t.category_id
     LEFT JOIN category p ON p.id = c.parent_id
     WHERE t.deleted_at IS NULL AND t.type = ? AND ${NOT_EXCLUDED_STATS}${withScope('', scope)}
     GROUP BY t.category_id
     ORDER BY amt DESC`,
    [type].concat(scope.params)
  )

  return rows.map((r, i) => {
    const amount = Number(r.amt) || 0
    const count = Number(r.cnt) || 0
    return {
      // ★ 分类被删除后 id 为 NULL —— 给个非空 id 给列表 key 用
      id: r.id || 'none',
      name: r.name || '未分类',
      icon: r.icon || 'more',
      color: PIE_PALETTE[i % PIE_PALETTE.length],
      parentName: r.parent_name || '未分类',
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
     WHERE t.deleted_at IS NULL AND t.type='expense' AND ${NOT_EXCLUDED_STATS}${withScope('', scope)}
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

/**
 * 同比变化：所选区间 vs「上一段同期」
 *
 * ★ 对比窗口怎么算（本轮用户第 2 条重新定义）★
 *   用户原话：「比如选中本月，应该是 11.1-今天同比 10 月最后相同天的变化，
 *             如果选中的范围全部有收支则全部同比，以此类推」。
 *   即：
 *     · 整月 / 一个月以内 → **上月同期**（同一段号），11/1~11/8 ↔ 10/1~10/8
 *     · 整年             → **去年同期**
 *     · 跨多月的自定义段 → 紧挨着的等长区间（不前跳重叠）
 *   具体换算全在 utils/compareRange.js 的 buildCompareRange()，
 *   那里有完整分支与月末夹取，页面和测试共用同一份实现。
 *
 * ★ 「今天」和「没有数据的日子」★
 *   区间终点晚于今天时先截到今天（否则「半个空月」比「整月」，
 *   所有数字都会显示成暴跌）；截断后**对比窗口按截断后的长度对齐**。
 *   区间里没有流水的那几天照样占窗口位置，不会因为「那天没记账」
 *   就把窗口缩短 —— 同比的前提是时间等长，不是数据等量。
 *
 * ★ 为什么返回分类维度的数组 ★
 *   面板下段要「每类别一行：分类名 + 变化值 + 百分比 + 双向柱状图」，
 *   所以必须给出每个分类在两段里的金额，前端才能算增减、画左右柱子。
 *
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @param {{level?:'root'|'sub', type?:'expense'|'income', today?:string}} [opt]
 *   level = 一级（默认，按一级分类归并）/ 二级（按二级分类，没有二级的归到自己）
 *   type  = 支出（默认）/ 收入 —— 决定下方分类列表走哪个方向
 *   today = 可注入的「今天」，测试用；不传给真实今天
 * @returns {Promise<null|{
 *   align:'year'|'month'|'span', clipped:boolean,
 *   curStart:string, curEnd:string, prevStart:string, prevEnd:string,
 *   current:{expense:number,income:number,balance:number,count:number},
 *   previous:{expense:number,income:number,balance:number,count:number},
 *   categories:Array<{id:string,name:string,color:string,
 *     current:number,previous:number,diff:number,pct:number|null}>
 * }>} null = 该区间算不出对比（不限时间 / 全在未来）
 */
export async function getPeriodComparison(range, opt = {}) {
  const level = opt.level === 'sub' ? 'sub' : 'root'
  const type = opt.type === 'income' ? 'income' : 'expense'

  const cr = buildCompareRange(range, opt.today || toDayKey())
  if (!cr) return null

  /* 两段各查一次总账（同一条 SQL，只换 where 参数） */
  const sumOf = async (startDay, endDay) => {
    const row = await queryOne(
      `SELECT COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount_cents ELSE 0 END),0) AS exp,
              COALESCE(SUM(CASE WHEN t.type='income'  THEN t.amount_cents ELSE 0 END),0) AS inc,
              COUNT(*) AS cnt
       FROM txn t
       WHERE t.deleted_at IS NULL AND ${NOT_EXCLUDED_STATS}
         AND t.occurred_day >= ? AND t.occurred_day <= ?`,
      [startDay, endDay]
    )
    const exp = Number(row ? row.exp : 0)
    const inc = Number(row ? row.inc : 0)
    return { expense: exp, income: inc, balance: inc - exp, count: Number(row ? row.cnt : 0) }
  }

  const current = await sumOf(cr.curStart, cr.curEnd)
  const previous = await sumOf(cr.prevStart, cr.prevEnd)

  /*
   * 分类维度
   *
   * ★ 一级 / 二级两种归并 ★
   *   一级：COALESCE(c.parent_id, c.id) —— 二级都向上归并到一级，
   *         交易没有分类时 root_id 为 NULL，统一落到「未分类」。
   *   二级：直接按 t.category_id 分，没有二级的交易自然就是他那个分类本身，
   *         和统计页「分类统计」的二级口径完全一致。
   *
   * ★ 二级的配色按序号取调色板 ★
   *   二级分类种子里继承父级色，同一支下的几个二级是同一个颜色，
   *   一列柱子看着像同一类被拆成好几个，所以按序取互不相同的颜色。
   */
  const catOf = async (startDay, endDay) => {
    const groupCol = level === 'sub' ? 't.category_id' : 'COALESCE(c.parent_id, c.id)'
    const rows = await query(
      `SELECT ${groupCol} AS root_id,
              COALESCE(c.name, '未分类') AS name,
              COALESCE(c.color, '#969799') AS color,
              SUM(t.amount_cents) AS amt,
              COUNT(*) AS cnt
       FROM txn t
       LEFT JOIN category c ON c.id = t.category_id
       WHERE t.deleted_at IS NULL AND t.type = ? AND ${NOT_EXCLUDED_STATS}
         AND t.occurred_day >= ? AND t.occurred_day <= ?
       GROUP BY root_id`,
      [type, startDay, endDay]
    )
    const map = {}
    for (const r of rows) {
      const key = r.root_id || 'none'
      map[key] = {
        id: key,
        name: r.name || '未分类',
        color: r.color || '#969799',
        amount: Number(r.amt) || 0,
        count: Number(r.cnt) || 0
      }
    }
    return map
  }

  const curCats = await catOf(cr.curStart, cr.curEnd)
  const prevCats = await catOf(cr.prevStart, cr.prevEnd)

  const allKeys = new Set([...Object.keys(curCats), ...Object.keys(prevCats)])
  const categories = Array.from(allKeys).map((key) => {
    const c = curCats[key] || prevCats[key]
    const cur = (curCats[key] || {}).amount || 0
    const prev = (prevCats[key] || {}).amount || 0
    return {
      id: key,
      name: c.name,
      color: c.color,
      current: cur,
      previous: prev,
      diff: cur - prev,
      /*
       * ★ 百分比在这里一次算好，不让页面各算各的 ★
       *   上期为 0 时 changePercent 返回 null（页面显示「新增」），
       *   两处各写一遍三元表达式，迟早一边算成 +100%、一边算成无限。
       */
      pct: changePercent(cur, prev)
    }
  })
  // 按「变化绝对值」降序：变化最大的排前面，扫一眼先看到重点
  categories.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))

  // ★ 二级配色：按当前顺序从调色板取，保证相邻两根柱子颜色不同 ★
  if (level === 'sub') {
    categories.forEach((c, i) => { c.color = PIE_PALETTE[i % PIE_PALETTE.length] })
  }

  return {
    align: cr.align,
    clipped: cr.clipped,
    curStart: cr.curStart,
    curEnd: cr.curEnd,
    prevStart: cr.prevStart,
    prevEnd: cr.prevEnd,
    current,
    previous,
    categories: categories.slice(0, 20)
  }
}

/**
 * 恩格尔系数（食品支出 / 总支出）
 *
 * ★ 「哪些算食品」由**用户自己在组件管理页选**（本轮第 3 条）★
 *   早期版本是让 AI 按分类名猜，用户明确要求删掉那套逻辑：
 *   AI 判定既不稳定（同样的分类名两次可能给不同答案），
 *   也永远不如用户自己清楚「我这几个分类是吃饭花的」。
 *   选择结果存在 setting 的 `engelFoodCategories`（一级分类 id 数组），
 *   见 api/engel.js 与 pages/settings/stats-panels.vue。
 *   这个函数只负责按给定的分类 id 算比例，不参与「选哪些」的判断。
 *
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @param {string[]} foodCategoryIds 被认为是「吃」的一级分类 id
 */
export async function getEngelCoefficient(range, foodCategoryIds = []) {
  const scope = rangeScope(range)

  const row = await queryOne(
    `SELECT COALESCE(SUM(t.amount_cents),0) AS total
     FROM txn t
     WHERE t.deleted_at IS NULL AND t.type='expense' AND ${NOT_EXCLUDED_STATS}${withScope('', scope)}`,
    scope.params
  )
  const total = Number(row ? row.total : 0) || 0

  if (total === 0) return { total: 0, food: 0, ratio: 0, foodIds: foodCategoryIds }

  const ids = Array.isArray(foodCategoryIds) ? foodCategoryIds.filter(Boolean) : []
  if (ids.length === 0) return { total, food: 0, ratio: 0, foodIds: [] }

  const placeholders = ids.map(() => '?').join(',')
  const foodRow = await queryOne(
    `SELECT COALESCE(SUM(t.amount_cents),0) AS food
     FROM txn t
     LEFT JOIN category c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL AND t.type='expense' AND ${NOT_EXCLUDED_STATS}${withScope('', scope)}
       AND COALESCE(c.parent_id, c.id) IN (${placeholders})`,
    scope.params.concat(ids)
  )
  const food = Number(foodRow ? foodRow.food : 0) || 0
  return {
    total,
    food,
    // 百分比保留 1 位小数（恩格尔系数习惯用百分数）
    ratio: Math.round((food / total) * 1000) / 10,
    foodIds: ids
  }
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

/**
 * 把预算挂的类别一次性查出来，按预算 id 分组。
 *
 * ★ 为什么以关联表为准 ★
 *   v18 起一条子预算可以挂多个类别，真正来源是 budget_category；
 *   budget.category_id 只是「第一个类别」的冗余列（给老版本 App 兜底显示）。
 *
 * ★ 为什么要留单列兜底 ★
 *   migrate() 对单条迁移是「失败只 log、版本号照样推进」的，
 *   万一 v18 的回填没跑成，关联表就是空的 ——
 *   这时退回单列 category_id，用户升级后预算至少还能正常显示和使用。
 *
 * @param {Array<Object>} budgets budget 表的行
 * @returns {Promise<Object<string, Array<{id:string,name:string,icon:string}>>>}
 */
async function loadBudgetCategories(budgets) {
  const list = Array.isArray(budgets) ? budgets : []
  const ids = list.filter((b) => b.scope === 'category').map((b) => b.id)
  const map = {}
  if (ids.length === 0) return map

  const rows = await query(
    `SELECT bc.budget_id AS bid, c.id AS cid, c.name AS cname, c.icon AS cicon
     FROM budget_category bc
     JOIN category c ON c.id = bc.category_id AND c.deleted_at IS NULL
     WHERE bc.budget_id IN (${ids.map(() => '?').join(',')})
     ORDER BY c.sort ASC, c.created_at ASC`,
    ids
  )
  rows.forEach((r) => {
    if (!map[r.bid]) map[r.bid] = []
    map[r.bid].push({ id: r.cid, name: r.cname || '', icon: r.cicon || '' })
  })

  const legacy = list.filter((b) => b.scope === 'category' && !map[b.id] && b.category_id)
  if (legacy.length > 0) {
    const catIds = legacy.map((b) => b.category_id)
    const catRows = await query(
      `SELECT id, name, icon FROM category
       WHERE deleted_at IS NULL AND id IN (${catIds.map(() => '?').join(',')})`,
      catIds
    )
    const byId = {}
    catRows.forEach((c) => { byId[c.id] = { id: c.id, name: c.name || '', icon: c.icon || '' } })
    legacy.forEach((b) => {
      const c = byId[b.category_id]
      if (c) map[b.id] = [c]
    })
  }

  return map
}

/**
 * 预算的展示名。
 *
 *   月预算 -> 固定「月预算」
 *   子预算 -> 用户起的名字优先；没起名就按挂的类别拼：
 *             一个类别用它的名字；两个用「A、B」；
 *             再多用「A、B 等N项」—— 一行放不下太多字。
 */
function budgetDisplayName(b, cats) {
  if (b.scope === 'total') return '月预算'
  const name = String(b.name || '').trim()
  if (name) return name
  const names = (cats || []).map((c) => c.name).filter(Boolean)
  if (names.length === 0) return '已删除分类'
  if (names.length === 1) return names[0]
  if (names.length === 2) return names.join('、')
  return `${names[0]}、${names[1]} 等${names.length}项`
}

/**
 * 某段月份区间内「每个月计入预算的支出」。
 *
 * ★ 为什么结转要查这么多月 ★
 *   结转是逐月累计的：要算 2026-10 的结转，得知道 2026-03（起始月）
 *   到 2026-09 每个月各花了多少。只查目标月永远只能得到 0 结转。
 *
 * @param {string} fromMonth 含（'YYYY-MM'）
 * @param {string} toMonth   不含（'YYYY-MM'）
 * @returns {Promise<Object<string, number>>}
 */
async function monthlyBudgetExpenseMap(fromMonth, toMonth) {
  const map = {}
  if (!fromMonth || !toMonth || fromMonth >= toMonth) return map

  const rows = await query(
    `SELECT month_key AS mk, COALESCE(SUM(amount_cents),0) AS amt
     FROM txn
     WHERE deleted_at IS NULL AND type = 'expense'
       AND COALESCE(exclude_from_budget, 0) = 0
       AND month_key >= ? AND month_key < ?
     GROUP BY month_key`,
    [fromMonth, toMonth]
  )
  rows.forEach((r) => { map[r.mk] = Number(r.amt) || 0 })
  return map
}

/** 'YYYY-MM' 递增一个月 */
function nextMonthKey(monthKey) {
  let y = Number(String(monthKey).slice(0, 4)) || 0
  let m = Number(String(monthKey).slice(5, 7)) || 0
  m += 1
  if (m > 12) { m = 1; y += 1 }
  return `${y}-${String(m).padStart(2, '0')}`
}

/**
 * 月预算在若干个月份里各自的「可用额度」（月额度 + 上期结转）。
 *
 * 口径见 api/budget.js 的 computeMonthAvailability（逐月累计、只结转正数）：
 *   每月可用 = 月额度 + 上期结转
 *   本期结转 = max(0, 本期可用 - 本期已用)
 * 超支时结转 0，不透支下月额度。
 *
 * @param {object} totalRow budget 表里 scope='total' 的行
 * @param {string[]} months 升序月份列表
 * @returns {Promise<Object<string, number>>} monthKey -> 可用额度（分）
 */
async function totalBudgetMonthlyAvailability(totalRow, months) {
  const monthly = Number(totalRow.amount_cents) || 0
  const startMonth = totalRow.start_month || ''
  const rollover = Number(totalRow.rollover) === 1
  const out = {}

  if (!rollover || !startMonth || months.length === 0) {
    months.forEach((m) => { out[m] = monthly })
    return out
  }

  const wanted = new Set(months)
  const last = months[months.length - 1]
  const usedByMonth = await monthlyBudgetExpenseMap(startMonth, nextMonthKey(last))

  let carry = 0
  let m = startMonth
  while (m <= last) {
    if (wanted.has(m)) out[m] = monthly + carry
    carry = Math.max(0, carry + monthly - (Number(usedByMonth[m]) || 0))
    m = nextMonthKey(m)
  }
  return out
}

/** 月预算在单独某个月的结转额（没开结转/尚未开始 -> 0） */
async function totalBudgetCarryover(totalRow, targetMonth) {
  if (!totalRow || Number(totalRow.rollover) !== 1) return 0
  const startMonth = totalRow.start_month || ''
  if (!startMonth || startMonth >= targetMonth) return 0

  const usedByMonth = await monthlyBudgetExpenseMap(startMonth, targetMonth)
  return computeMonthAvailability({
    monthly: Number(totalRow.amount_cents) || 0,
    startMonth,
    monthKey: targetMonth,
    usedByMonth,
    rollover: true
  }).carryover
}

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
  //
  // ★ 必须同时按「一级」和「二级」两个口径算 ★
  //   子预算挂的类别可能是二级、也可能是一级，
  //   如果只用 COALESCE(c.parent_id, c.id) 归并到一级，
  //   那么 key 全是一级 id，拿二级 id 去查永远是 0，
  //   于是「子预算的已用恒为 0」。
  //
  //   所以两套口径都查一遍：
  //     catMapRoot  一级 id -> 该一级下所有交易的合计
  //     catMapLeaf  二级 id -> 该二级自己的交易合计
  const catRows = await query(
    `SELECT COALESCE(c.parent_id, c.id) AS root_id,
            t.category_id AS leaf_id,
            SUM(t.amount_cents) AS amt
     FROM txn t LEFT JOIN category c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL AND t.type='expense' AND t.month_key = ?
       AND COALESCE(t.exclude_from_budget, 0) = 0
     GROUP BY root_id, leaf_id`,
    [mk]
  )
  const catMapRoot = {}
  const catMapLeaf = {}
  catRows.forEach((r) => {
    const amt = Number(r.amt) || 0
    if (r.root_id) catMapRoot[r.root_id] = (catMapRoot[r.root_id] || 0) + amt
    if (r.leaf_id) catMapLeaf[r.leaf_id] = (catMapLeaf[r.leaf_id] || 0) + amt
  })

  /**
   * 某个分类 id（一级或二级）对应的支出合计。
   *
   * ★ 为什么不能简单地「有 leaf 就用 leaf」★
   *   一级分类也可能**直接**挂着交易（比如「其他/杂项」这种没有二级的），
   *   那样 catMapLeaf['一级id'] 也会存在。
   *   如果优先取 leaf，一级预算就只会统计到那几笔直接挂一级的交易，
   *   把它下面所有二级的交易全漏掉 —— 这是写测试时才发现的问题。
   *
   *   正确做法：先判断这个 id 是不是「一级分类」。
   *   是一级 -> 用 root 口径（含所有子孙）；是二级 -> 用 leaf 口径（只算自己）
   *
   *   parentIds 是从 GROUP BY 结果里收集的：只要有一行 root_id === leaf_id，
   *   说明这个 id 自己就是根（没有 parent）。
   */
  const parentIds = new Set()
  catRows.forEach((r) => {
    if (r.root_id && r.root_id === r.leaf_id) parentIds.add(r.root_id)
  })

  const usedOf = (catId) => {
    if (!catId) return 0
    if (parentIds.has(catId)) return catMapRoot[catId] || 0
    return catMapLeaf[catId] !== undefined
      ? catMapLeaf[catId]
      : (catMapRoot[catId] || 0)
  }

  const catInfo = await loadBudgetCategories(budgets)
  const totalRowBudget = budgets.find((b) => b.scope === 'total') || null
  const carryover = await totalBudgetCarryover(totalRowBudget, mk)

  return budgets.map((b) => {
    const monthly = Number(b.amount_cents) || 0
    const cats = catInfo[b.id] || []
    const isTotal = b.scope === 'total'

    /*
     * ★ limit 与 baseLimit 的区别 ★
     *   limit     本月**实际可用**（月额度 + 上期结转）—— 进度条、剩余都按它算
     *   baseLimit 本月**本来是多少**（不含结转）—— 「月预算 → 子预算」的额度
     *             分配按它算；把结转也算进可分配池，子预算能设的额度会随
     *             月份莫名其妙变大，用户完全没法理解。
     */
    const baseLimit = monthly
    const carry = isTotal ? carryover : 0
    const limit = monthly + carry

    // 子预算的「已用」= 它挂的所有类别的支出之和。
    // （api/budget.js 保证不会同时挂一级和它自己的二级，所以不会重复计算。）
    const used = isTotal
      ? monthExpense
      : cats.reduce((sum, c) => sum + usedOf(c.id), 0)

    const pct = limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0
    const remaining = limit - used
    /*
     * ★ 日均可用：保留「分」的精度，不做整数四舍五入 ★
     *   原来 Math.round(...) 会把结果取整到「元」级别的分，
     *   前端再 toFixed(2) 也只可能显示 xxx.00。
     *   现在只对「分」保留两位小数的除数精度（除以剩余天数后仍有小数），
     *   前端按 0.00 展示就是真实值。
     */
    const dailyAvailable = remain > 0
      ? Math.max(Math.round((remaining / remain) * 100) / 100, 0)
      : 0

    return {
      id: b.id,
      scope: b.scope,
      categoryId: b.category_id,
      categoryIds: cats.map((c) => c.id),
      categoryNames: cats.map((c) => c.name),
      name: budgetDisplayName(b, cats),
      icon: isTotal ? 'chart' : ((cats[0] && cats[0].icon) || 'more'),
      limit,
      baseLimit,
      carryover: carry,
      monthly,
      // 是否开启了「未用完结转到下一月」（只有月预算可能为 true）
      rollover: isTotal && Number(b.rollover) === 1,
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
 *   整年 → 预算按月展开：limit = 各生效月的可用额度之和，used = 生效月支出合计
 *   全部 → 最早有交易的月份 ~ 今天，逐月展开
 *
 * ★ 结转在区间口径下逐月展开 ★
 *   开了结转的月预算，每个月的可用额度都不一样（前面几个月攒下来的），
 *   所以区间额度不能简单「月额度 × 月数」，必须把每个月各自算出来再相加。
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

  const budgets = await query('SELECT * FROM budget ORDER BY scope ASC')
  if (budgets.length === 0) return []

  const months = await budgetCandidateMonths(kind, e)
  if (months.length === 0) return []

  const scope = rangeScope(range)

  // 区间内的月度支出（总支出 + 分类支出）
  // ★ 排除标记了「不计入预算」的交易 ★
  //
  // ★ 一级 / 二级两套口径都要留 ★
  //   子预算挂的类别可能是二级：只按 COALESCE(parent_id, id) 归并到一级的话，
  //   拿二级 id 去查永远是 0 —— 子预算的「已用」就恒为 0。
  const monthRows = await query(
    `SELECT t.month_key AS mk,
            COALESCE(c.parent_id, c.id) AS root_id,
            t.category_id AS leaf_id,
            COALESCE(SUM(t.amount_cents),0) AS amt
     FROM txn t LEFT JOIN category c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL AND t.type='expense'
       AND COALESCE(t.exclude_from_budget, 0) = 0${withScope('', scope)}
     GROUP BY t.month_key, root_id, leaf_id`,
    scope.params
  )
  const totalByMonth = {}
  const catRootByMonth = {}
  const catLeafByMonth = {}
  monthRows.forEach((r) => {
    const mk = r.mk
    const amt = Number(r.amt) || 0
    totalByMonth[mk] = (totalByMonth[mk] || 0) + amt
    if (r.root_id) {
      if (!catRootByMonth[mk]) catRootByMonth[mk] = {}
      catRootByMonth[mk][r.root_id] = (catRootByMonth[mk][r.root_id] || 0) + amt
    }
    if (r.leaf_id) {
      if (!catLeafByMonth[mk]) catLeafByMonth[mk] = {}
      catLeafByMonth[mk][r.leaf_id] = (catLeafByMonth[mk][r.leaf_id] || 0) + amt
    }
  })

  /**
   * 某个月里，某个分类（一级或二级）的支出。
   *
   * ★ 必须区分父子，不能「有 leaf 就用 leaf」★
   *   一级分类也可能直接挂交易（「其他/杂项」这类没有二级的），
   *   那样 leaf 里也有它的 key；优先取 leaf 会把整棵子树漏掉。
   *   判断依据：root_id === leaf_id 说明这个 id 自己是根。
   */
  const parentIds = new Set()
  monthRows.forEach((r) => {
    if (r.root_id && r.root_id === r.leaf_id) parentIds.add(r.root_id)
  })

  const usedOfMonth = (mk, catId) => {
    if (!catId) return 0
    if (parentIds.has(catId)) {
      const root = catRootByMonth[mk]
      return (root && root[catId]) || 0
    }
    const leaf = catLeafByMonth[mk]
    if (leaf && leaf[catId] !== undefined) return leaf[catId]
    const root = catRootByMonth[mk]
    return (root && root[catId]) || 0
  }

  const catInfo = await loadBudgetCategories(budgets)

  // 最早有交易的日期（全部口径下算自然日进度用）
  let firstDay = ''
  if (kind === 'all') {
    const row = await queryOne(`SELECT MIN(t.occurred_day) AS d FROM txn t WHERE t.deleted_at IS NULL`)
    firstDay = row && row.d ? String(row.d) : ''
  }
  const cal = rangeCalendar(kind, e, firstDay)

  const totalRowBudget = budgets.find((b) => b.scope === 'total') || null
  // 月预算各月的可用额度（含结转），只算一次，所有预算共用
  const totalAvailability = totalRowBudget
    ? await totalBudgetMonthlyAvailability(totalRowBudget, months)
    : {}

  const out = []
  for (const b of budgets) {
    const startMonth = b.start_month || ''
    const isTotal = b.scope === 'total'

    // 生效月份 = 区间月份中，预算已经「开始」的那些月。
    // start_month 是「预算从哪个月开始生效」，
    // 所以 2025-06 建的预算在 2026 年整年视角下 12 个月全都生效。
    const effective = months.filter((m) => !startMonth || m >= startMonth)
    if (effective.length === 0) continue

    const monthly = Number(b.amount_cents) || 0
    const cats = catInfo[b.id] || []

    /*
     * 额度：
     *   月预算     -> 各生效月可用额度之和（结转逐月展开，见上方说明）
     *   子预算     -> 月额度 × 生效月数（子预算不参与结转）
     */
    let limit = 0
    if (isTotal) {
      for (const m of effective) limit += totalAvailability[m] !== undefined ? totalAvailability[m] : monthly
    } else {
      limit = monthly * effective.length
    }

    let used = 0
    if (isTotal) {
      for (const m of effective) used += totalByMonth[m] || 0
    } else {
      for (const m of effective) {
        for (const c of cats) used += usedOfMonth(m, c.id)
      }
    }

    const pct = limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0
    const remaining = limit - used

    // 剩余天数 = 生效月份里还没过的天数；都已过则用生效月份总数
    let remainDaysSum = 0
    for (const m of effective) remainDaysSum += monthProgress(m).remain
    const denom = remainDaysSum > 0 ? remainDaysSum : effective.length
    // 与 getBudgetUsage 一致：保留「分」的小数精度，供前端按 0.00 展示
    const dailyAvailable = remaining > 0
      ? Math.max(Math.round((remaining / denom) * 100) / 100, 0)
      : 0

    out.push({
      id: b.id,
      scope: b.scope,
      categoryId: b.category_id,
      categoryIds: cats.map((c) => c.id),
      categoryNames: cats.map((c) => c.name),
      name: budgetDisplayName(b, cats),
      icon: isTotal ? 'chart' : ((cats[0] && cats[0].icon) || 'more'),
      limit,
      baseLimit: monthly * effective.length,
      carryover: isTotal ? limit - monthly * effective.length : 0,
      monthly,
      rollover: isTotal && Number(b.rollover) === 1,
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
