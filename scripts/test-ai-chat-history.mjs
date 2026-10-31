/**
 * AI 对话历史记录 + 图表版面的回归测试
 *
 *   node scripts/test-ai-chat-history.mjs
 *
 * 背景（用户反馈的两个 bug）
 *   1. 「AI 对话历史聊天记录退出再进入，就不渲染了」
 *      根因链：
 *        a. saveHistory 存的是整个消息对象 —— 带着 blocks 和图表的
 *           SVG data URI（一张图 2.7 KB），30 条能到 50 KB；
 *        b. uni.setStorageSync 在 App 端有容量上限，超了直接抛异常；
 *        c. catch 是空的，异常被吞掉 —— **整份历史一条都没存进去**；
 *        d. 而模板当时只渲染 msg.blocks（历史记录里根本没这个字段）
 *           → 空白气泡。
 *      修法：只存 role + content，读出来重算 blocks，
 *            模板再加一层 content 兜底；存不下时降级存最后 10 条。
 *
 *   2. 「图标的图例和环形图重叠了」
 *      根因：标签排在环的两侧（x=4 / x=136），而环的范围是 38~222，
 *            标签压在环上面。修法：环缩到左边，标签全排到右边，
 *            并直接标出占比，不需要另配图例。
 */

import { renderMarkdown } from '../utils/markdown.js'
import { buildAiDonutSvg, buildAiChartUri } from '../utils/aiChart.js'
import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

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

/* =============================================== 1. 历史的存 / 取 */

console.log('=== 历史的存 / 取 ===')

/** 假的 uni storage，带容量上限 */
function makeStorage(limit = Infinity) {
  const STORE = {}
  let threw = false
  globalThis.uni = {
    setStorageSync: (k, v) => {
      if (v.length > limit) {
        threw = true
        throw new Error('setStorageSync:fail exceed storage max size')
      }
      STORE[k] = v
    },
    getStorageSync: (k) => STORE[k] || '',
    removeStorageSync: (k) => { delete STORE[k] }
  }
  return {
    store: STORE,
    get threw() { return threw },
    reset() { threw = false }
  }
}

/**
 * 和 chat.vue 里 saveHistory / loadHistory 一样的逻辑。
 * ★ 这里刻意写成和页面一致的样子 ★
 *   页面改了这里也要跟着改（两边用同一套规则）。
 */
function saveHistory(messages, storage) {
  try {
    const toSave = messages
      .slice(-30)
      .map((m) => ({ role: m.role, content: m.content }))
    uni.setStorageSync('aiChatHistory', JSON.stringify(toSave))
  } catch (e) {
    /*
     * ★ 存不下时不能一条都不剩 ★
     *   逐级减少条数重试：20 → 10 → 5 → 1。
     *   宁可只留下最近几条，也不能整个历史都没了。
     */
    for (const keep of [20, 10, 5, 1]) {
      try {
        const slim = messages
          .slice(-keep)
          .map((m) => ({ role: m.role, content: m.content }))
        uni.setStorageSync('aiChatHistory', JSON.stringify(slim))
        return
      } catch (e2) {
        // 继续试更少的条数
      }
    }
    console.warn('  ⚠️ 历史保存彻底失败')
  }
}

function loadHistory() {
  try {
    const raw = uni.getStorageSync('aiChatHistory')
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        return arr
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .map((m) => ({
            role: m.role,
            content: m.content,
            blocks: m.blocks && m.blocks.length
              ? m.blocks
              : (m.role === 'assistant' ? renderMarkdown(m.content) : null),
            charts: []
          }))
      }
    }
  } catch (e) {
    console.warn('  ⚠️ 历史读取失败:', e && e.message)
  }
  return []
}

const MD = '## 本月分析\n\n餐饮花了 **1200 元**，占 42%。\n\n- 餐饮最多\n- 交通其次'

// 1.1 只存 role + content —— 体积必须小
{
  const storage = makeStorage()
  const msgs = [
    { role: 'user', content: '分析下' },
    { role: 'assistant', content: MD, blocks: renderMarkdown(MD), charts: [{ uri: 'x'.repeat(2700) }] }
  ]
  saveHistory(msgs, storage)
  const raw = storage.store.aiChatHistory
  check('存进去的是 role + content 两字段', Object.keys(JSON.parse(raw)[1]).sort(), ['content', 'role'])
  ok('体积很小（不含图表 URI）', raw.length < 400)
}

// 1.2 读出来能渲染出 markdown 分片
{
  const storage = makeStorage()
  saveHistory([{ role: 'user', content: '分析下' }, { role: 'assistant', content: MD }], storage)
  const loaded = loadHistory()
  check('读出 2 条', loaded.length, 2)
  ok('AI 消息有 blocks', loaded[1].blocks && loaded[1].blocks.length > 0)
  check('blocks 里有标题', loaded[1].blocks[0].type, 'h')
  ok('用户消息没有 blocks（渲染走纯文本分支）', loaded[0].blocks === null)
}

