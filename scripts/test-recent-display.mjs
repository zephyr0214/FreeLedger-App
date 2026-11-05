/**
 * 首页「最近收支」显示规则的测试
 *
 *   node scripts/test-recent-display.mjs
 *
 * ★ 用户定的规则 ★
 *   当日记录 < 5 条  -> 显示最近 5 条（可跨天）
 *   当日记录 >= 5 条 -> 显示**全部**当日记录
 *
 * ★ 为什么必须测边界 ★
 *   这条规则只有 4/5 这一个临界点，差一条就切模式。
 *   而且「全部当日」这个要求很容易被实现成「todayList 的 20 条上限」，
 *   25 笔的那天就会少显示 5 笔 —— 肉眼很难发现，测试能钉死。
 */

import {
  pickRecentDisplayList, isShowingAllToday,
  RECENT_FULL_DAY_THRESHOLD, RECENT_FALLBACK_COUNT
} from '../utils/recentDisplay.js'

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

/** 造 n 条假流水 */
function makeTxns(n, day = '2026-11-05') {
  return Array.from({ length: n }, (_, i) => ({ id: `t${i}`, occurred_day: day }))
}

console.log('=== 常量 ===')

check('阈值是 5', RECENT_FULL_DAY_THRESHOLD, 5)
check('回退显示 5 条', RECENT_FALLBACK_COUNT, 5)

console.log('=== 当日 >= 5 条：显示全部当日 ===')

check('恰好 5 条', pickRecentDisplayList({
  todayAll: makeTxns(5), recentList: makeTxns(5)
}).length, 5)

check('6 条全显示', pickRecentDisplayList({
  todayAll: makeTxns(6), recentList: makeTxns(5)
}).length, 6)

/*
 * ★ 重点：25 条也要全显示 ★
 *   todayList 有 20 条上限（listTodayTransactions(20)），
 *   用它做数据源会截断成 20，和「显示全部当日记录」直接矛盾。
 *   所以数据源必须是 listAllTransactionsOfDay() 的 todayAll。
 */
check('25 条全显示（不截断到 20）', pickRecentDisplayList({
  todayAll: makeTxns(25), recentList: makeTxns(5)
}).length, 25)

check('100 条也全显示', pickRecentDisplayList({
  todayAll: makeTxns(100), recentList: makeTxns(5)
}).length, 100)

console.log('=== 当日 < 5 条：显示最近 5 条 ===')

check('恰好 4 条 -> 走最近 5 条', pickRecentDisplayList({
  todayAll: makeTxns(4), recentList: makeTxns(5)
}).length, 5)

check('0 条 -> 走最近 5 条', pickRecentDisplayList({
  todayAll: [], recentList: makeTxns(5)
}).length, 5)

check('1 条 -> 走最近 5 条', pickRecentDisplayList({
  todayAll: makeTxns(1), recentList: makeTxns(5)
}).length, 5)

/*
 * ★ recentList 多于 5 条要截断 ★
 *   规则写死「最近 5 条」，不依赖调用方传对数量。
 */
check('recentList 给多了也截到 5', pickRecentDisplayList({
  todayAll: [], recentList: makeTxns(10)
}).length, 5)

console.log('=== 边界与异常 ===')

check('两个都空', pickRecentDisplayList({ todayAll: [], recentList: [] }), [])
check('入参缺失', pickRecentDisplayList({}), [])
check('入参为 null', pickRecentDisplayList(null), [])
check('非数组容错', pickRecentDisplayList({ todayAll: null, recentList: 'x' }), [])

/*
 * ★ 阈值边界必须精确 ★
 *   4 -> false，5 -> true。差一条就切模式，两侧都要钉住。
 */
check('4 条不算全显示', isShowingAllToday(makeTxns(4)), false)
check('5 条算全显示', isShowingAllToday(makeTxns(5)), true)

console.log('=== 返回的是当日数据本身 ===')

{
  const today = makeTxns(7)
  const result = pickRecentDisplayList({ todayAll: today, recentList: makeTxns(5) })
  check('内容与 todayAll 一致', result.map((t) => t.id), today.map((t) => t.id))
}

console.log('=== 接线：首页与 store 用对了数据源 ===')

{
  const { readFileSync } = await import('fs')
  const { join, dirname, resolve } = await import('path')
  const { fileURLToPath } = await import('url')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8')

  const index = read('pages/index/index.vue')
  const store = read('stores/transaction.js')
  const api = read('api/transaction.js')

  check('首页用 pickRecentDisplayList', /pickRecentDisplayList/.test(index), true)
  // 数据源必须是不限条数的 todayAll，不能是有 20 上限的 todayList
  check('首页数据源是 todayAll', /txnStore\.todayAll/.test(index), true)
  check('store 有 todayAll 字段', /todayAll: \[\]/.test(store), true)
  check('store 拉全部当日流水', /listAllTransactionsOfDay\(\)/.test(store), true)
  check('API 导出 listAllTransactionsOfDay', /export async function listAllTransactionsOfDay/.test(api), true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
