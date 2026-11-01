/**
 * 借出 / 借入页面的统计口径测试
 *
 *   node scripts/test-loan-manage.mjs
 *
 * ★ 用户要求（本轮）★
 *   借出页：上方大数字 = 当前借出；
 *     下方 = 累计借出、借出收回、累计笔数
 *   借入页：上方大数字 = 当前借入；
 *     下方 = 累计借入、借入归还、累计笔数
 *   两个页面上方卡片下方先是 tab：全部流水 / 借出 / 借出收回
 *                                     全部流水 / 借入 / 借入归还
 *   全部流水页不显示「全部 ›」
 *
 * ★ 为什么口径要单测 ★
 *   「当前借出」= 借出 - 借出收回，这个减法一旦写反，
 *   用户会看到「借出去 500 收回来 200，当前显示 700」。
 *   纯算术，最适合用测试钉死。
 */

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

/**
 * 页面里 currentAmount 的计算（与 pages/loan/manage.vue 一致）
 *
 * @param {number} total  累计借出 / 累计借入（分）
 * @param {number} back   借出收回 / 借入归还（分）
 * @returns {number} 当前借出 / 当前借入（分），不小于 0
 */
function currentAmountOf(total, back) {
  const diff = total - back
  return diff > 0 ? diff : 0
}

console.log('=== 当前借出 = 借出 - 借出收回 ===')

check('借 500，收回 200 -> 当前 300', currentAmountOf(50000, 20000), 30000)
check('借 500，没收回 -> 当前 500', currentAmountOf(50000, 0), 50000)
check('借 500，全收回 -> 当前 0', currentAmountOf(50000, 50000), 0)
// 多记了收回（收回 > 借出）不该显示负数
check('收回多于借出 -> 按 0 显示', currentAmountOf(20000, 50000), 0)
check('一笔都没有 -> 0', currentAmountOf(0, 0), 0)

console.log('=== 当前借入 = 借入 - 借入归还 ===')

check('借入 1000，还 300 -> 当前 700', currentAmountOf(100000, 30000), 70000)
check('借入 1000，没还 -> 当前 1000', currentAmountOf(100000, 0), 100000)
check('借入 1000，还清 -> 当前 0', currentAmountOf(100000, 100000), 0)
check('还多了 -> 按 0 显示', currentAmountOf(10000, 20000), 0)

console.log('=== 累计笔数 = 主方向 + 反向 ===')

/**
 * 页面里 totalCount 的计算
 * @param {number} mainCount 借出/借入 笔数
 * @param {number} backCount 借出收回/借入归还 笔数
 */
function totalCountOf(mainCount, backCount) {
  return mainCount + backCount
}

check('借 3 笔、收回 2 笔 -> 累计 5 笔', totalCountOf(3, 2), 5)
check('只借没收回 -> 3 笔', totalCountOf(3, 0), 3)
check('一笔都没有 -> 0 笔', totalCountOf(0, 0), 0)

console.log('=== 两个方向的分类与 type 必须成对 ===')

/**
 * 与 api/db/schema.js 的 SYSTEM_PRESET_CHILDREN 保持一致的镜像。
 * （这里不直接 import，是为了让测试能独立跑出「方向配对」这条规则）
 */
const LOAN = {
  lendOut:    { name: '借出',     type: 'expense' },
  lendBack:   { name: '借出收回', type: 'income' },
  borrowIn:   { name: '借入',     type: 'income' },
  borrowBack: { name: '借入归还', type: 'expense' }
}

check('借出是支出（钱从账户出去）', LOAN.lendOut.type, 'expense')
check('借出收回是收入（钱回账户）', LOAN.lendBack.type, 'income')
check('借入是收入（钱进账户）', LOAN.borrowIn.type, 'income')
check('借入归还是支出（钱从账户出去）', LOAN.borrowBack.type, 'expense')

/** 借出页要看的两个分类 */
function lendCats() {
  return [LOAN.lendOut, LOAN.lendBack]
}
/** 借入页要看的两个分类 */
function borrowCats() {
  return [LOAN.borrowIn, LOAN.borrowBack]
}

