/**
 * 分类服务 —— 支持一级/二级，一级作为统计聚合口径
 */

import { query, queryOne, execute, transaction } from './db/index.js'
import { prefixedId } from '../utils/id.js'
import { RECONCILE_CATEGORIES, RECONCILE_LEGACY_NAME } from './db/schema.js'

/**
 * 默认分类。
 *
 * icon 字段的取值必须是 utils/icons.js 里 ICON_MAP / ICON_OPTIONS 的键。
 * 二级分类不单独配 icon，直接继承父级的（父级有就用父级的）。
 *
 * ★ 结构是一级 + 二级 ★
 *   一级是「统计口径」（餐饮食品、交通出行…），二级是用户真正记的那一项
 *   （正餐、饮品、零食/小吃…）。
 *   二级分类的 icon / color 都继承父级，所以每个一级只给一个图标一个颜色。
 *
 * ★ 颜色取自 App 现有的 Material 风格调色板 ★
 *   同一类型内保证一级分类颜色互不相同，一眼能分清。
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: '餐饮食品', icon: 'food',    color: '#FF976A', children: ['正餐', '饮品', '零食/小吃', '超市/零售'] },
  { name: '交通出行', icon: 'car',     color: '#1989FA', children: ['公共交通/打车', '火车/飞机', '加油/停车'] },
  { name: '居住住房', icon: 'home',    color: '#7D5FFF', children: ['房租/房贷/物业', '水电燃气', '话费/网费'] },
  { name: '购物消费', icon: 'shop',    color: '#EE0A24', children: ['日用品', '服饰', '数码'] },
  { name: '医疗健康', icon: 'medical', color: '#FF8F1F', children: ['买药/看病', '健身', '医保/社保'] },
  { name: '社交娱乐', icon: 'game',    color: '#07C160', children: ['旅游', '娱乐', '团建'] },
  { name: '学校学习', icon: 'book',    color: '#0A8F4A', children: ['学费', '书籍/课程/资料', '文具'] },
  { name: '人情往来', icon: 'gift',    color: '#FF6B9D', children: ['随份子', '红包', '送礼'] },
  { name: '其他/杂项', icon: 'more',   color: '#969799', children: [] }
]

export const DEFAULT_INCOME_CATEGORIES = [
  { name: '工资',     icon: 'money',  color: '#07C160', children: ['奖金补贴'] },
  { name: '奖金补贴', icon: 'bonus',  color: '#FF8F1F', children: [] },
  { name: '副业劳务', icon: 'work',   color: '#7D5FFF', children: [] },
  { name: '租金收入', icon: 'rent',   color: '#1989FA', children: [] },
  { name: '投资收益', icon: 'chart',  color: '#0A8F4A', children: [] },
  { name: '红包礼金', icon: 'gift',   color: '#FF6B9D', children: [] },
  { name: '二手出售', icon: 'more',   color: '#EE0A24', children: [] },
  { name: '退款返还', icon: 'refund', color: '#26A69A', children: [] },
  { name: '父母补贴', icon: 'money',  color: '#FFD60A', children: [] }
]

/**
 * ★ 注意：「奖金补贴」既是「工资」的二级，也是一个独立的一级 ★
 *   这是用户给的分类结构本身如此（截图里就是这样），不是笔误，原样保留。
 *
 *   影响：速记解析遇到「奖金补贴」时，按「同名二级优先」的既有规则
 *   会落到「工资/奖金补贴」上（api/aiParse.js 的 matchCategory）。
 *   给模型看的候选列表里两者是不同标签（"工资/奖金补贴" 和 "奖金补贴"），
 *   模型选完整路径时能精确命中独立的那个。

/**
 * 分类别名 —— 速记解析用，可在分类管理里扩展
 *
 * ★ 键名要和 DEFAULT_*_CATEGORIES 里的一级分类名对齐 ★
 *   一级分类改名后，这里的键也要跟着改，否则速记的别名就失配了。
 */
