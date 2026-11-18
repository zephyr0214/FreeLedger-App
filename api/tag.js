/**
 * 标签（= 「项目」）服务
 * 一条交易可挂多个标签，统计页的「项目统计」按标签聚合。
 */

import { query, queryOne, execute, transaction } from './db/index.js'
import { prefixedId } from '../utils/id.js'

function normalizeTag(row) {
  const income = Number(row.income_cents) || 0
  const expense = Number(row.expense_cents) || 0
  return {
    ...row,
    sort: Number(row.sort) || 0,
    archived: Number(row.archived) === 1,
    /*
     * 标签列表的派生字段
     *
     * ★ 笔数含全部流水，结余只算收支 ★
     *   用户明确要求：借入/借出这类「不计收支」的流水也要算「用过这个标签」，
     *   所以 txn_count 统计所有未删除关联流水；金额只累计
     *   exclude_from_stats = 0 的收入/支出，避免借款把结余带偏。
     */
    txn_count: Number(row.txn_count) || 0,
    income_cents: income,
    expense_cents: expense,
    balance_cents: income - expense,
    last_day: row.last_day ? String(row.last_day) : ''
  }
}

/**
 * 标签列表（附带使用统计，并按最近使用时间倒序）
 *
 * ★ 为什么在 API 层排序而不是页面各排各的 ★
 *   标签管理页和所有标签选择面板（记账、筛选、右滑、批量）都调用
 *   这一个函数。在这里排一次，所有入口顺序天然一致；
 *   交给页面排会出现「管理页按最近用、选择面板还是创建顺序」的分叉。
 *
 * ★ 没有流水的标签排最后 ★
 *   新标签还没用过，不该插在常用标签中间。
 */
export async function listTags(includeArchived = false) {
  const rows = await query(
    `SELECT tg.*,
            COUNT(t.id) AS txn_count,
            COALESCE(SUM(CASE WHEN t.type = 'income'
                               AND COALESCE(t.exclude_from_stats, 0) = 0
                              THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
            COALESCE(SUM(CASE WHEN t.type = 'expense'
                               AND COALESCE(t.exclude_from_stats, 0) = 0
                              THEN t.amount_cents ELSE 0 END), 0) AS expense_cents,
            MAX(t.occurred_day) AS last_day
       FROM tag tg
       LEFT JOIN txn_tag tt ON tt.tag_id = tg.id
       LEFT JOIN txn t ON t.id = tt.txn_id AND t.deleted_at IS NULL
      WHERE tg.deleted_at IS NULL${includeArchived ? '' : ' AND tg.archived = 0'}
      GROUP BY tg.id
      ORDER BY CASE WHEN MAX(t.occurred_day) IS NULL THEN 1 ELSE 0 END,
               MAX(t.occurred_day) DESC,
               tg.sort ASC,
               tg.created_at ASC`
  )
  return rows.map(normalizeTag)
}

export async function getTag(id) {
  const row = await queryOne('SELECT * FROM tag WHERE id = ? AND deleted_at IS NULL', [id])
  return row ? normalizeTag(row) : null
}

/**
 * 某标签关联流水的汇总信息（笔数 + 最早 / 最晚记录日期）
 *
 * 标签详情页要显示「2026年1月5日 - 2026年11月17日」。
 * 直接在 SQL 里取 COUNT/MIN/MAX，比拉全量流水再首尾取日期省内存；
 * 口径是「所有未删除关联流水」，与标签管理页的最近使用时间一致。
 * 金额（收入/支出）仍由 sumTransactions 提供，那边会排除不计收支。
 */
export async function getTagTxnRange(tagId) {
  const row = await queryOne(
    `SELECT COUNT(*) AS count,
            MIN(t.occurred_day) AS first_day,
            MAX(t.occurred_day) AS last_day
       FROM txn_tag tt
       JOIN txn t ON t.id = tt.txn_id AND t.deleted_at IS NULL
      WHERE tt.tag_id = ?`,
    [tagId]
  )
  return {
    count: row ? Number(row.count) || 0 : 0,
    firstDay: row && row.first_day ? String(row.first_day) : '',
    lastDay: row && row.last_day ? String(row.last_day) : ''
  }
}



export async function createTag(input) {
  const now = Date.now()
  const id = input.id || prefixedId('tag')
  const sort = input.sort !== undefined ? input.sort : await nextSort()

  await execute(
    `INSERT INTO tag (id, name, color, sort, archived, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,0,?,?,NULL)`,
    [id, input.name, input.color || null, sort, now, now]
  )
  return getTag(id)
}

export async function updateTag(id, patch) {
  const existing = await getTag(id)
  if (!existing) throw new Error('标签不存在')

  const fields = []
  const params = []
  const assign = (col, val) => { fields.push(`${col} = ?`); params.push(val) }

  if (patch.name !== undefined) assign('name', patch.name)
  if (patch.color !== undefined) assign('color', patch.color)
  if (patch.sort !== undefined) assign('sort', patch.sort)
  if (patch.archived !== undefined) assign('archived', patch.archived ? 1 : 0)
  assign('updated_at', Date.now())
  params.push(id)

  await execute(`UPDATE tag SET ${fields.join(', ')} WHERE id = ?`, params)
  return getTag(id)
}

export async function deleteTag(id) {
  const now = Date.now()
  await transaction(async () => {
    await execute('DELETE FROM txn_tag WHERE tag_id = ?', [id])
    await execute('UPDATE tag SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id])
  })
  return true
}

async function nextSort() {
  const row = await queryOne('SELECT COALESCE(MAX(sort), -1) AS m FROM tag WHERE deleted_at IS NULL')
  return Number(row ? row.m : -1) + 1
}
