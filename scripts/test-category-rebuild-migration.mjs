/**
 * 迁移 v5（默认分类重建成新分类表）的测试
 *
 *   node scripts/test-category-rebuild-migration.mjs
 *
 * ★ 这个测试驱动真实的 api/db/index.js ★
 *   复刻一份迁移逻辑的话，测不出「迁移里用了 query()/execute() 会死锁」
 *   这种问题（项目里踩过这个坑，见 api/db/index.js 里 v2 的注释）。
 *
 * 用 node:sqlite 造一个真的 SQLite 库，让假的 plus.sqlite 代理到它，
 * 这样 SQL 语义（软删除、父子关系、txn 引用）都是真的跑的。
 */

import { DatabaseSync } from 'node:sqlite'
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES
} from '../api/db/schema.js'

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

/* ------------------------------------------------- 真的 SQLite + 假 plus */

function makeFakePlus(opts = {}) {
  const db = new DatabaseSync(':memory:')
  const log = []

  db.exec(`CREATE TABLE category (
    id         TEXT PRIMARY KEY,
    parent_id  TEXT,
    name       TEXT    NOT NULL,
    type       TEXT    NOT NULL,
    icon       TEXT,
    color      TEXT,
    sort       INTEGER NOT NULL DEFAULT 0,
    hidden     INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`)
  db.exec(`CREATE TABLE txn (
    id            TEXT PRIMARY KEY,
    type          TEXT    NOT NULL,
    amount_cents  INTEGER NOT NULL,
    account_id    TEXT    NOT NULL,
    to_account_id TEXT,
    category_id   TEXT,
    note          TEXT,
    occurred_at   INTEGER NOT NULL,
    occurred_day  TEXT    NOT NULL,
    month_key     TEXT    NOT NULL,
    year_key      TEXT    NOT NULL,
    tz_offset     INTEGER NOT NULL DEFAULT 480,
    source        TEXT    NOT NULL DEFAULT 'manual',
    raw_text      TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    deleted_at    INTEGER,
    exclude_from_budget INTEGER NOT NULL DEFAULT 0
  )`)
  db.exec(`CREATE TABLE budget (
    id           TEXT PRIMARY KEY,
    scope        TEXT    NOT NULL,
    category_id  TEXT,
    period       TEXT    NOT NULL DEFAULT 'month',
    amount_cents INTEGER NOT NULL,
    start_month  TEXT    NOT NULL,
    rollover     INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  )`)

  db.exec(`PRAGMA user_version = ${Number(opts.userVersion) || 0}`)

  const fake = {
    sqlite: {
      openDatabase: ({ success }) => { log.push('open'); success && success() },
      closeDatabase: ({ success }) => { log.push('close'); success && success() },
      selectSql: ({ sql, success, fail }) => {
        if (sql.indexOf('PRAGMA user_version') !== -1) {
          log.push('user_version')
          const rows = db.prepare('PRAGMA user_version').all()
          success && success(rows.map((r) => ({ user_version: r.user_version })))
          return
        }
        log.push('select:' + sql.slice(0, 60))
        try {
          const rows = db.prepare(sql).all()
          success && success(rows)
        } catch (e) {
          fail && fail({ message: e.message })
        }
      },

      executeSql: ({ sql, success, fail }) => {
        log.push('exec:' + sql.slice(0, 60))
        try {
          db.exec(sql)
          success && success()
        } catch (e) {
          fail && fail({ message: e.message })
        }
      },
      transaction: ({ operation, success, fail }) => {
        log.push('tx:' + operation)
        try {
          if (operation === 'begin') db.exec('BEGIN')
          else if (operation === 'commit') db.exec('COMMIT')
          else if (operation === 'rollback') db.exec('ROLLBACK')
          success && success()
        } catch (e) {
          fail && fail({ message: e.message })
        }
      }
    },
    __db: db
  }
  return { fake, log, db }
}

async function loadRealDb(fake) {
  globalThis.plus = fake
  const mod = await import('../api/db/index.js?t=' + Math.random())
  return mod
}

function insertCat(db, { id, parent_id = null, name, type, icon = 'more', color = '#969799', sort = 0, deleted_at = null }) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?,?,?,0,?,?,?)`
  ).run(id, parent_id, name, type, icon, color, sort, now, now, deleted_at)
}

function insertTxn(db, { id, category_id, type = 'expense' }) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO txn (id, type, amount_cents, account_id, to_account_id, category_id, note,
      occurred_at, occurred_day, month_key, year_key, tz_offset,
      source, raw_text, created_at, updated_at, deleted_at)
     VALUES (?,?,?,'acc1',NULL,?,'note',?, '2026-10-27','2026-10','2026',480,'manual',NULL,?,?,NULL)`
  ).run(id, type, 100, category_id, now, now, now)
}

