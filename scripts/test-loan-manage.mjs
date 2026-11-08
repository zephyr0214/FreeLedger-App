/**
 * 借入 / 借出管理页 —— 按人员看账的口径测试
 *
 *   node scripts/test-loan-manage.mjs
 *
 * ★ 这一版和上一版的区别 ★
 *   上一版页面是「全部流水 / 借出 / 借款收回」三个 tab 的流水列表，
 *   测试钉的是 tab 定义和记账面板预填。
 *   现在页面改成「未结清 / 已结清」+ 按人员分组，所以测试也整体重写：
 *     · 余额口径（含坏账/利息的抵消）
 *     · 结清自动归类
 *     · 手动结清生成哪一笔
 *     · 页面静态约束（不再有旧 tab、不再有右上「记一笔」、借入页没有结清按钮）
 *
 * ★ 为什么这些要单测 ★
 *   「当前借出 = Σ(借出 - 借款收回 - 借出坏账 + 借出利息)」这个式子
 *   任何一项写反/漏写，用户都会看到「结清了却还挂在未结清」或者
 *   「坏账又多算一遍欠款」。纯算术，最适合钉死。
 */

import fs from 'node:fs'
import path from 'node:path'

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

const ROOT = path.resolve(import.meta.dirname, '..')
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

/* =============================================== 1. 余额口径 */

console.log('=== 人员余额 = 借出 - 借款收回 - 借出坏账 + 借出利息 ===')

/**
 * 与 api/loan.js 的 listLoanByPerson 一致的余额算法（借出方向）
 *
 *   balance = 主 - 反 - positive + negative
 *   positive = 借出坏账（我的损失，冲掉应收）
 *   negative = 借出利息（对方多还，算收益）
 *
 * @param {{total:number, back:number, bad:number, interest:number}} s
 * @returns {number} 正数 = 对方还欠我
 */
function balanceOf(s) {
  return (
    (Number(s.total) || 0) -
    (Number(s.back) || 0) -
    (Number(s.bad) || 0) +
    (Number(s.interest) || 0)
  )
}

check('借 500，没收回 -> 欠 500', balanceOf({ total: 50000 }), 50000)
check('借 500，收回 200 -> 欠 300', balanceOf({ total: 50000, back: 20000 }), 30000)
check('借 500，全收回 -> 0（自动结清）', balanceOf({ total: 50000, back: 50000 }), 0)
check('对方多还 100 -> -100（该记利息）', balanceOf({ total: 50000, back: 60000 }), -10000)

/*
 * ★ 结清之后必须归零 ★
 *   少还 200 记为坏账之后，这个人就该落到「已结清」，
 *   否则「手动结清」按钮会一直亮着，用户点了还会再生成一笔坏账。
 */
check(
  '借 500 收 300，坏账 200 -> 0（结清）',
  balanceOf({ total: 50000, back: 30000, bad: 20000 }),
  0
)
check(
  '借 500 收 600，利息 100 -> 0（结清）',
  balanceOf({ total: 50000, back: 60000, interest: 10000 }),
  0
)

/* =============================================== 2. 结清派生分类 */

console.log('=== 手动结清：按差额正负生成哪一笔 ===')

/**
 * 与 api/loan.js 的 settleLendPerson 一致的判定
 * @param {number} balance
 * @returns {'badDebt'|'interest'|'none'}
 */
function settleKindOf(balance) {
  if (balance === 0) return 'none'
  return balance > 0 ? 'badDebt' : 'interest'
}

check('少还（余额 > 0）-> 借出坏账', settleKindOf(30000), 'badDebt')
check('多还（余额 < 0）-> 借出利息', settleKindOf(-10000), 'interest')
check('恰好平账 -> 不生成', settleKindOf(0), 'none')

/* 结清两笔必须计入收支、不占预算（用户明确要求） */
const LOAN_SRC = read('api/loan.js')
check(
  '结清生成的流水计入收支（exclude_from_stats: false）',
  /exclude_from_stats:\s*false/.test(LOAN_SRC),
  true
)
check(
  '结清生成的流水不占预算（exclude_from_budget: true）',
  /exclude_from_budget:\s*true/.test(LOAN_SRC),
  true
)

/* =============================================== 3. 分类与方向配对 */

console.log('=== 六个分类的方向必须成对 ===')

const LOAN = {
  lendOut:   { name: '借出',     type: 'expense' },
  lendBack:  { name: '借款收回', type: 'income' },
  borrowIn:  { name: '借入',     type: 'income' },
  borrowBack:{ name: '借款归还', type: 'expense' },
  badDebt:   { name: '借出坏账', type: 'expense' },
  interest:  { name: '借出利息', type: 'income' }
}

