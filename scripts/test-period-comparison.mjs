/**
 * 同比 / 环比的真实取数窗口测试
 *
 *   node scripts/test-period-comparison.mjs
 *
 * ★ 本轮要求 ★
 *   「对比的日期应该是所选范围内第一笔交易日期-最后一笔交易日期」。
 *   即使用户选了一个整月，真正有账的日子只有 11/05~11/12，
 *   同比也应该是去年 11/05~11/12，而不是去年整月；
 *   环比则按上一周期规则换算（整月选择 -> 上月 10/05~10/12）。
 *
 * ★ 为什么用真 SQLite ★
 *   这条需求不是纯日期算术，而是「先查 MIN/MAX 再构造窗口」。
 *   桩测不出 SQL 条件写错（比如忘了排除 exclude_from_stats），
 *   所以用 node:sqlite 造真库直接跑 getPeriodComparison。
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

/* --------------------------------------------------- 最小真库 + 假 plus */

function makeFakePlus() {
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
    month_key TEXT NOT NULL, year_key TEXT NOT NULL, tz_offset INTEGER NOT NULL DEFAULT 480,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
    exclude_from_stats INTEGER NOT NULL DEFAULT 0
  )`)
  db.exec(`CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT)`)
  db.exec(`CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT)`)
  db.exec('PRAGMA user_version = 25')

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

function insertCategory(db, { id = 'c_food', name = '餐饮', type = 'expense' } = {}) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden,
      created_at, updated_at, deleted_at)
     VALUES (?,NULL,?,?,'1F35C','#FF8F1F',0,0,?,?,NULL)`
  ).run(id, name, type, now, now)
}

function insertTxn(db, { id, day, amount, excludeFromStats = 0, categoryId = 'c_food' }) {
  const ts = new Date(`${day}T12:00:00`).getTime()
  db.prepare(
    `INSERT INTO txn (id, type, amount_cents, account_id, to_account_id, category_id, note,
      occurred_at, occurred_day, month_key, year_key, tz_offset, created_at, updated_at,
      deleted_at, exclude_from_stats)
     VALUES (?, 'expense', ?, 'acc1', NULL, ?, '', ?, ?, ?, ?, 480, ?, ?, NULL, ?)`
  ).run(
    id, amount, categoryId, ts, day, day.slice(0, 7), day.slice(0, 4),
    ts, ts, excludeFromStats ? 1 : 0
  )
}

/* ------------------------------------------------------------- 用例 */

const { fake, db } = makeFakePlus()
insertCategory(db)
insertTxn(db, { id: 'cur1', day: '2026-11-05', amount: 10000 })
insertTxn(db, { id: 'cur2', day: '2026-11-12', amount: 20000 })

/*
 * 这两笔在所选整月里，但「不计收支」，不能把对比窗口撑到 11/01~11/30。
 * 它们正是验证「首末交易要按参与统计的流水取」的关键。
 */
insertTxn(db, { id: 'ex1', day: '2026-11-01', amount: 99900, excludeFromStats: 1 })
insertTxn(db, { id: 'ex2', day: '2026-11-30', amount: 88800, excludeFromStats: 1 })

// 去年同期：只放 11/05、11/12 两笔，金额 50 / 100
insertTxn(db, { id: 'yoy1', day: '2025-11-05', amount: 5000 })
insertTxn(db, { id: 'yoy2', day: '2025-11-12', amount: 10000 })
// 上月同期：10/05、10/12，金额 60 / 120
insertTxn(db, { id: 'mom1', day: '2026-10-05', amount: 6000 })
insertTxn(db, { id: 'mom2', day: '2026-10-12', amount: 12000 })

globalThis.plus = fake
const stats = await import('../api/stats.js?t=' + Math.random())

const range = { startDay: '2026-11-01', endDay: '2026-11-30', monthKey: '2026-11' }

console.log('=== 同比：去年同期，用区间内首末交易日 ===')
{
  const r = await stats.getPeriodComparison(range, { today: '2026-11-19' })
  check('当前窗口起点 = 第一笔交易', r.curStart, '2026-11-05')
  check('当前窗口终点 = 最后一笔交易', r.curEnd, '2026-11-12')
  check('同比窗口起点', r.prevStart, '2025-11-05')
  check('同比窗口终点', r.prevEnd, '2025-11-12')
  check('同比标记为按年', r.align, 'year')
  check('本期支出只算两笔有收支的', r.current.expense, 30000)
  check('去年同期支出', r.previous.expense, 15000)
  check('本期笔数', r.current.count, 2)
}

console.log('=== 环比：上一周期，用区间内首末交易日 ===')
{
  const r = await stats.getPeriodComparison(range, { today: '2026-11-19', mode: 'mom' })
  check('环比窗口起点 = 上月同日', r.prevStart, '2026-10-05')
  check('环比窗口终点 = 上月同日', r.prevEnd, '2026-10-12')
  check('环比标记为按月', r.align, 'month')
  check('上期支出', r.previous.expense, 18000)
}

console.log('=== 范围内没有可统计流水 ===')
{
  const empty = await stats.getPeriodComparison(
    { startDay: '2026-09-01', endDay: '2026-09-30', monthKey: '2026-09' },
    { today: '2026-11-19' }
  )
  check('没有交易时不给对比', empty, null)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
