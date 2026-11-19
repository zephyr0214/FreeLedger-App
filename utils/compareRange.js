/**
 * 同比 / 环比对比区间计算 —— 纯函数，可单测
 *
 *   node scripts/test-compare-range.mjs
 *
 * ★ 口径 ★
 *   同比：当前区间 vs **去年同期** —— 起止日期各往前推一年
 *         （2/29 落到平年时夹到 2/28）。
 *   环比：当前区间 vs **上一周期** ——
 *     · 整年 → 上一年同期
 *     · 单日 → 前一天
 *     · 整月 / 从 1 号开始的月内区间 → 上个月同期
 *     · 其它自定义 / 滚动区间 → 紧挨着的上一段等长区间
 *
 * ★ 首尾日期怎么算 ★
 *   当前区间终点晚于今天时先截到今天（否则「半个空月」比「整月」，
 *   所有数字都会显示成暴跌）。截断后再换算对比区间：
 *     · 同比按截断后的起止日期各减一年；
 *     · 环比按月对齐时起止各减一个月，月末不足自动夹取；
 *     · 等长区间用「含首尾」的天数，前一段终点 = 当前起点前一天，
 *       起点 = 终点往前推 span-1 天，保证两段长度一致且不重叠。
 *
 * ★ 为什么必须抽成纯函数 ★
 *   这段逻辑有六七条分支 + 月末/闰年夹取，埋在 api/stats.js 里
 *   只能靠「跑起来看看对不对」，边界（31 号、2 月、闰日）永远测不到。
 *   抽出来后每个分支都能用固定日期钉死。
 *
 * ★ 「今天」为什么要传进来 ★
 *   函数必须是纯的：测试要能伪造「今天是 11/8」。
 *   默认值取真实今天，业务调用方不用传。
 */

import { parseDayKey, toDayKey, monthSpan } from './date.js'

/** 按 YYYY-MM-DD 取某月的天数 */
function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

/**
 * 日期整体前/后移若干个月，**日号超出目标月天数时夹到最后一天**
 *
 *   2026-03-31 移 -1 月 → 2026-02-28（不是 3 月 2 日之类）
 *   2026-01-15 移 -1 月 → 2025-12-15（跨年）
 *
 * ★ 为什么不用 Date 的 month 溢出语义 ★
 *   `new Date(y, m-1, 31)` 在 2 月会溢出成 3 月 2/3 日 ——
 *   那不是「上月同期」，而是「下个月初」，会把对比窗口整体挪偏。
 */
export function shiftMonthClamped(dayKey, delta) {
  const [y, m, d] = String(dayKey || '').split('-').map(Number)
  if (!y || !m || !d) return ''
  // 用「第 0 天」的技巧算目标月的天数；先把月份归一到 12 个月制
  const total = (y * 12) + (m - 1) + Number(delta || 0)
  const ty = Math.floor(total / 12)
  const tm = (total % 12) + 1
  const td = Math.min(d, lastDayOfMonth(ty, tm))
  return `${ty}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}`
}

/**
 * 日期整体前/后移若干年，**2/29 落到平年时夹到 2/28**
 *
 * ★ 为什么要单独一个函数 ★
 *   整年区间不能用「移一个月」—— 1/1~11/8 移一个月会变成
 *   去年 12/1~今年 10/8，和当前区间重叠 10 个月，
 *   同比就变成了「拿自己跟自己比」，数字毫无意义。
 */
export function shiftYearClamped(dayKey, delta) {
  const [y, m, d] = String(dayKey || '').split('-').map(Number)
  if (!y || !m || !d) return ''
  const ty = y + Number(delta || 0)
  const td = Math.min(d, lastDayOfMonth(ty, m))
  return `${ty}-${String(m).padStart(2, '0')}-${String(td).padStart(2, '0')}`
}

/** 两个 YYYY-MM-DD 之间相差的自然天数（含首尾） */
export function daySpanInclusive(startDay, endDay) {
  const a = parseDayKey(startDay)
  const b = parseDayKey(endDay)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1
}

