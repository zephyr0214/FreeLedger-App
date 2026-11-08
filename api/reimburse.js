/**
 * 报销台账 —— 待报销 / 已报销（报销单）
 *
 * ★ 状态存在哪 ★
 *   txn.reimburse_status：0 不报销（默认）/ 1 待报销 / 2 已报销
 *   配套三列：reimburse_day（报销日期）、reimburse_amount_cents（实报金额）、
 *   reimburse_account_id（报销到账账户）。
 *
 * ★ 为什么待报销要同时改两个 exclude 标记 ★
 *   待报销的含义是「这笔钱还没回来」：
 *     · 不能计入收支 —— 我还没真的花掉它（能报回来）
 *     · 不能占预算   —— 同上
 *   所以 status=1 时把 exclude_from_budget / exclude_from_stats 都置 1。
 *   统计层因此一行都不用改（它只认这两个标记），
 *   报销完成后也不用把支出重新放开 —— 支出从来不进收支，
 *   真正的损益由「报销坏账 / 报销盈余」两笔表达。
 *
 * ★ 报销时写哪几笔 ★
 *   设原支出金额 A（分）、实报金额 R（分）：
 *     1) 报销到账   income  R   → 进报销账户（exclude_from_stats=1，不重复计收支）
 *     2) 报销坏账   expense A-R → 仅当 A > R（我的损失，计入收支）
 *     3) 报销盈余   income  R-A → 仅当 R > A（多拿到的，计入收支）
 *   差额为 0 时只记账 1。
 *
 * ★ 报销单（v23 起）★
 *   每一次报销（右滑单笔 / 多选批量）都先建一张 reimburse_batch（单头），
 *   再把这一单涉及的**所有**流水挂上 batch_id：
 *     · 被报销的那 N 笔原始支出
 *     · 自动生成的报销到账 / 报销坏账 / 报销盈余
 *   单头冗余存着 origin/done/txn_count/day/account，是为了列表页一次查询
 *   就能出卡头（不用把明细捞上来再聚合），也方便老版本 App 读新库时
 *   至少看到「报销了几笔、报了多少钱」。
 *
 * ★ 这个文件里「笔数」永远不含派生流水 ★
 *   派生流水（到账/坏账/盈余）是报销动作的产物，不是被报销的账。
 *   把它们算进笔数，用户会看到「我明明报了 3 笔，这里写 5 笔」。
 *   所以 txn_count 只记原始支出笔数，派生流水在卡片里单独分组并标注。
 *
 * ★ 老数据（batch_id 为空）怎么处理 ★
 *   v23 迁移**不回填**任何 batch_id（理由见 api/db/index.js v23 注释：
 *   反推一定会造出错误的单）。列表读的时候用
 *   groupLegacyReimburseBatches() 做一次**只读**的分组兜底：
 *   同报销日 + 同到账账户 + 同实报金额的一组已报销流水 = 一张「历史报销单」。
 *   派生流水再用金额精确对上（到账金额 == 单的实报金额，
 *   坏账/盈余金额 == |实报 - 原支出|），对不上的就不塞进去 ——
 *   宁可少显示一条差额，也不把不属于这张单的钱算进来。
 */

import { query, queryOne, execute, transaction } from './db/index.js'
import { prefixedId } from '../utils/id.js'
import { toDayKey, makeDateKeys } from '../utils/date.js'
import { ensurePresetCategories } from './category.js'
import { INTERNAL_ONLY_CATEGORY_NAMES, REIMBURSE_CATEGORY_NAMES } from './db/schema.js'
import { recalcBalance, writeTodaySnapshot } from './account.js'

/** 报销状态常量 */
export const REIMBURSE_STATUS = {
  NONE: 0,
  PENDING: 1,
  DONE: 2
}

/**
 * 报销的三个派生分类名。
 *
 * ★ 卡片里靠它区分「被报销的原始支出」和「报销动作的产物」★
 *   从分类名判断而不是再查一遍 txn.batch_id 与 reimburse_status：
 *   派生流水的 reimburse_status 是 0（它们不是被报销的账），
 *   而用户也可能手动记一笔「报销坏账」（系统分类允许手动记账），
 *   那种行不该被当成派生流水算进某一单。
 *   所以这里只是**名单**，真正归属哪一单由 batch_id 决定。
 */
