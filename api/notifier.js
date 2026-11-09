/**
 * 通知栏下载进度
 *
 * ★★★ 为什么不用 Java 静态字段（踩过两次坑）★★★
 *
 *   真机日志实测：sdk=0 importance=null service=null —— 三个静态字段全取不到。
 *
 *   1. `plus.android.getAttribute(类对象, 字段)` 对**类**无效（只对实例有效），
 *      返回 null。上一版就是这么写的，等于所有常量都是空。
 *   2. `Build.VERSION.SDK_INT` 更隐蔽：`VERSION` 是 android.os.Build 的
 *      **嵌套类**，importClass('android.os.Build') 不会自动导入它，
 *      所以 `Build.VERSION` 本身是 undefined，再取 .SDK_INT 还是 undefined。
 *
 *   最致命的是第 2 条的后果：
 *     `if (sdkInt >= 26)` 里 sdkInt 是 undefined -> 恒为 false
 *     -> **通知渠道从未被创建过**
 *     -> Android 8+ 没有渠道的通知被系统直接丢弃，且完全静默。
 *   这就是「通知栏一直不显示」的真正根因。
 *
 * ★ 解决：一个静态字段都不用 ★
 *   · Context.NOTIFICATION_SERVICE 的值就是字符串 "notification"
 *   · NotificationManager.IMPORTANCE_LOW 的值就是整数 2
 *   · SDK 级别用 plus.os.version（如 "13"）换算，不碰 Build
 *   这些都是 Android 公开且稳定的常量值，硬编码比反射可靠得多。
 */

/**
 * 从系统版本字符串推 API 级别（导出供单测）
 *
 * ★ 为什么用公式而不是查表（真机日志教训）★
 *   原来写的是 8~16 的映射表，结果测试机是 **Android 17**，
 *   查不到就返回 0 —— 于是 `sdkInt >= 33` 恒 false，权限永远不请求，
 *   通知在 Android 13+ 上被系统静默丢弃。
 *   查表法对「比表更新的系统」必然失效，是设计缺陷。
 *
 * ★ Android 版本号与 API 级别的关系（可推导，不用背表）★
 *   13 -> 33、14 -> 34、15 -> 35、16 -> 36、17 -> 37  => major + 20
 *   9  -> 28、10 -> 29、11 -> 30、12 -> 31            => major + 19
 *   8  -> 26（8.1 是 27）
 *   只需覆盖「≥26（有通知渠道）」和「≥33（要通知权限）」两档判断，
 *   所以 8 的 26/27 之分不影响任何分支。
 *
 * @param {string} osVersion 形如 "13"、"12"、"8.1.0"
 * @returns {number} API 级别；无法识别返回 0
 */
export function apiLevelFromOsVersion(osVersion) {
  const v = String(osVersion || '').trim()
  if (!v) return 0
  const major = parseInt(v.split('.')[0], 10)
  if (!Number.isFinite(major) || major <= 0) return 0
  if (major >= 13) return major + 20   // 13->33 ... 17->37，向上自动延展
  if (major >= 9) return major + 19    // 9->28 ... 12->31
  if (major === 8) return 26           // 8.0=26 / 8.1=27，两档判断都够
  return 0                             // 8 以下：无渠道概念
}

/**
 * 读当前 Android API 级别
 *
 * 优先 plus.os.version（App 端一定有），其次 uni 系统信息。
 */
function currentApiLevel() {
  // #ifdef APP-PLUS
  try {
    if (plus.os && plus.os.version) {
      const n = apiLevelFromOsVersion(plus.os.version)
      if (n) return n
    }
  } catch (e) {}
  // #endif
  try {
    const info = uni.getSystemInfoSync()
    if (info && info.osVersion) {
      const n = apiLevelFromOsVersion(info.osVersion)
      if (n) return n
    }
  } catch (e) {}
  return 0
}

/** Java 常量值（稳定公开，不用反射） */
const NOTIFICATION_SERVICE = 'notification'   // org string of Context.NOTIFICATION_SERVICE
const IMPORTANCE_LOW = 2                      // NotificationManager.IMPORTANCE_LOW