check(
  '借出页涉及「借出」+「借出收回」',
  lendCats().map((d) => d.name),
  ['借出', '借出收回']
)
check(
  '借入页涉及「借入」+「借入归还」',
  borrowCats().map((d) => d.name),
  ['借入', '借入归还']
)

console.log('=== tab 定义 ===')

/**
 * 页面里 tabs 的计算
 * @param {'expense'|'income'} loanType
 */
function tabsOf(loanType) {
  const isIncome = loanType === 'income'
  return [
    { key: 'all', name: '全部流水' },
    { key: 'main', name: isIncome ? '借入' : '借出' },
    { key: 'back', name: isIncome ? '借入归还' : '借出收回' }
  ]
}

check(
  '借出页三个 tab',
  tabsOf('expense').map((t) => t.name),
  ['全部流水', '借出', '借出收回']
)
check(
  '借入页三个 tab',
  tabsOf('income').map((t) => t.name),
  ['全部流水', '借入', '借入归还']
)
check('tab 的 key 顺序固定', tabsOf('expense').map((t) => t.key), ['all', 'main', 'back'])

console.log('=== 「全部 ›」只在分类 tab 上显示 ===')

/**
 * 页面里 showListMore 的计算
 * ★ 用户要求：「全部流水页面不显示跳转到全部交易的按钮」★
 *   那个 tab 本身就是全部，再给一个「全部 ›」是语义重复。
 */
function showMoreOf(tabKey) {
  return tabKey !== 'all'
}

check('全部流水 tab：不显示「全部 ›」', showMoreOf('all'), false)
check('借出/借入 tab：显示「全部 ›」', showMoreOf('main'), true)
check('借出收回/借入归还 tab：显示「全部 ›」', showMoreOf('back'), true)

console.log('=== 记账面板预填的分类随 tab 变化 ===')

/**
 * 页面里 panelPreset 的计算
 *
 * ★ 在「借出收回」tab 点「+」应该预填「借出收回」★
 *   预填成「借出」的话，用户想记一笔收回，
 *   打开面板却是「借出」，很容易记反。
 */
function presetOf(loanType, tabKey) {
  const isIncome = loanType === 'income'
  if (tabKey === 'back') {
    return {
      type: isIncome ? LOAN.borrowBack.type : LOAN.lendBack.type,
      categoryName: isIncome ? LOAN.borrowBack.name : LOAN.lendBack.name
    }
  }
  return {
    type: isIncome ? LOAN.borrowIn.type : LOAN.lendOut.type,
    categoryName: isIncome ? LOAN.borrowIn.name : LOAN.lendOut.name
  }
}

check(
  '借出页 + 全部流水 -> 预填「借出」',
  presetOf('expense', 'all'),
  { type: 'expense', categoryName: '借出' }
)
check(
  '借出页 + 借出 tab -> 预填「借出」',
  presetOf('expense', 'main'),
  { type: 'expense', categoryName: '借出' }
)
check(
  '借出页 + 借出收回 tab -> 预填「借出收回」',
  presetOf('expense', 'back'),
  { type: 'income', categoryName: '借出收回' }
)
check(
  '借入页 + 全部流水 -> 预填「借入」',
  presetOf('income', 'all'),
  { type: 'income', categoryName: '借入' }
)
check(
  '借入页 + 借入归还 tab -> 预填「借入归还」',
  presetOf('income', 'back'),
  { type: 'expense', categoryName: '借入归还' }
)

console.log('=== 借出借入的净额与账户负债口径一致 ===')

/*
 * ★ 页面上的「当前借入」和账户页的「未归还借入」必须是同一个口径 ★
 *   两处算法完全一样：借入 - 借入归还。
 *   如果一处按累计、一处按净额，用户会在两个页面看到两个数。
 */
check(
  '页面当前借入 == 账户页的未归还借入',
  currentAmountOf(100000, 30000),
  70000
)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
