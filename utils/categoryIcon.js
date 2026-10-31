/**
 * 分类图标配色 —— 记账弹层里的分类选择图标
 *
 * ★ 规则（用户明确要求）★
 *   未选中：**浅浅的灰色**底（不是完全没有底色）
 *   选中：  **浅色**底（分类色 + '22'，与交易流水一致）
 *   图标：  始终是**分类本色**
 *
 * ★ 灰色为什么要用 CSS 变量而不是写死 ★
 *   「浅浅的灰色」在浅色和深色下不是同一个值：
 *     · 浅色模式：#F7F8FA（比卡片白略深一点的灰）
 *     · 深色模式：#2C2C2E（比卡片 #1C1C1E 略亮一点的灰）
 *   写死一个浅灰（比如 #F7F8FA）在深色模式下会变成一块发白的斑，
 *   深色下「选中/未选中」也就分不出来了。
 *   --app-card-2 正好是项目里「比卡片底色高一档的表面」这个语义
 *   （浅色 #F7F8FA / 深色 #2C2C2E），深浅色自动跟着主题走，
 *   不需要在这里判断 isDark。
 *
 * ★ 选中态为什么用「分类色 + 22」而不是写死的浅色 ★
 *   交易流水里的分类图标就是这个浅色底（见 RecentTxnList.iconBgStyle），
 *   用户要求「和交易流水一致」——
 *   所以选中项的底色跟着该分类自己的颜色走，一眼能认出是哪个分类。
 *
 * ★ 图标为什么用分类本色 ★
 *   去掉深色实底之后，图标必须自己有颜色 ——
 *   写死白色在浅色面板上会看不见。
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
 * 未选中时的浅灰底。
 *
 * ★ 走 CSS 变量，深浅色自动适配 ★
 *   浅色模式 --app-card-2 = #F7F8FA，深色模式 = #2C2C2E。
 */
export const UNSELECTED_ICON_BG = 'var(--app-card-2)'

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
 * 图标背景色。
 *
 * @param {object} cat 分类对象
 * @param {string} fallback 兜底色（通常是主题色）
 * @param {boolean} active 是否选中
 * @returns {string} 选中 = '#RRGGBB22'；未选中 = 浅灰 var(--app-card-2)
 */
export function categoryIconBg(cat, fallback = FALLBACK_CATEGORY_COLOR, active = false) {
  if (!active) return UNSELECTED_ICON_BG
  return categoryColor(cat, fallback) + '22'
}

/**
 * 生成图标背景 / 前景的样式对象（可直接展开到 :style）。
 *
 * ★ 分类没设颜色时，底色和图标都用主题色 ★
 *   主题色本身就是 App 的主色，比中性灰更像「这个分类是有归属的」。
 *
 * @param {object} cat 分类对象
 * @param {string} primaryColor 主题色
 * @param {boolean} active 是否选中
 * @returns {{ backgroundColor: string, color: string }}
 */
export function categoryIconStyle(cat, primaryColor, active = false) {
  const fallback = primaryColor || FALLBACK_CATEGORY_COLOR
  return {
    backgroundColor: categoryIconBg(cat, fallback, active),
    color: categoryIconFg(cat, fallback)
  }
}

/**
 * 「分组标题」上那个一级分类图标的样式。
 *
 * ★ 与可选项不同：这里始终带浅色底 ★
 *   分组标题不是可点的选项，它是个「标签」，
 *   用来告诉用户下面这组属于哪个一级分类 ——
 *   所以一直显示分类色的浅色底（和分类管理页的父类图标一致），
 *   不跟着选中态变化。
 *
 * @param {object} cat 一级分类对象
 * @param {string} primaryColor 主题色
 * @returns {{ backgroundColor: string, color: string }}
 */
export function categoryGroupIconStyle(cat, primaryColor) {
  const c = categoryColor(cat, primaryColor || FALLBACK_CATEGORY_COLOR)
  return {
    backgroundColor: c + '22',
    color: c
  }
}
