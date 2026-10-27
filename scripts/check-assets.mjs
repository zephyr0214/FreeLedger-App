/**
 * 资源文件检查 —— 确认 pages.json 引用的图片都存在
 *
 *   node scripts/check-assets.mjs
 *
 * 坑：tabBar 的 iconPath 写错时，uni-app 编译期不报错，
 *     真机上只是图标空白，很难发现。这里提前拦住。
 */

import { readFileSync, existsSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

let errors = []
let checked = 0

/* --------------------------------------------------- pages.json 里的图片 */

const pagesJsonPath = join(ROOT, 'pages.json')

if (!existsSync(pagesJsonPath)) {
  console.log('找不到 pages.json')
  process.exit(1)
}

let raw = readFileSync(pagesJsonPath, 'utf-8')
// 去掉 JSON5 风格的注释
raw = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

let pagesJson
try {
  pagesJson = JSON.parse(raw)
} catch (e) {
  console.log(`pages.json 解析失败: ${e.message}`)
  process.exit(1)
}

/**
 * 解析 theme.json 里的 @变量。
 *
 * pages.json 里可以写 "@iconPath1" 这样的变量引用，
 * 真正的路径在 theme.json 的 light / dark 两套里。
 * 检查资源时要把变量解开，否则会误报「资源不存在」。
 */
function loadThemeVars() {
  const themePath = join(ROOT, 'theme.json')
  if (!existsSync(themePath)) return null
  try {
    const raw = readFileSync(themePath, 'utf-8')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const theme = JSON.parse(raw)
    const map = new Map()
    for (const mode of ['light', 'dark']) {
      const vars = theme[mode] || {}
      for (const [k, v] of Object.entries(vars)) {
        if (typeof v !== 'string') continue
        if (!map.has(k)) map.set(k, new Set())
        map.get(k).add(v)
      }
    }
    return map
  } catch (e) {
    errors.push(`theme.json 解析失败: ${e.message}`)
    return null
  }
}

const themeVars = loadThemeVars()

/**
 * 检查一个相对路径资源是否存在。
 * 路径可能是 "@变量" 形式，要先解成 theme.json 里的实际路径。
 */
function checkAsset(relPath, context) {
  checked++

  if (typeof relPath === 'string' && relPath.startsWith('@')) {
    const key = relPath.slice(1)
    if (!themeVars) {
      errors.push(`${context}: 用了 @${key} 但找不到 theme.json`)
      return
    }
    const values = themeVars.get(key)
    if (!values) {
      errors.push(`${context}: @${key} 在 theme.json 里没有定义`)
      return
    }
    // light / dark 两套路径都要存在
    for (const v of values) {
      if (!existsSync(join(ROOT, v))) {
        errors.push(`${context}: 资源不存在 — ${v}（@${key}）`)
      }
    }
    return
  }

  const abs = join(ROOT, relPath)
  if (!existsSync(abs)) {
    errors.push(`${context}: 资源不存在 — ${relPath}`)
  }
}

// tabBar 图标
if (pagesJson.tabBar && Array.isArray(pagesJson.tabBar.list)) {
  for (const item of pagesJson.tabBar.list) {
    const ctx = `tabBar[${item.text || item.pagePath}]`

    if (!item.iconPath) {
      errors.push(`${ctx}: 缺少 iconPath（tabBar 不会显示图标）`)
    } else {
      checkAsset(item.iconPath, ctx + ' iconPath')
    }

    if (!item.selectedIconPath) {
      errors.push(`${ctx}: 缺少 selectedIconPath（选中态不会显示图标）`)
    } else {
      checkAsset(item.selectedIconPath, ctx + ' selectedIconPath')
    }

    if (!item.pagePath) {
      errors.push(`${ctx}: 缺少 pagePath`)
    }
  }
}

// 页面 style 里可能引用的图片
for (const page of pagesJson.pages || []) {
  const style = page.style || {}
  if (style.appplus && style.appplus.titleNView) {
    const b = style.appplus.titleNView
    if (b.backgroundImage) checkAsset(b.backgroundImage, `${page.path} titleNView.backgroundImage`)
  }
}

/* --------------------------------------- 主题图标完整性（4 tab x 8 文件） */

const TAB_NAMES = ['home', 'account', 'stats', 'mine']
const PRESETS = ['green', 'blue', 'orange', 'purple', 'red', 'grey']

for (const name of TAB_NAMES) {
  checkAsset(`static/tabbar/${name}.png`, `${name} 浅色未选中`)
  checkAsset(`static/tabbar/${name}-dark.png`, `${name} 深色未选中`)
  for (const preset of PRESETS) {
    checkAsset(`static/tabbar/${name}-active-${preset}.png`, `${name} 选中态(${preset})`)
  }
}

/* ---------------------------------------------------------------- 输出 */

if (errors.length > 0) {
  console.log(`检查了 ${checked} 个资源引用`)
  console.log(`\n发现 ${errors.length} 处问题:`)
  errors.forEach((e) => console.log('   ' + e))
  console.log('\n提示: 运行 python scripts/gen-tabbar-icons.py 可重新生成 tabBar 图标')
  process.exit(1)
}

console.log(`检查了 ${checked} 个资源引用`)
console.log('全部资源存在')
