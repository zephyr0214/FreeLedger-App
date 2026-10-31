/**
 * AI 超时与迁移的回归测试
 *
 *   node scripts/test-ai-timeout.mjs
 *
 * 背景（用户反馈「和 AI 对话时总是显示 AI 请求超时」）
 *
 *   ★ 根因有三个 ★
 *     1. 超时值只有一个（20 秒），但深度思考 + 2000 token 的完整分析
 *        本来就要 30~90 秒 —— 必然超时；
 *     2. uni.request 自己也有一个默认超时（各平台不同），
 *        不显式设置的话，它会先于我们的计时器把请求掐掉，
 *        用户看到的是「request:fail timeout」这种看不懂的错；
 *     3. 超时后没有 abort 掉底层请求，请求还在跑，攒僵尸请求。
 *
 *   这里锁住：
 *     · 超时的优先级（opt > aiChat > ai > 默认）
 *     · uni.request 收到了 timeout，且比我们的计时器晚 3 秒
 *     · 超时后调用了 abort
 *     · 迁移 v12 把 20 秒提到 30 秒、创建 aiChat、清掉 aiCache
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

/* =============================================== 1. 超时的选择与传递 */

console.log('=== 超时的选择与传递 ===')

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

let lastOpts = null
let abortCalled = false
/** 让 uni.request 一直不回调（模拟慢响应） */
let neverRespond = false

function stubRequest() {
  globalThis.uni = {
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    request: (opt) => {
      lastOpts = opt
      if (!neverRespond) {
        opt.success && opt.success({
          statusCode: 200,
          data: { choices: [{ message: { content: 'ok' } }] }
        })
      }
      return {
        abort: () => {
          abortCalled = true
          // 真实的 abort 会触发 fail 回调
          opt.fail && opt.fail({ errMsg: 'request:fail abort' })
        }
      }
    }
  }
}

const AI = {
  baseUrl: 'https://example.com/v1',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  timeoutMs: 30000
}

const AI_CHAT = {
  temperature: 0.6,
  deepThinking: true,
  maxTokens: 2000,
  showCharts: true,
  timeoutMs: 120000
}

stubSettings(AI, AI_CHAT)
stubRequest()

const { chat } = await import('../api/ai.js?t=' + Math.random())

// 1. 对话（kind: 'chat'）→ 用 aiChat.timeoutMs（默认 120 秒）
{
  await chat([{ role: 'user', content: 'hi' }], { kind: 'chat' })
  check('对话用 aiChat.timeoutMs', lastOpts.timeout, 120000 + 3000)
}

// 2. 显式传 timeoutMs → 用它（记账解析 20 秒）
{
  await chat([{ role: 'user', content: 'hi' }], { timeoutMs: 20000 })
  check('显式指定优先', lastOpts.timeout, 20000 + 3000)
}

// 3. 不传 kind 也不传 timeoutMs → 用 ai.timeoutMs（通用）
{
  await chat([{ role: 'user', content: 'hi' }])
  check('非对话走通用 ai.timeoutMs', lastOpts.timeout, 30000 + 3000)
}

// 4. aiChat.timeoutMs 是合并默认值后的值，一定存在（120 秒）
//    —— 这正是「对话用 120 秒、记账用 20 秒」的分工来源
{
  stubSettings({ ...AI, timeoutMs: 45000 }, { temperature: 0.6 })
  const { chat: chat2 } = await import('../api/ai.js?t=' + Math.random())
  await chat2([{ role: 'user', content: 'hi' }], { kind: 'chat' })
  check('对话始终用 aiChat 的 120 秒（不跟着通用值走）', lastOpts.timeout, 120000 + 3000)
  stubSettings(AI, AI_CHAT)
}

// 5. 都没有 → 兜底 30 秒
{
  stubSettings({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' }, {})
  const { chat: chat3 } = await import('../api/ai.js?t=' + Math.random())
  await chat3([{ role: 'user', content: 'hi' }])
  check('都没有时兜底 30 秒', lastOpts.timeout, 33000)
  stubSettings(AI, AI_CHAT)
}

/* -------------------------------------------- 2. 超时后要 abort */

console.log('\n=== 超时后要 abort 掉底层请求 ===')

{
  neverRespond = true
  abortCalled = false
  const { chat: chat4 } = await import('../api/ai.js?t=' + Math.random())

  let err = ''
  try {
    // 给一个 120ms 的超时，测试跑得快一点
    await chat4([{ role: 'user', content: 'hi' }], { timeoutMs: 120 })
  } catch (e) {
    err = e.message
  }

  ok('超时后 reject 了', err.length > 0)
  ok('错误信息里带上了秒数', /超时/.test(err))
  ok('超时时调用了 abort', abortCalled === true)

  neverRespond = false
}

/* =============================================== 3. 迁移 v12 */

console.log('\n=== 迁移 v12（超时 20s → 30s） ===')

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const dbCode = readFileSync(join(ROOT, 'api', 'db', 'index.js'), 'utf-8')
const schemaCode = readFileSync(join(ROOT, 'api', 'db', 'schema.js'), 'utf-8')

ok('SCHEMA_VERSION 提到 12', /export const SCHEMA_VERSION = 12/.test(schemaCode))
ok('有 version: 12 的迁移', /version:\s*12/.test(dbCode))
ok('迁移里把 20000 改成 30000', /Number\(ai\.timeoutMs\) === 20000/.test(dbCode))
ok('迁移里创建 aiChat', /'aiChat'/.test(dbCode))
ok('迁移里清掉 aiCache', /DELETE FROM setting WHERE key = \?/.test(dbCode))

// ★ 迁移必须绕开 openDb() ★
//   query()/execute() 内部 await openDb()，在迁移里会死锁（见 test-db-migration.mjs）
const v12Body = (dbCode.match(/async function migrateAiSettings\(\)\s*\{([\s\S]*?)\n\}/) || [])[1] || ''
ok('迁移里用底层的 call() 而不是 query()', /call\('selectSql'/.test(v12Body))
ok('迁移里没有用 query()', !/\bquery\(/.test(v12Body))
ok('迁移里没有用 execute()', !/\bexecute\(/.test(v12Body))

/* =============================================== 4. 默认值 */

console.log('\n=== 默认值 ===')

const settingsCode = readFileSync(join(ROOT, 'api', 'settings.js'), 'utf-8')
ok('ai.timeoutMs 默认 30000', /timeoutMs:\s*30000/.test(settingsCode))
ok('aiChat.timeoutMs 默认 120000', /timeoutMs:\s*120000/.test(settingsCode))

// 记账解析必须显式用自己的超时，不能被对话的 120 秒带偏
const parseCode = readFileSync(join(ROOT, 'api', 'aiParse.js'), 'utf-8')
ok('记账解析显式用 20 秒超时', /thinking:\s*false,\s*timeoutMs:\s*20000/.test(parseCode))

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
