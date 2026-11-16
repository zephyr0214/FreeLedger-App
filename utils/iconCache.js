/**
 * 分类图标本地缓存
 *
 * ★ 为什么只缓存「用到的」★
 *   图标库有 1037 个图标 × 4 种样式 = 4148 个资源。
 *   全下下来既慢又占空间；实际账本只用到其中几十个分类图标。
 *   所以只缓存：
 *     · 当前所有分类（含隐藏分类）的图标
 *     · 主题外观页预览用的 1F35C
 *   用户在选择图标页浏览其它图标时仍按需联网，不写缓存。
 *
 * ★ 为什么四种样式一起缓存 ★
 *   用户切换样式后应该立刻有图，而不是再等一轮网络。
 *   cacheIcon() 会按 EMOJI_STYLES 把同一个码点的四种样式都下下来；
 *   当前样式只是选择显示哪一份本地文件。
 *
 * ★ 什么时候同步 ★
 *   · App 启动后后台预热（api/iconCache.warmCategoryIconCache）
 *   · 分类图标新增 / 修改后（api/iconCache.syncCategoryIconCache）
 *   · 分类删除后重新 prune（只保留仍在用的码点）
 *
 * ★ 存储 ★
 *   uni.saveFile 把文件放进 App 私有目录；manifest 存 uni storage，
 *   只记录「样式:码点 -> 本地路径 + 原始 URL」。
 *   CDN 地址已固定版本，URL 不变即可复用；URL 变了视为失效。
 *
 * 纯本地模块，不直接依赖 api/，避免 utils → api 的反向依赖。
 */

import { reactive } from 'vue'
import { EMOJI_STYLES, categoryIconCode, emojiImageSrc } from './emoji.js'

const STORAGE_KEY = 'icon_cache_manifest_v1'
const MAX_CONCURRENT = 3

/** 反应式路径表，CategoryGlyph / 主题页读取它来切换到本地文件 */
const paths = reactive({})

/** key -> { path, url } */
const manifest = {}
let loaded = false
let active = 0
const queue = []
const inflight = new Map()

function cacheKey(style, code) {
  return `${style}:${code}`
}

function isApp() {
  return typeof uni !== 'undefined' && typeof uni.downloadFile === 'function'
}

function loadManifest() {
  if (loaded) return
  loaded = true
  try {
    const raw = uni.getStorageSync(STORAGE_KEY)
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (obj && typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        if (value && value.path) {
          manifest[key] = value
          paths[key] = value.path
        }
      }
    }
  } catch (e) {
    console.warn('[iconCache] 读取缓存清单失败:', e && e.message)
  }
}

function persist() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  try {
    uni.setStorageSync(STORAGE_KEY, JSON.stringify(manifest))
  } catch (e) {
    console.warn('[iconCache] 写入缓存清单失败:', e && e.message)
  }
}

let persistTimer = null

/** 批量下载时不要每个文件都同步写 storage，300ms 合并一次 */
function schedulePersist() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    persist()
  }, 300)
}

function removeFile(path) {
  if (!path || typeof uni.removeSavedFile !== 'function') return
  uni.removeSavedFile({
    filePath: path,
    fail: () => {
      // 文件可能已被系统清理；清掉清单即可
    }
  })
}

/**
 * 取本地缓存路径；没有 / URL 已变 / 非 App 环境时返回空串。
 * 读取 paths[key] 是响应式的：缓存下载完成后依赖它的组件会自动刷新。
 */
export function cachedIconPath(code, style) {
  if (!isApp()) return ''
  loadManifest()
  const c = categoryIconCode(code)
  const key = cacheKey(style, c)
  const item = manifest[key]
  if (!item || !item.path) return ''
  if (item.url !== emojiImageSrc(c, 120, style)) return ''
  return paths[key] || item.path
}

/** 本地缓存失效：删文件 + 清清单（下次会重新走远程 / 重新下载） */
export function invalidateIcon(code, style) {
  const c = categoryIconCode(code)
  const key = cacheKey(style, c)
  const item = manifest[key]
  if (item && item.path) removeFile(item.path)
  delete manifest[key]
  delete paths[key]
  persist()
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()
    active++
    job.run()
      .then(job.resolve, job.reject)
      .finally(() => {
        active--
        pump()
      })
  }
}

function enqueue(run) {
  return new Promise((resolve, reject) => {
    queue.push({ run, resolve, reject })
    pump()
  })
}

function downloadOne(style, code) {
  const key = cacheKey(style, code)
  const url = emojiImageSrc(code, 120, style)
  return new Promise((resolve) => {
    uni.downloadFile({
      url,
      success: (res) => {
        if (!res || res.statusCode !== 200 || !res.tempFilePath) {
          resolve(false)
          return
        }
        uni.saveFile({
          tempFilePath: res.tempFilePath,
          success: (saved) => {
            if (!saved || !saved.savedFilePath) {
              resolve(false)
              return
            }
            manifest[key] = { path: saved.savedFilePath, url }
            paths[key] = saved.savedFilePath
            schedulePersist()
            resolve(true)
          },
          fail: () => resolve(false)
        })
      },
      fail: () => resolve(false)
    })
  })
}

/** 缓存一个码点的一个样式；已存在直接返回 true */
export function cacheIcon(code, style) {
  if (!isApp()) return Promise.resolve(false)
  loadManifest()
  const c = categoryIconCode(code)
  const key = cacheKey(style, c)
  if (manifest[key] && manifest[key].url === emojiImageSrc(c, 120, style)) {
    return Promise.resolve(true)
  }
  // URL 变了（CDN 升级 / 样式资源换地址）：旧文件先清掉，避免成为孤儿
  if (manifest[key]) {
    if (manifest[key].path) removeFile(manifest[key].path)
    delete manifest[key]
    delete paths[key]
    persist()
  }
  if (inflight.has(key)) return inflight.get(key)

  const p = enqueue(() => downloadOne(style, c)).finally(() => {
    inflight.delete(key)
  })
  inflight.set(key, p)
  return p
}

/** 把一个码点的四种样式都缓存好（不抛错，失败就等下次） */
export function cacheCodeAllStyles(code) {
  return Promise.all(EMOJI_STYLES.map((s) => cacheIcon(code, s.key)))
}

/** 批量缓存一批码点；未使用到的图标不要传进来 */
export function cacheCodes(codes) {
  const list = [...new Set((codes || []).filter(Boolean))]
  if (list.length === 0) return Promise.resolve()
  const jobs = []
  for (const code of list) {
    for (const s of EMOJI_STYLES) jobs.push(cacheIcon(code, s.key))
  }
  return Promise.all(jobs)
}

/** 删除不再使用的缓存；keepCodes 必须包含所有仍在用的码点 */
export function pruneIconCache(keepCodes) {
  if (!isApp()) return
  loadManifest()
  const keep = new Set((keepCodes || []).filter(Boolean))
  const validStyles = new Set(EMOJI_STYLES.map((s) => s.key))
  for (const key of Object.keys(manifest)) {
    const i = key.indexOf(':')
    const style = i >= 0 ? key.slice(0, i) : ''
    const code = i >= 0 ? key.slice(i + 1) : ''
    if (validStyles.has(style) && keep.has(code)) continue
    const item = manifest[key]
    if (item && item.path) removeFile(item.path)
    delete manifest[key]
    delete paths[key]
  }
  persist()
}
