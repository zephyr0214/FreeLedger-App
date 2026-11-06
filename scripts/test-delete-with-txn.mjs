/**
 * 「有交易也能删」—— 删账户 / 删分类 的行为测试
 *
 *   node scripts/test-delete-with-txn.mjs
 *
 * 用户要求：
 *   3. 删除账户时就算账户下还有交易，也应该可以删除，交易历史调整为无账户
 *   4. 删除分类时就算分类下还有交易，也应该可以删除，交易历史调整为无分类
 *
 * ★ 这个测试驱动真实的 api/account.js 和 api/category.js ★
 *   用 node:sqlite 造一个真的 SQLite 库，让假的 plus.sqlite 代理到它，
 *   这样 NOT NULL 约束、软删除、LEFT JOIN 这些都是真的跑的。
 *   （复刻一份逻辑的话，测不出「account_id 置 NULL 会撞 NOT NULL」这种问题。）
 */

import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_VERSION } from '../api/db/schema.js'

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

/** 造一个假的 plus.sqlite，后端是 node:sqlite 的真库 */
function makeFakePlus() {
  const db = new DatabaseSync(':memory:')
  const log = []

  // ★ 建表必须和 api/db/schema.js 的 SCHEMA_V1 完全一致 ★
  //   特别是 account_id TEXT NOT NULL —— 这是本次改动的关键约束。
  db.exec(`CREATE TABLE account (
    id                    TEXT PRIMARY KEY,
    name                  TEXT    NOT NULL,
    type                  TEXT    NOT NULL DEFAULT 'cash',
    icon                  TEXT,
    color                 TEXT,
    initial_balance_cents INTEGER NOT NULL DEFAULT 0,
    balance_cents         INTEGER NOT NULL DEFAULT 0,
    include_in_total      INTEGER NOT NULL DEFAULT 1,
    credit_limit_cents    INTEGER,
    bill_day              INTEGER,
    repay_day             INTEGER,
    card_tail             TEXT,
    sort                  INTEGER NOT NULL DEFAULT 0,
    archived              INTEGER NOT NULL DEFAULT 0,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    deleted_at            INTEGER
  )`)
  db.exec(`CREATE TABLE account_snapshot (
    id            TEXT PRIMARY KEY,
    account_id    TEXT    NOT NULL,
    day           TEXT    NOT NULL,
    balance_cents INTEGER NOT NULL,
    created_at    INTEGER NOT NULL,
    UNIQUE (account_id, day)
  )`)
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
  db.exec(`CREATE TABLE setting (
    key   TEXT PRIMARY KEY,
    value TEXT
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
  db.exec(`CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT)`)
  db.exec(`CREATE TABLE tag (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, sort INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`)
  db.exec(`CREATE TABLE txn_tag (txn_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (txn_id, tag_id))`)
  /*
   * ★ 组合账户的成员表（v11 起）★
   *   deleteAccount() 会清理 account_combo_member（删真实账户要把它从
   *   所有组合里摘掉，否则组合会指向一个「幽灵账户」）。
   *   这个测试库里的表必须齐全，否则删除会直接报
   *   「no such table: account_combo_member」—— 那不是业务 bug，
   *   是测试库少了表。
   */
  db.exec(`CREATE TABLE account_combo_member (
    combo_id TEXT NOT NULL, member_id TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (combo_id, member_id)
  )`)

  // 已经是最新版本，跳过所有迁移
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)

  const fake = {
    sqlite: {
      openDatabase: ({ success }) => { log.push('open'); success && success() },
      closeDatabase: ({ success }) => { log.push('close'); success && success() },

      selectSql: ({ sql, success, fail }) => {
        if (sql.indexOf('PRAGMA user_version') !== -1) {
          const rows = db.prepare('PRAGMA user_version').all()
          success && success(rows.map((r) => ({ user_version: r.user_version })))
          return
        }
        log.push('select:' + sql.slice(0, 60))
        try {
          success && success(db.prepare(sql).all())
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
        try {
          if (operation === 'begin') db.exec('BEGIN')
          else if (operation === 'commit') db.exec('COMMIT')
          else if (operation === 'rollback') db.exec('ROLLBACK')
          success && success()
        } catch (e) {
          fail && fail({ message: e.message })
        }
      }
    }
  }
  return { fake, log, db }
}

/** 装上假的 plus，导入真实模块（每次全新实例） */
async function loadReal(fake) {
  globalThis.plus = fake
  const stamp = Math.random()
  const accountMod = await import('../api/account.js?t=' + stamp)
  const categoryMod = await import('../api/category.js?t=' + stamp)
  const dbMod = await import('../api/db/index.js?t=' + stamp)
  await dbMod.openDb()
  return { accountMod, categoryMod, dbMod }
}

/* ------------------------------------------------------------ 数据准备 */

function insertAccount(db, { id, name, initial = 0, balance = 0, type = 'cash' }) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO account (id, name, type, initial_balance_cents, balance_cents, include_in_total,
      sort, archived, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?,1,0,0,?,?,NULL)`
  ).run(id, name, type, initial, balance, now, now)
}

