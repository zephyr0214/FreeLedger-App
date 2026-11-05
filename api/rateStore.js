/**
 * 汇率历史表的读写封装
 *
 * 拆出独立文件的原因：exchangeRate.js 是网络聚合层，
 * 表操作被 cycle 补记等多处复用 —— 单独成文件避免环依赖。
 *
 * 走 db/index.js 的 query/execute 门面（与 cycle.js 等业务层一致）；
 * 迁移内部才需要底层 call()（那里在 openDb 流程中，走门面会死锁），
 * 本文件的调用时机都在 openDb 完成之后，没有这个限制。
 */

import { query, execute } from './db/index.js'

/** 读某天某币种的汇率（1 外币 = ? CNY） */
export async function getStoredRate(day, currency) {
  try {
    const rows = await query(
      'SELECT rate, source FROM exchange_rate WHERE day = ? AND currency = ?',
      [day, currency]
    )
    if (Array.isArray(rows) && rows.length > 0) {
      return { rate: Number(rows[0].rate), source: rows[0].source || 'table' }
    }
    return null
  } catch (e) {
    console.warn('[rate] 读汇率表失败:', e && e.message)
    return null
  }
}

/** 写入某天某币种的汇率快照（INSERT OR REPLACE，幂等） */
export async function saveRatesForDay(day, ratesByCurrency, source) {
  try {
    const now = Date.now()
    for (const code of Object.keys(ratesByCurrency)) {
      const rate = Number(ratesByCurrency[code])
      if (!Number.isFinite(rate) || rate <= 0) continue
      await execute(
        'INSERT OR REPLACE INTO exchange_rate (day, currency, rate, source, fetched_at) VALUES (?,?,?,?,?)',
        [day, code, rate, source, now]
      )
    }
    return true
  } catch (e) {
    console.warn('[rate] 汇率落表失败:', e && e.message)
    return false
  }
}

/** 读某天全部币种的汇率（调试/展示用） */
export async function getDayRates(day) {
  try {
    const rows = await query(
      'SELECT currency, rate, source FROM exchange_rate WHERE day = ?',
      [day]
    )
    const out = {}
    for (const r of Array.isArray(rows) ? rows : []) {
      out[r.currency] = { rate: Number(r.rate), source: r.source }
    }
    return out
  } catch (e) {
    console.warn('[rate] 读当日汇率失败:', e && e.message)
    return {}
  }
}