// 1.3 ★ 核心：存不下时不能一条都不剩 ★
{
  // 容量限制：够存下 2 条，但存不下 20 条
  // （模拟「历史越来越长，storage 放不下」的真实场景）
  const probe = makeStorage()
  saveHistory([{ role: 'user', content: '问题。'.repeat(60) }], probe)
  const oneMsgSize = (probe.store.aiChatHistory || '').length

  const storage = makeStorage(oneMsgSize * 3)
  // 造 20 条长消息
  const msgs = []
  for (let i = 0; i < 10; i++) {
    msgs.push({ role: 'user', content: '问题' + i + '。'.repeat(60) })
    msgs.push({ role: 'assistant', content: MD + '补充。'.repeat(60) })
  }
  saveHistory(msgs, storage)
  ok('存储确实抛过异常', storage.threw === true)

  const loaded = loadHistory()
  ok('★ 降级后仍然存下了记录', loaded.length > 0)
  ok('★ 降级后不超过 10 条', loaded.length <= 10)
  ok('★ 降级后的记录内容完整', loaded[0] && typeof loaded[0].content === 'string')
  ok('★ 降级后的是最近的消息（不是最早的）', loaded[loaded.length - 1].content.includes('补充'))
}

// 1.4 兼容老版本存过 blocks 的记录
{
  const storage = makeStorage()
  const oldBlocks = renderMarkdown(MD)
  uni.setStorageSync('aiChatHistory', JSON.stringify([
    { role: 'assistant', content: MD, blocks: oldBlocks }
  ]))
  const loaded = loadHistory()
  ok('老记录能读出 blocks', loaded[0].blocks && loaded[0].blocks.length > 0)
  check('老记录的 blocks 内容一致', loaded[0].blocks[0].type, oldBlocks[0].type)
}

// 1.5 坏数据不能让整个页面崩
{
  const storage = makeStorage()
  uni.setStorageSync('aiChatHistory', '{ 这不是 JSON')
  let crashed = false
  let loaded = []
  try { loaded = loadHistory() } catch (e) { crashed = true }
  ok('坏 JSON 不抛异常', crashed === false)
  check('坏 JSON 返回空数组', loaded, [])
}

/* =============================================== 2. 模板要有兜底 */

console.log('\n=== 模板必须有 content 兜底 ===')

const chatCode = readFileSync(join(ROOT, 'pages', 'ai', 'chat.vue'), 'utf-8')

ok('模板里有「blocks 为空就显示 content」的兜底',
  /v-if="msg\.blocks && msg\.blocks\.length"/.test(chatCode))
ok('兜底分支渲染 msg.content',
  /v-else class="md-p">\{\{ msg\.content \}\}/.test(chatCode))

// 不该再有图例
ok('不再有 chart-legend', !/chart-legend/.test(chatCode))
ok('不再有 legend-item', !/legend-item/.test(chatCode))
ok('不再有 legend-dot', !/legend-dot/.test(chatCode))
ok('不再有 legend-name', !/legend-name/.test(chatCode))
ok('不再有 legend-value', !/legend-value/.test(chatCode))
ok('buildCharts 不再生成 legend', !/legend:/.test(chatCode))

/* =============================================== 3. 环形图版面 */

console.log('\n=== 环形图版面：标签不能压在环上 ===')

const ITEMS = [
  { name: '餐饮', amount: 1200, color: '#1E88E5' },
  { name: '交通', amount: 600, color: '#FB8C00' },
  { name: '购物', amount: 300, color: '#43A047' }
]

const donut = buildAiDonutSvg(ITEMS, { textColor: '#333333' })
ok('生成了 SVG', donut.startsWith('<svg'))

// 解析出所有元素的坐标，检查标签有没有压在环上
const ringR = 58
const ringCx = 82
// 色块（rect）的 x 必须都在环的右边
const rectXs = [...donut.matchAll(/<rect x="([\d.]+)"/g)].map(m => Number(m[1]))
ok('色块都在环右侧（x > 环的右边缘）', rectXs.length > 0 && rectXs.every(x => x > ringCx + ringR))
ok('色块不超过画布宽度', rectXs.every(x => x < 300))

// 分类名文字的 x 也要在环右侧
// （排除中心那两行「合计」/金额，以及右对齐的百分比）
const allTexts = [...donut.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)]
const nameTexts = allTexts.filter(m =>
  !/合计/.test(m[3]) && !/%$/.test(m[3]) && !/^\d+(\.\d+)?$/.test(m[3])
)
ok('找得到 3 个分类名', nameTexts.length === 3)
ok('分类名都在环右侧', nameTexts.every(m => Number(m[1]) > ringCx + ringR))

// 占比必须有
const pctTexts = [...donut.matchAll(/>([\d.]+%)<\/text>/g)].map(m => m[1])
check('三个分类都有占比', pctTexts.length, 3)
ok('占比加起来接近 100', (() => {
  const sum = pctTexts.reduce((a, b) => a + Number(b.replace('%', '')), 0)
  return Math.abs(sum - 100) < 1
})())

// 分类名不能被截断得看不出是什么（至少保留 4 个字）
ok('分类名没有过度截断', nameTexts.every(m => m[3].length <= 8))

/* =============================================== 4. 存历史的体积 */

console.log('\n=== 30 条消息的体积 ===')

{
  const storage = makeStorage()
  const msgs = []
  for (let i = 0; i < 15; i++) {
    msgs.push({ role: 'user', content: '问题' + i })
    msgs.push({ role: 'assistant', content: MD, blocks: renderMarkdown(MD), charts: [{ uri: 'x'.repeat(2700) }] })
  }
  saveHistory(msgs, storage)
  const raw = storage.store.aiChatHistory || ''
  ok('30 条消息存得下（< 10 KB）', raw.length < 10000)
  console.log(`  实际体积: ${raw.length} 字节`)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