/** 区间对象里 monthKey 补成具体起止日（空串表示不限） */
function expandRange(range) {
  const r = range || {}
  let startDay = r.startDay ? String(r.startDay) : ''
  let endDay = r.endDay ? String(r.endDay) : ''
  const monthKey = r.monthKey ? String(r.monthKey) : ''
  if (monthKey && (!startDay || !endDay)) {
    const [y, m] = monthKey.split('-').map(Number)
    const last = y && m ? lastDayOfMonth(y, m) : 0
    if (!startDay) startDay = `${monthKey}-01`
    if (!endDay) endDay = last ? `${monthKey}-${String(last).padStart(2, '0')}` : monthKey
  }
  return { startDay, endDay, monthKey }
}

/** 这个区间是不是「整年」（1/1~12/31，同一年） */
function isWholeYear(startDay, endDay) {
  if (!startDay || !endDay) return false
  if (!startDay.endsWith('-01-01') || !endDay.endsWith('-12-31')) return false
  return startDay.slice(0, 4) === endDay.slice(0, 4)
}

/** 这一天是不是所在月的最后一天（用于识别「整月」区间） */
function isMonthEnd(dayKey) {
  const [y, m, d] = String(dayKey || '').split('-').map(Number)
  if (!y || !m || !d) return false
  return d === lastDayOfMonth(y, m)
}

/**
 * 算出「当前区间」与「用来对比的上期区间」
 *
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @param {string} [today] YYYY-MM-DD，默认真实今天（测试可传假值）
 * @param {'yoy'|'mom'} [mode] yoy=同比（去年同期，默认）/ mom=环比（上一周期）
 * @returns {null|{
 *   curStart:string, curEnd:string,
 *   prevStart:string, prevEnd:string,
 *   align:'year'|'month'|'span',
 *   clipped:boolean,          // 当前区间是否被「今天」截断过
 *   rangeStart:string, rangeEnd:string  // 原始（未截断）区间，用于文案
 * }}
 */
