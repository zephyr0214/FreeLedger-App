/**
 * 分类服务 —— 支持一级/二级，一级作为统计聚合口径
 */

import { query, queryOne, execute, transaction } from './db/index.js'
import { prefixedId } from '../utils/id.js'
import {
  RECONCILE_CATEGORIES, RECONCILE_LEGACY_NAME,
  DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES, DEFAULT_ALIAS,
  childIcon, childColor
} from './db/schema.js'

/**
 * 默认分类。
 *
 * ★ 定义搬到 api/db/schema.js 了 ★
 *   两处都要用这份结构：
 *     - 这里的 seedDefaultCategories()（全新安装时写）
 *     - api/db/index.js 的迁移 v5（老设备重建时写）
 *   而本文件依赖 api/db/index.js，反过来 import 就成环了。
 *   schema.js 不依赖任何模块，是唯一能放「两边共用」的地方。
 *
 * icon 字段的取值必须是 utils/icons.js 里 ICON_MAP / ICON_OPTIONS 的键。
 * ★ 二级分类有自己的图标（v6 起）★
 *   children 里每一项是 { name, icon }，颜色继承父级。
 *
 * ★ 结构是一级 + 二级 ★
 *   一级是「统计口径」（餐饮食品、交通出行…），二级是用户真正记的那一项
 *   （正餐、饮品、零食/小吃…）。
 *
 * ★ 颜色取自 App 现有的 Material 风格调色板 ★
 *   同一类型内保证一级分类颜色互不相同，一眼能分清。
 */
export { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES, DEFAULT_ALIAS }

/* ------------------------------------------------------------------ 查询 */

function normalizeCategory(row) {
  return {
    ...row,
    sort: Number(row.sort) || 0,
    hidden: Number(row.hidden) === 1,
    isParent: !row.parent_id
  }
}

/** 全部分类（含二级），按 type 过滤 */
export async function listCategories(type = null, includeHidden = false) {
  const where = ['deleted_at IS NULL']
  const params = []
  if (type) { where.push('type = ?'); params.push(type) }
  if (!includeHidden) where.push('hidden = 0')

  const rows = await query(
    `SELECT * FROM category WHERE ${where.join(' AND ')} ORDER BY sort ASC, created_at ASC`,
    params
  )
  return rows.map(normalizeCategory)
}

/** 分类树：一级 + children */
export async function listCategoryTree(type = 'expense', includeHidden = false) {
  const all = await listCategories(type, includeHidden)
  const parents = all.filter((c) => !c.parent_id)
  return parents.map((p) => ({
    ...p,
    children: all.filter((c) => c.parent_id === p.id)
  }))
}

export async function getCategory(id) {
  const row = await queryOne('SELECT * FROM category WHERE id = ? AND deleted_at IS NULL', [id])
  return row ? normalizeCategory(row) : null
}

/** 取某个分类的根分类 id（二级归并到一级） */
export async function getRootCategoryId(id) {
  const cat = await getCategory(id)
  if (!cat) return null
  return cat.parent_id || cat.id
}

/** 按名称找分类（导入/速记解析用） */
export async function findCategoryByName(name, type = null) {
  const where = ['deleted_at IS NULL', 'name = ?']
  const params = [name]
  if (type) { where.push('type = ?'); params.push(type) }
  const row = await queryOne(`SELECT * FROM category WHERE ${where.join(' AND ')} LIMIT 1`, params)
  return row ? normalizeCategory(row) : null
}

/* ------------------------------------------------------------------ 写入 */

export async function createCategory(input) {
  const now = Date.now()
  const id = input.id || prefixedId('cat')
  const sort = input.sort !== undefined ? input.sort : await nextSort(input.type, input.parent_id || null)

  await execute(
    `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,NULL)`,
    [
      id,
      input.parent_id || null,
      input.name,
      input.type || 'expense',
      input.icon || null,
      input.color || null,
      sort,
      input.hidden ? 1 : 0,
      now,
      now
    ]
  )
  return getCategory(id)
}

