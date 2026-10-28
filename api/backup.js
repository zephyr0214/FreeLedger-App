/**
 * 数据备份 / 恢复
 *
 * 设计要点：
 *   1. 导出包含 settings + accounts + snapshots + categories + tags + txn + txn_tag + budgets
 *   2. API Key 默认不导出，需显式勾选（防误分享）
 *   3. 恢复前自动备份当前库（最后一道保险）
 *   4. 恢复只支持「覆盖」一种模式
 *   5. 文件自带 schemaVersion，未来结构变更可迁移老文件
 */

import { query, queryOne, execute, transaction, truncateAll } from './db/index.js'
import { getAllSettings, setSettings, clearSettingsCache } from './settings.js'
import { prefixedId } from '../utils/id.js'
import { recalcAllBalances } from './account.js'

const BACKUP_APP_ID = 'books'
const BACKUP_SCHEMA_VERSION = 1
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
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
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
 * 低级文件写入（plus.io）
 *
 * ═════════════════════════════════════════════════════════════
 * ★ 修过一个「备份写坏了，恢复时报『不是有效的 JSON』」的 bug ★
 *
 * 现象：点「恢复」报「备份文件不是有效的 JSON」，
 *      但文件明明是本 App 自己写出来的。
 *
 * 根因
 *   原实现是这样覆盖已有文件的：
 *       writer.truncate(0)   // 截断到 0
 *       writer.write(content) // 从当前位置写
 *
 *   ★ truncate(0) 在 Android 上不靠谱 ★
 *   plus.io 的 FileWriter.truncate 是 5+ 的实现，
 *   DCloud 官方论坛明确说过这是 Android 平台的 bug：
 *   「seek方法指定到特定位置pos后写入数据应该覆盖pos位置后的所有数据」
 *   「Android平台临时解决方法只能先删除原来文件避免」。
 *
 *   而且还有第二个坑：即使 truncate 生效了，
 *   write 的**起始位置**可能不在 0 ——
 *   新建 writer 时位置是 0，但对已有文件 createWriter 后位置是未定义的。
 *   结果就是新内容写在了旧内容后面，或者中间，
 *   读回来就不是合法的 JSON 了。
 *
 * 修法（按官方推荐）
 *   同名文件先 remove 掉，再 create 写全新的 ——
 *   这样文件必然是空的、写入位置必然是 0，
 *   不依赖 truncate/seek 在各 ROM 上的行为差异。
 *
 * 附带的另一个修复
 *   writer.onwriteend 才是「写完了」的信号；
 *   onwrite 在部分 ROM 上会随分块写入多次触发，
 *   提前 resolve 会让调用方以为写完了，实际文件还没写完 ——
 *   紧接着去读就会读到半截文件。
 *
 * @param {string} dir 目录（相对 _doc/ 或以 _doc/ 开头），如 '_doc/backup/'
 * @param {string} filename 文件名
 * @param {string} content 内容
 * @returns {Promise<string>} 写入的相对路径
 */
