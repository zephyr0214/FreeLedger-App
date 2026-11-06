/**
 * 账户类型的测试
 *
 *   node scripts/test-account-types.mjs
 *
 * ★ 用户提过的三次要求（按时间顺序）★
 *   第一次：「账户类型就这五个」——
 *     网络支付 / 信用卡 / 储蓄卡 / 现金 / 充值卡。
 *     之前多出来的「投资 / 借入 / 应收 / 其他」是多余的。
 *
 *   第二次：「组合账户保持账户类型不可编辑，
 *     但是其他类型的账户你都要设置账户类型可以编辑」。
 *     -> 组合账户是辅助类型，但它在界面上不可改类型；
 *        其余真实类型之间可以互相改。
 *
 *   第三次（本轮）：「添加账户分类选择信用卡时，删除信用额度、账单日、
 *     还款日、卡号后四位的条目及背后的逻辑，添加一个账户类型名为
 *     '电话卡'、'网络借贷'，电话卡条目和储蓄卡一致，网络借贷条目和信用卡一致，
 *     信用卡和网络借贷初始余额前默认显示 - 号，计入负债」。
 *     -> 真实类型变成 7 个（多了 phone / loan）；
 *        信用卡那四项设置整套删掉（所以「和信用卡一致」= 和储蓄卡一致）；
 *        信用卡 / 网络借贷新建时余额存成负数。
 *
 * 这个测试同时守住这三条约束。
 */

import {
  ACCOUNT_TYPES, ACCOUNT_GROUPS, getTypeMeta, isCreditType, isComboType
} from '../api/account.js'

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

/** 真实账户类型（不含组合）—— 界面上可选的就是这 7 个 */
const REAL_TYPES = ACCOUNT_TYPES.filter((t) => !t.isCombo)

console.log('=== 真实账户类型就这七种 ===')

/*
 * ★ 顺序就是用户看到的顺序 ★
 *   两个欠钱类（信用卡 / 网络借贷）紧跟网络支付排在最上面：
 *   用户打开账户页最先关心的是「我欠了多少」。
 *   电话卡紧跟储蓄卡 —— 它的表单条目和储蓄卡完全一致，
 *   放一起用户一眼能看出「这是同一类东西」。
 */
const EXPECTED = ['网络支付', '信用卡', '网络借贷', '储蓄卡', '电话卡', '现金', '充值卡']
const EXPECTED_KEYS = ['online', 'credit', 'loan', 'debit', 'phone', 'cash', 'prepaid']

check('真实类型数量就是 7 个', REAL_TYPES.length, 7)
check('真实类型名称', REAL_TYPES.map((t) => t.name), EXPECTED)
check('真实类型 key', REAL_TYPES.map((t) => t.key), EXPECTED_KEYS)

console.log('=== 第 8 种：组合账户（辅助类型，不是资金账户）===')

check('总类型数 = 7 真实 + 1 组合', ACCOUNT_TYPES.length, 8)
const combo = ACCOUNT_TYPES.find((t) => t.key === 'combo')
check('组合账户在类型表里', !!combo, true)
check('组合账户标了 isCombo', combo ? combo.isCombo : null, true)
check('组合账户的名字', combo ? combo.name : '', '组合账户')

// ★ 组合账户不是资金账户：不能被当成信用账户，也不该混进真实分组 ★
check('组合账户不是信用账户', isCreditType('combo'), false)
check('isComboType 认组合', isComboType('combo'), true)
check('isComboType 不认储蓄卡', isComboType('debit'), false)

// 真实类型都不能被当成组合
for (const t of REAL_TYPES) {
  check(`${t.name} 不是组合账户`, isComboType(t.key), false)
  check(`${t.name} 没有 isCombo 标记`, !!t.isCombo, false)
}

console.log('=== 新增的两个类型（本轮需求）===')

const phone = ACCOUNT_TYPES.find((t) => t.key === 'phone')
const loan = ACCOUNT_TYPES.find((t) => t.key === 'loan')

