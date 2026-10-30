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
db.exec(`CREATE TABLE txn_tag (
  txn_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (txn_id, tag_id))`)
db.exec(`CREATE TABLE cycle (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  account_id TEXT NOT NULL, to_account_id TEXT, category_id TEXT, note TEXT,
  recurrence TEXT NOT NULL DEFAULT 'monthly', weekday INTEGER, day_of_month INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  last_caught_up_day TEXT)`)
// v9：用户主动「不要」的发生日（建周期选先不记 / 删掉周期流水）
db.exec(`CREATE TABLE cycle_skip (
  cycle_id TEXT NOT NULL, day TEXT NOT NULL, created_at INTEGER,
  PRIMARY KEY (cycle_id, day))`)

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

// 让 openDb 走我们的内存库，并跳过真实迁移路径（表已建好，版本设 9）
db.exec('PRAGMA user_version = 9')

function resetTables() {
  db.exec('DELETE FROM txn')
  db.exec('DELETE FROM cycle')
  db.exec('DELETE FROM cycle_skip')
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

/**
 * ★ 周期详情页「有记录时下方不显示」的回归测试 ★
 * 详情页走 listRecentCycleTxns -> listTransactions({ cycleId })。
 * 必须能按 cycle_id 取回流水（带分类/账户 JOIN 字段）。
 */
async function testListCycleTxns() {
  resetTables()
  const cycle = await loadCycle()
  insertAccount(); insertCategory()
  insertCycle({ id: 'cyc5', recurrence: 'monthly', day_of_month: 15, cursor: '2026-09-01' })
  await cycle.catchUpCycles('2026-11-20') // 补 09-15 / 10-15 / 11-15

  const { listCycleTxns } = await loadCycle()
  const rows = await listCycleTxns('cyc5')
  check('详情页 listCycleTxns 返回 3 笔', rows.length, 3)
  check('详情页流水带分类名', rows[0] && rows[0].category_name, '餐饮')
  check('详情页流水带 cycle_id', rows[0] && rows[0].cycle_id, 'cyc5')
  check('详情页流水带 occurred_day', rows[0] && rows[0].occurred_day, '2026-11-15')

  // 空周期：不报错，返回 []
  const empty = await listCycleTxns('no_such_cycle')
  check('不存在的周期返回空数组', empty.length, 0)
}

/**
 * ★ 用户主动删除某天的周期流水后，再次进 App 不能补回来 ★
 *
 * 这是反馈里的真实 bug：
 *   删掉今天那笔周期账 → 下次启动 catchUpCycles 又补一笔 → 永远删不掉。
 *
 * 根因：补记只判断「这天有没有未删除的流水」，
 * 删掉后查不到就当没记过，于是重建。
 * 修复：删除时把 (cycle_id, day) 写进 cycle_skip，补记时跳过。
 */
async function testSkipAfterUserDelete() {
  resetTables()
  const cycle = await loadCycle()
  insertAccount(); insertCategory()
  insertCycle({ id: 'cyc6', recurrence: 'daily', cursor: '2026-10-01' })

  // 首次补记：10-02 ~ 10-05
  await cycle.catchUpCycles('2026-10-05')
  check('首次补了 4 笔', txnDays('cyc6').length, 4)

  // 用户主动删掉「今天」这笔（走真实删除入口，会写 cycle_skip）
  const row = db.prepare("SELECT id FROM txn WHERE cycle_id='cyc6' AND occurred_day='2026-10-05'").get()
  const txnApi = await import('../api/transaction.js?t=' + Math.random())
  await txnApi.deleteTransaction(row.id)

  // 再次进 App（同一天）
  await cycle.catchUpCycles('2026-10-05')
  check('删掉后当天不再被补回', txnDays('cyc6').includes('2026-10-05'), false)
  check('剩余 3 笔', txnDays('cyc6').length, 3)

  // 再过几天再进 App：中间的日期仍正常补，被删的那天仍不补
  await cycle.catchUpCycles('2026-10-07')
  const days = txnDays('cyc6')
  check('被删的那天永远不补', days.includes('2026-10-05'), false)
  check('后续新日期正常补', days.includes('2026-10-06') && days.includes('2026-10-07'), true)
}

/**
 * ★ 建周期时选「本天先不记」→ 该天不能被自动补 ★
 *
 * 老行为：创建时游标=今天，选「先不记」后没有任何标记；
 * 只要当天符合规则，下次启动就会被补记 —— 等于用户的「先不记」被忽略。
 */
async function testSkipWhenCreatedWithoutRecord() {
  resetTables()
  const cycle = await loadCycle()
  insertAccount(); insertCategory()
  insertCycle({ id: 'cyc7', recurrence: 'daily', cursor: '2026-10-05' })

  // 模拟用户当场选「先不记」：写一条 skip
  await cycle.skipCycleDay('cyc7', '2026-10-05')

  await cycle.catchUpCycles('2026-10-05')
  check('选了先不记的当天不补', txnDays('cyc7').includes('2026-10-05'), false)

  // 第二天起照常补
  await cycle.catchUpCycles('2026-10-06')
  const days = txnDays('cyc7')
  check('次日正常补记', days.includes('2026-10-06'), true)
  check('先不记的当天仍不补', days.includes('2026-10-05'), false)
}

async function main() {
  await testOccurrences()
  await testCatchUpNormal()
  await testCatchUpIdempotent()
  await testCatchUpSkipsDeleted()
  await testCatchUpTransfer()
  await testListCycleTxns()
  await testSkipAfterUserDelete()
  await testSkipWhenCreatedWithoutRecord()

  console.log(`\n=== 周期补记测试结果: ${pass} 通过 / ${fail} 失败 ===`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
