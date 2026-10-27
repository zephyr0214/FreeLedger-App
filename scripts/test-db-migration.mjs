/**
 * 数据库迁移的死锁回归测试
 *
 *   node scripts/test-db-migration.mjs
 *
 * 背景（踩过的坑）：
 *   迁移 v2（回填历史记录的时刻）里用了 query()/execute()。
 *   而 query()/execute() 内部会 await openDb()，
 *   迁移本身又是在 openDb() -> migrate() 里跑的：
 *
 *     openDb()            <- opening 这个 Promise 还没 resolve
 *       -> migrate()
 *         -> fixNoonTimestamps()
 *           -> query()  -> await openDb()  <- 等自己，死锁
 *
 *   结果是整个数据库永远打不开，所有页面查不到数据
 *   （表现就是「分类读没了」「账户不见了」）。
 *
 *   修法：迁移内部一律用底层的 call()，绕开 openDb()；
 *   并且 migrate() 对单条迁移加 try/catch，迁移失败也不挡住开库。
 *
 * ★ 这个测试直接驱动真实的 api/db/index.js ★
 *   复刻一份逻辑的话测不出「迁移里用了 query()」这种问题，
 *   只有跑真模块才能验证迁移内部确实绕开了 openDb()。
 */

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

/**
 * 造一个假的 plus.sqlite
 * @param {object} opts { userVersion, selectFail, execFail }
 */
function makeFakePlus(opts = {}) {
  const log = []
  const fake = {
    sqlite: {
      openDatabase: ({ success }) => { log.push('open'); success && success() },
      closeDatabase: ({ success }) => { log.push('close'); success && success() },

      selectSql: ({ sql, success, fail }) => {
        if (sql.indexOf('PRAGMA user_version') !== -1) {
          log.push('user_version')
          success && success([{ user_version: opts.userVersion === undefined ? 1 : opts.userVersion }])
          return
        }
        log.push('select:' + sql.slice(0, 45))
        if (opts.selectFail) { fail && fail({ message: 'select failed' }); return }
        // 模拟一条「12:00 且创建于同天」的记录
        const day = '2026-10-27'
        success && success([{
          id: 't1',
          occurred_at: new Date(`${day}T12:00:00`).getTime(),
          occurred_day: day,
          created_at: new Date(`${day}T09:15:00`).getTime()
        }])
      },

      executeSql: ({ sql, success, fail }) => {
        log.push('exec:' + sql.slice(0, 45))
        if (opts.execFail) { fail && fail({ message: 'exec failed' }); return }
        success && success()
      },

      transaction: ({ operation, success }) => { log.push('tx:' + operation); success && success() }
    }
  }
  return { fake, log }
}

/** 装上假的 plus，导入真实的 db 模块（每次全新实例） */
async function loadRealDb(fake) {
  globalThis.plus = fake
  const mod = await import('../api/db/index.js?t=' + Math.random())
  return mod
}

console.log('=== 真实模块：openDb -> migrate 不能死锁 ===')

// --- 正常情况 ---
{
  const { fake, log } = makeFakePlus()
  const db = await loadRealDb(fake)

  const result = await Promise.race([
    db.query('SELECT * FROM category').then(() => 'OK').catch((e) => 'ERROR:' + e.message),
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 2000))
  ])

  check('查询没有死锁', result, 'OK')
  check('跑到了 v2 迁移', log.some((l) => l.indexOf('select:SELECT id, occurred_at') === 0), true)
  check('回填执行了 UPDATE', log.some((l) => l.indexOf('exec:UPDATE txn SET occurred_at') === 0), true)
  check('版本被写回', log.some((l) => l.indexOf('exec:PRAGMA user_version') === 0), true)
}

// --- 迁移里 select 失败：不能挡住开库 ---
{
  const { fake, log } = makeFakePlus({ selectFail: true })
  const db = await loadRealDb(fake)

  const result = await Promise.race([
    db.openDb().then(() => 'OPENED').catch((e) => 'ERROR:' + e.message),
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 2000))
  ])

  check('迁移失败时仍能开库', result, 'OPENED')
  check('版本仍被推进', log.some((l) => l.indexOf('exec:PRAGMA user_version') === 0), true)
}

// --- 已经是 v2：不重复迁移 ---
{
  const { fake, log } = makeFakePlus({ userVersion: 2 })
  const db = await loadRealDb(fake)

  const result = await Promise.race([
    db.openDb().then(() => 'OPENED').catch((e) => 'ERROR:' + e.message),
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 2000))
  ])

  check('v2 时能开库', result, 'OPENED')
  check('不再跑回填', log.some((l) => l.indexOf('select:SELECT id, occurred_at') === 0), false)
}

// --- 迁移里 exec 失败：不能挡住开库 ---
{
  const { fake } = makeFakePlus({ execFail: true })
  const db = await loadRealDb(fake)

  const result = await Promise.race([
    db.openDb().then(() => 'OPENED').catch((e) => 'ERROR:' + e.message),
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 2000))
  ])

  check('UPDATE 失败时仍能开库', result, 'OPENED')
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
