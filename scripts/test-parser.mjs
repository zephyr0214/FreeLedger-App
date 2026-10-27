/**
 * 速记解析引擎单测 —— 不依赖 uni / SQLite，可直接 node 运行
 *
 *   node scripts/test-parser.mjs
 */

import { parseQuickInput, chineseToNumber } from '../api/quick/parser.js'

const CATEGORIES = [
  { id: 'c_food',  name: '餐饮', parent_id: null, type: 'expense' },
  { id: 'c_car',   name: '交通', parent_id: null, type: 'expense' },
  { id: 'c_shop',  name: '购物', parent_id: null, type: 'expense' },
  { id: 'c_home',  name: '居住', parent_id: null, type: 'expense' },
  { id: 'c_fun',   name: '娱乐', parent_id: null, type: 'expense' },
  { id: 'c_salary', name: '工资', parent_id: null, type: 'income' }
]

const ACCOUNTS = [
  { id: 'a_wechat', name: '微信', type: 'wechat', card_tail: null },
  { id: 'a_alipay', name: '支付宝', type: 'alipay', card_tail: null },
  { id: 'a_cmb',    name: '招商卡', type: 'debit', card_tail: '8888' },
  { id: 'a_credit', name: '信用卡', type: 'credit', card_tail: null }
]

const ALIAS = {
  餐饮: ['吃', '吃饭', '外卖', '午饭', '晚饭', '奶茶', '咖啡'],
  交通: ['打车', '地铁', '公交', '加油', '停车', '滴滴'],
  购物: ['买', '淘宝', '京东', '超市'],
  居住: ['房租', '水电', '物业'],
  娱乐: ['电影', '游戏', '会员'],
  工资: ['工资', '发工资', '月薪']
}

const TAGS = [
  { id: 't_dec', name: '装修' },
  { id: 't_jp', name: '日本旅行' }
]

const ctx = {
  categories: CATEGORIES,
  accounts: ACCOUNTS,
  tags: TAGS,
  aliasMap: ALIAS,
  defaultAccountId: 'a_wechat',
  baseDate: new Date('2026-10-27T15:00:00')
}

const CASES = [
  { input: '昨天中午吃饭四十五',  expect: { cents: 4500,  cat: '餐饮', type: 'expense' } },
  { input: '打车二十八块五',      expect: { cents: 2850,  cat: '交通' } },
  { input: '发工资一万二',        expect: { cents: 1200000, cat: '工资', type: 'income' } },
  { input: '5号交房租3500',       expect: { cents: 350000, cat: '居住' } },
  { input: '奶茶12块8',           expect: { cents: 1280,  cat: '餐饮' } },
  { input: '超市买了200',         expect: { cents: 20000, cat: '购物' } },
  { input: '电影票六十',          expect: { cents: 6000,  cat: '娱乐' } },
  { input: '今天天气不错',        expect: { cents: 0,     canSubmit: false } },
  { input: '打车到公司28',        expect: { cents: 2800,  cat: '交通' } },
  { input: '支付宝付了水电费300', expect: { cents: 30000, cat: '居住' } }
]

let pass = 0
let fail = 0

console.log('=== 中文数字 ===')
for (const [input, expect] of [['四十五', 45], ['一百二', 120], ['一万二', 12000], ['两万五', 25000]]) {
  const got = chineseToNumber(input)
  const ok = got === expect
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${input} => ${got} (期望 ${expect})`)
  ok ? pass++ : fail++
}

console.log('\n=== 速记解析 ===')
for (const c of CASES) {
  const r = parseQuickInput(c.input, ctx)
  const issues = []

  if (c.expect.cents !== undefined && r.amount_cents !== c.expect.cents) {
    issues.push(`金额 ${r.amount_cents} ≠ ${c.expect.cents}`)
  }
  if (c.expect.cat !== undefined && r.category_name !== c.expect.cat) {
    issues.push(`分类 "${r.category_name}" ≠ "${c.expect.cat}"`)
  }
  if (c.expect.type !== undefined && r.type !== c.expect.type) {
    issues.push(`类型 ${r.type} ≠ ${c.expect.type}`)
  }
  if (c.expect.canSubmit !== undefined && r.canSubmit !== c.expect.canSubmit) {
    issues.push(`canSubmit ${r.canSubmit} ≠ ${c.expect.canSubmit}`)
  }

  const ok = issues.length === 0
  console.log(`${ok ? 'PASS' : 'FAIL'}  "${c.input}"`)
  console.log(`      => ${r.type} ¥${(r.amount_cents / 100).toFixed(2)} ${r.category_name || '-'} ${r.account_name || '-'} conf=${r.confidence} missing=[${r.missing}]`)
  if (!ok) {
    issues.forEach((i) => console.log(`      ⚠ ${i}`))
    fail++
  } else {
    pass++
  }
}

console.log('\n=== 时间解析 ===')
const timeCases = [
  { input: '昨天吃饭20',  expectDay: '2026-10-26' },
  { input: '前天打车35',  expectDay: '2026-10-25' },
  { input: '今天午饭15',  expectDay: '2026-10-27' }
]
for (const c of timeCases) {
  const r = parseQuickInput(c.input, ctx)
  const ok = r.occurred_day === c.expectDay
  console.log(`${ok ? 'PASS' : 'FAIL'}  "${c.input}" => ${r.occurred_day} (期望 ${c.expectDay})`)
  ok ? pass++ : fail++
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
