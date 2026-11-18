/**
 * 交易筛选条件 —— 全部交易页与统计页共用
 *
 * ★ 为什么抽成纯函数 ★
 *   两页的筛选面板是同一个组件，但「面板里选了什么」最终要变成
 *   SQL 查询条件。这段转换如果各写一份，很容易出现
 *   「全部交易按账户 + 转入账户过滤、统计页只按转出账户过滤」
 *   这种口径分叉，数字看起来就永远对不上。
 *
 *   buildTxnFilterQuery 只负责「选项对象 -> 查询字段」，
 *   真正的 SQL 仍由 api/transaction.js 的 buildFilterWhere 生成。
 */

import { parseAmountInput } from './money.js'

/** 空筛选条件（所有字段都有稳定类型，避免页面里出现 undefined） */
export function createEmptyTxnFilter() {
  return {
    type: 'all',
    accountId: '',
    categoryIds: [],
    tagIds: [],
    cycleId: '',
    keyword: '',
    minYuan: '',
    maxYuan: ''
  }
}

/** 已生效的筛选条件数量（右上角角标 / 空态文案用） */
export function countActiveFilters(filter) {
  const f = filter || {}
  let n = 0
  if (f.type && f.type !== 'all') n++
  if (f.accountId) n++
  if ((f.categoryIds || []).length > 0) n++
  if ((f.tagIds || []).length > 0) n++
  if (f.cycleId) n++
  if (f.keyword) n++
  if (f.minYuan || f.maxYuan) n++
  return n
}

/**
 * 一级分类展开成「自己 + 所有二级」
 *
 * ★ 为什么一级要把自己也算进去 ★
 *   正常记账不会记在一级上（一级有二级时不可选），但老数据里
 *   可能有直接挂在一级上的流水；多带一个 id 不会多查出错单，
 *   却能保证和旧版两级联动的查询结果逐条一致。
 *
 * ★ 没有二级的一级分类保持原样 ★
 *   展开成空数组会把分类条件整个抹掉，变成「不限分类」—— 灾难性错误。
 */
export function expandCategoryIds(ids, categories) {
  const list = Array.isArray(categories) ? categories : []
  const picked = Array.isArray(ids) ? ids : []
  if (list.length === 0) return picked.filter(Boolean)

  const out = []
  const seen = new Set()
  const push = (id) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push(id)
  }

  for (const id of picked) {
    const cat = list.find((c) => c.id === id)
    if (!cat) continue
    const kids = list.filter((c) => c.parent_id === id)
    if (kids.length === 0) {
      push(id)
      continue
    }
    push(id)
    kids.forEach((k) => push(k.id))
  }
  return out
}

/**
 * 筛选面板选项 -> 查询字段
 *
 * 返回对象可直接展开进 listTransactions / sumTransactions / 统计 range。
 * 分类存的是用户勾的 id，这里才展开成叶子集合。
 */
export function buildTxnFilterQuery(filter, categories) {
  const f = filter || {}
  const q = {}

  if (f.type && f.type !== 'all') q.type = f.type
  if (f.accountId) q.accountId = f.accountId

  const pickedCats = expandCategoryIds(f.categoryIds, categories)
  if (pickedCats.length > 0) q.categoryIds = pickedCats

  if ((f.tagIds || []).length > 0) q.tagIds = f.tagIds.slice()
  if (f.cycleId) q.cycleId = f.cycleId
  if (f.keyword) q.keyword = f.keyword

  const min = parseAmountInput(f.minYuan)
  const max = parseAmountInput(f.maxYuan)
  if (f.minYuan && min) q.minCents = min
  if (f.maxYuan && max) q.maxCents = max

  return q
}
