/**
 * 预算额度分配（总预算 → 分类预算）单测
 *
 *   node scripts/test-budget-allocation.mjs
 *
 * 背景
 *   用户反馈：「分类预算不是独立的啊，
 *   应该是本月总预算下设的分类预算」。
 *   所以分类预算的额度是从总预算里「分配」出去的子额度：
 *     已分配合计 = 所有分类预算额度之和
 *     未分配额度 = 总预算 - 已分配合计
 *     分配超过总预算 -> 超额分配（UI 红色提示）
 *
 * 这里测两个纯函数（api/budget.js）：
 *   summarizeAllocation()  —— 汇总当前分配情况
 *   checkCategoryAllocation() —— 校验「这次设置会不会超」
 *
 * ★ 不碰数据库 ★
 *   budget 表的 scope 字段本来就能区分 total / category，
 *   这次只是把「子额度」这层关系在内存里算出来，不需要迁移。
 */

import { summarizeAllocation, checkCategoryAllocation } from '../api/budget.js'

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

/** 造一条预算用量记录 */
function usage(scope, limit, extra = {}) {
  return {
    id: extra.id || `${scope}-${limit}`,
    scope,
    categoryId: extra.categoryId || null,
    name: extra.name || (scope === 'total' ? '总预算' : '分类'),
    limit,
    used: extra.used || 0,
    remaining: (extra.used || 0) - limit,
    percent: 0,
    over: false,
    ...extra
  }
}

console.log('=== summarizeAllocation：基本汇总 ===')

{
  const r = summarizeAllocation([
    usage('total', 100000),
    usage('category', 30000, { name: '餐饮' }),
    usage('category', 20000, { name: '交通' })
  ])

  check('有总预算', r.hasTotal, true)
  check('总预算额度', r.totalLimit, 100000)
  check('已分配合计', r.allocated, 50000)
  check('未分配额度', r.unallocated, 50000)
  check('没有超额', r.overAllocated, false)
  check('已分配百分比', r.allocatedPercent, 50)
}

console.log('=== summarizeAllocation：超额分配 ===')

{
  const r = summarizeAllocation([
    usage('total', 100000),
    usage('category', 80000, { name: '餐饮' }),
    usage('category', 50000, { name: '交通' })
  ])

  check('标记为超额', r.overAllocated, true)
  // 未分配是负数 = 超出多少
  check('未分配是负数（超出 30000）', r.unallocated, -30000)
  check('已分配合计', r.allocated, 130000)
  check('已分配百分比超过 100', r.allocatedPercent > 100, true)
}

console.log('=== summarizeAllocation：刚好分完 ===')

{
  const r = summarizeAllocation([
    usage('total', 100000),
    usage('category', 60000),
    usage('category', 40000)
  ])

  check('没有超额', r.overAllocated, false)
  check('未分配是 0', r.unallocated, 0)
  check('已分配 100%', r.allocatedPercent, 100)
}

console.log('=== summarizeAllocation：没有总预算 ===')

{
  const r = summarizeAllocation([
    usage('category', 30000),
    usage('category', 20000)
  ])

  check('没有总预算', r.hasTotal, false)
  check('总预算额度是 0', r.totalLimit, 0)
  check('已分配合计仍然算得出', r.allocated, 50000)
  // 没有可分配的池子，就不存在「未分配」
  check('未分配是 0', r.unallocated, 0)
  check('不算超额', r.overAllocated, false)
  check('百分比是 0', r.allocatedPercent, 0)
}

console.log('=== summarizeAllocation：边界输入 ===')

{
  check('空数组不炸', summarizeAllocation([]).allocated, 0)
  check('null 不炸', summarizeAllocation(null).hasTotal, false)
  check('undefined 不炸', summarizeAllocation(undefined).allocated, 0)
  check('非数组不炸', summarizeAllocation({}).hasTotal, false)

  // 只有总预算、没有分类预算
  const onlyTotal = summarizeAllocation([usage('total', 50000)])
  check('只有总预算：已分配 0', onlyTotal.allocated, 0)
  check('只有总预算：未分配 = 总额', onlyTotal.unallocated, 50000)

  // limit 缺失/为 0 时按 0 算，不产生 NaN
  const zero = summarizeAllocation([usage('total', 0), usage('category', 0)])
  check('额度 0 不产生 NaN', Number.isFinite(zero.allocated), true)
  check('额度 0 已分配是 0', zero.allocated, 0)
}

console.log('=== checkCategoryAllocation：新增分类预算 ===')

{
  const usages = [
    usage('total', 100000),
    usage('category', 30000, { id: 'c1' })
  ]

  // 再分配 40000 -> 合计 70000，没超
  const ok = checkCategoryAllocation(usages, 40000)
  check('有总预算', ok.hasTotal, true)
  check('不会超', ok.wouldOver, false)
  check('已分配（不含新额度）', ok.allocated, 30000)
  check('加上新额度后', ok.newTotal, 70000)
  check('总预算', ok.totalLimit, 100000)
  check('超出金额是 0', ok.overflow, 0)
}

{
  const usages = [
    usage('total', 100000),
    usage('category', 80000, { id: 'c1' })
  ]

  // 再分配 50000 -> 合计 130000，超了
  const over = checkCategoryAllocation(usages, 50000)
  check('会超', over.wouldOver, true)
  check('超出金额', over.overflow, 30000)
  check('加上新额度后', over.newTotal, 130000)
}

console.log('=== checkCategoryAllocation：修改已有预算 ===')

{
  const usages = [
    usage('total', 100000),
    usage('category', 80000, { id: 'c1' })
  ]

  // 修改 c1 自己：算的时候要排除它自己
  // 排除 c1 后已分配 = 0，新额度 80000 -> 不会超
  const edit = checkCategoryAllocation(usages, 80000, 'c1')
  check('修改自己不算超', edit.wouldOver, false)
  check('排除自己后已分配', edit.allocated, 0)
  check('加上新额度后', edit.newTotal, 80000)
}

{
  const usages = [
    usage('total', 100000),
    usage('category', 30000, { id: 'c1' }),
    usage('category', 20000, { id: 'c2' })
  ]

  // 把 c1 从 30000 改成 90000：
  // 排除 c1 后已分配 = 20000，加上新的 90000 = 110000 -> 超
  const edit = checkCategoryAllocation(usages, 90000, 'c1')
  check('改大后会超', edit.wouldOver, true)
  check('超出金额', edit.overflow, 10000)
}

console.log('=== checkCategoryAllocation：没有总预算 ===')

{
  const usages = [usage('category', 30000, { id: 'c1' })]

  const r = checkCategoryAllocation(usages, 50000)
  check('没有总预算', r.hasTotal, false)
  // 没有总预算时允许单独设分类预算 —— 不算超
  check('没有总预算就不算超', r.wouldOver, false)
  check('总预算是 0', r.totalLimit, 0)
  check('超出金额是 0', r.overflow, 0)
}

console.log('=== checkCategoryAllocation：边界输入 ===')

{
  check('空数组不炸', checkCategoryAllocation([], 1000).wouldOver, false)
  check('null 不炸', checkCategoryAllocation(null, 1000).hasTotal, false)
  check('undefined 不炸', checkCategoryAllocation(undefined, 1000).newTotal, 1000)
  check('额度 0 不产生 NaN', Number.isFinite(checkCategoryAllocation([], 0).newTotal), true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
