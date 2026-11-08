/**
 * 报销状态徽标（待报销 / 已报销）
 *
 * ★ 为什么抽成一个文件 ★
 *   这个徽标要出现在四个地方：首页最近流水、全部交易页、
 *   交易详情页、报销管理页。四处各写一份颜色和文案，
 *   改一处就会漏三处 —— 而它表达的是同一个业务状态。
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
