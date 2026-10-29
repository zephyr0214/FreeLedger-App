/**
 * 日期工具
 *
 * 存储策略：
 *   occurred_at    UTC 毫秒时间戳（唯一权威时间）
 *   occurred_day   本地 YYYY-MM-DD（冗余，用于按天聚合，避免每次 strftime）
 *   month_key      本地 YYYY-MM（冗余，统计页 90% 的查询按此过滤）
 *   year_key       本地 YYYY（冗余）
 *   tz_offset      分钟数（东八区 = 480）
 */

const TZ_OFFSET = -new Date().getTimezoneOffset() // 东八区 -> 480

/** Date -> 本地 YYYY-MM-DD */
export function toDayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Date -> 本地 YYYY-MM */
export function toMonthKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/** Date -> 本地 YYYY */
function toYearKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  return String(d.getFullYear())
}

/** 时间戳 / Date -> 三个 key 的组合对象，写入 txn 时用 */
export function makeDateKeys(input) {
  const d = input instanceof Date ? input : new Date(input)
  return {
    occurred_at: d.getTime(),
    occurred_day: toDayKey(d),
    month_key: toMonthKey(d),
    year_key: toYearKey(d),
    tz_offset: TZ_OFFSET
  }
}

/** YYYY-MM-DD 的字符串 -> Date（本地零点） */
export function parseDayKey(dayKey) {
  const [y, m, d] = String(dayKey).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0)
}

/**
 * 三级选择（年/月/日）-> 查询区间
 *
 * 约定（0 表示「全部」）：
 *   year=0                 → 全部年：不限时间
 *   year>0, month=0        → 全部月：整年
 *   year>0, month>0, day=0 → 全部日：整月
 *   day>0                  → 具体某一天
 *
 * @param {{year:number,month:number,day:number}} sel
 * @returns {{startDay:string, endDay:string, monthKey:string}}
 *   startDay/endDay 为 '' 表示不限；monthKey 为 '' 表示不按月聚合
 */
export function selectionToRange(sel = {}) {
  const y = Number(sel.year) || 0
  const m = Number(sel.month) || 0
  const d = Number(sel.day) || 0
  if (!y) return { startDay: '', endDay: '', monthKey: '' }
  if (!m) return { startDay: `${y}-01-01`, endDay: `${y}-12-31`, monthKey: '' }

  const ym = `${y}-${String(m).padStart(2, '0')}`
  const lastDay = new Date(y, m, 0).getDate()
  if (d > 0) {
    const day = Math.min(d, lastDay)
    const dk = `${ym}-${String(day).padStart(2, '0')}`
    return { startDay: dk, endDay: dk, monthKey: ym }
  }
  return { startDay: `${ym}-01`, endDay: `${ym}-${String(lastDay).padStart(2, '0')}`, monthKey: ym }
}

/** 三级选择的默认态：当前年、当前月、全部日（即当月） */
export function defaultSelection() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: 0 }
}

/** YYYY-MM-DD -> 三级选择 */
export function selectionFromDayKey(dayKey) {
  const [y, m, d] = String(dayKey || '').split('-').map(Number)
  if (!y || !m) return defaultSelection()
  return { year: y, month: m, day: d || 0 }
}

/** 三级选择的展示文案（与 DateRangePicker 的 label 保持一致） */
export function selectionLabel(sel = {}) {
  const y = Number(sel.year) || 0
  const m = Number(sel.month) || 0
  const d = Number(sel.day) || 0
  if (!y) return '全部年'
  if (!m) return `${y}年`
  if (!d) return `${y}年${m}月`
  return `${y}年${m}月${d}日`
}

/**
 * 三级联动下拉的级联修正
 *
 * 规则（0 表示「全部」）：
 *   选年 = 0      → 月、日清零（全部年 = 不限时间）
 *   选月 = 0      → 日清零（全部月 = 整年）
 *   选到具体月但年为空 → 年补成今年
 *   日超出当月天数 → 下调到当月最后一天（不会变成 0）
 *
 * @param {{year:number,month:number,day:number}} sel
 * @param {'year'|'month'|'day'} changed 刚刚被改动的那一列
 * @returns {{year:number,month:number,day:number}} 修正后的选择
 */
