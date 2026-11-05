/**
 * 今日汇率页的换算规则测试
 *
 *   node scripts/test-exchange-calc.mjs
 *
 * ★ 为什么这一页要单独测 ★
 *   「改一行、其余行跟着变」这件事在 UI 上很难肉眼验收：
 *   汇率小数点后四位、浮点误差、清空输入时的行为，
 *   错一点点用户看到的就是一串 0.30000000000000004。
 *   这里把纯函数钉死，页面只管把结果铺到输入框里。
 *
 * ★ 核心口径 ★
 *   rates[code] = 1 单位外币值多少 CNY（与 api/exchangeRate.js 一致），
 *   CNY 恒为 1。外币金额 × rate = 人民币金额。
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  AMOUNT_DECIMALS,
  DEFAULT_BASE_AMOUNT,
  sanitizeAmountInput,
  roundTo,
  formatAmount,
  convertToCny,
  amountFromCny,
  buildAmountTexts
} from '../utils/exchange.js'
import { BASE_CURRENCY, SUPPORTED_CURRENCIES } from '../utils/currency.js'

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
    console.log(`FAIL  ${name}`)
    console.log(`      实际 ${a}`)
    console.log(`      期望 ${e}`)
  }
}

/* ------------------------------------------------------------ 常量 */

console.log('=== 展示口径 ===')
check('保留四位小数', AMOUNT_DECIMALS, 4)
check('默认基准金额是 100 元', DEFAULT_BASE_AMOUNT, 100)
check('基准币种是 CNY', BASE_CURRENCY, 'CNY')

/* --------------------------------------------------- 输入清洗 */

console.log('=== 输入清洗（不许吃掉用户正在敲的字）===')
check('普通数字原样', sanitizeAmountInput('123.45'), '123.45')
check('去掉非数字字符', sanitizeAmountInput('1a2b3'), '123')
check('只保留第一个小数点', sanitizeAmountInput('1.2.3'), '1.23')
check('小数最多四位', sanitizeAmountInput('1.23456789'), '1.2345')
check('末尾的小数点保留（正在输入）', sanitizeAmountInput('12.'), '12.')
check('空串仍是空串', sanitizeAmountInput(''), '')
check('null 变空串', sanitizeAmountInput(null), '')
check('整数部分限长', sanitizeAmountInput('1234567890123456').length, 12)
check('中文/符号被剔除', sanitizeAmountInput('￥1,000元'), '1000')

/* ------------------------------------------------------ 四舍五入 */

console.log('=== 四舍五入 ===')
check('roundTo 四位', roundTo(1.23456), 1.2346)
check('roundTo 消除浮点尾巴', roundTo(0.1 + 0.2), 0.3)
check('roundTo 非法值归零', roundTo(NaN), 0)
check('roundTo 字符串数字', roundTo('2.34567'), 2.3457)

/* --------------------------------------------------------- 格式化 */

console.log('=== 金额文本 ===')
check('外币固定四位', formatAmount(13.81), '13.8100')
check('人民币可省尾零', formatAmount(100, { fixed: false }), '100')
check('人民币保留有效小数', formatAmount(100.5, { fixed: false }), '100.5')
check('不把整数削成 1', formatAmount(100, { fixed: false }), '100')
check('四舍五入后补零', formatAmount(0.1 + 0.2, { fixed: false }), '0.3')

/* ----------------------------------------------------- 单步换算 */

// 1 USD = 7.24 CNY，1 JPY = 0.048 CNY
const RATES = { CNY: 1, USD: 7.24, JPY: 0.048 }

console.log('=== 单币种换算 ===')
check('人民币不动', convertToCny('CNY', 100, RATES), 100)
check('美元 -> 人民币', convertToCny('USD', 100, RATES), 724)
check('日元 -> 人民币', convertToCny('JPY', 10000, RATES), 480)
check('人民币 -> 美元', amountFromCny('USD', 724, RATES), 100)
check('人民币 -> 日元', amountFromCny('JPY', 480, RATES), 10000)
check('缺汇率时返回 0', convertToCny('TWD', 100, RATES), 0)
check('缺汇率时反算返回 0', amountFromCny('TWD', 100, RATES), 0)
check('金额为 0 时返回 0', convertToCny('USD', 0, RATES), 0)
check('非法金额返回 0', convertToCny('USD', 'abc', RATES), 0)

/* ------------------------------------------- 「改一行，其余同步」 */

console.log('=== 改一行，其余行同步 ===')

const CODES = ['CNY', 'USD', 'JPY']

// 第一次进入：CNY 100
{
  const r = buildAmountTexts('CNY', 100, CODES, RATES)
  check('基准：人民币金额', r.cny, 100)
  check('基准：CNY 文本', r.texts.CNY, '100')
  check('基准：USD 四位小数', r.texts.USD, (100 / 7.24).toFixed(4))
  check('基准：JPY 四位小数', r.texts.JPY, (100 / 0.048).toFixed(4))
}

