/**
 * 应用内检查更新 / 下载 / 安装
 *
 * ★ 数据源：Gitee 发行版 ★
 *   https://gitee.com/api/v5/repos/all0zy/FreeLedger-App/releases/latest
 *   公开仓库免鉴权、国内直连稳定。字段与 GitHub API 近似
   * （tag_name / assets[].browser_download_url / body），
 *   调用方（stores/update.js）在 Gitee 失败时可回退 GitHub 同名接口。
 *
 * ★ 三段式职责 ★
 *   checkUpdate()  查 Gitee + 版本比较，产出归一化的更新信息
 *   downloadApk()  系统 DownloadManager 下载到 App 专属外部目录（后台 / 锁屏 / 进程被杀都继续）
 *   installApk()   plus.runtime.install 拉起系统安装器
 *   编排（进度状态机、弹窗时机）在 stores/update.js，这里只管单步。
 *
 * ★ 失败分类（决定要不要引导授权）★
 *   Android 8+ 装 APK 需要「允许安装未知应用」授权，
 *   installApk 的错误会带这个语义出去，store 弹引导去系统设置。
 */

const LATEST_API = 'https://gitee.com/api/v5/repos/all0zy/FreeLedger-App/releases/latest'

import { APP_VERSION, compareVersions } from '../utils/version.js'
import { INSTALL_EXTRA_KEY } from './notifier.js'

/*
 * ★ 下载改走 Android 系统 DownloadManager ★
 *   下载任务在系统进程里跑，App 退后台 / 锁屏 / 进程被杀都能继续；
 *   通知、重试、断点续传都由系统负责。
 *   JS 侧只负责：入队 → 轮询进度 → 完成后拉起安装器。
 */
const DOWNLOAD_ID_KEY = 'update_download_id'
const DOWNLOAD_PATH_KEY = 'update_download_path'
const DOWNLOAD_VERSION_KEY = 'update_download_version'
const DOWNLOAD_BACKGROUND_KEY = 'update_download_background'
const DM_PENDING = 1
const DM_RUNNING = 2
const DM_PAUSED = 4
const DM_SUCCESSFUL = 8
const DM_FAILED = 16
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000

/** 轮询定时器 / 当前下载的 reject（用户取消时用来结束 Promise） */
let pollTimer = null
let activeCancel = null

/*
 * App 前后台状态
 *
 * ★ 为什么需要它 ★
 *   DownloadManager 在后台下载，JS 定时器会被挂起；用户回到 App 后
 *   poll 才看到「已完成」。如果不记录「下载期间进过后台」，
 *   App 会误以为刚在前台下载完，又自动拉起一次安装器 ——
 *   用户看到的就是「App 退后台下载完，回前台又弹安装界面」。
 */
let appVisible = true
let hiddenDuringDownload = false
let downloadActive = false

/** App.vue onShow / onHide 调用 */
export function setUpdateAppVisible(visible) {
  appVisible = !!visible
  if (!appVisible && downloadActive) {
    hiddenDuringDownload = true
    try { uni.setStorageSync(DOWNLOAD_BACKGROUND_KEY, 1) } catch (e) {}
  }
}

/** 这次下载是否在 App 退后台期间完成（完成后由 store 决定是否跳过自动安装） */
export function wasDownloadCompletedInBackground() {
  return hiddenDuringDownload || hadBackgroundDownload()
}

/** 请求 Gitee 最新发行版原始数据 */
async function fetchLatestReleaseData() {
  return new Promise((resolve, reject) => {
    uni.request({
      url: LATEST_API,
      method: 'GET',
      timeout: 10000,
      success: (res) => {
        if (res.statusCode !== 200) {
          reject(new Error('更新服务返回 ' + res.statusCode))
          return
        }
        resolve(res.data)
      },
      fail: (e) => reject(new Error((e && e.errMsg) || '网络请求失败'))
    })
  })
}

/**
 * 请求 Gitee 最新发行版并和本地版本比较
 *
 * @returns {Promise<{hasUpdate:boolean, version?:string, notes?:string,
 *   downloadUrl?:string, sizeBytes?:number}>}
 * @throws {Error} 网络失败 / 接口异常（由调用方决定静默还是提示）
 */
