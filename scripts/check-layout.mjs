/**
 * 布局检查 —— 防止「用 JS 算高度」这类问题复发
 *
 *   node scripts/check-layout.mjs
 *
 * 检查项：
 *   1. 页面里不许出现 getSystemInfoSync().windowHeight 参与高度计算
 *      （这类写法永远算不准，应改用 flex 布局）
 *   2. scroll-view 必须有父级 flex 约束，不能靠 :style 传死高度
 *   3. .app-page 必须是 flex column
 *   4. 固定头部（AppHeader / nav-bar / PageNav）必须有 flex-shrink: 0
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

let errors = []
let warnings = []

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'unpackage', '.git', 'dist'].includes(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (name.endsWith('.vue') || name.endsWith('.js')) out.push(full)
  }
  return out
}

const files = walk(ROOT)

/* ---------------------------------------------- 1. 禁止 JS 计算高度 */

for (const file of files) {
  const code = readFileSync(file, 'utf-8')
  const rel = relative(ROOT, file)

  // 只检查页面文件
  if (!rel.startsWith('pages')) continue

  // windowHeight / screenHeight 参与减法运算 = 在猜高度
  const heightCalcRe = /(windowHeight|screenHeight)\s*-\s*/g
  let m
  while ((m = heightCalcRe.exec(code)) !== null) {
    const line = code.slice(0, m.index).split('\n').length
    errors.push(
      `${rel}:${line} 用 ${m[1]} 做减法算高度 —— 应改用 flex 布局（见 App.vue 的 .app-page）`
    )
  }

  // :style 里传 height: xxx 给 scroll-view
  const styleHeightRe = /<scroll-view[^>]*?:style="\{[^"]*height:[^"]*\}[^>]*>/g
  while ((m = styleHeightRe.exec(code)) !== null) {
    const line = code.slice(0, m.index).split('\n').length
    errors.push(`${rel}:${line} scroll-view 用 :style 传死高度 —— 应交给父级 flex:1`)
  }
}

/* ------------------------------------ 2. App.vue 的 .app-page 必须是 flex */

const appVue = join(ROOT, 'App.vue')
if (readdirSync(ROOT).includes('App.vue')) {
  const code = readFileSync(appVue, 'utf-8')
  const match = code.match(/\.app-page\s*\{([^}]*)\}/)
  if (match) {
    const body = match[1]
    if (!/display:\s*flex/.test(body)) {
      errors.push('App.vue: .app-page 必须是 display:flex')
    }
    if (!/flex-direction:\s*column/.test(body)) {
      errors.push('App.vue: .app-page 必须是 flex-direction:column')
    }
    if (/min-height:\s*100vh/.test(body)) {
      errors.push('App.vue: .app-page 不要用 min-height:100vh（tabBar 页面会多出空白）')
    }
  } else {
    errors.push('App.vue: 找不到 .app-page 样式定义')
  }
}

/* -------------------------------------- 3. 固定头部必须有 flex-shrink:0 */

const FIXED_HEADERS = ['.app-header', '.nav-bar']

for (const file of files) {
  if (!file.endsWith('.vue')) continue
  const code = readFileSync(file, 'utf-8')
  const rel = relative(ROOT, file)

  for (const sel of FIXED_HEADERS) {
    const re = new RegExp(`${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`)
    const m = code.match(re)
    if (m && !/flex-shrink:\s*0/.test(m[1])) {
      warnings.push(`${rel}: ${sel} 缺少 flex-shrink: 0（flex 布局下可能被压缩）`)
    }
  }
}

/* ------------------------------------------------------------ 输出 */

if (errors.length === 0 && warnings.length === 0) {
  console.log(`检查了 ${files.length} 个文件的布局`)
  console.log('布局检查通过')
  process.exit(0)
}

if (warnings.length > 0) {
  console.log(`警告 ${warnings.length} 条:`)
  warnings.forEach((w) => console.log('   ' + w))
  console.log()
}

if (errors.length > 0) {
  console.log(`错误 ${errors.length} 条:`)
  errors.forEach((e) => console.log('   ' + e))
  process.exit(1)
}

console.log('布局检查通过')