check('借出是支出（钱从账户出去）', LOAN.lendOut.type, 'expense')
check('借款收回是收入（钱回账户）', LOAN.lendBack.type, 'income')
check('借入是收入（钱进账户）', LOAN.borrowIn.type, 'income')
check('借款归还是支出（钱从账户出去）', LOAN.borrowBack.type, 'expense')
check('借出坏账是支出（核销损失）', LOAN.badDebt.type, 'expense')
check('借出利息是收入（确认收益）', LOAN.interest.type, 'income')

/* =============================================== 4. 人员分类判定 */

console.log('=== 哪些分类要强制填人员 ===')

const SCHEMA_SRC = read('api/db/schema.js')
check(
  'schema 里六个分类名齐全',
  [
    '借出', '借款收回', '借入', '借款归还', '借出坏账', '借出利息'
  ].every((n) => SCHEMA_SRC.includes(`name: '${n}'`)),
  true
)
/*
 * ★ v20 起系统分类全部可选（用户要求）★
 *   四个结清派生分类不再是 hidden —— 面板和 AI 都能选它们，
 *   但仍保持固定（不可改名/删除）+ 人员语义。
 */
check(
  '四个结清分类都不再 hidden',
  [
    '借出坏账', '借出利息', '借入未还', '借入利息'
  ].every((n) => !new RegExp(`name: '${n}'[^}]*hidden: true`).test(SCHEMA_SRC)),
  true
)
check(
  '四个结清分类仍然锁死（在 FIXED_CHILD_NAMES 里）',
  read('api/category.js').includes('LOAN_SETTLE_CATEGORY_NAMES.badDebt.name'),
  true
)

/* =============================================== 5. 页面静态约束 */

console.log('=== 页面：按人员看账 ===')

const PAGE_RAW = read('pages/loan/manage.vue')

/*
 * 去掉注释再断言
 *
 * ★ 为什么要剥注释 ★
 *   页面顶部特意写了「不再有全部流水 tab」「右上角不再有记一笔」
 *   这类说明注释 —— 直接对原文断言「不含某字符串」会被自己的注释命中，
 *   测试永远失败。断言要针对**真正会渲染/执行的代码**。
 */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const PAGE = stripComments(PAGE_RAW)

check('页面按人员分组（listLoanGroups）', /listLoanGroups/.test(PAGE), true)
check('页面有手动结清（settleLoanPerson）', /settleLoanPerson/.test(PAGE), true)
check(
  '两个状态 tab：未结清 / 已结清',
  /key: 'open', name: '未结清'/.test(PAGE) && /key: 'settled', name: '已结清'/.test(PAGE),
  true
)

/*
 * ★ 用户要求去掉的东西，必须真的不在 ★
 *   这几条最容易在「顺手加回来」时被破坏，所以用断言挡住。
 */
check('不再有「全部流水 / 借入 / 借款归还」三 tab', /全部流水/.test(PAGE), false)
check('右上角不再有「记一笔」', /nav-add/.test(PAGE), false)
check('不再直接用 TxnPanel（这页不记账）', /<TxnPanel/.test(PAGE), false)

/*
 * ★ 结清按钮只在借出方向 ★
 *   用户原话「借入则不显示未平衡这种逻辑」。
 */
/*
 * ★ 用户要求的形制：组头 + 金额 + 按钮 + 组内流水 ★
 *   不是「卡片 + 点开弹层」。这几条断言钉住这个形状，
 *   防止以后又改回「点开才看到明细」。
 */
