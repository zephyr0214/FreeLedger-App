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
  isLoanCategory,
  isFixedCategory,
  isPresetGroupCategory,
  RECONCILE_NAMES,
  LOAN_CATEGORY_NAMES
} from '../api/category.js'
import {
  childIcon, childColor,
  SYSTEM_PRESET_GROUPS, SYSTEM_PRESET_CHILDREN
} from '../api/db/schema.js'
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

/** 取二级分类的名字列表（兼容 { name, icon } 对象与纯字符串两种写法） */
function childNames(children) {
  return children.map((c) => (typeof c === 'string' ? c : c.name))
}

console.log('=== 支出默认分类结构 ===')

check(
  '支出一级分类名字',
  DEFAULT_EXPENSE_CATEGORIES.map((c) => c.name),
  ['餐饮食品', '交通出行', '居住住房', '购物消费', '医疗健康', '社交娱乐', '学校学习', '人情往来', '其他支出']
)

check(
  '餐饮食品的二级',
  childNames(DEFAULT_EXPENSE_CATEGORIES[0].children),
  ['日常三餐', '奶茶饮料', '超市零售', '水果蔬菜', '零食小吃']
)
check(
  '交通出行的二级',
  childNames(DEFAULT_EXPENSE_CATEGORIES[1].children),
  ['公共交通', '长途交通', '加油充电', '打车租车', '停车过路', '洗车维保', '罚款违章']
)
check(
  '居住住房的二级',
  childNames(DEFAULT_EXPENSE_CATEGORIES[2].children),
  ['房租房贷', '水费电费', '通讯宽带', '家政维修', '燃气取暖', '洗衣洗澡']
)
check(
  '购物消费的二级',
  childNames(DEFAULT_EXPENSE_CATEGORIES[3].children),
  ['家居日用', '服饰鞋包', '数码电器', '美妆个护']
)
check(
  '医疗健康的二级',
  childNames(DEFAULT_EXPENSE_CATEGORIES[4].children),
  ['买药看病', '运动健身', '健康保健', '医保社保']
)
check(
  '社交娱乐的二级',
  childNames(DEFAULT_EXPENSE_CATEGORIES[5].children),
  ['度假旅游', '休闲玩乐', '休闲娱乐']
)
check(
  '学校学习的二级',
  childNames(DEFAULT_EXPENSE_CATEGORIES[6].children),
  ['学费学杂费', '书籍文具', '培训考证', '人工智能']
)
check(
  '人情往来的二级',
  childNames(DEFAULT_EXPENSE_CATEGORIES[7].children),
  ['随份子', '红包', '送礼']
)
check(
  '其他支出的二级',
  childNames(DEFAULT_EXPENSE_CATEGORIES[8].children),
  ['宠物开销', '快递邮费', '意外损失', '公益捐款', '其他支出']
)

console.log('=== 收入默认分类结构 ===')

check(
  '收入一级分类名字',
  DEFAULT_INCOME_CATEGORIES.map((c) => c.name),
  ['工资', '奖金补贴', '副业劳务', '租金收入', '投资收益', '红包礼金', '二手出售', '退款返还', '父母补贴']
)
check('工资没有二级', DEFAULT_INCOME_CATEGORIES[0].children, [])
check(
  '奖金补贴的二级',
  childNames(DEFAULT_INCOME_CATEGORIES[1].children),
  ['年终/季度奖', '项目奖金', '常规补贴', '奖学金']
)
check(
  '没有二级的收入分类',
  [2, 3, 4, 5, 8].map((i) => DEFAULT_INCOME_CATEGORIES[i].children),
  [[], [], [], [], []]
)
check(
  '二手出售的二级',
  childNames(DEFAULT_INCOME_CATEGORIES[6].children),
  ['数码家电', '闲置衣物']
)
check(
  '退款返还的二级',
  childNames(DEFAULT_INCOME_CATEGORIES[7].children),
  ['购物退款', '退税', '押金返还']
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
  DEFAULT_INCOME_CATEGORIES.filter((c) => childNames(c.children).includes('奖金补贴')).length,
  0
)

// ★ 同一类型下二级名不能重复 ★
//   两个「其他支出」并排出现时，用户根本分不清该点哪个；
//   按名字聚合统计的地方也会把两笔合成一条。
for (const list of [DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES]) {
  const seen = []
  for (const c of list) {
    for (const name of childNames(c.children)) {
      check(`二级名「${name}」在同类型内唯一`, seen.includes(name), false)
      seen.push(name)
    }
  }
}

console.log('=== 图标 key 必须真实存在 ===')

const allCats = [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES]
const optionKeys = new Set(ICON_OPTIONS.map((o) => o.key))

