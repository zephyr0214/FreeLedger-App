/**
 * 语法检查 —— 用 @babel/parser 做真正的 JS 解析
 *
 *   node scripts/check-syntax.mjs
 *
 * 历史教训：
 *   这个脚本第一版是手写的括号/引号配对检查，遇到正则字面量里的 `/`
 *   （例如 s.match(/^(\\d{4})[-/](\\d{1,2})$/)）就会误判成注释或除法，
 *   导致「括号提前闭合」这种假报错。
 *   既然项目已经装了 @babel/parser，就没必要自己写词法分析器。
 *
 * 检查项：
 *   1. 所有 .js 能被 Babel 解析
 *   2. 所有 .vue 的 <script> 能被解析
 *   3. import 的相对路径 / @/ 路径真实存在
 *   4. pages.json 声明的路由文件存在，tabBar 页面已声明
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, dirname, resolve, relative } from 'path'
import { fileURLToPath } from 'url'
import { parse } from '@babel/parser'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

let errors = []
let checked = 0

const PARSE_OPTS = {
  sourceType: 'module',
  plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator', 'classProperties'],
  errorRecovery: false
}

function addError(file, msg) {
  errors.push(`${relative(ROOT, file)}: ${msg}`)
}

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'unpackage', '.git', 'dist', 'scripts'].includes(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, exts, out)
    else if (exts.some((e) => name.endsWith(e))) out.push(full)
  }
  return out
}

/** 检查 import 路径是否存在 */
function checkImports(file, code) {
  const re = /(?:import\s+[\s\S]*?from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(code)) !== null) {
    const spec = m[1]
    if (!spec.startsWith('.') && !spec.startsWith('@/')) continue

    const target = spec.startsWith('@/')
      ? join(ROOT, spec.slice(2))
      : resolve(dirname(file), spec)

    const candidates = [
      target,
      target + '.js',
      target + '.vue',
      target + '.mjs',
      join(target, 'index.js')
    ]

    if (!candidates.some((c) => existsSync(c))) {
      addError(file, `import 路径不存在: ${spec}`)
    }
  }
}

/* ---------------------------------------------------- 1. 检查 .js 文件 */

const jsFiles = walk(ROOT, ['.js', '.mjs'])

for (const file of jsFiles) {
  const code = readFileSync(file, 'utf-8')
  checked++
  try {
    parse(code, PARSE_OPTS)
    checkImports(file, code)
  } catch (e) {
    const line = e.loc ? e.loc.line : 0
    addError(file, `JS 语法错误（第 ${line} 行）: ${e.message}`)
  }
}

/* --------------------------------------------------- 2. 检查 .vue 文件 */

const vueFiles = walk(ROOT, ['.vue'])

for (const file of vueFiles) {
  const code = readFileSync(file, 'utf-8')
  checked++

  const scriptMatch = code.match(/<script[^>]*>([\s\S]*?)<\/script>/)
  if (scriptMatch) {
    const script = scriptMatch[1]
    try {
      parse(script, PARSE_OPTS)
      checkImports(file, script)
    } catch (e) {
      const line = e.loc ? e.loc.line : 0
      addError(file, `<script> 语法错误（第 ${line} 行）: ${e.message}`)
    }
  }
}

/* ------------------------------------------- 3. 检查 JSON 配置文件 */

/**
 * ★ 为什么 manifest.json / theme.json 也要查 ★
 *   踩过的坑：删 manifest.json 里的一个模块时留了个尾逗号，
 *   整个项目编译失败（uni-app 报 "Unexpected comma"），
 *   而 npm run verify 全绿 —— 因为当时只有 pages.json 被检查。
 *
 *   尾逗号 JSON.parse 会直接报错，这类问题不能靠肉眼，
 *   必须让脚本每次都跑一遍。
 */
const JSON_FILES = ['manifest.json', 'pages.json', 'theme.json']

for (const name of JSON_FILES) {
  const file = join(ROOT, name)
  if (!existsSync(file)) continue

  let raw = readFileSync(file, 'utf-8')
  // uni-app 的 json5 风格：允许 // 和 /* */ 注释
  raw = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  try {
    JSON.parse(raw)
  } catch (e) {
    addError(file, `JSON 解析失败: ${e.message}`)
    // 打印出错行附近，方便定位
    const m = e.message.match(/position (\d+)/)
    if (m) {
      const pos = parseInt(m[1])
      const lines = raw.split('\n')
      const lineNo = raw.slice(0, pos).split('\n').length
      for (let i = Math.max(0, lineNo - 2); i < Math.min(lines.length, lineNo + 1); i++) {
        addError(file, `  第 ${i + 1} 行: ${lines[i].trim()}`)
      }
    }
  }
}

/* ------------------------------------------- 4. 检查 pages.json 路由 */

const pagesJsonPath = join(ROOT, 'pages.json')
if (existsSync(pagesJsonPath)) {
  let raw = readFileSync(pagesJsonPath, 'utf-8')
  raw = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  try {
    const pagesJson = JSON.parse(raw)
    const declared = new Set()

    for (const p of pagesJson.pages || []) {
      declared.add(p.path)
      const target = join(ROOT, p.path + '.vue')
      if (!existsSync(target)) {
        addError(pagesJsonPath, `路由声明的页面不存在: ${p.path}.vue`)
      }
    }

    if (pagesJson.tabBar && pagesJson.tabBar.list) {
      for (const item of pagesJson.tabBar.list) {
        if (!declared.has(item.pagePath)) {
          addError(pagesJsonPath, `tabBar 页面未在 pages 中声明: ${item.pagePath}`)
        }
      }
    }
  } catch (e) {
    // 语法错误上面已经报过了，这里不再重复
    if (!/JSON 解析失败/.test(errors.join('\n'))) {
      addError(pagesJsonPath, 'JSON 解析失败: ' + e.message)
    }
  }
}

/* --------------------------------------------------------- 输出结果 */

console.log(`检查了 ${checked} 个文件（${jsFiles.length} js + ${vueFiles.length} vue）\n`)

if (errors.length > 0) {
  console.log(`❌ 错误 ${errors.length} 条:`)
  errors.forEach((e) => console.log('   ' + e))
  process.exit(1)
}

console.log('✅ 全部通过')
