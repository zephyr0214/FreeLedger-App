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
import { toDayKey, makeDateKeys } from '../utils/date.js'
import { ensureReconcileCategory } from './category.js'
import { getSetting, setSetting } from './settings.js'

/**
 * 账户类型
 *
 * ★ 就这五种，不再有别的 ★
 *   网络支付：支付宝、微信等零钱账户
 *   信用卡  ：可以透支的信用账户（花呗算这里）
 *   储蓄卡  ：银行的储蓄账户
 *   现金    ：手里的现金
 *   充值卡  ：公交卡、饭卡等预付卡
 *
 * 之前还有「投资 / 借入 / 应收 / 其他」，
 * 用户没提这些，直接删掉了 ——
 * 账户类型就是用户挑的这几种，不多不少。
 *
 * isCredit = 会欠款的账户（信用卡）。
 * 只有这类账户才显示「信用额度」设置项。
 */
export const ACCOUNT_TYPES = [
  { key: 'online',  name: '网络支付', icon: 'wechat',     isCredit: false, group: 'online' },
  { key: 'credit',  name: '信用卡',   icon: 'creditcard', isCredit: true,  group: 'credit' },
  { key: 'debit',   name: '储蓄卡',   icon: 'card',       isCredit: false, group: 'debit' },
  { key: 'cash',    name: '现金',     icon: 'wallet',     isCredit: false, group: 'cash' },
  { key: 'prepaid', name: '充值卡',   icon: 'prepaid',    isCredit: false, group: 'prepaid' },
  /*
   * ★ 组合账户（combo）★
   *   不是一个真实的资金账户：没有余额、不计入总资产、不产生流水。
   *   它只是一组「按顺序扣款」的真实账户，
   *   记账时被解析成其中某一个真实账户（见 utils/combo.js）。
   *   放在 ACCOUNT_TYPES 里是为了复用现成的账户表结构，
   *   但 groups 里单独成组，不混进真实账户的分组。
   */
  { key: 'combo',   name: '组合账户', icon: 'layers',     isCredit: false, group: 'combo', isCombo: true }
]

/**
 * 账户页的展示分组
 *
 * ★ 组合账户单独成组、排在最后 ★
 *   它不是真实资金账户，和「网络支付 / 信用卡」并列会误导；
 *   放最后也符合「它是记账时用的辅助工具」这个定位。
 */
export const ACCOUNT_GROUPS = [
  { key: 'online',  name: '网络支付' },
  { key: 'credit',  name: '信用卡' },
  { key: 'debit',   name: '储蓄卡' },
  { key: 'cash',    name: '现金' },
  { key: 'prepaid', name: '充值卡' },
  { key: 'combo',   name: '组合账户' }
]

/** 真实账户分组（不含组合）—— 组合成员的候选项只能用这些 */
export const REAL_ACCOUNT_GROUPS = ACCOUNT_GROUPS.filter((g) => g.key !== 'combo')

export function getTypeMeta(type) {
  return ACCOUNT_TYPES.find((t) => t.key === type) || ACCOUNT_TYPES[0]
}

export function isCreditType(type) {
  return getTypeMeta(type).isCredit
}

/** 是否是组合账户 */
export function isComboType(type) {
  return type === 'combo'
}

/* ------------------------------------------------------------------ 查询 */

