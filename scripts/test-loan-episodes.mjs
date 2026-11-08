/**
 * 借入借出「结清批次分段」的测试
 *
 *   node scripts/test-loan-episodes.mjs
 *
 * 需求原话：
 *   「若是某位用户已结清，又产生新的借入借出，则在未结清中，
 *     自动折叠之前已结清的流水，可展开。
 *     在已结清中默认全部展开，但每次结清的中间要做分割标注已结清。」
 *
 * ★ 为什么单独一个脚本、而不是塞进 test-loan-manage.mjs ★
 *   test-loan-manage 测的是「余额口径 / 结清写哪一笔」这些既有逻辑，
 *   这一轮新增的是「把一个人的流水切成若干结清批次」——
 *   切批次本身是一段纯算术（余额何时回 0），最值得逐条钉死：
 *     借 → 还 → 借，必须是两段，而不是糊成一段；
 *     多还了但还没记利息，余额是 -100 不是 0，这一段就不能算结清。
 *   任何一条切错，用户看到的就是「未结清里混着早就两清的旧账」，
 *   或者反过来「明明还欠钱却显示已结清」。
 *
 * ★ 纯函数直接 import ★
 *   splitLoanEpisodes(txns, pair) 不碰数据库（只有 pair 里的四个分类 id），
 *   所以这个脚本不需要 node:sqlite，直接跑真函数，不是复制一份公式。
 *
 * 末尾还钉了几条页面 / API 的静态约束（字段名、默认折叠规则、
 * 全部交易页的汇总口径），防止以后被改回去。
 */

import fs from 'node:fs'
import path from 'node:path'
import { splitLoanEpisodes, buildLoanEpisodeView } from '../api/loan.js'

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

/* --------------------------------------------------- 造数据的小工具 */

/** 借出方向：主=借出(expense) 反=借款收回(income) 坏账 利息 */
const LEND = {
  mainId: 'cat_lend_out',
  backId: 'cat_lend_back',
  positiveId: 'cat_lend_bad',
  negativeId: 'cat_lend_interest'
}

/** 借入方向：主=借入(income) 反=借款归还(expense) 未还 利息 */
const BORROW = {
  mainId: 'cat_borrow_in',
  backId: 'cat_borrow_back',
  positiveId: 'cat_borrow_waived',
  negativeId: 'cat_borrow_interest'
}

/**
 * 造一笔流水
 *
 * ★ 只给 splitLoanEpisodes 真正用到的字段 ★
 *   category_id / amount_cents / occurred_day / occurred_at / created_at / id。
 *   它是个纯函数，不读 type / note / 账户，多给反而看不清哪些字段是「契约」。
 */
function txn(id, categoryId, yuan, day, hour = 12) {
  return {
    id,
    category_id: categoryId,
    amount_cents: yuan * 100,
    occurred_day: day,
    occurred_at: new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).getTime(),
    created_at: new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).getTime()
  }
}

/** 取每段的摘要，方便一比一比对（直接比 txns 太啰嗦） */
function summary(episodes) {
  return episodes.map((ep) => ({
    settled: ep.settled,
    balance: ep.balance,
    n: ep.txns.length,
    fromDay: ep.fromDay,
    toDay: ep.toDay,
    closingDay: ep.closingDay,
    ids: ep.txns.map((t) => t.id)
  }))
}

/* ============================================= 1. 基本分段 */

console.log('=== 1. 余额回 0 就收口一段 ===')

/* 只借没还：一段未结清 */
check(
  '借 500 没还 -> 一段未结清',
  summary(splitLoanEpisodes([txn('a1', LEND.mainId, 500, '2026-01-05')], LEND)),
  [
    { settled: false, balance: 50000, n: 1, fromDay: '2026-01-05', toDay: '2026-01-05', closingDay: '', ids: ['a1'] }
  ]
)

/* 借完还清：一段已结清，收口日期 = 还清那笔 */
check(
  '借 500 还 500 -> 一段已结清',
  summary(splitLoanEpisodes([
    txn('a1', LEND.mainId, 500, '2026-01-05'),
    txn('a2', LEND.backId, 500, '2026-01-20')
  ], LEND)),
  [
    {
      settled: true, balance: 0, n: 2,
      fromDay: '2026-01-05', toDay: '2026-01-20', closingDay: '2026-01-20',
      ids: ['a1', 'a2']
    }
  ]
)

/*
 * ★ 这条是整次改造的核心 ★
 *   结清过又新借：必须是两段，前面那段已结清、后面那段未结清。
 *   如果实现里「不按余额回 0 切」，两笔会糊成一段未结清，
 *   未结清 tab 里就会把早就两清的旧账一起平铺出来 —— 正是用户要修的现象。
 */
