/**
 * 设置读写 —— 全部存 setting 表（KV），值序列化为 JSON
 *
 * 为什么不用 uni.setStorageSync：
 *   备份时要求"设置也一起存"，存 SQLite 可以一次 SELECT 全带走，
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
   * 悬浮「+」按钮的行为
   *   quickAddHoldAction 长按触发什么：ai | manual | none
   *   quickAddTapAction  短按触发什么：ai | manual | none
   *
   * 默认值 = 改动前的行为（长按打开手动记账面板、短按打开 AI 速记），
   * 这样老用户升级后行为不变。
   */
  quickAddHoldAction: 'manual',
  quickAddTapAction: 'ai',

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
  lastBackupAt: 0
}

/**
 * 悬浮「+」按钮的触发方式
 *
 * ai     → 打开 AI 速记（QuickAddBar）
 * manual → 打开传统手动记账面板（TxnPanel）
 * none   → 不响应
 */
export const QUICK_ADD_ACTIONS = [
  { key: 'ai', name: 'AI 速记' },
  { key: 'manual', name: '手动记账' },
  { key: 'none', name: '不响应' }
]

/** 合法的触发方式 */
const QUICK_ADD_ACTION_KEYS = QUICK_ADD_ACTIONS.map((a) => a.key)

/**
 * 把存进库的触发方式归一化
 *
 * 库里存的是字符串，值可能来自旧版本或手工改库，
 * 这里统一兜底成合法值（非法的一律回落到 'ai'）。
 *
 * @param {any} raw
 * @param {string} fallback 非法时的默认值
 * @returns {string} ai | manual | none
 */
export function normalizeQuickAddAction(raw, fallback = 'ai') {
  const v = String(raw || '').trim()
  if (QUICK_ADD_ACTION_KEYS.includes(v)) return v
  return QUICK_ADD_ACTION_KEYS.includes(fallback) ? fallback : 'ai'
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




