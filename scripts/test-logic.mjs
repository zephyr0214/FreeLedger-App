/**
 * 业务逻辑纯函数测试 —— 不依赖 SQLite
 *
 *   node scripts/test-logic.mjs
 */

import { evaluateAmount, parseAmountInput, formatCents, yuanToCents, formatCentsCompact } from '../utils/money.js'
import { toDayKey, toMonthKey, shiftMonth, shiftDay, monthRange, monthProgress, relativeDayLabel, daysUntilMonthDay } from '../utils/date.js'

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

console.log('=== 金额 ===')
check('元转分 12.34', yuanToCents(12.34), 1234)
check('元转分 0.1+0.2', yuanToCents(0.1) + yuanToCents(0.2), 30)
check('表达式 12+8', evaluateAmount('12+8'), 2000)
check('表达式 100-30', evaluateAmount('100-30'), 7000)
check('表达式 2×3', evaluateAmount('2×3'), 600)
check('表达式 2×(3+4)', evaluateAmount('2×(3+4)'), 1400)
check('表达式 100÷4', evaluateAmount('100÷4'), 2500)
check('表达式 (10+5)×2', evaluateAmount('(10+5)×2'), 3000)
check('表达式 2×3+4', evaluateAmount('2×3+4'), 1000)
check('表达式 除以0无效', evaluateAmount('10÷0'), 0)
check('普通过滤 1,234', parseAmountInput('1,234'), 123400)

check('格式化 12345', formatCents(12345), '123.45')
check('格式化千分位', formatCents(123456789), '1,234,567.89')
check('格式化负数', formatCents(-4500), '-45.00')
check('格式化带符号', formatCents(4500, { sign: true }), '+45.00')
check('紧凑 1万', formatCentsCompact(1000000), '1.0万')
check('紧凑 1.2k', formatCentsCompact(120000), '1.2k')

console.log('=== 金额正负号（交易类型） ===')

/**
 * 与 MoneyText 组件的 signedCents / showSign 同样的逻辑：
 *   支出 -> 负数（前面 -）
 *   收入 -> 正数（前面 +）
 *   转账 -> 原值（不加符号）
 */
function signedAmount(cents, type) {
  const n = Number(cents) || 0
  if (type === 'expense') return -Math.abs(n)
  if (type === 'income') return Math.abs(n)
  return n
}

function shouldShowSign(type) {
  if (type) return type === 'expense' || type === 'income'
  return false
}

check('支出变负数', signedAmount(4500, 'expense'), -4500)
check('收入变正数', signedAmount(4500, 'income'), 4500)
check('转账保持原值', signedAmount(4500, 'transfer'), 4500)
check('支出显示符号', shouldShowSign('expense'), true)
check('收入显示符号', shouldShowSign('income'), true)
check('转账不显示符号', shouldShowSign('transfer'), false)

// 最终展示
check('支出显示 -', formatCents(signedAmount(4500, 'expense'), { sign: shouldShowSign('expense') }), '-45.00')
check('收入显示 +', formatCents(signedAmount(4500, 'income'), { sign: shouldShowSign('income') }), '+45.00')
check('转账不显示符号', formatCents(signedAmount(4500, 'transfer'), { sign: shouldShowSign('transfer') }), '45.00')

// 已经传了负数也不该出双负号
check('支出传负数不会双负号', formatCents(signedAmount(-4500, 'expense'), { sign: shouldShowSign('expense') }), '-45.00')
// 收入传负数也取绝对值
check('收入传负数取正', formatCents(signedAmount(-4500, 'income'), { sign: shouldShowSign('income') }), '+45.00')

console.log('=== 日期 ===')
const d = new Date('2026-10-27T15:30:00')
check('dayKey', toDayKey(d), '2026-10-27')
check('monthKey', toMonthKey(d), '2026-10')
check('shiftMonth +1', shiftMonth('2026-10', 1), '2026-11')
check('shiftMonth -1 跨年', shiftMonth('2026-01', -1), '2025-12')
check('shiftDay -1', shiftDay('2026-10-01', -1), '2026-09-30')
check('shiftDay +1 跨月', shiftDay('2026-10-31', 1), '2026-11-01')

const r = monthRange('2026-02')
check('2月最后一天', r.end.getDate(), 28)
check('2月总天数', monthRange('2024-02').end.getDate(), 29)

const mp = monthProgress('2026-09')
check('已过月份 passed=total', mp.passed, mp.total)

console.log('=== 还款日 ===')
// 2026-10-27，还款日 30 号 → 3 天后
check('还款日倒计时', daysUntilMonthDay(30) >= 0, true)
check('账单日 31 号不越界', daysUntilMonthDay(31) >= 0, true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
