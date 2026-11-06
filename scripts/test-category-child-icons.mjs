/**
 * 迁移 v6（二级分类独立图标）的测试
 *
 *   node scripts/test-category-child-icons.mjs
 *
 * ★ 背景 ★
 *   v5 建的分类表里，二级分类的 icon 直接继承了父级 ——
 *   「日常三餐」「奶茶饮料」「零食小吃」全是同一个 🍜。
 *   用户要求每个子类都能有自己的图标。
 *
 *   v6 的做法是**不重建分类表**（重建会打乱用户数据和历史交易引用），
 *   只按「一级分类名 + 二级分类名」把 icon 改对。
 *
 * 用 node:sqlite 造一个真的 SQLite 库，让假的 plus.sqlite 代理到它，
 * 这样 SQL 语义都是真的跑的。
 */

import { DatabaseSync } from 'node:sqlite'
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  childIcon,
  childColor
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

/* ------------------------------------------------- 真的 SQLite + 假 plus */

function makeFakePlus(opts = {}) {
  const db = new DatabaseSync(':memory:')
  const log = []

  db.exec(`CREATE TABLE category (
    id         TEXT PRIMARY KEY,
    parent_id  TEXT,
    name       TEXT    NOT NULL,
    type       TEXT    NOT NULL,
    icon       TEXT,
    color      TEXT,
    sort       INTEGER NOT NULL DEFAULT 0,
    hidden     INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`)
  db.exec(`CREATE TABLE txn (
    id            TEXT PRIMARY KEY,
    type          TEXT    NOT NULL,
    amount_cents  INTEGER NOT NULL,
    account_id    TEXT    NOT NULL,
    to_account_id TEXT,
    category_id   TEXT,
    note          TEXT,
    occurred_at   INTEGER NOT NULL,
    occurred_day  TEXT    NOT NULL,
    month_key     TEXT    NOT NULL,
    year_key      TEXT    NOT NULL,
    tz_offset     INTEGER NOT NULL DEFAULT 480,
    source        TEXT    NOT NULL DEFAULT 'manual',
    raw_text      TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    deleted_at    INTEGER,
    exclude_from_budget INTEGER NOT NULL DEFAULT 0
  )`)
  db.exec(`CREATE TABLE budget (
    id           TEXT PRIMARY KEY,
    scope        TEXT    NOT NULL,
    category_id  TEXT,
    period       TEXT    NOT NULL DEFAULT 'month',
    amount_cents INTEGER NOT NULL,
    start_month  TEXT    NOT NULL,
    rollover     INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  )`)

  db.exec(`PRAGMA user_version = ${Number(opts.userVersion) || 0}`)

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
        try {
          success && success(db.prepare(sql).all())
        } catch (e) {
          fail && fail({ message: e.message })
        }
      },
      executeSql: ({ sql, success, fail }) => {
        try {
          db.exec(sql)
          success && success()
        } catch (e) {
          fail && fail({ message: e.message })
        }
      },
      transaction: ({ operation, success, fail }) => {
        try {
          if (operation === 'begin') db.exec('BEGIN')
          else if (operation === 'commit') db.exec('COMMIT')
          else if (operation === 'rollback') db.exec('ROLLBACK')
          success && success()
        } catch (e) {
          fail && fail({ message: e.message })
        }
      }
    },
    __db: db
  }
  return { fake, log, db }
}

async function loadRealDb(fake) {
  globalThis.plus = fake
  const mod = await import('../api/db/index.js?t=' + Math.random())
  return mod
}

