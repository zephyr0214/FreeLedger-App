/**
 * AI 回答被 max_tokens 截断的处理测试
 *
 *   node scripts/test-ai-truncate.mjs
 *
 * 背景（用户反馈「AI 返回内容为空：模型输出被 max_tokens 截断（正文为空）」）
 *
 *   ★ 根因 ★
 *     max_tokens 同时限制了「思考」和「正文」。
 *     推理模型（deepseek-reasoner 这类）的推理过程本身就要吃掉
 *     几千 token —— 预算给小了，模型「想」完就没额度写正文：
 *       · content 为空
 *       · reasoning_content 有内容（想了一半）
 *       · finish_reason = 'length'
 *     我们只给了 2000，所以一开口就撞墙。
 *
 *   修法：
 *     1. 默认 maxTokens 2000 → 8000
 *     2. 被截断时自动把预算翻倍重试一次
 *     3. 截断信息（truncated / reasoning）从底层带到界面
 *     4. 界面上给一句能指导用户行动的话
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

/**
 * 假的服务端：
 *   · maxTokens 小 → 返回「被截断」的响应
 *   · maxTokens 大 → 返回正常正文
 */
let lastMaxTokens = 0
let requestCount = 0
const TRUNCATE_AT = 3000

function stubServer() {
  globalThis.uni = {
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    request: (opt) => {
      requestCount++
      const mt = opt.data.max_tokens || 0
      lastMaxTokens = mt
      if (mt && mt < TRUNCATE_AT) {
        // 被截断：思考写了一半，正文一个字没有
        opt.success && opt.success({
          statusCode: 200,
          data: {
            choices: [{
              message: { content: '', reasoning_content: '让我想想这个月餐饮花了多少……' },
              finish_reason: 'length'
            }]
          }
        })
      } else {
        opt.success && opt.success({
          statusCode: 200,
          data: { choices: [{ message: { content: '{"text":"完整回答","charts":[]}' } }] }
        })
      }
      return { abort: () => {} }
    }
  }
}

const AI = {
  baseUrl: 'https://example.com/v1',
  apiKey: 'sk-test',
  model: 'deepseek-reasoner',
  timeoutMs: 30000
}

const AI_CHAT = {
  temperature: 0.6,
  deepThinking: true,
  maxTokens: 8000,
  showCharts: true,
  timeoutMs: 120000
}

stubSettings(AI, AI_CHAT)
stubServer()

const { chat } = await import('../api/ai.js?t=' + Math.random())

console.log('=== 默认 maxTokens 要够大 ===')

{
  requestCount = 0
  await chat([{ role: 'user', content: 'hi' }], { kind: 'chat' })
  check('对话用 aiChat.maxTokens', lastMaxTokens, 8000)
  check('一次就成功（没有重试）', requestCount, 1)
}

console.log('\n=== 被截断时自动加大预算重试 ===')

{
  // 故意给一个很小的预算 → 必然被截断
  stubSettings(AI, { ...AI_CHAT, maxTokens: 2000 })
  requestCount = 0
  const reply = await chat([{ role: 'user', content: 'hi' }], { kind: 'chat' })
  check('重试后拿到了正文', reply, '{"text":"完整回答","charts":[]}')
  check('★ 发了两���（第一次 + 重试）', requestCount, 2)
  ok('★ 重试时预算翻倍了', lastMaxTokens >= 4000)
}

console.log('\n=== 重试也失败时，错误要带 truncated 标记 ===')

{
  // 让服务端永远返回截断
  globalThis.uni.request = (opt) => {
    requestCount++
    opt.success && opt.success({
      statusCode: 200,
      data: {
        choices: [{
          message: { content: '', reasoning_content: '想了一半' },
          finish_reason: 'length'
        }]
      }
    })
    return { abort: () => {} }
  }
  requestCount = 0

  let err = null
  try {
    await chat([{ role: 'user', content: 'hi' }], { kind: 'chat' })
  } catch (e) {
    err = e
  }
  ok('抛出了错误', err !== null)
  ok('★ 错误带 truncated 标记', err && err.truncated === true)
  ok('★ 错误带上了思考内容', err && typeof err.reasoning === 'string' && err.reasoning.length > 0)
  ok('★ 错误信息里说了是截断', err && /截断/.test(err.message))
  check('只重试了一次', requestCount, 2)
}

console.log('\n=== 记账解析不重试 ===')

{
  stubServer()
  stubSettings(AI, AI_CHAT)
  // 让服务端永远返回截断
  globalThis.uni.request = (opt) => {
    requestCount++
    opt.success && opt.success({
      statusCode: 200,
      data: {
        choices: [{
          message: { content: '', reasoning_content: '想了一半' },
          finish_reason: 'length'
        }]
      }
    })
    return { abort: () => {} }
  }
  requestCount = 0

  let err = null
  try {
    // 非对话（记账解析）→ 不该重试
    await chat([{ role: 'user', content: 'hi' }], { timeoutMs: 20000 })
  } catch (e) {
    err = e
  }
  ok('抛出了错误', err !== null)
  check('★ 记账解析没有重试（只发一次）', requestCount, 1)
}

console.log('\n=== 默认值 ===')

{
  const { readFileSync } = await import('fs')
  const { join, dirname, resolve } = await import('path')
  const { fileURLToPath } = await import('url')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

  const settingsCode = readFileSync(join(ROOT, 'api', 'settings.js'), 'utf-8')
  ok('aiChat.maxTokens 默认 8000', /maxTokens:\s*8000/.test(settingsCode))

  const storeCode = readFileSync(join(ROOT, 'stores', 'setting.js'), 'utf-8')
  ok('store 默认 8000', /maxTokens:\s*8000/.test(storeCode))

  // 迁移 v13
  const dbCode = readFileSync(join(ROOT, 'api', 'db', 'index.js'), 'utf-8')
  ok('有 v13 迁移', /version:\s*13/.test(dbCode))
  ok('v13 把 2000 提到 8000', /chat\.maxTokens = 8000/.test(dbCode))
  ok('v13 只改恰好等于 2000 的', /Number\(chat\.maxTokens\) !== 2000/.test(dbCode))

  const schemaCode = readFileSync(join(ROOT, 'api', 'db', 'schema.js'), 'utf-8')
  ok('SCHEMA_VERSION = 13', /export const SCHEMA_VERSION = 13/.test(schemaCode))

  // 界面提示
  const chatVue = readFileSync(join(ROOT, 'pages', 'ai', 'chat.vue'), 'utf-8')
  ok('界面有截断的专门提示', /e\.truncated/.test(chatVue))
  ok('提示里告诉用户去哪儿调', /回答长度上限/.test(chatVue))

  // askFinance 不再写死 2000
  const parseCode = readFileSync(join(ROOT, 'api', 'aiParse.js'), 'utf-8')
  ok('askFinance 不再写死 maxTokens 2000', !/maxTokens: opt\.maxTokens \|\| 2000/.test(parseCode))
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