const DERIVED_CATEGORY_NAMES = [
  REIMBURSE_CATEGORY_NAMES.income.name,
  REIMBURSE_CATEGORY_NAMES.badDebt.name,
  REIMBURSE_CATEGORY_NAMES.surplus.name
]

/**
 * 这几个分类是「报销台账自己写」的内部口径，用户与 AI 都不能手动选。
 *
 * ★ 用户要求的第 9 条 ★
 *   借入利息 / 借出坏账 / 借出利息 / 借入未还 / 报销坏账 / 报销盈余
 *   不可以被 AI 记账和手动记账面板选择。
 *   这条函数把「六类结清/报销派生分类」一次性列出来，
 *   面板与 AI 侧都调它来过滤。
 *
 * @param {string} name 分类名
 * @returns {boolean}
 */
export function isInternalOnlyCategory(name) {
  return INTERNAL_ONLY_CATEGORY_NAMES.includes(String(name || ''))
}

/** 单笔流水行 → 页面用的数字/布尔口径（列表与报销单共用） */
function normalizeTxnRow(r) {
  return {
    ...r,
    amount_cents: Number(r.amount_cents) || 0,
    /*
     * ★ tag_ids 必须转成数组（本轮：报销页流水也要显示用户标签徽标）★
     *   下面的 TXN_SELECT 用 GROUP_CONCAT 把标签拼成 `"tag_a,tag_b"` 这样的
     *   **字符串**；而 utils/txnBadges.js 的 buildTxnBadges 是按数组遍历的
     *   （`Array.isArray(t.tag_ids) ? t.tag_ids : []`）—— 直接把字符串传过去
     *   它拿到空数组，标签徽标一个都不显示，而且不报错，最难查。
     *   口径与 api/transaction.js 的 normalizeTxn 完全一致（split(',') 再 filter），
     *   保证同一笔账在报销页和其它列表页拿到同一种 tag_ids。
     */
    tag_ids: r.tag_ids
      ? String(r.tag_ids).split(',').filter(Boolean)
      : [],
    reimburse_status: Number(r.reimburse_status) || 0,
    reimburse_amount_cents: r.reimburse_amount_cents === null || r.reimburse_amount_cents === undefined
      ? null
      : Number(r.reimburse_amount_cents),
    exclude_from_budget: Number(r.exclude_from_budget) === 1,
    exclude_from_stats: Number(r.exclude_from_stats) === 1
  }
}

/**
 * 带分类 / 账户名 / 标签 id 的流水 SELECT 片段（报销页四处查询共用，
 * 避免各写一份 JOIN 与子查询走样）。
 *
 * ★ tag_ids 为什么用相关子查询而不是 JOIN txn_tag ★
 *   JOIN 会把「一笔账挂两个标签」变成两行，笔数和金额都会翻倍。
 *   子查询每行只出一个 GROUP_CONCAT 字符串，语义正好是「这笔账的标签集合」。
 *   写法与 api/transaction.js 的 listTransactions / getTransaction 逐字一致 ——
 *   同一个字段在哪个页面都得是同一种拼法，否则 normalize 层还要分两套。
 */
const TXN_SELECT = `t.*,
            c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            a.name AS account_name,
            (SELECT GROUP_CONCAT(tt.tag_id) FROM txn_tag tt WHERE tt.txn_id = t.id) AS tag_ids`

const TXN_JOINS = `LEFT JOIN category c ON c.id = t.category_id
     LEFT JOIN account  a ON a.id = t.account_id`

/**
 * 待报销 / 已报销流水（按时间倒序，带分类与账户信息）。
 *
 * ★ 报销页的「已报销」tab 已经改成按单展示（listReimburseBatches）★
 *   这个函数继续保留：其他页面（详情页徽标、统计自查）与
 *   「待报销」tab 都还在用它，签名和返回结构不能变。
 *
 * @param {'pending'|'done'} status
 * @param {{limit?:number}} [opt]
 */
