/**
 * 本轮 5 个 bug 修复的回归测试（不依赖数据库 / 真实 App）
 *
 * 覆盖：
 *   1. 不计入资产的账户排在同分类最后（SQL 排序断言）
 *   3. 侧滑返回先收起弹层（弹层栈行为）
 *   5. 自检报告结构化（排版）
 *
 * 2（预算剩余日均）在 scripts/test-logic.mjs 里；
 * 4（周期补记）在 scripts/test-cycle-catchup.mjs 里。
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { fileURLToPath } from 'url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
let pass = 0
let fail = 0

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    pass++
  } else {
    fail++
    console.log(`FAIL  ${name}`)
    console.log(`      实际 ${JSON.stringify(actual)}`)
    console.log(`      期望 ${JSON.stringify(expected)}`)
  }
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf-8')
}

/* -------------------------------------------- 1. 不计入资产排最后 */

console.log('=== 账户排序 ===')
const acc = read('api/account.js')
check(
  'ORDER BY 先按 include_in_total 降序',
  /ORDER BY include_in_total DESC, sort ASC, created_at ASC/.test(acc),
  true
)
check(
  '不再有「只按 sort」的旧排序',
  /ORDER BY sort ASC, created_at ASC'/.test(acc),
  false
)
// 分组走 listAccounts，排序自动生效
check('分组复用 listAccounts', /listAccountsGrouped[\s\S]*?listAccounts\(\)/.test(acc), true)

/* -------------------------------------------- 3. 弹层栈 */

console.log('=== 侧滑返回先收弹层 ===')
const layer = read('utils/layerStack.js')
check('有 pushLayer', /export function pushLayer/.test(layer), true)
check('有 handleBackPress', /export function handleBackPress/.test(layer), true)
check('后进先出（取栈顶）', /stack\[stack\.length - 1\]/.test(layer), true)
check('消费返回时返回 true', /return true/.test(layer), true)

