/**
 * AI 服务 —— 调用用户自配的大模型 API
 *
 * 约束（与计划书 §8.3 一致）：
 *   1. prompt 里只放聚合摘要，绝不塞原始交易明细
 *   2. 结果按 hash(区间+数据) 缓存到本地，数据不变不重算
 *   3. 超时/失败一律降级为「暂不可用」，不影响任何账务功能
 *   4. 不允许 AI 直接写库
 */

import { getSetting, setSetting, getAllSettings } from './settings.js'
import { getAiSummary, getAiSummaryRange } from './stats.js'

const CACHE_KEY = 'aiCache'

/* ------------------------------------------------------------- 底层调用 */

/**
 * 从响应里取出正文。
 *
 * ★ 为什么不能直接读 choices[0].message.content ★
 *   不同网关 / 不同模型的返回形状差别很大，直接读会踩这些坑：
 *     1. max_tokens 被截断时 content 可能是 null 或空串
 *     2. 推理模型（deepseek-reasoner 这类）正文在 reasoning_content 里，
 *        content 是空的 —— 只看 content 就会误判成「格式异常」
 *     3. 部分网关返回 Anthropic 风格的分段数组：
 *        content: [{ type: 'text', text: '...' }, ...]
 *   这些都当成「格式异常」抛掉的话，用户只会看到一句莫名其妙的报错，
 *   完全不知道是模型没配好还是网络问题。
 *
 * @param {object} data 响应体
 * @returns {{text: string, reason: string}} text 为空时 reason 说明原因
 */
function extractContent(data) {
  const choice = data && data.choices && data.choices[0]
  const msg = choice && choice.message

  if (!msg) {
    return { text: '', reason: '响应里没有 choices/message' }
  }

  let raw = msg.content

  // Anthropic 风格的分段数组
  if (Array.isArray(raw)) {
    raw = raw
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part.text === 'string') return part.text
        return ''
      })
      .join('')
  }

  // 推理模型：正文可能在 reasoning_content
  if ((typeof raw !== 'string' || raw.trim() === '') && typeof msg.reasoning_content === 'string') {
    raw = msg.reasoning_content
  }

  const text = typeof raw === 'string' ? raw.trim() : ''

  if (text) return { text, reason: '' }

  // 空正文时给出能看懂的原因
  if (choice && choice.finish_reason === 'length') {
    return { text: '', reason: '模型输出被 max_tokens 截断（正文为空）' }
  }
  if (choice && choice.finish_reason === 'content_filter') {
    return { text: '', reason: '内容被服务端过滤' }
  }
  return { text: '', reason: '模型返回了空正文' }
}

/**
 * 统一的 chat completion 调用
 * @param {Array} messages [{role, content}]
 * @param {object} opt { temperature, timeoutMs, maxTokens }
 */
