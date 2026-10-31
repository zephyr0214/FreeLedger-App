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

/**
 * 把可选分类按「一级分类」分组。
 *
 * ★ 为什么要分组 ★
 *   「更多分类」面板以前是一张平铺的网格，一二十个分类混在一起，
 *   用户根本分不清「正餐」属于餐饮、「学费」属于学校学习。
 *   改成按一级分类分组后，一眼就能看出层级关系。
 *
 * ★ 分组规则 ★
 *   1. 二级分类 → 归到它的一级分类下面
 *   2. 「没有二级」的一级分类（如收入的「工资」）→ 自己就是一组
 *   3. 找不到父级（父级被隐藏/删掉）→ 自己独立成组，避免被丢掉
 *
 * ★ 组的顺序 ★
 *   按 members 在传入列表里的**首次出现位置**排序
 *   （members 本身已按使用频率排好序，见 sortCategoriesByUsage）。
 *   所以「最近最常用的那个分类」所在的组一定排在最前面，
 *   和面板顶部那两行直接显示的分类是同一套排序逻辑。
 *
 * @param {Array} selectable  可选分类（已排序）[{id, name, parent_id, ...}]
 * @param {Array} all         当前类型下的全部分类（用来找一级分类）
 * @returns {Array} [{ parent, members }] —— parent 是一级分类对象，
 *            members 是该组下的可选分类
 */
export function groupCategoriesByParent(selectable, all = []) {
  if (!Array.isArray(selectable) || selectable.length === 0) return []

  const list = Array.isArray(all) ? all : []
  const parentMap = new Map()

  /** 找到某分类的一级分类对象（找不到就是 null） */
  function findParent(cat) {
    if (!cat || !cat.parent_id) return null
    if (parentMap.has(cat.parent_id)) return parentMap.get(cat.parent_id)
    const p = list.find((c) => c.id === cat.parent_id) || null
    parentMap.set(cat.parent_id, p)
    return p
  }

  const groups = []
  /** id -> group，用于把同一父级下的二级分类归到一起 */
  const groupByParentId = new Map()

  for (const cat of selectable) {
    if (!cat) continue

    // 一级分类（自己就是组）
    if (!cat.parent_id) {
      groups.push({ parent: cat, members: [cat] })
      continue
    }

    const parent = findParent(cat)
    if (!parent) {
      // 父级不在当前可见列表里（被隐藏或删掉了）→ 自己独立成组
      groups.push({ parent: cat, members: [cat] })
      continue
    }

    let group = groupByParentId.get(parent.id)
    if (!group) {
      group = { parent, members: [] }
      groupByParentId.set(parent.id, group)
      groups.push(group)
    }
    group.members.push(cat)
  }

  return groups
}