// 页面必须自己声明 onBackPress（组件里写不生效）
const pages = [
  ['pages/index/index.vue', '首页（记账面板 + AI 输入条）'],
  ['pages/settings/cycle.vue', '周期页（周期面板）'],
  ['pages/txn/detail.vue', '交易详情（编辑面板）'],
  ['pages/settings/category.vue', '分类管理（分类编辑弹层）'],
  ['pages/settings/tag.vue', '标签管理（标签编辑弹层）'],
  ['pages/settings/budget.vue', '预算管理（预算/分类预算编辑弹层）']
]
for (const [file, label] of pages) {
  const src = read(file)
  check(`${label} 注册了 onBackPress`, /onBackPress\(/.test(src), true)
  check(`${label} 调用 handleBackPress`, /handleBackPress\(\)/.test(src), true)
}

// 所有会弹编辑层的组件/页面都要登记进栈
const panels = [
  ['components/TxnPanel.vue', 'txnPanel'],
  ['components/CyclePanel.vue', 'cyclePanel'],
  ['components/QuickAddBar.vue', 'quickAddBar'],
  ['pages/settings/category.vue', 'categoryEditor'],
  ['pages/settings/tag.vue', 'tagEditor'],
  ['pages/settings/budget.vue', 'budgetEditor']
]
for (const [file, name] of panels) {
  const src = read(file)
  check(`${name} 打开时登记`, /pushLayer\(/.test(src), true)
  check(`${name} 带名字登记`, new RegExp(`'${name}'`).test(src), true)
  check(`${name} 关闭时注销`, /unregisterLayer\(\)/.test(src), true)
}

/* -------------------------------------------- 5. 自检报告排版 */

console.log('=== 自检报告排版 ===')
const diag = read('api/db/diagnose.js')
check('自检把 steps 交给结构化列表', /list: report\.steps/.test(diag), true)
check('纯文本报告里细节单独成行', /lines\.push\(`     \$\{s\.detail\}`\)/.test(diag), true)

const dialog = read('components/AppDialog.vue')
check('弹窗支持 list', /const list = ref\(null\)/.test(dialog), true)
check('弹窗渲染结构化列表', /v-for="\(item, i\) in list"/.test(dialog), true)
check('有勾叉样式', /\.chk-dot\.is-ok/.test(dialog), true)
check('细节缩进样式', /\.chk-detail\s*\{[\s\S]*?margin: 6rpx 0 0 42rpx/.test(dialog), true)

const dl = read('utils/dialog.js')
check('alertDialog 透传 list', /list: Array\.isArray\(options\.list\)/.test(dl), true)
check('原生兜底把 list 压成文本', /opts\.list\.map\(\(it, i\)/.test(dl), true)

/* -------------------------------------------- 6. 预算日均精确到 0.00 */

console.log('=== 预算剩余日均精度 ===')
const stats = read('api/stats.js')
check(
  '后端保留「分」的小数精度（不再取整）',
  /Math\.round\(\(remaining \/ remain\) \* 100\) \/ 100/.test(stats),
  true
)
check(
  '生效月份分支同样保留精度',
  /Math\.round\(\(remaining \/ denom\) \* 100\) \/ 100/.test(stats),
  true
)
check('不再有旧的整数四舍五入', /Math\.max\(Math\.round\(remaining \/ remain\), 0\)/.test(stats), false)

const idx = read('pages/index/index.vue')
check('首页总预算日均两位小数', /totalBudget\.dailyAvailable \/ 100\)\.toFixed\(2\)/.test(idx), true)
check('首页分类预算日均两位小数', /b\.dailyAvailable \/ 100\)\.toFixed\(2\)/.test(idx), true)

const budgetPage = read('pages/settings/budget.vue')
check('预算页日均两位小数', /totalBudget\.dailyAvailable \/ 100\)\.toFixed\(2\)/.test(budgetPage), true)

/* -------------------------------------------- 7. 覆盖安装：迁移链完整 */

console.log('=== 覆盖安装兼容（迁移链）===')
const dbIndex = read('api/db/index.js')
const schemaSrc = read('api/db/schema.js')

const migrated = [...dbIndex.matchAll(/version:\s*(\d+)/g)].map((m) => Number(m[1]))
const schemaVer = Number(/SCHEMA_VERSION\s*=\s*(\d+)/.exec(schemaSrc)[1])
check('迁移版本连续（从 1 开始无缺口）', migrated, Array.from({ length: migrated.length }, (_, i) => i + 1))
check('SCHEMA_VERSION 等于最大迁移版本', schemaVer, Math.max(...migrated))
check('有 v9 cycle_skip 迁移', /version: 9/.test(dbIndex), true)
check('v9 建表是 IF NOT EXISTS（可重复执行）', /CREATE TABLE IF NOT EXISTS cycle_skip/.test(dbIndex), true)
check('有 v10 停用 source/raw_text', /version: 10/.test(dbIndex), true)
// 迁移失败不能挡住开库 —— 这是「覆盖安装后能正常打开」的关键保障
check('迁移失败不阻断开库', /迁移失败不能挡住数据库打开/.test(dbIndex), true)

/* -------------------------------------------- 8. 弹层全覆盖（防再次遗漏） */

console.log('=== 弹层全覆盖 ===')

/**
 * 扫描所有 .vue：凡是有 wd-popup / wd-action-sheet 的页面/组件，
 * 都必须登记到弹层栈，否则侧滑返回会直接退页。
 *
 * 例外：
 *   - AppDialog / TxnPanel / CyclePanel 的面板本体由它们自己处理
 *   - 组件内部的 sheet 用 bindSheet 批量登记
 */
function collectVue(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) collectVue(full, out)
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

const allVue = [...collectVue(join(ROOT, 'pages')), ...collectVue(join(ROOT, 'components'))]
const missing = []
for (const file of allVue) {
  const src = readFileSync(file, 'utf-8')
  const hasPopup = /<wd-popup|<wd-action-sheet/.test(src)
  if (!hasPopup) continue
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  /*
   * AppDialog 是全局弹窗宿主（确认框），不是「可能挡在页面上的编辑弹层」：
   * 它本身就要能通过返回键/遮罩关闭，且它是组件、无法声明页面级 onBackPress。
   * 所以排除它，其余一律要求接入。
   */
  if (rel === 'components/AppDialog.vue') continue

  const registers = /pushLayer\(|bindSheet\(/.test(src)
  if (!registers) missing.push(`${rel} 未登记弹层栈`)

  // onBackPress 只能写在页面里；组件由宿主页面统一处理，不要求
  const isPage = rel.startsWith('pages/')
  if (isPage && !/onBackPress\(/.test(src)) missing.push(`${rel} 缺 onBackPress`)
}
check('所有含弹层的文件都已接入侧滑收起', missing, [])

console.log('=== 已停用「来源 / 速记原文」===')
const detail = read('pages/txn/detail.vue')
// 只看代码行，注释里会提到这两个词来解释「为什么删」
const detailCode = detail
  .split('\n')
  .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
  .join('\n')
check('详情页不再展示来源', /row-label">来源/.test(detailCode), false)
check('详情页不再展示速记原文', /速记原文/.test(detailCode), false)
check('详情页没有 sourceLabel（代码）', /sourceLabel/.test(detailCode), false)

const txnApi = read('api/transaction.js')
check('创建不再写 source', /input\.source/.test(txnApi), false)
check('创建不再写 raw_text', /input\.raw_text/.test(txnApi), false)
check('关键词搜索不再查 raw_text', /t\.raw_text LIKE/.test(txnApi), false)

const schemaNow = read('api/db/schema.js')
/*
 * ★ 只查 txn 表的 DDL ★
 *   原来是对整个 schema.js 做 /source\s+TEXT/ ——
 *   后来 v17 加了 exchange_rate 表（有 source TEXT 列，记录汇率来源），
 *   这条就误报了。断言的真正意图是「txn 表不再有 source / raw_text」，
 *   所以先把 txn 的建表语句切出来再查。
 */
const txnDdl = (() => {
  const i = schemaNow.indexOf('CREATE TABLE IF NOT EXISTS txn (')
  if (i < 0) return ''
  const j = schemaNow.indexOf(')`', i)
  return j > i ? schemaNow.slice(i, j) : schemaNow.slice(i, i + 2000)
})()
check('txn 建表 DDL 不再有 source 列', /source\s+TEXT/.test(txnDdl), false)
check('txn 建表 DDL 不再有 raw_text 列', /raw_text\s+TEXT/.test(txnDdl), false)

const quick = read('components/QuickAddBar.vue')
check('AI 速记不再写 source', /source: 'quick'/.test(quick), false)
check('AI 速记不再写 raw_text', /raw_text:/.test(quick), false)

const panelSrc = read('components/TxnPanel.vue')
check('手动记账不再写 source', /source: 'manual'/.test(panelSrc), false)

const cycleApi = read('api/cycle.js')
check('周期记账不再写 source', /source: 'cycle'/.test(cycleApi), false)

const accApi = read('api/account.js')
check('对账流水不再写 source', /'reconcile',/.test(accApi), false)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
