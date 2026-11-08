/**
 * 报销 / 内部口径分类 / 恩格尔触发的回归测试
 *
 *   node scripts/test-reimburse-flags.mjs
 *
 * 覆盖本轮用户需求：
 *   1. 详情页与记账面板不再有「报销与预算」标题和说明小字，
 *      改成一竖分割线居中两栏（ExcludeFlags 布局）
 *   2. AI 速记的两个胶囊有主题色描边；点胶囊不能把输入条收起来
 *   3. 勾「待报销」→「不计入预算」自动勾上并锁死；
 *      取消「待报销」→ 一起取消并恢复可点
 *   4. AI 识别「报销」二字时勾选待报销，没有这两个字时取消勾选（双向实时）
 *   5. 待报销可以由 AI / 手动记账产生，但「已报销」不能
 *   6. 借入利息 / 借出坏账 / 借出利息 / 借入未还 / 报销坏账 / 报销盈余
 *      不能被 AI 记账，也不能在手动记账面板选择
 *   7. 恩格尔系数不在 AI 记账时检查，改为进统计页时检查 + 分类保存后重判
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf-8')
}

/**
 * 只取模板部分（<template> ... </template>，到第一个 <script> 前）
 *
 * ★ 为什么要剥掉注释 ★
 *   源码注释里还留着「不要再显示『报销与预算』」这类说明，
 *   直接整文件搜索会把注释也算命中。
 *   断言只针对用户能看到的模板。
 */
function templateOf(src) {
  const i = src.indexOf('<template>')
  const j = src.indexOf('<script')
  if (i === -1) return src
  const tpl = src.slice(i, j === -1 ? src.length : j)
  // 再去掉 HTML 注释，只留用户真正看得到的节点
  return tpl.replace(/<!--[\s\S]*?-->/g, '')
}

const DETAIL = read('pages/txn/detail.vue')
const PANEL = read('components/TxnPanel.vue')
const FLAGS = read('components/ExcludeFlags.vue')
const QUICK = read('components/QuickAddBar.vue')
const AIPARSE = read('api/aiParse.js')
const SORT = read('utils/categorySort.js')
const STATS = read('pages/stats/index.vue')
const CATPAGE = read('pages/settings/category.vue')
const ENGEL = read('api/engel.js')

/* =============================================== 1. 详情页排版 */

console.log('=== 1. 详情页：去掉「报销与预算」标题与说明小字 ===')

