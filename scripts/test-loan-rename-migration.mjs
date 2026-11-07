/**
 * 迁移 v16（借入借出分类改名）的测试
 *
 *   node scripts/test-loan-rename-migration.mjs
 *
 * ★ 用户要求 ★
 *   「全局『借出收回』字样全部修改为『借款收回』，
 *    『借入归还』字样修改为『借款归还』，包括分类名和 tab 栏一类的东西」。
 *
 * ★ 为什么必须迁移 ★
 *   改代码字符串只影响新装的库（seedDefaultCategories），
 *   老库里那两行已经存成旧名字了。
 *
 * ★ 为什么必须保留 id ★
 *   历史流水的 txn.category_id 指着它们。
 *   删了重建会换 id -> 流水变成悬空引用 ->
 *   页面按分类名统计「当前借出 / 当前借入」直接算不出。
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

function makeFakePlus(userVersion = 15) {
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
    `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden,
      created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?,?,?,0,?,?,?)`
  ).run(id, parent_id, name, type, icon, color, sort, now, now, deleted_at)
}

function insertTxn(db, { id, type, amount, category_id }) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO txn (id, type, amount_cents, account_id, to_account_id, category_id, note,
      occurred_at, occurred_day, month_key, year_key, tz_offset, created_at, updated_at, deleted_at)
     VALUES (?,?,?,'acc1',NULL,?,'',?,'2026-11-01','2026-11','2026',480,?,?,NULL)`
  ).run(id, type, amount, category_id, now, now, now)
}

const alive = (db, name, type) => db.prepare(
  'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ?'
).all(name, type)

const catNameOf = (db, id) => {
  const r = db.prepare('SELECT name FROM category WHERE id = ?').get(id)
  return r ? r.name : null
}

console.log('=== 场景 1：老库（旧名）-> 改名，保留 id ===')

{
  const { fake, db } = makeFakePlus(15)

  // 模拟 v15 留下的结构：系统预置分类 + 旧名的两个反向分类
  insertCat(db, { id: 'g_exp', name: '系统预置分类', type: 'expense', sort: 999 })
  insertCat(db, { id: 'g_inc', name: '系统预置分类', type: 'income', sort: 999 })
  insertCat(db, { id: 'c_lend_out', parent_id: 'g_exp', name: '借出', type: 'expense', sort: 900 })
  insertCat(db, { id: 'c_borrow_back', parent_id: 'g_exp', name: '借入归还', type: 'expense', sort: 901 })
  insertCat(db, { id: 'c_borrow_in', parent_id: 'g_inc', name: '借入', type: 'income', sort: 900 })
  insertCat(db, { id: 'c_lend_back', parent_id: 'g_inc', name: '借出收回', type: 'income', sort: 901 })

  // 历史流水挂在旧名分类上
  insertTxn(db, { id: 't1', type: 'expense', amount: 30000, category_id: 'c_borrow_back' })
  insertTxn(db, { id: 't2', type: 'income', amount: 20000, category_id: 'c_lend_back' })

  globalThis.plus = fake
  const mod = await import('../api/db/index.js?t=' + Math.random())
  const opened = await Promise.race([
    mod.openDb().then(() => 'OPENED').catch((e) => 'ERROR:' + e.message),
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 5000))
  ])
  check('迁移没有死锁', opened, 'OPENED')

  // ---- 新名字出现 ----
  check('「借款归还」在 expense 下', alive(db, '借款归还', 'expense').length, 1)
  check('「借款收回」在 income 下', alive(db, '借款收回', 'income').length, 1)

  // ---- 旧名字消失 ----
  check('「借入归还」不再存在', alive(db, '借入归还', 'expense').length, 0)
  check('「借出收回」不再存在', alive(db, '借出收回', 'income').length, 0)

  // ---- ★ id 保留（历史引用不断）★ ----
  check('「借款归还」保留了原 id', catNameOf(db, 'c_borrow_back'), '借款归还')
  check('「借款收回」保留了原 id', catNameOf(db, 'c_lend_back'), '借款收回')

  // ---- 历史流水仍指向有效分类 ----
  const dangling = db.prepare(
    `SELECT COUNT(*) AS c FROM txn t
     WHERE t.deleted_at IS NULL AND t.category_id IS NOT NULL
       AND t.category_id NOT IN (SELECT id FROM category WHERE deleted_at IS NULL)`
  ).get().c
  check('没有交易指向已删除的分类', dangling, 0)

  const t1 = db.prepare('SELECT category_id FROM txn WHERE id = ?').get('t1')
  check('历史流水 t1 的 category_id 没变', t1.category_id, 'c_borrow_back')

  // ---- 其它分类没被动 ----
  check('「借出」没被改名', catNameOf(db, 'c_lend_out'), '借出')
  check('「借入」没被改名', catNameOf(db, 'c_borrow_in'), '借入')
}

console.log('=== 场景 2：幂等 —— 跑第二遍结果一样 ===')

{
  const { fake, db } = makeFakePlus(15)
  insertCat(db, { id: 'g_exp', name: '系统预置分类', type: 'expense', sort: 999 })
  insertCat(db, { id: 'g_inc', name: '系统预置分类', type: 'income', sort: 999 })
  insertCat(db, { id: 'c_borrow_back', parent_id: 'g_exp', name: '借入归还', type: 'expense', sort: 901 })
  insertCat(db, { id: 'c_lend_back', parent_id: 'g_inc', name: '借出收回', type: 'income', sort: 901 })

  globalThis.plus = fake
  const mod1 = await import('../api/db/index.js?t=' + Math.random())
  await mod1.openDb()

  const snapshot = () => db.prepare(
    'SELECT id, parent_id, name, type, deleted_at FROM category ORDER BY id'
  ).all()
  const first = snapshot()
  const firstDeleted = db.prepare(
    'SELECT COUNT(*) AS c FROM category WHERE deleted_at IS NOT NULL'
  ).get().c

  db.exec('PRAGMA user_version = 15')
  const mod2 = await import('../api/db/index.js?t=' + Math.random())
  await mod2.openDb()

  check('第二遍后分类表完全一样', snapshot(), first)
  check(
    '第二遍没有新增软删除记录',
    db.prepare('SELECT COUNT(*) AS c FROM category WHERE deleted_at IS NOT NULL').get().c,
    firstDeleted
  )

  const dup = db.prepare(
    `SELECT name, type, COUNT(*) AS c FROM category
     WHERE deleted_at IS NULL GROUP BY name, type HAVING c > 1`
  ).all()
  check('没有重复的分类', dup.length, 0)
}

console.log('=== 场景 3：新名字已经存在（脏数据）-> 软删旧的，交易改指向 ===')

{
  const { fake, db } = makeFakePlus(15)
  insertCat(db, { id: 'g_inc', name: '系统预置分类', type: 'income', sort: 999 })
  // 两条同名不同 id：一条已经是新名，一条还是旧名
  insertCat(db, { id: 'c_new', parent_id: 'g_inc', name: '借款收回', type: 'income', sort: 901 })
  insertCat(db, { id: 'c_old', parent_id: 'g_inc', name: '借出收回', type: 'income', sort: 902 })
  insertTxn(db, { id: 't1', type: 'income', amount: 20000, category_id: 'c_old' })

  globalThis.plus = fake
  const mod = await import('../api/db/index.js?t=' + Math.random())
  await mod.openDb()

  const aliveNew = alive(db, '借款收回', 'income')
  check('「借款收回」只有一条', aliveNew.length, 1)
  check('留下的那条是新名原有 id', aliveNew[0].id, 'c_new')

  const t1 = db.prepare('SELECT category_id FROM txn WHERE id = ?').get('t1')
  check('旧行的交易改指向新行（不丢统计）', t1.category_id, 'c_new')
}

console.log('=== 场景 4：本来就没有这两个分类 -> 什么都不做 ===')

{
  const { fake, db } = makeFakePlus(15)
  insertCat(db, { id: 'c_food', name: '餐饮食品', type: 'expense' })

  globalThis.plus = fake
  const mod = await import('../api/db/index.js?t=' + Math.random())
  await mod.openDb()

  check('普通分类没被动', catNameOf(db, 'c_food'), '餐饮食品')
  check(
    '没有凭空冒出借款收回',
    alive(db, '借款收回', 'income').length,
    0
  )
}

console.log('=== 场景 5：源码里不能残留旧名字 ===')

{
  const { readFileSync } = await import('fs')
  const { join, dirname, resolve } = await import('path')
  const { fileURLToPath } = await import('url')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

  const FILES = [
    'api/account.js', 'api/category.js', 'api/db/schema.js',
    'pages/loan/manage.vue', 'pages/account/index.vue',
    'utils/categoryIcon.js', 'utils/icons.js'
  ]

  for (const rel of FILES) {
    const code = readFileSync(join(ROOT, rel), 'utf-8')
    check(`${rel} 不含「借出收回」`, code.includes('借出收回'), false)
    check(`${rel} 不含「借入归还」`, code.includes('借入归还'), false)
  }

  // 新名字确实在源码里
  const schema = readFileSync(join(ROOT, 'api/db/schema.js'), 'utf-8')
  check('schema 里有「借款收回」', schema.includes('借款收回'), true)
  check('schema 里有「借款归还」', schema.includes('借款归还'), true)

  /*
   * ★ v19 起管理页不再按「借出 / 借款收回」写 tab ★
   *   页面改成按人员看账（未结清 / 已结清），分类名只出现在
   *   api/loan.js 的常量里和记账面板的分类网格里 ——
   *   所以「新名字确实在用」这条断言改成查 api/loan.js。
   *   要钉的规则没变：旧名（借出收回 / 借入归还）不能复活。
   */
  const loanApi = readFileSync(join(ROOT, 'api/loan.js'), 'utf-8')
  check('api/loan.js 有「借款收回」', loanApi.includes('借款收回'), true)
  check('api/loan.js 有「借款归还」', loanApi.includes('借款归还'), true)

  // 记账面板的分类网格仍会显示这四个名字（来自数据库，不是写死）
  const loanPanel = readFileSync(join(ROOT, 'components/TxnPanel.vue'), 'utf-8')
  check('记账面板引入借入借出判定', loanPanel.includes('isLoanPersonCategory'), true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
