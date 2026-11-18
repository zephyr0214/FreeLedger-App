/**
 * wot-design-uni 的「同一时间只开一个浮层」队列（安全版）
 *
 * ★ 为什么要在 App 根部提供自己的队列 ★
 *   wot 的 wd-swipe-action / wd-popover / wd-drop-menu 等组件没有显式
 *   provide 时，会退回到模块级 clickoutside 队列，里面的实现是：
 *
 *     queue.filter(item => item.$.uid !== comp.$.uid)
 *
 *   清空所有数据时，首页最近流水会一次性销毁多行 wd-swipe-action。
 *   某些机型/时序下，队列里会残留已经卸载的组件代理（proxy.$ 已不存在），
 *   这行就会抛：
 *     Cannot read properties of undefined (reading '$')
 *   而且每销毁一行就报一次，控制台刷屏。
 *
 * ★ 这里做什么 ★
 *   通过 app.provide('__QUEUE_KEY__', ...) 给 wot 注入一份同接口、
 *   但所有访问都先判空的队列。行为保持不变：
 *     · 打开一个右滑行时关掉其它行
 *     · 组件卸载时从队列移除
 *   只是不会再因为坏掉的代理把页面弄崩。
 */

import { ref } from 'vue'

const queue = ref([])

function uidOf(comp) {
  return comp && comp.$ && comp.$.uid !== undefined ? comp.$.uid : null
}

function closeOf(comp) {
  const exposed = comp && comp.$ && comp.$.exposed
  return exposed && typeof exposed.close === 'function' ? exposed.close : null
}

function pushToQueue(comp) {
  if (!comp || !comp.$) return
  queue.value.push(comp)
}

function removeFromQueue(comp) {
  const uid = uidOf(comp)
  queue.value = queue.value.filter((item) => {
    if (!item || !item.$) return false
    return uid === null || item.$.uid !== uid
  })
}

function closeOther(comp) {
  const uid = uidOf(comp)
  queue.value.forEach((item) => {
    if (!item || !item.$ || item.$.uid === uid) return
    const close = closeOf(item)
    if (close) close()
  })
}

function closeOutside() {
  queue.value.forEach((item) => {
    const close = closeOf(item)
    if (close) close()
  })
}

export const wotQueue = {
  queue,
  pushToQueue,
  removeFromQueue,
  closeOther,
  closeOutside
}