function insertCategory(db, { id, parent_id = null, name, type = 'expense' }) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,'more','#969799',0,0,?,?,NULL)`
  ).run(id, parent_id, name, type, now, now)
}

function insertTxn(db, { id, type = 'expense', amount = 100, account_id, to_account_id = null, category_id = null }) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO txn (id, type, amount_cents, account_id, to_account_id, category_id, note,
      occurred_at, occurred_day, month_key, year_key, tz_offset,
      source, raw_text, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?,?,'n',?,'2026-10-27','2026-10','2026',480,'manual',NULL,?,?,NULL)`
  ).run(id, type, amount, account_id, to_account_id, category_id, now, now, now)
}

function getTxn(db, id) {
  return db.prepare('SELECT id, type, account_id, to_account_id, category_id, deleted_at FROM txn WHERE id = ?').get(id)
}

function getAccount(db, id) {
  return db.prepare('SELECT id, name, balance_cents, deleted_at FROM account WHERE id = ?').get(id)
}

function getCategory(db, id) {
  return db.prepare('SELECT id, parent_id, name, deleted_at FROM category WHERE id = ?').get(id)
}

console.log('=== 场景 1：账户有交易也能删 ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, { id: 'acc1', name: '微信', initial: 100000, balance: 100000 })
  insertCategory(db, { id: 'cat1', name: '餐饮食品' })
  insertTxn(db, { id: 't1', account_id: 'acc1', category_id: 'cat1', amount: 3000 })

  const { accountMod } = await loadReal(fake)

  // ★ 以前这里会抛「该账户下还有 1 笔交易，不能删除」 ★
  let threw = null
  try {
    await accountMod.deleteAccount('acc1')
  } catch (e) {
    threw = e.message
  }
  check('有交易也能删（不抛错）', threw, null)

  // 账户被软删除
  const acc = getAccount(db, 'acc1')
  check('账户被软删除', acc.deleted_at !== null, true)

  // ★ 交易本身不删 ★
  const t1 = getTxn(db, 't1')
  check('交易还在（没被删）', t1 !== undefined, true)
  check('交易的 deleted_at 还是空的', t1 ? t1.deleted_at : 'x', null)

  // ★ 交易变成「无账户」 ★
  //   account_id 置空字符串（NOT NULL 约束，置 NULL 会直接报错）
  check('交易的 account_id 变成空', t1 ? t1.account_id : 'x', '')

  // ★ 不违反 NOT NULL 约束 ★
  //   能写进去就说明没撞约束（真库会直接抛错）
  let notNullViolated = false
  try {
    db.prepare(`INSERT INTO txn (id, type, amount_cents, account_id, occurred_at, occurred_day,
      month_key, year_key, created_at, updated_at) VALUES ('tnull','expense',1,NULL,0,'d','m','y',0,0)`).run()
  } catch (e) {
    notNullViolated = true
  }
  check('account_id 确实是 NOT NULL（所以不能用 NULL）', notNullViolated, true)
}

console.log('=== 场景 2：删账户后交易显示成「无账户」 ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, { id: 'acc1', name: '微信', initial: 100000, balance: 100000 })
  insertCategory(db, { id: 'cat1', name: '餐饮食品' })
  insertTxn(db, { id: 't1', account_id: 'acc1', category_id: 'cat1' })

  const { accountMod, dbMod } = await loadReal(fake)
  await accountMod.deleteAccount('acc1')

  // ★ LEFT JOIN 查不到账户 -> account_name 为 NULL ★
  //   UI 靠 `txn.account_name || '无账户'` 兜底
  const rows = await dbMod.query(
    `SELECT t.id, t.account_id, a.name AS account_name
     FROM txn t LEFT JOIN account a ON a.id = t.account_id WHERE t.id = ?`,
    ['t1']
  )
  check('JOIN 不到账户', rows[0].account_name === null || rows[0].account_name === undefined, true)
  check('account_id 是空字符串', rows[0].account_id, '')
  // UI 的兜底逻辑：'' 和 NULL 都是 falsy，|| 都能兜住
  check("UI 兜底 '无账户'", (rows[0].account_name || '无账户'), '无账户')
}

