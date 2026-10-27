/**
 * DAO 门面 —— 对上层只暴露 open / query / execute / transaction
 *
 * 为什么不让业务层直接用 plus.sqlite：
 *   1. plus.sqlite 全是回调式 API，业务层写下去会形成回调地狱
 *   2. 参数占位符在不同内核版本下支持程度不一致，需要统一在这里做绑定
 *   3. 事务必须手动 begin/commit，散落在业务层极易漏掉导致余额错乱
 */

import { SCHEMA_V1, INDEXES_V1, SCHEMA_VERSION } from './schema.js'

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
  }
]

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
