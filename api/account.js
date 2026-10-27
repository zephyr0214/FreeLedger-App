/**
 * 账户服务
 *
 * ★ 余额一致性规则（本项目最关键的约束）★
 *   权威余额 = initial_balance + Σ收入 - Σ支出 + Σ转入 - Σ转出
 *   account.balance_cents 只是缓存，任何改动都在同一事务里 recalc。
 *   信用卡余额为负数（欠款），额度不计入资产。
 */

import { query, queryOne, execute, transaction } from './db/index.js'
import { prefixedId } from '../utils/id.js'
import { toDayKey } from '../utils/date.js'

/**
 * 账户类型
 *
 * ★ 分五类 ★
 *   网络支付：支付宝、微信等零钱账户
 *   信用卡  ：可以透支的信用账户（花呗算这里）
 *   储蓄卡  ：银行的储蓄账户
 *   现金    ：手里的现金
 *   充值卡  ：公交卡、饭卡等预付卡
 *
 * isCredit = 会欠款的账户（信用卡）。
 * 只有这类账户才显示「信用额度」设置项。
 *
 * group 是**展示分组**，账户页按它分类呈现；
 * category 是更细的类型（选类型时用）。
 */
export const ACCOUNT_TYPES = [
  // ---- 网络支付
  { key: 'alipay',  name: '支付宝',   icon: 'alipay',     isCredit: false, group: 'online',  category: '网络支付' },
  { key: 'wechat',  name: '微信',     icon: 'wechat',     isCredit: false, group: 'online',  category: '网络支付' },
  // ---- 信用卡
  { key: 'credit',  name: '信用卡',   icon: 'creditcard', isCredit: true,  group: 'credit',  category: '信用卡' },
  { key: 'huabei',  name: '花呗',     icon: 'huabei',     isCredit: true,  group: 'credit',  category: '信用卡' },
  // ---- 储蓄卡
  { key: 'debit',   name: '储蓄卡',   icon: 'card',       isCredit: false, group: 'debit',   category: '储蓄卡' },
  // ---- 现金
  { key: 'cash',    name: '现金',     icon: 'wallet',     isCredit: false, group: 'cash',    category: '现金' },
  // ---- 充值卡
  { key: 'prepaid', name: '充值卡',   icon: 'prepaid',    isCredit: false, group: 'prepaid', category: '充值卡' },
  // ---- 其它（投资 / 借贷 / 其它，单独归类，不混进上面五类）
  { key: 'invest',     name: '投资', icon: 'invest',   isCredit: false, group: 'other', category: '投资' },
  { key: 'loan',       name: '借入', icon: 'arrowdown', isCredit: true,  group: 'other', category: '借入' },
  { key: 'receivable', name: '应收', icon: 'arrowup',   isCredit: false, group: 'other', category: '应收' },
  { key: 'other',      name: '其他', icon: 'more',      isCredit: false, group: 'other', category: '其他' }
]

/**
 * 账户页的展示分组（按用户要求的五类 + 其它）
 */
export const ACCOUNT_GROUPS = [
  { key: 'online',  name: '网络支付' },
  { key: 'credit',  name: '信用卡' },
  { key: 'debit',   name: '储蓄卡' },
  { key: 'cash',    name: '现金' },
  { key: 'prepaid', name: '充值卡' },
  { key: 'other',   name: '其它' }
]

/** 账户类型选择页用的分类（按 category 归并，同一类的类型排在一起） */
export const ACCOUNT_CATEGORIES = [
  { key: '网络支付', types: ['alipay', 'wechat'] },
  { key: '信用卡',   types: ['credit', 'huabei'] },
  { key: '储蓄卡',   types: ['debit'] },
  { key: '现金',     types: ['cash'] },
  { key: '充值卡',   types: ['prepaid'] },
  { key: '其它',     types: ['invest', 'loan', 'receivable', 'other'] }
]

export function getTypeMeta(type) {
  return ACCOUNT_TYPES.find((t) => t.key === type) || ACCOUNT_TYPES[0]
}

export function isCreditType(type) {
  return getTypeMeta(type).isCredit
}

/* ------------------------------------------------------------------ 查询 */

export async function listAccounts(includeArchived = false) {
  const sql = includeArchived
    ? 'SELECT * FROM account WHERE deleted_at IS NULL ORDER BY sort ASC, created_at ASC'
    : 'SELECT * FROM account WHERE deleted_at IS NULL AND archived = 0 ORDER BY sort ASC, created_at ASC'
  const rows = await query(sql)
  return rows.map(normalizeAccount)
}

