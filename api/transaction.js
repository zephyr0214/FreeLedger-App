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
import {
  recalcBalance, writeTodaySnapshot, isComboType, listComboMembers, getAccount
} from './account.js'
import { resolveComboAccount } from '../utils/combo.js'
/*
 * ★ 只为「系统固定分类不能待报销」这一条校验而引 ★
 *   category.js 只依赖 db/index.js 与 db/schema.js，不反向依赖 transaction.js，
 *   所以这里不会形成循环引用（详见 isSystemPresetName 的注释）。
 */
import { isSystemPresetName } from './category.js'





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
    /**
     * 这笔是否不计入收支（v19）
     *
     * ★ 与 exclude_from_budget 的区别 ★
     *   exclude_from_budget 只让「预算用量」不算它；
     *   exclude_from_stats 让「收支统计 / 分类占比 / 趋势」也不算它。
     *   借入借出四类两个标记都是 1（既不占预算也不算收支），
     *   但账户余额照常按资金流动计算 —— 钱确实动了。
     */
    exclude_from_stats: Number(row.exclude_from_stats) === 1,
    /**
     * 报销状态（v21）：0 不报销 / 1 待报销 / 2 已报销
     *
     * ★ 为什么归一成数字而不是布尔 ★
     *   它不是「有/没有」两态，而是三态流程；
     *   页面要按值分「待报销」「已报销」两个 tab，
     *   用布尔的化就没法区分。
     */
    reimburse_status: Number(row.reimburse_status) || 0,
    /** 报销日期 YYYY-MM-DD（仅已报销） */
    reimburse_day: row.reimburse_day || '',
    /** 实报金额（分，仅已报销；null 表示还没报） */
    reimburse_amount_cents: row.reimburse_amount_cents === null || row.reimburse_amount_cents === undefined
      ? null
      : Number(row.reimburse_amount_cents),
    /** 报销到账账户（仅已报销） */
    reimburse_account_id: row.reimburse_account_id || '',
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
export function buildFilterWhere(opt = {}) {
  const {
    monthKey, startDay, endDay, type, accountId, categoryId, categoryIds,
    includeSubcategories, tagId, tagIds, keyword, minCents, maxCents, cycleId
  } = opt

  const where = ['t.deleted_at IS NULL']
  const params = []

  if (monthKey) { where.push('t.month_key = ?'); params.push(monthKey) }
  if (startDay) { where.push('t.occurred_day >= ?'); params.push(startDay) }
  if (endDay) { where.push('t.occurred_day <= ?'); params.push(endDay) }
  if (type && type !== 'all') { where.push('t.type = ?'); params.push(type) }
  if (cycleId) { where.push('t.cycle_id = ?'); params.push(cycleId) }
  if (accountId) {
    where.push('(t.account_id = ? OR t.to_account_id = ?)')
    params.push(accountId, accountId)
  }
  /*
   * ★ 多类别过滤（categoryIds）优先于单个 categoryId ★
   *   子预算可以挂多个类别，它的「全部 ›」需要一次筛出这几个类别下的流水。
   *   走 IN 列表而不是多个 OR 子查询：数量有限（一条子预算十几个类别顶天），
   *   SQL 长度可控，也比一堆 OR 更容易走索引。
   *
   * ★ ★ 必须同时接受字符串和数组（bug 修复）★ ★
   *   用户反馈「筛选面板分类筛选失效」。
   *
   *   原因就在这一行：旧写法是
   *     const multiCats = Array.isArray(categoryIds) ? categoryIds.filter(Boolean) : []
   *   而筛选面板传进来的是**逗号串**：
   *     pages/txn/list.vue: q.categoryIds = pickedCats.join(',')
   *   于是 Array.isArray('一个字符串') === false
   *   → multiCats 永远是空数组 → 分类条件被完全忽略。
   *   页面上看起来就是「勾了分类、列表一条没变」。
   *
   *   为什么不去改页面、而是改这里 ——
   *   这个函数是公开 API 的入口：
   *     · parseTxnQueryOptions（URL 深链）给的是**数组**
   *     · 页面直接查询时给的是**字符串**
   *   两个调用方都合法。只修页面的话，以后又有人按“字符串”写
   *   就会再次静默失效。在边界上统一规范才一劳永逸。
   */
  const multiCats = (Array.isArray(categoryIds)
    ? categoryIds
    : String(categoryIds || '').split(','))
    .map((x) => String(x || '').trim())
    .filter(Boolean)
  if (multiCats.length > 0) {
    where.push(`t.category_id IN (${multiCats.map(() => '?').join(',')})`)
    params.push(...multiCats)
  } else {
    const catCond = buildCategoryCondition(categoryId, includeSubcategories)
    if (catCond) {
      where.push(catCond.sql)
      params.push(...catCond.params)
    }
  }
  if (keyword) {
    /*
     * ★ 只搜备注，不再搜 raw_text ★
     *   「速记原文」字段已停用且不再写入（见 v10 迁移），
     *   搜它等于永远搜不到；更要紧的是**新装库没有 raw_text 这一列**，
     *   继续拼进 SQL 会让全新安装的关键词搜索直接报错。
     */
    where.push('t.note LIKE ?')
    params.push(`%${keyword}%`)
  }
  if (minCents !== undefined && minCents !== null) { where.push('t.amount_cents >= ?'); params.push(Number(minCents)) }
  if (maxCents !== undefined && maxCents !== null) { where.push('t.amount_cents <= ?'); params.push(Number(maxCents)) }

  /*
   * 标签过滤（需要子查询）
   *
   * ★ 多标签优先，单标签保留为兼容分支（用户本轮第 1 条）★
   *   用户要求：「筛选页面标签复用设置标签的面板，
   *   只有一个标签时，显示选中的标签名；
   *   有两个以上标签时，显示「已选中 x 个标签」」——
   *   说明筛选面板的标签要支持**多选**。
   *
   * ★ 为什么用 `IN` 而不是多个 EXISTS ★
   *   EXISTS 只能表达「有这个标签」；多个标签要表达的是
   *   「命中其中任一个标签」（OR 语义），
   *   拼成 `tt.tag_id IN (?,?)` 一条子查询就够，也比多条 OR 更容易走索引。
   *
   * ★ 同样要同时接受字符串和数组 ★
   *   和 categoryIds 一样，两个调用方给的形式不同：
   *     · 页面直接查询时拼成逗号串传进来
   *     · URL 深链解析出来的是数组（见 parseTxnQueryOptions）
   *   在边界上统一规范，不让某一种写法静默失效。
   */
  const multiTags = (Array.isArray(tagIds)
    ? tagIds
    : String(tagIds || '').split(','))
    .map((x) => String(x || '').trim())
    .filter(Boolean)
  if (multiTags.length > 0) {
    where.push(
      `EXISTS (SELECT 1 FROM txn_tag tt WHERE tt.txn_id = t.id AND tt.tag_id IN (${multiTags.map(() => '?').join(',')}))`
    )
    params.push(...multiTags)
  } else if (tagId) {
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
 *   categoryIds          按多个分类筛选（逗号分隔，子预算的「全部」用）
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
  const cycleId = str(opt.cycleId)

  /*
   * 多标签：tagIds=a,b,c
   *
   * ★ 为什么要它 ★
   *   筛选面板支持多选标签之后，标签条件可能是**一组**。
   *   深链（「某标签的全部流水」）也要能把这组带过来。
   *   和 categoryIds 一样：非法/空值一律当没传。
   */
  const tagIds = str(opt.tagIds)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 100)

  const monthKeyRaw = str(opt.monthKey)
  // 月份必须是真实的月份（01-12），'2026-13' 这种要被挡掉
  const monthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthKeyRaw) ? monthKeyRaw : ''

  const dayRaw = str(opt.day)
  // 日期要存在且格式正确
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayRaw) && isRealDay(dayRaw) ? dayRaw : ''

  const includeSubcategories = parseBoolFlag(opt.includeSubcategories)

  /*
   * 多类别：categoryIds=a,b,c
   *
   * ★ 为什么需要它 ★
   *   v18 起一条子预算可以挂多个类别，预算详情页的「全部 ›」
   *   要把这些类别的流水一起筛出来，单个 categoryId 装不下。
   *   非法/空值一律当没传，不把脏数据带进查询。
   */
  const categoryIds = str(opt.categoryIds)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 100)

  return {
    type,
    accountId,
    categoryId,
    categoryIds,
    tagId,
    tagIds,
    cycleId,
    monthKey,
    day,
    includeSubcategories,
    /**
     * 是否带了「筛选类」参数。
     * 带了就说明是从详情页跳进来的（要的是「该筛选条件下的全部流水」），
     * 页面据此把时间范围放宽到全部时间，
     * 否则用户会只看到当月那几笔。
     */
    hasFilter: Boolean(
      accountId || categoryId || categoryIds.length > 0 || tagId || tagIds.length > 0 || cycleId || type !== 'all'
    )
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

  /*
   * ★ 汇总不带「不计入收支」的那几笔（v19）★
   *   借出 / 借入 / 借款归还 / 借款收回是资金往来，不是消费也不是收入。
   *   列表本身仍然把这几笔**列出来**（用户要看到它们），
   *   但顶部的「支出 X / 收入 Y」小计必须把它们排除 ——
   *   否则借出去 500 块，列表顶上就显示「支出 500」，用户以为花掉了。
   *
   * ★ 为什么 WHERE 而不是只在 SUM 里排除 ★
   *   count 也要一起排除：不然会出现「3 笔 · 支出 0.00」这种读不通的组合。
   */
  const statsWhere = where.concat(['COALESCE(t.exclude_from_stats, 0) = 0'])

  const row = await queryOne(
    `SELECT COUNT(*) AS cnt,
            COALESCE(SUM(CASE WHEN t.type='expense'  THEN t.amount_cents ELSE 0 END),0) AS expense,
            COALESCE(SUM(CASE WHEN t.type='income'   THEN t.amount_cents ELSE 0 END),0) AS income,
            COALESCE(SUM(CASE WHEN t.type='transfer' THEN t.amount_cents ELSE 0 END),0) AS transfer
     FROM txn t WHERE ${statsWhere.join(' AND ')}`,
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

/**
 * 取某一天的全部流水（不限条数）
 *
 * ★ 与 listTodayTransactions 的区别 ★
 *   那个有 limit 上限（默认 20），只适合「今日概览」这类场景。
 *   首页「最近收支」的新规则是「当日 >= 5 条时显示**全部**当日记录」——
 *   这时 20 条的上限会让记了 25 笔的那天少显示 5 笔，
 *   所以需要一个不设上限的查询。
 *
 * ★ 为什么给一个很大的上限而不是完全去掉 LIMIT ★
 *   listTransactions 的 SQL 里 LIMIT 是必填参数。
 *   一天记几百笔是小概率事件，给 500 作为实际上限即可，
 *   既避免无界查询，也远超任何人一天的记账量。
 *
 * @param {string} [day] YYYY-MM-DD，默认今天
 * @returns {Promise<Array>}
 */
export async function listAllTransactionsOfDay(day = toDayKey()) {
  return listTransactions({ startDay: day, endDay: day, limit: 500 })
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
       AND COALESCE(exclude_from_stats, 0) = 0
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

/**
 * 按天聚合全部流水的收支合计（不限月份）
 *
 * ★ 为什么要有这个（首页「最近收支」的 bug）★
 *   首页按日期分组显示最近几笔，每组右边写着「支出 X / 收入 Y」。
 *   以前这两个数是**把这几条显示出来的记录**累加出来的 ——
 *   而列表只显示最近 5 条，于是：
 *     某天记了 10 笔，列表里只露出 2 笔，
 *     那一组右边就只显示这 2 笔的合计，
 *     和当天真实的收支对不上（看着像少记了钱）。
 *
 *   月历用的 getDailyTotals(monthKey) 只统计当月，
 *   而「最近收支」可能跨月（最近 5 条里带着上个月的），
 *   所以这里不按月过滤，直接按天聚合全部流水。
 *
 * ★ 返回结构 ★
 *   { 'YYYY-MM-DD': { expense, income, count } }
 *   转账不计入收支合计（transfer 既不是支出也不是收入），
 *   但计入 count —— count 表示「这天记了几笔」。
 *
 * @returns {Promise<Object<string, {expense:number, income:number, count:number}>>}
 */
export async function getAllDailyTotals() {
  const rows = await query(
    `SELECT occurred_day,
            COALESCE(SUM(CASE WHEN type='expense' THEN amount_cents ELSE 0 END),0) AS exp,
            COALESCE(SUM(CASE WHEN type='income'  THEN amount_cents ELSE 0 END),0) AS inc,
            COUNT(*) AS cnt
     FROM txn
     WHERE deleted_at IS NULL AND COALESCE(exclude_from_stats, 0) = 0
     GROUP BY occurred_day
     ORDER BY occurred_day ASC`
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
 * 把「组合账户」解析成真正要扣款的真实账户。
 *
 * ★ 为什么在写库前解析，而不是在界面上先选好 ★
 *   组合的成员顺序、余额会变（用户随时可能调序、其它地方也在花钱）。
 *   界面选组合、用户确认「记一笔」这中间隔了多久不确定，
 *   到真正落库的那一刻才知道哪个账户够用，才是最准的时机。
 *   所以解析统一放在 api 层 —— 手动记账、AI 记账、周期补记
 *   都走这一条路径，行为完全一致。
 *
 * @param {string} accountId 用户选中的账户（可能是组合）
 * @param {number} amountCents 本笔金额（分）
 * @param {string} type 交易类型（收入不允许用组合）
 * @returns {Promise<{ accountId: string, viaComboId: string, warning: string }>}
 *   accountId   最终落库的账户 id
 *   viaComboId  若经过组合解析，这里是组合的 id，否则空串
 *   warning     需要给用户的提示（没有则空串）
 */
async function resolveAccountForWrite(accountId, amountCents, type) {
  const acc = await getAccount(accountId)
  if (!acc) return { accountId, viaComboId: '', warning: '' }
  if (!acc.isCombo) return { accountId, viaComboId: '', warning: '' }

  // 组合账户只用于支出：收入、转账都不能用（钱不能"进"虚拟账户，
  // 转账两端必须落到真实账户）。
  if (type === 'income') {
    throw new Error('组合账户不能用于收入，请选择真实账户')
  }
  if (type === 'transfer') {
    throw new Error('组合账户不能用于转账，请选择真实账户')
  }

  const members = await listComboMembers(accountId)
  const pick = resolveComboAccount(members, amountCents)

  if (!pick.accountId) {
    throw new Error('这个组合账户还没有添加成员，请先编辑它')
  }

  let warning = ''
  if (!pick.enough) {
    // 按约定这种情况不该发生，但真发生了也不能让整笔交易写不进去
    warning = '组合内没有账户余额足够，已从余额最多的账户扣款'
    console.warn('[txn] 组合账户余额不足，走兜底:', accountId, pick.accountId)
  }

  return { accountId: pick.accountId, viaComboId: accountId, warning }
}

/**
 * 校验转账的「转入方」不能是组合账户。
 *
 * ★ 为什么 ★
 *   组合是虚拟账户，钱只能「从它出」（转出=扣款），不能「进它」。
 *   收入已经在 resolveAccountForWrite 里拦了；转入方这里是另一半。
 *   用户选了组合作为转入目标，直接报错，别等落库了才发现。
 *
 * @param {string|null} toAccountId 转账目标账户 id
 */
async function assertTransferTargetNotCombo(toAccountId) {
  if (!toAccountId) return
  const to = await getAccount(toAccountId)
  if (to && to.isCombo) {
    throw new Error('组合账户只能作为转出方，不能作为转入方')
  }
}

/**
 * 新增交易
 * @param {object} input
 *   type, amount_cents, account_id, to_account_id, category_id, note,
 *   occurred_at (ms) | occurred_day, tag_ids[], cycle_id
 *
 * ★ 已移除 source / raw_text ★
 *   这两个字段不再入库（详见 api/db/index.js 的 v10 迁移）。
 */
export async function createTransaction(input) {
  validate(input)
  await assertReimburseAllowed(input)

  /*
   * ★ 「已报销」不能由普通记账路径写入（本轮用户第 5 条）★
   *   待报销可以随手补记（AI 记账、手动记账都行），
   *   但「待报销 → 已报销」这一步要算实报金额、挑到账账户、
   *   记坏账/盈余，只有 api/reimburse.js 的 reimburseTxns 能做
   *   （它走的是自己的 SQL，不经过本函数，所以这里拦不会误伤）。
   *
   *   放这一层而不是只靠界面：AI、导入、周期补记都从这儿进，
   *   界面藏一次不保证别处不写。
   */
  if (Number(input.reimburse_status) === 2) {
    throw new Error('「已报销」请到「报销管理」页确认，记账不能直接改成已报销')
  }

  const id = input.id || prefixedId('txn')
  const now = Date.now()
  // ★ 时间：优先用用户给的时刻 ★
  //   occurred_at  > 精确到时分（手动/AI 记账都走这条）
  //   occurred_day > 只有日期时，取当天的**当前时刻**（不是固定 12:00）
  //   都没有       > 用此刻
  const keys = makeDateKeys(resolveOccurredTime(input, now))

  const amount = Math.abs(Math.round(Number(input.amount_cents) || 0))

  /*
   * ★ 组合账户 → 真实账户 ★
   *   在写库之前解析，钱实际记在真实账户名下，
   *   组合只留下一个 via_combo_id 标记（纯记录，不参与任何计算）。
   */
  const resolved = await resolveAccountForWrite(input.account_id, amount, input.type)
  const finalAccountId = resolved.accountId

  // ★ 转账的转入方不允许是组合账户 ★
  if (input.type === 'transfer') {
    await assertTransferTargetNotCombo(input.to_account_id)
  }

  await transaction(async () => {
    /*
     * ★ 外币快照（v17）★
     *   original_currency / original_amount_cents / exchange_rate
     *   只在有原币信息时写入；人民币交易三列全 NULL（与迁移默认一致）。
     *   amount_cents 仍是折算后的 CNY 分 —— 统计层零改动。
     */
    await execute(
      `INSERT INTO txn (
        id, type, amount_cents, account_id, to_account_id, category_id, note,
        occurred_at, occurred_day, month_key, year_key, tz_offset,
        created_at, updated_at, deleted_at, cycle_id, via_combo_id,
        original_currency, original_amount_cents, exchange_rate,
        exclude_from_budget, exclude_from_stats, reimburse_status
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.type,
        amount,
        finalAccountId,
        input.type === 'transfer' ? input.to_account_id : null,
        input.type === 'transfer' ? null : (input.category_id || null),
        input.note || '',
        keys.occurred_at,
        keys.occurred_day,
        keys.month_key,
        keys.year_key,
        keys.tz_offset,
        now,
        now,
        input.cycle_id || null,
        resolved.viaComboId || null,
        input.original_currency || null,
        input.original_amount_cents || null,
        input.exchange_rate || null,
        input.exclude_from_budget ? 1 : 0,
        input.exclude_from_stats ? 1 : 0,
        Number(input.reimburse_status) || 0
      ]
    )

    if (Array.isArray(input.tag_ids) && input.tag_ids.length > 0) {
      await syncTags(id, input.tag_ids)
    }

    // 重算受影响账户（转账要两端）
    // ★ 用 finalAccountId（组合解析后的真实账户），不是原始的组合 id ★
    await recalcBalance(finalAccountId)
    if (input.type === 'transfer' && input.to_account_id) {
      await recalcBalance(input.to_account_id)
      await writeTodaySnapshot(input.to_account_id)
    }
    await writeTodaySnapshot(finalAccountId)
  })

  // 组合余额不足时的提示交给调用方展示（不阻断记账）
  if (resolved.warning) {
    console.warn('[txn]', resolved.warning)
  }

  return { id, ...keys, viaComboId: resolved.viaComboId || null }
}

/**
 * 更新交易 —— 注意账户可能被改，需要同时重算旧账户与新账户
 */
export async function updateTransaction(id, patch) {
  const existing = await getTransaction(id)
  if (!existing) throw new Error('交易不存在')

  /*
   * ★ 已报销不能由编辑保存「造出来」（本轮用户第 5 条）★
   *   编辑一笔已报销的账时原样带回 status=2 是允许的（值没变）；
   *   但把一笔没报销的账直接改成 2 不行 —— 那会绕过报销台账。
   */
  if (Number(patch.reimburse_status) === 2 && Number(existing.reimburse_status) !== 2) {
    throw new Error('「已报销」请到「报销管理」页确认，记账不能直接改成已报销')
  }

  const merged = { ...existing, ...patch }
  validate(merged)
  await assertReimburseAllowed(merged)

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

  /*
   * ★ 组合账户 → 真实账户（编辑时同样解析）★
   *   用户可能把一笔账改成走某个组合，
   *   或者改了金额后需要重新挑一个够用的账户。
   */
  const resolved = await resolveAccountForWrite(merged.account_id, amount, merged.type)
  const finalAccountId = resolved.accountId

  // ★ 转账的转入方不允许是组合账户 ★
  if (merged.type === 'transfer') {
    await assertTransferTargetNotCombo(merged.to_account_id)
  }

  // 需要重算的账户合集（旧的两个 + 新的两个）
  const affected = new Set([existing.account_id, patch.account_id, existing.to_account_id, patch.to_account_id])
  affected.delete(null)
  affected.delete(undefined)
  // 组合解析出来的真实账户也要重算
  affected.add(finalAccountId)

  await transaction(async () => {
    // 外币快照随编辑一起更新（patch 带了才写；没带沿用旧值——merged 已合并）
    await execute(
      `UPDATE txn SET
        type = ?, amount_cents = ?, account_id = ?, to_account_id = ?, category_id = ?, note = ?,
        occurred_at = ?, occurred_day = ?, month_key = ?, year_key = ?,
        updated_at = ?, via_combo_id = ?,
        original_currency = ?, original_amount_cents = ?, exchange_rate = ?,
        exclude_from_budget = ?, exclude_from_stats = ?, reimburse_status = ?
       WHERE id = ?`,
      [
        merged.type,
        amount,
        finalAccountId,
        merged.type === 'transfer' ? merged.to_account_id : null,
        merged.type === 'transfer' ? null : (merged.category_id || null),
        merged.note || '',
        keys.occurred_at,
        keys.occurred_day,
        keys.month_key,
        keys.year_key,
        now,
        resolved.viaComboId || null,
        merged.original_currency || null,
        merged.original_amount_cents || null,
        merged.exchange_rate || null,
        merged.exclude_from_budget ? 1 : 0,
        merged.exclude_from_stats ? 1 : 0,
        /*
         * ★ 报销状态也要能编辑（本轮用户第 3、5 条）★
         *   旧版这条 UPDATE 里根本没有 reimburse_status，
         *   于是「编辑一笔普通支出 → 勾上待报销 → 保存」什么都没发生，
         *   详情页再看还是没勾。待报销允许由手动记账设置（第 3 条）；
         *   已报销在上面被拦住了（只有报销管理页能推进到 2）。
         */
        Number(merged.reimburse_status) || 0,
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

/**
 * 设置/取消「这笔不计入收支」（v19）
 *
 * ★ 与 setExcludeFromBudget 分开 ★
 *   「不计入预算」和「不计入收支」是两件独立的事：
 *   一笔借款两个都要排除，但一笔代购可能只排除预算、仍要算收支。
 *
 * ★ 只改标记，不动余额 ★
 *   钱确实进出过账户，余额必须照实反映。
 *
 * @param {string} id 交易 id
 * @param {boolean} exclude true = 不计入收支
 * @returns {Promise<object>} 更新后的交易
 */
export async function setExcludeFromStats(id, exclude) {
  const existing = await getTransaction(id)
  if (!existing) throw new Error('交易不存在')

  await execute(
    'UPDATE txn SET exclude_from_stats = ?, updated_at = ? WHERE id = ?',
    [exclude ? 1 : 0, Date.now(), id]
  )
  return getTransaction(id)
}

/**
 * 设置报销状态（v21）
 *
 * ★ 只改状态列，不动两个 exclude 标记 ★
 *   「待报销」那两个标记由 api/reimburse.js 的 setTxnPendingReimburse
 *   一起改（它还要校验类型和分类）；这里只给「取消报销」这类场景用。
 *
 * @param {string} id
 * @param {number} status 0 / 1 / 2
 */
export async function setReimburseStatus(id, status) {
  const existing = await getTransaction(id)
  if (!existing) throw new Error('交易不存在')

  await execute(
    'UPDATE txn SET reimburse_status = ?, updated_at = ? WHERE id = ?',
    [Number(status) || 0, Date.now(), id]
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

  /*
   * ★ 删的是周期产生的流水 → 记住「这天不要再补」★
   *   周期自动补记只看「这天有没有未删除的流水」，
   *   删掉之后下次进 App 会被当成没记过、又补一笔回来。
   *   所以这里把 (cycle_id, occurred_day) 写进 cycle_skip，
   *   补记时直接跳过这一天（见 api/cycle.js 的 catchUpCycles）。
   *
   *   放在事务外：写失败也不该让「删除」本身失败。
   */
  if (existing.cycle_id && existing.occurred_day) {
    try {
      await execute(
        'INSERT OR IGNORE INTO cycle_skip (cycle_id, day, created_at) VALUES (?,?,?)',
        [existing.cycle_id, existing.occurred_day, Date.now()]
      )
    } catch (e) {
      console.warn('[txn] 记录周期跳过日失败:', e && e.message)
    }
  }

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

/* ------------------------------------------------------------------ 批量操作 */

/**
 * 批量删除流水（软删除，逐条走 deleteTransaction）
 *
 * ★ 为什么逐条调 deleteTransaction 而不是一条 UPDATE 带 IN ★
 *   删一笔流水要做的事情不只是改 deleted_at：
 *     · 重算涉及的账户余额（转账要算两个账户）
 *     · 写今日快照
 *     · 周期流水还要写 cycle_skip（否则下次进 App 又补回来）
 *   这些逻辑全在 deleteTransaction 里。在这里另写一份 SQL 等于
 *   把它们全部复制一遍，改一处漏一处。
 *
 * ★ 为什么不包一个大事务 ★
 *   deleteTransaction 自己已经开了事务（db 层不支持嵌套事务，
 *   嵌套会死锁）。且批量删除是「能删多少算多少」的语义，
 *   中间一条失败不应该把前面已经删掉的回滚 ——
 *   用户看到的是「删了一半」但实际全没删，反而更迷惑。
 *
 * @param {string[]} ids
 * @returns {Promise<{deleted:number, failed:number}>}
 */
export async function batchDeleteTransactions(ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : []
  let deleted = 0
  let failed = 0
  for (const id of list) {
    try {
      if (await deleteTransaction(id)) deleted++
      else failed++
    } catch (e) {
      console.warn('[txn] 批量删除失败:', id, e && e.message)
      failed++
    }
  }
  return { deleted, failed }
}

/**
 * 批量设置「不计预算 / 不计收支」
 *
 * ★ 为什么不用 setExcludeFromBudget / setExcludeFromStats 循环 ★
 *   那两个函数每次调用都要 getTransaction 查一遍完整行
 *   再写一遍（还要再查一次返回）。批量 50 条就是 150 次 SQL。
 *   这里只改一个标记位，不需要完整行，也不动余额，
 *   所以一条 IN UPDATE 就够。
 *
 * ★ 与单条接口的语义差异 ★
 *   单条接口是「设成某个值」（set true/false），
 *   这里也是「设成某个值」，不是「取反」 ——
 *   取反在混选时没有意义（一半开一半关会变成一团乱码）。
 *
 * @param {string[]} ids
 * @param {{budget?:boolean, stats?:boolean}} flags 只写传入的字段
 * @returns {Promise<number>} 影响行数
 */
export async function batchSetExcludeFlags(ids, flags = {}) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : []
  if (list.length === 0) return 0

  const fields = []
  const params = []
  if (flags.budget !== undefined) {
    fields.push('exclude_from_budget = ?')
    params.push(flags.budget ? 1 : 0)
  }
  if (flags.stats !== undefined) {
    fields.push('exclude_from_stats = ?')
    params.push(flags.stats ? 1 : 0)
  }
  if (fields.length === 0) return 0

  fields.push('updated_at = ?')
  params.push(Date.now())
  params.push(...list)

  await execute(
    `UPDATE txn SET ${fields.join(', ')} WHERE id IN (${list.map(() => '?').join(',')})`,
    params
  )
  return list.length
}

/**
 * 批量追加 / 移除标签
 *
 * ★ mode 的语义 ★
 *   'add'    —— 保留原有标签，只加不删（用户选了一组标签并希望追加）
 *   'remove' —— 只移除用户选的那几个，其余不动
 *   'set'    —— 覆盖成这一组（和 TxnPanel 单条编辑同一语义）
 *
 *   ★ 为什么默认用「追加」而不是「覆盖」 ★
 *     批量选中的流水各自已有不同标签。
 *     覆盖会把它们全部抹成一样——那是一个非常危险的默认行为，
 *     用户想的一般是「把这批都打上「出差」标签」。
 *
 * @param {string[]} ids
 * @param {string[]} tagIds
 * @param {'add'|'remove'|'set'} mode
 * @returns {Promise<number>} 影响笔数
 */
export async function batchSetTxnTags(ids, tagIds, mode = 'add') {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : []
  const tags = Array.isArray(tagIds) ? tagIds.filter(Boolean) : []
  if (list.length === 0) return 0

  const now = Date.now()
  for (const id of list) {
    try {
      if (mode === 'set') {
        await execute('DELETE FROM txn_tag WHERE txn_id = ?', [id])
        for (const tagId of tags) {
          await execute('INSERT OR IGNORE INTO txn_tag (txn_id, tag_id) VALUES (?, ?)', [id, tagId])
        }
      } else if (mode === 'remove') {
        for (const tagId of tags) {
          await execute('DELETE FROM txn_tag WHERE txn_id = ? AND tag_id = ?', [id, tagId])
        }
      } else {
        for (const tagId of tags) {
          await execute('INSERT OR IGNORE INTO txn_tag (txn_id, tag_id) VALUES (?, ?)', [id, tagId])
        }
      }
      await execute('UPDATE txn SET updated_at = ? WHERE id = ?', [now, id])
    } catch (e) {
      console.warn('[txn] 批量标签失败:', id, e && e.message)
    }
  }
  return list.length
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

/**
 * 校验「待报销」不能挂在系统固定分类上（用户本轮第 5 条）
 *
 * ★ 为什么这条要在 API 层再挡一次 ★
 *   前端四个入口（记账面板、周期面板、交易详情、AI 速记）都已经置灰了，
 *   但这四处的判断都依赖「当前选中的分类对象」，而分类是可能被改的：
 *   建账时选了普通分类、勾了待报销，之后有人把那个分类改名成「借出」——
 *   库里那笔账就变成了「系统分类 + 待报销」的矛盾状态。
 *   还有导入老备份、以及以后新增的调用点，都可能绕过前端判断。
 *   放在 create/update 的唯一写入口上兜底，是最后一道防线。
 *
 * ★ 为什么抛错而不是静默降级成 0 ★
 *   静默降级会产生「用户勾了、界面没报错、但没生效」的诡异行为
 *   （这正是上一轮 AI 记账里踩过的坑）。抛错至少能让人知道为什么。
 *
 * ★ 不会误伤报销派生流水 ★
 *   「报销到账 / 报销坏账 / 报销盈余」是 api/reimburse.js 用原始 SQL 写的，
 *   不走 createTransaction / updateTransaction，所以不受这里影响。
 *
 * @param {{category_id:string|null, reimburse_status:number|undefined}} t
 * @returns {Promise<void>}
 */
async function assertReimburseAllowed(t) {
  if (!t || Number(t.reimburse_status) !== 1) return
  if (!t.category_id) return
  const cat = await queryOne(
    'SELECT name, type FROM category WHERE id = ? AND deleted_at IS NULL',
    [t.category_id]
  )
  if (!cat) return
  if (isSystemPresetName(cat.name, cat.type)) {
    throw new Error(`「${cat.name}」是系统分类，不能标记为待报销`)
  }
}

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
