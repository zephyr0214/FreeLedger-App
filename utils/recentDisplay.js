/**
 * 首页「最近收支」的显示规则 —— 纯函数，可单测
 *
 *   node scripts/test-recent-display.mjs
 *
 * ★ 用户定的规则 ★
 *   当日记录 < 5 条  -> 显示最近 5 条（可跨天）
 *   当日记录 >= 5 条 -> 显示**全部**当日记录
 *
 * ★ 为什么必须抽成纯函数 ★
 *   这条规则是「首页看起来对不对」的唯一判断依据，
 *   埋在 .vue 的 computed 里只能靠肉眼看。
 *   抽出来之后边界条件（恰好 4 条 / 恰好 5 条 / 0 条）都能钉死。
 */

/** 切换阈值：当日条数达到这个数就改为显示全部当日 */
export const RECENT_FULL_DAY_THRESHOLD = 5

/** 当日不足阈值时，显示最近几条 */
export const RECENT_FALLBACK_COUNT = 5

/**
 * 计算首页「最近收支」应该显示哪些流水
 *
 * @param {object} input
 * @param {Array} input.todayAll 今天的**全部**流水（不限条数）
 * @param {Array} input.recentList 最近 N 条流水（通常是 5 条，可能跨天）
 * @returns {Array} 要显示的流水列表
 */
export function pickRecentDisplayList(input) {
  /*
   * ★ 不能在参数里解构 ★
   *   `function f({ a = [] } = {})` 的默认值只对 undefined 生效，
   *   传 null 会直接抛 "Cannot read properties of null"。
   *   这个函数被首页 computed 调用，一条坏数据就能白屏 ——
   *   所以在函数体里做规范化。
   */
  const src = input || {}
  const today = Array.isArray(src.todayAll) ? src.todayAll : []
  const recent = Array.isArray(src.recentList) ? src.recentList : []

  // 当日够多 -> 全显示当日（连跨天都不需要，因为只显示今天）
  if (today.length >= RECENT_FULL_DAY_THRESHOLD) return today

  /*
   * 当日不足 5 条 -> 显示最近 5 条。
   *
   * ★ 为什么要截断 recentList ★
   *   调用方传进来的可能多于 5 条（比如 -1 表示不限）。
   *   规则写的是「最近 5 条」，所以这里兜底截断，
   *   不依赖调用方一定传对。
   */
  return recent.slice(0, RECENT_FALLBACK_COUNT)
}

/**
 * 当前是否处于「显示全部当日」模式
 * （模板用它决定要不要标注范围，如「今日全部」）
 */
export function isShowingAllToday(todayAll = []) {
  return (Array.isArray(todayAll) ? todayAll.length : 0) >= RECENT_FULL_DAY_THRESHOLD
}
