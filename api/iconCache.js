/**
 * 分类图标缓存编排（业务层）
 *
 * utils/iconCache.js 只负责「下载 / 存文件 / 查清单」；
 * 这里负责回答「哪些码点算用到了」：
 *   · 所有分类（含隐藏分类）的 icon
 *   · 主题外观页预览用的五个图标
 *   · 标签详情 / 借入借出 / 报销等详情页固定使用的图标
 *
 * 不缓存图标选择页里的 1037 个图标 —— 那些只是候选，不是账本在用的。
 */

import { listCategories } from './category.js'
import { categoryIconCode } from '../utils/emoji.js'
import {
  cacheCodes, cacheCodeAllStyles, pruneIconCache
} from '../utils/iconCache.js'

/** 主题外观预览用的五个分类图标码点：面条 / 芒果 / 公交 / 礼物 / 钱袋 */
export const THEME_PREVIEW_CODES = ['1F35C', '1F96D', '1F68D', '1F381', '1F4B0']

/**
 * 详情页固定图标：标签详情「标签」、借出/借入「发件箱/收件箱」、报销「收据」
 * 这些不是分类图标，不会出现在分类表里，但详情页一进去就要显示。
 */
export const DETAIL_PAGE_CODES = ['1F3F7', '1F4E4', '1F4E5', '1F9FE']

function collectCodes(categories) {
  const set = new Set([...THEME_PREVIEW_CODES, ...DETAIL_PAGE_CODES])
  for (const cat of categories || []) {
    const code = categoryIconCode(cat.icon, cat.name)
    if (code) set.add(code)
  }
  return [...set]
}

let warming = null

/**
 * 预热所有在用分类图标（五种样式一起）
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
 * 分类图标新增 / 修改后同步：先把新码点的五种样式缓存好，
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