check('电话卡在类型表里', !!phone, true)
check('电话卡的名字', phone ? phone.name : '', '电话卡')
check('电话卡的图标', phone ? phone.icon : '', 'phone')
/*
 * ★ 电话卡「条目和储蓄卡一致」★
 *   储蓄卡除了「初始余额 + 计入总资产」这两项通用条目以外没有专属字段，
 *   所以「一致」的落地方式就是：电话卡也不带任何额外字段。
 *   这里用「它和储蓄卡在类型表里的形状相同」来守住这条，
 *   以后谁想给电话卡加个「运营商」之类的字段，这条会红。
 */
const debit = ACCOUNT_TYPES.find((t) => t.key === 'debit')
check(
  '电话卡与储蓄卡形状一致（除 key/name/icon/group 外无差异）',
  Object.keys(phone || {}).filter((k) => !['key', 'name', 'icon', 'group'].includes(k)).sort(),
  Object.keys(debit || {}).filter((k) => !['key', 'name', 'icon', 'group'].includes(k)).sort()
)
check('电话卡不是欠钱类账户', phone ? phone.isCredit : null, false)

check('网络借贷在类型表里', !!loan, true)
check('网络借贷的名字', loan ? loan.name : '', '网络借贷')
check('网络借贷的图标', loan ? loan.icon : '', 'loan')
/*
 * ★ 网络借贷「条目和信用卡一致」★
 *   信用卡那四项（额度/账单日/还款日/卡尾号）删完之后，
 *   信用卡本身也只剩通用条目，所以网络借贷同样没有专属字段。
 *   但 isCredit 必须跟着信用卡 —— 它决定初始余额前的负号、
 *   以及能不能当组合账户成员。
 */
check('网络借贷是欠钱类账户', loan ? loan.isCredit : null, true)
check(
  '网络借贷与信用卡形状一致（除 key/name/icon/group 外无差异）',
  Object.keys(loan || {}).filter((k) => !['key', 'name', 'icon', 'group'].includes(k)).sort(),
  Object.keys(ACCOUNT_TYPES.find((t) => t.key === 'credit') || {})
    .filter((k) => !['key', 'name', 'icon', 'group'].includes(k))
    .sort()
)

console.log('=== 之前多出来的类型已删除 ===')

const FORBIDDEN = ['投资', '借入', '应收', '其他', '支付宝', '微信', '花呗']
for (const name of FORBIDDEN) {
  check(`没有「${name}」类型`, ACCOUNT_TYPES.some((t) => t.name === name), false)
}

console.log('=== 展示分组 ===')

// 分组：7 个真实分组 + 1 个「组合账户」分组
check('分组数量 = 7 真实 + 1 组合', ACCOUNT_GROUPS.length, 8)
check('真实分组名称', ACCOUNT_GROUPS.filter((g) => g.key !== 'combo').map((g) => g.name), EXPECTED)
check(
  '组合分组排在最后',
  ACCOUNT_GROUPS[ACCOUNT_GROUPS.length - 1].key,
  'combo'
)

// 每个类型都要能在分组里找到
for (const t of ACCOUNT_TYPES) {
  check(`${t.name} 有对应的展示分组`, ACCOUNT_GROUPS.some((g) => g.key === t.group), true)
}

console.log('=== 信用账户（= 欠钱类账户）===')

/*
 * ★ isCredit 现在的语义只剩两件事 ★
 *   1. 新建账户时「初始余额」那一行改叫「当前欠款」，保存时自动取负
 *   2. 页面按「欠钱类 / 资金账户」分类展示（stores/account.js 的两个 getter）
 *   负债统计不看它 —— 那边是按余额正负拆的。
 *   组合成员资格也不看它了（用户要求放开，见下面单独一节）。
 */
check('信用卡是信用账户', isCreditType('credit'), true)
check('网络借贷是信用账户', isCreditType('loan'), true)
check('储蓄卡不是信用账户', isCreditType('debit'), false)
check('电话卡不是信用账户', isCreditType('phone'), false)
check('网络支付不是信用账户', isCreditType('online'), false)
check('现金不是信用账户', isCreditType('cash'), false)
check('充值卡不是信用账户', isCreditType('prepaid'), false)
check('组合账户不是信用账户', isCreditType('combo'), false)

