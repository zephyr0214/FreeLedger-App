/**
 * 账户页资产概览（净资产 / 总资产 / 负债）的测试
 *
 *   node scripts/test-account-overview.mjs
 *
 * ★ 用户要求 ★
 *   账户页上方的概览，右方增加两个金额「总资产」「负债」，分两行显示；
 *   左边的大数字左上方加一个「净资产」的文字说明。
 *
 * ★ 核心恒等式 ★
 *   净资产 = 总资产 - 负债
 *   这条必须永远成立，否则用户会看到「负债 0、净资产却是负数」
 *   这种自相矛盾的页面。
 *
 * ★ 为什么按余额正负拆、而不是按账户类型拆 ★
 *   「信用卡」类型也可能有正余额（刚还多了），
 *   储蓄卡也可能因为记错变负。
 *   按余额正负拆才能保证恒等式，而不是按 isCredit 拆。
 *
 * 这里驱动真实的 api/account.js getAssetOverview()，
 * 用 node:sqlite 造一个真的 SQLite 库。
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
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, day TEXT NOT NULL,
    balance_cents INTEGER NOT NULL, created_at INTEGER NOT NULL,
    UNIQUE (account_id, day)
  )`)
  db.exec(`CREATE TABLE account_combo_member (
    combo_id TEXT NOT NULL, member_id TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (combo_id, member_id)
  )`)
  db.exec(`CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT)`)
  db.exec(`CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT)`)
  db.exec('PRAGMA user_version = 14')

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
  id, name = '账户', type = 'cash', balance, include_in_total = 1,
  archived = 0, deleted_at = null
}) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO account (id, name, type, initial_balance_cents, balance_cents,
      include_in_total, sort, archived, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?,?,0,?,?,?,?)`
  ).run(id, name, type, balance, balance, include_in_total, archived, now, now, deleted_at)
}

/* --------------------------------------------------------- 纯逻辑复刻 */

/**
 * getAssetOverview 的 SQL 等价物（纯 JS 版，用于在上面的真库上交叉验证）
 */
function overviewOf(rows) {
  let assets = 0
  let debt = 0
  for (const r of rows) {
    if (r.deleted_at !== null) continue
    if (r.archived) continue
    if (!r.include_in_total) continue
    if (r.balance_cents > 0) assets += r.balance_cents
    else if (r.balance_cents < 0) debt += -r.balance_cents
  }
  return { assets, debt, net: assets - debt }
}

console.log('=== 纯逻辑：净资产 = 总资产 - 负债 ===')

{
  const rows = [
    { balance_cents: 100000, include_in_total: 1, archived: 0, deleted_at: null },
    { balance_cents: 50000, include_in_total: 1, archived: 0, deleted_at: null },
    { balance_cents: -30000, include_in_total: 1, archived: 0, deleted_at: null }
  ]
  const r = overviewOf(rows)
  check('总资产 = 正余额之和', r.assets, 150000)
  check('负债 = 负余额绝对值之和', r.debt, 30000)
  check('净资产 = 总资产 - 负债', r.net, 120000)
  check('恒等式成立', r.net, r.assets - r.debt)
}

console.log('=== 全是正余额：负债 0 ===')

{
  const r = overviewOf([
    { balance_cents: 100000, include_in_total: 1, archived: 0, deleted_at: null }
  ])
  check('负债是 0', r.debt, 0)
  check('净资产 = 总资产', r.net, 100000)
}

console.log('=== 全是负余额（纯信用卡欠款）===')

{
  const r = overviewOf([
    { balance_cents: -50000, include_in_total: 1, archived: 0, deleted_at: null },
    { balance_cents: -20000, include_in_total: 1, archived: 0, deleted_at: null }
  ])
  check('总资产是 0', r.assets, 0)
  check('负债 = 700', r.debt, 70000)
  check('净资产 = -700', r.net, -70000)
}

console.log('=== 零余额不影响任何一边 ===')

{
  const r = overviewOf([
    { balance_cents: 0, include_in_total: 1, archived: 0, deleted_at: null },
    { balance_cents: 100000, include_in_total: 1, archived: 0, deleted_at: null }
  ])
  check('总资产', r.assets, 100000)
  check('负债', r.debt, 0)
  check('净资产', r.net, 100000)
}

