/**
 * 账户类型分组的测试
 *
 *   node scripts/test-account-types.mjs
 *
 * 覆盖：
 *   1. 五类账户（网络支付/信用卡/储蓄卡/现金/充值卡）都存在
 *   2. 每个类型都归属到正确的展示分组
 *   3. 展示分组顺序与用户要求一致
 *   4. 信用卡类 isCredit = true（会显示信用额度）
 *   5. 账户类型选择页的分类覆盖了全部类型（不能漏）
 */

import {
  ACCOUNT_TYPES, ACCOUNT_GROUPS, ACCOUNT_CATEGORIES, getTypeMeta, isCreditType
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

console.log('=== 五类账户都在 ===')

const REQUIRED = ['网络支付', '信用卡', '储蓄卡', '现金', '充值卡']
for (const name of REQUIRED) {
  const has = ACCOUNT_TYPES.some((t) => t.category === name)
  check(`${name} 有对应类型`, has, true)
}

console.log('=== 展示分组顺序 ===')

check('分组数量', ACCOUNT_GROUPS.length, 6)
check('第1组是网络支付', ACCOUNT_GROUPS[0].name, '网络支付')
check('第2组是信用卡', ACCOUNT_GROUPS[1].name, '信用卡')
check('第3组是储蓄卡', ACCOUNT_GROUPS[2].name, '储蓄卡')
check('第4组是现金', ACCOUNT_GROUPS[3].name, '现金')
check('第5组是充值卡', ACCOUNT_GROUPS[4].name, '充值卡')
check('第6组是其它', ACCOUNT_GROUPS[5].name, '其它')

console.log('=== 类型的分组归属 ===')

const EXPECT_GROUP = {
  alipay: 'online',
  wechat: 'online',
  credit: 'credit',
  huabei: 'credit',
  debit: 'debit',
  cash: 'cash',
  prepaid: 'prepaid',
  invest: 'other',
  loan: 'other',
  receivable: 'other',
  other: 'other'
}

for (const [key, group] of Object.entries(EXPECT_GROUP)) {
  const meta = getTypeMeta(key)
  check(`${key} 属于 ${group}`, meta.group, group)
}

console.log('=== 信用账户 ===')

check('信用卡是信用账户', isCreditType('credit'), true)
check('花呗是信用账户', isCreditType('huabei'), true)
check('储蓄卡不是信用账户', isCreditType('debit'), false)
check('支付宝不是信用账户', isCreditType('alipay'), false)
check('微信不是信用账户', isCreditType('wechat'), false)
check('现金不是信用账户', isCreditType('cash'), false)
check('充值卡不是信用账户', isCreditType('prepaid'), false)

console.log('=== 类型选择页的分类 ===')

// 每个类型都必须在某个分类里，不能漏
const covered = new Set()
for (const cat of ACCOUNT_CATEGORIES) {
  for (const k of cat.types) covered.add(k)
}
for (const t of ACCOUNT_TYPES) {
  check(`${t.key} 在类型选择页有归属`, covered.has(t.key), true)
}

// 反过来，分类里不能有不存在的类型
const allKeys = new Set(ACCOUNT_TYPES.map((t) => t.key))
for (const cat of ACCOUNT_CATEGORIES) {
  for (const k of cat.types) {
    check(`${cat.key} 里的 ${k} 是有效类型`, allKeys.has(k), true)
  }
}

// 分类顺序
check('分类第1个是网络支付', ACCOUNT_CATEGORIES[0].key, '网络支付')
check('分类第2个是信用卡', ACCOUNT_CATEGORIES[1].key, '信用卡')
check('分类第3个是储蓄卡', ACCOUNT_CATEGORIES[2].key, '储蓄卡')
check('分类第4个是现金', ACCOUNT_CATEGORIES[3].key, '现金')
check('分类第5个是充值卡', ACCOUNT_CATEGORIES[4].key, '充值卡')

console.log('=== 兜底 ===')

// 未知类型要兜底到第一个，不能崩
check('未知类型有兜底', typeof getTypeMeta('不存在的类型').key, 'string')
check('未知类型的 group 有效', ACCOUNT_GROUPS.some((g) => g.key === getTypeMeta('x').group), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