export function writeTextFile(dir, filename, content) {
  return new Promise((resolve, reject) => {
    if (typeof plus === 'undefined') {
      reject(new Error('文件写入仅在 App 端可用'))
      return
    }

    const fullPath = `${dir}${filename}`
    // 目录统一成「相对 _doc/ 的路径」：'export' / 'backup'
    const relDir = String(dir)
      .replace(/^_doc\//, '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')

    /** 真正写文件（目录已就绪） */
    const writeInto = (dirEntry) => {
      /** 新建一个空文件并写入 */
      const doWrite = () => {
        dirEntry.getFile(
          filename,
          { create: true },
          (freshEntry) => {
            freshEntry.createWriter(
              (writer) => {
                // ★ onwriteend 才是写完的信号 ★
                writer.onwriteend = () => resolve(fullPath)
                writer.onerror = (e) =>
                  reject(new Error('写入失败: ' + ((e && e.message) || '')))
                // 位置归零（新建文件本来就在 0，这里只是保险）
                try { writer.seek(0) } catch (err) {}
                writer.write(content)
              },
              () => reject(new Error('创建写入流失败'))
            )
          },
          () => reject(new Error('创建文件失败'))
        )
      }

      // ★ 先删掉已有文件，再重新写 ★
      //   见函数头的说明：Android 上 truncate/seek 不可靠，
      //   「删了重写」是唯一在各 ROM 上都确定正确的做法。
      //   getFile(create:false) 找不到会走失败回调，正好用来判断有没有旧文件。
      try {
        dirEntry.getFile(
          filename,
          { create: false },
          (oldFile) => {
            oldFile.remove(
              () => doWrite(),
              () => doWrite()   // 删不掉也照样写
            )
          },
          () => doWrite()       // 没有旧文件
        )
      } catch (e) {
        doWrite()
      }
    }

    plus.io.resolveLocalFileSystemURL(
      '_doc/',
      (root) => {
        if (!relDir) {
          writeInto(root)
          return
        }
        root.getDirectory(
          relDir,
          { create: true },
          writeInto,
          () => reject(new Error(`无法创建目录 ${relDir}`))
        )
      },
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
            // ★ 结果可能挂在三个不同的属性上 ★
            //   不同基座/版本里 onloadend 的事件对象不一样：
            //     e.target.result / e.result / reader.result
            //   只取 e.target.result 的话，部分机型上拿到 undefined，
            //   后面的 JSON.parse 就报「不是有效的 JSON」。
            reader.onloadend = (e) => {
              const result =
                (e && e.target && e.target.result !== undefined && e.target.result) ||
                (e && e.result !== undefined && e.result) ||
                reader.result
              if (typeof result !== 'string') {
                reject(new Error('读取文件内容失败（内容不是文本）'))
                return
              }
              resolve(result)
            }
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

/**
 * 宽松地解析 JSON —— 容忍 BOM 和首尾空白。
 *
 * ★ 为什么需要 ★
 *   某些 ROM 的 readAsText 会在文件开头带上 UTF-8 BOM（\uFEFF），
 *   而 JSON.parse 对 BOM 是直接报错的：
 *     JSON.parse('\uFEFF{}')  ->  SyntaxError
 *   表现就是「明明是自己写的文件，却说不是有效的 JSON」。
 *
 * @param {string} text 文本
 * @returns {object} 解析结果
 */
export function parseJsonLoose(text) {
  if (typeof text !== 'string') throw new Error('内容不是文本')
  // 去掉 BOM（U+FEFF）和首尾空白
  const cleaned = text.replace(/^\uFEFF/, '').trim()
  return JSON.parse(cleaned)
}

/* ------------------------------------------------------------------ 恢复 */

 /** 校验备份数据 */
export function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('文件内容不是有效的 JSON 对象')
  if (payload.app !== BACKUP_APP_ID) throw new Error('这不是本应用生成的备份文件')
  const v = Number(payload.schemaVersion) || 0
  if (v > BACKUP_SCHEMA_VERSION) {
    throw new Error(`备份文件版本 (v${v}) 高于当前应用 (v${BACKUP_SCHEMA_VERSION})，请先升级应用`)
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

  // 恢复后重算所有余额，修正任何不一致
  await recalcAllBalances()

  return report
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

/**
 * 从一份备份文件恢复数据（覆盖当前数据）。
 *
 * ★ 为什么要有这个函数 ★
 *   之前页面里有个 doImport(path, mode) 负责所有导入，
 *   它同时服务于「用户导入外部文件」和「从备份恢复」。
 *   现在外部导入功能被删了，就只剩「从备份恢复」这一种用法 ——
 *   所以把它收敛到 api 层，页面只管调这一个函数。
 *
 * @param {string} relPath 备份文件的相对路径
 * @returns {Promise<object>} 恢复报告
 */
export async function restoreBackup(relPath) {
  const text = await readTextFile(relPath)
  let payload
  try {
    payload = parseJsonLoose(text)
  } catch (e) {
    // ★ 报错要说清楚到底是哪种情况 ★
    //   「不是有效的 JSON」这种话用户没法处理，
    //   实际可能是：文件被截断了（BOM/半个文件）、编码不对、文件根本不是备份。
    const size = typeof text === 'string' ? text.length : 0
    throw new Error(
      `备份文件解析失败（读到 ${size} 个字符）。` +
      '可能是文件写入不完整，或这个文件不是本应用生成的备份。'
    )
  }
  return importPayload(payload, { mode: 'overwrite' })
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

/**
 * 距上次备份过了多少天。
 *
 * ★ 为什么是「备份」不是「导出」★
 *   导出功能被删掉了，这个提示原本挂在「数据与备份」菜单的副标题上，
 *   改成显示备份状态才有意义。
 *
 * @returns {Promise<number>} 天数；从未备份过返回 Infinity
 */
export async function daysSinceLastBackup() {
  const list = await listBackups()
  if (!list || list.length === 0) return Infinity
  const last = list[0].time
  if (!last) return Infinity
  return Math.floor((Date.now() - Number(last)) / 86400000)
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