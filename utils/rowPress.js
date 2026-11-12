/**
 * 列表行长按手势闸门 —— 防「滑动列表时误触进入多选」
 *
 * ═════════════════════════════════════════════════════════
 * ★ 问题：平台 @longpress 判定太松 ★
 *
 *   全部交易页 / 报销页「长按某行进多选」以前直接绑 `<view @longpress>`。
 *   App 端这个事件不是浏览器原生的，是 uni-app 视图层统一派发的：
 *     手指按下后 **350ms** 触发，期间移动超过 **10px** 才取消
 *   （见打包产物 unpackage/dist/build/app-plus/uni-app-view.umd.js，
 *    就是其中的 gi=350、mi=10 两个常量）。
 *
 *   10px 在真机上只有两三毫米，350ms 又明显短于系统长按：
 *     · 手指按下列表、正准备往上滑的那一瞬间（先停一下再发力）
 *     · 滑动起步阶段手指移动很慢（滚动本身也要 10px 左右才启动）
 *   这两种再普通不过的动作都会被判成长按 ——
 *   于是「滑一下列表」变成了「进入多选」，
 *   随后松手补发的那次 click 又把这行勾上/取消勾选。
 *   用户反馈的「滑动时容易误触多选」就是这个。
 *
 * ★ 怎么修：不用平台的 @longpress，自己判定 ★
 *
 *   1) 按住 450ms 才算长按（比 350ms 更接近系统长按手感）
 *   2) 期间手指移动超过 12px 立刻取消（比 10px 宽一点，容纳抖动）
 *   3) 列表正在滚动时不判定：250ms 内有过 scroll 事件就作废，
 *      而且滚动一开始就立刻撤销计时（滚动中按住不动当然不算长按）
 *   4) 多指触摸直接取消
 *   5) 判定成立后 500ms 内屏蔽该行的 click ——
 *      否则长按刚把这行选中，松手补发的 click 又把它取消掉，
 *      表现成「长按进多选，但那一行怎么都选不上」
 *
 * ★ 为什么抽到 utils ★
 *
 *   两个页面（全部交易、报销管理）用的是同一套手势，判定规则必须完全一致；
 *   抽成纯逻辑后可以注入假时钟、假定时器做单测
 *   （scripts/test-longpress-guard.mjs），
 *   「多少毫秒算长按、多少像素算移动」这种参数就不必只能靠真机手感试。
 *
 * ★ 纯逻辑，不依赖 uni / Vue ★
 */

/** 按住多久算长按（毫秒） */
export const LONG_PRESS_HOLD_MS = 450

/**
 * 按住期间允许的最大位移（px）
 *
 * 用 px 而不是 rpx：touch 事件给的是 CSS px（逻辑像素），
 * 和视口宽度无关，写 rpx 反而要在运行期换算。
 */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 12

/** 距离上一次 scroll 多久之内算「列表正在滚」（毫秒） */
export const SCROLL_QUIET_MS = 250

/** 长按成立后屏蔽 click 的时长（毫秒） */
export const CLICK_SUPPRESS_MS = 500

/**
 * 取单指触摸点。
 *
 * ★ 多指一律返回 null ★
 *   双指缩放、双指滚动列表时不该触发任何一行的长按。
 *   返回 null 时调用方按「取消」处理。
 *
 * @param {any} event 触摸事件
 * @returns {{x:number,y:number}|null}
 */
export function singleTouchPoint(event) {
  const touches = event && event.touches
  if (!touches || touches.length !== 1) return null
  const t = touches[0]
  if (!t) return null
  // App 端给的是 clientX/clientY；个别平台只给 pageX/pageY，兜一下
  const x = typeof t.clientX === 'number' ? t.clientX : t.pageX
  const y = typeof t.clientY === 'number' ? t.clientY : t.pageY
  if (typeof x !== 'number' || typeof y !== 'number') return null
  return { x, y }
}

/**
 * 长按判定闸门（纯状态机）
 *
 * 只回答一个问题：**此刻这次按压，够不够格算长按？**
 * 计时器仍然由调用方持有（见 createRowPressController），
 * 这样「什么时候真去执行长按动作」留在页面里，闸门只管判定。
 *
 * @param {object} [options]
 * @param {number} [options.holdMs] 按住时长阈值
 * @param {number} [options.tolerance] 位移容差（px）
 * @param {number} [options.scrollQuietMs] 滚动静默窗口（毫秒）
 * @param {number} [options.clickSuppressMs] 长按后屏蔽 click 的时长
 * @param {() => number} [options.now] 取当前时间的函数（单测注入假时钟）
 */