export const DEFAULT_ALIAS = {
  餐饮食品: ['吃', '吃饭', '外卖', '午饭', '晚饭', '早餐', '奶茶', '咖啡', '下馆子', '喝', '饭', '零食', '超市'],
  交通出行: ['打车', '地铁', '公交', '加油', '停车', '高铁', '飞机', '滴滴', '车费', '火车'],
  居住住房: ['房租', '房贷', '物业', '燃气', '宽带', '交租', '水费', '电费', '话费', '网费'],
  购物消费: ['买', '淘宝', '京东', '拼多多', '超市', '购物', '日用品', '服饰', '数码'],
  医疗健康: ['药', '挂号', '看病', '体检', '健身', '医保', '社保'],
  社交娱乐: ['电影', '游戏', '会员', '续费', '旅游', '唱歌', '团建', '聚会'],
  学校学习: ['书', '课程', '培训', '考试', '学费', '文具', '资料'],
  人情往来: ['红包', '礼物', '请客', '份子', '随份子', '送礼'],
  '其他/杂项': ['其他', '杂项', '别的'],
  工资: ['工资', '发工资', '月薪', '薪水', '底薪'],
  奖金补贴: ['奖金', '年终奖', '补贴', '津贴', '加班费'],
  副业劳务: ['稿费', '项目款', '外快', '兼职', '劳务'],
  租金收入: ['房租收入', '租金', '出租'],
  投资收益: ['利息', '分红', '收益', '基金', '股票'],
  红包礼金: ['收到红包', '礼金', '压岁钱'],
  二手出售: ['二手', '卖掉', '闲鱼', '转卖'],
  退款返还: ['报销', '退款', '返还', '退钱'],
  父母补贴: ['爸妈', '父母', '家里给', '家用']
}

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

/** 删除分类 —— 若有交易引用则拒绝，避免统计口径断裂 */
export async function deleteCategory(id) {
  // ★ 固定分类（对账支出 / 对账收入）不允许删 ★
  //   UI 层已经拦了一道，这里是 API 层的兜底。
  const target = await getCategory(id)
  if (target && isReconcileCategory(target)) {
    throw new Error(`「${target.name}」是固定分类，不能删除`)
  }

  const used = await queryOne(
    'SELECT COUNT(*) AS c FROM txn WHERE category_id = ? AND deleted_at IS NULL',
    [id]
  )
  if (Number(used ? used.c : 0) > 0) {
    throw new Error(`该分类下有 ${used.c} 笔交易，请先改分类或隐藏它`)
  }
  const children = await queryOne(
    'SELECT COUNT(*) AS c FROM category WHERE parent_id = ? AND deleted_at IS NULL',
    [id]
  )
  if (Number(children ? children.c : 0) > 0) {
    throw new Error('请先删除该分类下的子分类')
  }
  const now = Date.now()
  await execute('UPDATE category SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id])
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

/** 写入默认分类（仅当分类表为空） */
export async function seedDefaultCategories() {
  const count = await queryOne('SELECT COUNT(*) AS c FROM category WHERE deleted_at IS NULL')
  if (Number(count ? count.c : 0) > 0) return 0

  const now = Date.now()
  let n = 0

  await transaction(async () => {
    for (const type of ['expense', 'income']) {
      const list = type === 'expense' ? DEFAULT_EXPENSE_CATEGORIES : DEFAULT_INCOME_CATEGORIES
      for (let i = 0; i < list.length; i++) {
        const item = list[i]
        const parentId = prefixedId('cat')
        await execute(
          `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
          [parentId, null, item.name, type, item.icon, item.color, i, now, now]
        )
        n++

        for (let j = 0; j < item.children.length; j++) {
          await execute(
            `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
             VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
            [prefixedId('cat'), parentId, item.children[j], type, item.icon, item.color, j, now, now]
          )
          n++
        }
      }
    }
  })

  return n
}