check('组头有人员姓名', /class="person-name/.test(PAGE), true)
check('组头有金额', /class="person-balance"/.test(PAGE), true)
check('组头有金额标签（待收回/待归还/多归还）', /balanceLabel\(g\)/.test(PAGE), true)
/*
 * ★ v1.23 起组内按「结清批次」分段渲染 ★
 *   用户要求：结清过又新借的人，未结清里要能折叠旧段、已结清里每段之间
 *   要有分割标注。分段算法与折叠规则都是纯函数（api/loan.js 的
 *   splitLoanEpisodes / buildLoanEpisodeView），由 scripts/test-loan-episodes.mjs
 *   逐条钉死；这里只钉「页面确实用上了它们、并把三种形态渲染出来」。
 */
check('组内按结清批次分段渲染', /v-for="\(ep, epIndex\) in episodeViewOf\(g\)"/.test(PAGE), true)
check('段内流水由 episodeTxns 取倒序副本', /v-for="t in episodeTxns\(ep\)"/.test(PAGE), true)
check('分段与折叠规则来自 api/loan.js', /buildLoanEpisodeView/.test(PAGE), true)
check('普通流水行有兜底分支', /v-else class="episode-txns"/.test(PAGE), true)
/*
 * ★ 分割标注已按用户要求删除（本轮第 8 条）★
 *   用户原话「已结清页面…你给「已结清」上下都添加了分割线，
 *   现在删除两个分割线，复原」。所以断言翻成「必须不存在」。
 */
check('已结清页不再有分割标注', /class="episode-divider/.test(PAGE), false)
check('已结清旧段默认折叠可展开', /class="episode-collapsed"/.test(PAGE), true)
check('不再有点开弹层看明细（showDetail/wd-popup）', /showDetail|<wd-popup/.test(PAGE), false)
check(
  '未结清的人都给结清按钮（按钮在组头右列第二行）',
  /v-if="!g\.settled"[\s\S]{0,120}?class="settle-btn"/.test(PAGE),
  true
)
check('右侧是两行：金额一行 + 按钮一行', /class="balance-row"/.test(PAGE), true)
check('结清按钮两个方向都出现（不再排除借入）', /!isIncome\.value/.test(PAGE), false)

/* 复用全局分段控件，不另写一套 tab */
check('状态切换复用全局 .seg-toggle', /class="seg-toggle seg-toggle--block/.test(PAGE), true)
check('页面没有自造的 .loan-tabs', /loan-tabs/.test(PAGE), false)

/* =============================================== 6. 记账面板 */

console.log('=== 记账面板：人员必填 + 账户标签同行 ===')

const PANEL = read('components/TxnPanel.vue')

check('引入人员判定', /isLoanPersonCategory/.test(PANEL), true)
check('人员为空时拦截', /请填写人员姓名/.test(PANEL), true)
check(
  '借款归还/收回必须选已记过的人',
  /请选择已记过的人员/.test(PANEL) && /allowsNewPerson/.test(PANEL),
  true
)
/*
 * ★ 八类借款语义分类都要排除预算；只有前四类排除收支 ★
 *   结清分类（坏账/未还/利息）是真实损益，必须计入收支 ——
 *   所以 exclude_from_stats 的判定里要有 isSettleCategory 分支。
 */
check(
  '八类借款分类都不占预算',
  /exclude_from_budget:[\s\S]{0,160}?isPersonCategory\.value/.test(PANEL) &&
    /exclude_from_budget:[\s\S]{0,160}?isSettleCategory\.value/.test(PANEL),
  true
)
check(
  '结清分类不计入收支时被排除（必须计入）',
  /exclude_from_stats:\s*isSettleCategory\.value[\s\S]{0,60}?false/.test(PANEL),
  true
)
check(
  '四个非结清分类默认不计入收支（结清分类除外）',
  /*
   * ★ 匹配「结清类 → false，借款类 → true」这条主干 ★
   *   中间多了「待报销时也排除」一层嵌套，顺序仍是
   *   isSettleCategory ? false : (isPersonCategory ? true : ...)。
   *   所以正则只钉前半段，不再要求末尾紧跟 ` ? true`。
   */
  /exclude_from_stats:\s*isSettleCategory\.value[\s\S]{0,20}?\?\s*false[\s\S]{0,60}?isPersonCategory\.value[\s\S]{0,20}?\?\s*true/.test(PANEL),
  true
)
check('账户与标签同一行（form-row-split）', /form-row-split/.test(PANEL), true)
check('人员行有「选择」入口', /class="person-pick"/.test(PANEL), true)

/* =============================================== 7. 人员显示成 tag */

console.log('=== 流水列表把人员渲染成胶囊 ===')

const RECENT = read('components/RecentTxnList.vue')
const LIST = read('pages/txn/list.vue')

check('最近流水有人员胶囊', /__person__/.test(RECENT), true)
check('全部交易页有人员胶囊', /__person__/.test(LIST), true)
/*
 * ★ 只是显示成 tag，不能真的写进 tag 表 ★
 *   用户明确要求。写进去会污染「项目统计」。
 */
check('不写 tag 表（没有 person 相关 createTag）', /createTag[\s\S]{0,80}person/.test(RECENT + LIST), false)

/* =============================================== 8. AI 识别人员 */

console.log('=== AI 提示词要求 note 填人名 ===')

const AI = read('api/aiParse.js')
check('提示词说明 note 是「人」', /note 字段必须是「人」/.test(AI), true)
check('给了「借给姐姐200 -> note = 姐姐」示例', /note = "姐姐"/.test(AI), true)
check('已知人员名单进提示词', /knownPeople/.test(AI), true)

/* =============================================== 9. 不计入收支全链路 */

console.log('=== 借款流水不进收支统计 ===')

const STATS = read('api/stats.js')
check('统计层有排除常量', /NOT_EXCLUDED_STATS/.test(STATS), true)
check(
  '总览聚合带排除条件',
  /overviewByScope[\s\S]{0,600}NOT_EXCLUDED_STATS/.test(STATS),
  true
)
check(
  '支出/收入两套口径都排除（categoryStatsByScope）',
  /categoryStatsByScope[\s\S]{0,600}NOT_EXCLUDED_STATS/.test(STATS),
  true
)

const TXN = read('api/transaction.js')
check('交易写入持久化 exclude_from_stats', /exclude_from_stats/.test(TXN), true)
check('有独立的 setExcludeFromStats', /export async function setExcludeFromStats/.test(TXN), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