export function createPressGate(options = {}) {
  const holdMs = Number.isFinite(options.holdMs) ? options.holdMs : LONG_PRESS_HOLD_MS
  const tolerance = Number.isFinite(options.tolerance)
    ? options.tolerance
    : LONG_PRESS_MOVE_TOLERANCE_PX
  const scrollQuietMs = Number.isFinite(options.scrollQuietMs)
    ? options.scrollQuietMs
    : SCROLL_QUIET_MS
  const clickSuppressMs = Number.isFinite(options.clickSuppressMs)
    ? options.clickSuppressMs
    : CLICK_SUPPRESS_MS
  const now = typeof options.now === 'function' ? options.now : () => Date.now()

  /** 是否正在跟踪一次按压（移动超容差后立刻变 false） */
  let pressed = false
  let startX = 0
  let startY = 0
  let startAt = 0
  /** 本次按压的最大位移，用于判定与排查 */
  let maxMovePx = 0
  /** 最近一次 scroll 的时间；初始为 -Infinity 表示「从没滚过」 */
  let lastScrollAt = -Infinity
  /** 长按成立后，到什么时候为止屏蔽 click */
  let suppressUntil = 0
  /** 本次按压是否已经触发过长按（抬手时要重新开屏蔽窗口） */
  let fired = false

  /** 开始跟踪一次按压 */
  function begin(x, y) {
    pressed = true
    fired = false
    startX = x
    startY = y
    startAt = now()
    maxMovePx = 0
  }

  /**
   * 记录手指移动。
   * @returns {boolean} 还在容差内（true）还是已判为滑动、本次按压作废（false）
   */
  function move(x, y) {
    if (!pressed) return false
    const dx = Math.abs(x - startX)
    const dy = Math.abs(y - startY)
    const d = dx > dy ? dx : dy
    if (d > maxMovePx) maxMovePx = d
    if (maxMovePx > tolerance) {
      pressed = false
      return false
    }
    return true
  }

  /** 抬手/取消：结束跟踪 */
  function end() {
    pressed = false
    /*
     * ★ 屏蔽窗口从「抬手」而不是从「长按成立」开始算 ★
     *   平台补发的 click 是在**松手那一刻**才派发的。
     *   如果用户长按成立后又继续按住两秒才松手，
     *   按「成立时间 + 500ms」算窗口早就过期了，那次 click 会照常生效，
     *   表现成「长按选中 → 松手又取消」。
     *   所以在 send 那次 click 之前（也就是抬手时）重新开窗口。
     */
    if (fired) {
      suppressUntil = now() + clickSuppressMs
      fired = false
    }
  }

  /** 作废本次按压（不改变 click 屏蔽窗口） */
  function cancel() {
    pressed = false
  }

  /** 彻底复位（页面卸载时调） */
  function reset() {
    pressed = false
    fired = false
    maxMovePx = 0
    startAt = 0
    lastScrollAt = -Infinity
    suppressUntil = 0
  }

  function isPressed() {
    return pressed
  }

  /** 本次按压已持续多久（未在跟踪时为 0） */
  function elapsed() {
    return pressed ? now() - startAt : 0
  }

  function maxMove() {
    return maxMovePx
  }

  /** 列表滚动了一下（scroll-view 的 @scroll 里调） */
  function noteScroll() {
    lastScrollAt = now()
  }

  /** 列表是否「正在滚」（离上次 scroll 不到静默窗口） */
  function scrollRecent() {
    return now() - lastScrollAt < scrollQuietMs
  }

  /**
   * 此刻这次按压是否够格算长按。
   * 三个条件缺一不可：还在跟踪（没被判成滑动）、按够时间、列表不在滚。
   */
  function canFire() {
    if (!pressed) return false
    if (now() - startAt < holdMs) return false
    if (scrollRecent()) return false
    return true
  }

  /** 长按已成立：结束跟踪并开一个屏蔽 click 的窗口 */
  function markFired() {
    pressed = false
    fired = true
    suppressUntil = now() + clickSuppressMs
  }

  /** 当前这次 click 是否属于「长按后补发的」，应当忽略 */
  function clickBlocked() {
    return now() < suppressUntil
  }

  return {
    begin,
    move,
    end,
    cancel,
    reset,
    isPressed,
    elapsed,
    maxMove,
    noteScroll,
    scrollRecent,
    canFire,
    markFired,
    clickBlocked
  }
}

