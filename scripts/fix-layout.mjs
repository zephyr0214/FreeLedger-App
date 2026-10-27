/**
 * 把「JS 硬编码算高度」改为「flex 自适应布局」
 *
 * 问题：
 *   原来每个页面都这样算 scroll-view 的高度：
 *     const scrollHeight = computed(() => {
 *       const info = uni.getSystemInfoSync()
 *       const headerH = (info.statusBarHeight || 20) + 60   // 60 是猜的
 *       const tabH = 50                                      // 50 也是猜的
 *       return `${info.windowHeight - headerH - tabH}px`
 *     })
 *   120rpx 的 header 在不同屏宽下换算出的 px 不同，tabBar 还要叠加安全区高度，
 *   两个硬编码数字必然算错 → 顶部或底部出现空白 / 内容被切。
 *
 * 改法：
 *   page 与 .app-page 用 height:100% + flex column，
 *   scroll-view 用 flex:1 自动占满剩余空间。
 *   高度由渲染引擎决定，不再靠 JS 猜。
 *
 *   node scripts/fix-layout.mjs
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

/** 递归找 .vue */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'unpackage', '.git', 'dist'].includes(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (name.endsWith('.vue') && full.includes(`${ROOT}\\pages`) ) out.push(full)
    else if (name.endsWith('.vue') && full.includes(`${ROOT}/pages`)) out.push(full)
  }
  return out
}

/**
 * 删除形如：
 *     const xxx = computed(() => {
 *       ...
 *     })
 * 的整段代码
 */
function removeComputedBlock(code, varName) {
  const lines = code.split(/\r?\n/)
  const startIdx = lines.findIndex((l) =>
    new RegExp(`^\\s*const\\s+${varName}\\s*=\\s*computed\\(`).test(l)
  )
  if (startIdx === -1) return code

  const indentMatch = lines[startIdx].match(/^(\s*)/)
  const indent = indentMatch ? indentMatch[1] : ''

  let endIdx = -1
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i] === `${indent}})`) {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) return code

  lines.splice(startIdx, endIdx - startIdx + 1)
  return lines.join('\n')
}

/** 从 return { ... } 里去掉某个标识符 */
function removeFromReturn(code, varName) {
  return code.replace(
    new RegExp(`(\\breturn\\s*\\{)([\\s\\S]*?)(\\n\\s*\\})`, ''),
    (m, open, body, close) => {
      const cleaned = body
        .split('\n')
        .map((line) => {
          if (!line.includes(varName)) return line
          // 处理 "a, b, c" 这种同行多个的情况
          const parts = line.split(',')
          const filtered = parts.filter((p) => p.trim() !== varName)
          if (filtered.length === parts.length) return line
          return filtered.join(',')
        })
        .join('\n')
      return open + cleaned + close
    }
  )
}

const files = walk(ROOT)
let touched = 0

for (const file of files) {
  let code = readFileSync(file, 'utf-8')
  const original = code
  const rel = relative(ROOT, file)

  // 1) 找出这个页面用的是 scrollHeight 还是 listHeight
  const heightVars = ['scrollHeight', 'listHeight']
  let usedVar = null
  for (const v of heightVars) {
    if (new RegExp(`const\\s+${v}\\s*=\\s*computed\\(`).test(code)) {
      usedVar = v
      break
    }
  }
  if (!usedVar) continue

  // 2) 模板里去掉 :style="{ height: xxx }"
  code = code.replace(
    new RegExp(`\\s*:style="\\{\\s*height:\\s*${usedVar}\\s*\\}"`, 'g'),
    ''
  )

  // 3) 删掉 computed 定义
  code = removeComputedBlock(code, usedVar)

  // 4) 从 return 里移除
  code = removeFromReturn(code, usedVar)

  if (code !== original) {
    writeFileSync(file, code, 'utf-8')
    touched++
    console.log(`  fixed ${rel} (removed ${usedVar})`)
  }
}

console.log(`\n共处理 ${touched} 个页面`)
