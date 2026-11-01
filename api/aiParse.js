/**
 * AI 记账解析 —— 一条自然语言消息 → 多条结构化交易
 *
 * 设计要点：
 *   1. 让模型只输出 JSON 数组，不输出任何解释
 *   2. 拿到响应后做**严格校验**：字段类型、枚举值、金额范围、日期合法性
 *   3. 分类/账户按「名称 → id」映射；匹配不到的用默认值，并标记出来
 *   4. 任一字段不合法就丢弃该条并在 warnings 里说明，绝不让脏数据进库
 *   5. 不信任模型的任何输出 —— 模型可能返回 markdown、多个 JSON、空数组
 */

import { chat } from './ai.js'
import { SYSTEM_PRESET_GROUP_NAME } from './db/schema.js'

/* ------------------------------------------------------------------ 常量 */

const VALID_TYPES = ['expense', 'income', 'transfer']

/** 单笔金额上限：1 亿元（分），防止模型返回离谱数字 */
const MAX_AMOUNT_CENTS = 10000000000

/** 一次最多解析多少条，防止模型刷屏 */
const MAX_ITEMS = 20

/* ------------------------------------------------------------ JSON 提取 */

/**
 * 从模型回复里提取 JSON 数组。
 * 模型常见的几种脏输出都要能处理：
 *   - ```json ... ``` 代码块
 *   - 前后带解释文字
 *   - 直接输出 {...} 单个对象而非数组
 */
export function extractJsonArray(reply) {
  if (typeof reply !== 'string') {
    throw new Error('AI 返回内容不是文本')
  }

  let text = reply.trim()

  // 去掉 markdown 代码块标记
  text = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()

  // 优先找数组
  const arrStart = text.indexOf('[')
  const arrEnd = text.lastIndexOf(']')

  if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
    const slice = text.slice(arrStart, arrEnd + 1)
    try {
      const parsed = JSON.parse(slice)
      if (Array.isArray(parsed)) return parsed
    } catch (e) {
      // 继续尝试对象
    }
  }

  // 退而求其次：单个对象 → 包成数组
  const objStart = text.indexOf('{')
  const objEnd = text.lastIndexOf('}')
  if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
    const slice = text.slice(objStart, objEnd + 1)
    try {
      const parsed = JSON.parse(slice)
      if (parsed && typeof parsed === 'object') return [parsed]
    } catch (e) {
      throw new Error('AI 返回的 JSON 无法解析')
    }
  }

  throw new Error('AI 没有返回 JSON，请重试或换个说法')
}

/* -------------------------------------------------------------- 字段校验 */

/** 把模型给的金额（可能是字符串、带货币符号）转成分 —— 导出供单测 */
export function toCents(v) {
  if (v === null || v === undefined) return null

  let n
  if (typeof v === 'number') {
    n = v
  } else {
    const cleaned = String(v).replace(/[^\d.\-]/g, '')
    n = Number(cleaned)
  }

  if (!Number.isFinite(n)) return null

  // ★ 负数直接判无效 ★
  //   本项目约定金额恒为正，方向由 type（expense/income）决定。
  //   模型返回 -50 说明它误解了语义，若取绝对值就会把「退款」记成「支出」，
  //   宁可拒绝并提示用户重说，也不要猜。
  if (n <= 0) return null

  const cents = Math.round(n * 100)
  if (cents <= 0 || cents > MAX_AMOUNT_CENTS) return null
  return cents
}

/**
 * 把模型给的日期（可能是 dayOffset 数字、YYYY-MM-DD 字符串、"今天"）解析成本地 YYYY-MM-DD
 * 导出供单测
 * @param {*} v
 * @param {Date} baseDate
 */
export function toDayKey(v, baseDate) {
  const fmt = (d) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  if (v === null || v === undefined) return fmt(baseDate)

  // 数字：视为相对今天的天数偏移
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(baseDate)
    d.setDate(d.getDate() + Math.trunc(v))
    return fmt(d)
  }

  const s = String(v).trim()

  // 相对词
  const relMap = { 今天: 0, 昨天: -1, 前天: -2, 大前天: -3, 明天: 1 }
  if (relMap[s] !== undefined) {
    const d = new Date(baseDate)
    d.setDate(d.getDate() + relMap[s])
    return fmt(d)
  }

  // YYYY-MM-DD / YYYY/MM/DD
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (m) {
    const y = Number(m[1])
    const mo = Number(m[2])
    const day = Number(m[3])
    if (y >= 1970 && y <= 2100 && mo >= 1 && mo <= 12 && day >= 1 && day <= 31) {
      const d = new Date(y, mo - 1, day)
      // 防止 2 月 30 日这类溢出
      if (d.getMonth() === mo - 1 && d.getDate() === day) {
        return fmt(d)
      }
    }
  }

  // 纯数字字符串 → 当作偏移天数
  if (/^-?\d+$/.test(s)) {
    const d = new Date(baseDate)
    d.setDate(d.getDate() + Number(s))
    return fmt(d)
  }

  return fmt(baseDate)
}

/**
 * 解析模型给的时刻
 *
 * 模型可能给 "HH:mm"、"晚上8点"、"8:30" 这类。
 * 没给就返回 null（调用方按「此刻」处理）。
 *
 * @param {*} v
 * @returns {string|null} 'HH:mm'
 */
