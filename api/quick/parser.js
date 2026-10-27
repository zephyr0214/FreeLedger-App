/**
 * 速记解析引擎 —— 把一句自然语言解析成结构化交易
 *
 * 设计原则：
 *   1. 纯函数、无 IO、可单测（分类/账户别名由调用方传入）
 *   2. 分层消除：先抽时间词（避免"5号"被当金额）→ 再抽金额 → 再匹配分类/账户/标签
 *   3. 输出 confidence + missing，由 UI 决定是直接落库还是让用户补
 *
 * 支持示例：
 *   "昨天中午吃饭四十五"      -> 45 元 餐饮 昨天
 *   "打车二十八块五"          -> 28.5 元 交通
 *   "发工资一万二"            -> 12000 收入 工资
 *   "转账五百到招商卡"        -> transfer 500 招商卡
 *   "5号交房租3500"          -> 3500 居住 5号
 */

/* ------------------------------------------------------------- 中文数字 */

const CN_DIGITS = {
  零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 贰: 2, 两: 2, 三: 3, 叁: 3,
  四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6, 七: 7, 柒: 7,
  八: 8, 捌: 8, 九: 9, 玖: 9
}

const CN_UNITS = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 }

/**
 * 中文数字转阿拉伯数字
 * 支持：四十五 / 一百二 / 一万二 / 两万五 / 十二块八
 * 注意「一百二」按中文习惯 = 120，不是 102
 */
export function chineseToNumber(str) {
  if (!str) return null
  const s = String(str).trim()

  // 纯阿拉伯数字
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)

  // 处理"万"为单位
  const wanIndex = s.indexOf('万')
  if (wanIndex > -1) {
    const before = s.slice(0, wanIndex)
    const after = s.slice(wanIndex + 1)
    const b = parseUnderWan(before)
    if (b === null) return null
    let tail = 0
    if (after) {
      // 「一万二」= 12000，即"二"表示 2000
      const afterNum = parseUnderWan(after)
      if (afterNum !== null) {
        // 若 after 无单位且只有一位，视为千位
        tail = /^[零〇一二三四五六七八九两]$/.test(after) ? afterNum * 1000 : afterNum
      }
    }
    return b * 10000 + tail
  }

  return parseUnderWan(s)
}

function parseUnderWan(s) {
  if (!s) return 0
  // 纯数字
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)

  let total = 0
  let section = 0
  let number = 0
  let lastUnit = 0
  let hasUnit = false

  for (const ch of s) {
    if (CN_DIGITS[ch] !== undefined) {
      number = CN_DIGITS[ch]
    } else if (CN_UNITS[ch] !== undefined) {
      hasUnit = true
      const unit = CN_UNITS[ch]
      if (number === 0) number = 1  // 「十五」的"十"前面省略了"一"
      section += number * unit
      number = 0
      lastUnit = unit
    } else if (ch === '块' || ch === '元' || ch === '毛' || ch === '分') {
      // 交给调用方处理
    } else if (ch === '点') {
      continue
    } else {
      // 遇到无法识别的字符，返回已知部分
      break
    }
  }

  total = section + number

  // 「一百二」= 120：末尾的单个数字若小于 lastUnit，视为下一位
  if (hasUnit && number > 0 && lastUnit >= 100 && number < 10) {
    total = section + number * (lastUnit / 10)
  }

  return total
}

/* ---------------------------------------------------------------- 金额 */

/**
 * 从文本中提取金额（返回 {cents, rest, matched}）
 * rest 是移除金额片段后的剩余文本，供后续分类匹配
 */
