/**
 * 借入 / 借出 —— 按「人员」聚合与手动结清
 *
 * ★ 「人员」存在哪 ★
 *   不建新表，人员就是这八类流水（借出 / 借款收回 / 借入 / 借款归还 /
 *   借出坏账 / 借出利息 / 借入未还 / 借入利息）的 **note**。
 *   理由：
 *     · 用户原话「备注必须是人名」，备注本来就是这一栏；
 *     · 人员不是独立实体，不需要改名/合并/归档等操作；
 *       真需要时从流水里改一次备注即可，不会出现「人员表与流水对不上」；
 *     · 少一张表 = 少一次迁移、少一处备份/导入的兼容分支。
 *   代价是「张三」和「张三 」算两个人，所以写入前统一 trim。
 *
 * ★ 为什么按人员分组而不是按流水列出 ★
 *   用户要看的是「谁欠我多少」，不是「我借过几次」。
 *   按人员分组后，一个人名下一行数字 = Σ主方向 - Σ反向，
 *   这个数字直接就是结论。
 *
 * ★ 平衡就自动算已结清，不做「结清」状态字段 ★
 *   状态字段会和流水打架：用户补记一笔或者删一笔之后，
 *   状态字段不会自己变，界面就会显示「已结清但余额 300」。
 *   直接从流水算余额是唯一不会自相矛盾的口径。
 *
 * ★ 借出 / 借入两个方向完全对称 ★
 *   同一个函数服务两个页面，方向差异全部收敛在 pairOf() 里：
 *     借出：主=借出(expense)  反=借款收回(income)  正差→借出坏账  负差→借出利息
 *     借入：主=借入(income)   反=借款归还(expense) 正差→借入未还  负差→借入利息
 *   页面上除了文案和方向，逻辑一字不差 —— 用户要求「两个页面逻辑基本一致化」。
 */

import { query, queryOne } from './db/index.js'
import { ensurePresetCategories, listCategories } from './category.js'
import { createTransaction } from './transaction.js'
import { toDayKey } from '../utils/date.js'

/** 借出 / 借入两个方向 */
export const LOAN_DIRECTIONS = { lend: 'lend', borrow: 'borrow' }

/**
 * 八个分类的名字（四类流水 + 四个结清派生分类）
 *
 * 后四个是「手动结清」自动写的（hidden，用户 / AI 都选不到，只有本模块写入）。
 */
export const LOAN_CATEGORY_NAME_LIST = [
  '借出', '借款收回', '借入', '借款归还',
  '借出坏账', '借出利息', '借入未还', '借入利息'
]

/**
 * 某个分类名是不是「借入借出」那八类之一。
 *
 * 记账面板用它决定：备注要不要变成「人员」、要不要强制必填、
 * 这笔要不要默认不计入收支。
 *
 * ★ 按名字判断而不是按 id ★
 *   面板拿到的是分类对象（含 name），而 id 会因为「用户删掉分类后
 *   系统重建」而变化 —— 名字才是稳定的语义。
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isLoanPersonCategory(name) {
  return LOAN_CATEGORY_NAME_LIST.includes(String(name || ''))
}

/**
 * 「借出 / 借入」这类**可以先手输新人名**的分类。
 *
 * 借款归还 / 借款收回必须是已经存在的人（还的是之前那笔借的），
 * 其余几类随时可能是第一次和某人打交道，允许新名字。
 *
 * @param {string} name
 */
export function allowsNewPerson(name) {
  return !['借款归还', '借款收回'].includes(String(name || ''))
}

/**
 * 这四类结清派生分类必须「计入收支」。
 *
 * ★ 为什么要单独判定 ★
 *   前面四类正常借款流水是「资金往来」→ 不计收支；
 *   而结清派生分类是「真实损益」→ 必须计入收支。
 *   两者在记账面板里长的位置不一样（派生分类 hidden，面板选不到），
 *   但 AI 记账、导入、结清逻辑都会碰到，所以给一个显式判定。
 *
 * @param {string} name
 */
export function isLoanSettleCategory(name) {
  return ['借出坏账', '借出利息', '借入未还', '借入利息'].includes(String(name || ''))
}

const NAMES = {
  lendOut: '借出',          // expense
  lendBack: '借款收回',      // income
  borrowIn: '借入',          // income
  borrowBack: '借款归还',     // expense
  badDebt: '借出坏账',       // expense（hidden）我的损失
  lendInterest: '借出利息',   // income （hidden）我的收益
  borrowWaived: '借入未还',   // income （hidden）债务被勾销 = 我的收益
  borrowInterest: '借入利息'  // expense（hidden）多付的利息 = 我的损失
}