export async function listReimburseTxns(status = 'pending', opt = {}) {
  const { limit = 500 } = opt
  const w = status === 'done'
    ? 't.reimburse_status = 2'
    : 't.reimburse_status = 1'

  const rows = await query(
    `SELECT ${TXN_SELECT}
     FROM txn t
     ${TXN_JOINS}
     WHERE t.deleted_at IS NULL AND ${w}
     ORDER BY ${status === 'done' ? 't.reimburse_day DESC, t.occurred_at DESC' : 't.occurred_at DESC, t.created_at DESC'}
     LIMIT ?`,
    [Number(limit) || 500]
  )

  return rows.map(normalizeTxnRow)
}

/**
 * 汇总：待报销笔数 / 待报销总额 / 已报销笔数 / 已报销总额。
 */
export async function getReimburseSummary() {
  const row = await queryOne(
    `SELECT
       SUM(CASE WHEN reimburse_status = 1 THEN 1 ELSE 0 END) AS pending_cnt,
       SUM(CASE WHEN reimburse_status = 1 THEN amount_cents ELSE 0 END) AS pending_amt,
       SUM(CASE WHEN reimburse_status = 2 THEN 1 ELSE 0 END) AS done_cnt,
       SUM(CASE WHEN reimburse_status = 2 THEN COALESCE(reimburse_amount_cents, amount_cents) ELSE 0 END) AS done_amt
     FROM txn WHERE deleted_at IS NULL`
  )
  return {
    pendingCount: Number(row ? row.pending_cnt : 0) || 0,
    pendingAmount: Number(row ? row.pending_amt : 0) || 0,
    doneCount: Number(row ? row.done_cnt : 0) || 0,
    doneAmount: Number(row ? row.done_amt : 0) || 0
  }
}

/**
 * 设置 / 取消「待报销」（只对支出生效）。
 *
 * ★ 勾上待报销时 ★
 *   reimburse_status = 1，同时把 exclude_from_budget / exclude_from_stats 置 1。
 * ★ 取消时 ★
 *   reimburse_status = 0，两个标记一起恢复成 0（前提是这笔不是借款类）。
 *
 * 借款类流水本来就不计收支，取消待报销不该把它们放回来 ——
 * 所以这里先查一下分类名，借款八类保持 exclude 不变。
 *
 * ★ batch_id 也要清 ★
 *   一笔已经报销过的流水被用户取消待报销时，它原来所属的报销单就少了一笔，
 *   单头的 origin/done/txn_count 也不再成立。这种「回退」是极少数情况，
 *   这里把 batch_id 清掉让它回到「无单」状态，比留着一张对不上的单更诚实。
 *
 * @param {string} id
 * @param {boolean} pending
 */
export async function setTxnPendingReimburse(id, pending) {
  const txn = await queryOne(
    `SELECT t.id, t.type, t.exclude_from_budget, t.exclude_from_stats, c.name AS category_name
     FROM txn t LEFT JOIN category c ON c.id = t.category_id
     WHERE t.id = ? AND t.deleted_at IS NULL`,
    [id]
  )
  if (!txn) throw new Error('交易不存在')
  if (txn.type !== 'expense') throw new Error('只有支出可以报销')

  /*
   * 借款类流水（借出 / 借出坏账…）本来就不计收支且不能报销了结，
   * 但它们是支出方向，用户可能在详情页误点。这里直接拒绝更清楚。
   */
  if (['借出', '借款归还', '借出坏账', '借入利息'].includes(txn.category_name)) {
    throw new Error('借款类的账不能走报销')
  }

  const now = Date.now()
  await execute(
    `UPDATE txn SET reimburse_status = ?, exclude_from_budget = ?, exclude_from_stats = ?,
       reimburse_day = NULL, reimburse_amount_cents = NULL, reimburse_account_id = NULL,
       batch_id = NULL, updated_at = ?
     WHERE id = ?`,
    [
      pending ? REIMBURSE_STATUS.PENDING : REIMBURSE_STATUS.NONE,
      pending ? 1 : 0,
      pending ? 1 : 0,
      now,
      id
    ]
  )
  return getReimburseTxn(id)
}