export async function listAccounts(includeArchived = false) {
  /*
   * ★ 排序：不计入资产的账户排在同分类最后 ★
   *   include_in_total = 0 的账户不参与总资产（如「报销待还」「代管钱包」），
   *   放在前面会和真正的资产并排，读起来像是在算总账。
   *   所以在 SQL 里先按 include_in_total DESC 排 —— 参与总资产的（1）在前，
   *   不参与的（0）在后；同组内再按用户自定义的 sort、创建时间排。
   *   ORDER BY 的第一顺位保证了「同分类内」的语义（分组本身按 type 来）。
   */
  const base = 'SELECT * FROM account WHERE deleted_at IS NULL'
  const withArchived = includeArchived ? '' : ' AND archived = 0'
  const order = ' ORDER BY include_in_total DESC, sort ASC, created_at ASC'
  const rows = await query(`${base}${withArchived}${order}`)
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
    isCredit: meta.isCredit,
    /** 是否是组合账户（无余额、不计入总资产、记账时解析成真实账户） */
    isCombo: isComboType(row.type)
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

/**
 * 所有余额之和（含负余额抵扣）—— 等价于「净资产」
 *
 * @deprecated 用 getAssetOverview() 代替。
 *   这个函数的返回值 = 正余额 - 负债 = 净资产，
 *   名字叫「总资产」但其实是净资产，容易在页面上算错
 *   （账户页现在要把「总资产」和「净资产」分开展示）。
 *   资产趋势（getAssetChangePoints）仍然用它这套口径 —— 趋势看的是净资产走势，
 *   两边必须一致，所以那个函数里直接用 SQL 聚合、不调这个。
 */
export async function getTotalAssets() {
  const row = await queryOne(
    'SELECT COALESCE(SUM(balance_cents), 0) AS total FROM account WHERE deleted_at IS NULL AND archived = 0 AND include_in_total = 1'
  )
  return Number(row ? row.total : 0)
}

/**
 * 账户资产概览 —— 资产 / 负债 / 净资产
 *
 * ★ 为什么一次查出来 ★
 *   账户页要同时显示「总资产」「负债」「净资产」，
 *   分三次查询会有时间差（用户在两个查询之间刚好记了一笔），
 *   三块数字就对不上了。所以这里把账户余额和借入余额一起算。
 *
 * ★ 口径 ★
 *   只算 include_in_total = 1 且未归档、未删除的账户。
 *     总资产 = 账户正余额之和
 *     负  债 = 账户负余额绝对值之和（信用卡欠款等）
 *            + **尚未归还的借入**（借入 - 借款归还）
 *     净资产 = 总资产 - 负债
 *
 * ★ 为什么要单独加「未归还的借入」★
 *   借入的钱记在「借入」（收入分类）下，钱进的是真实账户，
 *   所以它已经计入了总资产；但它同时是**一笔要还的债**。
 *   如果负债里不包含它，用户借了 1 万，净资产会凭空多出 1 万 ——
 *   这正是用户反馈的「借入没有添加在负债中，所以净资产显示有误」。
 *
 *   算的是「净额」而不是「累计借入」：
 *     借了 1 万、已还 3 千 -> 负债 +7 千（不是 +1 万）。
 *     还清之后负债回落到 0，净资产恢复 —— 这才对。
 *
 * ★ 为什么按余额正负拆账户，而不是按账户类型拆 ★
 *   「信用卡」类型也可能有正余额（刚还多了），
 *   而储蓄卡也可能因为记错而变成负的。
 *   按余额正负拆才能保证「净资产 == 总资产 - 负债」这条恒等式永远成立 ——
 *   否则用户会看到「负债 0、净资产却是负数」这种自相矛盾的页面。
 *
 * @returns {Promise<{assets:number, debt:number, net:number, loanDebt:number}>}
 *   loanDebt 是负债里属于「未归还借入」的那部分（页面可用于说明构成）
 */
export async function getAssetOverview() {
  const accRow = await queryOne(
    `SELECT
       COALESCE(SUM(CASE WHEN balance_cents > 0 THEN balance_cents ELSE 0 END), 0) AS assets,
       COALESCE(SUM(CASE WHEN balance_cents < 0 THEN -balance_cents ELSE 0 END), 0) AS debt
     FROM account
     WHERE deleted_at IS NULL AND archived = 0 AND include_in_total = 1`
  )
  const assets = Number(accRow ? accRow.assets : 0) || 0
  const accountDebt = Number(accRow ? accRow.debt : 0) || 0

  /*
   * ★ 未归还的借入 ★
   *   按分类名聚合，不硬编码 id（id 会随备份导入变化）。
   *   「借入」是 income（钱进来 -> 增加了要还的债），
   *   「借款归还」是 expense（钱还出去 -> 减少要还的债）。
   *
   *   JOIN 分类表而不是用 IN (子查询)，是因为同时要读分类名判断方向；
   *   分类已被删除的交易（category_id 为空或指向已删行）自然被 JOIN 排除，
   *   它们本来也不算在借入里。
   */
  const loanRow = await queryOne(
    `SELECT COALESCE(SUM(
              CASE WHEN t.type = 'income'  AND c.name = '借入'     THEN t.amount_cents
                   WHEN t.type = 'expense' AND c.name = '借款归还' THEN -t.amount_cents
                   ELSE 0 END), 0) AS loan_debt
     FROM txn t
     JOIN category c ON c.id = t.category_id AND c.deleted_at IS NULL
     WHERE t.deleted_at IS NULL`
  )
  // 归还多于借入（数据异常）时不让负债变负
  const loanDebt = Math.max(0, Number(loanRow ? loanRow.loan_debt : 0) || 0)

  const debt = accountDebt + loanDebt
  return { assets, debt, net: assets - debt, loanDebt }
}

/**
 * 尚未收回的借出（应收）
 *
 * ★ 目前只用于展示，不参与净资产 ★
 *   和「未归还的借入」不一样：借出的钱直接从账户余额里少了，
 *   如果把它加回总资产，就等于「借出去的钱还当自己的钱」——
 *   这是个产品口径选择，不是算术问题。
 *   当前口径是「净资产只认账户里的钱 + 明确要还的债」，
 *   所以这里单独提供函数，页面要显示时自己取，不混进 getAssetOverview。
 *
 * 算法：借出（expense）合计 - 借款收回（income）合计。
 *
 * @returns {Promise<number>} 分
 */
export async function getOutstandingLending() {
  const row = await queryOne(
    `SELECT COALESCE(SUM(
              CASE WHEN t.type = 'expense' AND c.name = '借出'     THEN t.amount_cents
                   WHEN t.type = 'income'  AND c.name = '借款收回' THEN -t.amount_cents
                   ELSE 0 END), 0) AS lending
     FROM txn t
     JOIN category c ON c.id = t.category_id AND c.deleted_at IS NULL
     WHERE t.deleted_at IS NULL`
  )
  return Math.max(0, Number(row ? row.lending : 0) || 0)
}

/** 总负债（信用卡/借入的绝对值） */
export async function getTotalDebt() {
  const row = await queryOne(
    'SELECT COALESCE(SUM(ABS(balance_cents)), 0) AS total FROM account WHERE deleted_at IS NULL AND archived = 0 AND include_in_total = 1 AND balance_cents < 0'
  )
  return Number(row ? row.total : 0)
}

/* ------------------------------------------------------------------ 写入 */

/* ------------------------------------------------------------ 组合账户成员 */

/**
 * 覆盖式写入组合账户的成员（按传入顺序决定扣款顺序）。
 *
 * ★ 为什么是「先全删再全插」★
 *   成员是一组有序关系，用户调序时可能整体上移下移，
 *   逐条 diff 维护 sort 很容易出现重复序号。
 *   直接重写整组最简单、结果确定 —— 成员通常只有 2~4 个，开销可忽略。
 *
 * ★ 过滤规则 ★
 *   · 组合不能作为成员（禁止嵌套）
 *   · 信用卡不能作为成员（按需求：组合账户不支持选择信用卡）
 *   · 不存在的账户直接丢弃（防止脏 id 写进来）
 *
 * @param {string} comboId
 * @param {string[]} memberIds 有序的真实账户 id 列表
 */
export async function replaceComboMembers(comboId, memberIds) {
  await execute('DELETE FROM account_combo_member WHERE combo_id = ?', [comboId])

  const ids = Array.isArray(memberIds) ? memberIds.filter(Boolean) : []
  if (ids.length === 0) return

  // 一次性取回这些账户的类型，用来过滤组合/信用卡
  const rows = await query(
    `SELECT id, type FROM account WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
    ids
  )
  const typeOf = {}
  rows.forEach((r) => { typeOf[r.id] = r.type })

  let sort = 0
  for (const mid of ids) {
    const t = typeOf[mid]
    if (!t) continue                     // 账户不存在
    if (isComboType(t)) continue         // 禁止嵌套
    if (isCreditType(t)) continue        // 不支持信用卡
    await execute(
      'INSERT OR IGNORE INTO account_combo_member (combo_id, member_id, sort) VALUES (?,?,?)',
      [comboId, mid, sort]
    )
    sort += 1
  }
}

/**
 * 读取组合账户的成员（按扣款顺序）。
 *
 * @param {string} comboId
 * @returns {Promise<Array>} 真实账户对象数组，已按 sort 排好
 */
export async function listComboMembers(comboId) {
  try {
    const rows = await query(
      `SELECT a.* FROM account_combo_member m
       JOIN account a ON a.id = m.member_id
       WHERE m.combo_id = ? AND a.deleted_at IS NULL AND a.archived = 0
       ORDER BY m.sort ASC, m.member_id ASC`,
      [comboId]
    )
    return rows.map(normalizeAccount)
  } catch (e) {
    // 表还不存在（老库未迁移）时按无成员处理，不影响主流程
    return []
  }
}

/** 读取成员 id 列表（保持顺序），编辑页回填用 */
export async function listComboMemberIds(comboId) {
  try {
    const rows = await query(
      'SELECT member_id FROM account_combo_member WHERE combo_id = ? ORDER BY sort ASC, member_id ASC',
      [comboId]
    )
    return rows.map((r) => r.member_id)
  } catch (e) {
    return []
  }
}

/**
 * 把某个真实账户从所有组合里移除。
 *
 * ★ 为什么必须做 ★
 *   删掉一个真实账户后，如果它还留在某个组合的成员表里，
 *   组合就指向一个「幽灵账户」：解析扣款时会找不到它，
 *   甚至可能把一笔钱算到已删除的账户上。
 */
export async function removeAccountFromAllCombos(accountId) {
  try {
    await execute('DELETE FROM account_combo_member WHERE member_id = ?', [accountId])
  } catch (e) {
    console.warn('[account] 从组合中移除失败:', e && e.message)
  }
}

/* ------------------------------------------------------------------ 写入 */

export async function createAccount(input) {
  const now = Date.now()
  const id = input.id || prefixedId('acc')
  const meta = getTypeMeta(input.type)
  const isCombo = isComboType(input.type)

  /*
   * ★ 组合账户没有钱 ★
   *   它不是真实资金账户，所以：
   *     · 期初余额强制 0（界面上也不显示这两个字段）
   *     · 不计入总资产强制 0
   *     · 余额恒 0，永不参与 recalcBalance
   *   不这样强制的话，一旦有值混进来，总资产就会凭空多出一笔。
   */
  const initial = isCombo ? 0 : (Number(input.initial_balance_cents) || 0)
  const includeInTotal = isCombo ? 0 : (input.include_in_total === false ? 0 : 1)
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
        initial, // 新账户余额 = 期初（组合账户恒为 0）
        includeInTotal,
        input.credit_limit_cents === undefined || input.credit_limit_cents === null ? null : Number(input.credit_limit_cents),
        input.bill_day === undefined ? null : input.bill_day,
        input.repay_day === undefined ? null : input.repay_day,
        input.card_tail || null,
        sort,
        now,
        now
      ]
    )

    // 组合账户的成员（按顺序），真实账户没有这一步
    if (isCombo && Array.isArray(input.member_ids)) {
      await replaceComboMembers(id, input.member_ids)
    }

    // 组合账户不写资产快照 —— 它没有余额，写进去会在资产趋势里出现 0 元点
    if (!isCombo) await writeTodaySnapshot(id)
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

  /*
   * ★ 账户类型可以改（除组合账户外）★
   *
   * 用户要求：「组合账户保持账户类型不可编辑，但其他类型的账户都要可以编辑类型」。
   *
   * ★ 唯一禁止的是「组合 <-> 真实账户」的互转 ★
   *   两者语义完全互斥：
   *     · 真实账户有余额、有流水，参与总资产
   *     · 组合账户没有余额（恒 0），只有成员列表，不参与总资产
   *   互转会让余额/成员两套语义同时坏掉：
   *     储蓄卡 -> 组合：余额没地方放了（recalcBalance 会强制写 0），
   *       原来那笔钱从总资产里凭空消失，而且理财/流水全挂在它名下。
   *     组合 -> 储蓄卡：成员列表变成孤儿，组合也没了「按顺序扣款」的意义。
   *   所以这两种转换一律拦掉，其余（现金<->储蓄卡<->信用卡<->网络支付<->充值卡）随便改。
   *
   * ★ 改成 / 改离信用卡时的字段清理 ★
   *   updateAccount 用 patch 里传了什么就写什么，
   *   所以「信用卡 -> 储蓄卡」时界面会把 credit_limit_cents / bill_day /
   *   repay_day 传成 null，这里直接写空即可（不清会残留额度，
   *   虽然统计不再按信用卡算，但编辑页会冒出莫名其妙的额度行）。
   */
  const willBeCombo = patch.type !== undefined
    ? isComboType(patch.type)
    : existing.isCombo
  if (patch.type !== undefined && isComboType(patch.type) !== existing.isCombo) {
    throw new Error('组合账户不能与其它类型互相转换')
  }

  if (patch.name !== undefined) assign('name', patch.name)
  if (patch.type !== undefined) assign('type', patch.type)
  if (patch.icon !== undefined) assign('icon', patch.icon)
  if (patch.color !== undefined) assign('color', patch.color)

  // 组合账户永远不计入总资产，忽略外部传入
  if (willBeCombo) {
    assign('include_in_total', 0)
  } else if (patch.include_in_total !== undefined) {
    assign('include_in_total', patch.include_in_total ? 1 : 0)
  }

  if (patch.credit_limit_cents !== undefined) {
    assign('credit_limit_cents', patch.credit_limit_cents === null ? null : Number(patch.credit_limit_cents))
  }
  if (patch.bill_day !== undefined) assign('bill_day', patch.bill_day)
  if (patch.repay_day !== undefined) assign('repay_day', patch.repay_day)
  if (patch.card_tail !== undefined) assign('card_tail', patch.card_tail)
  if (patch.archived !== undefined) assign('archived', patch.archived ? 1 : 0)
  if (patch.sort !== undefined) assign('sort', patch.sort)

  // 期初余额变动 → 需要重算余额（组合账户没有余额，忽略）
  let needRecalc = false
  if (!willBeCombo && patch.initial_balance_cents !== undefined) {
    assign('initial_balance_cents', Number(patch.initial_balance_cents) || 0)
    needRecalc = true
  }

  assign('updated_at', now)
  params.push(id)

  await transaction(async () => {
    await execute(`UPDATE account SET ${fields.join(', ')} WHERE id = ?`, params)

    // 组合账户：成员变化整体重写（顺序即扣款顺序）
    if (willBeCombo && Array.isArray(patch.member_ids)) {
      await replaceComboMembers(id, patch.member_ids)
    }

    if (needRecalc) await recalcBalance(id)
    // 组合账户不写快照（没有余额，写了会在趋势图出现 0 元点）
    if (!willBeCombo) await writeTodaySnapshot(id)
  })

  return getAccount(id)
}

/**
 * 把账户余额调整到指定值 —— 差额以「对账交易」的形式记进流水
 *
 * ★ 为什么不用「改期初余额」 ★
 *   期初余额是开户时的钱，用户看到「期初 5000 / 现在 4800」
 *   根本不知道差在哪。改成直接编辑**当前余额**：
 *   用户说「我卡里现在是 4800」，差额 200 就记一笔
 *   「对账支出 200」，在交易记录里看得见、也说得清。
 *   余额公式（期初 + 收入 - 支出）依然成立，账对得上。
 *
 * @param {string} accountId 账户 id
 * @param {number} targetCents 目标余额（分）
 * @param {object} opts { note }
 * @returns {Promise<{changed:boolean, delta:number, txnId:string|null}>}
 */
export async function adjustAccountBalance(accountId, targetCents, opts = {}) {
  const acc = await getAccount(accountId)
  if (!acc) throw new Error('账户不存在')

  const target = Math.round(Number(targetCents) || 0)
  const current = Number(acc.balance_cents) || 0
  const delta = target - current

  // 没变化就什么都不做
  if (delta === 0) {
    return { changed: false, delta: 0, txnId: null }
  }

  // 差额为正 → 记一笔收入；为负 → 记一笔支出
  const type = delta > 0 ? 'income' : 'expense'
  const amount = Math.abs(delta)

  // 确保「对账支出」「对账收入」两个固定一级分类存在
  //   v4 起这两个分类是一级的（parent_id = NULL），
  //   但 txn.category_id 指向一级分类完全合法 ——
  //   日常「其他/杂项」这种没有二级的一级分类就是这么用的。
  const cats = await ensureReconcileCategory()
  const categoryId = type === 'income' ? cats.incomeId : cats.expenseId

  const note = opts.note || '余额对账调整'
  const now = Date.now()
  const txnId = prefixedId('txn')
  const keys = makeDateKeys(new Date())

  // ★ 直接写交易表，不走 api/transaction.js ★
  //   transaction.js 反过来 import 了本文件的 recalcBalance，
  //   这里再 import 回去就形成循环依赖。
  //   写入的字段和 createTransaction 完全一致。
  await transaction(async () => {
    /*
     * ★ 不再写 source / raw_text ★
     *   两列已停用（v10 迁移），新装库没有它们。
     *   对账流水的说明本来就在 note 里，不需要再冗余一份。
     */
    await execute(
      `INSERT INTO txn (
        id, type, amount_cents, account_id, to_account_id, category_id, note,
        occurred_at, occurred_day, month_key, year_key, tz_offset,
        created_at, updated_at, deleted_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
      [
        txnId,
        type,
        amount,
        accountId,
        null,
        categoryId,
        note,
        keys.occurred_at,
        keys.occurred_day,
        keys.month_key,
        keys.year_key,
        keys.tz_offset,
        now,
        now
      ]
    )

    // 重算余额 + 写快照
    await recalcBalance(accountId)
    await writeTodaySnapshot(accountId)
  })

  return { changed: true, delta, txnId }
}