check(
  '借 500 -> 还清 -> 又借 300 -> 两段（前一段已结清）',
  summary(splitLoanEpisodes([
    txn('b1', LEND.mainId, 500, '2026-01-05'),
    txn('b2', LEND.backId, 500, '2026-01-20'),
    txn('b3', LEND.mainId, 300, '2026-03-02')
  ], LEND)),
  [
    {
      settled: true, balance: 0, n: 2,
      fromDay: '2026-01-05', toDay: '2026-01-20', closingDay: '2026-01-20',
      ids: ['b1', 'b2']
    },
    {
      settled: false, balance: 30000, n: 1,
      fromDay: '2026-03-02', toDay: '2026-03-02', closingDay: '',
      ids: ['b3']
    }
  ]
)

/* 结清两次又借：三段（两段已结清 + 一段未结清） */
check(
  '结清两次后又借 -> 三段',
  summary(splitLoanEpisodes([
    txn('c1', LEND.mainId, 100, '2026-01-01'),
    txn('c2', LEND.backId, 100, '2026-01-10'),
    txn('c3', LEND.mainId, 200, '2026-02-01'),
    txn('c4', LEND.backId, 200, '2026-02-10'),
    txn('c5', LEND.mainId, 300, '2026-03-01')
  ], LEND)).map((s) => [s.settled, s.ids]),
  [
    [true, ['c1', 'c2']],
    [true, ['c3', 'c4']],
    [false, ['c5']]
  ]
)

/* 全部结清：只有已结清段，没有未结清段 */
check(
  '全部结清 -> 没有未结清段',
  summary(splitLoanEpisodes([
    txn('d1', LEND.mainId, 100, '2026-01-01'),
    txn('d2', LEND.backId, 100, '2026-01-10'),
    txn('d3', LEND.mainId, 200, '2026-02-01'),
    txn('d4', LEND.backId, 200, '2026-02-10')
  ], LEND)).map((s) => s.settled),
  [true, true]
)

/* ============================================= 2. 结清派生分类也算收口 */

console.log('=== 2. 坏账 / 利息同样能把余额收到 0 ===')

/*
 * ★ 少还 200 记坏账 = 两清 ★
 *   坏账（positive）在余额公式里是「减」，所以 500 - 300 - 200 = 0。
 *   如果分段时漏掉 positive 分类，这段会算成还欠 200，
 *   用户明明点过「手动结清」，未结清 tab 里却还挂着他。
 */
check(
  '借 500 收回 300 坏账 200 -> 已结清',
  summary(splitLoanEpisodes([
    txn('e1', LEND.mainId, 500, '2026-01-05'),
    txn('e2', LEND.backId, 300, '2026-01-15'),
    txn('e3', LEND.positiveId, 200, '2026-01-16')
  ], LEND)),
  [
    {
      settled: true, balance: 0, n: 3,
      fromDay: '2026-01-05', toDay: '2026-01-16', closingDay: '2026-01-16',
      ids: ['e1', 'e2', 'e3']
    }
  ]
)

/* 多还 100 记利息 = 两清（利息在公式里是「加」） */
check(
  '借 500 收回 600 利息 100 -> 已结清',
  summary(splitLoanEpisodes([
    txn('f1', LEND.mainId, 500, '2026-01-05'),
    txn('f2', LEND.backId, 600, '2026-01-15'),
    txn('f3', LEND.negativeId, 100, '2026-01-16')
  ], LEND)),
  [
    {
      settled: true, balance: 0, n: 3,
      fromDay: '2026-01-05', toDay: '2026-01-16', closingDay: '2026-01-16',
      ids: ['f1', 'f2', 'f3']
    }
  ]
)

/*
 * ★ 多还了但还没记利息：余额是 -100，不能算结清 ★
 *   这正是「手动结清」按钮存在的场景。分段如果写成「余额 <= 0 就收口」，
 *   这里会冒出一段 settled=true 的段，未结清 tab 里就再也点不到结清按钮了。
 */
check(
  '借 500 收回 600（未记利息）-> 未结清，余额 -100',
  summary(splitLoanEpisodes([
    txn('g1', LEND.mainId, 500, '2026-01-05'),
    txn('g2', LEND.backId, 600, '2026-01-15')
  ], LEND)),
  [
    {
      settled: false, balance: -10000, n: 2,
      fromDay: '2026-01-05', toDay: '2026-01-15', closingDay: '',
      ids: ['g1', 'g2']
    }
  ]
)

/* ============================================= 3. 借入方向（公式对称） */

