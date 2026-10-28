/**
 * 筛选面板两级分类 + URL 参数契约 + 周期数据结构 的测试
 *
 *   node scripts/test-txn-filter.mjs
 *
 * 覆盖三块：
 *   1. 分类过滤条件（精确匹配 vs 含子分类）生成的 SQL 与参数
 *   2. URL query 参数的解析与归一化（全是字符串的坑）
 *   3. 周期（周期性固定支出）数据的规范化与数组兜底
 *
 * 用 node:sqlite 跑真实 SQL，验证子查询口径正确。
 */

import { DatabaseSync } from 'node:sqlite'
import {
  buildCategoryCondition, parseTxnQueryOptions
} from '../api/transaction.js'
import { normalizeCycle, getCycles, setCycles, CYCLE_TYPES } from '../api/settings.js'

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

console.log('=== 分类过滤条件 ===')

// 空 id -> 不产生条件
check('空 id 没有条件', buildCategoryCondition('', false), null)
check('空 id（带子分类）也没有条件', buildCategoryCondition('', true), null)

// 精确匹配
check('精确匹配', buildCategoryCondition('cat_1', false), {
  sql: 't.category_id = ?',
  params: ['cat_1']
})

// 含子分类
check('含子分类用子查询', buildCategoryCondition('cat_1', true), {
  sql: 't.category_id IN (SELECT id FROM category WHERE id = ? OR parent_id = ?)',
  params: ['cat_1', 'cat_1']
})

console.log('=== 含子分类的真实 SQL 行为 ===')

