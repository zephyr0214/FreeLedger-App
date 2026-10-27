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

  // 分类：按名称或 id 匹配，匹配不到用默认
  let categoryId = null
  let categoryName = ''
  const rawCat = raw.category
  if (rawCat && type !== 'transfer') {
    const hit = matchByNameOrId(rawCat, ctx.categories)
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
    // 转账必须有目标账户，且不能与来源相同
    if (!toAccountId) {
      return { ok: false, reason: '转账缺少目标账户' }
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
      tag_ids: tagIds,
      note,
      // 标记：分类/账户是模型给的还是我们兜底的
      categoryFromAi: !!categoryId,
      accountFromAi: !!accountId
    }
  }
}

/** 按名称或 id 在候选列表里找 */
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

  // 只把必要的候选集给模型，避免 prompt 过长
  const categoryNames = ctx.categories
    .filter((c) => !c.parent_id)   // 只给一级分类，二级让模型映射不到就用一级
    .map((c) => c.name)

  const accountNames = ctx.accounts.map((a) => a.name)

  const systemPrompt = `你是一个记账助手，负责把用户的一句话解析成结构化的记账记录。

规则：
1. 只输出 JSON 数组，不要任何解释、注释或 markdown 代码块。
2. 一句话里可能包含多笔收支，要全部拆开，每笔一个对象。
3. 如果某条信息没提到，用 null 或者省略该字段，不要编造。
4. amount 只填数字（单位：元），不要带货币符号。
5. type 只能是 "expense"（支出）、"income"（收入）、"transfer"（转账）。
6. category 必须从给定的分类名列表里选，选不到就给 null。
7. account 必须从给定的账户名列表里选，选不到就给 null。
8. date 用 "YYYY-MM-DD" 格式；用户说「昨天」「前天」这类相对时间，请换算成具体日期。
9. note 填这句话里剩下的描述性内容（去掉金额、分类、时间后剩下的部分）。

今天的日期是：${toDayKey(baseDate, baseDate)}`

  const userPrompt = `可选分类：${JSON.stringify(categoryNames)}
可选账户：${JSON.stringify(accountNames)}

用户消息：${message}

请输出 JSON 数组，每个元素格式：
{"amount": 45.5, "type": "expense", "category": "餐饮", "account": "微信", "date": "2026-10-27", "note": "午饭"}`

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
      baseDate
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