/** 单笔（带分类/账户名） */
export async function getReimburseTxn(id) {
  return queryOne(
    `SELECT ${TXN_SELECT}
     FROM txn t
     ${TXN_JOINS}
     WHERE t.id = ? AND t.deleted_at IS NULL`,
    [id]
  )
}

/**
 * 执行报销（单笔或多笔一起），同时生成一张报销单。
 *
 * @param {{ids:string[], totalCents:number, accountId:string, day?:string}} input
 *   ids        待报销的交易 id 列表
 *   totalCents 实际到账总额（分）—— 多选时是这一批的总数
 *   accountId  到账账户
 *   day        报销日期（默认今天）
 * @returns {Promise<{incomeCents:number, badDebtCents:number, surplusCents:number,
 *   incomeId:string, batchId:string}>}
 */
export async function reimburseTxns(input) {
  // 去重：同一笔被传两次会让「笔数」和「原支出合计」各多算一次
  const ids = Array.isArray(input.ids)
    ? Array.from(new Set(input.ids.filter(Boolean)))
    : []
  if (ids.length === 0) throw new Error('没有选中要报销的流水')

  const totalCents = Math.max(0, Math.round(Number(input.totalCents) || 0))
  if (!totalCents) throw new Error('请输入报销金额')
  if (!input.accountId) throw new Error('请选择报销账户')

  // 选出这批待报销流水的原金额合计
  const placeholders = ids.map(() => '?').join(',')
  const rows = await query(
    `SELECT id, amount_cents, reimburse_status FROM txn
     WHERE deleted_at IS NULL AND id IN (${placeholders})`,
    ids
  )
  if (rows.length === 0) throw new Error('选中的流水不存在')
  /*
   * ★ 笔数必须和选中数对得上 ★
   *   有一条查不到（被删了 / 被并发改了）时，如果照旧只更新能查到的那些，
   *   单头的 txn_count 就会比实际挂上 batch_id 的流水多，
   *   卡片上写着「报销 3 笔」、下面只列得出 2 笔，用户会以为账丢了。
   *   这里直接报错让他刷新重来，比生成一张对不上的单安全。
   */
  if (rows.length !== ids.length) {
    throw new Error('选中的流水里有不存在或已删除的，请刷新后重试')
  }
  const notPending = rows.find((r) => Number(r.reimburse_status) !== REIMBURSE_STATUS.PENDING)
  if (notPending) throw new Error('选中的流水里有不是「待报销」的，请刷新后重试')

  const originCents = rows.reduce((a, r) => a + (Number(r.amount_cents) || 0), 0)
  const day = input.day || toDayKey()

  const cats = await ensurePresetCategories()
  const now = Date.now()
  /*
   * ★ batch_id 在事务外先算好 ★
   *   它要在事务里被三处写入（三笔派生 + N 笔原始），
   *   提前生成一个稳定的 id，比在事务里到处传 prefixedId() 更不容易写错。
   */
  const batchId = prefixedId('batch')

  /*
   * ★ 三笔的顺序不重要，但必须在同一个事务里 ★
   *   中途失败会留下「状态已改、钱没记」的脏数据 ——
   *   用户看到已报销，账户余额却没变。
   *   报销单头也在同一个事务里写：单在、明细不在，或者反过来，都是坏数据。
   */
  return transaction(async () => {
    // 0) 报销单头
    await execute(
      `INSERT INTO reimburse_batch (
        id, total_origin_cents, total_done_cents, txn_count, day, account_id,
        created_at, updated_at, deleted_at
      ) VALUES (?,?,?,?,?,?,?,?,NULL)`,
      [batchId, originCents, totalCents, ids.length, day, input.accountId, now, now]
    )

    // 1) 报销到账：实报金额进报销账户，不计收支
    const incomeId = prefixedId('txn')
    const keys = makeDateKeys(new Date(`${day}T12:00:00`).getTime())
    await execute(
      `INSERT INTO txn (
        id, type, amount_cents, account_id, to_account_id, category_id, note,
        occurred_at, occurred_day, month_key, year_key, tz_offset,
        created_at, updated_at, deleted_at, cycle_id, via_combo_id,
        original_currency, original_amount_cents, exchange_rate,
        exclude_from_budget, exclude_from_stats, reimburse_status, batch_id
      ) VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,1,1,0,?)`,
      [
        incomeId, 'income', totalCents, input.accountId,
        cats.reimburseIncomeId || null,
        `报销到账 ${ids.length} 笔`,
        keys.occurred_at, keys.occurred_day, keys.month_key, keys.year_key, keys.tz_offset,
        now, now, batchId
      ]
    )

    /*
     * 2) 差额 → 坏账 / 盈余
     *
     * ★ 这一笔要占预算（本轮用户第 5 条）★
     *   用户原话「借出坏账 / 借入利息 / 报销坏账这三类要默认计入预算」。
     *   报销坏账是实实在在的损失，占用了这个月的可花额度；
     *   以前给它 exclude_from_budget = 1（当成「不是消费」），
     *   结果预算里的「已用」比实际感受少一块 —— 用户能感觉到不对劲。
     *   报销盈余是收入，本来就不进预算的分子，标记成 0 也无副作用。
     *
     * ★ 「报销到账」保持 exclude_from_budget = 1 ★
     *   它只是把钱从公司挪回自己账户（income），不是新挣的钱；
     *   预算只统计支出，对 income 那两个值本来就没有影响，
     *   这里不改是为了让「到账这一笔不参与任何预算口径」这个语义更明确。
     */
    let badDebtCents = 0
    let surplusCents = 0
    const diff = totalCents - originCents
    if (diff !== 0) {
      const isBadDebt = diff < 0
      const amount = Math.abs(diff)
      if (isBadDebt) badDebtCents = amount
      else surplusCents = amount

      await execute(
        `INSERT INTO txn (
          id, type, amount_cents, account_id, to_account_id, category_id, note,
          occurred_at, occurred_day, month_key, year_key, tz_offset,
          created_at, updated_at, deleted_at, cycle_id, via_combo_id,
          original_currency, original_amount_cents, exchange_rate,
          exclude_from_budget, exclude_from_stats, reimburse_status, batch_id
        ) VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,0,0,0,?)`,
        [
          prefixedId('txn'),
          isBadDebt ? 'expense' : 'income',
          amount,
          input.accountId,
          isBadDebt ? (cats.reimburseBadDebtId || null) : (cats.reimburseSurplusId || null),
          isBadDebt ? '报销坏账' : '报销盈余',
          keys.occurred_at, keys.occurred_day, keys.month_key, keys.year_key, keys.tz_offset,
          now, now, batchId
        ]
      )
    }

    /*
     * 3) 把这批流水标成已报销，并挂到这张单上
     *
     * ★ batch_id 一起写，不能只写单头 ★
     *   列表页是「先查单、再按 batch_id 捞明细」的，
     *   少了这一句，单头在、明细查不出来，卡片就是一张空壳。
     */
    for (const id of ids) {
      await execute(
        `UPDATE txn SET reimburse_status = ?, reimburse_day = ?, reimburse_amount_cents = ?,
           reimburse_account_id = ?, batch_id = ?, updated_at = ?
         WHERE id = ?`,
        [REIMBURSE_STATUS.DONE, day, totalCents, input.accountId, batchId, now, id]
      )
    }

    // 4) 重算报销账户余额（到账与差额都记在它上面）
    await recalcBalance(input.accountId)
    await writeTodaySnapshot(input.accountId)

    return { incomeCents: totalCents, badDebtCents, surplusCents, incomeId, batchId }
  })
}