/**
 * 通知点击时携带「安装包路径」的 Intent extra 键名
 *
 * ★ 为什么要自己定一个键 ★
 *   弹出通知后点它，系统只会把应用拉回前台，
 *   **不会**替我们去调 plus.runtime.install。
 *   现在把路径写进启动 Intent，App 回前台时读出来再安装一次，
 *   才算真正「点通知就去安装」。
 */
export const INSTALL_EXTRA_KEY = 'freecount_install_apk'

/** Intent / PendingIntent 的 flag 字面量（同样避开静态字段） */
const INTENT_FLAG_CLEAR_TOP = 0x04000000      // Intent.FLAG_ACTIVITY_CLEAR_TOP
const INTENT_FLAG_SINGLE_TOP = 0x20000000     // Intent.FLAG_ACTIVITY_SINGLE_TOP
const PI_FLAG_UPDATE_CURRENT = 0x08000000     // PendingIntent.FLAG_UPDATE_CURRENT
const PI_FLAG_IMMUTABLE = 0x04000000           // PendingIntent.FLAG_IMMUTABLE（Android 12+ 必选）

/**
 * 创建通知栏进度器
 * @returns {{update:Function, done:Function, fail:Function}}
 */
export function createProgressNotifier() {
  // #ifdef APP-PLUS
  try {
    const main = plus.android.runtimeMainActivity()
    plus.android.importClass(main)

    const sdkInt = currentApiLevel()
    console.warn(`[update] 通知初始化：android=${(plus.os && plus.os.version) || '?'} api=${sdkInt}`)

    const nm = main.getSystemService(NOTIFICATION_SERVICE)
    if (!nm) {
      console.warn('[update] 拿不到 NotificationManager')
      return { update() {}, done() {}, fail() {} }
    }
    plus.android.importClass(nm)

    const CHANNEL_ID = 'freecount_update'
    const NOTIFY_ID = 10010

    /*
     * 包名提前取出来：通知点击要用它拿启动 Intent。
     * 下面小图标那一段也需要，提到这里变成共用变量。
     */
    let packageName = ''
    try { packageName = String(main.getPackageName() || '') } catch (e) {}

    /* -------------------------------------------------- 权限 */

    /*
     * Android 13（API 33）起发通知要 POST_NOTIFICATIONS 运行时权限。
     * 未授权时 notify 会被系统静默丢弃。
     * 这里主动请求一次 —— 结果是异步的，用户点「允许」后，
     * 后续的 update() 调用就能正常显示。
     */
    if (sdkInt >= 33) {
      try {
        const granted = main.checkSelfPermission('android.permission.POST_NOTIFICATIONS')
        if (Number(granted) !== 0) {   // 0 == PackageManager.PERMISSION_GRANTED
          main.requestPermissions(['android.permission.POST_NOTIFICATIONS'], 1001)
          console.warn('[update] 已弹出通知权限请求（Android 13+）')
        }
      } catch (e) {
        console.warn('[update] 请求通知权限失败:', e && e.message)
      }
    }

    /* -------------------------------------------------- 渠道 */

    /*
     * Android 8+ 必须先建渠道，否则通知被系统丢弃（无任何报错）。
     * 同 id 重复创建是幂等的。
     *
     * ★ sdkInt 未知（0）时也建 ★
     *   渠道是 8+ 的概念，但低版本创建它不会报错（系统忽略），
     *   而「该建没建」的代价是整个通知功能失效。
     *   所以宁可在不确定时也建一次。
     */
    try {
      const NotificationChannel = plus.android.importClass('android.app.NotificationChannel')
      const ch = new NotificationChannel(CHANNEL_ID, '应用更新', IMPORTANCE_LOW)
      plus.android.importClass(ch)
      ch.setShowBadge(false)
      try { ch.setSound(null, null) } catch (e) {}
      nm.createNotificationChannel(ch)
    } catch (e) {
      // Android 8 以下没有这个类，属正常情况
      if (sdkInt >= 26) console.warn('[update] 创建通知渠道失败:', e && e.message)
    }

    /* -------------------------------------------------- 小图标 */

    /*
     * ★ 必须用单色小图标 ★
     *   应用彩色启动图标在状态栏只取 alpha 通道，
     *   渲染成一坨白块；部分 ROM 干脆因此丢弃整条通知。
     * 优先按名字找 DCloud 自带的 notification 图标。
     */
    /*
     * ★ 必须 importClass 方法返回的对象 ★
     *   真机日志：`res.getIdentifier is not a function`
     *   —— plus.android 只会给「importClass 过的对象」挂方法代理，
     *   对象方法返回的 Java 对象（这里 getResources() 返回 Resources）
     *   不会自动代理，直接调它上面的方法就是 undefined。
     *   每个跨越边界拿到的对象都要单独 importClass 一次。
     */
    let smallIcon = 0
    try {
      const res = main.getResources()
      plus.android.importClass(res)
      const pkg = packageName || main.getPackageName()

      const candidates = ['notification', 'ic_notification', 'ic_launcher', 'icon']
      for (const name of candidates) {
        const id = res.getIdentifier(name, 'drawable', pkg)
        if (id) { smallIcon = id; break }
      }

      if (!smallIcon) {
        const appInfo = main.getApplicationInfo()
        plus.android.importClass(appInfo)
        smallIcon = appInfo.icon
      }
      console.warn(`[update] 通知小图标 resId=${smallIcon}`)
    } catch (e) {
      console.warn('[update] 取通知小图标失败:', e && e.message)
    }

    /*
     * ★ 没有有效图标就不要发通知 ★
     *   setSmallIcon(0) 在部分 ROM 上会让整条通知被丢弃，
     *   而且完全静默。与其发一条可能消失的通知，
     *   不如明确降级并留下日志，方便定位。
     */
    if (!smallIcon) {
      console.warn('[update] 小图标缺失，跳过通知栏进度')
      return { update() {}, done() {}, fail() {} }
    }

    /* -------------------------------------------------- 发射 */

    /**
     * 每次通知都新建 Builder
     *
     * ★ 一个 Builder 只能 build 一次 ★
     *   复用再 build 会抛 "this builder has already been used"，
     *   被 catch 吞掉后进度再也不更新（通知出现但不走）。
     */
    function makeBuilder(title, text) {
      const B = plus.android.importClass('android.app.Notification$Builder')
      const b = new B(main, CHANNEL_ID)
      plus.android.importClass(b)
      b.setSmallIcon(smallIcon)
      b.setContentTitle(title)
      b.setContentText(text)
      b.setOngoing(true)
      b.setOnlyAlertOnce(true)
      b.setAutoCancel(false)
      return b
    }

    /*
     * ★ 构造「点通知→打开 App 并带上安装包路径」的 PendingIntent（bug 修复）★
     *
     * ★ 用户反馈 ★
     *   「下载完成后，点击通知栏为什么不能跳转到安装页面呢」。
     *
     * ★ 根因 ★
     *   done() 里发的那条通知**根本没设 setContentIntent**。
     *   Android 上没有 contentIntent 的通知点下去就是一个纯饰边：
     *   不会拉起应用、不会弹安装器、什么都不会发生。
     *   之前只能靠「下载完自动调 plus.runtime.install」那一次机会，
     *   用户一旦把那个安装界面关掉，就再也回不去了。
     *
     * ★ 为什么不能直接在这里调 plus.runtime.install ★
     *   PendingIntent 只能携带一个 Intent（一个动作 + 一组 extra），
     *   不能携带 JS 回调。所以只能把路径当 extra 传回去，
     *   由 App 回前台时自己读出来再调 install。
     *   读取在 App.vue（酸编排在那里，且同时覆盖 onLaunch / onShow / newintent）。
     *
     * @param {string} apkPath 已下载的 APK 本地路径；为空时只拉起 App
     * @returns {object|null} PendingIntent，构造失败返回 null
     */
    function buildContentIntent(apkPath) {
      try {
        /*
         * ★ 用 getLaunchIntentForPackage 而不是硬编码 Activity 类名 ★
         *   DCloud 的启动 Activity 叫 io.dcloud.PandoraEntry，
         *   但那是**6.x 基座的名字**。它在不同版本 / 不同打包配置下可能变，
         *   硬编码一旦错了，点通知就会“什么都不发生”——和没挂意图一样难查。
         *   用 PackageManager 向系统要「这个包的启动意图」，它返回的就是
         *   Manifest 里声明了 MAIN/LAUNCHER 的那个，永远不会错。
         */
        let intent = null
        try {
          const pm = main.getPackageManager()
          plus.android.importClass(pm)
          intent = plus.android.invoke(pm, 'getLaunchIntentForPackage', packageName)
        } catch (e) {
          console.warn('[update] getLaunchIntentForPackage 失败:', e && e.message)
        }

        if (!intent) {
          /*
           * 降级：取不到启动意图时手动指定入口 Activity。
           * 这个名字对当前基座（DCloud 6.x）是对的，
           * 但前面那条路才是主路。
           */
          const Intent = plus.android.importClass('android.content.Intent')
          intent = new Intent()
          plus.android.importClass(intent)
          intent.setClassName(packageName, 'io.dcloud.PandoraEntry')
        }
        plus.android.importClass(intent)

        /*
         * ★ FLAG_ACTIVITY_CLEAR_TOP | SINGLE_TOP ★
         *   App 已在后台时不能新开一个实例，而是把现有的拉到前台。
         *   不加这两个 flag 会出现「点通知又开了一个 App」的怪现象。
         */
        intent.addFlags(INTENT_FLAG_CLEAR_TOP | INTENT_FLAG_SINGLE_TOP)
        if (apkPath) {
          intent.putExtra(INSTALL_EXTRA_KEY, String(apkPath))
        }

        const PendingIntent = plus.android.importClass('android.app.PendingIntent')
        /*
         * requestCode 用固定值 1：
         * 同一条通知重复发布时共用同一个 PendingIntent，
         * 配 UPDATE_CURRENT 能让最新一次写入的 apk 路径生效。
         * （不用 UPDATE_CURRENT 的话，extra 会停留在第一次创建的值上。）
         */
        return PendingIntent.getActivity(
          main, 1, intent, PI_FLAG_UPDATE_CURRENT | PI_FLAG_IMMUTABLE
        )
      } catch (e) {
        console.warn('[update] 构造通知点击意图失败:', e && e.message)
        return null
      }
    }

    return {
      /** 更新进度（pct: 0~100，0 表示还在等总大小，用不确定进度条） */
      update(pct) {
        try {
          const b = makeBuilder('正在下载更新', pct > 0 ? pct + '%' : '准备中…')
          plus.android.importClass(b)
          if (pct > 0) b.setProgress(100, pct, false)
          else b.setProgress(0, 0, true)
          nm.notify(NOTIFY_ID, b.build())
        } catch (e) {
          console.warn('[update] 推送通知失败:', e && e.message)
        }
      },
      /**
       * 下载完成：撤掉进度条，提示点按安装
       *
       * @param {string} [apkPath] 已下载的 APK 路径
       *   传了就把它写进通知的点击意图，
       *   用户点通知栏 → App 回前台 → 自动拉起安装器（bug 修复）。
       *   不传就只拉起 App（降级行为，总比点下去没反应强）。
       */
      done(apkPath) {
        try {
          const b = makeBuilder('更新已下载', '点按通知栏即可安装')
          b.setOngoing(false)
          b.setAutoCancel(true)
          plus.android.importClass(b)
          /*
           * ★ 关键一步：给通知挂上点击意图 ★
           *   没这一句，通知就是个纯饰边 ——
           *   点下去既不拉起 App，也不弹安装器，什么都不会发生。
           */
          const pi = buildContentIntent(apkPath)
          if (pi) b.setContentIntent(pi)
          nm.notify(NOTIFY_ID, b.build())
          console.warn('[update] 完成通知已发出，带安装路径=' + (apkPath ? '是' : '否'))
        } catch (e) {
          console.warn('[update] 完成通知失败:', e && e.message)
        }
      },
      /** 失败/取消：撤掉通知 */
      fail() {
        try { nm.cancel(NOTIFY_ID) } catch (e) {}
      }
    }
  } catch (e) {
    console.warn('[update] 通知栏初始化异常:', e && e.message)
  }
  // #endif
  return { update() {}, done() {}, fail() {} }
}

/** 撤销下载通知（取消下载 / 安装失败时调用） */
export function clearProgressNotification() {
  // #ifdef APP-PLUS
  try {
    const main = plus.android.runtimeMainActivity()
    plus.android.importClass(main)
    const nm = main.getSystemService(NOTIFICATION_SERVICE)
    if (nm) {
      plus.android.importClass(nm)
      nm.cancel(10010)
    }
  } catch (e) {}
  // #endif
}