/**
 * 取八个分类的 id（幂等，分类不存在会自动补建）。
 *
 * @returns {Promise<{lendOutId:string, lendBackId:string, borrowInId:string,
 *   borrowBackId:string, badDebtId:string, interestId:string,
 *   borrowWaivedId:string, borrowInterestId:string}>}
 */
export async function resolveLoanCategoryIds() {
  try {
    const all = await ensurePresetCategories()
    if (all.lendOutId && all.borrowInId) {
      return {
        lendOutId: all.lendOutId,
        lendBackId: all.lendBackId,
        borrowInId: all.borrowInId,
        borrowBackId: all.borrowBackId,
        badDebtId: all.badDebtId,
        interestId: all.interestId,
        borrowWaivedId: all.borrowWaivedId,
        borrowInterestId: all.borrowInterestId
      }
    }
  } catch (e) {
    console.warn('[loan] ensurePresetCategories 失败，改为按名称查找:', e && e.message)
  }

  // 兜底：按名字在分类表里找（不区分层级）
  const [expenseList, incomeList] = await Promise.all([
    listCategories('expense', true),
    listCategories('income', true)
  ])
  const pick = (list, name) => {
    const hit = list.find((c) => c.name === name)
    return hit ? hit.id : ''
  }
  return {
    lendOutId: pick(expenseList, NAMES.lendOut),
    borrowBackId: pick(expenseList, NAMES.borrowBack),
    badDebtId: pick(expenseList, NAMES.badDebt),
    borrowInterestId: pick(expenseList, NAMES.borrowInterest),
    borrowInId: pick(incomeList, NAMES.borrowIn),
    lendBackId: pick(incomeList, NAMES.lendBack),
    interestId: pick(incomeList, NAMES.lendInterest),
    borrowWaivedId: pick(incomeList, NAMES.borrowWaived)
  }
}

/**
 * 某个方向下的四个分类（主 / 反 / 两个结清分类）。
 *
 *   借出页：借出(expense) / 借款收回(income) / 借出坏账(expense) / 借出利息(income)
 *   借入页：借入(income)  / 借款归还(expense) / 借入未还(income)  / 借入利息(expense)
 *
 * ★ 结清分类的 type 跟「经济意义」走，不跟名字方向走 ★
 *   借出坏账 = 我的损失 = expense；借入未还 = 我的收益 = income。
 *   如果按名字字面把「借入未还」当支出，统计页会出现
 *   「债务被免除了，本月支出反而增加」这种反直觉结果。
 *
 * @param {'lend'|'borrow'} direction
 */
function pairOf(direction, ids) {
  if (direction === LOAN_DIRECTIONS.borrow) {
    return {
      mainId: ids.borrowInId,
      backId: ids.borrowBackId,
      mainType: 'income',
      backType: 'expense',
      /** 差额为正（我还欠对方）时用来核销的分类 */
      positiveId: ids.borrowWaivedId,
      positiveType: 'income',
      positiveName: NAMES.borrowWaived,
      /** 差额为负（我还多了）时用来记利息的分类 */
      negativeId: ids.borrowInterestId,
      negativeType: 'expense',
      negativeName: NAMES.borrowInterest
    }
  }
  return {
    mainId: ids.lendOutId,
    backId: ids.lendBackId,
    mainType: 'expense',
    backType: 'income',
    positiveId: ids.badDebtId,
    positiveType: 'expense',
    positiveName: NAMES.badDebt,
    negativeId: ids.interestId,
    negativeType: 'income',
    negativeName: NAMES.lendInterest
  }
}

/**
 * 人员名归一化。
 *
 * ★ 必须 trim ★
 *   「张三」和「张三 」在 SQL 里是两个人，分组会裂成两行。
 *   全角空格也要处理 —— 中文输入法很容易带出来。
 */
function normalizePerson(note) {
  return String(note || '').replace(/[\s\u3000]+/g, ' ').trim()
}

/**
 * 按人员聚合某个方向的借款。
 *
 * ★ 余额公式（两个方向共用）★
 *     balance = 主方向 - 反向 - positive + negative
 *   其中 positive / negative 就是点「手动结清」时写入的那两笔。
 *   结清之后正负相抵恰好归零，这个人自动落到「已结清」。
 *   少了这两项，结清过的行会一直挂在「未结清」上。
 *
 * @param {'lend'|'borrow'} direction
 * @param {'open'|'settled'|'all'} status 未结清 / 已结清 / 全部
 * @returns {Promise<Array<{person:string, total:number, back:number, balance:number,
 *   count:number, lastDay:string, settled:boolean}>>}
 */
