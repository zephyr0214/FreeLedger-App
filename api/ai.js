/**
 * AI 服务 —— 调用用户自配的大模型 API
 *
 * 约束（与计划书 §8.3 一致）：
 *   1. prompt 里只放聚合摘要，绝不塞原始交易明细
 *   2. 超时/失败一律降级为「暂不可用」，不影响任何账务功能
 *   3. 不允许 AI 直接写库
 *
 * ★ 关于「结果缓存」★
 *   原来这里有一套缓存（readCache / writeCache / hashSummary），
 *   但它服务的「首页洞察」「统计页分析」功能已经下线，
 *   而且这套缓存从来就没有调用方 —— 已经连同设置页的
 *   「清除 AI 缓存」按钮一起删掉了。
 */

import { getAllSettings } from './settings.js'

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
 *
 * @param {Array} messages [{role, content}]
 * @param {object} opt
 *   - temperature    采样随机性；不传则读 settings.aiChat.temperature
 *   - timeoutMs      超时；不传则按 kind 决定（见下面）
 *   - maxTokens      输出上限
 *   - kind           'chat' = 对话（用 settings.aiChat.timeoutMs，默认 120 秒）
 *                     不传   = 其它（用 settings.ai.timeoutMs，默认 30 秒）
 *   - thinking       是否开启「深度思考」
 *                     true  = 开启（对话页用，模型自己决定要不要推理）
 *                     false = 关闭（记账解析用，要的是快和稳）
 *                     不传  = 按 opt.disableThinking 的老逻辑（向后兼容）
 */
