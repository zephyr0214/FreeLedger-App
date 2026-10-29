/**
 * 备份 / 导入：周期（cycle）数据
 *
 *   node scripts/test-backup-cycle.mjs
 *
 * ★ 这次要锁住的需求 ★
 *   用户要求「导入导出备份要覆盖新增的周期数据」，
 *   同时「导入必须兼容旧版本（不含 cycle）的备份」。
 *
 * 这个测试不依赖真机 plus.io / SQLite，只在进程内用桩替换
 * db / account / settings / id 的导入，把 backup.js 当成 CommonJS
 * 编译后，验证：
 *   1. importPayload 处理「含 cycles」的新备份时，cycle 被正确写入；
 *   2. importPayload 处理「不含 cycles 的旧备份」时，整条链路不报错
 *      （即 payload.cycles 缺失时走 Array.isArray 守卫，向后兼容）；
 *   3. 交易的 cycle_id 列在导入时被保留。
 */

let pass = 0
let fail = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`FAIL  ${name}\n      实际 ${a}\n      期望 ${e}`)
  }
}

const inserted = { cycle: [], txn: [] }
const fakeDb = {
  async query() { return [] },
  async queryOne() { return null },
  async execute(sql, params) {
    if (sql.startsWith('INSERT INTO cycle')) inserted.cycle.push(params)
    if (sql.startsWith('INSERT INTO txn')) inserted.txn.push(params)
    return { rowsAffected: 1 }
  },
  async transaction(fn) { return fn() },
  async truncateAll() { return true }
}
const fakeAccount = { recalcAllBalances: async () => true }
const fakeSettings = {
  getAllSettings: async () => ({ ai: { apiKey: '' } }),
  setSettings: async () => true,
  clearSettingsCache() {}
}
const fakeId = { prefixedId: (p) => `${p}_stub` }

const { Module } = await import('module')
const path = await import('path')
const fs = await import('fs')

const backupPath = path.resolve('api/backup.js')
let src = fs.readFileSync(backupPath, 'utf8')

// 1) 把 platform 依赖的静态 import 替换成桩
src = src.replace(
  /import\s*\{[^}]*\}\s*from\s*'\.\/db\/index\.js'/,
  `const { query, queryOne, execute, transaction, truncateAll } = globalThis.__STUB_DB__;`
)
src = src.replace(
  /import\s*\{[^}]*\}\s*from\s*'\.\/account\.js'/,
  `const { recalcAllBalances } = globalThis.__STUB_ACC__;`
)
src = src.replace(
  /import\s*\{[^}]*\}\s*from\s*'\.\/settings\.js'/,
  `const { getAllSettings, setSettings, clearSettingsCache } = globalThis.__STUB_SET__;`
)
src = src.replace(
  /import\s*\{[^}]*\}\s*from\s*'\.\.\/utils\/id\.js'/,
  `const { prefixedId } = globalThis.__STUB_ID__;`
)

// 2) 把 ESM export 改成 CommonJS 导出，使文件能在 Node 里用 _compile 加载
src = src.replace(/export\s+async\s+function\s+(\w+)/g, 'module.exports.$1 = async function $1')
src = src.replace(/export\s+function\s+(\w+)/g, 'module.exports.$1 = function $1')
src = src.replace(/export\s+const\s+(\w+)/g, 'module.exports.$1 =')

globalThis.__STUB_DB__ = fakeDb
globalThis.__STUB_ACC__ = fakeAccount
globalThis.__STUB_SET__ = fakeSettings
globalThis.__STUB_ID__ = fakeId

const m = new Module(backupPath, null)
m.filename = backupPath
m.paths = Module._nodeModulePaths(path.dirname(backupPath))
m._compile(src, backupPath)
const backup = m.exports

console.log('=== 旧版本备份（无 cycles）向后兼容 ===')
{
  const oldPayload = {
    app: 'books',
    schemaVersion: 1,
    settings: { ai: { apiKey: '' } },
    accounts: [],
    categories: [],
    tags: [],
    transactions: [
      { id: 't1', type: 'expense', amount_cents: 100, account_id: 'a1', occurred_at: 1, occurred_day: '2026-01-01', month_key: '2026-01', year_key: '2026' }
    ],
    txnTags: [],
    budgets: []
  }
  let err = null
  try {
    await backup.importPayload(oldPayload, { mode: 'merge', skipBeforeBackup: true })
  } catch (e) { err = e }
  check('旧备份导入不报错', err === null, true)
  check('旧备份交易写入 1 条', inserted.txn.length, 1)
  check('旧备份交易 cycle_id 补为 null', inserted.txn[0][14], null)
  check('旧备份不产生任何 cycle 写入', inserted.cycle.length, 0)
}

console.log('=== 新版本备份（含 cycles）可导入 ===')
{
  inserted.cycle.length = 0
  inserted.txn.length = 0
  const newPayload = {
    app: 'books',
    schemaVersion: 2,
    settings: { ai: { apiKey: '' } },
    accounts: [{ id: 'a1', name: '现金', type: 'cash', balance_cents: 0 }],
    categories: [],
    tags: [],
    transactions: [
      { id: 't1', type: 'expense', amount_cents: 100, account_id: 'a1', occurred_at: 1, occurred_day: '2026-01-01', month_key: '2026-01', year_key: '2026', cycle_id: 'c1' }
    ],
    txnTags: [],
    budgets: [],
    cycles: [
      { id: 'c1', type: 'expense', amount_cents: 100, account_id: 'a1', recurrence: 'monthly', day_of_month: 1, last_caught_up_day: '2026-01-01' }
    ]
  }
  let err = null
  try {
    await backup.importPayload(newPayload, { mode: 'merge', skipBeforeBackup: true })
  } catch (e) { err = e }
  check('新备份导入不报错', err === null, true)
  check('cycle 被写入 1 条', inserted.cycle.length, 1)
  check('写入的 cycle id 正确', inserted.cycle[0][0], 'c1')
  check('写入的 cycle recurrence 正确', inserted.cycle[0][7], 'monthly')
  check('交易带上了 cycle_id', inserted.txn[0][14], 'c1')
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
