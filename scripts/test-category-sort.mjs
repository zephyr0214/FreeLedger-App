/**
 * 分类排序单测
 *
 *   node scripts/test-category-sort.mjs
 */

import { sortCategoriesByUsage } from '../utils/categorySort.js'

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

const CATS = [
  { id: 'a', name: '餐饮', sort: 0 },
  { id: 'b', name: '交通', sort: 1 },
  { id: 'c', name: '购物', sort: 2 },
  { id: 'd', name: '居住', sort: 3 },
  { id: 'e', name: '娱乐', sort: 4 }
]

const ids = (list) => list.map((c) => c.id)

console.log('=== 排序规则 ===')

// 1. 无使用记录 → 按 sort 升序（保持用户设定顺序）
check(
  '没有使用记录时按 sort 升序',
  ids(sortCategoriesByUsage(CATS, {}, '')),
  ['a', 'b', 'c', 'd', 'e']
)

// 2. 有使用记录 → 按次数降序
check(
  '按使用次数降序',
  ids(sortCategoriesByUsage(CATS, { c: 5, a: 3, e: 1 }, '')),
  ['c', 'a', 'e', 'b', 'd']
)

// 3. 已选中的排第一
check(
  '已选中的排第一',
  ids(sortCategoriesByUsage(CATS, { c: 5, a: 3 }, 'b')),
  ['b', 'c', 'a', 'd', 'e']
)

// 4. 已选中的即使没被用过也排第一
check(
  '已选中但没用过也排第一',
  ids(sortCategoriesByUsage(CATS, { c: 5 }, 'd')),
  ['d', 'c', 'a', 'b', 'e']
)

// 5. 用过的永远排在没用过的前面
check(
  '用过的排没用过的前面',
  ids(sortCategoriesByUsage(CATS, { e: 1 }, '')),
  ['e', 'a', 'b', 'c', 'd']
)

// 6. 次数相同 → 按 sort 升序
check(
  '次数相同按 sort 升序',
  ids(sortCategoriesByUsage(CATS, { a: 2, c: 2 }, '')),
  ['a', 'c', 'b', 'd', 'e']
)

// 7. 空输入
check('空数组', sortCategoriesByUsage([], {}, ''), [])
check('非数组', sortCategoriesByUsage(null, {}, ''), [])

// 8. 不修改入参
const orig = CATS.map((c) => ({ ...c }))
const snapshot = JSON.stringify(orig)
sortCategoriesByUsage(CATS, { a: 10 }, 'b')
check('不修改入参', JSON.stringify(CATS), snapshot)

// 9. 缺失 usageCounts / selectedId 也能工作
check(
  '参数缺失时按 sort 升序',
  ids(sortCategoriesByUsage(CATS)),
  ['a', 'b', 'c', 'd', 'e']
)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
