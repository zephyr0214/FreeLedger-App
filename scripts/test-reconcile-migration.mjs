/**
 * 迁移 v4（「对账调整」拆成两个固定一级分类）的测试
 *
 *   node scripts/test-reconcile-migration.mjs
 *
 * ★ 这个测试驱动真实的 api/db/index.js ★
 *   复刻一份迁移逻辑的话，测不出「迁移里用了 query()/execute() 会死锁」
 *   这种问题（项目里踩过这个坑，见 api/db/index.js 里 v2 的注释）。
 *
 * 用 node:sqlite 造一个真的 SQLite 库，让假的 plus.sqlite 代理到它，
 * 这样 SQL 语义（软删除、父子关系、txn 引用）都是真的跑的。
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

/* ------------------------------------------------- 真的 SQLite + 假 plus */

/**
 * 造一个假的 plus.sqlite，后端是 node:sqlite 的真库
 * @param {object} opts { userVersion }
 */
function makeFakePlus(opts = {}) {
  const db = new DatabaseSync(':memory:')
  const log = []

  // 建表（和 api/db/schema.js 的 SCHEMA_V1 保持一致）
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

  // 设定初始版本号 —— 迁移就是靠 PRAGMA user_version 判断该跑哪几条
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

/** 装上假的 plus，导入真实的 db 模块（每次全新实例） */
async function loadRealDb(fake) {
  globalThis.plus = fake
  const mod = await import('../api/db/index.js?t=' + Math.random())
  return mod
}

/** 插入一条分类 */
function insertCat(db, { id, parent_id = null, name, type, icon = 'more', color = '#969799', sort = 0, deleted_at = null }) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?,?,?,0,?,?,?)`
  ).run(id, parent_id, name, type, icon, color, sort, now, now, deleted_at)
}

/** 插入一条交易 */
function insertTxn(db, { id, category_id, type = 'expense' }) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO txn (id, type, amount_cents, account_id, to_account_id, category_id, note,
      occurred_at, occurred_day, month_key, year_key, tz_offset,
      source, raw_text, created_at, updated_at, deleted_at)
     VALUES (?,?,?,'acc1',NULL,?,'note',?, '2026-10-27','2026-10','2026',480,'manual',NULL,?,?,NULL)`
  ).run(id, type, 100, category_id, now, now, now)
}

/** 查所有分类（按 id 排序，方便对比） */
function allCats(db) {
  return db.prepare('SELECT id, parent_id, name, type, deleted_at FROM category ORDER BY id').all()
}

/** 查某分类的交易 id 列表 */
function txnCats(db) {
  return db.prepare('SELECT id, category_id FROM txn ORDER BY id').all()
}

console.log('=== 场景 1：老库结构（对账调整 + 二级）→ 迁移后 ===')

