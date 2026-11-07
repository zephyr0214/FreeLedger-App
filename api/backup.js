/**
 * 数据备份 / 恢复
 *
 * 设计要点：
 *   1. 导出包含 settings + accounts + snapshots + categories + tags + txn + txn_tag + budgets
 *      + budgetCategories（v18 起：子预算挂的多个类别）+ cycles
 *   2. API Key 默认不导出，需显式勾选（防误分享）
 *   3. 恢复前自动备份当前库（最后一道保险）
 *   4. 恢复只支持「覆盖」一种模式
 *   5. 文件自带 schemaVersion，未来结构变更可迁移老文件
 *   6. 旧版本（schemaVersion < 2）的备份不含 cycles，导入时自动按「无周期」处理，向后兼容
 */

import { query, queryOne, execute, transaction, truncateAll } from './db/index.js'
import { getAllSettings, setSettings, clearSettingsCache } from './settings.js'
import { prefixedId } from '../utils/id.js'
import { recalcAllBalances } from './account.js'
// ★ 覆盖导入时补默认分类 ★
//   （为什么必须补，见 importPayload 的 overwrite 分支注释）
import { seedDefaultCategories, syncDefaultCategories } from './category.js'

const BACKUP_APP_ID = 'books'
const BACKUP_SCHEMA_VERSION = 2
const MAX_AUTO_BACKUPS = 5
const BACKUP_DIR = '_doc/backup/'
/** 导出文件目录：用户主动导出、可分享的文件都放这里 */
const EXPORT_DIR = '_doc/export/'

/**
 * 导入/导出调试日志。
 *
 * ★ 为什么留 ★
 *   用户反馈「选择从文件导入后很慢/一直转圈」，但我在电脑上复现不了，
 *   只能靠用户手机上的日志定位。所以把导入/导出每一步都打点：
 *   console.log 会进原生 logcat（HBuilderX 控制台可见），
 *   同时 uni.showLoading 的标题会变成当前阶段，手机上也能看到卡在哪。
 *
 * @param {string} tag  阶段名
 * @param {*} [extra]   附加信息
 */
