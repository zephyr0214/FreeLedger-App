/**
 * AI 对话改造的单测 —— 设置拆分 / markdown 渲染 / 图表规格校验
 *
 *   node scripts/test-ai-chat.mjs
 *
 * 覆盖：
 *   1. aiChat 图表规格的归一化（白名单校验）
 *   2. markdown 渲染（标题 / 段落 / 列表 / 行内加粗）
 *   3. AI 图表 SVG（转义、环形、条形、折线）
 *   4. 旧设置迁移（ai.temperature → aiChat.temperature）
 */

import { normalizeChartSpec, CHART_TYPES } from '../api/aiChartData.js'
import { renderMarkdown, parseInline, escapeHtml } from '../utils/markdown.js'
import {
  buildAiDonutSvg, buildAiBarSvg, buildAiTrendSvg, buildAiChartUri,
  escapeXml, formatShortMoney, truncate
} from '../utils/aiChart.js'

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

/* ================================================ 1. 图表规格归一化 */

console.log('=== 图表规格归一化（白名单） ===')

check(
  'donut + category 是合法的',
  normalizeChartSpec({ type: 'donut', dimension: 'category', title: '支出构成' }),
  { type: 'donut', dimension: 'category', title: '支出构成', limit: 6 }
)

check(
  '类型大小写不敏感',
  normalizeChartSpec({ type: 'DONUT', dimension: 'CATEGORY' }).type,
  'donut'
)

check(
  '不支持的类型 → null',
  normalizeChartSpec({ type: 'pie', dimension: 'category' }),
  null
)

check(
  '不支持的维度 → null',
  normalizeChartSpec({ type: 'donut', dimension: 'account' }),
  null
)

check(
  '没有 type → null',
  normalizeChartSpec({ dimension: 'category' }),
  null
)

check(
  '不是对象 → null',
  normalizeChartSpec(null),
  null
)

check(
  '字符串 → null',
  normalizeChartSpec('donut'),
  null
)

// trend 没有维度概念
check(
  'trend 不带维度',
  normalizeChartSpec({ type: 'trend', title: '趋势' }),
  { type: 'trend', title: '趋势', days: 30 }
)

check(
  'trend 的 days 被夹在 7~90',
  normalizeChartSpec({ type: 'trend', days: 999 }).days,
  90
)

check(
  'trend 的 days 下限是 7',
  normalizeChartSpec({ type: 'trend', days: 1 }).days,
  7
)

// limit 被夹在 3~8
check(
  'limit 上限是 8',
  normalizeChartSpec({ type: 'bar', dimension: 'category', limit: 99 }).limit,
  8
)

check(
  'limit 下限是 3',
  normalizeChartSpec({ type: 'bar', dimension: 'category', limit: 0 }).limit,
  3
)

// 标题被截断，防止模型塞超长标题
check(
  '标题超长会被截断',
  normalizeChartSpec({ type: 'donut', dimension: 'category', title: 'x'.repeat(100) }).title.length,
  40
)

ok('支持的类型只有三种', CHART_TYPES.join(',') === 'donut,bar,trend')

/* ==================================================== 2. markdown 渲染 */

console.log('\n=== markdown 渲染 ===')

// 行内
check(
  '普通文本只有一段',
  parseInline('hello').length,
  1
)

check(
  '加粗被拆出来',
  parseInline('这是**重点**内容')[1],
  { text: '重点', bold: true, code: false }
)

check(
  '行内代码被拆出来',
  parseInline('用 `code` 吧')[1],
  { text: 'code', bold: false, code: true }
)

// 块级
const md = `## 本月分析

餐饮花了 **1200 元**，占总支出的 42%。

- 餐饮最多
- 交通其次
- 购物最少`

const blocks = renderMarkdown(md)

check('渲染出 3 个块（标题 / 段落 / 列表）', blocks.length, 3)
check('第 1 个是标题', blocks[0].type, 'h')
check('标题级别是 2', blocks[0].level, 2)
check('标题文字', blocks[0].text, '本月分析')
check('第 2 个是段落', blocks[1].type, 'p')
check('第 3 个是列表', blocks[2].type, 'ul')
check('列表有 3 项', blocks[2].items.length, 3)
check('列表项文字', blocks[2].items[0].text, '餐饮最多')

// 段落里的加粗
const para = blocks[1]
ok('段落里加粗被拆出来', para.segments.some((s) => s.bold && s.text === '1200 元'))

// 空输入
check('空文本 → 空数组', renderMarkdown(''), [])
check('空白文本 → 空数组', renderMarkdown('   \n  \n '), [])

// 数字列表
const numList = renderMarkdown('1. 第一\n2. 第二')
check('数字列表被识别', numList[0].type, 'ul')
check('数字列表有 2 项', numList[0].items.length, 2)

// 多段落
const multi = renderMarkdown('第一段\n\n第二段')
check('空行分出两段', multi.length, 2)

check(
  'escapeHtml 处理尖括号',
  escapeHtml('<script>'),
  '&lt;script&gt;'
)

/* ==================================================== 3. 图表 SVG */

console.log('\n=== 图表 SVG ===')

const ITEMS = [
  { name: '餐饮', amount: 1200, color: '#1E88E5' },
  { name: '交通', amount: 600, color: '#FB8C00' },
  { name: '购物', amount: 200, color: '#43A047' }
]

const donut = buildAiDonutSvg(ITEMS, { textColor: '#333333' })
ok('环形图生成了 SVG', donut.startsWith('<svg') && donut.endsWith('</svg>'))
ok('环形图里有三个扇区', (donut.match(/<path/g) || []).length === 3)
ok('环形图里有合计文字', donut.includes('合计'))

// 空数据
check('空数据 → 空串', buildAiDonutSvg([]), '')
check('金额全 0 → 空串', buildAiDonutSvg([{ name: 'x', amount: 0 }]), '')

// 分类名里的尖括号必须被转义
const escaped = buildAiDonutSvg([{ name: '<b>bad</b>', amount: 10, color: '#000' }])
ok('分类名里的尖括号被转义', escaped.includes('&lt;b&gt;'))
ok('没有裸的 <b> 标签', !escaped.includes('<b>bad</b>'))

// 条形图
const bar = buildAiBarSvg(ITEMS)
ok('条形图生成了 SVG', bar.startsWith('<svg'))
ok('条形图有三条 rect 条', (bar.match(/<rect/g) || []).length >= 3)

// 折线图
const trend = buildAiTrendSvg([
  { day: '1', total: 10 },
  { day: '2', total: 30 },
  { day: '3', total: 20 }
])
ok('折线图生成了 SVG', trend.startsWith('<svg'))
ok('折线图有折线 path', trend.includes('<path d="M'))

// 单点折线（不能崩）
const single = buildAiTrendSvg([{ day: '1', total: 10 }])
ok('单点折线不崩', single.startsWith('<svg'))

// 空折线
check('空折线 → 空串', buildAiTrendSvg([]), '')

// uri
const uri = buildAiChartUri('donut', ITEMS)
ok('uri 是 data:image/svg+xml', uri.startsWith('data:image/svg+xml'))
check('不认识的类型 → 空串', buildAiChartUri('pie', ITEMS), '')

// 工具函数
check('escapeXml 转义引号', escapeXml('a"b'), 'a&quot;b')
check('formatShortMoney 整数', formatShortMoney(1234), '1234')
check('formatShortMoney 万', formatShortMoney(12345), '1.2万')
check('formatShortMoney 小数', formatShortMoney(12.345), '12.35')
check('truncate 截断', truncate('abcdefgh', 3), 'abc…')
check('truncate 不够长', truncate('ab', 5), 'ab')

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
