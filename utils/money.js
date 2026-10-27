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
  const n = Math.abs(Number(cents) || 0)   // 单位：分
  const negative = Number(cents) < 0
  const prefix = negative ? '-' : ''
  const yuan = n / 100                      // 单位：元

  if (yuan >= 10000) {
    return `${prefix}${(yuan / 10000).toFixed(1)}万`
  }
  if (yuan >= 1000) {
    return `${prefix}${(yuan / 1000).toFixed(1)}k`
  }
  // 元以下保留两位，整数元不带小数
  return `${prefix}${(yuan).toFixed(n % 100 === 0 ? 0 : 2)}`
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

/**
 * 解析带运算符的金额表达式，返回「分」。
 *
 * 数字键盘支持 + - × ÷ 和括号，这里同步支持，
 * 保证「界面上显示的金额」和「实际保存的金额」一致。
 *
 * 不用 eval —— 手写递归下降解析，优先级：
 *   括号 > 乘除 > 加减
 *
 *   evaluateAmount("12+8")     -> 2000  （分）
 *   evaluateAmount("12.5")     -> 1250
 *   evaluateAmount("2×(3+4)")  -> 1400
 *   evaluateAmount("")         -> 0
 */
export function evaluateAmount(expr) {
  if (expr === null || expr === undefined) return 0
  const raw = String(expr).trim()
  if (!raw) return 0

  // 归一化：× → *，÷ → /
  const s = raw.replace(/×/g, '*').replace(/÷/g, '/').replace(/\s/g, '')
  if (!s) return 0

  // 不含运算符和括号 → 走普通解析
  if (!/[+\-*/()]/.test(s)) {
    return parseAmountInput(s)
  }

  let pos = 0

  const peek = () => s[pos]

  function parseExpr() {
    let value = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const op = s[pos++]
      const rhs = parseTerm()
      value = op === '+' ? value + rhs : value - rhs
    }
    return value
  }

  function parseTerm() {
    let value = parseFactor()
    while (peek() === '*' || peek() === '/') {
      const op = s[pos++]
      const rhs = parseFactor()
      if (op === '*') {
        value = value * rhs
      } else {
        if (rhs === 0) return NaN   // 除以 0 视为无效
        value = value / rhs
      }
    }
    return value
  }

  function parseFactor() {
    if (peek() === '(') {
      pos++
      const v = parseExpr()
      if (peek() === ')') pos++
      return v
    }
    let numStr = ''
    while (pos < s.length && /[0-9.]/.test(s[pos])) {
      numStr += s[pos++]
    }
    const n = Number(numStr)
    return Number.isFinite(n) ? n : 0
  }

  try {
    const result = parseExpr()
    if (!Number.isFinite(result) || result <= 0) return 0
    return Math.round(result * 100)
  } catch (e) {
    return 0
  }
}
