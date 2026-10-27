/**
 * 给页面导航栏补 flex-shrink: 0
 *
 * 背景：.app-page 改为 flex column 后，子元素默认 flex-shrink:1，
 *       header / nav-bar 可能被 scroll-view 的高内容挤压变形。
 *       固定头部必须显式 flex-shrink: 0。
 *
 *   node scripts/fix-flexshrink.mjs
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const SELECTORS = ['.nav-bar', '.app-header', '.guide-page']

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

for (const file of walk(ROOT)) {
  if (!file.includes('pages') && !file.includes('components')) continue

  let code = readFileSync(file, 'utf-8')
  const original = code

  for (const sel of SELECTORS) {
    // 匹配 .sel { ... } 且内部还没有 flex-shrink
    const re = new RegExp(
      `(${sel.replace('.', '\\.')}\\s*\\{)([^}]*?)(\\})`,
      'g'
    )
    code = code.replace(re, (match, open, body, close) => {
      if (/flex-shrink/.test(body)) return match
      // 保持缩进：在 body 末尾追加一行
      const hasNewline = body.includes('\n')
      if (!hasNewline) {
        return `${open}${body.trimEnd()} flex-shrink: 0; ${close}`
      }
      const lines = body.split('\n')
      // 找到最后一行非空行的缩进
      let lastIndent = '  '
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim()) {
          lastIndent = lines[i].match(/^\s*/)[0]
          break
        }
      }
      // 插到最后一个非空行之后
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim()) {
          lines.splice(i + 1, 0, `${lastIndent}flex-shrink: 0;`)
          break
        }
      }
      return `${open}${lines.join('\n')}${close}`
    })
  }

  if (code !== original) {
    writeFileSync(file, code, 'utf-8')
    touched++
    console.log(`  fixed ${relative(ROOT, file)}`)
  }
}

console.log(`\n共处理 ${touched} 个文件`)
