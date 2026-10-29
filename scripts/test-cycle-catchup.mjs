/**
 * 周期自动补记（catchUpCycles / occurrencesInRange）测试
 *
 *   node scripts/test-cycle-catchup.mjs
 *
 * ★ 用 node:sqlite 造真库 + 假 plus.sqlite 代理 ★
 *   这样 SQL 语义（含 cycle 表、txn.cycle_id）都是真跑的，
 *   只是 `plus.sqlite` 这层是 stub，把调用转给内存 SQLite。
 *
 * 不联网、不碰真机，纯本地逻辑验证：
 *   1) occurrencesInRange 的日期运算（每天/每周跨月/每月 31→2月 clamp）
 *   2) catchUpCycles 的游标幂等、补全部漏掉、不重建已删账、按发生日记账、转账
 *
 * ★ 单共享 DB 说明 ★
 *   db/index.js 是单例（opened 标志），所以所有用例共用同一个 fake DB，
 *   每个用例开始前清空相关表即可，无需重建 plus。
 */

import { DatabaseSync } from 'node:sqlite'

let pass = 0
let fail = 0

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++ }
  else {
    fail++
    console.log(`FAIL  ${name}\n      实际 ${a}\n      期望 ${e}`)
  }
}

const db = new DatabaseSync(':memory:')
const log = []

db.exec(`CREATE TABLE account (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'cash',
  icon TEXT, color TEXT, initial_balance_cents INTEGER NOT NULL DEFAULT 0,
  balance_cents INTEGER NOT NULL DEFAULT 0, include_in_total INTEGER NOT NULL DEFAULT 1,
  credit_limit_cents INTEGER, bill_day INTEGER, repay_day INTEGER, card_tail TEXT,
  sort INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`)
db.exec(`CREATE TABLE account_snapshot (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, day TEXT NOT NULL,
  balance_cents INTEGER NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE (account_id, day))`)
db.exec(`CREATE TABLE category (
  id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL, type TEXT NOT NULL,
  icon TEXT, color TEXT, sort INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`)
db.exec(`CREATE TABLE txn (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  account_id TEXT NOT NULL, to_account_id TEXT, category_id TEXT, note TEXT,
  occurred_at INTEGER NOT NULL, occurred_day TEXT NOT NULL, month_key TEXT NOT NULL,
  year_key TEXT NOT NULL, tz_offset INTEGER NOT NULL DEFAULT 480,
  source TEXT NOT NULL DEFAULT 'manual', raw_text TEXT, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, deleted_at INTEGER, cycle_id TEXT,
  exclude_from_budget INTEGER NOT NULL DEFAULT 0)`)
db.exec(`CREATE TABLE cycle (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  account_id TEXT NOT NULL, to_account_id TEXT, category_id TEXT, note TEXT,
  recurrence TEXT NOT NULL DEFAULT 'monthly', weekday INTEGER, day_of_month INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  last_caught_up_day TEXT)`)

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
      try { success && success(db.prepare(sql).all()) }
      catch (e) { fail && fail({ message: e.message }) }
    },
    executeSql: ({ sql, success, fail }) => {
      try { db.exec(sql); success && success() }
      catch (e) { fail && fail({ message: e.message }) }
    },
    transaction: ({ operation, success, fail }) => {
      try {
        if (operation === 'begin') db.exec('BEGIN')
        else if (operation === 'commit') db.exec('COMMIT')
        else if (operation === 'rollback') db.exec('ROLLBACK')
        success && success()
      } catch (e) { fail && fail({ message: e.message }) }
    }
  },
  __db: db
}
globalThis.plus = fake

// 让 openDb 走我们的内存库，并跳过真实迁移路径（表已建好，版本设 8）
db.exec('PRAGMA user_version = 8')

function resetTables() {
  db.exec('DELETE FROM txn')
  db.exec('DELETE FROM cycle')
  db.exec('DELETE FROM account')
  db.exec('DELETE FROM account_snapshot')
  db.exec('DELETE FROM category')
}

function insertAccount(id = 'acc1') {
  db.prepare(`INSERT INTO account (id, name, type, balance_cents, created_at, updated_at)
    VALUES (?, '测试账户', 'cash', 0, 0, 0)`).run(id)
}
function insertCategory(id = 'cat1') {
  db.prepare(`INSERT INTO category (id, name, type, icon, color, sort, hidden, created_at, updated_at)
    VALUES (?, '餐饮', 'expense', 'food', '#f00', 0, 0, 0, 0)`).run(id)
}
function insertCycle({ id, recurrence, weekday = null, day_of_month = null, type = 'expense', amount = 1000, account_id = 'acc1', category_id = 'cat1', to_account_id = null, cursor = null }) {
  db.prepare(`INSERT INTO cycle
    (id, type, amount_cents, account_id, to_account_id, category_id, note,
     recurrence, weekday, day_of_month, created_at, updated_at, deleted_at, last_caught_up_day)
    VALUES (?,?,?,?,?,?,?,?,?,?,0,0,NULL,?)`).run(
    id, type, amount, account_id, to_account_id, category_id, '', recurrence, weekday, day_of_month, cursor
  )
}
function txnDays(cycleId) {
  const rows = db.prepare('SELECT occurred_day FROM txn WHERE cycle_id = ? AND deleted_at IS NULL ORDER BY occurred_day').all(cycleId)
  return rows.map((r) => r.occurred_day)
}
function cursorOf(cycleId) {
  return db.prepare('SELECT last_caught_up_day FROM cycle WHERE id=?').get(cycleId).last_caught_up_day
}