export function toTimeText(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null

  // 「晚上8点」「下午3点半」「8点」
  const cn = s.match(/^(早上|上午|中午|下午|傍晚|晚上|夜里|凌晨)?\s*(\d{1,2})\s*[点:：]\s*(半|\d{1,2})?\s*分?$/)
  if (cn) {
    let hh = Number(cn[2])
    // 「点半」= 30 分
    const mm = cn[3] === '半' ? 30 : (cn[3] !== undefined ? Number(cn[3]) : 0)
    const period = cn[1] || ''
    if (hh > 23 || mm > 59) return null
    // 12 点制转 24 小时制
    if (period === '下午' || period === '傍晚' || period === '晚上' || period === '夜里') {
      if (hh < 12) hh += 12
    } else if (period === '凌晨') {
      if (hh === 12) hh = 0
    } else if (period === '中午') {
      if (hh < 12) hh += 12
    }
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }

  // 「08:30」「8:30」
  const hm = s.match(/^(\d{1,2})\s*[:：]\s*(\d{1,2})$/)
  if (hm) {
    const hh = Number(hm[1])
    const mm = Number(hm[2])
    if (hh > 23 || mm > 59) return null
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }

  return null
}

/**
 * 从原句里识别「借入借出」意图
 *
 * ★ 为什么需要它（用户反馈的真 bug）★
 *   用户说「还给姐姐200元」，模型把它当成了**转账**：
 *   「还给 X」这种句式看着确实像「A 转给 B」，
 *   但「姐姐」是**人**，不是账户 ——
 *   于是 toAccount 匹配不到任何账户，
 *   整条记录被丢成「转账缺少目标账户」，用户什么也没记上。
 *
 *   借还这件事的本质是**收支**，不是账户间转账：
 *     还给别人钱     -> 支出，分类「借款归还」
 *     别人还我钱     -> 收入，分类「借款收回」
 *     向别人借钱     -> 收入，分类「借入」
 *     借钱给别人     -> 支出，分类「借出」
 *
 *   提示词已经教模型这么做，但模型不保证听话 ——
 *   所以这里再加一道**确定性兜底**：从原句文本自己判断，
 *   命中就纠正模型给的 transfer / 补上正确分类。
 *
 * ★ 顺序很重要 ★
 *   「还给我」同时含「还给」和「给我」，
 *   必须先判「收回」再判「归还」，否则会判反方向。
 *
 * @param {string} text 用户原句（或备注 + 原句）
 * @returns {{type:string, categoryName:string, key:string}|null}
 *   type: 'expense' | 'income'
 *   categoryName: 要挂的分类名（与「系统预置分类」下的固定子类一致）
 */
export function detectLoanIntent(text) {
  const t = String(text || '')
  if (!t) return null

  /*
   * 依次尝试，先命中先返回。
   * 每条都是「关键词 + 归类」——故意写得窄，
   * 避免「还款」「还价」这种普通说法被误判。
   */
  const RULES = [
    // ---- 别人还我钱：收入，借款收回 ----
    //   「姐姐还我200」「还给我200」「把钱收回来」
    {
      key: 'lendBack',
      type: 'income',
      categoryName: '借款收回',
      re: /还给我|还我|(?:收回|收回来|要回来|还回来)/
    },
    // ---- 我借钱给别人：支出，借出 ----
    //   「借给姐姐200」「借钱给朋友」
    {
      key: 'lendOut',
      type: 'expense',
      categoryName: '借出',
      re: /借给|借出|借钱给|借了.{0,4}给/
    },
    // ---- 我向别人借钱：收入，借入 ----
    //   「向姐姐借了200」「跟同事借500」「找朋友借」
    {
      key: 'borrowIn',
      type: 'income',
      categoryName: '借入',
      re: /向.{0,8}借|跟.{0,8}借|找.{0,8}借|借来|借到/
    },
    // ---- 我把钱还给别人：支出，借款归还 ----
    //   「还给姐姐200」「还同事500」「还回500」「归还」「偿还」
    //
    //   ★ 强关键词 / 弱关键词 ★
    //     强关键词（还给 / 还回 / 归还 / 偿还 / 还钱）本身足够明确。
    //     弱关键词就是一个「还」字 —— 用户很少说全「还给」，
    //     更多是「还同事500」「还了300」。
    //
    //   ★ 但「还」太常见，必须前后都设防 ★
    //     后接这些字不是借还：
    //       还价 / 还是 / 还有 / 还要 / 还款 / 还能 / 还在 / 还得 /
    //       还好 / 还行 / 还没（「还款」尤其重要：信用卡还款是转账）
    //     前置这些字不是借还：
    //       不还 / 没还 / 未还 / 别还 / 先还 / 再还 / 是否还
    //       —— 都是「还没还钱」的意思，不能记成「借款归还」
    //
    //   ★ 前置断言要包住整个分支组 ★
    //     写成 `A|(?<!C)还` 时断言只作用于最后一个分支，
    //     「是否还给」这种会被强关键词分支命中。
    //     所以把 lookbehind 提到分组外面：`(?<!C)(?:A|B)`。
    {
      key: 'borrowBack',
      type: 'expense',
      categoryName: '借款归还',
      re: new RegExp(
        '(?<![不没未别先再否想真太很需也才刚又])' +
        '(?:还给|还回|归还|偿还|还钱|把钱还|' +
        // 弱关键词：光秃秃一个「还」，后面再设一道防
        '还(?![价钱是有要能在得好的行不会可款剩差算用需想真太很没]))'
      )
    }
  ]

  for (const rule of RULES) {
    if (rule.re.test(t)) {
      return { key: rule.key, type: rule.type, categoryName: rule.categoryName }
    }
  }

  return null
}

/**
 * 校验并归一化单条记录
 * 导出供单测
 * @returns {{ok: boolean, item?: object, reason?: string}}
 */
