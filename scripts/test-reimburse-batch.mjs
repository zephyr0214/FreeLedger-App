/**
 * 报销单（reimburse_batch，schema v23）测试
 *
 *   node scripts/test-reimburse-batch.mjs
 *
 * ★ 这一轮要锁住的东西 ★
 *   用户要求：「每次选择报销时，自动创建一个报销单，类似于借款人那样的界面，
 *   显示报销金额，实报金额，报销时间，报销笔数；右滑报销则将该笔设置为一个报销单，
 *   多选报销则共同设置为一个报销单。报销返还/盈余/坏账也列入下方报销单，
 *   但不计入报销笔数。」
 *
 *   拆成可验证的几条：
 *     1. schema v23：SCHEMA_VERSION = 23、迁移 v23 注册、建 reimburse_batch、
 *        txn 加 batch_id、truncateAll 带上新表
 *     2. 迁移 v23 真的能在「v22 的库」上跑出结构，**且不回填任何老数据**
 *     3. reimburseTxns 单笔 → 1 张单、txn_count = 1、派生流水挂在同一单
 *     4. reimburseTxns 三笔 + 差额 → 1 张单、txn_count = 3（不含坏账）、
 *        原支出合计 / 实报金额 / 坏账金额都对
 *     5. listReimburseBatches：明细不含派生、derived 单独一份、排序正确
 *     6. 老数据（batch_id 为空）只读兜底成「历史报销单」，
 *        且「同日同账户两批不同实报金额」不会被合成一张单
 *     7. 备份导出/导入带上 reimburse_batch 与 txn.batch_id（恢复后单还在）
 *     8. truncateAll 真的把 reimburse_batch 清空
 *
 * ★ 为什么用真 SQLite（node:sqlite）而不是桩 ★
 *   这次改动全部是「写入 → 再按 batch_id 读回来」，桩测不出
 *   INSERT 列数不匹配、JOIN 写错、NULL 语义这类问题 ——
 *   而它们恰好是报销单最容易出错的地方（列一多，参数就对不上）。
 */

import { readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

import { SCHEMA_V1, SCHEMA_VERSION, REIMBURSE_CATEGORY_NAMES } from '../api/db/schema.js'

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

function ok(name, cond) {
  if (cond) pass++
  else {
    fail++
    console.log(`FAIL  ${name}`)
  }
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8')

/* ==================================================== 1. 静态：schema */

console.log('=== 1. schema v23 与迁移注册 ===')

const schemaSrc = read('api/db/schema.js')
const dbSrc = read('api/db/index.js')
const reimbSrc = read('api/reimburse.js')

check('SCHEMA_VERSION 是 23', SCHEMA_VERSION, 23)
check('迁移 v23 已注册', /version:\s*23,\s*\n\s*up:\s*migrateReimburseBatch/.test(dbSrc), true)
check('迁移函数存在', /async function migrateReimburseBatch\s*\(/.test(dbSrc), true)

/*
 * ★ txn 必须有 batch_id（可空）★
 *   写成 NOT NULL 会让所有老流水（NULL）在 ALTER 时直接失败，
 *   所以这里的断言要确认它**没有** NOT NULL。
 */
check('SCHEMA_V1 的 txn 有 batch_id 列', /batch_id\s+TEXT\b/.test(schemaSrc), true)
ok('batch_id 允许为 NULL（老数据兼容）', !/batch_id\s+TEXT\s+NOT NULL/.test(schemaSrc))

check(
  '迁移里建 reimburse_batch（IF NOT EXISTS，可重复执行）',
  /CREATE TABLE IF NOT EXISTS reimburse_batch/.test(dbSrc),
  true
)
check(
  '迁移里 ALTER txn 加 batch_id',
  /ALTER TABLE txn ADD COLUMN batch_id TEXT/.test(dbSrc),
  true
)

/** 单头列必须齐全（少了任何一列，卡片就少一块信息） */
for (const col of ['total_origin_cents', 'total_done_cents', 'txn_count', 'day', 'account_id']) {
  ok(`reimburse_batch 有 ${col} 列`, new RegExp(`\\b${col}\\b`).test(dbSrc))
}

check('truncateAll 清 reimburse_batch', /'reimburse_batch'/.test(dbSrc), true)

/* 页面与 API 接线 */
check('reimburseTxns 建单（INSERT INTO reimburse_batch）', /INSERT INTO reimburse_batch/.test(reimbSrc), true)
check('reimburseTxns 返回 batchId', /return\s*\{\s*incomeCents[\s\S]{0,200}?batchId/.test(reimbSrc), true)
check('listReimburseBatches 已导出', /export async function listReimburseBatches/.test(reimbSrc), true)
check('保留 listReimburseTxns（其它页面还在用）', /export async function listReimburseTxns/.test(reimbSrc), true)
check('保留 getReimburseSummary', /export async function getReimburseSummary/.test(reimbSrc), true)

/* ========================================= 2. 真库脚手架（假 plus） */

/**
 * 从 db/index.js 的迁移 DDL 里抠出「只在迁移里建的表」。
 *
 * ★ 不手写第二份清单 ★
 *   test-clear-all 也这么干：手写的话以后迁移加表，
 *   这里的测试库不会跟着长，跑起来就是「no such table」而不是真 bug。
 */
const schemaTables = []
for (const sql of SCHEMA_V1) {
  const m = /CREATE TABLE IF NOT EXISTS\s+(\w+)/i.exec(sql)
  if (m) schemaTables.push(m[1])
}

function migrationDDL(table) {
  const re = new RegExp('`(CREATE TABLE IF NOT EXISTS ' + table + ' \\([\\s\\S]*?\\))`')
  const m = re.exec(dbSrc)
  return m ? m[1] : ''
}

const migrationTables = []
{
  const re = /`(CREATE TABLE IF NOT EXISTS (\w+) \([\s\S]*?\))`/g
  let m
  while ((m = re.exec(dbSrc)) !== null) {
    if (!schemaTables.includes(m[2])) migrationTables.push(m[2])
  }
}

/**
 * 把建表语句里 v23 新加的 batch_id 列删掉，模拟 v22 的 txn 表。
 *
 * ★ 为什么用 SQLite 自己的 DROP COLUMN，而不是正则改 DDL ★
 *   batch_id 前面挂着一整段设计注释，正则很难同时照顾「删列」和「删悬空逗号」：
 *   逗号在那一大段注释之前、`batch_id` 在注释之后，两头都不挨着，
 *   试过两条正则，要么留下 `TEXT, )` 语法错，要么把中间好几列一起吃掉。
 *   真 SQLite 3.35+ 支持 DROP COLUMN，直接让库自己把它拿掉最干净。
 *   （只在测试脚手架里用；App 端不依赖它 —— 那里删列要重建表，见 schema 注释。）
 */
function dropBatchIdColumn(db) {
  db.exec('ALTER TABLE txn DROP COLUMN batch_id')
}

/**
 * 造一个假 plus.sqlite，后端是 node:sqlite 内存库。
 *
 * @param {object} opt
 *   legacyTxnSchema  true 时用「v22 的 txn 表」建库（没有 batch_id），
 *                    并且不建 reimburse_batch —— 用来验证迁移自身
 *   userVersion      库头版本号
 */
function makeFakePlus(opt = {}) {
  const { legacyTxnSchema = false, userVersion = SCHEMA_VERSION, emptyDb = false } = opt
  const db = new DatabaseSync(':memory:')
  db.exec(`PRAGMA user_version = ${userVersion}`)

  /*
   * ★ emptyDb = 全新安装的现场 ★
   *   全空的库（连表都没有）+ user_version = 0，
   *   这样 openDb() 会真的从 v1 一条条跑到 v23 ——
   *   这才是新装用户拿到新表的真实路径。
   *   下面「预先建好表」的脚手架模拟的是老库升级，两条路都要守。
   */
  if (emptyDb) {
    return { fake: makeFakeSqlite(db), db }
  }

  // 1) SCHEMA_V1 的建表语句
  for (const sql of SCHEMA_V1) {
    db.exec(sql)
  }

  /*
   * 1b) 模拟「v22 的库」：把 v23 才加的 batch_id 列拿掉
   *
   * ★ 必须在建表之后单独一步做，不能改 DDL 字符串 ★
   *   txn 的建表语句里 batch_id 前面挂着一整段设计注释，
   *   「删列 + 补悬空逗号」的正则要么留下 `TEXT, )` 语法错，
   *   要么把中间的 exclude_from_stats / via_combo_id / 四个 reimburse_* 列一起吃掉。
   *   真 SQLite（3.35+）支持 DROP COLUMN，让库自己拿掉最干净。
   *   这一步只为验证「迁移 v23 能在缺列的老库上补齐」，
   *   App 端删列要重建表，见 schema.js 的注释。
   */
  if (legacyTxnSchema) dropBatchIdColumn(db)

  // 2) 只由迁移创建的表（cycle / cycle_skip / exchange_rate / reimburse_batch ...）
  for (const t of migrationTables) {
    if (legacyTxnSchema && t === 'reimburse_batch') continue
    const ddl = migrationDDL(t)
    if (ddl) db.exec(ddl)
  }

  /*
   * 3) 迁移里 ALTER 加出来的列
   *
   * ★ 为什么必须补 ★
   *   库是按「SCHEMA_V1 + 迁移 DDL」直接搭的，而且 user_version 已经是 SCHEMA_VERSION，
   *   migrate() 不会再跑，那些 ALTER 出来的列就缺了。
   *   reimburseTxns 会往 txn.cycle_id / via_combo_id 等列写值，
   *   不补就会报 "table txn has no column named cycle_id" —— 与业务无关的假失败。
   */
  const extraCols = [
    'ALTER TABLE txn ADD COLUMN cycle_id TEXT',
    'ALTER TABLE txn ADD COLUMN via_combo_id TEXT',
    /*
     * 外币三列（v17）：SCHEMA_V1 里没有，只在迁移里 ALTER 出来。
     * reimburseTxns 的 INSERT 会显式写这三列（写 NULL），不补就报
     * "table txn has no column named original_currency"。
     */
    'ALTER TABLE txn ADD COLUMN original_currency TEXT',
    'ALTER TABLE txn ADD COLUMN original_amount_cents INTEGER',
    'ALTER TABLE txn ADD COLUMN exchange_rate REAL',
    'ALTER TABLE cycle ADD COLUMN last_caught_up_day TEXT',
    'ALTER TABLE cycle ADD COLUMN original_currency TEXT',
    'ALTER TABLE cycle ADD COLUMN original_amount_cents INTEGER',
    'ALTER TABLE cycle ADD COLUMN exclude_from_budget INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE cycle ADD COLUMN reimburse_status INTEGER NOT NULL DEFAULT 0'
  ]
  for (const sql of extraCols) {
    try { db.exec(sql) } catch (e) {}
  }

  /*
   * ★ 事务要按层数模拟 ★
   *   importPayload / reimburseTxns 自己开事务，里面的
   *   seedDefaultCategories / ensurePresetCategories 也会开（或可能开）。
   *   每条 begin 都真发 BEGIN 会报 "cannot start a transaction within a transaction"，
   *   而这跟被测行为毫无关系。只在最外层真发 BEGIN/COMMIT/ROLLBACK。
   */
  return { fake: makeFakeSqlite(db), db }
}

/**
 * 把 node:sqlite 包成假的 plus.sqlite。
 *
 * ★ 事务按层数模拟 ★
 *   importPayload / reimburseTxns 自己开事务，里面还会套 seed / ensurePreset，
 *   每条 begin 都真发 BEGIN 会报 "cannot start a transaction within a transaction"，
 *   而这跟被测行为无关。只在最外层真发 BEGIN/COMMIT/ROLLBACK。
 */
function makeFakeSqlite(db) {
  let depth = 0

  const fake = {
    sqlite: {
      openDatabase: ({ success }) => success && success(),
      closeDatabase: ({ success }) => success && success(),
      selectSql: ({ sql, success, fail: f }) => {
        if (sql.indexOf('PRAGMA user_version') !== -1) {
          const rows = db.prepare('PRAGMA user_version').all()
          success && success(rows.map((r) => ({ user_version: r.user_version })))
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
          if (operation === 'begin') {
            if (depth === 0) db.exec('BEGIN')
            depth++
          } else if (operation === 'commit') {
            depth--
            if (depth === 0) db.exec('COMMIT')
          } else if (operation === 'rollback') {
            depth = 0
            db.exec('ROLLBACK')
          }
          success && success()
        } catch (e) {
          depth = 0
          f && f({ message: e.message })
        }
      }
    }
  }
  return fake
}

/** 每次全新模块实例（模块里有 opened / opening 缓存，换库必须换实例） */
async function loadModules(fake) {
  globalThis.plus = fake
  const stamp = Math.random()
  const reimbMod = await import('../api/reimburse.js?t=' + stamp)
  const dbMod = await import('../api/db/index.js?t=' + stamp)
  await dbMod.openDb()
  return { reimbMod, dbMod }
}

const countOf = (db, t) => Number(db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c)

/** 插一个账户（余额字段照实写，recalcBalance 会重算，这里给 0 就行） */
function insertAccount(db, id, name = '银行卡') {
  db.prepare(
    `INSERT INTO account (id, name, type, initial_balance_cents, balance_cents, include_in_total,
      sort, archived, created_at, updated_at, deleted_at)
     VALUES (?,?, 'bank', 0, 0, 1, 0, 0, ?, ?, NULL)`
  ).run(id, name, Date.now(), Date.now())
}

/** 插一笔支出（默认「待报销」，报销测试的起点） */
function insertExpense(db, { id, amount, accountId, categoryId = null, day = '2026-11-01', status = 1, batchId = null }) {
  const ts = new Date(`${day}T10:00:00`).getTime()
  db.prepare(
    `INSERT INTO txn (id, type, amount_cents, account_id, category_id, note,
      occurred_at, occurred_day, month_key, year_key, tz_offset,
      created_at, updated_at, deleted_at,
      exclude_from_budget, exclude_from_stats, reimburse_status,
      reimburse_day, reimburse_amount_cents, reimburse_account_id, batch_id)
     VALUES (?, 'expense', ?, ?, ?, '', ?, ?, ?, ?, 480, ?, ?, NULL, 1, 1, ?,
      NULL, NULL, NULL, ?)`
  ).run(
    id, amount, accountId, categoryId,
    ts, day, day.slice(0, 7), day.slice(0, 4),
    ts, ts, status, batchId
  )
}

/** 取分类 id（ensurePresetCategories 会建好这些行） */
function categoryIdByName(db, name, type) {
  const row = db.prepare(
    'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? LIMIT 1'
  ).get(name, type)
  return row ? row.id : null
}

/** 取某张单的全部流水 */
function txnsOfBatch(db, batchId) {
  return db.prepare('SELECT * FROM txn WHERE batch_id = ? ORDER BY occurred_at ASC').all(batchId)
}

/* ============================ 3. 迁移 v23：建结构 + 不回填老数据 */

console.log('=== 3. 迁移 v23 在 v22 的库上 ===')

{
  const { fake, db } = makeFakePlus({ legacyTxnSchema: true, userVersion: 22 })

  // 先塞一批「v22 时代已经报销过」的流水：没有 batch_id 列，状态是 2
  const ts = new Date('2026-10-01T10:00:00').getTime()
  db.prepare(
    `INSERT INTO txn (id, type, amount_cents, account_id, note,
      occurred_at, occurred_day, month_key, year_key, tz_offset,
      created_at, updated_at, deleted_at, exclude_from_budget, exclude_from_stats,
      reimburse_status, reimburse_day, reimburse_amount_cents, reimburse_account_id)
     VALUES ('old1', 'expense', 10000, 'acc1', '', ?, '2026-10-01', '2026-10', '2026', 480,
       ?, ?, NULL, 1, 1, 2, '2026-10-05', 10000, 'acc1')`
  ).run(ts, ts, ts)

  // 迁移前：表不存在、列不存在
  const beforeTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='reimburse_batch'"
  ).get()
  check('迁移前没有 reimburse_batch 表', beforeTable, undefined)
  const beforeCols = db.prepare('PRAGMA table_info(txn)').all().map((c) => c.name)
  check('迁移前 txn 没有 batch_id 列', beforeCols.includes('batch_id'), false)

  // 跑真模块：openDb → migrate() 会发现 user_version=22 < 23，执行 v23
  const { dbMod } = await loadModules(fake)

  const afterTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='reimburse_batch'"
  ).get()
  ok('迁移后建出了 reimburse_batch', !!afterTable)

  const afterCols = db.prepare('PRAGMA table_info(txn)').all().map((c) => c.name)
  check('迁移后 txn 有 batch_id 列', afterCols.includes('batch_id'), true)

  /*
   * ★ 核心断言：不回填 ★
   *   老数据一条都不该被塞进任何单里 ——
   *   造错单比没有单危险得多（理由见 api/db/index.js 的 v23 注释）。
   */
  check('迁移没有凭空造出报销单', countOf(db, 'reimburse_batch'), 0)
  const oldRow = db.prepare("SELECT batch_id FROM txn WHERE id = 'old1'").get()
  check('老流水 batch_id 保持 NULL（不回填）', oldRow.batch_id, null)

  /* 迁移可重复执行（幂等）：再跑一次不报错、不重复建表 */
  const again = await dbMod.runMigrationForTest(23)
  check('迁移 v23 可以重复执行', again, true)
  check('重复执行后仍只有一张表（没报错）', countOf(db, 'reimburse_batch'), 0)

  /* user_version 被推进到 23 */
  const ver = db.prepare('PRAGMA user_version').get().user_version
  check('user_version 推进到 23', Number(ver), 23)
}

/* ==================== 3b. 全新安装：从 0 跑到 23 也要有表 */

console.log('=== 3b. 全新安装（空库 + user_version=0）跑完整迁移链 ===')

{
  /*
   * ★ 这条守的是「新装用户」这条路 ★
   *   reimburse_batch 没写进 SCHEMA_V1（和 cycle / cycle_skip / exchange_rate 一样），
   *   新装库全靠迁移建出来。如果哪天有人把它从迁移里挪走、
   *   或者迁移顺序写错（v23 在 v22 之前跑之类），
   *   新用户装完就是一个「点开报销页报 no such table」的 App ——
   *   而老用户升级上来的库反而是好的，最难排查的一类问题。
   */
  const { fake, db } = makeFakePlus({ emptyDb: true, userVersion: 0 })
  const { dbMod } = await loadModules(fake)

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  ok('全新安装后存在 reimburse_batch 表', tables.includes('reimburse_batch'))
  ok('全新安装后存在 txn 表', tables.includes('txn'))
  ok('全新安装后存在 cycle 表（对照：同为迁移建的表）', tables.includes('cycle'))

  const cols = db.prepare('PRAGMA table_info(txn)').all().map((c) => c.name)
  ok('全新安装的 txn 有 batch_id 列', cols.includes('batch_id'))

  const ver = db.prepare('PRAGMA user_version').get().user_version
  check('全新安装后 user_version = 23', Number(ver), 23)

  /* 索引也建出来了（列表页排序要它） */
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name)
  ok('有 idx_txn_batch 索引', idx.includes('idx_txn_batch'))
  ok('有 idx_batch_day 索引', idx.includes('idx_batch_day'))
}

/* ============================ 4. 单笔报销 → 一张单 */

console.log('=== 4. 右滑单笔报销 = 1 张报销单 ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, 'acc1', '工资卡')
  const { reimbMod } = await loadModules(fake)

  insertExpense(db, { id: 'e1', amount: 50000, accountId: 'acc1' }) // 500.00 待报销

  const r = await reimbMod.reimburseTxns({
    ids: ['e1'], totalCents: 50000, accountId: 'acc1', day: '2026-11-08'
  })

  ok('返回 batchId', typeof r.batchId === 'string' && r.batchId.length > 0)
  check('实报合计 = 50000', r.incomeCents, 50000)
  check('无差额 → 没有坏账', r.badDebtCents, 0)
  check('无差额 → 没有盈余', r.surplusCents, 0)

  const batches = db.prepare('SELECT * FROM reimburse_batch').all()
  check('生成了 1 张报销单', batches.length, 1)
  if (batches.length === 1) {
    const b = batches[0]
    check('单头 id = 返回的 batchId', b.id, r.batchId)
    check('原支出合计', Number(b.total_origin_cents), 50000)
    check('实报金额', Number(b.total_done_cents), 50000)
    check('报销笔数 = 1', Number(b.txn_count), 1)
    check('报销日期', b.day, '2026-11-08')
    check('到账账户', b.account_id, 'acc1')
    ok('单头有 created_at / updated_at', Number(b.created_at) > 0 && Number(b.updated_at) > 0)
    ok('单头 deleted_at 为空', b.deleted_at === null || b.deleted_at === undefined)
  }

  const collected = txnsOfBatch(db, r.batchId)
  check('挂上 batch_id 的流水共 2 笔（1 原始 + 1 到账）', collected.length, 2)

  const origin = collected.find((t) => t.id === 'e1')
  check('原始支出 batch_id 已写入', origin.batch_id, r.batchId)
  check('原始支出现在是「已报销」', Number(origin.reimburse_status), 2)
  check('原始支出现在有报销日期', origin.reimburse_day, '2026-11-08')

  const derived = collected.filter((t) => t.id !== 'e1')
  check('派生流水只有「报销到账」一笔', derived.length, 1)
  if (derived.length === 1) {
    const d = derived[0]
    check('到账流水金额 = 实报金额', Number(d.amount_cents), 50000)
    check('到账流水是收入', d.type, 'income')
    check('到账流水不计收支', Number(d.exclude_from_stats), 1)
    const incomeCatId = categoryIdByName(db, REIMBURSE_CATEGORY_NAMES.income.name, 'income')
    check('到账流水挂在「报销到账」分类', d.category_id, incomeCatId)
  }

  /* listReimburseBatches 读回来 */
  const list = await reimbMod.listReimburseBatches()
  check('列表返回 1 张单', list.length, 1)
  if (list.length === 1) {
    const b = list[0]
    check('单的笔数 = 1（不含派生）', b.txnCount, 1)
    check('单的实报金额', b.doneCents, 50000)
    check('单的原支出合计', b.originCents, 50000)
    check('单的到账账户名', b.accountName, '工资卡')
    check('明细只含被报销的原始支出', b.items.map((t) => t.id), ['e1'])
    check('派生单独一份', b.derived.map((t) => t.category_name), ['报销到账'])
    check('txns = 明细 + 派生', b.txns.length, 2)
    check('新单不是 legacy', b.isLegacy, false)
  }
}

/* ==================== 5. 多选 3 笔 + 差额 → 一张单 */

console.log('=== 5. 多选报销 = 1 张单，派生流水不计入笔数 ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, 'acc1', '工资卡')
  const { reimbMod } = await loadModules(fake)

  insertExpense(db, { id: 'e1', amount: 20000, accountId: 'acc1', day: '2026-11-01' })
  insertExpense(db, { id: 'e2', amount: 30000, accountId: 'acc1', day: '2026-11-02' })
  insertExpense(db, { id: 'e3', amount: 50000, accountId: 'acc1', day: '2026-11-03' })

  // 原支出 1000.00，实报 900.00 → 坏账 100.00
  const r = await reimbMod.reimburseTxns({
    ids: ['e1', 'e2', 'e3'], totalCents: 90000, accountId: 'acc1', day: '2026-11-08'
  })

  check('坏账 = 10000', r.badDebtCents, 10000)
  check('盈余 = 0', r.surplusCents, 0)

  const b = db.prepare('SELECT * FROM reimburse_batch').get()
  check('只生成 1 张单', countOf(db, 'reimburse_batch'), 1)
  check('原支出合计 = 100000', Number(b.total_origin_cents), 100000)
  check('实报金额 = 90000', Number(b.total_done_cents), 90000)
  check('报销笔数 = 3（不含坏账）', Number(b.txn_count), 3)

  const collected = txnsOfBatch(db, b.id)
  check('挂 batch_id 的流水共 5 笔（3 原始 + 到账 + 坏账）', collected.length, 5)

  const badDebt = collected.find((t) => Number(t.amount_cents) === 10000 && t.type === 'expense')
  ok('有一笔 100.00 的报销坏账', !!badDebt)
  if (badDebt) {
    check('坏账挂在「报销坏账」分类', badDebt.category_id,
      categoryIdByName(db, REIMBURSE_CATEGORY_NAMES.badDebt.name, 'expense'))
    check('坏账计入收支（不那么做损失就看不见）', Number(badDebt.exclude_from_stats), 0)
  }

  const list = await reimbMod.listReimburseBatches()
  const card = list[0]
  check('卡片笔数 = 3', card.txnCount, 3)
  check('卡片明细 3 笔', card.items.length, 3)
  check('明细按发生时间正序', card.items.map((t) => t.id), ['e1', 'e2', 'e3'])
  check('派生 2 笔（到账 + 坏账）', card.derived.length, 2)
  check('派生分类名集合', card.derived.map((t) => t.category_name).sort(),
    ['报销坏账', '报销到账'].sort())
  check('原支出合计 = 100000', card.originCents, 100000)
  check('实报金额 = 90000', card.doneCents, 90000)
}

/* ==================== 5b. 盈余情况 */

console.log('=== 5b. 实报 > 原支出 → 报销盈余 ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, 'acc1')
  const { reimbMod } = await loadModules(fake)

  insertExpense(db, { id: 'e1', amount: 10000, accountId: 'acc1' })
  const r = await reimbMod.reimburseTxns({
    ids: ['e1'], totalCents: 12000, accountId: 'acc1', day: '2026-11-08'
  })

  check('盈余 = 2000', r.surplusCents, 2000)
  const list = await reimbMod.listReimburseBatches()
  check('派生里有两笔（到账 + 盈余）', list[0].derived.map((t) => t.category_name).sort(),
    ['报销到账', '报销盈余'].sort())
  const surplus = db.prepare(
    'SELECT amount_cents, exclude_from_stats, batch_id FROM txn WHERE amount_cents = 2000'
  ).get()
  check('盈余金额写对', Number(surplus.amount_cents), 2000)
  check('盈余计入收支', Number(surplus.exclude_from_stats), 0)
  check('盈余挂着 batch_id', surplus.batch_id, r.batchId)
}

/* ==================== 5c. 校验与幂等护栏 */

console.log('=== 5c. 报销参数护栏 ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, 'acc1')
  const { reimbMod } = await loadModules(fake)

  insertExpense(db, { id: 'e1', amount: 10000, accountId: 'acc1', status: 0 })

  let msg = ''
  try { await reimbMod.reimburseTxns({ ids: ['e1'], totalCents: 10000, accountId: 'acc1' }) } catch (e) { msg = e.message }
  check('不是待报销的流水 → 拒绝', /不是「待报销」/.test(msg), true)

  insertExpense(db, { id: 'e2', amount: 10000, accountId: 'acc1' })
  msg = ''
  try { await reimbMod.reimburseTxns({ ids: ['e2', 'nope'], totalCents: 10000, accountId: 'acc1' }) } catch (e) { msg = e.message }
  check('有流水查不到 → 拒绝（否则单头笔数和明细对不上）', /不存在/.test(msg), true)

  msg = ''
  try { await reimbMod.reimburseTxns({ ids: [], totalCents: 10000, accountId: 'acc1' }) } catch (e) { msg = e.message }
  check('没选流水 → 拒绝', /没有选中/.test(msg), true)

  msg = ''
  try { await reimbMod.reimburseTxns({ ids: ['e2'], totalCents: 0, accountId: 'acc1' }) } catch (e) { msg = e.message }
  check('金额为 0 → 拒绝', /请输入报销金额/.test(msg), true)

  check('所有被拒绝的请求都没留下半张单', countOf(db, 'reimburse_batch'), 0)
}

/* ==================== 6. 老数据（无 batch_id）只读兜底 */

console.log('=== 6. 老数据兜底：按报销日 + 账户 + 实报金额拼历史单 ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, 'acc1', '工资卡')
  const { reimbMod } = await loadModules(fake)

  /*
   * 先让 ensurePresetCategories() 建好三个报销派生分类。
   *
   * ★ 为什么不能靠 listReimburseBatches() 顺手建 ★
   *   它是只读查询，不调用 ensurePresetCategories（读不该有副作用）；
   *   分类由 reimburseTxns 在真正报销时才补齐。
   *   这里手动调一次，只是为了拿到分类 id 去造「v22 时代留下的」流水。
   */
  const catMod = await import('../api/category.js?t=' + Math.random())
  await catMod.ensurePresetCategories()
  const incomeId = categoryIdByName(db, REIMBURSE_CATEGORY_NAMES.income.name, 'income')
  const badDebtId = categoryIdByName(db, REIMBURSE_CATEGORY_NAMES.badDebt.name, 'expense')

  /** 直接写「v22 时代留下的」已报销流水（batch_id 为 NULL） */
  const insertDone = (id, amount, day, doneCents, accountId = 'acc1') => {
    const ts = new Date(`${day}T09:00:00`).getTime()
    const rd = new Date(`${day}T12:00:00`).getTime()
    db.prepare(
      `INSERT INTO txn (id, type, amount_cents, account_id, note,
        occurred_at, occurred_day, month_key, year_key, tz_offset,
        created_at, updated_at, deleted_at, exclude_from_budget, exclude_from_stats,
        reimburse_status, reimburse_day, reimburse_amount_cents, reimburse_account_id, batch_id)
       VALUES (?, 'expense', ?, ?, '', ?, ?, ?, ?, 480, ?, ?, NULL, 1, 1, 2, ?, ?, ?, NULL)`
    ).run(
      id, amount, accountId, ts, day, day.slice(0, 7), day.slice(0, 4),
      rd, rd, day, doneCents, accountId
    )
  }
  const insertDerived = (id, type, amount, day, categoryId, accountId = 'acc1') => {
    const ts = new Date(`${day}T12:00:00`).getTime()
    db.prepare(
      `INSERT INTO txn (id, type, amount_cents, account_id, category_id, note,
        occurred_at, occurred_day, month_key, year_key, tz_offset,
        created_at, updated_at, deleted_at, exclude_from_budget, exclude_from_stats,
        reimburse_status, reimburse_day, reimburse_amount_cents, reimburse_account_id, batch_id)
       VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, 480, ?, ?, NULL, 1, ?, 0, NULL, NULL, NULL, NULL)`
    ).run(
      id, type, amount, accountId, categoryId, ts, day, day.slice(0, 7), day.slice(0, 4),
      ts, ts, type === 'income' ? 1 : 0
    )
  }

  /* 第 1 批：2026-10-05，两笔共 300.00，实报 300.00 */
  insertDone('o1', 10000, '2026-10-05', 30000)
  insertDone('o2', 20000, '2026-10-05', 30000)
  insertDerived('d1', 'income', 30000, '2026-10-05', incomeId)

  /* 第 2 批：2026-10-06，一笔 500.00，实报 400.00 + 坏账 100.00 */
  insertDone('o3', 50000, '2026-10-06', 40000)
  insertDerived('d2', 'income', 40000, '2026-10-06', incomeId)
  insertDerived('d3', 'expense', 10000, '2026-10-06', badDebtId)

  const list = await reimbMod.listReimburseBatches()
  check('两批老数据 → 2 张历史单', list.length, 2)
  ok('两张都标成 legacy', list.every((b) => b.isLegacy === true))

  const [first, second] = list // 按报销日倒序：10-06 在前
  check('最新一张是 10-06', first.day, '2026-10-06')
  check('10-06 笔数 = 1', first.txnCount, 1)
  check('10-06 实报 = 40000', first.doneCents, 40000)
  check('10-06 原支出 = 50000', first.originCents, 50000)
  check('10-06 派生归位 2 笔（到账 + 坏账）', first.derived.map((t) => t.id).sort(), ['d2', 'd3'])

  check('10-05 笔数 = 2', second.txnCount, 2)
  check('10-05 实报 = 30000', second.doneCents, 30000)
  check('10-05 原支出 = 30000', second.originCents, 30000)
  check('10-05 派生归位 1 笔', second.derived.map((t) => t.id), ['d1'])
  check('10-05 明细是那两笔', second.items.map((t) => t.id).sort(), ['o1', 'o2'])

  /*
   * ★ 同一天同账户、实报金额不同的两批，绝不能被合成一张单 ★
   *   这正是 v23 不回填的理由之一：不完整的痕迹只能拼出「像」的，
   *   拼错时用户看不出来。这里守着兜底逻辑至少把不同实报金额分开。
   */
  const insertDone2 = (id, amount, doneCents) => {
    const ts = new Date('2026-10-07T09:00:00').getTime()
    const rd = new Date('2026-10-07T12:00:00').getTime()
    db.prepare(
      `INSERT INTO txn (id, type, amount_cents, account_id, note,
        occurred_at, occurred_day, month_key, year_key, tz_offset,
        created_at, updated_at, deleted_at, exclude_from_budget, exclude_from_stats,
        reimburse_status, reimburse_day, reimburse_amount_cents, reimburse_account_id, batch_id)
       VALUES (?, 'expense', ?, 'acc1', '', ?, '2026-10-07', '2026-10', '2026', 480,
         ?, ?, NULL, 1, 1, 2, '2026-10-07', ?, 'acc1', NULL)`
    ).run(id, amount, ts, rd, rd, doneCents)
  }
  insertDone2('o4', 10000, 10000)
  insertDone2('o5', 20000, 20000)

  const list2 = await reimbMod.listReimburseBatches()
  const day07 = list2.filter((b) => b.day === '2026-10-07')
  check('同一天同账户、实报金额不同 → 拆成 2 张单', day07.length, 2)
  check('两张单的实报金额分别对', day07.map((b) => b.doneCents).sort((a, b) => a - b), [10000, 20000])
  check('两张单各 1 笔', day07.map((b) => b.txnCount).sort(), [1, 1])

  /*
   * ★ v21 之前报销的老数据：没有 reimburse_amount_cents ★
   *   那个年代页面口径是「拿原支出当实报」。
   *   兜底必须照同一条口径来：实报 = 原支出合计，
   *   而不是显示成「实报 ¥0.00」（那会让人以为钱没到账）。
   */
  const insertNoDone = (id, amount, day) => {
    const ts = new Date(`${day}T09:00:00`).getTime()
    db.prepare(
      `INSERT INTO txn (id, type, amount_cents, account_id, note,
        occurred_at, occurred_day, month_key, year_key, tz_offset,
        created_at, updated_at, deleted_at, exclude_from_budget, exclude_from_stats,
        reimburse_status, reimburse_day, reimburse_amount_cents, reimburse_account_id, batch_id)
       VALUES (?, 'expense', ?, 'acc1', '', ?, ?, ?, ?, 480, ?, ?, NULL, 1, 1, 2, ?, NULL, 'acc1', NULL)`
    ).run(id, amount, ts, day, day.slice(0, 7), day.slice(0, 4), ts, ts, day)
  }
  insertNoDone('o6', 8000, '2026-09-20')
  insertNoDone('o7', 2000, '2026-09-20')

  const list3 = await reimbMod.listReimburseBatches()
  const sep = list3.find((b) => b.day === '2026-09-20')
  ok('没有实报金额的老数据也拼出一张单', !!sep)
  if (sep) {
    check('实报金额按原支出合计兜底（不是 0）', sep.doneCents, 10000)
    check('原支出合计 = 10000', sep.originCents, 10000)
    check('笔数 = 2', sep.txnCount, 2)
  }

  /* 兜底是只读的：不写库 */
  const stillNull = db.prepare(
    'SELECT COUNT(*) AS c FROM txn WHERE reimburse_status = 2 AND batch_id IS NULL'
  ).get()
  check('兜底没有偷偷回填 batch_id', Number(stillNull.c), 7)
  check('兜底也没有造出报销单行', countOf(db, 'reimburse_batch'), 0)
}

/* ==================== 7. 备份导出 / 导入带上报销单 */

console.log('=== 7. 备份导出导入带 reimburse_batch 与 batch_id ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, 'acc1', '工资卡')
  const { reimbMod, dbMod } = await loadModules(fake)

  insertExpense(db, { id: 'e1', amount: 30000, accountId: 'acc1', day: '2026-11-01' })
  insertExpense(db, { id: 'e2', amount: 20000, accountId: 'acc1', day: '2026-11-02' })
  const r = await reimbMod.reimburseTxns({
    ids: ['e1', 'e2'], totalCents: 45000, accountId: 'acc1', day: '2026-11-08'
  })

  const backup = await import('../api/backup.js?t=' + Math.random())
  const json = await backup.exportToJson({ includeApiKey: false })
  const payload = JSON.parse(json)

  ok('导出包里有 reimburseBatches', Array.isArray(payload.reimburseBatches))
  check('导出的报销单 1 张', payload.reimburseBatches.length, 1)
  check('导出 counts 里也有', payload.counts.reimburseBatches, 1)
  const exportedTxn = payload.transactions.find((t) => t.id === 'e1')
  check('导出的交易带着 batch_id', exportedTxn.batch_id, r.batchId)
  const exportedDerived = payload.transactions.find((t) => t.category_id && t.type === 'income')
  ok('导出的派生流水也带 batch_id', exportedDerived && exportedDerived.batch_id === r.batchId)

  /* 清库后导入回来 */
  await dbMod.truncateAll()
  check('清空后报销单为空', countOf(db, 'reimburse_batch'), 0)

  const report = await backup.importPayload(payload, { mode: 'overwrite', skipBeforeBackup: true })
  check('导入报告：1 张报销单', report.reimburseBatches, 1)
  check('导入后报销单回来了', countOf(db, 'reimburse_batch'), 1)

  const list = await reimbMod.listReimburseBatches()
  const live = list.filter((b) => !b.isLegacy)
  check('恢复后列表里还是 1 张真单（不靠 legacy 兜底）', live.length, 1)
  if (live.length === 1) {
    check('恢复后笔数仍 = 2', live[0].txnCount, 2)
    check('恢复后实报金额仍 = 45000', live[0].doneCents, 45000)
    check('恢复后原支出合计仍 = 50000', live[0].originCents, 50000)
    check('恢复后派生仍归位（到账 + 坏账）', live[0].derived.length, 2)
  }

  /* ---------- 旧备份（没有 reimburseBatches 段）也要能导入 ---------- */
  const oldPayload = JSON.parse(json)
  delete oldPayload.reimburseBatches
  delete oldPayload.counts.reimburseBatches
  oldPayload.transactions = oldPayload.transactions.map((t) => {
    const copy = { ...t }
    delete copy.batch_id
    return copy
  })

  let err = null
  try {
    await backup.importPayload(oldPayload, { mode: 'overwrite', skipBeforeBackup: true })
  } catch (e) { err = e }
  check('旧备份（无报销单）导入不报错', err, null)
  check('旧备份导入后没有报销单行', countOf(db, 'reimburse_batch'), 0)

  const legacyList = await reimbMod.listReimburseBatches()
  const legacyCards = legacyList.filter((b) => b.isLegacy)
  check('旧备份的已报销流水靠 legacy 兜底仍能看到 1 张单', legacyCards.length, 1)
  if (legacyCards.length === 1) {
    check('兜底单笔数 = 2', legacyCards[0].txnCount, 2)
    check('兜底单实报金额 = 45000', legacyCards[0].doneCents, 45000)
  }
}

/* ==================== 8. truncateAll 覆盖新表 */

console.log('=== 8. truncateAll 清空 reimburse_batch ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, 'acc1')
  const { reimbMod, dbMod } = await loadModules(fake)

  insertExpense(db, { id: 'e1', amount: 10000, accountId: 'acc1' })
  await reimbMod.reimburseTxns({
    ids: ['e1'], totalCents: 10000, accountId: 'acc1', day: '2026-11-08'
  })
  check('清空前有 1 张单', countOf(db, 'reimburse_batch'), 1)

  const res = await dbMod.truncateAll()
  check('清空后报销单表为空', countOf(db, 'reimburse_batch'), 0)
  check('清空没有报「表不存在」', res.missing.includes('reimburse_batch'), false)
  check('清空后流水也没了', countOf(db, 'txn'), 0)
}

/* ==================== 9. 页面：已报销 tab 是报销单卡片 */

console.log('=== 9. 页面接线（已报销 = 报销单卡片）===')

{
  const page = read('pages/loan/reimburse.vue')

  check('已报销 tab 用 listReimburseBatches', /listReimburseBatches/.test(page), true)
  check('待报销 tab 仍用 listReimburseTxns', /listReimburseTxns\s*\(\s*'pending'\s*\)/.test(page), true)
  check('卡片循环 batches', /v-for="b in batches"/.test(page), true)
  check('卡头有实报金额（大号）', /class="batch-done-amount"/.test(page), true)
  check('卡头有报销时间', /class="batch-day"/.test(page), true)
  check('卡头有到账账户', /class="batch-account[^"]*"/.test(page), true)
  check('卡身有报销笔数', /报销笔数/.test(page), true)
  check('卡身有报销金额', /报销金额/.test(page), true)
  check('明细里原金额划删除线', /class="batch-origin-strike"/.test(page), true)
  /* ★ 用户要求：明细里不再重复显示实报金额 ★ */
  check('明细里不再显示实报金额', /reimburse_amount_cents/.test(page), false)
  check('派生流水标注「不计入笔数」', /不计入笔数/.test(page), true)
  check('派生流水不划删除线（用 MoneyText）', /txn-item-derived[\s\S]{0,2000}?<MoneyText/.test(page), true)
  check('待报销 tab 的金额不划删除线', /class="amount-pending"/.test(page), true)
}

/* ============================ 10. 撤销报销单 */

console.log('=== 10. 撤销报销单：删派生流水 + 原始流水退回未报销 ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, 'acc1', '工资卡')
  const { reimbMod } = await loadModules(fake)

  /*
   * ★ 用户本轮要求的两件事 ★
   *   1) 删除该报销单的「报销到账」「报销盈余」「报销坏账」记录；
   *   2) 把该报销单已报销的流水切换为未报销。
   *
   * 这里造一张带坏账的单（原支出 1000、实报 900），
   * 这样派生流水里会有两种（到账 + 坏账），
   * 比只有到账的场景更能验证「该删的都删了」。
   */
  insertExpense(db, { id: 'v1', amount: 40000, accountId: 'acc1', day: '2026-11-01' })
  insertExpense(db, { id: 'v2', amount: 60000, accountId: 'acc1', day: '2026-11-02' })

  const r = await reimbMod.reimburseTxns({
    ids: ['v1', 'v2'], totalCents: 90000, accountId: 'acc1', day: '2026-11-08'
  })
  check('造单：坏账 100.00', r.badDebtCents, 10000)

  const beforeAlive = db.prepare(
    'SELECT COUNT(*) AS c FROM txn WHERE batch_id = ? AND deleted_at IS NULL'
  ).get(r.batchId).c
  check('撤销前活着 4 笔（2 原始 + 到账 + 坏账）', Number(beforeAlive), 4)

  /*
   * ★ 余额预期要把「原始支出」也算进去 ★
   *   原始支出 v1+v2 = 1000.00 也记在 acc1 上（钱确实花出去了），
   *   所以：-1000（原支出）+ 900（到账）- 100（坏账） = -200.00
   *   一开始只想到到账与坏账，忘了原始支出也在同一个账户上。
   */
  const balBefore = Number(db.prepare("SELECT balance_cents FROM account WHERE id='acc1'").get().balance_cents)
  check('撤销前余额 = -200.00（原支出 -1000 + 到账 900 - 坏账 100）', balBefore, -20000)

  const out = await reimbMod.voidReimburseBatch(r.batchId)
  check('返回删了 2 笔派生流水', out.deletedDerived, 2)
  check('返回退回 2 笔原始流水', out.restoredItems, 2)

  const derivedAlive = db.prepare(
    'SELECT COUNT(*) AS c FROM txn WHERE batch_id = ? AND deleted_at IS NULL'
  ).get(r.batchId).c
  check('单下再没有活着的流水', Number(derivedAlive), 0)

  /*
   * ★ 派生流水的时间 = 保存时刻，不是 12:00（用户本轮第 1 条）★
   *   用户原话：「报销订单时，报销返回/盈余/坏账的交易时间
   *   设置为保存时刻，不要默认 12:00」。
   *
   *   这里报销日是 2026-11-08（过去的日子），
   *   所以落库时间应当是「2026-11-08 + 保存时的时分」，
   *   不应当是 12:00。而且因为不是今天，也不可能命中“当前时刻”。
   */
  const derivedRows = db.prepare(
    `SELECT t.occurred_at, t.occurred_day, c.name AS cat
     FROM txn t LEFT JOIN category c ON c.id = t.category_id
     WHERE t.batch_id = ?`
  ).all(r.batchId).filter((x) => ['报销到账', '报销坏账', '报销盈余'].includes(x.cat))
  ok('派生流水有 2 笔', derivedRows.length === 2)
  for (const d of derivedRows) {
    check(`派生「${d.cat}」日期跟报销日`, d.occurred_day, '2026-11-08')
    const hh = new Date(Number(d.occurred_at)).getHours()
    const mm = new Date(Number(d.occurred_at)).getMinutes()
    ok(`派生「${d.cat}」不是 12:00`, !(hh === 12 && mm === 0))
  }

  const softDeleted = db.prepare(
    `SELECT t.id FROM txn t LEFT JOIN category c ON c.id = t.category_id
     WHERE t.deleted_at IS NOT NULL
       AND c.name IN ('报销到账','报销坏账','报销盈余')`
  ).all()
  check('到账 + 坏账都被软删除', softDeleted.length, 2)

  /*
   * ★ 撤销后回到「待报销」（用户反馈修正）★
   *   上一版置成 status=0，结果这几笔在报销页两个 tab
   *   （待报销只查 1、已报销只查 2）都不显示，
   *   用户看起来就像“流水被删了”。
   *   现在应当回到 1，且两个 exclude 重新置 1
   *   （待报销的标准状态：钱还没回来，不计收支、不占预算）。
   */
  for (const id of ['v1', 'v2']) {
    const t = db.prepare('SELECT * FROM txn WHERE id = ?').get(id)
    check(`原始流水 ${id} 退回待报销`, Number(t.reimburse_status), 1)
    check(`原始流水 ${id} 的 batch_id 已清`, t.batch_id, null)
    check(`原始流水 ${id} 的报销日期已清`, t.reimburse_day, null)
    check(`原始流水 ${id} 的实报金额已清`, t.reimburse_amount_cents, null)
    check(`原始流水 ${id} 仍不计收支`, Number(t.exclude_from_stats), 1)
    check(`原始流水 ${id} 仍不占预算`, Number(t.exclude_from_budget), 1)
    check(`原始流水 ${id} 金额不变`, Number(t.amount_cents), id === 'v1' ? 40000 : 60000)
  }

  /*
   * ★ 最关键的一条：它们应当回到「待报销」列表里 ★
   *   这才是用户看得到的结果。
   */
  const pendingList = await reimbMod.listReimburseTxns('pending')
  check('撤销后这两笔回到待报销列表', pendingList.map((t) => t.id).sort(), ['v1', 'v2'])

  const batchRow = db.prepare('SELECT deleted_at FROM reimburse_batch WHERE id = ?').get(r.batchId)
  ok('单头被软删除', batchRow.deleted_at !== null && batchRow.deleted_at !== undefined)
  const list = await reimbMod.listReimburseBatches()
  check('撤销后已报销列表为空', list.length, 0)

  /*
   * 撤销后：到账 900 与坏账 100 都没了，只剩原始支出 1000，
   * 所以余额变成 -1000.00。
   * ★ 这恰好证明撤销是对的 ★
   *   钱确实花了（原支出还在），而公司打回的那 900 被扣回去了。
   */
  const balAfter = Number(db.prepare("SELECT balance_cents FROM account WHERE id='acc1'").get().balance_cents)
  check('撤销后余额 = -1000.00（只剩原始支出）', balAfter, -100000)
}

console.log('=== 10b. 撤销的护栏 ===')

{
  const { fake, db } = makeFakePlus()
  insertAccount(db, 'acc1')
  const { reimbMod } = await loadModules(fake)

  let err = null
  try { await reimbMod.voidReimburseBatch('nope') } catch (e) { err = e.message }
  ok('单不存在时报错', !!err && /不存在|已撤销/.test(err))

  err = null
  try { await reimbMod.voidReimburseBatch('') } catch (e) { err = e.message }
  ok('空 id 时报错', !!err && /缺少/.test(err))

  /*
   * ★ 历史单不能撤销 ★
   *   它们没有真正的单头，只是按「报销日 + 账户 + 实报」拼出来的只读视图。
   *   撤销它等于要反推一次历史操作，反推错会把用户的账搅乱。
   */
  err = null
  try { await reimbMod.voidReimburseBatch('legacy_2026-11-01|acc1|90000') } catch (e) { err = e.message }
  ok('历史单拒绝撤销', !!err && /历史/.test(err))

  insertExpense(db, { id: 'twice1', amount: 10000, accountId: 'acc1' })
  const r2 = await reimbMod.reimburseTxns({
    ids: ['twice1'], totalCents: 10000, accountId: 'acc1', day: '2026-11-08'
  })
  await reimbMod.voidReimburseBatch(r2.batchId)
  err = null
  try { await reimbMod.voidReimburseBatch(r2.batchId) } catch (e) { err = e.message }
  ok('重复撤销报错（单已删）', !!err && /不存在|已撤销/.test(err))
}

console.log('=== 10c. 页面：撤销按钮与确认弹窗 ===')

{
  const page = read('pages/loan/reimburse.vue')

  /*
   * ★ 应报改到「N 笔」之后的同一行，撤销按钮挪到卡尾（用户本轮）★
   *   用户原话：「应报显示在 X 笔之后「· 应报 ￥ XX.XX」，
   *   实报上，移撤按钮切换为「撤销本报销单」按钮，显示在下方」。
   */
  check(
    '应报在「N 笔」之后',
    /class="batch-count">[^<]*txnCount[^<]*笔\s*<\/text>\s*<text class="batch-origin-inline"/.test(page),
    true
  )
  /*
   * ★ 撤销按钮在实报金额下方（用户本轮明确）★
   *   用户原话：「『撤销本报销单』按钮，我指的是显示在实报金额下方」。
   *   不是卡尾、不是应报金额后面 —— 而是右列里紧跟着实报那个大数字。
   */
  /*
   * ★ 用位置比较而不是正则跨段匹配 ★
   *   两者之间隔着一大段注释与模板，正则写长了容易断，
   *   写短了又可能匹配到别处。直接比两个类名的出现位置最直接。
   */
  check(
    '撤销按钮在实报金额之后',
    page.indexOf('class="batch-void-btn"') > page.indexOf('class="batch-done-amount"'),
    true
  )
  check(
    '撤销按钮仍在卡头区域内（明细之前）',
    page.indexOf('class="batch-void-btn"') < page.indexOf('class="batch-items"'),
    true
  )
  check('不再有卡尾那一行', /class="batch-foot"/.test(page), false)
  check('按钮文案是「撤销本报销单」', /撤销本报销单/.test(page), true)
  check('撤销按钮绑了处理函数', /@click\.stop="onVoidBatch\(b\)"/.test(page), true)
  check('历史单不显示撤销按钮', /v-if="!b\.isLegacy"[\s\S]{0,160}?batch-void-btn/.test(page), true)
  check('点击后弹确认框', /confirmDialog\(/.test(page), true)
  check('确认框用危险色', /danger:\s*true/.test(page), true)
  /*
   * ★ 确认框只留一句话（用户本轮要求）★
   *   用户原话：「撤销确认面板只显示确认撤销这次报销？
   *   多余文字不要显示」。
   *   之前正文列了三行（删几笔 / 退回几笔 / 钱会扣掉），现在 content 留空。
   */
  check('确认框正文为空（不显示多余文字）', /title:\s*'确认撤销这次报销？'[\s\S]{0,120}?content:\s*''/.test(page), true)
  check('确认后调 voidReimburseBatch', /voidReimburseBatch\(b\.id\)/.test(page), true)
  check('撤销后重新加载列表', /onVoidBatch[\s\S]{0,1200}?await load\(\)/.test(page), true)
  check('API 已导出 voidReimburseBatch', /export async function voidReimburseBatch/.test(reimbSrc), true)
  /*
   * ★ 撤销按钮与手动结清按钮样式一致（用户本轮第 4 条）★
   *   font-size 22rpx、padding 6rpx 18rpx、border-radius 14rpx、1rpx 描边、透明底。
   *   颜色由模板内联传入（主题色）。
   */
  check(
    '撤销按钮样式与手动结清一致',
    /\.batch-void-btn\s*\{[\s\S]{0,220}?font-size:\s*22rpx[\s\S]{0,160}?padding:\s*6rpx 18rpx[\s\S]{0,120}?border-radius:\s*14rpx/.test(page),
    true
  )
  check(
    '撤销按钮用主题色',
    /class="batch-void-btn"[\s\S]{0,120}?:style="\{ borderColor: primaryColor, color: primaryColor \}"/.test(page),
    true
  )
  check(
    '实报金额用主题色',
    /class="batch-done-amount"[\s\S]{0,320}?:color="primaryColor"/.test(page),
    true
  )
}

/* ------------------------------------------------------------ */

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
