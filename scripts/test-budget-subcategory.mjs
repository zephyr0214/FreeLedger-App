/**
 * 月预算结转 & 子预算多类别（v18）的测试
 *
 *   node scripts/test-budget-subcategory.mjs
 *
 * ★ 这个测试守什么 ★
 *   1. 结转口径：逐月累计、只结转正数
 *        - 没花完 -> 结转到下月
 *        - 超支   -> 结转 0（不透支下月额度）
 *        - 连续几个月花得少 -> 额度一直在账上（不是只看上一个月）
 *        - 没开结转 / 起始月当月 -> 结转 0
 *   2. 一条子预算挂多个类别时，「已用」= 各挂载类别支出之和
 *        - 二级类别只算自己
 *        - 一级类别算整棵子树
 *        - 不会因为「同一个一类 id 既在 root 又在 leaf」而重复或漏算
 *   3. 迁移 v18：budget.name 列 + budget_category 表 + 老数据回填（幂等）
 *   4. 额度分配的口径：可分配池 = 月预算的「原本额度」，不含结转
 *
 * 用 node:sqlite 造真库跑聚合 SQL（和 scripts/test-budget-usage-leaf.mjs 同一套路），
 * 纯函数直接 import api/budget.js —— 不碰 plus.sqlite，node 下能跑。
 */

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { computeMonthAvailability, summarizeAllocation, checkCategoryAllocation } from '../api/budget.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8')

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

/* ================================================== 1. 结转：逐月累计 */

console.log('=== 结转：逐月累计、只结转正数 ===')

{
  // 3 月起始，每月额度 1000 元
  const monthly = 100000

  // 每月都花光 -> 结转始终 0
  check(
    '每月花光：结转 0',
    computeMonthAvailability({
      monthly,
      startMonth: '2026-03',
      monthKey: '2026-04',
      usedByMonth: { '2026-03': monthly },
      rollover: true
    }),
    { carryover: 0, available: monthly }
  )

  // 3 月只花 200 -> 结余 800 带到 4 月
  check(
    '上月结余结转到本月',
    computeMonthAvailability({
      monthly,
      startMonth: '2026-03',
      monthKey: '2026-04',
      usedByMonth: { '2026-03': 20000 },
      rollover: true
    }),
    { carryover: 80000, available: 180000 }
  )

  // 3 月超支 500 -> 结转 0，绝不透支 4 月
  check(
    '超支只结转 0（不透支下月）',
    computeMonthAvailability({
      monthly,
      startMonth: '2026-03',
      monthKey: '2026-04',
      usedByMonth: { '2026-03': 150000 },
      rollover: true
    }),
    { carryover: 0, available: monthly }
  )

  // 连续三个月都只花一半 -> 累计结转（只看上一月的话只会剩 50000）
  check(
    '连续多月的结余一直累计',
    computeMonthAvailability({
      monthly,
      startMonth: '2026-01',
      monthKey: '2026-04',
      usedByMonth: {
        '2026-01': 50000,
        '2026-02': 50000,
        '2026-03': 50000
      },
      rollover: true
    }),
    { carryover: 150000, available: monthly + 150000 }
  )

  // 中间某月超支，把之前攒的额度吃掉，但不产生负结转
  check(
    '中间超支先吃掉已攒额度，不吃成负数',
    computeMonthAvailability({
      monthly,
      startMonth: '2026-01',
      monthKey: '2026-04',
      usedByMonth: {
        '2026-01': 20000,  // 结余 80000
        '2026-02': 150000, // 80000+100000-150000 = 30000（吃掉攒的额度，不吃成负数）
        '2026-03': 0       // 30000+100000-0 = 130000
      },
      rollover: true
    }),
    { carryover: 130000, available: monthly + 130000 }
  )
}

console.log('=== 结转：不开启 / 未到起始月 ===')