export function validateItem(raw, ctx) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: '记录不是对象' }
  }

  // 金额
  const cents = toCents(raw.amount)
  if (!cents) {
    return { ok: false, reason: `金额无效: ${JSON.stringify(raw.amount)}` }
  }

  // 类型：非法值退化为支出（记账里支出最常见）
  let type = String(raw.type || '').toLowerCase().trim()
  if (!VALID_TYPES.includes(type)) {
    type = 'expense'
  }

  /*
   * ★ 借入借出兜底（必须在分类解析之前）★
   *   「还给姐姐200元」这类句子会被模型误判成 transfer，
   *   而「姐姐」不是账户 -> toAccount 解析不出来 -> 整条被丢弃。
   *   这里从原句自己判断借还意图，命中就：
   *     1. 把 type=transfer 纠正成真正的收支方向
   *     2. 记下应该挂的分类名，给下面的分类解析兜底
   */
  const intentText = [ctx.hintText, raw.note].filter(Boolean).join(' ')
  const loanIntent = detectLoanIntent(intentText)
  if (loanIntent && type === 'transfer') {
    type = loanIntent.type
  }

  // 日期
  const occurredDay = toDayKey(raw.date !== undefined ? raw.date : raw.dayOffset, ctx.baseDate)

  // 时刻：模型没给就留空，落库时按「此刻」处理
  let occurredTime = null
  const rawTime = raw.time !== undefined ? raw.time : raw.timeText
  if (rawTime !== undefined && rawTime !== null) {
    occurredTime = toTimeText(rawTime)
  }
  // 模型没给 time 字段时，试着从原句里捞「晚上8点」这类说法
  if (!occurredTime) {
    const hint = [raw.note, ctx.hintText].filter(Boolean).join(' ')
    const m = hint.match(/(早上|上午|中午|下午|傍晚|晚上|夜里|凌晨)?\s*\d{1,2}\s*[点:：]\s*(半|\d{1,2})?\s*分?/)
    if (m) {
      const guess = toTimeText(m[0])
      if (guess) {
        // 只在原句里明确出现「点/:」时才采信
        occurredTime = guess
      }
    }
  }

  // 分类：按名称或 id 匹配，优先二级分类
  let categoryId = null
  let categoryName = ''
  const rawCat = raw.category
  if (rawCat && type !== 'transfer') {
    // 提示文本 = 备注 + 原句，用来在一级分类下猜二级
    const hint = [raw.note, ctx.hintText].filter(Boolean).join(' ')
    const hit = matchCategory(rawCat, ctx.categories, hint)
    if (hit) {
      categoryId = hit.id
      categoryName = hit.name
    }
  }

  /*
   * ★ 借入借出兜底：按意图强制挂到正确的分类 ★
   *
   * 模型可能给了个别的分类（把「还给姐姐」记成「人情往来/送礼」），
   * 也可能因为原本判成 transfer 而根本没给分类。
   * 既然我们已经从句子里认出了借还意图，这里就把它钉到
   * 「系统预置分类」下对应的固定子类上 ——
   * 否则借入借出页面按分类统计时抓不到这一笔。
   */
  if (loanIntent) {
    const target = ctx.categories.find(
      (c) => c.name === loanIntent.categoryName && c.type === loanIntent.type
    )
    if (target) {
      categoryId = target.id
      categoryName = target.name
    } else {
      /*
       * 分类还不存在（老库没跑迁移 / 用户删过）。
       * 这时不能硬塞一个不存在的 id —— 留空，交给
       * parseMessageToTransactions 的分类兜底流程，
       * 至少把这笔记成正确的收支方向，别整条丢掉。
       */
      categoryId = null
      categoryName = ''
    }
  }

  // 账户
  let accountId = null
  let accountName = ''
  const rawAcc = raw.account
  if (rawAcc) {
    const hit = matchByNameOrId(rawAcc, ctx.accounts)
    if (hit) {
      accountId = hit.id
      accountName = hit.name
    }
  }

  // 转账目标账户
  let toAccountId = null
  let toAccountName = ''
  if (type === 'transfer') {
    const rawTo = raw.toAccount || raw.to_account
    if (rawTo) {
      const hit = matchByNameOrId(rawTo, ctx.accounts)
      if (hit) {
        toAccountId = hit.id
        toAccountName = hit.name
      }
    }

    // ★ 模型漏了 toAccount（或 account）时，用原句自己找一遍 ★
    //   「微信转给支付宝200元」这类句式模型偶尔只给一半。
    const hint = [raw.note, ctx.hintText].filter(Boolean).join(' ')
    if (hint) {
      const dir = parseTransferDirection(hint, ctx.accounts)
      if (dir.from && dir.to) {
        if (!accountId) {
          accountId = dir.from.id
          accountName = dir.from.name
        }
        if (!toAccountId) {
          toAccountId = dir.to.id
          toAccountName = dir.to.name
        }
      }
    }

    // ★ 组合账户守卫（转账转入）★
    //   转入方不能是组合账户（钱只能从组合出、不能进组合）。
    //   模型可能误选，清掉后下面会报「转账缺少目标账户」。
    const toAcc = ctx.accounts.find((a) => a.id === toAccountId)
    if (toAcc && toAcc.isCombo) {
      toAccountId = null
      toAccountName = ''
    }

    // 转账必须有目标账户，且不能与来源相同
    if (!toAccountId) {
      return { ok: false, reason: '转账缺少目标账户' }
    }
    if (accountId && accountId === toAccountId) {
      return { ok: false, reason: '转出与转入账户不能相同' }
    }
  }

  /*
   * ★ 组合账户守卫（账户）★
   *   组合账户只能用于「支出」（日常碰一碰/自动续费）；
   *   收入、转账都不能用组合（钱不能进虚拟账户、转账两端须落真实账户）。
   *   AI 候选列表里包含组合账户，它可能误选 —— 这里清掉，
   *   让 parseMessageToTransactions 补一个真实默认账户。
   */
  const srcAcc = ctx.accounts.find((a) => a.id === accountId)
  if (srcAcc && srcAcc.isCombo && type !== 'expense') {
    accountId = null
    accountName = ''
  }

  // 标签
  const tagIds = []
  if (Array.isArray(raw.tags)) {
    for (const t of raw.tags) {
      const hit = matchByNameOrId(t, ctx.tags)
      if (hit && !tagIds.includes(hit.id)) tagIds.push(hit.id)
    }
  }

  // 备注
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 100) : ''

  return {
    ok: true,
    item: {
      type,
      amount_cents: cents,
      category_id: categoryId,
      category_name: categoryName,
      account_id: accountId,
      account_name: accountName,
      to_account_id: toAccountId,
      to_account_name: toAccountName,
      occurred_day: occurredDay,
      occurred_time: occurredTime,
      tag_ids: tagIds,
      note,
      // 标记：分类/账户是模型给的还是我们兜底的
      categoryFromAi: !!categoryId,
      accountFromAi: !!accountId
    }
  }
}

