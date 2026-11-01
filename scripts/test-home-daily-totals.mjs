/**
 * 首页「最近收支」分组合计的测试
 *
 *   node scripts/test-home-daily-totals.mjs
 *
 * ★ 用户反馈的 bug ★
 *   首页按日期分组显示最近几笔，每组右边写着「支出 X / 收入 Y」。
 *   那个数以前是**把显示出来的那几条**累加出来的 ——
 *   列表只显示最近 5 条，于是：
 *     某天记了 10 笔，列表里只露出 2 笔，
 *     那一组右边就只写这 2 笔的合计，和当天的真实收支对不上，
 *     看着像少记了钱。
 *   正确行为：列表显示最近 5 条，但合计必须是**当日全部流水**的合计。
 *
 * ★ 这里测两层 ★
 *   1. api/transaction.js 的 getAllDailyTotals()：按天聚合全部流水
 *   2. stores/transaction.js 的 allDailyTotals：首页用的就是这个
 *   3. pages/index/index.vue 的分组逻辑：用 allDailyTotals 而不是就地累加
 */

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

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

function insertTxn(db, { id, type, amount, day, month = '2026-11', deleted_at = null }) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO txn (id, type, amount_cents, account_id, to_account_id, category_id, note,
      occurred_at, occurred_day, month_key, year_key, tz_offset, created_at, updated_at, deleted_at)
     VALUES (?,?,?,'acc1',NULL,'cat1','',?,?,?,'2026',480,?,?,?)`
  ).run(id, type, amount, now, day, month, now, now, deleted_at)
}

console.log('=== getAllDailyTotals：按天聚合全部流水（不限月份）===')

{
  const { fake, db } = makeFakePlus()

  // 11-01 记了 3 笔：支出 100 + 200，收入 500
  insertTxn(db, { id: 't1', type: 'expense', amount: 10000, day: '2026-11-01' })
  insertTxn(db, { id: 't2', type: 'expense', amount: 20000, day: '2026-11-01' })
  insertTxn(db, { id: 't3', type: 'income', amount: 50000, day: '2026-11-01' })
  // 11-02 一笔支出 300
  insertTxn(db, { id: 't4', type: 'expense', amount: 30000, day: '2026-11-02' })
  // 上个月的一笔（跨月，最近 5 条里可能出现）
  insertTxn(db, { id: 't5', type: 'expense', amount: 70000, day: '2026-10-30', month: '2026-10' })
  // 转账：不计入收支，但计入笔数
  insertTxn(db, { id: 't6', type: 'transfer', amount: 90000, day: '2026-11-01' })
  // 软删除的：不参与任何统计
  insertTxn(db, { id: 't7', type: 'expense', amount: 99000, day: '2026-11-01', deleted_at: Date.now() })

  globalThis.plus = fake
  const mod = await import('../api/transaction.js')
  const totals = await mod.getAllDailyTotals()

  check('11-01 的支出 = 100 + 200', totals['2026-11-01'].expense, 30000)
  check('11-01 的收入 = 500', totals['2026-11-01'].income, 50000)
  // 转账 + 未软删的 3 笔 = 4 笔
  check('11-01 的笔数 = 4（转账算一笔，软删的不算）', totals['2026-11-01'].count, 4)
  check('11-02 的支出 = 300', totals['2026-11-02'].expense, 30000)
  check('上个月那天也有（不限月份）', totals['2026-10-30'].expense, 70000)

  // ★ 对照：月历用的 getDailyTotals 只含当月 ★
  const monthly = await mod.getDailyTotals('2026-11')
  check('月历口径不含上个月', monthly['2026-10-30'], undefined)
  check('月历口径当月是对的', monthly['2026-11-01'].expense, 30000)
}

console.log('=== 首页分组逻辑：用当日合计，不就地累加 ===')

{
  /*
   * 复现原来的 bug：
   *   最近 5 条里只有 2 条属于 11-01，但这天实际有 3 笔支出 + 1 笔收入。
   *   旧写法（就地累加 visible 的记录）会得到 expense=10000，
   *   新写法（查当日合计）应该得到 expense=30000。
   */
  const visible = [
    { id: 'a', type: 'expense', amount_cents: 10000, occurred_day: '2026-11-01' },
    { id: 'b', type: 'income', amount_cents: 50000, occurred_day: '2026-11-01' }
  ]
  const allDailyTotals = {
    '2026-11-01': { expense: 30000, income: 50000, count: 4 }
  }

  // 旧算法：只累加显示出来的
  const oldExpense = visible
    .filter((t) => t.occurred_day === '2026-11-01' && t.type === 'expense')
    .reduce((s, t) => s + t.amount_cents, 0)

  // 新算法：查当日合计
  const newExpense = (allDailyTotals['2026-11-01'] || { expense: 0 }).expense

  check('旧算法确实算错了（只统计显示出来的 1 条）', oldExpense, 10000)
  check('新算法是当日全部（3 笔支出）', newExpense, 30000)
  check('两个口径不相等（这就是 bug 的表现）', oldExpense !== newExpense, true)
}

console.log('=== 页面与 store 确实接上了新数据源 ===')

{
  const { readFileSync: rd } = await import('fs')
  const index = rd(join(ROOT, 'pages', 'index', 'index.vue'), 'utf-8')
  const store = rd(join(ROOT, 'stores', 'transaction.js'), 'utf-8')
  const api = rd(join(ROOT, 'api', 'transaction.js'), 'utf-8')

  // store 必须把全部日期的汇总缓存下来
  check('store 有 allDailyTotals 状态', /allDailyTotals:\s*\{\}/.test(store), true)
  check('store 的 loadHome 调用 getAllDailyTotals', /getAllDailyTotals\(\)/.test(store), true)

  // api 必须提供这个函数，且不按月份过滤
  check('api 导出了 getAllDailyTotals', /export async function getAllDailyTotals/.test(api), true)
  check(
    'getAllDailyTotals 不按 month_key 过滤（否则跨月的日期查不到）',
    /getAllDailyTotals[\s\S]*?GROUP BY occurred_day/.test(api) &&
      !/getAllDailyTotals[\s\S]{0,400}?month_key = \?/.test(api),
    true
  )

  // 首页分组必须用 allDailyTotals，不能就地累加
  check('首页分组用 allDailyTotals', /txnStore\.allDailyTotals/.test(index), true)
  check(
    '首页不再就地累加 amount_cents（那正是 bug 的根因）',
    /g\.expense \+= txn\.amount_cents/.test(index),
    false
  )
  check('首页不再就地累加收入', /g\.income \+= txn\.amount_cents/.test(index), false)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