console.log('=== 3. 借入方向：主收入 / 反支出，公式对称 ===')

check(
  '借入 800 归还 800 -> 已结清',
  summary(splitLoanEpisodes([
    txn('h1', BORROW.mainId, 800, '2026-01-05'),
    txn('h2', BORROW.backId, 800, '2026-02-05')
  ], BORROW)),
  [
    {
      settled: true, balance: 0, n: 2,
      fromDay: '2026-01-05', toDay: '2026-02-05', closingDay: '2026-02-05',
      ids: ['h1', 'h2']
    }
  ]
)

check(
  '借入结清后又借 -> 两段',
  summary(splitLoanEpisodes([
    txn('i1', BORROW.mainId, 800, '2026-01-05'),
    txn('i2', BORROW.backId, 800, '2026-02-05'),
    txn('i3', BORROW.mainId, 120, '2026-03-05')
  ], BORROW)).map((s) => [s.settled, s.balance, s.ids]),
  [
    [true, 0, ['i1', 'i2']],
    [false, 12000, ['i3']]
  ]
)

/* 借入少还（记「借入未还」收入）也应两清 */
check(
  '借入 800 归还 500 未还 300 -> 已结清',
  summary(splitLoanEpisodes([
    txn('j1', BORROW.mainId, 800, '2026-01-05'),
    txn('j2', BORROW.backId, 500, '2026-02-05'),
    txn('j3', BORROW.positiveId, 300, '2026-02-06')
  ], BORROW)).map((s) => [s.settled, s.balance]),
  [[true, 0]]
)

/* ============================================= 4. 健壮性 */

console.log('=== 4. 顺序 / 空值 / 副作用 ===')

/* 传进来的数组是倒序的（listLoanGroups 就是倒序查的），结果必须一样 */
const asc = [
  txn('k1', LEND.mainId, 500, '2026-01-05'),
  txn('k2', LEND.backId, 500, '2026-01-20'),
  txn('k3', LEND.mainId, 300, '2026-03-02')
]
const desc = asc.slice().reverse()
check(
  '乱序输入结果与正序一致',
  summary(splitLoanEpisodes(desc, LEND)),
  summary(splitLoanEpisodes(asc, LEND))
)

/* ★ 不能改调用方的数组 ★   页面直接拿 g.txns 渲染，被排过序就全乱了 */
const mutable = desc.slice()
const before = mutable.map((t) => t.id)
splitLoanEpisodes(mutable, LEND)
check('不修改传入数组的顺序', mutable.map((t) => t.id), before)

check('空数组 -> 空结果', splitLoanEpisodes([], LEND), [])
check('null -> 空结果', splitLoanEpisodes(null, LEND), [])
check('缺 pair -> 空结果', splitLoanEpisodes(asc, null), [])
check('pair 全空 -> 空结果', splitLoanEpisodes(asc, {}), [])

/* 金额为 0 的脏数据既不改变余额，也不能被算进任何一段（说明见 splitLoanEpisodes 注释） */
check(
  '0 元流水不进分段',
  summary(splitLoanEpisodes([
    txn('m0', LEND.mainId, 0, '2026-01-01'),
    txn('m1', LEND.mainId, 500, '2026-01-05')
  ], LEND)),
  [
    {
      settled: false, balance: 50000, n: 1,
      fromDay: '2026-01-05', toDay: '2026-01-05', closingDay: '',
      ids: ['m1']
    }
  ]
)

/* 不属于本方向的分类不参与：混进别的分类也不能把余额带偏 */
check(
  '无关分类被忽略',
  summary(splitLoanEpisodes([
    txn('n1', LEND.mainId, 500, '2026-01-05'),
    txn('n2', 'cat_salary', 9999, '2026-01-06'),
    txn('n3', LEND.backId, 500, '2026-01-20')
  ], LEND)),
  [
    {
      settled: true, balance: 0, n: 2,
      fromDay: '2026-01-05', toDay: '2026-01-20', closingDay: '2026-01-20',
      ids: ['n1', 'n3']
    }
  ]
)

/*
 * 同一天同一时刻（补记时都会落在 12:00，见 resolveOccurredTime）：
 * 靠 created_at 排先后。借和还在同一秒时，先借后还才能判成结清。
 */
