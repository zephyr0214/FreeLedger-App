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

    // 转账必须有目标账户，且不能与来源相同
    if (!toAccountId) {
      return { ok: false, reason: '转账缺少目标账户' }
    }
    if (accountId && accountId === toAccountId) {
      return { ok: false, reason: '转出与转入账户不能相同' }
    }
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
 * @param {Array} categories 全部分类（含二级）
 * @returns {Array<{id:string,label:string,type:string,isLeaf:boolean}>}
 *   label 形如「餐饮/午餐」，让模型知道归属关系
 */
export function buildCategoryOptions(categories = []) {
  const list = categories || []
  const parents = list.filter((c) => !c.parent_id)
  const out = []

  for (const p of parents) {
    const children = list.filter((c) => c.parent_id === p.id)
    if (children.length === 0) {
      // 没有二级，一级本身就是最细的粒度
      out.push({ id: p.id, label: p.name, type: p.type, isLeaf: true })
    } else {
      for (const c of children) {
        out.push({
          id: c.id,
          label: `${p.name}/${c.name}`,
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

  const accountNames = ctx.accounts.map((a) => a.name)

  const systemPrompt = `你是一个记账助手，负责把用户的一句话解析成结构化的记账记录。

规则：
1. 只输出 JSON 数组，不要任何解释、注释或 markdown 代码块。
2. 一句话里可能包含多笔收支，要全部拆开，每笔一个对象。
3. 如果某条信息没提到，用 null 或者省略该字段，不要编造。
4. amount 只填数字（单位：元），不要带货币符号。
5. type 只能是 "expense"（支出）、"income"（收入）、"transfer"（转账）。
6. category 必须从给定的分类列表里选，且**必须选最具体的那一级**（形如「餐饮/午餐」）。
   - 给的分类列表里每项都是「一级/二级」这种完整路径，直接原样填进 category 字段。
   - 不要只填一级（如「餐饮」）。若列表里只有一级分类没有二级，才填一级。
   - 选不到就给 null，不要编造分类名。
7. account 必须从给定的账户名列表里选，选不到就给 null。
8. **转账（transfer）必须同时给出转出账户 account 和转入账户 toAccount**。
   - 例：「微信转给支付宝200元」→ account="微信"，toAccount="支付宝"
   - 例：「从支付宝转到招商卡」→ account="支付宝"，toAccount="招商卡"
   - 两个字段都必须从账户名列表里选，不要编造。
   - 只有在句子明确表达了「A 转给 B」「A 转到 B」「从 A 转 B」这类方向时才用 transfer；
     如果只有一个账户出现，那是收支不是转账。
   - 转账不需要 category，给 null 即可。
9. date 用 "YYYY-MM-DD" 格式；用户说「昨天」「前天」这类相对时间，请换算成具体日期。
10. time 用 "HH:mm" 格式（24 小时制）。用户明确说了几点几分就填那个时间，
    没提时间就给 null（系统会自动记成当前时刻）。
11. note 填这句话里剩下的描述性内容（去掉金额、分类、时间后剩下的部分）。

今天的日期是：${toDayKey(baseDate, baseDate)}`

  const userPrompt = `可选分类（请原样使用列表里的完整路径）：
${categoryLabels.map((l) => `- ${l}`).join('\n')}

可选账户：${JSON.stringify(accountNames)}

用户消息：${message}

请输出 JSON 数组，每个元素格式：
{"amount": 45.5, "type": "expense", "category": "餐饮/午餐", "account": "微信", "toAccount": null, "date": "2026-10-27", "time": null, "note": "午饭"}

转账的格式：
{"amount": 200, "type": "transfer", "category": null, "account": "微信", "toAccount": "支付宝", "date": "2026-10-27", "time": null, "note": "转给支付宝"}`

  const reply = await chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    // 记账解析不需要推理过程，关掉深度思考能把响应从数秒压到 1~2 秒
    { maxTokens: 1200, temperature: 0, disableThinking: true }
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
      item.account_name = acc ? acc.name : ''
      item.accountFromAi = false
    }

    // 分类兜底：支出/收入没给分类 → 用「其他」
    if (item.type !== 'transfer' && !item.category_id) {
      const other = ctx.categories.find(
        (c) => !c.parent_id && c.name === '其他' && c.type === item.type
      )
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
 * 财务问答：回答关于收入、支出、月报、周报的问题
 *
 * @param {Array} history  [{role, content}] 最近几轮
 * @param {object} summary 由 getAiSummary 生成的聚合数据
 */
export async function askFinance(history, summary) {
  const system = `你是一个个人记账助手。请基于下面这份账务摘要回答用户的问题。

摘要数据（JSON）：
${JSON.stringify(summary)}

回答要求：
1. 用简洁的中文口语回答，直接给结论和数字。
2. 涉及金额时用「元」为单位，保留到小数点后两位。
3. 如果摘要里没有用户问的数据，如实说「当前数据里没有这部分信息」，不要编造。
4. 回答控制在 150 字以内，不要用 markdown 标题。
5. 不要道德说教，不要说「建议你节约」这类空话。`

  const messages = [
    { role: 'system', content: system },
    ...history.slice(-8)
  ]

  return chat(messages, { maxTokens: 500 })
}