console.log('=== 组合账户可以包含信用卡 / 网络借贷（本轮需求）===')

/*
 * ★ 用户原话：「修改组合账户支持添加信用卡和网络借贷账户」★
 *   三处都要放开，缺一处用户就会「能看到但存不进去」：
 *     1. api/account.js 的 replaceComboMembers —— 写成员时的过滤
 *     2. pages/account/edit.vue 的 availableMembers —— 多选弹层的候选
 *     3. utils/combo.js 的 availableCents / canBeComboMember —— 扣款解析
 *   后者的取舍：欠钱类账户没有信用额度可比对（那字段已删），
 *   所以按「可用额度无限」处理，排到前面就先刷它。
 */
{
  const { readFileSync } = await import('fs')
  const { join, dirname, resolve } = await import('path')
  const { fileURLToPath } = await import('url')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const pick = (p) => readFileSync(join(ROOT, ...p.split('/')), 'utf-8')

  const api = pick('api/account.js')
  check(
    'replaceComboMembers 不再用 isCreditType 过滤成员',
    /if \(isCreditType\(t\)\) continue/.test(api),
    false
  )
  check(
    'replaceComboMembers 仍然禁止组合嵌套',
    /if \(isComboType\(t\)\) continue/.test(api),
    true
  )

  const edit = pick('pages/account/edit.vue')
  check(
    '成员候选只排除组合（不再排除欠钱类）',
    /accountStore\.list\.filter\(\(a\) => !a\.isCombo\)/.test(edit),
    true
  )
  /*
   * 只查代码行：`!a.isCredit` 还会出现在解释「以前为什么排除」的注释里，
   * 那是历史说明，不是现行逻辑。
   */
  const editCode = edit
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/^[ \t]*\*.*$/gm, '')
  check(
    '成员候选里没有 !a.isCredit 的旧过滤',
    /!a\.isCredit/.test(editCode),
    false
  )

  const { canBeComboMember, availableCents } = await import('../utils/combo.js')
  check('信用卡可以当组合成员', canBeComboMember('credit'), true)
  check('网络借贷可以当组合成员', canBeComboMember('loan'), true)
  check('储蓄卡可以当组合成员', canBeComboMember('debit'), true)
  check('组合不能嵌套当成员', canBeComboMember('combo'), false)

  // 欠钱类账户按「额度无限」参与扣款，才可能被选成扣款账户
  check(
    '信用卡的可用额度按无限处理',
    availableCents({ isCredit: true, balance_cents: -500000 }) > 100000000,
    true
  )
  check(
    '普通账户负余额仍按 0 处理',
    availableCents({ isCredit: false, balance_cents: -500000 }),
    0
  )
}

console.log('=== 类型可编辑性（第二次需求）===')

/**
 * ★ 哪些类型在「编辑账户」页可以改 ★
 *
 *   api/account.js 的 updateAccount():
 *     只拦「组合 <-> 真实」的互相转换，其余组合全部放行。
 *
 *   所以这里等价地验一遍「界面上该给哪些选项」：
 *     编辑真实账户 -> 7 个真实类型可选
 *     编辑组合账户 -> 0 个可选（模板里走只读分支）
 */

/**
 * 界面上可选类型（与 pages/account/edit.vue 的 selectableTypes 同逻辑）
 *
 * ★ 新建和编辑的规则不一样 ★
 *   新建：全部类型都给，**包括组合账户**
 *        —— 组合账户只有这一个新建入口。
 *        以前这里把它过滤掉了、注释说「入口在账户页的分组说明」，
 *        但那个入口根本不存在，结果组合账户完全建不出来（用户反馈的 bug）。
 *   编辑真实账户：只给真实类型（不能把储蓄卡改成组合）
 *   编辑组合账户：0 个可选（模板走只读分支）
 */
function selectableTypesFor(acc) {
  const isEdit = !!acc
  if (isEdit && acc.isCombo) return []
  if (isEdit) return ACCOUNT_TYPES.filter((t) => !t.isCombo)
  // 新建：全给
  return ACCOUNT_TYPES
}