{
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE category (
    id TEXT PRIMARY KEY, parent_id TEXT, name TEXT, type TEXT, deleted_at INTEGER
  )`)
  db.exec(`CREATE TABLE txn (
    id TEXT PRIMARY KEY, type TEXT, amount_cents INTEGER,
    account_id TEXT, category_id TEXT, deleted_at INTEGER
  )`)

  // 一级「餐饮」+ 二级「早餐」「午餐」
  db.exec(`INSERT INTO category VALUES
    ('p_food', NULL, '餐饮', 'expense', NULL),
    ('c_breakfast', 'p_food', '早餐', 'expense', NULL),
    ('c_lunch', 'p_food', '午餐', 'expense', NULL),
    ('p_shop', NULL, '购物', 'expense', NULL),
    ('c_shoes', 'p_shop', '鞋', 'expense', NULL)`)

  db.exec(`INSERT INTO txn VALUES
    ('t1', 'expense', 100, 'a1', 'c_breakfast', NULL),
    ('t2', 'expense', 200, 'a1', 'c_lunch', NULL),
    ('t3', 'expense', 300, 'a1', 'c_shoes', NULL),
    ('t4', 'expense', 400, 'a1', 'p_food', NULL),
    ('t5', 'expense', 500, 'a1', NULL, NULL),
    ('t6', 'expense', 600, 'a1', 'c_breakfast', 12345)`)

  const cond = buildCategoryCondition('p_food', true)
  const rows = db.prepare(
    `SELECT id FROM txn t WHERE t.deleted_at IS NULL AND ${cond.sql} ORDER BY id`
  ).all(...cond.params).map((r) => r.id)

  // 一级「餐饮」应匹配：它自己 + 早餐 + 午餐（不含购物、软删记录）
  check('一级分类匹配所有二级', rows, ['t1', 't2', 't4'])

  const exact = buildCategoryCondition('p_food', false)
  const rows2 = db.prepare(
    `SELECT id FROM txn t WHERE t.deleted_at IS NULL AND ${exact.sql} ORDER BY id`
  ).all(...exact.params).map((r) => r.id)
  check('精确匹配只命中自己', rows2, ['t4'])

  const exact2 = buildCategoryCondition('c_breakfast', false)
  const rows3 = db.prepare(
    `SELECT id FROM txn t WHERE t.deleted_at IS NULL AND ${exact2.sql} ORDER BY id`
  ).all(...exact2.params).map((r) => r.id)
  check('精确匹配二级', rows3, ['t1'])

  db.close()
}

console.log('=== URL 参数解析 ===')

// 空参数
{
  const q = parseTxnQueryOptions({})
  check('空参数 -> 全部类型', q.type, 'all')
  check('空参数 -> 无账户', q.accountId, '')
  check('空参数 -> 无分类', q.categoryId, '')
  check('空参数 -> 无子分类展开', q.includeSubcategories, false)
  check('空参数 -> 不是筛选跳转', q.hasFilter, false)
}

// 完整契约
{
  const q = parseTxnQueryOptions({
    accountId: 'acc_1',
    categoryId: 'cat_1',
    includeSubcategories: '1',
    tagId: 'tag_1',
    monthKey: '2026-10',
    type: 'expense'
  })
  check('账户', q.accountId, 'acc_1')
  check('分类', q.categoryId, 'cat_1')
  check('includeSubcategories=1', q.includeSubcategories, true)
  check('标签', q.tagId, 'tag_1')
  check('月份', q.monthKey, '2026-10')
  check('类型', q.type, 'expense')
  check('是筛选跳转', q.hasFilter, true)
}

// 类型白名单
check('非法类型 -> all', parseTxnQueryOptions({ type: 'gift' }).type, 'all')
check('非法类型 -> all（空）', parseTxnQueryOptions({ type: '' }).type, 'all')
check('合法类型 income', parseTxnQueryOptions({ type: 'income' }).type, 'income')
check('合法类型 transfer', parseTxnQueryOptions({ type: 'transfer' }).type, 'transfer')
check('类型大小写不敏感', parseTxnQueryOptions({ type: 'EXPENSE' }).type, 'expense')

// 布尔标记的各种写法
check('includeSubcategories=1', parseTxnQueryOptions({ includeSubcategories: '1' }).includeSubcategories, true)
check('includeSubcategories=true', parseTxnQueryOptions({ includeSubcategories: 'true' }).includeSubcategories, true)
check('includeSubcategories=0', parseTxnQueryOptions({ includeSubcategories: '0' }).includeSubcategories, false)
check('includeSubcategories=空', parseTxnQueryOptions({ includeSubcategories: '' }).includeSubcategories, false)
check('includeSubcategories=乱值', parseTxnQueryOptions({ includeSubcategories: 'x' }).includeSubcategories, false)

// 月份 / 日期格式校验
check('合法 monthKey', parseTxnQueryOptions({ monthKey: '2026-10' }).monthKey, '2026-10')
check('非法 monthKey', parseTxnQueryOptions({ monthKey: '2026-13' }).monthKey, '')
check('非法 monthKey（短）', parseTxnQueryOptions({ monthKey: '2026-1' }).monthKey, '')
check('非法 monthKey（00 月）', parseTxnQueryOptions({ monthKey: '2026-00' }).monthKey, '')
check('合法 day', parseTxnQueryOptions({ day: '2026-10-27' }).day, '2026-10-27')
check('非法 day（2月30日）', parseTxnQueryOptions({ day: '2026-02-30' }).day, '')
check('非法 day（13 月）', parseTxnQueryOptions({ day: '2026-13-01' }).day, '')
check('合法 day（闰年 2 月 29）', parseTxnQueryOptions({ day: '2024-02-29' }).day, '2024-02-29')

// 只带月份不算「筛选跳转」——月份本身是时间范围
check('只带月份不算筛选跳转', parseTxnQueryOptions({ monthKey: '2026-10' }).hasFilter, false)
check('只带类型算筛选跳转', parseTxnQueryOptions({ type: 'expense' }).hasFilter, true)
check('只带账户算筛选跳转', parseTxnQueryOptions({ accountId: 'a' }).hasFilter, true)
check('只带标签算筛选跳转', parseTxnQueryOptions({ tagId: 't' }).hasFilter, true)

// 空白要清掉
check('账户去空格', parseTxnQueryOptions({ accountId: '  acc_1  ' }).accountId, 'acc_1')

console.log('=== 周期数据结构 ===')

// 规范化的默认值
{
  const c = normalizeCycle({ name: '房租' })
  check('默认类型 monthly', c.cycleType, 'monthly')
  check('默认启用', c.enabled, true)
  check('默认金额 0', c.amountCents, 0)
  check('默认 interval 1', c.interval, 1)
  check('默认 dayOfMonth 1', c.dayOfMonth, 1)
  check('默认 weekday 1', c.weekday, 1)
  check('默认 nextDate 空', c.nextDate, '')
}

// 名称必填
check('没有名称 -> null', normalizeCycle({ amountCents: 100 }), null)
check('空名称 -> null', normalizeCycle({ name: '   ' }), null)
check('不是对象 -> null', normalizeCycle(null), null)
check('字符串 -> null', normalizeCycle('房租'), null)

// 字段裁剪
{
  const c = normalizeCycle({
    name: 'Netflix', amountCents: 35800, icon: '📺',
    cycleType: 'monthly', dayOfMonth: 15, nextDate: '2026-11-15',
    accountId: 'acc_1', enabled: false, note: '会员'
  })
  check('名称', c.name, 'Netflix')
  check('金额', c.amountCents, 35800)
  check('图标', c.icon, '📺')
  check('类型', c.cycleType, 'monthly')
  check('几号', c.dayOfMonth, 15)
  check('下次日期', c.nextDate, '2026-11-15')
  check('账户', c.accountId, 'acc_1')
  check('停用', c.enabled, false)
  check('备注', c.note, '会员')
}

// 越界裁剪
{
  const c = normalizeCycle({ name: 'x', dayOfMonth: 99, weekday: 99, interval: 0, amountCents: -5 })
  check('dayOfMonth 上限 31', c.dayOfMonth, 31)
  check('weekday 上限 7', c.weekday, 7)
  check('interval 下限 1', c.interval, 1)
  check('负金额归零', c.amountCents, 0)
}

// 非法类型回落
check('非法 cycleType -> monthly', normalizeCycle({ name: 'x', cycleType: 'nope' }).cycleType, 'monthly')
check('合法 cycleType weekly', normalizeCycle({ name: 'x', cycleType: 'weekly' }).cycleType, 'weekly')
check('合法 cycleType yearly', normalizeCycle({ name: 'x', cycleType: 'yearly' }).cycleType, 'yearly')
check('合法 cycleType custom', normalizeCycle({ name: 'x', cycleType: 'custom' }).cycleType, 'custom')

// 每年几月
check('默认 monthOfYear 1', normalizeCycle({ name: 'x' }).monthOfYear, 1)
check('monthOfYear 越界裁剪', normalizeCycle({ name: 'x', monthOfYear: 99 }).monthOfYear, 12)
check('monthOfYear 下限裁剪', normalizeCycle({ name: 'x', monthOfYear: 0 }).monthOfYear, 1)
check('monthOfYear 正常值', normalizeCycle({ name: 'x', monthOfYear: 3 }).monthOfYear, 3)

console.log('=== 周期存取（内存桩） ===')

// getCycles / setCycles 走的是 api/settings.js 的 setting KV 表，
// 这里只验证「非法项被丢掉、合法项被规范化」这一层逻辑。
{
  const raw = [
    { id: 'c1', name: '房租', amountCents: 350000, cycleType: 'monthly', dayOfMonth: 8 },
    { name: '' },                       // 名字为空 -> 丢掉
    null,                              // 非法 -> 丢掉
    { id: 'c2', name: '会员', amountCents: 3580, cycleType: 'weekly', weekday: 3 }
  ]
  const clean = []
  for (const item of raw) {
    const c = normalizeCycle(item)
    if (c) clean.push(c)
  }
  check('过滤掉非法项后剩 2 条', clean.length, 2)
  check('第一项的金额', clean[0].amountCents, 350000)
  check('第二项的星期', clean[1].weekday, 3)
  check('第二项默认启用', clean[1].enabled, true)
}

console.log('=== 周期类型表 ===')
check('周期类型有 4 种', CYCLE_TYPES.length, 4)
check('周期类型 key 集合', CYCLE_TYPES.map((t) => t.key), ['monthly', 'weekly', 'yearly', 'custom'])

// 非法日期
check('非法 nextDate -> 空', normalizeCycle({ name: 'x', nextDate: '2026-1-1' }).nextDate, '')

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
