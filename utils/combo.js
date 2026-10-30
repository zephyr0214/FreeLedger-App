/**
 * 组合账户的扣款顺序解析（纯函数，可单测）
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 组合账户是什么 ★
 *   它不是真实的资金账户，而是一组「按顺序扣款」的真实账户。
 *   用户在日常支付（碰一碰、自动续费）时不想关心到底是哪张卡被扣了，
 *   就选一个组合账户，由这里决定钱从哪一个真实账户出。
 *
 * ★ 核心规则：跳过制 ★
 *   从顺序第一个开始，找**第一个余额足够覆盖整笔金额**的账户，
 *   整笔从它扣除（不做拆分）。
 *   这样一笔消费永远对应一个真实账户，余额记在一处，口径最干净。
 *
 *   ★ 为什么不做拆分 ★
 *     拆分会让一笔 80 元支出变成「60 从 A、20 从 B」两条记录，
 *     笔数统计、预算口径、流水展示全都会歪。
 *     而用户的真实诉求只是「别让我选账户」，不是「必须按余额拆」。
 *
 * ★ 限制（与产品约定一致）★
 *   · 成员不含信用卡（组合账户不支持选择信用卡）
 *   · 成员不含其它组合账户（禁止嵌套）
 *   · 总余额不足的情况按约定不考虑；但为了不崩，仍给一个兜底
 */

/**
 * 计算某个账户可用于支付的余额。
 *
 * ★ 直接取 balance_cents 即可 ★
 *   这个 App 的余额口径是「初始 + 收入 + 转入 − 支出 − 转出」，
 *   balance_cents 就是实时维护的可用余额，不需要再算。
 *
 * ★ 为什么不处理信用卡 ★
 *   按产品约定组合账户不支持信用卡成员，
 *   所以这里不引入「信用额度 + 负余额」那套特殊口径，
 *   保持函数只做一件事。
 *
 * @param {object} account
 * @returns {number} 可用于支付的金额（分）；负数按 0 处理
 */
export function availableCents(account) {
  if (!account) return 0
  const n = Number(account.balance_cents) || 0
  return n > 0 ? n : 0
}

/**
 * 按扣款顺序选出「整笔从哪个账户出」。
 *
 * @param {Array<object>} members
 *   组合成员，**必须已按用户的扣款顺序排好**（由 listComboMembers 保证）。
 *   每项至少需要 { id, balance_cents }。
 * @param {number} amountCents 本次要支付的金额（分，正数）
 * @returns {{
 *   accountId: string,      // 选中的真实账户 id；无可用账户时为 ''
 *   enough: boolean,        // 该账户余额是否真的够（false 表示走了兜底）
 *   available: number,      // 该账户当时可用余额（分）
 *   fallback: boolean,      // 是否因为「没人够」而启用的兜底
 *   reason: string          // 'ok' | 'no-members' | 'fallback-max'
 * }}
 */
export function resolveComboAccount(members, amountCents) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0))
  const list = Array.isArray(members) ? members.filter(Boolean) : []

  // 没有成员：明确失败，调用方应提示用户去编辑组合账户
  if (list.length === 0) {
    return { accountId: '', enough: false, available: 0, fallback: false, reason: 'no-members' }
  }

  // 金额为 0 时不需要挑账户，直接给第一个（调用方通常不会走到这里）
  if (amount === 0) {
    const first = list[0]
    return {
      accountId: first.id,
      enough: true,
      available: availableCents(first),
      fallback: false,
      reason: 'ok'
    }
  }

  // 按顺序找第一个够用的
  for (const m of list) {
    const avail = availableCents(m)
    if (avail >= amount) {
      return { accountId: m.id, enough: true, available: avail, fallback: false, reason: 'ok' }
    }
  }

  /*
   * ★ 兜底：没有任何一个账户能单独覆盖 ★
   *
   * 按产品约定这种情况「不存在」，但代码不能因此抛异常 ——
   * 一旦发生（余额刚被他处改动、用户误判），必须还能记账，
   * 否则整笔交易写不进去，用户会以为 App 坏了。
   *
   * 选择「余额最大的那个」：
   *   它最接近能覆盖，扣完后余额最小但通常仍在合理范围；
   *   比「退回第一个」更不容易出现负数。
   * 同时把 enough 置为 false，让调用方可以提示「该账户余额不足」。
   */
  let best = list[0]
  let bestAvail = availableCents(best)
  for (const m of list) {
    const avail = availableCents(m)
    if (avail > bestAvail) {
      best = m
      bestAvail = avail
    }
  }

  return {
    accountId: best.id,
    enough: false,
    available: bestAvail,
    fallback: true,
    reason: 'fallback-max'
  }
}

/**
 * 判断某个账户类型能否作为组合成员。
 *
 * @param {string} type account.type
 * @returns {boolean}
 */
export function canBeComboMember(type) {
  // 组合不能嵌套；信用卡按产品约定不支持
  return !!type && type !== 'combo' && type !== 'credit'
}