export async function updateCategory(id, patch) {
  const existing = await getCategory(id)
  if (!existing) throw new Error('分类不存在')

  // ★ 固定分类（对账支出 / 对账收入）不允许改 ★
  //   UI 层已经拦了一道，这里是 API 层的兜底 ——
  //   万一别处（导入、脚本）绕过了 UI，也不能把固定分类改了。
  if (isReconcileCategory(existing)) {
    throw new Error(`「${existing.name}」是固定分类，不能修改`)
  }

  const fields = []
  const params = []
  const assign = (col, val) => { fields.push(`${col} = ?`); params.push(val) }

  if (patch.name !== undefined) assign('name', patch.name)
  if (patch.icon !== undefined) assign('icon', patch.icon)
  if (patch.color !== undefined) assign('color', patch.color)
  if (patch.sort !== undefined) assign('sort', patch.sort)
  if (patch.hidden !== undefined) assign('hidden', patch.hidden ? 1 : 0)
  if (patch.parent_id !== undefined) assign('parent_id', patch.parent_id || null)
  assign('updated_at', Date.now())
  params.push(id)

  await execute(`UPDATE category SET ${fields.join(', ')} WHERE id = ?`, params)
  return getCategory(id)
}

/**
 * 删除分类
 *
 * ★ 有交易也能删 ★
 *   用户要求：删除分类时就算分类下还有交易也允许删除，
 *   这些交易变成「无分类」（交易本身不删，历史记录要留住）。
 *
 * ★ 为什么可以直接置 NULL ★
 *   txn.category_id 建表时就是可空的（`category_id TEXT`，没有 NOT NULL），
 *   不像 account_id 那样有约束问题 —— 不需要任何数据库迁移。
 *
 * ★ 删一级分类时连带软删除它的子分类 ★
 *   否则会留下一堆孤儿二级（parent_id 指向已删除的一级），
 *   分类树里点不到、但又还在库里占着位置。
 *   子分类下的交易同样置成「无分类」。
 *
 * ★ 固定分类（对账支出 / 对账收入）仍然不允许删 ★
 *   这两条是余额对账的记账口径，删了账就对不上了。
 */
export async function deleteCategory(id) {
  // ★ 固定分类（对账支出 / 对账收入）不允许删 ★
  //   UI 层已经拦了一道，这里是 API 层的兜底。
  const target = await getCategory(id)
  if (!target) throw new Error('分类不存在')
  if (isReconcileCategory(target)) {
    throw new Error(`「${target.name}」是固定分类，不能删除`)
  }

  const now = Date.now()

  await transaction(async () => {
    // 1) 收集要删的分类 id：自己 + 它的所有子分类
    //    （删一级时连带删二级，避免留下孤儿）
    const childRows = await query(
      'SELECT id FROM category WHERE parent_id = ? AND deleted_at IS NULL',
      [id]
    )
    const ids = [id].concat(childRows.map((r) => r.id))

    // 2) 这些分类下的交易变成「无分类」（交易本身不删）
    for (const cid of ids) {
      await execute(
        'UPDATE txn SET category_id = NULL, updated_at = ? WHERE category_id = ? AND deleted_at IS NULL',
        [now, cid]
      )
    }

    // 3) 删掉这些分类的「分类预算」
    //   ★ budget 表没有 deleted_at 字段，只能硬删 ★
    //     （见 api/db/schema.js 的建表语句）
    //   不删的话预算会一直挂着，但它的分类已经没了：
    //   交易的 category_id 都变成 NULL 了，那个预算的「已用」永远是 0，
    //   看着像「预算没生效」。
    for (const cid of ids) {
      await execute('DELETE FROM budget WHERE scope = ? AND category_id = ?', ['category', cid])
    }

    // 4) 软删除子分类 + 自己
    for (const cid of ids) {
      await execute('UPDATE category SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, cid])
    }
  })

  return true
}

/** 批量更新排序（拖拽排序后调用） */
export async function reorderCategories(orderedIds) {
  await transaction(async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await execute('UPDATE category SET sort = ? WHERE id = ?', [i, orderedIds[i]])
    }
  })
  return true
}

async function nextSort(type, parentId) {
  const row = parentId
    ? await queryOne(
        'SELECT COALESCE(MAX(sort), -1) AS m FROM category WHERE type = ? AND parent_id = ? AND deleted_at IS NULL',
        [type, parentId]
      )
    : await queryOne(
        'SELECT COALESCE(MAX(sort), -1) AS m FROM category WHERE type = ? AND parent_id IS NULL AND deleted_at IS NULL',
        [type]
      )
  return Number(row ? row.m : -1) + 1
}

/* ------------------------------------------------------ 首次启动初始化 */

