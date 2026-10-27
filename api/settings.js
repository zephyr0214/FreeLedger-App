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
    quickFallback: false      // 速记规则失败时是否走 AI 兜底
  },

  // 数据
  autoBackup: true,
  lastExportAt: 0
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
