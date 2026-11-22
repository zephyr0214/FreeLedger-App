/**
 * 弹层栈 —— 让「侧滑返回 / 物理返回键」先收起弹层，而不是退出页面。
 *
 * ★ 问题是什么 ★
 *   全面屏机型从屏幕左缘右滑（或按安卓返回键）会直接触发页面返回。
 *   而记账面板（TxnPanel）、周期面板（CyclePanel）、AI 输入条（QuickAddBar）
 *   都是页面内自绘的弹层，不是独立页面 ——
 *   于是用户以为「滑一下关掉面板」，实际整页退出了，输入的内容也丢了。
 *
 * ★ 为什么不能只在组件里写 onBackPress ★
 *   onBackPress 是**页面级**生命周期钩子，只有在页面组件里声明才会被调用；
 *   写在子组件里 uni-app 不会派发。所以：
 *     · 组件（面板）打开时把自己登记到栈里
 *     · 页面统一写 onBackPress，交给本工具判断
 *
 * ★ 有弹层时返回 true ★
 *   onBackPress 返回 true = 本次返回已被处理、不要再退出页面。
 *   我们把弹层关掉（调用登记时给的处理函数），并返回 true，
 *   就实现了「右滑 = 收起面板」。
 *
 * ★ 为什么要用栈 ★
 *   可能有嵌套（比如输入条里又弹确认框），
 *   关最上面那个才有意义，所以用数组、后进先出。
 */

/** @type {Array<{ key: string, close: () => void }>} */
const stack = []

/** 自增 id，避免同名弹层互相覆盖 */
let seq = 0

/**
 * 只需要「有/没有弹层」这个布尔值时用的订阅者。
 *
 * ★ 为什么要有它 ★
 *   悬浮底栏（AppTabBar，z-index 300）必须比任何弹层都低，
 *   但记账面板 / 周期面板用的是 wd-popup，默认 z-index 只有 10，
 *   比底栏低。历史实现靠「每个调用方记得传 :hidden」来回避，
 *   结果新增分类 / 新增标签这类从别处叠出来的弹层一漏，底栏就压上来了。
 *
 *   现在底栏直接订阅弹层栈：栈非空就隐藏，栈空就恢复。
 *   不再依赖页面逐个传 hidden。
 */
const watchers = new Set()

/** 通知所有订阅者「弹层数量变了」 */
function notify() {
  const open = stack.length > 0
  watchers.forEach((fn) => {
    try {
      fn(open)
    } catch (e) {
      console.warn('[layerStack] 订阅回调失败:', e && e.message)
    }
  })
}

/**
 * 订阅「是否有弹层打开」。
 *
 * @param {(open:boolean) => void} fn
 * @returns {() => void} 取消订阅
 */
export function subscribeLayerOpen(fn) {
  if (typeof fn !== 'function') return () => {}
  watchers.add(fn)
  // 立即同步一次当前状态，避免挂载时状态不对
  try {
    fn(stack.length > 0)
  } catch (e) {}
  return () => watchers.delete(fn)
}

/**
 * 登记一个已打开的弹层。
 *
 * @param {() => void} close 收起这个弹层的函数（通常是 visible = false）
 * @param {string} name 调试用名字
 * @returns {() => void} 注销函数，在弹层关闭 / 组件卸载时调用
 */
export function pushLayer(close, name = 'layer') {
  const key = `${name}#${++seq}`
  stack.push({ key, close })
  notify()
  return () => {
    const i = stack.findIndex((l) => l.key === key)
    if (i >= 0) {
      stack.splice(i, 1)
      notify()
    }
  }
}

/**
 * 处理一次返回（页面 onBackPress 调用）。
 *
 * @returns {boolean} true = 已消费本次返回（收起了弹层），页面不要退出
 */
export function handleBackPress() {
  const top = stack[stack.length - 1]
  if (!top) return false
  try {
    top.close()
  } catch (e) {
    // 关闭失败也不能让返回事件卡住，直接从栈里摘掉
    console.warn('[layerStack] 关闭弹层失败:', e && e.message)
  }
  const i = stack.findIndex((l) => l.key === top.key)
  if (i >= 0) {
    stack.splice(i, 1)
    notify()
  }
  return true
}

/** 当前是否有弹层打开（调试 / 测试用） */
export function hasLayer() {
  return stack.length > 0
}

/** 清空（测试用） */
export function clearLayers() {
  stack.length = 0
  notify()
}
