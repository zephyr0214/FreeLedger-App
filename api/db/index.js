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
let platformSupported = typeof plus !== 'undefined' && !!plus.sqlite

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

function call(fn, arg) {
  return new Promise((resolve, reject) => {
    if (!platformSupported) {
      reject(new Error('SQLite 仅在 App 端可用，请在 HBuilderX 中运行到手机或模拟器'))
      return
    }
    fn({
      ...arg,
      success: resolve,
      fail: (e) => reject(new Error(e.message || `SQLite 执行失败: ${e.code || ''}`))
    })
  })
}

/* ------------------------------------------------------------ 打开与迁移 */

async function readUserVersion() {
  try {
    const rows = await call(plus.sqlite.selectSql, {
      name: DB_NAME,
      sql: 'PRAGMA user_version'
    })
    if (rows && rows.length > 0) {
      const first = rows[0]
      return Number(first.user_version !== undefined ? first.user_version : Object.values(first)[0]) || 0
    }
  } catch (e) {
    // 表尚未创建等情况，视为 0
  }
  return 0
}

async function writeUserVersion(v) {
  await call(plus.sqlite.executeSql, { name: DB_NAME, sql: `PRAGMA user_version = ${Number(v)}` })
}

/** 执行建表与索引 —— 幂等，用 IF NOT EXISTS */
async function applySchemaV1() {
  for (const sql of SCHEMA_V1) {
    await call(plus.sqlite.executeSql, { name: DB_NAME, sql })
  }
  for (const sql of INDEXES_V1) {
    try {
      await call(plus.sqlite.executeSql, { name: DB_NAME, sql })
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
  }
  // {
  //   version: 2,
  //   up: async () => { await execute('ALTER TABLE txn ADD COLUMN attachment TEXT') }
  // }
]

async function migrate() {
  const current = await readUserVersion()
  if (current >= SCHEMA_VERSION) return

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    console.log(`[db] migrating -> v${m.version}`)
    await m.up()
    await writeUserVersion(m.version)
  }
}

/** 打开数据库（并发调用共享同一个 Promise） */
export function openDb() {
  if (opened) return Promise.resolve(true)
  if (opening) return opening

  opening = (async () => {
    if (!platformSupported) {
      throw new Error('SQLite 仅在 App 端可用，请在 HBuilderX 中运行到手机或模拟器')
    }
    await call(plus.sqlite.openDatabase, { name: DB_NAME, path: DB_PATH })
    await migrate()
    opened = true
    console.log('[db] opened', DB_PATH)
    return true
  })()

  return opening
}

export function isOpened() {
  return opened
}

export async function closeDb() {
  if (!opened) return
  try {
    await call(plus.sqlite.closeDatabase, { name: DB_NAME })
  } catch (e) {}
  opened = false
  opening = null
}

/* ------------------------------------------------------------- 查询/执行 */

/** 查询，返回行数组 */
export async function query(sql, params = []) {
  await openDb()
  const rows = await call(plus.sqlite.selectSql, {
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
  const res = await call(plus.sqlite.executeSql, {
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
  await call(plus.sqlite.transaction, { name: DB_NAME, operation: 'begin' })
  try {
    const result = await fn()
    await call(plus.sqlite.transaction, { name: DB_NAME, operation: 'commit' })
    return result
  } catch (e) {
    try {
      await call(plus.sqlite.transaction, { name: DB_NAME, operation: 'rollback' })
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
 * 这里统一退化为「先 UPDATE，若影响 0 行则 INSERT」，兼容所有版本。
 *
 * @param {string} table
 * @param {object} row 字段名 -> 值
 * @param {string[]} keyCols 唯一键列
 */
export async function upsert(table, row, keyCols) {
  const cols = Object.keys(row)
  const where = keyCols.map((k) => `${k} = ?`).join(' AND ')
  const whereParams = keyCols.map((k) => row[k])

  const updated = await execute(
    `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${where}`,
    cols.map((c) => row[c]).concat(whereParams)
  )

  // plus.sqlite 的 executeSql 通常不返回 changes，改用存在性判断
  const exist = await queryOne(`SELECT 1 AS x FROM ${table} WHERE ${where}`, whereParams)
  if (!exist) {
    await execute(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => row[c])
    )
  }
  return updated
}

/** 调试用：列出所有表 */
export async function listTables() {
  return query(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
}

export { DB_NAME, DB_PATH, bindParams }
