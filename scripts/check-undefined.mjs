/**
 * 未定义变量检查 —— 找出「用了但没定义」的标识符
 *
 *   node scripts/check-undefined.mjs
 *
 * 背景：
 *   之前改布局时，删掉了 16 个页面的 `const scrollHeight = computed(...)`，
 *   但 return 里还留着 `scrollHeight`。这是运行时错误：
 *     ReferenceError: scrollHeight is not defined
 *   直接导致页面白屏，而语法检查（check-deep）完全看不出来。
 *
 * 做法（针对 Vue setup 函数）：
 *   1. 取出 setup() 里声明的所有 const/let/function 名
 *   2. 取出 setup() 展开的 return { ... } 里的每个标识符
 *   3. 检查每个标识符是否在 1 中定义，或来自 import / 解构 / 内建
 *   4. 同样检查模板 {{ }} 里引用的标识符
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

let errors = []

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

/** 提取 setup() 或 data() 的作用域文本 */
function extractSetupBody(script) {
  // 匹配 setup() { ... } 或 setup(props, { emit }) { ... }
  const idx = script.search(/\bsetup\s*\(/)
  if (idx === -1) return null

  // 找到 setup 后面的第一个 {
  let i = script.indexOf('{', idx)
  if (i === -1) return null

  let depth = 0
  const start = i
  for (; i < script.length; i++) {
    if (script[i] === '{') depth++
    else if (script[i] === '}') {
      depth--
      if (depth === 0) return script.slice(start + 1, i)
    }
  }
  return null
}

/** 取 import 引入的本地名字 */
function extractImportedNames(script) {
  const names = new Set()
  const re = /import\s+(?:([\w$]+)\s*(?:,\s*)?)?(?:\{([^}]*)\})?\s*from/g
  let m
  while ((m = re.exec(script)) !== null) {
    if (m[1]) names.add(m[1].trim())
    if (m[2]) {
      m[2].split(',').forEach((part) => {
        const n = part.trim().split(/\s+as\s+/).pop()
        if (n) names.add(n.trim())
      })
    }
  }
  return names
}

/** 取 setup 里声明的名字 */
function extractDeclaredNames(body) {
  const names = new Set()

  // const/let/var 声明（含解构）
  const declRe = /\b(?:const|let|var)\s+([\w$]+)\s*=/g
  let m
  while ((m = declRe.exec(body)) !== null) names.add(m[1])

  // 对象/数组解构： const { a, b } = ...   const [x, y] = ...
  const destructureRe = /\b(?:const|let|var)\s*[\{\[]([^\}\]]*)[\}\]]\s*=/g
  while ((m = destructureRe.exec(body)) !== null) {
    m[1].split(',').forEach((part) => {
      const n = part.trim().split(':').pop().split('=')[0].trim()
      if (/^[\w$]+$/.test(n)) names.add(n)
    })
  }

  // function 声明
  const fnRe = /\bfunction\s+([\w$]+)\s*\(/g
  while ((m = fnRe.exec(body)) !== null) names.add(m[1])

  // setup(props, { emit }) 的参数
  names.add('props')
  names.add('emit')
  names.add('attrs')
  names.add('slots')

  return names
}

/**
 * 取 return { ... } 里展开的标识符
 *
 * 只取 setup 体内的**顶层** return —— 不能匹配 computed(() => { return {...} }) 里
 * 嵌套的 return，否则会把对象字面量的键（如 first / last / background）误报成变量。
 */
function extractReturnedNames(body) {
  const names = []

  // 逐字符扫描，记录当前嵌套深度（大括号 + 小括号），只在深度 0 时接受 return
  let braceDepth = 0
  let parenDepth = 0
  let inStr = null
  let inTemplate = false
  let inLineComment = false
  let inBlockComment = false

  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    const next = body[i + 1]
    const prev = body[i - 1]

    if (inLineComment) {
      if (c === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') { inBlockComment = false; i++ }
      continue
    }
    if (inStr) {
      if (c === '\\') { i++; continue }
      if (c === inStr) inStr = null
      continue
    }
    if (inTemplate) {
      if (c === '\\') { i++; continue }
      if (c === '`') inTemplate = false
      continue
    }

    if (c === '/' && next === '/') { inLineComment = true; i++; continue }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue }
    if (c === "'" || c === '"') { inStr = c; continue }
    if (c === '`') { inTemplate = true; continue }

    if (c === '{') braceDepth++
    else if (c === '}') braceDepth--
    else if (c === '(') parenDepth++
    else if (c === ')') parenDepth--

    // 只在顶层（不在任何括号内）识别 return
    if (braceDepth === 0 && parenDepth === 0 && body.startsWith('return', i)) {
      const before = body[i - 1]
      // 确保是独立关键字（前面是空白或行首）
      if (before && /[\w$]/.test(before)) continue

      // 找 return 后的 {
      let j = i + 6
      while (j < body.length && /\s/.test(body[j])) j++
      if (body[j] !== '{') continue

      // 提取配对的大括号内容
      let depth = 1
      const start = j + 1
      let k = j + 1
      let str = null
      let tpl = false
      for (; k < body.length; k++) {
        const ch = body[k]
        if (str) {
          if (ch === '\\') { k++; continue }
          if (ch === str) str = null
          continue
        }
        if (tpl) {
          if (ch === '\\') { k++; continue }
          if (ch === '`') tpl = false
          continue
        }
        if (ch === "'" || ch === '"') { str = ch; continue }
        if (ch === '`') { tpl = true; continue }
        if (ch === '{') depth++
        else if (ch === '}') {
          depth--
          if (depth === 0) break
        }
      }
      const inner = body.slice(start, k)

      // 拆顶层逗号
      let d = 0
      let cur = ''
      const parts = []
      let s2 = null
      for (const ch of inner) {
        if (s2) {
          cur += ch
          if (ch === s2) s2 = null
          continue
        }
        if (ch === "'" || ch === '"' || ch === '`') { s2 = ch; cur += ch; continue }
        if ('{[('.includes(ch)) d++
        if ('}])'.includes(ch)) d--
        if (ch === ',' && d === 0) {
          parts.push(cur)
          cur = ''
        } else {
          cur += ch
        }
      }
      if (cur.trim()) parts.push(cur)

      for (const p of parts) {
        const t = p.trim()
        if (!t) continue
        const keyPart = t.includes(':') ? t.split(':')[0].trim() : t
        if (/^[\w$]+$/.test(keyPart)) names.push(keyPart)
      }

      i = k
    }
  }

  return names
}

