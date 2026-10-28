/**
 * DAO 门面 —— 对上层只暴露 open / query / execute / transaction
 *
 * 为什么不让业务层直接用 plus.sqlite：
 *   1. plus.sqlite 全是回调式 API，业务层写下去会形成回调地狱
 *   2. 参数占位符在不同内核版本下支持程度不一致，需要统一在这里做绑定
 *   3. 事务必须手动 begin/commit，散落在业务层极易漏掉导致余额错乱
 */

import {
  SCHEMA_V1, INDEXES_V1, SCHEMA_VERSION,
  RECONCILE_CATEGORIES, RECONCILE_LEGACY_NAME,
  DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES,
  childIcon, childColor
} from './schema.js'
// ★ utils/id.js 是纯函数（不碰数据库），在迁移里用它生成 id 不会有循环依赖 ★
import { prefixedId } from '../../utils/id.js'

const DB_NAME = 'books'
const DB_PATH = '_doc/books.db'

let opened = false
let opening = null

/**
 * 运行时判定 SQLite 是否可用。
 *
 * ★ 不能写成模块级常量 ★
 *   ES 模块在 App 启动早期就被求值，此时 plus 可能还没注入，
 *   一旦缓存成 false 就永远 false，后面所有数据库操作都会报"仅 App 端可用"。
 *   所以每次调用都要重新读。
 */
function isSqliteReady() {
  return typeof plus !== 'undefined' && !!plus.sqlite
}

/**
 * 等待 plus 就绪。
 * 标准基座下 plus 在 onLaunch 前后才注入；云打包下也有极短的空窗。
 * 用轮询避免"明明在真机上却说不能用"。
 */
function waitForPlus(timeoutMs = 3000) {
  if (isSqliteReady()) return Promise.resolve(true)

  return new Promise((resolve, reject) => {
    const start = Date.now()
    const timer = setInterval(() => {
      if (isSqliteReady()) {
        clearInterval(timer)
        resolve(true)
        return
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer)
        reject(new Error(
          'plus.sqlite 不可用。请确认：\n' +
          '1) 运行在 App 端（不能是 H5 / 小程序）\n' +
          '2) manifest.json → App模块配置 中已勾选 SQLite\n' +
          '3) 使用标准基座或已重新云打包'
        ))
      }
    }, 50)
  })
}

/* ------------------------------------------------------------------ 工具 */

/** 把 ? 占位符替换为转义后的字面量，避免依赖内核的 prepared statement 能力 */
function bindParams(sql, params) {
  if (!params || params.length === 0) return sql
  let i = 0
  return sql.replace(/\?/g, () => {
    const v = params[i++]
    if (v === null || v === undefined) return 'NULL'
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return 'NULL'
      return String(v)
    }
    if (typeof v === 'boolean') return v ? '1' : '0'
    // 字符串：单引号转义
    return `'${String(v).replace(/'/g, "''")}'`
  })
}

/**
 * 调用 plus.sqlite 的某个方法。
 *
 * ★ 必须传方法名而不是函数引用 ★
 *   plus.sqlite.openDatabase / selectSql / executeSql 是 HTML5+ 的桥接方法，
 *   内部依赖 this.getCallbackIDByFunction。若写成 call(plus.sqlite.selectSql, ...)，
 *   方法被摘下来单独调用，this 变成 undefined，就会抛：
 *     "this.getCallbackIDByFunction is not a function"
 *   所以统一用 plus.sqlite[method](arg) 的形式，在对象上调用。
 *
 * @param {string} method 方法名，如 'selectSql'
 * @param {object} arg 参数
 */
function call(method, arg) {
  return new Promise((resolve, reject) => {
    if (!isSqliteReady()) {
      reject(new Error('plus.sqlite 不可用，请确认运行在 App 端且已勾选 SQLite 模块'))
      return
    }
    const api = plus.sqlite
    if (typeof api[method] !== 'function') {
      reject(new Error(`plus.sqlite.${method} 不存在，可能该模块未打包进基座`))
      return
    }
    api[method]({
      ...arg,
      success: resolve,
      fail: (e) => {
        const code = e && e.code !== undefined ? e.code : ''
        const msg = (e && e.message) || ''
        reject(new Error(`SQLite 执行失败${code !== '' ? ` (code ${code})` : ''}${msg ? `: ${msg}` : ''}`))
      }
    })
  })
}

/* ------------------------------------------------------------ 打开与迁移 */

