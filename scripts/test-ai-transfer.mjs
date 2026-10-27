/**
 * AI 速记的转账方向解析测试
 *
 *   node scripts/test-ai-transfer.mjs
 *
 * 背景：
 *   「微信转账给支付宝200元」会报「转账缺少目标账户」。
 *   根因是 prompt 里**从来没提过 toAccount 这个字段** ——
 *   规则只讲了 category / account / date / note，
 *   示例 JSON 里也只有 "account"，
 *   模型根本不知道转账要额外给一个目标账户。
 *
 *   现在：
 *     1. prompt 规则补上 toAccount，并给了转账的示例格式
 *     2. 模型仍漏掉时，用规则从原句里解析转账方向兜底
 */

import { parseTransferDirection, validateItem, extractJsonArray } from '../api/aiParse.js'

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

const ACCOUNTS = [
  { id: 'a_wx', name: '微信', type: 'wechat' },
  { id: 'a_ali', name: '支付宝', type: 'alipay' },
  { id: 'a_cmb', name: '招商卡', type: 'debit' },
  { id: 'a_cash', name: '现金', type: 'cash' }
]

console.log('=== 转账方向解析 ===')

let d = parseTransferDirection('微信转账给支付宝200元', ACCOUNTS)
check('A转给B -> 转出A', d.from && d.from.id, 'a_wx')
check('A转给B -> 转入B', d.to && d.to.id, 'a_ali')

d = parseTransferDirection('从支付宝转到招商卡', ACCOUNTS)
check('从A转到B -> 转出A', d.from && d.from.id, 'a_ali')
check('从A转到B -> 转入B', d.to && d.to.id, 'a_cmb')

d = parseTransferDirection('微信转支付宝200', ACCOUNTS)
check('A转B -> 转出A', d.from && d.from.id, 'a_wx')
check('A转B -> 转入B', d.to && d.to.id, 'a_ali')

d = parseTransferDirection('从现金转200到微信', ACCOUNTS)
check('从A转B到C -> 转出A', d.from && d.from.id, 'a_cash')
check('从A转B到C -> 转入C', d.to && d.to.id, 'a_wx')

// 只提到一个账户 -> 解析不出方向
d = parseTransferDirection('微信花了200', ACCOUNTS)
check('只有一个账户 -> from 为 null', d.from, null)
check('只有一个账户 -> to 为 null', d.to, null)

// 完全没有账户
d = parseTransferDirection('转了200元', ACCOUNTS)
check('没有账户 -> from 为 null', d.from, null)
check('没有账户 -> to 为 null', d.to, null)

console.log('=== validateItem 端到端 ===')

const CTX = {
  categories: [{ id: 'c_other', name: '其他', type: 'expense', parent_id: null }],
  accounts: ACCOUNTS,
  tags: [],
  baseDate: new Date('2026-10-27T15:00:00')
}

// 模型正确给了 toAccount
let v = validateItem({
  amount: 200, type: 'transfer',
  account: '微信', toAccount: '支付宝', date: '2026-10-27'
}, CTX)
check('模型给全 -> 转出', v.item.account_id, 'a_wx')
check('模型给全 -> 转入', v.item.to_account_id, 'a_ali')
check('模型给全 -> 名称', v.item.to_account_name, '支付宝')

// ★ 模型漏了 toAccount -> 用原句兜底 ★
v = validateItem({
  amount: 200, type: 'transfer',
  account: '微信', date: '2026-10-27', note: '微信转账给支付宝200元'
}, { ...CTX, hintText: '微信转账给支付宝200元' })
check('漏toAccount -> 兜底出转入', v.item.to_account_id, 'a_ali')
check('漏toAccount -> 兜底出转出', v.item.account_id, 'a_wx')

// 模型连 account 也漏了 -> 两个都靠原句
v = validateItem({
  amount: 200, type: 'transfer', date: '2026-10-27', note: '从支付宝转到招商卡'
}, { ...CTX, hintText: '从支付宝转到招商卡' })
check('全漏 -> 兜底转出', v.item.account_id, 'a_ali')
check('全漏 -> 兜底转入', v.item.to_account_id, 'a_cmb')

// 真的没有目标账户 -> 拒绝
v = validateItem({
  amount: 200, type: 'transfer', account: '微信', date: '2026-10-27'
}, { ...CTX, hintText: '转了200元' })
check('无目标 -> 拒绝', v.ok, false)
check('无目标 -> 原因', v.reason, '转账缺少目标账户')

// 转出转入相同 -> 拒绝
v = validateItem({
  amount: 200, type: 'transfer', account: '微信', toAccount: '微信', date: '2026-10-27'
}, CTX)
check('同账户 -> 拒绝', v.ok, false)
check('同账户 -> 原因', v.reason, '转出与转入账户不能相同')

console.log('=== 模拟完整解析链路（模型漏 toAccount） ===')

/** 模拟 parseMessageToTransactions 的校验循环（不联网） */
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
    if (!item.account_id) {
      item.account_id = defaultAccountId || (ctx.accounts[0] || {}).id || ''
      const acc = ctx.accounts.find((a) => a.id === item.account_id)
      item.account_name = acc ? acc.name : ''
    }
    items.push(item)
  }
  return { items, warnings }
}

// 模型只给了 account，没给 toAccount（这正是报错场景）
const modelReply = `[
  {"amount": 200, "type": "transfer", "category": null, "account": "微信", "date": "2026-10-27", "note": "转给支付宝"}
]`

const userMessage = '微信转账给支付宝200元'
const simCtx = { ...CTX, hintText: userMessage }
const sim = simulateParse(modelReply, simCtx, 'a_cmb')

check('链路：没有警告', sim.warnings.length, 0)
check('链路：保存了1条', sim.items.length, 1)
check('链路：转出账户', sim.items[0].account_id, 'a_wx')
check('链路：转入账户', sim.items[0].to_account_id, 'a_ali')

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
