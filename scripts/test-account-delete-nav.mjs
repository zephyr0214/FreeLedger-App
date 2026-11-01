/**
 * 删除账户后的「退到哪一页」的测试
 *
 *   node scripts/test-account-delete-nav.mjs
 *
 * ★ 背景（用户反馈的 bug）★
 *   从「账户页 → 账户详情 → 编辑」进来删除账户后，
 *   原来只 navigateBack() 一次，会退回到**那个已经被删掉的账户的详情页**，
 *   页面上还显示着刚删掉的账户名和余额 —— 用户以为没删成功。
 *
 *   正确行为：退到账户列表（或其它安全页面），
 *   中间的账户详情页要被一并跳过。
 *
 * 这里测 utils/navBack.js 的纯计算部分 + 假 uni 走一遍分支。
 */

import {
  findSafeBackSteps,
  backAfterAccountDelete,
  SAFE_LANDING_ROUTES,
  ACCOUNT_LIST_ROUTE
} from '../utils/navBack.js'

let pass = 0
let fail = 0

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    fail++
    console.log(`FAIL  ${name}\n      实际 ${a}\n      期望 ${e}`)
  }
}

/** 造一个页面栈（栈底 -> 栈顶） */
function stackOf(...routes) {
  return routes.map((route) => ({ route }))
}

/* --------------------------------------------------------- 常量本身 */

console.log('=== 安全落点名单 ===')

check('账户列表在名单里', SAFE_LANDING_ROUTES.includes(ACCOUNT_LIST_ROUTE), true)
check('账户列表的 route 常量', ACCOUNT_LIST_ROUTE, 'pages/account/index')
// ★ 关键：账户详情页不在名单里，否则删除后会停在被删掉的账户页 ★
check(
  '账户详情不在安全落点里',
  SAFE_LANDING_ROUTES.includes('pages/account/detail'),
  false
)
check(
  '账户编辑不在安全落点里',
  SAFE_LANDING_ROUTES.includes('pages/account/edit'),
  false
)

/* ------------------------------------------------- findSafeBackSteps */

console.log('=== 栈：账户页 -> 详情 -> 编辑（用户报的那个场景）===')

{
  const stack = stackOf(
    'pages/account/index',
    'pages/account/detail',
    'pages/account/edit'
  )
  const r = findSafeBackSteps(stack)
  // 栈顶是编辑页（下标 2），安全落点是账户列表（下标 0）-> 退 2 步
  check('退 2 步（跳过详情页）', r.steps, 2)
  check('落点是账户列表', r.route, 'pages/account/index')
}

console.log('=== 栈：首页 -> 账户页 -> 详情 -> 编辑 ===')

{
  const stack = stackOf(
    'pages/index/index',
    'pages/account/index',
    'pages/account/detail',
    'pages/account/edit'
  )
  const r = findSafeBackSteps(stack)
  check('退 2 步（落在账户列表，不是首页）', r.steps, 2)
  check('落点是账户列表', r.route, 'pages/account/index')
}

console.log('=== 栈：只有 账户页 -> 编辑（从列表直接进编辑）===')

{
  const stack = stackOf('pages/account/index', 'pages/account/edit')
  const r = findSafeBackSteps(stack)
  check('退 1 步', r.steps, 1)
  check('落点是账户列表', r.route, 'pages/account/index')
}

console.log('=== 栈：首页 -> 编辑（首页的 + 添加账户）===')

{
  const stack = stackOf('pages/index/index', 'pages/account/edit')
  const r = findSafeBackSteps(stack)
  check('退 1 步', r.steps, 1)
  check('落点是首页', r.route, 'pages/index/index')
}

console.log('=== 栈：只有编辑页（分享链接 / 冷启动直达）===')

{
  const stack = stackOf('pages/account/edit')
  const r = findSafeBackSteps(stack)
  check('没有可退的安全落点', r.steps, 0)
  check('route 是空串', r.route, '')
}

console.log('=== 栈：空栈 / 非法入参不能崩 ===')

{
  check('空数组', findSafeBackSteps([]).steps, 0)
  check('null', findSafeBackSteps(null).steps, 0)
  check('undefined', findSafeBackSteps(undefined).steps, 0)
  check('不是数组', findSafeBackSteps('abc').steps, 0)
}

console.log('=== 自定义安全名单 ===')

{
  const stack = stackOf(
    'pages/index/index',
    'pages/account/detail',
    'pages/account/edit'
  )
  // 只允许首页当落点 -> 退 2 步
  const r = findSafeBackSteps(stack, { safeRoutes: ['pages/index/index'] })
  check('自定义名单：退 2 步', r.steps, 2)
  check('自定义名单：落在首页', r.route, 'pages/index/index')
}