function insertBudget(db, { id, scope, category_id }) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO budget (id, scope, category_id, period, amount_cents, start_month, rollover, created_at, updated_at)
     VALUES (?,?,?,'month',10000,'2026-10',0,?,?)`
  ).run(id, scope, category_id, now, now)
}

/** 活着的分类（没被软删除的） */
function activeCats(db) {
  return db.prepare(
    'SELECT id, parent_id, name, type, icon, color, sort FROM category WHERE deleted_at IS NULL ORDER BY type, sort, name'
  ).all()
}

/** 一级分类名（按 type） */
function topNames(db, type) {
  return db.prepare(
    'SELECT name FROM category WHERE deleted_at IS NULL AND type = ? AND parent_id IS NULL ORDER BY sort'
  ).all(type).map((r) => r.name)
}

/** 软删除的分类数 */
function deletedCount(db) {
  return db.prepare('SELECT COUNT(*) AS c FROM category WHERE deleted_at IS NOT NULL').get().c
}

console.log('=== 场景 1：老库（旧默认分类）→ 迁移后应该是新分类表 ===')

{
  const { fake, db } = makeFakePlus({ userVersion: 4 })

  // 老默认分类：餐饮/交通/购物 + 工资/理财
  insertCat(db, { id: 'cat_food', name: '餐饮', type: 'expense' })
  insertCat(db, { id: 'cat_food_child', parent_id: 'cat_food', name: '午餐', type: 'expense' })
  insertCat(db, { id: 'cat_car', name: '交通', type: 'expense' })
  insertCat(db, { id: 'cat_salary', name: '工资', type: 'income' })
  // v4 留下的固定分类
  insertCat(db, { id: 'cat_rec_exp', name: '对账支出', type: 'expense', sort: 999 })
  insertCat(db, { id: 'cat_rec_inc', name: '对账收入', type: 'income', sort: 999 })

  // 历史交易挂在旧分类上
  insertTxn(db, { id: 't1', category_id: 'cat_food' })
  insertTxn(db, { id: 't2', category_id: 'cat_food_child' })
  insertTxn(db, { id: 't3', category_id: 'cat_salary' })

  // 分类预算也指向旧分类
  insertBudget(db, { id: 'b1', scope: 'category', category_id: 'cat_food' })
  insertBudget(db, { id: 'b2', scope: 'total', category_id: null })

  const mod = await loadRealDb(fake)
  const result = await Promise.race([
    mod.openDb().then(() => 'OPENED').catch((e) => 'ERROR:' + e.message),
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 5000))
  ])
  check('迁移没有死锁', result, 'OPENED')

  // ---- 支出一级分类应该是新的 9 个（+ 对账支出这个固定分类） ----
  check(
    '支出一级分类已换成新的',
    topNames(db, 'expense'),
    [...DEFAULT_EXPENSE_CATEGORIES.map((c) => c.name), '对账支出']
  )

  // ---- 收入一级分类应该是新的 9 个（+ 对账收入这个固定分类） ----
  check(
    '收入一级分类已换成新的',
    topNames(db, 'income'),
    [...DEFAULT_INCOME_CATEGORIES.map((c) => c.name), '对账收入']
  )

  // ---- 二级分类也在 ----
  const food = db.prepare(
    "SELECT id FROM category WHERE deleted_at IS NULL AND name = '餐饮食品' AND type = 'expense'"
  ).get()
  check('餐饮食品存在', !!food, true)

  const children = db.prepare(
    'SELECT name FROM category WHERE deleted_at IS NULL AND parent_id = ? ORDER BY sort'
  ).all(food.id).map((r) => r.name)
  check(
    '餐饮食品的二级分类',
    children,
    DEFAULT_EXPENSE_CATEGORIES[0].children.map((c) => (typeof c === 'string' ? c : c.name))
  )

  // ---- 旧分类被软删除（不是硬删，可撤销） ----
  const oldFood = db.prepare("SELECT deleted_at FROM category WHERE id = 'cat_food'").get()
  check('旧分类被软删除', oldFood.deleted_at !== null, true)
  check('旧分类还在表里（软删不是硬删）', !!oldFood, true)

  // ---- 历史交易不再指向已删除的分类 ----
  const dangling = db.prepare(
    `SELECT COUNT(*) AS c FROM txn t
     WHERE t.deleted_at IS NULL AND t.category_id IS NOT NULL
       AND t.category_id NOT IN (SELECT id FROM category WHERE deleted_at IS NULL)`
  ).get().c
  check('没有交易指向已删除的分类', dangling, 0)

  // ---- 交易的 category_id 指向了活着的分类 ----
  const txnCats = db.prepare('SELECT id, category_id FROM txn ORDER BY id').all()
  const allIds = new Set(activeCats(db).map((r) => r.id))
  for (const t of txnCats) {
    check(`交易 ${t.id} 指向有效分类`, allIds.has(t.category_id), true)
  }

  // ---- 分类预算：指向旧分类的被删掉，总预算保留 ----
  const budgets = db.prepare('SELECT id FROM budget ORDER BY id').all().map((r) => r.id)
  check('失效的分类预算被删除，总预算保留', budgets, ['b2'])

  // ---- 对账固定分类还在（且是一级） ----
  const recExp = db.prepare(
    "SELECT parent_id, sort FROM category WHERE deleted_at IS NULL AND name = '对账支出' AND type = 'expense'"
  ).get()
  check('对账支出重建了', !!recExp, true)
  check('对账支出是一级分类', recExp ? recExp.parent_id === null : false, true)

  const recInc = db.prepare(
    "SELECT parent_id FROM category WHERE deleted_at IS NULL AND name = '对账收入' AND type = 'income'"
  ).get()
  check('对账收入重建了', !!recInc, true)
  check('对账收入是一级分类', recInc ? recInc.parent_id === null : false, true)

  // ---- 分类数量对得上 ----
  const expectedCount =
    DEFAULT_EXPENSE_CATEGORIES.reduce((n, c) => n + 1 + c.children.length, 0) +
    DEFAULT_INCOME_CATEGORIES.reduce((n, c) => n + 1 + c.children.length, 0) +
    2 // 两个对账固定分类
  check('活着的分类总数', activeCats(db).length, expectedCount)

  console.log(`  活着的分类 ${activeCats(db).length} 条，软删除 ${deletedCount(db)} 条`)
}

console.log('=== 场景 2：幂等 —— 跑第二遍结果一样 ===')

{
  const { fake, db } = makeFakePlus({ userVersion: 4 })
  insertCat(db, { id: 'cat_food', name: '餐饮', type: 'expense' })
  insertTxn(db, { id: 't1', category_id: 'cat_food' })

  const mod = await loadRealDb(fake)
  await mod.openDb()

  const first = activeCats(db).map((r) => r.name + '|' + r.type).sort()
  const firstDeleted = deletedCount(db)
  const firstIds = activeCats(db).map((r) => r.id).sort()

  // 再跑一次（把 user_version 拨回 4，模拟重复执行）
  db.exec('PRAGMA user_version = 4')
  const mod2 = await loadRealDb(fake)
  await mod2.openDb()

  const second = activeCats(db).map((r) => r.name + '|' + r.type).sort()
  check('第二遍后活着的分类一样', second, first)

  // ★ 关键：第二遍必须完全跳过，不能把刚建好的又软删一遍重建 ★
  //   否则会凭空多出一批软删除记录，
  //   而且历史交易的 category_id 会指向刚被软删的行。
  check('第二遍没有新增软删除记录', deletedCount(db), firstDeleted)
  check(
    '第二遍没有重建分类（id 不变）',
    activeCats(db).map((r) => r.id).sort(),
    firstIds
  )

  // 活着的分类不该翻倍
  const dup = db.prepare(
    `SELECT name, type, COUNT(*) AS c FROM category
     WHERE deleted_at IS NULL GROUP BY name, type HAVING c > 1`
  ).all()
  check('没有重复的分类', dup.length, 0)

  console.log(`  软删除数 ${firstDeleted} -> ${deletedCount(db)}`)
}

console.log('=== 场景 3：空库（全新安装）也能正常迁移 ===')

{
  const { fake, db } = makeFakePlus({ userVersion: 4 })
  const mod = await loadRealDb(fake)
  const result = await Promise.race([
    mod.openDb().then(() => 'OPENED').catch((e) => 'ERROR:' + e.message),
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 5000))
  ])
  check('空库迁移没死锁', result, 'OPENED')
  check(
    '空库也有完整的新分类表',
    topNames(db, 'expense'),
    [...DEFAULT_EXPENSE_CATEGORIES.map((c) => c.name), '对账支出']
  )
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
