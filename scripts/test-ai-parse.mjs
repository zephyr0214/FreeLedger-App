/**
 * AI 解析校验层单测 —— 只测纯函数，不联网
 *
 *   node scripts/test-ai-parse.mjs
 *
 * 这是整个 AI 记账功能里最需要测的部分：
 * 模型输出完全不可信，任何脏数据都必须在入库前被拦掉。
 */

import { extractJsonArray, toCents, toDayKey, validateItem } from '../api/aiParse.js'

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

function checkThrows(name, fn) {
  try {
    fn()
    fail++
    console.log(`FAIL  ${name}  (期望抛错，实际没抛)`)
  } catch (e) {
    pass++
  }
}

/* ============================================================ JSON 提取 */

console.log('=== JSON 提取 ===')

check('纯数组', extractJsonArray('[{"amount":45}]'), [{ amount: 45 }])
check('markdown 代码块', extractJsonArray('```json\n[{"amount":45}]\n```'), [{ amount: 45 }])
check('前后带解释文字', extractJsonArray('好的：[{"amount":45}] 完毕'), [{ amount: 45 }])
check('单个对象包成数组', extractJsonArray('{"amount":45}'), [{ amount: 45 }])
check('多条记录', extractJsonArray('[{"amount":10},{"amount":20}]'), [{ amount: 10 }, { amount: 20 }])
check('空数组', extractJsonArray('[]'), [])
check('嵌套结构', extractJsonArray('[{"a":{"b":1},"c":[1,2]}]'), [{ a: { b: 1 }, c: [1, 2] }])
check('带换行空格', extractJsonArray('[\n {"amount":12.5},\n {"amount":8}\n]'), [{ amount: 12.5 }, { amount: 8 }])

checkThrows('无 JSON', () => extractJsonArray('我不知道'))
checkThrows('非字符串', () => extractJsonArray(null))
checkThrows('损坏 JSON', () => extractJsonArray('[{"amount":}]'))

/* ================================================================ 金额 */

console.log('\n=== 金额校验 ===')

check('整数', toCents(45), 4500)
check('小数', toCents(45.5), 4550)
check('两位小数', toCents(12.34), 1234)
check('字符串', toCents('45'), 4500)
check('带货币符号', toCents('¥45.50'), 4550)
check('负数无效（方向由type决定）', toCents(-45), null)
check('零无效', toCents(0), null)
check('空值无效', toCents(null), null)
check('非数字无效', toCents('abc'), null)
check('超限无效', toCents(200000000), null)   // 2 亿元 > 1 亿上限
check('NaN 无效', toCents(NaN), null)
check('Infinity 无效', toCents(Infinity), null)

/* ================================================================ 日期 */

console.log('\n=== 日期校验 ===')

const BASE = new Date('2026-10-27T15:00:00')

check('今天', toDayKey('今天', BASE), '2026-10-27')
check('昨天', toDayKey('昨天', BASE), '2026-10-26')
check('前天', toDayKey('前天', BASE), '2026-10-25')
check('明天', toDayKey('明天', BASE), '2026-10-28')

check('标准日期', toDayKey('2026-10-01', BASE), '2026-10-01')
check('斜杠日期', toDayKey('2026/10/01', BASE), '2026-10-01')
check('空值用今天', toDayKey(null, BASE), '2026-10-27')

check('偏移 0', toDayKey(0, BASE), '2026-10-27')
check('偏移 -1', toDayKey(-1, BASE), '2026-10-26')
check('偏移数字字符串', toDayKey('-2', BASE), '2026-10-25')

// 关键：2 月 30 日这种不存在的日期必须被拒绝，回退到今天
check('无效日期回退', toDayKey('2026-02-30', BASE), '2026-10-27')
check('月份越界回退', toDayKey('2026-13-01', BASE), '2026-10-27')
check('垃圾字符串回退', toDayKey('随便写的', BASE), '2026-10-27')

/* ============================================================ 整条校验 */

console.log('\n=== 整条记录校验 ===')

const CTX = {
  categories: [
    { id: 'c_food', name: '餐饮', type: 'expense', parent_id: null },
    { id: 'c_car', name: '交通', type: 'expense', parent_id: null },
    { id: 'c_salary', name: '工资', type: 'income', parent_id: null },
    { id: 'c_other', name: '其他', type: 'expense', parent_id: null }
  ],
  accounts: [
    { id: 'a_wechat', name: '微信', type: 'wechat' },
    { id: 'a_cmb', name: '招商卡', type: 'debit' }
  ],
  tags: [{ id: 't_dec', name: '装修' }],
  baseDate: BASE
}

// 正常
const r1 = validateItem(
  { amount: 45.5, type: 'expense', category: '餐饮', account: '微信', date: '2026-10-27', note: '午饭' },
  CTX
)
check('正常记录 ok', r1.ok, true)
check('正常记录 金额', r1.item.amount_cents, 4550)
check('正常记录 分类id', r1.item.category_id, 'c_food')
check('正常记录 账户id', r1.item.account_id, 'a_wechat')
check('正常记录 备注', r1.item.note, '午饭')

// 金额缺失
const r2 = validateItem({ type: 'expense', category: '餐饮' }, CTX)
check('缺金额被拒', r2.ok, false)
check('缺金额原因', /金额无效/.test(r2.reason), true)

// 类型非法 → 退化为支出
const r3 = validateItem({ amount: 10, type: '转账啊' }, CTX)
check('非法类型退化', r3.item.type, 'expense')

// 分类名不认识 → category_id 为 null（后续由调用方兜底）
const r4 = validateItem({ amount: 10, type: 'expense', category: '不存在的分类' }, CTX)
check('未知分类为空', r4.item.category_id, null)
check('标记非AI来源', r4.item.categoryFromAi, false)

// 分类按 id 匹配
const r5 = validateItem({ amount: 10, type: 'expense', category: 'c_car' }, CTX)
check('分类按id匹配', r5.item.category_id, 'c_car')

// 账户按卡号后四位之外的名称匹配
const r6 = validateItem({ amount: 10, type: 'expense', account: '招商卡' }, CTX)
check('账户名称匹配', r6.item.account_id, 'a_cmb')

// 标签
const r7 = validateItem({ amount: 10, type: 'expense', tags: ['装修', '不存在'] }, CTX)
check('标签匹配', r7.item.tag_ids, ['t_dec'])

// 转账缺目标账户 → 拒绝
const r8 = validateItem({ amount: 100, type: 'transfer', account: '微信' }, CTX)
check('转账缺目标被拒', r8.ok, false)
check('转账缺目标原因', /目标账户/.test(r8.reason), true)

// 转账正常
const r9 = validateItem(
  { amount: 100, type: 'transfer', account: '微信', toAccount: '招商卡' },
  CTX
)
check('转账 ok', r9.ok, true)
check('转账目标', r9.item.to_account_id, 'a_cmb')

// 非对象
const r10 = validateItem('不是对象', CTX)
check('非对象被拒', r10.ok, false)

// 备注过长被截断
const r11 = validateItem({ amount: 10, type: 'expense', note: 'x'.repeat(200) }, CTX)
check('备注截断到100', r11.item.note.length, 100)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