export async function getAccount(id) {
  const row = await queryOne('SELECT * FROM account WHERE id = ? AND deleted_at IS NULL', [id])
  return row ? normalizeAccount(row) : null
}

function normalizeAccount(row) {
  const meta = getTypeMeta(row.type)
  return {
    ...row,
    initial_balance_cents: Number(row.initial_balance_cents) || 0,
    balance_cents: Number(row.balance_cents) || 0,
    include_in_total: Number(row.include_in_total) === 1,
    credit_limit_cents: row.credit_limit_cents === null ? null : Number(row.credit_limit_cents),
    archived: Number(row.archived) === 1,
    typeName: meta.name,
    typeIcon: meta.icon,
    group: meta.group,
    /** 展示分类：网络支付 / 信用卡 / 储蓄卡 / 现金 / 充值卡 / 其它 */
    category: meta.category || '其它',
    isCredit: meta.isCredit
  }
}

/** 按分组返回账户，空组不返回 */
export async function listAccountsGrouped() {
  const accounts = await listAccounts()
  return ACCOUNT_GROUPS
    .map((g) => ({
      ...g,
      accounts: accounts.filter((a) => a.group === g.key)
    }))
    .filter((g) => g.accounts.length > 0)
}

/* ------------------------------------------------------------------ 统计 */

/** 总资产：只算 include_in_total=1 的账户，信用卡负余额自然抵扣 */
export async function getTotalAssets() {
  const row = await queryOne(
    'SELECT COALESCE(SUM(balance_cents), 0) AS total FROM account WHERE deleted_at IS NULL AND archived = 0 AND include_in_total = 1'
  )
  return Number(row ? row.total : 0)
}

/** 总负债（信用卡/借入的绝对值） */
export async function getTotalDebt() {
  const row = await queryOne(
    'SELECT COALESCE(SUM(ABS(balance_cents)), 0) AS total FROM account WHERE deleted_at IS NULL AND archived = 0 AND include_in_total = 1 AND balance_cents < 0'
  )
  return Number(row ? row.total : 0)
}

/* ------------------------------------------------------------------ 写入 */

export async function createAccount(input) {
  const now = Date.now()
  const id = input.id || prefixedId('acc')
  const meta = getTypeMeta(input.type)

  const initial = Number(input.initial_balance_cents) || 0
  const sort = input.sort !== undefined ? input.sort : await nextSort()

  await transaction(async () => {
    await execute(
      `INSERT INTO account (
        id, name, type, icon, color, initial_balance_cents, balance_cents,
        include_in_total, credit_limit_cents, bill_day, repay_day, card_tail,
        sort, archived, created_at, updated_at, deleted_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,NULL)`,
      [
        id,
        input.name || meta.name,
        input.type || 'cash',
        input.icon || null,
        input.color || null,
        initial,
        initial, // 新账户余额 = 期初
        input.include_in_total === false ? 0 : 1,
        input.credit_limit_cents === undefined || input.credit_limit_cents === null ? null : Number(input.credit_limit_cents),
        input.bill_day === undefined ? null : input.bill_day,
        input.repay_day === undefined ? null : input.repay_day,
        input.card_tail || null,
        sort,
        now,
        now
      ]
    )
    await writeTodaySnapshot(id)
  })

  return getAccount(id)
}

export async function updateAccount(id, patch) {
  const existing = await getAccount(id)
  if (!existing) throw new Error('账户不存在')

  const now = Date.now()
  const fields = []
  const params = []

  const assign = (col, val) => {
    fields.push(`${col} = ?`)
    params.push(val)
  }

  if (patch.name !== undefined) assign('name', patch.name)
  if (patch.type !== undefined) assign('type', patch.type)
  if (patch.icon !== undefined) assign('icon', patch.icon)
  if (patch.color !== undefined) assign('color', patch.color)
  if (patch.include_in_total !== undefined) assign('include_in_total', patch.include_in_total ? 1 : 0)
  if (patch.credit_limit_cents !== undefined) {
    assign('credit_limit_cents', patch.credit_limit_cents === null ? null : Number(patch.credit_limit_cents))
  }
  if (patch.bill_day !== undefined) assign('bill_day', patch.bill_day)
  if (patch.repay_day !== undefined) assign('repay_day', patch.repay_day)
  if (patch.card_tail !== undefined) assign('card_tail', patch.card_tail)
  if (patch.archived !== undefined) assign('archived', patch.archived ? 1 : 0)
  if (patch.sort !== undefined) assign('sort', patch.sort)

  // 期初余额变动 → 需要重算余额
  let needRecalc = false
  if (patch.initial_balance_cents !== undefined) {
    assign('initial_balance_cents', Number(patch.initial_balance_cents) || 0)
    needRecalc = true
  }

  assign('updated_at', now)
  params.push(id)

  await transaction(async () => {
    await execute(`UPDATE account SET ${fields.join(', ')} WHERE id = ?`, params)
    if (needRecalc) await recalcBalance(id)
    // 类型/名称变化不影响余额，但快照的展示值需要跟上
    await writeTodaySnapshot(id)
  })

  return getAccount(id)
}