/**
 * 「对账」固定分类
 *
 * 用户直接改账户余额时，差额不是凭空改的 ——
 * 要在交易记录里留下一笔「对账支出」或「对账收入」，
 * 这样余额公式（期初 + 收入 - 支出）仍然成立，账也对得上。
 *
 * ★ v4 起：两个**独立的一级分类** ★
 *   旧结构是「对账调整」一级 → 下面挂「对账支出」「对账收入」两个二级。
 *   现在按用户要求改成：
 *     - expense 类型下的一级分类叫「对账支出」
 *     - income  类型下的一级分类叫「对账收入」
 *   两条都是固定分类：分类管理里不能改名、不能改图标/颜色、不能删除。
 *
 * 定义放在 api/db/schema.js（RECONCILE_CATEGORIES），
 * 让这里和迁移 v4 共用同一份数据，不会改了一处忘了另一处。
 */
export const RECONCILE_CATEGORY = RECONCILE_CATEGORIES

/** 「对账支出」「对账收入」两个固定分类的名字（按 type 区分） */
export const RECONCILE_NAMES = {
  expense: '对账支出',
  income: '对账收入'
}

/**
 * 判断一个分类是不是「对账」固定分类（不可删改）。
 *
 * ★ 判定依据是「名字 + 类型 + 一级」 ★
 *   不用 id —— id 会随备份导入/导出变化，用名字判定才稳。
 *
 * @param {object|null} cat 分类对象（至少含 name / type / parent_id）
 * @returns {boolean}
 */
export function isReconcileCategory(cat) {
  if (!cat || !cat.name || !cat.type) return false
  if (cat.parent_id) return false
  const expected = RECONCILE_NAMES[cat.type]
  return !!expected && cat.name === expected
}

/**
 * 确保「对账支出」「对账收入」两个固定一级分类存在，
 * 返回 { expenseId, incomeId }（分别是这两个一级分类的 id）。
 *
 * ★ API 契约不变 ★
 *   以前返回的是「对账调整」下面两个**二级**分类的 id，
 *   现在返回的是两个**一级**分类的 id。
 *   调用方（api/account.js 的 adjustAccountBalance）只把它写进
 *   txn.category_id，而 txn.category_id 本来就允许指向一级分类
 *   （日常「其他」这种无二级的一级分类就是这么用的），所以是合法的。
 *
 * 幂等：已经存在就直接返回，不重复插入。
 */
export async function ensureReconcileCategory() {
  const now = Date.now()

  const result = {}

  for (const def of RECONCILE_CATEGORIES) {
    const row = await queryOne(
      'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
      [def.name, def.type]
    )

    let id = row ? row.id : null
    if (!id) {
      id = prefixedId('cat')
      // sort = 999：排到最后，别抢用户自己分类的位置
      await execute(
        `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
         VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
        [id, null, def.name, def.type, def.icon, def.color, 999, now, now]
      )
    }

    result[def.type === 'expense' ? 'expenseId' : 'incomeId'] = id
  }

  return result
}

/**
 * 把默认分类写进数据库（首次安装用）。
 *
 * @param {Function} exec  执行 SQL 的函数
 * @param {Function} makeId 生成 id 的函数
 * @param {number} now 时间戳
 * @returns {number} 写入的分类条数
 */
async function insertDefaultCategories(exec, makeId, now) {
  let n = 0

  for (const type of ['expense', 'income']) {
    const list = type === 'expense' ? DEFAULT_EXPENSE_CATEGORIES : DEFAULT_INCOME_CATEGORIES
    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      const parentId = makeId()
      await exec(
        `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
         VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
        [parentId, null, item.name, type, item.icon, item.color, i, now, now]
      )
      n++

      // ★ 二级分类有自己的图标（颜色继承父级）★
      //   childIcon / childColor 兼容旧写法（纯字符串），
      //   详见 api/db/schema.js 的说明。
      for (let j = 0; j < item.children.length; j++) {
        const child = item.children[j]
        const childName = typeof child === 'string' ? child : child.name
        await exec(
          `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
          [
            makeId(), parentId, childName, type,
            childIcon(child, item.icon), childColor(child, item.color),
            j, now, now
          ]
        )
        n++
      }
    }
  }

  return n
}

/**
 * 写入默认分类（仅当分类表为空）。
 *
 * ★ 为什么老设备上不会自动更新 ★
 *   这里只在「一条分类都没有」时才写。
 *   老用户库里有旧分类，就永远走不到这里 ——
 *   改成新分类结构要靠数据库迁移（见 api/db/index.js 的迁移 v5）。
 */
export async function seedDefaultCategories() {
  const count = await queryOne('SELECT COUNT(*) AS c FROM category WHERE deleted_at IS NULL')
  if (Number(count ? count.c : 0) > 0) return 0

  const now = Date.now()
  let n = 0

  await transaction(async () => {
    n = await insertDefaultCategories(execute, prefixedId, now)
  })

  return n
}