{
  check(
    '没开结转：永远 0',
    computeMonthAvailability({
      monthly: 100000,
      startMonth: '2026-01',
      monthKey: '2026-06',
      usedByMonth: { '2026-01': 0 },
      rollover: false
    }),
    { carryover: 0, available: 100000 }
  )

  check(
    '起始月本身没有结转',
    computeMonthAvailability({
      monthly: 100000,
      startMonth: '2026-03',
      monthKey: '2026-03',
      usedByMonth: {},
      rollover: true
    }),
    { carryover: 0, available: 100000 }
  )

  check(
    '目标月早于起始月：当作没结转',
    computeMonthAvailability({
      monthly: 100000,
      startMonth: '2026-05',
      monthKey: '2026-04',
      usedByMonth: {},
      rollover: true
    }),
    { carryover: 0, available: 100000 }
  )

  check(
    '跨年结转（12 月 -> 次年 1 月）',
    computeMonthAvailability({
      monthly: 100000,
      startMonth: '2025-12',
      monthKey: '2026-01',
      usedByMonth: { '2025-12': 30000 },
      rollover: true
    }),
    { carryover: 70000, available: 170000 }
  )

  check(
    '空输入不炸',
    computeMonthAvailability({}).available,
    0
  )
}

/* ======================================== 2. 多类别子预算的「已用」口径 */

console.log('=== 多类别子预算：已用 = 各挂载类别之和 ===')

const db = new DatabaseSync(':memory:')

db.exec(`CREATE TABLE category (
  id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL, type TEXT NOT NULL,
  icon TEXT, color TEXT, sort INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, deleted_at INTEGER
)`)
db.exec(`CREATE TABLE txn (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  account_id TEXT NOT NULL, category_id TEXT,
  occurred_at INTEGER NOT NULL, occurred_day TEXT NOT NULL,
  month_key TEXT NOT NULL, year_key TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  deleted_at INTEGER, exclude_from_budget INTEGER NOT NULL DEFAULT 0
)`)
db.exec(`CREATE TABLE budget (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, category_id TEXT, name TEXT,
  period TEXT NOT NULL DEFAULT 'month', amount_cents INTEGER NOT NULL,
  start_month TEXT NOT NULL, rollover INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
)`)
db.exec(`CREATE TABLE budget_category (
  budget_id TEXT NOT NULL, category_id TEXT NOT NULL,
  PRIMARY KEY (budget_id, category_id)
)`)

const now = Date.now()
const insCat = db.prepare(
  `INSERT INTO category (id,parent_id,name,type,icon,color,sort,hidden,created_at,updated_at,deleted_at)
   VALUES (?,?,?,'expense','more','#999',0,0,?,?,NULL)`
)
// 餐饮食品（一级）下挂 日常三餐 / 奶茶饮料；交通出行（一级）下挂 打车；娱乐（一级）没有二级
insCat.run('c_food', null, '餐饮食品', now, now)
insCat.run('c_meal', 'c_food', '日常三餐', now, now)
insCat.run('c_drink', 'c_food', '奶茶饮料', now, now)
insCat.run('c_traffic', null, '交通出行', now, now)
insCat.run('c_taxi', 'c_traffic', '打车', now, now)
insCat.run('c_fun', null, '娱乐', now, now)

const insTxn = db.prepare(
  `INSERT INTO txn (id,type,amount_cents,account_id,category_id,occurred_at,
    occurred_day,month_key,year_key,created_at,updated_at,deleted_at,exclude_from_budget)
   VALUES (?,'expense',?,'acc1',?,?,'2026-10-05','2026-10','2026',?,?,NULL,?)`
)
insTxn.run('t1', 3000, 'c_meal', now, now, now, 0)
insTxn.run('t2', 4000, 'c_meal', now, now, now, 0)
insTxn.run('t3', 2000, 'c_drink', now, now, now, 0)
insTxn.run('t4', 5000, 'c_taxi', now, now, now, 0)
insTxn.run('t5', 1500, 'c_fun', now, now, now, 0)
insTxn.run('t6', 7777, 'c_meal', now, now, now, 1) // 不计入预算

