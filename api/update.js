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
 * 下载进度显示在**系统通知栏**（而不是 App 内的进度条）
 *
 * ★ 为什么放通知栏 ★
 *   更新下载经常要几十秒，用户会切出去干别的 ——
 *   进度留在 App 内等于看不见。通知栏是系统级的，切走也能看到，
 *   下载完成后还能顺手点通知直接进安装界面。
 *
 * ★ 实现 ★
 *   Android 8+ 必须走 NotificationChannel（低版本直接 build 即可）。
 *   用 IMPORTANCE_LOW：不响铃、不弹横幅，只在通知栏安静地更新进度条。
 *   进度用 setProgress(100, pct, false) —— 系统渲染成标准进度条。
 *
 * ★ 失败静默 ★
 *   通知 API 在个别定制 ROM 上可能不可用（权限/渠道限制）。
 *   拿不到通知就退化成「无进度显示」，绝不能让下载本身失败 ——
 *   进度显示是锦上添花，不是关键路径。
 */
function createProgressNotifier() {
  // #ifdef APP-PLUS
  try {
    const main = plus.android.runtimeMainActivity()
    const Context = plus.android.importClass('android.content.Context')
    const NotificationManager = plus.android.importClass('android.app.NotificationManager')
    const NotificationChannel = plus.android.importClass('android.app.NotificationChannel')
    const Notification = plus.android.importClass('android.app.Notification')

    const CHANNEL_ID = 'freecount_update'
    const NOTIFY_ID = 10010

    const nm = main.getSystemService(Context.NOTIFICATION_SERVICE)
    if (!nm) return { update() {}, done() {}, fail() {} }

    // Android 8+ 必须建渠道（重复建同 id 是幂等的）
    try {
      if (plus.android.importClass('android.os.Build').VERSION.SDK_INT >= 26) {
        const ch = new NotificationChannel(
          CHANNEL_ID, '应用更新', NotificationManager.IMPORTANCE_LOW
        )
        ch.setShowBadge(false)
        nm.createNotificationChannel(ch)
      }
    } catch (e) {}

    const pkg = main.getPackageName()
    let builder = null

    /** 建一个带标题/内容的 builder（每次都重建，避免复用旧状态） */
    function makeBuilder(title, text) {
      try {
        const B = plus.android.importClass('android.app.Notification$Builder')
        return new B(main, CHANNEL_ID)
          .setSmallIcon(main.getApplicationInfo().icon)
          .setContentTitle(title)
          .setContentText(text)
          .setOngoing(true)
          .setOnlyAlertOnce(true)
          .setAutoCancel(false)
      } catch (e) {
        return null
      }
    }

    return {
      /** 更新进度（pct: 0~100） */
      update(pct) {
        try {
          const b = makeBuilder('正在下载更新', pct + '%')
          if (!b) return
          b.setProgress(100, pct, false)
          nm.notify(NOTIFY_ID, b.build())
        } catch (e) {}
      },
      /** 下载完成：进度条换成「点按安装」的提示 */
      done() {
        try {
          const b = makeBuilder('更新已下载', '点按完成安装')
          if (!b) return
          b.setProgress(0, 0, false)
          b.setOngoing(false)
          b.setAutoCancel(true)
          nm.notify(NOTIFY_ID, b.build())
        } catch (e) {}
      },
      /** 失败/取消：撤掉通知，不留残影 */
      fail() {
        try { nm.cancel(NOTIFY_ID) } catch (e) {}
      }
    }
  } catch (e) {
    // 通知不可用：退化成无进度显示
  }
  // #endif
  return { update() {}, done() {}, fail() {} }
}

/**
 * 下载 APK 到本机（进度显示在系统通知栏）
 * @param {string} url APK 直链
 * @param {string} filename 保存文件名（FreeLedger-v1.16.3.apk）
 * @param {Function} onProgress 可选，进度回调（0~100）；不传则只更新通知栏
 * @returns {Promise<string>} 本地文件路径（供 installApk）
 */
export function downloadApk(url, filename, onProgress) {
  // #ifdef APP-PLUS
  return new Promise((resolve, reject) => {
    abortDownload()
    const notifier = createProgressNotifier()
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
        // 通知栏可以每帧都刷；App 内如果有回调也照常给
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
  // #ifdef APP-PLUS
  try {
    const main = plus.android.runtimeMainActivity()
    const Context = plus.android.importClass('android.content.Context')
    const nm = main.getSystemService(Context.NOTIFICATION_SERVICE)
    if (nm) nm.cancel(10010)
  } catch (e) {}
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
