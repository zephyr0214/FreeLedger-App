/**
 * 详情页展示条目改版的回归测试
 *
 * 覆盖本轮需求：
 *   1. 分类详情：大数字=本月支出；小条目=本月笔数/本月支出占比/总支出/总笔数/总支出占比；
 *                 中间的「本月收支」组件已删除
 *   2. 标签详情：大数字=总支出；小条目=总收入/本月笔数/总笔数；中间的「本月收支」组件保留
 *   3. 周期详情：大数字=总支出；小条目=单次金额/总笔数/扣款账户/最近已扣/最近将扣；
 *                「记一笔」按钮已删除
 *   4. 预算详情：中间的「本月收支」组件已删除
 *   5. 预算详情 bug：二级分类预算的最近流水必须按二级分类查，不能归到一级
 */

import { readFileSync } from 'fs'
import { join } from 'path'
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

/* ------------------------------------------------ 1. 分类详情 */

console.log('=== 分类详情 ===')
const cat = read('pages/settings/category-detail.vue')

/*
 * ★ 文案和口径改成跟着分类方向走（本轮修复）★
 *   用户反馈：「收入详情页显示的应该是本月收入、总收入，怎么显示的支出」。
 *   原来这一页写死了「本月支出」+ monthStats.expense，
 *   收入分类点进来 expense 恒为 0，大数字永远显示 0.00。
 *   现在标签用 statWord 拼（支出/收入），金额用 monthAmount / totalAmount。
 */
