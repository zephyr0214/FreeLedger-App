/**
 * AI 响应解析的测试
 *
 *   node scripts/test-ai-response.mjs
 *
 * ★ 这个测试是为了锁住一个真机 bug ★
 *   报错现场：
 *     [account] 生成图标失败（不影响保存）: AI 返回格式异常
 *   根因是 chat() 只看 choices[0].message.content 是不是字符串。
 *   以下三种情况都会被误判成「格式异常」：
 *     1. max_tokens 截断 → content 为 null
 *     2. 推理模型 → 正文在 reasoning_content，content 为空
 *     3. 部分网关 → content 是 [{type:'text', text:'...'}] 分段数组
 *
 * 这里用假的 uni.request 驱动真实的 api/ai.js，
 * 逐个验证这些形状都能正确取到正文，且空正文时给出可读的原因。
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
    console.log(`FAIL  ${name}\n      实际 ${a}\n      期望 ${e}`)
  }
}

/* ---------------------------------------------- 假的 uni + 假的数据库 */

/** 让 getAllSettings() 返回一份配好的 AI 设置 */
function stubSettings(ai) {
  globalThis.plus = {
    sqlite: {
      openDatabase: ({ success }) => success && success(),
      closeDatabase: ({ success }) => success && success(),
      selectSql: ({ sql, success }) => {
        // api/settings.js 会 SELECT key, value FROM setting
        if (/FROM setting/i.test(sql)) {
          const rows = [
            { key: 'ai', value: JSON.stringify(ai) }
          ]
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

let nextResponse = null

function stubRequest() {
  globalThis.uni = {
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    request: (opt) => {
      const r = nextResponse
      if (r && r.fail) {
        opt.fail && opt.fail({ errMsg: r.errMsg || 'fail' })
        return
      }
      opt.success && opt.success({
        statusCode: r.statusCode !== undefined ? r.statusCode : 200,
        data: r.data
      })
    }
  }
}

const AI = {
  baseUrl: 'https://example.com/v1',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  temperature: 0.3,
  timeoutMs: 5000
}

/* ------------------------------------------------------------ 跑测试 */

const { chat } = await import('../api/ai.js?t=' + Math.random())

stubSettings(AI)
stubRequest()

async function ask() {
  return chat([{ role: 'user', content: 'hi' }], { timeoutMs: 3000 })
}

console.log('=== 正常返回 ===')

{
  nextResponse = { data: { choices: [{ message: { content: '  hello  ' } }] } }
  check('取出并 trim 正文', await ask(), 'hello')
}

console.log('=== 截断（content=null，finish_reason=length）===')

{
  nextResponse = {
    data: { choices: [{ message: { content: null }, finish_reason: 'length' }] }
  }
  let err = ''
  try { await ask() } catch (e) { err = e.message }
  check('给出「被截断」的原因', /截断/.test(err), true)
  check('不再是含糊的「格式异常」', /格式异常/.test(err), false)
}

console.log('=== 推理模型（正文在 reasoning_content）===')

{
  nextResponse = {
    data: {
      choices: [{
        message: { content: '', reasoning_content: '<svg>ok</svg>' }
      }]
    }
  }
  check('回落到 reasoning_content', await ask(), '<svg>ok</svg>')
}

console.log('=== Anthropic 风格分段数组 ===')

{
  nextResponse = {
    data: {
      choices: [{
        message: {
          content: [
            { type: 'text', text: 'abc' },
            { type: 'thinking', thinking: 'ignored' },
            { type: 'text', text: 'def' }
          ]
        }
      }]
    }
  }
  check('拼出分段正文', await ask(), 'abcdef')
}

console.log('=== 纯字符串数组 ===')

{
  nextResponse = { data: { choices: [{ message: { content: ['a', 'b', 'c'] } }] } }
  check('拼接字符串数组', await ask(), 'abc')
}

console.log('=== 空正文的各种情况 ===')

{
  nextResponse = { data: { choices: [{ message: { content: '   ' } }] } }
  let err = ''
  try { await ask() } catch (e) { err = e.message }
  check('全空白也报空正文', /空正文/.test(err), true)
}

{
  nextResponse = { data: { choices: [] } }
  let err = ''
  try { await ask() } catch (e) { err = e.message }
  check('没有 choices 时报错可读', /空|没有/.test(err), true)
}

{
  nextResponse = {
    data: { choices: [{ message: { content: null }, finish_reason: 'content_filter' }] }
  }
  let err = ''
  try { await ask() } catch (e) { err = e.message }
  check('内容被过滤时说明原因', /过滤/.test(err), true)
}

console.log('=== 网络与鉴权错误仍然正确 ===')

{
  nextResponse = { statusCode: 401, data: { error: { message: 'bad key' } } }
  let err = ''
  try { await ask() } catch (e) { err = e.message }
  check('401 提示 Key 无效', /API Key 无效/.test(err), true)
}

{
  nextResponse = { statusCode: 429, data: {} }
  let err = ''
  try { await ask() } catch (e) { err = e.message }
  check('429 提示频率/额度', /频繁|额度/.test(err), true)
}

{
  nextResponse = { fail: true, errMsg: 'request:fail timeout' }
  let err = ''
  try { await ask() } catch (e) { err = e.message }
  /*
   * ★ 超时要翻译成能看懂的话 ★
   *   uni.request 自己超时时会带 errMsg: 'request:fail timeout'，
   *   直接透给用户等于把内部细节甩出去。
   *   现在统一转成「AI 请求超时（xx 秒）」，并带上实际的秒数。
   */
  check('超时转成可读提示', /AI 请求超时/.test(err), true)
  check('超时提示带上了秒数', /秒）/.test(err), true)
}

{
  // 其它网络错误仍然原样透出 errMsg
  nextResponse = { fail: true, errMsg: 'request:fail ssl hand shake error' }
  let err = ''
  try { await ask() } catch (e) { err = e.message }
  check('非超时错误透出 errMsg', /ssl hand shake/.test(err), true)
}

console.log('=== 超时 ===')

{
  // 让请求永远不回调，验证超时会 reject
  globalThis.uni.request = () => {}
  let err = ''
  try {
    await chat([{ role: 'user', content: 'hi' }], { timeoutMs: 60 })
  } catch (e) {
    err = e.message
  }
  check('超时会报错', /超时/.test(err), true)
}

delete globalThis.uni
delete globalThis.plus

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
