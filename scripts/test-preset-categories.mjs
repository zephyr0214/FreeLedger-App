/**
 * 迁移 v14（「系统预置分类」固定分类组）的测试
 *
 *   node scripts/test-preset-categories.mjs
 *
 * ★ 用户要求 ★
 *   分类页面，固定分类的一级分类名为「系统预置分类」，
 *   二级分类支出为「借出」「对账支出」，收入为「借入」「对账收入」。
 *
 * ★ 为什么必须靠迁移，不能只改代码 ★
 *   老库里「对账支出 / 对账收入」是各自独立的一级分类，
 *   历史对账流水的 category_id 全指着它们。
 *   只改新建逻辑的话，老用户永远看不到新结构。
 *
 * ★ 迁移必须「收编」而不是「重建」★
 *   如果软删旧行再新建，历史流水的 category_id 会变成悬空引用，
 *   账面上那几笔「余额对账调整」就说不清了。
 *   正确做法是把旧行的 parent_id 改到「系统预置分类」下面，保留 id。
 *
 * 这里驱动真实的 api/db/index.js（用 node:sqlite 造真库）。
 */

import { DatabaseSync } from 'node:sqlite'
import {
  SYSTEM_PRESET_GROUPS, SYSTEM_PRESET_CHILDREN
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

function makeFakePlus(userVersion = 13) {
  const db = new DatabaseSync(':memory:')

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
    id TEXT PRIMARY KEY, type TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    account_id TEXT NOT NULL, to_account_id TEXT, category_id TEXT, note TEXT,
    occurred_at INTEGER NOT NULL, occurred_day TEXT NOT NULL,
    month_key TEXT NOT NULL, year_key TEXT NOT NULL,
    tz_offset INTEGER NOT NULL DEFAULT 480,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
    exclude_from_budget INTEGER NOT NULL DEFAULT 0
  )`)
  db.exec(`CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT)`)
  db.exec(`CREATE TABLE budget (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL, category_id TEXT,
    period TEXT NOT NULL DEFAULT 'month', amount_cents INTEGER NOT NULL,
    start_month TEXT NOT NULL, rollover INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`)
  db.exec(`PRAGMA user_version = ${userVersion}`)

  const fake = {
    sqlite: {
      openDatabase: ({ success }) => success && success(),
      closeDatabase: ({ success }) => success && success(),
      selectSql: ({ sql, success, fail: f }) => {
        if (sql.indexOf('PRAGMA user_version') !== -1) {
          success && success(db.prepare('PRAGMA user_version').all())
          return
        }
        try {
          success && success(db.prepare(sql).all())
        } catch (e) {
          f && f({ message: e.message })
        }
      },
      executeSql: ({ sql, success, fail: f }) => {
        try {
          db.exec(sql)
          success && success()
        } catch (e) {
          f && f({ message: e.message })
        }
      },
      transaction: ({ operation, success, fail: f }) => {
        try {
          if (operation === 'begin') db.exec('BEGIN')
          else if (operation === 'commit') db.exec('COMMIT')
          else if (operation === 'rollback') db.exec('ROLLBACK')
          success && success()
        } catch (e) {
          f && f({ message: e.message })
        }
      }
    }
  }
  return { fake, db }
}

function insertCat(db, {
  id, parent_id = null, name, type, icon = 'more', color = '#969799',
  sort = 0, deleted_at = null
}) {
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
      created_at, updated_at, deleted_at)
     VALUES (?,?,100,'acc1',NULL,?,'note',?,'2026-10-27','2026-10','2026',480,?,?,NULL)`
  ).run(id, type, category_id, now, now, now)
}

/** 找「系统预置分类」这一条一级分类 */
function groupRow(db, type) {
  return db.prepare(
    'SELECT id, name, icon, color, sort FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL'
  ).get(SYSTEM_PRESET_GROUPS[type].name, type)
}

/** 组下的固定子类（按 sort） */
function childrenOf(db, groupId) {
  return db.prepare(
    'SELECT id, name, icon, parent_id FROM category WHERE deleted_at IS NULL AND parent_id = ? ORDER BY sort, name'
  ).all(groupId)
}

