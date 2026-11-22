/**
 * 本轮修复的回归测试
 *
 *   node scripts/test-fix-round.mjs
 *
 * 覆盖：
 *   1. 外币周期模板持久化（新建 / 编辑 / 记一笔）
 *   2. 结算分类按「名字 + 系统父级」判定，分类保留名
 *   3. AI 月度范围必须传字符串日期
 *   4. AI 多笔消息每笔只拿自己的分句；还房贷/信用卡等不误判借还
 *   5. AI 分类必须同 type；未知币种拒绝；图表合计用全量
 *   6. 删除分类/账户清理周期引用；撤销恢复级联流水
 *   7. 备份包含 cycle_skip / 汇率历史；自动备份不写 API Key
 *   8. 报销只允许日常支出；已报销禁改金额/账户/分类/日期
 *   9. 统计页按需加载、请求序号、监听器解绑、徽标缓存
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  splitMessageClauses,
  pickItemHint,
  detectLoanIntent,
  validateItem,
  matchCategory
} from '../api/aiParse.js'

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

/* ------------------------------------------------------------ 测试上下文 */

const categories = [
  { id: 'sys-exp', name: '系统分类', type: 'expense', parent_id: null },
  { id: 'sys-inc', name: '系统分类', type: 'income', parent_id: null },
  { id: 'lend', name: '借出', type: 'expense', parent_id: 'sys-exp' },
  { id: 'lend-back', name: '借款收回', type: 'income', parent_id: 'sys-inc' },
  { id: 'borrow', name: '借入', type: 'income', parent_id: 'sys-inc' },
  { id: 'borrow-back', name: '借款归还', type: 'expense', parent_id: 'sys-exp' },
  { id: 'food', name: '餐饮食品', type: 'expense', parent_id: null },
  { id: 'lunch', name: '日常三餐', type: 'expense', parent_id: 'food' },
  { id: 'salary', name: '工资', type: 'income', parent_id: null },
  { id: 'other-exp', name: '其他支出', type: 'expense', parent_id: null }
]

const accounts = [
  { id: 'a1', name: '微信', isCombo: false },
  { id: 'a2', name: '支付宝', isCombo: false }
]

const ctx = {
  categories,
  accounts,
  tags: [],
  baseDate: new Date('2026-11-19T10:00:00'),
  hintText: ''
}

const validate = (raw, hintText = '') =>
  validateItem(raw, { ...ctx, hintText })

/* ------------------------------------------------------ 4. AI 多笔不串味 */

console.log('=== AI 多笔消息：每笔只拿自己的分句 ===')

{
  const msg = '午饭45，还姐姐200'
  check('按标点拆成两条', splitMessageClauses(msg).length, 2)
  check('第一条拿午饭分句', pickItemHint(msg, { amount: 45, note: '午饭' }, 0, 2), '午饭45')
  check('第二条拿还钱分句', pickItemHint(msg, { amount: 200, note: '姐姐' }, 1, 2), '还姐姐200')

  const lunchHint = pickItemHint(msg, { amount: 45, note: '午饭' }, 0, 2)
  check('午饭分句不会识别成借款', detectLoanIntent(lunchHint), null)

  const res = validate(
    { amount: 45, type: 'expense', category: '餐饮食品/日常三餐', account: '微信', note: '午饭' },
    lunchHint
  )
  check('午饭仍然是餐饮分类', res.ok && res.item.category_id, 'lunch')
}

console.log('=== 还房贷 / 信用卡 / 花呗 不误判成借还 ===')

{
  check('还房贷', detectLoanIntent('还房贷5000'), null)
  check('还车贷', detectLoanIntent('还车贷2000'), null)
  check('还信用卡', detectLoanIntent('还信用卡1000'), null)
  check('还花呗', detectLoanIntent('还花呗200'), null)
  check('还白条', detectLoanIntent('还白条300'), null)
  check('还姐姐仍然是借款归还', detectLoanIntent('还姐姐200')?.key, 'borrowBack')

  const res = validate(
    { amount: 5000, type: 'expense', category: '餐饮食品/日常三餐', account: '微信', note: '房贷' },
    '还房贷5000'
  )
  check('还房贷不会把分类改成借款归还', res.ok && res.item.category_id, 'lunch')
}

/* -------------------------------------------- 5. 分类 type / 币种 / 图表 */