/**
 * 老数据兜底：把「无单」的已报销流水按报销痕迹拼成报销单（纯函数，不碰库）。
 *
 * ★ 为什么要这个函数 ★
 *   v23 之前报销的流水没有 batch_id（迁移故意不回填，理由见 api/db/index.js）。
 *   它们的单头信息其实就冗余在那三列里：报销日 + 到账账户 + 实报金额。
 *   同一报销日、同一到账账户、同一实报金额的一组流水，
 *   在用户的操作里就是「一次多选报销」——按这个口径拼出来的卡片，
 *   金额和笔数都和当年那次操作一致。
 *
 * ★ 派生流水怎么归位（三条硬规则）★
 *   1. 报销到账：金额 == 单的实报金额，且同一天同一账户；
 *   2. 报销坏账 / 报销盈余：金额 == |实报 - 原支出|，且同一天同一账户；
 *   3. 对不上就不塞进来。
 *   因为没有 batch_id，只能靠金额对齐；放宽成「同一天同账户就归这张单」
 *   会把同一天两笔报销的差额错配到同一张卡上，那正是「造错单」。
 *   规则 1/2 命中不了时留一个兜底：该「日 + 账户」只有一张单时，剩下的派生流水
 *   全归它（此时不存在歧义，归错也无从谈起）。
 *
 * ★ 只读 ★
 *   不写库、不改任何流水的 batch_id —— 显示层兜底不能反过来污染数据。
 *
 * @param {Array<object>} originRows  已报销、batch_id 为空、且不是派生分类的流水
 * @param {Array<object>} derivedRows batch_id 为空的派生流水（报销到账/坏账/盈余）
 * @returns {Array<object>} 合成的报销单（结构与 listReimburseBatches 一致）
 */
