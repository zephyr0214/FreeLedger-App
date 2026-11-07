/**
 * 预算服务 —— 月预算 + 子预算（v18 起）
 *
 * ★ 两级结构 ★
 *   月预算（scope='total'）：每月总支出上限，全局只有一条。
 *   子预算（scope='category'）：从月预算里**分配**出去的额度，可以有多条。
 *     一个子预算可以挂**多个类别**（budget_category 关联表），
 *     名字由用户自定（budget.name，不填时按类别名自动拼）。
 *
 * ★ 为什么子预算要能挂多个类别 ★
 *   用户原话：「同一个子预算支持选择多个类别」。
 *   现实里「吃饭」常常横跨餐饮/外卖，「周末开销」横跨娱乐/购物 ——
 *   一个类别一条预算的话，用户得自己拿计算器加总才看得懂。
 *
 * ★ 一个类别只能属于一条子预算 ★
 *   否则同一笔支出会被两条子预算各算一次，「已用」凭空翻倍。
 *   保存时把选中的类别从别的子预算上摘掉（见 detachCategories），
 *   摘空的子预算直接删掉 —— 它已经没有统计口径了，留着只会显示成
 *   「已删除分类」并把用户搞糊涂。
 */

import { query, queryOne, execute, transaction } from './db/index.js'
import { prefixedId } from '../utils/id.js'
import { toMonthKey } from '../utils/date.js'

const SCOPE_TOTAL = 'total'
const SCOPE_CATEGORY = 'category'

/* ------------------------------------------------------------ 查询 */

export async function listBudgets() {
  const rows = await query('SELECT * FROM budget ORDER BY scope ASC, category_id ASC, created_at ASC')
  return attachCategories(rows.map(normalizeBudget))
}

async function getBudget(id) {
  const row = await queryOne('SELECT * FROM budget WHERE id = ?', [id])
  if (!row) return null
  const list = await attachCategories([normalizeBudget(row)])
  return list[0] || null
}

function normalizeBudget(row) {
  return {
    ...row,
    amount_cents: Number(row.amount_cents) || 0,
    rollover: Number(row.rollover) === 1,
    name: row.name || '',
    // 子预算挂的类别 id 列表（v18 之前是单列 category_id，这里统一成数组）
    categoryIds: []
  }
}

/**
 * 给一批预算补上 categoryIds。
 *
 * ★ 老数据兜底 ★
 *   关联表里没有记录、但 category_id 单列有值的（v17 及更早的数据），
 *   当成「只挂了一个类别」，这样升级后立刻就是可用状态，
 *   用户不需要重新编辑一遍预算。
 */
async function attachCategories(list) {
  if (list.length === 0) return list

  const ids = list.map((b) => b.id)
  const rows = await query(
    `SELECT budget_id, category_id FROM budget_category
     WHERE budget_id IN (${ids.map(() => '?').join(',')})
     ORDER BY budget_id ASC, category_id ASC`,
    ids
  )
  const map = {}
  rows.forEach((r) => {
    if (!map[r.budget_id]) map[r.budget_id] = []
    map[r.budget_id].push(r.category_id)
  })

  return list.map((b) => {
    let categoryIds = map[b.id] || []
    if (categoryIds.length === 0 && b.scope === SCOPE_CATEGORY && b.category_id) {
      categoryIds = [b.category_id]
    }
    return { ...b, categoryIds }
  })
}

/* ------------------------------------------------------------ 写入 */

/**
 * 新建预算
 *
 * @param {object} input
 *   scope        'total' | 'category'
 *   amount_cents 月额度（分）
 *   name         子预算名称（可空，月预算忽略）
 *   category_ids 子预算挂的类别 id 数组
 *   category_id  旧字段（兼容老调用方，等价于 category_ids=[category_id]）
 *   start_month  'YYYY-MM'，预算从哪个月开始生效
 *   rollover     仅月预算：未用完是否结转到下一月
 */
