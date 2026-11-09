/**
 * 保持 CPU 工作的唤醒锁（专给后台下载用）
 *
 * ★ 用户反馈 ★
 *   「把软件放在后台怎么下载就终止了？」
 *
 * ★ 根因 ★
 *   plus.downloader 的下载线程跑在应用进程里，
 *   而 App 退到后台后，Android 会在屏幕熄灭后进入低功耗状态：
 *     · CPU 睡眠 → 下载线程被挂起，看起来就是「下载停了」
 *     · 国产 ROM 的省电策略更激进，直接冻结后台进程
 *   所以下载期间必须持有一把 PARTIAL_WAKE_LOCK，把 CPU 叫醒。
 *
 * ★ 为什么用 PARTIAL（而不是 FULL / SCREEN_DIM）★
 *   PARTIAL 只保证 CPU 运行，**不保证屏幕亮**。
 *   下载不需要屏幕，用 FULL 会让用户的手机屏一直亮着——
 *   那是很讨厌的行为（而且很耗电）。
 *
 * ★ 一定要设超时 ★
 *   下载完没释放、异常退出没释放，都会留下一把“永不释放”的锁 ——
 *   那是真正的耗电元凶。
 *   所以 acquire 时就带上超时（默认 15 分钟，超过任何正常下载），
 *   即使 JS 侧没释放，系统也会自动收回。
 *
 * ★ manifest 里已经有 WAKE_LOCK 权限 ★
 *   但之前一直没人用它。现在用上了。
 */

/** PowerManager.PARTIAL_WAKE_LOCK 的真实值（避开静态字段反射，同 notifier.js） */
export const PARTIAL_WAKE_LOCK = 1

/** 默认超时：15 分钟（超过与不超过都不影响正常下载，只是保底） */
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000

/** 当前持有的锁（null = 没有） */
let wakeLock = null

/**
 * 获取一把 PARTIAL_WAKE_LOCK（已持有时直接返回 true）
 *
 * @param {string} [tag] 在系统电量详情里显示的标签
 * @param {number} [timeoutMs] 超时毫秒；0 表示不设超时（不建议）
 * @returns {boolean} 是否持有锁
 */
export function acquireWakeLock(tag = 'FreeLedger:download', timeoutMs = DEFAULT_TIMEOUT_MS) {
  // #ifdef APP-PLUS
  if (wakeLock) return true
  /*
   * ★ 先确认 plus 环境存在 ★
   *   node 单测会直接 import 本文件（没有 plus），
   *   不先判一下就会抛 ReferenceError，虽然被 catch 住但日志很吓人。
   *   顺带保证下面所有 plus.* 调用都在安全的前提下。
   */
  if (typeof plus === 'undefined' || !plus.android) return false
  try {
    const main = plus.android.runtimeMainActivity()
    plus.android.importClass(main)

    /*
     * Context.POWER_SERVICE 的值就是字符串 "power"，
     * 和 notifier.js 用 "notification" 是同一个道理：字面量比反射可靠。
     */
    const pm = main.getSystemService('power')
    if (!pm) {
      console.warn('[wakeLock] 拿不到 PowerManager')
      return false
    }
    plus.android.importClass(pm)

    const lock = plus.android.invoke(pm, 'newWakeLock', PARTIAL_WAKE_LOCK, tag)
    if (!lock) {
      console.warn('[wakeLock] newWakeLock 返回空')
      return false
    }
    plus.android.importClass(lock)

    /*
     * 关掉引用计数。
     * 默认开启时，acquire 两次就要 release 两次才能真正释放，
     * 而我们这里只会 acquire 一次（已持有时提前返回）。
     * 开着反而容易因为计数不平衡而释放不掉。
     */
    try { lock.setReferenceCounted(false) } catch (e) {}

    /*
     * ★ 带超时的 acquire ★
     *   超时到点系统会自己释放，
     *   就算 JS 崩了 / 进程被杀，也不会永久持有一把锁。
     */
    if (timeoutMs > 0) lock.acquire(timeoutMs)
    else lock.acquire()

    wakeLock = lock
    console.warn(`[wakeLock] 已获取（${tag}，超时 ${Math.round(timeoutMs / 1000)}s）`)
    return true
  } catch (e) {
    console.warn('[wakeLock] 获取失败:', e && e.message)
    return false
  }
  // #endif
  // #ifndef APP-PLUS
  return false
  // #endif
}

/**
 * 释放唤醒锁（幂等：没持有时调用不报错）
 */
export function releaseWakeLock() {
  // #ifdef APP-PLUS
  if (!wakeLock) return
  try {
    wakeLock.release()
    console.warn('[wakeLock] 已释放')
  } catch (e) {
    // 已经被超时自动释放 / Activity 已销毁 → release 会抛异常，属正常
    console.warn('[wakeLock] 释放异常（可能已超时自动释放）:', e && e.message)
  } finally {
    wakeLock = null
  }
  // #endif
}

/** 当前是否持有锁（调试用） */
export function hasWakeLock() {
  return !!wakeLock
}