check(
  '编辑储蓄卡：7 个真实类型都可选',
  selectableTypesFor({ isCombo: false }).map((t) => t.key),
  EXPECTED_KEYS
)
check(
  '编辑组合账户：没有可选类型（只读展示）',
  selectableTypesFor({ isCombo: true }),
  []
)
// 编辑时组合不能出现在可选项里 —— 否则用户能把储蓄卡改成组合
check(
  '编辑真实账户时，可选项里不含组合账户',
  selectableTypesFor({ isCombo: false }).some((t) => t.isCombo),
  false
)

console.log('=== 新建账户：全部类型都要能选（含组合账户）===')

/*
 * ★ 用户反馈的 bug ★
 *   「为什么新建账户无法新建组合账户了」
 *   根因：新建时 selectableTypes 滤掉了组合，
 *        而新建入口只有 pages/account/edit.vue 这一个，
 *        注释里说的「账户页分组说明入口」不存在 —— 组合账户无处可建。
 */
check(
  '新建时全部类型都给',
  selectableTypesFor(null).length,
  ACCOUNT_TYPES.length
)
check(
  '新建时可选项**包含**组合账户',
  selectableTypesFor(null).some((t) => t.isCombo),
  true
)
check(
  '新建时可选项顺序与 ACCOUNT_TYPES 一致',
  selectableTypesFor(null).map((t) => t.key),
  ACCOUNT_TYPES.map((t) => t.key)
)

/*
 * ★ 上面的 helper 是「照抄」逻辑的副本，容易和真实代码漂移 ★
 *   所以再直接查源码：新建分支不能无条件过滤掉 isCombo。
 *   当初那个 bug 的写法正是裸用 ACCOUNT_TYPES.filter((t) => !t.isCombo)。
 */
{
  const { readFileSync } = await import('fs')
  const { join, dirname, resolve } = await import('path')
  const { fileURLToPath } = await import('url')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const edit = readFileSync(join(ROOT, 'pages', 'account', 'edit.vue'), 'utf-8')

  // 取出 selectableTypes 的定义体
  const m = /const selectableTypes = computed\(\(\) => \{([\s\S]*?)\n    \}\)/.exec(edit)
  check('找得到 selectableTypes 定义', !!m, true)

  if (m) {
    const body = m[1]
    // 新建分支必须直接返回 ACCOUNT_TYPES（不过滤组合）
    check(
      '新建分支返回全量 ACCOUNT_TYPES（不过滤组合）',
      /return ACCOUNT_TYPES$/.test(body.trim()) || /return ACCOUNT_TYPES\n/.test(body),
      true
    )
    // 编辑分支才过滤
    check(
      '编辑分支过滤掉组合',
      /filter\(\(t\) => !t\.isCombo\)/.test(body),
      true
    )
  }

  // 新建入口必须存在（组合账户只能从这里建）
  check(
    '账户页有新建入口 goAddAccount',
    /function goAddAccount\(\)/.test(
      readFileSync(join(ROOT, 'pages', 'account', 'index.vue'), 'utf-8')
    ),
    true
  )
}

console.log('=== 信用卡四项已彻底删除（本轮需求）===')

/*
 * ★ 「删干净」不等于「加个 v-if=false」★
 *   用户说的是「删除条目及背后的逻辑」，
 *   所以这里连字段名都不允许出现在 UI 与新建逻辑里。
 *   数据库列还在（api/db/schema.js，删列要重建表），
 *   这里只查「界面 / 新建 / 编辑」这几个文件。
 */
{
  const { readFileSync } = await import('fs')
  const { join, dirname, resolve } = await import('path')
  const { fileURLToPath } = await import('url')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const pick = (p) => readFileSync(join(ROOT, ...p.split('/')), 'utf-8')

  const uiFiles = [
    'pages/account/edit.vue',
    'pages/account/detail.vue',
    'pages/account/index.vue'
  ]
  // 这四个是信用卡专属字段的表单/展示名
  const GONE_FIELDS = ['creditLimitYuan', 'bill_day', 'repay_day', 'card_tail']
  for (const f of uiFiles) {
    const src = pick(f)
    for (const field of GONE_FIELDS) {
      // 允许出现在解释「已经删掉了」的注释里，所以只校验代码行
      const codeOnly = src
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '')
      check(`${f} 不再使用 ${field}`, codeOnly.includes(field), false)
    }
    check(`${f} 不再出现「信用额度」文案`, /信用额度/.test(
      src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    ), false)
  }

  /*
   * ★ 新建账户不再往这四列写值 ★
   *   api/account.js 的 INSERT 里这四列是字面 NULL。
   */
  const api = pick('api/account.js')
  check(
    'createAccount 的 INSERT 把这四列写成 NULL',
    /include_in_total, credit_limit_cents, bill_day, repay_day, card_tail,[\s\S]{0,120}NULL,NULL,NULL,NULL/.test(api),
    true
  )
  check(
    'updateAccount 不再接受这四列的 patch',
    /patch\.credit_limit_cents/.test(api) ||
      /patch\.bill_day/.test(api) ||
      /patch\.repay_day/.test(api) ||
      /patch\.card_tail/.test(api),
    false
  )
}

