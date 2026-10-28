/**
 * 数据导出 / 导入 / 自动备份
 *
 * 设计要点：
 *   1. 导出包含 settings + accounts + snapshots + categories + tags + txn + txn_tag + budgets
 *   2. API Key 默认不导出，需显式勾选（防误分享）
 *   3. 导入前自动备份当前库（最后一道保险）
 *   4. 导入支持「合并 / 覆盖」两种模式，合并按 id 去重、updated_at 取新
 *   5. 文件自带 schemaVersion，未来结构变更可迁移老文件
 */

import { query, queryOne, execute, transaction, truncateAll } from './db/index.js'
import { getAllSettings, setSettings, clearSettingsCache } from './settings.js'
import { prefixedId } from '../utils/id.js'
import { recalcAllBalances } from './account.js'

export const EXPORT_APP_ID = 'books'
export const EXPORT_SCHEMA_VERSION = 1
const MAX_AUTO_BACKUPS = 5
const BACKUP_DIR = '_doc/backup/'

/* ------------------------------------------------------------------ 导出 */

/**
 * 生成导出对象
 * @param {object} opt { includeApiKey: boolean, includeDeleted: boolean }
 */
export async function buildExportPayload(opt = {}) {
  const { includeApiKey = false, includeDeleted = false } = opt

  const settings = await getAllSettings()
  const exportedSettings = { ...settings }
  if (!includeApiKey && exportedSettings.ai) {
    exportedSettings.ai = { ...exportedSettings.ai, apiKey: '' }
  }

  const whereNotDeleted = includeDeleted ? '' : 'WHERE deleted_at IS NULL'

  const [accounts, snapshots, categories, tags, transactions, txnTags, budgets] = await Promise.all([
    query(`SELECT * FROM account ${whereNotDeleted} ORDER BY sort ASC`),
    query('SELECT * FROM account_snapshot ORDER BY day ASC'),
    query(`SELECT * FROM category ${whereNotDeleted} ORDER BY sort ASC`),
    query(`SELECT * FROM tag ${whereNotDeleted} ORDER BY sort ASC`),
    query(`SELECT * FROM txn ${whereNotDeleted} ORDER BY occurred_at ASC`),
    query('SELECT * FROM txn_tag'),
    query('SELECT * FROM budget')
  ])

  return {
    app: EXPORT_APP_ID,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    appVersion: '1.0.0',
    counts: {
      accounts: accounts.length,
      transactions: transactions.length,
      categories: categories.length,
      tags: tags.length,
      budgets: budgets.length
    },
    settings: exportedSettings,
    accounts,
    accountSnapshots: snapshots,
    categories,
    tags,
    transactions,
    txnTags,
    budgets
  }
}

/** 导出为 JSON 字符串 */
export async function exportToJson(opt = {}) {
  const payload = await buildExportPayload(opt)
  return JSON.stringify(payload, null, 2)
}

/**
 * 生成文件名里的时间戳（精确到秒 + 毫秒尾数）
 *
 * ★ 为什么不能用「精确到分钟」★
 *   原来是 books_20261028_1323.json。
 *   同一分钟内导两次 → 文件名完全相同 → 第二次会去覆盖第一次那个文件。
 *   覆盖本身在多数 ROM 上能成功，但如果第一次的文件正被分享/被其它
 *   进程打开，写入就会失败 —— 表现为「导出过一次，再导出就失败」。
 *   加上秒和毫秒尾数，基本不可能撞名。
 */