async function loadCycle() {
  // 清缓存，确保拿到最新模块（db 单例共享，但 cycle.js 顶层逻辑无副作用）
  return import('../api/cycle.js?t=' + Math.random())
}

/* ------------------------------------------------ occurrencesInRange 纯函数测试 */

async function testOccurrences() {
  const { occurrencesInRange } = await loadCycle()

  check('daily 10天',
    occurrencesInRange({ recurrence: 'daily' }, '2026-10-01', '2026-10-10').length, 10)

  check('weekly 周三',
    occurrencesInRange({ recurrence: 'weekly', weekday: 3 }, '2026-10-01', '2026-10-31'),
    ['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28'])

  check('weekly 周一 跨月',
    occurrencesInRange({ recurrence: 'weekly', weekday: 1 }, '2026-10-30', '2026-11-03'),
    ['2026-11-02'])

  check('monthly 15号',
    occurrencesInRange({ recurrence: 'monthly', day_of_month: 15 }, '2026-10-01', '2026-11-30'),
    ['2026-10-15', '2026-11-15'])

  check('monthly 31号 2月clamp到月末',
    occurrencesInRange({ recurrence: 'monthly', day_of_month: 31 }, '2026-01-01', '2026-03-31'),
    ['2026-01-31', '2026-02-28', '2026-03-31'])
}

/* ------------------------------------------------ catchUpCycles 集成测试 */

async function testCatchUpNormal() {
  resetTables()
  const cycle = await loadCycle()
  insertAccount(); insertCategory()
  insertCycle({ id: 'cyc1', recurrence: 'monthly', day_of_month: 15, cursor: '2026-10-01' })

  const res = await cycle.catchUpCycles('2026-12-20')
  check('catchUp 补 3 笔', txnDays('cyc1'), ['2026-10-15', '2026-11-15', '2026-12-15'])
  check('catchUp 返回数', res[0] && res[0].added, 3)
  check('游标推进到今天', cursorOf('cyc1'), '2026-12-20')
}

async function testCatchUpIdempotent() {
  resetTables()
  const cycle = await loadCycle()
  insertAccount(); insertCategory()
  insertCycle({ id: 'cyc2', recurrence: 'daily', cursor: '2026-10-01' })

  await cycle.catchUpCycles('2026-10-05')
  check('第一次补 4 笔', txnDays('cyc2').length, 4)
  await cycle.catchUpCycles('2026-10-05')
  check('重复跑不追加', txnDays('cyc2').length, 4)
}

async function testCatchUpSkipsDeleted() {
  resetTables()
  const cycle = await loadCycle()
  insertAccount(); insertCategory()
  insertCycle({ id: 'cyc3', recurrence: 'daily', cursor: '2026-10-01' })

  await cycle.catchUpCycles('2026-10-05')
  db.prepare("UPDATE txn SET deleted_at = 1 WHERE cycle_id='cyc3' AND occurred_day='2026-10-03'").run()
  await cycle.catchUpCycles('2026-10-10')

  const days = txnDays('cyc3')
  check('已删的账不重建', days.includes('2026-10-03'), false)
  check('后续日期正常补', days.includes('2026-10-06'), true)
}

async function testCatchUpTransfer() {
  resetTables()
  const cycle = await loadCycle()
  insertAccount('from'); insertAccount('to'); insertCategory()
  insertCycle({
    id: 'cyc4', recurrence: 'weekly', weekday: 1, type: 'transfer',
    amount: 5000, account_id: 'from', to_account_id: 'to', category_id: null, cursor: '2026-10-01'
  })

  await cycle.catchUpCycles('2026-10-20')
  check('转账周期补 3 笔', txnDays('cyc4'), ['2026-10-05', '2026-10-12', '2026-10-19'])
  const t = db.prepare("SELECT type, account_id, to_account_id, amount_cents FROM txn WHERE cycle_id='cyc4' LIMIT 1").get()
  check('转账字段正确', { type: t.type, from: t.account_id, to: t.to_account_id, amt: t.amount_cents },
    { type: 'transfer', from: 'from', to: 'to', amt: 5000 })
}

async function main() {
  await testOccurrences()
  await testCatchUpNormal()
  await testCatchUpIdempotent()
  await testCatchUpSkipsDeleted()
  await testCatchUpTransfer()

  console.log(`\n=== 周期补记测试结果: ${pass} 通过 / ${fail} 失败 ===`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