const sameDay = [
  {
    id: 'o2', category_id: LEND.backId, amount_cents: 50000,
    occurred_day: '2026-01-05',
    occurred_at: new Date('2026-01-05T12:00:00').getTime(),
    created_at: new Date('2026-01-05T12:00:00').getTime() + 1000
  },
  {
    id: 'o1', category_id: LEND.mainId, amount_cents: 50000,
    occurred_day: '2026-01-05',
    occurred_at: new Date('2026-01-05T12:00:00').getTime(),
    created_at: new Date('2026-01-05T12:00:00').getTime()
  }
]
check(
  '同一时刻用 created_at 分先后',
  summary(splitLoanEpisodes(sameDay, LEND)).map((s) => [s.settled, s.ids]),
  [[true, ['o1', 'o2']]]
)

/* ============================================= 5. api / 页面静态约束 */

console.log('=== 5. API 与页面的接线 ===')

const LOAN = read('api/loan.js')

check('api/loan.js 导出 splitLoanEpisodes', /export function splitLoanEpisodes\s*\(/.test(LOAN), true)
check(
  'listLoanGroups 给每组挂 episodes',
  /g\.episodes = splitLoanEpisodes\(g\.txns, pair\)/.test(LOAN),
  true
)
check('listLoanGroups 给每组挂 settledTxnCount', /g\.settledTxnCount\s*=/.test(LOAN), true)
/* 分段公式必须复用 listLoanGroups 的累加语义：四个分类 id 都从 pair 取 */
check(
  '分段里四个分类 id 全部来自 pair',
  ['p.mainId', 'p.backId', 'p.positiveId', 'p.negativeId'].every((k) => LOAN.includes(k)),
  true
)
check(
  '分段函数不查库（纯函数）',
  /export function splitLoanEpisodes[\s\S]{0,2000}?await /.test(
    LOAN.slice(LOAN.indexOf('export function splitLoanEpisodes'),
      LOAN.indexOf('async function accountOfLastTxn'))
  ),
  false
)

const PAGE = read('pages/loan/manage.vue')

check('页面用 episodesOf 取分段', /episodesOf\(g\)/.test(PAGE), true)
check('页面用 buildLoanEpisodeView 算展示规则', /buildLoanEpisodeView/.test(PAGE), true)
check(
  '未结清 tab 折叠文案：已结清 N 笔 · 点击展开',
  /已结清 \$\{ep\.txns\.length\} 笔 · 点击展开/.test(read('api/loan.js')),
  true
)
check('折叠条渲染在页面里', /class="episode-collapsed"/.test(PAGE), true)
check('折叠条可点开', /class="episode-collapsed"[\s\S]{0,200}?@click="toggleEpisode/.test(PAGE), true)
check('展开后有收起入口', /class="episode-collapse-btn"/.test(PAGE), true)
/*
 * ★ 分割标注已按用户要求删除（本轮第 8 条）★
 *   用户原话「已结清页面，如上一轮图所示，你给「已结清」上下都添加了
 *   分割线，现在删除两个分割线，复原」。
 *   所以这里从「必须存在」翻成「必须不存在」——
 *   防止以后有人又把那段加回去。
 */
check('已结清 tab 不再有分割标注', /class="episode-divider/.test(PAGE), false)
check('分割段落的样式也已删除', /\.episode-divider/.test(PAGE), false)
check('结清日期文案仍由 api 提供（页面暂不用）', /已结清 · \$\{prevDay\}/.test(LOAN), true)
check('折叠状态按 人员+段序号 记 key', /`\$\{person \|\| ''\}#\$\{index\}`/.test(PAGE), true)
check('刷新后清理失效的折叠 key', /pruneEpisodeStates\(groups\.value\)/.test(PAGE), true)
check('段内流水倒序渲染（最近的在前）', /v-for="t in episodeTxns\(ep\)"/.test(PAGE), true)
/* 样式必须走 CSS 变量，不能写死深浅色 */
/*
 * ★ 已结清段的金额要划删除线（本轮第 6 条）★
 *   用户原话「已结清的借出/借入价钱上也添加删除线」。
 *   已结清 = 这笔账已两清、不再计入「当前借出」，
 *   划掉金额和报销单里「已报销的原支出」是同一个视觉语言。
 */
check(
  '已结清段的金额划删除线',
  /v-if="ep\.settled"[\s\S]{0,120}?amount-settled-strike/.test(PAGE),
  true
)
check(
  '删除线样式用 text-decoration',
  /\.amount-settled-strike\s*\{[^}]*text-decoration:\s*line-through/.test(PAGE),
  true
)
check(
  '折叠条底色用 --app-card-2',
  /\.episode-collapsed\s*\{[^}]*var\(--app-card-2\)/.test(PAGE),
  true
)
check(
  '折叠条文字用 --app-text-3',
  /\.episode-collapsed-text\s*\{[^}]*var\(--app-text-3\)/.test(PAGE),
  true
)

/* ------------------------- buildLoanEpisodeView 的展示规则（纯函数，直接跑） ------------------------- */

console.log('=== 5.1 buildLoanEpisodeView：折叠与分割标注 ===')

const EPS_THREE = splitLoanEpisodes([
  txn('p1', LEND.mainId, 500, '2026-01-05'),
  txn('p2', LEND.backId, 500, '2026-01-20'),
  txn('p3', LEND.mainId, 300, '2026-03-02')
], LEND)

/*
 * ★ 未结清 tab 的段序反过来了（用户本轮第 4 条）★
 *   用户原话「未结清页面，已结清流水展开应该显示在当前流水下方而不是上方」。
 *   splitLoanEpisodes 给的是时间正序（旧→新），页面上要「现在在上、历史在下」，
 *   所以 buildLoanEpisodeView 在 status='open' 时先反序再算折叠/分割。
 *   于是反序后 idx 0 = 当前的未结清段（不折叠），idx 1 = 历史已结清段（折叠）。
 */
check(
  '未结清 tab：当前段在上、历史已结清段在下且折叠',
  buildLoanEpisodeView(EPS_THREE, { status: 'open' }).map((v) => [v.collapsed, !!v.showDividerBefore, !!v.showCollapseBtn]),
  [[false, false, false], [true, false, false]]
)
check(
  '未结清 tab：手动展开的折叠条（反序后是 idx 1）不折叠且给收起入口',
  buildLoanEpisodeView(EPS_THREE, {
    status: 'open',
    isExpanded: (i) => i === 1
  }).map((v) => [v.collapsed, !!v.showCollapseBtn]),
  [[false, false], [false, true]]
)
check(
  '未结清 tab：反序后 rowIndex 跟着新顺序（否则展开会点错段）',
  buildLoanEpisodeView(EPS_THREE, { status: 'open' }).map((v) => v.rowIndex),
  [0, 1]
)
check(
  '已结清 tab：全部展开，不再画分割标注',
  buildLoanEpisodeView(EPS_THREE, { status: 'settled' }).map((v) => [v.collapsed, !!v.showDividerBefore]),
  [[false, false], [false, false]]
)
check(
  '分割标注日期取上一段的收口日',
  buildLoanEpisodeView(EPS_THREE, { status: 'settled' })[1].dividerText,
  '已结清 · 2026-01-20'
)
/*
 * ★ 只有一段（纯未结清）时不能画分割线、也不能折叠 ★
 *   否则「只有一笔借款」的人下面会莫名多出一条「已结清 · —」。
 */
check(
  '单段：不折叠、不画分割线',
  buildLoanEpisodeView(
    splitLoanEpisodes([txn('q1', LEND.mainId, 500, '2026-01-05')], LEND),
    { status: 'open' }
  ).map((v) => [v.collapsed, !!v.showDividerBefore]),
  [[false, false]]
)
check('空分段 -> 空视图', buildLoanEpisodeView([], { status: 'open' }), [])
check('null 分段 -> 空视图', buildLoanEpisodeView(null, { status: 'settled' }), [])

/* ------------------------ 全部交易页：分组汇总排除 exclude_from_stats ------------------------ */

console.log('=== 6. 全部交易页：组头汇总与顶部 summary 同口径 ===')

const LIST = read('pages/txn/list.vue')
const groupsBody = (LIST.match(/const groups = computed\(\(\) => \{([\s\S]*?)\n    \}\)/) || [])[1] || ''

check('找到了 groups 计算属性', groupsBody.length > 0, true)
check(
  '分组汇总跳过 exclude_from_stats',
  /if \(txn\.exclude_from_stats\) continue/.test(groupsBody),
  true
)
/*
 * ★ 顺序也钉住 ★
 *   continue 必须在累加之前。写在累加之后等于没写，
 *   而正则只看「有没有」是看不出来的，所以比较两个下标。
 */
check(
  '排除判断在累加之前',
  groupsBody.indexOf('exclude_from_stats') >= 0 &&
    groupsBody.indexOf('exclude_from_stats') < groupsBody.indexOf('g.expense +='),
  true
)
/* 列表本身仍要 push（否则借款流水在页面上消失，用户会以为数据丢了） */
check(
  '被排除的流水仍然进列表',
  groupsBody.indexOf('g.list.push(txn)') < groupsBody.indexOf('exclude_from_stats'),
  true
)
check(
  '转账不进汇总（只认 expense / income）',
  /if \(txn\.type === 'expense'\)/.test(groupsBody) &&
    /if \(txn\.type === 'income'\)/.test(groupsBody) &&
    !/txn\.type === 'transfer'\) g\./.test(groupsBody),
  true
)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
