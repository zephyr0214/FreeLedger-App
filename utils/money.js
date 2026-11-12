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


/**
 * 万元阈值：超过就用「万」作单位
 *
 * ★ 用户本轮第 6 条 ★
 *   「一些没有考虑到金额过大的情况，把所有显示价签的地方，
 *   金额大于等于 100 万时使用两位小数加 W 为单位表示，也就是自动换算」。
 *
 * ★ 为什么是 100 万（不是 1 万）★
 *   一万开始就换算会让常见金额变得难读：「12345 元」变成「1.23W」，
 *   用户反而要心算一下。而 100 万以上的数字本来就长
 *   （「1,234,567.89」一行放不下），换算才真正有价值。
 */
export const WAN_THRESHOLD_CENTS = 100 * 10000 * 100

/**
 * 一万元在分下的值：10000 元 × 100 = 1,000,000 分
 *
 * ★ 和上面的阈值是两回事，不能混用（写错一次就会差 100 倍）★
 *   · WAN_THRESHOLD_CENTS = 100 万元 → 「从多大开始换算」
 *   · WAN_UNIT_CENTS      = 1 万元  → 「W 这个单位本身是多少」
 *
 *   123 万元 应该显示成「123.00W」。
 *   如果除以阈值，会得到「1.23W」—— 那个 1.23 的单位是「100 万」，
 *   与 W（万）不是同一个量级，用户看了会以为金额少了 100 倍。
 */
export const WAN_UNIT_CENTS = 10000 * 100

/**
 * 分 -> 展示字符串
 *
 * @param {number} cents 分
 * @param {object} opt
 *   sign              是否带正负号
 *   grouping          千分位
 *   symbol            货币符号
 *   decimals          小数位
 *   hideZeroDecimals  整数元时隐藏小数
 *   autoWan           超过 100 万自动换成「1.23W」（默认开）
 *
 * ★ 为什么默认开而不是让调用方逐个开 ★
 *   用户要求的是「**所有**显示价签的地方」。
 *   如果写成可选参数、默认关，那 30 多个调用点就得逐个加上，
 *   漏一个就会出现「这里换算了那里没换算」的不一致。
 *   默认开、需要原始数字时显式传 false（如输入框回填）。
 */
export function formatCents(cents, opt = {}) {
  const {
    sign = false,
    grouping = true,
    symbol = '',
    decimals = 2,
    hideZeroDecimals = false,
    autoWan = true
  } = opt

  const n = Number(cents) || 0
  const negative = n < 0
  const abs = Math.abs(n)
  const prefix = negative ? '-' : (sign ? '+' : '')

  /*
   * ★ 大额：换算成万元，两位小数 + W ★
   *   不走千分位——「1.23W」本身只有 4 个数字，再加逗号反而累赘。
   *   小数位固定 2 位：「100W」「150.00W」在一列里对齐，比「100W / 150W」好读。
   */
  if (autoWan && abs >= WAN_THRESHOLD_CENTS) {
    const wan = abs / WAN_UNIT_CENTS
    return `${prefix}${symbol}${wan.toFixed(2)}W`
  }

  let yuan = abs / 100

  if (hideZeroDecimals && abs % 100 === 0) {
    // 整数元时不显示小数
    let intPart = String(Math.floor(yuan))
    if (grouping) intPart = groupThousands(intPart)
    return `${prefix}${symbol}${intPart}`
  }

  let str = yuan.toFixed(decimals)
  let [intPart, decPart] = str.split('.')
  if (grouping) intPart = groupThousands(intPart)
  str = decPart ? `${intPart}.${decPart}` : intPart

  return `${prefix}${symbol}${str}`
}

function groupThousands(intStr) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * 金额的「万」单位简写（不带货币符号）
 *
 * ★ 为什么单独一个函数 ★
 *   页面里大量的价签是**手写**字符串，如
 *     `¥{{ (x / 100).toFixed(2) }}`
 *   （因为那些地方需要控制前后文、嵌在一句话里，用不了组件）。
 *   这些地方改成调 formatCents 会很啰嗦（还要处理符号/负数），
 *   所以给一个只管「金额本体」的轻量函数：
 *     formatWanYuan(123456789) -> '1.23W'
 *     formatWanYuan(12345)     -> '123.45'
 *
 * ★ 为什么还要保留原来的小数位规则 ★
 *   未达阈值时行为必须与之前**完全一致**（一直是两位小数），
 *   否则就不是「大额补救」而是「全盘改展示」了。
 *
 * @param {number} cents 分
 * @returns {string} 带 W 后缀或两位小数的字符串
 */
export function formatWanYuan(cents) {
  const abs = Math.abs(Number(cents) || 0)
  if (abs >= WAN_THRESHOLD_CENTS) {
    return `${(abs / WAN_UNIT_CENTS).toFixed(2)}W`
  }
  return (abs / 100).toFixed(2)
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


/** 安全加法，接收分 */


/** 百分比，返回 0~100 的整数 */


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
