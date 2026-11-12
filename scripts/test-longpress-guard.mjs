/**
 * 长按手势闸门测试 —— 防「滑动列表时误触进入多选」
 *
 *   node scripts/test-longpress-guard.mjs
 *
 * ★ 用户反馈 ★
 *   「全部交易页面和报销页面我在滑动时容易误触多选」
 *
 * ★ 根因 ★
 *   原来两页都直接绑平台的 @longpress。
 *   App 端这个事件由 uni-app 视图层自己派发：
 *     按下 350ms 触发，期间移动超过 10px 才取消
 *   （打包产物 unpackage/dist/build/app-plus/uni-app-view.umd.js
 *    里就是 gi=350、mi=10 这两个常量）。
 *   10px 只有两三毫米，350ms 又比系统长按短，
 *   手指「先按住再发力上滑」这个再普通不过的动作就会命中判定。
 *
 * ★ 修法 ★
 *   换成 utils/rowPress.js 自己判定（450ms + 12px + 滚动抑制 +
 *   多指忽略 + 长按后 500ms 屏蔽 click），两个页面共用同一份规则。
 *
 * ★ 这个测试钉住什么 ★
 *   1. 滑动的第一段位移就要能取消长按（不是滑到 30px 才取消）
 *   2. 按住不动但列表在滚，不能判成长按
 *   3. 按够时长、没位移、没滚动 → 必须判成长按（别修成「怎么按都不触发」）
 *   4. 长按成立后补发的 click 必须被忽略
 *   5. 多指触摸不参与判定
 *   6. 抬手要撤销计时器（否则松手后才弹出多选）
 *   7. 两个页面都必须用这个闸门，不能再直接绑 @longpress
 */

import { readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

import {
  createPressGate,
  createRowPressController,
  singleTouchPoint,
  LONG_PRESS_HOLD_MS,
  LONG_PRESS_MOVE_TOLERANCE_PX,
  CLICK_SUPPRESS_MS
} from '../utils/rowPress.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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

/** 假时钟：手动推进，避免测试靠真实 sleep */
function fakeClock() {
  let t = 1000
  return {
    now: () => t,
    advance: (ms) => {
      t += ms
    }
  }
}

function touchEvent(x, y) {
  return { touches: [{ clientX: x, clientY: y }] }
}

console.log('=== 1. 阈值常量：必须比平台的 350ms / 10px 更严 ===')

check('长按时长大于平台的 350ms', LONG_PRESS_HOLD_MS > 350, true)
check('位移容差大于平台的 10px', LONG_PRESS_MOVE_TOLERANCE_PX > 10, true)

console.log('\n=== 2. 闸门：滑动起步就该取消长按 ===')

{
  const clock = fakeClock()
  const gate = createPressGate({ now: clock.now })
  gate.begin(100, 100)
  // 平台只容忍 10px；这里滑到 13px 就必须判为「在滑动」
  check('13px 时仍在跟踪', gate.move(100, 113), false)
  check('判为滑动后 isPressed', gate.isPressed(), false)
  clock.advance(1000)
  check('滑动后按再久也不算长按', gate.canFire(), false)
}

{
  // 反向 / 斜向也要算（取 x、y 里大的那个）
  const clock = fakeClock()
  const gate = createPressGate({ now: clock.now })
  gate.begin(200, 200)
  check('向左 13px 也判为滑动', gate.move(187, 200), false)
}

{
  // 12px 以内是人手抖动，不该取消
  const clock = fakeClock()
  const gate = createPressGate({ now: clock.now })
  gate.begin(100, 100)
  clock.advance(LONG_PRESS_HOLD_MS)
  check('11px 抖动仍算按住', gate.move(100, 111), true)
  check('按够时长且没超容差 → 成立', gate.canFire(), true)
}

console.log('\n=== 3. 按住不动但列表在滚：不判长按 ===')

{
  const clock = fakeClock()
  const gate = createPressGate({ now: clock.now })
  gate.begin(100, 100)
  clock.advance(300) // 按住到一半，列表被带动滚了一下
  gate.noteScroll()
  clock.advance(LONG_PRESS_HOLD_MS - 300) // 到点这一刻，离上次滚动只有 150ms
  check('离滚动太近 → 不成立', gate.canFire(), false)

  clock.advance(300) // 静默超过 250ms
  check('静默够久 → 才可能成立', gate.canFire(), true)
}

console.log('\n=== 4. 控制器：按够时长触发一次，且只触发一次 ===')

{
  const clock = fakeClock()
  let timerFn = null
  const fired = []
  const press = createRowPressController({
    now: clock.now,
    setTimer: (fn) => {
      timerFn = fn
      return 1
    },
    clearTimer: () => {
      timerFn = null
    },
    onLongPress: (row) => fired.push(row)
  })

  press.onTouchStart({ id: 't1' }, touchEvent(50, 50))
  // 计时器还没到点：手动推进后不该已经触发
  check('未到点不触发', fired.length, 0)
  clock.advance(LONG_PRESS_HOLD_MS)
  timerFn()
  check('到点触发一次，行对象正确', fired, [{ id: 't1' }])
  check('关闭对象被传给回调', JSON.stringify(fired[0]), JSON.stringify({ id: 't1' }))

  // 计时器回调重复执行（个别平台会补）也不该再次触发
  timerFn && timerFn()
  check('不会重复触发', fired.length, 1)
}

console.log('\n=== 5. 长按后补发的 click 必须忽略 ===')

{
  const clock = fakeClock()
  let timerFn = null
  const press = createRowPressController({
    now: clock.now,
    setTimer: (fn) => {
      timerFn = fn
      return 1
    },
    clearTimer: () => {
      timerFn = null
    },
    onLongPress: () => {}
  })

  check('平时 click 正常', press.clickBlocked(), false)
  press.onTouchStart({ id: 't2' }, touchEvent(10, 10))
  clock.advance(LONG_PRESS_HOLD_MS)
  timerFn()
  check('长按刚成立 → click 被屏蔽', press.clickBlocked(), true)
  clock.advance(CLICK_SUPPRESS_MS + 1)
  check('窗口过了 → click 恢复', press.clickBlocked(), false)
}

console.log('\n=== 5b. 长按成立后又按住很久才松手：click 依然要挡 ===')

{
  /*
   * ★ 平台补发的 click 是在松手那一刻派发的 ★
   *   如果屏蔽窗口只从「长按成立」开始算，
   *   用户长按 1 秒后才松手，窗口早过期 —— 那次 click 会照常生效，
   *   表现成「长按选中 → 松手又取消」。窗口必须在抬手时续上。
   */
  const clock = fakeClock()
  let timerFn = null
  const press = createRowPressController({
    now: clock.now,
    setTimer: (fn) => {
      timerFn = fn
      return 1
    },
    clearTimer: () => {
      timerFn = null
    },
    onLongPress: () => {}
  })

  press.onTouchStart({ id: 't2b' }, touchEvent(10, 10))
  clock.advance(LONG_PRESS_HOLD_MS)
  timerFn()
  clock.advance(1200) // 用户还一直按着
  check('按住很久后窗口已过期', press.clickBlocked(), false)
  press.onTouchEnd() // 松手 —— 平台就在这一刻补发 click
  check('松手后 click 重新被屏蔽', press.clickBlocked(), true)
  clock.advance(CLICK_SUPPRESS_MS + 1)
  check('之后的正常点击恢复', press.clickBlocked(), false)
}

console.log('\n=== 6. 抬手 / 移动 / 多指 都要撤销 ===')

{
  const clock = fakeClock()
  let timerFn = null
  let cleared = 0
  const fired = []
  const press = createRowPressController({
    now: clock.now,
    setTimer: (fn) => {
      timerFn = fn
      return 1
    },
    clearTimer: () => {
      cleared++
      timerFn = null
    },
    onLongPress: (row) => fired.push(row)
  })

  press.onTouchStart({ id: 't3' }, touchEvent(10, 10))
  press.onTouchEnd()
  check('抬手清掉计时器', cleared, 1)
  check('抬手后计时器回调不再触发', timerFn, null)

  press.onTouchStart({ id: 't4' }, touchEvent(10, 10))
  press.onTouchMove(touchEvent(10, 40)) // 往上滑 30px
  check('滑动撤销计时器', cleared, 2)
  clock.advance(LONG_PRESS_HOLD_MS)
  check('滑动后不触发', fired, [])

  // 多指：不该进入判定
  cleared = 0
  press.onTouchStart({ id: 't5' }, { touches: [{ clientX: 1, clientY: 1 }, { clientX: 9, clientY: 9 }] })
  check('多指不启动计时器', timerFn, null)

  // 中途变多指：也要撤销
  press.onTouchStart({ id: 't6' }, touchEvent(10, 10))
  press.onTouchMove({ touches: [{ clientX: 1, clientY: 1 }, { clientX: 9, clientY: 9 }] })
  check('中途变多指也撤销', timerFn, null)
}

console.log('\n=== 7. 滚动一发生就撤销进行中的长按 ===')

{
  const clock = fakeClock()
  let timerFn = null
  const fired = []
  const press = createRowPressController({
    now: clock.now,
    setTimer: (fn) => {
      timerFn = fn
      return 1
    },
    clearTimer: () => {
      timerFn = null
    },
    onLongPress: (row) => fired.push(row)
  })

  press.onTouchStart({ id: 't7' }, touchEvent(10, 10))
  press.onScroll()
  check('滚动撤销计时器', timerFn, null)
  clock.advance(LONG_PRESS_HOLD_MS)
  check('滚动后不触发长按', fired, [])
}

console.log('\n=== 8. singleTouchPoint 读坐标 ===')

check('单指', singleTouchPoint(touchEvent(3, 4)), { x: 3, y: 4 })
check('双指返回 null', singleTouchPoint({ touches: [{ clientX: 1, clientY: 1 }, { clientX: 2, clientY: 2 }] }), null)
check('空事件返回 null', singleTouchPoint(null), null)
check('只有 pageX/pageY 时兜底', singleTouchPoint({ touches: [{ pageX: 7, pageY: 8 }] }), { x: 7, y: 8 })

console.log('\n=== 9. 两个页面都必须用闸门，不能再直接绑 @longpress ===')

{
  const list = read('pages/txn/list.vue')
  const reimburse = read('pages/loan/reimburse.vue')

  /*
   * ★ 为什么钉「没有 @longpress」★
   *   只要有人图省事把平台的 @longpress 加回来，
   *   误触问题就立刻复活，而且这种「两个事件都在」不会报错。
   */
  check('全部交易不再用平台 @longpress', /@longpress="/.test(list), false)
  check('报销页不再用平台 @longpress', /@longpress="/.test(reimburse), false)

  check('全部交易绑了 touchstart', /@touchstart="onRowTouchStart\(txn, \$event\)"/.test(list), true)
  check('报销页绑了 touchstart', /@touchstart="onRowTouchStart\(t, \$event\)"/.test(reimburse), true)
  check('全部交易 scroll-view 上报滚动', /@scroll="onListScroll"/.test(list), true)
  check('报销页 scroll-view 上报滚动', /@scroll="onListScroll"/.test(reimburse), true)

  check('全部交易 import 了闸门', /import \{ createRowPressController \} from '@\/utils\/rowPress\.js'/.test(list), true)
  check('报销页 import 了闸门', /import \{ createRowPressController \} from '@\/utils\/rowPress\.js'/.test(reimburse), true)

  check('两页都把手势函数暴露给模板（全部交易）', /onRowTouchStart, onRowTouchMove, onRowTouchEnd, onListScroll/.test(list), true)
  check('两页都把手势函数暴露给模板（报销）', /onRowTouchStart, onRowTouchMove, onRowTouchEnd, onListScroll/.test(reimburse), true)

  check('click 里挡掉长按补发的那一次（全部交易）', /function onRowClick[\s\S]{0,200}?rowPress\.clickBlocked\(\)/.test(list), true)
  check('click 里挡掉长按补发的那一次（报销）', /function onRowClick[\s\S]{0,200}?rowPress\.clickBlocked\(\)/.test(reimburse), true)

  check('卸载时清计时器（全部交易）', /rowPress\.dispose\(\)/.test(list), true)
  check('卸载时清计时器（报销）', /rowPress\.dispose\(\)/.test(reimburse), true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
