/**
 * 设置读写 —— 全部存 setting 表（KV），值序列化为 JSON
 *
 * 为什么不用 uni.setStorageSync：
 *   导出 JSON 时要求"设置也一起导出"，存 SQLite 可以一次 SELECT 全带走，
 *   并且和账户/交易在同一个事务里保持一致。
 */

import { query, execute, transaction } from './db/index.js'

export const DEFAULT_SETTINGS = {
  // 个人信息
  nickname: '',
  avatar: '',
  signature: '',

  // 记账
  defaultAccountId: '',
  monthStartDay: 1,
  currencySymbol: '¥',
  firstRunDone: false,

  /**
   * 周期性固定支出列表
   * 结构见 normalizeCycle()：
   *   { id, name, amountCents, icon, cycleType, interval,
   *     dayOfMonth, weekday, nextDate, accountId, enabled, note }
   */
  cycles: [],

  // 外观
  themeMode: 'system',        // system | light | dark
  themePreset: 'green',
  privacyMode: false,         // 金额脱敏

  // AI
  ai: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.3,
    timeoutMs: 20000,
    quickFallback: false      // ⚠️ 已废弃：无任何调用方，UI 入口已删除（见 api/ai.js 的说明）
  },

  // 数据
  autoBackup: true,
  lastExportAt: 0
}

/**
 * 周期类型 —— 周期性固定支出的扣款频率
 *
 * monthly 每月固定几号
 * weekly  每周固定星期几
 * yearly  每年固定几月几号
 * custom  自定义间隔（如每 2 个月）
 */
export const CYCLE_TYPES = [
  { key: 'monthly', name: '每月' },
  { key: 'weekly', name: '每周' },
  { key: 'yearly', name: '每年' },
  { key: 'custom', name: '自定义' }
]

/** 周期类型的取值集合（用于校验） */
const CYCLE_TYPE_KEYS = CYCLE_TYPES.map((t) => t.key)

/**
 * 周期数据结构的规范化 + 校验
 *
 * 存进 settings 的是 JSON 数组，每项结构：
 *   {
 *     id:          'cyc_xxx',   // 稳定 id
 *     name:        '房租',       // 名称
 *     amountCents: 350000,      // 金额（整数分）
 *     icon:        '🏠',        // emoji 或 icon key
 *     cycleType:   'monthly',   // monthly | weekly | yearly | custom
 *     interval:    1,           // 自定义时的间隔数（配合 cycleType='custom'）
 *     dayOfMonth:  8,           // 每月几号扣（monthly / yearly 时用）
 *     monthOfYear: 1,           // 每年几月扣（yearly 时用，1-12）
 *     weekday:     1,           // 星期几（weekly 时用，1-7）
 *     nextDate:    '2026-11-08',// 下次扣款日 YYYY-MM-DD
 *     accountId:   'acc_xxx',   // 从哪个账户扣（可选）
 *     enabled:     true,        // 是否启用
 *     note:        '每月 8 号交' // 备注
 *   }
 *
 * @param {object} raw
 * @returns {object|null} 合法则返回规范化的对象，非法返回 null
 */
export function normalizeCycle(raw) {
  if (!raw || typeof raw !== 'object') return null

  const name = String(raw.name || '').trim()
  if (!name) return null

  const cycleType = CYCLE_TYPE_KEYS.includes(raw.cycleType) ? raw.cycleType : 'monthly'

  const amountCents = Math.max(0, Math.round(Number(raw.amountCents) || 0))

  let interval = Number(raw.interval)
  if (!Number.isFinite(interval)) interval = 1
  interval = Math.min(Math.max(Math.round(interval), 1), 365)

  let dayOfMonth = Number(raw.dayOfMonth)
  if (!Number.isFinite(dayOfMonth)) dayOfMonth = 1
  dayOfMonth = Math.min(Math.max(Math.round(dayOfMonth), 1), 31)

  let monthOfYear = Number(raw.monthOfYear)
  if (!Number.isFinite(monthOfYear)) monthOfYear = 1
  monthOfYear = Math.min(Math.max(Math.round(monthOfYear), 1), 12)

  let weekday = Number(raw.weekday)
  if (!Number.isFinite(weekday)) weekday = 1
  weekday = Math.min(Math.max(Math.round(weekday), 1), 7)

  // 下次扣款日：只认 YYYY-MM-DD
  const nextDateRaw = String(raw.nextDate || '').trim()
  const nextDate = /^\d{4}-\d{2}-\d{2}$/.test(nextDateRaw) ? nextDateRaw : ''

  return {
    id: String(raw.id || ''),
    name,
    amountCents,
    icon: String(raw.icon || '').trim(),
    cycleType,
    interval,
    dayOfMonth,
    monthOfYear,
    weekday,
    nextDate,
    accountId: String(raw.accountId || '').trim(),
    enabled: raw.enabled !== false,
    note: String(raw.note || '').trim()
  }
}

