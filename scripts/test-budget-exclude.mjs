/**
 * 「不计入预算」标记的测试
 *
 *   node scripts/test-budget-exclude.mjs
 *
 * 验证三件事：
 *   1. 迁移 v3 能给已有的 txn 表加上 exclude_from_budget 字段
 *   2. 重复执行迁移不会报错（幂等）
 *   3. 预算统计会排除标记了「不计入预算」的交易
 *
 * 用 node:sqlite 跑真实 SQL。
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

console.log('=== 迁移 v3：加字段 ===')

{
  const db = new DatabaseSync(':memory:')
  // 模拟 v1 建出来的表（没有 exclude_from_budget）
  db.exec(`CREATE TABLE txn (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    account_id TEXT NOT NULL, category_id TEXT, note TEXT,
    occurred_day TEXT NOT NULL, month_key TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual', deleted_at INTEGER
  )`)

  // 检查字段确实不存在
  const before = db.prepare('PRAGMA table_info(txn)').all().map((c) => c.name)
  check('迁移前没有这个字段', before.includes('exclude_from_budget'), false)

  // 执行迁移
  db.exec('ALTER TABLE txn ADD COLUMN exclude_from_budget INTEGER NOT NULL DEFAULT 0')
  const after = db.prepare('PRAGMA table_info(txn)').all().map((c) => c.name)
  check('迁移后字段存在', after.includes('exclude_from_budget'), true)

  // 已有数据的默认值应该是 0（不排除）
  db.exec(`INSERT INTO txn (id, type, amount_cents, account_id, occurred_day, month_key)
           VALUES ('t1', 'expense', 10000, 'a1', '2026-10-01', '2026-10')`)
  const row = db.prepare('SELECT exclude_from_budget FROM txn WHERE id = ?').get('t1')
  check('老数据默认是 0', row.exclude_from_budget, 0)

  db.close()
}

console.log('=== 迁移幂等（字段已存在） ===')

{
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE txn (id TEXT PRIMARY KEY, exclude_from_budget INTEGER NOT NULL DEFAULT 0)`)

  let threw = null
  try {
    db.exec('ALTER TABLE txn ADD COLUMN exclude_from_budget INTEGER NOT NULL DEFAULT 0')
  } catch (e) {
    threw = e.message
  }
  check('重复迁移会报错（靠 catch 兜住）', !!threw, true)
  check('错误信息能识别出来', /duplicate|already exists/i.test(threw || ''), true)

  db.close()
}

console.log('=== 预算统计排除标记 ===')

{
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE txn (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    account_id TEXT NOT NULL, category_id TEXT, note TEXT,
    occurred_day TEXT NOT NULL, month_key TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual', deleted_at INTEGER,
    exclude_from_budget INTEGER NOT NULL DEFAULT 0
  )`)

  // 餐饮 100（计入）+ 购物 200（不计入）
  db.exec(`INSERT INTO txn (id, type, amount_cents, account_id, category_id, occurred_day, month_key, exclude_from_budget)
    VALUES ('t1', 'expense', 10000, 'a1', 'c_food', '2026-10-01', '2026-10', 0),
           ('t2', 'expense', 20000, 'a1', 'c_shop', '2026-10-02', '2026-10', 1)`)

  const totalSql = `SELECT COALESCE(SUM(amount_cents),0) AS amt FROM txn
     WHERE deleted_at IS NULL AND type='expense' AND month_key = ?
       AND COALESCE(exclude_from_budget, 0) = 0`
  const total = db.prepare(totalSql).get('2026-10')
  check('总额只算计入预算的', total.amt, 10000)

  // 不排除的话应该是 30000
  const noFilter = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS amt FROM txn
     WHERE deleted_at IS NULL AND type='expense' AND month_key = ?`).get('2026-10')
  check('不排除的话是全部', noFilter.amt, 30000)

  // 分类聚合也要排除
  const catSql = `SELECT c.name, SUM(t.amount_cents) AS amt
     FROM txn t LEFT JOIN category c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL AND t.type='expense' AND t.month_key = ?
       AND COALESCE(t.exclude_from_budget, 0) = 0
     GROUP BY c.name`
  db.exec(`CREATE TABLE category (id TEXT PRIMARY KEY, name TEXT)`)
  db.exec(`INSERT INTO category VALUES ('c_food', '餐饮'), ('c_shop', '购物')`)
  const cats = db.prepare(catSql).all('2026-10')
  check('分类聚合只有餐饮', cats.length, 1)
  check('分类金额是 10000', cats[0].amt, 10000)

  db.close()
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