export function buildCompareRange(range, today = toDayKey(), mode = 'yoy') {
  const e = expandRange(range)
  const todayKey = String(today || toDayKey())
  const isMom = mode === 'mom'

  // 1) 不限时间（全部）—— 没有「上一段」可言，直接不给对比
  if (!e.startDay || !e.endDay) return null

  /*
   * 2) 用今天截断当前区间
   *
   * ★ 为什么一定要截 ★
   *   「本月」是 11/1~11/30，可数据只到 11/19。
   *   不截断的话，当前区间是「半个空月」，对比区间是整月，
   *   所有数字都会显示成「大幅下降」，用户会以为这个月花得特别少。
   */
  const curStart = e.startDay
  const curEnd = e.endDay > todayKey ? todayKey : e.endDay
  const clipped = e.endDay > todayKey

  // 3) 整个区间都在未来（比如手动选了下个月）—— 没什么可比
  if (curStart > curEnd) return null

  const base = {
    curStart,
    curEnd,
    clipped,
    rangeStart: e.startDay,
    rangeEnd: e.endDay
  }

  /*
   * 4) 同比：一律去年同期
   *   起止日期各减一年，月末 / 闰日夹取，首尾都包含。
   *   11/01~11/19 -> 去年 11/01~11/19（不是上月，也不是整年）。
   */
  if (!isMom) {
    return {
      ...base,
      prevStart: shiftYearClamped(curStart, -1),
      prevEnd: shiftYearClamped(curEnd, -1),
      align: 'year'
    }
  }

  /*
   * 5) 环比：上一周期
   *
   * ★ 整年 ★
   *   1/1~12/31 -> 上一年 1/1~12/31。
   *   如果当前年还没过完、终点被截到今天，就按同样的截止日期比
   *   去年同期，不能拿半截年去比完整年。
   */
  if (isWholeYear(e.startDay, e.endDay)) {
    return {
      ...base,
      prevStart: shiftYearClamped(curStart, -1),
      prevEnd: shiftYearClamped(curEnd, -1),
      align: 'year'
    }
  }

  /*
   * 6) 单日 -> 前一天
   *   环比是「上一期」：日粒度数据的上一期就是昨天。
   */
  if (curStart === curEnd) {
    const prevEnd = shiftDays(curStart, -1)
    return {
      ...base,
      prevStart: prevEnd,
      prevEnd,
      align: 'span'
    }
  }

  /*
   * 7) 整月 / 从 1 号开始的月内区间 -> 上个月同期
   *
   *   11/01~11/19 -> 10/01~10/19
   *   10/01~10/31 -> 09/01~09/30（月末不足自动夹取）
   *   01/01~01/20 -> 去年 12/01~12/20（跨年）
   *
   * ★ 为什么「从 1 号开始」也算月内区间 ★
   *   用户选「本月至今」时 startDay 是 1 号，但 customToRange 不会给
   *   monthKey（不是完整月）。如果按等长区间往前推，会变成上个月
   *   24 号~月底这种「连续 19 天」，和「上月同期」不是一回事。
   */
  const sameMonth = monthSpan(curStart, curEnd) <= 1
  const startsAtMonthStart = curStart.slice(8, 10) === '01'
  if (sameMonth && (e.monthKey || startsAtMonthStart)) {
    return {
      ...base,
      prevStart: shiftMonthClamped(curStart, -1),
      prevEnd: shiftMonthClamped(curEnd, -1),
      align: 'month'
    }
  }

  /*
   * 8) 多个完整自然月 -> 紧挨着的前 N 个完整月
   *
   *   1/1~2/28 -> 去年 11/1~12/31
   *   4/1~6/30 -> 1/1~3/31
   *
   *   如果只按等长天数往前推，1~2 月会得到 11/3~12/31 ——
   *   天数一样，但首尾不在月初 / 月末，读起来不像「上期」。
   */
  const monthCount = monthSpan(curStart, curEnd)
  if (monthCount > 1 && startsAtMonthStart && isMonthEnd(curEnd)) {
    const prevEnd = shiftDays(curStart, -1)
    /*
     * 先把 prevEnd 往前推 monthCount-1 个月，再把日号固定为 01。
     * 例：prevEnd=12/31、monthCount=2 -> 11/30 -> 11/01。
     */
    const prevStart = `${shiftMonthClamped(prevEnd, -(monthCount - 1)).slice(0, 8)}01`
    return {
      ...base,
      prevStart,
      prevEnd,
      align: 'month'
    }
  }

  /*
   * 9) 其它滚动 / 自定义区间 -> 紧挨着的上一个等长区间
   *
   *   近一周 11/13~11/19 -> 11/06~11/12
   *   近一月 10/21~11/19 -> 09/21~10/20
   *   跨多月自定义 6/15~9/30 -> 紧邻的前一段等长窗口
   *
   * ★ 首尾都包含 ★
   *   prevEnd 是当前起点前一天，prevStart 再往前推 span-1 天；
   *   两段天数完全一致，且不会重叠一天。
   */
  const span = daySpanInclusive(curStart, curEnd)
  const prevEnd = shiftDays(curStart, -1)
  return {
    ...base,
    prevStart: shiftDays(prevEnd, -(span - 1)),
    prevEnd,
    align: 'span'
  }
}

/** 日期加减天数（本地时区，避免 UTC 偏移到前后一天） */
function shiftDays(dayKey, delta) {
  const d = parseDayKey(dayKey)
  d.setDate(d.getDate() + Number(delta || 0))
  return toDayKey(d)
}

/**
 * 变化百分比（相对上期）
 *
 * @param {number} cur 本期
 * @param {number} prev 上期
 * @returns {null|number} null 表示「算不出来」（上期为 0）
 *
 * ★ 上期为 0 时返回 null 而不是 0 或 100 ★
 *   「上个月这项花了 0，这个月花了 500」——
 *   算成 +∞%、+100% 或 0% 都是错的。返回 null，由页面显示「新增」。
 *   两边都是 0 时也返回 null（页面显示「—」）。
 */