export async function createBudget(input) {
  const amount = Math.round(Number(input.amount_cents))
  if (!(amount > 0)) throw new Error('预算金额必须大于 0')

  const scope = input.scope === SCOPE_CATEGORY ? SCOPE_CATEGORY : SCOPE_TOTAL
  const categoryIds = await normalizeCategoryIds(input, scope)
  const name = scope === SCOPE_CATEGORY ? String(input.name || '').trim() : ''
  const now = Date.now()
  const id = input.id || prefixedId('bud')
  const startMonth = input.start_month || toMonthKey()

  if (scope === SCOPE_CATEGORY) {
    await assertSubBudgetWithinMonth(amount, null)
  } else {
    await assertMonthCoversSubBudgets(amount, null)
  }

  await transaction(async () => {
    // 月预算全局唯一：先删旧的（含它自己的类别关联）
    if (scope === SCOPE_TOTAL) {
      const old = await queryOne('SELECT id FROM budget WHERE scope = ? LIMIT 1', [SCOPE_TOTAL])
      if (old) await hardDeleteBudget(old.id)
    }

    // 类别唯一：把这些类别从别的子预算上摘掉
    await detachCategories(categoryIds, null)

    await execute(
      `INSERT INTO budget (id, scope, category_id, name, period, amount_cents, start_month, rollover, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        scope,
        // category_id 只是「第一个类别」的冗余列（给老版本 App 兜底显示）
        categoryIds.length > 0 ? categoryIds[0] : null,
        name || null,
        input.period || 'month',
        amount,
        startMonth,
        scope === SCOPE_TOTAL && input.rollover ? 1 : 0,
        now,
        now
      ]
    )

    if (scope === SCOPE_CATEGORY) {
      await linkCategories(id, categoryIds)
    }
  })

  return getBudget(id)
}

/**
 * 修改预算
 *
 * 支持 amount_cents / rollover / start_month / name / category_ids。
 * category 相关的归一化与「类别唯一」处理与新建一致。
 */
export async function updateBudget(id, patch) {
  const existing = await getBudget(id)
  if (!existing) throw new Error('预算不存在')

  const scope = existing.scope

  if (patch.amount_cents !== undefined) {
    const amount = Math.round(Number(patch.amount_cents))
    if (!(amount > 0)) throw new Error('预算金额必须大于 0')
    if (scope === SCOPE_CATEGORY) await assertSubBudgetWithinMonth(amount, id)
    else await assertMonthCoversSubBudgets(amount, id)
  }

  let categoryIds = null
  if (scope === SCOPE_CATEGORY && (patch.category_ids !== undefined || patch.category_id !== undefined)) {
    categoryIds = await normalizeCategoryIds(patch, scope)
    if (categoryIds.length === 0) throw new Error('子预算至少要选一个类别')
  }

  const fields = []
  const params = []
  const assign = (col, val) => { fields.push(`${col} = ?`); params.push(val) }

  if (patch.amount_cents !== undefined) {
    assign('amount_cents', Math.round(Number(patch.amount_cents)))
  }
  if (patch.rollover !== undefined && scope === SCOPE_TOTAL) assign('rollover', patch.rollover ? 1 : 0)
  if (patch.start_month !== undefined) assign('start_month', patch.start_month)
  if (patch.name !== undefined && scope === SCOPE_CATEGORY) {
    assign('name', String(patch.name || '').trim() || null)
  }
  if (categoryIds) assign('category_id', categoryIds.length > 0 ? categoryIds[0] : null)
  assign('updated_at', Date.now())
  params.push(id)

  await transaction(async () => {
    await execute(`UPDATE budget SET ${fields.join(', ')} WHERE id = ?`, params)
    if (categoryIds) {
      await detachCategories(categoryIds, id)
      await execute('DELETE FROM budget_category WHERE budget_id = ?', [id])
      await linkCategories(id, categoryIds)
    }
  })

  return getBudget(id)
}

export async function deleteBudget(id) {
  await transaction(async () => hardDeleteBudget(id))
  return true
}

/** 删预算 + 它的类别关联（关联表没有软删概念，硬删） */
async function hardDeleteBudget(id) {
  await execute('DELETE FROM budget_category WHERE budget_id = ?', [id])
  await execute('DELETE FROM budget WHERE id = ?', [id])
}

/* ---------------------------------------------------- 类别关联的内部工具 */

/**
 * 把入参里的类别统一成 id 数组。
 *
 * ★ 兼容三种老写法 ★
 *   category_ids: ['a','b']  （v18 新写法）
 *   category_id:  'a'        （v17 及更早的单类别写法）
 *   都不传                    （月预算）
 */
async function normalizeCategoryIds(input, scope) {
  if (scope !== SCOPE_CATEGORY) {
    return []
  }
  let ids = []
  if (Array.isArray(input.category_ids)) ids = input.category_ids
  else if (input.category_id) ids = [input.category_id]
  ids = ids.filter(Boolean).map((x) => String(x))
  // 去重，保持用户选择的顺序（第一个类别会写进冗余列，顺序也算信息）
  ids = ids.filter((x, i) => ids.indexOf(x) === i)

  if (ids.length === 0) throw new Error('子预算至少要选一个类别')

  const rows = await query(
    `SELECT id, parent_id, type FROM category WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
    ids
  )
  const found = new Set(rows.map((r) => r.id))
  const missing = ids.filter((x) => !found.has(x))
  if (missing.length > 0) throw new Error('选择的类别不存在或已被删除')

  // ★ 不允许同时选一级和它自己的二级 ★
  //   统计口径上父类别已经包含全部子类别，两个一起选会把同一笔支出算两遍。
  //   （选择器本身只提供「叶子类别 / 没有子类别的一级类别」，这里只是兜底。）
  const parentIds = new Set(rows.filter((r) => r.parent_id).map((r) => r.parent_id))
  const overlap = rows.find((r) => parentIds.has(r.id))
  if (overlap) throw new Error('不能同时选择一级类别和它下面的二级类别')

  return ids
}

async function linkCategories(budgetId, categoryIds) {
  for (const cid of categoryIds) {
    await execute(
      'INSERT OR IGNORE INTO budget_category (budget_id, category_id) VALUES (?, ?)',
      [budgetId, cid]
    )
  }
}

/**
 * 把 categoryIds 从「别的子预算」上摘掉。
 *
 * @param {string[]} categoryIds
 * @param {string|null} exceptBudgetId 不动的预算（正在保存的这条）
 */
async function detachCategories(categoryIds, exceptBudgetId) {
  if (categoryIds.length === 0) return

  const holders = await query(
    `SELECT DISTINCT budget_id FROM budget_category
     WHERE category_id IN (${categoryIds.map(() => '?').join(',')})`,
    categoryIds
  )

  for (const h of holders) {
    const bid = h.budget_id
    if (exceptBudgetId && bid === exceptBudgetId) continue

    await execute(
      `DELETE FROM budget_category
       WHERE budget_id = ? AND category_id IN (${categoryIds.map(() => '?').join(',')})`,
      [bid, ...categoryIds]
    )

    const left = await queryOne(
      'SELECT COUNT(*) AS c FROM budget_category WHERE budget_id = ?',
      [bid]
    )
    if (!Number(left ? left.c : 0)) {
      // 一个类别都不剩了：这条子预算已经没有任何统计口径，
      // 留着只会显示成「已删除分类」并占着额度，直接删掉。
      await execute('DELETE FROM budget WHERE id = ? AND scope = ?', [bid, SCOPE_CATEGORY])
    } else {
      await syncLegacyCategory(bid)
    }
  }
}

/** 关联表变了之后，把冗余的 category_id 列同步成第一个类别 */
async function syncLegacyCategory(budgetId) {
  const first = await queryOne(
    'SELECT category_id FROM budget_category WHERE budget_id = ? ORDER BY category_id ASC LIMIT 1',
    [budgetId]
  )
  await execute('UPDATE budget SET category_id = ? WHERE id = ?', [first ? first.category_id : null, budgetId])
}

/* ------------------------------------------------ 额度分配（硬性校验） */

/**
 * 子预算合计不能超过月预算。
 *
 * ★ 与 v17 的「只提示不硬拦」不同 ★
 *   用户这次明确要求「子预算总额度不能超过月预算」，
 *   所以从 v18 起这里直接拒绝保存，由页面给出具体差多少。
 *   没设月预算时也不允许设子预算 —— 没有池子可分配。
 */
async function assertSubBudgetWithinMonth(amount, excludeId) {
  const total = await queryOne(
    'SELECT amount_cents FROM budget WHERE scope = ? LIMIT 1',
    [SCOPE_TOTAL]
  )
  if (!total) throw new Error('请先设置月预算，再添加子预算')

  const totalLimit = Number(total.amount_cents) || 0
  const others = excludeId
    ? await queryOne(
      'SELECT COALESCE(SUM(amount_cents),0) AS amt FROM budget WHERE scope = ? AND id <> ?',
      [SCOPE_CATEGORY, excludeId]
    )
    : await queryOne(
      'SELECT COALESCE(SUM(amount_cents),0) AS amt FROM budget WHERE scope = ?',
      [SCOPE_CATEGORY]
    )
  const allocated = Number(others ? others.amt : 0)

  if (allocated + amount > totalLimit) {
    const overflow = allocated + amount - totalLimit
    throw new Error(
      `子预算合计不能超过月预算：月预算 ¥${(totalLimit / 100).toFixed(2)}，` +
      `已有子预算 ¥${(allocated / 100).toFixed(2)}，这次 ¥${(amount / 100).toFixed(2)}，` +
      `超出 ¥${(overflow / 100).toFixed(2)}`
    )
  }
}

/**
 * 月预算不能低于已有子预算合计。
 *
 * 用户把月预算调小到「比已分配的子预算还少」时直接拒绝：
 * 那样会出现「子预算合计 > 月预算」的矛盾状态，
 * 界面上到处是红色警告，用户却不知道自己哪一步做错了。
 */
async function assertMonthCoversSubBudgets(amount, excludeId) {
  const row = await queryOne(
    'SELECT COALESCE(SUM(amount_cents),0) AS amt FROM budget WHERE scope = ?',
    [SCOPE_CATEGORY]
  )
  const allocated = Number(row ? row.amt : 0)
  if (allocated > amount) {
    throw new Error(
      `已有子预算合计 ¥${(allocated / 100).toFixed(2)}，` +
      `月预算不能低于这个数（当前设置 ¥${(amount / 100).toFixed(2)}）。` +
      '请先减少子预算额度。'
    )
  }
  void excludeId
}

/* ------------------------------------------------ 结转（逐月累计） */

/** 'YYYY-MM' 递增一个月（本地实现，避免和 date.js 的 shiftMonth 语义耦合） */
function nextMonth(monthKey) {
  let y = Number(String(monthKey).slice(0, 4)) || 0
  let m = Number(String(monthKey).slice(5, 7)) || 0
  m += 1
  if (m > 12) { m = 1; y += 1 }
  return `${y}-${String(m).padStart(2, '0')}`
}

/**
 * 月预算在某个月的「可用额度」= 本月额度 + 上期结转。
 *
 * ★ 结转口径（用户指定）★
 *   「逐月累计结转，且只结转正数」
 *     每月可用 = 月额度 + 上期结转
 *     本期结转 = max(0, 本期可用 - 本期已用)
 *   也就是说：没花完结转到下月；超支则结转 0，**不透支下月的额度**。
 *   从预算的 start_month 开始算，之前不存在的月份不参与。
 *
 * ★ 为什么要逐月累计而不是只看上一月 ★
 *   用户可能连续几个月都花得少，那些额度应该一直在账上；
 *   只看上一月的话，第二个月没花完的部分会在第三个月被静默丢弃。
 *
 * @param {object} opt
 *   monthly    月额度（分）
 *   startMonth 预算起始月 'YYYY-MM'
 *   monthKey   要算的月份
 *   usedByMonth { 'YYYY-MM': 已用分 } 从 startMonth 到 monthKey 的每月支出
 *   rollover   是否开启结转
 * @returns {{ carryover:number, available:number }}
 */
export function computeMonthAvailability(opt) {
  const monthly = Math.max(0, Number(opt.monthly) || 0)
  const startMonth = String(opt.startMonth || '')
  const monthKey = String(opt.monthKey || '')
  const usedByMonth = opt.usedByMonth || {}
  const rollover = !!opt.rollover

  if (!rollover || !startMonth || !monthKey || startMonth > monthKey) {
    return { carryover: 0, available: monthly }
  }

  let carry = 0
  let m = startMonth
  // 只滚到 monthKey 的**前一个月**：target 月的结转来自之前各月
  while (m < monthKey) {
    const used = Number(usedByMonth[m]) || 0
    carry = Math.max(0, carry + monthly - used)
    m = nextMonth(m)
  }
  return { carryover: carry, available: monthly + carry }
}

/* ------------------------------------------------------------ 额度分配 */

/**
 * 算「月预算 → 子预算」的额度分配情况。
 *
 * ★ 子预算是月预算的子额度，不是独立的额度 ★
 *     - 已分配合计 = 所有子预算的额度之和
 *     - 未分配额度 = 月预算 - 已分配合计
 *     - 已分配合计 > 月预算 -> 超额分配（界面红色提示）
 *
 * @param {Array<Object>} usages getBudgetUsage / getBudgetUsageRange 的返回值
 * @returns {{
 *   hasTotal: boolean,
 *   totalLimit: number,
 *   allocated: number,
 *   unallocated: number,
 *   overAllocated: boolean,
 *   allocatedPercent: number
 * }}
 */
export function summarizeAllocation(usages) {
  const list = Array.isArray(usages) ? usages : []

  const total = list.find((b) => b.scope === SCOPE_TOTAL) || null
  const categories = list.filter((b) => b.scope === SCOPE_CATEGORY)

  // 月预算的「可分配额度」用 baseLimit（不含结转）：
  // 结转是「本月能花多少」，不是「能分配给子预算多少」——
  // 把结转也算进来，子预算额度会随着月份莫名其妙地变大。
  const totalLimit = total ? Number(total.baseLimit !== undefined ? total.baseLimit : total.limit) || 0 : 0
  const allocated = categories.reduce((sum, b) => sum + (Number(b.limit) || 0), 0)

  // 没有月预算时，「未分配」无从谈起（没有可分配的池子）
  const unallocated = total ? totalLimit - allocated : 0
  const overAllocated = !!total && allocated > totalLimit
  const allocatedPercent = totalLimit > 0
    ? Math.round((allocated / totalLimit) * 1000) / 10
    : 0

  return {
    hasTotal: !!total,
    totalLimit,
    allocated,
    unallocated,
    overAllocated,
    allocatedPercent
  }
}

/**
 * 校验「新增 / 修改一个子预算」会不会超月预算。
 *
 * ★ 这里仍然只算结果、不抛异常 ★
 *   页面要用它做「保存前预检 + 提示到底超多少」，
 *   真正的硬拦在 createBudget / updateBudget 里（同一份口径、只算一次 SQL）。
 *
 * @param {Array<Object>} usages 当前的预算用量列表
 * @param {number} newLimit    这次要设的额度（分）
 * @param {string} [excludeId] 要排除的预算 id（修改已有预算时排除它自己）
 */
export function checkCategoryAllocation(usages, newLimit, excludeId) {
  const list = (Array.isArray(usages) ? usages : []).filter(
    (b) => b.scope === SCOPE_CATEGORY && b.id !== excludeId
  )
  const total = (Array.isArray(usages) ? usages : []).find((b) => b.scope === SCOPE_TOTAL) || null

  const allocated = list.reduce((sum, b) => sum + (Number(b.limit) || 0), 0)
  const totalLimit = total ? Number(total.baseLimit !== undefined ? total.baseLimit : total.limit) || 0 : 0
  const amount = Number(newLimit) || 0
  const newTotal = allocated + amount

  return {
    hasTotal: !!total,
    wouldOver: !!total && newTotal > totalLimit,
    allocated,
    newTotal,
    totalLimit,
    overflow: total && newTotal > totalLimit ? newTotal - totalLimit : 0
  }
}
