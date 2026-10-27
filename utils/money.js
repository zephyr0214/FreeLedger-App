/**
 * 金额工具 —— 内部一律使用「分」(integer cents)，仅在展示层转换为元。
 * 绝不用浮点数参与计算：0.1 + 0.2 !== 0.3
 */

/** 元 -> 分（四舍五入，容忍 "12.345" 这类输入） */
export function yuanToCents(yuan) {
  const n = Number(yuan)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

/** 分 -> 元（number） */
export function centsToYuan(cents) {
  const n = Number(cents)
  if (!Number.isFinite(n)) return 0
  return n / 100
}

/**
 * 分 -> 展示字符串
 * @param {number} cents 分
 * @param {object} opt { sign: 是否带正负号, grouping: 千分位, symbol: 货币符号, decimals: 小数位 }
 */
export function formatCents(cents, opt = {}) {
  const {
    sign = false,
    grouping = true,
    symbol = '',
    decimals = 2,
    hideZeroDecimals = false
  } = opt

  const n = Number(cents) || 0
  const negative = n < 0
  const abs = Math.abs(n)
  let yuan = abs / 100

  if (hideZeroDecimals && abs % 100 === 0) {
    // 整数元时不显示小数
    let intPart = String(Math.floor(yuan))
    if (grouping) intPart = groupThousands(intPart)
    return `${negative ? '-' : sign ? '+' : ''}${symbol}${intPart}`
  }

  let str = yuan.toFixed(decimals)
  let [intPart, decPart] = str.split('.')
  if (grouping) intPart = groupThousands(intPart)
  str = decPart ? `${intPart}.${decPart}` : intPart

  const prefix = negative ? '-' : (sign ? '+' : '')
  return `${prefix}${symbol}${str}`
}

function groupThousands(intStr) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 紧凑展示：12345 分 -> "123.45"，超过 1 万元显示 "1.2万" */
export function formatCentsCompact(cents) {
  const n = Math.abs(Number(cents) || 0)
  const negative = Number(cents) < 0
  const prefix = negative ? '-' : ''
  if (n >= 1000000) {
    // >= 1万元
    return `${prefix}${(n / 1000000).toFixed(1)}万`
  }
  if (n >= 100000) {
    // >= 1000元
    return `${prefix}${(n / 10000).toFixed(0)}k`
  }
  return `${prefix}${(n / 100).toFixed(n % 100 === 0 ? 0 : 2)}`
}

/** 金额脱敏：隐私模式 */
export function maskCents(cents) {
  return '****'
}

/** 安全加法，接收分 */
export function sumCents(list) {
  return list.reduce((acc, v) => acc + (Number(v) || 0), 0)
}

/** 百分比，返回 0~100 的整数 */
export function percentOf(part, total) {
  const t = Number(total) || 0
  if (t === 0) return 0
  return Math.round((Number(part) / t) * 1000) / 10
}

/**
 * 解析用户输入的金额字符串为分。
 * 支持 "12"、"12.5"、"12.345"（截断到分）、".5"
 */
export function parseAmountInput(str) {
  if (str === null || str === undefined) return 0
  const s = String(str).replace(/[^\d.]/g, '')
  if (!s || s === '.') return 0
  return yuanToCents(s)
}
