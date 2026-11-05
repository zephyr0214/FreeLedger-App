/**
 * 金额展示规则的统一性校验（符号 + 颜色）
 *
 * 对应需求：
 *   符号：支出 -，收入 +，0.00 无符号（金额本身仍要显示出来）
 *   颜色：支出无色，收入绿色，0 无色；
 *         结余（variant=balance）负数红、正数绿、0 无色；
 *         月历颜色保持现状（不归 MoneyText 管，这里不覆盖）
 *
 * ★ 为什么单独一个脚本 ★
 *   这些规则散落在几十个页面调用点上，肉眼看不出是否统一。
 *   这里把「组件源码里的规则」和「各页面是否还在写死颜色」
 *   都做成断言，以后谁再手写 :color="...success..." 会立刻失败。
 *
 * 纯静态断言（不跑 Vue、不连数据库），和 scripts/ 下其它 check 脚本同构。
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { fileURLToPath } from 'url'

// Windows 上 URL.pathname 是「/C:/...」，直接 join 会拼成「C:\C:\...」
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

/* ------------------------------------------------------------ MoneyText 规则 */

console.log('=== MoneyText：符号规则 ===')
const money = read('components/MoneyText.vue')
// theme 在这里就要读到 —— 后面「浅灰主题变量」的断言用得上
const theme = read('utils/theme.js')

// 0 不加符号
check('0 金额不显示符号', /const isZero = computed\(\(\) => rawCents\.value === 0\)/.test(money), true)
check('showSign 里 0 优先返回 false', /if \(isZero\.value\) return false/.test(money), true)

// 支出 - / 收入 +
check('支出为负（显示 -）', /props\.type === 'expense'\) return -Math\.abs\(n\)/.test(money), true)
check('收入为正（显示 +）', /props\.type === 'income'\) return Math\.abs\(n\)/.test(money), true)

// 0 仍显示两位小数
check('0 不套用 hideZeroDecimals', /props\.hideZeroDecimals && !isZero\.value/.test(money), true)

console.log('=== MoneyText：颜色规则 ===')
check('存在 balance 语义变体', /variant: \{ type: String, default: 'amount' \}/.test(money), true)
check('0 返回无色（空串）', /if \(isZero\.value\) return ''/.test(money), true)
check('结余负数用 danger', /rawCents\.value < 0 \? 'var\(--app-danger/.test(money), true)
check('结余正数用 success', /: 'var\(--app-success/.test(money), true)
check('流水收入用 success', /props\.type === 'income' \? 'var\(--app-success/.test(money), true)
check('流水支出无色（空串 = 不给颜色）', /return props\.type === 'income' \? 'var\(--app-success, #07c160\)' : ''/.test(money), true)

console.log('=== MoneyText：转账 / 不计入资产 → 浅灰 ===')
check('有 muted 开关', /muted: \{ type: Boolean, default: false \}/.test(money), true)
check('有 muted 变体', /'muted'\s*——/.test(money), true)
check('浅灰优先于 0 判断', /props\.muted \|\| props\.variant === 'muted' \|\| props\.type === 'transfer'/.test(money), true)
check('浅灰取 --app-muted', /return 'var\(--app-muted, #b8bec7\)'/.test(money), true)
check('transfer 时 sign 可显式开启', /if \(props\.type\) return props\.sign/.test(money), true)

console.log('=== 浅灰主题变量（明暗都适配）===')
check('浅色有 --app-muted', /'--app-muted': '#B8BEC7'/.test(theme), true)
check('暗色有 --app-muted', /'--app-muted': '#8E8E93'/.test(theme), true)

/* ------------------------------------------------- 页面里不能再手写收支色 */

console.log('=== 各页面统一走 MoneyText 规则 ===')

/** 递归收集所有 .vue */
function collectVue(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'unpackage' || name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) collectVue(full, out)
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

const vueFiles = collectVue(join(ROOT, 'pages')).concat(collectVue(join(ROOT, 'components')))

/**
 * 违规写法：在 MoneyText 上同时写死「收入绿 / 支出黑」这类三元表达式。
 * 这类写法就是以前不一致的根源，现在必须由组件内部规则决定。
 */
const BAD_PATTERNS = [
  /:color="[^"]*type === 'expense'[^"]*'/,
  /:color="[^"]*type === 'income'[^"]*'/,
  /:color="[^"]*balance[^"]*success[^"]*"/
]

const offenders = []
for (const file of vueFiles) {
  const src = readFileSync(file, 'utf-8')
  // 只看 MoneyText 标签内部
  const tagRe = /<MoneyText[\s\S]*?\/>/g
  let m
  while ((m = tagRe.exec(src)) !== null) {
    const tag = m[0]
    if (BAD_PATTERNS.some((re) => re.test(tag))) {
      const line = src.slice(0, m.index).split('\n').length
      offenders.push(`${relative(ROOT, file)}:${line}`)
    }
  }
}
check('没有页面手写收支颜色三元表达式', offenders, [])

/* -------------------------------------------------------------- 暗色适配 */

console.log('=== 暗色模式浅色底 ===')
check('暗色 primary-light 不再用纯白半透明', /'--app-primary-light': 'rgba\(255,255,255,0\.10\)'/.test(theme), false)
check('暗色 primary-light 走主题色调', /'--app-primary-light': tintOf\(p\.primary, 0\.22\)/.test(theme), true)
check('导出 tintOf 供复用', /export function tintOf/.test(theme), true)

const tabbar = read('components/AppTabBar.vue')
// 只看代码行，注释里提到旧值不算 —— 注释保留是为了解释「为什么改」
const tabbarCodeOnly = tabbar
  .split('\n')
  .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l) && !/^\s*\*/.test(l))
  .join('\n')
