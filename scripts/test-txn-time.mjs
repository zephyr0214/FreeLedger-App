/**
 * 交易时刻的测试
 *
 *   node scripts/test-txn-time.mjs
 *
 * 背景：
 *   所有记录的时间都显示「12:00」。
 *   根因是 api/transaction.js 里：
 *     new Date(`${input.occurred_day}T12:00:00`)
 *   只要传了日期就把时刻写死成当天中午。
 *
 * 现在的规则：
 *   - 传了 occurred_at  → 用它（精确到分）
 *   - 只传 occurred_day → 当天的**当前时刻**（今天记就是此刻）
 *   - 过去/未来的日期   → 当天 12:00（中性值，不会跨天）
 *   - 都没传            → 此刻
 */

import { resolveOccurredTime } from '../api/transaction.js'
import {
  currentTimeText, combineDayTime, formatTime, toDayKey
} from '../utils/date.js'
import { toTimeText } from '../api/aiParse.js'

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

console.log('=== combineDayTime（日期 + 时刻 -> 时间戳）===')

const ts = combineDayTime('2026-10-27', '15:30')
const d = new Date(ts)
check('日期对', d.getFullYear(), 2026)
check('月对', d.getMonth() + 1, 10)
check('日对', d.getDate(), 27)
check('时对', d.getHours(), 15)
check('分对', d.getMinutes(), 30)

check('零点的时分', (() => {
  const x = new Date(combineDayTime('2026-01-01', '00:00'))
  return [x.getHours(), x.getMinutes()]
})(), [0, 0])

check('23:59', (() => {
  const x = new Date(combineDayTime('2026-01-01', '23:59'))
  return [x.getHours(), x.getMinutes()]
})(), [23, 59])

console.log('=== resolveOccurredTime（落库时刻）===')

// 传了 occurred_at -> 用它
check('用传入的时刻', resolveOccurredTime({ occurred_at: 1234567890 }).getTime(), 1234567890)

// 只传今天的日期 -> 当前时刻（不是 12:00）
const now = new Date()
const todayKey = toDayKey(now)
const resolved = resolveOccurredTime({ occurred_day: todayKey })
const r = new Date(resolved.getTime())
check('今天是当前小时', r.getHours(), now.getHours())
check('今天是当前分钟', r.getMinutes(), now.getMinutes())
check('今天不是 12 点整', r.getHours() === 12 && r.getMinutes() === 0, false)

// 过去日期 -> 当天中午
const past = resolveOccurredTime({ occurred_day: '2026-01-05' })
const p = new Date(past.getTime())
check('过去日期是 12:00', [p.getHours(), p.getMinutes()], [12, 0])
check('过去日期日期对', toDayKey(p), '2026-01-05')

// 都没传 -> 此刻
check('都没传 -> 此刻', (() => {
  const x = new Date(resolveOccurredTime({}).getTime())
  return x.getHours() === now.getHours()
})(), true)

console.log('=== 时刻解析（AI 用）===')

check('08:30', toTimeText('08:30'), '08:30')
check('8:30', toTimeText('8:30'), '08:30')
check('晚上8点', toTimeText('晚上8点'), '20:00')
check('下午3点', toTimeText('下午3点'), '15:00')
check('中午12点', toTimeText('中午12点'), '12:00')
check('凌晨1点', toTimeText('凌晨1点'), '01:00')
check('晚上8点半', toTimeText('晚上8点半'), '20:30')
check('上午9点30分', toTimeText('上午9点30分'), '09:30')
check('12点', toTimeText('12点'), '12:00')
check('null', toTimeText(null), null)
check('空串', toTimeText(''), null)
check('乱写', toTimeText('随便写的'), null)
check('非法小时', toTimeText('25:00'), null)

console.log('=== 格式化 ===')

check('currentTimeText 格式', /^\d{2}:\d{2}$/.test(currentTimeText()), true)
check('formatTime', formatTime(combineDayTime('2026-10-27', '08:05')), '08:05')

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
