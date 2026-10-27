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

// 两个变化点，中间缺 3 天
const points = [
  { day: '2026-10-20', total: 10000, delta: 0 },
  { day: '2026-10-24', total: 20000, delta: 10000 }
]

const filled = fillChangePoints(points, 5)

check('长度 = 5 天', filled.length, 5)
check('第1天是10-20', filled[0].day, '2026-10-20')
check('第1天值', filled[0].total, 10000)
check('中间缺失补 0', filled[1].total, 0)
check('中间缺失补 0', filled[2].total, 0)
check('中间缺失补 0', filled[3].total, 0)
check('最后一天是10-24', filled[4].day, '2026-10-24')
check('最后一天值', filled[4].total, 20000)

// 连续的两天
const filled2 = fillChangePoints([
  { day: '2026-10-23', total: 100, delta: 0 },
  { day: '2026-10-24', total: 200, delta: 100 }
], 2)
check('连续两天长度', filled2.length, 2)
check('连续第1天', filled2[0].day, '2026-10-23')
check('连续第2天', filled2[1].day, '2026-10-24')

// 单个点
const filled3 = fillChangePoints([{ day: '2026-10-24', total: 500, delta: 0 }], 3)
check('单点补齐3天', filled3.length, 3)
check('单点最后一天有值', filled3[2].total, 500)
check('单点前面补0', filled3[0].total, 0)

// 空数组
check('空数组 -> 空', fillChangePoints([], 10), [])

console.log('=== 跨月边界 ===')

// 跨月：10-30 到 11-02
const filled4 = fillChangePoints([
  { day: '2026-10-30', total: 100, delta: 0 },
  { day: '2026-11-02', total: 200, delta: 100 }
], 4)
check('跨月长度', filled4.length, 4)
check('跨月第1天', filled4[0].day, '2026-10-30')
check('跨月中间1', filled4[1].day, '2026-10-31')
check('跨月中间2', filled4[2].day, '2026-11-01')
check('跨月最后', filled4[3].day, '2026-11-02')

// 跨年：12-30 到 01-02
const filled5 = fillChangePoints([
  { day: '2025-12-30', total: 100, delta: 0 },
  { day: '2026-01-02', total: 200, delta: 100 }
], 4)
check('跨年第1天', filled5[0].day, '2025-12-30')
check('跨年中间1', filled5[1].day, '2025-12-31')
check('跨年中间2', filled5[2].day, '2026-01-01')
check('跨年最后', filled5[3].day, '2026-01-02')

console.log('=== 闰年 2 月 ===')

// 2024 是闰年，2 月有 29 天
const filled6 = fillChangePoints([
  { day: '2024-02-28', total: 100, delta: 0 },
  { day: '2024-03-01', total: 200, delta: 100 }
], 3)
check('闰年2月长度', filled6.length, 3)
check('闰年2月第1天', filled6[0].day, '2024-02-28')
check('闰年2月中间', filled6[1].day, '2024-02-29')
check('闰年2月最后', filled6[2].day, '2024-03-01')

// 2026 不是闰年，2 月有 28 天
const filled7 = fillChangePoints([
  { day: '2026-02-27', total: 100, delta: 0 },
  { day: '2026-03-01', total: 200, delta: 100 }
], 3)
check('平年2月长度', filled7.length, 3)
check('平年2月中间', filled7[1].day, '2026-02-28')

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
