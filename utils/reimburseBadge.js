/**
 * 交易状态徽标（待报销 / 已报销 / 不计收支）
 *
 * ★ 为什么抽成一个文件 ★
 *   这些徽标要出现在四处：首页最近流水、全部交易页、
 *   交易详情页、公共列表组件。四处各写一份颜色和文案，
 *   改一处就会漏三处 —— 而它们表达的是同一批业务状态。
 *
 * ★ 颜色为什么用固定 hex 而不是主题变量 ★
 *   徽标颜色要拼 `color + '22'` 做浅底（和周期/组合账户徽标同一套做法），
 *   而 CSS 变量拼不了字符串。这两个颜色是「语义色」不是「主题色」：
 *   待报销 = 橙色（钱还没回来，等着），已报销 = 绿色（已到账），
 *   深浅色模式下都靠半透明底叠在卡片上，观感一致。
 */

/** 待报销：橙色（等公司打钱） */
export const PENDING_REIMBURSE_COLOR = '#FF8F1F'
/** 已报销：绿色（钱已到账） */
export const DONE_REIMBURSE_COLOR = '#07C160'
/**
 * 不计收支：中性灰（借款 / 待报销 / 报销到账等资金往来）
 *
 * ★ 为什么用灰而不是红/绿 ★
 *   灰表达的是「这笔不算收支」，不是好也不是坏 ——
 *   用红会像亏损、用绿会像收益，都会误导。
 */
export const NOT_COUNTED_COLOR = '#969799'

/**
 * 这笔交易该显示哪个报销徽标。
 *
 * @param {object} txn 交易对象（需含 reimburse_status）
 * @returns {{key:string, name:string, color:string, bg:string, border:string}|null}
 *   不需要显示时返回 null（0 = 不报销，不挂任何徽标）
 */
export function reimburseBadge(txn) {
  if (!txn) return null
  const status = Number(txn.reimburse_status) || 0
  if (status === 1) {
    const c = PENDING_REIMBURSE_COLOR
    return { key: '__reimburse_pending__', name: '待报销', color: c, bg: c + '22', border: c }
  }
  if (status === 2) {
    const c = DONE_REIMBURSE_COLOR
    return { key: '__reimburse_done__', name: '已报销', color: c, bg: c + '22', border: c }
  }
  return null
}

/**
 * 「不计收支」徽标（本轮用户第 7 条）
 *
 * ★ 用户原话 ★
 *   「不计收支也作为 tag 添加到每一笔不计收支的流水/交易记录上」。
 *
 * ★ 为什么单独一个函数、不和报销徽标合并 ★
 *   一笔账可以同时是「待报销」和「不计收支」（待报销必然不计收支），
 *   合并成一个函数就只能二选一。拆开后两个徽标会并排显示，
 *   用户能一眼看出「它为什么没进统计」以及「它在报销流程的哪一步」。
 *
 * ★ 判定只看 exclude_from_stats ★
 *   这是统计层的唯一口径（api/stats.js 的 NOT_EXCLUDED_STATS）。
 *   不要在这里再按分类名二次判断 —— 那会造出第二套口径，
 *   某天两边不一致时用户会看到「标了不计收支，但统计里算进去了」。
 *
 * @param {object} txn 交易对象（需含 exclude_from_stats）
 * @returns {{key:string,name:string,color:string,bg:string,border:string}|null}
 */
export function notCountedBadge(txn) {
  if (!txn || !txn.exclude_from_stats) return null
  const c = NOT_COUNTED_COLOR
  return { key: '__not_counted__', name: '不计收支', color: c, bg: c + '22', border: c }
}
