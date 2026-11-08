/**
 * 同比对比区间计算 —— 纯函数，可单测
 *
 *   node scripts/test-compare-range.mjs
 *
 * ★ 这个文件解决什么问题 ★
 *   「本月」这个选择在日历上是 11/1~11/30，但今天才 11/8 ——
 *   拿「11/1~11/8」去比「10/1~10/31」是不公平的（半个月比整月），
 *   用户明确要求：**比上月同期**，即 11/1~11/8 ↔ 10/1~10/8。
 *
 *   而「近一周」「自定义 10/5~10/20」这类区间的正确做法又不一样：
 *   它们不是日历锚定的，硬按「段号」对齐反而会跳到上个把月去。
 *
 * ★ 为什么必须抽成纯函数 ★
 *   这段逻辑有六七条分支 + 月末/闰年夹取，埋在 api/stats.js 里
 *   只能靠「跑起来看看对不对」，边界（31 号、2 月、闰日）永远测不到。
 *   抽出来后每个分支都能用固定日期钉死。
 *
 * ★ 三条对齐规则（按优先级）★
 *   1. **整年**（1/1~12/31）→ 上一年同期，见 alignYear
 *   2. **一个月以内**（含整月、单日、「11/1~今天」这种从 1 号起的半截月）
 *      → 上一个月同期（同一段号），见 shiftMonthClamped
 *   3. 其它跨多月的自定义区间 → 紧挨着的上一个等长区间（不前跳重叠）
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

/**
 * 算出「当前区间」与「用来对比的上期区间」
 *
 * @param {{startDay?:string,endDay?:string,monthKey?:string}} range
 * @param {string} [today] YYYY-MM-DD，默认真实今天（测试可传假值）
 * @returns {null|{
 *   curStart:string, curEnd:string,
 *   prevStart:string, prevEnd:string,
 *   align:'year'|'month'|'span',
 *   clipped:boolean,          // 当前区间是否被「今天」截断过
 *   rangeStart:string, rangeEnd:string  // 原始（未截断）区间，用于文案
 * }}
 */
export function buildCompareRange(range, today = toDayKey()) {
  const e = expandRange(range)
  const todayKey = String(today || toDayKey())

  // 1) 不限时间（全部）—— 没有「上一段」可言，直接不给对比
  if (!e.startDay || !e.endDay) return null

  /*
   * 2) 用今天截断当前区间
   *
   * ★ 为什么一定要截 ★
   *   「本月」是 11/1~11/30，可数据只到 11/8。
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

  // 4) 整年 → 上一年同期
  if (isWholeYear(e.startDay, e.endDay)) {
    return {
      ...base,
      prevStart: shiftYearClamped(curStart, -1),
      prevEnd: shiftYearClamped(curEnd, -1),
      align: 'year'
    }
  }

  /*
   * 5) 一个月以内 → 上一个月同期（同一段号）
   *
   *   11/1~11/8   → 10/1~10/8
   *   10/1~10/31  → 9/1~9/30（整月对整月，天数不同但段号一致）
   *   11/8        → 10/8（单日）
   *   1/5~1/20    → 12/5~12/20（跨年由 shiftMonthClamped 处理）
   *
   * ★ 为什么用 monthSpan 而不是天数 ★
   *   「9/1~9/30」和「10/1~10/31」天数不同，按天数判断会把整月区间
   *   误判成跨月；按自然月跨度判断，整月永远是 1。
   */
  if (monthSpan(curStart, curEnd) <= 1) {
    return {
      ...base,
      prevStart: shiftMonthClamped(curStart, -1),
      prevEnd: shiftMonthClamped(curEnd, -1),
      align: 'month'
    }
  }

  /*
   * 6) 跨多月的自定义区间 → 紧挨着的上一个等长区间
   *
   *   ★ 为什么这里不再按段号对齐 ★
   *     9/15~11/8 如果整体前移一个月会变成 8/15~10/8，
   *     和当前区间重叠近 24 天 —— 「同比」变成自己跟自己比，
   *     涨幅永远接近 0，等于把面板做废。
   *     往后平移等长窗口虽然跨月不好看，但口径是干净的。
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
 * 百分比展示文案（分类行用）
 *
 *   null + 本期有数  → '新增'（上期这块一分没花，本期有了）
 *   null + 本期为 0  → '—'
 *   其它            → '+12.3%' / '-8.0%' / '0%'
 */
export function percentText(pct, cur) {
  if (pct === null || pct === undefined) {
    return Number(cur) > 0 ? '新增' : '—'
  }
  return percentOnly(pct)
}

/**
 * 对比区间的说明文案（面板副标题用）
 *
 *   '对比 10/01~10/08（上月同期）'
 *   '对比 2025/01/01~2025/11/08（去年同期）'
 *   '对比 07/23~09/14（等长区间）'
 */
export function compareRangeLabel(cr) {
  if (!cr || !cr.prevStart || !cr.prevEnd) return ''
  const f = (d) => {
    const [y, m, dd] = String(d).split('-')
    const curYear = new Date().getFullYear()
    // 跨年对比时把年份也写出来，否则「对比 12/01~12/08」看不出是哪一年
    return Number(y) === curYear ? `${m}/${dd}` : `${y}/${m}/${dd}`
  }
  const why = cr.align === 'year' ? '去年同期' : cr.align === 'month' ? '上月同期' : '等长区间'
  return `对比 ${f(cr.prevStart)}~${f(cr.prevEnd)}（${why}）`
}