for (const c of allCats) {
  check(`${c.name} 的 icon 存在于 ICON_MAP`, typeof ICON_MAP[c.icon] === 'string', true)
  check(`${c.name} 的 icon 在可选列表里`, optionKeys.has(c.icon), true)
}

console.log('=== 二级分类：自己的图标 ===')

/**
 * ★ 二级分类现在有自己的图标（v6 起）★
 *   以前二级直接继承父级，一级下挂十几个子类全是同一个图标。
 *   现在每个二级都能单独配一个贴切的图标。
 */
for (const c of allCats) {
  for (const child of c.children) {
    const name = typeof child === 'string' ? child : child.name
    const icon = childIcon(child, c.icon)

    check(`${c.name}/${name} 的 icon 存在于 ICON_MAP`, typeof ICON_MAP[icon] === 'string', true)
    check(`${c.name}/${name} 的 icon 在可选列表里`, optionKeys.has(icon), true)
    // 颜色继承父级
    check(`${c.name}/${name} 的颜色继承父级`, childColor(child, c.color), c.color)
  }
}

// ★ 二级分类的图标不能全是父级的图标（那等于没分开）★
for (const c of allCats) {
  if (c.children.length < 2) continue
  const icons = c.children.map((ch) => childIcon(ch, c.icon))
  check(`${c.name} 的二级图标不是全都一样`, new Set(icons).size > 1, true)
}

// 纯字符串写法（兼容旧结构）依然能用
check('纯字符串子分类继承父级图标', childIcon('日常三餐', 'food'), 'food')
check('纯字符串子分类继承父级颜色', childColor('日常三餐', '#FF976A'), '#FF976A')
check('对象子分类用自己的图标', childIcon({ name: '日常三餐', icon: 'food' }, 'more'), 'food')
check('对象子分类没写图标时用父级的', childIcon({ name: '日常三餐' }, 'more'), 'more')
check('对象子分类写了自己的颜色就用自己的', childColor({ name: 'x', color: '#123456' }, '#FF976A'), '#123456')

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

console.log('=== 对账分类：固定的子分类 ===')

check('expense 的固定分类名', RECONCILE_NAMES.expense, '对账支出')
check('income 的固定分类名', RECONCILE_NAMES.income, '对账收入')

/*
 * ★ v14 起判定规则变了 ★
 *   以前「对账支出 / 对账收入」是独立的一级分类，判定要求 parent_id 为空。
 *   现在它们是「系统分类」下的二级分类，
 *   判定只看「名字 + type」，不再看层级 ——
 *   否则这两个分类又会变成可以改名/删除的普通分类。
 */