/**
 * 直接把账户余额设成指定值 —— **不记对账交易**
 *
 * ★ 和 adjustAccountBalance 的区别 ★
 *   adjustAccountBalance：差额记一笔「对账支出 / 对账收入」，
 *     流水里看得见，余额公式（期初 + 收入 - 支出）依然成立。
 *     适合「卡里实际是 4800，和我记的 5000 差 200」这种真实差异。
 *
 *   本函数：直接改**期初余额**，把余额凑到目标值，
 *     不产生任何流水。适合「一开始就把期初余额填错了，
 *     现在想改过来，别在流水里留一条假账」。
 *
 * ★ 怎么反推期初余额 ★
 *   余额公式：balance = initial - Σ支出(含转出) + Σ收入(含转入)
 *   所以：   initial = target + Σ支出 - Σ收入
 *   两边对一遍就知道为什么是「加支出、减收入」：
 *   支出会让余额变小，要多算一点期初才补得回来。
 *
 * ★ 为什么不允许对组合账户调用 ★
 *   组合账户没有余额（恒 0），改它没有意义。
 *
 * @param {string} accountId 账户 id
 * @param {number} targetCents 目标余额（分）
 * @returns {Promise<{changed:boolean, delta:number}>}
 */
export async function setAccountBalanceDirect(accountId, targetCents) {
  const acc = await getAccount(accountId)
  if (!acc) throw new Error('账户不存在')
  if (acc.isCombo) throw new Error('组合账户没有余额，不能修改')

  const target = Math.round(Number(targetCents) || 0)
  const current = Number(acc.balance_cents) || 0
  const delta = target - current

  if (delta === 0) return { changed: false, delta: 0 }

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

  const outSum = Number(outRow ? outRow.s : 0)
  const inSum = Number(inRow ? inRow.s : 0)
  const initial = target + outSum - inSum

  await transaction(async () => {
    await execute('UPDATE account SET initial_balance_cents = ?, updated_at = ? WHERE id = ?', [
      initial,
      Date.now(),
      accountId
    ])
    await recalcBalance(accountId)
    await writeTodaySnapshot(accountId)
  })

  return { changed: true, delta }
}