export function groupLegacyReimburseBatches(originRows = [], derivedRows = []) {
  const groups = new Map()

  for (const r of originRows) {
    const day = r.reimburse_day || ''
    const accountId = r.reimburse_account_id || ''
    /*
     * ★ 实报金额缺失（v21 之前报销的老数据）要单独成键 ★
     *   那个年代的流水没有 reimburse_amount_cents，页面当时的口径是
     *   「拿原支出当实报」。如果这里直接兜成 0，它们会全部挤进
     *   「实报 0 元」这一组，卡片上写「实报 ¥0.00」——
     *   账其实早就报完了，这个 0 会让人以为钱没到账。
     *
     *   所以缺金额的用一个 'na' 段区分开，后面按「原支出合计 = 实报」兜底。
     */
    const rawDone = r.reimburse_amount_cents
    const hasDone = rawDone !== null && rawDone !== undefined
    const done = hasDone ? Number(rawDone) || 0 : 0
    /*
     * ★ 分组键里必须带「实报金额」★
     *   同一天同一账户报了两批（比如上午一批、下午一批）时，
     *   光靠「日 + 账户」会把两批合成一张单，笔数和原支出合计就错了。
     *   而实报金额不同的两批，天然被拆开。
     */
    const key = `${day}|${accountId}|${hasDone ? done : 'na'}`
    if (!groups.has(key)) {
      groups.set(key, {
        id: `legacy_${key}`,
        isLegacy: true,
        day,
        accountId,
        accountName: r.account_name || '',
        originCents: 0,
        doneCents: hasDone ? done : 0,
        hasDoneAmount: hasDone,
        txnCount: 0,
        createdAt: 0,
        items: [],
        derived: []
      })
    }
    const g = groups.get(key)
    g.items.push(normalizeTxnRow(r))
    g.originCents += Number(r.amount_cents) || 0
    g.txnCount += 1
    g.createdAt = Math.max(g.createdAt, Number(r.created_at) || 0)
  }

  for (const g of groups.values()) {
    // ★ 实报金额缺失时按「原支出全部报回」兜底（v21 之前的页面口径）★
    if (!g.hasDoneAmount) g.doneCents = g.originCents
    // 每张单的差额预算（坏账/盈余金额靠它对上）
    g.diffCents = Math.abs(g.doneCents - g.originCents)
    g.dayAccountKey = `${g.day}|${g.accountId}`
  }

  /** 「日 + 账户」→ 该组合下有几张单、分别是哪些单（判断歧义用） */
  const byDayAccount = new Map()
  for (const g of groups.values()) {
    if (!byDayAccount.has(g.dayAccountKey)) byDayAccount.set(g.dayAccountKey, [])
    byDayAccount.get(g.dayAccountKey).push(g)
  }

  /**
   * 这张单里是不是已经有同类派生流水了
   *
   * ★ 一次报销最多产生：到账 1 笔 + （坏账 或 盈余）1 笔 ★
   *   所以同类第二笔一定不是这张单的产物 ——
   *   最可能的来源是「用户手动记了一笔报销坏账」（系统分类允许手动记账），
   *   它 batch_id 也是 NULL、状态也是 0，和真正的派生流水长得一模一样。
   *   不加这道判断，那笔手动账会被塞进当天某张历史单里，
   *   看起来就是「这张单莫名其妙多了一笔坏账」。
   */
  const alreadyHas = (card, name) => card.derived.some((d) => d.category_name === name)

  /** 还没归位的派生流水（第一轮按金额精确匹配，第二轮无歧义时整体归位） */
  const pending = []
  for (const d of derivedRows) {
    const amount = Number(d.amount_cents) || 0
    const name = d.category_name || ''
    const day = d.occurred_day || ''
    const accountId = d.account_id || ''
    const candidates = byDayAccount.get(`${day}|${accountId}`) || []

    let matched = null
    if (name === REIMBURSE_CATEGORY_NAMES.income.name) {
      const hit = candidates.filter((g) => g.doneCents === amount && !alreadyHas(g, name))
      if (hit.length === 1) matched = hit[0]
    } else {
      const hit = candidates.filter((g) => g.diffCents === amount && !alreadyHas(g, name))
      if (hit.length === 1) matched = hit[0]
    }

    if (matched) matched.derived.push(normalizeTxnRow(d))
    else pending.push(d)
  }

  // 第二轮：该「日 + 账户」只有一张单时，剩下的派生流水无歧义地归它
  for (const d of pending) {
    const day = d.occurred_day || ''
    const accountId = d.account_id || ''
    const name = d.category_name || ''
    const candidates = byDayAccount.get(`${day}|${accountId}`) || []
    if (candidates.length === 1 && !alreadyHas(candidates[0], name)) {
      candidates[0].derived.push(normalizeTxnRow(d))
    }
    // 多张单且金额对不上 / 同类已经有一笔：宁可丢这条不显示，也不能塞进不确定的单
  }

  return Array.from(groups.values()).map((g) => {
    // 时间正序：原始支出 → 派生流水，和流水列表的读法一致
    const sortAsc = (a, b) => (Number(a.occurred_at) || 0) - (Number(b.occurred_at) || 0)
    const items = g.items.slice().sort(sortAsc)
    const derived = g.derived.slice().sort(sortAsc)
    const out = { ...g, items, derived, txns: items.concat(derived) }
    delete out.diffCents
    delete out.dayAccountKey
    delete out.hasDoneAmount
    return out
  })
}

