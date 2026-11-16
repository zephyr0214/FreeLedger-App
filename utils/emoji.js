/**
 * 分类图标 —— 元数据索引、三种联网样式、旧 key 兼容
 *
 * ★ 图标图片不随包下载 ★
 *   用户在「我的 → 主题外观」里选样式，运行时按码点拼对应 CDN：
 *     noto     https://fonts.gstatic.com/s/e/notoemoji/latest/...
 *     twemoji  https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/...
 *     openmoji https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@15.1.0/color/...
 *   选择页缩略图用 60 档，分类列表 / 流水图标用 120 档。
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

/**
 * 三种图标样式（与 haoemoji.com 的样式选择一致）
 *
 * 系统样式和 Noto 在 Android 上看不出差别，已去掉；
 * 三种样式都按需从各自 CDN 加载。
 */
export const EMOJI_STYLES = [
  { key: 'noto', name: 'Noto Color Emoji', desc: '(Android)' },
  { key: 'twemoji', name: 'Twemoji', desc: '(Twitter)' },
  { key: 'openmoji', name: 'OpenMoji', desc: '开源彩色图标' }
]

/** 把设置里的样式 key 归一（非法值 / 旧 system 退回 Noto） */
export function normalizeEmojiStyle(key) {
  const raw = String(key || '').trim()
  return EMOJI_STYLES.some((s) => s.key === raw) ? raw : 'noto'
}

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
 * 码点 -> 指定样式的联网图片地址
 *
 * @param {string} code 码点（大小写 / FE0F 都会规范化）
 * @param {number} size 60 档（缩略图）或 120 档（列表 / 详情）
 * @param {string} style noto | twemoji | openmoji
 * @returns {string}
 */
export function emojiImageSrc(code, size = 120, style = 'noto') {
  let hex = toEmojiIconCode(code)
  if (!hex || !META.has(hex)) hex = FALLBACK_EMOJI_CODE

  const st = normalizeEmojiStyle(style)

  const small = Number(size) <= 60
  const lower = hex.toLowerCase()

  if (st === 'noto') {
    // Google Noto Color Emoji：1f415_200d_1f9ba / 72.png | 128.png
    return `https://fonts.gstatic.com/s/e/notoemoji/latest/${lower.replace(/-/g, '_')}/${small ? 72 : 128}.png`
  }

  if (st === 'twemoji') {
    // Twemoji（jdecked 维护的 15.1 分支，覆盖到较新的 emoji）：1f415-200d-1f9ba.svg
    return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${lower}.svg`
  }

  // OpenMoji 15.1：文件名是 1F415-200D-1F9BA.png
  /*
   * ★ 用 PNG，不用 SVG（用户反馈暗色模式是白色描边）★
   *   OpenMoji 的彩色图标本身是**黑色描边**；但 Android 的 <image>
   *   对远程 SVG 的支持不稳定，加载失败后会回退系统 emoji（Noto），
   *   而 Noto 的图标带白色描边 —— 用户看到的就是「OpenMoji 变成白描边」。
   *   改用 OpenMoji 官方 PNG：黑色描边是图片本身画好的，不依赖 SVG 渲染。
   *   缩略图用 72×72，列表 / 详情用 618×618（高清屏不糊）。
   */
  return small
    ? `https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@15.1.0/color/72x72/${hex}.png`
    : `https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@15.1.0/color/618x618/${hex}.png`
}

/**
 * OpenMoji 的「纯描边」图层地址（暗色模式用）
 *
 * ★ 为什么需要第二个 URL ★
 *   OpenMoji 彩色 PNG 的描边是黑色的，暗色背景上太硬；
 *   但官方没有「灰色描边」版本。black/ 目录是纯黑线稿，
 *   把它叠在彩色图上再做 invert 滤镜，就能只把描边变灰、
 *   保留彩色填充（见 CategoryGlyph）。
 *
 * @param {string} code 码点
 * @param {number} size 60 档 / 120 档
 * @returns {string}
 */
export function emojiOutlineSrc(code, size = 120) {
  let hex = toEmojiIconCode(code)
  if (!hex || !META.has(hex)) hex = FALLBACK_EMOJI_CODE
  const small = Number(size) <= 60
  return small
    ? `https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@15.1.0/black/72x72/${hex}.png`
    : `https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@15.1.0/black/618x618/${hex}.png`
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

/** 分类图标 -> 指定样式的联网图片地址 */
export function categoryIconSrc(icon, name = '', size = 120, style = 'noto') {
  return emojiImageSrc(categoryIconCode(icon, name), size, style)
}