export async function chat(messages, opt = {}) {
  const settings = await getAllSettings()
  const ai = settings.ai || {}
  const aiChat = settings.aiChat || {}

  if (!ai.apiKey) throw new Error('未配置 API Key，请到「设置 → AI」中填写')
  if (!ai.baseUrl) throw new Error('未配置 Base URL')

  const url = `${String(ai.baseUrl).replace(/\/+$/, '')}/chat/completions`

  /**
   * ★ 超时怎么算 ★
   *   优先级：
   *     1. opt.timeoutMs       —— 调用方显式指定（记账解析走这条）
   *     2. opt.kind === 'chat' —— 对话：用 settings.aiChat.timeoutMs（120 秒）
   *     3. settings.ai.timeoutMs —— 通用（30 秒）
   *     4. 兜底 30 秒
   *
   *   ★ 为什么不能让「对话超时」无条件生效 ★
   *     settings.aiChat.timeoutMs 有默认值（120 秒），
   *     而 AI 记账也走同一个 chat()。
   *     如果无条件用 aiChat.timeoutMs，记账解析就会变成 120 秒 ——
   *     网络卡住时用户对着转圈干等两分钟。
   *     所以「用对话超时」必须由调用方**明确说这是对话**（kind: 'chat'）。
   */
  const isChat = opt.kind === 'chat'
  const timeoutMs =
    opt.timeoutMs ||
    (isChat ? aiChat.timeoutMs : 0) ||
    ai.timeoutMs ||
    30000

  const body = {
    model: ai.model || 'deepseek-chat',
    messages,
    temperature: opt.temperature !== undefined ? opt.temperature : (aiChat.temperature || 0.6),
    stream: false
  }
  if (opt.maxTokens) body.max_tokens = opt.maxTokens

  /**
   * 「深度思考」的开关。
   *
   * ★ 两套语义要分清 ★
   *   opt.thinking 明确给 true/false  → 以它为准（新的显式开关）
   *   opt.thinking 没给              → 走老的 disableThinking 逻辑
   *
   * ★ 关闭时各家的参数名不统一，这里一次性把常见的都带上 ★
   *   - DeepSeek / 多数 OpenAI 兼容网关：thinking: { type: 'disabled' }
   *   - 部分厂商：enable_thinking: false
   *   - 部分厂商：reasoning: { enabled: false }
   *   不认识的字段会被服务端忽略，不会报错。
   *
   * ★ 开启时怎么办 ★
   *   很多推理模型（deepseek-reasoner、o1、qwen-max 的思考模式等）
   *   **默认就是开思考的**，不需要传任何参数 ——
   *   传一堆「打开思考」的字段反而可能让不支持的网关报错。
   *   所以开启时我们**什么都不加**，只把关闭的参数撤掉。
   *   如果用户自己把模型名填成 deepseek-reasoner 这类推理模型，
   *   那是模型本身的行为，参数关不掉 —— 这种情况在设置页给了提示。
   */
  const thinkingEnabled = opt.thinking === undefined
    ? opt.disableThinking === false
    : !!opt.thinking

  if (!thinkingEnabled) {
    body.thinking = { type: 'disabled' }
    body.enable_thinking = false
    body.reasoning = { enabled: false }
  }

  return new Promise((resolve, reject) => {
    let settled = false
    /** 底层请求任务（超时后要主动 abort，否则请求还在跑） */
    let task = null

    /**
     * 收尾：清计时器、标记已结算。
     * ★ settled 这个闸门必须有 ★
     *   超时和请求回调可能同时到达（谁先谁后不确定），
     *   不加闸门会出现「Promise 已 reject 又 resolve」，
     *   或者重复 reject。
     */
    function finish() {
      if (settled) return false
      settled = true
      clearTimeout(timer)
      return true
    }

    const timer = setTimeout(() => {
      if (!finish()) return
      // ★ 超时后主动中断底层请求 ★
      //   不中断的话，这个请求会继续占着连接和内存，
      //   用户连着问几句就攒下一堆僵尸请求。
      try {
        if (task && typeof task.abort === 'function') task.abort()
      } catch (e) {}
      reject(new Error(`AI 请求超时（${Math.round(timeoutMs / 1000)} 秒）`))
    }, timeoutMs)

    task = uni.request({
      url,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ai.apiKey}`
      },
      data: body,
      /**
       * ★ 必须把超时值告诉 uni.request ★
       *
       *   uni.request 自己有个默认超时（各平台不一样，App 端常见 60 秒），
       *   到点会直接走 fail 回调。
       *   如果不显式设置：
       *     · 我们想给对话 120 秒，但 uni.request 60 秒就断了 → 用户看到超时
       *     · 我们想给解析 20 秒，但 uni.request 60 秒才断 → 界面干等
       *   显式传 timeout 后，两边的时间才一致。
       *
       *   ★ 还要留一点余量给我们的计时器 ★
       *     uni.request 的 timeout 是「网络层」的超时，
       *     我们的 setTimeout 是「整体」的超时。
       *     让网络层比整体晚一点点触发，
       *     这样「我们自己判定超时」总是先发生，报错信息更准
       *     （否则拿到的是 uni 的 errMsg，看不出是自己超时了）。
       */
      timeout: timeoutMs + 3000,
      success: (res) => {
        if (!finish()) return

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
        if (!finish()) return
        const msg = e && e.errMsg ? e.errMsg : '网络请求失败'
        // uni.request 自己超时了 —— 也报成我们能看懂的超时提示
        if (/timeout/i.test(msg)) {
          reject(new Error(`AI 请求超时（${Math.round(timeoutMs / 1000)} 秒）`))
          return
        }
        reject(new Error(msg))
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

/*
 * ★ 这里曾经有一套 AI 结果缓存，已经删掉了 ★
 *   它由 readCache / writeCache / hashSummary 三个函数组成，
 *   用来缓存「首页一句话洞察」「统计页分析」的结果 ——
 *   数据没变就不重新调模型，省钱省时间。
 *
 *   ★ 为什么现在没用了 ★
 *     1. 上面那两个功能（首页洞察 / 统计页分析）早就不存在了，
 *        现在只剩「AI 对话」和「AI 记账」两个入口；
 *     2. 对话是**追问式**的 —— 每一轮的问题都不一样，
 *        摘要变了、问题变了，缓存命中不了；
 *     3. 这三个函数**从来没有调用方**，也就是说 setting 表里的
 *        aiCache 这一项永远是空的。
 *
 *   所以设置页那个「清除 AI 缓存」按钮点了也没有任何实际作用，
 *   已经连同按钮一起删掉。
 */

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

/*
 * ★ 这里曾经有个 ask()，已经删掉了 ★
 *   它是「自然语言问答」的第一版实现：
 *     · 提示词限制「不超过 100 字」
 *     · 只返回纯文本，没有图表
 *     · 没有深度思考
 *   后来对话页改用 aiParse.js 的 askFinance()
 *   （结构化 JSON 返回 + 图表规格 + 更透彻的提示词 + 深度思考）。
 *
 *   两个实现并存很容易改错 —— 改了一个另一个还在跑。
 *   所以把旧的删掉，只留 askFinance 一份。
 */

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