/* ---------------------------------------------- backAfterAccountDelete */

console.log('=== 执行回退：栈里有账户列表 -> navigateBack ===')

{
  const calls = []
  const fakeUni = {
    navigateBack: (opt) => calls.push(['back', opt && opt.delta]),
    switchTab: (opt) => calls.push(['switchTab', opt && opt.url])
  }
  const stack = stackOf(
    'pages/account/index',
    'pages/account/detail',
    'pages/account/edit'
  )

  // 注入假的 getCurrentPages
  const prevGet = globalThis.getCurrentPages
  globalThis.getCurrentPages = () => stack
  try {
    const r = backAfterAccountDelete(fakeUni)
    check('走了 navigateBack', calls[0][0], 'back')
    check('delta = 2（跳过详情页）', calls[0][1], 2)
    check('返回的 via 是 back', r.via, 'back')
    check('没有额外调 switchTab', calls.length, 1)
  } finally {
    globalThis.getCurrentPages = prevGet
  }
}

console.log('=== 执行回退：栈里只有编辑页 -> switchTab 到账户列表 ===')

{
  const calls = []
  const fakeUni = {
    navigateBack: (opt) => calls.push(['back', opt && opt.delta]),
    switchTab: (opt) => calls.push(['switchTab', opt && opt.url])
  }
  const stack = stackOf('pages/account/edit')

  const prevGet = globalThis.getCurrentPages
  globalThis.getCurrentPages = () => stack
  try {
    const r = backAfterAccountDelete(fakeUni)
    check('走了 switchTab', calls[0][0], 'switchTab')
    // ★ tab 页只能 switchTab 跳，redirectTo/navigateTo 都会失败 ★
    check('目标是账户列表', calls[0][1], '/pages/account/index')
    check('返回的 via 是 switchTab', r.via, 'switchTab')
    check('没有调 navigateBack', calls.filter((c) => c[0] === 'back').length, 0)
  } finally {
    globalThis.getCurrentPages = prevGet
  }
}

console.log('=== 执行回退：栈里有首页但没有账户列表 -> 直接切账户列表 ===')

{
  const calls = []
  const fakeUni = {
    navigateBack: (opt) => calls.push(['back', opt && opt.delta]),
    switchTab: (opt) => calls.push(['switchTab', opt && opt.url])
  }
  const stack = stackOf('pages/index/index', 'pages/account/edit')

  const prevGet = globalThis.getCurrentPages
  globalThis.getCurrentPages = () => stack
  try {
    backAfterAccountDelete(fakeUni)
    /*
     * ★ 为什么这里不 navigateBack 到首页 ★
     *   用户是来删账户的，删完应该看到账户列表。
     *   退到首页再 switchTab 过去，会多闪一次页面。
     *   直接 switchTab 一步到位。
     */
    check('直接 switchTab 到账户列表', calls[0], ['switchTab', '/pages/account/index'])
  } finally {
    globalThis.getCurrentPages = prevGet
  }
}

console.log('=== 执行回退：getCurrentPages 抛异常也不能崩 ===')

{
  const calls = []
  const fakeUni = {
    navigateBack: () => { throw new Error('boom') },
    switchTab: (opt) => calls.push(['switchTab', opt && opt.url])
  }

  const prevGet = globalThis.getCurrentPages
  globalThis.getCurrentPages = () => { throw new Error('no pages') }
  try {
    const r = backAfterAccountDelete(fakeUni)
    check('异常时不崩，兜底切账户列表', calls[0], ['switchTab', '/pages/account/index'])
    check('返回 via = switchTab', r.via, 'switchTab')
  } finally {
    globalThis.getCurrentPages = prevGet
  }
}

console.log('=== 执行回退：uni 接口本身失败也不能抛 ===')

{
  const fakeUni = {
    navigateBack: () => { throw new Error('not supported') },
    switchTab: () => { throw new Error('not supported') }
  }
  const stack = stackOf('pages/account/index', 'pages/account/edit')

  const prevGet = globalThis.getCurrentPages
  globalThis.getCurrentPages = () => stack
  try {
    // 不抛异常就算通过
    let threw = null
    try {
      backAfterAccountDelete(fakeUni)
    } catch (e) {
      threw = e
    }
    check('接口抛异常时被吞掉，不向上传播', threw, null)
  } finally {
    globalThis.getCurrentPages = prevGet
  }
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
