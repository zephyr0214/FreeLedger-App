/**
 * 分类图标 —— 元数据索引、五种联网样式、旧 key 兼容
 *
 * ★ 图标图片不随包下载 ★
 *   用户在「我的 → 主题外观」里选样式，运行时按码点拼对应 CDN：
 *     noto     https://fonts.gstatic.com/s/e/notoemoji/latest/...
 *     twemoji  https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/...
 *     openmoji https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@17.0.0/color/svg/...
 *     fluent   https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@.../assets/.../Flat/...svg
 *   选择页缩略图用 60 档，分类列表 / 流水图标用 120 档。
 *
 * ★ 数据范围 ★
 *   六大类：人物与身体（职业与角色 / 奇幻人物 / 人物活动 / 运动中的人 / 人物休息）
 *   + 动物与自然 / 食物与饮料 / 旅行与地点 / 活动 / 物品
 *   共 54 个二级分类、1037 个图标（utils/emojiData.js 生成）。
 *
 * ★ 显示兜底链 ★
 *   1. icon 本身是六组内的合法码点 → 用它
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
import { FLUENT_BASE, FLUENT_MAP } from './fluentEmojiMap.js'
import { FE0F_VARIANT_CODES } from './emojiAssetCodes.js'

export { EMOJI_GROUPS, LEGACY_ICON_CODES }

/** 兜底图标：包裹（「其他」） */
export const FALLBACK_EMOJI_CODE = '1F4E6'

/**
 * 五种图标样式
 *
 * 系统样式和 Noto 在 Android 上看不出差别，已去掉；
 * 五种样式都按需从各自 CDN 加载，不打包进 APK。
 *
 * ★ 格式按加载速度选 ★
 *   Noto       128×128 PNG（官方 CDN 快、体积小）
 *   Twemoji    SVG（约 3.5KB）
 *   OpenMoji   SVG（官方没有 128 PNG，72 太小、618 太大）
 *   Fluent     Flat SVG（约 1–2KB）
 *   Fluent 3D  256 PNG（约 28–35KB，加载较慢，提供本地缓存）
 *
 * Fluent 覆盖全部 1037 个图标，不需要缺失回退。
 */
export const EMOJI_STYLES = [
  { key: 'noto', name: 'Noto Color Emoji', desc: '(Android)' },
  { key: 'twemoji', name: 'Twemoji', desc: '(Twitter)' },
  { key: 'openmoji', name: 'OpenMoji', desc: '开源彩色图标' },
  { key: 'fluent', name: 'Microsoft Fluent', desc: '微软扁平图标' },
  { key: 'fluent3d', name: 'Microsoft Fluent 3D', desc: '加载速度较慢' }
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

/** 这个字符串本身是不是六组内的一个码点（旧 key 不算） */
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
 * @param {string} style noto | twemoji | openmoji | fluent | fluent3d
 * @returns {string}
 */
export function emojiImageSrc(code, size = 120, style = 'noto') {
  let hex = toEmojiIconCode(code)
  if (!hex || !META.has(hex)) hex = FALLBACK_EMOJI_CODE

  const st = normalizeEmojiStyle(style)

  const small = Number(size) <= 60
  /** Twemoji / OpenMoji 有 88 个人物组合必须带 FE0F，否则 CDN 404 */
  const assetCode = FE0F_VARIANT_CODES[hex] || hex

  /** Noto 官方 CDN：72 / 128 PNG（也是 Fluent 缺图标时的兜底） */
  const notoUrl = () => {
    const lower = hex.toLowerCase()
    return `https://fonts.gstatic.com/s/e/notoemoji/latest/${lower.replace(/-/g, '_')}/${small ? 72 : 128}.png`
  }

  if (st === 'noto') return notoUrl()

  if (st === 'twemoji') {
    // Twemoji（jdecked 维护的 17.0 分支，覆盖到较新的 emoji）：1f415-200d-1f9ba.svg
    return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/${assetCode.toLowerCase()}.svg`
  }

  if (st === 'fluent') {
    /*
     * Microsoft Fluent Emoji：Flat SVG，单张约 1–2KB。
     * 3D PNG 单张约 28KB，Color SVG 约 15KB，Flat 是加载最快的。
     * 元数据来自 fluentemoji.com，路径按英文名存放，所以用静态映射表。
     */
    const path = FLUENT_MAP[hex]
    return path ? FLUENT_BASE + encodeURI(path) : notoUrl()
  }

  if (st === 'fluent3d') {
    /*
     * Microsoft Fluent 3D：256×256 PNG，单张约 28–35KB，明显更重。
     * 只给愿意接受较慢加载的用户使用；本地缓存会把它也缓存下来。
     * 3D 路径可由 Flat 路径推导：
     *   .../Flat/xxx_flat.svg -> .../3D/xxx_3d.png
     *   .../Default/Flat/xxx_flat_default.svg -> .../Default/3D/xxx_3d_default.png
     */
    const flat = FLUENT_MAP[hex]
    if (!flat) return notoUrl()
    const png = flat.replace('/Flat/', '/3D/').replace(/_flat([^/]*)\.svg$/i, '_3d$1.png')
    return FLUENT_BASE + encodeURI(png)
  }

  /*
   * OpenMoji 17.0：1F415-200D-1F9BA.svg
   *
   * ★ 用 SVG，不用 PNG ★
   *   OpenMoji 官方只有 72×72 和 618×618 两档 PNG：
   *   72 太小、618 太大，列表里十几张 618 PNG 解码很慢。
   *   SVG 只有约 2KB，且矢量可缩放，小图标和大图都清晰；
   *   Twemoji 也走 SVG，Android <image> 能正常渲染。
   *   尺寸档对 SVG 不生效，统一返回同一个矢量地址。
   */
  return `https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@17.0.0/color/svg/${assetCode}.svg`
}

/** 码点 -> 系统 emoji 字符（图片加载中 / 失败时的兜底） */
export function emojiChar(code) {
  const hex = toEmojiIconCode(code) || FALLBACK_EMOJI_CODE
  const meta = META.get(hex)
  if (meta && meta.char) return meta.char

  // 元数据里没有时按码点还原（老数据 / 六组之外的码点）
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

/** 分类图标 -> 最终码点（永远返回六组内存在的码点） */
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
