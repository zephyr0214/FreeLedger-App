/**
 * 页面栈回退计算 —— 删除/销毁类操作后「退到哪个页面」
 *
 * ★ 解决什么问题 ★
 *   从「账户页 → 账户详情 → 编辑」进来删除账户后，
 *   如果只 navigateBack() 一次，会退回到**那个已经被删掉的账户的详情页**，
 *   页面上还显示着刚删掉的账户名和余额，看着像没删成功。
 *
 *   正确行为是退到账户列表（或其它「上层」安全页面），
 *   中间那些「已经被销毁的对象」的页面要一并跳过。
 *
 * ★ 为什么抽成纯函数 ★
 *   页面栈操作在真机上很难复现和断言，
 *   但「栈里有哪几页、要退几步」是纯计算 ——
 *   抽出来就能单测（scripts/test-account-delete-nav.mjs）。
 */

/** 账户列表页的 route（getCurrentPages() 里的写法：不带前导斜杠） */
export const ACCOUNT_LIST_ROUTE = 'pages/account/index'

/**
 * 删除账户后「可以安全停留」的页面。
 *
 * 不在这个名单里的页面一律视为「要跳过的」——
 * 比如 pages/account/detail（渲染的就是刚被删掉的账户）。
 * 用白名单而不是黑名单，是因为将来新增的详情页默认就该被跳过。
 */
export const SAFE_LANDING_ROUTES = [
  ACCOUNT_LIST_ROUTE,
  'pages/index/index',
  'pages/stats/index',
  'pages/mine/index',
  'pages/txn/list'
]

/**
 * 从页面栈里算出「要退几步才能落到一个安全页面」。
 *
 * @param {Array<{route:string}>} stack getCurrentPages() 的结果（栈底 -> 栈顶）
 * @param {object} [opt]
 * @param {string[]} [opt.safeRoutes] 可以停留的 route 名单
 * @returns {{steps:number, route:string}}
 *   steps 要退的步数（0 表示「栈里没有安全落点」，调用方应改用 redirect/switchTab）
 *   route 退到的那一页的 route（没有就是空串）
 */
export function findSafeBackSteps(stack, opt = {}) {
  const list = Array.isArray(stack) ? stack : []
  const safe = new Set(opt.safeRoutes || SAFE_LANDING_ROUTES)

  // 栈顶永远是当前页（比如账户编辑页），从它下面一页开始找
  for (let i = list.length - 2; i >= 0; i--) {
    const route = list[i] && list[i].route
    if (route && safe.has(route)) {
      // 栈顶下标是 list.length - 1，目标是 i，所以要退这么多步
      return { steps: list.length - 1 - i, route }
    }
  }

  return { steps: 0, route: '' }
}

/**
 * 删除账户后执行回退。
 *
 * ★ 落点优先级 ★
 *   1. 栈里能退到账户列表 -> navigateBack 到它
 *      （中间夹着的账户详情页会被一并跳过）
 *   2. 栈里能退到其它安全页面（首页 / 统计 / 我的 / 全部交易）
 *      -> 退到它，再把账户列表补上（switchTab）
 *   3. 栈里一个安全落点都没有（分享链接 / 冷启动直达编辑页）
 *      -> switchTab 到账户列表
 *
 * ★ 为什么账户列表用 switchTab ★
 *   pages/account/index 是 tabBar 页面，
 *   navigateTo / redirectTo 跳到 tab 页会失败（uni 的硬限制），
 *   只有 switchTab 能用。
 *
 * @param {object} [uniApi] 传入 uni（便于单测注入假实现）
 * @returns {{steps:number, route:string, via:string}}
 *   via: 'back' | 'switchTab'
 */
export function backAfterAccountDelete(uniApi = null) {
  const api = uniApi || (typeof uni !== 'undefined' ? uni : null)

  let stack = []
  try {
    stack = typeof getCurrentPages === 'function' ? (getCurrentPages() || []) : []
  } catch (e) {
    stack = []
  }

  const found = findSafeBackSteps(stack)

  // 1) 退到账户列表
  if (found.steps > 0 && found.route === ACCOUNT_LIST_ROUTE) {
    try {
      if (api && typeof api.navigateBack === 'function') {
        api.navigateBack({ delta: found.steps })
      }
    } catch (e) {}
    return { steps: found.steps, route: found.route, via: 'back' }
  }

  // 2) 退到其它安全页面，但账户列表才是用户想看的结果 -> 直接切账户列表
  //    （退到首页再切 tab，用户会看到一次多余的页面闪烁）
  try {
    if (api && typeof api.switchTab === 'function') {
      api.switchTab({ url: `/${ACCOUNT_LIST_ROUTE}` })
    }
  } catch (e) {}
  return { steps: 0, route: ACCOUNT_LIST_ROUTE, via: 'switchTab' }
}