/**
 * 读全部周期
 * @returns {Array<object>}
 */
export async function getCycles() {
  const raw = await getSetting('cycles', [])
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    const c = normalizeCycle(item)
    if (c) out.push(c)
  }
  return out
}

/**
 * 写全部周期（整体覆盖）
 * @param {Array<object>} cycles
 */
export async function setCycles(cycles) {
  const list = Array.isArray(cycles) ? cycles : []
  const clean = []
  for (const item of list) {
    const c = normalizeCycle(item)
    if (c) clean.push(c)
  }
  await setSetting('cycles', clean)
  return clean
}

const CACHE = {}

/** 读全部设置（含默认值合并） */
export async function getAllSettings() {
  const rows = await query('SELECT key, value FROM setting')
  const out = { ...DEFAULT_SETTINGS }
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value)
    } catch (e) {
      out[row.key] = row.value
    }
    CACHE[row.key] = out[row.key]
  }
  // 对象型字段做浅合并，防止旧版本缺少新字段
  out.ai = { ...DEFAULT_SETTINGS.ai, ...(out.ai || {}) }
  // 周期是数组型字段：旧数据可能存成 null / 非数组，这里做数组兜底
  out.cycles = Array.isArray(out.cycles) ? out.cycles : []
  return out
}

/** 读单项 */
export async function getSetting(key, fallback) {
  if (Object.prototype.hasOwnProperty.call(CACHE, key)) return CACHE[key]
  const rows = await query('SELECT value FROM setting WHERE key = ?', [key])
  if (rows.length === 0) return fallback !== undefined ? fallback : DEFAULT_SETTINGS[key]
  try {
    const v = JSON.parse(rows[0].value)
    CACHE[key] = v
    return v
  } catch (e) {
    return rows[0].value
  }
}

/** 写单项（先删后插，兼容旧 SQLite 内核的 upsert 语法差异） */
export async function setSetting(key, value) {
  const serialized = JSON.stringify(value === undefined ? null : value)
  await execute('DELETE FROM setting WHERE key = ?', [key])
  await execute('INSERT INTO setting (key, value) VALUES (?, ?)', [key, serialized])
  CACHE[key] = value
  return true
}

/**
 * 批量写。
 * 注意：部分 SQLite 内核不支持 ON CONFLICT DO UPDATE，因此退化为先删后插。
 */
export async function setSettings(patch) {
  return transaction(async () => {
    for (const [key, value] of Object.entries(patch)) {
      await execute('DELETE FROM setting WHERE key = ?', [key])
      await execute('INSERT INTO setting (key, value) VALUES (?, ?)', [
        key,
        JSON.stringify(value === undefined ? null : value)
      ])
      CACHE[key] = value
    }
  })
}

/** 清缓存（导入后必须调用，否则读到旧值） */
export function clearSettingsCache() {
  Object.keys(CACHE).forEach((k) => delete CACHE[k])
}

/* ------------------------------------------------------------- app_meta */

export async function getMeta(key, fallback = null) {
  const rows = await query('SELECT value FROM app_meta WHERE key = ?', [key])
  if (rows.length === 0) return fallback
  try {
    return JSON.parse(rows[0].value)
  } catch (e) {
    return rows[0].value
  }
}

export async function setMeta(key, value) {
  await execute('DELETE FROM app_meta WHERE key = ?', [key])
  await execute('INSERT INTO app_meta (key, value) VALUES (?, ?)', [key, JSON.stringify(value)])
  return true
}
