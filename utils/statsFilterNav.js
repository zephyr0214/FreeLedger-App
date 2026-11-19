/**
 * 从「账户详情 / 标签详情」跳到统计页并带上筛选条件
 *
 * ★ 为什么不能直接 navigateTo 带 query ★
 *   统计页是 tab 页（pages.json 里注册在 tabBar），
 *   uni.switchTab 不支持 query 参数；而 navigateTo 打开 tab 页会失败。
 *   所以把条件临时存到本地存储，统计页 onShow 时消费一次。
 *
 * ★ 为什么要带时间戳 ★
 *   如果 switchTab 失败（极少数情况），这条条件会留在存储里；
 *   用户下次从 tabBar 进统计页时不该莫名其妙套上一个旧筛选。
 *   超过 30 秒直接丢弃。
 */

const KEY = 'stats_pending_filter'
const TTL_MS = 30 * 1000

/**
 * 跳转到统计页，并携带筛选条件（对象形状与 TxnFilterSheet 的 filter 一致）
 *
 * @param {object} filter 账户 / 标签等筛选条件
 * @param {{dateMode?:'period'|'custom', selection?:{year:number,month:number,day:number}}} [opt]
 *   opt.selection 用来指定进入统计页后的时间选择；
 *   标签详情要求默认「全部年 / 全部月 / 全部日」，就是传
 *   { dateMode: 'period', selection: { year: 0, month: 0, day: 0 } }。
 */
export function openStatsWithFilter(filter, opt = {}) {
  const payload = {
    filter: filter || {},
    at: Date.now()
  }
  if (opt && (opt.dateMode === 'period' || opt.dateMode === 'custom')) {
    payload.dateMode = opt.dateMode
  }
  if (opt && opt.selection) {
    payload.selection = {
      year: Number(opt.selection.year) || 0,
      month: Number(opt.selection.month) || 0,
      day: Number(opt.selection.day) || 0
    }
  }
  try {
    uni.setStorageSync(KEY, JSON.stringify(payload))
  } catch (e) {}
  uni.switchTab({ url: '/pages/stats/index' })
}

/**
 * 统计页消费完整的待生效导航数据；没有 / 已过期返回 null
 *
 * @returns {null|{filter:object, dateMode?:string, selection?:object}}
 */
export function consumeStatsPayload() {
  let raw = null
  try {
    raw = uni.getStorageSync(KEY)
  } catch (e) {
    return null
  }
  if (!raw) return null
  try {
    uni.removeStorageSync(KEY)
  } catch (e) {}
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      return null
    }
  }
  if (!parsed) return null
  if (parsed.at && Date.now() - Number(parsed.at) > TTL_MS) return null
  const hasFilter = parsed.filter && Object.keys(parsed.filter).length > 0
  if (!hasFilter && !parsed.dateMode && !parsed.selection) return null
  return parsed
}

/** 统计页消费待生效的筛选条件；没有 / 已过期返回 null */
export function consumeStatsFilter() {
  const payload = consumeStatsPayload()
  return payload ? (payload.filter || {}) : null
}
