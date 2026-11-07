/**
 * 「清空所有数据后分类为空，必须杀进程重进才恢复」的回归测试
 *
 *   node scripts/test-clear-all.mjs
 *
 * ★ 背景（bug 是怎么发生的）★
 *   默认分类只有两个地方会写：
 *     1) App.vue 的 onLaunch → seedDefaultCategories() + syncDefaultCategories()
 *     2) api/db/index.js 的迁移 v5
 *   清空数据页（pages/settings/data.vue）调 truncateAll() 把 category 表删干净后
 *   只调了 uni.reLaunch() 重启页面栈 —— 而 reLaunch **不会重跑 App 的 onLaunch**，
 *   App 进程还活着，onLaunch 只跑过一次。
 *   于是分类表一直是空的，分类页/记账面板都读不到任何分类；
 *   用户杀掉进程重进，onLaunch 才补上默认分类 —— 这就是「重进才能加载」。
 *
 * ★ 这个测试守三件事 ★
 *   1. onClearAll() 在 truncateAll() 之后确实 seed + sync 了（静态断言顺序）
 *   2. truncateAll() 覆盖了库里**所有**表（漏一张就是漏一份数据没清掉）
 *   3. seed / sync 是真能在「刚被清空的空库」上把默认分类写回来的（真 SQLite 跑）
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
 * 从源码里抠出某个函数的函数体。
 *
 * ★ 为什么要括号配对而不是正则 ★
 *   onClearAll 里嵌了 try/catch 和 if，正则匹配到第一个 `}` 就截断了，
 *   断在 catch 之前会让「失败也要清空」这类断言变成假通过。
 */
function extractFunctionBody(src, name) {
  const m = new RegExp(`function\\s+${name}\\s*\\(`).exec(src)
  if (!m) return ''
  let i = src.indexOf('{', m.index + m[0].length)
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

/** 去掉注释，静态断言只看真代码（注释里提到 truncateAll 也会造成误判） */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

const dataVue = read('pages/settings/data.vue')
const dbIndex = read('api/db/index.js')

/* ------------------------------------------------ 1) onClearAll 的顺序 */

console.log('=== 清空后必须重新写入默认分类 ===')

const clearBody = extractFunctionBody(dataVue, 'onClearAll')
const clearCode = stripComments(clearBody)

ok('找得到 onClearAll', clearBody.length > 0)
ok('清空数据调用 truncateAll()', /truncateAll\s*\(\s*\)/.test(clearCode))
ok(
  '清空后调用了 seedDefaultCategories()',
  /seedDefaultCategories\s*\(\s*\)/.test(clearCode)
)
ok(
  '清空后调用了 syncDefaultCategories()',
  /syncDefaultCategories\s*\(\s*\)/.test(clearCode)
)

/*
 * ★ 顺序断言 ★
 *   必须在 truncateAll() **之后**写分类。
 *   写反了（先 seed 再清空）等于什么都没做，而且静态上看起来"两个函数都调了"，
 *   是最容易糊弄过去的一种错法。
 */
const iTruncate = clearCode.search(/truncateAll\s*\(\s*\)/)
const iSeed = clearCode.search(/seedDefaultCategories\s*\(\s*\)/)
const iSync = clearCode.search(/syncDefaultCategories\s*\(\s*\)/)
check('顺序：truncateAll 先于 seed', iTruncate >= 0 && iTruncate < iSeed, true)
check('顺序：seed 先于 sync', iSeed >= 0 && iSeed < iSync, true)

/*
 * ★ 补分类必须被 try 住 ★
 *   清空是主操作：即使分类补不回来（磁盘满、SQL 异常），
 *   也必须让「清空」这个动作完成，否则用户会看到「清空失败」而数据其实已经清了。
 *   这里断言 seed 出现在 truncateAll 之后的第一个 try 块里。
 */
ok(
  '补分类被 try 住（失败不影响清空）',
  /truncateAll\s*\(\s*\)[\s\S]{0,900}?try\s*\{[\s\S]{0,300}?seedDefaultCategories\s*\(\s*\)/.test(
    clearCode
  )
)

ok(
  'data.vue 从 api/category.js 引入了这两个函数',
  /import\s*\{[^}]*seedDefaultCategories[^}]*\}\s*from\s*['"]@\/api\/category\.js['"]/.test(
    dataVue
  ) &&
    /import\s*\{[^}]*syncDefaultCategories[^}]*\}\s*from\s*['"]@\/api\/category\.js['"]/.test(
      dataVue
    )
)

