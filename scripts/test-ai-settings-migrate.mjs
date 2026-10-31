/**
 * AI 设置拆分的迁移测试
 *
 *   node scripts/test-ai-settings-migrate.mjs
 *
 * 背景
 *   旧版本只有 settings.ai 一个对象（带 temperature / quickFallback）。
 *   现在拆成：
 *     settings.ai      公共（baseUrl / apiKey / model / timeoutMs）
 *     settings.aiChat  对话专属（temperature / deepThinking / maxTokens / showCharts）
 *     settings.aiParse 记账专属
 *
 *   要保证的是：**老用户升级后设置不丢、也不被默认值悄悄覆盖**。
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

/* ---------------------------------------------- 假的 uni + 假的数据库 */

/** 让 getAllSettings() 返回指定的几条 setting 记录 */
function stubSettings(rows) {
  globalThis.plus = {
    sqlite: {
      openDatabase: ({ success }) => success && success(),
      closeDatabase: ({ success }) => success && success(),
      selectSql: ({ sql, success }) => {
        if (/FROM setting/i.test(sql)) {
          success && success(rows.map((r) => ({ key: r.key, value: JSON.stringify(r.value) })))
          return
        }
        success && success([])
      },
      executeSql: ({ success }) => success && success(),
      transaction: ({ success }) => success && success()
    }
  }
}

const { getAllSettings, clearSettingsCache } = await import('../api/settings.js?t=' + Math.random())

/* ------------------------------------------------------------ 用例 */

console.log('=== 老用户升级：ai.temperature 要搬到 aiChat.temperature ===')

stubSettings([
  {
    key: 'ai',
    value: {
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-old',
      model: 'deepseek-chat',
      temperature: 0.9,
      timeoutMs: 20000,
      quickFallback: true
    }
  }
])
clearSettingsCache()

{
  const s = await getAllSettings()
  check('老用户的 temperature 0.9 被搬到 aiChat', s.aiChat.temperature, 0.9)
  check('apiKey 保留', s.ai.apiKey, 'sk-old')
  check('baseUrl 保留', s.ai.baseUrl, 'https://api.deepseek.com/v1')
  check('model 保留', s.ai.model, 'deepseek-chat')
  check('timeoutMs 保留', s.ai.timeoutMs, 20000)
  ok('废弃的 quickFallback 不再出现在 ai 里', s.ai.quickFallback === undefined)
  check('对话默认开深度思考', s.aiChat.deepThinking, true)
  check('对话默认允许图表', s.aiChat.showCharts, true)
  check('对话默认 maxTokens', s.aiChat.maxTokens, 2000)
}

console.log('\n=== 新用户：没有 aiChat 记录时用默认值 ===')

stubSettings([
  { key: 'ai', value: { baseUrl: 'https://x/v1', apiKey: 'sk-new', model: 'deepseek-chat', timeoutMs: 20000 } }
])
clearSettingsCache()

{
  const s = await getAllSettings()
  check('没有旧 temperature 时用默认 0.6', s.aiChat.temperature, 0.6)
  check('ai 里没有 temperature', s.ai.temperature, undefined)
}

console.log('\n=== 已经迁移过的用户：不能被旧值覆盖回去 ===')

stubSettings([
  { key: 'ai', value: { baseUrl: 'https://x/v1', apiKey: 'sk', model: 'm', temperature: 0.3, timeoutMs: 20000 } },
  { key: 'aiChat', value: { temperature: 0.8, deepThinking: false, maxTokens: 3000, showCharts: false } }
])
clearSettingsCache()

{
  const s = await getAllSettings()
  check('aiChat 已有的值不被旧 ai.temperature 覆盖', s.aiChat.temperature, 0.8)
  check('deepThinking 保持用户的关闭', s.aiChat.deepThinking, false)
  check('maxTokens 保持', s.aiChat.maxTokens, 3000)
  check('showCharts 保持', s.aiChat.showCharts, false)
}

console.log('\n=== aiChat 缺字段时用默认值补齐 ===')

stubSettings([
  { key: 'ai', value: { baseUrl: 'https://x/v1', apiKey: 'sk', model: 'm', timeoutMs: 20000 } },
  { key: 'aiChat', value: { deepThinking: false } }
])
clearSettingsCache()

{
  const s = await getAllSettings()
  check('缺失的 maxTokens 用默认', s.aiChat.maxTokens, 2000)
  check('缺失的 showCharts 用默认', s.aiChat.showCharts, true)
  check('缺失的 temperature 用默认', s.aiChat.temperature, 0.6)
  check('用户设的 deepThinking 保留', s.aiChat.deepThinking, false)
}

console.log('\n=== 完全没有 AI 设置：全是默认值 ===')

stubSettings([])
clearSettingsCache()

{
  const s = await getAllSettings()
  check('默认 baseUrl', s.ai.baseUrl, 'https://api.deepseek.com/v1')
  check('默认 model', s.ai.model, 'deepseek-chat')
  check('默认 temperature', s.aiChat.temperature, 0.6)
  check('默认 timeoutMs', s.ai.timeoutMs, 20000)
}

console.log('\n=== 记账与对话的配置互不影响 ===')

stubSettings([
  { key: 'ai', value: { baseUrl: 'https://x/v1', apiKey: 'sk', model: 'm', timeoutMs: 20000 } },
  { key: 'aiChat', value: { temperature: 0.9, deepThinking: true } },
  { key: 'aiParse', value: { enabled: false } }
])
clearSettingsCache()

{
  const s = await getAllSettings()
  check('对话温度是 0.9', s.aiChat.temperature, 0.9)
  check('记账开关独立', s.aiParse.enabled, false)
  ok('ai 里不含 temperature（记账写死 0）', s.ai.temperature === undefined)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