export async function checkUpdate() {
  const data = await fetchLatestReleaseData()
  return resolveUpdate(data, APP_VERSION)
}

/**
 * 把 Gitee 的 latest 数据归一化成更新信息（导出供单测）
 *
 * ★ 只认 .apk 附件 ★
 *   Gitee 会自动附带源码 zip / tar.gz，不能把它们当安装包。
 * @param {object} data /releases/latest 的响应
 * @param {string} current 本地版本号
 */
export function resolveUpdate(data, current) {
  if (!data || !data.tag_name) return { hasUpdate: false }
  const version = String(data.tag_name).replace(/^v/i, '').trim()
  const apk = (data.assets || []).find((a) => /\.apk$/i.test(a.name || ''))
  if (!version || !apk) return { hasUpdate: false }

  /*
   * ★ 永远比较版本，不提示降级 ★
   *   调试入口已删除；正式版本不再提供「跳过版本比较」的暗路。
   */
  const cmp = compareVersions(version, current)
  if (cmp <= 0) return { hasUpdate: false }

  return {
    hasUpdate: true,
    version,
    notes: String(data.body || ''),
    downloadUrl: apk.browser_download_url,
    sizeBytes: apk.size || 0
  }
}

/* ------------------------------------------------------------------ *
 * Android DownloadManager
 *
 * ★ 为什么从 plus.downloader 换成系统 DownloadManager ★
 *   plus.downloader 的下载线程跑在 App 进程里：
 *     · App 退后台 / 锁屏后，Doze、后台网络限制、国产 ROM 省电策略
 *       都会让下载暂停甚至杀掉进程
 *     · PARTIAL_WAKE_LOCK 只保 CPU，不保网络 / 进程优先级
 *   系统 DownloadManager 在系统进程里下载：
 *     · App 退后台、锁屏、进程被杀，下载都继续
 *     · 通知、重试、断点续传由系统负责
 *     · 完成后系统通知点一下就能进安装器
 *
 * ★ JS 侧职责 ★
 *   入队 → 每秒查一次状态（App 在前台时）→ 完成后按本地路径拉起安装器。
 *   下载 ID / 本地路径写进 uni storage：
 *     App 被杀后重新打开，resumePendingDownload() 还能接着查 / 安装。
 * ------------------------------------------------------------------ */

function isAppRuntime() {
  return typeof plus !== 'undefined' && !!plus.android
}

function getMainActivity() {
  if (!isAppRuntime()) return null
  try {
    const main = plus.android.runtimeMainActivity()
    plus.android.importClass(main)
    return main
  } catch (e) {
    console.warn('[update] 取主 Activity 失败:', e && e.message)
    return null
  }
}

function getDownloadManager() {
  const main = getMainActivity()
  if (!main) return null
  try {
    const dm = main.getSystemService('download') // Context.DOWNLOAD_SERVICE
    if (dm) plus.android.importClass(dm)
    return dm || null
  } catch (e) {
    console.warn('[update] 取 DownloadManager 失败:', e && e.message)
    return null
  }
}

/** DownloadManager 写到 App 专属外部目录（无需存储权限） */
function downloadFilePath(filename) {
  const main = getMainActivity()
  if (!main) return ''
  try {
    // Environment.DIRECTORY_DOWNLOADS 的值就是 "Download"
    const dir = plus.android.invoke(main, 'getExternalFilesDir', 'Download')
    if (!dir) return ''
    try {
      plus.android.importClass(dir)
      if (!plus.android.invoke(dir, 'exists')) plus.android.invoke(dir, 'mkdirs')
    } catch (e) {}
    const base = String(plus.android.invoke(dir, 'getAbsolutePath') || '')
    return base ? `${base}/${filename}` : ''
  } catch (e) {
    console.warn('[update] 取下载目录失败:', e && e.message)
    return ''
  }
}

function deleteLocalFile(path) {
  if (!path || !isAppRuntime()) return
  try {
    const File = plus.android.importClass('java.io.File')
    const f = new File(path)
    if (plus.android.invoke(f, 'exists')) plus.android.invoke(f, 'delete')
  } catch (e) {}
}

