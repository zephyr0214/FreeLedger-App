/**
 * 借入 / 借出 —— 按「人员」聚合与手动结清
 *
 * ★ 「人员」存在哪 ★
 *   不建新表，人员就是这六类流水（借出 / 借款收回 / 借入 / 借款归还 /
 *   借出坏账 / 借出利息）的 **note**。
 *   理由：
 *     · 用户原话「备注必须是人名」，备注本来就是这一栏；
 *     · 人员不是独立实体，不需要改名/合并/归档等操作；
 *       真需要时从流水里改一次备注即可，不会出现「人员表与流水对不上」；
 *     · 少一张表 = 少一次迁移、少一处备份/导入的兼容分支。
 *   代价是「张三」和「张三 」算两个人，所以写入前统一 trim。
 *
 * ★ 为什么按人员分组而不是按流水列出 ★
 *   用户要看的是「谁欠我多少」，不是「我借过几次」。
 *   按人员分组后，一个人名下一行数字 = Σ借出 - Σ收回，
 *   这个数字直接就是结论。
 *
 * ★ 平衡就自动算已结清，不做「结清」状态字段 ★
 *   状态字段会和流水打架：用户补记一笔或者删一笔之后，
 *   状态字段不会自己变，界面就会显示「已结清但余额 300」。
 *   直接从流水算余额是唯一不会自相矛盾的口径。
 */

import { query, queryOne } from './db/index.js'
import { ensurePresetCategories, listCategories } from './category.js'
import { createTransaction } from './transaction.js'
import { toDayKey } from '../utils/date.js'

/** 借出 / 借入两个方向 */
export const LOAN_DIRECTIONS = { lend: 'lend', borrow: 'borrow' }

/**
 * 六个分类的名字（按方向配对）
 *
 * 前四个是正常的借款流水；后两个是「手动结清」自动写的派生分类
 * （hidden，用户/ AI 都选不到，只能由本模块写入）。
 */
export const LOAN_CATEGORY_NAME_LIST = [
  '借出', '借款收回', '借入', '借款归还', '借出坏账', '借出利息'
]

/**
 * 某个分类名是不是「借入借出」那六类之一。
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
 * 「借入 / 借出」这类**可以先手输新人名**的分类。
 *
 * 借款归还 / 借款收回必须是已经存在的人（还的是之前那笔借的），
 * 但借出 / 借入随时可能是第一次和某人打交道，所以允许新名字。
 *
 * @param {string} name
 */
export function allowsNewPerson(name) {
  return name === '借出' || name === '借入' || name === '借出坏账' || name === '借出利息'
}

const NAMES = {
  lendOut: '借出',      // expense
  lendBack: '借款收回',  // income
  borrowIn: '借入',      // income
  borrowBack: '借款归还', // expense
  badDebt: '借出坏账',   // expense（hidden）
  interest: '借出利息'   // income（hidden）
}

/**
 * 取六个分类的 id（幂等，分类不存在会自动补建）。
 *
 * @returns {Promise<{lendOutId:string, lendBackId:string, borrowInId:string,
 *   borrowBackId:string, badDebtId:string, interestId:string}>}
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
        interestId: all.interestId
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
    borrowInId: pick(incomeList, NAMES.borrowIn),
    lendBackId: pick(incomeList, NAMES.lendBack),
    interestId: pick(incomeList, NAMES.interest)
  }
}

/**
 * 某个方向下的两个分类（主方向 + 反向）。
 *
 *   借出页：借出（expense，钱出去） / 借款收回（income，钱回来）
 *   借入页：借入（income，钱进来） / 借款归还（expense，钱出去）
 *
 * @param {'lend'|'borrow'} direction
 */