export function extractAmount(text) {
  let rest = text
  let cents = null
  let matched = ''

  // 1) 「X块Y」/「X元Y」/「X块Y毛」的形式：12块8 = 12.8
  const kuaPattern = /([零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+|\d+(?:\.\d+)?)\s*[块元]\s*([零〇一二三四五六七八九两\d])\s*[毛角]?/
  let m = rest.match(kuaPattern)
  if (m) {
    const yuanPart = chineseToNumber(m[1])
    const jiaoPart = chineseToNumber(m[2])
    if (yuanPart !== null && jiaoPart !== null) {
      cents = Math.round(yuanPart * 100) + Math.round(jiaoPart * 10)
      matched = m[0]
      rest = rest.replace(m[0], ' ')
      return { cents, rest, matched }
    }
  }

  // 2) 「X点Y元」小数形式：28.5 元 / 二十八点五
  const decimalPattern = /(\d+)\.(\d{1,2})\s*[块元]?/
  m = rest.match(decimalPattern)
  if (m) {
    cents = Math.round(Number(m[1]) * 100) + Math.round(Number(m[2].padEnd(2, '0')))
    matched = m[0]
    rest = rest.replace(m[0], ' ')
    return { cents, rest, matched }
  }

  // 3) 「X万Y」：一万二 = 12000
  const wanPattern = /([一二三四五六七八九两\d])\s*万\s*([一二三四五六七八九两\d]?)/
  m = rest.match(wanPattern)
  if (m) {
    const base = chineseToNumber(m[1])
    const tail = m[2] ? chineseToNumber(m[2]) : 0
    if (base !== null) {
      cents = Math.round((base * 10000 + (tail || 0) * 1000) * 100)
      matched = m[0]
      rest = rest.replace(m[0], ' ')
      return { cents, rest, matched }
    }
  }

  // 4) 阿拉伯数字 + 可选单位：3500 / 3500元 / 3500块
  const plainPattern = /(\d+(?:\.\d{1,2})?)\s*([块元]?)/
  m = rest.match(plainPattern)
  if (m) {
    const num = Number(m[1])
    if (Number.isFinite(num) && num > 0) {
      cents = Math.round(num * 100)
      matched = m[0]
      rest = rest.replace(m[0], ' ')
      return { cents, rest, matched }
    }
  }

  // 5) 中文数字 + 单位（必须有单位，否则容易误判，如"三个人"）
  const cnPattern = /([零〇一二三四五六七八九十百千万两]{1,8})\s*[块元]/
  m = rest.match(cnPattern)
  if (m) {
    const num = chineseToNumber(m[1])
    if (num !== null && num > 0) {
      cents = Math.round(num * 100)
      matched = m[0]
      rest = rest.replace(m[0], ' ')
      return { cents, rest, matched }
    }
  }

  // 6) 纯中文数字（无单位）—— 仅在整句较短时使用，避免"三个人"误判
  if (rest.replace(/\s/g, '').length <= 8) {
    const pureCn = rest.match(/([零〇一二三四五六七八九十百千万两]{2,8})/)
    if (pureCn) {
      const num = chineseToNumber(pureCn[1])
      if (num !== null && num > 0) {
        cents = Math.round(num * 100)
        matched = pureCn[0]
        rest = rest.replace(pureCn[0], ' ')
        return { cents, rest, matched }
      }
    }
  }

  return { cents: null, rest, matched: '' }
}

/* ---------------------------------------------------------------- 时间 */

const TIME_WORD_MAP = {
  今天: 0, 今儿: 0, 今日: 0,
  昨天: -1, 昨儿: -1, 昨日: -1,
  前天: -2,
  大前天: -3,
  明天: 1
}

const PERIOD_HINT = {
  早上: 8, 早晨: 8, 上午: 9, 中午: 12, 下午: 15,
  傍晚: 18, 晚上: 20, 晚: 20, 夜里: 22, 深夜: 23, 凌晨: 3
}

/**
 * 提取时间，返回 {ts, dayKey, rest}
 * 支持：今天/昨天/前天/大前天 + 上午中午晚上 + 5号 + 3月5日
 */
export function extractTime(text, baseDate = new Date()) {
  let rest = text
  let dayOffset = null
  let explicitDay = null
  let hour = null

  // 相对日
  for (const [word, offset] of Object.entries(TIME_WORD_MAP)) {
    if (rest.includes(word)) {
      dayOffset = offset
      rest = rest.replace(word, ' ')
      break
    }
  }

  // 「5号」/「5日」（必须在金额提取之前处理，否则会被当金额）
  if (dayOffset === null) {
    const dayMatch = rest.match(/(\d{1,2})\s*[号日]/)
    if (dayMatch) {
      const d = Number(dayMatch[1])
      if (d >= 1 && d <= 31) {
        explicitDay = d
        rest = rest.replace(dayMatch[0], ' ')
      }
    }
  }

  // 「3月5日」
  const mdMatch = rest.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/)
  if (mdMatch) {
    explicitDay = { month: Number(mdMatch[1]), day: Number(mdMatch[2]) }
    rest = rest.replace(mdMatch[0], ' ')
  }

  // 时段
  for (const [word, h] of Object.entries(PERIOD_HINT)) {
    if (rest.includes(word)) {
      hour = h
      rest = rest.replace(word, ' ')
      break
    }
  }

  // 计算最终时间
  const d = new Date(baseDate)
  if (dayOffset !== null) {
    d.setDate(d.getDate() + dayOffset)
  } else if (explicitDay !== null) {
    if (typeof explicitDay === 'object') {
      d.setMonth(explicitDay.month - 1)
      d.setDate(explicitDay.day)
      // 若指定的月份已过，视为明年
      if (d > baseDate) d.setFullYear(d.getFullYear() - 1)
    } else {
      const today = baseDate.getDate()
      // 指定的日期若大于今天，认为指的是上个月
      if (explicitDay > today) {
        d.setMonth(d.getMonth() - 1)
      }
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      d.setDate(Math.min(explicitDay, lastDay))
    }
  }

  if (hour !== null) {
    d.setHours(hour, 0, 0, 0)
  }

  return { ts: d.getTime(), rest, hasTime: dayOffset !== null || explicitDay !== null }
}