/* ------------------------------------- 2) truncateAll 覆盖所有表 */

console.log('=== truncateAll 要清掉库里的每一张表 ===')

const truncateBody = extractFunctionBody(dbIndex, 'truncateAll')
ok('找得到 truncateAll', truncateBody.length > 0)

/** schema.js 里 SCHEMA_V1 建的表 */
const schemaTables = []
for (const sql of SCHEMA_V1) {
  const m = /CREATE TABLE IF NOT EXISTS\s+(\w+)/i.exec(sql)
  if (m) schemaTables.push(m[1])
}

/**
 * 只存在于迁移里的表（v7 的 cycle、v9 的 cycle_skip）。
 * 直接从 db/index.js 的 DDL 里抠，不手写第二份 ——
 * 手写的话迁移加一张新表，测试不会跟着变，等于没守。
 */
const migrationTables = []
const ddlRe = /`(CREATE TABLE IF NOT EXISTS (\w+) \([\s\S]*?\))`/g
let dm
while ((dm = ddlRe.exec(dbIndex)) !== null) {
  if (!schemaTables.includes(dm[2])) migrationTables.push(dm[2])
}

const allTables = Array.from(new Set([...schemaTables, ...migrationTables]))
ok(`schema 里解析出建表语句（${schemaTables.length} 张）`, schemaTables.length >= 11)

for (const t of allTables) {
  ok(`truncateAll 清空了 ${t}`, new RegExp(`['"]${t}['"]`).test(truncateBody))
}

/*
 * ★ setting / app_meta 为什么也算「用户数据」★
 *   setting 存的是用户设置（含 AI key、默认账户），必须清。
 *   app_meta 是 KV 草稿表，现在只被自检写临时键 —— 留着也无害，
 *   但「清空」语义上不该留下任何东西，所以一起清。
 *
 *   ★ 关键澄清 ★
 *     迁移版本号不在 app_meta 里，在 SQLite 库头的 PRAGMA user_version 里，
 *     所以 DELETE FROM app_meta 不会让迁移重跑。
 *     v5 迁移会把所有分类软删再重建 —— 万一真的重跑，
 *     刚补好的默认分类会被它换掉。这里把「两者无关」这一点钉死，
 *     免得以后有人把游标搬进 app_meta 却忘了这条约束。
 */