/**
 * 分类匹配
 *
 * ★ 速记必须落到二级分类 ★
 *   一级分类是「统计口径」（餐饮、居住…），用户记的是具体花在哪
 *   （午餐、房租、外卖…）。所以：
 *     1. 候选列表只给**叶子分类**（没有下级的那些）；
 *        一级分类只有在「自己没有二级」时才作为候选（如「其他」）。
 *     2. 匹配时**优先命中二级分类**，同名时二级优先。
 *     3. 模型只给了一级分类时，用「备注/原句」里的关键词在它的二级里再猜一次。
 */

/**
 * 从原句里解析转账方向
 *
 * 模型有时会漏掉 toAccount 字段（尤其句式复杂时）。
 * 这里用规则从原句里再找一遍：
 *   「A转给B」「A转到B」「从A转B」「A转B」「A给B」
 *
 * @param {string} text 用户原句
 * @param {Array} accounts 可选账户
 * @returns {{from:object|null, to:object|null}}
 */
export function parseTransferDirection(text, accounts = []) {
  const t = String(text || '')
  const list = accounts || []
  if (!t || list.length === 0) return { from: null, to: null }

  // 「从X转…」/「X转给Y」这类句式
  const patterns = [
    /从\s*(.+?)\s*转(?:给|到|入)/,
    /(.+?)\s*转(?:给|到|入)\s*(.+)/,
    /(.+?)\s*转\s*(.+)/,
    /(.+?)\s*给\s*(.+)/
  ]

  for (const re of patterns) {
    const m = t.match(re)
    if (!m) continue

    const a = findAccountInText(m[1], list)
    const b = findAccountInText(m[2], list)

    // 「从X转Y」：X 是转出方，Y 是转入方
    if (a && b && a.id !== b.id) {
      return { from: a, to: b }
    }
    // 「X转给Y」：X 是转出方，Y 是转入方
    if (a && b && a.id !== b.id) {
      return { from: a, to: b }
    }
  }

  // 退一步：句子里出现两个不同账户名，猜第一个是转出、第二个是转入
  const hits = []
  for (const acc of list) {
    if (acc.name && t.indexOf(acc.name) !== -1) hits.push(acc)
  }
  if (hits.length >= 2) {
    return { from: hits[0], to: hits[1] }
  }

  return { from: null, to: null }
}

/**
 * 在一段文字里找出账户名
 * 优先匹配更长的名字（避免「微信」抢在「微信零钱」前面命中）
 * @returns {object|null}
 */
function findAccountInText(text, accounts = []) {
  const t = String(text || '')
  if (!t) return null

  let best = null
  for (const acc of accounts || []) {
    const name = String(acc.name || '')
    if (!name) continue
    if (t.indexOf(name) === -1) continue
    if (!best || name.length > String(best.name).length) best = acc
  }
  return best
}

/**
 * 构造给模型看的分类候选
 *
 * ★ 「系统预置分类」下的固定子类用短名，不加路径前缀 ★
 *   那一组是「借出 / 借款归还 / 借入 / 借款收回 / 对账支出 / 对账收入」，
 *   用户说的是「还给姐姐200」而不是「系统预置分类/借款归还」。
 *   如果给模型的标签是「系统预置分类/借款归还」，
 *   它很容易觉得不贴切而去选「人情往来/送礼」——
 *   这正是「还给姐姐」记错分类的原因之一。
 *   所以这几个直接给短名（「借款归还」），模型一眼就能对上。
 *
 * 其它分类仍然给「一级/二级」完整路径。
 *
 * @param {Array} categories 全部分类（含二级）
 * @returns {Array<{id:string,label:string,type:string,isLeaf:boolean}>}
 */
export function buildCategoryOptions(categories = []) {
  const list = categories || []
  const parents = list.filter((c) => !c.parent_id)
  const out = []

  for (const p of parents) {
    const children = list.filter((c) => c.parent_id === p.id)
    // 系统预置分类：子类直接给短名
    const isPreset = p.name === SYSTEM_PRESET_GROUP_NAME

    if (children.length === 0) {
      // 没有二级，一级本身就是最细的粒度
      out.push({ id: p.id, label: p.name, type: p.type, isLeaf: true })
    } else {
      for (const c of children) {
        out.push({
          id: c.id,
          label: isPreset ? c.name : `${p.name}/${c.name}`,
          type: c.type || p.type,
          isLeaf: true
        })
      }
    }
  }

  return out
}

/**
 * 从一段文字里猜某个一级分类下的哪个二级分类
 *
 * 做法分三档打分，取分最高的：
 *   1. 分类名**原样出现在**文字里（如「外卖」出现在「点了外卖」）—— 最强信号
 *   2. 分类名里**两个字以上**出现在文字里（如「咖啡奶茶」在「买了杯咖啡」里命中「咖啡」）
 *   3. 分类名的**第一个字**出现在文字里（如「午饭」命中「午餐」的「午」）
 *      —— 这一档专门对付「午饭/早饭/晚饭」这类同义不同字的说法
 *
 * @param {Array} children 二级分类
 * @param {string} text 备注 + 用户原句
 * @returns {object|null} 猜中的二级分类，猜不出返回 null
 */
