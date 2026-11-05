/**
 * 汇率聚合层 —— 多源取数 + 顺序降级 + 本地缓存
 *
 * ★ 数据源（4 个端点 / 3 个独立来源，全部免 Key）★
 *   1. open.er-api.com            每日一价，~160 币种，主源
 *   2. fawazahmed0（jsDelivr）    每日一价，200+ 币种，国内可达性好
 *   3. fawazahmed0（Cloudflare）  同项目双镜像
 *   4. frankfurter.app            欧央行，每工作日，唯一支持历史日期
 *
 * ★ 口径统一 ★
 *   各接口返回的都是「1 base = X 外币」。统一折算成
 *   「1 外币 = ? CNY」：rate_cny = base_cny / currency_per_base。
 *   base 用 USD 最通用（frankfurter 的历史查询按日期也支持 base=usd）。
 *
 * ★ 币种边界（与 utils/currency.js 白名单的关系）★
 *   白名单是功能边界（静态、含 TWD/VND），
 *   接口返回缺某币种时用**缓存的上次汇率**兜底并标注 ——
 *   绝不让「某个接口某天少了 TWD」把 TWD 记账功能干掉。
 *
 * ★ 历史汇率（周期补记按发生日口径的前提）★
 *   frankfurter / fawazahmed0 支持按日期取，
 *   拉到就写进 exchange_rate 表（一天一价）复用；
 *   周末/假日取前一工作日 —— 与银行结算惯例一致。
 */

import { SUPPORTED_CURRENCIES, BASE_CURRENCY } from '../utils/currency.js'
import { getStoredRate, saveRatesForDay } from './rateStore.js'
import { getSetting, setSetting } from './settings.js'

/** 汇率源，按优先级排序（实时/最新价） */
const SOURCES = [
  {
    name: 'open.er-api',
    url: 'https://open.er-api.com/v6/latest/USD'
  },
  {
    name: 'fawazahmed0-jsdelivr',
    url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json'
  },
  {
    name: 'fawazahmed0-cloudflare',
    url: 'https://latest.currency-api.pages.dev/v1/currencies/usd.json'
  }
]

/** 历史汇率源（按日期；frankfurter 周末返回前一工作日） */
function historicalUrl(day, base) {
  return `https://api.frankfurter.app/${day}?from=${base}`
}
function historicalUrlAlt(day, base) {
  // fawazahmed0 按日期快照（日期目录），无 key
  return `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${day}/v1/currencies/${base}.json`
}

/** 单源请求超时（毫秒）—— 快速失败才能快速降级 */
const REQ_TIMEOUT = 8000

/**
 * 统一的 uni.request 包装
 * @returns {Promise<any>} 解析好的 JSON
 */
function requestJson(url) {
  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method: 'GET',
      timeout: REQ_TIMEOUT,
      success: (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        resolve(res.data)
      },
      fail: (e) => reject(new Error((e && e.errMsg) || '网络请求失败'))
    })
  })
}

/**
 * 从各源响应里抽出「1 USD = X 币种」的映射表
 * 三个源的 JSON 形状不同，这里各自归一化。
 */
function parseRates(name, data) {
  if (name === 'open.er-api') {
    return (data && data.rates) || null
  }
  if (name === 'frankfurter') {
    return (data && data.rates) || null
  }
  // fawazahmed0: { date: "...", usd: { jpy: 150, cny: 7.2, ... } }
  if (data && typeof data === 'object' && data.usd && typeof data.usd === 'object') {
    return data.usd
  }
  return null
}

/**
 * 顺序降级取「1 USD = X 各币种」的最新汇率
 *
 * ★ 为什么按源降级而不是按币种递归 ★
 *   每个源一次请求就返回全部币种 —— 按源切最省请求；
 *   币种缺失走缓存兜底（见 getRates）。
 *
 * @returns {Promise<{rates: Object<string,number>, source: string, day: string}>}
 * @throws {Error} 全部源失败
 */
async function fetchLatestRatesFromSources() {
  const errors = []
  for (const src of SOURCES) {
    try {
      const data = await requestJson(src.url)
      const rates = parseRates(src.name, data)
      if (!rates || typeof rates.cny !== 'number') {
        throw new Error('响应缺少 rates')
      }
      return { rates, source: src.name, day: (data.date || data.time_last_update_utc || '') }
    } catch (e) {
      errors.push(`${src.name}: ${e.message}`)
      console.warn(`[rate] 源 ${src.name} 失败：${e.message}，尝试下一个`)
    }
  }
  throw new Error('所有汇率源均失败 —— ' + errors.join(' | '))
}

/**
 * 换算：「1 USD = r_usd 外币」 -> 「1 外币 = ? CNY」
 * rate(c) = cny_per_usd / usd_per_c ... 即 cny_usd.rates[c]
 * 注意 rates 的 key 都是小写
 */
