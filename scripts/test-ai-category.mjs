/**
 * AI 速记的二级分类匹配测试
 *
 *   node scripts/test-ai-category.mjs
 *
 * 背景：
 *   速记（AI 自动识别）原来只把**一级分类**给模型，注释写着
 *   「只给一级分类，二级让模型映射不到就用一级」，
 *   结果所有记录都落到了一级分类上（餐饮、居住…），
 *   丢失了「午餐 / 外卖 / 房租」这种真正有用的粒度。
 *
 *   现在改成：
 *     1. 只把**叶子分类**给模型（label 形如「餐饮/午餐」）
 *     2. 匹配时二级优先
 *     3. 模型只给了一级时，用备注 + 原句在它下面猜二级
 */

import {
  buildCategoryOptions, guessChildByText, matchCategory, validateItem
} from '../api/aiParse.js'

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

/** 与真实数据同构的分类表（一级 + 二级） */
const CATS = [
  { id: 'c_food', name: '餐饮', type: 'expense', parent_id: null },
  { id: 'c_food_b', name: '早餐', type: 'expense', parent_id: 'c_food' },
  { id: 'c_food_l', name: '午餐', type: 'expense', parent_id: 'c_food' },
  { id: 'c_food_d', name: '晚餐', type: 'expense', parent_id: 'c_food' },
  { id: 'c_food_w', name: '外卖', type: 'expense', parent_id: 'c_food' },
  { id: 'c_food_c', name: '咖啡奶茶', type: 'expense', parent_id: 'c_food' },

  { id: 'c_home', name: '居住', type: 'expense', parent_id: null },
  { id: 'c_home_r', name: '房租', type: 'expense', parent_id: 'c_home' },
  { id: 'c_home_w', name: '水电', type: 'expense', parent_id: 'c_home' },

  { id: 'c_car', name: '交通', type: 'expense', parent_id: null },
  { id: 'c_car_t', name: '打车', type: 'expense', parent_id: 'c_car' },
  { id: 'c_car_b', name: '公交地铁', type: 'expense', parent_id: 'c_car' },

  // 「其他」没有二级，属于可以直接用的叶子
  { id: 'c_other', name: '其他', type: 'expense', parent_id: null },

  { id: 'c_salary', name: '工资', type: 'income', parent_id: null },
  { id: 'c_salary_m', name: '月薪', type: 'income', parent_id: 'c_salary' }
]

console.log('=== 候选列表只给叶子分类 ===')

const opts = buildCategoryOptions(CATS)
const labels = opts.map((o) => o.label)

check('没有一级分类「餐饮」', labels.includes('餐饮'), false)
check('有二级「餐饮/午餐」', labels.includes('餐饮/午餐'), true)
check('没有二级「居住」', labels.includes('居住'), false)
check('有二级「居住/房租」', labels.includes('居住/房租'), true)
check('无二级的一级「其他」保留', labels.includes('其他'), true)
check('收入也进候选', labels.includes('工资/月薪'), true)
check('候选数量', opts.length, 11)

console.log('=== 匹配：二级优先 ===')

// 模型直接给「餐饮/午餐」
check('完整路径 -> 二级', matchCategory('餐饮/午餐', CATS, '').id, 'c_food_l')
// 模型给二级名字
check('二级名字 -> 二级', matchCategory('外卖', CATS, '').id, 'c_food_w')
// 模型给一级名字
check('一级名字 -> 一级', matchCategory('餐饮', CATS, '').id, 'c_food')
// 同名时二级优先
const dup = [
  { id: 'p1', name: '红包', type: 'expense', parent_id: null },
  { id: 'c1', name: '红包', type: 'expense', parent_id: 'p1' }
]
check('同名二级优先', matchCategory('红包', dup, '').id, 'c1')
// 按 id 匹配
check('按 id -> 命中', matchCategory('c_home_r', CATS, '').id, 'c_home_r')
// 匹配不到
check('匹配不到 -> null', matchCategory('不存在的分类', CATS, ''), null)

console.log('=== 一级 + 文字线索 -> 猜二级 ===')

check('午饭 -> 午餐', guessChildByText(
  CATS.filter((c) => c.parent_id === 'c_food'), '吃了顿午饭'
).id, 'c_food_l')

check('外卖 -> 外卖', guessChildByText(
  CATS.filter((c) => c.parent_id === 'c_food'), '点了外卖'
).id, 'c_food_w')

check('咖啡 -> 咖啡奶茶', guessChildByText(
  CATS.filter((c) => c.parent_id === 'c_food'), '买了杯咖啡'
).id, 'c_food_c')

check('早饭 -> 早餐', guessChildByText(
  CATS.filter((c) => c.parent_id === 'c_food'), '早饭吃了两个包子'
).id, 'c_food_b')

check('晚饭 -> 晚餐', guessChildByText(
  CATS.filter((c) => c.parent_id === 'c_food'), '晚饭吃的火锅'
).id, 'c_food_d')

// 完全无关的文字，不该猜出任何二级
check('无关文字 -> null', guessChildByText(
  CATS.filter((c) => c.parent_id === 'c_food'), 'xyz'
), null)
check('空文字 -> null', guessChildByText(
  CATS.filter((c) => c.parent_id === 'c_food'), ''
), null)

console.log('=== validateItem 端到端 ===')

const CTX = {
  categories: CATS,
  accounts: [{ id: 'a1', name: '微信' }],
  tags: [],
  baseDate: new Date('2026-10-27T15:00:00'),
  hintText: '吃了顿午饭'
}

// 模型给了「餐饮/午餐」
const v1 = validateItem(
  { amount: 30, type: 'expense', category: '餐饮/午餐', account: '微信', date: '2026-10-27' },
  CTX
)
check('路径分类 -> 二级 id', v1.item.category_id, 'c_food_l')
check('路径分类 -> 二级名字', v1.item.category_name, '午餐')

// 模型只给了一级，但原句里有线索 -> 细化到二级
const v2 = validateItem(
  { amount: 30, type: 'expense', category: '餐饮', account: '微信', date: '2026-10-27' },
  CTX
)
check('一级+线索 -> 二级 id', v2.item.category_id, 'c_food_l')
check('一级+线索 -> 二级名字', v2.item.category_name, '午餐')

// 模型只给了一级，原句没线索 -> 保持一级（不硬猜）
const v3 = validateItem(
  { amount: 30, type: 'expense', category: '餐饮', account: '微信', date: '2026-10-27' },
  { ...CTX, hintText: '花了点' }
)
check('一级无线索 -> 保持一级', v3.item.category_id, 'c_food')

// 二级名字直接给
const v4 = validateItem(
  { amount: 30, type: 'expense', category: '外卖', account: '微信', date: '2026-10-27' },
  CTX
)
check('二级名字 -> 二级 id', v4.item.category_id, 'c_food_w')

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