console.log('=== 场景 3：转账 —— 被删的是转出方 ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, { id: 'acc1', name: '微信', initial: 100000, balance: 100000 })
  insertAccount(db, { id: 'acc2', name: '支付宝', initial: 0, balance: 0 })
  // acc1 转账 5000 给 acc2
  insertTxn(db, { id: 't1', type: 'transfer', amount: 5000, account_id: 'acc1', to_account_id: 'acc2' })

  const { accountMod } = await loadReal(fake)
  await accountMod.deleteAccount('acc1')

  // ★ 被删的是「转出方」★
  //   转出方的 account_id 置空，但 to_account_id 还是 acc2，
  //   所以 acc2 依然是这笔转账的转入方 —— 它的余额不变（还是 +5000）。
  const t1 = getTxn(db, 't1')
  check('转账的 account_id 置空', t1.account_id, '')
  check('转账的 to_account_id 保留（acc2 还在）', t1.to_account_id, 'acc2')
  check('转账本身还在', t1.deleted_at, null)

  const acc2 = getAccount(db, 'acc2')
  check('转入方余额不变（仍是 +5000）', Number(acc2.balance_cents), 5000)
}

console.log('=== 场景 3b：转账 —— 被删的是转入方 ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, { id: 'acc1', name: '微信', initial: 100000, balance: 100000 })
  insertAccount(db, { id: 'acc2', name: '支付宝', initial: 0, balance: 0 })
  // acc1 转账 5000 给 acc2
  insertTxn(db, { id: 't1', type: 'transfer', amount: 5000, account_id: 'acc1', to_account_id: 'acc2' })

  const { accountMod } = await loadReal(fake)
  // 删的是转入方 acc2
  await accountMod.deleteAccount('acc2')

  const t1 = getTxn(db, 't1')
  check('转账的 to_account_id 置 NULL', t1.to_account_id, null)
  check('转账的 account_id 保留（acc1 还在）', t1.account_id, 'acc1')
  check('转账本身还在', t1.deleted_at, null)

  // ★ acc1 仍然在转出（account_id 还在，type 还是 transfer）★
  //   所以 acc1 的余额还是 100000 - 5000 = 95000
  const acc1 = getAccount(db, 'acc1')
  check('转出方余额重算正确（仍在转出）', Number(acc1.balance_cents), 95000)
}

console.log('=== 场景 4：删默认账户要清掉默认账户设置 ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, { id: 'acc1', name: '微信', initial: 100000, balance: 100000 })
  insertAccount(db, { id: 'acc2', name: '支付宝', initial: 0, balance: 0 })
  db.prepare('INSERT INTO setting (key, value) VALUES (?,?)').run('defaultAccountId', JSON.stringify('acc1'))
  insertTxn(db, { id: 't1', account_id: 'acc1' })

  const { accountMod } = await loadReal(fake)
  await accountMod.deleteAccount('acc1')

  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get('defaultAccountId')
  const val = row ? JSON.parse(row.value) : ''
  // ★ defaultAccountId 指向已删除的账户的话，新交易会挂到空账户上 ★
  check('默认账户设置被清空', val, '')
}

console.log('=== 场景 5：分类有交易也能删 ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, { id: 'acc1', name: '微信' })
  insertCategory(db, { id: 'cat1', name: '餐饮食品' })
  insertTxn(db, { id: 't1', account_id: 'acc1', category_id: 'cat1' })

  const { categoryMod } = await loadReal(fake)

  let threw = null
  try {
    await categoryMod.deleteCategory('cat1')
  } catch (e) {
    threw = e.message
  }
  check('有交易也能删（不抛错）', threw, null)

  const cat = getCategory(db, 'cat1')
  check('分类被软删除', cat.deleted_at !== null, true)

  // ★ 交易本身不删，category_id 置 NULL ★
  const t1 = getTxn(db, 't1')
  check('交易还在（没被删）', t1 !== undefined, true)
  check('交易的 deleted_at 还是空的', t1 ? t1.deleted_at : 'x', null)
  check('交易的 category_id 变成 NULL', t1 ? t1.category_id : 'x', null)
}

