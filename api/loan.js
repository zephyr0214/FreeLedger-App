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
 * 这个分类名是不是「借出 / 借入」**本金**。
 *
 * ★ 为什么需要这个判定（用户本轮第 2 条前半）★
 *   用户原话：「只借入和借出的删除线，其他和借入/借出有关的不用删除线」。
 *   上一轮偷懒，只要 `ep.settled` 就把**段内每一笔**金额都划了删除线 ——
 *   于是「借款收回 / 借款归还 / 借出坏账 / 借出利息 / 借入未还 / 借入利息」
 *   全被划掉。可那几笔恰恰是**让账平掉的原因**：
 *   借款收回到账了、坏账核销了、利息记上了，它们是结清的证据，
 *   划掉它们等于在说「这几笔不作数」，读起来自相矛盾。
 *   只有本金那两笔（借出 / 借入）代表「当时真正借出去 / 借进来的钱」，
 *   结清之后它才不该再算进「当前借出 / 当前借入」，需要划掉。
 *
 * ★ 按名字判断而不是按 id ★
 *   与 isLoanPersonCategory 同一个理由：分类 id 会随「用户删掉分类后
 *   系统重建」和「备份导入到另一台设备」而变化，名字才是稳定的语义。
 *   删除线是纯展示判断，更不该依赖库里的 id。
 *
 * ★ 为什么写成两个显式字面量，而不是取 LOAN_CATEGORY_NAME_LIST 的子集 ★
 *   那个数组是「业务名单」（八类都算借款流水），这里要的是「本金」这个
 *   更窄的展示口径。直接拍在明面上，以后有人要改名单时能一眼看见
 *   这里还有一处独立的判断，不会顺手带错。
 *
 * @param {string} name 分类名（txn.category_name）
 * @returns {boolean}
 */
export function isLoanPrincipalCategory(name) {
  const n = String(name || '')
  return n === NAMES.lendOut || n === NAMES.borrowIn
}

/**
 * 把 SQL 里 GROUP_CONCAT 出来的 tag_ids 转成数组。
 *
 * ★ 为什么必须在这一层转 ★
 *   `SELECT ... GROUP_CONCAT(tt.tag_id) AS tag_ids` 出来的是 `"tag_a,tag_b"`
 *   这样的**字符串**，而 utils/txnBadges.js 的 buildTxnBadges 需要数组，
 *   逐个 id 去 tagMap 里反查标签名 —— 直接把字符串传过去，它会按字符拆，
 *   一个标签徽标都出不来（而且不报错，只是默默没有标签）。
 *   api/transaction.js 的 normalizeTxn 里也是同一个口径（split(',') 再 filter），
 *   抄同一份实现是为了「同一笔账在哪个页面都拿到同一种 tag_ids」。
 *
 * @param {string|string[]|null|undefined} raw
 * @returns {string[]}
 */
