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

/* ==================================== 1a. 深色模式的分类底色 */

console.log('\n=== 深色模式：分类底色加深（用户反馈不明显） ===')

/*
 * ★ 为什么不能继续用 '22' ★
 *   13% 的分类色叠在深色卡片 #1C1C1E 上，几乎和背景融成一片。
 *   暗色模式统一提高到 30%（'4D'），所有分类图标都要走这个函数。
 */
check(
  '深色选中底是分类色 + 4D',
  categoryIconBg({ color: '#FF976A' }, FALLBACK_CATEGORY_COLOR, true, true),
  '#FF976A4D'
)

check(
  '浅色选中底仍是 + 22（不改变原观感）',
  categoryIconBg({ color: '#FF976A' }, FALLBACK_CATEGORY_COLOR, true, false),
  '#FF976A22'
)

check(
  '深色未选中仍是浅灰底（不跟分类色变）',
  categoryIconBg({ color: '#FF976A' }, FALLBACK_CATEGORY_COLOR, false, true),
  UNSELECTED_ICON_BG
)

check(
  '深色完整样式含加深底色 + 主题色圈',
  categoryIconFullStyle({ color: '#1989FA' }, PRIMARY, true, true),
  {
    backgroundColor: '#1989FA4D',
    color: '#1989FA',
    border: `3rpx solid ${PRIMARY}`
  }
)

check(
  '深色分组标题底色也加深',
  categoryGroupIconStyle({ color: '#07C160' }, PRIMARY, true),
  { backgroundColor: '#07C1604D', color: '#07C160' }
)

check(
  '非法分类色不会拼出 #undefined',
  categoryIconBg({ color: 'bad' }, FALLBACK_CATEGORY_COLOR, true, true),
  `${FALLBACK_CATEGORY_COLOR}4D`
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
 *   「其他支出」这类分类色是 #969799（中性灰），
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
 *   其他支出（一级，无二级 → 自己就是可选的一级）
 */
const ALL = [
  { id: 'food',  name: '餐饮食品', parent_id: null, isParent: true },
  { id: 'lunch', name: '日常三餐',     parent_id: 'food', isParent: false },
  { id: 'drink', name: '奶茶饮料',     parent_id: 'food', isParent: false },
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

/* --------------------------- 记账面板分类选择器：无子类也有组头 + 添加子类 */

console.log('\n=== 选择分类面板：组头与添加子类 ===')

{
  const { readFileSync } = await import('fs')
  const { join, dirname, resolve } = await import('path')
  const { fileURLToPath } = await import('url')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const read = (p) => readFileSync(join(ROOT, p), 'utf-8')

  const picker = read('components/CategoryPickerSheet.vue')
  const multiPicker = read('components/CategoryMultiPickerSheet.vue')
  const editor = read('components/CategoryEditorSheet.vue')
  const txnPanel = read('components/TxnPanel.vue')
  const cyclePanel = read('components/CyclePanel.vue')
  const categoryPage = read('pages/settings/category.vue')

  check('无子类的一级分类也生成组标题', /title:\s*g\.parent\.name/.test(picker), true)
  check('组头不再按 sec.title 隐藏', /v-if="sec\.title"/.test(picker), false)
  check('组头右侧有「添加子类」', /class="group-add"/.test(picker) && /添加子类/.test(picker), true)
  check(
    '固定分类/二级分类不显示添加入口',
    /function canAddChild/.test(picker) && /parent\.parent_id/.test(picker) && /isFixedCategory/.test(picker),
    true
  )
  check('顶部右侧有「添加分类」', /class="more-sheet-add"/.test(picker) && /添加分类/.test(picker), true)
  check(
    '添加一级分类打开无父级的编辑弹层',
    /function openAddRoot/.test(picker) && /editorParent\.value\s*=\s*null/.test(picker),
    true
  )
  check('记账面板把当前收支类型传给分类面板', /:type="form\.type"/.test(txnPanel), true)
  check('周期面板把当前收支类型传给分类面板', /:type="form\.type"/.test(cyclePanel), true)
  check('添加子类复用 CategoryEditorSheet', /<CategoryEditorSheet/.test(picker), true)
  check('添加成功通知外层刷新分类', /emit\('category-created'/.test(picker), true)

  check(
    '全部交易筛选：无子类一级分类也显示组标题',
    /title:\s*root\.name/.test(multiPicker),
    true
  )

  check('编辑器支持新建与编辑', /createCategory\(/.test(editor) && /updateCategory\(/.test(editor), true)
  check(
    '编辑器自己登记弹层栈',
    /pushLayer\(\(\) => \{ visible\.value = false \}, 'categoryEditor'\)/.test(editor),
    true
  )
  check('编辑器保存后同步图标缓存', /syncCategoryIconCache\(form\.icon/.test(editor), true)

  check('记账面板接住新分类事件', /@category-created="onCategoryCreated"/.test(txnPanel), true)
  check('周期面板接住新分类事件', /@category-created="onCategoryCreated"/.test(cyclePanel), true)
  check('分类管理页复用同一个编辑弹层', /<CategoryEditorSheet/.test(categoryPage), true)
  check('分类管理页不再自己写编辑弹层', /<wd-popup v-model="showEditor"/.test(categoryPage), false)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