export function guessChildByText(children = [], text = '') {
  const t = String(text || '')
  if (!t || children.length === 0) return null

  let best = null
  let bestScore = 0

  for (const c of children) {
    const name = String(c.name || '')
    if (!name) continue

    let score = 0

    if (t.indexOf(name) !== -1) {
      // 分类名原样出现
      score = 1000 + name.length
    } else {
      let hits = 0
      for (const ch of name) {
        if (t.indexOf(ch) !== -1) hits++
      }
      if (hits >= 2) {
        score = 100 + hits
      } else if (t.indexOf(name[0]) !== -1) {
        // 第一个字命中：午饭 -> 午餐、早饭 -> 早餐
        score = 50
      }
    }

    if (score > bestScore) {
      best = c
      bestScore = score
    }
  }

  return bestScore > 0 ? best : null
}

/**
 * 匹配分类，优先二级
 *
 * @param {*} rawValue 模型给的分类（可能是 id、名字、「餐饮/午餐」）
 * @param {Array} categories 全部分类（含二级）
 * @param {string} hintText 备注 + 原句，用于在一级分类下猜二级
 * @returns {object|null} 命中的分类
 */
export function matchCategory(rawValue, categories = [], hintText = '') {
  if (!rawValue) return null
  const v = String(rawValue).trim()
  if (!v) return null

  const list = categories || []

  // 「餐饮/午餐」这种带路径的写法
  if (v.indexOf('/') !== -1) {
    const parts = v.split('/').map((s) => s.trim()).filter(Boolean)
    const leaf = parts[parts.length - 1]
    const byLeaf = list.find((c) => c.name === leaf && c.parent_id)
    if (byLeaf) return byLeaf
    const byLeafAny = list.find((c) => c.name === leaf)
    if (byLeafAny) return byLeafAny
  }

  // 按 id
  const byId = list.find((c) => c.id === v)
  if (byId) return byId

  // 按名字精确匹配 —— 同名时二级优先
  const exact = list.filter((c) => c.name === v)
  if (exact.length > 0) {
    const child = exact.find((c) => c.parent_id)
    const hit = child || exact[0]
    return refineToChild(hit, list, hintText)
  }

  // 按名字包含（模型可能输出「餐饮类」这种）
  const loose = list.filter((c) => c.name && (v.indexOf(c.name) !== -1 || c.name.indexOf(v) !== -1))
  if (loose.length > 0) {
    const child = loose.find((c) => c.parent_id)
    const hit = child || loose[0]
    return refineToChild(hit, list, hintText)
  }

  return null
}

/**
 * 命中的是一级分类且它有二级时，尝试用文字再猜一个二级出来
 */
function refineToChild(cat, list, hintText) {
  if (!cat || cat.parent_id) return cat
  const children = list.filter((c) => c.parent_id === cat.id)
  if (children.length === 0) return cat
  const guess = guessChildByText(children, hintText)
  return guess || cat
}

/** 按名称或 id 在候选列表里找（账户、标签用） */
function matchByNameOrId(rawValue, list) {
  if (!rawValue) return null
  const v = String(rawValue).trim()
  if (!v) return null

  // 先按 id
  let hit = list.find((x) => x.id === v)
  if (hit) return hit

  // 再按名称精确匹配
  hit = list.find((x) => x.name === v)
  if (hit) return hit

  // 最后按名称包含（模型可能输出「餐饮类」这种）
  hit = list.find((x) => x.name && (v.includes(x.name) || x.name.includes(v)))
  if (hit) return hit

  return null
}

/* -------------------------------------------------------------- 主入口 */

/**
 * 用 AI 把一条消息解析成多条记账记录
 *
 * @param {string} text 用户输入
 * @param {object} ctx {
 *   categories: [{id,name,type,parent_id}],
 *   accounts:   [{id,name,type,card_tail}],
 *   tags:       [{id,name}],
 *   defaultAccountId: string,
 *   baseDate: Date
 * }
 * @returns {Promise<{items: Array, warnings: Array, raw: string}>}
 */
