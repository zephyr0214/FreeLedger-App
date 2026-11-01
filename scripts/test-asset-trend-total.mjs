/**
 * 总资产趋势（快照聚合口径）的测试
 *
 *   node scripts/test-asset-trend-total.mjs
 *
 * ★ 用户要求 ★
 *   「资产趋势显示的应该是总资产的趋势，改为『总资产趋势图』，
 *    并核验数据是否为总资产，而非净资产。」
 *
 * ★ 核验的重点 ★
 *   getAssetChangePoints() 以前是 SUM(balance_cents) ——
 *   把负余额（信用卡欠款）也加进去了，那算出来是**净资产**。
 *   而账户页的「总资产」只算正余额。
 *   于是同一屏上：大数字「净资产 5000」、下方「总资产 8000」，
 *   趋势图画的却是 5000 那条线 —— 三处数字对不上。
 *
 *   现在改成只累加正余额，必须与 getAssetOverview().assets 一致。
 *
 * 这里驱动真实的 api/account.js，用 node:sqlite 造真库。
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

function makeFakePlus() {
  const db = new DatabaseSync(':memory:')

  db.exec(`CREATE TABLE account (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'cash',
    icon TEXT, color TEXT,
    initial_balance_cents INTEGER NOT NULL DEFAULT 0,
    balance_cents INTEGER NOT NULL DEFAULT 0,
    include_in_total INTEGER NOT NULL DEFAULT 1,
    credit_limit_cents INTEGER, bill_day INTEGER, repay_day INTEGER, card_tail TEXT,
    sort INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
  )`)
  db.exec(`CREATE TABLE account_snapshot (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, day TEXT NOT NULL,
    balance_cents INTEGER NOT NULL, created_at INTEGER NOT NULL,
    UNIQUE (account_id, day)
  )`)
  db.exec(`CREATE TABLE account_combo_member (
    combo_id TEXT NOT NULL, member_id TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (combo_id, member_id)
  )`)
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
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
  )`)
  db.exec(`CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT)`)
  db.exec(`CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT)`)
  db.exec('PRAGMA user_version = 16')

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

function insertAccount(db, {
  id, balance, include_in_total = 1, archived = 0, deleted_at = null
}) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO account (id, name, type, initial_balance_cents, balance_cents,
      include_in_total, sort, archived, created_at, updated_at, deleted_at)
     VALUES (?, '账户', 'cash', ?, ?, ?, 0, ?, ?, ?, ?)`
  ).run(id, balance, balance, include_in_total, archived, now, now, deleted_at)
}

function insertSnapshot(db, { id, account_id, day, balance }) {
  db.prepare(
    `INSERT INTO account_snapshot (id, account_id, day, balance_cents, created_at)
     VALUES (?,?,?,?,?)`
  ).run(id, account_id, day, balance, Date.now())
}

/** 今天 / N 天前的 day key */
function dayKeyOf(offsetDays) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

console.log('=== 趋势只算正余额（总资产），不抵扣负余额 ===')

{
  const { fake, db } = makeFakePlus()

  // 储蓄卡 +5000，信用卡 -1500
  insertAccount(db, { id: 'a1', balance: 500000 })
  insertAccount(db, { id: 'a2', balance: -150000 })

  // 今天两条快照
  insertSnapshot(db, { id: 's1', account_id: 'a1', day: dayKeyOf(0), balance: 500000 })
  insertSnapshot(db, { id: 's2', account_id: 'a2', day: dayKeyOf(0), balance: -150000 })

  globalThis.plus = fake
  const mod = await import('../api/account.js')

  const points = await mod.getAssetChangePoints(1)
  const today = points[points.length - 1]

  /*
   * ★ 总资产 = 5000（只算正余额）★
   *   如果是净资产口径会是 5000 - 1500 = 3500 —— 那才是 bug。
   */
  check('趋势最后一天是总资产 5000', today ? today.total : null, 500000)
  check('不是净资产 3500', (today ? today.total : null) === 350000, false)

  // 与概览的总资产核对
  const overview = await mod.getAssetOverview()
  check('趋势值 == 概览里的总资产', today ? today.total : 0, overview.assets)
  check('概览里的总资产是 5000', overview.assets, 500000)
  check('概览里的负债是 1500', overview.debt, 150000)
  check('概览里的净资产是 3500', overview.net, 350000)
  // ★ 关键断言：趋势画的是 assets 而不是 net ★
  check(
    '趋势 ≠ 净资产（这次修的就是这个）',
    (today ? today.total : 0) === overview.net,
    false
  )
}