function pairOf(direction, ids) {
  return direction === LOAN_DIRECTIONS.borrow
    ? { mainId: ids.borrowInId, backId: ids.borrowBackId, mainType: 'income', backType: 'expense' }
    : { mainId: ids.lendOutId, backId: ids.lendBackId, mainType: 'expense', backType: 'income' }
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
 * @param {'lend'|'borrow'} direction
 * @param {'open'|'settled'|'all'} status 未结清 / 已结清 / 全部
 * @returns {Promise<Array<{person:string, total:number, back:number, balance:number,
 *   count:number, lastDay:string, settled:boolean}>>}
 *   balance = 主方向合计 - 反向合计（正 = 对方还欠我）。
 *   settled = balance 恰好为 0（有借有还、正好平账）。
 */
export async function listLoanByPerson(direction, status = 'all') {
  const ids = await resolveLoanCategoryIds()
  const { mainId, backId } = pairOf(direction, ids)
  if (!mainId && !backId) return []

  /*
   * ★ 一次 SQL 聚合完 ★
   *   GROUP BY note + 两段条件求和，比「先查全部再在 JS 里分组」省一次
   *   全表扫描，也让排序（按金额）能在 SQL 里做。
   *
   * ★ 排除空备注 ★
   *   历史上（v19 之前）允许借出/借入不写备注，那批流水没有人员，
   *   分组会挤出一个空名字的行，点进去也没有意义。
   *   这里直接过滤掉 —— 老数据仍在流水列表里能查到，只是不进本页统计。
   */
  /*
   * ★ 结清产生的两笔也要参与余额 ★
   *   「借出坏账」等价于「这 300 收不回来了、从应收里核销」，
   *   「借出利息」等价于「多还的 100 已经作为收益确认」。
   *   所以：
   *     余额 = 借出 - 借款收回 - 借出坏账 + 借出利息
   *   结清之后两者相抵恰好归零，这个人自动落到「已结清」。
   *   少了这两项，结清过的行会一直挂在「未结清」上 ——
   *   因为坏账/利息根本不在上面两个分类里。
   */
  //   只有借出方向有坏账/利息；借入方向传空 id，SUM 恒为 0。
  const badDebtId = direction === LOAN_DIRECTIONS.lend ? (ids.badDebtId || '') : ''
  const interestId = direction === LOAN_DIRECTIONS.lend ? (ids.interestId || '') : ''

  const rows = await query(
    `SELECT TRIM(note) AS person,
            SUM(CASE WHEN category_id = ? THEN amount_cents ELSE 0 END) AS total,
            SUM(CASE WHEN category_id = ? THEN amount_cents ELSE 0 END) AS back,
            SUM(CASE WHEN category_id = ? THEN amount_cents ELSE 0 END) AS bad,
            SUM(CASE WHEN category_id = ? THEN amount_cents ELSE 0 END) AS interest,
            COUNT(*) AS cnt,
            MAX(occurred_day) AS last_day
     FROM txn
     WHERE deleted_at IS NULL
       AND note IS NOT NULL AND TRIM(note) != ''
       AND category_id IN (?, ?, ?, ?)
     GROUP BY TRIM(note)`,
    [
      mainId || '', backId || '', badDebtId, interestId,
      mainId || '', backId || '', badDebtId, interestId
    ]
  )

  const list = rows.map((r) => {
    const total = Number(r.total) || 0
    const back = Number(r.back) || 0
    const bad = Number(r.bad) || 0
    const interest = Number(r.interest) || 0
    const balance = total - back - bad + interest
    return {
      person: r.person,
      total,
      back,
      bad,
      interest,
      balance,
      count: Number(r.cnt) || 0,
      lastDay: r.last_day ? String(r.last_day) : '',
      settled: balance === 0
    }
  })

  // ★ 排序：未结清在前、金额大的在前 ★
  //   用户要的是「谁欠我最多」，所以按 |balance| 降序（借出为正、借入为负都适用）。
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
 * ★ 六个分类全收 ★
 *   包括「借出坏账 / 借出利息」—— 那两笔的备注也是人名，
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
 * 某个人在某个方向下的流水（点开人员行看明细用）。
 *
 * @param {'lend'|'borrow'} direction
 * @param {string} person 人员名
 * @param {number} limit
 */
export async function listLoanTxnsOfPerson(direction, person, limit = 50) {
  const ids = await resolveLoanCategoryIds()
  const { mainId, backId } = pairOf(direction, ids)
  const catIds = [mainId, backId, ids.badDebtId, ids.interestId].filter(Boolean)
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
 * 找某个人最近一笔某个分类的账户。
 *
 * 用户要求：
 *   · 借出坏账的账户与「借出」一致 —— 坏账是从当初借出的账户核销掉的；
 *   · 借出利息的账户与「归还」一致 —— 利息是回到收钱的那个账户里。
 * 找不到时回落到另一个方向，最后回落到默认账户。
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
 * 手动结清某个人（借出方向）。
 *
 * ★ 不输入金额，差额自动算 ★
 *   余额 = Σ借出 - Σ借款收回：
 *     · 余额 > 0（对方少还）→ 记一笔支出「借出坏账」，金额 = 余额
 *     · 余额 < 0（对方多还）→ 记一笔收入「借出利息」，金额 = -余额
 *   这样结清之后，这个人的 借出 - 收回 恰好归零，自动落到「已结清」。
 *
 * ★ 这两笔要计入收支 ★
 *   坏账是真实损失、利息是真实收益，用户明确要求计入。
 *   所以 exclude_from_stats = 0；但 exclude_from_budget = 1 ——
 *   它们不是消费，不该占用月预算额度。
 *
 * ★ 账户跟着原流水走 ★
 *   见 accountOfLastTxn 的注释。找不到原流水时抛错，
 *   让用户知道「这笔借款没有账户信息，结清不了」，而不是瞎记账。
 *
 * @param {string} person 人员名
 * @returns {Promise<{created:object|null, balance:number, kind:'badDebt'|'interest'|'none'}>}
 */
export async function settleLendPerson(person) {
  const name = normalizePerson(person)
  if (!name) throw new Error('人员不能为空')

  const ids = await resolveLoanCategoryIds()
  const pair = pairOf(LOAN_DIRECTIONS.lend, ids)

  const row = await queryOne(
    `SELECT
       SUM(CASE WHEN category_id = ? THEN amount_cents ELSE 0 END) AS total,
       SUM(CASE WHEN category_id = ? THEN amount_cents ELSE 0 END) AS back,
       SUM(CASE WHEN category_id = ? THEN amount_cents ELSE 0 END) AS bad,
       SUM(CASE WHEN category_id = ? THEN amount_cents ELSE 0 END) AS interest
     FROM txn
     WHERE deleted_at IS NULL AND TRIM(note) = ?
       AND category_id IN (?, ?, ?, ?)`,
    [
      pair.mainId || '', pair.backId || '', ids.badDebtId || '', ids.interestId || '',
      name,
      pair.mainId || '', pair.backId || '', ids.badDebtId || '', ids.interestId || ''
    ]
  )
  const total = Number(row ? row.total : 0) || 0
  const back = Number(row ? row.back : 0) || 0
  const bad = Number(row ? row.bad : 0) || 0
  const interest = Number(row ? row.interest : 0) || 0
  // 余额口径与 listLoanByPerson 完全一致（含已结清的两笔），否则「结清」按钮会一直亮着
  const balance = total - back - bad + interest

  if (balance === 0) return { created: null, balance: 0, kind: 'none' }

  const isBadDebt = balance > 0
  const amount = Math.abs(balance)
  const categoryId = isBadDebt ? ids.badDebtId : ids.interestId
  if (!categoryId) throw new Error('结清分类缺失，请重启应用后重试')

  // 坏账跟着「借出」的账户；利息跟着「借款收回」的账户
  const accountId = await accountOfLastTxn(name, isBadDebt ? 'main' : 'back', pair)
  if (!accountId) throw new Error('没找到这笔借款的账户，无法结清')

  const now = new Date()
  const created = await createTransaction({
    type: isBadDebt ? 'expense' : 'income',
    amount_cents: amount,
    account_id: accountId,
    category_id: categoryId,
    // ★ 备注就是人员名 ★
    //   结清这两笔也必须带人名：管理页按 note 分组，
    //   不带的话这笔会掉进「空人员」那一堆里，用户看不到钱去哪了。
    note: name,
    occurred_day: toDayKey(now),
    occurred_at: now.getTime(),
    // 计入收支、不占预算
    exclude_from_stats: false,
    exclude_from_budget: true,
    tag_ids: []
  })

  return { created, balance, kind: isBadDebt ? 'badDebt' : 'interest' }
}
