/**
 * 分类图标配色 —— 记账弹层里的分类选择图标
 *
 * ★ 规则（用户明确要求）★
 *   未选中：**浅浅的灰色**底（不是完全没有底色）
 *   选中：  **分类色半透明**底（浅色 +22 / 深色 +4D，与交易流水一致）
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
 * ★ 选中态为什么用「分类色 + 透明度」而不是写死的浅色 ★
 *   交易流水里的分类图标就是这个浅色底（见 TxnIcon），
 *   用户要求「和交易流水一致」——
 *   所以选中项的底色跟着该分类自己的颜色走，一眼能认出是哪个分类。
 *
 * ★ 暗色模式要加深（用户反馈「分类底色不明显」）★
 *   '#RRGGBB22' 只有约 13% 不透明度。浅色模式下叠在白卡片上还能看见，
 *   深色模式下叠在 #1C1C1E 上几乎和背景融成一片。
 *   所以暗色模式统一提高到 30%（'4D'）。所有分类底色都必须走
 *   categoryTint()，不要在各页面自己拼 '22'，否则深浅色会不一致。
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

/** 分类色的浅底透明度：浅色 13%（和旧版一致） / 深色 30%（否则看不出来） */
export const CATEGORY_TINT_ALPHA_LIGHT = '22'
export const CATEGORY_TINT_ALPHA_DARK = '4D'

/**
 * 分类色 -> 带透明度的浅底色。
 *
 * ★ 所有分类图标底色都走这里 ★
 *   浅色模式 #RRGGBB22；深色模式 #RRGGBB4D。
 *   传进来的颜色必须是 #RRGGBB（分类色 / 主题色都是这个格式）；
 *   空值或非法值退回中性灰，避免拼出 '#undefined22'。
 *
 * @param {string} color #RRGGBB
 * @param {boolean} isDark 当前是否深色模式
 * @returns {string} #RRGGBBAA
 */
export function categoryTint(color, isDark = false) {
  const raw = String(color || '').trim()
  const base = /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : FALLBACK_CATEGORY_COLOR
  return base + (isDark ? CATEGORY_TINT_ALPHA_DARK : CATEGORY_TINT_ALPHA_LIGHT)
}

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
 * @param {boolean} isDark 是否深色模式（暗色下加深底色）
 * @returns {string} 选中 = '#RRGGBB22'（深色 '#RRGGBB4D'）；未选中 = 浅灰 var(--app-card-2)
 */
export function categoryIconBg(cat, fallback = FALLBACK_CATEGORY_COLOR, active = false, isDark = false) {
  if (!active) return UNSELECTED_ICON_BG
  return categoryTint(categoryColor(cat, fallback), isDark)
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
 * @param {boolean} isDark 是否深色模式
 * @returns {{ backgroundColor: string, color: string }}
 */
export function categoryIconStyle(cat, primaryColor, active = false, isDark = false) {
  const fallback = primaryColor || FALLBACK_CATEGORY_COLOR
  return {
    backgroundColor: categoryIconBg(cat, fallback, active, isDark),
    color: categoryIconFg(cat, fallback)
  }
}

/**
 * 选中态的「圈圈」—— 图标外面那一圈主题色描边。
 *
 * ★ 为什么只靠底色不够 ★
 *   选中态原来是「分类色 + 22」的浅底（约 13% 不透明度），
 *   未选中是 --app-card-2 的浅灰底 ——
 *   两者在浅色主题下明度非常接近，扫一眼分不出哪个被选中了。
 *   加一圈 3rpx 的主题色描边之后，选中项在任何底色上都能一眼认出来。
 *
 * ★ 为什么用主题色而不是分类色 ★
 *   分类色五花八门（有橙有蓝有灰），灰色分类（「其他/杂项」#969799）
 *   的描边在浅底上几乎看不见。主题色是用户自己选的主色，
 *   对比度有保证，而且「选中 = 主题色」本身就是全 App 的语义。
 *
 * ★ 未选中时必须是 transparent 而不是 '' ★
 *   写成空串等于没有 border 声明，图标尺寸会变化（选中项被撑大 6rpx），
 *   一排分类会跟着抖动。transparent 占住位置，尺寸恒定。
 *
 * @param {boolean} active 是否选中
 * @param {string} primaryColor 主题色
 * @returns {{ border: string }}
 */
export function categoryRingStyle(active, primaryColor) {
  return {
    border: `3rpx solid ${active ? (primaryColor || FALLBACK_CATEGORY_COLOR) : 'transparent'}`
  }
}

/**
 * 分类图标的完整样式（底色 + 前景色 + 选中圈）。
 *
 * 三个弹层（记账面板 / 周期面板 / 更多分类面板）都用它，
 * 保证三处的选中观感完全一致。
 *
 * @param {object} cat 分类对象
 * @param {string} primaryColor 主题色
 * @param {boolean} active 是否选中
 * @param {boolean} isDark 是否深色模式
 * @returns {{ backgroundColor: string, color: string, border: string }}
 */
export function categoryIconFullStyle(cat, primaryColor, active = false, isDark = false) {
  return {
    ...categoryIconStyle(cat, primaryColor, active, isDark),
    ...categoryRingStyle(active, primaryColor)
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
 * @param {boolean} isDark 是否深色模式
 * @returns {{ backgroundColor: string, color: string }}
 */
export function categoryGroupIconStyle(cat, primaryColor, isDark = false) {
  const c = categoryColor(cat, primaryColor || FALLBACK_CATEGORY_COLOR)
  return {
    backgroundColor: categoryTint(c, isDark),
    color: c
  }
}