console.log('=== 场景 1：老库（对账支出/对账收入是独立一级）→ 收编到组里 ===')

{
  const { fake, db } = makeFakePlus(13)

  // 老结构：两个独立的一级分类
  insertCat(db, { id: 'cat_rec_exp', name: '对账支出', type: 'expense', sort: 999 })
  insertCat(db, { id: 'cat_rec_inc', name: '对账收入', type: 'income', sort: 999 })
  // 普通分类
  insertCat(db, { id: 'cat_food', name: '餐饮食品', type: 'expense' })

  // 历史对账流水挂在它们名下
  insertTxn(db, { id: 't1', category_id: 'cat_rec_exp' })
  insertTxn(db, { id: 't2', category_id: 'cat_rec_inc', type: 'income' })

  globalThis.plus = fake
  const mod = await import('../api/db/index.js?t=' + Math.random())
  const opened = await Promise.race([
    mod.openDb().then(() => 'OPENED').catch((e) => 'ERROR:' + e.message),
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 5000))
  ])
  check('迁移没有死锁', opened, 'OPENED')

  // ---- 组建出来了 ----
  const gExp = groupRow(db, 'expense')
  const gInc = groupRow(db, 'income')
  check('支出的「系统预置分类」存在', !!gExp, true)
  check('收入的「系统预置分类」存在', !!gInc, true)

  // ---- 固定子类齐了，顺序是用户指定的 ----
  check('支出的固定子类', childrenOf(db, gExp.id).map((c) => c.name), ['借出', '借款归还', '对账支出'])
  check('收入的固定子类', childrenOf(db, gInc.id).map((c) => c.name), ['借入', '借款收回', '对账收入'])

  // ---- ★ 关键：旧行的 id 被保留（历史流水不能变成悬空引用）★ ----
  const recExpNow = childrenOf(db, gExp.id).find((c) => c.name === '对账支出')
  const recIncNow = childrenOf(db, gInc.id).find((c) => c.name === '对账收入')
  check('「对账支出」保留了原来的 id', recExpNow ? recExpNow.id : '', 'cat_rec_exp')
  check('「对账收入」保留了原来的 id', recIncNow ? recIncNow.id : '', 'cat_rec_inc')
  check('「对账支出」现在挂在组下面', recExpNow ? recExpNow.parent_id : '', gExp.id)

  // ---- 历史流水仍然指向有效的分类 ----
  const t1 = db.prepare('SELECT category_id FROM txn WHERE id = ?').get('t1')
  const t2 = db.prepare('SELECT category_id FROM txn WHERE id = ?').get('t2')
  check('历史对账流水的 category_id 没被改坏', t1.category_id, 'cat_rec_exp')
  check('历史对账收入流水的 category_id 没被改坏', t2.category_id, 'cat_rec_inc')

  const dangling = db.prepare(
    `SELECT COUNT(*) AS c FROM txn t
     WHERE t.deleted_at IS NULL AND t.category_id IS NOT NULL
       AND t.category_id NOT IN (SELECT id FROM category WHERE deleted_at IS NULL)`
  ).get().c
  check('没有交易指向已删除的分类', dangling, 0)

  // ---- 没有重复的「对账支出」 ----
  const dupRec = db.prepare(
    "SELECT COUNT(*) AS c FROM category WHERE deleted_at IS NULL AND name = '对账支出' AND type = 'expense'"
  ).get().c
  check('「对账支出」只有一条', dupRec, 1)

  // ---- 普通分类没被动 ----
  const food = db.prepare("SELECT deleted_at FROM category WHERE id = 'cat_food'").get()
  check('用户自己的分类没被软删', food.deleted_at, null)

  // ---- 图标来自 schema 定义 ----
  for (const def of SYSTEM_PRESET_CHILDREN) {
    const row = db.prepare(
      'SELECT icon FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NOT NULL'
    ).get(def.name, def.type)
    check(`固定子类「${def.name}」的图标`, row ? row.icon : '', def.icon)
  }
}

console.log('=== 场景 2：全新库（没有任何对账分类）-> 直接建 ===')

