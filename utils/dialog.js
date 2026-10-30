/**
 * 全局弹窗服务 —— 用组件库（wot-design-uni）替换原生 uni.showModal
 *
 * 目标：全 App 的「确定 / 取消」弹窗样式统一，不再出现
 *      Android 原生白底方框那种和整体 UI 不搭的弹窗。
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 为什么不直接用 useMessage() ★
 *   wd-message-box 的函数式调用依赖 Vue 的 provide / inject：
 *   useMessage() 必须在**组件的 setup()** 里调用，
 *   才能和 <wd-message-box> 建立父子关系。
 *
 *   但业务代码很多不在组件里：
 *     - api/db/diagnose.js 的 showDbDiagnostics()
 *     - App.vue 的 onLaunch（App 端 App.vue 的 template 根本不渲染）
 *   这些地方拿不到组件实例，也就调不了 useMessage()。
 *
 *   所以这里做一层「宿主注册」：
 *     1. 每个会弹窗的页面挂一个 <AppDialog />，
 *        组件内部实现 confirm / alert / prompt；
 *     2. 组件 setup 里 registerDialogHost()，卸载时 unregisterDialogHost()；
 *     3. 业务代码直接调 confirmDialog() / alertDialog()，
 *        由本文件转发给「当前该用的」那个宿主。
 *
 * ★ 怎么保证弹窗出现在正确的页面上 ★
 *   uni-app 的页面栈里，上一个页面还活着（只是被盖住）。
 *   如果只按「挂载顺序」取最后一个宿主，
 *   就会出现「在下面页面触发的弹窗，跑到上面那个页面去了」。
 *
 *   所以每个宿主注册时带上自己所属的页面路径，
 *   取宿主时用 getCurrentPages() 拿到当前栈顶页面的路径去匹配。
 *   匹配不上（说明栈顶页面没挂宿主）就退回原生弹窗。
 *
 * ★ 语义对齐原 uni.showModal ★
 *   - 确认框点「取消」→ 视为不确认，调用方什么也不做
 *   - 单按钮框（showCancel: false）→ 用「知道了」模式
 *   - 确认框返回 Promise<boolean>，与原来的 res.confirm 一一对应
 */

/* ------------------------------------------------------------------ *
 * 宿主表
 * ------------------------------------------------------------------ */

/** @type {Array<{host: Object, route: string}>} 已注册的宿主 */
const hosts = []

/** @type {Array<{run: Function}>} 等待宿主的请求队列 */
const waiting = []

/**
 * 宿主都没挂上时的兜底超时（毫秒）。
 *
 * 正常情况下所有会弹窗的页面都挂了 <AppDialog />，
 * 队列会在页面挂载的瞬间被消费掉。
 *
 * 真正用到兜底的只有两种情况：
 *   1. App.vue 的 onLaunch —— 那时还没有任何页面
 *   2. 某个页面漏挂了 <AppDialog />
 * 两种都退回原生弹窗，保证「操作不会卡死」比「样式统一」更重要。
 */
const FALLBACK_TIMEOUT = 1000

/* ------------------------------------------------------------------ *
 * 弹窗串行队列
 * ------------------------------------------------------------------ */

/**
 * 全局串行链。
 *
 * ★ 为什么必须串行 ★
 *   弹窗是单例的：同一时刻只能显示一个。
 *   如果两个弹窗同时打开，第二个会覆盖第一个的内容，
 *   第一个的 resolve 就再也拿不到了 ——
 *   调用方的 await 会永远挂在那里（表现为「点了没反应」）。
 *
 *   这条链放在全局（而不是每个宿主各一条），
 *   是为了保证**整个 App 同时只有一个弹窗**，
 *   哪怕两个弹窗来自不同页面/组件。
 */
let chain = Promise.resolve()

/**
 * 把一次弹窗请求排进全局队列。
 *
 * @param {() => Promise<any>} task
 * @returns {Promise<any>}
 */
function enqueue(task) {
  const p = chain.then(() => task())
  // 链条本身不能被 reject 打断，否则一次失败后面全排不上
  chain = p.then(
    () => undefined,
    () => undefined
  )
  return p
}

/* ------------------------------------------------------------------ *
 * 页面路由
 * ------------------------------------------------------------------ */

/**
 * 取当前页面栈顶页面的路径。
 *
 * @returns {string} 形如 'pages/index/index'；取不到返回空串
 */
