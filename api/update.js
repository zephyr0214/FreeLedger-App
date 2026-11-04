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
 *
 * @param {object} [opt]
 * @param {boolean} [opt.force] 跳过版本比较（测试用）——
 *   只要远端有 APK 就当「有新版」，即使版本号不比本地新。
 *   用来反复验证弹窗 / 下载 / 安装链路，不用每次发新版本。
 * @returns {Promise<{hasUpdate:boolean, version?:string, notes?:string,
 *   downloadUrl?:string, sizeBytes?:number}>}
 * @throws {Error} 网络失败 / 接口异常（由调用方决定静默还是提示）
 */
export async function checkUpdate(opt = {}) {
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
  return resolveUpdate(data, APP_VERSION, opt)
}

/**
 * 把 Gitee 的 latest 数据归一化成更新信息（导出供单测）
 *
 * ★ 只认 .apk 附件 ★
 *   Gitee 会自动附带源码 zip / tar.gz，不能把它们当安装包。
 * @param {object} data /releases/latest 的响应
 * @param {string} current 本地版本号
 * @param {object} [opt]
 * @param {boolean} [opt.force] 跳过版本比较（测试用）
 */
export function resolveUpdate(data, current, opt = {}) {
  if (!data || !data.tag_name) return { hasUpdate: false }
  const version = String(data.tag_name).replace(/^v/i, '').trim()
  const apk = (data.assets || []).find((a) => /\.apk$/i.test(a.name || ''))
  if (!version || !apk) return { hasUpdate: false }

  /*
   * ★ force 模式（测试按钮用）★
   *   照常从 Gitee 拉真实数据（版本号、说明、APK 直链都是真的），
   *   只是跳过「是否比本地新」这一步判断 ——
   *   这样在已经是最新版的情况下，也能反复把弹窗和下载链路走一遍。
   *   注意 force 不改变下载内容：下到的仍是远端那个真实版本，
   *   所以如果需要「装完比当前版本新」用来验证升级流程，
   *   还是得发一个更高的版本号。
   */
  if (!opt.force) {
    const cmp = compareVersions(version, current)
    if (cmp <= 0) return { hasUpdate: false }
  }

  return {
    hasUpdate: true,
    version,
    notes: String(data.body || ''),
    downloadUrl: apk.browser_download_url,
    sizeBytes: apk.size || 0,
    // 标记这是测试模式拉到的，UI 可据此加一行提示（避免误以为真有新版）
    forced: !!opt.force
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
function createProgressNotifier() {
  // #ifdef APP-PLUS
  try {
    const main = plus.android.runtimeMainActivity()
    const Context = plus.android.importClass('android.content.Context')
    const NotificationManager = plus.android.importClass('android.app.NotificationManager')
    const NotificationChannel = plus.android.importClass('android.app.NotificationChannel')
    const Build = plus.android.importClass('android.os.Build')

    const CHANNEL_ID = 'freecount_update'
    const NOTIFY_ID = 10010
    const sdkInt = Build.VERSION.SDK_INT

    const nm = main.getSystemService(Context.NOTIFICATION_SERVICE)
    if (!nm) {
      console.warn('[update] 拿不到 NotificationManager，通知栏进度不可用')
      return { update() {}, done() {}, fail() {} }
    }

    /*
     * ★ Android 13+ 主动请求通知权限 ★
     *   不请求的话通知会被系统静默丢弃 ——
     *   这正是「点了立即更新，通知栏什么都没显示」的主因之一
     *   （另一个是 manifest 没声明 POST_NOTIFICATIONS）。
     *   请求是异步的，用户点允许后后续的 notify 才会生效；
     *   这里不等结果，直接往下走（进度会持续刷新，授权后自然出现）。
     */
    if (sdkInt >= 33) {
      try {
        const has = main.checkSelfPermission('android.permission.POST_NOTIFICATIONS')
        // PackageManager.PERMISSION_GRANTED === 0
        if (has !== 0) {
          main.requestPermissions(['android.permission.POST_NOTIFICATIONS'], 1001)
          console.warn('[update] 已请求通知权限（Android 13+ 首次需授权）')
        }
      } catch (e) {
        console.warn('[update] 请求通知权限失败:', e && e.message)
      }
    }

    // Android 8+ 必须建渠道（重复建同 id 是幂等的）
    try {
      if (sdkInt >= 26) {
        const ch = new NotificationChannel(
          CHANNEL_ID, '应用更新', NotificationManager.IMPORTANCE_LOW
        )
        ch.setShowBadge(false)
        nm.createNotificationChannel(ch)
      }
    } catch (e) {
      console.warn('[update] 创建通知渠道失败:', e && e.message)
    }

    /**
     * 单色小图标资源 id
     *
     * ★ 为什么不用 main.getApplicationInfo().icon ★
     *   那是应用的多色启动图标，系统状态栏只取它的 alpha 通道，
     *   渲染出来常是一坨白块；部分 ROM 甚至因此整条通知不显示。
     *   DCloud 运行时自带 ic_launcher / notification 图标，
     *   这里按名字找，找不到再退回应用图标（至少不会崩）。
     */
    let smallIcon = 0
    try {
      const res = main.getResources()
      const pkg = main.getPackageName()
      // 优先找通知专用图标，其次启动图标
      const candidates = ['notification', 'ic_notification', 'ic_launcher', 'icon']
      for (const name of candidates) {
        const id = res.getIdentifier(name, 'drawable', pkg)
        if (id) { smallIcon = id; break }
      }
      if (!smallIcon) smallIcon = main.getApplicationInfo().icon
    } catch (e) {
      console.warn('[update] 取通知小图标失败:', e && e.message)
    }

    /** 建一个带标题/内容的 builder（每次都重建，避免复用旧状态） */
    function makeBuilder(title, text) {
      try {
        const B = plus.android.importClass('android.app.Notification$Builder')
        const b = new B(main, CHANNEL_ID)
        b.setSmallIcon(smallIcon)
        b.setContentTitle(title)
        b.setContentText(text)
        b.setOngoing(true)
        b.setOnlyAlertOnce(true)
        b.setAutoCancel(false)
        return b
      } catch (e) {
        console.warn('[update] 构造通知失败:', e && e.message)
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
        } catch (e) {
          console.warn('[update] 推送通知失败:', e && e.message)
        }
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
        } catch (e) {
          console.warn('[update] 完成通知失败:', e && e.message)
        }
      },
      /** 失败/取消：撤掉通知，不留残影 */
      fail() {
        try { nm.cancel(NOTIFY_ID) } catch (e) {}
      }
    }
  } catch (e) {
    console.warn('[update] 通知栏初始化失败:', e && e.message)
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
