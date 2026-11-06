/**
 * 覆盖导入（importPayload overwrite）的分类兜底测试
 *
 *   node scripts/test-import-fallback.mjs
 *
 * ★ 背景 ★
 *   importPayload 的 overwrite 分支先 truncateAll() 把库清空，再按
 *   payload.categories 逐条 INSERT。如果备份包本身没有分类
 *   （老版本导出的、被手工裁过的、只有流水的半成品），
 *   导入完成后分类表就是空的 —— 用户看到「导入成功，但全是未分类」。
 *
 *   所以修完之后 overwrite 分支必须：
 *     truncateAll() → seedDefaultCategories() → 逐表导入 → syncDefaultCategories()
 *
 * ★ 这个测试守什么 ★
 *   1. 静态：上面四步的顺序，以及 seed / sync 都被 try 住
 *   2. 真库：一份「没有分类」的备份导入后，分类表不为空，且是全新安装的条数
 *   3. 真库：一份「带分类」的备份导入后，不会因为 seed 而出现重复分类
 */

import { readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

import {
  SCHEMA_V1,
  SCHEMA_VERSION,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  SYSTEM_PRESET_CHILDREN
} from '../api/db/schema.js'

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

/**
 * 抠出函数体（括号配对，避免正则截断在第一个 `}`）。
 *
 * ★ 为什么要先跳过参数表 ★
 *   importPayload(payload, opt = {}) 的参数里就有一个 `{}`，
 *   直接从函数名后面找第一个 `{` 会停在默认值上，
 *   抠出来只有 1 个字符，后面所有断言都会莫名其妙地失败。
 */
function extractFunctionBody(src, name, kind = 'function') {
  const re = kind === 'async'
    ? new RegExp(`async\\s+function\\s+${name}\\s*\\(`)
    : new RegExp(`function\\s+${name}\\s*\\(`)
  const m = re.exec(src)
  if (!m) return ''

  // 先走到参数表的右括号，再找函数体左花括号
  let i = m.index + m[0].length - 1 // 此时正好停在开括号上
  if (i < 0 || src[i] !== '(') return ''
  let pd = 0
  for (; i < src.length; i++) {
    if (src[i] === '(') pd++
    else if (src[i] === ')') {
      pd--
      if (pd === 0) break
    }
  }

  i = src.indexOf('{', i)
  if (i === -1) return ''
  const start = i
  let depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start + 1, i)
    }
  }
  return ''
}

/** 去注释：静态断言只看真代码，注释里提到函数名不该算数 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

/* ---------------------------------------- 1) 静态：顺序与容错 */

console.log('=== importPayload 覆盖分支的顺序 ===')

const backupSrc = read('api/backup.js')
const importBody = extractFunctionBody(backupSrc, 'importPayload', 'async')
const importCode = stripComments(importBody)

ok('找得到 importPayload', importBody.length > 0)
ok('覆盖分支调用了 truncateAll()', /truncateAll\s*\(\s*\)/.test(importCode))
ok('覆盖分支调用了 seedDefaultCategories()', /seedDefaultCategories\s*\(\s*\)/.test(importCode))
ok('导入结束后调用了 syncDefaultCategories()', /syncDefaultCategories\s*\(\s*\)/.test(importCode))

const iTruncate = importCode.search(/truncateAll\s*\(\s*\)/)
const iSeed = importCode.search(/seedDefaultCategories\s*\(\s*\)/)
const iInsertCat = importCode.search(/INSERT INTO category/)
const iSync = importCode.search(/syncDefaultCategories\s*\(\s*\)/)

check('顺序：truncateAll 先于 seed', iTruncate >= 0 && iTruncate < iSeed, true)
check('顺序：seed 先于分类落库', iSeed >= 0 && iSeed < iInsertCat, true)
check('顺序：分类落库先于 sync（sync 在导入之后）', iInsertCat >= 0 && iInsertCat < iSync, true)

/*
 * ★ 两处都必须 try 住 ★
 *   导入是主操作：补分类失败（磁盘满、库异常）不能把已经导进来的数据判成失败。
 */