export async function parseMessageToTransactions(text, ctx) {
  const message = String(text || '').trim()
  if (!message) throw new Error('消息为空')

  const baseDate = ctx.baseDate || new Date()

  // ★ 只把「叶子分类」给模型 ★
  //   一级分类（餐饮、居住…）是统计口径，不是用户记的具体项。
  //   给模型的是「餐饮/午餐」这种二级分类，让它直接选到最细的一级。
  const categoryOptions = buildCategoryOptions(ctx.categories)
  const categoryLabels = categoryOptions.map((c) => c.label)

  /*
   * ★ 提示词辅助：只用来看清楚「有哪些已有分类」★
   *
   *   这两个列表**只拼进提示词**，不参与任何匹配逻辑：
   *     · parentNames —— 有二级的一级分类名（「餐饮食品」「购物消费」…）
   *       给模型当「上位概念」，帮它把「买猫粮」这种说法
   *       映射到已有的二级分类上，而不是自己造一个「宠物食品」。
   *     · fallbackNames —— 兜底类（「其他/杂项」）
   *       跟下面的兜底逻辑保持一致：找不到别的分类时，用它总比空着强。
   */
  const allCats = ctx.categories || []
  const parentNames = allCats
    .filter((c) => !c.parent_id && c.name !== SYSTEM_PRESET_GROUP_NAME)
    .filter((c) => allCats.some((x) => x.parent_id === c.id))
    .map((c) => c.name)
  const fallbackNames = Array.from(new Set(
    allCats
      .filter((c) => !c.parent_id && /其他|杂项|未分类|不明/.test(c.name))
      .map((c) => c.name)
  ))

  const accountNames = ctx.accounts.map((a) => a.name)

  const systemPrompt = `你是一个记账助手，负责把用户的一句话解析成结构化的记账记录。

规则：
1. 只输出 JSON 数组，不要任何解释、注释或 markdown 代码块。
2. 一句话里可能包含多笔收支，要全部拆开，每笔一个对象。
3. 如果某条信息没提到，用 null 或者省略该字段，不要编造。
4. amount 只填数字（单位：元），不要带货币符号。
5. type 只能是 "expense"（支出）、"income"（收入）、"transfer"（转账）。
6. category 必须从给定的分类列表里选，且**必须选最具体的那一级**（形如「餐饮食品/正餐」）。
   - 给的分类列表里每项都是「一级/二级」这种完整路径，直接原样填进 category 字段；
     少数几项是短名（如「借款归还」「借出」），也原样填。
   - 不要只填一级（如「餐饮食品」）。若列表里只有一级分类没有二级，才填一级。
   - 选不到就给 null，不要编造分类名。
7. **★★ 优先归到已有分类：只能用列表里的，绝不自己造 ★★**
   - **只能从下面给的分类列表里选**。列表里没有的分类名一律不要输出。
   - **优先归到已有的、语义最接近的那一项**，按这个顺序判断：
     a) 先找语义**完全一致**的：例「买咖啡」→ 列表里表示咖啡/饮品的那一项；
     b) 再找**上位概念里语义最近**的：例「买猫粮」，列表里没有「宠物食品」，
        就归到列表里最接近的日用品那一项（如「购物消费/日用品」这种已经存在的）；
     c) 实在找不到能沾边的，才用**兜底类**（如「其他/杂项」）。
   - **不要新建列表里没有的分类名**。哪怕用户原句里出现了某个词
     （「猫粮」「宠物」「健身卡」……），只要那个词不在列表里，
     它就只是**备注**，不是分类名。
   - **宁可归到兜底类，也不要归到一个不存在的分类** ——
     编出来的名字程序匹配不到，分类会变成空，整条记录只能走兜底，
     等于这句话白记了。优先级：**已有分类 > 兜底类 > 不存在的分类**。
   - 实在对不上列表里任何一项，就给 null（程序会自动挂到兜底类），
     但**绝对不要**输出列表以外的分类名。
8. account 必须从给定的账户名列表里选，选不到就给 null。
9. **转账（transfer）必须同时给出转出账户 account 和转入账户 toAccount**。
   - 例：「微信转给支付宝200元」→ account="微信"，toAccount="支付宝"
   - 例：「从支付宝转到招商卡」→ account="支付宝"，toAccount="招商卡"
   - 两个字段都必须从账户名列表里选，不要编造。
   - 只有在句子明确表达了「A 转给 B」「A 转到 B」「从 A 转 B」这类方向时才用 transfer；
     如果只有一个账户出现，那是收支不是转账。
   - 转账不需要 category，给 null 即可。
10. **★★ 借入借出（最容易错的地方，务必按下面的判断）★★**

   借钱/还钱的对象是「人」（姐姐、同事、朋友、爸妈…），
   **不是账户** —— 所以这四种情况**一律不是 transfer**，
   而是普通收支，分类从「系统预置分类」下选：

   | 用户怎么说 | type | category |
   |---|---|---|
   | 借给姐姐200、借钱给朋友500 | expense | 借出 |
   | 还给姐姐200、还同事500、归还、偿还 | expense | 借款归还 |
   | 向姐姐借了200、跟同事借500、找朋友借钱 | income | 借入 |
   | 姐姐还我200、收回借出的钱、还给我300 | income | 借款收回 |

   ★ 判断口诀 ★
     - 钱**离开**我 → expense：「借给」= 借出；「还给 / 归还 / 偿还」= 借款归还
     - 钱**回到**我 → income ：「向…借 / 跟…借」= 借入；「…还我 / 收回」= 借款收回
   ★ 特别注意 ★
     - 「还给姐姐200元」是**支出 + 借款归还**，绝不因为含「给」字就判成转账。
     - 「姐姐还我200」是**收入 + 借款收回**，方向与上一条相反，别弄反。
     - 只有两边都是**账户列表里的账户**（如「微信转支付宝」）才是 transfer。
       如果句子里出现的「对方」不在账户列表里，那就不是转账。

11. date 用 "YYYY-MM-DD" 格式；用户说「昨天」「前天」这类相对时间，请换算成具体日期。
12. time 用 "HH:mm" 格式（24 小时制）。用户明确说了几点几分就填那个时间，
    没提时间就给 null（系统会自动记成当前时刻）。
13. note 填这句话里剩下的描述性内容（去掉金额、分类、时间后剩下的部分）。

今天的日期是：${toDayKey(baseDate, baseDate)}`

  const userPrompt = `可选分类（请原样使用列表里的完整路径，**不要输出列表以外的分类**）：
${categoryLabels.map((l) => `- ${l}`).join('\n')}
${parentNames.length ? `
上面这些分类归属的一级分类（帮你在心里把说法映射到已有的二级上）：
${parentNames.map((n) => `- ${n}`).join('\n')}
` : ''}${fallbackNames.length ? `
兜底分类（实在对不上上面任何一项时才用；宁可选它，也不要造一个不存在的分类）：
${fallbackNames.map((n) => `- ${n}`).join('\n')}
` : ''}
可选账户：${JSON.stringify(accountNames)}

用户消息：${message}

★ 分类怎么选（务必照做）★
1. category 只能填上面列表里的某一项，**原样照抄，不要改字、不要加词、不要造新名字**。
2. 优先归到**已有的、语义最接近**的那一项：
   - 先找语义完全一致的（例：「买咖啡」→ 列表里的「餐饮食品/饮品」）；
   - 再找上位概念里语义最近的（例：「买猫粮」列表里没有「宠物食品」，
     就归到最接近的日用品类，如「购物消费/日用品」）；
   - 实在沾不上边的，才用上面的兜底分类。
3. 用户原句里出现的词（如「猫粮」「宠物」「车险」）如果不在列表里，
   它只是**备注**（填进 note），**不是分类名**。
4. 绝不要输出列表以外的分类名 —— 编出来的名字程序匹配不到，
   这一条记录就白记了。宁可给 null 或兜底分类。

请输出 JSON 数组，每个元素格式：
{"amount": 45.5, "type": "expense", "category": "餐饮食品/正餐", "account": "微信", "toAccount": null, "date": "2026-10-27", "time": null, "note": "午饭"}

转账的格式（两个账户都在上面的账户列表里）：
{"amount": 200, "type": "transfer", "category": null, "account": "微信", "toAccount": "支付宝", "date": "2026-10-27", "time": null, "note": "转给支付宝"}

借还的格式（对方是人，不是账户，所以是收支不是转账）：
{"amount": 200, "type": "expense", "category": "借款归还", "account": "微信", "toAccount": null, "date": "2026-10-27", "time": null, "note": "还给姐姐"}`

  const reply = await chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    /*
     * ★ 记账解析有自己的超时预算 ★
     *   解析只要抽一段 JSON，1~3 秒就够了，
     *   用 30 秒（通用值）的话，网络卡住时界面会干等很久。
     *   显式给 20 秒 —— 超时了用户重试就行，不用一直等。
     *
     *   这里是唯一显式传 timeoutMs 的地方，
     *   其它调用（AI 对话）走 settings.aiChat.timeoutMs（120 秒）。
     */
    { maxTokens: 1200, temperature: 0, thinking: false, timeoutMs: 20000 }
  )

  // ---- 提取 JSON
  let rawItems
  try {
    rawItems = extractJsonArray(reply)
  } catch (e) {
    throw new Error(`解析失败：${e.message}`)
  }

  if (rawItems.length === 0) {
    throw new Error('没有从这句话里识别出记账记录')
  }

  if (rawItems.length > MAX_ITEMS) {
    rawItems = rawItems.slice(0, MAX_ITEMS)
  }

  // ---- 逐条校验
  const items = []
  const warnings = []

  for (let i = 0; i < rawItems.length; i++) {
    const res = validateItem(rawItems[i], {
      categories: ctx.categories,
      accounts: ctx.accounts,
      tags: ctx.tags || [],
      baseDate,
      // 提示文本 = 用户原句，用来在一级分类下猜二级
      hintText: message
    })

    if (!res.ok) {
      warnings.push(`第 ${i + 1} 条已跳过：${res.reason}`)
      continue
    }

    const item = res.item

    // 账户兜底：模型没给或给的不认识 → 用默认账户
    if (!item.account_id) {
      item.account_id = ctx.defaultAccountId || (ctx.accounts[0] || {}).id || ''
      const acc = ctx.accounts.find((a) => a.id === item.account_id)
      // 防御：组合账户只能用于支出，退到第一个真实账户
      if (acc && acc.isCombo && item.type !== 'expense') {
        const real = ctx.accounts.find((a) => !a.isCombo)
        if (real) { item.account_id = real.id }
      }
      const acc2 = ctx.accounts.find((a) => a.id === item.account_id)
      item.account_name = acc2 ? acc2.name : ''
      item.accountFromAi = false
    }

    // 分类兜底：支出/收入没给分类 → 用「其他/杂项」这类兜底分类
    //   ★ 不能只认「其他」一个名字 ★
    //     默认分类改版后一级叫「其他/杂项」，
    //     而用户自己建的也可能叫「其它」「未分类」。
    //     这里按「名字含其他/杂项」来找，找不到再退到任意一个无二级的兜底分类。
    if (item.type !== 'transfer' && !item.category_id) {
      const sameType = ctx.categories.filter((c) => c.type === item.type && !c.parent_id)
      const other =
        sameType.find((c) => /其他|其它|杂项/.test(c.name)) ||
        sameType.find((c) => /未分类|不明/.test(c.name)) ||
        null
      if (other) {
        item.category_id = other.id
        item.category_name = other.name
      }
      item.categoryFromAi = false
    }

    // ★ 分类细化兜底 ★
    //   模型可能只给了一级分类（「餐饮」），而我们要求落到二级。
    //   这里再用备注 + 原句在它下面猜一个二级；猜不到才保留一级。
    if (item.type !== 'transfer' && item.category_id) {
      const cat = ctx.categories.find((c) => c.id === item.category_id)
      if (cat && !cat.parent_id) {
        const children = ctx.categories.filter((c) => c.parent_id === cat.id)
        if (children.length > 0) {
          const hint = [item.note, message].filter(Boolean).join(' ')
          const guess = guessChildByText(children, hint)
          if (guess) {
            item.category_id = guess.id
            item.category_name = guess.name
            item.categoryRefined = true
          }
        }
      }
    }

    // 备注兜底：模型没给备注时，把原句作为备注（用户要求）
    if (!item.note) {
      item.note = message
    }

    if (!item.account_id) {
      warnings.push(`第 ${i + 1} 条已跳过：没有可用账户`)
      continue
    }

    items.push(item)
  }

  if (items.length === 0) {
    throw new Error(warnings.length > 0 ? warnings[0] : '没有识别出有效的记账记录')
  }

  return { items, warnings, raw: reply }
}

