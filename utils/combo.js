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
 *   · 成员不含其它组合账户（禁止嵌套）
 *   · 信用卡 / 网络借贷**可以**当成员（用户明确要求）：
 *     它们余额通常是负的，availableCents() 返回 0，
 *     所以扣款时会自然被跳过，轮到后面的储蓄卡 ——
 *     这正是用户想要的「先刷信用卡，不够再走储蓄卡」的语义。
 *   · 总余额不足的情况按约定不考虑；但为了不崩，仍给一个兜底
 */

/**
 * 计算某个账户可用于支付的余额。
 *
 * ★ 直接取 balance_cents 即可 ★
 *   这个 App 的余额口径是「初始 + 收入 + 转入 − 支出 − 转出」，
 *   balance_cents 就是实时维护的可用余额，不需要再算。
 *
 * ★ 欠钱类账户（信用卡 / 网络借贷）恒为「够用」★
 *   它们的余额是负数（欠款），但**余额为负恰恰证明它还能刷** ——
 *   花的时候余额继续往下走，欠款变大，账本语义是自洽的。
 *   早先把它们排除在组合之外，就是因为这里算不出「可用额度」：
 *   信用额度字段已经随「信用额度/账单日/还款日/卡尾号」一起删了，
 *   没有上限可以比对。
 *
 *   现在用户的诉求是「组合里也能放信用卡」（先刷信用卡、不够再走储蓄卡），
 *   所以给出一个「上限无穷」的取值：用 MAX_SAFE_INTEGER 而不是 Infinity，
 *   它会出现在 pick.available 里一路传下去，Infinity 序列化成 JSON 会变成 null。
 *
 *   ★ 这是本轮唯一的语义取舍 ★
 *     不校验信用额度（没有额度数据可校验），超额由用户自己掌握 ——
 *     比「算不出可用额度就干脆不让用」更符合信用卡的直觉。
 *
 * @param {object} account
 * @returns {number} 可用于支付的金额（分）；普通账户负数按 0 处理
 */
export function availableCents(account) {
  if (!account) return 0
  if (account.isCredit) return Number.MAX_SAFE_INTEGER
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
 * 语义是「能不能从这个账户扣款」：
 *   · 组合不能嵌套
 *   · 信用卡 / 网络借贷**可以**（用户明确要求）：
 *     它们的可用额度算作无限，排在前就会先刷它们，排在最后就是兜底。
 * 所以现在只拦组合，剩下的类型全部放行 —— 加新类型时自动可用。
 * （api/account.js 那边等价逻辑也是只拦 isComboType()；
 *  这个函数目前没有调用方，保持简单即可。）
 *
 * @param {string} type account.type
 * @returns {boolean}
 */
export function canBeComboMember(type) {
  return !!type && type !== 'combo'
}