/**
 * 重算指定账户余额。
 * 必须在事务内调用。
 * transfer 会同时影响两个账户：转出方减、转入方加。
 */
export async function recalcBalance(accountId) {
  const acc = await queryOne('SELECT * FROM account WHERE id = ?', [accountId])
  if (!acc) return 0

  const initial = Number(acc.initial_balance_cents) || 0

  // 支出、转出（减）
  const outRow = await queryOne(
    `SELECT COALESCE(SUM(amount_cents), 0) AS s FROM txn
     WHERE deleted_at IS NULL AND (account_id = ? AND type IN ('expense','transfer'))`,
    [accountId]
  )
  // 收入、转入（增）
  const inRow = await queryOne(
    `SELECT COALESCE(SUM(amount_cents), 0) AS s FROM txn
     WHERE deleted_at IS NULL AND ((account_id = ? AND type = 'income') OR (to_account_id = ? AND type = 'transfer'))`,
    [accountId, accountId]
  )

  const balance = initial - (Number(outRow ? outRow.s : 0)) + (Number(inRow ? inRow.s : 0))

  await execute('UPDATE account SET balance_cents = ?, updated_at = ? WHERE id = ?', [
    balance,
    Date.now(),
    accountId
  ])
  return balance
}

/** 重算所有账户（设置页的"修复数据"工具） */
export async function recalcAllBalances() {
  const accounts = await listAccounts(true)
  await transaction(async () => {
    for (const acc of accounts) {
      await recalcBalance(acc.id)
    }
  })
  return accounts.length
}

