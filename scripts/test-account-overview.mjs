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

  /*
   * ★ getAssetOverview 还要读 txn + category ★
   *   因为「负债」里包含「未归还的借入」——
   *   那部分不在 account.balance_cents 里（借来的钱已经加进某张卡的余额了），
   *   只能按「借入 - 借款归还」的流水净额算。
   *   测试库必须带上这两张表，否则查询直接报 no such table。
   */
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

  db.exec('PRAGMA user_version = 15')

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

/** 插一条分类（只需要 name / type 就够借入借出统计用） */
function insertCat(db, { id, name, type, parent_id = null, deleted_at = null }) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden,
      created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,'more','#969799',0,0,?,?,?)`
  ).run(id, parent_id, name, type, now, now, deleted_at)
}

/** 插一条流水（借入借出统计只关心 type / amount / category） */
function insertTxn(db, { id, type, amount, category_id }) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO txn (id, type, amount_cents, account_id, to_account_id, category_id, note,
      occurred_at, occurred_day, month_key, year_key, tz_offset, created_at, updated_at, deleted_at)
     VALUES (?,?,?,'acc1',NULL,?,'',?,'2026-11-01','2026-11','2026',480,?,?,NULL)`
  ).run(id, type, amount, category_id, now, now, now)
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

console.log('=== 真实 SQL：借入计入负债（用户反馈的 bug）===')

/*
 * ★ 用户反馈 ★
 *   「借入，没有添加在负债中，所以净资产显示也有误」。
 *
 *   借来的钱进了真实账户 -> 已计入总资产；
 *   但它同时是一笔要还的债 —— 负债里不算它，净资产就凭空多出来这一笔。
 *
 *   算的是净额（借入 - 借款归还），不是累计借入：
 *   借 1 万已还 3 千 -> 负债 +7 千，还清后回落到 0。
 */
{
  const { fake, db } = makeFakePlus()

  // 账户里只有 1000 元现金（借来的钱已经存进来了）
  insertAccount(db, { id: 'a1', type: 'cash', balance: 100000 })

  // 分类（系统预置分类下的四个固定子类）
  insertCat(db, { id: 'c_borrow_in', name: '借入', type: 'income' })
  insertCat(db, { id: 'c_borrow_back', name: '借款归还', type: 'expense' })
  insertCat(db, { id: 'c_lend_out', name: '借出', type: 'expense' })
  insertCat(db, { id: 'c_lend_back', name: '借款收回', type: 'income' })

  // 借入 1000 元（钱进账户），已归还 300 元
  insertTxn(db, { id: 't1', type: 'income', amount: 100000, category_id: 'c_borrow_in' })
  insertTxn(db, { id: 't2', type: 'expense', amount: 30000, category_id: 'c_borrow_back' })

  globalThis.plus = fake
  const mod = await import('../api/account.js')
  const r = await mod.getAssetOverview()

  check('总资产 = 账户余额 1000', r.assets, 100000)
  check('未归还的借入 = 1000 - 300 = 700', r.loanDebt, 70000)
  check('负债包含借入净额', r.debt, 70000)
  check('净资产 = 1000 - 700 = 300', r.net, 30000)
  check('恒等式仍成立', r.net, r.assets - r.debt)
}

console.log('=== 借入还清后负债回落到 0 ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, { id: 'a1', type: 'cash', balance: 0 })
  insertCat(db, { id: 'c_borrow_in', name: '借入', type: 'income' })
  insertCat(db, { id: 'c_borrow_back', name: '借款归还', type: 'expense' })

  // 借 500 还 500
  insertTxn(db, { id: 't1', type: 'income', amount: 50000, category_id: 'c_borrow_in' })
  insertTxn(db, { id: 't2', type: 'expense', amount: 50000, category_id: 'c_borrow_back' })

  globalThis.plus = fake
  const mod = await import('../api/account.js')
  const r = await mod.getAssetOverview()

  check('还清后借入负债 = 0', r.loanDebt, 0)
  check('还清后负债 = 0', r.debt, 0)
}

console.log('=== 归还多于借入（数据异常）不让负债变负 ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, { id: 'a1', type: 'cash', balance: 0 })
  insertCat(db, { id: 'c_borrow_in', name: '借入', type: 'income' })
  insertCat(db, { id: 'c_borrow_back', name: '借款归还', type: 'expense' })

  insertTxn(db, { id: 't1', type: 'income', amount: 10000, category_id: 'c_borrow_in' })
  insertTxn(db, { id: 't2', type: 'expense', amount: 30000, category_id: 'c_borrow_back' })

  globalThis.plus = fake
  const mod = await import('../api/account.js')
  const r = await mod.getAssetOverview()

  check('归还多于借入时借入负债按 0 处理', r.loanDebt, 0)
}