/**
 * 报销单列表（已报销 tab 的数据源）。
 *
 * @param {{limit?:number, includeLegacy?:boolean}} [opt]
 * @returns {Promise<Array<object>>} 每张单：
 *   { id, isLegacy, day, accountId, accountName, originCents, doneCents, txnCount,
 *     createdAt, items,   // 被报销的原始支出（不含派生，按 occurred_at 正序）
 *     derived,            // 本单的派生流水（报销到账/坏账/盈余）
 *     txns }              // items + derived（明细全量，按 occurred_at 正序）
 */
export async function listReimburseBatches(opt = {}) {
  const { limit = 300, includeLegacy = true } = opt
  const cap = Number(limit) || 300

  /*
   * ★ 表不存在时不能让整页崩掉 ★
   *   迁移失败是不阻断开库的（见 api/db/index.js 的 migrate()），
   *   所以理论上存在「user_version 推到了 23、但 reimburse_batch 没建出来」的设备。
   *   那时这里会抛 "no such table"，整个已报销 tab 白屏 ——
   *   而用户的历史报销流水其实完好无损，只靠 legacy 兜底就能全部显示。
   *   所以查不到表就当作「还没有单」，继续走兜底分支。
   */
  let batchRows = []
  try {
    batchRows = await query(
      `SELECT b.*, a.name AS account_name
       FROM reimburse_batch b
       LEFT JOIN account a ON a.id = b.account_id
       WHERE b.deleted_at IS NULL
       ORDER BY b.day DESC, b.created_at DESC
       LIMIT ?`,
      [cap]
    )
  } catch (e) {
    console.warn('[reimburse] 报销单表不可用，改用无单兜底:', e && e.message)
    batchRows = []
  }

  /* ---------- 1) 有单的：一次查全部明细，再按 batch_id 分桶 ---------- */

  const ids = batchRows.map((b) => b.id).filter(Boolean)
  let txnsByBatch = new Map()
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',')
    const rows = await query(
      `SELECT ${TXN_SELECT}
       FROM txn t
       ${TXN_JOINS}
       WHERE t.deleted_at IS NULL AND t.batch_id IN (${placeholders})
       ORDER BY t.occurred_at ASC, t.created_at ASC`,
      ids
    )
    for (const r of rows) {
      const key = r.batch_id
      if (!txnsByBatch.has(key)) txnsByBatch.set(key, [])
      txnsByBatch.get(key).push(normalizeTxnRow(r))
    }
  }

  const batches = batchRows.map((b) => {
    const all = txnsByBatch.get(b.id) || []
    const derived = all.filter((t) => DERIVED_CATEGORY_NAMES.includes(t.category_name))
    const items = all.filter((t) => !DERIVED_CATEGORY_NAMES.includes(t.category_name))
    return {
      id: b.id,
      isLegacy: false,
      day: b.day || '',
      accountId: b.account_id || '',
      accountName: b.account_name || '',
      /*
       * ★ 单头的金额优先，但明细和单头对不上时以明细为准 ★
       *   正常不会出现。真出现了（比如用户手工改过某笔的金额），
       *   卡片上卡头和明细必须自洽 —— 否则用户点开一看「3 笔加起来不等于卡头」。
       *   单头只在没有明细时才兜底（比如明细被删光了）。
       */
      originCents: items.length > 0
        ? items.reduce((n, t) => n + t.amount_cents, 0)
        : Number(b.total_origin_cents) || 0,
      doneCents: Number(b.total_done_cents) || 0,
      txnCount: items.length > 0 ? items.length : Number(b.txn_count) || 0,
      createdAt: Number(b.created_at) || 0,
      items,
      derived,
      txns: items.concat(derived)
    }
  })

  /* ---------- 2) 无单的老数据：只读兜底 ---------- */

  let legacy = []
  if (includeLegacy) {
    const originRows = await query(
      `SELECT ${TXN_SELECT}
       FROM txn t
       ${TXN_JOINS}
       WHERE t.deleted_at IS NULL
         AND t.reimburse_status = 2
         AND t.batch_id IS NULL
       ORDER BY t.reimburse_day DESC, t.occurred_at DESC
       LIMIT ?`,
      [cap]
    )

    /*
     * 派生流水的候选：batch_id 为空、分类是三个报销派生分类。
     * ★ 必须限定 reimburse_status = 0 ★
     *   派生流水的状态就是 0；不加这个条件会把「用户手动记的一笔报销坏账」
     *   也当候选（那条也是 0，但它没有对应的报销动作）。
     *   后面还有金额精确匹配兜着，这里多一道过滤。
     */
    const derivedRows = await query(
      `SELECT ${TXN_SELECT}
       FROM txn t
       ${TXN_JOINS}
       WHERE t.deleted_at IS NULL
         AND t.batch_id IS NULL
         AND t.reimburse_status = 0
         AND c.name IN (?, ?, ?)
       ORDER BY t.occurred_at ASC
       LIMIT ?`,
      [...DERIVED_CATEGORY_NAMES, cap]
    )

    // 原始支出里要排除派生分类（理论上不会混进来，防御性过滤）
    legacy = groupLegacyReimburseBatches(
      originRows.filter((r) => !DERIVED_CATEGORY_NAMES.includes(r.category_name)),
      derivedRows
    )
  }

  /* ---------- 3) 合并排序：报销日倒序，同一天新单在前 ---------- */

  const all = batches.concat(legacy)
  all.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? 1 : -1
    return (b.createdAt || 0) - (a.createdAt || 0)
  })
  return all
}