export async function listLoanByPerson(direction, status = 'all') {
  const ids = await resolveLoanCategoryIds()
  const pair = pairOf(direction, ids)
  if (!pair.mainId && !pair.backId) return []

  /*
   * ★ 一次 SQL 聚合完 ★
   *   GROUP BY note + 四段条件求和，比「先查全部再在 JS 里分组」省一次
   *   全表扫描，也让排序（按金额）能在 SQL 里做。
   *
   * ★ 排除空备注 ★
   *   历史上（v19 之前）允许借出/借入不写备注，那批流水没有人员，
   *   分组会挤出一个空名字的行，点进去也没有意义。
   *   这里直接过滤掉 —— 老数据仍在流水列表里能查到，只是不进本页统计。
   */
  const catIds = [pair.mainId, pair.backId, pair.positiveId, pair.negativeId].map((x) => x || '')
  const rows = await query(
    `SELECT TRIM(note) AS person,
            SUM(CASE WHEN category_id = ? THEN amount_cents ELSE 0 END) AS total,
            SUM(CASE WHEN category_id = ? THEN amount_cents ELSE 0 END) AS back,
            SUM(CASE WHEN category_id = ? THEN amount_cents ELSE 0 END) AS pos,
            SUM(CASE WHEN category_id = ? THEN amount_cents ELSE 0 END) AS neg,
            COUNT(*) AS cnt,
            MAX(occurred_day) AS last_day
     FROM txn
     WHERE deleted_at IS NULL
       AND note IS NOT NULL AND TRIM(note) != ''
       AND category_id IN (?, ?, ?, ?)
     GROUP BY TRIM(note)`,
    [...catIds, ...catIds]
  )

  const list = rows.map((r) => {
    const total = Number(r.total) || 0
    const back = Number(r.back) || 0
    const pos = Number(r.pos) || 0
    const neg = Number(r.neg) || 0
    const balance = total - back - pos + neg
    return {
      person: r.person,
      total,
      back,
      balance,
      count: Number(r.cnt) || 0,
      lastDay: r.last_day ? String(r.last_day) : '',
      settled: balance === 0
    }
  })

  // ★ 排序：未结清在前、金额大的在前 ★
  //   用户要的是「谁欠我最多 / 我欠谁最多」，所以按 |balance| 降序。
  list.sort((a, b) => {
    if (a.settled !== b.settled) return a.settled ? 1 : -1
    return Math.abs(b.balance) - Math.abs(a.balance)
  })

  if (status === 'settled') return list.filter((x) => x.settled)
  if (status === 'open') return list.filter((x) => !x.settled)
  return list
}

/**
 * 所有出现过的人员（供记账面板「人员」选择、以及匹配识别用）。
 *
 * ★ 八个分类全收 ★
 *   包括四个结清派生分类 —— 那几笔的备注也是人名，
 *   收进来才能保证「结清过的人」下次仍然能被选到。
 *
 * @returns {Promise<string[]>} 人员名，按最近发生排序（最近打过交道的在前）
 */
export async function listLoanPeople() {
  const ids = await resolveLoanCategoryIds()
  const catIds = Object.values(ids).filter(Boolean)
  if (catIds.length === 0) return []

  const rows = await query(
    `SELECT TRIM(note) AS person, MAX(occurred_day) AS last_day, COUNT(*) AS cnt
     FROM txn
     WHERE deleted_at IS NULL
       AND note IS NOT NULL AND TRIM(note) != ''
       AND category_id IN (${catIds.map(() => '?').join(',')})
     GROUP BY TRIM(note)
     ORDER BY last_day DESC, cnt DESC`,
    catIds
  )
  return rows.map((r) => normalizePerson(r.person)).filter(Boolean)
}

/**
 * 某个人在某个方向下的流水（页面里展开人员后罗列的明细）。
 *
 * @param {'lend'|'borrow'} direction
 * @param {string} person 人员名
 * @param {number} limit
 */
export async function listLoanTxnsOfPerson(direction, person, limit = 50) {
  const ids = await resolveLoanCategoryIds()
  const pair = pairOf(direction, ids)
  const catIds = [pair.mainId, pair.backId, pair.positiveId, pair.negativeId].filter(Boolean)
  if (catIds.length === 0) return []

  return query(
    `SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            a.name AS account_name
     FROM txn t
     LEFT JOIN category c ON c.id = t.category_id
     LEFT JOIN account  a ON a.id = t.account_id
     WHERE t.deleted_at IS NULL
       AND TRIM(t.note) = ?
       AND t.category_id IN (${catIds.map(() => '?').join(',')})
     ORDER BY t.occurred_at DESC, t.created_at DESC
     LIMIT ?`,
    [normalizePerson(person), ...catIds, Number(limit) || 50]
  )
}