/**
 * 把闸门接到页面的 touch 事件上，返回一组可直接绑到模板的处理函数。
 *
 * 页面只需：
 *   const press = createRowPressController({ onLongPress: onRowLongPress })
 *   @touchstart="press.onTouchStart(txn, $event)"
 *   @touchmove="press.onTouchMove($event)"
 *   @touchend="press.onTouchEnd"
 *   @touchcancel="press.onTouchEnd"
 *   scroll-view 上 @scroll="press.onScroll"
 *   onRowClick 开头 if (press.clickBlocked()) return
 *
 * ★ 定时器为什么放在这里而不放页面 ★
 *   两个页面各写一份「起计时器 / 取消计时器」很容易一边改了一边忘了改，
 *   而这类 bug 在真机上表现为偶发误触，极难复现。
 *
 * @param {object} options
 * @param {(row:any)=>void} [options.onLongPress] 长按成立时调用，参数是按下时的那一行
 * @param {number} [options.holdMs]
 * @param {() => number} [options.now] 假时钟（单测用）
 * @param {Function} [options.setTimer] 假定时器（单测用）
 * @param {Function} [options.clearTimer] 假清除定时器（单测用）
 */
export function createRowPressController(options = {}) {
  const onLongPress = typeof options.onLongPress === 'function' ? options.onLongPress : () => {}
  const holdMs = Number.isFinite(options.holdMs) ? options.holdMs : LONG_PRESS_HOLD_MS
  const setTimer = typeof options.setTimer === 'function' ? options.setTimer : setTimeout
  const clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : clearTimeout

  const gate = createPressGate({
    holdMs,
    tolerance: options.tolerance,
    scrollQuietMs: options.scrollQuietMs,
    clickSuppressMs: options.clickSuppressMs,
    now: options.now
  })

  /** 待触发的长按计时器 */
  let pendingTimer = null
  /** 按下时的那一行（长按成立时用它，而不是「此刻手指下的一行」） */
  let pressedRow = null

  function stopPending() {
    if (pendingTimer !== null) {
      clearTimer(pendingTimer)
      pendingTimer = null
    }
  }

  /** 放弃本次按压：停计时器、作废闸门、忘掉按下的是哪一行 */
  function abandon() {
    stopPending()
    gate.cancel()
    pressedRow = null
  }

  /** 手指按下（模板：@touchstart="press.onTouchStart(txn, $event)"） */
  function onTouchStart(row, event) {
    const point = singleTouchPoint(event)
    if (!point) {
      // 多指 / 拿不到坐标：这次触摸不参与长按判定
      abandon()
      return
    }
    stopPending()
    pressedRow = row
    gate.begin(point.x, point.y)
    pendingTimer = setTimer(() => {
      pendingTimer = null
      // 计时器跑完时再判一次：这期间可能已经滚动了、或者被 touchend 取消
      if (pressedRow === null) return
      if (!gate.canFire()) return
      const row = pressedRow
      pressedRow = null
      gate.markFired()
      onLongPress(row)
    }, holdMs)
  }

  /** 手指移动（模板：@touchmove="press.onTouchMove($event)"） */
  function onTouchMove(event) {
    const point = singleTouchPoint(event)
    if (!point) {
      // 中途变成多指：直接作废
      if (pressedRow !== null) abandon()
      return
    }
    if (!gate.isPressed()) return
    if (!gate.move(point.x, point.y)) {
      // 位移超容差 —— 这是一次滑动，不是长按
      abandon()
    }
  }

  /** 抬手 / 被系统取消（模板：@touchend / @touchcancel） */
  function onTouchEnd() {
    stopPending()
    gate.end()
    pressedRow = null
  }

  /** 列表滚动（模板：scroll-view 的 @scroll） */
  function onScroll() {
    gate.noteScroll()
    // 手指还按着但列表已经滚起来了：立刻撤销，别等计时器到点再判
    if (gate.isPressed()) abandon()
  }

  /** 这次 click 是否该忽略（长按刚成立后补发的那一次） */
  function clickBlocked() {
    return gate.clickBlocked()
  }

  /** 页面卸载时复位，别把计时器和时间戳留在内存里 */
  function dispose() {
    stopPending()
    pressedRow = null
    gate.reset()
  }

  return { onTouchStart, onTouchMove, onTouchEnd, onScroll, clickBlocked, dispose, gate }
}
