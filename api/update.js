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
 *   downloadApk()  plus.downloader 下到 _doc/update/，带进度回调
 *   installApk()   plus.runtime.install 拉起系统安装器
 *   编排（进度状态机、弹窗时机）在 stores/update.js，这里只管单步。
 *
 * ★ 失败分类（决定要不要引导授权）★
 *   Android 8+ 装 APK 需要「允许安装未知应用」授权，
 *   installApk 的错误会带这个语义出去，store 弹引导去系统设置。
 */

const LATEST_API = 'https://gitee.com/api/v5/repos/all0zy/FreeLedger-App/releases/latest'

import { APP_VERSION, compareVersions } from '../utils/version.js'
import { createProgressNotifier, clearProgressNotification } from './notifier.js'

/** 正在进行的下载任务（取消下载用） */
let currentTask = null

/** 取消当前下载（如有） */
export function abortDownload() {
  if (currentTask) {
    try { currentTask.abort() } catch (e) {}
    currentTask = null
  }
}

/**
 * 请求 Gitee 最新发行版并和本地版本比较
 * @returns {Promise<{hasUpdate:boolean, version?:string, notes?:string,
 *   downloadUrl?:string, sizeBytes?:number}>}
 * @throws {Error} 网络失败 / 接口异常（由调用方决定静默还是提示）
 */
export async function checkUpdate() {
  const data = await new Promise((resolve, reject) => {
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
   * ★ 远端不比本地新 -> 不算更新（永不提示降级）★
   *   App 内不提供「强制弹窗」这类调试入口：
   *   它会把当前版本当成新版本推给用户，误报比省一次发版更重要。
   *   真机验证更新链路请直接发一个更高的 tag。
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

/**
 * 下载进度显示在**系统通知栏**（而不是 App 内的进度条）
 *
 * ★ 为什么放通知栏 ★
 *   更新下载经常要几十秒，用户会切出去干别的 ——
 *   进度留在 App 内等于看不见。通知栏是系统级的，切走也能看到，
 *   下载完成后还能顺手点通知直接进安装界面。
 *
 * ★ 实现要点（每一条都踩过坑） ★
 *   1. Android 13+ 发通知需要 POST_NOTIFICATIONS **运行时权限**，
 *      光在 manifest 声明不够 —— 必须在发之前主动请求。
 *      用户拒绝过的话，发通知会被系统静默丢弃（一点报错都没有）。
 *   2. setSmallIcon 必须用**单色小图标**（系统状态栏是白的）。
 *      用应用彩色大图标在某些 ROM 上会让整条通知被丢弃。
 *      这里优先用渠道里的小图标资源，拿不到再退回应用图标。
 *   3. Android 8+ 必须建 NotificationChannel，用 IMPORTANCE_LOW
 *      保持安静（不响铃、不弹横幅），setProgress 画标准进度条。
 *   4. 任何异常都要 console.warn 出来 —— 之前全是空 catch，
 *      出了问题在日志里一点痕迹都没有，只能靠猜。
 *
 * ★ 失败静默（对用户）★
 *   拿不到通知就退化成「无进度显示」，绝不能让下载本身失败。
 *   但对开发要留日志，否则「通知没出现」根本无从查起。
 */
/* 通知栏进度的实现移到 api/notifier.js ——
   那里用 plus.android.getAttribute 正确读取 Java 静态字段。
   旧实现在本文件里直接写 Context.NOTIFICATION_SERVICE /
   IMPORTANCE_LOW / Build.VERSION.SDK_INT，这些在 plus.android
   里全是 undefined，导致通知被系统静默丢弃（见 notifier.js 顶部说明）。 */

/**
 * 下载 APK 到本机（进度显示在系统通知栏）
 * @param {string} url APK 直链
 * @param {string} filename 保存文件名（FreeLedger-v1.16.3.apk）
 * @param {Function} onProgress 可选，进度回调（0~100）
 * @returns {Promise<string>} 本地文件路径（供 installApk）
 */
export function downloadApk(url, filename, onProgress) {
  // #ifdef APP-PLUS
  return new Promise((resolve, reject) => {
    abortDownload()
    const notifier = createProgressNotifier()
    // 0% 时先立一条不确定进度条（总大小还没拿到），让用户立刻看到「在下载」
    notifier.update(0)

    const dtask = plus.downloader.createDownload(url, {
      filename: '_doc/update/' + filename,
      timeout: 600,
      retry: 1,
      retryInterval: 3
    }, (d, status) => {
      if (status === 200) {
        currentTask = null
        onProgress && onProgress(100)
        notifier.done()
        resolve(d.filename)
      } else if (status !== undefined) {
        currentTask = null
        notifier.fail()
        reject(new Error('下载失败（状态 ' + status + '）'))
      }
    })
    dtask.addEventListener('statechanged', (task) => {
      if (task && task.totalSize > 0 && task.downloadedSize > 0) {
        const pct = Math.min(100, Math.round((task.downloadedSize / task.totalSize) * 100))
        notifier.update(pct)
        onProgress && onProgress(pct)
      }
    })
    currentTask = dtask
    dtask.start()
  })
  // #endif
  // #ifndef APP-PLUS
  return Promise.reject(new Error('请在 App 内使用检查更新'))
  // #endif
}

/**
 * 取消下载（同时清掉通知栏的进度条）
 */
export function cancelDownload() {
  abortDownload()
  clearProgressNotification()
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