/**
 * 按人员分组，并把每个人的流水一起带回来（页面直接渲染用）。
 *
 * ★ 与 listLoanByPerson 的区别 ★
 *   listLoanByPerson 只出汇总（一个人一行数字）；
 *   这个函数多带一份 `txns`，因为页面上每个人下面要罗列他自己那几笔。
 *
 * ★ 为什么一次查完全部、在 JS 里分组 ★
 *   按人员 N 条 SQL 会变成 N+1 查询（人一多就是几十次往返）。
 *   这里一条 SQL 取全部相关流水（一个人一辈子也就几十笔），
 *   JS 分组是内存操作，快得多，而且「汇总」和「明细」用的是同一份数据 ——
 *   不会出现「组头写欠 300、下面三笔加起来 250」这种自相矛盾。
 *
 * @param {'lend'|'borrow'} direction
 * @param {'open'|'settled'|'all'} status
 * @returns {Promise<Array<{person:string, total:number, back:number, balance:number,
 *   count:number, lastDay:string, settled:boolean, txns:Array<object>}>>}
 */
export async function listLoanGroups(direction, status = 'all') {
  const ids = await resolveLoanCategoryIds()
  const pair = pairOf(direction, ids)
  const catIds = [pair.mainId, pair.backId, pair.positiveId, pair.negativeId].filter(Boolean)
  if (catIds.length === 0) return []

  const rows = await query(
    `SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            a.name AS account_name
     FROM txn t
     LEFT JOIN category c ON c.id = t.category_id
     LEFT JOIN account  a ON a.id = t.account_id
     WHERE t.deleted_at IS NULL
       AND t.note IS NOT NULL AND TRIM(t.note) != ''
       AND t.category_id IN (${catIds.map(() => '?').join(',')})
     ORDER BY t.occurred_at DESC, t.created_at DESC`,
    catIds
  )

  /*
   * 分组 + 汇总
   *
   * ★ 汇总口径必须与 listLoanByPerson 完全一致 ★
   *   两边都用 balance = 主 - 反 - pos + neg，否则
   *   页面上「组头显示的余额」和「结算后是否归零」会对不上。
   */
  const map = new Map()
  for (const r of rows) {
    const person = normalizePerson(r.note)
    if (!person) continue
    if (!map.has(person)) {
      map.set(person, {
        person,
        total: 0,
        back: 0,
        balance: 0,
        count: 0,
        lastDay: '',
        settled: false,
        txns: []
      })
    }
    const g = map.get(person)
    const amt = Number(r.amount_cents) || 0
    if (r.category_id === pair.mainId) g.total += amt
    else if (r.category_id === pair.backId) g.back += amt
    else if (r.category_id === pair.positiveId) g.total -= amt
    else if (r.category_id === pair.negativeId) g.total += amt
    g.count++
    if (!g.lastDay || String(r.occurred_day) > g.lastDay) g.lastDay = String(r.occurred_day)
    g.txns.push(r)
  }

  const list = Array.from(map.values())
  for (const g of list) {
    // 上面已经在累加时把四个分类折进 total/back，这里统一算一次，避免两处公式
    g.balance = g.total - g.back
    g.settled = g.balance === 0
  }

  list.sort((a, b) => {
    if (a.settled !== b.settled) return a.settled ? 1 : -1
    return Math.abs(b.balance) - Math.abs(a.balance)
  })

  if (status === 'settled') return list.filter((x) => x.settled)
  if (status === 'open') return list.filter((x) => !x.settled)
  return list
}

/**
 * 找某个人最近一笔某个分类的账户。
 *
 * 结清那两笔的账户必须和原流水一致，否则账户余额对不上现实：
 *   · 借出方向正差（坏账）→ 跟着「借出」的账户
 *   · 借出方向负差（利息）→ 跟着「借款收回」的账户
 *   · 借入方向正差（未还）→ 跟着「借入」的账户
 *   · 借入方向负差（利息）→ 跟着「借款归还」的账户
 *
 * @param {string} person
 * @param {'main'|'back'} which
 * @param {{mainId:string, backId:string}} pair
 * @returns {Promise<string>} account_id，找不到返回空串
 */
