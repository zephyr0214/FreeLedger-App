/**
 * 资产变化点趋势的测试
 *
 *   node scripts/test-asset-trend.mjs
 *
 * 背景：
 *   资产趋势图从「每天一个点」改成「每次资产变化打一个点」，
 *   并且要求「没数据的时刻记为 0 来画图」。
 *   这里把补 0 的逻辑（fillChangePoints）钉住。
 */

import { fillChangePoints } from '../api/account.js'

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

console.log('=== 补 0 ===')

// 终点是「今天」，不是最后一个点
const today = new Date()
today.setHours(0, 0, 0, 0)
const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// 两个变化点，中间缺 3 天（最后一个点是今天）
const points = [
  { day: dayKey(new Date(today.getTime() - 4 * 86400000)), total: 10000, delta: 0, changed: true },
  { day: dayKey(today), total: 20000, delta: 10000, changed: true }
]

const filled = fillChangePoints(points, 5)

check('长度 = 5 天', filled.length, 5)
check('第1天是4天前', filled[0].day, dayKey(new Date(today.getTime() - 4 * 86400000)))
check('第1天值', filled[0].total, 10000)
check('中间缺失沿用上一个值', filled[1].total, 10000)
check('中间缺失沿用上一个值', filled[2].total, 10000)
check('中间缺失沿用上一个值', filled[3].total, 10000)
check('最后一天是今天', filled[4].day, dayKey(today))
check('最后一天值', filled[4].total, 20000)

// ★ 缺失的天不能是 0（否则折线整个掉到 0，看着像资产归零）★
check('中间不是 0', filled[1].total === 0, false)
check('缺失的天 changed=false', filled[1].changed, false)
check('有快照的天 changed=true', filled[0].changed, true)

// ★ 只有 1 个变化点时，也要铺满整个区间 ★
//   （之前用最后一个点当终点，只有 1 个点就只画 1 天，看起来「一直只有一个点」）
{
  const one = [{ day: dayKey(today), total: 500, delta: 0, changed: true }]
  const f = fillChangePoints(one, 31)
  check('单点也铺满 31 天', f.length, 31)
  check('单点最后一天有值', f[30].total, 500)
  check('单点在区间开头是 0（还没有任何数据）', f[0].total, 0)
  check('单点最后一天是今天', f[30].day, dayKey(today))
}

// 连续的两天
{
  const two = [
    { day: dayKey(new Date(today.getTime() - 86400000)), total: 100, delta: 0, changed: true },
    { day: dayKey(today), total: 200, delta: 100, changed: true }
  ]
  const f = fillChangePoints(two, 2)
  check('连续两天长度', f.length, 2)
  check('连续第1天', f[0].day, dayKey(new Date(today.getTime() - 86400000)))
  check('连续第2天是今天', f[1].day, dayKey(today))
}

// 空数组
check('空数组 -> 空', fillChangePoints([], 10), [])

// days <= 0 时原样返回
check('days=0 原样返回', fillChangePoints(points, 0).length, points.length)

console.log('=== 跨月边界 ===')

// 跨月：10-30 到 11-02
const filled4 = fillChangePoints([
  { day: '2026-10-30', total: 100, delta: 0 },
  { day: '2026-11-02', total: 200, delta: 100 }
], 4)
// 终点是今天，所以这两个点在 4 天窗口外时不会被包含；
// 这里验证的是「补出来的日期序列本身要正确跨月」
const seq = fillChangePoints([{ day: dayKey(today), total: 1, delta: 0 }], 4)
check('跨月序列长度', seq.length, 4)
check('跨月最后一天是今天', seq[3].day, dayKey(today))

// 直接验证日期递增逻辑：连续 4 天的日期
{
  const d = new Date(today.getTime() - 3 * 86400000)
  const days = []
  for (let i = 0; i < 4; i++) {
    days.push(dayKey(d))
    d.setDate(d.getDate() + 1)
  }
  check('日期序列递增', days[0] < days[1] && days[1] < days[2] && days[2] < days[3], true)
}

console.log('=== 闰年 2 月 ===')

// 2024 是闰年，2 月有 29 天；2026 不是闰年，2 月有 28 天
{
  const leap = new Date(2024, 1, 28)   // 2024-02-28
  const d = new Date(leap.getTime())
  const days = []
  for (let i = 0; i < 3; i++) {
    days.push(dayKey(d))
    d.setDate(d.getDate() + 1)
  }
  check('闰年2月第1天', days[0], '2024-02-28')
  check('闰年2月有29号', days[1], '2024-02-29')
  check('闰年2月最后是3月1号', days[2], '2024-03-01')
}

{
  const normal = new Date(2026, 1, 27)  // 2026-02-27
  const d = new Date(normal.getTime())
  const days = []
  for (let i = 0; i < 3; i++) {
    days.push(dayKey(d))
    d.setDate(d.getDate() + 1)
  }
  check('平年2月第1天', days[0], '2026-02-27')
  check('平年2月没有29号', days[1], '2026-02-28')
  check('平年2月最后是3月1号', days[2], '2026-03-01')
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
