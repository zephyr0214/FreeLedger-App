/**
 * 分类排序单测
 *
 *   node scripts/test-category-sort.mjs
 */

import { sortCategoriesByUsage, isSelectableCategory } from '../utils/categorySort.js'

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

console.log('=== isSelectableCategory（收入分类不显示问题） ===')

// 模拟：工资/奖金是「一级且无二级」→ 可选；餐饮一级下有二级 → 只选二级
const INC = [
  { id: 'w', name: '工资', parent_id: null, isParent: true },
  { id: 'b', name: '奖金', parent_id: null, isParent: true }
]
const EXP = [
  { id: 'food', name: '餐饮', parent_id: null, isParent: true },
  { id: 'lunch', name: '正餐', parent_id: 'food', isParent: false },
  { id: 'drink', name: '饮品', parent_id: 'food', isParent: false }
]

// 无二级的一级（收入）必须可选
check('收入一级无二级 → 可选', isSelectableCategory(INC[0], INC), true)
check('收入一级无二级(第二个) → 可选', isSelectableCategory(INC[1], INC), true)

// 有二级的一级 → 不可选（要选它的二级）
check('有二级的一级 → 不可选', isSelectableCategory(EXP[0], EXP), false)

// 二级 → 永远可选
check('二级 → 可选', isSelectableCategory(EXP[1], EXP), true)
check('二级(饮品) → 可选', isSelectableCategory(EXP[2], EXP), true)

// 空/非法
check('空分类 → false', isSelectableCategory(null, EXP), false)
check('空列表 → 一级不可选', isSelectableCategory(EXP[0], []), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
