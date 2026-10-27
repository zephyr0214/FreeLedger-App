/**
 * 清理各页面 scoped 样式里的 .bottom-space 重复定义
 *
 * 放到 App.vue 全局统一（要叠加 safe-area-inset-bottom），
 * 页面里各自定义会覆盖全局规则，且高度不一致。
 *
 *   node scripts/fix-bottomspace.mjs
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'unpackage', '.git', 'dist'].includes(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

let touched = 0

for (const file of walk(join(ROOT, 'pages'))) {
  let code = readFileSync(file, 'utf-8')
  const original = code

  // 删除 .bottom-space { ... } 整块（含前面可能的注释行不计）
  code = code.replace(/\.bottom-space\s*\{[^}]*\}\s*/g, '')

  if (code !== original) {
    writeFileSync(file, code, 'utf-8')
    touched++
    console.log(`  cleaned ${relative(ROOT, file)}`)
  }
}

console.log(`\n共清理 ${touched} 个文件`)