check('滑块暗色不再用纯白半透明', /rgba\(255,255,255,0\.14\)/.test(tabbarCodeOnly), false)
check('滑块走主题色浅底', /'--slider-color': settingStore\.primaryLight/.test(tabbar), true)

/* ------------------------------------------------------------ 玻璃质感统一 */

console.log('=== 柔光玻璃统一 ===')
check('theme 导出 glassVars', /export function glassVars/.test(theme), true)
check('tabbar 用 glassVars', /glassVars\(settingStore\.isDark/.test(tabbar), true)

/*
 * ★ 柔光玻璃用在「AI 记账输入条」上 ★
 *   用户明确要的是 + 弹出的那个输入框（QuickAddBar），
 *   不是通用确认弹窗（AppDialog 保持实色）。
 */
const quickAdd = read('components/QuickAddBar.vue')
check('AI 记账输入条用 glassVars', /glassVars\(settingStore\.isDark/.test(quickAdd), true)
check('输入条有玻璃底变量', /var\(--glass-bg-solid/.test(quickAdd), true)
check('输入条支持模糊并带 @supports 降级', /@supports[^{]*backdrop-filter[\s\S]*?\.quick-add-bar/.test(quickAdd), true)

const dialog = read('components/AppDialog.vue')
check('通用确认弹窗保持实色（不跟玻璃）', /background-color: var\(--app-card\)/.test(dialog), true)
check('确认弹窗未引入 glassVars', /glassVars/.test(dialog), false)

/* --------------------------------------------------------------- 月历现状 */

console.log('=== 月历保持现状 ===')
const cal = read('components/CalendarGrid.vue')
check('月历色仍在 CalendarGrid 内部', /heatColor|day-expense|day-income/.test(cal), true)
// 金额颜色必须来自主题变量，且「只有一套色值」—— 不许按档位换色
const calCode = cal
  .split('\n')
  .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
  .join('\n')
check('月历支出金额用 --app-danger', /return 'var\(--app-danger\)'/.test(cal), true)
check('月历收入金额用 --app-success', /return 'var\(--app-success\)'/.test(cal), true)
check('月历金额不再写死红色', /#D9363E|#E03131|#FF6B6B/.test(calCode), false)
check('月历金额不再写死绿色', /#0A8F4A|#4ADE80/.test(calCode), false)
// 关键：不能再有「第二套红/绿」（提亮档之类的派生色值）
check('月历不再按热力档位换色', /level >= 3\) return 'var\(--app-/.test(calCode), false)
check('没有派生出来的提亮色变量', /text-on-heat/.test(read('utils/theme.js')), false)

/* ------------------------------------------------ 日期分组头：收支一律无色 */

console.log('=== 日期分组头：标签无色、数字按规则着色 ===')
const listPage = read('pages/txn/list.vue')
check('全部交易：不再有 .day-income 整段着色类', /\.day-income\s*\{/.test(listPage), false)
check('全部交易：分组标签统一用 text-3', /\.day-sum-text\s*\{[^}]*color: var\(--app-text-3\)/.test(listPage), true)
check('全部交易：收入数字单独绿色', /\.day-sum-income\s*\{[^}]*var\(--app-success\)/.test(listPage), true)
// 符号：支出 -、收入 +（分组汇总也要带符号）
check('全部交易：支出汇总带 -', /支出 -\{\{ \(group\.expense/.test(listPage), true)
check('全部交易：收入汇总带 +', /收入 <text[^>]*>\+\{\{ \(group\.income/.test(listPage), true)

const indexPage = read('pages/index/index.vue')
check('首页：支出标签无色', /\.recent-day-exp\s*\{[^}]*--app-text-3/.test(indexPage), true)
check('首页：收入标签无色', /\.recent-day-inc\s*\{[^}]*--app-text-3/.test(indexPage), true)
check('首页：收入数字单独绿色', /\.recent-day-income-num\s*\{[^}]*var\(--app-success\)/.test(indexPage), true)
check('首页：支出汇总带 -', /支出 -\{\{ \(group\.expense/.test(indexPage), true)
check('首页：收入汇总带 +', /收入 <text[^>]*>\+\{\{ \(group\.income/.test(indexPage), true)

/* --------------------------------------------------- 其余分组场景一致性 */

// RecentTxnList 是账户/分类/标签/预算/周期详情页共用的按日期分组列表。
// 它没有分组汇总行（分组汇总只在首页和全部交易页），金额全部走 MoneyText 统一规则。
// 断言见下方「转账金额浅灰」小节（那里才声明 recent）。

/* ------------------------------------------- 账户余额：无色无符号 / 浅灰 */

console.log('=== 账户余额 ===')
const accPage = read('pages/account/index.vue')
check('账户列表余额不做 balance 着色', /variant="balance"/.test(accPage), false)
check('不计入资产的账户走 muted', /:muted="!acc\.include_in_total"/.test(accPage), true)

const accDetail = read('pages/account/detail.vue')
check('账户详情余额不做 balance 着色', /variant="balance"/.test(accDetail), false)
check('账户详情余额不置灰', /:muted=/.test(accDetail), false)

console.log('=== 交易详情 ===')
const txnDetail = read('pages/txn/detail.vue')
check('交易详情转账不着灰（显式正文色）', /txn\.type === 'transfer' \? 'var\(--app-text\)' : 'auto'/.test(txnDetail), true)

console.log('=== 转账金额浅灰 ===')
const recent = read('components/RecentTxnList.vue')
check('转账 type 恒为 transfer', /if \(txn\.type === 'transfer'\) return 'transfer'/.test(recent), true)
check('有账户视角时转账显示符号', /function amountSign\(txn\)/.test(recent), true)
// 共用的按日期分组列表没有分组汇总行（汇总只在首页 / 全部交易页）
check('RecentTxnList 无分组汇总行', /group\.expense|group\.income/.test(recent), false)
// amountColor 必须返回 'auto'，不能再写死颜色（图标色不在此列）
check('amountColor 交给统一规则', /function amountColor\(\) \{\s*return 'auto'\s*\}/.test(recent), true)

/* ------------------------------------- 货币符号：定死为 ¥（设置项已删） */

console.log('=== 货币符号定死为 ¥（个人信息页的设置项已删除）===')

/*
 * ★ 为什么这条要断言「不存在」★
 *   本位币恒为人民币，符号只能是 ¥。
 *   原来个人信息页给了一个可编辑的「货币符号」，
 *   改成 $ 之后金额显示成 $12.00 但实际还是人民币 ——
 *   数字和币种自相矛盾，用户已经要求把它彻底删掉。
 *   谁再把输入框加回来，或者让组件重新去读设置，这里会立刻失败。
 */
const profilePage = read('pages/settings/profile.vue')
check('个人信息页没有 currencySymbol 字段', /currencySymbol/.test(profilePage), false)
check('个人信息页没有「货币符号」一行', /货币符号/.test(profilePage), false)

const settingsApi = read('api/settings.js')
check('DEFAULT_SETTINGS 不再定义 currencySymbol', /currencySymbol\s*:/.test(settingsApi), false)

const settingStore = read('stores/setting.js')
check('setting store 没有 currencySymbol getter', /currencySymbol\s*\(/.test(settingStore), false)

check('MoneyText 的符号来自 BASE_SYMBOL', /symbol: props\.symbol \? BASE_SYMBOL : ''/.test(money), true)

const balanceSheet = read('components/BalanceSheet.vue')
check('对账弹层的符号来自 BASE_SYMBOL', /const currencySymbol = BASE_SYMBOL/.test(balanceSheet), true)
// 注释里会提到「原来读 settingStore.currencySymbol」，所以断言前先剥掉注释
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
check('对账弹层不再读设置里的符号', /settingStore\.currencySymbol/.test(stripComments(balanceSheet)), false)

check('账户页的符号来自 BASE_SYMBOL', /symbol: BASE_SYMBOL/.test(accPage), true)
check('账户页不再读设置里的符号', /settingStore\.currencySymbol/.test(stripComments(accPage)), false)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