console.log('=== AI 分类必须同 type ===')

{
  check(
    '支出匹配不到收入分类',
    matchCategory('工资', categories, '', 'expense'),
    null
  )
  check(
    '收入可以匹配工资',
    matchCategory('工资', categories, '', 'income')?.id,
    'salary'
  )
  const bad = validate({
    amount: 100,
    type: 'expense',
    category: '工资',
    account: '微信',
    note: 'test'
  })
  check('支出不会被挂到工资', bad.ok && bad.item.category_id, null)

  const good = validate({
    amount: 100,
    type: 'income',
    category: '工资',
    account: '微信',
    note: 'test'
  })
  check('收入可以挂到工资', good.ok && good.item.category_id, 'salary')
}

console.log('=== 未知币种不再静默按人民币 ===')

{
  const yen = validate({
    amount: 2000,
    type: 'expense',
    currency: 'YEN',
    category: '餐饮食品/日常三餐',
    account: '微信',
    note: '东京晚饭'
  })
  check('YEN 归一成 JPY', yen.ok && yen.item.currency, 'JPY')

  const cny = validate({
    amount: 45,
    type: 'expense',
    currency: '人民币',
    category: '餐饮食品/日常三餐',
    account: '微信',
    note: '午饭'
  })
  check('人民币别名归一成 CNY', cny.ok && cny.item.currency, 'CNY')

  const unknown = validate({
    amount: 2000,
    type: 'expense',
    currency: 'ABC',
    category: '餐饮食品/日常三餐',
    account: '微信',
    note: 'test'
  })
  check('未知币种整条拒绝', unknown.ok, false)
  check('拒绝原因里带币种', /ABC/.test(unknown.reason || ''), true)
}

console.log('=== AI 图表合计在 Top N 之前算 ===')

{
  const src = read('api/aiChartData.js')
  check('先算全量合计', /const total = all\.reduce/.test(src), true)
  check('再截断 Top N', /const list = all\s*\.slice\(0, spec\.limit\)/.test(src), true)
  check('环形图接收 total', /total: data\.total/.test(read('pages/ai/chat.vue')), true)
  check('月度范围传 monthKey', /const scope = \{ monthKey: thisMonth \}/.test(read('pages/ai/chat.vue')), true)
}

/* ---------------------------------------------------- 1. 外币周期持久化 */

console.log('=== 外币周期模板 ===')

