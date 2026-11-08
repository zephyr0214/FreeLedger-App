/**
 * 第二轮反馈的回归测试（v1.22.0）
 *
 *   node scripts/test-reimburse-round2.mjs
 *
 * 覆盖用户这一轮的五条：
 *   1. 交易详情 / 记账面板要「勾选框」而不是按钮式样式；
 *      周期面板也要这两个勾选，且「周期 + 几号」并到一行、放在备注下方
 *   2. AI 速记胶囊：每次打开默认不勾（上一次勾了没发送不能留到下次）；
 *      点胶囊时输入法不能缩回
 *   3. 待报销 / 已报销要在流水上显示成 tag
 *   4. 报销管理页：待报销不划删除线，已报销才划
 *   5. 报销管理页去掉底部提示语；报销弹层的金额价签在右侧
 *      （差额提示走「修改账户余额」弹层那种样式）
 *
 * 另外钉住 v22 迁移（cycle 表加两列）与版本号同步 ——
 * 这两处一旦漏掉，用户在旧库上升级后周期勾选会静默丢失。
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { SCHEMA_VERSION } from '../api/db/schema.js'
import { APP_VERSION, RELEASES } from '../utils/version.js'
import { reimburseBadge, PENDING_REIMBURSE_COLOR, DONE_REIMBURSE_COLOR } from '../utils/reimburseBadge.js'

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

/** 只取模板部分，并去掉 HTML 注释（断言只看用户看得见的节点） */
function templateOf(src) {
  const i = src.indexOf('<template>')
  const j = src.indexOf('<script')
  if (i === -1) return src
  const tpl = src.slice(i, j === -1 ? src.length : j)
  return tpl.replace(/<!--[\s\S]*?-->/g, '')
}

const FLAGS = read('components/ExcludeFlags.vue')
const DETAIL = read('pages/txn/detail.vue')
const PANEL = read('components/TxnPanel.vue')
const CYCLP = read('components/CyclePanel.vue')
const QUICK = read('components/QuickAddBar.vue')
const REIMB = read('pages/loan/reimburse.vue')
const CYCLE_API = read('api/cycle.js')
const DB = read('api/db/index.js')
const BACKUP = read('api/backup.js')

/* ============================ 1. 勾选框（详情页 / 记账面板） */

console.log('=== 1. 勾选框样式（不是按钮）===')