/* --------------------------------------------------------- AI 对话问答 */

/**
 * 从模型回复里抠出 JSON 对象。
 *
 * 模型有时会在 JSON 外面裹一层 ```json ... ```，
 * 或者前后带一句「好的，分析如下：」。
 * 这里做几层兜底：
 *   1. 直接 JSON.parse
 *   2. 抠出第一个 {...} 再 parse
 *   3. 抠出第一个 {...} 后做一次「去掉尾逗号」的修正再 parse
 */
function extractJsonObject(text) {
  const raw = String(text || '').trim()
  if (!raw) return null

  // 1. 直接解析
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object') return obj
  } catch (e) {}

  // 2. 抠出第一个 {...}（注意别把字符串里的花括号算进去）
  const start = raw.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let escape = false
  let end = -1
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end === -1) return null

  const slice = raw.slice(start, end + 1)
  try {
    const obj = JSON.parse(slice)
    if (obj && typeof obj === 'object') return obj
  } catch (e) {}

  // 3. 去掉尾逗号再试一次
  try {
    const fixed = slice.replace(/,\s*([}\]])/g, '$1')
    const obj = JSON.parse(fixed)
    if (obj && typeof obj === 'object') return obj
  } catch (e) {}

  return null
}

/**
 * 财务问答：回答关于收入、支出、月报、周报的问题
 *
 * ★ 返回结构化结果（不是纯文本）★
 *   { text, charts, reason }
 *   text   = 回答正文（markdown）
 *   charts = 图表规格数组（只有规格，没有数字！）
 *
 * ★ 为什么不返回纯文本 ★
 *   要画图就得让模型输出结构化数据。
 *   但**绝不让模型输出数字** —— 它可能算错、可能编。
 *   所以模型只说「画哪张图」（类型/维度/标题），
 *   数字由前端拿规格去本地库取（见 api/aiChartData.js）。
 *
 * @param {Array} history  [{role, content}] 最近几轮
 * @param {object} summary 由 getAiSummary 生成的聚合数据
 * @param {object} opt { maxTokens, temperature, thinking, allowCharts }
 */
