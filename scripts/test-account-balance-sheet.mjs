/**
 * 余额修改弹层两种口径的测试
 *
 *   node scripts/test-account-balance-sheet.mjs
 *
 * ★ 背景 ★
 *   用户要求「更改账户余额时不要直接改」，改成弹层，
 *   下方提供单选：
 *     · 计入对账收支（默认）—— 差额记一笔「对账支出 / 对账收入」流水
 *     · 修改当前余额        —— 直接改期初余额，不产生任何流水
 *
 * ★ 为什么两种口径都要严格验算 ★
 *   余额是 App 最核心的数字。两种口径最终都必须落到同一个结果：
 *     改完之后，权威余额公式算出来的值 == 用户填的目标值。
 *   如果某种口径算错，用户会看到「我明明填了 800，列表里还是 1000」。
 *
 * 余额公式（与 api/account.js 的 recalcBalance 完全一致）：
 *   balance = initial - Σ(expense + transfer 转出) + Σ(income + transfer 转入)
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
 * 权威余额（与 recalcBalance 同一套算法）
 *
 * @param {{initial:number, txns:Array}} ledger
 * @param {string} accountId
 * @returns {number} 分
 */
function balanceOf(ledger, accountId) {
  let balance = ledger.initial
  for (const t of ledger.txns) {
    if (t.deleted_at) continue
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

/** 汇总某账户的「流出 / 流入」（与 recalcBalance 的两条 SQL 同口径） */
function sumsOf(ledger, accountId) {
  let outSum = 0
  let inSum = 0
  for (const t of ledger.txns) {
    if (t.deleted_at) continue
    if (t.account_id === accountId && (t.type === 'expense' || t.type === 'transfer')) {
      outSum += t.amount_cents
    }
    if (t.type === 'income' && t.account_id === accountId) inSum += t.amount_cents
    if (t.type === 'transfer' && t.to_account_id === accountId) inSum += t.amount_cents
  }
  return { outSum, inSum }
}

/**
 * 口径一：计入对账收支
 * 与 api/account.js 的 adjustAccountBalance() 同逻辑。
 *
 * @returns {object|null} 生成的对账流水；差额为 0 时返回 null
 */
function applyReconcile(ledger, accountId, targetCents) {
  const current = balanceOf(ledger, accountId)
  const delta = targetCents - current
  if (delta === 0) return null

  const type = delta > 0 ? 'income' : 'expense'
  const txn = {
    type,
    amount_cents: Math.abs(delta),
    account_id: accountId,
    category: type === 'income' ? '对账收入' : '对账支出'
  }
  ledger.txns.push(txn)
  return txn
}

/**
 * 口径二：修改当前余额（直接改期初，不产生流水）
 * 与 api/account.js 的 setAccountBalanceDirect() 同逻辑。
 *
 *   initial = target + Σ流出 - Σ流入
 *
 * @returns {{changed:boolean, delta:number}}
 */
function applyDirect(ledger, accountId, targetCents) {
  const current = balanceOf(ledger, accountId)
  const delta = targetCents - current
  if (delta === 0) return { changed: false, delta: 0 }

  const { outSum, inSum } = sumsOf(ledger, accountId)
  ledger.initial = targetCents + outSum - inSum
  return { changed: true, delta }
}

/* ------------------------------------------------------ 口径一：对账收支 */

console.log('=== 口径一：计入对账收支（默认）===')

{
  // 期初 1000，没有任何流水，当前 1000 -> 改到 800
  const ledger = { initial: 100000, txns: [] }
  const txn = applyReconcile(ledger, 'a1', 80000)

  check('生成了一笔对账流水', !!txn, true)
  check('方向：余额变小 -> 支出', txn.type, 'expense')
  check('金额 = 差额', txn.amount_cents, 20000)
  check('分类是对账支出', txn.category, '对账支出')
  check('改完余额 == 目标', balanceOf(ledger, 'a1'), 80000)
  check('期初余额没被动过', ledger.initial, 100000)
}

{
  const ledger = { initial: 100000, txns: [] }
  const txn = applyReconcile(ledger, 'a1', 120000)

  check('余额变大 -> 收入', txn.type, 'income')
  check('分类是对账收入', txn.category, '对账收入')
  check('改完余额 == 目标', balanceOf(ledger, 'a1'), 120000)
}

console.log('=== 口径二：修改当前余额（不动流水）===')

{
  // 期初 1000，没有流水，当前 1000 -> 改到 800
  const ledger = { initial: 100000, txns: [] }
  const res = applyDirect(ledger, 'a1', 80000)

  check('标记为已变更', res.changed, true)
  check('差额是 -200', res.delta, -20000)
  check('没有生成任何流水', ledger.txns.length, 0)
  check('期初被改成 800', ledger.initial, 80000)
  check('改完余额 == 目标', balanceOf(ledger, 'a1'), 80000)
}

{
  // 有流水时：期初 1000，支出 300、收入 500 -> 当前 1200，改到 1000
  const ledger = {
    initial: 100000,
    txns: [
      { type: 'expense', amount_cents: 30000, account_id: 'a1' },
      { type: 'income', amount_cents: 50000, account_id: 'a1' }
    ]
  }
  check('改之前的余额', balanceOf(ledger, 'a1'), 120000)

  applyDirect(ledger, 'a1', 100000)

  check('改完余额 == 目标', balanceOf(ledger, 'a1'), 100000)
  check('流水条数没变（不新增流水）', ledger.txns.length, 2)
}

{
  // 含转账：期初 1000，支出 200、转出 300、转入 100 -> 当前 600，改到 800
  const ledger = {
    initial: 100000,
    txns: [
      { type: 'expense', amount_cents: 20000, account_id: 'a1' },
      { type: 'transfer', amount_cents: 30000, account_id: 'a1' },
      { type: 'transfer', amount_cents: 10000, to_account_id: 'a1' }
    ]
  }
  check('含转账的当前余额', balanceOf(ledger, 'a1'), 60000)

  // 流出 200+300=500，流入 100 -> initial = 800 + 500 - 100 = 1200
  applyDirect(ledger, 'a1', 80000)

  check('含转账改完余额 == 目标', balanceOf(ledger, 'a1'), 80000)
  check('含转账时期初反推正确', ledger.initial, 120000)
  check('含转账时也没新增流水', ledger.txns.length, 3)
}

console.log('=== 两种口径：目标值一致时结果必须一样 ===')

{
  const scenarios = [
    { initial: 100000, txns: [], target: 80000 },
    // 有流水、且目标 ≠ 当前（当前 = 100000 - 30000 = 70000，目标 50000）
    { initial: 100000, txns: [{ type: 'expense', amount_cents: 30000, account_id: 'a1' }], target: 50000 },
    {
      initial: 0,
      txns: [
        { type: 'expense', amount_cents: 50000, account_id: 'a1' },
        { type: 'income', amount_cents: 20000, account_id: 'a1' }
      ],
      target: -10000   // 信用卡欠款
    },
    {
      initial: 100000,
      txns: [
        { type: 'transfer', amount_cents: 40000, account_id: 'a1' },
        { type: 'transfer', amount_cents: 15000, to_account_id: 'a1' }
      ],
      target: 250000
    }
  ]

  for (const s of scenarios) {
    const a = { initial: s.initial, txns: s.txns.map((t) => ({ ...t })) }
    const b = { initial: s.initial, txns: s.txns.map((t) => ({ ...t })) }

    applyReconcile(a, 'a1', s.target)
    applyDirect(b, 'a1', s.target)

    check(
      `目标 ${s.target}：两种口径的最终余额一致`,
      balanceOf(a, 'a1'),
      balanceOf(b, 'a1')
    )
    check(`目标 ${s.target}：都等于目标值`, balanceOf(a, 'a1'), s.target)
    // 口径一多一条流水，口径二一条不多
    check(`目标 ${s.target}：对账口径多了一条流水`, a.txns.length, s.txns.length + 1)
    check(`目标 ${s.target}：直接改口径不增加流水`, b.txns.length, s.txns.length)
  }
}

console.log('=== 目标值等于当前余额：两边都不该动 ===')

{
  const a = { initial: 100000, txns: [] }
  const r1 = applyReconcile(a, 'a1', 100000)
  check('对账口径：不生成流水', r1, null)
  check('对账口径：余额不变', balanceOf(a, 'a1'), 100000)

  const b = { initial: 100000, txns: [] }
  const r2 = applyDirect(b, 'a1', 100000)
  check('直接改口径：changed = false', r2.changed, false)
  check('直接改口径：差额 0', r2.delta, 0)
  check('直接改口径：期初不变', b.initial, 100000)
}

console.log('=== 负余额（信用卡欠款）也能改 ===')

{
  // 信用卡：期初 0，消费 500 -> 当前 -500，改到 -800（欠得更多）
  const ledger = {
    initial: 0,
    txns: [{ type: 'expense', amount_cents: 50000, account_id: 'a1' }]
  }
  check('当前是负余额', balanceOf(ledger, 'a1'), -50000)

  applyDirect(ledger, 'a1', -80000)
  check('改完余额 == 目标', balanceOf(ledger, 'a1'), -80000)
  check('没有新增流水', ledger.txns.length, 1)

  // 再把它还清到 0
  applyDirect(ledger, 'a1', 0)
  check('还清后余额是 0', balanceOf(ledger, 'a1'), 0)
}

console.log('=== 已删除的流水不参与计算 ===')

{
  // 一笔已软删的支出不该影响反推出来的期初
  const ledger = {
    initial: 100000,
    txns: [
      { type: 'expense', amount_cents: 30000, account_id: 'a1' },
      { type: 'expense', amount_cents: 20000, account_id: 'a1', deleted_at: Date.now() }
    ]
  }
  check('软删的流水不计入余额', balanceOf(ledger, 'a1'), 70000)

  applyDirect(ledger, 'a1', 100000)
  check('反推时也排除了软删流水', balanceOf(ledger, 'a1'), 100000)
  // initial = 100000 + 30000(只有活着的那笔) - 0 = 130000
  check('期初反推只算活着的流水', ledger.initial, 130000)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
