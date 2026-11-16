/**
 * 分类图标缓存编排（业务层）
 *
 * utils/iconCache.js 只负责「下载 / 存文件 / 查清单」；
 * 这里负责回答「哪些码点算用到了」：
 *   · 所有分类（含隐藏分类）的 icon
 *   · 主题外观页预览用的 1F35C
 *
 * 不缓存图标选择页里的 1037 个图标 —— 那些只是候选，不是账本在用的。
 */

import { listCategories } from './category.js'
import { categoryIconCode } from '../utils/emoji.js'
import {
  cacheCodes, cacheCodeAllStyles, pruneIconCache
} from '../utils/iconCache.js'

/** 主题外观预览 / 样式选择行使用的码点 */
export const THEME_PREVIEW_CODE = '1F35C'

function collectCodes(categories) {
  const set = new Set([THEME_PREVIEW_CODE])
  for (const cat of categories || []) {
    const code = categoryIconCode(cat.icon, cat.name)
    if (code) set.add(code)
  }
  return [...set]
}

let warming = null

/**
 * 预热所有在用分类图标（四种样式一起）
 *
 * 由 App.vue 在启动稳定后延迟调用；重复调用会复用同一个 Promise。
 */
export function warmCategoryIconCache() {
  if (warming) return warming
  warming = (async () => {
    try {
      const cats = await listCategories(null, true)
      const codes = collectCodes(cats)
      await cacheCodes(codes)
      pruneIconCache(codes)
      return codes.length
    } catch (e) {
      console.warn('[iconCache] 预热分类图标失败:', e && e.message)
      return 0
    } finally {
      warming = null
    }
  })()
  return warming
}

/**
 * 分类图标新增 / 修改后同步：先把新码点的四种样式缓存好，
 * 再交给 warm 重新收集 + 清理旧码点。
 */
export async function syncCategoryIconCache(icon, name) {
  const code = categoryIconCode(icon, name)
  if (code) await cacheCodeAllStyles(code)
  await refreshCategoryIconCache()
}

/** 等正在跑的预热结束后，再按最新分类重新收集一遍并清理旧缓存 */
export async function refreshCategoryIconCache() {
  if (warming) await warming
  return warmCategoryIconCache()
}