/** 软删除账户（有交易时拒绝，避免数据悬空） */
export async function deleteAccount(id) {
  const row = await queryOne(
    'SELECT COUNT(*) AS c FROM txn WHERE deleted_at IS NULL AND (account_id = ? OR to_account_id = ?)',
    [id, id]
  )
  if (Number(row ? row.c : 0) > 0) {
    throw new Error(`该账户下还有 ${row.c} 笔交易，不能删除。可先归档。`)
  }
  const now = Date.now()
  await transaction(async () => {
    await execute('UPDATE account SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id])
    await execute('DELETE FROM account_snapshot WHERE account_id = ?', [id])
  })
  return true
}

/* ------------------------------------------------------------------ 快照 */

/** 写今日快照（幂等，用 upsert 兼容旧 SQLite 内核） */
export async function writeTodaySnapshot(accountId) {
  const acc = await queryOne('SELECT balance_cents FROM account WHERE id = ?', [accountId])
  if (!acc) return
  const day = toDayKey()
  const existing = await queryOne(
    'SELECT id FROM account_snapshot WHERE account_id = ? AND day = ?',
    [accountId, day]
  )
  if (existing) {
    await execute('UPDATE account_snapshot SET balance_cents = ? WHERE id = ?', [
      Number(acc.balance_cents) || 0,
      existing.id
    ])
  } else {
    await execute(
      `INSERT INTO account_snapshot (id, account_id, day, balance_cents, created_at)
       VALUES (?,?,?,?,?)`,
      [prefixedId('snap'), accountId, day, Number(acc.balance_cents) || 0, Date.now()]
    )
  }
}

/** 为所有账户写今日快照（App 冷启动时调用） */
export async function writeAllTodaySnapshots() {
  const accounts = await queryOne('SELECT COUNT(*) AS c FROM account WHERE deleted_at IS NULL')
  if (!accounts || Number(accounts.c) === 0) return 0

  const list = await query('SELECT id, balance_cents FROM account WHERE deleted_at IS NULL')
  const day = toDayKey()
  const now = Date.now()

  await transaction(async () => {
    for (const acc of list) {
      const exist = await queryOne(
        'SELECT id FROM account_snapshot WHERE account_id = ? AND day = ?',
        [acc.id, day]
      )
      if (exist) {
        await execute('UPDATE account_snapshot SET balance_cents = ? WHERE id = ?', [
          Number(acc.balance_cents) || 0,
          exist.id
        ])
      } else {
        await execute(
          `INSERT INTO account_snapshot (id, account_id, day, balance_cents, created_at)
           VALUES (?,?,?,?,?)`,
          [prefixedId('snap'), acc.id, day, Number(acc.balance_cents) || 0, now]
        )
      }
    }
  })
  return list.length
}

/**
 * 总资产趋势：按天聚合所有账户快照
 *
 * @deprecated 旧接口：按天一个点，柱子图用。
 *   新的「资产变化点」趋势请用 getAssetChangePoints()。
 */
export async function getAssetTrend(months = 6) {
  const days = months * 31
  // 日期边界在 JS 里算好再传参，不依赖 SQLite 的 date('now') 时区行为
  const from = new Date()
  from.setDate(from.getDate() - days)
  const fromDay = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`

  const rows = await query(
    `SELECT day, SUM(balance_cents) AS total
     FROM account_snapshot
     WHERE day >= ?
     GROUP BY day
     ORDER BY day ASC`,
    [fromDay]
  )
  return rows.map((r) => ({ day: r.day, total: Number(r.total) || 0 }))
}

/**
 * 资产变化点趋势。
 *
 * ★ 与 getAssetTrend 的区别 ★
 *   getAssetTrend 是「每天一个点」（资产没变的天也占一个点）。
 *   这里要的是「**每次资产变化打一个点**」：
 *   只有当天的总资产和前一天不一样时，才记一个点。
 *
 * 口径与 getTotalAssets 对齐：
 *   只算 include_in_total=1 的账户、排除已归档的。
 *   account_snapshot 表里可能还留着已归档账户的历史快照，
 *   所以聚合时要按账户过滤，不能直接 SUM 全部。
 *
 * @param {number} months 回看多少个月
 * @returns {Promise<Array<{day:string, total:number, delta:number}>>}
 *   delta = 与上一个点相比的变化额（第一个点为 0）
 */
export async function getAssetChangePoints(months = 6) {
  const from = new Date()
  from.setDate(from.getDate() - months * 31)
  const fromDay = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`

  // 每天的总资产（只算计入总资产的账户）
  const rows = await query(
    `SELECT s.day AS day, SUM(s.balance_cents) AS total
     FROM account_snapshot s
     JOIN account a ON a.id = s.account_id
     WHERE s.day >= ?
       AND a.deleted_at IS NULL
       AND a.archived = 0
       AND a.include_in_total = 1
     GROUP BY s.day
     ORDER BY s.day ASC`,
    [fromDay]
  )

  if (rows.length === 0) return []

  const daily = rows.map((r) => ({
    day: r.day,
    total: Number(r.total) || 0
  }))

  // 只保留「与前一天不同」的点 = 资产发生变化时打点
  const points = []
  let prev = null
  for (const d of daily) {
    if (prev === null || d.total !== prev) {
      points.push({
        day: d.day,
        total: d.total,
        delta: prev === null ? 0 : d.total - prev
      })
      prev = d.total
    }
  }

  return points
}
/**
 * 把变化点补成连续的时间序列（缺失的天记为 0）。
 *
 * 用户要求：「没数据的时刻就记为 0 来画图」。
 * 没有这一步，折线会在两个点之间直接连一条直线，
 * 看起来像「这段时间资产没动过」，与事实不符。
 *
 * @param {Array<{day:string,total:number,delta:number}>} points
 * @param {number} days 补齐的天数
 * @returns {Array<{day:string,total:number,delta:number}>}
 */
export function fillChangePoints(points = [], days = 0) {
  if (points.length === 0) return []

  // 以最后一个点为终点往前推 days 天
  const last = points[points.length - 1]
  const endDate = parseDayKeyLocal(last.day)
  const startDate = new Date(endDate.getTime())
  startDate.setDate(startDate.getDate() - days + 1)

  // 建立 day -> point 的索引
  const map = {}
  for (const p of points) map[p.day] = p

  const out = []
  const cur = new Date(startDate.getTime())
  while (cur.getTime() <= endDate.getTime()) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    if (map[key]) {
      out.push(map[key])
    } else {
      out.push({ day: key, total: 0, delta: 0 })
    }
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

/** YYYY-MM-DD -> 本地 Date（不依赖 SQLite） */
function parseDayKeyLocal(dayKey) {
  const [y, m, d] = String(dayKey).split('-').map(Number)
  return new Date(y || 1970, (m || 1) - 1, d || 1)
}

async function nextSort() {
  const row = await queryOne('SELECT COALESCE(MAX(sort), -1) AS m FROM account WHERE deleted_at IS NULL')
  return (Number(row ? row.m : -1) + 1)
}
