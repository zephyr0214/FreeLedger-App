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

/**
 * 自定义区间（开始日 ~ 结束日）-> 查询区间
 *
 * ★ 为什么 monthKey 只在「整月」时才给 ★
 *   monthKey 是个查询加速开关：给了它，SQL 就会走
 *   `t.month_key = ?` 的索引（见 api/transaction.js 的 buildQuery）。
 *   自定义区间大多是跨月的，硬塞一个 monthKey 会漏数据。
 *   只有用户正好选满一整月（1 号 ~ 月末）时才顺手补上，
 *   其余情况一律走 occurred_day 的区间比较。
 *
 * ★ 起止颠倒要自动纠正 ★
 *   用户先点结束日再改开始日时很容易选出「开始 > 结束」，
 *   这时候如果不交换，查询结果永远是空的，看着像「这个区间没数据」。
 *
 * @param {string} startDay YYYY-MM-DD
 * @param {string} endDay YYYY-MM-DD
 * @returns {{startDay:string, endDay:string, monthKey:string}}
 */
export function customToRange(startDay, endDay) {
  let a = String(startDay || '')
  let b = String(endDay || '')
  if (!a && !b) return { startDay: '', endDay: '', monthKey: '' }
  if (!a) a = b
  if (!b) b = a
  if (a > b) {
    const t = a
    a = b
    b = t
  }

  // 整月才给 monthKey（提升走索引的几率）
  let monthKey = ''
  if (a.slice(0, 7) === b.slice(0, 7)) {
    const ym = a.slice(0, 7)
    const [y, m] = ym.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    if (a === `${ym}-01` && b === `${ym}-${String(last).padStart(2, '0')}`) {
      monthKey = ym
    }
  }
  return { startDay: a, endDay: b, monthKey }
}

/**
 * 自定义区间的默认态：近一月（今天往前 30 天，含今天）
 *
 * ★ 为什么默认是「近一月」而不是「本月 1 号」★
 *   用户要求默认显示「近一月」。
 *   而且月初那几天用「本月 1 号 ~ 今天」只有一两天数据，
 *   看着像统计坏了；近一月无论哪天打开都有一段像样的数据。
 *
 * ★ 必须和 DateFilterBar 的「近一月」预设算得一模一样 ★
 *   组件里的近一月是 shiftDay(today, -29) ~ today（共 30 天）。
 *   两处算法一旦不同，默认状态下左边的下拉就显示成「自定义」，
 *   而不是「近一月」—— 用户会以为默认值没生效。
 */
export function defaultCustomRange() {
  const now = new Date()
  const today = toDayKey(now)
  return { startDay: shiftDay(today, -29), endDay: today }
}

/**
 * 自定义区间的展示文案
 * @param {string} startDay
 * @param {string} endDay
 * @returns {string}
 */
export function customRangeLabel(startDay, endDay) {
  const r = customToRange(startDay, endDay)
  if (!r.startDay) return '全部时间'
  if (r.startDay === r.endDay) return r.startDay
  return `${r.startDay} ~ ${r.endDay}`
}

/**
 * 趋势图「按天分桶」允许的最大自然月跨度
 *
 * ★ 为什么是「月跨度」而不是「多少天」★
 *   写死 62 天会踩两个坑：
 *     1. 2 月（28 天）整月只有 28 天，判成日趋势天经地义；
 *        但 62 天这个数字会让「7 月 1 号 ~ 8 月 31 号」这种正好两个整月
 *        的区间变成 62 天，边界上忽日忽月，用户点相邻两个月会看到图表跳变。
 *     2. 用户选的是「月」，脑子里的单位就是月。
 *   所以按「跨了几个自然月」判断：跨 1~2 个月用日趋势，3 个月以上用月趋势。
 *   两个月 = 最多 62 天（31+31），正好是「再密也塞得下」的上限。
 */
export const TREND_DAY_MAX_MONTHS = 2

/**
 * 区间跨越的自然月数（含首尾）
 *
 *   '2026-03-15' ~ '2026-03-20' → 1
 *   '2026-03-15' ~ '2026-04-02' → 2
 *   '2026-01-01' ~ '2026-12-31' → 12
 *   任一端为空 / 起止颠倒 / 格式不对 → 0（表示「不限」，由调用方按不限处理）
 *
 * @param {string} startDay YYYY-MM-DD
 * @param {string} endDay YYYY-MM-DD
 * @returns {number}
 */
export function monthSpan(startDay, endDay) {
  const a = String(startDay || '')
  const b = String(endDay || '')
  if (!a || !b || a > b) return 0
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  if (!ay || !am || !by || !bm) return 0
  return (by - ay) * 12 + (bm - am) + 1
}

/**
 * 趋势图该按「日」还是「月」分桶
 *
 * ★ 不限时间（两端都空）一律按月 ★
 *   全量数据可能横跨好几年，按天画出来是上千根柱子，既看不清也画不动。
 *
 * @param {string} startDay
 * @param {string} endDay
 * @returns {'day'|'month'}
 */
export function trendBucketOf(startDay, endDay) {
  const span = monthSpan(startDay, endDay)
  if (span <= 0) return 'month'
  return span <= TREND_DAY_MAX_MONTHS ? 'day' : 'month'
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

/**
 * 距离「本月某个第 N 天」还有几天（返回 0 表示今天）。
 *
 * ★ 通用工具，不再绑定信用卡 ★
 *   以前给账户的「还款日」做倒计时用；信用卡的账单日/还款日已经整套删掉，
 *   但「离某个月的某一天还有几天」本身是个通用问题（周期记账、
 *   自定义提醒都用得上），所以函数留着，scripts/test-logic.mjs 也还在测它。
 */
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

/**
 * 本月已过天数 / 本月总天数，用于预算「日均可用」。
 *
 * ★ remain 必须包含「今天」★
 *   10 月 30 日：passed = 30，但今天这一天还没过完、还能花钱，
 *   所以剩余可用天数是 2（30 号、31 号），不是 1。
 *   写成 total - passed 会少算一天，日均被高估
 *   （用户反馈的正是这个：10/30 时应该除以 2）。
 *
 * ★ total 用真实月份天数 ★
 *   new Date(y, m, 0).getDate() 会正确处理 28/29/30/31：
 *     2024-02 → 29（闰年）、2025-02 → 28、4/6/9/11 月 → 30、其余 → 31。
 *
 * ★ 非当月 ★
 *   已过去的月份：已全部过完，remain = 0（不再有「剩余日均」）；
 *   未来月份：还没开始，passed = 0，remain = 整月天数。
 */
export function monthProgress(monthKey) {
  const now = new Date()
  const [y, m] = String(monthKey).split('-').map(Number)
  const total = new Date(y, m, 0).getDate()
  const isCurrent = y === now.getFullYear() && m === now.getMonth() + 1

  let passed
  let remain
  if (isCurrent) {
    // 当月：已过天数含今天；剩余天数从今天算起（含今天）
    passed = now.getDate()
    remain = Math.max(total - passed + 1, 1)
  } else if (monthKey < toMonthKey(now)) {
    // 已过去的月份：全部过完，没有剩余天数
    passed = total
    remain = 0
  } else {
    // 未来月份：一天都还没过，整月都是剩余
    passed = 0
    remain = total
  }

  return { total, passed, remain }
}
