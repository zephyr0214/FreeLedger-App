/**
 * 图标库加载状态 —— 判断"这一套样式整体是不是加载不出来"
 *
 * ★ 为什么需要它 ★
 *   用户要求：图标选择页刚进去时不要一屏系统 emoji 乱跳，
 *   图片没加载出来就先留空；但如果**一个都没加载出来**（断网 / CDN 挂了），
 *   就整页回退成系统 emoji，而不是留一屏空白。
 *
 * ★ 判定规则 ★
 *   同一样式下：
 *     - 任意一张成功 → 说明网络/库可用，个别失败就留空，不切系统图标
 *     - 连续失败 >= 6 且成功数仍为 0 → 判定该样式整体不可用，
 *       所有 CategoryGlyph 回退系统 emoji
 *
 * ★ 为什么用 reactive ★
 *   CategoryGlyph 通过 emojiStyleFailed(style) 读取 failed，
 *   failed 一变，所有正在显示的图标一起切换成系统 emoji。
 */

import { reactive } from 'vue'
import { EMOJI_STYLES } from './emoji.js'

const FAIL_THRESHOLD = 6

/** style -> { attempts, ok, failed } */
const state = reactive({})
for (const s of EMOJI_STYLES) {
  state[s.key] = { attempts: 0, ok: 0, failed: false }
}

function ensure(style) {
  if (!state[style]) state[style] = { attempts: 0, ok: 0, failed: false }
  return state[style]
}

/**
 * 记录一次图片加载结果
 *
 * @param {string} style noto | twemoji | openmoji
 * @param {boolean} success 是否加载成功
 */
export function noteEmojiLoad(style, success) {
  const s = ensure(style)
  if (success) {
    s.ok += 1
    s.failed = false
    return
  }

  s.attempts += 1
  if (s.ok === 0 && s.attempts >= FAIL_THRESHOLD) {
    s.failed = true
  }
}

/** 该样式是否整体不可用（应回退系统 emoji） */
export function emojiStyleFailed(style) {
  const s = state[style]
  return !!(s && s.failed)
}

/**
 * 该样式是否至少成功加载过一张
 *
 * ★ 用途：单个图标加载失败后的兜底判断 ★
 *   页面只有一个图标时，6 次失败阈值永远达不到；
 *   CategoryGlyph 会在失败后等一小段时间，如果这时该样式
 *   还是一张都没成功，就按「一个都没加载出来」显示系统 emoji。
 *   一旦任意一张成功（本页或别处），失败的那张就保持空白。
 */
export function emojiStyleHasSuccess(style) {
  const s = state[style]
  return !!(s && s.ok > 0)
}

/** 重置某样式（切样式时重试 / 测试用） */
export function resetEmojiLoad(style) {
  if (!style) {
    for (const key of Object.keys(state)) state[key] = { attempts: 0, ok: 0, failed: false }
    return
  }
  state[style] = { attempts: 0, ok: 0, failed: false }
}