async function readUserVersion() {
  try {
    const rows = await call('selectSql', {
      name: DB_NAME,
      sql: 'PRAGMA user_version'
    })
    if (rows && rows.length > 0) {
      const first = rows[0]
      return Number(first.user_version !== undefined ? first.user_version : Object.values(first)[0]) || 0
    }
  } catch (e) {
    // 库尚未建立或该语法不支持，视为 0
  }
  return 0
}

async function writeUserVersion(v) {
  try {
    await call('executeSql', { name: DB_NAME, sql: `PRAGMA user_version = ${Number(v)}` })
  } catch (e) {
    // ★ 写版本号失败不能挡住开库 ★
    //   最坏结果是下次启动再跑一遍迁移（迁移都是幂等的）。
    console.warn('[db] write user_version failed:', e && e.message)
  }
}

/** 执行建表与索引 —— 幂等，用 IF NOT EXISTS */
async function applySchemaV1() {
  for (const sql of SCHEMA_V1) {
    await call('executeSql', { name: DB_NAME, sql })
  }
  for (const sql of INDEXES_V1) {
    try {
      await call('executeSql', { name: DB_NAME, sql })
    } catch (e) {
      // 索引已存在或内核不支持该语法时不影响主流程
      console.warn('[db] index skipped:', e.message)
    }
  }
}

/**
 * 迁移表。每次结构变更追加一条，up 内只做增量 DDL。
 * 注意：SQLite 不支持 DROP COLUMN 的老版本，需要重建表，届时单独处理。
 */
const MIGRATIONS = [
  {
    version: 1,
    up: applySchemaV1
  },
  {
    // ★ 修复历史记录的「12:00」★
    //   旧逻辑只要传了日期就把时刻写死成当天中午，
    //   所以历史数据 occurred_at 全部落在 12:00:00。
    //   这里按 created_at（记录真正被创建的时刻）回填：
    //   只有 occurred_day 等于「记录创建那天」的才回填，
    //   「补记昨天」这类本来就该是过去时刻的不动。
    //   ★ 时区换算放在 JS 里做 ★
    //     SQLite 的 strftime 按 UTC 算，直接在 SQL 里换本地日期会差一天。
    version: 2,
    up: fixNoonTimestamps
  },
  {
    // ★ txn 表加「不计入预算」标记 ★
    //   有些支出（比如一次性的大额购物、退款、报销）不该算进预算额度。
    //   用一个 0/1 字段标记，预算统计时排除掉。
    //
    //   用 ALTER TABLE ADD COLUMN 而不是改表结构重建 ——
    //   SQLite 的 ADD COLUMN 是 O(1) 的元数据操作，不动数据，
    //   而且老版本内核也支持。
    version: 3,
    up: async () => {
      try {
        await call('executeSql', {
          name: DB_NAME,
          sql: 'ALTER TABLE txn ADD COLUMN exclude_from_budget INTEGER NOT NULL DEFAULT 0'
        })
        console.log('[db] migration v3: txn.exclude_from_budget 已添加')
      } catch (e) {
        // 字段已存在（重复执行）时会报错，忽略即可
        if (e && /duplicate|already exists/i.test(e.message || '')) {
          console.log('[db] migration v3: exclude_from_budget 已存在，跳过')
        } else {
          throw e
        }
      }
    }
  },
  {
    // ★ 「对账调整」拆成两个固定的一级分类 ★
    //   旧结构：expense 下有一个一级「对账调整」，下面挂二级
    //          「对账支出」「对账收入」（income 下同理）。
    //   新结构：expense 下直接是一级「对账支出」，
    //          income 下直接是一级「对账收入」，
    //          两条都是固定分类（分类管理里不可改名/改图标/删除）。
    //
    //   详见 migrateReconcileCategories()。
    version: 4,
    up: migrateReconcileCategories
  },
  {
    // ★ 默认分类重建成新的分类表 ★
    //   老库里存的是旧结构（餐饮/交通/购物/居住/娱乐/医疗/教育/人情/其他…），
    //   用户要求换成新的分类表（餐饮食品/交通出行/居住住房/购物消费…）。
    //
    //   ★ 为什么必须靠迁移，不能靠 seedDefaultCategories ★
    //     seedDefaultCategories() 只在「分类表一条都没有」时才写，
    //     老用户库里有旧分类，走不到那里 —— 改代码对他们没有任何效果。
    //     只有全新安装才看得到新分类。这就是「改了却没生效」的原因。
    //
    //   详见 rebuildDefaultCategories()。
    version: 5,
    up: rebuildDefaultCategories
  },
  {
    // ★ 二级分类改为独立图标 ★
    //   v5 的分类表里，二级分类的 icon 直接继承了父级
    //   （「早餐」「午餐」「晚餐」全是同一个 🍜）。
    //   用户要求每个子类都能有自己的图标。
    //
    //   这里**不重建分类表** —— 重建会把用户的分类改动和历史交易引用
    //   全部打乱（v5 迁移已经干过一次那样的事，代价太大）。
    //   只按「一级分类名 + 二级分类名」把 icon 改对就行：
    //   用户自己新建的分类不受影响（名字对不上就不动）。
    //
    //   详见 applyChildCategoryIcons()。
    version: 6,
    up: applyChildCategoryIcons
  }
]