export function cascadeSelection(sel = {}, changed = 'day') {
  let year = Number(sel.year) || 0
  let month = Number(sel.month) || 0
  let day = Number(sel.day) || 0

  if (changed === 'year' && !year) {
    month = 0
    day = 0
  }
  if (changed === 'month') {
    if (!month) {
      day = 0
    } else {
      if (!year) year = new Date().getFullYear()
    }
  }

  // 日越界下调（年或月没选时不处理，日只能是 0）
  if (year && month) {
    const last = new Date(year, month, 0).getDate()
    if (day > last) day = last
  } else {
    day = 0
  }

  return { year, month, day }
}

/** 某月的第一天与最后一天 */
export function monthRange(monthKey) {
  const [y, m] = String(monthKey).split('-').map(Number)
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0)
  const end = new Date(y, m, 0, 23, 59, 59, 999)
  return { start, end }
}

/** 月份加减，返回 YYYY-MM */
export function shiftMonth(monthKey, delta) {
  const [y, m] = String(monthKey).split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return toMonthKey(d)
}

/** 日期加减天数，返回本地 YYYY-MM-DD */
export function shiftDay(dayKey, delta) {
  const d = parseDayKey(dayKey)
  d.setDate(d.getDate() + delta)
  return toDayKey(d)
}

/** 今天 / 昨天 / 前天 的相对标签 */
export function relativeDayLabel(dayKey) {
  const today = toDayKey()
  if (dayKey === today) return '今天'
  if (dayKey === shiftDay(today, -1)) return '昨天'
  if (dayKey === shiftDay(today, -2)) return '前天'
  return ''
}

/** 星期几中文 */
export const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']
export function weekdayLabel(dayKey) {
  const d = parseDayKey(dayKey)
  return `周${WEEKDAY_CN[d.getDay()]}`
}

/** 完整展示：10月27日 周二 */
export function formatDayHeader(dayKey) {
  const d = parseDayKey(dayKey)
  const rel = relativeDayLabel(dayKey)
  const base = `${d.getMonth() + 1}月${d.getDate()}日 ${weekdayLabel(dayKey)}`
  return rel ? `${rel} · ${base}` : base
}

/** 时间展示 HH:mm */
export function formatTime(ts) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 当前时刻的 HH:mm */
export function currentTimeText(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 日期 + HH:mm -> 时间戳
 *
 * ★ 为什么不是 new Date('2026-10-27') ★
 *   不带时间的日期字符串会被按 **UTC** 解析，
 *   在东八区会变成当天 08:00，看起来「时间自己变了」。
 *   这里显式按本地时间构造。
 *
 * @param {string} dayKey YYYY-MM-DD
 * @param {string} timeText HH:mm
 * @returns {number} 毫秒时间戳
 */
export function combineDayTime(dayKey, timeText) {
  const [y, m, d] = String(dayKey || '').split('-').map(Number)
  const [hh, mm] = String(timeText || '00:00').split(':').map(Number)
  return new Date(
    y || 1970,
    (m || 1) - 1,
    d || 1,
    Number.isFinite(hh) ? hh : 0,
    Number.isFinite(mm) ? mm : 0,
    0,
    0
  ).getTime()
}

/** 按月计算的扣款日：若当月没有该日（如 31 号在 2 月），回退到当月最后一天 */
export function clampDayOfMonth(year, month, day) {
  const last = new Date(year, month, 0).getDate()
  return Math.min(day, last)
}

/** 距离下一次「还款日/账单日」还有几天（返回 0 表示今天） */
export function daysUntilMonthDay(dayOfMonth) {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const target = new Date(y, m, clampDayOfMonth(y, m + 1, dayOfMonth), 0, 0, 0, 0)
  const today = new Date(y, m, now.getDate(), 0, 0, 0, 0)
  let diff = Math.round((target - today) / 86400000)
  if (diff < 0) {
    const nextMonth = new Date(y, m + 1, clampDayOfMonth(y, m + 2, dayOfMonth), 0, 0, 0, 0)
    diff = Math.round((nextMonth - today) / 86400000)
  }
  return diff
}

/** 本月已过天数 / 本月总天数，用于预算「日均可用」 */
export function monthProgress(monthKey) {
  const now = new Date()
  const [y, m] = String(monthKey).split('-').map(Number)
  const total = new Date(y, m, 0).getDate()
  const isCurrent = y === now.getFullYear() && m === now.getMonth() + 1
  const passed = isCurrent ? now.getDate() : (monthKey < toMonthKey(now) ? total : 0)
  const remain = Math.max(total - passed, 0)
  return { total, passed, remain }
}
