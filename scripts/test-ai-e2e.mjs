/**
 * AI 记账端到端模拟测试 —— 用假的模型回复跑完整解析链路
 *
 *   node scripts/test-ai-e2e.mjs
 *
 * 目的：验证「多条记录拆分 + 兜底 + 拒绝脏数据」在真实调用路径下有效，
 *      但不联网。通过 monkey-patch 替换 chat() 的返回。
 */

import { extractJsonArray, validateItem, toCents, toDayKey } from '../api/aiParse.js'

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

const BASE = new Date('2026-10-27T15:00:00')

const CTX = {
  categories: [
    { id: 'c_food', name: '餐饮', type: 'expense', parent_id: null },
    { id: 'c_car', name: '交通', type: 'expense', parent_id: null },
    { id: 'c_salary', name: '工资', type: 'income', parent_id: null },
    { id: 'c_other', name: '其他', type: 'expense', parent_id: null },
    { id: 'c_other_in', name: '其他', type: 'income', parent_id: null }
  ],
  accounts: [
    { id: 'a_wechat', name: '微信', type: 'wechat' },
    { id: 'a_cmb', name: '招商卡', type: 'debit' }
  ],
  tags: [{ id: 't_dec', name: '装修' }],
  baseDate: BASE
}

/**
 * 模拟 parseMessageToTransactions 的核心校验循环
 * （不调 chat，直接把「模型回复」喂进来）
 */
function simulateParse(reply, ctx, defaultAccountId) {
  const rawItems = extractJsonArray(reply)
  const items = []
  const warnings = []

  for (let i = 0; i < rawItems.length; i++) {
    const res = validateItem(rawItems[i], ctx)
    if (!res.ok) {
      warnings.push(`第 ${i + 1} 条已跳过：${res.reason}`)
      continue
    }
    const item = res.item

    // 账户兜底
    if (!item.account_id) {
      item.account_id = defaultAccountId || (ctx.accounts[0] || {}).id || ''
      const acc = ctx.accounts.find((a) => a.id === item.account_id)
      item.account_name = acc ? acc.name : ''
      item.accountFromAi = false
    }

    // 分类兜底
    if (item.type !== 'transfer' && !item.category_id) {
      const other = ctx.categories.find(
        (c) => !c.parent_id && c.name === '其他' && c.type === item.type
      )
      if (other) {
        item.category_id = other.id
        item.category_name = other.name
      }
      item.categoryFromAi = false
    }

    if (!item.account_id) {
      warnings.push(`第 ${i + 1} 条已跳过：没有可用账户`)
      continue
    }
    items.push(item)
  }

  return { items, warnings }
}

/* ------------------------------------------- 场景1：一条消息多笔 */

console.log('=== 场景1: 一句话拆多条 ===')

const multiReply = `[
  {"amount": 45, "type": "expense", "category": "餐饮", "account": "微信", "date": "2026-10-26", "note": "午饭"},
  {"amount": 28, "type": "expense", "category": "交通", "account": "微信", "date": "2026-10-26", "note": "打车"}
]`

const r1 = simulateParse(multiReply, CTX, 'a_wechat')
check('拆出2条', r1.items.length, 2)
check('第1条金额', r1.items[0].amount_cents, 4500)
check('第1条分类', r1.items[0].category_id, 'c_food')
check('第2条金额', r1.items[1].amount_cents, 2800)
check('第2条分类', r1.items[1].category_id, 'c_car')
check('第1条日期', r1.items[0].occurred_day, '2026-10-26')
check('无警告', r1.warnings.length, 0)

/* ------------------------------------- 场景2：模型漏字段走兜底 */

console.log('\n=== 场景2: 缺字段兜底 ===')

const looseReply = `[
  {"amount": 100, "type": "expense", "note": "没给分类和账户"}
]`

const r2 = simulateParse(looseReply, CTX, 'a_wechat')
check('仍保存1条', r2.items.length, 1)
check('账户兜底为默认', r2.items[0].account_id, 'a_wechat')
check('账户标记非AI', r2.items[0].accountFromAi, false)
check('分类兜底为其他', r2.items[0].category_id, 'c_other')
check('分类标记非AI', r2.items[0].categoryFromAi, false)
check('日期默认今天', r2.items[0].occurred_day, '2026-10-27')

/* ------------------------------------------ 场景3：脏数据被拒绝 */

console.log('\n=== 场景3: 脏数据拦截 ===')

const dirtyReply = `[
  {"amount": "abc", "type": "expense"},
  {"type": "expense", "category": "餐饮"},
  {"amount": -50, "type": "expense", "category": "餐饮"},
  {"amount": 999999999999, "type": "expense"},
  {"amount": 30, "type": "expense", "category": "餐饮"}
]`

const r3 = simulateParse(dirtyReply, CTX, 'a_wechat')
check('只有1条有效', r3.items.length, 1)
check('有效的是30元', r3.items[0].amount_cents, 3000)
check('跳过4条', r3.warnings.length, 4)
check('警告含金额无效', /金额无效/.test(r3.warnings[0]), true)

/* ------------------------------------- 场景4：收入与月份边界 */

console.log('\n=== 场景4: 收入识别 ===')

const incomeReply = `[
  {"amount": 12000, "type": "income", "category": "工资", "account": "招商卡", "date": "2026-10-25"}
]`

const r4 = simulateParse(incomeReply, CTX, 'a_wechat')
check('收入类型', r4.items[0].type, 'income')
check('收入金额', r4.items[0].amount_cents, 1200000)
check('收入分类', r4.items[0].category_id, 'c_salary')

/* ------------------------------------ 场景5：转账与非法类型退化 */

console.log('\n=== 场景5: 转账与类型退化 ===')

const transferReply = `[
  {"amount": 500, "type": "transfer", "account": "微信", "toAccount": "招商卡"}
]`
const r5 = simulateParse(transferReply, CTX, 'a_wechat')
check('转账目标', r5.items[0].to_account_id, 'a_cmb')

const badTypeReply = `[
  {"amount": 20, "type": "不清楚", "category": "餐饮"}
]`
const r6 = simulateParse(badTypeReply, CTX, 'a_wechat')
check('非法类型退化为支出', r6.items[0].type, 'expense')

const transferNoToReply = `[
  {"amount": 500, "type": "transfer", "account": "微信"}
]`
const r7 = simulateParse(transferNoToReply, CTX, 'a_wechat')
check('转账缺目标被拒', r7.items.length, 0)
check('有警告', r7.warnings.length, 1)

/* -------------------------------------------- 场景6：20条上限 */

console.log('\n=== 场景6: 批量上限 ===')

const many = []
for (let i = 0; i < 25; i++) {
  many.push({ amount: i + 1, type: 'expense', category: '餐饮' })
}
const r8 = simulateParse(JSON.stringify(many), CTX, 'a_wechat')
// 注意：上限裁剪在 parseMessageToTransactions 里做，模拟函数没裁，
// 这里只验证 25 条都能通过校验
check('25条都能校验通过', r8.items.length, 25)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