/**
 * 迁移 v6 —— 给二级分类补上各自的图标
 *
 * ★ 为什么不重建分类表 ★
 *   重建（v5 那种做法）会软删所有分类再新建，
 *   历史交易的 category_id 会变成悬空引用，用户的自定义分类也会没。
 *   这里只做最小改动：按名字找到对应的二级分类，把 icon 改对。
 *
 * ★ 怎么找到「对应的」二级分类 ★
 *   一级分类名 + 二级分类名 一起当 key。
 *   名字对不上（用户自己新建的、改过名的）就跳过 —— 不动用户的数据。
 *
 * ★ 为什么必须用底层的 call()，不能用 query()/execute() ★
 *   query()/execute() 内部会 await openDb()，
 *   而本函数正是在 openDb() -> migrate() 里被调用的，会死锁。
 *   （v2 / v4 / v5 都踩过这个坑，见那边的注释。）
 */
async function applyChildCategoryIcons() {
  const now = Date.now()

  const select = async (sql, params) => {
    try {
      const rows = await call('selectSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return Array.isArray(rows) ? rows : []
    } catch (e) {
      console.warn('[db] migration v6 select failed:', e && e.message)
      return null
    }
  }

  const run = async (sql, params) => {
    try {
      await call('executeSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return true
    } catch (e) {
      console.warn('[db] migration v6 exec failed:', e && e.message)
      return false
    }
  }

  let updated = 0

  for (const type of ['expense', 'income']) {
    const list = type === 'expense' ? DEFAULT_EXPENSE_CATEGORIES : DEFAULT_INCOME_CATEGORIES

    for (const parent of list) {
      // 找父级
      const parents = await select(
        'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
        [parent.name, type]
      )
      if (!parents || parents.length === 0) continue
      const parentId = parents[0].id

      for (const child of parent.children) {
        const childName = typeof child === 'string' ? child : child.name
        const icon = childIcon(child, parent.icon)

        const ok = await run(
          `UPDATE category SET icon = ?, updated_at = ?
           WHERE deleted_at IS NULL AND parent_id = ? AND name = ?`,
          [icon, now, parentId, childName]
        )
        if (ok) updated++
      }
    }
  }

  console.log(`[db] migration v6: 二级分类图标已更新（${updated} 条）`)
}

/**
 * 迁移 v4 —— 把旧的一级「对账调整」拆成两个固定的一级分类
 *
 * ★ 这里必须用底层的 call()，不能用 query()/execute() ★
 *   query()/execute() 内部会 await openDb()，
 *   而本函数正是在 openDb() -> migrate() 里被调用的，
 *   那样会等自己（opening 那个 Promise 还没 resolve），直接死锁。
 *   （v2 的 fixNoonTimestamps 已经踩过这个坑，见那边的注释。）
 *
 * ★ 目标结构 ★
 *   expense:  一级「对账支出」（parent_id = NULL）
 *   income:   一级「对账收入」（parent_id = NULL）
 *
 * ★ 处理步骤（对每个 type 各做一遍）★
 *   1. 先记下旧一级「对账调整」和它下面的二级分类
 *      ★ 必须在改名之前取 ★
 *        改名之后旧一级就叫「对账支出」了，
 *        再按旧名字去查子分类就查不到了。
 *   2. 找目标名的一级分类：
 *      - 已经有 -> 直接复用它的 id（幂等的关键）
 *      - 没有 -> 把旧的一级改名成目标名（保留 id，历史交易的引用不用改）
 *      - 旧的一级也没有 -> 新建一个
 *   3. 旧一级下面的二级分类：
 *      - 名字和目标名相同（expense 下的「对账支出」二级）-> 软删除
 *      - 引用了它的交易（txn.category_id）-> 改指向目标 id
 *   4. 直接引用旧一级 id 的交易 -> 也改指向目标 id
 *
 * ★ 幂等 ★
 *   跑第二遍时：目标一级已经存在（步骤 2 复用），
 *   旧一级已改名或已软删除（步骤 1 查不到 active 的旧一级），
 *   旧二级已软删除（步骤 3 跳过），
 *   txn.category_id 已经指向目标 id（步骤 4 已是目标）—— 结果完全一样。
 */
async function migrateReconcileCategories() {
  const now = Date.now()

  /** 底层查询（迁移里不能走 query()，会死锁） */
  const select = async (sql, params) => {
    try {
      const rows = await call('selectSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return Array.isArray(rows) ? rows : []
    } catch (e) {
      console.warn('[db] migration v4 select failed:', e && e.message)
      return null
    }
  }

  /** 底层写入（迁移里不能走 execute()，会死锁） */
  const run = async (sql, params) => {
    try {
      await call('executeSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return true
    } catch (e) {
      console.warn('[db] migration v4 exec failed:', e && e.message)
      return false
    }
  }

  for (const def of RECONCILE_CATEGORIES) {
    const type = def.type
    const targetName = def.name

    // ---- 1) 先记下旧一级和它的子分类（必须在改名之前取）----
    //     旧一级只看「没被软删除」的 —— 软删除的记录不能再被改名复活。
    const legacyRows = await select(
      'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
      [RECONCILE_LEGACY_NAME, type]
    )
    if (legacyRows === null) continue

    const legacyIds = legacyRows.map((r) => r.id).filter(Boolean)

    // 收集所有（不管有没有被软删除的）旧一级的子分类 ——
    // 历史数据里可能有「一级被软删除但二级还活着」的残留，一并收掉。
    const allLegacyRows = await select(
      'SELECT id FROM category WHERE name = ? AND type = ? AND parent_id IS NULL',
      [RECONCILE_LEGACY_NAME, type]
    )
    if (allLegacyRows === null) continue

    let childRows = []
    for (const row of allLegacyRows) {
      if (!row.id) continue
      const rows = await select(
        'SELECT id, name FROM category WHERE deleted_at IS NULL AND parent_id = ?',
        [row.id]
      )
      if (rows === null) continue
      childRows = childRows.concat(rows)
    }

    // ---- 2) 目标一级分类 ----
    const targetRows = await select(
      'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
      [targetName, type]
    )
    if (targetRows === null) continue

    let targetId = targetRows.length > 0 ? targetRows[0].id : null

    if (targetId) {
      // 目标名已经被占用（同名的一级已存在）
      // -> 旧的一级「对账调整」软删除，它下面的二级也软删除，
      //    引用它们 id 的交易在步骤 3/4 里改指到目标。
      for (const legacyId of legacyIds) {
        await run('UPDATE category SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, legacyId])
      }
    } else if (legacyIds.length > 0) {
      // 目标名没被占用 -> 把旧的一级直接改名（保留 id，历史引用不用改）
      const legacyId = legacyIds[0]
      const ok = await run(
        'UPDATE category SET name = ?, parent_id = NULL, icon = ?, color = ?, updated_at = ? WHERE id = ?',
        [targetName, def.icon, def.color, now, legacyId]
      )
      if (ok) {
        targetId = legacyId
        // 重名的旧一级（异常数据）软删除
        for (const extra of legacyIds.slice(1)) {
          await run('UPDATE category SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, extra])
        }
      }
    }

    if (!targetId) {
      // 老库里根本没有对账分类 -> 直接建一个目标一级
      const newId = prefixedId('cat')
      const ok = await run(
        `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
         VALUES (?,NULL,?,?,?,?,999,0,?,?,NULL)`,
        [newId, targetName, type, def.icon, def.color, now, now]
      )
      if (!ok) continue
      targetId = newId
    }

    // ---- 3) 旧一级下面的二级：软删除，引用改指向目标 ----
    //   旧结构里这些二级（「对账支出」「对账收入」）是挂在「对账调整」下面的，
    //   现在由目标一级直接承担，旧的二级全部软删除（软删除而不是硬删，
    //   撤销功能还能用）。
    for (const child of childRows) {
      const childId = child.id
      if (!childId || childId === targetId) continue

      await run('UPDATE category SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, childId])

      // 引用它的交易改指向目标一级
      await run('UPDATE txn SET category_id = ? WHERE category_id = ?', [targetId, childId])
    }

    // ---- 4) 直接引用旧一级 id 的交易 -> 也改指向目标 ----
    for (const legacyId of legacyIds) {
      if (legacyId === targetId) continue
      await run('UPDATE txn SET category_id = ? WHERE category_id = ?', [targetId, legacyId])
    }
  }

  console.log('[db] migration v4: 对账分类已拆分为「对账支出」「对账收入」两个一级分类')
}

/**
 * 迁移 v5 —— 把默认分类重建成新的分类表
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 背景 ★
 *   旧默认分类：餐饮/交通/购物/居住/娱乐/医疗/教育/人情/其他
 *               + 工资/理财/兼职/红包/其他
 *   新默认分类：餐饮食品/交通出行/居住住房/购物消费/医疗健康/社交娱乐/
 *               学校学习/人情往来/其他-杂项
 *               + 工资/奖金补贴/副业劳务/租金收入/投资收益/红包礼金/
 *                 二手出售/退款返还/父母补贴
 *
 * ★ 为什么必须做成「迁移」而不是改 seedDefaultCategories ★
 *   seedDefaultCategories() 只在「分类表一条都没有」时才写入。
 *   老用户库里已经有旧分类了，这个函数根本不会执行 ——
 *   改了代码对老设备完全没有效果，只有全新安装才看得到新分类。
 *   所以要让老设备也换上新分类，只能走数据库迁移。
 *
 * ★ 处理方式：清空重建 ★
 *   1. 先把旧分类全部「软删除」（deleted_at 打上时间戳）。
 *      不用硬删，是为了万一用户想撤销还能捞回来。
 *   2. 历史交易的 category_id 改指向新结构里的兜底分类
 *      （expense -> 「其他/杂项」，income -> 「父母补贴」不合适，
 *        收入这边用「其他/杂项」？收入没有这个分类，
 *        所以收入的旧交易改指向「奖金补贴」？也不对。
 *        —— 收入的兜底用「父母补贴」不合适，这里统一用
 * ★ 处理方式：清空重建 ★
 *   1. 先把旧分类全部「软删除」（deleted_at 打上时间戳）。
 *      不用硬删，是为了万一用户想撤销还能捞回来。
 *   2. 写入新分类表（一级 + 二级）。
 *   3. 历史交易的 category_id 改指向新分类里活着的那些
 *      （指向已删除分类的交易会变成「未分类」，JOIN 不到）。
 *   4. 重新建「对账支出」「对账收入」两个固定一级分类
 *      （上一步把旧分类全软删了，包括这两个，得重建）。
 *
 * ★ 分类预算怎么办 ★
 *   budget.category_id 指向的是旧分类 id，分类被软删后预算就悬空了。
 *   budget 表没有 deleted_at 字段，所以直接 DELETE ——
 *   预算只是限额，删了不影响任何交易和余额。
 *
 * ★ 幂等：靠「已经是新结构了就直接跳过」 ★
 *   跑第二遍时，如果分类表已经是新结构了（判断依据见下），
 *   就直接返回，什么都不做 ——
 *   否则会把刚建好的分类又软删一遍再重建，
 *   白白产生一批软删除记录，而且历史交易的 category_id 会指向被删的行。
 *
 *   判断依据：一个一级分类的名字 + type + parent_id IS NULL
 *   在新结构里全部存在，就认为已经是新结构了。
 *
 * ★ 这里必须用底层的 call()，不能用 query()/execute() ★
 *   query()/execute() 内部会 await openDb()，
 *   而本函数正是在 openDb() -> migrate() 里被调用的，会死锁。
 *   （v2 的 fixNoonTimestamps 已经踩过这个坑。）
 */
async function rebuildDefaultCategories() {
  const now = Date.now()

  /** 底层查询（迁移里不能走 query()，会死锁） */
  const select = async (sql, params) => {
    try {
      const rows = await call('selectSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return Array.isArray(rows) ? rows : []
    } catch (e) {
      console.warn('[db] migration v5 select failed:', e && e.message)
      return null
    }
  }

  /** 底层写入（迁移里不能走 execute()，会死锁） */
  const run = async (sql, params) => {
    try {
      await call('executeSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return true
    } catch (e) {
      console.warn('[db] migration v5 exec failed:', e && e.message)
      return false
    }
  }

  // ---- 0) 幂等检查：已经是新结构了就直接跳过 ----
  //   逐个查新结构里的一级分类（名字 + type + 一级）是否都已存在。
  //   全在 -> 说明上一轮已经建好了，别再动。
  let alreadyNew = true
  const allTop = [
    ...DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ name: c.name, type: 'expense' })),
    ...DEFAULT_INCOME_CATEGORIES.map((c) => ({ name: c.name, type: 'income' }))
  ]
  for (const t of allTop) {
    const rows = await select(
      'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
      [t.name, t.type]
    )
    if (!rows || rows.length === 0) {
      alreadyNew = false
      break
    }
  }
  if (alreadyNew) {
    console.log('[db] migration v5: 分类表已是新结构，跳过')
    return
  }

  // ---- 1) 旧分类全部软删除 ----
  await run('UPDATE category SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL', [now, now])

  // ---- 2) 写新分类表 ----
  //   用 schema.js 里的同一份定义（api/category.js 的 seedDefaultCategories
  //   也用它），保证「首次安装写的」和「迁移重建的」结构完全一致 ——
  //   改默认分类表只改一处，不会两处不同步。
  let created = 0
  for (const type of ['expense', 'income']) {
    const list = type === 'expense' ? DEFAULT_EXPENSE_CATEGORIES : DEFAULT_INCOME_CATEGORIES
    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      const parentId = prefixedId('cat')
      const ok = await run(
        `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
         VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
        [parentId, null, item.name, type, item.icon, item.color, i, now, now]
      )
      if (!ok) continue
      created++

      for (let j = 0; j < item.children.length; j++) {
        // ★ 二级分类有自己的图标（颜色继承父级）★
        //   childIcon / childColor 兼容旧写法（纯字符串），
        //   详见 api/db/schema.js 的说明。
        const child = item.children[j]
        const childName = typeof child === 'string' ? child : child.name
        const okChild = await run(
          `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
          [
            prefixedId('cat'), parentId, childName, type,
            childIcon(child, item.icon), childColor(child, item.color),
            j, now, now
          ]
        )
        if (okChild) created++
      }
    }
  }

  // ---- 3) 历史交易改指向新分类 ----
  //   旧分类已经没了，txn.category_id 还指着它们就成了悬空引用，
  //   统计时 JOIN 不到分类（会显示成「未分类」）。
  //
  //   支出交易 -> 归到「其他/杂项」
  //   收入交易 -> 归到「其他/杂项」？收入的分类表里没有「其他/杂项」，
  //              所以收入这边统一归到「奖金补贴」？语义不对。
  //              —— 收入里最中性的是……收入分类表里确实没有「其他」。
  //              折中做法：收入的旧交易归到「工资」显然不对。
  //
  //   所以这里不猜：收入的旧交易直接置空（category_id = NULL），
  //   界面上会显示「未分类」，用户可以自己重新归类 ——
  //   比归到一个语义不对的分类里更诚实。
  const expenseFallback = await select(
    'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
    ['其他/杂项', 'expense']
  )
  const fallbackId = expenseFallback && expenseFallback.length > 0 ? expenseFallback[0].id : null

  if (fallbackId) {
    await run(
      `UPDATE txn SET category_id = ?
       WHERE deleted_at IS NULL
         AND category_id IS NOT NULL
         AND category_id NOT IN (SELECT id FROM category WHERE deleted_at IS NULL)`,
      [fallbackId]
    )
  } else {
    // 连兜底分类都没有 -> 置空，至少不指向已删除的行
    await run(
      `UPDATE txn SET category_id = NULL
       WHERE deleted_at IS NULL
         AND category_id IS NOT NULL
         AND category_id NOT IN (SELECT id FROM category WHERE deleted_at IS NULL)`,
      []
    )
  }

  // ---- 4) 失效的分类预算删掉 ----
  //   budget 表没有 deleted_at 字段，直接 DELETE。
  //   预算只是限额，删掉不影响任何交易和账户余额。
  //
  //   run() 内部已经 catch 了错误并返回 false，
  //   所以这里失败也不会中断迁移（分类重建已经成功了，这只是收尾）。
  await run(
    `DELETE FROM budget
     WHERE scope = 'category' AND category_id IS NOT NULL
       AND category_id NOT IN (SELECT id FROM category WHERE deleted_at IS NULL)`,
    []
  )

  // ---- 5) 重建「对账支出」「对账收入」两个固定一级分类 ----
  //   第 1 步把旧分类连这两个一起软删了，得重新建。
  //   sort = 999：排到最后，别抢用户自己分类的位置。
  for (const def of RECONCILE_CATEGORIES) {
    const existing = await select(
      'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
      [def.name, def.type]
    )
    if (existing && existing.length > 0) continue

    await run(
      `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
       VALUES (?,NULL,?,?,?,?,999,0,?,?,NULL)`,
      [prefixedId('cat'), def.name, def.type, def.icon, def.color, now, now]
    )
  }

  console.log(`[db] migration v5: 默认分类已重建（${created} 条）`)
}

/**
 * 回填历史记录的时刻（12:00 -> 实际创建时刻）
 *
 * 条件：occurred_at 落在当天 12:00（±1 分钟，容忍时钟漂移）
 *       且 occurred_day 等于 created_at 的本地日期
 *
 * ★ 这里必须用底层的 call()，不能用 query()/execute() ★
 *   query()/execute() 内部会 await openDb()，
 *   而本函数正是在 openDb() -> migrate() 里被调用的，
 *   那样会等自己（opening 那个 Promise 还没 resolve），直接死锁。
 *   v1 的 applySchemaV1 也是这么绕过 openDb 的。
 */
async function fixNoonTimestamps() {
  let rows = []
  try {
    rows = await call('selectSql', {
      name: DB_NAME,
      sql: 'SELECT id, occurred_at, occurred_day, created_at FROM txn WHERE deleted_at IS NULL'
    })
  } catch (e) {
    console.warn('[db] migration v2 skip:', e.message)
    return
  }
  if (!Array.isArray(rows)) rows = []

  let fixed = 0
  for (const r of rows) {
    const occ = Number(r.occurred_at) || 0
    const created = Number(r.created_at) || 0
    if (!occ || !created) continue

    const occDate = new Date(occ)
    // 只处理「看起来就是 12:00」的记录
    if (occDate.getHours() !== 12 || occDate.getMinutes() > 1) continue

    // created_at 的本地日期必须和 occurred_day 一致
    const c = new Date(created)
    const cDay = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`
    if (cDay !== r.occurred_day) continue

    // 回填成创建时刻（保留 occurred_at 当天，时分秒用 created_at 的）
    const fixedTs = new Date(
      occDate.getFullYear(), occDate.getMonth(), occDate.getDate(),
      c.getHours(), c.getMinutes(), c.getSeconds(), 0
    ).getTime()

    try {
      await call('executeSql', {
        name: DB_NAME,
        sql: bindParams('UPDATE txn SET occurred_at = ? WHERE id = ?', [fixedTs, r.id])
      })
      fixed++
    } catch (e) {
      console.warn('[db] migration v2 update failed:', e.message)
    }
  }

  if (fixed > 0) {
    console.log(`[db] 已回填 ${fixed} 条历史记录的时刻`)
  }
}

async function migrate() {
  const current = await readUserVersion()
  if (current >= SCHEMA_VERSION) return

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    console.log(`[db] migrating -> v${m.version}`)
    try {
      await m.up()
    } catch (e) {
      // ★ 迁移失败不能挡住数据库打开 ★
      //   迁移只是「锦上添花」（建表 / 回填时刻），
      //   万一失败也必须让 App 能正常用，
      //   否则整个 App 会因为一个迁移卡在打不开库。
      console.error(`[db] migration v${m.version} failed:`, e && e.message)
    }
    await writeUserVersion(m.version)
  }
}

/**
 * ★ 仅供测试用：单独跑某一条迁移 ★
 *
 * 为什么需要它
 *   迁移之间是有顺序依赖的：
 *     v4 把「对账调整」拆成两个固定一级分类
 *     v5 把整个默认分类表重建
 *   两个测试如果都从同一个老版本号起步，
 *   v5 会在 v4 之后跑，把 v4 刚建好的分类全软删掉 ——
 *   于是 v4 的断言看着像是失败了，其实是 v5 干的。
 *
 *   有了这个函数，测试可以「只跑 v4」，互不干扰。
 *
 * @param {number} version 要跑的那条迁移的版本号
 * @returns {Promise<boolean>} 是否找到了并执行
 */
export async function runMigrationForTest(version) {
  const m = MIGRATIONS.find((x) => x.version === version)
  if (!m) return false
  await m.up()
  return true
}

/** 打开数据库（并发调用共享同一个 Promise） */
export function openDb() {
  if (opened) return Promise.resolve(true)
  if (opening) return opening

  const p = (async () => {
    await waitForPlus()

    // 已打开过同名库时 openDatabase 会失败，先尝试关闭一次（忽略错误）
    try {
      await new Promise((resolve) => {
        plus.sqlite.closeDatabase({ name: DB_NAME, success: resolve, fail: resolve })
      })
    } catch (e) {}

    await call('openDatabase', { name: DB_NAME, path: DB_PATH })

    await migrate()
    opened = true
    console.log('[db] opened', DB_PATH)
    return true
  })()

  opening = p

  // 失败后要清掉缓存的 Promise，否则后续调用会一直拿到同一个 rejected
  return p.catch((e) => {
    opening = null
    throw e
  })
}

export function isOpened() {
  return opened
}

export async function closeDb() {
  if (!opened) return
  try {
    await call('closeDatabase', { name: DB_NAME })
  } catch (e) {}
  opened = false
  opening = null
}

/* ------------------------------------------------------------- 查询/执行 */

/** 查询，返回行数组 */
export async function query(sql, params = []) {
  await openDb()
  const rows = await call('selectSql', {
    name: DB_NAME,
    sql: bindParams(sql, params)
  })
  return Array.isArray(rows) ? rows : []
}

/** 查询单行，无结果返回 null */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params)
  return rows.length > 0 ? rows[0] : null
}

/** 查询单个标量值 */
export async function queryScalar(sql, params = []) {
  const row = await queryOne(sql, params)
  if (!row) return null
  const keys = Object.keys(row)
  return keys.length > 0 ? row[keys[0]] : null
}

/** 执行写入，返回受影响行数（拿不到时返回 true） */
export async function execute(sql, params = []) {
  await openDb()
  const res = await call('executeSql', {
    name: DB_NAME,
    sql: bindParams(sql, params)
  })
  return res
}

/**
 * 事务。所有涉及余额变动的操作必须走这里。
 * 注意：plus.sqlite 的 begin/commit 是独立调用，没有自动回滚，
 * 因此 catch 里必须显式 rollback。
 */
export async function transaction(fn) {
  await openDb()
  await call('transaction', { name: DB_NAME, operation: 'begin' })
  try {
    const result = await fn()
    await call('transaction', { name: DB_NAME, operation: 'commit' })
    return result
  } catch (e) {
    try {
      await call('transaction', { name: DB_NAME, operation: 'rollback' })
    } catch (rollbackErr) {
      console.error('[db] rollback failed', rollbackErr)
    }
    throw e
  }
}

/** 批量执行（同一事务内），用于导入 */
export async function batchExecute(sqlList) {
  return transaction(async () => {
    for (const item of sqlList) {
      if (typeof item === 'string') {
        await execute(item)
      } else {
        await execute(item.sql, item.params || [])
      }
    }
  })
}

/** 清空所有业务表（保留结构），用于「清空数据」与「覆盖导入」 */
export async function truncateAll() {
  const tables = [
    'txn_tag', 'txn', 'account_snapshot', 'budget',
    'category', 'tag', 'account', 'setting', 'app_meta'
  ]
  return transaction(async () => {
    for (const t of tables) {
      await execute(`DELETE FROM ${t}`)
    }
  })
}

/**
 * Upsert 辅助 —— 不用 ON CONFLICT DO UPDATE。
 * 原因：Android 各版本内置的 SQLite 内核版本不一致，
 * ON CONFLICT DO UPDATE 需要 3.24+，在旧内核上会直接报语法错误。
 * 这里统一退化为「先 UPDATE，若不存在则 INSERT」，兼容所有版本。
 *
 * @param {string} table
 * @param {object} row 字段名 -> 值
 * @param {string[]} keyCols 唯一键列
 */
export async function upsert(table, row, keyCols) {
  const cols = Object.keys(row)
  const where = keyCols.map((k) => `${k} = ?`).join(' AND ')
  const whereParams = keyCols.map((k) => row[k])

  const exist = await queryOne(`SELECT 1 AS x FROM ${table} WHERE ${where}`, whereParams)

  if (exist) {
    return execute(
      `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${where}`,
      cols.map((c) => row[c]).concat(whereParams)
    )
  }
  return execute(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => row[c])
  )
}

/** 调试用：列出所有表 */
export async function listTables() {
  return query(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
}

export { DB_NAME, DB_PATH, bindParams }