/* ------------------------------------------------------------ 主流程 */

const files = walk(ROOT)

/**
 * Vue 组合式 API 的全局可用名。
 *
 * ★ 故意只放「不会用错」的 ★
 *   ref / computed / watch / 生命周期钩子这些漏了 import 基本都会白屏，
 *   必须查出来，所以不放进白名单。
 *   （之前放进来过，结果「reactive 没 import」这个坑就漏过去了。）
 */
const VUE_GLOBALS = new Set([
  'defineProps', 'defineEmits', 'defineExpose', 'defineOptions',
  'useSlots', 'useAttrs', 'useId', 'useTemplateRef', 'useCssModule',
  'h', 'nextTick', 'getCurrentInstance'
])

for (const file of files) {
  const code = readFileSync(file, 'utf-8')
  const rel = relative(ROOT, file)

  const scriptMatch = code.match(/<script[^>]*>([\s\S]*?)<\/script>/)
  if (!scriptMatch) continue
  const script = scriptMatch[1]

  // 只处理 options API 风格（有 setup() 的）
  const body = extractSetupBody(script)
  if (!body) continue

  const imported = extractImportedNames(script)
  const declared = extractDeclaredNames(body)
  const returned = extractReturnedNames(body)

  for (const name of returned) {
    if (declared.has(name) || imported.has(name)) continue
    // 常见内建，跳过
    if (['undefined', 'null', 'true', 'false', 'this'].includes(name)) continue
    errors.push(`${rel}: return 里引用了未定义的 \`${name}\``)
  }

  /* ---- setup 体内用到的标识符 ----
   * 踩过的坑：
   *   在 setup 里写了 `const swipeStates = reactive({})`，
   *   但 import 那行忘了加 reactive，
   *   运行时直接 ReferenceError: reactive is not defined → 整页白屏。
   *   语法检查、模板编译、作用域检查全都看不出来
   *   （作用域检查只查 return 里的名字）。
   *
   * 做法：扫出 setup 体内所有「被调用/被引用」的标识符，
   * 确认它在 declared / imported / VUE_GLOBALS 里有定义。
   */
  const used = extractUsedIdentifiers(body)
  for (const name of used) {
    if (declared.has(name) || imported.has(name)) continue
    if (VUE_GLOBALS.has(name)) continue
    if (['undefined', 'null', 'true', 'false', 'this', 'arguments', 'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Promise', 'Set', 'Map', 'WeakMap', 'WeakSet', 'Symbol', 'Error', 'TypeError', 'RangeError', 'RegExp', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'structuredClone', 'uni', 'plus', 'getCurrentInstance', 'resolve', 'reject', 'Proxy', 'Reflect', 'Intl', 'BigInt', 'globalThis', 'undefined'].includes(name)) continue
    // 对象属性（a.b.c）、可选链（a?.b）里的 a 也要算
    errors.push(`${rel}: setup 里用到了未定义的 \`${name}\` —— 运行时 ReferenceError`)
  }
}

/**
 * 取出 setup 体内「被使用」的标识符。
 *
 * 只取「后面跟着 ( 或 . 或 = 」这种明显被使用的形式，
 * 避免把对象字面量的键、属性名当成变量。
 */
function extractUsedIdentifiers(body) {
  const names = new Set()

  // 去掉注释和字符串，避免误匹配
  const code = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')

  // 被调用： foo(  但排除关键字（if/for/while/switch/catch/return/function）
  const callRe = /\b([A-Za-z_$][\w$]*)\s*\(/g
  const KEYWORDS = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof',
    'await', 'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'try',
    'finally', 'throw', 'case', 'break', 'continue', 'yield', 'instanceof',
    // 下面这些是关键字/语法糖，不是变量
    'async', 'get', 'set', 'static', 'super', 'extends', 'import', 'export',
    'default', 'from', 'as', 'with'
  ])
  let m
  while ((m = callRe.exec(code)) !== null) {
    const name = m[1]
    if (KEYWORDS.has(name)) continue
    // 前面是 . 的（obj.method()）说明是属性，不算变量
    const before = code.slice(0, m.index).trimEnd()
    if (before.endsWith('.')) continue
    names.add(name)
  }

  return names
}

/* ------------------------------------------------------------ 输出 */

if (errors.length === 0) {
  console.log(`检查了 ${files.length} 个 .vue 文件的作用域`)
  console.log('未发现未定义变量')
  process.exit(0)
}

console.log(`发现 ${errors.length} 处未定义变量:`)
errors.forEach((e) => console.log('   ' + e))
process.exit(1)