// 用户改美元那一行 -> 人民币与日元都要跟着变
{
  const r = buildAmountTexts('USD', 50, CODES, RATES)
  check('改美元：折算人民币', r.cny, 362)
  check('改美元：CNY 文本', r.texts.CNY, '362')
  check('改美元：JPY 同步', r.texts.JPY, (362 / 0.048).toFixed(4))
  // 被编辑的那一行由页面自己保留原始输入，这里的文本只用于其它行
  check('改美元：USD 自身也给出四位', r.texts.USD, '50.0000')
}

// 用户改日元那一行
{
  const r = buildAmountTexts('JPY', 10000, CODES, RATES)
  check('改日元：折算人民币', r.cny, 480)
  check('改日元：USD 同步', r.texts.USD, (480 / 7.24).toFixed(4))
}

// 清空输入：全部归零，不能出 NaN
{
  const r = buildAmountTexts('USD', '', CODES, RATES)
  check('清空：人民币归零', r.cny, 0)
  check('清空：CNY 文本为零', r.texts.CNY, '0')
  check('清空：JPY 文本为零（不是 NaN）', r.texts.JPY, '0.0000')
}

// 只有小数点（用户刚敲完小数点）
{
  const r = buildAmountTexts('CNY', '12.', CODES, RATES)
  check('半个小数：人民币取 12', r.cny, 12)
  check('半个小数：USD 有值', r.texts.USD, (12 / 7.24).toFixed(4))
}

/* ------------------------------------------------ 页面源码约束 */

console.log('=== 今日汇率页 ===')
const page = read('pages/rate/index.vue')

