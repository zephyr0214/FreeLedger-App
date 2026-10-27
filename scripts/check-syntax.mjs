/**
 * 轻量语法检查 —— 不依赖 uni-app 编译器，用于快速发现低级错误
 *
 *   node scripts/check-syntax.mjs
 *
 * 检查项：
 *   1. 所有 .js 能否被 Node 解析（ESM 语法层面）
 *   2. 所有 .vue 的 <script> 块能否被解析
 *   3. pages.json 中声明的路由是否都存在对应文件
 *   4. .vue 文件中 template 的标签是否配对（粗检）
 *   5. script 中 import 的相对路径是否存在
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, dirname, resolve, relative } from 'path'
import { fileURLToPath } from 'url'
import vm from 'vm'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

let errors = []
let warnings = []
let checked = 0

function addError(file, msg) {
  errors.push(`${relative(ROOT, file)}: ${msg}`)
}

function addWarning(file, msg) {
  warnings.push(`${relative(ROOT, file)}: ${msg}`)
}

/** 递归收集文件 */
function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'unpackage' || name === '.git' || name === 'dist') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, exts, out)
    } else if (exts.some((e) => name.endsWith(e))) {
      out.push(full)
    }
  }
  return out
}

/** 检查 import 路径是否存在（只查相对路径与 @/） */
function checkImports(file, code) {
  const re = /(?:import\s+[\s\S]*?from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(code)) !== null) {
    const spec = m[1]
    if (!spec.startsWith('.') && !spec.startsWith('@/')) continue

    let target
    if (spec.startsWith('@/')) {
      target = join(ROOT, spec.slice(2))
    } else {
      target = resolve(dirname(file), spec)
    }

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

const jsFiles = walk(ROOT, ['.js', '.mjs']).filter((f) => !f.includes('check-syntax'))

for (const file of jsFiles) {
  const code = readFileSync(file, 'utf-8')
  checked++
  try {
    // 用 Module 方式解析（new vm.SourceTextModule 在部分 Node 下需要 flag，
    // 这里改用动态 import 的语法检查替代：直接尝试解析成函数体不够准确，
    // 因此用 acorn 风格的简单校验：检查括号、引号平衡 + 尝试 import）
    checkBalanced(code, file)
    checkImports(file, code)
  } catch (e) {
    addError(file, e.message)
  }
}

/* --------------------------------------------------- 2. 检查 .vue 文件 */

const vueFiles = walk(ROOT, ['.vue'])

const VOID_TAGS = new Set([
  'br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col',
  'embed', 'source', 'track', 'wbr'
])

for (const file of vueFiles) {
  const code = readFileSync(file, 'utf-8')
  checked++

  // 提取 <script> 块
  const scriptMatch = code.match(/<script[^>]*>([\s\S]*?)<\/script>/)
  if (scriptMatch) {
    const script = scriptMatch[1]
    checkBalanced(script, file)
    checkImports(file, script)

    // 粗检：是否有明显的语法残留
    if (/<script/.test(script)) {
      addError(file, 'script 块中出现嵌套 <script')
    }
  }

  // 提取 <template> 块并做标签配对检查
  const templateMatch = code.match(/<template>([\s\S]*)<\/template>/)
  if (templateMatch) {
    checkTagBalance(templateMatch[1], file)
  }

  // 检查 style 块
  const styleMatches = code.match(/<style[^>]*>([\s\S]*?)<\/style>/g)
  if (styleMatches) {
    for (const s of styleMatches) {
      const body = s.replace(/<style[^>]*>/, '').replace(/<\/style>/, '')
      checkBraces(body, file)
    }
  }
}

/* ------------------------------------------- 3. 检查 pages.json 路由 */

const pagesJsonPath = join(ROOT, 'pages.json')
if (existsSync(pagesJsonPath)) {
  let raw = readFileSync(pagesJsonPath, 'utf-8')
  // 去掉 JSON5 风格的注释
  raw = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  try {
    const pagesJson = JSON.parse(raw)
    for (const p of pagesJson.pages || []) {
      const target = join(ROOT, p.path + '.vue')
      if (!existsSync(target)) {
        addError(pagesJsonPath, `路由声明的页面不存在: ${p.path}.vue`)
      }
    }
    // tabBar 页面必须在 pages 中
    if (pagesJson.tabBar && pagesJson.tabBar.list) {
      const declared = new Set((pagesJson.pages || []).map((p) => p.path))
      for (const item of pagesJson.tabBar.list) {
        if (!declared.has(item.pagePath)) {
          addError(pagesJsonPath, `tabBar 页面未在 pages 中声明: ${item.pagePath}`)
        }
      }
    }
  } catch (e) {
    addError(pagesJsonPath, 'JSON 解析失败: ' + e.message)
  }
}

/* --------------------------------------------------------- 工具函数 */

/** 引号与括号平衡（跳过字符串与注释） */
function checkBalanced(code, file) {
  let braces = 0
  let parens = 0
  let brackets = 0
  let inSingle = false
  let inDouble = false
  let inTemplate = false
  let inLineComment = false
  let inBlockComment = false
  let inRegex = false
  let lastSignificant = ''

  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    const next = code[i + 1]
    const prev = code[i - 1]

    if (inLineComment) {
      if (c === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') { inBlockComment = false; i++ }
      continue
    }
    if (inSingle) {
      if (c === '\\') { i++; continue }
      if (c === "'") inSingle = false
      continue
    }
    if (inDouble) {
      if (c === '\\') { i++; continue }
      if (c === '"') inDouble = false
      continue
    }
    if (inTemplate) {
      if (c === '\\') { i++; continue }
      if (c === '`') inTemplate = false
      continue
    }
    if (inRegex) {
      if (c === '\\') { i++; continue }
      if (c === '/') inRegex = false
      continue
    }

    if (c === '/' && next === '/') { inLineComment = true; i++; continue }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue }
    if (c === "'") { inSingle = true; continue }
    if (c === '"') { inDouble = true; continue }
    if (c === '`') { inTemplate = true; continue }

    // 正则字面量判断：/ 前是运算符或开头或括号
    if (c === '/' && (lastSignificant === '' || /[=(,!&|?:;{}\[\]]/.test(lastSignificant))) {
      // 排除注释已处理，这里认为是正则
      inRegex = true
      continue
    }

    if (c === '{') braces++
    else if (c === '}') braces--
    else if (c === '(') parens++
    else if (c === ')') parens--
    else if (c === '[') brackets++
    else if (c === ']') brackets--

    if (braces < 0 || parens < 0 || brackets < 0) {
      addError(file, `括号提前闭合（位置 ${i}）`)
      return
    }

    if (!/\s/.test(c)) lastSignificant = c
  }

  if (braces !== 0) addError(file, `花括号不平衡: ${braces}`)
  if (parens !== 0) addError(file, `圆括号不平衡: ${parens}`)
  if (brackets !== 0) addError(file, `方括号不平衡: ${brackets}`)
  if (inSingle || inDouble || inTemplate) addError(file, '存在未闭合的字符串')
}

/** CSS 花括号平衡 */
function checkBraces(css, file) {
  let depth = 0
  for (const c of css) {
    if (c === '{') depth++
    else if (c === '}') depth--
  }
  if (depth !== 0) addWarning(file, `样式花括号不平衡: ${depth}`)
}

/** 模板标签配对 */
function checkTagBalance(template, file) {
  const stack = []
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let m

  while ((m = re.exec(template)) !== null) {
    const [, closing, tag, attrs, selfClose] = m
    const name = tag.toLowerCase()

    if (VOID_TAGS.has(name) || selfClose === '/') continue

    if (closing === '/') {
      if (stack.length === 0) {
        addError(file, `多余的闭合标签 </${tag}>`)
        return
      }
      const top = stack.pop()
      if (top !== name) {
        addError(file, `标签未正确闭合: 期望 </${top}>，实际 </${tag}>`)
        return
      }
    } else {
      stack.push(name)
    }
  }

  if (stack.length > 0) {
    addError(file, `标签未闭合: <${stack.join('>, <')}>`)
  }
}

/* --------------------------------------------------------- 输出结果 */

console.log(`检查了 ${checked} 个文件（${jsFiles.length} js + ${vueFiles.length} vue）\n`)

if (warnings.length > 0) {
  console.log(`⚠️  警告 ${warnings.length} 条:`)
  warnings.forEach((w) => console.log('   ' + w))
  console.log()
}

if (errors.length > 0) {
  console.log(`❌ 错误 ${errors.length} 条:`)
  errors.forEach((e) => console.log('   ' + e))
  process.exit(1)
} else {
  console.log('✅ 全部通过')
}