async function accountOfLastTxn(person, which, pair) {
  const order = which === 'back' ? [pair.backId, pair.mainId] : [pair.mainId, pair.backId]
  for (const catId of order) {
    if (!catId) continue
    const row = await queryOne(
      `SELECT account_id FROM txn
       WHERE deleted_at IS NULL AND category_id = ? AND TRIM(note) = ?
       ORDER BY occurred_at DESC, created_at DESC LIMIT 1`,
      [catId, normalizePerson(person)]
    )
    if (row && row.account_id) return row.account_id
  }
  return ''
}

/**
 * 手动结清某个人（借出 / 借入两个方向共用）。
 *
 * ★ 不输入金额，差额自动算 ★
 *   余额 = 主 - 反 - positive + negative（与 listLoanByPerson 逐字一致）。
 *   余额恰好为 0 直接返回 kind='none'，不写任何流水。
 *
 * ★ 差额为正 / 为负分别记什么 ★
 *     借出方向（对方欠我）
 *       余额 > 0（少还）→ 支出「借出坏账」  我的损失
 *       余额 < 0（多还）→ 收入「借出利息」  我的收益
 *     借入方向（我欠对方）
 *       余额 > 0（还不齐）→ 收入「借入未还」 债务被勾销 = 我的收益
 *       余额 < 0（还多了）→ 支出「借入利息」 多付的利息 = 我的损失
 *   记完之后余额精确归零，自动落到「已结清」。
 *
 * ★ 这两笔要计入收支 ★
 *   坏账/未还/利息都是真实损益。所以 exclude_from_stats = 0；
 *   但 exclude_from_budget = 1 —— 它们不是消费，不该占用月预算额度。
 *
 * @param {string} person 人员名
 * @param {'lend'|'borrow'} direction 方向
 * @returns {Promise<{created:object|null, balance:number,
 *   kind:'positive'|'negative'|'none', categoryName:string, type:string}>}
 */
export async function settleLoanPerson(person, direction = LOAN_DIRECTIONS.lend) {
  const name = normalizePerson(person)
  if (!name) throw new Error('人员不能为空')

  const ids = await resolveLoanCategoryIds()
  const pair = pairOf(direction, ids)

  const catIds = [pair.mainId, pair.backId, pair.positiveId, pair.negativeId].map((x) => x || '')
  const row = await queryOne(
    `SELECT
       SUM(CASE WHEN category_id = ? THEN amount_cents ELSE 0 END) AS total,
       SUM(CASE WHEN category_id = ? THEN amount_cents ELSE 0 END) AS back,
       SUM(CASE WHEN category_id = ? THEN amount_cents ELSE 0 END) AS pos,
       SUM(CASE WHEN category_id = ? THEN amount_cents ELSE 0 END) AS neg
     FROM txn
     WHERE deleted_at IS NULL AND TRIM(note) = ?
       AND category_id IN (?, ?, ?, ?)`,
    [...catIds, name, ...catIds]
  )
  const total = Number(row ? row.total : 0) || 0
  const back = Number(row ? row.back : 0) || 0
  const pos = Number(row ? row.pos : 0) || 0
  const neg = Number(row ? row.neg : 0) || 0
  const balance = total - back - pos + neg

  if (balance === 0) {
    return { created: null, balance: 0, kind: 'none', categoryName: '', type: '' }
  }

  const isPositive = balance > 0
  const amount = Math.abs(balance)
  const categoryId = isPositive ? pair.positiveId : pair.negativeId
  const categoryName = isPositive ? pair.positiveName : pair.negativeName
  const type = isPositive ? pair.positiveType : pair.negativeType
  if (!categoryId) throw new Error('结清分类缺失，请重启应用后重试')

  // isPositive 都对应「主方向」的账户，负差对应「反向」的账户
  const accountId = await accountOfLastTxn(name, isPositive ? 'main' : 'back', pair)
  if (!accountId) throw new Error('没找到这笔借款的账户，无法结清')

  const now = new Date()
  const created = await createTransaction({
    type,
    amount_cents: amount,
    account_id: accountId,
    category_id: categoryId,
    // ★ 备注就是人员名 ★
    //   管理页按 note 分组，不带的话这笔会掉进「空人员」那一堆里。
    note: name,
    occurred_day: toDayKey(now),
    occurred_at: now.getTime(),
    // 计入收支、不占预算
    exclude_from_stats: false,
    exclude_from_budget: true,
    tag_ids: []
  })

  return {
    created,
    balance,
    kind: isPositive ? 'positive' : 'negative',
    categoryName,
    type
  }
}

/**
 * 兼容旧名（v19 第一版叫 settleLendPerson，只支持借出方向）。
 *
 * @deprecated 用 settleLoanPerson(person, direction)
 */
export async function settleLendPerson(person) {
  return settleLoanPerson(person, LOAN_DIRECTIONS.lend)
}