console.log('=== 欠款账户的初始余额叫「当前欠款」并自动取负（本轮需求）===')

/*
 * ★ 用户后来改了主意：不要负号，要「当前欠款」★
 *   原话：「删除两个类型中默认的 - 号吧，选中这两个类型的时候，
 *          初始余额修改为『当前欠款(自动设置为负值)』」。
 *   所以源码里必须同时满足：
 *     1. 界面上**没有**任何负号前缀（- 号删干净，不许留个只读 text）
 *     2. 标签按类型切换成「当前欠款」
 *     3. 保存时仍然取负 —— 界面不显示负号，但账本里必须是负数
 *     4. 编辑回填仍走绝对值（否则会回填一个用户打不出来的负数）
 */
{
  const { readFileSync } = await import('fs')
  const { join, dirname, resolve } = await import('path')
  const { fileURLToPath } = await import('url')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const edit = readFileSync(join(ROOT, 'pages', 'account', 'edit.vue'), 'utf-8')

  // 1) 负号前缀彻底没了
  check('模板里不再有负号前缀 showMinusSign', /showMinusSign/.test(
    edit.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  ), false)
  check('模板里不再有 .balance-sign 负号样式', /\.balance-sign|class="balance-sign"/.test(edit), false)

  // 2) 标签按类型切换
  check(
    '欠款类账户的标签是「当前欠款」',
    /isDebtType \? '当前欠款' : '初始余额'/.test(edit),
    true
  )
  check(
    'isDebtType 挂在 isCreditType 上（信用卡 + 网络借贷自动都算）',
    /const isDebtType = computed\(\(\) => isCreditType\(form\.type\)\)/.test(edit),
    true
  )

  // 3) 保存仍然取负
  check(
    '新建保存时把欠款取成负数',
    /isDebtType\.value \? -Math\.abs\(rawCents\) : rawCents/.test(edit),
    true
  )

  // 4) 回填绝对值
  check(
    '编辑回填用绝对值',
    /form\.balanceYuan = \(Math\.abs\(acc\.balance_cents\) \/ 100\)\.toFixed\(2\)/.test(edit),
    true
  )

  const { ICON_MAP, ICON_OPTIONS } = await import('../utils/icons.js')
  check('图标表里有 phone', !!ICON_MAP.phone, true)
  check('图标表里有 loan', !!ICON_MAP.loan, true)
  check(
    'phone 在可选图标列表里',
    ICON_OPTIONS.some((o) => o.key === 'phone'),
    true
  )
  check(
    'loan 在可选图标列表里',
    ICON_OPTIONS.some((o) => o.key === 'loan'),
    true
  )
}

console.log('=== 兜底 ===')

// 未知类型要兜底到第一个，不能崩
const fallback = getTypeMeta('不存在的类型')
check('未知类型有兜底', typeof fallback.key, 'string')
check('兜底的 group 有效', ACCOUNT_GROUPS.some((g) => g.key === fallback.group), true)

// 每个类型都要有图标和名称
for (const t of ACCOUNT_TYPES) {
  check(`${t.name} 有名称`, !!t.name, true)
  check(`${t.name} 有图标`, !!t.icon, true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
