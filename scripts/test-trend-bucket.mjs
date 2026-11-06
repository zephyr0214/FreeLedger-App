/**
 * 趋势图分桶规则测试（日趋势 / 月趋势）
 *
 *   node scripts/test-trend-bucket.mjs
 *
 * 用户需求（原话）：
 *   「统计页面自定义筛选等，选择近一周、近一月时，或者当的两个日期之间的时间
 *    小于等于两个月，下方显示的应该是日趋势组件，反之显示的应该是月趋势组件」
 *   后续补充：「不写死62天，你判断月份跨度」
 *
 * ★ 为什么不能写死天数 ★
 *   「7 月 1 号 ~ 8 月 31 号」正好两个整月、62 天。用 62 天做阈值时，
 *   这个区间恰好卡在边界上，用户点相邻的两个整月会看到图表在日/月之间跳。
 *   按「跨了几个自然月」判断，语义和用户脑子里的单位一致。
 */

import {
  monthSpan, trendBucketOf, TREND_DAY_MAX_MONTHS,
  shiftDay, toDayKey
} from '../utils/date.js'

let pass = 0
let fail = 0
const fails = []

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    fail++
    fails.push(`${name}\n      实际 ${a}\n      期望 ${e}`)
    console.log(`FAIL  ${name}\n      实际 ${a}\n      期望 ${e}`)
  }
}

/* ------------------------------------------------------------- 常量 */

console.log('=== 常量 ===')

check('日趋势最多覆盖 2 个月', TREND_DAY_MAX_MONTHS, 2)

/* --------------------------------------------------------- 月份跨度 */

console.log('\n=== monthSpan（跨了几个自然月，含首尾）===')

check('同一天 → 1', monthSpan('2026-03-15', '2026-03-15'), 1)
check('同月不同日 → 1', monthSpan('2026-03-01', '2026-03-31'), 1)
check('跨到下一月 → 2', monthSpan('2026-03-15', '2026-04-02'), 2)
check('两个整月 → 2', monthSpan('2026-07-01', '2026-08-31'), 2)
check('三个整月 → 3', monthSpan('2026-07-01', '2026-09-30'), 3)
check('跨年整两个月 → 2', monthSpan('2025-12-01', '2026-01-31'), 2)
check('整一年 → 12', monthSpan('2026-01-01', '2026-12-31'), 12)
check('整两年 → 24', monthSpan('2025-01-01', '2026-12-31'), 24)
check('整五年 → 60', monthSpan('2021-11-06', '2026-11-06'), 61)

// 边界：一端为空 / 起止颠倒 / 格式不对 → 0（调用方按「不限」处理）
check('两端都空 → 0', monthSpan('', ''), 0)
check('只有开始 → 0', monthSpan('2026-03-15', ''), 0)
check('只有结束 → 0', monthSpan('', '2026-03-15'), 0)
check('起止颠倒 → 0', monthSpan('2026-04-02', '2026-03-15'), 0)
check('格式不对 → 0', monthSpan('abc', 'def'), 0)

/* ----------------------------------------------------------- 分桶 */

console.log('\n=== trendBucketOf ===')

// 预设对应的真实区间（与 DateFilterBar 的 presetRange 同一套算法）
const today = toDayKey()
const weekRange = { startDay: shiftDay(today, -6), endDay: today }
const monthRange30 = { startDay: shiftDay(today, -29), endDay: today }

check(
  '近一周 → 日趋势',
  trendBucketOf(weekRange.startDay, weekRange.endDay),
  'day'
)
check(
  '近一月 → 日趋势',
  trendBucketOf(monthRange30.startDay, monthRange30.endDay),
  'day'
)
check('单日 → 日趋势', trendBucketOf('2026-03-15', '2026-03-15'), 'day')
check('整月 → 日趋势', trendBucketOf('2026-03-01', '2026-03-31'), 'day')
check('两个整月 → 日趋势', trendBucketOf('2026-07-01', '2026-08-31'), 'day')
check('三个月 → 月趋势', trendBucketOf('2026-07-01', '2026-09-30'), 'month')
check('近半年 → 月趋势', trendBucketOf('2026-05-07', '2026-11-06'), 'month')
check('整一年 → 月趋势', trendBucketOf('2026-01-01', '2026-12-31'), 'month')
check('不限（两端空）→ 月趋势', trendBucketOf('', ''), 'month')

/*
 * ★ 关键回归：62 天这个数字不能再出现在判据里 ★
 *   「7/1~8/31」是 62 天，写死阈值会算错；按月份跨度必须是 2 个月 → 日趋势。
 */
check('62 天但正好两个整月 → 日趋势（不是被天数阈值卡住）', trendBucketOf('2026-07-01', '2026-08-31'), 'day')
check('62 天的月份跨度确实是 2', monthSpan('2026-07-01', '2026-08-31'), 2)

/* -------------------------------------- 与 api/stats.js 的实现一致 */

console.log('\n=== api/stats.js 必须用同一套判据 ===')

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const statsSrc = readFileSync(join(ROOT, 'api', 'stats.js'), 'utf-8')

check('stats.js 引入了 monthSpan', /monthSpan/.test(statsSrc), true)
check('stats.js 引入了 TREND_DAY_MAX_MONTHS', /TREND_DAY_MAX_MONTHS/.test(statsSrc), true)
check(
  'stats.js 的自定义分支按月份跨度判日/月',
  /kind === 'custom'[\s\S]{0,400}?monthSpan\(e\.startDay, e\.endDay\)/.test(statsSrc),
  true
)
check(
  'stats.js 里没有写死的 62 天阈值',
  /62\s*\*\s*86400|<=?\s*62\b/.test(statsSrc),
  false
)

/* -------------------------------------------- 统计页要跟着分桶换标题 */

console.log('\n=== 统计页标题/单位随分桶变化 ===')

const pageSrc = readFileSync(join(ROOT, 'pages', 'stats', 'index.vue'), 'utf-8')

check('统计页 import 了 trendBucketOf', /trendBucketOf/.test(pageSrc), true)
check('统计页有 trendBucket computed', /const trendBucket = computed\(/.test(pageSrc), true)
check(
  '自定义模式走 trendBucketOf',
  /dateMode\.value === 'custom'[\s\S]{0,200}?trendBucketOf\(customStart\.value, customEnd\.value\)/.test(pageSrc),
  true
)
check('trendUnit 按分桶给「日」/「月」', /trendUnit = computed\(\(\) => \(trendBucket\.value === 'day' \? '日' : '月'\)\)/.test(pageSrc), true)
check('trendTitle 按分桶给日趋势/月趋势', /日趋势/.test(pageSrc) && /月趋势/.test(pageSrc), true)
check('trendBucket 出现在 return 里（模板/极值文案要用）', /return \{[\s\S]{0,2000}?trendBucket/.test(pageSrc), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) {
  console.log('\n失败项：')
  for (const f of fails) console.log('  · ' + f.split('\n')[0])
  process.exit(1)
}