function ratesToCny(usdRates) {
  const cnyPerUsd = usdRates.cny
  if (!cnyPerUsd || !Number.isFinite(Number(cnyPerUsd)) || Number(cnyPerUsd) <= 0) {
    throw new Error('汇率数据里没有 CNY')
  }
  const out = { CNY: 1 }
  for (const c of SUPPORTED_CURRENCIES) {
    const key = c.code.toLowerCase()
    const perUsd = Number(usdRates[key])
    // 1 c = perUsd USD；1 USD = cnyPerUsd CNY
    // => 1 c = cnyPerUsd / perUsd CNY
    if (Number.isFinite(perUsd) && perUsd > 0) {
      out[c.code] = cnyPerUsd / perUsd
    }
  }
  return out
}

/* ------------------------------------------------------------- 缓存存取 */

/** setting 表的 key（最新一次成功拉取的全量汇率 + 日期） */
const RATE_CACHE_KEY = 'exchangeRateCache'

async function readRateCache() {
  try {
    return (await getSetting(RATE_CACHE_KEY)) || { rates: {}, day: '', source: '' }
  } catch (e) {
    return { rates: {}, day: '', source: '' }
  }
}

async function writeRateCache(cache) {
  try {
    await setSetting({ [RATE_CACHE_KEY]: cache })
  } catch (e) {}
}

/* ------------------------------------------------------------- 对外 API */

/**
 * 获取最新汇率（供手动面板「一键拉取」与开屏预取）
 *
 * 顺序：4 源降级 -> 全挂时用本地缓存 -> 都没有则抛错。
 * 成功后写 setting 缓存，并落 exchange_rate 表（今日一行/币种）。
 *
 * @returns {Promise<{rates: Object<string,number>, day: string, source: string, fromCache: boolean}>}
 *   rates: { USD: 7.24, JPY: 0.048, ... }（1 外币 = ? CNY，大写币种为 key）
 */
export async function fetchLatestRates() {
  let result = null
  try {
    const src = await fetchLatestRatesFromSources()
    result = {
      rates: ratesToCny(src.rates),
      day: toDayKey(),
      source: src.source
    }
    await writeRateCache(result)
  } catch (e) {
    // 全部源失败 -> 用缓存兜底
    const cache = await readRateCache()
    if (cache && cache.rates && Object.keys(cache.rates).length > 0) {
      console.warn('[rate] 所有汇率源失败，使用缓存（' + (cache.day || '?') + '）')
      return { rates: cache.rates, day: cache.day || '', source: cache.source || 'cache', fromCache: true }
    }
    throw e
  }

  // 落 exchange_rate 表（今日快照，供周期补记复用；失败不影响返回）
  try {
    await saveRatesForDay(result.day, result.rates, result.source)
  } catch (e) {
    console.warn('[rate] 汇率落表失败（不影响本次使用）:', e && e.message)
  }

  return { ...result, fromCache: false }
}

function toDayKey(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * 取某一天的汇率（周期补记按「发生日当天」口径用）
 *
 * 顺序：本地 exchange_rate 表 -> 历史接口（frankfurter 优先，
 * 失败用 fawazahmed0 日期快照）-> 落表复用。
 *
 * @param {string} day 'YYYY-MM-DD'
 * @param {string} currencyCode 大写币种代码
 * @returns {Promise<{rate:number, source:string}|null>} 1 外币 = ? CNY；取不到 null
 */
export async function getRateForDay(day, currencyCode) {
  const code = String(currencyCode || '').toUpperCase()
  if (!code || code === BASE_CURRENCY) return { rate: 1, source: 'base' }

  // 1) 本地 exchange_rate 表（同 day 同 currency）
  const stored = await getStoredRate(day, code)
  if (stored) return stored

  // 2) 历史接口
  const errors = []
  for (const getUrl of [historicalUrl, historicalUrlAlt]) {
    try {
      const data = await requestJson(getUrl(day, 'usd'))
      const rates = parseRates(getUrl === historicalUrl ? 'frankfurter' : 'fawazahmed0-hist', data)
      const cnyPerUsd = Number(rates && rates.cny)
      const perUsd = Number(rates && rates[code.toLowerCase()])
      if (!cnyPerUsd || !perUsd) throw new Error('响应缺 ' + code)
      const rate = cnyPerUsd / perUsd

      // 落表复用（同 day 同币种不再二次请求）
      await saveRatesForDay(day, { [code]: rate }, getUrl === historicalUrl ? 'frankfurter' : 'fawazahmed0-hist')
      return { rate, source: 'history' }
    } catch (e) {
      errors.push(e.message)
    }
  }
  console.warn(`[rate] ${day} ${code} 历史汇率获取失败：` + errors.join(' | '))
  return null
}

/**
 * 批量取多天汇率（周期补记一次缺口可能跨多天）
 * 去重后逐日取，全部走 getRateForDay 的缓存逻辑。
 * @returns {Promise<Object<string, {rate:number, source:string}>>} day -> rate
 */
export async function getRatesForDays(days, currencyCode) {
  const out = {}
  const uniq = [...new Set(days)]
  for (const day of uniq) {
    const r = await getRateForDay(day, currencyCode)
    if (r) out[day] = r
  }
  return out
}