/* ---------------------------------------------------------------- 类型 */

const INCOME_WORDS = ['发工资', '工资', '到账', '收入', '退款', '报销', '奖金', '收到', '红包收', '分红', '利息', '进账', '赚']
const TRANSFER_WORDS = ['转账', '转给', '还信用卡', '还花呗', '还借', '还款', '转到', '充']

export function detectType(text) {
  // 转账优先级最高（"还信用卡"必须识别为 transfer，不能是 expense）
  for (const w of TRANSFER_WORDS) {
    if (text.includes(w)) return 'transfer'
  }
  for (const w of INCOME_WORDS) {
    if (text.includes(w)) return 'income'
  }
  return 'expense'
}

/* ---------------------------------------------------------- 分类/账户/标签 */

/**
 * 匹配分类
 * @param {string} text
 * @param {Array} categories [{id, name, parent_id}]
 * @param {object} aliasMap { 分类名: [别名...] }
 * @param {string} type
 */
export function matchCategory(text, categories, aliasMap = {}, type = 'expense') {
  const pool = categories.filter((c) => c.type === type)
  let best = null
  let bestScore = 0

  for (const cat of pool) {
    let score = 0
    // 名称直接命中
    if (text.includes(cat.name)) score = cat.name.length * 10

    // 别名命中
    const aliases = aliasMap[cat.name] || []
    for (const alias of aliases) {
      if (text.includes(alias) && alias.length > 1) {
        const s = alias.length * 5
        if (s > score) score = s
      }
    }

    if (score > bestScore) {
      bestScore = score
      best = cat
    }
  }

  return { category: best, score: bestScore }
}

/** 匹配账户 */
export function matchAccount(text, accounts) {
  let best = null
  let bestScore = 0

  for (const acc of accounts) {
    let score = 0

    // 名称命中
    if (text.includes(acc.name)) score = acc.name.length * 10

    // 卡号后四位
    if (acc.card_tail && text.includes(String(acc.card_tail))) {
      score = Math.max(score, 30)
    }

    // 类型关键字
    const typeKeywords = {
      wechat: ['微信', 'weixin', 'wx'],
      alipay: ['支付宝', '花呗', '余额宝', 'zfb'],
      credit: ['信用卡', '刷卡', '透支'],
      debit: ['储蓄卡', '银行卡'],
      cash: ['现金', '付现'],
      huabei: ['花呗']
    }
    const kws = typeKeywords[acc.type] || []
    for (const kw of kws) {
      if (text.includes(kw)) score = Math.max(score, kw.length * 6)
    }

    if (score > bestScore) {
      bestScore = score
      best = acc
    }
  }

  return { account: best, score: bestScore }
}

/** 匹配标签 */
export function matchTags(text, tags) {
  const hits = []
  for (const tag of tags) {
    if (tag.name && text.includes(tag.name)) hits.push(tag.id)
  }
  return hits
}

/* -------------------------------------------------------------- 主入口 */

