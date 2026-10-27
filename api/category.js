/**
 * 分类服务 —— 支持一级/二级，一级作为统计聚合口径
 */

import { query, queryOne, execute, transaction } from './db/index.js'
import { prefixedId } from '../utils/id.js'

/** 初始化用的默认分类（仅在首次启动时写入） */
/**
 * 默认分类。
 * icon 字段的取值必须是 utils/icons.js 里 ICON_MAP 的键。
 * 二级分类不单独配 icon，直接继承父级的（父级有就用父级的）。
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: '餐饮', icon: 'food',  color: '#FF976A', children: ['早餐', '午餐', '晚餐', '外卖', '零食饮料', '咖啡奶茶'] },
  { name: '交通', icon: 'car',   color: '#1989FA', children: ['公交地铁', '打车', '加油', '停车', '高铁飞机'] },
  { name: '购物', icon: 'shop',  color: '#EE0A24', children: ['日用', '服饰', '数码', '美妆', '家居'] },
  { name: '居住', icon: 'home',  color: '#7D5FFF', children: ['房租', '水电', '燃气', '物业', '宽带'] },
  { name: '娱乐', icon: 'game',  color: '#07C160', children: ['电影', '游戏', '旅行', '演出', '会员订阅'] },
  { name: '医疗', icon: 'medical', color: '#FF8F1F', children: ['门诊', '药品', '体检', '保险'] },
  { name: '教育', icon: 'book',  color: '#0A8F4A', children: ['书籍', '课程', '考试'] },
  { name: '人情', icon: 'gift',  color: '#FF6B9D', children: ['红包', '礼物', '请客'] },
  { name: '其他', icon: 'more',  color: '#969799', children: [] }
]

export const DEFAULT_INCOME_CATEGORIES = [
  { name: '工资', icon: 'money', color: '#07C160', children: ['月薪', '加班费', '年终奖'] },
  { name: '理财', icon: 'chart', color: '#1989FA', children: ['利息', '分红', '基金收益'] },
  { name: '兼职', icon: 'work',  color: '#7D5FFF', children: ['项目款', '稿费'] },
  { name: '红包', icon: 'gift',  color: '#FF6B9D', children: ['收到红包', '报销', '退款'] },
  { name: '其他', icon: 'more',  color: '#969799', children: [] }
]

/** 分类别名 —— 速记解析用，可在分类管理里扩展 */
export const DEFAULT_ALIAS = {
  餐饮: ['吃', '吃饭', '外卖', '午饭', '晚饭', '早餐', '奶茶', '咖啡', '下馆子', '喝', '饭'],
  交通: ['打车', '地铁', '公交', '加油', '停车', '高铁', '滴滴', '车费'],
  购物: ['买', '淘宝', '京东', '拼多多', '超市', '购物'],
  居住: ['房租', '水电', '物业', '燃气', '宽带', '交租'],
  娱乐: ['电影', '游戏', '会员', '续费', '健身', '演唱会'],
  医疗: ['药', '挂号', '看病', '体检'],
  教育: ['书', '课程', '培训', '考试'],
  人情: ['红包', '礼物', '请客', '份子'],
  工资: ['工资', '发工资', '月薪', '薪水'],
  理财: ['利息', '分红', '收益'],
  兼职: ['稿费', '项目款', '外快'],
  红包: ['报销', '退款', '收到']
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