function makeStamp() {
  const now = new Date()
  const p2 = (n) => String(n).padStart(2, '0')
  const ymd = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`
  const hms = `${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
  const ms = String(now.getMilliseconds()).padStart(3, '0').slice(0, 2)
  return `${ymd}_${hms}${ms}`
}

/**
 * 导出到文件
 * @returns {Promise<{path: string, filename: string, size: number}>}
 */
export async function exportToFile(opt = {}) {
  const json = await exportToJson(opt)
  const filename = `books_${makeStamp()}.json`

  const path = await writeTextFile('_doc/export/', filename, json)
  return { path, filename, size: json.length }
}

/**
 * 把文件复制到目标目录。
 *
 * 用于「导出后自定义位置」：用户选个目录，把 JSON 复制过去，
 * 这样文件管理器 / 微信 / 网盘都能找到。
 *
 * @param {string} absSrcPath 源文件绝对路径
 * @param {string} targetDir 目标目录（plus.io 认识的形式，如 '_downloads/'）
 * @param {string} fileName 目标文件名
 * @returns {Promise<string>} 目标绝对路径
 */
export function copyFileTo(absSrcPath, targetDir, fileName) {
  return new Promise((resolve, reject) => {
    if (typeof plus === 'undefined') {
      reject(new Error('仅在 App 端可用'))
      return
    }

    plus.io.resolveLocalFileSystemURL(
      absSrcPath,
      (srcEntry) => {
        plus.io.resolveLocalFileSystemURL(
          targetDir,
          (dirEntry) => {
            // 先删同名的旧文件，避免 copyTo 因目标已存在而失败
            dirEntry.getFile(
              fileName,
              { create: false },
              (oldFile) => {
                oldFile.remove(
                  () => doCopy(srcEntry, dirEntry, fileName, targetDir, resolve, reject),
                  () => doCopy(srcEntry, dirEntry, fileName, targetDir, resolve, reject)
                )
              },
              () => doCopy(srcEntry, dirEntry, fileName, targetDir, resolve, reject)
            )
          },
          () => reject(new Error(`无法访问目标目录：${targetDir}`))
        )
      },
      () => reject(new Error('找不到源文件'))
    )
  })
}

function doCopy(srcEntry, dirEntry, fileName, targetDir, resolve, reject) {
  srcEntry.copyTo(
    dirEntry,
    fileName,
    (newEntry) => {
      try {
        resolve(newEntry.fullPath || `${targetDir}${fileName}`)
      } catch (e) {
        resolve(`${targetDir}${fileName}`)
      }
    },
    (e) => reject(new Error('复制失败: ' + ((e && e.message) || '')))
  )
}

/**
 * 把相对路径（_doc/export/xxx.json）解析成可供分享的绝对路径。
 *
 * ★ 为什么必须转 ★
 *   plus.share.sendWithSystem 的 filePath 要的是**绝对路径**，
 *   传 '_doc/export/xxx.json' 这种相对路径，
 *   系统分享会报「获取资源失败」（拿不到这个资源）。
 *
 * ★ 为什么 convertLocalFileSystemURL 不一定够 ★
 *   它在不同基座/ROM 上返回的东西不一样：
 *     有的返回 file:///storage/emulated/0/Android/data/<pkg>/doc/xxx.json
 *     有的只返回 /storage/... 这样的裸路径（没有 file:// 前缀）
 *     还有的（HBuilderX 标准基座）会原样把 _doc/xxx 返回回来
 *   后两种都还是拿不到资源。
 *
 *   所以这里做三重兜底：
 *     1. convertLocalFileSystemURL，结果带 file:// 就直接用
 *     2. 结果不带 file:// 但以 / 开头 → 前面补 file://
 *     3. 上面都不行 → 用 plus.io 的根目录 root.fullPath 自己拼
 *
 * @param {string} relPath 相对路径，如 '_doc/export/books_xxx.json'
 * @returns {string} 绝对路径（尽力而为，转换不出来就原样返回）
 */
export function toAbsolutePath(relPath) {
  if (typeof plus === 'undefined' || !relPath) return relPath || ''

  const raw = String(relPath)

  // 已经是 file:// 就原样返回
  if (/^file:\/\//i.test(raw)) return raw

  // ---- 1) 系统转换 ----
  try {
    if (plus.io && typeof plus.io.convertLocalFileSystemURL === 'function') {
      const abs = plus.io.convertLocalFileSystemURL(raw)
      if (abs && typeof abs === 'string') {
        if (/^file:\/\//i.test(abs)) return abs
        // 裸绝对路径 -> 补协议
        if (abs.startsWith('/')) return 'file://' + abs
      }
    }
  } catch (e) {
    console.warn('[backup] 路径转换失败:', e && e.message)
  }

  // ---- 2) 用 plus.io 的根目录自己拼 ----
  //   plus.io 里 _doc 对应应用私有文档目录，
  //   root.fullPath 一般是 file:///storage/emulated/0/Android/data/<pkg>/
  try {
    if (typeof plus.io !== 'undefined' && plus.io) {
      const docDir = plus.io.PRIVATE_DOC || '_doc/'
      const joined = raw.replace(/^_doc\//, docDir)
      if (/^file:\/\//i.test(joined)) return joined
    }
  } catch (e) {}

  // ---- 3) 实在转不出来 ----
  //   返回原值，让调用方把「文件在哪」告诉用户（至少不至于白导）
  return raw
}

/**
 * 确保分享前文件真的在磁盘上，并把路径转成绝对路径。
 *
 * 分享报「获取资源失败」还有一个可能：文件压根没写成功。
 * 所以这里先 resolve 一次，确认拿得到 fileEntry 再返回路径。
 *
 * @param {string} relPath 相对路径
 * @returns {Promise<string>} 绝对路径
 */
export function resolveSharePath(relPath) {
  return new Promise((resolve, reject) => {
    if (typeof plus === 'undefined') {
      reject(new Error('分享仅在 App 端可用'))
      return
    }
    if (!relPath) {
      reject(new Error('文件路径为空'))
      return
    }

    // 先确认文件存在
    plus.io.resolveLocalFileSystemURL(
      relPath,
      (entry) => {
        if (!entry || !entry.isFile) {
          reject(new Error('导出文件不存在，请重新导出'))
          return
        }
        // fullPath 在多数基座上是绝对路径，优先用它
        let p = ''
        try { p = entry.fullPath || '' } catch (e) {}
        const abs = toAbsolutePath(p || relPath)
        resolve(abs)
      },
      () => reject(new Error('导出文件不存在，请重新导出'))
    )
  })
}

/**
 * 低级文件写入（plus.io）
 *
 * ★ 修过一个「第一次成功、第二次失败」的 bug ★
 *   原实现先 resolveLocalFileSystemURL(dir)：
 *     - 目录不存在 → 走失败回调，递归建目录（这条路径是好的）
 *     - 目录已存在 → entry 是**目录本身**，然后在它上面调
 *       entry.getDirectory('', ...) —— 空目录名在部分 Android ROM 上
 *       直接报错，于是第二次导出就失败了。
 *   现在改成：
 *     1. 先用 resolveLocalFileSystemURL 拿 _doc/ 根
 *     2. 用 getDirectory(相对路径, { create: true }) 一次性建出（或拿到）目录
 *        getDirectory 的 create:true 本来就是幂等的，目录存在就直接返回
 *     3. 再 getFile + createWriter
 *   一条路径走到底，不再分「存在/不存在」两种情况。
 *
 * @param {string} dir 目录（相对 _doc/ 或以 _doc/ 开头），如 '_doc/export/'
 * @param {string} filename 文件名
 * @param {string} content 内容
 * @returns {Promise<string>} 写入的相对路径
 */
export function writeTextFile(dir, filename, content) {
  return new Promise((resolve, reject) => {
    if (typeof plus === 'undefined') {
      reject(new Error('文件导出仅在 App 端可用'))
      return
    }

    const fullPath = `${dir}${filename}`
    // 目录统一成「相对 _doc/ 的路径」：'export' / 'backup'
    const relDir = String(dir)
      .replace(/^_doc\//, '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')

    const writeInto = (parentEntry) => {
      const onDir = (dirEntry) => {
        dirEntry.getFile(
          filename,
          { create: true },
          (fileEntry) => {
            fileEntry.createWriter(
              (writer) => {
                // ★ onwriteend 比 onwrite 更可靠 ★
                //   onwrite 在部分 ROM 上会被多次触发（分块写入），
                //   提前 resolve 会让调用方拿到一个还没写完的文件，
                //   紧接着的分享/读取就会失败。
                writer.onwriteend = () => resolve(fullPath)
                writer.onerror = (e) => reject(new Error('写入失败: ' + ((e && e.message) || '')))
                // 已有同名文件时先截断，否则会残留上一次的尾部内容
                try { writer.truncate(0) } catch (err) {}
                writer.write(content)
              },
              () => reject(new Error('创建写入流失败'))
            )
          },
          () => reject(new Error('创建文件失败'))
        )
      }

      if (!relDir) {
        onDir(parentEntry)
        return
      }
      parentEntry.getDirectory(
        relDir,
        { create: true },
        onDir,
        () => reject(new Error(`无法创建目录 ${relDir}`))
      )
    }

    plus.io.resolveLocalFileSystemURL(
      '_doc/',
      (root) => writeInto(root),
      () => reject(new Error('无法访问 _doc 目录'))
    )
  })
}

/** 读取文本文件 */
export function readTextFile(path) {
  return new Promise((resolve, reject) => {
    if (typeof plus === 'undefined') {
      reject(new Error('文件读取仅在 App 端可用'))
      return
    }
    plus.io.resolveLocalFileSystemURL(
      path,
      (entry) => {
        entry.file(
          (file) => {
            const reader = new plus.io.FileReader()
            reader.onloadend = (e) => resolve(e.target.result)
            reader.onerror = () => reject(new Error('读取文件失败'))
            reader.readAsText(file, 'utf-8')
          },
          () => reject(new Error('无法读取文件'))
        )
      },
      () => reject(new Error('文件不存在或路径无效: ' + path))
    )
  })
}

/** 列出导出目录中的文件 */
export function listExportFiles() {
  return new Promise((resolve) => {
    if (typeof plus === 'undefined') {
      resolve([])
      return
    }
    plus.io.resolveLocalFileSystemURL(
      '_doc/export/',
      (entry) => {
        const reader = entry.createReader()
        reader.readEntries(
          (entries) => {
            const files = entries
              .filter((e) => e.isFile && e.name.endsWith('.json'))
              .map((e) => ({ name: e.name, path: `_doc/export/${e.name}` }))
            resolve(files)
          },
          () => resolve([])
        )
      },
      () => resolve([])
    )
  })
}

/* ------------------------------------------------------------------ 导入 */

/** 校验导入数据 */
export function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('文件内容不是有效的 JSON 对象')
  if (payload.app !== EXPORT_APP_ID) throw new Error('这不是本应用导出的备份文件')
  const v = Number(payload.schemaVersion) || 0
  if (v > EXPORT_SCHEMA_VERSION) {
    throw new Error(`备份文件版本 (v${v}) 高于当前应用 (v${EXPORT_SCHEMA_VERSION})，请先升级应用`)
  }
  return true
}

/**
 * 导入
 * @param {object} payload 解析后的导出对象
 * @param {object} opt { mode: 'merge' | 'overwrite', skipBeforeBackup: boolean }
 */
export async function importPayload(payload, opt = {}) {
  const { mode = 'merge', skipBeforeBackup = false } = opt
  validatePayload(payload)

  const report = {
    mode,
    accounts: 0, transactions: 0, categories: 0, tags: 0, budgets: 0,
    skipped: 0, conflicts: 0, backupPath: null
  }

  // 导入前自动备份当前库
  if (!skipBeforeBackup) {
    try {
      const hasData = await queryOne('SELECT COUNT(*) AS c FROM txn')
      if (hasData && Number(hasData.c) > 0) {
        const backup = await autoBackup('before-import')
        report.backupPath = backup ? backup.path : null
      }
    } catch (e) {
      console.warn('[import] 导入前备份失败:', e.message)
    }
  }

  if (mode === 'overwrite') {
    await truncateAll()
    clearSettingsCache()
  }

  await transaction(async () => {
    // ---------- 设置
    if (payload.settings) {
      const merged = { ...payload.settings }
      // 合并模式下不覆盖本机 API Key（除非备份里有值）
      if (mode === 'merge' && merged.ai && !merged.ai.apiKey) {
        const cur = await getAllSettings()
        merged.ai.apiKey = cur.ai.apiKey
      }
      await setSettings(merged)
    }

    // ---------- 账户
    if (Array.isArray(payload.accounts)) {
      for (const a of payload.accounts) {
        const exists = mode === 'merge' ? await queryOne('SELECT id FROM account WHERE id = ?', [a.id]) : null
        if (exists) {
          report.skipped++
          continue
        }
        await execute(
          `INSERT INTO account (id, name, type, icon, color, initial_balance_cents, balance_cents,
            include_in_total, credit_limit_cents, bill_day, repay_day, card_tail, sort, archived,
            created_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            a.id, a.name, a.type, a.icon || null, a.color || null,
            a.initial_balance_cents || 0, a.balance_cents || 0,
            a.include_in_total === undefined ? 1 : a.include_in_total,
            a.credit_limit_cents === undefined ? null : a.credit_limit_cents,
            a.bill_day === undefined ? null : a.bill_day,
            a.repay_day === undefined ? null : a.repay_day,
            a.card_tail || null, a.sort || 0, a.archived || 0,
            a.created_at || Date.now(), a.updated_at || Date.now(), a.deleted_at || null
          ]
        )
        report.accounts++
      }
    }

    // ---------- 分类
    if (Array.isArray(payload.categories)) {
      for (const c of payload.categories) {
        const exists = mode === 'merge' ? await queryOne('SELECT id FROM category WHERE id = ?', [c.id]) : null
        if (exists) { report.skipped++; continue }
        await execute(
          `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            c.id, c.parent_id || null, c.name, c.type, c.icon || null, c.color || null,
            c.sort || 0, c.hidden || 0, c.created_at || Date.now(), c.updated_at || Date.now(), c.deleted_at || null
          ]
        )
        report.categories++
      }
    }

    // ---------- 标签
    if (Array.isArray(payload.tags)) {
      for (const t of payload.tags) {
        const exists = mode === 'merge' ? await queryOne('SELECT id FROM tag WHERE id = ?', [t.id]) : null
        if (exists) { report.skipped++; continue }
        await execute(
          `INSERT INTO tag (id, name, color, sort, archived, created_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,?)`,
          [t.id, t.name, t.color || null, t.sort || 0, t.archived || 0,
           t.created_at || Date.now(), t.updated_at || Date.now(), t.deleted_at || null]
        )
        report.tags++
      }
    }

    // ---------- 交易
    if (Array.isArray(payload.transactions)) {
      for (const t of payload.transactions) {
        const exists = mode === 'merge' ? await queryOne('SELECT id FROM txn WHERE id = ?', [t.id]) : null
        if (exists) { report.skipped++; continue }
        await execute(
          `INSERT INTO txn (id, type, amount_cents, account_id, to_account_id, category_id, note,
            occurred_at, occurred_day, month_key, year_key, tz_offset, source, raw_text,
            created_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            t.id, t.type, t.amount_cents, t.account_id, t.to_account_id || null,
            t.category_id || null, t.note || '',
            t.occurred_at, t.occurred_day, t.month_key, t.year_key, t.tz_offset || 480,
            t.source || 'import', t.raw_text || null,
            t.created_at || Date.now(), t.updated_at || Date.now(), t.deleted_at || null
          ]
        )
        report.transactions++
      }
    }

    // ---------- 交易标签关联
    if (Array.isArray(payload.txnTags)) {
      for (const tt of payload.txnTags) {
        await execute(
          'INSERT OR IGNORE INTO txn_tag (txn_id, tag_id) VALUES (?, ?)',
          [tt.txn_id, tt.tag_id]
        )
      }
    }

    // ---------- 预算
    if (Array.isArray(payload.budgets)) {
      for (const b of payload.budgets) {
        const exists = mode === 'merge' ? await queryOne('SELECT id FROM budget WHERE id = ?', [b.id]) : null
        if (exists) { report.skipped++; continue }
        await execute(
          `INSERT INTO budget (id, scope, category_id, period, amount_cents, start_month, rollover, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [b.id, b.scope, b.category_id || null, b.period || 'month', b.amount_cents,
           b.start_month, b.rollover || 0, b.created_at || Date.now(), b.updated_at || Date.now()]
        )
        report.budgets++
      }
    }

    // ---------- 快照
    if (Array.isArray(payload.accountSnapshots)) {
      for (const s of payload.accountSnapshots) {
        const exist = await queryOne(
          'SELECT id FROM account_snapshot WHERE account_id = ? AND day = ?',
          [s.account_id, s.day]
        )
        if (exist) {
          await execute('UPDATE account_snapshot SET balance_cents = ? WHERE id = ?', [
            s.balance_cents, exist.id
          ])
        } else {
          await execute(
            `INSERT INTO account_snapshot (id, account_id, day, balance_cents, created_at)
             VALUES (?,?,?,?,?)`,
            [s.id || prefixedId('snap'), s.account_id, s.day, s.balance_cents, s.created_at || Date.now()]
          )
        }
      }
    }
  })

  // 导入后重算所有余额，修正任何不一致
  await recalcAllBalances()
  clearSettingsCache()

  return report
}

/** 从文件导入 */
export async function importFromFile(path, opt = {}) {
  const text = await readTextFile(path)
  let payload
  try {
    payload = JSON.parse(text)
  } catch (e) {
    throw new Error('文件不是合法的 JSON 格式')
  }
  return importPayload(payload, opt)
}

/* ------------------------------------------------------------------ 备份 */

/** 自动备份（写入 _doc/backup/，滚动保留 5 份） */
export async function autoBackup(reason = 'auto') {
  try {
    const json = await exportToJson({ includeApiKey: true })
    const filename = `backup_${makeStamp()}_${reason}.json`
    const path = await writeTextFile(BACKUP_DIR, filename, json)

    await rotateBackups()
    return { path, filename, size: json.length }
  } catch (e) {
    console.warn('[backup] 失败:', e.message)
    return null
  }
}

/** 只保留最近 MAX_AUTO_BACKUPS 份 */
async function rotateBackups() {
  return new Promise((resolve) => {
    if (typeof plus === 'undefined') { resolve(); return }
    plus.io.resolveLocalFileSystemURL(
      BACKUP_DIR,
      (entry) => {
        const reader = entry.createReader()
        reader.readEntries(
          (entries) => {
            const files = entries
              .filter((e) => e.isFile && e.name.endsWith('.json'))
              .sort((a, b) => (a.name < b.name ? -1 : 1))

            const toDelete = files.slice(0, Math.max(files.length - MAX_AUTO_BACKUPS, 0))
            let pending = toDelete.length
            if (pending === 0) { resolve(); return }

            toDelete.forEach((entry) => {
              entry.remove(
                () => { if (--pending <= 0) resolve() },
                () => { if (--pending <= 0) resolve() }
              )
            })
          },
          () => resolve()
        )
      },
      () => resolve()
    )
  })
}

/** 列出所有备份 */
export function listBackups() {
  return new Promise((resolve) => {
    if (typeof plus === 'undefined') { resolve([]); return }
    plus.io.resolveLocalFileSystemURL(
      BACKUP_DIR,
      (entry) => {
        const reader = entry.createReader()
        reader.readEntries(
          (entries) => {
            const files = entries
              .filter((e) => e.isFile && e.name.endsWith('.json'))
              .map((e) => ({
                name: e.name,
                path: `${BACKUP_DIR}${e.name}`,
                // 从文件名解析时间：backup_20261027_131405_auto.json
                time: parseBackupName(e.name)
              }))
              .sort((a, b) => b.time - a.time)
            resolve(files)
          },
          () => resolve([])
        )
      },
      () => resolve([])
    )
  })
}

function parseBackupName(name) {
  const m = name.match(/backup_(\d{8})_(\d{6})/)
  if (!m) return 0
  const d = m[1]
  const t = m[2]
  return new Date(
    Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)),
    Number(t.slice(0, 2)), Number(t.slice(2, 4)), Number(t.slice(4, 6))
  ).getTime()
}

/** 距离上次导出的天数（首页提醒用） */
export async function daysSinceLastExport() {
  const settings = await getAllSettings()
  if (!settings.lastExportAt) return Infinity
  return Math.floor((Date.now() - Number(settings.lastExportAt)) / 86400000)
}