function logStep(tag, extra) {
  const ts = Date.now()
  const t = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${t.getHours()}:${pad(t.getMinutes())}:${pad(t.getSeconds())}.${String(ts % 1000).padStart(3, '0')}`
  console.log(`[自由记导入] ${stamp} ${tag}`, extra === undefined ? '' : extra)
}

/* ------------------------------------------------------------------ 导出 */

/**
 * 生成导出对象
 * @param {object} opt { includeApiKey: boolean, includeDeleted: boolean }
 */
async function buildExportPayload(opt = {}) {
  const { includeApiKey = false, includeDeleted = false } = opt

  const settings = await getAllSettings()
  const exportedSettings = { ...settings }
  if (!includeApiKey && exportedSettings.ai) {
    exportedSettings.ai = { ...exportedSettings.ai, apiKey: '' }
  }

  const whereNotDeleted = includeDeleted ? '' : 'WHERE deleted_at IS NULL'

  const [accounts, snapshots, categories, tags, transactions, txnTags, budgets, budgetCategories, cycles, comboMembers] = await Promise.all([
    query(`SELECT * FROM account ${whereNotDeleted} ORDER BY sort ASC`),
    query('SELECT * FROM account_snapshot ORDER BY day ASC'),
    query(`SELECT * FROM category ${whereNotDeleted} ORDER BY sort ASC`),
    query(`SELECT * FROM tag ${whereNotDeleted} ORDER BY sort ASC`),
    query(`SELECT * FROM txn ${whereNotDeleted} ORDER BY occurred_at ASC`),
    query('SELECT * FROM txn_tag'),
    query('SELECT * FROM budget'),
    // ★ 子预算挂的类别（v18）★
    //   不导出的话，多类别子预算恢复后只剩冗余列里的第一个类别，
    //   「已用」会突然变小 —— 用户会以为恢复把数据弄坏了。
    query('SELECT * FROM budget_category ORDER BY budget_id ASC, category_id ASC'),
    query(`SELECT * FROM cycle ${whereNotDeleted} ORDER BY created_at ASC`),
    // ★ 组合账户的成员关系 ★
    //   不导出的话，恢复后组合账户会变成「空壳」，用户还得重新配一遍。
    query('SELECT * FROM account_combo_member ORDER BY combo_id ASC, sort ASC')
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
      budgets: budgets.length,
      budgetCategories: budgetCategories.length,
      cycles: cycles.length,
      comboMembers: comboMembers.length
    },
    settings: exportedSettings,
    accounts,
    accountSnapshots: snapshots,
    categories,
    tags,
    transactions,
    txnTags,
    budgets,
    budgetCategories,
    cycles,
    comboMembers
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

/* ------------------------------------------------------ 导出文件与分享 */

/**
 * 把相对路径转成系统能识别的绝对路径。
 *
 * ★ 为什么需要 ★
 *   分享给别的 App 时必须给绝对路径
 *   （如 /storage/emulated/0/Android/data/xxx/apps/yyy/doc/export/a.json），
 *   plus.io 的 _doc/xxx 是 DCloud 的虚拟路径，系统不认。
 *   plus.io.convertLocalFileSystemURL 负责这层映射。
 *
 * @param {string} relPath 相对路径（_doc/export/x.json）
 * @returns {string} 绝对路径
 */
export function toAbsolutePath(relPath) {
  if (!relPath) return ''
  // 本来就是绝对路径就直接返回
  if (/^\//.test(relPath)) return relPath
  try {
    if (typeof plus !== 'undefined' && plus.io) {
      const abs = plus.io.convertLocalFileSystemURL(relPath)
      if (abs) return abs
    }
  } catch (e) {}
  return relPath
}

/**
 * 导出一份数据到文件。
 *
 * 落在 _doc/export/ 下，文件名带时间戳，可以导出很多份互不覆盖。
 *
 * @param {object} opt { includeApiKey, includeDeleted }
 * @returns {Promise<{path, name, bytes, time}>}
 */
export async function exportToFile(opt = {}) {
  const json = await exportToJson(opt)
  const name = `books_${makeStamp()}.json`
  const path = await writeTextFile(EXPORT_DIR, name, json)
  return { path, name, bytes: json.length, time: Date.now() }
}

/** 列出导出目录里的文件（新的排前面） */
export function listExportFiles() {
  return new Promise((resolve) => {
    if (typeof plus === 'undefined') {
      resolve([])
      return
    }
    plus.io.resolveLocalFileSystemURL(
      EXPORT_DIR,
      (entry) => {
        const reader = entry.createReader()
        reader.readEntries(
          (entries) => {
            const files = entries
              .filter((e) => e.isFile && /\.json$/i.test(e.name))
              .map((e) => ({
                name: e.name,
                path: `${EXPORT_DIR}${e.name}`,
                // 文件名里的时间戳，用来排序和显示
                time: nameToTime(e.name)
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

/**
 * 删除一个导出文件。
 *
 * ★ 用户要求 ★
 *   「要支持对导出历史进行删除」——
 *   导出目录会越攒越多，必须能自己清。
 *
 * @param {string} relPath
 */
export function deleteExportFile(relPath) {
  return new Promise((resolve, reject) => {
    if (typeof plus === 'undefined') {
      reject(new Error('文件删除仅在 App 端可用'))
      return
    }
    plus.io.resolveLocalFileSystemURL(
      relPath,
      (entry) => {
        entry.remove(
          () => resolve(true),
          () => reject(new Error('删除失败'))
        )
      },
      () => reject(new Error('文件不存在'))
    )
  })
}

/**
 * 调起系统分享面板，把导出的文件分享出去。
 *
 * ★ 为什么不用 uni.shareWithSystem 分享文件 ★
 *   实测（用户反馈）：这个基座版本的 shareWithSystem **只支持 text / image**，
 *   传 type: 'file' 会直接报
 *     shareWithSystem:fail 分享参数type不正确。只支持text、image
 *   所以文件分享只能走原生：Native.js 起 ACTION_SEND Intent。
 *
 * ★ 为什么必须用 FileProvider 生成 content:// URI ★
 *   Android 7.0+ 禁止把 file:// URI 传给其他 App（FileUriExposedException），
 *   微信收到 file:// 一律报「获取资源失败」。
 *   必须用 FileProvider 把文件换成 content:// URI 再传。
 *   DCloud 基座自带 io.dcloud.common.util.DCloud_FileProvider，
 *   authority 固定为「应用包名 + .dc.fileprovider」。
 *
 * ★ 降级 ★
 *   万一 FileProvider 没声明 / 包名取不到，退而求其次：
 *   把 JSON 内容当**文本**用 shareWithSystem 分享出去
 *   （系统面板发文本给微信没问题，接收方能复制保存）。
 *   这样至少数据能出去，不至于完全没分享入口。
 *
 * @param {string} relPath 导出文件的相对路径
 * @returns {Promise<{used: 'file'|'text'}>}
 */
export function shareExportFile(relPath) {
  return new Promise((resolve, reject) => {
    if (typeof plus === 'undefined') {
      reject(new Error('分享仅在 App 端可用'))
      return
    }

    if (plus.os.name === 'Android') {
      shareViaFileProvider(relPath)
        .then((r) => resolve(r))
        .catch((e) => {
          // FileProvider 路线失败 → 降级成文本分享
          shareAsText(relPath)
            .then((r) => resolve(r))
            .catch(() => reject(e))
        })
    } else {
      // iOS：没有免插件的文件分享，降级成文本分享
      shareAsText(relPath)
        .then((r) => resolve(r))
        .catch((e) => reject(e))
    }
  })
}

/** Android：用 DCloud 自带 FileProvider 生成 content:// URI，ACTION_SEND 分享 */
function shareViaFileProvider(relPath) {
  return new Promise((resolve, reject) => {
    try {
      const main = plus.android.runtimeMainActivity()
      const pkg = main.getPackageName()
      const authority = `${pkg}.dc.fileprovider`

      const File = plus.android.importClass('java.io.File')
      const FileProvider = plus.android.importClass('io.dcloud.common.util.DCloud_FileProvider')
      const Intent = plus.android.importClass('android.content.Intent')

      const abs = toAbsolutePath(relPath)
      const file = new File(abs)
      if (!file.exists()) {
        reject(new Error('文件不存在：' + abs))
        return
      }

      const uri = FileProvider.getUriForFile(main, authority, file)

      const intent = new Intent(Intent.ACTION_SEND)
      intent.setType('application/json')
      intent.putExtra(Intent.EXTRA_STREAM, uri)
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

      main.startActivity(Intent.createChooser(intent, '分享导出文件'))
      resolve({ used: 'file' })
    } catch (e) {
      reject(new Error((e && e.message) || '调起系统分享失败'))
    }
  })
}

/** 降级：把 JSON 内容当文本分享（系统面板发文本给微信是没问题的） */
function shareAsText(relPath) {
  return new Promise((resolve, reject) => {
    if (typeof uni === 'undefined' || typeof uni.shareWithSystem !== 'function') {
      reject(new Error('当前基座不支持系统分享'))
      return
    }
    readTextFile(relPath)
      .then((text) => {
        let settled = false
        uni.shareWithSystem({
          type: 'text',
          summary: text.slice(0, 5000),
          success: () => {
            if (settled) return
            settled = true
            resolve({ used: 'text' })
          },
          fail: (err) => {
            if (settled) return
            settled = true
            reject(new Error((err && (err.errMsg || err.message)) || '调起分享面板失败'))
          }
        })
        setTimeout(() => {
          if (settled) return
          settled = true
          resolve({ used: 'text' })
        }, 1500)
      })
      .catch((e) => reject(e))
  })
}

/** 从导出文件名里解析出时间（解析不出来就用文件本身的时间兜底） */
function nameToTime(name) {
  const m = String(name).match(/(\d{8})_(\d{6})(\d{2})?/)
  if (!m) return 0
  const d = m[1]
  const t = m[2]
  return new Date(
    Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)),
    Number(t.slice(0, 2)), Number(t.slice(2, 4)), Number(t.slice(4, 6))
  ).getTime()
}

/* ------------------------------------------------------------ 从文件导入 */

/**
 * 列出应用可访问目录里的可导入 JSON 文件。
 *
 * ★ 为什么不用系统文件选择器 ★
 *   用户实测（日志确认）：这个基座上 startActivityForResult 能调起，
 *   但 onActivityResult 事件**从不回调**（plus.globalEvent 收不到），
 *   90 秒后报「系统未回调」。所以 Native.js + ACTION_GET_CONTENT 那套
 *   在这个基座上走不通。
 *
 *   uni.chooseFile 在 App 端只打开相册；plus.io.chooseFile 并不存在。
 *   官方文档对 App 端的建议就是：
 *     「App端如果想选择下载到 _doc、_downloads、_documents 等
 *       plus.io 控制的目录下的文件，可通过 plus.io API，自己做选择框」
 *
 *   所以这里用 plus.io 扫这几个目录，把 .json 列出来给页面渲染，
 *   用户在应用内挑一个。纯 plus.io、没有原生回调，稳定可靠。
 *
 * @returns {Promise<Array<{path,name,dir,time}>>} 按修改时间倒序
 */
export function listImportableFiles() {
  const ROOTS = ['_doc/', '_downloads/', '_documents/']
  const out = []
  const seen = new Set()

  const getTime = (entry) =>
    new Promise((res) => {
      try {
        entry.getMetadata(
          (m) => res((m && m.modificationTime) || 0),
          () => res(0)
        )
      } catch (e) {
        res(0)
      }
    })

  const scan = (dirPath, depth) =>
    new Promise((resolve) => {
      if (depth > 4) {
        resolve()
        return
      }
      if (typeof plus === 'undefined' || !plus.io) {
        resolve()
        return
      }
      plus.io.resolveLocalFileSystemURL(
        dirPath,
        (entry) => {
          const reader = entry.createReader()
          reader.readEntries(
            (entries) => {
              const pending = []
              for (const e of entries) {
                if (e.isFile && /\.json$/i.test(e.name)) {
                  const p = dirPath.endsWith('/') ? dirPath + e.name : dirPath + '/' + e.name
                  if (!seen.has(p)) {
                    seen.add(p)
                    pending.push(
                      getTime(e).then((time) =>
                        out.push({ path: p, name: e.name, dir: dirPath, time })
                      )
                    )
                  }
                } else if (e.isDirectory) {
                  const sub = dirPath.endsWith('/')
                    ? dirPath + e.name + '/'
                    : dirPath + '/' + e.name + '/'
                  pending.push(scan(sub, depth + 1))
                }
              }
              Promise.all(pending).then(resolve)
            },
            () => resolve()
          )
        },
        () => resolve()
      )
    })

  return Promise.all(ROOTS.map((r) => scan(r, 0))).then(() =>
    out.sort((a, b) => b.time - a.time)
  )
}

/* ------------------------------------------------------------------ 恢复 */

 /** 校验备份数据 */
function validatePayload(payload) {
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
    accounts: 0, transactions: 0, categories: 0, tags: 0, budgets: 0, budgetCategories: 0, cycles: 0,
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

    /*
     * ★ 覆盖导入必须先补一份默认分类 ★
     *   truncateAll() 把 category 表清空了，而下面只按 payload.categories 逐条 INSERT ——
     *   备份包可能是三种「没有分类」的样子：
     *     · 老版本导出的（那时候还没有分类表）
     *     · 被用户手工编辑/裁剪过的 JSON
     *     · 只有流水没有分类的半成品备份
     *   这时库里的分类就是空的，后果不是「分类页空着」这么简单：
     *   recalcAllBalances 不依赖分类，但所有按分类的统计、记账面板的
     *   分类选择器都会退化成「未分类」，用户看到的是
     *   「导入成功，但每一笔都是未分类」—— 比直接报错还难排查。
     *
     *   所以先 seed 一份完整的默认分类垫底，再让备份里的分类叠上去。
     *
     * ★ 失败只告警，不能挡住导入 ★
     *   导入才是主操作。seed 挂了（磁盘满、库异常）也得把用户数据导进来。
     */
    try {
      const n = await seedDefaultCategories()
      logStep('已预置默认分类', { count: n })
    } catch (e) {
      console.warn('[import] 预置默认分类失败（不影响导入）:', e && e.message)
    }
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
            /*
             * ★ 组合账户强制不计入总资产、余额恒 0 ★
             *   它是虚拟账户，备份里即使带了旧值也不能直接用 ——
             *   否则总资产会凭空多出一笔。
             */
            a.type === 'combo' ? 0 : (a.initial_balance_cents || 0),
            a.type === 'combo' ? 0 : (a.balance_cents || 0),
            a.type === 'combo' ? 0 : (a.include_in_total === undefined ? 1 : a.include_in_total),
            /*
             * ★ 信用卡那四列（credit_limit_cents / bill_day / repay_day / card_tail）★
             *   业务上已经不用了（界面与新建逻辑都删干净），但这里**照旧搬回来**：
             *   这是「历史兼容」路径 —— 老备份里带着值，恢复后原样落在表里，
             *   不丢数据。表里那四列还在（见 api/db/schema.js），
             *   normalizeAccount() 会把它们抹成 null，所以不会冒到界面上。
             *   新备份里这四项自然都是 null。
             */
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

    // ---------- 组合账户成员
    //   必须放在账户之后 —— 成员指向真实账户，账户还没导入就插不进去
    if (Array.isArray(payload.comboMembers)) {
      for (const m of payload.comboMembers) {
        if (!m || !m.combo_id || !m.member_id) continue
        const combo = await queryOne('SELECT id FROM account WHERE id = ?', [m.combo_id])
        const member = await queryOne('SELECT id FROM account WHERE id = ?', [m.member_id])
        // 两端都得存在，否则就是悬空引用（组合/成员没被一起导入）
        if (!combo || !member) continue
        await execute(
          'INSERT OR IGNORE INTO account_combo_member (combo_id, member_id, sort) VALUES (?,?,?)',
          [m.combo_id, m.member_id, m.sort || 0]
        )
      }
    }

    // ---------- 分类
    if (Array.isArray(payload.categories)) {
      /*
       * ★ 备份里带分类时，先撤掉上面垫底的那份 seed ★
       *   两张表之间没有任何唯一键能把「同名分类」判成同一行
       *   （category 的主键是 uuid，name+type+parent_id 上没有约束），
       *   所以 seed 的「餐饮食品」和备份里的「餐饮食品」会并排存两行 ——
       *   用户恢复完会看到每个分类都出现两次，比没有分类更难受。
       *
       *   ★ 为什么可以直接 DELETE FROM category ★
       *     此刻在同一笔事务里，分类表里只有刚 seed 的那些行
       *     （前面的 settings / account / comboMember 都不碰 category），
       *     所以整表清掉不会有误伤。备份里的分类马上会逐条插进来。
       *
       *   ★ 空数组时不能清 ★
       *     payload.categories 是空数组 = 这份备份没有分类数据，
       *     那正是 seed 要救的场，清掉就白垫了。
       */
      if (mode === 'overwrite' && payload.categories.length > 0) {
        await execute('DELETE FROM category')
      }

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
        /*
         * ★ 导入时忽略旧备份里的 source / raw_text ★
         *   老备份 JSON 里可能带这两个字段，但当前库已停用它们
         *   （v10 迁移，新装库连列都没有），所以不写入。
         *   其余字段照常恢复，不影响历史数据导入。
         */
        await execute(
          `INSERT INTO txn (id, type, amount_cents, account_id, to_account_id, category_id, note,
            occurred_at, occurred_day, month_key, year_key, tz_offset,
            cycle_id, created_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            t.id, t.type, t.amount_cents, t.account_id, t.to_account_id || null,
            t.category_id || null, t.note || '',
            t.occurred_at, t.occurred_day, t.month_key, t.year_key, t.tz_offset || 480,
            t.cycle_id || null,
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
    //
    // ★ name 缺失时写 NULL ★
    //   老备份包里没有 name 列（v18 之前的导出），取 undefined 会写成 NULL，
    //   正好就是「没起名」的语义，统计层会按类别名自动拼。
    if (Array.isArray(payload.budgets)) {
      for (const b of payload.budgets) {
        const exists = mode === 'merge' ? await queryOne('SELECT id FROM budget WHERE id = ?', [b.id]) : null
        if (exists) { report.skipped++; continue }
        await execute(
          `INSERT INTO budget (id, scope, category_id, name, period, amount_cents, start_month, rollover, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [b.id, b.scope, b.category_id || null, b.name || null, b.period || 'month', b.amount_cents,
           b.start_month, b.rollover || 0, b.created_at || Date.now(), b.updated_at || Date.now()]
        )
        report.budgets++
      }
    }

    // ---------- 子预算挂的类别（v18）
    //
    // ★ 老备份没有这一段 ★
    //   那时一条子预算只有一个类别，信息全在 budget.category_id 里，
    //   所以这里要按「关联表为空就退回单列」补一份，否则恢复后子预算挂不上类别，
    //   页面上会显示成「已删除分类」、已用恒为 0。
    if (Array.isArray(payload.budgets)) {
      const rows = Array.isArray(payload.budgetCategories) ? payload.budgetCategories.slice() : []
      const covered = new Set(rows.map((r) => r.budget_id))
      for (const b of payload.budgets) {
        if (b.scope !== 'category' || !b.category_id || covered.has(b.id)) continue
        rows.push({ budget_id: b.id, category_id: b.category_id })
      }
      for (const r of rows) {
        // 类别可能已经不在了（备份包里分类被裁剪过），外键没建但统计会 JOIN 不到，
        // 所以这里先确认类别存在再写，避免关联表里堆垃圾行。
        const cat = await queryOne('SELECT id FROM category WHERE deleted_at IS NULL AND id = ?', [r.category_id])
        if (!cat) { report.skipped++; continue }
        await execute(
          'INSERT OR IGNORE INTO budget_category (budget_id, category_id) VALUES (?, ?)',
          [r.budget_id, r.category_id]
        )
        report.budgetCategories++
      }
    }

    // ---------- 周期（旧版本备份不含此项，自动按空处理）
    if (Array.isArray(payload.cycles)) {
      for (const cy of payload.cycles) {
        const exists = mode === 'merge' ? await queryOne('SELECT id FROM cycle WHERE id = ?', [cy.id]) : null
        if (exists) { report.skipped++; continue }
        await execute(
          `INSERT INTO cycle (id, type, amount_cents, account_id, to_account_id, category_id, note,
            recurrence, weekday, day_of_month, last_caught_up_day, created_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            cy.id, cy.type, cy.amount_cents, cy.account_id, cy.to_account_id || null,
            cy.category_id || null, cy.note || null,
            cy.recurrence || 'monthly', cy.weekday === undefined ? null : cy.weekday,
            cy.day_of_month === undefined ? null : cy.day_of_month,
            cy.last_caught_up_day || null,
            cy.created_at || Date.now(), cy.updated_at || Date.now(), cy.deleted_at || null
          ]
        )
        report.cycles++
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

  /*
   * ★ 导入完成后把默认分类对齐到最新设计 ★
   *   seedDefaultCategories() 只会写「全新安装」那一份，
   *   而分类表是产品内容，改一版就该让恢复回来的老库也拿到新分类
   *   （和 App.vue onLaunch 里做的事一致）。
   *   ★ 幂等、只补不改 ★
   *     已存在的分类不覆盖，用户自己改过的图标/顺序不会被刷回去，
   *     软删掉的也不会被复活 —— 所以放在用户数据导完之后跑是安全的。
   *   ★ 只告警 ★
   *     导入已经成功，这一步只是锦上添花，不该让它把整个恢复判成失败。
   */
  try {
    const r = await syncDefaultCategories()
    logStep('默认分类已对齐', r)
  } catch (e) {
    console.warn('[import] 对齐默认分类失败（不影响导入）:', e && e.message)
  }

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
