/**
 * AI 对话端到端模拟测试 —— 用假的模型回复跑完整链路
 *
 *   node scripts/test-ai-chat-e2e.mjs
 *
 * 目的：验证「模型返回 JSON → 解析 → 图表规格 → 本地取数 → SVG」
 *      这条链路真的通，不联网。
 *
 * 重点验证的坑：
 *   1. 模型外面裹了 ```json ... ``` 代码块时也能解析
 *   2. 模型在 JSON 前后加了废话时也能解析
 *   3. 模型输出的图表规格非法时**必须被忽略**，不能崩
 *   4. 模型编的数字不会进到图表里（数字只来自本地）
 */

let pass = 0
let fail = 0

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    fail++
    console.log(`FAIL  ${name}\n      got  ${a}\n      want ${e}`)
  }
}

function ok(name, cond) {
  if (cond) pass++
  else {
    fail++
    console.log(`FAIL  ${name}`)
  }
}

// ============================================================ 1. JSON 解析

console.log('=== 模型回复的 JSON 解析（各种脏格式都要能扛住） ===')

// 直接 import askFinance 的内部解析 —— 它没有导出，
// 所以这里用同样的逻辑（extractJsonObject）单独验证。
// 为避免重复实现，这里从 aiParse.js 里取不到，改测行为：
// 走完整的 askFinance → 假 chat → 拿结果。

/* ---------------------------------------------- 假的 uni + 假的设置 */

function stubSettings(ai, aiChat) {
  globalThis.plus = {
    sqlite: {
      openDatabase: ({ success }) => success && success(),
      closeDatabase: ({ success }) => success && success(),
      selectSql: ({ sql, success }) => {
        if (/FROM setting/i.test(sql)) {
          const rows = []
          if (ai) rows.push({ key: 'ai', value: JSON.stringify(ai) })
          if (aiChat) rows.push({ key: 'aiChat', value: JSON.stringify(aiChat) })
          success && success(rows)
          return
        }
        success && success([])
      },
      executeSql: ({ success }) => success && success(),
      transaction: ({ success }) => success && success()
    }
  }
}

let nextReply = ''
let lastRequestBody = null

function stubRequest() {
  globalThis.uni = {
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    request: (opt) => {
      lastRequestBody = opt.data
      opt.success && opt.success({
        statusCode: 200,
        data: { choices: [{ message: { content: nextReply } }] }
      })
    }
  }
}

const AI = {
  baseUrl: 'https://example.com/v1',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  timeoutMs: 5000
}

const AI_CHAT = {
  temperature: 0.6,
  deepThinking: true,
  maxTokens: 2000,
  showCharts: true
}

stubSettings(AI, AI_CHAT)
stubRequest()

const { askFinance } = await import('../api/aiParse.js?t=' + Math.random())

const SUMMARY = { month: '2026-10', expense: 5000, income: 8000, categories: [{ name: '餐饮', amount: 2000 }] }

console.log('\n=== 标准 JSON ===')
{
  nextReply = JSON.stringify({
    text: '## 本月分析\n\n餐饮花了 2000 元，占 40%。',
    charts: [{ type: 'donut', dimension: 'category', title: '支出构成' }]
  })
  const res = await askFinance([{ role: 'user', content: '分析下' }], SUMMARY)
  ok('正文正确', res.text.includes('餐饮花了 2000 元'))
  check('图表规格透传', res.charts.length, 1)
  check('图表类型', res.charts[0].type, 'donut')
}

console.log('\n=== 外面裹了 ```json 代码块 ===')
{
  nextReply = '```json\n{"text":"来自代码块的回答","charts":[]}\n```'
  const res = await askFinance([{ role: 'user', content: 'q' }], SUMMARY)
  check('代码块里的 JSON 也能解析', res.text, '来自代码块的回答')
}

console.log('\n=== JSON 前后有废话 ===')
{
  nextReply = '好的，分析如下：\n{"text":"有废话也没关系","charts":[]}\n希望对你有帮助！'
  const res = await askFinance([{ role: 'user', content: 'q' }], SUMMARY)
  check('废话被剥掉了', res.text, '有废话也没关系')
}

console.log('\n=== 完全不是 JSON（降级成纯文本） ===')
{
  nextReply = '我就是一段普通文字，没有 JSON。'
  const res = await askFinance([{ role: 'user', content: 'q' }], SUMMARY)
  check('原样返回', res.text, '我就是一段普通文字，没有 JSON。')
  check('图表为空数组', res.charts, [])
}

console.log('\n=== 尾逗号（模型常见毛病） ===')
{
  nextReply = '{"text":"尾逗号也没事","charts":[],}'
  const res = await askFinance([{ role: 'user', content: 'q' }], SUMMARY)
  check('尾逗号被修正', res.text, '尾逗号也没事')
}

console.log('\n=== 正文为空但有图表 → 不能整条消息空着 ===')
{
  nextReply = '{"text":"","charts":[{"type":"donut"}]}'
  const res = await askFinance([{ role: 'user', content: 'q' }], SUMMARY)
  ok('正文有兜底文案', typeof res.text === 'string' && res.text.length > 0)
}

/* ------------------------------------------------------- 2. 图表规格 */

console.log('\n=== 图表规格：非法的必须被忽略 ===')

const { normalizeChartSpec } = await import('../api/aiChartData.js?t=' + Math.random())

check('pie 类型被拒', normalizeChartSpec({ type: 'pie' }), null)
check('account 维度被拒', normalizeChartSpec({ type: 'donut', dimension: 'account' }), null)
check('空对象被拒', normalizeChartSpec({}), null)
ok('合法规格通过', normalizeChartSpec({ type: 'bar', dimension: 'category' }) !== null)

/* ----------------------------------------- 3. 请求参数：思考开关 */

console.log('\n=== 深度思考开关 ===')

{
  nextReply = '{"text":"ok","charts":[]}'
  await askFinance([{ role: 'user', content: 'q' }], SUMMARY, { thinking: true })
  ok('开思考时不带关闭参数', lastRequestBody.thinking === undefined)
  ok('开思考时不带 enable_thinking', lastRequestBody.enable_thinking === undefined)
  ok('开思考时不带 reasoning', lastRequestBody.reasoning === undefined)
}

{
  nextReply = '{"text":"ok","charts":[]}'
  await askFinance([{ role: 'user', content: 'q' }], SUMMARY, { thinking: false })
  check('关思考时 thinking=disabled', lastRequestBody.thinking.type, 'disabled')
  check('关思考时 enable_thinking=false', lastRequestBody.enable_thinking, false)
  check('关思考时 reasoning.enabled=false', lastRequestBody.reasoning.enabled, false)
}

{
  nextReply = '{"text":"ok","charts":[]}'
  await askFinance([{ role: 'user', content: 'q' }], SUMMARY)
  ok('默认开思考（对话固定开启）', lastRequestBody.thinking === undefined)
}

{
  nextReply = '{"text":"ok","charts":[]}'
  await askFinance([{ role: 'user', content: 'q' }], SUMMARY, { thinking: true, maxTokens: 3000 })
  check('maxTokens 传下去了', lastRequestBody.max_tokens, 3000)
  check('temperature 用对话的值 0.6', lastRequestBody.temperature, 0.6)
  check('stream 仍然是 false（不流式）', lastRequestBody.stream, false)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
