/**
 * 分类服务 —— 支持一级/二级，一级作为统计聚合口径
 */

import { query, queryOne, execute, transaction } from './db/index.js'
import { prefixedId } from '../utils/id.js'
import {
  RECONCILE_CATEGORIES, RECONCILE_LEGACY_NAME,
  DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES, DEFAULT_ALIAS,
  SYSTEM_PRESET_GROUP_NAME, SYSTEM_PRESET_GROUPS, SYSTEM_PRESET_CHILDREN,
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


/** 按名称找分类（导入/速记解析用） */


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

  // ★ 固定分类（「系统预置分类」及其下的借出/借入/对账支出/对账收入）不允许改 ★
  //   UI 层已经拦了一道，这里是 API 层的兜底 ——
  //   万一别处（导入、脚本）绕过了 UI，也不能把固定分类改了。
  if (await isFixedCategoryById(existing)) {
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
  // ★ 固定分类不允许删 ★
  //   UI 层已经拦了一道，这里是 API 层的兜底。
  const target = await getCategory(id)
  if (!target) throw new Error('分类不存在')
  if (await isFixedCategoryById(target)) {
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

/* ---------------------------------------------- 固定分类（系统预置分类） */

/**
 * 「系统预置分类」—— 固定分类组（v14 起）
 *
 * ★ 结构 ★
 *   一级分类「系统预置分类」在 expense / income 下各一条（名字相同、type 不同），
 *   它下面挂的是系统自己用的固定子类：
 *     支出：借出、对账支出
 *     收入：借入、对账收入
 *
 * ★ 为什么从「独立一级」改成「挂在同一个父级下」★
 *   用户要求分类页里把这几个不能改的分类收进一个固定的一级分类，
 *   别和用户自己的分类混排 —— 混在一起看着像可以随便删改的普通分类。
 *
 * ★ 固定分类不可改名 / 改图标 / 改颜色 / 删除 ★
 *   · 「对账支出 / 对账收入」是余额对账的记账口径（改账户余额时自动记的账）
 *   · 「借出 / 借入」是借入借出管理的记账口径
 *   删了或改名了，账就对不上，所以整组锁死。
 *
 * 定义放在 api/db/schema.js，让这里（运行时兜底创建）
 * 和 api/db/index.js（迁移 v14）共用同一份数据。
 */

/** 「对账支出」「对账收入」两个固定分类的名字（按 type 区分） */
export const RECONCILE_NAMES = {
  expense: '对账支出',
  income: '对账收入'
}

/**
 * 借入借出相关的四个固定分类名，按「语义」而不是按 type 命名。
 *
 * ★ 一笔借出涉及两个方向 ★
 *   借出（expense，钱出去）+ 借出收回（income，钱回来）
 *   借入（income，钱进来）+ 借入归还（expense，钱出去）
 *   所以不能再用「expense 叫借出、income 叫借入」这种一对一的映射，
 *   否则「借出收回」和「借入归还」无处安放。
 *
 * 定义同步在 api/db/schema.js 的 LOAN_CATEGORY_NAMES，供迁移使用。
 */
export const LOAN_CATEGORY_NAMES = {
  lendOut: { name: '借出', type: 'expense' },
  lendBack: { name: '借出收回', type: 'income' },
  borrowIn: { name: '借入', type: 'income' },
  borrowBack: { name: '借入归还', type: 'expense' }
}

/** 每个 type 下「系统预置分类」里的固定子类名（顺序即展示顺序） */
const FIXED_CHILD_NAMES = {
  expense: ['借出', '借入归还', RECONCILE_NAMES.expense],
  income: ['借入', '借出收回', RECONCILE_NAMES.income]
}

/** 所有借入借出相关的固定分类名（跨两个 type） */
const ALL_LOAN_NAMES = ['借出', '借出收回', '借入', '借入归还']

/**
 * 是不是「系统预置分类」这个一级分类本身。
 *
 * @param {object|null} cat 分类对象（至少含 name / type / parent_id）
 * @returns {boolean}
 */
export function isPresetGroupCategory(cat) {
  if (!cat || !cat.name || !cat.type) return false
  if (cat.parent_id) return false
  return cat.name === SYSTEM_PRESET_GROUP_NAME
}

/**
 * 是不是「对账」固定分类（名字 + type 匹配，不看层级）。
 *
 * ★ 为什么不再要求「必须是一级」★
 *   v14 起「对账支出 / 对账收入」是「系统预置分类」下的**二级**分类，
 *   还按「一级」判定就会漏判 —— 这两个分类就又能被改名删除了。
 *
 * @param {object|null} cat 分类对象（至少含 name / type）
 * @returns {boolean}
 */
export function isReconcileCategory(cat) {
  if (!cat || !cat.name || !cat.type) return false
  const expected = RECONCILE_NAMES[cat.type]
  return !!expected && cat.name === expected
}

/**
 * 是不是「借出 / 借出收回 / 借入 / 借入归还」固定分类。
 *
 * ★ 判定按名字，不按 type ★
 *   「借出」一定是 expense、「借出收回」一定是 income……
 *   名字本身已经唯一确定了它的方向（见 LOAN_CATEGORY_NAMES），
 *   再要求 type 匹配反而会漏判（比如把「借出收回」写成 income 才对的场景）。
 *   为了兼容旧调用点（只传 {name, type}），type 存在时会校验一遍。
 *
 * @param {object|null} cat
 * @returns {boolean}
 */
export function isLoanCategory(cat) {
  if (!cat || !cat.name) return false
  if (!ALL_LOAN_NAMES.includes(cat.name)) return false
  // type 给了就校验（防同名误解），没给就只按名字认
  if (!cat.type) return true
  return Object.values(LOAN_CATEGORY_NAMES).some(
    (d) => d.name === cat.name && d.type === cat.type
  )
}

/**
 * 名字是不是「固定子类」的名字（只比名字和 type，不看层级）。
 *
 * @param {object|null} cat
 * @returns {boolean}
 */
function isFixedChildName(cat) {
  if (!cat || !cat.name || !cat.type) return false
  return (FIXED_CHILD_NAMES[cat.type] || []).includes(cat.name)
}

/**
 * 名字是不是「系统预置分类」里的固定分类名（同步、不查库）。
 *
 * 用于在**扁平分类列表**里把这些分类挑出来 / 跳过它们。
 * 典型场景：记账面板选默认分类时不能让「借出」当默认，
 * 否则用户新建一笔日常支出，分类默认变成「借出」。
 *
 * @param {string} name 分类名
 * @param {string} type 'expense' | 'income'
 * @returns {boolean}
 */
export function isSystemPresetName(name, type) {
  if (!name || !type) return false
  return (FIXED_CHILD_NAMES[type] || []).includes(name)
}

/**
 * 是不是固定分类（不可改名 / 改图标 / 删除）—— 同步版，给 UI 用。
 *
 * ★ 判定规则 ★
 *   · 「系统预置分类」这个一级分类本身
 *   · 「对账支出 / 对账收入 / 借出 / 借入」这些固定名字
 *   · 旧结构遗留的一级「对账支出 / 对账收入」（迁移前的数据）
 *
 * UI 层只需要「这个分类能不能改」的答案，不需要查库，
 * 所以这里只看对象自带的字段。
 * API 层（updateCategory / deleteCategory）另有 isFixedCategoryById，
 * 会再确认一次父级是不是「系统预置分类」，防止用户自建的同名分类被误锁。
 *
 * @param {object|null} cat
 * @returns {boolean}
 */
export function isFixedCategory(cat) {
  if (!cat || !cat.name || !cat.type) return false
  if (isPresetGroupCategory(cat)) return true
  if (isFixedChildName(cat)) return true
  return false
}

/**
 * 是不是固定分类 —— 带库校验版，给 API 层兜底用。
 *
 * 和 isFixedCategory 的区别：对「二级」的固定名字会再查一次父级，
 * 只有当父级确实是「系统预置分类」时才算固定 ——
 * 用户自己在别的分类下建一个叫「借出」的子分类不会被误锁。
 *
 * @param {object|null} cat 分类对象（含 id / name / type / parent_id）
 * @returns {Promise<boolean>}
 */
export async function isFixedCategoryById(cat) {
  if (!cat) return false
  if (isPresetGroupCategory(cat)) return true
  if (!isFixedChildName(cat)) return false
  // 旧结构：一级的「对账支出 / 对账收入」同样锁死
  if (!cat.parent_id) return true
  const parent = await getCategory(cat.parent_id)
  return !!parent && isPresetGroupCategory(parent)
}

/* ------------------------------------------- 系统预置分类的创建（幂等） */

/** 取或建「系统预置分类」这一条一级分类，返回 id */
async function ensurePresetGroupRow(type) {
  const def = SYSTEM_PRESET_GROUPS[type]
  const row = await queryOne(
    'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
    [def.name, type]
  )
  if (row) return row.id

  const now = Date.now()
  const id = prefixedId('cat')
  // sort = 999：排到最后，别抢用户自己分类的位置
  await execute(
    `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
    [id, null, def.name, def.type, def.icon, def.color, 999, now, now]
  )
  return id
}

/** 取或建「系统预置分类」下某个固定子类，返回 id */
async function ensurePresetChildRow(type, name) {
  const def = SYSTEM_PRESET_CHILDREN.find((d) => d.type === type && d.name === name)
  if (!def) return null

  const groupId = await ensurePresetGroupRow(type)

  const child = await queryOne(
    'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id = ?',
    [name, type, groupId]
  )
  if (child) return child.id

  const now = Date.now()

  /*
   * ★ 先把「同名的一级分类」收编到组里，而不是另外新建一条 ★
   *   v14 之前的「对账支出 / 对账收入」是一级分类，
   *   历史交易的 category_id 全指着它们。
   *   直接新建一条二级再删旧的，会让这些交易变成「未分类」（悬空引用）。
   *   所以优先复用旧行的 id，只把 parent_id 改到组里。
   */
  const legacy = await queryOne(
    'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
    [name, type]
  )
  if (legacy) {
    await execute(
      'UPDATE category SET parent_id = ?, icon = ?, color = ?, sort = ?, updated_at = ? WHERE id = ?',
      [groupId, def.icon, def.color, def.sort, now, legacy.id]
    )
    return legacy.id
  }

  const id = prefixedId('cat')
  await execute(
    `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
    [id, groupId, name, type, def.icon, def.color, def.sort, now, now]
  )
  return id
}

/**
 * 确保「系统预置分类」整组存在（两个父级 + 六个固定子类）。
 *
 * ★ 六个固定子类 ★
 *   支出：借出、借入归还、对账支出
 *   收入：借入、借出收回、对账收入
 *   「借出收回 / 借入归还」是这一轮补的 ——
 *   一笔借出只有「借出」而没有「收回」，账面上就永远看不出还了多少。
 *
 * 幂等：已经存在就直接复用，不重复插入。
 *
 * @returns {Promise<{expenseGroupId:string, incomeGroupId:string,
 *   lendOutId:string, lendBackId:string,
 *   borrowInId:string, borrowBackId:string,
 *   reconcileExpenseId:string, reconcileIncomeId:string,
 *   loanExpenseId:string, loanIncomeId:string}>}
 *   loanExpenseId / loanIncomeId 是旧字段名（= 借出 / 借入），
 *   保留是为了不破坏已有调用点。
 */
export async function ensurePresetCategories() {
  const expenseGroupId = await ensurePresetGroupRow('expense')
  const incomeGroupId = await ensurePresetGroupRow('income')

  const lendOutId = await ensurePresetChildRow('expense', LOAN_CATEGORY_NAMES.lendOut.name)
  const borrowBackId = await ensurePresetChildRow('expense', LOAN_CATEGORY_NAMES.borrowBack.name)
  const reconcileExpenseId = await ensurePresetChildRow('expense', RECONCILE_NAMES.expense)

  const borrowInId = await ensurePresetChildRow('income', LOAN_CATEGORY_NAMES.borrowIn.name)
  const lendBackId = await ensurePresetChildRow('income', LOAN_CATEGORY_NAMES.lendBack.name)
  const reconcileIncomeId = await ensurePresetChildRow('income', RECONCILE_NAMES.income)

  return {
    expenseGroupId,
    incomeGroupId,
    lendOutId,
    lendBackId,
    borrowInId,
    borrowBackId,
    reconcileExpenseId,
    reconcileIncomeId,
    // 旧字段名，等价的别名
    loanExpenseId: lendOutId,
    loanIncomeId: borrowInId
  }
}

/**
 * 确保「对账支出」「对账收入」两个固定分类存在，
 * 返回 { expenseId, incomeId }。
 *
 * ★ API 契约不变 ★
 *   api/account.js 的 adjustAccountBalance() 只把这两个 id 写进 txn.category_id。
 *   v14 起它们是「系统预置分类」下的二级分类，
 *   而 txn.category_id 本来就是二级分类的标准用法 —— 完全合法。
 *
 * 幂等：已经存在就直接返回，不重复插入。
 */
export async function ensureReconcileCategory() {
  const all = await ensurePresetCategories()
  return {
    expenseId: all.reconcileExpenseId,
    incomeId: all.reconcileIncomeId
  }
}

/**
 * 确保借入借出四个固定分类存在。
 *
 * 借入借出管理页（pages/loan/manage.vue）用它拿到：
 *   · 记一笔时要挂的分类 id
 *   · 算「当前借出 / 当前借入」时用来按分类求和的两组 id
 *
 * @returns {Promise<{expenseId:string, incomeId:string,
 *   lendOutId:string, lendBackId:string, borrowInId:string, borrowBackId:string}>}
 *   expenseId / incomeId 是旧字段名（借出 / 借入），保留以兼容。
 *
 * 幂等。
 */
export async function ensureLoanCategories() {
  const all = await ensurePresetCategories()
  return {
    expenseId: all.lendOutId,
    incomeId: all.borrowInId,
    lendOutId: all.lendOutId,
    lendBackId: all.lendBackId,
    borrowInId: all.borrowInId,
    borrowBackId: all.borrowBackId
  }
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

  /*
   * ★ 「系统预置分类」固定分类组（v14 起）★
   *   全新安装也要有这一组，否则用户第一次改账户余额时
   *   得等到 ensureReconcileCategory() 被调用才会凭空冒出来 ——
   *   分类页里会「突然多出一个一级分类」，很突兀。
   *   结构定义在 api/db/schema.js，和迁移 v14 共用同一份。
   */
  for (const type of ['expense', 'income']) {
    const groupDef = SYSTEM_PRESET_GROUPS[type]
    const groupId = makeId()
    await exec(
      `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
       VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
      [groupId, null, groupDef.name, type, groupDef.icon, groupDef.color, 999, now, now]
    )
    n++

    for (const def of SYSTEM_PRESET_CHILDREN.filter((d) => d.type === type)) {
      await exec(
        `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
         VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
        [makeId(), groupId, def.name, type, def.icon, def.color, def.sort, now, now]
      )
      n++
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