console.log('=== 借出不计入负债（借款收回也不该抵债）===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, { id: 'a1', type: 'cash', balance: 100000 })
  insertCat(db, { id: 'c_lend_out', name: '借出', type: 'expense' })
  insertCat(db, { id: 'c_lend_back', name: '借款收回', type: 'income' })

  insertTxn(db, { id: 't1', type: 'expense', amount: 50000, category_id: 'c_lend_out' })
  insertTxn(db, { id: 't2', type: 'income', amount: 20000, category_id: 'c_lend_back' })

  globalThis.plus = fake
  const mod = await import('../api/account.js')
  const r = await mod.getAssetOverview()

  check('借出不影响负债', r.debt, 0)
  check('借出负债字段为 0', r.loanDebt, 0)

  /*
   * ★ 需求：总览「负债」后面显示「应收」，应收不计入净资产 ★
   *   getAssetOverview 现在把 lending 一起带出来（账户页直接消费），
   *   但 net 必须仍然是 assets - debt —— 借出的钱已经从余额里扣掉了，
   *   加回去等于「借出去的钱还当自己的钱」。
   */
  check('概览带出应收 = 500 - 200 = 300', r.lending, 30000)
  check('应收计入概览后净资产口径不变', r.net, 100000)
  check('恒等式仍成立（应收不参与减法）', r.net, r.assets - r.debt)

  // 未收回的借出单独提供（不进净资产）
  const lending = await mod.getOutstandingLending()
  check('未收回的借出 = 500 - 200 = 300', lending, 30000)
  check('概览里的 lending 与独立函数一致', r.lending, lending)
}

console.log('=== 没有借出时概览的应收字段是 0（老数据兼容）===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, { id: 'a1', type: 'cash', balance: 100000 })
  insertCat(db, { id: 'c_borrow_in', name: '借入', type: 'income' })
  insertCat(db, { id: 'c_borrow_back', name: '借款归还', type: 'expense' })

  insertTxn(db, { id: 't1', type: 'income', amount: 100000, category_id: 'c_borrow_in' })

  globalThis.plus = fake
  const mod = await import('../api/account.js')
  const r = await mod.getAssetOverview()

  check('没有借出：应收字段为 0', r.lending, 0)
  check('没有借出：净资产 = 1000 - 1000 = 0', r.net, 0)
}

/* ------------------------------------------- 页面 / store 的数据链路 */

/*
 * ★ 为什么要在这里查源码 ★
 *   这条需求是「负债后面多一格应收」。数据链路有三段：
 *     api 返回 lending -> store 存 netReceivable -> 页面渲染「应收」
 *   任何一段断掉，数字都会静默变成 0 或整格不显示（编译不报错）。
 *   所以除了算得对，还要锁住「三格结构」与「文案是应收」。
 */
console.log('=== 账户页三格：总资产 / 负债 / 应收 ===')

{
  const { readFileSync } = await import('fs')
  const { join, dirname, resolve } = await import('path')
  const { fileURLToPath } = await import('url')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const read = (p) => readFileSync(join(ROOT, p), 'utf-8')

  /*
   * ★ 断言前先剥掉注释 ★
   *   注释里会写「不要『借出』/『不计入净资产』」「lending 不参与 net」
   *   这类说明文字，直接正则会把注释当实现，误报。
   *   注释是给维护者看的，断言只该盯真正的模板结构和代码。
   */
  const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '')
  const stripJsComments = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  const page = read('pages/account/index.vue')
  const store = read('stores/account.js')

  // 三格都在同一行，且顺序是 总资产 -> 负债 -> 应收
  const rowHtml = page.match(/<view class="asset-sub-row">([\s\S]*?)\n          <\/view>/)
  check('账户页有 asset-sub-row 概览行', !!rowHtml, true)
  const row = stripHtmlComments(rowHtml ? rowHtml[1] : '')
  const order = ['总资产', '负债', '应收'].map((t) => row.indexOf(t))
  check('三格文案齐全', order.every((i) => i >= 0), true)
  check('顺序：总资产 -> 负债 -> 应收', order[0] < order[1] && order[1] < order[2], true)
  // 用户要求只显示「应收」两个字，不要「（借出）」/「不计入净资产」的附加说明
  check('文案只有「应收」，不带「（借出）」', /应收（借出）/.test(row), false)
  check('不再显示「不计入净资产」小字', /不计入净资产/.test(row), false)
  // 三格必须是等分布局，否则长金额会把其中一格挤扁
  check('三格等分（asset-sub-item flex:1）', /\.asset-sub-item\s*\{[^}]*flex:\s*1/.test(page), true)

  // 血缘：页面读 store 的 netReceivable，store 读 api 的 lending
  check('页面消费 accountStore.netReceivable', /accountStore\.netReceivable/.test(page), true)
  check('store 有 netReceivable 字段', /netReceivable:\s*0/.test(store), true)
  check('store 从 overview.lending 取值', /netReceivable\s*=\s*overview\.lending/.test(store), true)

  // ★ 净资产口径：不能把应收减进/加进 assets 或 net
  const api = stripJsComments(read('api/account.js'))
  const overviewFn = api.match(/export async function getAssetOverview\(\)[\s\S]*?\n\}/)
  const body = overviewFn ? overviewFn[0] : ''
  check('找到 getAssetOverview 函数体', !!body, true)
  check('net 仍然只由 assets - debt 得出', /net:\s*assets\s*-\s*debt/.test(body), true)
  check('net 表达式里不含 lending', /net:\s*[^,}\n]*lending/.test(body), false)
  check('assets 没有被 lending 修改', /assets\s*(\+=|=)[^;\n]*lending/.test(body), false)
  check('debt 没有被 lending 修改', /debt\s*(\+=|=)[^;\n]*lending/.test(body), false)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
