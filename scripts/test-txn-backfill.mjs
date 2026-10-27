/**
 * 历史记录时刻回填的测试（用 node:sqlite 跑真实 SQL）
 *
 *   node scripts/test-txn-backfill.mjs
 *
 * 背景：
 *   旧逻辑把时刻写死成 12:00，历史数据全是 12:00。
 *   迁移 v2 用 created_at 回填，但只在「occurred_day 等于创建那天」时才回填。
 *
 *   注意：真实 App 端用 plus.sqlite，这里用 node:sqlite 验证同样的 SQL 与判定逻辑。
 */

import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'module'

let pass = 0
let fail = 0

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    fail++
    console.log(`FAIL  ${name}\n      实际 ${a}\n      期望 ${e}`)
  }
}

const db = new DatabaseSync(':memory:')
db.exec(`CREATE TABLE txn (
  id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  occurred_day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
)`)

/** 与 api/db/index.js 的 fixNoonTimestamps 同样的判定与回填逻辑 */
async function fixNoonTimestamps(rows, update) {
  let fixed = 0
  for (const r of rows) {
    const occ = Number(r.occurred_at) || 0
    const created = Number(r.created_at) || 0
    if (!occ || !created) continue

    const occDate = new Date(occ)
    if (occDate.getHours() !== 12 || occDate.getMinutes() > 1) continue

    const c = new Date(created)
    const cDay = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`
    if (cDay !== r.occurred_day) continue

    const fixedTs = new Date(
      occDate.getFullYear(), occDate.getMonth(), occDate.getDate(),
      c.getHours(), c.getMinutes(), c.getSeconds(), 0
    ).getTime()

    await update(r.id, fixedTs)
    fixed++
  }
  return fixed
}

const noon = (day) => new Date(`${day}T12:00:00`).getTime()
const at = (day, h, m) => new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime()

console.log('=== 回填判定 ===')

const rows = [
  // 今天记的：12:00 -> 应回填成创建时刻 09:15
  { id: 'a', occurred_at: noon('2026-10-27'), occurred_day: '2026-10-27', created_at: at('2026-10-27', 9, 15) },
  // 补记昨天：创建日 != 记账日 -> 不动
  { id: 'b', occurred_at: noon('2026-10-26'), occurred_day: '2026-10-26', created_at: at('2026-10-27', 9, 20) },
  // 本来就不是 12:00（比如 AI 识别出 20:30）-> 不动
  { id: 'c', occurred_at: at('2026-10-27', 20, 30), occurred_day: '2026-10-27', created_at: at('2026-10-27', 21, 0) },
  // 12:01 也算「12点」(容忍漂移) -> 回填
  { id: 'd', occurred_at: new Date('2026-10-27T12:01:00').getTime(), occurred_day: '2026-10-27', created_at: at('2026-10-27', 8, 5) },
  // 12:30 不算 -> 不动
  { id: 'e', occurred_at: new Date('2026-10-27T12:30:00').getTime(), occurred_day: '2026-10-27', created_at: at('2026-10-27', 8, 5) }
]

const updates = new Map()
const fixedCount = await fixNoonTimestamps(rows, (id, ts) => { updates.set(id, ts) })

check('回填了2条', fixedCount, 2)
check('回填的id', [...updates.keys()].sort(), ['a', 'd'])

const a = new Date(updates.get('a'))
check('a 回填后小时', a.getHours(), 9)
check('a 回填后分钟', a.getMinutes(), 15)
check('a 回填后日期不变', a.getDate(), 27)

const d = new Date(updates.get('d'))
check('d 回填后小时', d.getHours(), 8)
check('d 回填后分钟', d.getMinutes(), 5)

console.log('=== 跨月边界 ===')

// 12月31日 23:50 创建，记账日也是 12-31
const rows2 = [
  { id: 'x', occurred_at: noon('2026-12-31'), occurred_day: '2026-12-31', created_at: at('2026-12-31', 23, 50) }
]
const u2 = new Map()
const f2 = await fixNoonTimestamps(rows2, (id, ts) => { u2.set(id, ts) })
check('跨月回填1条', f2, 1)
const x = new Date(u2.get('x'))
check('跨月仍是12-31', x.getDate(), 31)
check('跨月月仍是12', x.getMonth() + 1, 12)
check('跨月时间是23:50', [x.getHours(), x.getMinutes()], [23, 50])

console.log('=== 空表 / 边界 ===')

check('空表回填0条', await fixNoonTimestamps([], () => {}), 0)
check('occurred_at=0 跳过', await fixNoonTimestamps(
  [{ id: 'z', occurred_at: 0, occurred_day: '2026-10-27', created_at: at('2026-10-27', 9, 0) }],
  () => {}
), 0)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
