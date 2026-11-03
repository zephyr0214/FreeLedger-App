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
 * ★ 截断时还要把「思考内容」带出来 ★
 *   推理模型被 max_tokens 截断时，典型现象是：
 *     · reasoning_content 有内容（想了一半）
 *     · content 是空的（正文一个字没输出）
 *     · finish_reason = 'length'
 *   这时候直接把整个响应丢掉、只报一句「内容为空」，
 *   用户完全不知道发生了什么、也不知道该怎么办。
 *   所以把 reasoning_content 也返回去（作为「思考过程」），
 *   上层可以据此给出更准确的提示。
 *
 * @param {object} data 响应体
 * @returns {{text: string, reason: string, reasoning: string, truncated: boolean}}
 *   text 为空时 reason 说明原因；reasoning 是模型的思考内容（可能为空）
 */
function extractContent(data) {
  const choice = data && data.choices && data.choices[0]
  const msg = choice && choice.message

  if (!msg) {
    return { text: '', reason: '响应里没有 choices/message', reasoning: '', truncated: false }
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

  // 推理模型的思考内容（正文被截断时，靠它才知道模型其实想说什么）
  const reasoning = typeof msg.reasoning_content === 'string' ? msg.reasoning_content.trim() : ''

  /*
   * ★ 推理内容不能当正文用 ★
   *   早先这里是「content 为空就拿 reasoning_content 顶上」，
   *   结果推理模型被 max_tokens 截断时，
   *   用户看到的是一段**半截的思考过程**（像是胡言乱语），
   *   而不是「回答被截断了」这个能指导他行动的信息。
   *
   *   而且这样一来，上层根本判断不出「被截断了」，
   *   也就没机会加大预算重试。
   *
   *   所以：content 为空 + finish_reason=length → 明确报「被截断」，
   *   reasoning_content 只作为诊断信息带出去。
   */
  const truncated = !!(choice && choice.finish_reason === 'length')

  const text = typeof raw === 'string' ? raw.trim() : ''

  if (text) return { text, reason: '', reasoning, truncated: false }

  // 空正文时给出能看懂的原因
  if (truncated) {
    return {
      text: '',
      reason: '模型输出被 max_tokens 截断（正文为空）',
      reasoning,
      truncated: true
    }
  }
  if (choice && choice.finish_reason === 'content_filter') {
    return { text: '', reason: '内容被服务端过滤', reasoning, truncated: false }
  }

  /*
   * 不是被截断，但 content 也是空的。
   * 这时候 reasoning_content 里往往真的有正文
   * （有些网关把正文放在 reasoning_content 里）。
   * 所以这时候才用它顶上。
   */
  if (reasoning) {
    return { text: reasoning, reason: '', reasoning, truncated: false }
  }

  return { text: '', reason: '模型返回了空正文', reasoning, truncated: false }
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
   *     1. opt.timeoutMs       —— 调用方显式指定（连通性测试 15 秒走这条）
   *     2. opt.kind === 'chat' —— 对话：用 settings.aiChat.timeoutMs（120 秒）
   *     3. settings.ai.timeoutMs —— 通用（30 秒）
   *        ★ 记账解析走这条 ★：解析不传 timeoutMs，
   *        设置页的「记账解析超时（秒）」真实生效（以前这里被
   *        硬编码 20 秒顶掉，设置字段是个摆设 —— 用户反馈后已修）。
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

  /**
   * ★ 初始的 max_tokens ★
   *   对话走 settings.aiChat.maxTokens（默认 8000）。
   *
   *   ★ 为什么不能太小 ★
   *     max_tokens 同时限制了「思考」和「正文」。
   *     推理模型（deepseek-reasoner 这类）思考几千 token 是常事 ——
   *     预算给小了，模型「想」完就没额度写正文，
   *     于是 content 全空、finish_reason=length，
   *     用户看到「AI 返回内容为空：模型输出被 max_tokens 截断」。
   *
   *   ★ 兜底值从 2000 提到 8000 ★
   *     原来的 2000 对开着深度思考的推理模型远远不够。
   */
  const initialMaxTokens =
    opt.maxTokens ||
    (isChat ? aiChat.maxTokens : 0) ||
    0

  const body = {
    model: ai.model || 'deepseek-chat',
    messages,
    temperature: opt.temperature !== undefined ? opt.temperature : (aiChat.temperature || 0.6),
    stream: false
  }

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

  /**
   * 发一次请求。
   *
   * @param {number} maxTokens 本次的 max_tokens
   * @returns {Promise<{text: string, reasoning: string, truncated: boolean}>}
   *   正常返回正文；被截断时 text 为空、truncated 为 true
   */
  function requestOnce(maxTokens) {
    const reqBody = { ...body }
    if (maxTokens) reqBody.max_tokens = maxTokens
    else delete reqBody.max_tokens

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
        const timeoutErr = new Error(`AI 请求超时（${Math.round(timeoutMs / 1000)} 秒）`)
        timeoutErr.isTimeout = true   // 上层重试判断用：超时不重试（每次都要烧满整个预算）
        reject(timeoutErr)
      }, timeoutMs)

      task = uni.request({
        url,
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ai.apiKey}`
        },
        data: reqBody,
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
         * ★ 还要留一点余量给我们的计时器 ★
         *   uni.request 的 timeout 是「网络层」的超时，
         *   我们的 setTimeout 是「整体」的超时。
         *   让网络层比整体晚一点点触发，
         *   这样「我们自己判定超时」总是先发生，报错信息更准
         *   （否则拿到的是 uni 的 errMsg，看不出是自己超时了）。
         */
        timeout: timeoutMs + 3000,
        success: (res) => {
          if (!finish()) return

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const msg = extractError(res)
            const err = new Error(msg)
            /*
             * ★ 把状态码结构化地带出去 ★
             *   上层的重试判断要靠它区分「临时故障」和「重试也没用」：
             *   429 / 5xx 值得再试；401 / 404 / 400 重试一万次结果一样。
             *   错误文案不变（extractError 里的中文照旧给用户看）。
             */
            err.status = res.statusCode
            reject(err)
            return
          }

          const r = extractContent(res.data)
          if (!r.text) {
            /*
             * ★ 把「被截断」这个信息带出去 ★
             *   上层要靠 truncated 判断要不要加大预算重试，
             *   也要靠它给用户一句能看懂的提示
             *   （而不是干巴巴的「内容为空」）。
             */
            const err = new Error(`AI 返回内容为空：${r.reason}`)
            err.truncated = r.truncated
            err.reasoning = r.reasoning
            reject(err)
            return
          }
          resolve(r)
        },
        fail: (e) => {
          if (!finish()) return
          const msg = e && e.errMsg ? e.errMsg : '网络请求失败'
          // uni.request 自己超时了 —— 也报成我们能看懂的超时提示
          if (/timeout/i.test(msg)) {
            const timeoutErr = new Error(`AI 请求超时（${Math.round(timeoutMs / 1000)} 秒）`)
            timeoutErr.isTimeout = true
            reject(timeoutErr)
            return
          }
          // 其余网络层失败（DNS / 断网 / 连接被拒）—— 临时性故障，标记出去供重试判断
          const failErr = new Error(msg)
          failErr.networkFail = true
          reject(failErr)
        }
      })
    })
  }

  /**
   * ★ 截断了就加大预算重试一次 ★
   *
   *   为什么要有这层兜底：
   *     max_tokens 同时限制「思考」和「正文」，
   *     推理模型思考起来很容易把预算吃光 ——
   *     而「模型想了多少」我们事先根本猜不准。
   *     所以第一次被截断时，**把预算翻一倍再试一次**，
   *     比直接报错给用户友好得多。
   *
   *   只重试一次，避免无限循环烧额度。
   *   记账解析那边不重试（opt.retryOnTruncate 为 false）——
   *   解析要的是快，重试一遍反而更慢。
   */
  const canRetry = opt.retryOnTruncate !== false && isChat
  let result
  try {
    result = await requestOnce(initialMaxTokens)
  } catch (e) {
    if (!e || !e.truncated || !canRetry) throw e

    /*
     * ★ 重试时把预算翻倍 ★
     *   上限 32K —— 再大就没意义了（模型本身也用不了那么多），
     *   而且万一用户模型不支持这么大的 max_tokens，
     *   服务端会直接报错（400），那就白重试了。
     */
    const bigger = Math.min(32000, Math.max((initialMaxTokens || 4000) * 2, 8000))
    console.warn(
      `[ai] 回答被 max_tokens 截断（用了 ${initialMaxTokens}），` +
      `加大到 ${bigger} 重试`
    )
    result = await requestOnce(bigger)
  }

  return result.text
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