{
  const { fake, db } = makeFakePlus({ userVersion: 3 })

  // 老结构：expense 下一个一级「对账调整」，下面挂二级「对账支出」
  insertCat(db, { id: 'cat_exp', name: '对账调整', type: 'expense', sort: 999 })
  insertCat(db, { id: 'cat_exp_child', parent_id: 'cat_exp', name: '对账支出', type: 'expense' })
  // income 下一个一级「对账调整」，下面挂二级「对账收入」
  insertCat(db, { id: 'cat_inc', name: '对账调整', type: 'income', sort: 999 })
  insertCat(db, { id: 'cat_inc_child', parent_id: 'cat_inc', name: '对账收入', type: 'income' })
  // 两个普通的日常分类，确认没被误伤
  insertCat(db, { id: 'cat_food', name: '餐饮', type: 'expense' })
  insertCat(db, { id: 'cat_salary', name: '工资', type: 'income' })

  // 历史交易挂在旧的二级上
  insertTxn(db, { id: 't1', category_id: 'cat_exp_child' })
  insertTxn(db, { id: 't2', category_id: 'cat_inc_child' })
  insertTxn(db, { id: 't3', category_id: 'cat_food' })

  const mod = await loadRealDb(fake)
  const result = await Promise.race([
    mod.openDb().then(() => 'OPENED').catch((e) => 'ERROR:' + e.message),
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 5000))
  ])
  check('迁移没有死锁', result, 'OPENED')

  const cats = allCats(db)
  console.log('  迁移后：', JSON.stringify(cats))

  // 旧的一级改名成「对账支出」「对账收入」，且是一级
  const exp = cats.find((c) => c.type === 'expense' && c.name === '对账支出')
  check('存在 expense 一级「对账支出」', !!exp, true)
  check('「对账支出」是一级（parent_id 为空）', exp ? exp.parent_id : 'x', null)
  check('「对账支出」没有软删除', exp ? exp.deleted_at : 'x', null)

  const inc = cats.find((c) => c.type === 'income' && c.name === '对账收入')
  check('存在 income 一级「对账收入」', !!inc, true)
  check('「对账收入」是一级（parent_id 为空）', inc ? inc.parent_id : 'x', null)
  check('「对账收入」没有软删除', inc ? inc.deleted_at : 'x', null)

  // 旧的一级「对账调整」不该再活着
  const aliveLegacy = cats.filter((c) => c.name === '对账调整' && c.deleted_at === null)
  check('没有活的「对账调整」', aliveLegacy.length, 0)

  // 旧的二级被软删除
  const oldChild = cats.find((c) => c.id === 'cat_exp_child')
  check('旧的二级「对账支出」被软删除', oldChild ? oldChild.deleted_at !== null : false, true)
  const oldChild2 = cats.find((c) => c.id === 'cat_inc_child')
  check('旧的二级「对账收入」被软删除', oldChild2 ? oldChild2.deleted_at !== null : false, true)

  // 交易改指向新的一级
  const txns = txnCats(db)
  const t1 = txns.find((t) => t.id === 't1')
  const t2 = txns.find((t) => t.id === 't2')
  const t3 = txns.find((t) => t.id === 't3')
  check('expense 的历史交易指向新的一级', t1 ? t1.category_id : 'x', exp ? exp.id : 'x')
  check('income 的历史交易指向新的一级', t2 ? t2.category_id : 'x', inc ? inc.id : 'x')
  check('普通分类的交易没被动', t3 ? t3.category_id : 'x', 'cat_food')

  // 日常分类没被误删
  check('「餐饮」还在', cats.some((c) => c.id === 'cat_food' && c.deleted_at === null), true)
  check('「工资」还在', cats.some((c) => c.id === 'cat_salary' && c.deleted_at === null), true)
}

console.log('=== 场景 2：迁移幂等（跑两次结果一样）===')

{
  const { fake, db } = makeFakePlus({ userVersion: 3 })

  insertCat(db, { id: 'cat_exp', name: '对账调整', type: 'expense', sort: 999 })
  insertCat(db, { id: 'cat_exp_child', parent_id: 'cat_exp', name: '对账支出', type: 'expense' })
  insertCat(db, { id: 'cat_inc', name: '对账调整', type: 'income', sort: 999 })
  insertCat(db, { id: 'cat_inc_child', parent_id: 'cat_inc', name: '对账收入', type: 'income' })
  insertTxn(db, { id: 't1', category_id: 'cat_exp_child' })
  insertTxn(db, { id: 't2', category_id: 'cat_inc_child' })

  const mod = await loadRealDb(fake)
  await mod.openDb()

  const afterFirst = allCats(db).map((c) => ({
    id: c.id, parent_id: c.parent_id, name: c.name, type: c.type,
    deleted: c.deleted_at !== null
  }))
  const txnsFirst = txnCats(db).map((t) => ({ id: t.id, category_id: t.category_id }))

  // 手动把版本号退回 3，再跑一次迁移
  db.exec('PRAGMA user_version = 3')

  const mod2 = await import('../api/db/index.js?t=' + Math.random())
  globalThis.plus = fake
  await mod2.openDb()

  const afterSecond = allCats(db).map((c) => ({
    id: c.id, parent_id: c.parent_id, name: c.name, type: c.type,
    deleted: c.deleted_at !== null
  }))
  const txnsSecond = txnCats(db).map((t) => ({ id: t.id, category_id: t.category_id }))

  check('跑两次后分类结构一样', afterSecond, afterFirst)
  check('跑两次后交易指向一样', txnsSecond, txnsFirst)

  // 目标一级只有一个
  const expTargets = allCats(db).filter(
    (c) => c.name === '对账支出' && c.type === 'expense' && c.deleted_at === null
  )
  check('expense 的「对账支出」只有一个', expTargets.length, 1)
  const incTargets = allCats(db).filter(
    (c) => c.name === '对账收入' && c.type === 'income' && c.deleted_at === null
  )
  check('income 的「对账收入」只有一个', incTargets.length, 1)
}

console.log('=== 场景 3：目标名已被占用（幂等的另一半）===')

