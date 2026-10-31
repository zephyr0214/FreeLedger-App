/**
 * 「更多分类」按一级分类分组的单测
 *
 *   node scripts/test-category-group.mjs
 *
 * 背景（用户需求）
 *   1. 记账弹层（含周期弹层）里的分类图标底色要跟交易流水一致 ——
 *      浅色底（分类色 + '22'）+ 分类本色图标，而不是深色实底 + 白图标。
 *   2. 「更多分类」面板要按一级分类分组，把所有二级分类显示在它的一级分类下面。
 *
 * 检查项：
 *   1. categoryIconStyle：浅色底 + 本色图标，选中时加同色描边
 *   2. groupCategoriesByParent：二级归到一级下面、无二级的一级自己成组、
 *      父级缺失时不丢分类、组顺序按首次出现位置
 */

import { groupCategoriesByParent } from '../utils/categorySort.js'
import {
  categoryIconStyle,
  categoryIconBg,
  categoryIconFg,
  categoryColor,
  FALLBACK_CATEGORY_COLOR
} from '../utils/categoryIcon.js'

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

const PRIMARY = '#07C160'

/* ==================================================== 1. 图标配色 */

console.log('=== 图标配色（与交易流水一致：浅色底 + 本色图标） ===')

check(
  '分类色 + 22 = 浅色底',
  categoryIconBg({ color: '#FF976A' }),
  '#FF976A22'
)

check(
  '图标前景是分类本色',
  categoryIconFg({ color: '#FF976A' }),
  '#FF976A'
)

check(
  '分类没设颜色时用兜底色',
  categoryColor({}),
  FALLBACK_CATEGORY_COLOR
)

check(
  '分类没设颜色时可用主题色兜底',
  categoryColor({}, PRIMARY),
  PRIMARY
)

check(
  '空分类也能取色',
  categoryColor(null, PRIMARY),
  PRIMARY
)

check(
  '默认样式：浅色底 + 本色图标 + 无描边',
  categoryIconStyle({ color: '#1989FA' }, PRIMARY),
  { backgroundColor: '#1989FA22', color: '#1989FA', borderColor: 'transparent' }
)

check(
  '选中时加一圈同色描边',
  categoryIconStyle({ color: '#1989FA' }, PRIMARY, true),
  { backgroundColor: '#1989FA22', color: '#1989FA', borderColor: '#1989FA' }
)

check(
  '没有颜色时整组用主题色',
  categoryIconStyle({}, PRIMARY),
  { backgroundColor: PRIMARY + '22', color: PRIMARY, borderColor: 'transparent' }
)

/* ============================================== 2. 按一级分类分组 */

console.log('\n=== groupCategoriesByParent（按一级分类分组） ===')

/**
 * 一组典型的支出分类：
 *   餐饮食品（一级，有 3 个二级）
 *   交通出行（一级，有 2 个二级）
 *   其他/杂项（一级，无二级 → 自己就是可选的一级）
 */
const ALL = [
  { id: 'food',  name: '餐饮食品', parent_id: null, isParent: true },
  { id: 'lunch', name: '正餐',     parent_id: 'food', isParent: false },
  { id: 'drink', name: '饮品',     parent_id: 'food', isParent: false },
  { id: 'snack', name: '零食',     parent_id: 'food', isParent: false },
  { id: 'car',   name: '交通出行', parent_id: null, isParent: true },
  { id: 'taxi',  name: '打车',     parent_id: 'car',  isParent: false },
  { id: 'bus',   name: '公交',     parent_id: 'car',  isParent: false },
  { id: 'other', name: '其他',     parent_id: null, isParent: true }
]

/** 可选分类 = 二级 + 无二级的一级（见 isSelectableCategory） */
const SELECTABLE = ['lunch', 'drink', 'snack', 'taxi', 'bus', 'other']

const groups = groupCategoriesByParent(
  SELECTABLE.map((id) => ALL.find((c) => c.id === id)),
  ALL
)

check(
  '分成 3 组（餐饮 / 交通 / 其他）',
  groups.map((g) => g.parent.id),
  ['food', 'car', 'other']
)

check(
  '餐饮组下面挂着它的 3 个二级',
  groups[0].members.map((c) => c.id),
  ['lunch', 'drink', 'snack']
)

check(
  '交通组下面挂着它的 2 个二级',
  groups[1].members.map((c) => c.id),
  ['taxi', 'bus']
)

check(
  '无二级的一级自己就是一组',
  groups[2].members.map((c) => c.id),
  ['other']
)

check(
  '组标题取一级分类的名字',
  groups.map((g) => g.parent.name),
  ['餐饮食品', '交通出行', '其他']
)

/* ------------------------------- 顺序：按组内首个分类的首次出现位置 */

console.log('\n=== 分组顺序 ===')

// 把「其他」排到最前（模拟最近用得最多），它所在的那组应该排第一
const reordered = ['other', 'lunch', 'drink', 'snack', 'taxi', 'bus']
const g2 = groupCategoriesByParent(
  reordered.map((id) => ALL.find((c) => c.id === id)),
  ALL
)
check(
  '组顺序按组内首个分类的首次出现位置',
  g2.map((g) => g.parent.id),
  ['other', 'food', 'car']
)
check(
  '排到最前的组，其成员顺序不变',
  g2[1].members.map((c) => c.id),
  ['lunch', 'drink', 'snack']
)

/* ------------------------------------------------ 父级缺失的处理 */

console.log('\n=== 边界情况 ===')

// 父级被隐藏/删掉：子分类不能被丢掉，要自己独立成组
const orphan = groupCategoriesByParent(
  [{ id: 'x', name: '孤儿分类', parent_id: 'gone', isParent: false }],
  ALL
)
check('父级缺失时不丢分类', orphan.length, 1)
check('父级缺失的分类自己成组', orphan[0].members.map((c) => c.id), ['x'])

check('空列表 → 空分组', groupCategoriesByParent([], ALL), [])
check('非数组 → 空分组', groupCategoriesByParent(null, ALL), [])

// 没传 all（找不到父级）时也不能丢分类
const noAll = groupCategoriesByParent(
  [{ id: 'x', name: 'X', parent_id: 'food', isParent: false }],
  []
)
check('没传全部分类时不丢分类', noAll.length, 1)

/* ------------------------------------------------ 不修改入参 */

const snapshot = JSON.stringify(ALL)
groupCategoriesByParent(SELECTABLE.map((id) => ALL.find((c) => c.id === id)), ALL)
check('不修改入参', JSON.stringify(ALL), snapshot)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
