/**
 * 默认分类结构 + 对账分类锁定的测试
 *
 *   node scripts/test-default-categories.mjs
 *
 * 覆盖三件事：
 *   1. 默认分类表符合用户给的结构（一级 + 二级、名字、图标 key、颜色）
 *   2. 图标 key 都是 utils/icons.js 里真实存在的（不能拼错）
 *   3. 「对账支出」「对账收入」是固定的一级分类，识别函数判断正确
 */

import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_ALIAS,
  isReconcileCategory,
  RECONCILE_NAMES
} from '../api/category.js'
import { ICON_MAP, ICON_OPTIONS } from '../utils/icons.js'

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

console.log('=== 支出默认分类结构 ===')

check(
  '支出一级分类名字',
  DEFAULT_EXPENSE_CATEGORIES.map((c) => c.name),
  ['餐饮食品', '交通出行', '居住住房', '购物消费', '医疗健康', '社交娱乐', '学校学习', '人情往来', '其他/杂项']
)

check(
  '餐饮食品的二级',
  DEFAULT_EXPENSE_CATEGORIES[0].children,
  ['正餐', '饮品', '零食/小吃', '超市/零售']
)
check(
  '交通出行的二级',
  DEFAULT_EXPENSE_CATEGORIES[1].children,
  ['公共交通/打车', '火车/飞机', '加油/停车']
)
check(
  '居住住房的二级',
  DEFAULT_EXPENSE_CATEGORIES[2].children,
  ['房租/房贷/物业', '水电燃气', '话费/网费']
)
check(
  '购物消费的二级',
  DEFAULT_EXPENSE_CATEGORIES[3].children,
  ['日用品', '服饰', '数码']
)
check(
  '医疗健康的二级',
  DEFAULT_EXPENSE_CATEGORIES[4].children,
  ['买药/看病', '健身', '医保/社保']
)
check(
  '社交娱乐的二级',
  DEFAULT_EXPENSE_CATEGORIES[5].children,
  ['旅游', '娱乐', '团建']
)
check(
  '学校学习的二级',
  DEFAULT_EXPENSE_CATEGORIES[6].children,
  ['学费', '书籍/课程/资料', '文具']
)
check(
  '人情往来的二级',
  DEFAULT_EXPENSE_CATEGORIES[7].children,
  ['随份子', '红包', '送礼']
)
check('其他/杂项没有二级', DEFAULT_EXPENSE_CATEGORIES[8].children, [])

console.log('=== 收入默认分类结构 ===')

check(
  '收入一级分类名字',
  DEFAULT_INCOME_CATEGORIES.map((c) => c.name),
  ['工资', '奖金补贴', '副业劳务', '租金收入', '投资收益', '红包礼金', '二手出售', '退款返还', '父母补贴']
)
check('工资没有二级', DEFAULT_INCOME_CATEGORIES[0].children, [])
check(
  '其余收入分类没有二级',
  DEFAULT_INCOME_CATEGORIES.slice(1).map((c) => c.children),
  [[], [], [], [], [], [], [], []]
)

// ★ 「奖金补贴」不能既是「工资」的二级、又是一级 ★
//   那属于重复定义（同一个东西出现两次，速记匹配会随机落到其中一个）。
check(
  '「奖金补贴」只作为独立一级分类存在',
  DEFAULT_INCOME_CATEGORIES.filter((c) => c.name === '奖金补贴').length,
  1
)
check(
  '没有一级分类的二级与它重名',
  DEFAULT_INCOME_CATEGORIES.filter((c) => c.children.includes('奖金补贴')).length,
  0
)

console.log('=== 图标 key 必须真实存在 ===')

const allCats = [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES]
const optionKeys = new Set(ICON_OPTIONS.map((o) => o.key))

for (const c of allCats) {
  check(`${c.name} 的 icon 存在于 ICON_MAP`, typeof ICON_MAP[c.icon] === 'string', true)
  check(`${c.name} 的 icon 在可选列表里`, optionKeys.has(c.icon), true)
}

console.log('=== 颜色：合法 + 同类型内不重复 ===')

const HEX = /^#[0-9A-Fa-f]{6}$/
for (const c of allCats) {
  check(`${c.name} 的颜色是合法 hex`, HEX.test(c.color), true)
}

for (const list of [DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES]) {
  const colors = list.map((c) => c.color)
  check('同类型内颜色不重复', new Set(colors).size, colors.length)
}

console.log('=== 别名表：键必须是一级分类名 ===')

const allNames = new Set(allCats.map((c) => c.name))
for (const key of Object.keys(DEFAULT_ALIAS)) {
  check(`别名键「${key}」是已存在的一级分类`, allNames.has(key), true)
}

// ★ 别名不能同时指向两个一级分类 ★
//   否则速记解析会随机落到其中一个，用户看着像「分类会自己变」。
const aliasToNames = new Map()
for (const [name, words] of Object.entries(DEFAULT_ALIAS)) {
  for (const w of words) {
    const prev = aliasToNames.get(w)
    if (prev && prev !== name) {
      check(`别名「${w}」不重复指向多个一级分类`, `${prev}|${name}`, name)
    } else {
      aliasToNames.set(w, name)
    }
  }
}

console.log('=== 对账分类：固定的一级分类 ===')

check('expense 的固定分类名', RECONCILE_NAMES.expense, '对账支出')
check('income 的固定分类名', RECONCILE_NAMES.income, '对账收入')

// 识别： expense 类型的一级「对账支出」-> 是固定分类
check(
  'expense 一级「对账支出」是固定分类',
  isReconcileCategory({ name: '对账支出', type: 'expense', parent_id: null }),
  true
)
check(
  'income 一级「对账收入」是固定分类',
  isReconcileCategory({ name: '对账收入', type: 'income', parent_id: null }),
  true
)
// 类型不对 -> 不是
check(
  'income 类型下的「对账支出」不是固定分类',
  isReconcileCategory({ name: '对账支出', type: 'income', parent_id: null }),
  false
)
// 是二级 -> 不是
check(
  '二级的「对账支出」不是固定分类',
  isReconcileCategory({ name: '对账支出', type: 'expense', parent_id: 'cat_x' }),
  false
)
// 普通分类 -> 不是
check(
  '「餐饮食品」不是固定分类',
  isReconcileCategory({ name: '餐饮食品', type: 'expense', parent_id: null }),
  false
)
// 旧的一级「对账调整」-> 不是固定分类（已经被迁移掉了）
check(
  '「对账调整」不是固定分类',
  isReconcileCategory({ name: '对账调整', type: 'expense', parent_id: null }),
  false
)
// 空值
check('null -> false', isReconcileCategory(null), false)
check('undefined -> false', isReconcileCategory(undefined), false)
check('缺 type -> false', isReconcileCategory({ name: '对账支出' }), false)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