check('app_meta 与 setting 都在清空列表里', [
  /['"]setting['"]/.test(truncateBody),
  /['"]app_meta['"]/.test(truncateBody)
], [true, true])

/*
 * ★ 这里要查的就是注释 ★
 *   上一条断言用的是去注释后的源码（只看真代码），
 *   这一条反过来：必须能在注释里找到这段解释，
 *   免得以后有人把游标搬进 app_meta 却没人提醒。
 */
const truncateAt = dbIndex.indexOf('export async function truncateAll')
ok(
  'truncateAll 的注释写明了迁移游标是 PRAGMA user_version、不在 app_meta',
  truncateAt > 0 && /user_version/.test(dbIndex.slice(Math.max(0, truncateAt - 2000), truncateAt))
)

/*
 * ★ 表缺失不能把整个清空搞崩 ★
 *   cycle_skip / exchange_rate / cycle 是迁移建的。迁移失败只 console.error
 *   不阻断（见 migrate() 的注释），所以老设备上完全可能没有这几张表。
 *   那时 DELETE FROM cycle_skip 会抛 "no such table"，
 *   整笔清空事务回滚 —— 用户点了清空却什么都没发生。
 *   所以 truncateAll 里必须逐表容错。
 */
ok(
  'truncateAll 逐表容错（no such table 不致命）',
  /try\s*\{[\s\S]*?DELETE FROM[\s\S]*?catch/.test(stripComments(truncateBody))
)

/* ------------------------------------- 3) 真库：清空 → seed → sync */

console.log('=== 空库上 seed + sync 必须能补回默认分类 ===')

/** 用 node:sqlite 造一个真库，让假的 plus.sqlite 代理到它 */
function makeFakePlus() {
  const db = new DatabaseSync(':memory:')
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)

  // 建表：schema.js 的 11 张 + 迁移里的 cycle / cycle_skip / exchange_rate
  for (const sql of SCHEMA_V1) db.exec(sql)
  const seen = new Set(schemaTables)
  for (const t of migrationTables) {
    const m = new RegExp('`(CREATE TABLE IF NOT EXISTS ' + t + ' \\([\\s\\S]*?\\))`').exec(dbIndex)
    if (m && !seen.has(t)) {
      db.exec(m[1])
      seen.add(t)
    }
  }

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

const countOf = (db, t) => Number(db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c)

// 默认分类总条数：一级 + 二级 + 两个「系统分类」组 + 组下的固定子类
const expectedCategories =
  DEFAULT_EXPENSE_CATEGORIES.length +
  DEFAULT_INCOME_CATEGORIES.length +
  [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES].reduce(
    (n, c) => n + c.children.length,
    0
  ) +
  2 +
  SYSTEM_PRESET_CHILDREN.length

{
  const { fake, db } = makeFakePlus()
  globalThis.plus = fake

  const cat = await import('../api/category.js?t=' + Math.random())
  const dbMod = await import('../api/db/index.js?t=' + Math.random())

  // 1) 模拟一台正常使用的设备：分类、账户、流水、设置都有
  const seeded0 = await cat.seedDefaultCategories()
  check('新装设备写入默认分类', seeded0, expectedCategories)
  db.exec(
    `INSERT INTO account (id, name, type, created_at, updated_at)
     VALUES ('acc1', '现金', 'cash', 1, 1)`
  )
  db.exec(
    `INSERT INTO txn (id, type, amount_cents, account_id, occurred_at, occurred_day,
      month_key, year_key, created_at, updated_at)
     VALUES ('t1', 'expense', 100, 'acc1', 1, '2026-11-01', '2026-11', '2026', 1, 1)`
  )
  db.exec(`INSERT INTO setting (key, value) VALUES ('ai', '{}')`)
  db.exec(`INSERT INTO budget (id, scope, period, amount_cents, start_month, created_at, updated_at)
           VALUES ('b1', 'total', 'month', 100, '2026-11', 1, 1)`)

  // 2) 清空
  await dbMod.truncateAll()
  check('清空后分类表为空', countOf(db, 'category'), 0)
  check('清空后流水表为空', countOf(db, 'txn'), 0)
  check('清空后设置表为空', countOf(db, 'setting'), 0)

  /*
   * 3) 按 onClearAll 修好之后的顺序补分类
   *    ★ 这一步就是 bug 的现场 ★
   *      改之前这里不会发生，于是 categories 一直是 0；
   *      页面 reLaunch 后去读库，自然是空列表。
   */
  await cat.seedDefaultCategories()
  await cat.syncDefaultCategories()

  check('清空后默认分类被补回（条数 = 全新安装）', countOf(db, 'category'), expectedCategories)

  const expense = await cat.listCategories('expense')
  const income = await cat.listCategories('income')
  ok('支出分类不为空', expense.length > 0)
  ok('收入分类不为空', income.length > 0)

  // 固定分类组也要在（这是 seed + sync 一起才有的结果）
  const groupExpense = expense.find((c) => c.name === '系统分类' && !c.parent_id)
  ok('支出侧有「系统分类」组', !!groupExpense)
  /*
   * ★ v20 起系统分类全部可见可选 ★
   *   用户要求「所有的系统分类都可以手动记账 / AI 记账」，
   *   四个结清派生分类已经从 hidden 放开，listCategories 会返回它们，
   *   所以期望值不再按 hidden 过滤 —— 两边都列全。
   */
  const groupChildren = expense.filter((c) => c.parent_id === (groupExpense && groupExpense.id))
  check(
    '「系统分类」下挂着固定子类',
    groupChildren.map((c) => c.name).sort(),
    SYSTEM_PRESET_CHILDREN
      .filter((d) => d.type === 'expense')
      .map((d) => d.name)
      .sort()
  )

  // 4) 幂等：再跑一遍不能翻倍（onLaunch 下次启动还会跑这两句）
  const again = await cat.seedDefaultCategories()
  const report = await cat.syncDefaultCategories()
  check('分类已存在时 seed 不再写入', again, 0)
  check('再对齐一次不新增一级', report.parents, 0)
  check('再对齐一次不新增二级', report.children, 0)
  check('重复补分类不会翻倍', countOf(db, 'category'), expectedCategories)
}

/* ------------------------------------- 3b) 老用户的库：sync 不许塞默认分类 */

console.log('=== 老用户库上 sync 只补固定分类，不动用户自己的分类 ===')

{
  const { fake, db } = makeFakePlus()
  globalThis.plus = fake

  /*
   * ★ 这是「用户纠正过」的一条语义 ★
   *   默认分类表是**新用户**的产品内容（全新安装 / 清空数据时由 seed 写入）。
   *   老用户已经按自己的习惯整理过分类，启动时再按默认表补一遍，
   *   等于把别人的账本重新洗一遍。sync 只负责固定分类（改名 + 补子类），
   *   默认表一个字段都不该读。
   */
  const now = 1
  db.prepare(
    `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
     VALUES ('mine', NULL, '我自己的吃饭', 'expense', 'food', '#123456', 0, 0, ?, ?, NULL)`
  ).run(now, now)
  db.prepare(
    `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
     VALUES ('old_g', NULL, '系统预置分类', 'expense', 'more', '#969799', 999, 0, ?, ?, NULL)`
  ).run(now, now)

  const cat = await import('../api/category.js?t=' + Math.random())
  const report = await cat.syncDefaultCategories()

  /*
   * parents 这里不用断言成 0：收入侧那条组本来就不存在，建它是应该的。
   * 真正要守住的是「默认表里的名字一个都没被插进来」——
   * 那才是老用户被洗账本的地方。
   */
  const tops = db.prepare(
    'SELECT name, type FROM category WHERE deleted_at IS NULL AND parent_id IS NULL'
  ).all().map((r) => `${r.type}/${r.name}`)

  const defaultNames = [
    ...DEFAULT_EXPENSE_CATEGORIES.map((c) => `expense/${c.name}`),
    ...DEFAULT_INCOME_CATEGORIES.map((c) => `income/${c.name}`)
  ]
  check(
    'sync 没把默认分类表插进老用户的库',
    tops.filter((t) => defaultNames.includes(t)),
    []
  )
  check('用户的分类还在', tops.includes('expense/我自己的吃饭'), true)
  check('组被改名成「系统分类」', report.renamed, 1)

  const mine = db.prepare(
    "SELECT icon, color FROM category WHERE id = 'mine'"
  ).get()
  check('用户改过的图标/颜色没被覆盖', mine, { icon: 'food', color: '#123456' })
}

/* ------------------------------------- 4) 两个函数本身要存在且 async */

console.log('=== seedDefaultCategories / syncDefaultCategories ===')

{
  const { fake } = makeFakePlus()
  globalThis.plus = fake
  const cat = await import('../api/category.js?t=' + Math.random())

  check(
    'seedDefaultCategories 是 async 函数',
    typeof cat.seedDefaultCategories,
    'function'
  )
  check(
    'seedDefaultCategories 返回 Promise',
    cat.seedDefaultCategories.constructor.name,
    'AsyncFunction'
  )
  check(
    'syncDefaultCategories 是 async 函数',
    cat.syncDefaultCategories.constructor.name,
    'AsyncFunction'
  )
}

/* ------------------------------------------------------------ */

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