export async function askFinance(history, summary, opt = {}) {
  const allowCharts = opt.allowCharts !== false

  /**
   * ★ 提示词 ★
   *   老版把回答限制在「150 字以内、不要 markdown 标题」，
   *   那是「能答就行」的标准 —— 用户要的是**分析透彻**。
   *   现在放开长度限制，明确要求：
   *     · 先给结论，再给依据
   *     · 有对比就对比（有环比、有环比就有意义）
   *     · 能画图就画图（但只准给规格，不准自己编数字）
   */
  const chartRule = allowCharts
    ? `
5. 如果回答涉及「构成 / 占比 / 排名」这类适合看图的内容，在 charts 数组里给出图表规格。
   可用的图表类型只有三种：
   - {"type":"donut","dimension":"category","title":"本月支出构成"}     环形图：按一级分类看构成
   - {"type":"donut","dimension":"subcategory","title":"本月支出明细"}   环形图：按二级分类看构成
   - {"type":"bar","dimension":"category","title":"各类消费对比"}        条形图：分类之间比大小
   - {"type":"trend","title":"每日支出趋势","days":30}                 折线图：按天看变化
   最多给 2 张图。没有必要时就给空数组 []。`
    : `
5. 不要生成图表，charts 一律给空数组 []。`

  const system = `你是一个个人记账助手。请基于下面这份账务摘要回答用户的问题。

摘要数据（JSON）：
${JSON.stringify(summary)}

回答要求：
1. 用简洁的中文口语回答，**先给结论，再给依据**。
2. 涉及金额时用「元」为单位，保留到小数点后两位。
3. 如果摘要里没有用户问的数据，如实说「当前数据里没有这部分信息」，不要编造。
4. 回答要有分析深度：能对比就对比（环比、占比、异常值），能指出趋势就指出趋势，
   能给出结构化的建议就给出，但**不要道德说教**，不要说「建议你节约」这类空话。
5. 可以用 markdown 排版（## 标题、- 列表、**加粗**），让回答更清楚易读。
6. **只输出一个 JSON 对象**，不要在 JSON 前后加任何解释文字、不要用 markdown 代码块包裹。
   格式：
   {"text":"回答正文（markdown）","charts":[]}
   charts 里每一项是图表规格，**只写类型、维度、标题，不要写任何数字** ——
   数字会由程序从本地账本里取，你写了也会被忽略。${chartRule}`

  const messages = [
    { role: 'system', content: system },
    ...history.slice(-8)
  ]

  const reply = await chat(messages, {
    /*
     * ★ maxTokens 不写死，交给 chat() 按设置来 ★
     *   不传的话 chat() 会用 settings.aiChat.maxTokens（默认 8000）。
     *   原来这里写死 2000 —— 深度思考的推理模型光思考就吃光了，
     *   正文一个字都写不出来（content 空 + finish_reason=length）。
     */
    maxTokens: opt.maxTokens,
    temperature: opt.temperature,
    thinking: opt.thinking !== false,
    /*
     * ★ kind: 'chat' —— 告诉 chat() 这是「对话」★
     *   对话要用 settings.aiChat.timeoutMs（默认 120 秒）：
     *   深度思考 + 完整分析可能要一两分钟，
     *   用通用的 30 秒必然超时（这正是「AI 请求超时」的老大难）。
     *
     *   记账解析那边不传 kind，走通用的 30 秒。
     */
    kind: 'chat',
    timeoutMs: opt.timeoutMs
  })

  // 解析结构化结果；解析不了就把整段回复当正文显示（不能让用户看到空白）
  const obj = extractJsonObject(reply)
  if (!obj) {
    return { text: String(reply || '').trim(), charts: [], reason: '' }
  }

  const text = typeof obj.text === 'string' ? obj.text.trim() : ''
  const charts = Array.isArray(obj.charts) ? obj.charts : []

  // 正文为空但有图表 → 至少给一句提示，不能整条消息空着
  return {
    text: text || '（以上是本次查询的数据，详见下方图表）',
    charts,
    reason: ''
  }
}
