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

/** 跳转到统计页，并携带筛选条件（对象形状与 TxnFilterSheet 的 filter 一致） */
export function openStatsWithFilter(filter) {
  try {
    uni.setStorageSync(KEY, JSON.stringify({
      filter: filter || {},
      at: Date.now()
    }))
  } catch (e) {}
  uni.switchTab({ url: '/pages/stats/index' })
}

/** 统计页消费待生效的筛选条件；没有 / 已过期返回 null */
export function consumeStatsFilter() {
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
  if (!parsed || !parsed.filter) return null
  if (parsed.at && Date.now() - Number(parsed.at) > TTL_MS) return null
  return parsed.filter
}