export function currentRoute() {
  try {
    if (typeof getCurrentPages !== 'function') return ''
    const pages = getCurrentPages()
    if (!pages || !pages.length) return ''
    const top = pages[pages.length - 1]
    if (!top) return ''
    // 不同端拿到的字段不一样，都试一遍
    const route = top.route || (top.$page && top.$page.route) || top.path || ''
    return normalizeRoute(route)
  } catch (e) {
    return ''
  }
}

/**
 * 归一化页面路径：去掉开头的 '/' 和查询串。
 *
 * @param {string} route
 * @returns {string}
 */
function normalizeRoute(route) {
  return String(route || '').replace(/^\//, '').split('?')[0]
}

/* ------------------------------------------------------------------ *
 * 宿主注册
 * ------------------------------------------------------------------ */

/**
 * 注册宿主。
 *
 * @param {Object} host 需实现 confirm / alert / prompt 三个方法
 * @param {string} [route] 宿主所属的页面路径；不传就用当前栈顶页面
 */
export function registerDialogHost(host, route) {
  if (!host) return
  if (hosts.some((h) => h.host === host)) return
  const normalized = normalizeRoute(route || currentRoute())
  hosts.push({ host, route: normalized })
  drainWaiting()
}

/**
 * 注销宿主（页面卸载时调用）。
 *
 * @param {Object} host
 */
export function unregisterDialogHost(host) {
  const i = hosts.findIndex((h) => h.host === host)
  if (i !== -1) hosts.splice(i, 1)
}

/**
 * 找到当前该用的宿主。
 *
 * 优先用「当前栈顶页面」自己的宿主 ——
 * 这样在下面页面触发的弹窗不会跑到上面那个页面去。
 * 栈顶页面没挂宿主时，退回最后一个注册的（一般是最近打开的页面）。
 *
 * @returns {Object|null}
 */
function currentHost() {
  if (!hosts.length) return null

  const route = currentRoute()
  if (route) {
    for (let i = hosts.length - 1; i >= 0; i--) {
      if (hosts[i].route === route) return hosts[i].host
    }
  }

  return hosts[hosts.length - 1].host
}

/** 有宿主了就把排队的请求发出去 */
function drainWaiting() {
  const host = currentHost()
  if (!host) return
  while (waiting.length) {
    const job = waiting.shift()
    try {
      job.run(host)
    } catch (e) {
      console.warn('[dialog] 宿主执行失败:', e && e.message)
    }
  }
}

/* ------------------------------------------------------------------ *
 * 转发
 * ------------------------------------------------------------------ */

/**
 * 把请求交给宿主执行；没有宿主就排队等。
 *
 * @param {(host: Object) => Promise<any>} executor
 * @param {() => Promise<any>} fallback 兜底（原生弹窗）
 * @returns {Promise<any>}
 */
function request(executor, fallback) {
  const host = currentHost()
  if (host) {
    try {
      return enqueue(() => executor(host))
    } catch (e) {
      return Promise.reject(e)
    }
  }

  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null

    const settle = (fn, value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      fn(value)
    }

    const job = {
      run(h) {
        try {
          enqueue(() => executor(h)).then(
            (v) => settle(resolve, v),
            (e) => settle(reject, e)
          )
        } catch (e) {
          settle(reject, e)
        }
      }
    }
    waiting.push(job)

    timer = setTimeout(() => {
      if (settled) return
      const i = waiting.indexOf(job)
      if (i !== -1) waiting.splice(i, 1)
      settled = true
      try {
        Promise.resolve(fallback()).then(resolve, reject)
      } catch (e) {
        reject(e)
      }
    }, FALLBACK_TIMEOUT)
  })
}

/* ------------------------------------------------------------------ *
 * 兜底：原生弹窗
 * ------------------------------------------------------------------ */

function nativeConfirm(opts) {
  return new Promise((resolve) => {
    uni.showModal({
      title: opts.title,
      content: opts.content,
      confirmText: opts.confirmText,
      cancelText: opts.cancelText,
      confirmColor: opts.confirmColor || undefined,
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false)
    })
  })
}