console.log('=== 排除规则 ===')

{
  const rows = [
    // 计入总资产的
    { balance_cents: 100000, include_in_total: 1, archived: 0, deleted_at: null },
    // 不计入总资产 -> 不算
    { balance_cents: 999999, include_in_total: 0, archived: 0, deleted_at: null },
    // 已归档 -> 不算
    { balance_cents: 888888, include_in_total: 1, archived: 1, deleted_at: null },
    // 已删除 -> 不算
    { balance_cents: 777777, include_in_total: 1, archived: 0, deleted_at: Date.now() },
    // 负的、不计入 -> 也不算负债
    { balance_cents: -666666, include_in_total: 0, archived: 0, deleted_at: null }
  ]
  const r = overviewOf(rows)
  check('只有计入总资产的活着账户参与', r.assets, 100000)
  check('不计入的负余额不算负债', r.debt, 0)
  check('净资产', r.net, 100000)
}

/* ------------------------------------------- 驱动真实的 getAssetOverview */

console.log('=== 真实 getAssetOverview()：一条 SQL 出三个数 ===')

{
  const { fake, db } = makeFakePlus()

  insertAccount(db, { id: 'a1', name: '招行储蓄卡', type: 'debit', balance: 500000 })
  insertAccount(db, { id: 'a2', name: '微信零钱', type: 'online', balance: 20000 })
  insertAccount(db, { id: 'a3', name: '信用卡', type: 'credit', balance: -150000 })
  // 不计入总资产的
  insertAccount(db, { id: 'a4', name: '代管钱包', type: 'cash', balance: 999900, include_in_total: 0 })

  globalThis.plus = fake
  const mod = await import('../api/account.js')
  await mod.openDbPublic ? await mod.openDbPublic() : null

  // getAssetOverview 内部走 queryOne -> openDb()，会自动打开
  const r = await mod.getAssetOverview()

  check('总资产 = 5000 + 200 = 5200 元', r.assets, 520000)
  check('负债 = 1500 元', r.debt, 150000)
  check('净资产 = 3700 元', r.net, 370000)
  check('恒等式：净资产 = 总资产 - 负债', r.net, r.assets - r.debt)
  check('不计入总资产的账户被排除', r.assets, 520000)
}

console.log('=== 真实 SQL：空库返回全 0 ===')

{
  const { fake, db } = makeFakePlus()
  globalThis.plus = fake
  const mod = await import('../api/account.js')

  const r = await mod.getAssetOverview()
  check('空库：总资产 0', r.assets, 0)
  check('空库：负债 0', r.debt, 0)
  check('空库：净资产 0', r.net, 0)
}

console.log('=== 真实 SQL：与 getTotalAssets / getTotalDebt 口径对齐 ===')

{
  const { fake, db } = makeFakePlus()

  insertAccount(db, { id: 'a1', type: 'debit', balance: 300000 })
  insertAccount(db, { id: 'a2', type: 'credit', balance: -100000 })
  insertAccount(db, { id: 'a3', type: 'credit', balance: -50000 })

  globalThis.plus = fake
  const mod = await import('../api/account.js')

  const [overview, assets, debt] = await Promise.all([
    mod.getAssetOverview(),
    mod.getTotalAssets(),
    mod.getTotalDebt()
  ])

  check('getAssetOverview().debt 与 getTotalDebt() 一致', overview.debt, debt)
  /*
   * ★ 注意 here 故意不断言 assets === getTotalAssets() ★
   *   旧的 getTotalAssets() 是「所有余额之和」（负余额直接抵扣），
   *   所以它其实等于净资产；新的 getAssetOverview().assets 是「正余额之和」。
   *   两者语义不同，账号页现在只用新的 getAssetOverview()。
   *   这条断言记录的就是这个差别 —— 别把它当成 bug 改回去。
   */
  check('新旧口径的差别被记录下来（旧 getTotalAssets 抵扣了负余额）', assets, 150000)
  check('新口径总资产只算正余额', overview.assets, 300000)
  check('两种口径的净资产相同', overview.net, 150000)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