function insertCat(db, { id, parent_id = null, name, type, icon = 'more', color = '#969799', sort = 0, deleted_at = null }) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?,?,?,0,?,?,?)`
  ).run(id, parent_id, name, type, icon, color, sort, now, now, deleted_at)
}

/**
 * 造一个「已经是 v5 结构、但二级图标全是继承父级」的库
 */
function seedV5StyleDb(db) {
  let i = 0
  for (const type of ['expense', 'income']) {
    const list = type === 'expense' ? DEFAULT_EXPENSE_CATEGORIES : DEFAULT_INCOME_CATEGORIES
    for (const p of list) {
      const pid = `p_${type}_${i++}`
      insertCat(db, { id: pid, name: p.name, type, icon: p.icon, color: p.color })
      let j = 0
      for (const child of p.children) {
        const name = typeof child === 'string' ? child : child.name
        // ★ 旧结构：二级图标 = 父级图标 ★
        insertCat(db, {
          id: `c_${type}_${i}_${j++}`,
          parent_id: pid,
          name,
          type,
          icon: p.icon,
          color: p.color
        })
      }
    }
  }
  // 用户自己建的分类（名字对不上默认表，迁移不该动它）
  insertCat(db, { id: 'u_mine', name: '我的分类', type: 'expense', icon: 'gift', color: '#123456' })
  insertCat(db, { id: 'u_mine_c', parent_id: 'u_mine', name: '我的子类', type: 'expense', icon: 'gift', color: '#123456' })
}

console.log('=== childIcon / childColor 兼容两种写法 ===')

check('对象用自己的图标', childIcon({ name: '日常三餐', icon: 'food' }, 'more'), 'food')
check('对象没写图标用父级的', childIcon({ name: '日常三餐' }, 'more'), 'more')
check('纯字符串继承父级图标', childIcon('日常三餐', 'food'), 'food')
check('对象用自己的颜色', childColor({ name: 'x', color: '#111111' }, '#222222'), '#111111')
check('对象没写颜色用父级的', childColor({ name: 'x' }, '#222222'), '#222222')
check('纯字符串继承父级颜色', childColor('日常三餐', '#222222'), '#222222')

console.log('=== 迁移 v6：给二级分类补上各自的图标 ===')

{
  const { fake, db } = makeFakePlus({ userVersion: 5 })
  seedV5StyleDb(db)

  // 迁移前：所有二级都是父级图标
  const before = db.prepare(
    "SELECT icon FROM category WHERE deleted_at IS NULL AND parent_id IS NOT NULL AND name = '奶茶饮料'"
  ).get()
  check('迁移前「奶茶饮料」继承父级图标', before.icon, 'food')

  const mod = await loadRealDb(fake)
  const result = await Promise.race([
    mod.openDb().then(() => 'OPENED').catch((e) => 'ERROR:' + e.message),
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 5000))
  ])
  check('迁移没有死锁', result, 'OPENED')

  // 迁移后：每个二级都有自己的图标
  const after = db.prepare(
    "SELECT icon FROM category WHERE deleted_at IS NULL AND parent_id IS NOT NULL AND name = '奶茶饮料'"
  ).get()
  check('迁移后「奶茶饮料」有自己的图标', after.icon, 'coffee')

  const breakfast = db.prepare(
    "SELECT icon FROM category WHERE deleted_at IS NULL AND parent_id IS NOT NULL AND name = '日常三餐'"
  ).get()
  check('迁移后「日常三餐」有自己的图标', breakfast.icon, 'food')

  const snack = db.prepare(
    "SELECT icon FROM category WHERE deleted_at IS NULL AND parent_id IS NOT NULL AND name = '零食小吃'"
  ).get()
  check('迁移后「零食小吃」有自己的图标', snack.icon, 'snack')

  // 同一个父类下，二级图标不再是同一个
  const foodId = db.prepare(
    "SELECT id FROM category WHERE deleted_at IS NULL AND name = '餐饮食品' AND type = 'expense' AND parent_id IS NULL"
  ).get().id
  const icons = db.prepare(
    'SELECT icon FROM category WHERE deleted_at IS NULL AND parent_id = ?'
  ).all(foodId).map((r) => r.icon)
  /*
   * ★ 从「两两不同」改成「与默认表逐条一致」★
   *   新表里「水果蔬菜」和「零食小吃」都归零食类，图标都是 snack ——
   *   再要求两两不同，等于不让分类按语义归类。
   *   改成和默认表比对，强度没降低：漏刷任何一个子类都会对不上。
   */
  const expectedIcons = DEFAULT_EXPENSE_CATEGORIES[0].children
    .map((ch) => childIcon(ch, 'food'))
    .sort()
  check('餐饮食品下二级图标与默认表一致', [...icons].sort(), expectedIcons)
  check('餐饮食品下二级图标不是全都一样', new Set(icons).size > 1, true)

  // ★ 用户自己的分类不能被动 ★
  const mine = db.prepare("SELECT icon FROM category WHERE id = 'u_mine'").get()
  check('用户自建分类的图标没被改', mine.icon, 'gift')
  const mineChild = db.prepare("SELECT icon FROM category WHERE id = 'u_mine_c'").get()
  check('用户自建子分类的图标没被改', mineChild.icon, 'gift')

  // ★ 颜色不能被动 ★
  const color = db.prepare("SELECT color FROM category WHERE deleted_at IS NULL AND name = '奶茶饮料'").get()
  check('二级分类的颜色不变', color.color, '#FF976A')

  // 版本被推进
  const ver = db.prepare('PRAGMA user_version').get().user_version
  check('版本推进到 6', ver >= 6, true)
}

console.log('=== 迁移 v6：幂等 —— 跑第二遍结果一样 ===')

{
  const { fake, db } = makeFakePlus({ userVersion: 5 })
  seedV5StyleDb(db)

  const mod = await loadRealDb(fake)
  await mod.openDb()

  const snap = () => db.prepare(
    'SELECT id, icon FROM category WHERE deleted_at IS NULL ORDER BY id'
  ).all().map((r) => `${r.id}:${r.icon}`)

  const first = snap()
  // 再跑一遍 v6
  const rows = await db.prepare(
    "SELECT id FROM category WHERE deleted_at IS NULL AND name = '奶茶饮料' AND parent_id IS NOT NULL"
  ).all()
  check('第一遍后「奶茶饮料」图标正确', rows[0] ? db.prepare('SELECT icon FROM category WHERE id = ?').get(rows[0].id).icon : null, 'coffee')

  // 手动再执行一次 v6 的 UPDATE（幂等性验证）
  const now = Date.now()
  for (const p of DEFAULT_EXPENSE_CATEGORIES) {
    for (const child of p.children) {
      const name = typeof child === 'string' ? child : child.name
      db.prepare(
        `UPDATE category SET icon = ?, updated_at = ?
         WHERE deleted_at IS NULL AND parent_id IS NOT NULL AND name = ?`
      ).run(childIcon(child, p.icon), now, name)
    }
  }
  check('再跑一遍结果不变', snap(), first)
}

console.log('=== 全新安装：二级分类直接就有自己的图标 ===')

{
  const { fake, db } = makeFakePlus({ userVersion: 0 })

  const mod = await loadRealDb(fake)
  const result = await Promise.race([
    mod.openDb().then(() => 'OPENED').catch((e) => 'ERROR:' + e.message),
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 5000))
  ])
  check('开库没有死锁', result, 'OPENED')

  // 迁移 v5 会重建分类表（全新库没有分类 -> 建新的）
  const drink = db.prepare(
    "SELECT icon FROM category WHERE deleted_at IS NULL AND parent_id IS NOT NULL AND name = '奶茶饮料'"
  ).get()
  check('新装的「奶茶饮料」有自己的图标', drink ? drink.icon : null, 'coffee')

  const food = db.prepare(
    "SELECT icon FROM category WHERE deleted_at IS NULL AND parent_id IS NOT NULL AND name = '日常三餐'"
  ).get()
  check('新装的「日常三餐」有自己的图标', food ? food.icon : null, 'food')
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