ok(
  'seed 被 try 住',
  /try\s*\{[\s\S]{0,200}?seedDefaultCategories\s*\(\s*\)[\s\S]{0,400}?catch/.test(importCode)
)
ok(
  'sync 被 try 住',
  /try\s*\{[\s\S]{0,200}?syncDefaultCategories\s*\(\s*\)[\s\S]{0,400}?catch/.test(importCode)
)

/*
 * ★ 备份包自带分类时要先撤掉 seed 那份 ★
 *   category 表主键是 uuid，name+type+parent_id 上没有唯一约束，
 *   seed 的同名分类和备份里的同名分类会并排存两行。
 */
ok(
  '备份带分类时先清掉 seed 的垫底数据',
  /payload\.categories\.length\s*>\s*0[\s\S]{0,200}?DELETE FROM category/.test(importCode)
)

ok(
  'sync 出现在 recalcAllBalances 之后（导入事务已提交）',
  importCode.search(/recalcAllBalances\s*\(\s*\)/) < iSync
)

/* ---------------------------------------- 2) 真库 */

console.log('=== 真库：没有分类的备份导入后分类不为空 ===')

const schemaTables = []
for (const sql of SCHEMA_V1) {
  const m = /CREATE TABLE IF NOT EXISTS\s+(\w+)/i.exec(sql)
  if (m) schemaTables.push(m[1])
}

/**
 * 只存在于迁移里的表。
 * 从 db/index.js 的 DDL 里抠，不手写第二份 ——
 * 迁移加表时测试会自动跟上。
 */
const dbIndexSrc = read('api/db/index.js')
const migrationTables = []
const ddlRe = /`(CREATE TABLE IF NOT EXISTS (\w+) \([\s\S]*?\))`/g
let dm
while ((dm = ddlRe.exec(dbIndexSrc)) !== null) {
  if (!schemaTables.includes(dm[2])) migrationTables.push(dm[2])
}

/**
 * 假 plus.sqlite，代理到 node:sqlite。
 *
 * ★ 事务要按层数模拟，不能每条 begin 都真发 BEGIN ★
 *   importPayload 自己开了一笔事务，里面的 setSettings() 又调了一次
 *   transaction() —— 真发两次 BEGIN 会报
 *   "cannot start a transaction within a transaction"，
 *   而这跟我们要测的东西毫无关系。
 *   这里只在最外层真发 BEGIN/COMMIT，内层当无操作。
 */
function makeFakePlus() {
  const db = new DatabaseSync(':memory:')
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)

  for (const sql of SCHEMA_V1) db.exec(sql)
  for (const t of migrationTables) {
    const m = new RegExp('`(CREATE TABLE IF NOT EXISTS ' + t + ' \\([\\s\\S]*?\\))`').exec(dbIndexSrc)
    if (m) db.exec(m[1])
  }

  /*
   * ★ 补上「迁移里 ALTER 加出来的列」★
   *   这里的库是按 schema.js + 迁移 DDL 直接搭的，且 user_version 已经是 17，
   *   所以 migrate() 不会再跑，那些 ALTER 加出来的列就缺了。
   *   importPayload 会往这些列写值（tnx.cycle_id 存「这笔是哪个周期记的」），
   *   不补会报 "table txn has no column named cycle_id"，
   *   而这跟本测试要验证的分类兜底毫无关系。
   */
  const extraCols = [
    'ALTER TABLE txn ADD COLUMN cycle_id TEXT',
    'ALTER TABLE txn ADD COLUMN via_combo_id TEXT',
    'ALTER TABLE cycle ADD COLUMN last_caught_up_day TEXT'
  ]
  for (const sql of extraCols) {
    try {
      db.exec(sql)
    } catch (e) {}
  }

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
  return { fake, db }
}

const countOf = (db, t) => Number(db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c)

// 全新安装会写入的默认分类条数
const expectedCategories =
  DEFAULT_EXPENSE_CATEGORIES.length +
  DEFAULT_INCOME_CATEGORIES.length +
  [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES].reduce(
    (n, c) => n + c.children.length,
    0
  ) +
  2 +
  SYSTEM_PRESET_CHILDREN.length

// 一份最小的合法备份骨架（validatePayload 只要求 app + schemaVersion）
function makePayload(overrides = {}) {
  return {
    app: 'books',
    schemaVersion: 2,
    settings: { ai: { apiKey: '' } },
    accounts: [{ id: 'a1', name: '现金', type: 'cash', balance_cents: 0 }],
    accountSnapshots: [],
    categories: [],
    tags: [],
    transactions: [],
    txnTags: [],
    budgets: [],
    cycles: [],
    comboMembers: [],
    ...overrides
  }
}

{
  /*
   * ★ 第一次 import 会真正打开 db 模块（openDb 里有 opened 缓存）★
   *   fake plus 每次换成新的库实例，db 模块的 call() 是调用时取 globalThis.plus，
   *   所以同一进程里换库没问题。
   */
  const { fake, db } = makeFakePlus()
  globalThis.plus = fake

  const { importPayload } = await import('../api/backup.js?t=' + Math.random())
  const { listCategories } = await import('../api/category.js?t=' + Math.random())

  // 先在库里放点「要清掉」的旧数据
  db.exec(`INSERT INTO category (id, parent_id, name, type, sort, hidden, created_at, updated_at)
           VALUES ('old1', NULL, '旧分类', 'expense', 0, 0, 1, 1)`)

  // 1) 没有分类的备份
  const report = await importPayload(
    makePayload({
      transactions: [
        {
          id: 't1', type: 'expense', amount_cents: 100, account_id: 'a1',
          occurred_at: 1, occurred_day: '2026-11-01', month_key: '2026-11', year_key: '2026'
        }
      ]
    }),
    { mode: 'overwrite', skipBeforeBackup: true }
  )

  check('导入报告：1 笔流水', report.transactions, 1)
  check('导入报告：0 个分类（备份里没有）', report.categories, 0)
  check('备份里的旧分类被清掉了', countOf(db, 'category') === expectedCategories, true)
  check('分类表不为空（补了默认分类）', countOf(db, 'category') > 0, true)
  check('补回的就是全新安装那一份', countOf(db, 'category'), expectedCategories)

  const cats = await listCategories()
  ok('支出分类可用', cats.filter((c) => c.type === 'expense').length > 0)
  ok('收入分类可用', cats.filter((c) => c.type === 'income').length > 0)
  ok(
    '「系统分类」组也在',
    cats.some((c) => c.name === '系统分类' && !c.parent_id)
  )

  // 2) 带分类的备份：不能因为 seed 而出现重复
  const seededCats = db.prepare('SELECT * FROM category').all()
  const backupCats = seededCats
    .filter((c) => c.deleted_at === null || c.deleted_at === undefined)
    .map((c) => ({
      // 换成另一套 id，模拟「备份里是用户自己的分类」
      id: 'bk_' + c.id,
      parent_id: c.parent_id ? 'bk_' + c.parent_id : null,
      name: c.name,
      type: c.type,
      icon: c.icon,
      color: c.color,
      sort: c.sort,
      hidden: c.hidden,
      created_at: c.created_at,
      updated_at: c.updated_at,
      deleted_at: null
    }))

  const report2 = await importPayload(
    makePayload({ categories: backupCats }),
    { mode: 'overwrite', skipBeforeBackup: true }
  )

  check('带分类的备份全量写入', report2.categories, backupCats.length)
  /*
   * ★ 这条是「不能翻倍」的守卫 ★
   *   如果只是在 truncateAll() 之后 seed、却不撤掉 seed 那份，
   *   这里会是 backupCats.length + expectedCategories，每个分类出现两次。
   */
  check('带分类导入后不重复', countOf(db, 'category'), backupCats.length)

  const names = db.prepare('SELECT name, type, parent_id, COUNT(*) AS c FROM category GROUP BY name, type, parent_id HAVING c > 1').all()
  check('没有同名同级的重复分类', names.length, 0)
}

/* ------------------------------------------------------------ */

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
