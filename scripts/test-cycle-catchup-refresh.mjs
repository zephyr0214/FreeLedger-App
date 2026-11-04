/**
 * 周期补记「补了但看不见」的回归测试
 *
 *   node scripts/test-cycle-catchup-refresh.mjs
 *
 * ★ 用户反馈的 bug ★
 *   「首页补齐周期记账之后，不能立刻显示出来」
 *
 * ★ 根因是异步竞态，不是补记失败 ★
 *   App.vue 的 onShow 里跑 runCycleCatchUp()（异步写库），
 *   页面自己的 onShow 里跑 loadAll()（读库渲染）。
 *   两条流互不等待，顺序通常是：
 *     1. 页面 loadAll() 开始，查出「补记前」的数据
 *     2. 补记落库（晚于查询）
 *     3. 页面用旧数据渲染完
 *   → 补记的流水确实进库了，但界面停在第 1 步的快照上，
 *     要等下一次刷新（切 tab / 再回前台）才看得到。
 *
 *   所以这类 bug 有个特征：**数据是对的，只是显示滞后**。
 *   修法不是改查询，而是让补记完成后主动通知页面重查。
 *
 * ★ 这里锁什么 ★
 *   1. App.vue 补记成功后 emit 'cycle:caughtup'
 *   2. 只在确实补了账（total > 0）时才 emit —— 否则每天进前台
 *      都让所有页面白白重查一遍
 *   3. 三个显示流水的页面都监听（首页 / 统计 / 账户）
 *   4. 监听回调真的重新拉数据（不是空实现）
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8')

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

const EVENT = 'cycle:caughtup'

console.log('=== 补记完成后必须发出通知 ===')

{
  const app = read('App.vue')

  check('App.vue 在补记后 emit 事件', new RegExp(`\\$emit\\('${EVENT}'`).test(app), true)

  /*
   * ★ emit 必须在 total > 0 的块里 ★
   *   拿到 total 之后立刻判断，只有真补了账才通知。
   *   用「total > 0」到 emit 之间的最近距离验证它们在同一分支。
   */
  const emitIdx = app.indexOf(`$emit('${EVENT}'`)
  const guardIdx = app.lastIndexOf('if (total > 0)', emitIdx)
  check('emit 在 total > 0 分支内', guardIdx > 0 && emitIdx > guardIdx, true)

  // 补记失败时不能 emit（否则页面白白重查，用户还以为补了）
  check('catch 块里没有 emit', /catch \(e\) \{[\s\S]{0,200}?\$emit\('cycle:caughtup'[\s\S]{0,200}?\}/.test(app.slice(app.indexOf('catch (e) {'))), false)
}

console.log('=== 三个显示流水的页面都要监听 ===')

const PAGES = [
  { rel: 'pages/index/index.vue', label: '首页', loader: /loadAll\(true\)/ },
  { rel: 'pages/stats/index.vue', label: '统计页', loader: /loadAll\(\)/ },
  { rel: 'pages/account/index.vue', label: '账户页', loader: /accountStore\.refresh\(\)/ }
]

for (const p of PAGES) {
  const src = read(p.rel)
  check(
    `${p.label}监听 ${EVENT}`,
    new RegExp(`\\$on\\('${EVENT}'`).test(src),
    true
  )
  check(`${p.label}的监听回调真的重新拉数据`, p.loader.test(src), true)
}

console.log('=== 首页的刷新要绕过缓存 ===')

{
  const index = read('pages/index/index.vue')
  /*
   * ★ 必须是 loadAll(true) 而不是 loadAll() ★
   *   第二个参数是 force —— 走缓存的话等于没刷新，
   *   补记的流水照样出不来。
   */
  const onIdx = index.indexOf(`$on('${EVENT}'`)
  const tail = index.slice(onIdx, onIdx + 300)
  check('首页监听回调用 loadAll(true)（强制刷新）', /loadAll\(true\)/.test(tail), true)
}

console.log('=== 这个 bug 的成因（防止以后改回去）===')

{
  const app = read('App.vue')
  /*
   * 补记是 await catchUpCycles() 的异步写库。
   * 如果有人把它改成不 await（fire-and-forget），
   * 竞态会更严重 —— 补记甚至可能在页面渲染之后才完成。
   */
  check('补记仍然 await 写库完成', /const added = await catchUpCycles\(\)/.test(app), true)

  // 幂等闸门不能丢（同一次 onShow 里重复跑会重复补账）
  check('保留运行中闸门', /_cycleCatchUpRunning/.test(app), true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
