/**
 * 预算统计口径的测试
 *
 *   node scripts/test-budget-usage-leaf.mjs
 *
 * ★ 这个测试是为了锁住一个被用户报过的 bug ★
 *   报错现象：「分类预算统计有误，交易未统计在内」
 *   —— 分类预算的「已用」一直是 0。
 *
 * 根因
 *   budget.category_id 存的是用户在分类选择器里选的那个分类，
 *   而选择器只让选**叶子（二级）分类**。
 *   但 getBudgetUsage 里的聚合是
 *       GROUP BY COALESCE(c.parent_id, c.id)
 *   它把交易全归并到**一级**，key 全是 一级 id。
 *   于是拿二级 id 去查 catMap[二级id] 永远是 undefined -> 0。
 *
 *   这个测试同时锁住两种口径都成立：
 *     - 预算挂二级：只统计该二级自己的交易
 *     - 预算挂一级：统计该一级下所有二级的合计
 *
 * 用 node:sqlite 造真库，直接跑聚合 SQL，验证口径。
 */

import { DatabaseSync } from 'node:sqlite'

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

/* ---------------------------------------------------------------- 造库 */

const db = new DatabaseSync(':memory:')

db.exec(`CREATE TABLE category (
  id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL, type TEXT NOT NULL,
  icon TEXT, color TEXT, sort INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, deleted_at INTEGER
)`)
db.exec(`CREATE TABLE txn (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  account_id TEXT NOT NULL, to_account_id TEXT, category_id TEXT, note TEXT,
  occurred_at INTEGER NOT NULL, occurred_day TEXT NOT NULL,
  month_key TEXT NOT NULL, year_key TEXT NOT NULL,
  tz_offset INTEGER NOT NULL DEFAULT 480, source TEXT NOT NULL DEFAULT 'manual',
  raw_text TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  deleted_at INTEGER, exclude_from_budget INTEGER NOT NULL DEFAULT 0
)`)

const now = Date.now()
const insCat = db.prepare(
  `INSERT INTO category (id,parent_id,name,type,icon,color,sort,hidden,created_at,updated_at,deleted_at)
   VALUES (?,?,?,'expense','more','#999',0,0,?,?,NULL)`
)
// 一级「餐饮食品」下面挂两个二级
insCat.run('c_food', null, '餐饮食品', now, now)
insCat.run('c_meal', 'c_food', '正餐', now, now)
insCat.run('c_drink', 'c_food', '饮品', now, now)

const insTxn = db.prepare(
  `INSERT INTO txn (id,type,amount_cents,account_id,category_id,occurred_at,
    occurred_day,month_key,year_key,created_at,updated_at,deleted_at,exclude_from_budget)
   VALUES ('t'||?, 'expense', ?, 'acc1', ?, ?, '2026-10-05','2026-10','2026',?,?,NULL,?)`
)
// 正餐 3 笔共 100.00，饮品 2 笔共 50.00
insTxn.run(1, 3000, 'c_meal', now, now, now, 0)
insTxn.run(2, 4000, 'c_meal', now, now, now, 0)
insTxn.run(3, 3000, 'c_meal', now, now, now, 0)
insTxn.run(4, 2000, 'c_drink', now, now, now, 0)
insTxn.run(5, 3000, 'c_drink', now, now, now, 0)
// 一笔标记「不计入预算」，不能算进去
insTxn.run(6, 9999, 'c_meal', now, now, now, 1)
// 一笔挂在**一级分类**上的交易（有些分类没有二级，直接挂一级）
insTxn.run(7, 700, 'c_food', now, now, now, 0)

/* ------------------------------------------- 复刻 stats.js 里的两套口径 */

console.log('=== 聚合：一级 / 二级两套口径 ===')

const rows = db.prepare(
  `SELECT COALESCE(c.parent_id, c.id) AS root_id,
          t.category_id AS leaf_id,
          SUM(t.amount_cents) AS amt
   FROM txn t LEFT JOIN category c ON c.id = t.category_id
   WHERE t.deleted_at IS NULL AND t.type='expense' AND t.month_key = ?
     AND COALESCE(t.exclude_from_budget, 0) = 0
   GROUP BY root_id, leaf_id`
).all('2026-10')

const catMapRoot = {}
const catMapLeaf = {}
rows.forEach((r) => {
  const amt = Number(r.amt) || 0
  if (r.root_id) catMapRoot[r.root_id] = (catMapRoot[r.root_id] || 0) + amt
  if (r.leaf_id) catMapLeaf[r.leaf_id] = (catMapLeaf[r.leaf_id] || 0) + amt
})

/**
 * 判断一个 id 是不是父分类。
 *
 * ★ 为什么不能「有 leaf 就用 leaf」★
 *   一级分类也可能直接挂交易（「其他/杂项」这类没有二级的），
 *   于是 leaf 里也会有它的 key。优先取 leaf 会把整棵子树漏掉 ——
 *   写这个测试时正是先写错了一版，才把 api/stats.js 的实现也一起纠正过来。
 *
 *   root_id === leaf_id 的那一行说明这个 id 自己是根（没有 parent）。
 */
const parentIds = new Set()
rows.forEach((r) => {
  if (r.root_id && r.root_id === r.leaf_id) parentIds.add(r.root_id)
})

const usedOf = (id) => {
  if (!id) return 0
  if (parentIds.has(id)) return catMapRoot[id] || 0
  return catMapLeaf[id] !== undefined ? catMapLeaf[id] : (catMapRoot[id] || 0)
}

// 正餐：3 笔 3000+4000+3000 = 10000（不含那笔 9999）
check('二级「正餐」只算自己', usedOf('c_meal'), 10000)
check('二级「饮品」只算自己', usedOf('c_drink'), 5000)
// 一级：正餐 10000 + 饮品 5000 + 直接挂一级的 700 = 15700
check('一级「餐饮食品」含所有二级 + 自身', usedOf('c_food'), 15700)

console.log('=== 排除标记生效 ===')

{
  const marked = db.prepare(
    `SELECT SUM(amount_cents) AS amt FROM txn
     WHERE deleted_at IS NULL AND exclude_from_budget = 1`
  ).get()
  check('存在被标记的交易（测试前提）', Number(marked.amt), 9999)
  check('标记的交易没被算进任何预算', usedOf('c_meal') + usedOf('c_drink'), 15000)
}

console.log('=== 旧实现会算错（回归对照）===')

{
  // 旧实现只用 root 口径，然后拿二级 id 去查 -> 恒为 0
  const oldUsed = (id) => catMapRoot[id] || 0
  check('旧实现：二级「正餐」查到 0（就是这个 bug）', oldUsed('c_meal'), 0)
  check('旧实现：二级「饮品」查到 0', oldUsed('c_drink'), 0)
  // 说明：这正是「分类预算统计有误，交易未统计在内」的原因
}

console.log('=== 总支出口径 ===')

{
  const total = db.prepare(
    `SELECT COALESCE(SUM(amount_cents),0) AS amt FROM txn
     WHERE deleted_at IS NULL AND type='expense' AND month_key = ?
       AND COALESCE(exclude_from_budget,0)=0`
  ).get('2026-10')
  check('总支出排除标记后 = 15700', Number(total.amt), 15700)
  check('一级口径合计 == 总支出', usedOf('c_food'), 15700)
}

console.log('=== 边界 ===')

check('null 分类返回 0', usedOf(null), 0)
check('空串分类返回 0', usedOf(''), 0)
check('不存在的分类返回 0', usedOf('c_nope'), 0)

db.close()

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
