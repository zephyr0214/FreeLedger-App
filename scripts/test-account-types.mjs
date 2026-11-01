/**
 * 账户类型的测试
 *
 *   node scripts/test-account-types.mjs
 *
 * ★ 用户要求（两次）★
 *   第一次：「账户类型就这五个」——
 *     网络支付 / 信用卡 / 储蓄卡 / 现金 / 充值卡。
 *     之前多出来的「投资 / 借入 / 应收 / 其他」是多余的。
 *
 *   第二次（本轮）：「组合账户保持账户类型不可编辑，
 *     但是其他类型的账户你都要设置账户类型可以编辑」。
 *     -> 组合账户是第 6 种类型，但它在界面上不可改类型；
 *        其余 5 种真实类型之间可以互相改。
 *
 * 这个测试同时守住这两条约束。
 */

import {
  ACCOUNT_TYPES, ACCOUNT_GROUPS, getTypeMeta, isCreditType, isComboType
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

/** 真实账户类型（不含组合）—— 界面上可选的就是这 5 个 */
const REAL_TYPES = ACCOUNT_TYPES.filter((t) => !t.isCombo)

console.log('=== 真实账户类型就这五种 ===')

const EXPECTED = ['网络支付', '信用卡', '储蓄卡', '现金', '充值卡']

check('真实类型数量就是 5 个', REAL_TYPES.length, 5)
check('真实类型名称', REAL_TYPES.map((t) => t.name), EXPECTED)
check('真实类型 key', REAL_TYPES.map((t) => t.key), ['online', 'credit', 'debit', 'cash', 'prepaid'])

console.log('=== 第 6 种：组合账户（辅助类型，不是资金账户）===')

check('总类型数 = 5 真实 + 1 组合', ACCOUNT_TYPES.length, 6)
const combo = ACCOUNT_TYPES.find((t) => t.key === 'combo')
check('组合账户在类型表里', !!combo, true)
check('组合账户标了 isCombo', combo ? combo.isCombo : null, true)
check('组合账户的名字', combo ? combo.name : '', '组合账户')

// ★ 组合账户不是资金账户：不能被当成信用账户，也不该混进真实分组 ★
check('组合账户不是信用账户', isCreditType('combo'), false)
check('isComboType 认组合', isComboType('combo'), true)
check('isComboType 不认储蓄卡', isComboType('debit'), false)

// 真实类型都不能被当成组合
for (const t of REAL_TYPES) {
  check(`${t.name} 不是组合账户`, isComboType(t.key), false)
  check(`${t.name} 没有 isCombo 标记`, !!t.isCombo, false)
}

console.log('=== 之前多出来的类型已删除 ===')

const FORBIDDEN = ['投资', '借入', '应收', '其他', '支付宝', '微信', '花呗']
for (const name of FORBIDDEN) {
  check(`没有「${name}」类型`, ACCOUNT_TYPES.some((t) => t.name === name), false)
}

console.log('=== 展示分组 ===')

// 分组：5 个真实分组 + 1 个「组合账户」分组
check('分组数量 = 5 真实 + 1 组合', ACCOUNT_GROUPS.length, 6)
check('真实分组名称', ACCOUNT_GROUPS.filter((g) => g.key !== 'combo').map((g) => g.name), EXPECTED)
check(
  '组合分组排在最后',
  ACCOUNT_GROUPS[ACCOUNT_GROUPS.length - 1].key,
  'combo'
)

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
check('组合账户不是信用账户', isCreditType('combo'), false)

console.log('=== 类型可编辑性（本轮新需求）===')

/**
 * ★ 哪些类型在「编辑账户」页可以改 ★
 *
 *   api/account.js 的 updateAccount():
 *     只拦「组合 <-> 真实」的互相转换，其余组合全部放行。
 *
 *   所以这里等价地验一遍「界面上该给哪些选项」：
 *     编辑真实账户 -> 5 个真实类型可选
 *     编辑组合账户 -> 0 个可选（模板里走只读分支）
 */

/** 编辑时可选类型（与 pages/account/edit.vue 的 selectableTypes 同逻辑） */
function selectableTypesFor(acc) {
  if (acc && acc.isCombo) return []
  return ACCOUNT_TYPES.filter((t) => !t.isCombo)
}

check(
  '编辑储蓄卡：5 个真实类型都可选',
  selectableTypesFor({ isCombo: false }).map((t) => t.key),
  ['online', 'credit', 'debit', 'cash', 'prepaid']
)
check(
  '编辑组合账户：没有可选类型（只读展示）',
  selectableTypesFor({ isCombo: true }),
  []
)
// 组合账户不能出现在可选项里 —— 否则用户能把储蓄卡改成组合
check(
  '可选项里不含组合账户',
  selectableTypesFor({ isCombo: false }).some((t) => t.isCombo),
  false
)

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