check('用 onShow 拉取（每次进入都重拉）', /onShow\(\(\) => \{\s*reload\(\)/.test(page), true)
check('页面里调 fetchLatestRates', /fetchLatestRates\(\)/.test(page), true)
check('关联的币种来自白名单', /SUPPORTED_CURRENCIES/.test(page), true)
check('拉完汇率后回到 100 元基准', /applyBase\(DEFAULT_BASE_AMOUNT\)/.test(page), true)
check('第一行是 CNY 基准行', /isBase: true/.test(page), true)
check('输入框允许编辑（@input）', /@input="\(e\) => onAmountInput/.test(page), true)
check('输入框用 digit 键盘', /type="digit"/.test(page), true)
check('挂在页面上的 UpdateDialog', /<UpdateDialog \/>/.test(page), true)

// 币种顺序必须与白名单一致（CNY 打头，然后是 SUPPORTED_CURRENCIES 的原序）
{
  const idx = page.indexOf('for (const c of SUPPORTED_CURRENCIES)')
  check('按白名单顺序铺行', idx > 0, true)
  check('基准行在循环之前', page.indexOf('isBase: true') < idx, true)
}

/* --------------------------------------- 汇率页的界面调整（m00910） */

console.log('=== 今日汇率页的界面调整 ===')

// 1. 上方左来源、右更新时间
check('顶部有来源/更新时间一行', /class="meta-bar"/.test(page), true)
check('左边显示汇率来源', /class="meta-text">\{\{ sourceText \}\}/.test(page), true)
check('右边显示更新时间', /class="meta-text">\{\{ updatedText \}\}/.test(page), true)
check('来源文案带上「来源：」', /来源：/.test(page), true)
check('更新时间写成「更新于 YYYY-MM-DD HH:MM」', /更新于 ' \+ nowText\(\)/.test(page), true)
check('时间格式含日期', /return `\$\{toDayKey\(\)\} \$\{currentTimeText\(\)\}`/.test(page), true)
check('两端对齐（space-between）', /justify-content: space-between/.test(page), true)

// 2. 两句说明文案已删除
check('已删「数据仅供参考…」', /数据仅供参考/.test(page), false)
check('已删「改任意一行…」', /改任意一行的金额，其余币种/.test(page), false)
check('不再有 tip-text 提示条', /class="tip-text"/.test(page), false)

// 3. 汇率说明统一成「1 CNY = X 币种」
check('统一以人民币为 1', /return `1 CNY = \$\{formatAmount\(1 \/ rate\)\} \$\{code\}`/.test(page), true)
check('不再按 rate 大小分左右两种写法', /rate >= 1 \?/.test(page), false)
check('CNY 行也用同一句（不再写「基准币种」）', /rateText: '基准币种'/.test(page), false)
check('CNY 行也走 rateTextOf', /rateText: rateTextOf\(BASE_CURRENCY, 1\)/.test(page), true)

// 4. 每个币种一张卡、行间留白（照分类管理页）
check('列表容器是 rate-list', /class="rate-list"/.test(page), true)
check('每一项是独立卡片', /class="rate-item"/.test(page), true)
check('卡片之间 16rpx 间隔', /\.rate-item \{[\s\S]*?margin-bottom: 16rpx;/.test(page), true)
check('卡片有自己的圆角', /\.rate-item \{[\s\S]*?border-radius: 20rpx;/.test(page), true)
check('不再用整张大卡 + 分隔线', /border-bottom: 1rpx solid var\(--app-line\);\s*\}\s*\.rate-row/.test(page), false)

// 5. 人民币前面不再有主题色竖线
check('已删基准行的主题色左边线', /\.rate-row\.is-base/.test(page), false)
check('基准行不再绑 is-base 样式类', /:class="\{ 'is-base': row\.isBase \}"/.test(page), false)

/* --------------------------------- 新入口必须在「我的」页宫格里 */

console.log('=== 「我的」页两个宫格分组（基础功能 / 拓展功能）===')
const mine = read('pages/mine/index.vue')
check('有报销管理入口', /name: '报销管理'/.test(mine), true)
check('报销管理指向占位页', /\/pages\/loan\/reimburse/.test(mine), true)
check('有今日汇率入口', /name: '今日汇率'/.test(mine), true)
check('今日汇率指向汇率页', /\/pages\/rate\/index/.test(mine), true)

/*
 * ★ 分组与顺序按用户 m01008 / m01093 的原话定 ★
 *   基础功能：分类、标签、预算、汇率
 *   拓展功能：借入、借出、周期、报销
 *   两组各 4 项、各排成 2×2；数组顺序就是宫格里的左右上下顺序。
 */
const baseGroup = /title: '基础功能',[\s\S]*?title: '拓展功能'/.exec(mine)
check('有「基础功能」分组', !!baseGroup, true)
if (baseGroup) {
  check('基础功能里有分类管理', baseGroup[0].includes('分类管理'), true)
  check('基础功能里有标签管理', baseGroup[0].includes('标签管理'), true)
  check('基础功能里有预算管理', baseGroup[0].includes('预算管理'), true)
  check('基础功能里有今日汇率', baseGroup[0].includes('今日汇率'), true)
  check('基础功能里没有周期管理', baseGroup[0].includes('周期管理'), false)
  check('基础功能里没有报销管理', baseGroup[0].includes('报销管理'), false)
  // 顺序：分类 -> 标签 -> 预算 -> 汇率
  check(
    '基础功能按「分类、标签、预算、汇率」排',
    baseGroup[0].indexOf('分类管理') < baseGroup[0].indexOf('标签管理') &&
      baseGroup[0].indexOf('标签管理') < baseGroup[0].indexOf('预算管理') &&
      baseGroup[0].indexOf('预算管理') < baseGroup[0].indexOf('今日汇率'),
    true
  )
}
const extGroup = /title: '拓展功能',[\s\S]*?\]\s*\}\s*\]\)/.exec(mine)
check('有「拓展功能」分组', !!extGroup, true)
if (extGroup) {
  check('拓展功能里有借入管理', extGroup[0].includes('借入管理'), true)
  check('拓展功能里有借出管理', extGroup[0].includes('借出管理'), true)
  check('拓展功能里有周期管理', extGroup[0].includes('周期管理'), true)
  check('拓展功能里有报销管理', extGroup[0].includes('报销管理'), true)
  check('拓展功能里没有分类管理', extGroup[0].includes('分类管理'), false)
  check('拓展功能里没有今日汇率', extGroup[0].includes('今日汇率'), false)
  // 顺序：借入 -> 借出 -> 周期 -> 报销（用户就是这么写的）
  check(
    '拓展功能按「借入、借出、周期、报销」排',
    extGroup[0].indexOf('借入管理') < extGroup[0].indexOf('借出管理') &&
      extGroup[0].indexOf('借出管理') < extGroup[0].indexOf('周期管理') &&
      extGroup[0].indexOf('周期管理') < extGroup[0].indexOf('报销管理'),
    true
  )
}
check('分组标题不含「管理」二字', /title: '基础功能管理'|title: '拓展功能管理'/.test(mine), false)
check('每个分组各 4 项（2×2）', (mine.match(/key: '(category|tag|budget|rate|loanIn|loanOut|cycle|reimburse)'/g) || []).length, 8)

console.log('=== 占位页 ===')
const reimburse = read('pages/loan/reimburse.vue')
check('报销页有标题', /title="报销管理"/.test(reimburse), true)
check('报销页说明是占位', /占位|还在路上/.test(reimburse), true)
check('报销页没有假按钮', /<button/.test(reimburse), false)
check('报销页也挂了 UpdateDialog', /<UpdateDialog \/>/.test(reimburse), true)

console.log('=== 路由声明 ===')
const pagesJson = JSON.parse(read('pages.json'))
const paths = pagesJson.pages.map((p) => p.path)
check('pages.json 声明了汇率页', paths.includes('pages/rate/index'), true)
check('pages.json 声明了报销页', paths.includes('pages/loan/reimburse'), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