function nativeAlert(opts) {
  /*
   * ★ 原生弹窗不支持结构化列表 ★
   *   所以有 list 时先把它压成纯文本（带勾叉和缩进），
   *   保证兜底路径也能看到完整内容，而不是只剩一行标题。
   */
  const content = opts.list && opts.list.length
    ? [opts.content, ...opts.list.map((it, i) =>
        `${it.ok ? '✓' : '✗'} ${i + 1}. ${it.name}${it.detail ? `\n     ${it.detail}` : ''}`
      )].filter(Boolean).join('\n')
    : opts.content
  return new Promise((resolve) => {
    uni.showModal({
      title: opts.title,
      content,
      showCancel: false,
      success: () => resolve(),
      fail: () => resolve()
    })
  })
}

function nativePrompt(opts) {
  return new Promise((resolve) => {
    uni.showModal({
      title: opts.title,
      content: opts.content,
      editable: true,
      placeholderText: opts.placeholder,
      confirmText: opts.confirmText,
      cancelText: opts.cancelText,
      success: (res) => resolve(res.confirm ? String(res.content || '') : null),
      fail: () => resolve(null)
    })
  })
}

/* ------------------------------------------------------------------ *
 * 对外 API
 * ------------------------------------------------------------------ */

/**
 * 确认框（两个按钮：确定 / 取消）。
 *
 * ```js
 * const ok = await confirmDialog({
 *   title: '删除这笔记录？',
 *   content: '删除后会同步修正账户余额',
 *   confirmText: '删除',
 *   danger: true
 * })
 * if (!ok) return   // 取消就什么都不做
 * ```
 *
 * @param {Object} options
 * @param {string} [options.title]        标题
 * @param {string} [options.content]      内容（支持换行）
 * @param {string} [options.confirmText]  确定按钮文案，默认「确定」
 * @param {string} [options.cancelText]   取消按钮文案，默认「取消」
 * @param {string} [options.confirmColor] 确定按钮颜色（十六进制），一般配合 danger 用
 * @param {boolean} [options.danger]      确定按钮是否用危险色（红）
 * @returns {Promise<boolean>} true = 用户点了确定
 */
export function confirmDialog(options = {}) {
  const opts = {
    title: options.title || '提示',
    content: options.content || '',
    confirmText: options.confirmText || '确定',
    cancelText: options.cancelText || '取消',
    confirmColor: options.confirmColor || '',
    danger: !!options.danger
  }
  return request((host) => host.confirm(opts), () => nativeConfirm(opts))
}

/**
 * 单按钮提示框（原 showModal 的 showCancel: false）。
 *
 * ```js
 * await alertDialog({ title: '保存失败', content: e.message })
 * ```
 *
 * @param {Object} options
 * @param {string} [options.title]       标题
 * @param {string} [options.content]     内容（支持换行）
 * @param {string} [options.confirmText] 按钮文案，默认「知道了」
 * @returns {Promise<void>}
 */
export function alertDialog(options = {}) {
  const opts = {
    title: options.title || '提示',
    content: options.content || '',
    confirmText: options.confirmText || '知道了',
    /*
     * ★ 结构化列表（可选）★
     *   传了就优先按列表渲染（每项 { ok, name, detail }），
     *   比把一堆长句塞进一大段 content 里好读得多
     *   （数据库自检报告就是这么用的）。
     *   没传则退回原来的纯文本 content。
     */
    list: Array.isArray(options.list) ? options.list : null
  }
  return request((host) => host.alert(opts), () => nativeAlert(opts)).then(() => undefined)
}

/**
 * 输入框弹窗（原 showModal 的 editable: true）。
 *
 * ```js
 * const text = await promptDialog({
 *   title: '最后确认',
 *   placeholder: '请输入「确认清空」'
 * })
 * if (text === null) return   // 取消了
 * ```
 *
 * @param {Object} options
 * @param {string} [options.title]       标题
 * @param {string} [options.content]     提示内容
 * @param {string} [options.placeholder] 输入框占位文案
 * @param {string} [options.confirmText] 确定按钮文案，默认「确定」
 * @param {string} [options.cancelText]  取消按钮文案，默认「取消」
 * @returns {Promise<string|null>} 输入的内容；取消返回 null
 */
export function promptDialog(options = {}) {
  const opts = {
    title: options.title || '请输入',
    content: options.content || '',
    placeholder: options.placeholder || '',
    confirmText: options.confirmText || '确定',
    cancelText: options.cancelText || '取消'
  }
  return request((host) => host.prompt(opts), () => nativePrompt(opts))
}
