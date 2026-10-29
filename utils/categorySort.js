/**
 * 分类排序 —— 按最近 30 天使用频率，已选中的排第一
 *
 * 纯函数，不依赖 uni / SQLite，可单测。
 */

/**
 * 排序规则（优先级从高到低）：
 *   1. 已选中的分类永远排第一
 *   2. 最近 30 天用过的，按使用次数降序
 *   3. 没用过的，按默认 sort 升序（保持用户在分类管理里排好的顺序）
 *
 * @param {Array} categories 分类列表 [{id, name, sort, ...}]
 * @param {Object} usageCounts { categoryId: count } 最近 30 天使用次数
 * @param {string} selectedId 当前选中的分类 id
 * @returns {Array} 排好序的新数组（不修改入参）
 */
export function sortCategoriesByUsage(categories, usageCounts = {}, selectedId = '') {
  if (!Array.isArray(categories)) return []

  const counts = usageCounts || {}
  const idx = new Map()
  categories.forEach((c, i) => idx.set(c.id, i))

  return categories
    .map((c, i) => ({
      c,
      i,
      selected: c.id === selectedId ? 1 : 0,
      count: Number(counts[c.id]) || 0
    }))
    .sort((a, b) => {
      // 1. 已选中的排第一
      if (a.selected !== b.selected) return b.selected - a.selected

      // 2. 用过的按次数降序
      const aUsed = a.count > 0
      const bUsed = b.count > 0
      if (aUsed !== bUsed) return aUsed ? -1 : 1
      if (a.count !== b.count) return b.count - a.count

      // 3. 都没用过（或次数相同）→ 按用户设定的 sort 升序
      const aSort = Number.isFinite(a.c.sort) ? a.c.sort : 0
      const bSort = Number.isFinite(b.c.sort) ? b.c.sort : 0
      if (aSort !== bSort) return aSort - bSort

      // 最后用原始下标兜底，保证顺序稳定
      return a.i - b.i
    })
    .map((x) => x.c)
}

/**
 * 判断一个分类是否「可直接选」。
 *
 * ★ 收入分类不显示的根本原因 ★
 *   默认收入分类（工资/奖金补贴/…）都是「一级分类且没有二级」，
 *   而分类列表之前只保留 `!isParent`（即二级）。结果收入分类全部被过滤掉，
 *   选收入时一片空白。
 *
 * 规则：
 *   - 有 parent_id（是二级）→ 永远可选
 *   - 没有 parent_id（是一级）→ 仅当它下面没有任何二级时才可选
 *     （否则选它没意义，应该去选它的二级）
 *
 * @param {object} cat 分类对象（含 isParent / parent_id / id）
 * @param {Array}  all 当前类型下的全部分类
 * @returns {boolean}
 */
export function isSelectableCategory(cat, all) {
  if (!cat) return false
  if (!cat.isParent) return true
  // 一级分类：仅当它下面没有任何二级时才可选
  return !all.some((c) => c.parent_id === cat.id)
}