function fileExists(path) {
  if (!path || !isAppRuntime()) return false
  try {
    const File = plus.android.importClass('java.io.File')
    return !!plus.android.invoke(new File(path), 'exists')
  } catch (e) {
    return false
  }
}

function readDownloadId() {
  try {
    const id = Number(uni.getStorageSync(DOWNLOAD_ID_KEY))
    return Number.isFinite(id) && id > 0 ? id : 0
  } catch (e) {
    return 0
  }
}

function readDownloadPath() {
  try {
    return String(uni.getStorageSync(DOWNLOAD_PATH_KEY) || '')
  } catch (e) {
    return ''
  }
}

function readDownloadVersion() {
  try {
    return String(uni.getStorageSync(DOWNLOAD_VERSION_KEY) || '')
  } catch (e) {
    return ''
  }
}

function hadBackgroundDownload() {
  try { return uni.getStorageSync(DOWNLOAD_BACKGROUND_KEY) === 1 } catch (e) { return false }
}

function clearBackgroundDownloadFlag() {
  try { uni.removeStorageSync(DOWNLOAD_BACKGROUND_KEY) } catch (e) {}
}

function clearDownloadStorage() {
  try { uni.removeStorageSync(DOWNLOAD_ID_KEY) } catch (e) {}
  try { uni.removeStorageSync(DOWNLOAD_PATH_KEY) } catch (e) {}
  try { uni.removeStorageSync(DOWNLOAD_VERSION_KEY) } catch (e) {}
  clearBackgroundDownloadFlag()
}

