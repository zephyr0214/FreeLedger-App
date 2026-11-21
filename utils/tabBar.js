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
