/**
 * 借入借出「按单分组」——纯函数
 *
 * ★ 为什么不按总余额归零切段 ★
 *   总余额归零只能回答「这个人现在是否两清」，回答不了「这是第几单」。
 *   例如旧单借出 200 还没收回时，又借出 100 并马上收回 100：
 *     余额：200 -> 300 -> 200
 *   总余额只在最后收回 198 + 坏账 2 时才回到 0。
 *   按总余额切，会把「新借的 100 + 收回 100」和旧单糊成一单；
 *   用户要的是「这两笔新增为新的一单」，旧单继续挂着。
 *
 * ★ 按「新单在旧单里面收口」切 ★
 *   旧单还没结清时又发生一笔新的本金，就在当前余额之上开一个子单。
 *   子单的余额回到开单时的水平，就说明这一笔新单自己收口了：
 *     旧单本金 200         余额 200
 *     新单本金 100         余额 300  ← 子单开始
 *     新单收回 100         余额 200  ← 子单回到 200，独立成一单
 *     旧单收回 198 + 坏账 2 余额 0   ← 旧单收口
 *
 *   如果子单一直没回到开单水平（比如只还了一部分），
 *   结束时会把它并回父单，避免拆出一堆半截账。
 *
 * ★ 一行流水只属于一单 ★
 *   子单收口后，它的流水从父单里拿走；父单的流水可能因此在时间上
 *   不连续（旧单本金 → 子单流水 → 旧单收回），但金额口径仍然正确：
 *   父单余额 = 父单自己的主方向 - 收回 + 利息 - 坏账。
 *
 * ★ 为什么单独一个文件 ★
 *   api/loan.js 要用它算页面分段，api/loanCleanup.js 要用它找
 *   「删掉的这笔属于哪一单」。loanCleanup 不能反向 import loan.js
 *   （transaction -> loanCleanup，loan -> transaction，会成环），
 *   所以把这段纯算术放在两边都能安全引用的模块里。
 */

import { toDayKey } from '../utils/date.js'
import { isSettlementAdjustmentName } from './txnFilter.js'

/**
 * 借款流水按「录入顺序」比较
 *
 * ★ created_at 在前，occurred_at 在后 ★
 *   结清是按用户点「结清」的动作发生的，顺序必须按录入时间走。
 *   补记到更早业务日期的流水，不能排到旧结清的坏账之前。
 */
export function compareLoanTxnAsc(a, b) {
  const ac = Number(a && a.created_at) || 0
  const bc = Number(b && b.created_at) || 0
  if (ac !== bc) return ac - bc
  const ao = Number(a && a.occurred_at) || 0
  const bo = Number(b && b.occurred_at) || 0
  if (ao !== bo) return ao - bo
  return String((a && a.id) || '').localeCompare(String((b && b.id) || ''))
}

/** 单笔流水对借出 / 借入余额的增量 */
export function loanDeltaOf(t, pair) {
  const amt = Number(t && t.amount_cents) || 0
  if (amt <= 0) return 0
  const p = pair || {}
  const cid = t && t.category_id
  if (cid === p.mainId) return amt
  if (cid === p.backId) return -amt
  if (cid === p.positiveId) return -amt
  if (cid === p.negativeId) return amt
  return 0
}

function dayOf(t) {
  return String((t && t.occurred_day) || '') ||
    (t && t.occurred_at ? toDayKey(new Date(Number(t.occurred_at))) : '')
}

function makeOrder() {
  return { rows: [], net: 0 }
}

function toSegment(order) {
  const rows = order.rows.slice()
  const last = rows.length > 0 ? rows[rows.length - 1] : null
  return {
    settled: order.net === 0,
    txns: rows,
    displayTxns: rows.filter((t) => !isSettlementAdjustmentName(t.category_name)),
    balance: order.net,
    fromDay: rows.length > 0 ? dayOf(rows[0]) : '',
    toDay: rows.length > 0 ? dayOf(last) : '',
    closingDay: order.net === 0 && last ? dayOf(last) : ''
  }
}