check(
  'expense 的「对账支出」是固定分类',
  isReconcileCategory({ name: '对账支出', type: 'expense', parent_id: null }),
  true
)
check(
  'income 的「对账收入」是固定分类',
  isReconcileCategory({ name: '对账收入', type: 'income', parent_id: null }),
  true
)
// 类型不对 -> 不是
check(
  'income 类型下的「对账支出」不是固定分类',
  isReconcileCategory({ name: '对账支出', type: 'income', parent_id: null }),
  false
)
// 二级也是固定分类（v14 起它们就挂在「系统分类」下面）
check(
  '二级的「对账支出」也是固定分类',
  isReconcileCategory({ name: '对账支出', type: 'expense', parent_id: 'cat_x' }),
  true
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

console.log('=== 借入 / 借出：四个固定的子分类 ===')

/*
 * ★ v15 起是四个而不是两个 ★
 *   一笔借出要还回来，一笔借入也要还回去。
 *   只有「借出 / 借入」两个分类时，收回来/还回去的钱
 *   只能记成普通收支，页面就算不出「当前还欠多少」。
 *
 *   借出     expense  钱出去
 *   借款收回 income   钱回来
 *   借入     income   钱进来
 *   借款归还 expense  钱出去
 */
check('借出的分类名与方向', LOAN_CATEGORY_NAMES.lendOut, { name: '借出', type: 'expense' })
check('借款收回的分类名与方向', LOAN_CATEGORY_NAMES.lendBack, { name: '借款收回', type: 'income' })
check('借入的分类名与方向', LOAN_CATEGORY_NAMES.borrowIn, { name: '借入', type: 'income' })
check('借款归还的分类名与方向', LOAN_CATEGORY_NAMES.borrowBack, { name: '借款归还', type: 'expense' })

check(
  '「借出」(expense) 是固定分类',
  isLoanCategory({ name: '借出', type: 'expense' }),
  true
)
check(
  '「借款收回」(income) 是固定分类',
  isLoanCategory({ name: '借款收回', type: 'income' }),
  true
)
check(
  '「借入」(income) 是固定分类',
  isLoanCategory({ name: '借入', type: 'income' }),
  true
)
check(
  '「借款归还」(expense) 是固定分类',
  isLoanCategory({ name: '借款归还', type: 'expense' }),
  true
)
// 方向写反 -> 不是（名字和 type 必须成对）
check(
  'income 类型下的「借出」不是固定分类',
  isLoanCategory({ name: '借出', type: 'income' }),
  false
)
check(
  'expense 类型下的「借入」不是固定分类',
  isLoanCategory({ name: '借入', type: 'expense' }),
  false
)
check('「餐饮食品」不是借出类', isLoanCategory({ name: '餐饮食品', type: 'expense' }), false)
check('null -> false', isLoanCategory(null), false)

console.log('=== 系统分类组 ===')

check('支出侧的组名', SYSTEM_PRESET_GROUPS.expense.name, '系统分类')
check('收入侧的组名', SYSTEM_PRESET_GROUPS.income.name, '系统分类')
check('支出侧的 type', SYSTEM_PRESET_GROUPS.expense.type, 'expense')
check('收入侧的 type', SYSTEM_PRESET_GROUPS.income.type, 'income')

check(
  '「系统分类」一级分类本身是固定分类',
  isPresetGroupCategory({ name: '系统分类', type: 'expense', parent_id: null }),
  true
)
check(
  '二级的「系统分类」不是那个组',
  isPresetGroupCategory({ name: '系统分类', type: 'expense', parent_id: 'cat_x' }),
  false
)
// ★ 老库里的旧名也要认 ★
//   不然迁移还没跑到 / 被跳过的库，这一组会突然变成能删能改的普通分类。
check(
  '旧名「系统预置分类」也认作那个组',
  isPresetGroupCategory({ name: '系统预置分类', type: 'expense', parent_id: null }),
  true
)

console.log('=== 固定子类的名字与顺序（用户指定）===')

/** 某个 type 下的固定子类（按 sort 排好） */
/**
 * 某个 type 下「用户看得见」的固定子类
 *
 * ★ 必须排除 hidden ★
 *   v19 加了「借出坏账 / 借出利息」两个 hidden 的派生分类，
 *   它们不在分类页/记账面板里出现，不属于「固定子类」这个清单。
 *   不排除的话这条断言会在每次新增派生分类时误报。
 */
function fixedChildrenOf(type) {
  return SYSTEM_PRESET_CHILDREN
    .filter((d) => d.type === type && !d.hidden)
    .sort((a, b) => a.sort - b.sort)
    .map((d) => d.name)
}

/*
 * ★ 每个 type 下的固定子类 ★
 *   支出：借出（钱出去）、借款归还（还钱出去）、对账支出
 *   收入：借入（钱进来）、借款收回（收钱回来）、对账收入、报销收入
 *   （「借出坏账 / 借出利息」是 v19 的 hidden 派生分类，不在此列）
 *
 *   顺序由 sort 决定：借贷两类在前（900/901），对账排 902，
 *   「报销收入」是 v18 新加的，排 903 接在对账后面。
 *   对账类排在借贷之后：它是系统自己写进去的调整流水，
 *   用户在分类页里扫一眼时应该先看到「借出 / 借入」这些他能主动记的。
 */
check(
  '支出的固定子类：借出、借款归还、对账支出',
  fixedChildrenOf('expense'),
  ['借出', '借款归还', '对账支出']
)
check(
  '收入的固定子类：借入、借款收回、对账收入、报销收入',
  fixedChildrenOf('income'),
  ['借入', '借款收回', '对账收入', '报销收入']
)

// 固定子类的图标必须是真实存在的 icon key
for (const def of SYSTEM_PRESET_CHILDREN) {
  check(`固定子类「${def.name}」的图标存在`, typeof ICON_MAP[def.icon] === 'string', true)
}

console.log('=== isFixedCategory（UI 判定，不查库）===')

check(
  '「系统分类」是固定分类',
  isFixedCategory({ name: '系统分类', type: 'expense', parent_id: null }),
  true
)
check(
  '二级「借出」是固定分类',
  isFixedCategory({ name: '借出', type: 'expense', parent_id: 'cat_g' }),
  true
)
check(
  '一级「对账支出」（迁移前的旧数据）也是固定分类',
  isFixedCategory({ name: '对账支出', type: 'expense', parent_id: null }),
  true
)
check(
  '普通一级分类不是固定分类',
  isFixedCategory({ name: '餐饮食品', type: 'expense', parent_id: null }),
  false
)
check('null -> 不是固定分类', isFixedCategory(null), false)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
