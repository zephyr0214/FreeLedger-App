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

/** 汇率表保留天数（用户指定 30 天） */
export const RATE_RETAIN_DAYS = 30

/**
 * 清理过期的汇率历史
 *
 * ★ 为什么必须清 ★
 *   汇率表是**按天 × 币种**存的：每天 16 个币种。
 *   而 fetchLatestRates() 每次打开记账面板都会落一份当日快照，
 *   周期补记还会按天写入历史汇率 ——
 *   不清的话一年就是 16 × 365 ≈ 5,840 行，十年 5.8 万行。
 *   虽然这点数据量不致命（有主键索引、查询仍是毫秒级），
 *   但它是纯缓存性质的数据，留着没有价值：
 *   99% 的日期用户根本没有外币交易。
 *
 * ★ 清理会不会丢账？不会 ★
 *   真正的汇率快照存在 txn.exchange_rate 里，跟着交易永久保存。
 *   这张表只是「历史查询缓存」，删了只影响
 *   「30 天以前的老周期补记时能否按当天汇率折算」——
 *   那种情况会退回按人民币记录并写日志，不影响已有账目。
 *
 * ★ 为什么是 30 天 ★
 *   用户指定。记账场景里需要回溯的历史汇率基本都在这个窗口内
 *   （周期补记最多补最近几个月的漏记，30 天覆盖绝大多数情况）。
 *
 * @param {string} today 今天的 YYYY-MM-DD（用于日志与边界计算）
 * @returns {Promise<number>} 删掉的行数
 */
export async function pruneOldRates(today) {
  try {
    /*
     * 用 SQLite 的 date() 算边界：
     *   date(?, '-30 days') 比在 JS 里算日期更稳（不受时区/夏令时影响），
     *   而且这是「按天字符串比较」——库里的 day 是 'YYYY-MM-DD'，
     *   字典序与时间序一致，直接 < 比较即可。
     */
    const rows = await query(
      'SELECT COUNT(*) AS c FROM exchange_rate WHERE day < date(?, ?)',
      [today, `-${RATE_RETAIN_DAYS} days`]
    )
    const n = Number((rows && rows[0] && rows[0].c) || 0)
    if (n === 0) return 0

    await execute(
      'DELETE FROM exchange_rate WHERE day < date(?, ?)',
      [today, `-${RATE_RETAIN_DAYS} days`]
    )
    console.log(`[rate] 清理过期汇率 ${n} 行（保留最近 ${RATE_RETAIN_DAYS} 天）`)
    return n
  } catch (e) {
    // 清理失败不能影响任何功能 —— 它是纯维护任务
    console.warn('[rate] 清理过期汇率失败:', e && e.message)
    return 0
  }
}