/** 安装完成后清掉路径/版本记录（下载文件本身保留，系统 Downloads 里可见） */
export function clearDownloadedPath() {
  try { uni.removeStorageSync(DOWNLOAD_PATH_KEY) } catch (e) {}
  try { uni.removeStorageSync(DOWNLOAD_VERSION_KEY) } catch (e) {}
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

/**
 * 调 Java 方法：先试直接调用，失败再用 plus.android.invoke 兜底
 *
 * ★ 为什么两种都要试 ★
 *   Native.js 只有在对象「被 importClass 过」时才会挂方法代理；
 *   newObject / new 拿到的对象、以及 Java 方法返回的对象，
 *   在不同基座上有的能直接调、有的只能走 invoke。
 *   更新下载是低频但关键的操作，宁可多一层兜底，
 *   也不要让一次方法绑定失败直接变成「创建下载任务失败」。
 */
function callJava(obj, method, ...args) {
  if (obj && typeof obj[method] === 'function') {
    try {
      return obj[method](...args)
    } catch (e) {
      // 直接调用失败（参数转换 / 方法未绑定），继续试 invoke
      console.warn(`[update] ${method} 直接调用失败，改用 invoke:`, e && e.message)
    }
  }
  return plus.android.invoke(obj, method, ...args)
}

/** 把 enqueue 的返回值稳妥地转成数字（有些基座返回 Java Long 包装对象） */
function toDownloadId(raw) {
  if (typeof raw === 'number') return raw
  if (raw === null || raw === undefined) return NaN
  const direct = Number(raw)
  if (Number.isFinite(direct)) return direct
  try {
    const longValue = Number(plus.android.invoke(raw, 'longValue'))
    if (Number.isFinite(longValue)) return longValue
  } catch (e) {}
  const m = String(raw).match(/-?\d+/)
  return m ? Number(m[0]) : NaN
}

/**
 * 创建一个 DownloadManager.Request
 *
 * ★ 两种构造方式都保留 ★
 *   importClass + new 是官方文档写法；newObject 对「内嵌类 + 带参构造」
 *   在少数基座上更稳。任一成功即可，避免因基座差异直接失败。
 */
function createDownloadRequest(uri, filename) {
  let request = null
  try {
    const Request = plus.android.importClass('android.app.DownloadManager$Request')
    request = new Request(uri)
  } catch (e) {
    console.warn('[update] new Request 失败，改用 newObject:', e && e.message)
  }
  if (!request) {
    request = plus.android.newObject('android.app.DownloadManager$Request', uri)
  }
  if (!request) throw new Error('创建下载请求失败')

  /*
   * ★ 必须 importClass 实例 ★
   *   newObject 返回的对象在部分基座上不会自动挂方法代理，
   *   不 import 的话 request.setXxx 是 undefined。
   *   importClass 本身失败也不阻断：下面的 callJava 还有 invoke 兜底。
   */
  try {
    plus.android.importClass(request)
  } catch (e) {
    console.warn('[update] importClass(Request) 失败，改用 invoke:', e && e.message)
  }

  // Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED = 1
  callJava(request, 'setNotificationVisibility', 1)
  callJava(request, 'setTitle', '自由记更新')
  callJava(request, 'setDescription', filename)
  callJava(request, 'setMimeType', 'application/vnd.android.package-archive')
  callJava(request, 'setAllowedOverMetered', true)
  callJava(request, 'setAllowedOverRoaming', false)
  // 部分文件 CDN 会对 DownloadManager 默认 UA 做限制，换成浏览器 UA
  callJava(request, 'addRequestHeader', 'User-Agent',
    'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36')
  callJava(request, 'addRequestHeader', 'Accept', '*/*')
  return request
}

/**
 * 入队一个系统下载任务，返回 downloadId
 *
 * @param {string} url APK 直链
 * @param {string} filename 保存文件名
 * @param {string} path 下载完成后的绝对路径（与 filename 同目录）
 */
function enqueueSystemDownload(url, filename, path) {
  const dm = getDownloadManager()
  const main = getMainActivity()
  if (!dm || !main) throw new Error('系统下载服务不可用')

  const Uri = plus.android.importClass('android.net.Uri')
  const uri = Uri.parse(url)
  const request = createDownloadRequest(uri, filename)

  /*
   * ★ 先用目录 API 设目标，再用 setDestinationUri 兜底 ★
   *   上一版只调 setDestinationInExternalFilesDir(main, ...)，
   *   部分基座把 Activity 参数转成 Context 时失败、又静默不报错，
   *   结果请求没有目标目录，enqueue 直接返回 -1。
   *   现在两条都调、指向同一个路径：
   *     · 目录 API 是老版本 Android 上不需要存储权限的官方写法；
   *     · setDestinationUri 用 File → Uri 明确路径，
   *       不经过 Activity → Context 转换，覆盖前一条静默失败的情况。
   *   任何一条成功即可，两条都成功也没有副作用。
   */
  let destSet = false
  try {
    callJava(request, 'setDestinationInExternalFilesDir', main, 'Download', filename)
    destSet = true
  } catch (e) {
    console.warn('[update] 设置系统下载目录失败:', e && e.message)
  }

  try {
    const File = plus.android.importClass('java.io.File')
    const dest = Uri.fromFile(new File(path))
    if (dest) {
      callJava(request, 'setDestinationUri', dest)
      destSet = true
    }
  } catch (e) {
    console.warn('[update] setDestinationUri 失败:', e && e.message)
  }

  if (!destSet) {
    throw new Error('设置下载目录失败：系统没有接受任何目标路径')
  }

  let raw
  try {
    raw = callJava(dm, 'enqueue', request)
  } catch (e) {
    console.warn('[update] DownloadManager.enqueue 异常:', e && e.message)
    throw new Error('创建系统下载任务失败：' + ((e && e.message) || '未知错误'))
  }

  const id = toDownloadId(raw)
  if (!Number.isFinite(id) || id <= 0) {
    console.warn('[update] DownloadManager.enqueue 返回:', String(raw))
    throw new Error('创建系统下载任务失败（返回 ' + String(raw) + '）')
  }
  return id
}

/** 查询下载状态：{ status, bytes, total, reason } / null */
function querySystemDownload(id) {
  const dm = getDownloadManager()
  if (!dm || !id) return null

  let cursor = null
  try {
    const Query = plus.android.importClass('android.app.DownloadManager$Query')
    const q = new Query()
    plus.android.invoke(q, 'setFilterById', id)
    cursor = plus.android.invoke(dm, 'query', q)
    if (!cursor) return null
    if (!plus.android.invoke(cursor, 'moveToFirst')) return null

    const col = (name) => Number(plus.android.invoke(cursor, 'getColumnIndex', name))
    const int = (name) => Number(plus.android.invoke(cursor, 'getInt', col(name)))
    const long = (name) => Number(plus.android.invoke(cursor, 'getLong', col(name)))

    return {
      status: int('status'),
      bytes: long('bytes_so_far'),
      total: long('total_size'),
      reason: int('reason')
    }
  } catch (e) {
    console.warn('[update] 查询系统下载失败:', e && e.message)
    return null
  } finally {
    if (cursor) {
      try { plus.android.invoke(cursor, 'close') } catch (e) {}
    }
  }
}

/** 取消 / 清理旧任务（下载列表 + 本地文件 + storage） */
export function abortDownload() {
  stopPolling()
  downloadActive = false
  hiddenDuringDownload = false
  if (activeCancel) {
    const cancel = activeCancel
    activeCancel = null
    cancel(new Error('已取消下载'))
  }

  const id = readDownloadId()
  const path = readDownloadPath()
  if (id) {
    try {
      const dm = getDownloadManager()
      if (dm) plus.android.invoke(dm, 'remove', id)
    } catch (e) {}
  }
  if (path) deleteLocalFile(path)
  clearDownloadStorage()
}

/**
 * 下载 APK 到 App 专属外部目录
 *
 * @param {string} url APK 直链
 * @param {string} filename 保存文件名
 * @param {Function} onProgress 可选，进度回调（0~100）
 * @returns {Promise<string>} 本地绝对路径（供 installApk）
 */
export function downloadApk(url, filename, onProgress, version = '') {
  // #ifdef APP-PLUS
  return new Promise((resolve, reject) => {
    try {
      abortDownload()

      const path = downloadFilePath(filename)
      if (!path) throw new Error('无法创建下载目录')
      // 同名文件存在会让 DownloadManager 直接失败，先删掉
      deleteLocalFile(path)

      downloadActive = true
      hiddenDuringDownload = false
      const id = enqueueSystemDownload(url, filename, path)
      uni.setStorageSync(DOWNLOAD_ID_KEY, id)
      uni.setStorageSync(DOWNLOAD_PATH_KEY, path)
      if (version) uni.setStorageSync(DOWNLOAD_VERSION_KEY, version)

      activeCancel = reject
      const startedAt = Date.now()

      const fail = (message) => {
        stopPolling()
        activeCancel = null
        downloadActive = false
        // 超时 / 任务丢失时把系统任务也撤掉，避免通知栏留一条僵尸进度
        try {
          const dm = getDownloadManager()
          if (dm) plus.android.invoke(dm, 'remove', id)
        } catch (e) {}
        clearDownloadStorage()
        deleteLocalFile(path)
        reject(new Error(message))
      }

      const poll = () => {
        pollTimer = null
        const st = querySystemDownload(id)

        if (!st) {
          fail('系统下载任务已丢失，请重试')
          return
        }

        if (st.total > 0) {
          const pct = Math.min(100, Math.round((st.bytes / st.total) * 100))
          onProgress && onProgress(pct)
        }

        if (st.status === DM_SUCCESSFUL) {
          activeCancel = null
          downloadActive = false
          // ID 可以清掉；路径/版本留着，安装成功后才清（进程被杀后 resume 还能装）
          try { uni.removeStorageSync(DOWNLOAD_ID_KEY) } catch (e) {}
          /*
           * ★ 后台完成：清掉 pending 记录，只让系统通知负责安装 ★
           *   否则下次冷启动 resumePendingDownload 还会再拉一次安装器，
           *   用户会看到「更新完又弹一次」。
           */
          if (hiddenDuringDownload || hadBackgroundDownload()) {
            clearDownloadedPath()
            clearBackgroundDownloadFlag()
          }
          onProgress && onProgress(100)
          resolve(path)
          return
        }

        if (st.status === DM_FAILED) {
          fail(`系统下载失败（原因 ${st.reason}）`)
          return
        }

        // PENDING / RUNNING / PAUSED：继续等。系统会自己重试/续传。
        if (Date.now() - startedAt > DOWNLOAD_TIMEOUT_MS) {
          fail('下载超时，请重试')
          return
        }
        pollTimer = setTimeout(poll, 1000)
      }

      poll()
    } catch (e) {
      downloadActive = false
      reject(e)
    }
  })
  // #endif
  // #ifndef APP-PLUS
  return Promise.reject(new Error('请在 App 内使用检查更新'))
  // #endif
}

/** 当前系统下载任务是否还在跑（PENDING / RUNNING / PAUSED） */
export function isDownloading() {
  const id = readDownloadId()
  if (!id) return false
  const st = querySystemDownload(id)
  if (!st) return false
  return [DM_PENDING, DM_RUNNING, DM_PAUSED].includes(st.status)
}

/** 取消下载（系统通知栏进度条由 DownloadManager.remove 一并撤掉） */
export function cancelDownload() {
  abortDownload()
}

/**
 * 把系统下载目录里的 APK 复制到 _doc/update/
 *
 * ★ 为什么需要这一步 ★
 *   DownloadManager 只能写到 App 专属外部目录；部分 Android 版本上
 *   plus.runtime.install 直接吃外部路径会触发 FileUriExposedException。
 *   复制到 _doc 后再装，和旧版 plus.downloader 的安装路径一致。
 */
function copyToDoc(path, filename) {
  return new Promise((resolve, reject) => {
    try {
      plus.io.resolveLocalFileSystemURL('file://' + path, (srcEntry) => {
        plus.io.resolveLocalFileSystemURL('_doc/', (root) => {
          root.getDirectory('update', { create: true }, (dir) => {
            const doCopy = () => {
              srcEntry.copyTo(dir, filename, () => {
                resolve('_doc/update/' + filename)
              }, (e) => reject(new Error((e && e.message) || '复制安装包失败')))
            }
            // 目标已存在时 copyTo 会失败，先删旧文件
            plus.io.resolveLocalFileSystemURL('_doc/update/' + filename, (old) => {
              old.remove(doCopy, doCopy)
            }, doCopy)
          }, (e) => reject(new Error((e && e.message) || '创建安装目录失败')))
        }, (e) => reject(new Error((e && e.message) || '访问 _doc 失败')))
      }, () => reject(new Error('读取系统下载文件失败')))
    } catch (e) {
      reject(e)
    }
  })
}

/**
 * 安装系统下载好的 APK：直接装失败时转存 _doc 再装一次
 *
 * 导出给 stores/update.js 用；最终失败会 throw，交由调用方弹授权引导。
 */
export async function installApkWithFallback(path) {
  try {
    await installApk(path)
    clearDownloadedPath()
    return true
  } catch (e) {
    console.warn('[update] 直接安装失败，转存 _doc 重试:', e && e.message)
  }

  const filename = String(path).split('/').pop()
  const local = await copyToDoc(path, filename)
  await installApk(local)
  clearDownloadedPath()
  return true
}

/** 下载完成后拉起安装器；失败时保留路径，下次冷启动可重试 */
async function installDownloaded(path) {
  if (!path || !fileExists(path)) {
    clearDownloadStorage()
    return false
  }
  try {
    await installApkWithFallback(path)
    return true
  } catch (e) {
    console.warn('[update] 自动安装失败:', e && e.message)
    try {
      uni.showToast({ title: '安装未完成，请检查「安装未知应用」权限', icon: 'none' })
    } catch (err) {}
    return false
  }
}

/**
 * App 冷启动时恢复未完成的系统下载 / 未安装的安装包
 *
 * ★ 为什么需要它 ★
 *   DownloadManager 在进程被杀后仍会继续下载，但 JS 侧的 Promise 已经没了。
 *   onLaunch 里调一次：还在下载就接着轮询；已经下完就拉起安装器。
 *
 * @returns {Promise<{handled:boolean, path?:string}>}
 */
export async function resumePendingDownload() {
  // #ifdef APP-PLUS
  let id = readDownloadId()
  let path = readDownloadPath()

  /*
   * ★ 后台完成的下载不在这里补装 ★
   *   系统通知已经可以点按安装；再自动拉起安装器就是重复弹窗。
   *   清掉 pending 记录，安装包仍保留在原位置供通知栏使用。
   */
  if (hadBackgroundDownload()) {
    clearDownloadStorage()
    return { handled: false }
  }

  /*
   * ★ 已经装上了就不要再恢复安装 ★
   *   用户可能直接点系统通知栏完成安装，然后才打开 App；
   *   这时 pending 路径还在，如果不比对版本就会再弹一次安装器。
   *   版本优先读 storage；老数据没有版本字段时从文件名解析。
   */
  const fileVersion = (String(path).match(/FreeLedger-v([\d.]+)\.apk$/i) || [])[1] || ''
  const pendingVersion = readDownloadVersion() || fileVersion
  if (pendingVersion && compareVersions(pendingVersion, APP_VERSION) <= 0) {
    clearDownloadStorage()
    deleteLocalFile(path)
    return { handled: false }
  }

  if (id) {
    const st = querySystemDownload(id)
    if (st && st.status === DM_SUCCESSFUL) {
      try { uni.removeStorageSync(DOWNLOAD_ID_KEY) } catch (e) {}
      const ok = await installDownloaded(path)
      return { handled: ok, path }
    }
    if (st && st.status === DM_FAILED) {
      clearDownloadStorage()
      deleteLocalFile(path)
      return { handled: false }
    }
    if (st) {
      // 仍在下载：等到成功再装；App 在后台时定时器会挂起，回前台自动继续
      return new Promise((resolve) => {
        const startedAt = Date.now()
        const poll = () => {
          const s = querySystemDownload(id)
          if (s && s.status === DM_SUCCESSFUL) {
            try { uni.removeStorageSync(DOWNLOAD_ID_KEY) } catch (e) {}
            installDownloaded(path).then((ok) => resolve({ handled: ok, path }))
            return
          }
          if (!s || s.status === DM_FAILED || Date.now() - startedAt > DOWNLOAD_TIMEOUT_MS) {
            clearDownloadStorage()
            deleteLocalFile(path)
            resolve({ handled: false })
            return
          }
          pollTimer = setTimeout(poll, 2000)
        }
        poll()
      })
    }
  }

  if (path) {
    // 下载早完成、但进程在安装前被杀：直接补一次安装
    if (!fileExists(path)) {
      clearDownloadStorage()
      return { handled: false }
    }
    const ok = await installDownloaded(path)
    return { handled: ok, path }
  }

  return { handled: false }
  // #endif
  // #ifndef APP-PLUS
  return { handled: false }
  // #endif
}

/**
 * 拉起系统安装器安装 APK
 * @param {string} localPath downloadApk 返回的本地路径
 * @returns {Promise<void>} 成功 = 系统安装界面已拉起（后续交给用户）
 */
export function installApk(localPath) {
  // #ifdef APP-PLUS
  return new Promise((resolve, reject) => {
    plus.runtime.install(localPath, { force: false }, () => resolve(), (e) => {
      reject(new Error((e && e.message) || '安装失败'))
    })
  })
  // #endif
  // #ifndef APP-PLUS
  return Promise.reject(new Error('请在 App 内使用检查更新'))
  // #endif
}

/**
 * 读启动 Intent：如果是「点通知栏回来」就把安装包装上（bug 修复）
 *
 * ★ 为什么需要这个函数 ★
 *   下载完后通知栏会发一条「点按即可安装」。
 *   点它时，系统只能把 App 拉到前台 —— 不会替我们调安装器。
 *   所以 api/notifier.js 把 APK 路径写进了启动 Intent 的 extra，
 *   App 回前台时这里读出来、再调一次 installApk。
 *
 * ★ 三个时机都要调 ★
 *   · onLaunch：App 已经死掉 / 被系统回收 → 冷启动
 *   · onShow  ：App 在后台 → 点通知 → 回前台
 *   · newintent：部分机型走这条，且 onShow 可能迟到
 *   少一个，就会出现「点了通知只回到 App、没弹安装器」。
 *
 * ★ 容错与去重 ★
 *   同一个 Intent 会在 onLaunch / onShow 里被读两次，
 *   所以这里记一个「上次已处理的路径」，
 *   同一路径不重复拉安装器（否则会连弹两次安装界面）。
 *
 * @returns {Promise<{handled:boolean, path?:string}>}
 */
let lastConsumedInstallPath = ''

export async function consumePendingInstall() {
  // #ifdef APP-PLUS
  let path = ''
  try {
    const main = plus.android.runtimeMainActivity()
    const intent = plus.android.invoke(main, 'getIntent')
    if (intent) {
      const extra = plus.android.invoke(intent, 'getStringExtra', INSTALL_EXTRA_KEY)
      if (extra) path = String(extra)
    }
  } catch (e) {
    console.warn('[update] 读启动 Intent 失败:', e && e.message)
    return { handled: false }
  }

  if (!path) return { handled: false }
  if (path === lastConsumedInstallPath) return { handled: false, path }
  lastConsumedInstallPath = path

  /*
   * ★ 读到就清掉 extra ★
   *   Intent 是长生命的，不清的话下次冷启动还会读到同一个路径，
   *   用户每次开 App 都被弹一次安装界面。
   */
  try {
    const main = plus.android.runtimeMainActivity()
    const intent = plus.android.invoke(main, 'getIntent')
    if (intent) plus.android.invoke(intent, 'removeExtra', INSTALL_EXTRA_KEY)
  } catch (e) {}

  try {
    await installApk(path)
    console.warn('[update] 从通知栏回到应用，已拉起安装器:', path)
    return { handled: true, path }
  } catch (e) {
    /*
     * 安装失败（多半是没授权「安装未知应用」）。
     * 这时不弹弹窗——用户刚回到 App，上面可能还在做别的事。
     * 只提一个 toast，并把真实原因写进控制台。
     * 要重试就走「检查更新」（包已在本地，直接重装）。
     */
    console.warn('[update] 通知栏引导安装失败:', e && e.message)
    try {
      uni.showToast({ title: '安装未完成，请检查「安装未知应用」权限', icon: 'none' })
    } catch (err) {}
    return { handled: false, path }
  }
  // #endif
  // #ifndef APP-PLUS
  return { handled: false }
  // #endif
}

/**
 * 跳转系统的「允许安装未知应用」授权页（Android 8+）
 * 用户授权后回到 App，重新点下载即可（安装包已缓存，秒装）。
 */
export function openUnknownSourceSettings() {
  // #ifdef APP-PLUS
  try {
    const main = plus.android.runtimeMainActivity()
    plus.android.importClass(main)
    const Intent = plus.android.importClass('android.content.Intent')
    const Uri = plus.android.importClass('android.net.Uri')

    /*
     * ★ Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES 是静态字符串常量 ★
     *   plus.android 的 importClass **不映射静态字段**，
     *   直接写 Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES 会得到 undefined，
     *   new Intent(undefined) 抛异常 -> 用户点「去设置」毫无反应。
     *   必须用 plus.android.getAttribute 取。
     */
    const Settings = plus.android.importClass('android.provider.Settings')
    const ACTION = plus.android.getAttribute(Settings, 'ACTION_MANAGE_UNKNOWN_APP_SOURCES')

    if (ACTION) {
      const intent = new Intent(ACTION)
      intent.setData(Uri.parse('package:' + main.getPackageName()))
      main.startActivity(intent)
      return
    }
    // 老系统（Android 8 以下）没有这个页：退回应用详情页
    const detail = new Intent('android.settings.APPLICATION_DETAILS_SETTINGS')
    detail.setData(Uri.parse('package:' + main.getPackageName()))
    main.startActivity(detail)
  } catch (e) {
    console.warn('[update] 打开未知来源设置失败:', e && e.message)
    // 最后兜底：直接从 App 内发起安装，让系统弹自己的授权流程
    try { plus.runtime.openURL('package:' + plus.runtime.pkg) } catch (e2) {}
  }
  // #endif
}
