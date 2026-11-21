/**
 * 原生 tabBar 的隐藏
 *
 * ★ 为什么还要保留原生 tabBar ★
 *   pages.json 里的 tabBar 声明不只是「画一条底栏」，
 *   它同时把这 4 个页面注册成了 tab 页 —— 只有这样
 *   uni.switchTab 才能跳转（换成 navigateTo / redirectTo 都会失败）。
 *   所以声明必须留着，我们只是把它「藏起来」。
 *
 * ★ 为什么必须藏 ★
 *   原生 tabBar 由系统绘制，做不了圆角、悬浮、左右留白、阴影，
 *   App 端也没有小程序那种 custom:true 自定义 tabBar。
 *   要做圆角悬浮就只能自己用 view 画（见 components/AppTabBar.vue），
 *   再把原生的这条藏掉，否则两条底栏会叠在一起。
 *
 * ★ hideTabBar 的几个坑 ★
 *   1. 只能在 tabBar 页面调用，在子页面调用会失败（这里一律在 4 个 tab 页里调）
 *   2. 冷启动时原生 tabBar 可能还没建好，这一轮会静默失败
 *      —— 所以要重试，见 stores/setting.js 的 _scheduleTabBarRetry
 *   3. 切到子页面再回来时，原生栏有可能被系统重新显示
 *      —— 所以每个 tab 页的 onShow 都要调一次（幂等，重复调无害）
 */

/**
 * 隐藏原生 tabBar。幂等，可重复调用。
 *
 * @returns {boolean} 本次是否调用成功
 *   false 通常意味着原生 tabBar 还没建好，调用方可以稍后重试。
 */
export function hideNativeTabBar() {
  try {
    uni.hideTabBar({ animation: false })
    return true
  } catch (e) {
    return false
  }
}

/**
 * 键盘相关场景的补藏（真机 bug）。
 *
 * ★ 现象 ★
 *   手动记账面板里点备注输入框 → 弹出输入法 → 收起输入法，
 *   原生 tabBar 冒出来压在面板底部（原生 view 永远在 webview 之上）。
 *
 * ★ 根因 ★
 *   pages.json 的 softinputMode 是 adjustResize。Android 在键盘弹出/收起时
 *   会重新布局整个窗口，部分 ROM 会顺手把之前 hideTabBar() 藏起来的
 *   原生 tabBar 重新显示出来 —— 这不是我们代码里调了 showTabBar。
 *   原生 tabBar 由系统绘制，层级高于页面所有 view（包括 wd-popup），
 *   所以在自绘底栏 hidden、面板全屏时它仍然盖在上面。
 *
 * ★ 为什么补藏要延迟几轮 ★
 *   hideTabBar 在「键盘动画尚未结束 / 窗口正在重新布局」时调用会静默失败，
 *   所以键盘高度变化后连藏几次，跨越布局完成的那一刻。
 *
 * @param {number[]} delays 补藏时机（ms），默认覆盖一轮键盘收起动画
 */
export function hideNativeTabBarAfterKeyboard(delays = [0, 120, 320, 700]) {
  /*
   * ★ 第一次立刻藏，不节流 ★
   *   hideTabBar 幂等且开销极小；如果连第一次都节流掉，
   *   「面板刚打开 → 马上点备注 → 马上收键盘」这种快操作会整段被跳过，
   *   bug 就还在。
   */
  hideNativeTabBar()

  /*
   * ★ 只给「延迟补藏」加节流 ★
   *   4 个 tab 页各挂一个 AppTabBar，每个都有自己的键盘监听；
   *   键盘收起时四个监听会同时触发。不节流就是 4 组定时器、
   *   十几次桥调用，纯属浪费。
   */
  const now = Date.now()
  if (now - lastKeyboardHideAt < KEYBOARD_HIDE_WINDOW_MS) return
  lastKeyboardHideAt = now

  delays.forEach((d) => {
    if (d <= 0) return
    setTimeout(() => {
      try {
        hideNativeTabBar()
      } catch (e) {}
    }, d)
  })
}

/** 上次补藏时间 + 去重窗口（ms） */
let lastKeyboardHideAt = 0
const KEYBOARD_HIDE_WINDOW_MS = 800

/**
 * 在「非首页」的 tab 页点记账按钮时用：
 * 记下意图并切回首页，由首页 onShow 取走执行。
 *
 * ★ 为什么不能就地打开面板 ★
 *   TxnPanel / QuickAddBar 只挂在首页
 *   （其余页面没有这两个组件，就地打开也无处安放）。
 *   所以统一「回首页再打开」，用户感知是多跳了一步，
 *   但避免了把面板复制到 4 个页面 —— 那会是四份数据加载
 *   和四份表单状态的维护成本。
 *
 * @param {'ai'|'manual'} mode
 * @param {object} uiStore useUiStore() 实例
 */
export function gotoHomeAndAdd(mode, uiStore) {
  try {
    if (uiStore) uiStore.requestAdd(mode)
  } catch (e) {}
  try {
    uni.switchTab({ url: '/pages/index/index' })
  } catch (e) {}
}