/**
 * 重算指定账户余额。
 * 必须在事务内调用。
 * transfer 会同时影响两个账户：转出方减、转入方加。
 */
export async function recalcBalance(accountId) {
  const acc = await queryOne('SELECT * FROM account WHERE id = ?', [accountId])
  if (!acc) return 0

  /*
   * ★ 组合账户没有余额，直接跳过 ★
   *   它不是资金账户：钱都记在真实账户名下，
   *   组合名下本来就不该有流水（记账时已解析掉）。
   *   万一有历史脏数据挂上来，也不能让它影响总资产 ——
   *   所以这里强制保持 0，绝不参与计算。
   */
  if (isComboType(acc.type)) {
    await execute('UPDATE account SET balance_cents = 0, updated_at = ? WHERE id = ?', [
      Date.now(),
      accountId
    ])
    return 0
  }

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
  /*
   * 组合账户不参与重算（它没有余额）——
   * recalcBalance 内部虽然也会跳过，但这里先过滤掉可以少走一趟循环。
   */
  const real = accounts.filter((a) => !a.isCombo)
  await transaction(async () => {
    for (const acc of real) {
      await recalcBalance(acc.id)
    }
  })
  return real.length
}

/**
 * 软删除账户
 *
 * ★ 有交易也能删 ★
 *   用户要求：删除账户时就算账户下还有交易也允许删除，
 *   这些交易变成「无账户」（交易本身不删，历史记录要留住）。
 *
 * ★ 为什么用空字符串 '' 而不是 NULL ★
 *   txn.account_id 在建表时是 `TEXT NOT NULL`，
 *   SQLite 改不了已有列的 NOT NULL（只能重建表，代价大、风险高）。
 *   而用 NULL 会直接撞上 NOT NULL 约束 —— 写不进去。
 *   空字符串 '' 同样「匹配不上任何账户」（账户 id 是 uuid），
 *   LEFT JOIN account a ON a.id = t.account_id 匹配不到，
 *   显示效果和 NULL 完全一样，但不违反约束。
 *   同时 api/backup.js 的导入用 `t.account_id || null` 写值，
 *   空字符串经过 || 也会变成 null，导入不会炸。
 *
 * ★ to_account_id 用 NULL ★
 *   它建表时就是可空的（没有 NOT NULL），用 NULL 语义更准确。
 *
 * ★ 要重算哪些账户的余额 ★
 *   只重算「转账的对方账户」——
 *   被删账户自己已经软删了，不再出现在账户列表里，
 *   它的余额缓存留着也不影响显示（总资产统计本来就排除了 deleted_at 的行）。
 *   对方账户则必须重算：
 *     - 被删的是转入方 -> to_account_id 置 NULL，这笔转账不再计入任何人的流入，
 *       但转出方仍在转出，转出方余额要重算
 *     - 被删的是转出方 -> 转入方的流入不变（to_account_id 还指着它），
 *       重算一次是无害的兜底
 *
 * @param {string} id 账户 id
 * @returns {Promise<boolean>}
 */