export function changePercent(cur, prev) {
  const c = Number(cur) || 0
  const p = Number(prev) || 0
  if (p === 0) return null
  return Math.round(((c - p) / p) * 1000) / 10
}

/**
 * 结余的变化百分比
 *
 * ★ 为什么不能用 changePercent ★
 *   结余可以是负数（这个月花超了）。上期结余 -100、本期 +50 明明是**变好**，
 *   但 (50 - (-100)) / (-100) = -150% —— 分母为负，方向被翻反了，
 *   用户看到「结余 -150%」会以为更糟。
 *   所以上期结余 <= 0 时一律不给百分比（返回 null，页面显示「—」）。
 */
export function balanceChangePercent(cur, prev) {
  const p = Number(prev) || 0
  if (p <= 0) return null
  return Math.round(((Number(cur) || 0) - p) / p * 1000) / 10
}

/**
 * 百分比文案（不含 null 的特殊语义）
 *
 *   null → '—'
 *   0    → '0%'
 *   其它 → '+12.3%' / '-8.0%'
 */
export function percentOnly(pct) {
  if (pct === null || pct === undefined) return '—'
  const v = Number(pct)
  if (v === 0) return '0%'
  const sign = v > 0 ? '+' : '-'
  // 整数就不显示 .0，避免「+12.0%」这种别扭写法
  const abs = Math.abs(v)
  return `${sign}${abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(1)}%`
}

/**
 * 百分比展示文案（分类行与变化项用）
 *
 *   null + 本期有数  → '100%'（配上方箭头 ↑一起看）
 *   null + 本期为 0  → '—'
 *   其它            → '+12.3%' / '-8.0%' / '0%'
 *
 * ★ 为什么不再显示「新增」（用户本轮）★
 *   用户原话「不要显示新增了，就是上箭头100%」。
 *   「新增」是一个状态词，和周围那些百分比数字放在一起不齐；
 *   上期为 0 时本期的增长从比例上看就是「从 0 到 100%」，
 *   叫它 100% 脱离了一个整数周期的语境——但用户要的就是这个。
 *   方向仍然由箭头表达（调用方负责）。
 */
export function percentText(pct, cur) {
  if (pct === null || pct === undefined) {
    return Number(cur) > 0 ? '100%' : '—'
  }
  return percentOnly(pct)
}

/**
 * 对比区间的说明文案（面板副标题用）
 *
 *   环比：'对比 10/01~10/19'（同年上月）
 *   同比：'对比 2025/11/01~2025/11/19'（去年同期，年份必须写出来）
 *   跨年：'对比 2025/12/01~2025/12/19'
 *
 * ★ 年份按「当前区间」判断，而不是系统今年 ★
 *   用户在看 2027 年的账时，2026 年虽然等于系统当前年，
 *   对 2027 来说仍是「去年」，同比文案必须带年份。
 */
export function compareRangeLabel(cr) {
  if (!cr || !cr.prevStart || !cr.prevEnd) return ''
  const curYear = Number(String(cr.curStart || '').slice(0, 4)) || new Date().getFullYear()
  const f = (d) => {
    const [y, m, dd] = String(d).split('-')
    // 跨年对比时把年份也写出来，否则「对比 12/01~12/08」看不出是哪一年
    return Number(y) === curYear ? `${m}/${dd}` : `${y}/${m}/${dd}`
  }
  /*
   * ★ 不再带「（上月同期）」这种括号说明（本轮用户第 9b 条）★
   *   用户原话「「对比...」后面的两个括号及其内容删除，
   *   保持现有字号显示在同比变化和环比变化之后，同行」。
   *   括号里的「上月同期 / 去年同期 / 等长区间」属于解释性文字，
   *   放在标题后面会把「对比 10/01~10/08」挤到换行，
   *   而对比哪两段日期本身已经把话说清楚了。
   *   align 字段仍然返回给调用方，需要时可用（比如以后做 tooltip）。
   */
  return `对比 ${f(cr.prevStart)}~${f(cr.prevEnd)}`
}