check('ExcludeFlags 有勾选框方块', /class="flag-box"/.test(FLAGS), true)
check('勾选框选中时是主题实底', /\.flag-box\.on\s*\{[\s\S]{0,200}?var\(--app-primary\)/.test(FLAGS), true)
check(
  '勾选框里有对勾字符',
  /class="flag-tick">✓</.test(FLAGS),
  true
)
check(
  '勾选框带 border-radius（方框，不是圆点）',
  /\.flag-box\s*\{[\s\S]{0,200}?border-radius:\s*8rpx/.test(FLAGS),
  true
)
check('详情页用 ExcludeFlags 渲染', /<ExcludeFlags/.test(DETAIL), true)
check('记账面板用 ExcludeFlags 渲染', /<ExcludeFlags/.test(PANEL), true)

/* ============ 1b. 周期面板：勾选 + 周期与几号同一行 + 备注下方 */

console.log('=== 1b. 周期面板 ===')

const cycTpl = templateOf(CYCLP)
check('周期面板引用了 ExcludeFlags', /<ExcludeFlags/.test(cycTpl), true)
check(
  '「不计入预算 / 待报销」写在备注之后',
  cycTpl.indexOf('备注') !== -1 &&
    cycTpl.indexOf('备注') < cycTpl.indexOf('<ExcludeFlags'),
  true
)
check(
  '周期与几号在同一行（form-row-split + 两个 form-cell）',
  /form-row-split/.test(cycTpl) && (cycTpl.match(/class="form-cell/g) || []).length >= 2,
  true
)
check(
  '「周期」和「几号」都在这一行的两格里',
  /cell-label">周期/.test(cycTpl) &&
    /form\.recurrence === 'weekly' \? '周几' : '几号'/.test(cycTpl),
  true
)
check('只有支出才显示这两个勾选', /form\.type === 'expense'/.test(cycTpl), true)
check('面板里有 onFlagsUpdate 处理', /function onFlagsUpdate\(next\)/.test(CYCLP), true)
check('form 里有这两个字段', /excludeBudget: false/.test(CYCLP) && /reimburseStatus: 0/.test(CYCLP), true)
check('保存时把标记写进周期', /exclude_from_budget: form\.type === 'expense'/.test(CYCLP), true)

/* =========================== 2. AI 速记胶囊 */

console.log('=== 2. AI 速记胶囊 ===')

check(
  '触摸用 stop.prevent（阻止输入框失焦）',
  /@touchstart\.stop\.prevent="holdInputAlive"/.test(QUICK),
  true
)
check('touchend 立刻处理点按', /@touchend\.stop="onChipTap/.test(QUICK), true)
check('click 兜底去重', /chipTouchedAt/.test(QUICK), true)
check(
  '保活窗口 ≥ 1 秒（覆盖一轮键盘收起再弹起）',
  /keepAliveUntil = Date\.now\(\) \+ 1200/.test(QUICK),
  true
)
check('关闭时清空勾选状态', /close\(\)[\s\S]{0,1200}?pendingReimburse\.value = false/.test(QUICK), true)
check('重新打开时也清空勾选状态', /autoReimburse = false[\s\S]{0,200}?pendingReimburse\.value = false/.test(QUICK), true)
check(
  'watch(modelValue) 关闭分支同样清空',
  /if \(!open\) \{[\s\S]{0,600}?pendingReimburse\.value = false/.test(QUICK),
  true
)

/* ========================= 3. 待报销 / 已报销 tag */

console.log('=== 3. 报销状态 tag ===')

check('badge 工具导出待报销颜色', typeof PENDING_REIMBURSE_COLOR, 'string')
check('badge 工具导出已报销颜色', typeof DONE_REIMBURSE_COLOR, 'string')
check('status=0 不挂徽标', reimburseBadge({ reimburse_status: 0 }), null)
check('status=1 是「待报销」', reimburseBadge({ reimburse_status: 1 }).name, '待报销')
check('status=2 是「已报销」', reimburseBadge({ reimburse_status: 2 }).name, '已报销')
check('徽标带半透明底', /^#[0-9A-Fa-f]{6}22$/.test(reimburseBadge({ reimburse_status: 1 }).bg), true)

/*
 * ★ 徽标构建已收归 utils/txnBadges.js（用户第 1 条）★
 *   以前四个页面各自拼一份 push 顺序，现在统一调 buildTxnBadges()。
 *   所以断言从「拉 reimburseBadge」改成「拉 buildTxnBadges」。
 *   顺序本身由 utils/txnBadges.js 的单元测试钉住。
 */
check('首页最近流水挂了徽标', /buildTxnBadges\(txn/.test(read('pages/index/index.vue')), true)
check('全部交易页挂了徽标', /buildTxnBadges\(txn/.test(read('pages/txn/list.vue')), true)
check('交易详情页挂了徽标', /buildTxnBadges\(t/.test(DETAIL), true)
check('公共列表组件挂了徽标', /buildTxnBadges\(txn/.test(read('components/RecentTxnList.vue')), true)

/* ===================== 4. 报销管理：删除线归属 */

console.log('=== 4. 报销管理页删除线 ===')

check('待报销行没有删除线样式', /\.amount-strike\s*\{/.test(REIMB), false)
check('待报销金额用正常样式', /class="amount-pending"/.test(REIMB), true)
check('已报销才划掉原金额', /class="batch-origin-strike"/.test(REIMB), true)
check(
  '划掉的是原支出金额',
  /class="batch-origin-strike">¥\{\{ yuan\(t\.amount_cents\) \}\}/.test(REIMB),
  true
)
/*
 * ★ 第 5 条改了：明细里只划原金额，不再显示实报金额 ★
 *   用户原话「只划掉原有金额，不显示实报金额」——
 *   实报金额只在卡头出现一次（batch-done-amount），
 *   明细行重复显示会让人误以为那是两笔不同的钱。
 */
check(
  '明细里不再重复显示实报金额',
  /batch-origin-strike[\s\S]{0,400}?reimburse_amount_cents/.test(REIMB),
  false
)
check('实报金额只在卡头出现', /class="batch-done-amount"/.test(REIMB), true)
check('卡头有报销笔数', /报销笔数/.test(REIMB), true)

/* ============== 5. 底部提示语 + 弹层金额右侧 */

console.log('=== 5. 报销管理底部提示 & 报销弹层 ===')

check('底部提示卡片已删除', /tip-card/.test(REIMB), false)
check('提示文案已删除', /右滑单笔可以直接报销/.test(REIMB), false)

check('金额行不再是列布局', /sheet-row-column/.test(REIMB), false)
check(
  '实际报销金额行与其它行同一种左右排版',
  /class="sheet-row sheet-row-amount"/.test(REIMB),
  true
)
check('金额输入右对齐', /\.amount-input\s*\{[\s\S]{0,300}?text-align:\s*right/.test(REIMB), true)
check(
  '差额提示是「左说明 / 右彩色差值」',
  /class="sheet-diff"/.test(REIMB) &&
    /class="sheet-diff-label"/.test(REIMB) &&
    /class="sheet-diff-value"/.test(REIMB),
  true
)
check('差额颜色分多了/少了', /const diffColor = computed/.test(REIMB), true)
check('差额文案分多了/少了/相等', /刚好相等/.test(REIMB) && /多了 ¥/.test(REIMB) && /少了 ¥/.test(REIMB), true)

/* =================== 6. v22 迁移与版本号 */

console.log('=== 6. 周期标记的数据库迁移 ===')

check('SCHEMA_VERSION 是 23（v23 报销单）', SCHEMA_VERSION, 23)
check('有 v22 迁移', /version: 22,\s*\n\s*up: migrateCycleFlags/.test(DB), true)
check('迁移建 exclude_from_budget 列', /migrateCycleFlags[\s\S]{0,900}'exclude_from_budget INTEGER NOT NULL DEFAULT 0'/.test(DB), true)
check('迁移建 reimburse_status 列', /migrateCycleFlags[\s\S]{0,900}'reimburse_status INTEGER NOT NULL DEFAULT 0'/.test(DB), true)

check('cycle API 读这两列', /exclude_from_budget: Number\(row\.exclude_from_budget\) === 1/.test(CYCLE_API), true)
check('createCycle 写入这两列', /INSERT INTO cycle[\s\S]{0,900}?exclude_from_budget, reimburse_status/.test(CYCLE_API), true)
check('updateCycle 能改这两列', /assign\('exclude_from_budget'/.test(CYCLE_API), true)
check(
  '补记流水时带上周期标记',
  /recordCycleForDay[\s\S]{0,2000}?exclude_from_budget: c\.exclude_from_budget === true/.test(CYCLE_API),
  true
)
check(
  '只允许周期带「待报销」，不允许已报销',
  /reimburse_status: Number\(c\.reimburse_status\) === 1 \? 1 : 0/.test(CYCLE_API),
  true
)
check('备份导入也带上这两列', /exclude_from_budget, reimburse_status\)\s*\n\s*VALUES/.test(BACKUP), true)

check('版本号是 1.23.2', APP_VERSION, '1.23.2')
check('更新日志最新一条是 1.23.2', RELEASES[0].version, '1.23.2')
check('更新日志的 schemaVersion 与迁移对齐', RELEASES[0].schemaVersion, SCHEMA_VERSION)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
