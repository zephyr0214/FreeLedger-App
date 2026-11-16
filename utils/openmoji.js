/**
 * OpenMoji 分类图标 —— 运行时解析、路径、元数据
 *
 * ★ 数据从哪来 ★
 *   static/openmoji/ 下是 OpenMoji 彩色 SVG（867 个，只保留五组，CC BY-SA 4.0）；
 *   utils/openmojiData.js 是由 scripts/gen-openmoji.mjs 生成的元数据
 *   （码点 / 英文名 / 分组 / 搜索关键词 / 中文名）。
 *
 * ★ icon 字段存什么 ★
 *   分类表 category.icon 现在存 **OpenMoji 码点**（如 `1F35C`），
 *   旧版本存的语义 key（`food` / `car`…）由 utils/openmojiLegacy.js
 *   兼容，v24 迁移会把老数据统一改写成码点。
 *
 * ★ 显示兜底链 ★
 *   1. icon 本身是合法码点 → 用它
 *   2. icon 是旧 key → 查表
 *   3. icon 为空/未知 → 按分类名猜旧 key，再查表
 *   4. 都失败 → 包裹图标（1F4E6）
 */

import { OPENMOJI_GROUPS, OPENMOJI_ICONS } from './openmojiData.js'
import { toOpenmojiIconCode, LEGACY_ICON_CODES } from './openmojiLegacy.js'
import { guessIconKeyByName } from './icons.js'

export { OPENMOJI_GROUPS, OPENMOJI_ICONS, LEGACY_ICON_CODES }

/** 兜底图标：包裹（「其他」） */
export const FALLBACK_OPENMOJI_CODE = '1F4E6'

/** 全部合法码点 */
const HEX_SET = new Set(OPENMOJI_ICONS.map((r) => r[0]))

/** 码点 -> 元数据对象（给选择器显示名称 / 分组用） */
const META = new Map(
  OPENMOJI_ICONS.map(([hex, name, group, subgroup, tags, zh]) => [
    hex,
    { hex, name, group, subgroup, tags, zh }
  ])
)

/** 分组 key -> 中文名 */
const GROUP_NAMES = {}
for (const g of OPENMOJI_GROUPS) GROUP_NAMES[g.key] = g.name

/** 这个字符串是不是一个真实存在的 OpenMoji 码点 */
export function isOpenmojiCode(code) {
  return HEX_SET.has(String(code || '').toUpperCase())
}

/** 分类图标 -> 最终码点（永远返回一个存在的码点） */
export function categoryIconCode(icon, name = '') {
  const direct = toOpenmojiIconCode(icon)
  if (direct && HEX_SET.has(direct)) return direct

  const guessed = toOpenmojiIconCode(guessIconKeyByName(name))
  if (guessed && HEX_SET.has(guessed)) return guessed

  return FALLBACK_OPENMOJI_CODE
}

/**
 * 码点 -> static 路径
 *
 * ★ 为什么是 /static 绝对路径 ★
 *   App 端打包后静态资源在 _www/static 下，`/static/...` 是 uni-app
 *   约定的根路径；页面和组件里都能直接用，不依赖当前页面层级。
 */
export function openmojiSrc(code) {
  const hex = String(code || '').toUpperCase()
  if (!HEX_SET.has(hex)) return `/static/openmoji/${FALLBACK_OPENMOJI_CODE}.svg`
  return `/static/openmoji/${hex}.svg`
}

/** 分类图标直接出 src（含旧 key / 按名字猜的兜底） */
export function categoryIconSrc(icon, name = '') {
  return openmojiSrc(categoryIconCode(icon, name))
}

/** 取元数据（不存在返回 null） */
export function openmojiMeta(code) {
  return META.get(String(code || '').toUpperCase()) || null
}

/** 图标显示名：优先中文名，其次英文名 */
export function openmojiLabel(code) {
  const meta = openmojiMeta(code)
  if (!meta) return ''
  return meta.zh || meta.name
}

/** 分组中文名 */
export function openmojiGroupName(groupKey) {
  return GROUP_NAMES[groupKey] || groupKey
}
