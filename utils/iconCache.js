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
 * ★ 为什么五种样式一起缓存 ★
 *   用户切换样式后应该立刻有图，而不是再等一轮网络。
 *   cacheIcon() 会按 EMOJI_STYLES 把同一个码点的五种样式都下下来；
 *   当前样式只是选择显示哪一份本地文件。
 *
 * ★ 什么时候同步 ★
 *   · App 启动后后台预热（api/iconCache.warmCategoryIconCache）
 *   · 分类图标新增 / 修改后（api/iconCache.syncCategoryIconCache）
 *   · 分类删除后重新 prune（只保留仍在用的码点）
 *
 * ★ 存储 ★
 *   plus.downloader 下载到 App 私有目录 `_doc/icon-cache/`，
 *   文件名 = 样式-码点-URL hash，避免 Twemoji / OpenMoji 同码点互相覆盖。
 *   manifest 存 uni storage，只记录「样式:码点 -> 本地路径 + 原始 URL」。
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

/** 新版缓存文件固定放在 _doc/icon-cache/ 下；旧的 uni.saveFile 路径不再信任 */
function isCachePath(path) {
  return typeof path === 'string' && path.indexOf('_doc/icon-cache/') === 0
}

function isApp() {
  return typeof plus !== 'undefined' && !!plus.downloader && !!plus.io
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

/**
 * 删除本地缓存文件
 *
 * ★ 不能用 uni.saveFile 的自动命名 ★
 *   Twemoji 和 OpenMoji 的同一个码点都可能被保存成 1f35c.svg／1F35C.svg；
 *   uni.saveFile 按临时文件名保存时，OpenMoji 可能直接拿到 Twemoji 的路径
 *   —— 表现就是「选了 OpenMoji，预览却是 Twemoji」。
 *   所以现在下载到我们自己的固定目录，文件名带 style + code + URL hash。
 */
function removeFile(path) {
  if (!path) return Promise.resolve()
  return new Promise((resolve) => {
    if (typeof plus !== 'undefined' && plus.io) {
      plus.io.resolveLocalFileSystemURL(
        path,
        (entry) => entry.remove(() => resolve(), () => resolve()),
        () => resolve()
      )
      return
    }
    if (typeof uni !== 'undefined' && typeof uni.removeSavedFile === 'function') {
      uni.removeSavedFile({ filePath: path, complete: () => resolve() })
      return
    }
    resolve()
  })
}

/** 缓存目录只建一次 */
let dirPromise = null
function ensureCacheDir() {
  if (dirPromise) return dirPromise
  dirPromise = new Promise((resolve, reject) => {
    if (typeof plus === 'undefined' || !plus.io) {
      reject(new Error('plus.io 不可用'))
      return
    }
    plus.io.requestFileSystem(plus.io.PRIVATE_DOC, (fs) => {
      fs.root.getDirectory('icon-cache', { create: true }, resolve, reject)
    }, reject)
  })
  return dirPromise
}

/** 文件名里带上样式和 URL hash，彻底避免不同样式/版本互相覆盖 */
function cacheFileName(style, code, url) {
  let hash = 0
  for (let i = 0; i < url.length; i++) hash = (hash * 31 + url.charCodeAt(i)) >>> 0
  const extMatch = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(url)
  const ext = extMatch ? extMatch[1].toLowerCase() : 'img'
  return `${style}-${code}-${hash.toString(36)}.${ext}`
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
  if (!item || !item.path || !isCachePath(item.path)) return ''
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

async function downloadOne(style, code) {
  const key = cacheKey(style, code)
  const url = emojiImageSrc(code, 120, style)
  const filename = cacheFileName(style, code, url)
  const dest = `_doc/icon-cache/${filename}`

  try {
    await ensureCacheDir()
    // 上一次同 URL 下载可能留下半截文件；先删掉
    await removeFile(dest)
  } catch (e) {
    return false
  }

  return new Promise((resolve) => {
    let task = null
    try {
      task = plus.downloader.createDownload(url, { filename: dest, timeout: 30 }, (d, status) => {
        if (status === 200) {
          manifest[key] = { path: dest, url }
          paths[key] = dest
          schedulePersist()
          resolve(true)
          return
        }
        // 失败时不要留下半截文件，否则下次会命中坏缓存
        removeFile(dest)
        resolve(false)
      })
      task.start()
    } catch (e) {
      if (task) {
        try { task.abort() } catch (err) {}
      }
      removeFile(dest)
      resolve(false)
    }
  })
}

/** 缓存一个码点的一个样式；已存在直接返回 true */
export function cacheIcon(code, style) {
  if (!isApp()) return Promise.resolve(false)
  loadManifest()
  const c = categoryIconCode(code)
  const key = cacheKey(style, c)
  if (manifest[key] && manifest[key].url === emojiImageSrc(c, 120, style) && isCachePath(manifest[key].path)) {
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

/** 把一个码点的五种样式都缓存好（不抛错，失败就等下次） */
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
    const item = manifest[key]
    if (!item || !isCachePath(item.path) || !validStyles.has(style) || !keep.has(code)) {
      if (item && item.path) removeFile(item.path)
      delete manifest[key]
      delete paths[key]
    }
  }
  persist()
}
