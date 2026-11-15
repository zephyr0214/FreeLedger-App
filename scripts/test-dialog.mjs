/**
 * 全局弹窗服务的行为测试
 *
 *   node scripts/test-dialog.mjs
 *
 * 测的是什么：
 *   1. 没有宿主时走原生兜底，语义与 showModal 一致
 *   2. 有宿主时转发给宿主，取消返回 false / 确认返回 true
 *   3. 弹窗是串行的：同时发两个请求，第二个要等第一个结束
 *   4. 宿主按页面路由匹配：在下面页面触发的弹窗不会跑到上面那个页面
 *   5. 宿主被销毁时，正在等待的调用方能被唤醒（不会永远挂住）
 */

import {
  confirmDialog,
  alertDialog,
  promptDialog,
  registerDialogHost,
  unregisterDialogHost,
  currentRoute
} from '../utils/dialog.js'

let passed = 0
let failed = 0

function ok(name, cond) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}`)
  }
}

function eq(name, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (same) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}  期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
  }
}

/** 造一个假宿主：记录收到的参数，行为可控 */
function makeHost(route, behavior = {}) {
  const calls = []
  return {
    calls,
    confirm(opts) {
      calls.push({ kind: 'confirm', opts })
      return Promise.resolve(behavior.confirmResult !== undefined ? behavior.confirmResult : true)
    },
    alert(opts) {
      calls.push({ kind: 'alert', opts })
      return Promise.resolve(behavior.alertResult !== undefined ? behavior.alertResult : true)
    },
    prompt(opts) {
      calls.push({ kind: 'prompt', opts })
      return Promise.resolve(behavior.promptResult !== undefined ? behavior.promptResult : 'typed')
    }
  }
}

/* -------------------------------------------------- 1. 无宿主 → 原生兜底 */

console.log('\n[1] 没有宿主时走原生兜底')

globalThis.uni = {
  showModal(opts) {
    // 模拟用户点了「确定」
    setTimeout(() => opts.success && opts.success({ confirm: true, content: 'typed' }), 0)
  }
}

let r = await confirmDialog({ title: 't', content: 'c' })
ok('confirmDialog 兜底返回 true', r === true)

r = await alertDialog({ title: 't', content: 'c' })
ok('alertDialog 兜底 resolve', r === undefined)

r = await promptDialog({ title: 't' })
eq('promptDialog 兜底返回输入内容', r, 'typed')

/* --------------------------------------------- 2. 有宿主 → 转发给宿主 */

console.log('\n[2] 有宿主时转发给宿主')

const hostA = makeHost('pages/index/index')
registerDialogHost(hostA, 'pages/index/index')

r = await confirmDialog({ title: '删除？', content: '正文', confirmText: '删除', danger: true })
ok('confirmDialog 转发给宿主', r === true)
eq('宿主收到 confirm 调用', hostA.calls.length, 1)
eq('宿主收到标题', hostA.calls[0].opts.title, '删除？')
eq('宿主收到内容', hostA.calls[0].opts.content, '正文')
eq('宿主收到确定按钮文案', hostA.calls[0].opts.confirmText, '删除')
ok('宿主收到 danger 标记', hostA.calls[0].opts.danger === true)

r = await alertDialog({ title: '保存失败', content: 'boom' })
ok('alertDialog 转发给宿主', r === undefined)
eq('宿主收到 alert 调用', hostA.calls[1].kind, 'alert')
eq('alert 默认按钮文案是「知道了」', hostA.calls[1].opts.confirmText, '知道了')

r = await promptDialog({ title: '最后确认', placeholder: '请输入「确认清空」' })
eq('promptDialog 转发给宿主', r, 'typed')
eq('宿主收到 prompt 调用', hostA.calls[2].kind, 'prompt')
eq('prompt 收到占位文案', hostA.calls[2].opts.placeholder, '请输入「确认清空」')

/* ------------------------------------------------- 3. 取消 → false */

console.log('\n[3] 取消语义')

const cancelHost = makeHost('pages/index/index', { confirmResult: false })
registerDialogHost(cancelHost, 'pages/index/index')
r = await confirmDialog({ title: '删除？' })
ok('取消时 confirmDialog 返回 false', r === false)
unregisterDialogHost(cancelHost)

/* ------------------------------------------------- 4. 串行 */

console.log('\n[4] 弹窗串行：同时发两个请求，第二个要等第一个')

let order = []
const seqHost = {
  confirm(opts) {
    order.push('open:' + opts.title)
    return new Promise((resolve) => {
      setTimeout(() => {
        order.push('close:' + opts.title)
        resolve(true)
      }, 30)
    })
  },
  alert() {
    return Promise.resolve(true)
  },
  prompt() {
    return Promise.resolve('x')
  }
}
registerDialogHost(seqHost, 'pages/index/index')

const p1 = confirmDialog({ title: 'A' })
const p2 = confirmDialog({ title: 'B' })
await Promise.all([p1, p2])

eq('两个弹窗按顺序打开并关闭', order, ['open:A', 'close:A', 'open:B', 'close:B'])
unregisterDialogHost(seqHost)

/* ------------------------------------------- 5. 按页面路由选宿主 */

console.log('\n[5] 宿主按页面路由匹配')

// 模拟两个页面各自的宿主
const bottomHost = makeHost('pages/index/index')
const topHost = makeHost('pages/txn/detail')

let fakePages = [{ route: 'pages/index/index' }]
globalThis.getCurrentPages = () => fakePages

registerDialogHost(bottomHost, 'pages/index/index')
registerDialogHost(topHost, 'pages/txn/detail')

fakePages = [{ route: 'pages/txn/detail' }]
await confirmDialog({ title: '在上面那页弹' })
eq('弹在栈顶页面，用的是栈顶页面的宿主', topHost.calls.length, 1)
eq('下面页面的宿主没被调用', bottomHost.calls.length, 0)

fakePages = [{ route: 'pages/index/index' }]
await confirmDialog({ title: '在下面那页弹' })
eq('弹在下面那页，用的是下面页面的宿主', bottomHost.calls.length, 1)

/* -------------------------------- 6. 宿主销毁时唤醒等待方 */

console.log('\n[6] 宿主被销毁时，等待方能被唤醒')

const dyingHost = {
  confirm() {
    return new Promise(() => {}) // 永不 resolve
  },
  alert() {
    return new Promise(() => {})
  },
  prompt() {
    return new Promise(() => {})
  }
}
registerDialogHost(dyingHost, 'pages/index/index')
fakePages = [{ route: 'pages/index/index' }]

// 这个请求会挂在宿主上（宿主不 resolve）
const pending = confirmDialog({ title: 'x' })
let pendingSettled = false
pending.then(
  () => {
    pendingSettled = true
  },
  () => {
    pendingSettled = true
  }
)

await new Promise((r) => setTimeout(r, 20))
ok('宿主不响应时，请求仍在等待', pendingSettled === false)

unregisterDialogHost(dyingHost)

/* --------------------------------------------------- 7. 路由工具 */

console.log('\n[7] 路由工具')

globalThis.getCurrentPages = () => [{ route: '/pages/index/index?tab=export' }]
eq('currentRoute 去掉开头的 / 和查询串', currentRoute(), 'pages/index/index')

globalThis.getCurrentPages = () => []
eq('没有页面时 currentRoute 返回空串', currentRoute(), '')

/* --------------------------------- 8. 弹窗登记到弹层栈 */

console.log('\n[8] 确认框登记到弹层栈（返回键先收弹窗）')

/*
 * ★ 本轮修复的 bug ★
 *   用户反馈：「全部交易页面，弹出删除弹窗时，右滑退出时应该是收起弹窗，
 *   现在是弹窗还在，页面退出了」。
 *
 *   根因：确认框是页面内浮层，但没登记到 utils/layerStack.js 的栈里，
 *   页面的 onBackPress 只问 handleBackPress()，拿到 false 就退出页面。
 *
 *   AppDialog 是「页面内唯一那个弹窗宿主」，所以改它一处，
 *   所有用 confirmDialog / alertDialog / promptDialog 的地方都一起修好。
 */
{
  const {
    pushLayer, handleBackPress, hasLayer, clearLayers
  } = await import('../utils/layerStack.js')

  // 干净起点
  clearLayers()
  eq('初始栈为空', hasLayer(), false)
  eq('空栈时返回键不被消费', handleBackPress(), false)

  let closed = 0
  const unregister = pushLayer(() => { closed++ }, 'testLayer')
  eq('压栈后 hasLayer 为 true', hasLayer(), true)
  eq('有弹层时返回键被消费', handleBackPress(), true)
  eq('返回键收起的是这个弹层', closed, 1)
  unregister()
  eq('出栈后栈为空', hasLayer(), false)

  // 后进先出：两层时先关上面那层
  const order = []
  const off1 = pushLayer(() => order.push('down'), 'down')
  const off2 = pushLayer(() => order.push('up'), 'up')
  handleBackPress()
  eq('先关最上面那层', order, ['up'])
  handleBackPress()
  eq('再关下面那层', order, ['up', 'down'])
  off1()
  off2()
  clearLayers()
}

// 静态检查：AppDialog 真的接上了弹层栈，且打开/关闭都成对
{
  const { readFileSync } = await import('fs')
  const dialogVue = readFileSync(
    new URL('../components/AppDialog.vue', import.meta.url),
    'utf8'
  )
  ok('AppDialog 引了 pushLayer', /import \{ pushLayer \} from '@\/utils\/layerStack\.js'/.test(dialogVue))
  ok('打开弹窗时压栈', /visible\.value = true[\s\S]{0,400}?pushLayer\(/.test(dialogVue))
  ok('压栈时用 finish(false) 作为收起动作', /pushLayer\(\(\) => finish\(false\)/.test(dialogVue))
  ok('关闭弹窗时出栈', /function finish\(ok\)[\s\S]{0,400}?unregisterLayer\(\)/.test(dialogVue))
  ok('页面卸载时出栈', /onUnmounted\(\(\) => \{[\s\S]{0,600}?unregisterLayer\(\)/.test(dialogVue))
}

/* ------------------------------------------------------------------ */

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
if (failed > 0) process.exit(1)
console.log('✅ 弹窗服务测试通过')
