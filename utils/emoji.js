/**
 * Emojiall 分类图标 —— 元数据索引、联网图片地址、旧 key 兼容
 *
 * ★ 图标图片不随包下载 ★
 *   运行时按码点拼 Emojiall 的 CDN 地址：
 *     https://www.emojiall.com/images/{60|120}/apple/<小写码点>.png
 *   选择页缩略图用 60，分类列表 / 流水图标用 120。
 *   图片由系统 HTTP 缓存复用，安装包不增加图片体积。
 *
 * ★ 数据范围 ★
 *   只有五个大类：动物与自然 / 食物与饮料 / 旅行与地点 / 活动 / 物品
 *   共 49 个二级分类、836 个图标（utils/emojiData.js 生成）。
 *
 * ★ 显示兜底链 ★
 *   1. icon 本身是五组内的合法码点 → 用它
 *   2. icon 是旧 key（food / car…）→ 查 utils/emojiLegacy.js
 *   3. icon 为空/未知 → 按分类名猜旧 key，再查表
 *   4. 都失败 → 包裹（1F4E6）
 *
 * ★ 网络失败兜底 ★
 *   CategoryGlyph 在图片加载成功前 / 失败后显示系统 emoji 字符，
 *   所以断网时分类图标退化成系统 emoji，记账查账不受影响。
 */

import { EMOJI_GROUPS } from './emojiData.js'
import { LEGACY_ICON_CODES, toEmojiIconCode } from './emojiLegacy.js'
import { guessIconKeyByName } from './icons.js'

export { EMOJI_GROUPS, LEGACY_ICON_CODES }

/** 兜底图标：包裹（「其他」） */
export const FALLBACK_EMOJI_CODE = '1F4E6'

/** Emojiall 图片 CDN 根路径 */
export const EMOJI_IMAGE_BASE = 'https://www.emojiall.com/images'

/** 码点 -> 元数据（扁平索引） */
const META = new Map()

/**
 * 全部图标（扁平表）
 *
 * 每项：{ hex, name, char, group, groupName, subgroup, subgroupName, search }
 * search 是搜索用的预拼接小写串（中文名 / 分组 / 二级分类 / 码点）。
 */
export const EMOJI_LIST = []

for (const g of EMOJI_GROUPS) {
  for (const sg of g.subgroups) {
    for (const [hex, name, char] of sg.icons) {
      const item = {
        hex,
        name,
        char,
        group: g.key,
        groupName: g.name,
        subgroup: sg.key,
        subgroupName: sg.name,
        search: `${hex} ${name} ${g.name} ${sg.name} ${char}`.toLowerCase()
      }
      META.set(hex, item)
      EMOJI_LIST.push(item)
    }
  }
}

/** 这个字符串本身是不是五组内的一个码点（旧 key 不算） */
export function isEmojiCode(code) {
  const raw = String(code === undefined || code === null ? '' : code).trim()
  if (!/^[0-9A-F]+(?:-[0-9A-F]+)*$/i.test(raw)) return false
  return META.has(toEmojiIconCode(raw))
}

/**
 * 码点 -> Emojiall 图片地址
 *
 * @param {string} code 码点（大小写 / FE0F 都会规范化）
 * @param {number} size 60 或 120（其他值按 120 处理）
 * @returns {string}
 */
export function emojiImageSrc(code, size = 120) {
  let hex = toEmojiIconCode(code)
  if (!hex || !META.has(hex)) hex = FALLBACK_EMOJI_CODE
  const bucket = Number(size) <= 60 ? 60 : 120
  return `${EMOJI_IMAGE_BASE}/${bucket}/apple/${hex.toLowerCase()}.png`
}

/** 码点 -> 系统 emoji 字符（图片加载中 / 失败时的兜底） */
export function emojiChar(code) {
  const hex = toEmojiIconCode(code) || FALLBACK_EMOJI_CODE
  const meta = META.get(hex)
  if (meta && meta.char) return meta.char

  // 元数据里没有时按码点还原（老数据 / 五组之外的码点）
  try {
    return hex
      .split('-')
      .map((h) => String.fromCodePoint(parseInt(h, 16)))
      .join('')
  } catch (e) {
    return '📦'
  }
}

/** 取元数据（不存在返回 null） */
export function emojiMeta(code) {
  return META.get(toEmojiIconCode(code)) || null
}

/** 图标中文名（不存在返回空串） */
export function emojiLabel(code) {
  const meta = emojiMeta(code)
  return meta ? meta.name : ''
}

/** 分类图标 -> 最终码点（永远返回五组内存在的码点） */
export function categoryIconCode(icon, name = '') {
  const direct = toEmojiIconCode(icon)
  if (direct && META.has(direct)) return direct

  const guessed = toEmojiIconCode(guessIconKeyByName(name))
  if (guessed && META.has(guessed)) return guessed

  return FALLBACK_EMOJI_CODE
}

/** 分类图标 -> 联网图片地址 */
export function categoryIconSrc(icon, name = '', size = 120) {
  return emojiImageSrc(categoryIconCode(icon, name), size)
}
