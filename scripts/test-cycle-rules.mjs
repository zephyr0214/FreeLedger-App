/**
 * 周期规则测试 —— 每两周 / 每年 / 每间隔天
 *
 *   node scripts/test-cycle-rules.mjs
 *
 * 只测纯日期函数（occurrencesInRange / recurrenceLabel），
 * 不依赖 plus.sqlite。
 */

import {
  CYCLE_RECURRENCES, occurrencesInRange, recurrenceLabel
} from '../api/cycle.js'

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

const ms = (y, m, d) => new Date(y, m - 1, d, 9, 0, 0).getTime()

console.log('=== 周期规则清单 ===')
check('六种周期规则', CYCLE_RECURRENCES.map((r) => r.name), [
  '每天', '每周', '每两周', '每月', '每年', '每间隔天'
])

console.log('=== 每两周 ===')
{
  // 2026-01-05 是周一；从周一开始每两周
  const cycle = { recurrence: 'biweekly', weekday: 1, created_at: ms(2026, 1, 5) }
  check(
    '周一创建，隔周周一',
    occurrencesInRange(cycle, '2026-01-05', '2026-02-02'),
    ['2026-01-05', '2026-01-19', '2026-02-02']
  )

  // 2026-01-07 是周三；第一次落在下周一（1/12），之后隔周
  const wed = { recurrence: 'biweekly', weekday: 1, created_at: ms(2026, 1, 7) }
  check(
    '周三创建，第一次是下周一',
    occurrencesInRange(wed, '2026-01-07', '2026-02-10'),
    ['2026-01-12', '2026-01-26', '2026-02-09']
  )
}

console.log('=== 每年 ===')
{
  const cycle = { recurrence: 'yearly', month_of_year: 3, day_of_month: 15, created_at: ms(2026, 1, 1) }
  check(
    '每年 3 月 15 日',
    occurrencesInRange(cycle, '2026-01-01', '2027-12-31'),
    ['2026-03-15', '2027-03-15']
  )
  check('每年标签', recurrenceLabel(cycle), '每年3月15日')

  // 创建日期晚于当年纪念日时，当年不再补，下一次在明年
  const late = { recurrence: 'yearly', month_of_year: 3, day_of_month: 15, created_at: ms(2026, 11, 1) }
  check(
    '11 月创建，下一次是明年 3 月',
    occurrencesInRange(late, '2026-01-01', '2027-12-31'),
    ['2027-03-15']
  )
}

console.log('=== 每间隔天 ===')
{
  const cycle = { recurrence: 'interval', interval_days: 14, created_at: ms(2026, 1, 5) }
  check(
    '从创建日起每 14 天',
    occurrencesInRange(cycle, '2026-01-05', '2026-02-03'),
    ['2026-01-05', '2026-01-19', '2026-02-02']
  )
  check('间隔标签', recurrenceLabel(cycle), '每14天')
}

console.log('=== 旧规则标签不受影响 ===')
check('每天', recurrenceLabel({ recurrence: 'daily' }), '每天')
check('每周三', recurrenceLabel({ recurrence: 'weekly', weekday: 3 }), '每周三')
check('每月 15 号', recurrenceLabel({ recurrence: 'monthly', day_of_month: 15 }), '每月15号')

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
