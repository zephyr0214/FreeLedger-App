/**
 * 三级联动日期选择器的区间换算测试 —— 不依赖 SQLite
 *
 *   node scripts/test-date-range.mjs
 *
 * 背景：
 *   统计页与全部交易页都换成了「年 / 月 / 日」三级联动，
 *   0 表示「全部」，需要保证「选择 -> 查询区间」的换算永远正确。
 *   这里把 utils/date.js 的 selectionToRange / defaultSelection /
 *   selectionFromDayKey / selectionLabel 全部钉住。
 */

import {
  selectionToRange, defaultSelection, selectionFromDayKey, selectionLabel,
  cascadeSelection
} from '../utils/date.js'

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

console.log('=== 区间换算 ===')

// 全部年：不限时间
check('全部年 -> 不限', selectionToRange({ year: 0, month: 0, day: 0 }), {
  startDay: '', endDay: '', monthKey: ''
})

// 全部月（整年）
check('全部月 2026 -> 整年', selectionToRange({ year: 2026, month: 0, day: 0 }), {
  startDay: '2026-01-01', endDay: '2026-12-31', monthKey: ''
})

// 全部日（整月）
check('全部日 2026-03 -> 整月', selectionToRange({ year: 2026, month: 3, day: 0 }), {
  startDay: '2026-03-01', endDay: '2026-03-31', monthKey: '2026-03'
})
check('全部日 2026-02 -> 28 天', selectionToRange({ year: 2026, month: 2, day: 0 }), {
  startDay: '2026-02-01', endDay: '2026-02-28', monthKey: '2026-02'
})
check('全部日 2024-02 -> 29 天（闰年）', selectionToRange({ year: 2024, month: 2, day: 0 }), {
  startDay: '2024-02-01', endDay: '2024-02-29', monthKey: '2024-02'
})

// 具体某天
check('具体日 2026-03-15', selectionToRange({ year: 2026, month: 3, day: 15 }), {
  startDay: '2026-03-15', endDay: '2026-03-15', monthKey: '2026-03'
})
check('具体日 2026-01-01', selectionToRange({ year: 2026, month: 1, day: 1 }), {
  startDay: '2026-01-01', endDay: '2026-01-01', monthKey: '2026-01'
})
check('具体日 2026-12-31', selectionToRange({ year: 2026, month: 12, day: 31 }), {
  startDay: '2026-12-31', endDay: '2026-12-31', monthKey: '2026-12'
})

// 越界日：31 号落到 2 月要下调到 28/29 号
check('越界日 2月31 -> 28', selectionToRange({ year: 2026, month: 2, day: 31 }), {
  startDay: '2026-02-28', endDay: '2026-02-28', monthKey: '2026-02'
})
check('越界日 闰年2月31 -> 29', selectionToRange({ year: 2024, month: 2, day: 31 }), {
  startDay: '2024-02-29', endDay: '2024-02-29', monthKey: '2024-02'
})
check('越界日 4月31 -> 30', selectionToRange({ year: 2026, month: 4, day: 31 }), {
  startDay: '2026-04-30', endDay: '2026-04-30', monthKey: '2026-04'
})

// 只有一个年、其余为 0 的组合
check('只有年 -> 整年', selectionToRange({ year: 2025, month: 0, day: 0 }), {
  startDay: '2025-01-01', endDay: '2025-12-31', monthKey: ''
})
check('空对象 -> 不限', selectionToRange({}), {
  startDay: '', endDay: '', monthKey: ''
})
check('undefined -> 不限', selectionToRange(), {
  startDay: '', endDay: '', monthKey: ''
})

console.log('=== 默认值与反解 ===')

const def = defaultSelection()
check('默认是当前年', def.year, new Date().getFullYear())
check('默认是当前月', def.month, new Date().getMonth() + 1)
check('默认日=0（当月）', def.day, 0)

check('dayKey -> 三级', selectionFromDayKey('2026-03-15'), {
  year: 2026, month: 3, day: 15
})
check('dayKey -> 三级（单月）', selectionFromDayKey('2026-12-01'), {
  year: 2026, month: 12, day: 1
})
check('空 dayKey -> 默认', selectionFromDayKey('').year, new Date().getFullYear())
check('非法 dayKey -> 默认', selectionFromDayKey('abc').year, new Date().getFullYear())

// 反解后再换算，应与原区间一致
const orig = selectionToRange({ year: 2026, month: 3, day: 15 })
const round = selectionToRange(selectionFromDayKey(orig.startDay))
check('dayKey 往返一致', round, orig)

console.log('=== 级联修正 ===')

// 选年=0（全部年）→ 月、日清零
check('选全部年 -> 清空月日', cascadeSelection({ year: 0, month: 3, day: 15 }, 'year'), {
  year: 0, month: 0, day: 0
})
// 选年=2026，保留原来的月
check('选具体年 -> 保留月', cascadeSelection({ year: 2026, month: 3, day: 15 }, 'year'), {
  year: 2026, month: 3, day: 15
})

// 选月=0（全部月）→ 日清零
check('选全部月 -> 清空日', cascadeSelection({ year: 2026, month: 0, day: 15 }, 'month'), {
  year: 2026, month: 0, day: 0
})
// 选到具体月但年为空 → 年补今年
check('选月补年', cascadeSelection({ year: 0, month: 3, day: 0 }, 'month'), {
  year: new Date().getFullYear(), month: 3, day: 0
})

// 日越界下调
check('31号选到2月 -> 28', cascadeSelection({ year: 2026, month: 2, day: 31 }, 'day'), {
  year: 2026, month: 2, day: 28
})
check('31号选到闰年2月 -> 29', cascadeSelection({ year: 2024, month: 2, day: 31 }, 'day'), {
  year: 2024, month: 2, day: 29
})
check('31号选到4月 -> 30', cascadeSelection({ year: 2026, month: 4, day: 31 }, 'day'), {
  year: 2026, month: 4, day: 30
})
// 年或月没选时日只能是 0
check('没有年月 -> 日清零', cascadeSelection({ year: 0, month: 0, day: 15 }, 'day'), {
  year: 0, month: 0, day: 0
})
// 正常值不动
check('正常值不变', cascadeSelection({ year: 2026, month: 3, day: 15 }, 'day'), {
  year: 2026, month: 3, day: 15
})

console.log('=== 展示文案 ===')

// selectionLabel：区间级文案
check('文案 全部年', selectionLabel({ year: 0, month: 0, day: 0 }), '全部年')
check('文案 全部月', selectionLabel({ year: 2026, month: 0, day: 0 }), '2026年')
check('文案 全部日', selectionLabel({ year: 2026, month: 3, day: 0 }), '2026年3月')
check('文案 具体日', selectionLabel({ year: 2026, month: 3, day: 15 }), '2026年3月15日')

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