function splitTagIds(raw) {
  if (Array.isArray(raw)) return raw
  if (!raw) return []
  return String(raw).split(',').filter(Boolean)
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

  const rows = await query(
    `SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            a.name AS account_name,
            (SELECT GROUP_CONCAT(tt.tag_id) FROM txn_tag tt WHERE tt.txn_id = t.id) AS tag_ids
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
  /*
   * ★ tag_ids 在 API 层就转成数组 ★
   *   页面只负责 buildTxnBadges(t) 渲染，不该知道「库里是 GROUP_CONCAT 字符串」。
   *   与 api/transaction.js 的 normalizeTxn 同一口径（见 splitTagIds 注释）。
   */
  return rows.map((r) => ({ ...r, tag_ids: splitTagIds(r.tag_ids) }))
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
            a.name AS account_name,
            (SELECT GROUP_CONCAT(tt.tag_id) FROM txn_tag tt WHERE tt.txn_id = t.id) AS tag_ids
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
    /*
     * ★ 明细行里带出 tag_ids（本轮：借入借出页每笔流水都要显示用户标签徽标）★
     *   库里那条 SQL 用 GROUP_CONCAT 拼的是 `"tag_a,tag_b"` 字符串，
     *   而 utils/txnBadges.js 的 buildTxnBadges 按数组遍历 ——
     *   这里就地转成数组，页面拿到的东西和 api/transaction.js 的流水行同形。
     *   放在「进分组」这一刻转，而不是渲染时转：
     *   页面每帧都在渲染几十行，能省一次 split 就省一次；
     *   而且 episodes / txns 共用同一批对象，转换只发生一次。
     */
    g.txns.push({ ...r, tag_ids: splitTagIds(r.tag_ids) })
  }

  const list = Array.from(map.values())
  for (const g of list) {
    // 上面已经在累加时把四个分类折进 total/back，这里统一算一次，避免两处公式
    g.balance = g.total - g.back
    g.settled = g.balance === 0

    /*
     * ★ 分组里再挂一份「结清批次」★
     *   页面要按批次折叠 / 画分割标注（见 splitLoanEpisodes 的注释）。
     *   这里挂在组上而不是让页面自己切：
     *     · 页面上不需要知道四个分类 id，方向差异全在 api/loan.js 里；
     *     · 明细和批次用的是同一条 SQL 的同一批行，不会出现
     *       「段里的流水加起来跟组头余额对不上」。
     *
     * ★ 不改原有字段语义 ★
     *   balance / settled / count / lastDay / total / back / txns 全部照旧，
     *   新增字段纯粹是附加信息 —— 别的调用方（比如以后复用本函数的页面）
     *   不加判断也不会坏。
     */
    g.episodes = splitLoanEpisodes(g.txns, pair)

    /*
     * 「之前已经结清过几笔」= 已收口那几段的流水总数。
     * 未结清 tab 里折叠条要写「已结清 N 笔 · 点击展开」，
     * 在 API 里数好，页面就不用为了一个数字再遍历一遍。
     */
    g.settledTxnCount = g.episodes.reduce(
      (acc, ep) => acc + (ep.settled ? ep.txns.length : 0),
      0
    )
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
 * 流水按「时间正序」比较（结清批次切分专用）。
 *
 * ★ 为什么不在 SQL 里直接 ORDER BY ASC ★
 *   listLoanGroups 的那条 SQL 是倒序的（页面从上往下就是最近的在前），
 *   而切批次要正序走才能判断「余额什么时候回 0」。
 *   同一份数据换个顺序就行，没必要为它再查一次库。
 *
 * ★ 二级键必须和列表排序一致 ★
 *   同一天记的多笔，occurred_at 可能完全相同（补记时只给日期，
 *   见 api/transaction.js 的 resolveOccurredTime），这时再比 created_at，
 *   最后用 id 兜底 —— 保证同一份数据每次切出来的批次一模一样，
 *   不会出现「刷新一下分段就变了」。
 *
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
function compareTxnAsc(a, b) {
  const ao = Number(a && a.occurred_at) || 0
  const bo = Number(b && b.occurred_at) || 0
  if (ao !== bo) return ao - bo
  const ac = Number(a && a.created_at) || 0
  const bc = Number(b && b.created_at) || 0
  if (ac !== bc) return ac - bc
  return String((a && a.id) || '').localeCompare(String((b && b.id) || ''))
}

/**
 * 把某个人的流水按「结清批次」切成若干段。
 *
 * ★ 为什么需要分段 ★
 *   同一个人可能先借后还、结清，过一阵又借 —— 用户原话：
 *   「若是某位用户已结清，又产生新的借入借出，则在未结清中，
 *     自动折叠之前已结清的流水，可展开。」
 *   也就是说「这个人当前这笔账」只从上一段收口之后开始算，
 *   之前那些已经两清的流水不该跟现在的欠款混在一起铺开。
 *
 * ★ 为什么按「余额回到 0」切，而不是按日期或按用户点结清 ★
 *   这个仓库的立场是「不存结清状态字段」（见文件头）——
 *   状态字段会和流水打架。批次也一样：余额回到 0 是流水的**算术事实**，
 *   用户补记一笔或删一笔，重新算出来的批次自然就变了，界面不会自相矛盾。
 *   按日期切则会在「跨月还清」时切错，按点结清切则会漏掉自动平账的情况。
 *
 * ★ 累加公式必须与 listLoanGroups / listLoanByPerson 逐字一致 ★
 *     balance = 主 + - 反 - positive + negative
 *   其中 positive（坏账 / 借入未还）是用来核销主方向的，所以减；
 *   negative（利息 / 多还的利息）是往回收的，所以加。
 *   两边公式一旦不同，就会出现「组头写着已结清、分段里却还有一段未结清」。
 *   四个分类 id 全部从 pair 里取，借出 / 借入两个方向共用这一份实现。
 *
 * ★ 纯函数，不碰数据库 ★
 *   参数就是「某个人的流水 + 方向配对」，没有查询没有事务 ——
 *   这样才能用 node 直接单测（scripts/test-loan-episodes.mjs）。
 *   页面要的「默认折叠哪些段」也完全由这里的 settled 决定，
 *   页面自己不再推一遍余额。
 *
 * @param {Array<object>} txns 该人员的流水（顺序不限，函数内部自己按正序排）
 * @param {{mainId?:string, backId?:string, positiveId?:string, negativeId?:string}} pair
 *   方向配对，见 pairOf()
 * @returns {Array<{settled:boolean, txns:Array<object>, balance:number,
 *   fromDay:string, toDay:string, closingDay:string}>}
 *   settled=true 表示这一段余额已经回 0（两清）；
 *   closingDay 是收口那笔的 occurred_day（分割标注要显示它）；
 *   最后若还有剩余流水，会多出一条 settled=false 的未结清段。
 */
export function splitLoanEpisodes(txns, pair) {
  const src = Array.isArray(txns) ? txns : []
  const p = pair || {}
  if (!p.mainId && !p.backId && !p.positiveId && !p.negativeId) return []

  /*
   * ★ 拷贝再排序 ★
   *   传进来的是页面正在渲染的数组（listLoanGroups 里是倒序的），
   *   就地 sort 会把组内明细的顺序改掉 —— 页面按 g.txns 渲染时
   *   就变成「最近的排最下面」，和首页 / 交易列表的观感反过来。
   *   slice() 之后随便排，调用方的数组一个字节都不动。
   */
  const list = src.slice().sort(compareTxnAsc)

  const episodes = []
  let cur = null

  /** 单笔流水对本方向余额的增量（四个分类的符号全收在这一处） */
  function deltaOf(t) {
    const amt = Number(t && t.amount_cents) || 0
    if (amt <= 0) return 0
    const cid = t && t.category_id
    if (cid === p.mainId) return amt
    if (cid === p.backId) return -amt
    if (cid === p.positiveId) return -amt
    if (cid === p.negativeId) return amt
    return 0
  }

  function openEpisode() {
    return { txns: [], balance: 0, fromDay: '', toDay: '', closingDay: '' }
  }

  for (const t of list) {
    const delta = deltaOf(t)
    /*
     * ★ 增量 0 的流水不进任何批次 ★
     *   金额为 0 的脏数据（历史导入可能有）既不改变余额，
     *   放进批次反而会把「段首」算错（0 元那笔成了段首，分割线画在它上面）。
     *   代价是它不会出现在借入借出页的分段明细里 —— 但记账面板校验过
     *   金额必须 > 0（见 utils/money.js 的金额规则），正常路径写不出 0 元流水；
     *   真要看这类历史脏数据，全部交易页仍然查得到。
     *   整个人的流水如果全是 0 元，episodes 会是空数组，页面那边有兜底
     *   （见 pages/loan/manage.vue 的 episodesOf），会退回平铺显示。
     */
    if (delta === 0) continue

    if (!cur) cur = openEpisode()
    cur.txns.push(t)
    cur.balance += delta

    const day = String((t && t.occurred_day) || '')
    if (!cur.fromDay) cur.fromDay = day
    if (day) cur.toDay = day

    /*
     * ★ 恰好为 0 才算收口 ★
     *   金额都是「分」的整数，没有浮点误差，所以可以用 === 0；
     *   余额从正数一下跨到负数（多还了但还没记利息）时并没有经过 0，
     *   这一笔不能算结清 —— 它会继续挂在未结清段里，等用户点「手动结清」
     *   写下利息那笔后余额才真正归零。
     */
    if (cur.balance === 0) {
      episodes.push({
        settled: true,
        txns: cur.txns,
        balance: 0,
        fromDay: cur.fromDay,
        toDay: cur.toDay,
        closingDay: day
      })
      cur = null
    }
  }

  // 最后还剩流水 = 当前这段没结清
  if (cur && cur.txns.length > 0) {
    episodes.push({
      settled: false,
      txns: cur.txns,
      balance: cur.balance,
      fromDay: cur.fromDay,
      toDay: cur.toDay,
      closingDay: ''
    })
  }

  return episodes
}

/**
 * 把某个人的「结清批次」算成页面直接可用的「段视图」。
 *
 * ★ 为什么这段规则在 api 层而不是页面里 ★
 *   「哪一段默认折叠、分割标注画在哪一段前面、哪一段能收起」——
 *   都只是纯判断，不依赖 DOM。放页面里就只能靠读源码断言，
 *   放这里可以被 scripts/test-loan-episodes.mjs 直接 import 单测
 *   （node 跑不了 .vue）。仓库里 recurrenceLabel 这类展示辅助
 *   也放在 api/cycle.js，同一个先例。
 *
 * ★ 为什么不直接改 splitLoanEpisodes 的返回 ★
 *   那个函数只回答「流水怎么切段」这一个问题，是账务口径；
 *   折叠 / 分割标注是**展示**口径，随页面 tab 变。
 *   混在一起的话，以后统计页复用切段逻辑还得再拆一遍。
 *
 * 返回的每一项在原 segment 上多了几个字段：
 *   rowIndex            段序号（页面记折叠状态用）
 *   collapsed           这一段的流水是否折叠成一行摘要
 *   showDividerBefore   是否在本段之前画「已结清 · 日期」标注
 *                       （仅已结清 tab 的段与段之间为 true，见下面的说明）
 *   dividerText         结清日期文案「已结清 · YYYY-MM-DD」；上一段没有收口日时
 *                       退化成「已结清」
 *   collapseText        折叠条文案「已结清 N 笔 · 点击展开」
 *   showCollapseBtn     展开后是否给「收起」入口
 *
 * @param {Array<object>} episodes splitLoanEpisodes 的返回值
 * @param {{status?:'open'|'settled', isExpanded?:(index:number)=>boolean}} opt
 *   status 决定默认折叠规则（未结清折叠历史段 / 已结清全部展开）；
 *   isExpanded 由页面提供（它手里才有「用户手动展开过哪些段」）。
 * @returns {Array<object>} 段视图
 */
export function buildLoanEpisodeView(episodes, opt = {}) {
  const eps = Array.isArray(episodes) ? episodes : []
  const status = opt.status === 'settled' ? 'settled' : 'open'
  const isSettledTab = status === 'settled'
  const isExpanded = typeof opt.isExpanded === 'function' ? opt.isExpanded : () => false

  /*
   * ★ 两个 tab 都要倒序：最新的在上、历史的在下 ★
   *   splitLoanEpisodes 给的是时间正序（旧的段在前、新的段在后），
   *   但页面从上往下读，每个 tab 都应当是「最近的在最上面」。
   *
   *   未结清 tab（用户第 4 条）：
   *     「未结清页面，已结清流水展开应该显示在当前流水下方而不是上方」。
   *   已结清 tab：
   *     「历史结清显示在下，最新结清显示在上」。
   *
   * ★ 倒序要在算标注之前做 ★
   *   标注的日期取自相邻段，段序一变标注就跟着变 ——
   *   先反序再算，标注才对得上屏幕上看到的相邻关系。
   */
  const ordered = eps.slice().reverse()

  /*
   * ★ 未结清 tab：所有已结清段合成一个「历史」折叠组（用户本轮第 5 条）★
   *   用户原话：「历史有多次已结清时，未结清页面现在会显示多个展开按钮，
   *   修复一下这个 bug，只显示一个」。
   *
   *   之前每个已结清段各给一个折叠条（「已结清 3 笔 · 点击展开」×N），
   *   一个人结清过五次就会出现五条一模一样的栏，看起来像 bug。
   *   它们本来就是同一件事（“这个人的历史”），合成一条正确。
   *
   *   展开后要像已结清页一样，每段前面标「已结清 · 日期」 ——
   *   否则展开后就是一堆流水堆在一起，看不出哪几笔是同一次结清的。
   */
  const historyTxnCount = ordered.reduce(
    (n, ep) => n + (ep && ep.settled && Array.isArray(ep.txns) ? ep.txns.length : 0),
    0
  )
  // 历史组的展开状态用专用下标 -1 存（它不对应任何一段）
  const historyExpanded = !isSettledTab && isExpanded(-1)
  // 历史组里最后一段的下标（收起按钮挂在它后面）
  let lastSettledIndex = -1
  for (let i = 0; i < ordered.length; i++) {
    const ep = ordered[i]
    if (ep && ep.settled && Array.isArray(ep.txns) && ep.txns.length > 0) lastSettledIndex = i
  }

  const out = []
  let historyBarPlaced = false

  for (let i = 0; i < ordered.length; i++) {
    const ep = ordered[i]
    if (!ep || !Array.isArray(ep.txns) || ep.txns.length === 0) continue

    /*
     * ★ 未结清 tab 里的已结清段：合成一个折叠组 ★
     *   折叠时：只有第一段放折叠条，其余段整段跳过（skip）；
     *   展开时：每段都渲染，各自带「已结清 · 日期」标注。
     */
    if (!isSettledTab && ep.settled) {
      const historyDay = ep.closingDay || ''

      if (!historyExpanded) {
        if (historyBarPlaced) {
          // 已经有一条折叠条了 → 这一段完全不渲染
          out.push({
            ...ep,
            rowIndex: i,
            collapsed: false,
            skip: true,
            showDividerBefore: false,
            dividerText: '',
            collapseText: '',
            showCollapseBtn: false
          })
          continue
        }
        historyBarPlaced = true
        out.push({
          ...ep,
          /*
           * 折叠条的下标用 -1：
           * 它代表的是「这个人的整个历史组」，不是某一段。
           * 用真实下标的话，展开状态会跟着分段变化而错位。
           */
          rowIndex: -1,
          collapsed: true,
          skip: false,
          showDividerBefore: false,
          dividerText: '',
          collapseText: `已结清 ${historyTxnCount} 笔 · 点击展开`,
          showCollapseBtn: false
        })
        continue
      }

      historyBarPlaced = true
      out.push({
        ...ep,
        /*
         * ★ 展开后的历史段，rowIndex 也要是 -1 ★
         *   展开状态存在 `person#-1` 上，而「收起」按钮是用
         *   `toggleEpisode(g.person, ep.rowIndex)` 去翻转的 ——
         *   如果这里给真实下标 i，按钮去翻的是另一个 key，
         *   历史组永远收不回去（用户反馈的 bug）。
         *   展开后这些段不再单独折叠，rowIndex 没有别的用途。
         */
        rowIndex: -1,
        collapsed: false,
        skip: false,
        showDividerBefore: true,
        /*
         * ★ 这里的日期用「这一段自己的收口日」★
         *   已结清 tab 用的是「上一段的收口日」（那边每段都是已结清，
         *   标注读作“上面那段结清于哪天”）。
         *   而这里的历史组每段都是一次独立的结清，
         *   标它自己的日期最不容易误读。
         */
        dividerText: historyDay ? `已结清 · ${historyDay}` : '已结清',
        collapseText: '',
        // 收起入口挂在历史组最后一段后面
        showCollapseBtn: i === lastSettledIndex
      })
      continue
    }

    const prev = i > 0 ? ordered[i - 1] : null
    const prevDay = (prev && prev.closingDay) || ''

    out.push({
      ...ep,
      rowIndex: i,
      collapsed: false,
      skip: false,
      /*
       * 已结清 tab：段与段之间标「已结清 · 上一段收口日」
       * 未结清 tab 的当前段（下标 0）：不标
       */
      showDividerBefore: isSettledTab && i > 0,
      dividerText: prevDay ? `已结清 · ${prevDay}` : '已结清',
      collapseText: '',
      showCollapseBtn: false
    })
  }

  return out
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
    /*
     * ★ 结清派生的这三类要**占预算**（本轮用户第 5 条）★
     *   用户原话「借出坏账 / 借入利息 / 报销坏账这三类要默认计入预算」。
     *   以前这里写的是 exclude_from_budget: true，理由是「它们不是消费」——
     *   但用户的口径是「真实损益就该算进来」：坏账是实际损失、
     *   借入利息是实际多付的钱，都占用了这个月的可花额度。
     *   exclude_from_stats 仍然是 false（计入收支），这条不变。
     */
    exclude_from_stats: false,
    exclude_from_budget: false,
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
