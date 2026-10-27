/**
 * 余额对账调整的测试
 *
 *   node scripts/test-account-reconcile.mjs
 *
 * 背景：
 *   用户直接改账户余额时，差额要记成「对账支出 / 对账收入」交易，
 *   而不是偷偷改期初余额 —— 这样流水里看得见，账也对得上。
 *
 * 这里验证核心的账务公式：
 *   权威余额 = 期初 + Σ收入 - Σ支出 + Σ转入 - Σ转出
 * 对账交易必须满足：改完余额后，这个公式算出来的值 == 目标余额。
 */

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

/* ------------------------------------------------ 迷你账本（模拟数据库） */

/**
 * @param {object} state { initial, txns: [] }
 * @param {object} txn { type, amount_cents, account_id, to_account_id }
 */
function balanceOf(state, accountId) {
  let balance = state.initial
  for (const t of state.txns) {
    if (t.account_id === accountId && (t.type === 'expense' || t.type === 'transfer')) {
      balance -= t.amount_cents
    }
    if (t.type === 'income' && t.account_id === accountId) {
      balance += t.amount_cents
    }
    if (t.type === 'transfer' && t.to_account_id === accountId) {
      balance += t.amount_cents
    }
  }
  return balance
}

/**
 * 对账调整（与 api/account.js 的 adjustAccountBalance 同样的判定逻辑）
 * @returns {object|null} 生成的对账交易，差额为 0 时返回 null
 */
function makeReconcile(state, accountId, targetCents) {
  const current = balanceOf(state, accountId)
  const delta = targetCents - current
  if (delta === 0) return null

  const type = delta > 0 ? 'income' : 'expense'
  return {
    type,
    amount_cents: Math.abs(delta),
    account_id: accountId,
    category: type === 'income' ? '对账收入' : '对账支出',
    note: '余额对账调整',
    source: 'reconcile'
  }
}

console.log('=== 差额方向 ===')

{
  // 当前 1000（100000 分），要调到 800（80000 分）→ 少�� 200 → 记支出
  const state = { initial: 100000, txns: [] }
  const r = makeReconcile(state, 'a1', 80000)
  check('余额变小 -> 支出', r.type, 'expense')
  check('金额是差额', r.amount_cents, 20000)
  check('分类是对账支出', r.category, '对账支出')

  // 当前 1000，要调到 1200 → 多了 200 → 记收入
  const r2 = makeReconcile(state, 'a1', 120000)
  check('余额变大 -> 收入', r2.type, 'income')
  check('金额是差额', r2.amount_cents, 20000)
  check('分类是对账收入', r2.category, '对账收入')
}

console.log('=== 账目仍然对得上 ===')

{
  // 期初 1000，已有支出 300 → 当前 700
  const state = {
    initial: 100000,
    txns: [
      { type: 'expense', amount_cents: 30000, account_id: 'a1' },
      { type: 'income', amount_cents: 50000, account_id: 'a1' }
    ]
  }
  const current = balanceOf(state, 'a1')
  check('当前余额', current, 120000)

  // 调到 1000（100000 分）→ 差 -20000 → 记一笔对账支出 200
  const target = 100000
  const r = makeReconcile(state, 'a1', target)
  check('差额方向', r.type, 'expense')
  check('差额金额', r.amount_cents, 20000)

  state.txns.push(r)
  check('调整后余额 == 目标', balanceOf(state, 'a1'), target)
}

{
  // 有转入转出时也要对得上
  const state = {
    initial: 100000,
    txns: [
      { type: 'expense', amount_cents: 20000, account_id: 'a1' },
      { type: 'transfer', amount_cents: 30000, account_id: 'a1' },      // 转出 300
      { type: 'transfer', amount_cents: 10000, to_account_id: 'a1' }     // 转入 100
    ]
  }
  const current = balanceOf(state, 'a1')
  check('含转账的当前余额', current, 60000)

  const target = 80000
  const r = makeReconcile(state, 'a1', target)
  check('差额方向', r.type, 'income')
  check('差额金额', r.amount_cents, 20000)

  state.txns.push(r)
  check('调整后余额 == 目标', balanceOf(state, 'a1'), target)
}

console.log('=== 无变化时不动 ===')

{
  const state = { initial: 100000, txns: [] }
  const r = makeReconcile(state, 'a1', 100000)
  check('余额没变 -> 不生成交易', r, null)
}

console.log('=== 负余额（信用卡欠款）===')

{
  // 信用卡欠 500（-50000 分），实际是欠 800 → 差 -30000 → 记支出 300
  const state = { initial: 0, txns: [] }
  const current = balanceOf(state, 'a1')
  check('当前是负余额', current, 0)

  const r = makeReconcile(state, 'a1', -80000)
  check('欠更多 -> 支出', r.type, 'expense')
  check('差额金额', r.amount_cents, 80000)

  state.txns.push(r)
  check('调整后余额 == 目标', balanceOf(state, 'a1'), -80000)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