console.log('=== 场景 6：删一级分类连带删二级 ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, { id: 'acc1', name: '微信' })
  insertCategory(db, { id: 'cat1', name: '餐饮食品' })
  insertCategory(db, { id: 'cat1a', parent_id: 'cat1', name: '日常三餐' })
  insertCategory(db, { id: 'cat1b', parent_id: 'cat1', name: '奶茶饮料' })
  insertTxn(db, { id: 't1', account_id: 'acc1', category_id: 'cat1a' })
  insertTxn(db, { id: 't2', account_id: 'acc1', category_id: 'cat1b' })
  insertTxn(db, { id: 't3', account_id: 'acc1', category_id: 'cat1' })

  const { categoryMod } = await loadReal(fake)
  await categoryMod.deleteCategory('cat1')

  check('一级被软删除', getCategory(db, 'cat1').deleted_at !== null, true)
  check('二级「日常三餐」被连带软删除', getCategory(db, 'cat1a').deleted_at !== null, true)
  check('二级「奶茶饮料」被连带软删除', getCategory(db, 'cat1b').deleted_at !== null, true)

  check('二级下的交易变成无分类', getTxn(db, 't1').category_id, null)
  check('另一个二级的交易也变成无分类', getTxn(db, 't2').category_id, null)
  check('一级自己的交易也变成无分类', getTxn(db, 't3').category_id, null)
  check('交易本身没被删', getTxn(db, 't1').deleted_at, null)
}

console.log('=== 场景 7：固定分类（对账支出/对账收入）仍然不能删 ===')

{
  const { fake, db } = makeFakePlus()
  insertCategory(db, { id: 'catR', name: '对账支出', type: 'expense' })
  insertCategory(db, { id: 'catI', name: '对账收入', type: 'income' })

  const { categoryMod } = await loadReal(fake)

  let threwE = null
  try { await categoryMod.deleteCategory('catR') } catch (e) { threwE = e.message }
  check('「对账支出」不能删', threwE !== null, true)
  check('「对账支出」还在', getCategory(db, 'catR').deleted_at, null)

  let threwI = null
  try { await categoryMod.deleteCategory('catI') } catch (e) { threwI = e.message }
  check('「对账收入」不能删', threwI !== null, true)
  check('「对账收入」还在', getCategory(db, 'catI').deleted_at, null)
}

console.log('=== 场景 8：普通分类可以正常删（没交易时也一样）===')

{
  const { fake, db } = makeFakePlus()
  insertCategory(db, { id: 'cat1', name: '临时分类' })

  const { categoryMod } = await loadReal(fake)
  let threw = null
  try { await categoryMod.deleteCategory('cat1') } catch (e) { threw = e.message }
  check('没交易的分类也能删', threw, null)
  check('分类被软删除', getCategory(db, 'cat1').deleted_at !== null, true)
}

console.log('=== 场景 9：删分类时它的「分类预算」也要删掉 ===')

{
  const { fake, db } = makeFakePlus()
  insertCategory(db, { id: 'cat1', name: '餐饮食品' })
  insertCategory(db, { id: 'cat1a', parent_id: 'cat1', name: '日常三餐' })
  // 给一级和二级各挂一条分类预算
  const now = Date.now()
  db.prepare(
    `INSERT INTO budget (id, scope, category_id, period, amount_cents, start_month, rollover, created_at, updated_at)
     VALUES ('b1','category','cat1','month',10000,'2026-10',0,?,?)`
  ).run(now, now)
  db.prepare(
    `INSERT INTO budget (id, scope, category_id, period, amount_cents, start_month, rollover, created_at, updated_at)
     VALUES ('b2','category','cat1a','month',5000,'2026-10',0,?,?)`
  ).run(now, now)
  // 顺便放一条「总预算」，它不依赖分类，不该被动到
  db.prepare(
    `INSERT INTO budget (id, scope, category_id, period, amount_cents, start_month, rollover, created_at, updated_at)
     VALUES ('b3','total',NULL,'month',30000,'2026-10',0,?,?)`
  ).run(now, now)

  const { categoryMod } = await loadReal(fake)
  await categoryMod.deleteCategory('cat1')

  const ids = db.prepare('SELECT id FROM budget ORDER BY id').all().map((r) => r.id)
  check('一级的分类预算被删', ids.includes('b1'), false)
  check('二级的分类预算被删', ids.includes('b2'), false)
  check('总预算保留', ids.includes('b3'), true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