check('详情页模板不再有「报销与预算」', /报销与预算/.test(templateOf(DETAIL)), false)
check('详情页不再有 flagsHint 小字', /flagsHint/.test(DETAIL), false)
check('详情页不再有 row-hint 样式', /\.row-hint\s*\{/.test(DETAIL), false)
check('详情页用一行 flags-row 承载双栏', /class="row flags-row"/.test(DETAIL), true)
check('详情页那一行居中', /\.flags-row\s*\{[\s\S]{0,200}?justify-content:\s*center/.test(DETAIL), true)

console.log('=== 1b. ExcludeFlags：竖分割线 + 居中 ===')

check('有竖分割线元素', /class="flag-divider"/.test(FLAGS), true)
check(
  '分割线是 1rpx 竖线',
  /\.flag-divider\s*\{[\s\S]{0,200}?width:\s*1rpx[\s\S]{0,200}?height:\s*28rpx/.test(FLAGS),
  true
)
check(
  '两栏等宽并居中',
  /\.flag-item\s*\{[\s\S]{0,200}?flex:\s*1[\s\S]{0,200}?justify-content:\s*center/.test(FLAGS),
  true
)
check('行本身居中', /\.flag-row\s*\{[\s\S]{0,200}?justify-content:\s*center/.test(FLAGS), true)
check('文案是「不计入预算」', /不计入预算/.test(FLAGS), true)
check('每项都是「勾选框 + 文字」（改回勾选框）', /class="flag-box"/.test(FLAGS), true)
check(
  '勾选框有主题色实底',
  /\.flag-box\.on\s*\{[\s\S]{0,200}?background-color:\s*var\(--app-primary\)/.test(FLAGS),
  true
)
check('文案是「待报销」', /待报销/.test(FLAGS), true)

console.log('=== 1c. 记账面板同样形态 ===')

check('面板模板不再有「报销与预算」', /报销与预算/.test(templateOf(PANEL)), false)
check('面板那一行居中', /\.form-row-flags\s*\{[\s\S]{0,120}?justify-content:\s*center/.test(PANEL), true)
check('面板不再有 flags-wrap 包裹层', /flags-wrap/.test(PANEL), false)

/* ======================================= 2. 胶囊：描边 + 点击不收起 */

console.log('=== 2. AI 速记胶囊 ===')

check(
  '胶囊有主题色描边',
  /\.qa-chip\s*\{[\s\S]{0,300}?border:\s*2rpx solid var\(--app-primary\)/.test(QUICK),
  true
)
check(
  '胶囊里的小方框也是主题色描边',
  /\.qa-chip-box\s*\{[\s\S]{0,200}?border:\s*2rpx solid var\(--app-primary\)/.test(QUICK),
  true
)
/*
 * ★ 触摸必须 .prevent ★
 *   只 stop 不 prevent 时，原生输入框还是会先失焦、键盘照样收起 ——
 *   这正是本轮用户反馈的「点胶囊输入法缩回」。
 */
check(
  '胶囊触摸时阻止夺焦并保活输入条',
  /@touchstart\.stop\.prevent="holdInputAlive"/.test(QUICK),
  true
)
check(
  '触摸结束时立刻处理点按（不等 300ms 的 click）',
  /@touchend\.stop="onChipTap\('reimburse'\)"/.test(QUICK),
  true
)
check(
  'click 只作兜底且去重',
  /function onChipClick\(which\)/.test(QUICK) && /chipTouchedAt/.test(QUICK),
  true
)
check('有保活窗口', /keepAliveUntil/.test(QUICK), true)
check(
  '键盘归零时先看保活窗口再决定关闭',
  /if \(Date\.now\(\) < keepAliveUntil\)\s*\{[\s\S]{0,120}?return/.test(QUICK),
  true
)
check('保活后把焦点还给输入框', /function refocus\(\)/.test(QUICK), true)

/* ============================================= 3. 双栏联动规则 */

console.log('=== 3. 待报销 ↔ 不计入预算 联动 ===')

check(
  '勾上待报销时自动勾不计入预算',
  /excludeBudget:\s*next === 1/.test(FLAGS),
  true
)
check('取消待报销时一起取消（不再保留）', /excludeBudget:\s*next === 1\b/.test(FLAGS), true)
check(
  '待报销时不计入预算锁死',
  /const budgetLocked = computed\(\(\) => reimburseChecked\.value\)/.test(FLAGS),
  true
)
check('已报销锁死不可取消', /reimburseStatus === 2 \|\| props\.doneLocked/.test(FLAGS), true)

/* ==================================== 4. AI 识别「报销」实时勾选 */

console.log('=== 4. 输入含「报销」实时勾选 / 取消 ===')

check(
  'watch 里按「报销」二字判定',
  /const has = \/报销\/\.test\(String\(text \|\| ''\)\)/.test(QUICK),
  true
)
check('勾选状态随输入双向同步', /pendingReimburse\.value = has/.test(QUICK), true)
check('取消时不计入预算一起取消', /excludeBudget\.value = has/.test(QUICK), true)
check(
  '只在结论翻转时回写（不吞手动操作）',
  /if \(has === autoReimburse\) return/.test(QUICK),
  true
)

/* ============================== 5. 待报销可 AI 记账，已报销不能 */

console.log('=== 5. 待报销 / 已报销 的写入边界 ===')

check(
  'AI 侧不再一见「报销」就整条拒绝',
  /if \(\/报销\/\.test\(message\)\) \{\s*const err = new Error\(/.test(AIPARSE),
  false
)
check('AI 侧改为只拦「已完成报销」语义', /isReimburseDoneText/.test(AIPARSE), true)
check(
  '完成态词表包含已报销/报销到账',
  /已报销\|报销到账/.test(AIPARSE),
  true
)
check('提示词允许把报销记成普通待报销支出', /程序会自动把那笔标成「待报销」/.test(AIPARSE), true)

const TXN = read('api/transaction.js')
check(
  'createTransaction 拒绝直接写入已报销',
  /Number\(input\.reimburse_status\) === 2[\s\S]{0,160}?throw new Error/.test(TXN),
  true
)
check(
  'updateTransaction 拒绝把未报销改成已报销',
  /Number\(patch\.reimburse_status\) === 2 && Number\(existing\.reimburse_status\) !== 2/.test(TXN),
  true
)

/* =================================== 6. 六类内部口径分类不可选 */

console.log('=== 6. 内部口径分类：AI 与手动都选不到 ===')

check('categorySort 导出内部口径判定', /export function isInternalOnlyCategory/.test(SORT), true)
check(
  'isSelectableCategory 先挡内部口径',
  /isSelectableCategory[\s\S]{0,400}?isInternalOnlyCategory\(cat\)\) return false/.test(SORT),
  true
)

const SCHEMA = read('api/db/schema.js')
for (const n of ['借入利息', '借出坏账', '借出利息', '借入未还', '报销坏账', '报销盈余']) {
  check(`清单含「${n}」`, new RegExp(`'${n}'`).test(SCHEMA), true)
}

check('AI 候选分类过滤内部口径（一级）', /if \(!isInternalOnlyCategory\(p\.name\)\)/.test(AIPARSE), true)
check('AI 候选分类过滤内部口径（二级）', /if \(isInternalOnlyCategory\(c\.name\)\) continue/.test(AIPARSE), true)
check(
  'AI 命中内部口径分类时不采信',
  /if \(hit && !isInternalOnlyCategory\(hit\.name\)\)/.test(AIPARSE),
  true
)
check(
  '面板默认分类跳过内部口径',
  /const list = categories\.value\.filter\(\s*[\s\S]{0,200}?!isInternalOnlyCategory\(c\.name\)/.test(PANEL),
  true
)

/* ========================================== 7. 恩格尔触发时机 */

console.log('=== 7. 恩格尔系数：不在记账时查，改在统计页 ===')

check('AI 速记条不再检查恩格尔', /ensureEngelFoodCategories|getEngelFoodIds/.test(QUICK), false)

/*
 * ★ 第 3 条改了口径：AI 识别食品分类的整套逻辑要删除 ★
 *   用户原话：「让用户自行选择用于食物消费的支出分类来计算恩格尔系数，
 *             之前添加的 ai 识别食物消费什么的逻辑全部删除」。
 *   所以这一节从「钉 AI 的触发时机」翻成「钉 AI 已经不存在」。
 */
check('统计页不再读 AI 判定缓存', /getEngelCacheState/.test(STATS), false)
check('统计页不再触发 AI 判定', /ensureEngelFoodCategories/.test(STATS), false)
check('统计页不再有「自动判过一次」的标记', /engelAutoTried/.test(STATS), false)
check('统计页不再有判定 loading 态', /engelLoading/.test(STATS), false)
check('统计页不再显示「正在识别食品分类」', /正在识别食品分类/.test(STATS), false)
check('统计页改成读用户手选的分类', /getEngelFoodIds/.test(STATS), true)
check('没选分类时给引导文案', /还没选食品分类/.test(STATS), true)
check('分类页不再重判恩格尔', /refreshEngelFoodCategories/.test(CATPAGE), false)
check('分类页不再有 rejudgeEngel', /rejudgeEngel/.test(CATPAGE), false)
check('engel.js 里没有 AI 调用', /await chat\(/.test(ENGEL), false)
check('engel.js 提供手选读取接口', /export async function getEngelFoodIds/.test(ENGEL), true)

/* ============================================= 8. 深浅色适配 */

console.log('=== 8. 深浅色模式适配（只用 CSS 变量）===')

const flagStyle = FLAGS.slice(FLAGS.indexOf('<style scoped>'))
/*
 * ★ 对勾是白色 ★
 *   主题色实底上的对勾必须是白色（和预算页结转勾选、报销多选圈一致），
 *   这是唯一允许的硬编码色值；正文/分隔线/底色都必须走 CSS 变量。
 */
const flagStyleNoTick = flagStyle.replace(/\.flag-tick\s*\{[\s\S]*?\}/, '')
check('除了对勾外不用硬编码白/黑', /#fff\b|#ffffff/i.test(flagStyleNoTick), false)
check('对勾是白色（主题实底上唯一允许的写死色）', /color:\s*#ffffff/.test(flagStyle), true)
check('ExcludeFlags 用主题变量取色', /var\(--app-primary\)/.test(flagStyle), true)
check('ExcludeFlags 分割线用 --app-line', /var\(--app-line\)/.test(flagStyle), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
