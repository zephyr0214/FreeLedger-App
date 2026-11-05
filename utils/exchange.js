/**
 * 汇率换算页的纯数学部分 —— 零依赖、零副作用，可被 node 测试直接跑
 *
 * ★ 这一页为什么不用「分」★
 *   记账金额一律是整数「分」，但这里显示的是**换算结果**，
 *   不是账务数字：1 元人民币 ≈ 0.13 美元，用分表示要写 13 分，
 *   再乘回去就会一层层丢精度。
 *   用户明确要求「保留四位小数」，所以这里统一按 4 位小数存储与展示，
 *   每一步都 roundTo(4) 收口，避免浮点尾巴（0.30000000000000004）。
 *
 * ★ 口径 ★
 *   rates 沿用 api/exchangeRate.js 的语义：rates[code] = 1 单位外币值多少 CNY，
 *   CNY 恒为 1。所以：
 *     外币金额 -> 人民币：amount * rate
 *     人民币 -> 外币金额：cny / rate
 *   两个方向都只在最后一步取 4 位小数，中间不截断。
 */

import { BASE_CURRENCY } from './currency.js'

/** 换算结果保留的小数位数（用户指定） */
export const AMOUNT_DECIMALS = 4

/** 每次进入页面的基准金额：人民币 100 元 */
export const DEFAULT_BASE_AMOUNT = 100

/** 整数部分最多允许输入多少位（防止连按出一串数字撑破布局） */
const MAX_INT_DIGITS = 12

/**
 * 清洗金额输入：只留数字和一个小数点，小数最多 4 位
 *
 * ★ 为什么不用 parseFloat 直接吃 ★
 *   输入框是逐字符变化的。用户刚敲下 "12." 的时候，
 *   parseFloat 得到 12（合法），但如果直接回写格式化后的 "12.0000"，
 *   光标会被顶到末尾、小数点也被吃掉，人就没法继续输入了。
 *   所以保留「用户正在输入的形状」，只做非法字符剔除与位数截断。
 *
 * @param {string|number} raw 输入框的原始值
 * @param {number} maxDecimals 允许的小数位数
 * @returns {string} 清洗后的字符串（可能以小数点结尾，也可能是空串）
 */
export function sanitizeAmountInput(raw, maxDecimals = AMOUNT_DECIMALS) {
  let s = String(raw == null ? '' : raw).replace(/[^\d.]/g, '')

  // 只保留第一个小数点，后面再出现的一律删掉（否则 Number() 直接 NaN）
  const firstDot = s.indexOf('.')
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '')
  }

  const [intRaw, decRaw] = s.split('.')
  const intPart = (intRaw || '').slice(0, MAX_INT_DIGITS)
  if (decRaw === undefined) return intPart
  return intPart + '.' + decRaw.slice(0, maxDecimals)
}

/**
 * 四舍五入到指定小数位（返回 number）
 *
 * 用 Math.round(v * 10^n) / 10^n 而不是 toFixed()：toFixed 返回字符串，
 * 且在某些值上是「银行家式」的舍入，用来做下一步运算会再次引入误差。
 */
export function roundTo(n, decimals = AMOUNT_DECIMALS) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  const f = Math.pow(10, decimals)
  return Math.round(v * f) / f
}

/**
 * 金额文本化
 *
 * ★ 人民币不强行补 4 个 0 ★
 *   第一行是「CNY 100 元」这种基准表达，写成 100.0000 很难看；
 *   外币按用户要求固定 4 位（13.8100 比 13.81 更像汇率表）。
 *
 * @param {number} n 金额
 * @param {{ fixed?: boolean, decimals?: number }} opt fixed=是否强制补足小数位
 * @returns {string} 展示文本
 */
export function formatAmount(n, opt = {}) {
  const decimals = opt.decimals == null ? AMOUNT_DECIMALS : opt.decimals
  const fixed = opt.fixed !== false
  const v = roundTo(n, decimals)
  if (!Number.isFinite(v)) return ''
  const s = v.toFixed(decimals)
  if (fixed) return s
  // 去掉小数部分末尾的 0（只动小数点之后，避免把 100 削成 1）
  if (!s.includes('.')) return s
  return s.replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * 任意币种金额 -> 人民币金额（4 位小数）
 *
 * 输入还没成形（空串、"12."）时返回 0，调用方据此决定「要不要同步别的行」。
 */
export function convertToCny(code, amount, rates) {
  const v = Number(amount)
  if (!Number.isFinite(v) || v <= 0) return 0
  if (code === BASE_CURRENCY) return roundTo(v)
  const rate = Number(rates && rates[code])
  if (!Number.isFinite(rate) || rate <= 0) return 0
  return roundTo(v * rate)
}

/**
 * 人民币金额 -> 某币种金额（4 位小数）
 *
 * 汇率缺失（接口没返回该币种）时返回 0，页面会把这一行过滤掉。
 */
export function amountFromCny(code, cnyAmount, rates) {
  const cny = Number(cnyAmount)
  if (!Number.isFinite(cny) || cny <= 0) return 0
  if (code === BASE_CURRENCY) return roundTo(cny)
  const rate = Number(rates && rates[code])
  if (!Number.isFinite(rate) || rate <= 0) return 0
  return roundTo(cny / rate)
}

/**
 * 给定「哪一行被编辑了 + 它的金额」，算出所有币种的展示文本
 *
 * @param {string} editedCode 被编辑的币种
 * @param {string|number} editedAmount 它当前的输入值
 * @param {string[]} codes 要输出的币种列表（含 CNY）
 * @param {Object<string, number>} rates rates[code] = 1 外币 = ? CNY
 * @returns {{ cny: number, texts: Object<string, string> }}
 *   cny 是换算出的基准人民币金额；texts 是各币种待展示的文本
 */
export function buildAmountTexts(editedCode, editedAmount, codes, rates) {
  const cny = convertToCny(editedCode, editedAmount, rates)
  const texts = {}
  for (const code of codes) {
    const amount = amountFromCny(code, cny, rates)
    // 人民币不补零，外币固定 4 位 —— 与 formatAmount 的注释一致
    texts[code] = formatAmount(amount, { fixed: code !== BASE_CURRENCY })
  }
  return { cny, texts }
}