console.log('=== 全是负余额时，总资产趋势是 0（不是负数）===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, { id: 'a1', balance: -300000 })
  insertSnapshot(db, { id: 's1', account_id: 'a1', day: dayKeyOf(0), balance: -300000 })

  globalThis.plus = fake
  const mod = await import('../api/account.js')

  const points = await mod.getAssetChangePoints(1)
  const today = points[points.length - 1]
  check('纯欠款时总资产趋势是 0', today ? today.total : null, 0)

  const overview = await mod.getAssetOverview()
  check('与概览一致（总资产 0）', today ? today.total : 0, overview.assets)
  check('但净资产是 -3000', overview.net, -300000)
}

console.log('=== 排除不计入总资产 / 已归档 / 已删除的账户 ===')

{
  const { fake, db } = makeFakePlus()
  const day = dayKeyOf(0)

  insertAccount(db, { id: 'a1', balance: 100000 })
  insertAccount(db, { id: 'a2', balance: 999900, include_in_total: 0 })
  insertAccount(db, { id: 'a3', balance: 888800, archived: 1 })
  insertAccount(db, { id: 'a4', balance: 777700, deleted_at: Date.now() })

  insertSnapshot(db, { id: 's1', account_id: 'a1', day, balance: 100000 })
  insertSnapshot(db, { id: 's2', account_id: 'a2', day, balance: 999900 })
  insertSnapshot(db, { id: 's3', account_id: 'a3', day, balance: 888800 })
  insertSnapshot(db, { id: 's4', account_id: 'a4', day, balance: 777700 })

  globalThis.plus = fake
  const mod = await import('../api/account.js')

  const points = await mod.getAssetChangePoints(1)
  const today = points[points.length - 1]
  check('只有计入总资产的账户参与', today ? today.total : null, 100000)
}

console.log('=== 多天序列：每天都要是当天总资产 ===')

{
  const { fake, db } = makeFakePlus()

  insertAccount(db, { id: 'a1', balance: 300000 })
  insertAccount(db, { id: 'a2', balance: -100000 })

  // 三天：资产在涨（正余额增长），负债一直存在
  insertSnapshot(db, { id: 's1', account_id: 'a1', day: dayKeyOf(-2), balance: 100000 })
  insertSnapshot(db, { id: 's1b', account_id: 'a2', day: dayKeyOf(-2), balance: -100000 })
  insertSnapshot(db, { id: 's2', account_id: 'a1', day: dayKeyOf(-1), balance: 200000 })
  insertSnapshot(db, { id: 's2b', account_id: 'a2', day: dayKeyOf(-1), balance: -100000 })
  insertSnapshot(db, { id: 's3', account_id: 'a1', day: dayKeyOf(0), balance: 300000 })
  insertSnapshot(db, { id: 's3b', account_id: 'a2', day: dayKeyOf(0), balance: -100000 })

  globalThis.plus = fake
  const mod = await import('../api/account.js')

  const points = await mod.getAssetChangePoints(1)
  const byDay = {}
  for (const p of points) byDay[p.day] = p.total

  check('两天前总资产 1000', byDay[dayKeyOf(-2)], 100000)
  check('昨天总资产 2000', byDay[dayKeyOf(-1)], 200000)
  check('今天总资产 3000', byDay[dayKeyOf(0)], 300000)
}

console.log('=== 页面文案与数据源 ===')

{
  // 页面标题必须是「总资产趋势图」，且用的是 getAssetChangePoints
  const { readFileSync } = await import('fs')
  const { join, dirname, resolve } = await import('path')
  const { fileURLToPath } = await import('url')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const page = readFileSync(join(ROOT, 'pages', 'account', 'index.vue'), 'utf-8')

  check('趋势标题是「总资产趋势图」', page.includes('>总资产趋势图<'), true)
  check('不再叫「资产趋势」', />资产趋势</.test(page), false)
  check('用的是 getAssetChangePoints', /getAssetChangePoints/.test(page), true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
