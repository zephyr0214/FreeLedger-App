/**
 * 账户类型的测试
 *
 *   node scripts/test-account-types.mjs
 *
 * 用户要求：账户类型**就这五个**，
 * 网络支付 / 信用卡 / 储蓄卡 / 现金 / 充值卡。
 * 之前多出来的「投资 / 借入 / 应收 / 其他」是多余的，
 * 这个测试确保它们不会又被加回来。
 */

import {
  ACCOUNT_TYPES, ACCOUNT_GROUPS, getTypeMeta, isCreditType
} from '../api/account.js'

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

console.log('=== 就这五种类型 ===')

const EXPECTED = ['网络支付', '信用卡', '储蓄卡', '现金', '充值卡']

check('类型数量就是 5 个', ACCOUNT_TYPES.length, 5)
check('类型名称', ACCOUNT_TYPES.map((t) => t.name), EXPECTED)
check('类型 key', ACCOUNT_TYPES.map((t) => t.key), ['online', 'credit', 'debit', 'cash', 'prepaid'])

console.log('=== 之前多出来的类型已删除 ===')

const FORBIDDEN = ['投资', '借入', '应收', '其他', '支付宝', '微信', '花呗']
for (const name of FORBIDDEN) {
  check(`没有「${name}」类型`, ACCOUNT_TYPES.some((t) => t.name === name), false)
}

console.log('=== 展示分组 ===')

check('分组数量就是 5 个', ACCOUNT_GROUPS.length, 5)
check('分组名称', ACCOUNT_GROUPS.map((g) => g.name), EXPECTED)
check('分组顺序与类型一致', ACCOUNT_GROUPS.map((g) => g.key), ACCOUNT_TYPES.map((t) => t.key))

// 每个类型都要能在分组里找到
for (const t of ACCOUNT_TYPES) {
  check(`${t.name} 有对应的展示分组`, ACCOUNT_GROUPS.some((g) => g.key === t.group), true)
}

console.log('=== 信用账户 ===')

check('信用卡是信用账户', isCreditType('credit'), true)
check('储蓄卡不是信用账户', isCreditType('debit'), false)
check('网络支付不是信用账户', isCreditType('online'), false)
check('现金不是信用账户', isCreditType('cash'), false)
check('充值卡不是信用账户', isCreditType('prepaid'), false)

console.log('=== 兜底 ===')

// 未知类型要兜底到第一个，不能崩
const fallback = getTypeMeta('不存在的类型')
check('未知类型有兜底', typeof fallback.key, 'string')
check('兜底的 group 有效', ACCOUNT_GROUPS.some((g) => g.key === fallback.group), true)

// 每个类型都要有图标和名称
for (const t of ACCOUNT_TYPES) {
  check(`${t.name} 有名称`, !!t.name, true)
  check(`${t.name} 有图标`, !!t.icon, true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