/* 子预算 A：日常三餐（二级）+ 打车（二级） */
db.prepare('INSERT INTO budget (id,scope,category_id,name,amount_cents,start_month,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
  .run('b_sub', 'category', 'c_meal', '吃饭和通勤', 50000, '2026-10', now, now)
db.prepare('INSERT INTO budget_category (budget_id, category_id) VALUES (?,?)').run('b_sub', 'c_meal')
db.prepare('INSERT INTO budget_category (budget_id, category_id) VALUES (?,?)').run('b_sub', 'c_taxi')

/* 子预算 B：餐饮食品（一级，整棵子树） */
db.prepare('INSERT INTO budget (id,scope,category_id,name,amount_cents,start_month,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
  .run('b_root', 'category', 'c_food', null, 30000, '2026-10', now, now)
db.prepare('INSERT INTO budget_category (budget_id, category_id) VALUES (?,?)').run('b_root', 'c_food')

/* 复刻 api/stats.js 的口径：root / leaf 两套 map + parentIds 判定 */
const catRows = db.prepare(
  `SELECT COALESCE(c.parent_id, c.id) AS root_id,
          t.category_id AS leaf_id,
          SUM(t.amount_cents) AS amt
   FROM txn t LEFT JOIN category c ON c.id = t.category_id
   WHERE t.deleted_at IS NULL AND t.type='expense' AND t.month_key = ?
     AND COALESCE(t.exclude_from_budget, 0) = 0
   GROUP BY root_id, leaf_id`
).all('2026-10')

const catMapRoot = {}
const catMapLeaf = {}
catRows.forEach((r) => {
  const amt = Number(r.amt) || 0
  if (r.root_id) catMapRoot[r.root_id] = (catMapRoot[r.root_id] || 0) + amt
  if (r.leaf_id) catMapLeaf[r.leaf_id] = (catMapLeaf[r.leaf_id] || 0) + amt
})
const parentIds = new Set()
catRows.forEach((r) => {
  if (r.root_id && r.root_id === r.leaf_id) parentIds.add(r.root_id)
})
const usedOf = (id) => {
  if (!id) return 0
  if (parentIds.has(id)) return catMapRoot[id] || 0
  return catMapLeaf[id] !== undefined ? catMapLeaf[id] : (catMapRoot[id] || 0)
}

/** 某条子预算的已用 = 它挂的所有类别之和 */
function usedOfBudget(budgetId) {
  const cats = db.prepare('SELECT category_id FROM budget_category WHERE budget_id = ?')
    .all(budgetId).map((r) => r.category_id)
  return cats.reduce((sum, cid) => sum + usedOf(cid), 0)
}

check('二级「日常三餐」只算自己（不含那笔 7777 标记项）', usedOf('c_meal'), 7000)
check('二级「奶茶饮料」只算自己', usedOf('c_drink'), 2000)
check('一级「餐饮食品」含所有二级', usedOf('c_food'), 9000)
check('一级「交通出行」含打车', usedOf('c_traffic'), 5000)
check('没有二级的一级分类也算得出', usedOf('c_fun'), 1500)

check('子预算 A（日常三餐 + 打车）合计', usedOfBudget('b_sub'), 12000)
check('子预算 B（餐饮食品整棵子树）', usedOfBudget('b_root'), 9000)

/*
 * 关键回归：一条子预算同时挂「一级 + 它下面的二级」会把同一笔支出算两遍。
 * api/budget.js 的 normalizeCategoryIds 直接拒绝这种组合 —— 这里验证
 * 「拒绝是必要的」：真算出来会翻倍。
 */
check(
  '一级与自身二级同时挂载会导致重复计算（所以保存时必须拒绝）',
  usedOf('c_food') + usedOf('c_meal'),
  16000
)

console.log('=== 多类别：类别唯一性 ===')

{
  // 主键约束保证同一条预算里不重复挂同一个类别
  let dup = 'ok'
  try {
    db.prepare('INSERT INTO budget_category (budget_id, category_id) VALUES (?,?)').run('b_sub', 'c_meal')
  } catch (e) {
    dup = 'rejected'
  }
  check('同一条子预算里不能重复挂同一类别（主键约束）', dup, 'rejected')

  const cnt = db.prepare('SELECT COUNT(*) AS c FROM budget_category WHERE budget_id = ?').get('b_sub').c
  check('子预算 A 仍然挂 2 个类别', Number(cnt), 2)
}

db.close()

/* ============================================ 3. 迁移 v18 的源码约束 */

console.log('=== 迁移 v18：结构 ===')

{
  const schemaSrc = read('api/db/schema.js')
  const dbSrc = read('api/db/index.js')

  // ★ 断言「至少 18」而不是「恰好 18」★
  //   v19 起还有新的迁移，写死 18 会让每次加迁移都要回来改这一条。
  //   这里要钉的是「v18 这一版的结构存在」，不是「版本停在 18」。
  check(
    'SCHEMA_VERSION 至少是 18',
    Number((schemaSrc.match(/export const SCHEMA_VERSION = (\d+)/) || [])[1]) >= 18,
    true
  )
  check('budget 表有 name 列', /CREATE TABLE IF NOT EXISTS budget \([\s\S]*?name\s+TEXT/.test(schemaSrc), true)
  check(
    '有 budget_category 建表 DDL',
    /CREATE TABLE IF NOT EXISTS budget_category \([\s\S]*?budget_id[\s\S]*?category_id[\s\S]*?PRIMARY KEY \(budget_id, category_id\)/.test(schemaSrc),
    true
  )
  check('有 budget_category 索引', /idx_budget_cat_cat ON budget_category\(category_id\)/.test(schemaSrc), true)

  check('迁移注册为 v18', /version:\s*18,\s*\n\s*up:\s*migrateBudgetCategories/.test(dbSrc), true)
  check('有 migrateBudgetCategories 函数', /function migrateBudgetCategories/.test(dbSrc), true)
  check('迁移里 ALTER 加 name 列', /ALTER TABLE budget ADD COLUMN name TEXT/.test(dbSrc), true)
  check(
    '迁移里的关联表 DDL 与 schema 一致',
    /CREATE TABLE IF NOT EXISTS budget_category \(/.test(dbSrc),
    true
  )
  check(
    '迁移回填老数据（INSERT OR IGNORE + 只搬活着的分类）',
    /INSERT OR IGNORE INTO budget_category[\s\S]{0,400}?c\.deleted_at IS NULL/.test(dbSrc),
    true
  )
  /*
   * ★ 迁移内不能用 query()/execute()，会死锁（见 test-db-migration.mjs）★
   *
   * ★ 切片必须以「下一个函数定义」为界，不能切到 migrate() ★
   *   v19 的迁移函数插在 migrateBudgetCategories 和 migrate() 之间，
   *   按旧写法会把 v19 的代码一起切进来，于是「v18 迁移里用了 query()」
   *   这种假警报就出现了 —— 实际是隔壁函数的内容被误判。
   */
  const migrateFnStart = dbSrc.indexOf('function migrateBudgetCategories')
  const nextFnAfterMigrate = dbSrc.indexOf('async function migrateLoanExcludeAndSettleCategories')
  let migrateFnEnd
  if (nextFnAfterMigrate > 0) {
    /*
     * ★ 要退到下一个函数的**文档注释开头**，不是函数名 ★
     *   v19 函数头上那段注释里就写着「不能 query()/execute()」，
     *   按函数名切会把这段注释算进 v18 —— 断言直接命中自己那段说明。
     */
    migrateFnEnd = dbSrc.lastIndexOf('/**', nextFnAfterMigrate)
  } else {
    migrateFnEnd = dbSrc.indexOf('async function migrate()')
  }
  const migrateFn = dbSrc.slice(migrateFnStart, migrateFnEnd)
  check('迁移内部没有用 query(', /\bquery\(/.test(migrateFn), false)
  check('迁移内部没有用 execute(', /\bexecute\(/.test(migrateFn), false)
  check('迁移内部用底层 call(', /call\('executeSql'/.test(migrateFn), true)

  check('清空库里包含 budget_category', /truncateAll[\s\S]{0,400}'budget_category'/.test(dbSrc), true)
}

console.log('=== 迁移 v18：备份兼容 ===')

{
  const backupSrc = read('api/backup.js')
  check('导出包含 budget_category', /SELECT \* FROM budget_category/.test(backupSrc), true)
  check('导出 payload 带 budgetCategories', /budgetCategories,/.test(backupSrc), true)
  check(
    '导入 budget 时写 name 列',
    /INSERT INTO budget \(id, scope, category_id, name, period/.test(backupSrc),
    true
  )
  check(
    '导入时兼容老备份（无 budgetCategories 时按单列补）',
    /Array\.isArray\(payload\.budgetCategories\) \? payload\.budgetCategories\.slice\(\) : \[\]/.test(backupSrc),
    true
  )
  check(
    '导入关联时用 INSERT OR IGNORE',
    /INSERT OR IGNORE INTO budget_category/.test(backupSrc),
    true
  )
}

/* ==================================== 4. 额度分配：可分配池不含结转 */

console.log('=== 额度分配：结转不计入可分配池 ===')

{
  const usages = [
    // 月预算：原本 1000 元，含 200 结转 -> limit 1200、baseLimit 1000
    { id: 'b1', scope: 'total', limit: 120000, baseLimit: 100000, monthly: 100000 },
    { id: 'b2', scope: 'category', limit: 60000, name: '吃饭' },
    { id: 'b3', scope: 'category', limit: 30000, name: '通勤' }
  ]
  const r = summarizeAllocation(usages)
  check('可分配池用 baseLimit（不含结转）', r.totalLimit, 100000)
  check('已分配合计', r.allocated, 90000)
  check('未分配额度', r.unallocated, 10000)
  check('不算超额', r.overAllocated, false)

  const over = checkCategoryAllocation(usages, 20000)
  check('再分 200 元刚好超 100 元', over.wouldOver, true)
  check('超出金额', over.overflow, 10000)

  const noBase = summarizeAllocation([
    { id: 'b1', scope: 'total', limit: 120000 }
  ])
  check('没有 baseLimit 时退回 limit（老数据兼容）', noBase.totalLimit, 120000)
}

/* ============================================ 5. 页面与文案（静态） */

console.log('=== 页面：月预算 / 子预算 / 结转勾选 ===')

{
  const budgetPage = read('pages/settings/budget.vue')

  check('文案用「月预算」', /<text class="card-title">月预算<\/text>/.test(budgetPage), true)
  check('文案用「子预算」', /<text class="card-title">子预算<\/text>/.test(budgetPage), true)
  check('不再出现「总预算」标题', /class="card-title">总预算</.test(budgetPage), false)
  check('不再出现「分类预算」标题', /class="card-title">分类预算</.test(budgetPage), false)
  check(
    '有结转勾选框',
    /未用完的预算结转到下一月/.test(budgetPage),
    true
  )
  check(
    '未设月预算时隐藏子预算卡（v-if="allocation.hasTotal"）',
    /v-if="allocation\.hasTotal"[\s\S]{0,200}card-title">子预算/.test(budgetPage),
    true
  )
  check('子预算编辑器有名称输入', /v-model="editorName"/.test(budgetPage), true)

  /*
   * ★ 类别多选已改成弹层组件（用户要求「做成一个弹层」）★
   *   预算页只保留一行「已选 N 个」的入口，勾选本身在弹层里；
   *   弹层同时被「全部交易」的筛选面板复用（见下方断言）。
   */
  check('预算页用多选弹层组件', /<CategoryMultiPickerSheet/.test(budgetPage), true)
  check(
    '弹层接的是 editorCatIds',
    /:selected-ids="editorCatIds"/.test(budgetPage),
    true
  )
  check('有打开弹层的入口', /openCatPickerSheet/.test(budgetPage), true)
  /*
   * ★ 已选类别不再罗列（用户要求「右侧显示已选择1分类名，后面加等X项」）★
   *   以前是一排 chip 全部铺出来，挂 5 个类别就占三四行、把弹层顶高。
   */
  check(
    '已选类别只给摘要（catPickLabel）',
    /\{\{ catPickLabel \}\}/.test(budgetPage),
    true
  )
  check('不再罗列已选类别 chip', /picked-chip|picked-wrap/.test(budgetPage), false)
  check(
    '摘要格式是「已选择 名字 等N项」',
    /`已选择 \$\{names\[0\]\} 等\$\{names\.length\}项`/.test(budgetPage),
    true
  )
  // 内联长列表应当已经撤掉（否则又会把弹层顶高）
  check('不再有内联类别列表样式', /\.cat-select\s*\{/.test(budgetPage), false)

  const sheet = read('components/CategoryMultiPickerSheet.vue')
  check('弹层组件按一级分组', /const roots = list\.filter\(\(c\) => !c\.parent_id\)/.test(sheet), true)
  // 用户要求删掉「选择类别」下面那句说明
  check('弹层不再有说明小字', /multi-hint/.test(sheet), false)
  check('弹层不接受 hint 参数', /hint: \{/.test(sheet), false)
  check(
    '弹层标签是「一级-二级」',
    /label: `\$\{root\.name\}-\$\{k\.name\}`/.test(sheet),
    true
  )
  check('弹层有勾选框', /class="check-box"/.test(sheet), true)
  check('弹层支持禁用项（已被别的子预算占用）', /disabled: disabled\.has\(k\.id\)/.test(sheet), true)
  check('弹层点确定才回传', /emit\('picked', draft\.value\.slice\(\)\)/.test(sheet), true)
  check('弹层接入弹层栈', /pushLayer\(\(\) => \{ visible\.value = false \}, 'categoryMultiSheet'\)/.test(sheet), true)
  check('保存超月预算时硬拦', /checkCategoryAllocation\(usages\.value/.test(budgetPage), true)

  const detail = read('pages/settings/budget-detail.vue')
  check('详情页文案用「月预算 / 子预算」', /return '子预算'/.test(detail), true)
  check('详情页支持多类别跳转', /categoryIds=\$\{catIds\.join\(','\)\}/.test(detail), true)

  const idx = read('pages/index/index.vue')
  check('首页月预算文案', /<text class="ov-budget-name">月预算<\/text>/.test(idx), true)

  const txnSrc = read('api/transaction.js')
  check('交易筛选支持多类别', /categoryIds/.test(txnSrc), true)
  check(
    '多类别走 IN 查询',
    /t\.category_id IN \(\$\{multiCats\.map/.test(txnSrc),
    true
  )

  /*
   * ★ 全部交易页复用同一个多选弹层 ★
   *   预算页点「全部交易」会带 categoryIds 深链过来，
   *   筛选面板必须能展示并继续编辑这组多选条件。
   *
   * ★ v1.18.0 起分类只剩多选这一种 ★
   *   用户要求「筛选时删除单选的一级和二级分类，其他页面跳转过来的效果保持不变」，
   *   所以面板上只有一行「分类」，点开就是多选弹层；
   *   旧链接里的 categoryId 由 normalizeUrlCategory 换算成一组 id。
   */
  const listPage = read('pages/txn/list.vue')
  check('筛选面板复用多选弹层', /<CategoryMultiPickerSheet/.test(listPage), true)
  check(
    '筛选面板只有一行「分类」（不再有二级分类行）',
    /<text class="filter-row-label">分类<\/text>/.test(listPage) &&
      !/filter-row-label">二级分类</.test(listPage),
    true
  )
  check(
    '查询时把勾选的分类展开后拼 categoryIds',
    /const pickedCats = expandCategoryIds\(appliedFilter\.categoryIds \|\| \[\]\)/.test(listPage) &&
      /q\.categoryIds = pickedCats\.join\(','\)/.test(listPage),
    true
  )
  check(
    'URL 深链能回显多选分类',
    /filter\.categoryIds = Array\.isArray\(q\.categoryIds\) \? q\.categoryIds\.slice\(\) : \[\]/.test(listPage),
    true
  )
  check(
    '旧链接的单个 categoryId 也会换算成多选',
    /pendingUrlCategoryId = q\.categoryId \|\| ''/.test(listPage) &&
      /function normalizeUrlCategory\(includeSub\)/.test(listPage),
    true
  )
  check(
    '一级分类按整支展开（勾一级 = 看它所有二级）',
    /function expandCategoryIds\(ids\)/.test(listPage) &&
      /kids\.length === 0\) \{[\s\S]{0,40}?push\(id\)/.test(listPage),
    true
  )
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