check('大数字标签跟着分类方向走', /summary-label">本月\{\{ statWord \}\}/.test(cat), true)
check('大数字用 monthAmount（方向感知）', /summary-label">本月\{\{ statWord \}\}[\s\S]*?:cents="monthAmount"/.test(cat), true)
check('大数字类型跟着方向走', /:cents="monthAmount"[\s\S]{0,160}?:type="statType"/.test(cat), true)
check('小条目有本月笔数', /summary-row-label">本月笔数/.test(cat), true)
check('小条目有本月占比（方向感知）', /summary-row-label">本月\{\{ statWord \}\}占比/.test(cat), true)
check('小条目有总金额（方向感知）', /summary-row-label">总\{\{ statWord \}\}/.test(cat), true)
check('小条目有总笔数', /summary-row-label">总笔数/.test(cat), true)
check('小条目有总占比（方向感知）', /summary-row-label">总\{\{ statWord \}\}占比/.test(cat), true)

// 方向派生的四个量都要 return（否则模板拿 undefined）
{
  const tail = cat.slice(cat.lastIndexOf('return {'))
  for (const name of ['statType', 'statWord', 'monthAmount', 'totalAmount']) {
    check('return 里暴露了 ' + name, new RegExp('\\b' + name + '\\b').test(tail), true)
  }
}
check('支出分类仍判作「支出」', /statType\.value === 'income' \? '收入' : '支出'/.test(cat), true)
check('本月占比分母按方向查（带 type）', /sumTransactions\(\{ monthKey: toMonthKey\(\), type: listType \}\)/.test(cat), true)
check('全部占比分母按方向查（带 type）', /sumTransactions\(\{ type: listType \}\)/.test(cat), true)
// 中间的本月收支组件已删
check('已删除本月收支组件', /class="month-card"/.test(cat), false)
check('已清理 month-card 样式', /\.month-card\s*\{/.test(cat), false)
// 不再展示本月收入
check('小条目不再有本月收入', /summary-row-label">本月收入/.test(cat), false)
// 新增的统计数据源
check('有 totalStats', /const totalStats = ref/.test(cat), true)
check('有 totalSharePercent', /const totalSharePercent = computed/.test(cat), true)
check('不限月份查本分类（总支出）', /sumTransactions\(\{\s*categoryId: categoryId\.value,\s*includeSubcategories: isParent\.value\s*\}\)/.test(cat), true)

/* ------------------------------------------------ 2. 标签详情 */

console.log('=== 标签详情 ===')
const tag = read('pages/settings/tag-detail.vue')

check('大数字是总支出', /summary-label">总支出/.test(tag), true)
check('大数字用 totalStats.expense', /summary-label">总支出[\s\S]*?:cents="totalStats\.expense"/.test(tag), true)
check('小条目有总收入', /summary-row-label">总收入/.test(tag), true)
check('小条目有本月笔数', /summary-row-label">本月笔数/.test(tag), true)
check('小条目有总笔数', /summary-row-label">总笔数/.test(tag), true)
// ★ 本页按要求保留本月收支组件
check('保留本月收支组件', /class="month-card"/.test(tag), true)
check('保留 month-card 样式', /\.month-card\s*\{/.test(tag), true)
check('本月收支显示本月支出', /month-label">本月支出/.test(tag), true)
check('本月收支显示本月收入', /month-label">本月收入/.test(tag), true)
check('有 totalStats', /const totalStats = ref/.test(tag), true)
check('旧的 totalCount 已移除', /const totalCount = ref/.test(tag), false)

/* ------------------------------------------------ 3. 周期详情 */

console.log('=== 周期详情 ===')
const cyc = read('pages/settings/cycle-detail.vue')

check('大数字是总支出', /summary-label">总支出/.test(cyc), true)
check('大数字用 totalCents', /summary-label">总支出[\s\S]*?:cents="totalCents"/.test(cyc), true)
check('小条目有单次金额', /summary-row-label">单次金额/.test(cyc), true)
check('小条目有总笔数', /summary-row-label">总笔数/.test(cyc), true)
check('小条目有扣款账户', /summary-row-label">扣款账户/.test(cyc), true)
check('小条目有最近一次已扣款', /summary-row-label">最近一次已扣款/.test(cyc), true)
check('小条目有最近一次将扣款', /summary-row-label">最近一次将扣款/.test(cyc), true)
// 记一笔按钮已删
check('已删除记一笔按钮', /record-btn/.test(cyc), false)
check('已删除 onRecord', /function onRecord/.test(cyc), false)
check('不再导入 recordCycle', /recordCycle[,\s]/.test(cyc), false)
check('不再导入 alertDialog', /alertDialog/.test(cyc), false)
// 两个时间字段
check('有 lastChargedText', /const lastChargedText = computed/.test(cyc), true)
check('有 nextChargeText', /const nextChargeText = computed/.test(cyc), true)
check('导入 nextOccurrence', /nextOccurrence/.test(cyc), true)
check('有 formatYmd 中文日期', /function formatYmd/.test(cyc), true)

/* ------------------------------------------------ 4. 预算详情改版 */

console.log('=== 预算详情 ===')
const budget = read('pages/settings/budget-detail.vue')

check('已删除本月收支组件', /class="month-card"/.test(budget), false)
check('已清理 month-card 样式', /\.month-card\s*\{/.test(budget), false)
check('本月笔数仍保留（依赖 monthStats）', /monthStats\.count/.test(budget), true)

/* ------------------------------------------------ 5. 预算详情二级分类 bug */

console.log('=== 预算详情：二级分类筛选 bug ===')
/*
 * 修复前：无条件把分类归到一级 rootId 并 includeSubcategories，
 * 导致二级分类预算下列出了同级其它分类的交易。
 * 修复后：二级只查自己，一级才查整个分类族。
 * 只看代码行 —— 注释里保留了旧写法用来说明 bug 成因。
 */
const budgetCode = budget
  .split('\n')
  .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
  .join('\n')

check(
  '二级分类不再归并到一级',
  /const rootId = \(cat && cat\.parent_id\) \|\| u\.categoryId/.test(budgetCode),
  false
)
check(
  '按是否叶子决定 includeSubcategories',
  /isLeaf[\s\S]{0,120}includeSubcategories: false[\s\S]{0,120}includeSubcategories: true/.test(budgetCode),
  true
)
check('新增 isLeaf 判断', /const isLeaf = !!\(cat && cat\.parent_id\)/.test(budget), true)
// 「全部 ›」跳转也要用同一口径，不能把二级归到一级
check(
  '全部跳转按叶子区分参数',
  /const param = isLeaf[\s\S]{0,80}categoryId=\$\{u\.categoryId\}`[\s\S]{0,80}includeSubcategories=1/.test(budgetCode),
  true
)

/* ------------------------------------------------ 6. 最近流水显示标签 */

console.log('=== 最近流水显示标签 ===')
/*
 * RecentTxnList 是各详情页共用的「最近流水」组件，
 * 之前只显示分类名，没有标签。
 * 现在要和首页 / 全部交易页一致：tag_ids 反查标签表。
 *
 * ★ v13 起这里统一成了「徽标」txnBadges ★
 *   以前的 txnTags 只渲染用户标签，
 *   后来把「周期 / 组合账户 / 标签」三种标记统一成同一种描边胶囊，
 *   函数也改名成 txnBadges（见 components/RecentTxnList.vue 的注释）。
 *   所以这里断言的是 txnBadges —— 名字换了但行为更强了：
 *   周期和组合账户的标记也一并渲染在同一个胶囊列表里。
 *
 * ★ 「最多 2 个 + N」的折叠被去掉了 ★
 *   徽标数量本身很少（周期 + 组合 + 标签），
 *   真实场景里叠到 3 个以上的情况极罕见，
 *   折叠反而让「这笔有哪些标记」看不全。现在用 flex-wrap 换行显示。
 */
const recent = read('components/RecentTxnList.vue')
const acc = read('pages/account/detail.vue')

check('引入 listTags', /import \{ listTags \} from '@\/api\/tag\.js'/.test(recent), true)
check('有标签缓存', /const tags = ref\(\[\]\)/.test(recent), true)
check('挂载时加载标签', /onMounted\(loadTags\)/.test(recent), true)
check('有 tagNameMap 反查', /const tagNameMap = computed/.test(recent), true)
check('有 txnBadges 函数（周期/组合/标签统一徽标）', /function txnBadges\(txn\)/.test(recent), true)
check('模板渲染标签胶囊', /v-if="txnBadges\(txn\)\.length"/.test(recent), true)
check('标签带自身颜色浅底', /backgroundColor: t\.bg/.test(recent), true)
check('徽标列表可换行（不再折叠 +N）', /\.txn-tag-list \{[\s\S]*?flex-wrap: wrap/.test(recent), true)
check('txnBadges 已暴露给模板', /txnTitle, txnSub, txnBadges,/.test(recent), true)
check('有标签样式', /\.txn-tag\s*\{/.test(recent), true)
check('有标签容器样式', /\.txn-tag-list\s*\{/.test(recent), true)

/* ------------------------------------------------ 7. 暗色高亮块不透白 */

console.log('=== 暗色：前三名高亮块 ===')
/*
 * 暗色下 --app-primary-light 是半透明色，铺成整行背景时
 * 圆角边缘/条目间隙会透出父层，看起来像一圈发白的阴影。
 * 修法：整行色块改用不透明的 --app-primary-light-solid。
 */
const themeSrc = read('utils/theme.js')
check('导出 mixHex', /export function mixHex/.test(themeSrc), true)
check(
  '暗色有不透明高亮色',
  /'--app-primary-light-solid': mixHex\('#1C1C1E', p\.primary, 0\.22\)/.test(themeSrc),
  true
)
check('浅色有对应变量', /'--app-primary-light-solid': p\.light/.test(themeSrc), true)

const statsSrc = read('pages/stats/index.vue')
check('前三名用不透明高亮色', /--app-primary-light-solid/.test(statsSrc), true)
check('高亮块去掉分隔线', /\.top-item-hi\s*\{[\s\S]*?border-bottom: none/.test(statsSrc), true)

/* ------------------------------ 7b. 总结余 + 底部「查看全部」 */

console.log('=== 总结余与底部查看全部 ===')

/*
 * ★ 标签详情：总收入下方要有「总结余」（本轮新增）★
 *   用户原话：「标签管理页面大的价签总收入下方添加一个总结余」。
 *   口径 = 总收入 - 总支出，可能为负，所以走 variant="balance"
 *   （正绿负红、0 无色），不能用单向的 type。
 */
check('标签详情有总结余条目', /summary-row-label">总结余/.test(tag), true)
check(
  '总结余 = 总收入 - 总支出',
  /总结余[\s\S]{0,260}?totalStats\.income - totalStats\.expense/.test(tag),
  true
)
check('总结余用 balance 变体（正绿负红）', /variant="balance"/.test(tag), true)
check('总结余排在总收入之后', tag.indexOf('总结余') > tag.indexOf('总收入'), true)

/*
 * ★ 五个详情页的流水底部要有居中「查看全部 ›」★
 *   用户原话：「分类详情、周期、预算、标签四个页面下方显示的流水
 *   划底部时显示查看更多的按钮，样式居中，参考首页智能助手的按钮样式，
 *   点击进入全部交易界面（附带筛选条件）」。
 *   后续要求账户详情页的最近流水也按同一套展示。
 *
 *   样式复用 components/HeaderAction.vue（= 首页「智能助手」那个胶囊），
 *   所以断言重点是：五个页面都开了 show-footer-more，
 *   组件里那个按钮用的是 HeaderAction 且居中。
 */
for (const [name, src] of [
  ['账户详情', acc],
  ['分类详情', cat],
  ['周期详情', cyc],
  ['预算详情', budget],
  ['标签详情', tag]
]) {
  check(name + ' 的流水底部开了查看全部', /show-footer-more/.test(src), true)
  check(name + ' 仍然把点击接到 goAllTxn', /@more="goAllTxn"/.test(src), true)
}

check('组件有 showFooterMore 开关', /showFooterMore: \{ type: Boolean/.test(recent), true)

/*
 * ★ 只有没显示完才显示底部按钮（用户要求）★
 *   用户原话：「只有没显示完全才显示查看全部，
 *   如果记录全部显示出了就不要显示查看全部了」。
 *   所以 v-if 里必须有 hasMoreThanShown，不能只看 showFooterMore。
 */
check(
  '底部按钮带「没显示完」条件',
  /v-if="showFooterMore && hasMoreThanShown"/.test(recent),
  true
)
check('有 hasMoreThanShown 计算属性', /const hasMoreThanShown = computed/.test(recent), true)
check('hasMoreThanShown 暴露给模板', /visibleTxns, groups, hasMoreThanShown,/.test(recent), true)
check('组件能接收真实总笔数', /totalCount: \{ type: Number/.test(recent), true)
check(
  '有总数时按总数判断（不是只看手里这批）',
  /const total = Number\(props\.totalCount\) \|\| 0[\s\S]{0,160}?total > visibleTxns\.value\.length/.test(recent),
  true
)

// 五个页面都要把真实总笔数传进去，否则判断永远不成立
// 账户详情用 countTransactions 的列表口径（含借入借出），不能拿 sum 的 count 顶替
check('账户详情传了总笔数', /:total-count="totalCount"/.test(acc), true)
check('账户详情用列表口径取总笔数', /countTransactions\(\{ accountId: accountId\.value \}\)/.test(acc), true)
check('分类详情传了总笔数', /:total-count="totalStats\.count"/.test(cat), true)
check('标签详情传了总笔数', /:total-count="totalStats\.count"/.test(tag), true)
check('预算详情传了总笔数', /:total-count="monthStats\.count"/.test(budget), true)
check('周期详情传了总笔数', /:total-count="totalCount"/.test(cyc), true)
check(
  '组件引入 HeaderAction',
  /import HeaderAction from '@\/components\/HeaderAction\.vue'/.test(recent),
  true
)
check('组件注册了 HeaderAction', /components: \{[^}]*HeaderAction/.test(recent), true)
check('底部按钮用 HeaderAction', /<HeaderAction @action-click="onMore">查看全部/.test(recent), true)
check('底部按钮居中', /\.footer-more\s*\{[^}]*justify-content: center/.test(recent), true)

/* ------------------------------------------------ 6. 交易详情 */

console.log('=== 交易详情：分类层级 + 时间合并 ===')
const txnDetail = read('pages/txn/detail.vue')
const txnApi = read('api/transaction.js')

/*
 * 用户要求：
 *   1. 分类显示「一级 - 二级」；
 *   2. 日期和时间合并成一行「时间」；
 *   3. 图标样式跟设置走（CategoryGlyph 自己读 settingStore.emojiStyle）。
 */
check(
  '交易查询带上一级分类名',
  /pc\.name AS category_parent_name/.test(txnApi) && /JOIN category pc ON pc\.id = c\.parent_id/.test(txnApi),
  true
)
check('详情页有 categoryLabel', /const categoryLabel = computed/.test(txnDetail), true)
check(
  '分类按「一级 - 二级」拼接',
  /return `\$\{parent\} - \$\{child\}`/.test(txnDetail),
  true
)
check(
  '不再有单独的日期行',
  /<text class="row-label">日期<\/text>/.test(txnDetail),
  false
)
check(
  '日期时间合并为一行「时间」',
  /<text class="row-label">时间<\/text>[\s\S]{0,80}?\{\{ datetimeLabel \}\}/.test(txnDetail),
  true
)
check(
  '详情页图标用 CategoryGlyph（跟随全局图标样式）',
  /<CategoryGlyph[\s\S]{0,160}?:icon="txn\.category_icon"/.test(txnDetail),
  true
)
check(
  '详情页分类底色走 categoryTint（深色加深）',
  /categoryTint\(txn\.category_color/.test(txnDetail),
  true
)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