export async function deleteAccount(id) {
  const acc = await getAccount(id)
  if (!acc) throw new Error('账户不存在')

  const now = Date.now()

  await transaction(async () => {
    // 1) 找出两种「对方账户」—— 必须在改 account_id 之前查，改完就找不到了
    //
    //    a) 被删账户是「转出方」：这笔转账的转入方是谁
    //       —— 对方仍然是转入方，余额不变（但重算一次也没坏处，
    //          顺便兜住别的情况）
    //    b) 被删账户是「转入方」：这笔转账的转出方是谁
    //       —— ★ 这个必须重算 ★
    //          to_account_id 被置 NULL 之后，这笔转账不再计入
    //          任何人的流入，但转出方仍然在转出（account_id 还在），
    //          不重算的话转出方的余额就平白少了一截。
    const transferOutRows = await query(
      `SELECT DISTINCT to_account_id AS id FROM txn
       WHERE deleted_at IS NULL AND to_account_id IS NOT NULL AND to_account_id != ''
         AND account_id = ?`,
      [id]
    )
    const transferInRows = await query(
      `SELECT DISTINCT account_id AS id FROM txn
       WHERE deleted_at IS NULL AND account_id IS NOT NULL AND account_id != ''
         AND to_account_id = ?`,
      [id]
    )
    const counterpartIds = transferOutRows
      .concat(transferInRows)
      .map((r) => r.id)
      .filter((x) => x && x !== id)

    // 2) 交易本身不删，只把账户摘掉（变成「无账户」）
    //    account_id 置空字符串（NOT NULL 约束），to_account_id 置 NULL（可空）
    await execute(
      `UPDATE txn SET account_id = '', updated_at = ?
       WHERE deleted_at IS NULL AND account_id = ?`,
      [now, id]
    )
    await execute(
      `UPDATE txn SET to_account_id = NULL, updated_at = ?
       WHERE deleted_at IS NULL AND to_account_id = ?`,
      [now, id]
    )

    // 3) 软删除账户 + 清掉它的快照
    await execute('UPDATE account SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id])
    await execute('DELETE FROM account_snapshot WHERE account_id = ?', [id])

    /*
     * 3.5) 组合账户的成员关系必须清掉
     *
     * 两种方向都要处理：
     *   · 被删的是真实账户 → 它可能是某些组合的成员，留着会变成「幽灵账户」，
     *     解析扣款时找不到它，甚至可能把钱算到已删除账户上
     *   · 被删的是组合账户 → 它自己的成员关系整组作废
     *
     * ★ 放在事务内 ★
     *   和上面的软删一起提交，不会出现「账户删了、成员还在」的中间态。
     */
    await execute('DELETE FROM account_combo_member WHERE member_id = ?', [id])
    await execute('DELETE FROM account_combo_member WHERE combo_id = ?', [id])

    /*
     * 3.6) 被删的是组合账户 → 清掉经它记的交易的 via_combo_id
     *
     * ★ 用户要求 ★
     *   组合账户删除后，交易记录**不设为无账户**（它们本来就记在真实账户名下），
     *   只是去掉「组合账户」这个标记（via_combo_id 是它的来源）。
     *   清掉后这些交易在列表里不再显示「组合账户」徽标，变回普通交易。
     *
     * ★ 为什么不动 account_id / to_account_id ★
     *   组合从不作为 txn 的 account_id 落库（记账时已解析成真实账户），
     *   上面的 account_id='' / to_account_id=NULL 更新对组合是空操作。
     *   这里只需清 via_combo_id。
     */
    if (acc.isCombo) {
      await execute(
        'UPDATE txn SET via_combo_id = NULL, updated_at = ? WHERE via_combo_id = ?',
        [now, id]
      )
    }

    // 4) 重算对方账户的余额
    for (const cid of counterpartIds) {
      await recalcBalance(cid)
      await writeTodaySnapshot(cid)
    }
  })

  // 5) 被删的账户如果正是「默认账户」，把默认账户设置清掉
  //    ★ 必须在事务外做 ★
  //      setSetting 内部会走 execute() -> await openDb()，
  //      而这里已经在 transaction() 里了，套一层事务容易出问题。
  //    ★ 为什么必须清 ★
  //      defaultAccountId 被 TxnPanel / QuickAddBar 直接拿来当新交易的账户，
  //      不校验它还在不在。留着的话新交易会挂到一个已删除的账户上，
  //      余额算不到（看起来就是「钱丢了」）。
  try {
    const defaultId = await getSetting('defaultAccountId', '')
    if (defaultId === id) {
      await setSetting('defaultAccountId', '')
    }
  } catch (e) {
    // 设置写失败不该挡住删除
    console.warn('[account] 清理默认账户设置失败:', e && e.message)
  }

  return true
}

/* ------------------------------------------------------------------ 快照 */

/** 写今日快照（幂等，用 upsert 兼容旧 SQLite 内核） */
export async function writeTodaySnapshot(accountId) {
  /*
   * ★ 组合账户不写快照 ★
   *   它是虚拟账户，没有余额可言；
   *   写进去只会在资产趋势里多一条无意义的 0 元记录。
   */
  const acc = await queryOne('SELECT balance_cents, type FROM account WHERE id = ?', [accountId])
  if (!acc) return
  if (isComboType(acc.type)) return
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

  /*
   * ★ 排除组合账户 ★
   *   组合没有余额，写进快照会在「资产趋势」里多出一条 0 元线，
   *   而且和真实资产的量级混在一起，图上看着很脏。
   */
  const list = await query(
    "SELECT id, balance_cents FROM account WHERE deleted_at IS NULL AND type != 'combo'"
  )
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


/**
 * 总资产变化点趋势。
 *
 * 这里要的是「**每次资产变化打一个点**」：
 *   只有当天的总资产和前一天不一样时，才记一个点。
 *
 * ★ 口径必须与 getAssetOverview 的「总资产」完全一致 ★
 *   总资产 = 账户**正余额**之和（负余额是负债，不算进总资产）。
 *
 *   以前这里直接 SUM(balance_cents)，把负余额也加进去了 ——
 *   那是**净资产**（正余额 - 负债），不是总资产。
 *   结果就是：账户页大数字写着「净资产 5000」，下面「总资产 8000」，
 *   而趋势图画的却是 5000 那条线（净资产），
 *   三处数字对不上。用户这次明确要求趋势图看总资产。
 *
 *   所以改成只累加正余额：
 *     SUM(CASE WHEN balance_cents > 0 THEN balance_cents ELSE 0 END)
 *
 * ★ 为什么不在 SQL 里再减掉「未归还的借入」★
 *   负债里的借入部分不是账户余额，快照表里没有它；
 *   要算的话得按天回溯 txn，代价大且和「账户快照」这个数据源不一致。
 *   趋势图看的是「账户里有多少钱」的走势，用账户快照最直接。
 *   （负债/净资产的即时值在账户页概览里，那里是实时算的。）
 *
 * ★ 过滤条件 ★
 *   只算 include_in_total=1 的账户、排除已归档/已删除的。
 *   account_snapshot 表里可能还留着已归档账户的历史快照，
 *   所以聚合时要按账户过滤，不能直接 SUM 全部。
 *
 * @param {number} months 回看多少个月
 * @returns {Promise<Array<{day:string, total:number, delta:number}>>}
 *   delta = 与上一个点相比的变化额（第一个点为 0）
 */
export async function getAssetChangePoints(months = 6) {
  // ★ 先确保今天的快照存在 ★
  //   快照原来只在 App 冷启动时写一次（writeAllTodaySnapshots）。
  //   如果 App 跨过午夜还开着、或者不冷启动直接进页面，
  //   今天就没有快照 -> 趋势图今天这一格是 0（看着像资产归零了）。
  //   这里查之前补写一次，代价很小。
  await writeAllTodaySnapshots().catch(() => {})

  const from = new Date()
  from.setDate(from.getDate() - months * 31)
  const fromDay = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`

  // 每天的总资产（只算计入总资产的账户，且只累加正余额）
  const rows = await query(
    `SELECT s.day AS day,
            SUM(CASE WHEN s.balance_cents > 0 THEN s.balance_cents ELSE 0 END) AS total
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

  // 每天一个点，并标出「这一天资产变了没有」
  // 之前只返回变化点，导致没变化的那天被补成 0 ——
  // 折线会在两次变化之间整个掉到 0，看着像资产归零了。
  // 现在返回完整序列，变化点用 changed 标出来。
  const points = []
  let prev = null
  for (const d of daily) {
    const changed = prev === null || d.total !== prev
    points.push({
      day: d.day,
      total: d.total,
      delta: prev === null ? 0 : d.total - prev,
      changed
    })
    prev = d.total
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
 * ★ 缺失的天用「上一个已知值」填，不是 0 ★
 *   直接记 0 会让折线整个掉到 0 ——
 *   资产没变的那天（最常见的情况）会被画成 0，
 *   看着像资产归零了，实际只是那天没记账。
 *
 *   规则：
 *   - 有快照的天：用真实值
 *   - 没快照的天：沿用上一个已知值（资产没动过）
 *   - 一个已知值都没有（区间开头）：才记 0
 *
 * ★ 终点是「今天」★
 *   最后一次变化之后到现在（资产没动过的那段）也要画出来，趋势才是连续的。
 *
 * 「资产变化点」由 changed 字段标出，页面用它决定要不要打标记。
 *
 * @param {Array<{day:string,total:number,delta:number,changed?:boolean}>} points
 * @param {number} days 区间长度（天）
 * @returns {Array<{day:string,total:number,delta:number,changed:boolean}>}
 */
export function fillChangePoints(points = [], days = 0) {
  if (points.length === 0) return []
  if (days <= 0) return points.slice()

  // 终点：今天
  const endDate = new Date()
  endDate.setHours(0, 0, 0, 0)
  // 起点：今天往前 days-1 天
  const startDate = new Date(endDate.getTime())
  startDate.setDate(startDate.getDate() - days + 1)

  // 建立 day -> point 的索引
  const map = {}
  for (const p of points) map[p.day] = p

  const out = []
  // 上一个已知值（用来填补中间没数据的天）
  let lastKnown = null
  const cur = new Date(startDate.getTime())
  while (cur.getTime() <= endDate.getTime()) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    if (map[key]) {
      lastKnown = map[key]
      out.push({ ...map[key], changed: map[key].changed !== false })
    } else if (lastKnown) {
      // 这天没快照，但资产没变过 -> 沿用上一个值
      out.push({ day: key, total: lastKnown.total, delta: 0, changed: false })
    } else {
      // 区间开头还没有任何数据
      out.push({ day: key, total: 0, delta: 0, changed: false })
    }
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

async function nextSort() {
  const row = await queryOne('SELECT COALESCE(MAX(sort), -1) AS m FROM account WHERE deleted_at IS NULL')
  return (Number(row ? row.m : -1) + 1)
}
