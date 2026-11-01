/**
 * 「更多分类」按一级分类分组 + 分类图标配色的单测
 *
 *   node scripts/test-category-group.mjs
 *
 * 背景（用户需求）
 *   1. 记账弹层（含周期弹层）里的分类图标底色：
 *      未选中 = 浅浅的灰色底（深浅色模式自适应）；
 *      选中   = 分类色的浅色底（与交易流水一致）；
 *      图标   = 始终是分类本色。
 *   2. 「更多分类」面板要按一级分类分组，把所有二级分类显示在它的一级分类下面。
 *
 * 检查项：
 *   1. categoryIconStyle：未选中浅灰底、选中分类色浅底、图标始终本色
 *   2. groupCategoriesByParent：二级归到一级下面、无二级的一级自己成组、
 *      父级缺失时不丢分类、组顺序按首次出现位置
 */

import { groupCategoriesByParent } from '../utils/categorySort.js'
import {
  categoryIconStyle,
  categoryIconBg,
  categoryIconFg,
  categoryColor,
  categoryGroupIconStyle,
  categoryRingStyle,
  categoryIconFullStyle,
  UNSELECTED_ICON_BG,
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

console.log('=== 图标配色（未选中浅灰底 / 选中分类色浅底 / 图标本色） ===')

check(
  '未选中时是浅灰底（走 CSS 变量，深浅色自动适配）',
  categoryIconBg({ color: '#FF976A' }),
  UNSELECTED_ICON_BG
)

check(
  '未选中时底色是 var(--app-card-2)',
  categoryIconBg({ color: '#FF976A' }),
  'var(--app-card-2)'
)

check(
  '选中时是分类色 + 22 的浅色底',
  categoryIconBg({ color: '#FF976A' }, FALLBACK_CATEGORY_COLOR, true),
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
  '未选中：浅灰底 + 本色图标',
  categoryIconStyle({ color: '#1989FA' }, PRIMARY),
  { backgroundColor: 'var(--app-card-2)', color: '#1989FA' }
)

check(
  '选中：分类色浅底 + 本色图标',
  categoryIconStyle({ color: '#1989FA' }, PRIMARY, true),
  { backgroundColor: '#1989FA22', color: '#1989FA' }
)

check(
  '没有颜色时选中态用主题色做浅底',
  categoryIconStyle({}, PRIMARY, true),
  { backgroundColor: PRIMARY + '22', color: PRIMARY }
)

check(
  '没有颜色时未选中仍是浅灰底',
  categoryIconStyle({}, PRIMARY),
  { backgroundColor: 'var(--app-card-2)', color: PRIMARY }
)

check(
  '分组标题的图标：始终是分类色浅底（不跟选中态变）',
  categoryGroupIconStyle({ color: '#07C160' }, PRIMARY),
  { backgroundColor: '#07C16022', color: '#07C160' }
)

/* ====================================== 1b. 选中态的主题色「圈圈」 */

console.log('\n=== 选中圈（用户反馈：灰底选中态区分度不明显） ===')

/*
 * ★ 为什么要有这一圈 ★
 *   选中态原来只是「分类色 + 22」的浅底（约 13% 不透明），
 *   未选中是 --app-card-2 浅灰底 —— 浅色主题下两者明度非常接近，
 *   扫一眼看不出选中了哪个。加一圈 3rpx 主题色描边后一眼可辨。
 *
 * ★ 未选中必须是 transparent 而不是空串 ★
 *   空串等于没写 border，选中项会因为多出 6rpx 边框而变大，
 *   一排分类跟着抖动。transparent 占位，尺寸恒定。
 */

check(
  '未选中：边框是 transparent（占位不显示）',
  categoryRingStyle(false, PRIMARY),
  { border: '3rpx solid transparent' }
)

check(
  '选中：边框是主题色',
  categoryRingStyle(true, PRIMARY),
  { border: `3rpx solid ${PRIMARY}` }
)

// 主题色缺失时兜底成中性灰，不出现 'undefined' 这种非法值
check(
  '选中但没传主题色：兜底成中性灰',
  categoryRingStyle(true, ''),
  { border: '3rpx solid #969799' }
)

check(
  '完整样式：未选中含浅灰底 + transparent 边框',
  categoryIconFullStyle({ color: '#1989FA' }, PRIMARY, false),
  {
    backgroundColor: 'var(--app-card-2)',
    color: '#1989FA',
    border: '3rpx solid transparent'
  }
)

check(
  '完整样式：选中含分类浅底 + 主题色边框',
  categoryIconFullStyle({ color: '#1989FA' }, PRIMARY, true),
  {
    backgroundColor: '#1989FA22',
    color: '#1989FA',
    border: `3rpx solid ${PRIMARY}`
  }
)

/*
 * ★ 灰色分类也要能看出选中 ★
 *   「其他/杂项」这类分类色是 #969799（中性灰），
 *   如果圈用分类色，在浅底上几乎看不见。
 *   用主题色就解决了 —— 下面这条把结论钉住。
 */
check(
  '灰色分类的选中圈仍是主题色（不是分类灰）',
  categoryIconFullStyle({ color: '#969799' }, PRIMARY, true).border,
  `3rpx solid ${PRIMARY}`
)

console.log('\n=== 三个弹层都用同一个样式函数 ===')

{
  const { readFileSync } = await import('fs')
  const { join, dirname, resolve } = await import('path')
  const { fileURLToPath } = await import('url')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

  /** 三个用到分类选择图标的弹层 */
  const PANELS = [
    'components/TxnPanel.vue',
    'components/CyclePanel.vue',
    'components/CategoryPickerSheet.vue'
  ]

  for (const rel of PANELS) {
    const code = readFileSync(join(ROOT, rel), 'utf-8')
    check(`${rel} 用 categoryIconFullStyle`, /categoryIconFullStyle/.test(code), true)
    // 图标外框必须 border-box，否则选中时会被 6rpx 边框撑大
    check(`${rel} 图标外框是 border-box`, /box-sizing:\s*border-box/.test(code), true)
  }
}

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