{
  const cycle = read('api/cycle.js')
  check('INSERT 带原币字段', /original_currency, original_amount_cents/.test(cycle), true)
  check('UPDATE 写原币字段', /assign\('original_currency'/.test(cycle), true)
  check('手工记一笔也走外币折算', /return recordCycleForDay\(id, day\)/.test(cycle), true)

  const backup = read('api/backup.js')
  check('周期导入带原币字段', /cy\.original_currency/.test(backup), true)
}

/* -------------------------------------------- 2. 结算分类按系统父级判定 */

console.log('=== 结算分类不能只看名字 ===')

{
  const filter = read('api/txnFilter.js')
  check('结算 SQL 限定系统父级', /JOIN category p ON p\.id = c\.parent_id/.test(filter), true)
  check('结算 SQL 认新旧组名', /SYSTEM_PRESET_GROUP_NAMES/.test(filter), true)

  const category = read('api/category.js')
  check('分类创建校验保留名', /RESERVED_CATEGORY_NAMES/.test(category), true)
  check('分类创建校验同级重名', /assertCategoryNameAvailable/.test(category), true)

  const schema = read('api/db/schema.js')
  check('保留名包含六个结算分类', /SETTLEMENT_ADJUSTMENT_CATEGORY_NAMES/.test(schema), true)
}

/* ------------------------------------ 6. 删除引用清理 / 撤销级联恢复 */

console.log('=== 删除与撤销 ===')

{
  const category = read('api/category.js')
  check('删分类软删周期', /UPDATE cycle SET deleted_at/.test(category), true)

  const account = read('api/account.js')
  check('删账户软删周期', /UPDATE cycle SET deleted_at/.test(account), true)
  check('删账户清报销单账户', /UPDATE reimburse_batch SET account_id = NULL/.test(account), true)

  const txn = read('api/transaction.js')
  check('撤销恢复借款差额', /via_combo_id = \?/.test(txn), true)
  check('撤销恢复报销派生', /batch_id = \? AND deleted_at = \?/.test(txn), true)
  check('撤销恢复被退回的原支出', /reimburse_status = 2/.test(txn), true)
}

/* ------------------------------------------------------------ 7. 备份 */

console.log('=== 备份完整性 ===')

{
  const backup = read('api/backup.js')
  check('导出周期跳过日', /cycleSkips/.test(backup), true)
  check('导出汇率历史', /exchangeRates/.test(backup), true)
  check('导入周期跳过日', /INSERT OR IGNORE INTO cycle_skip/.test(backup), true)
  check('导入汇率历史', /INSERT OR REPLACE INTO exchange_rate/.test(backup), true)
  check('自动备份不写 API Key', /exportToJson\(\{ includeApiKey: false \}\)/.test(backup), true)
}

/* ------------------------------------------------------------ 8. 报销 */

console.log('=== 报销状态护栏 ===')

{
  const reimb = read('api/reimburse.js')
  check('校验只有支出能报销', /r\.type !== 'expense'/.test(reimb), true)
  check('校验系统分类', /INTERNAL_ONLY_CATEGORY_NAMES\.includes/.test(reimb), true)
  check('校验到账账户不是组合', /targetAccount\.isCombo/.test(reimb), true)
  check('已报销不能从待报销旁路取消', /已经报销过了/.test(reimb), true)

  const txn = read('api/transaction.js')
  check('已报销禁改关键字段', /已报销的流水不能修改金额/.test(txn), true)
  check('setReimburseStatus 只能 0/1', /\[0, 1\]\.includes\(next\)/.test(txn), true)
}

/* ------------------------------------------------------ 9. 统计刷新 */

console.log('=== 统计页刷新成本 ===')

{
  const stats = read('pages/stats/index.vue')
  check('只查可见面板', /show\.category/.test(stats) && /show\.average/.test(stats), true)
  check('请求序号防覆盖', /seq !== loadSeq/.test(stats), true)
  check('extras 并发执行', /Promise\.allSettled\(tasks\)/.test(stats), true)
  check('监听器有解绑', /uni\.\$off\('txn:changed'/.test(stats), true)

  const index = read('pages/index/index.vue')
  check('首页徽标缓存', /recentBadgeMap/.test(index), true)
  const list = read('pages/txn/list.vue')
  check('列表徽标缓存', /const badgeMap = computed/.test(list), true)
}

/* ------------------------------------------ 10. 导入/迁移/预算/备份 */

console.log('=== 导入与迁移的原子性 ===')

{
  const backup = read('api/backup.js')
  check('覆盖导入清空在事务内', /truncateAll\(\{\s*inTransaction:\s*true/.test(backup), true)
  check('seed 在事务内', /seedDefaultCategories\(\{\s*inTransaction:\s*true/.test(backup), true)
  check('设置写入不再嵌套事务', /setSettingsInTransaction/.test(backup), true)
  check('导入前备份失败会中止', /导入前自动备份失败，已取消导入/.test(backup), true)

  const settings = read('api/settings.js')
  check('提供不启事务的批量写', /export async function setSettingsInTransaction/.test(settings), true)

  const db = read('api/db/index.js')
  check('truncateAll 支持 inTransaction', /truncateAll\(opt\)/.test(db), true)
  check('truncateAll 不再写 user_version', /truncateAll[\s\S]{0,2500}?writeUserVersion/.test(db), false)
  check('迁移失败 break', /catch\s*\(e\)\s*\{[\s\S]{0,900}?break/.test(db), true)
}

console.log('=== 备份版本与保留份数 ===')

{
  const backup = read('api/backup.js')
  check('备份版本跟随 SCHEMA_VERSION', /BACKUP_SCHEMA_VERSION = SCHEMA_VERSION/.test(backup), true)
  check('自动备份保留 10 份', /MAX_AUTO_BACKUPS = 10/.test(backup), true)
}

console.log('=== 预算区间按已过天数折算 ===')

{
  const stats = read('api/stats.js')
  check('存在月份折算函数', /const monthFraction = \(mk\)/.test(stats), true)
  check('额度按 units 折算', /const limit = Math\.round\(monthly \* units\)/.test(stats), true)
  check('baseLimit 仍是完整月额度', /baseLimit: monthly \* effective\.length/.test(stats), true)
  check('单日区间总天数为 1', /return \{ total: 1, passed/.test(stats), true)
}

console.log('=== 隐私模式与手动重算已删除 ===')

{
  check('设置里没有隐私模式', /privacyMode/.test(read('api/settings.js')), false)
  check('store 里没有隐私模式', /privacyMode/.test(read('stores/setting.js')), false)
  check('MoneyText 没有脱敏分支', /forceMask|masked/.test(read('components/MoneyText.vue')), false)
  check('数据页没有重算入口', /重算所有账户余额/.test(read('pages/settings/data.vue')), false)
  check('account store 没有 repair', /async repair\(/.test(read('stores/account.js')), false)
}

/* ------------------------------------------ 11. 列表分页 / 暗色 / 测试 */

console.log('=== 全部交易：首屏 100 条 + 手动加载更多 ===')

{
  const list = read('pages/txn/list.vue')
  check('每页 100 条', /const PAGE_SIZE = 100/.test(list), true)
  check('不再随滚动自动追加', /@scrolltolower="loadMore"/.test(list), false)
  check('使用 HeaderAction 按钮', /<HeaderAction[\s\S]{0,120}加载更多/.test(list), true)
  check('加载中显示加载态', /loading\s*\?\s*'加载中…'|v-if="loading"[\s\S]{0,80}加载中/.test(list), true)
}

console.log('=== 暗色环图文字色 ===')

{
  const stats = read('pages/stats/index.vue')
  check('读 store 的 isDark', /return settingStore\.isDark \?/.test(stats), true)
  // 注释里会提到旧字段，这里只看真实表达式
  check('不再读不存在的 theme 字段', /settingStore\.theme\s*\|\|/.test(stats), false)
}

console.log('=== AI 测试连接不落库 ===')

{
  const ai = read('api/ai.js')
  check('chat 支持临时配置', /const ai = opt\.ai \?/.test(ai), true)
  check('testConnection 支持临时配置', /export async function testConnection\(aiOverride/.test(ai), true)

  const page = read('pages/settings/ai.vue')
  const testBody = page.slice(page.indexOf('async function onTest'), page.indexOf('async function onSave'))
  check('测试前不再 setAi', /setAi\s*\(/.test(testBody), false)
  check('测试传表单临时值', /testConnection\(\{[\s\S]{0,300}?apiKey: form\.apiKey/.test(testBody), true)
}

console.log('=== 周期补记失败不丢日期 ===')

{
  const cycle = read('api/cycle.js')
  check('失败时停住', /failed = true/.test(cycle), true)
  check('失败游标停在失败日前一天', /if \(!cursor\) cursor = shiftDay\(d, -1\)/.test(cycle), true)
  check('达到上限只停在上次处理日', /capped = true/.test(cycle) && /if \(!failed && !capped\) cursor = today/.test(cycle), true)
}

console.log('=== AI 图表支持收入/近 N 天 ===')

{
  const chart = read('api/aiChartData.js')
  check('规格支持 metric', /export const CHART_METRICS/.test(chart), true)
  check('分类查询按 metric', /getSubCategoryStatsRange\(scope, metric\)/.test(chart), true)
  check('趋势按 metric 取值', /Number\(t\[metric\]\)/.test(chart), true)
  check('days 覆盖滚动窗口', /scope = \{ startDay: shiftDay\(end, -\(spec\.days - 1\)\), endDay: end \}/.test(chart), true)
}

console.log('=== 底栏不依赖页面传 hidden，自己订阅弹层栈 ===')

{
  const stack = read('utils/layerStack.js')
  check('提供弹层开合订阅', /export function subscribeLayerOpen/.test(stack), true)
  check('入栈时通知', /stack\.push\(\{ key, close \}\)[\s\S]{0,200}?notify\(\)/.test(stack), true)
  check('出栈时通知', /stack\.splice\(i, 1\)[\s\S]{0,80}?notify\(\)/.test(stack), true)

  const bar = read('components/AppTabBar.vue')
  check('底栏 import 订阅函数', /subscribeLayerOpen/.test(bar), true)
  check('底栏根节点用 visuallyHidden', /v-show="!visuallyHidden"/.test(bar), true)
  check('显式 hidden 与弹层状态取或', /props\.hidden \|\| layerOpen\.value/.test(bar), true)
  check('卸载时取消订阅', /unsubLayer\(\)/.test(bar), true)
}

/* ------------------------------------------------------------ 汇总 */

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
