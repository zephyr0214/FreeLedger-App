/**
 * 分类图标配色 —— 与交易流水保持一致
 *
 * ★ 为什么抽出来 ★
 *   「交易流水」里的分类图标是「浅色底 + 本色图标」：
 *     · 底色 = 分类色 + '22'（约 13% 透明度）
 *     · 图标 = 分类本色
 *   而记账弹层（TxnPanel / CyclePanel）里的分类图标却是「深色实底 + 白色图标」，
 *   选中时更是一整块分类色实底 —— 同一个分类在两处观感完全不同。
 *   这里把流水那套规则抽成纯函数，两边共用，以后改配色只动这一个文件。
 *
 * ★ 纯函数，不依赖 uni / Vue，可单测 ★
 */

/**
 * 分类色的兜底值。
 *
 * 与交易流水（api/transaction.js 里 COALESCE 的默认色）保持一致。
 */
export const FALLBACK_CATEGORY_COLOR = '#969799'

/**
 * 取一个分类的有效颜色。
 *
 * @param {object} cat 分类对象（可能没有 color 字段）
 * @param {string} fallback 兜底色（通常是主题色）
 * @returns {string} #RRGGBB
 */
export function categoryColor(cat, fallback = FALLBACK_CATEGORY_COLOR) {
  if (!cat) return fallback
  return cat.color || fallback
}

/**
 * 图标背景色 —— 分类色 + '22'（浅色底）。
 *
 * ★ 为什么用「色值 + 22」而不是不透明的浅色 ★
 *   半透明底能跟着分类色走，深浅色模式下都成立；
 *   流水那边一直就是这么做的（见 RecentTxnList.iconBgStyle），
 *   两边共用同一个函数，观感自然一致。
 *
 * @param {object} cat 分类对象
 * @param {string} fallback 兜底色（通常是主题色）
 * @returns {string} 形如 '#RRGGBB22'
 */
export function categoryIconBg(cat, fallback = FALLBACK_CATEGORY_COLOR) {
  return categoryColor(cat, fallback) + '22'
}

/**
 * 图标前景色 —— 分类本色。
 *
 * @param {object} cat 分类对象
 * @param {string} fallback 兜底色（通常是主题色）
 * @returns {string} 形如 '#RRGGBB'
 */
export function categoryIconFg(cat, fallback = FALLBACK_CATEGORY_COLOR) {
  return categoryColor(cat, fallback)
}

/**
 * 生成图标背景 / 前景的样式对象（可直接展开到 :style）。
 *
 * ★ 分类没设颜色时，底色和图标都用主题色 ★
 *   主题色本身就是 App 的主色，比中性灰更像「这个分类是有归属的」。
 *
 * ★ 选中态用一圈同色描边表示 ★
 *   底色改成浅色之后，原先「实心深底」带来的选中感就没了，
 *   所以补一圈分类色的描边把选中项标出来。
 *   描边宽度固定 2rpx（不选的项用 transparent 占位），
 *   这样选中/不选中之间不会产生位置跳动。
 *
 * @param {object} cat 分类对象
 * @param {string} primaryColor 主题色
 * @param {boolean} active 是否选中
 * @returns {{ backgroundColor: string, color: string, borderColor: string }}
 */
export function categoryIconStyle(cat, primaryColor, active = false) {
  const c = categoryColor(cat, primaryColor || FALLBACK_CATEGORY_COLOR)
  return {
    backgroundColor: c + '22',
    color: c,
    borderColor: active ? c : 'transparent'
  }
}
