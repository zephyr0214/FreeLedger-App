/**
 * 结算差额流水的统一过滤
 *
 * 六类「结清差额」流水（报销坏账/盈余、借出坏账/利息、借入未还/利息）：
 *   · 必须计入收支与统计
 *   · 不影响账户余额（现金已经由本金/到账/收回/归还记过）
 *   · 在所有流水列表 / 详情里隐藏
 *
 * 这里集中放名单判断和 SQL 片段，避免每个查询各写一遍分类名：
 * 以后分类改名或增减，只改 api/db/schema.js 一处。
 */

import { SETTLEMENT_ADJUSTMENT_CATEGORY_NAMES } from './db/schema.js'

const NAME_SET = new Set(SETTLEMENT_ADJUSTMENT_CATEGORY_NAMES)

/**
 * 这个分类名是不是「结算差额」类
 *
 * @param {string} name category_name
 * @returns {boolean}
 */
export function isSettlementAdjustmentName(name) {
  return NAME_SET.has(String(name || ''))
}

/**
 * 这笔流水是不是「结算差额」类
 *
 * @param {object} txn 至少带 category_name
 * @returns {boolean}
 */
export function isSettlementAdjustmentTxn(txn) {
  return isSettlementAdjustmentName(txn && txn.category_name)
}

/**
 * 生成「排除结算差额流水」的 SQL 条件
 *
 * ★ 为什么用子查询按分类名，而不是按分类 id ★
 *   分类 id 会随备份导入 / 分类重建变化，名字才是稳定语义；
 *   本仓库的借款、报销派生分类都按名字判断（isLoanSettleCategory 等）。
 *
 * ★ 为什么把名字直接拼进 SQL 而不走占位符 ★
 *   这份名单是 schema.js 里的常量，不含用户输入；
 *   拼成常量后调用方不用多传六个参数，列表查询的可读性更高。
 *
 * @param {string} [alias] 表别名，默认 t
 * @returns {string}
 */
export function notSettlementAdjustmentSql(alias = 't') {
  const a = alias || 't'
  const names = SETTLEMENT_ADJUSTMENT_CATEGORY_NAMES
    .map((n) => `'${String(n).replace(/'/g, "''")}'`)
    .join(', ')
  return `(${a}.category_id IS NULL OR ${a}.category_id NOT IN (SELECT id FROM category WHERE name IN (${names})))`
}