{
  const { fake, db } = makeFakePlus(13)

  globalThis.plus = fake
  const mod = await import('../api/db/index.js?t=' + Math.random())
  await mod.openDb()

  const gExp = groupRow(db, 'expense')
  const gInc = groupRow(db, 'income')
  check('支出组建出来了', !!gExp, true)
  check('收入组建出来了', !!gInc, true)
  check('支出的固定子类', childrenOf(db, gExp.id).map((c) => c.name), ['借出', '借款归还', '对账支出'])
  check('收入的固定子类', childrenOf(db, gInc.id).map((c) => c.name), ['借入', '借款收回', '对账收入'])
  // 组排最后（sort 999），不抢用户分类的位置
  check('支出组的 sort 排最后', gExp.sort, 999)
}

console.log('=== 场景 3：幂等 —— 跑第二遍结果一样 ===')

{
  const { fake, db } = makeFakePlus(13)

  insertCat(db, { id: 'cat_rec_exp', name: '对账支出', type: 'expense', sort: 999 })

  globalThis.plus = fake
  const mod1 = await import('../api/db/index.js?t=' + Math.random())
  await mod1.openDb()

  const snapshot = () => db.prepare(
    'SELECT id, parent_id, name, type, icon, color, sort FROM category WHERE deleted_at IS NULL ORDER BY id'
  ).all()

  const first = snapshot()
  const firstDeleted = db.prepare(
    'SELECT COUNT(*) AS c FROM category WHERE deleted_at IS NOT NULL'
  ).get().c

  // 再跑一遍（把 user_version 拨回 13）
  db.exec('PRAGMA user_version = 13')
  const mod2 = await import('../api/db/index.js?t=' + Math.random())
  await mod2.openDb()

  check('第二遍后分类表完全一样', snapshot(), first)
  check(
    '第二遍没有新增软删除记录',
    db.prepare('SELECT COUNT(*) AS c FROM category WHERE deleted_at IS NOT NULL').get().c,
    firstDeleted
  )

  // 不该出现重复
  const dup = db.prepare(
    `SELECT name, type, COUNT(*) AS c FROM category
     WHERE deleted_at IS NULL GROUP BY name, type HAVING c > 1`
  ).all()
  check('没有重复的分类', dup.length, 0)
}

console.log('=== 场景 4：组已经存在、子类也在 -> 只刷新图标，不重复插入 ===')

{
  const { fake, db } = makeFakePlus(13)

  // 手工造一个已经正确的结构，但图标是错的
  insertCat(db, {
    id: 'g_exp', name: '系统预置分类', type: 'expense', sort: 999
  })
  insertCat(db, {
    id: 'c_lend', parent_id: 'g_exp', name: '借出', type: 'expense', icon: 'WRONG', sort: 0
  })

  globalThis.plus = fake
  const mod = await import('../api/db/index.js?t=' + Math.random())
  await mod.openDb()

  const lend = db.prepare("SELECT id, icon FROM category WHERE name = '借出' AND type = 'expense'").get()
  check('「借出」没有被重复插入（id 还是原来那条）', lend.id, 'c_lend')
  check(
    '「借出」的图标被刷成定义里的',
    lend.icon,
    SYSTEM_PRESET_CHILDREN.find((d) => d.name === '借出').icon
  )
  const lendCount = db.prepare(
    "SELECT COUNT(*) AS c FROM category WHERE deleted_at IS NULL AND name = '借出' AND type = 'expense'"
  ).get().c
  check('「借出」只有一条', lendCount, 1)
}

console.log('=== 场景 5：同名一级分类有多条（脏数据）-> 只收编一条，其余软删 ===')

{
  const { fake, db } = makeFakePlus(13)

  insertCat(db, { id: 'rec_a', name: '对账支出', type: 'expense', sort: 998 })
  insertCat(db, { id: 'rec_b', name: '对账支出', type: 'expense', sort: 999 })

  globalThis.plus = fake
  const mod = await import('../api/db/index.js?t=' + Math.random())
  await mod.openDb()

  const alive = db.prepare(
    "SELECT id FROM category WHERE deleted_at IS NULL AND name = '对账支出' AND type = 'expense'"
  ).all()
  check('活着的「对账支出」只有一条', alive.length, 1)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