export async function chat(messages, opt = {}) {
  const settings = await getAllSettings()
  const ai = settings.ai || {}

  if (!ai.apiKey) throw new Error('未配置 API Key，请到「设置 → AI」中填写')
  if (!ai.baseUrl) throw new Error('未配置 Base URL')

  const url = `${String(ai.baseUrl).replace(/\/+$/, '')}/chat/completions`
  const timeoutMs = opt.timeoutMs || ai.timeoutMs || 20000

  const body = {
    model: ai.model || 'deepseek-chat',
    messages,
    temperature: opt.temperature !== undefined ? opt.temperature : (ai.temperature || 0.3),
    stream: false
  }
  if (opt.maxTokens) body.max_tokens = opt.maxTokens

  /**
   * 关闭「深度思考」以降低延迟。
   *
   * 各家参数名不统一，这里一次性把常见的都带上：
   *   - DeepSeek / 多数 OpenAI 兼容网关：thinking: { type: 'disabled' }
   *   - 部分厂商：enable_thinking: false
   *   - 部分厂商：reasoning: { enabled: false }
   * 不认识的字段会被服务端忽略，不会报错。
   *
   * 另外：如果用户自己把模型名填成 deepseek-reasoner 这类推理模型，
   * 那是模型本身的行为，参数关不掉 —— 这种情况在设置页给了提示。
   */
  if (opt.disableThinking !== false) {
    body.thinking = { type: 'disabled' }
    body.enable_thinking = false
    body.reasoning = { enabled: false }
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error('AI 请求超时'))
      }
    }, timeoutMs)

    uni.request({
      url,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ai.apiKey}`
      },
      data: body,
      success: (res) => {
        if (settled) return
        settled = true
        clearTimeout(timer)

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const msg = extractError(res)
          reject(new Error(msg))
          return
        }

        const { text, reason } = extractContent(res.data)
        if (!text) {
          reject(new Error(`AI 返回内容为空：${reason}`))
          return
        }
        resolve(text)
      },
      fail: (e) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(e.errMsg || '网络请求失败'))
      }
    })
  })
}

function extractError(res) {
  if (res.statusCode === 401) return 'API Key 无效或已过期 (401)'
  if (res.statusCode === 404) return '接口地址或模型名不存在 (404)'
  if (res.statusCode === 429) return '请求过于频繁或额度用尽 (429)'
  const detail = res.data?.error?.message || res.data?.message || ''
  return `AI 请求失败 (${res.statusCode})${detail ? ': ' + detail : ''}`
}

/** 连通性测试 */
export async function testConnection() {
  const reply = await chat(
    [
      { role: 'system', content: '你是一个测试助手。' },
      { role: 'user', content: '回复"ok"两个字母即可。' }
    ],
    { maxTokens: 16, temperature: 0, timeoutMs: 15000 }
  )
  return { ok: true, reply: reply.slice(0, 50) }
}

/* ------------------------------------------------------------------ 缓存 */

async function readCache() {
  const raw = await getSetting(CACHE_KEY, {})
  return raw && typeof raw === 'object' ? raw : {}
}

async function writeCache(cache) {
  // 只保留最近 50 条，防止无限增长
  const keys = Object.keys(cache)
  if (keys.length > 50) {
    keys
      .sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0))
      .slice(0, keys.length - 50)
      .forEach((k) => delete cache[k])
  }
  await setSetting(CACHE_KEY, cache)
}

/** 由数据生成哈希，用于判断是否需要重算 */
function hashSummary(summary) {
  const s = JSON.stringify(summary)
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return String(h)
}

/* -------------------------------------------------------- 首页一句话洞察 */

/**
 * 首页 AI 洞察：一句结论，≤40 字
 * @param {string} monthKey
 * @param {boolean} force 强制刷新
 */


/* ------------------------------------------------------ 统计页 AI 分析 */

/**
 * 统计页分析：3~5 句 + 2 条建议
 */


/**
 * 统计页分析（任意日期区间版）
 *
 * 1. 摘要数据来自 getAiSummaryRange（区间口径，而非固定某个月）
 * 2. 缓存 key 用 label + 摘要 hash，label 缺省时退化为摘要 hash
 * 3. prompt 措辞中性化，不写死「这个月」
 *
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @param {string} label 展示文案，如 '2026年10月'；可缺省
 * @param {boolean} force 强制刷新
 */


/* ------------------------------------------------------------ 对话 */

/**
 * 自然语言问答
 * @param {Array} history [{role, content}]
 */
export async function ask(history, monthKey) {
  const summary = await getAiSummary(monthKey)

  const system = `你是用户的个人记账助手。你只能基于下面这份本月账务摘要回答，摘要里没有的信息要如实说"数据里没有"。

本月摘要：${JSON.stringify(summary)}

回答要求：简洁口语化，中文，不要说教，不超过 100 字。`

  const messages = [
    { role: 'system', content: system },
    ...history.slice(-6)  // 只带最近 3 轮，控制 Token
  ]

  return chat(messages, { maxTokens: 300 })
}

/* ------------------------------------------------ 速记解析的 AI 兜底 */

/**
 * ⚠️ 当前**没有任何调用方**，属于死代码，保留以备将来恢复两段式设计。
 *
 * ★ 为什么现在不用它 ★
 *   当初的设计是「本地规则引擎先解析，解析不了再交给 AI 兜底」，
 *   所以有了这个函数和设置页那个「速记 AI 兜底」开关。
 *   后来速记改成直接走 api/aiParse.js（它内部就调模型），
 *   规则引擎那一段已经不在了 ——
 *   于是这个函数和那个开关都变成了摆设：开了也不会有任何效果。
 *
 *   死开关比没开关更糟，用户会以为自己开了个功能。
 *   所以设置页那个开关已经删掉，这个函数保留但加了这行说明。
 *
 * 如果将来真要做「本地优先、AI 兜底」，
 * 在这里接上即可（参数 ctx 的结构见 aiParse.js 的 parseMessageToTransactions）。
 */
export async function parseQuickWithAi(text, candidates) {
  // 分类同样只给「叶子分类」，让模型选到最细的一级
  const categoryLabels = (candidates.categories || []).map((c) => {
    if (c.parent_id) {
      const parent = (candidates.categories || []).find((p) => p.id === c.parent_id)
      return parent ? `${parent.name}/${c.name}` : c.name
    }
    return c.name
  })

  const prompt = `把下面这句记账口语解析成 JSON，只输出 JSON，不要任何解释。

句子：${text}

可选分类（请原样使用完整路径，必须选最具体的那一级）：
${JSON.stringify(categoryLabels)}
可选账户：${JSON.stringify(candidates.accounts.map((a) => a.name))}

输出格式（金额单位元，数字）：
{"amount": 45.5, "type": "expense|income|transfer", "category": "分类完整路径或null", "account": "账户名或null", "toAccount": "目标账户名或null", "dayOffset": 0, "note": "备注"}`

  const reply = await chat([
    { role: 'system', content: '你是一个严谨的 JSON 生成器，只输出合法 JSON。' },
    { role: 'user', content: prompt }
  ], { maxTokens: 200, temperature: 0 })

  // 剥离可能的 markdown 代码块
  const cleaned = reply.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI 未返回有效 JSON')

  return JSON.parse(jsonMatch[0])
}

/** 清除缓存（设置页提供） */
export async function clearAiCache() {
  await setSetting('aiCache', {})
  return true
}
