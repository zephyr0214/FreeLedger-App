/**
 * 标签（= 「项目」）服务
 * 一条交易可挂多个标签，统计页的「项目统计」按标签聚合。
 */

import { query, queryOne, execute, transaction } from './db/index.js'
import { prefixedId } from '../utils/id.js'

function normalizeTag(row) {
  return {
    ...row,
    sort: Number(row.sort) || 0,
    archived: Number(row.archived) === 1
  }
}

export async function listTags(includeArchived = false) {
  const rows = await query(
    includeArchived
      ? 'SELECT * FROM tag WHERE deleted_at IS NULL ORDER BY sort ASC, created_at ASC'
      : 'SELECT * FROM tag WHERE deleted_at IS NULL AND archived = 0 ORDER BY sort ASC, created_at ASC'
  )
  return rows.map(normalizeTag)
}

export async function getTag(id) {
  const row = await queryOne('SELECT * FROM tag WHERE id = ? AND deleted_at IS NULL', [id])
  return row ? normalizeTag(row) : null
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