{
  // 目标一级已经存在（比迁移先跑过），旧的「对账调整」还在
  const { fake, db } = makeFakePlus({ userVersion: 3 })

  insertCat(db, { id: 'cat_exp_new', name: '对账支出', type: 'expense', sort: 999 })
  insertCat(db, { id: 'cat_exp', name: '对账调整', type: 'expense', sort: 999 })
  insertCat(db, { id: 'cat_exp_child', parent_id: 'cat_exp', name: '对账支出', type: 'expense' })
  insertTxn(db, { id: 't1', category_id: 'cat_exp_child' })
  insertTxn(db, { id: 't2', category_id: 'cat_exp' })

  const mod = await loadRealDb(fake)
  await mod.openDb()

  const cats = allCats(db)
  const alive = cats.filter((c) => c.name === '对账支出' && c.type === 'expense' && c.deleted_at === null)
  check('只有一个活的「对账支出」', alive.length, 1)
  check('活的那个是原有的（id 不变）', alive[0] ? alive[0].id : 'x', 'cat_exp_new')
  check('旧的一级被软删除', cats.find((c) => c.id === 'cat_exp').deleted_at !== null, true)
  check('旧的二级被软删除', cats.find((c) => c.id === 'cat_exp_child').deleted_at !== null, true)

  const txns = txnCats(db)
  check('引用旧二级的交易改指到目标', txns.find((t) => t.id === 't1').category_id, 'cat_exp_new')
  check('引用旧一级的交易改指到目标', txns.find((t) => t.id === 't2').category_id, 'cat_exp_new')
}

console.log('=== 场景 4：老库里根本没有对账分类 ===')

{
  const { fake, db } = makeFakePlus({ userVersion: 3 })
  insertCat(db, { id: 'cat_food', name: '餐饮', type: 'expense' })

  const mod = await loadRealDb(fake)
  await mod.openDb()

  const cats = allCats(db)
  const exp = cats.find((c) => c.name === '对账支出' && c.type === 'expense')
  const inc = cats.find((c) => c.name === '对账收入' && c.type === 'income')
  check('自动建出 expense 一级「对账支出」', !!exp, true)
  check('自动建出 income 一级「对账收入」', !!inc, true)
  check('「对账支出」是一级', exp ? exp.parent_id : 'x', null)
  check('「对账收入」是一级', inc ? inc.parent_id : 'x', null)
  check('「餐饮」不受影响', cats.some((c) => c.id === 'cat_food' && c.deleted_at === null), true)
}

console.log('=== 场景 5：迁移必须用底层 call()，不能走 query()/execute() ===')

{
  const { fake, log } = makeFakePlus({ userVersion: 3 })
  const mod = await loadRealDb(fake)

  const result = await Promise.race([
    mod.openDb().then(() => 'OPENED').catch((e) => 'ERROR:' + e.message),
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 5000))
  ])
  check('开库没有死锁', result, 'OPENED')

  // 迁移 v4 的 SQL 必须以 select:/exec: 出现在日志里（= 走了底层的 call）
  const v4selects = log.filter((l) => l.startsWith('select:') && l.includes('FROM category'))
  check('迁移里用了底层 select', v4selects.length > 0, true)
  const v4execs = log.filter(
    (l) => l.startsWith('exec:') &&
      (l.includes('UPDATE category') || l.includes('UPDATE txn') || l.includes('INSERT INTO category'))
  )
  check('迁移里用了底层 exec', v4execs.length > 0, true)

  // 版本号被写回 4
  check('版本被写回', log.some((l) => l.indexOf('exec:PRAGMA user_version') === 0), true)
  const uv = log.filter((l) => l === 'exec:PRAGMA user_version = 4')
  check('写的是 4', uv.length > 0, true)
}

console.log('=== 场景 6：已是 v4 时不再重跑 ===')

{
  const { fake, log } = makeFakePlus({ userVersion: 4 })
  const mod = await loadRealDb(fake)

  const result = await Promise.race([
    mod.openDb().then(() => 'OPENED').catch((e) => 'ERROR:' + e.message),
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 5000))
  ])
  check('v4 时能开库', result, 'OPENED')
  check('不再跑 v4 的查询', log.some((l) => l.startsWith('select:') && l.includes('FROM category')), false)
  check('不再跑 v4 的写入', log.some((l) => l.startsWith('exec:') && l.includes('UPDATE category')), false)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