/**
 * 把某个人的流水拆成若干「单」
 *
 * @param {Array<object>} txns 该人员的流水（顺序不限）
 * @param {{mainId?:string, backId?:string, positiveId?:string, negativeId?:string}} pair
 * @returns {Array<{settled:boolean, txns:Array<object>, displayTxns:Array<object>,
 *   balance:number, fromDay:string, toDay:string, closingDay:string}>}
 *   输出顺序是「收口顺序」：子单先收口就排在父单前面；
 *   最后最多还剩一个未收口的根单。
 */
export function splitLoanOrders(txns, pair) {
  const src = Array.isArray(txns) ? txns : []
  const p = pair || {}
  if (!p.mainId && !p.backId && !p.positiveId && !p.negativeId) return []

  const list = src.slice().sort(compareLoanTxnAsc)
  const stack = []
  const closed = []

  const currentBalance = () => stack.reduce((n, o) => n + o.net, 0)

  /**
   * 把当前打开的几层单合成一单并收口。
   *
   * 什么时候会走到这里：总余额已经回到 0，但最内层子单自己还没回到
   * 开单水平（典型是一笔收回同时结清父子两单）。这时硬拆没有意义，
   * 合成一单、标记结清，金额口径最稳。
   */
  const closeMergedStack = () => {
    if (stack.length === 0) return
    const rows = []
    let net = 0
    for (const o of stack) {
      rows.push(...o.rows)
      net += o.net
    }
    stack.length = 0
    if (rows.length > 0) {
      closed.push(toSegment({ rows, net }))
    }
  }

  for (const t of list) {
    const delta = loanDeltaOf(t, p)
    // 0 元 / 无关分类不改变余额，也不进任何一单（与旧分段口径一致）
    if (delta === 0) continue

    if (stack.length === 0) stack.push(makeOrder())

    /*
     * 旧单还没平，又开了一笔新本金 -> 在旧单上面开子单。
     * 新单自己后续的收回 / 坏账 / 利息都记在这张子单上；
     * 子单如果一直没收口，收尾时会并回父单，不会拆出半截账。
     */
    if (t.category_id === p.mainId && currentBalance() !== 0) {
      stack.push(makeOrder())
    }

    const top = stack[stack.length - 1]
    top.net += delta
    top.rows.push(t)

    /*
     * 最内层单自己回到 0 -> 这张单独立收口，弹出。
     * 弹完后父单可能也刚好回到 0（子单净额为 0，不影响父单余额），
     * 所以要用 while 继续检查。
     */
    while (stack.length > 0 && stack[stack.length - 1].net === 0) {
      const done = stack.pop()
      if (done.rows.length > 0) closed.push(toSegment(done))
    }

    /*
     * 总余额已经归零，但还有没收回的子单 -> 父子一起合成一单。
     * 不合并的话，下一笔新本金会被加到负余额的子单里，越算越乱。
     */
    if (stack.length > 0 && currentBalance() === 0) {
      closeMergedStack()
    }
  }

  /*
   * 收尾：还有未收口的子单就并回父单。
   * 这些子单没回到开单水平，说明只是父单里的部分还款，
   * 不能单独算一单；但如果并完之后子单自己刚好归零，
   * 说明「子单 + 它下面那些子单」是一张完整的新单，要单独收口。
   */
  while (stack.length > 1) {
    const child = stack.pop()
    if (child.net === 0) {
      if (child.rows.length > 0) closed.push(toSegment(child))
      continue
    }
    const parent = stack[stack.length - 1]
    parent.net += child.net
    parent.rows.push(...child.rows)
  }

  const out = closed.slice()
  const root = stack.length === 1 ? stack[0] : null
  if (root && root.rows.length > 0) {
    out.push(toSegment(root))
  }
  return out
}
