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
 * 下载 APK 到本机
 * @param {string} url APK 直链
 * @param {string} filename 保存文件名（FreeLedger-v1.16.3.apk）
 * @param {Function} onProgress (percent: 0~100)
 * @returns {Promise<string>} 本地文件路径（供 installApk）
 */
export function downloadApk(url, filename, onProgress) {
  // #ifdef APP-PLUS
  return new Promise((resolve, reject) => {
    abortDownload()
    const dtask = plus.downloader.createDownload(url, {
      filename: '_doc/update/' + filename,
      timeout: 600,
      retry: 1,
      retryInterval: 3
    }, (d, status) => {
      if (status === 200) {
        currentTask = null
        onProgress && onProgress(100)
        resolve(d.filename)
      } else if (status !== undefined) {
        currentTask = null
        reject(new Error('下载失败（状态 ' + status + '）'))
      }
    })
    dtask.addEventListener('statechanged', (task) => {
      if (task && task.totalSize > 0 && task.downloadedSize > 0) {
        onProgress && onProgress(Math.min(100, Math.round((task.downloadedSize / task.totalSize) * 100)))
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
    const Intent = plus.android.importClass('android.content.Intent')
    const Settings = plus.android.importClass('android.provider.Settings')
    const Uri = plus.android.importClass('android.net.Uri')
    const intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
    intent.setData(Uri.parse('package:' + main.getPackageName()))
    main.startActivity(intent)
  } catch (e) {
    // 个别 ROM 不支持该 action，退回应用详情页
    try { plus.runtime.openURL('package:' + plus.runtime.pkg) } catch (e2) {}
  }
  // #endif
}
