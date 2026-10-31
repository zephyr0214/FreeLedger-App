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

  // AI —— 公共配置（两端共用：接口地址 / Key / 模型 / 超时）
  ai: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    /*
     * 超时默认 30 秒。
     *
     * ★ 为什么从 20 改成 30 ★
     *   深度思考模式下模型要先推演再回答，
     *   响应可能要十几秒甚至几十秒 —— 20 秒太紧，
     *   很容易出现「AI 请求超时」，用户还以为是自己网络不好。
     */
    timeoutMs: 30000
  },

  /**
   * AI 记账（速记解析）专属设置
   *
   * ★ 为什么和对话分开 ★
   *   两者诉求完全相反：
   *     · AI 记账：抽 JSON，要**稳定** —— temperature 固定 0、不思考
   *     · AI 对话：要**发散和透彻** —— 有自己的温度、开着深度思考
   *   以前共用一个 ai.temperature，调对话的滑块会顺手影响记账解析，
   *   调记账又会毁掉对话的发挥空间。
   *
   * ★ 迁移说明 ★
   *   旧版本只有 settings.ai.temperature（默认 0.3）。
   *   升级后老用户的这个值会被搬到 aiChat.temperature（见 migrateAiSettings），
   *   不会白白丢掉。
   */
  aiParse: {
    enabled: true
  },

  /**
   * AI 对话专属设置
   *
   * · temperature  对话用的采样随机性（固定 0.6，不再给用户滑块）
   * · deepThinking 深度思考开关
   * · maxTokens    单次回答的 token 上限（比记账宽松，回答更完整）
   * · showCharts   是否允许 AI 附图表
   */
  aiChat: {
    temperature: 0.6,
    deepThinking: true,
    maxTokens: 2000,
    showCharts: true
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

/**
 * ★ 旧版 AI 设置的迁移 ★
 *
 * 旧版本只有 settings.ai 一个对象，里面带着 temperature / quickFallback。
 * 现在拆成了：
 *   settings.ai      公共（baseUrl / apiKey / model / timeoutMs）
 *   settings.aiChat  对话专属（temperature / deepThinking / maxTokens / showCharts）
 *   settings.aiParse 记账专属
 *
 * 迁移规则：
 *   1. ai.temperature → aiChat.temperature（老用户调过的值不丢）
 *      —— 只有当 aiChat 里还没有 temperature 时才搬，
 *         避免每次读设置都把新值覆盖回旧值。
 *   2. ai.quickFallback 是废弃字段（无任何调用方），直接丢掉。
 *   3. ai 里多余的键不写回去，保持结构干净。
 *
 * @param {object} settings getAllSettings 组装出来的对象
 * @returns {object} 同一个对象（原地改）
 */
function migrateAiSettings(settings, rawChat) {
  const ai = settings.ai || {}
  const legacyTemp = ai.temperature

  // 1. 旧的 temperature 搬到 aiChat
  //    ★ 要看「库里原样存的 aiChat」，不能用合并后的值 ★
  //      合并后 temperature 一定有默认值（0.6），
  //      那样就永远判定不了「老用户从没设过」，迁移也就永远不会发生。
  //    ★ 用 hasOwnProperty 判断「有没有这一项」★
  //      不能只判 rawTemp === undefined：
  //      万一用户显式存了 temperature: undefined，
  //      会被当成「没设过」而被旧值覆盖。
  const hasOwnTemp = !!(rawChat && typeof rawChat === 'object') &&
    Object.prototype.hasOwnProperty.call(rawChat, 'temperature')

  if (
    legacyTemp !== undefined &&
    legacyTemp !== null &&
    !hasOwnTemp
  ) {
    settings.aiChat = { ...settings.aiChat, temperature: Number(legacyTemp) }
  }

  // 2. ai 只保留公共字段
  const cleanAi = {}
  for (const k of ['baseUrl', 'apiKey', 'model', 'timeoutMs']) {
    if (ai[k] !== undefined) cleanAi[k] = ai[k]
  }
  settings.ai = { ...DEFAULT_SETTINGS.ai, ...cleanAi }

  return settings
}

/** 读全部设置（含默认值合并） */
export async function getAllSettings() {
  const rows = await query('SELECT key, value FROM setting')
  const out = { ...DEFAULT_SETTINGS }

  /*
   * ★ 记下「库里原样存了什么」★
   *   out 一开始就带上了 DEFAULT_SETTINGS，
   *   所以 out.aiChat.temperature 永远是 0.6 ——
   *   分不出「老用户没设过」和「老用户就想要 0.6」。
   *   迁移必须看**数据库里到底存没存这一条**，
   *   所以单独用 raw 记下原始值。
   */
  const raw = {}

  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value)
      raw[row.key] = out[row.key]
    } catch (e) {
      out[row.key] = row.value
      raw[row.key] = row.value
    }
    CACHE[row.key] = out[row.key]
  }

  // 对象型字段做浅合并，防止旧版本缺少新字段
  out.ai = { ...DEFAULT_SETTINGS.ai, ...(out.ai || {}) }
  out.aiChat = { ...DEFAULT_SETTINGS.aiChat, ...(out.aiChat || {}) }
  out.aiParse = { ...DEFAULT_SETTINGS.aiParse, ...(out.aiParse || {}) }
  // 旧版 ai.temperature 迁移到 aiChat.temperature
  migrateAiSettings(out, raw.aiChat)
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