/**
 * @param {string} text 用户输入
 * @param {object} ctx {
 *   categories: [], accounts: [], tags: [],
 *   aliasMap: {}, defaultAccountId: '', defaultCategoryId: '',
 *   baseDate: Date
 * }
 * @returns {object} 解析结果
 */
export function parseQuickInput(text, ctx) {
  const raw = String(text || '').trim()
  const {
    categories = [],
    accounts = [],
    tags = [],
    aliasMap = {},
    defaultAccountId = '',
    defaultCategoryId = '',
    baseDate = new Date()
  } = ctx || {}

  if (!raw) {
    return emptyResult(raw)
  }

  // 1) 先抽时间（"5号"必须先于金额被拿走）
  const timeRes = extractTime(raw, baseDate)
  let work = timeRes.rest

  // 2) 类型判断（在抽取金额前，避免"还信用卡2000"被当成收入）
  const type = detectType(raw)

  // 3) 抽金额
  const amountRes = extractAmount(work)
  const cents = amountRes.cents
  work = amountRes.rest

  // 4) 匹配分类
  const { category } = matchCategory(work, categories, aliasMap, type === 'transfer' ? 'expense' : type)

  // 5) 匹配账户
  const { account } = matchAccount(work, accounts)

  // 转账时，"到XX"的目标账户
  let toAccount = null
  if (type === 'transfer') {
    const toMatch = raw.match(/(?:到|去|给)\s*([^\s，,。]+?)(?:\s|$)/)
    if (toMatch) {
      const seg = toMatch[1]
      const hit = matchAccount(seg, accounts)
      if (hit.account) toAccount = hit.account
    }
    // 若没匹配到目标账户，把原账户视为来源
    if (account && toAccount && account.id === toAccount.id) toAccount = null
  }

  // 6) 匹配标签
  const tagIds = matchTags(raw, tags)

  // 7) 剩余文本作为备注
  const note = work
    .replace(/[，,。.、]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // 8) 置信度
  let confidence = 0
  const missing = []

  if (cents && cents > 0) confidence += 0.5
  else missing.push('amount')

  if (category) confidence += 0.25
  else if (type === 'transfer') confidence += 0.25  // 转账不需要分类
  else missing.push('category')

  if (account) confidence += 0.15
  else missing.push('account')

  if (timeRes.hasTime) confidence += 0.10
  else if (!missing.includes('time')) missing.push('time')

  // 转账必须有目标账户
  if (type === 'transfer' && !toAccount) {
    confidence -= 0.2
    missing.push('toAccount')
  }

  confidence = Math.max(0, Math.min(1, Math.round(confidence * 100) / 100))

  // 低于阈值时用默认值补齐
  const finalAccountId = account ? account.id : (defaultAccountId || '')
  const finalCategoryId = type === 'transfer' ? null : (category ? category.id : (defaultCategoryId || ''))

  if (!account && defaultAccountId) {
    const idx = missing.indexOf('account')
    if (idx > -1) missing.splice(idx, 1)
    confidence = Math.min(1, confidence + 0.05)
  }

  // 兜底：浮点累加会出现 0.15000000000000002 这类值，统一归一化
  confidence = Math.round(confidence * 100) / 100

  return {
    raw,
    amount_cents: cents || 0,
    type,
    category_id: finalCategoryId,
    category_name: category ? category.name : '',
    account_id: finalAccountId,
    account_name: account ? account.name : '',
    to_account_id: toAccount ? toAccount.id : null,
    to_account_name: toAccount ? toAccount.name : '',
    tag_ids: tagIds,
    note,
    occurred_at: timeRes.ts,
    occurred_day: formatDayKey(new Date(timeRes.ts)),
    confidence,
    missing,
    canSubmit: !!(cents && cents > 0 && (type === 'transfer' ? toAccount : true))
  }
}

function emptyResult(raw) {
  return {
    raw,
    amount_cents: 0,
    type: 'expense',
    category_id: '',
    category_name: '',
    account_id: '',
    account_name: '',
    to_account_id: null,
    to_account_name: '',
    tag_ids: [],
    note: '',
    occurred_at: Date.now(),
    occurred_day: formatDayKey(new Date()),
    confidence: 0,
    missing: ['amount', 'category', 'account'],
    canSubmit: false
  }
}

function formatDayKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const __internals = { chineseToNumber, extractAmount, extractTime, detectType }
