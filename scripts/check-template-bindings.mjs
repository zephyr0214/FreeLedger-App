/**
 * 模板绑定检查 —— 找出「setup 里定义了函数，但没在 return 里暴露」的情况
 *
 *   node scripts/check-template-bindings.mjs
 *
 * 背景（踩过的坑）：
 *   TxnPanel 模板里写了 @submit-amount="onFinish"，
 *   但 setup() 的 return 里漏了 onFinish，
 *   事件绑定静默失效 —— 表现为「点完成毫无反应」，
 *   只有控制台的 Vue warn 能看出来：
 *     Property "onFinish" was accessed during render but is not defined on instance.
 *
 *   语法检查、模板编译、作用域检查全都查不出来
 *   （模板编译不校验绑定目标是否存在）。
 *
 * 检查策略（只看函数，避开 v-for 局部变量等噪音）：
 *   1. 找出 setup() 里定义的所有函数名
 *   2. 找出模板 @event="fn" 里引用的函数名
 *   3. 若 fn 在 setup 里定义了、却被模板引用 → 必须出现在 return 里
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

/** 模板里可以直接用、不需要 return 的东西 */
const BUILTIN = new Set([
  'true', 'false', 'null', 'undefined', '$event', 'item', 'index',
  '$emit', '$refs', '$props', '$slots', '$attrs', '$nextTick'
])

let errors = []

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'unpackage', '.git', 'dist', 'scripts'].includes(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

/** 取出 setup() 的函数体（按大括号配对） */
function extractSetupBody(script) {
  const idx = script.search(/\bsetup\s*\(/)
  if (idx === -1) return null

  // ★ 先跳过参数列表 ★
  //   setup(props, { emit }) { ... } —— 参数里的解构也有大括号，
  //   直接找第一个 '{' 会取到 { emit }，导致函数体提取错误。
  let p = script.indexOf('(', idx)
  if (p === -1) return null
  let pDepth = 0
  let i = p
  for (; i < script.length; i++) {
    if (script[i] === '(') pDepth++
    else if (script[i] === ')') {
      pDepth--
      if (pDepth === 0) break
    }
  }
  if (i >= script.length) return null

  // 参数列表之后才是函数体的 {
  const braceIdx = script.indexOf('{', i)
  if (braceIdx === -1) return null

  let depth = 0
  const start = braceIdx
  for (let j = braceIdx; j < script.length; j++) {
    if (script[j] === '{') depth++
    else if (script[j] === '}') {
      depth--
      if (depth === 0) return script.slice(start + 1, j)
    }
  }
  return null
}

/** 去掉字符串和注释，避免误匹配 */
function stripLiterals(code) {
  return code
    .replace(/`(?:\\.|[^`\\])*`/g, '``')      // 模板字符串
    .replace(/'(?:\\.|[^'\\])*'/g, "''")      // 单引号
    .replace(/"(?:\\.|[^"\\])*"/g, '""')      // 双引号
    .replace(/\/\*[\s\S]*?\*\//g, '')           // 块注释
    .replace(/\/\/[^\n]*/g, '')                // 行注释
}

/** setup 里定义的函数名 */
function extractDefinedFunctions(body) {
  const code = stripLiterals(body)
  const names = new Set()
  const fnRe = /\bfunction\s+([\w$]+)\s*\(/g
  let m
  while ((m = fnRe.exec(code)) !== null) names.add(m[1])

  // const foo = (...) => {}  /  const foo = function () {}
  const arrowRe = /\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/g
  while ((m = arrowRe.exec(code)) !== null) names.add(m[1])

  return names
}

/** setup 的 return 里暴露的名字 */
function extractReturnedNames(body) {
  const code = stripLiterals(body)
  const names = new Set()

  // 只找最外层的 return { ... }
  const re = /\breturn\s*\{/g
  let m
  while ((m = re.exec(code)) !== null) {
    const openIdx = m.index + m[0].length - 1
    let depth = 0
    let i = openIdx
    let end = -1
    for (; i < code.length; i++) {
      if (code[i] === '{') depth++
      else if (code[i] === '}') {
        depth--
        if (depth === 0) { end = i; break }
      }
    }
    if (end === -1) continue
    const inner = code.slice(openIdx + 1, end)

    // 顶层逗号切分
    let d = 0
    let cur = ''
    const parts = []
    for (const ch of inner) {
      if ('{[('.includes(ch)) d++
      else if ('}])'.includes(ch)) d--
      if (ch === ',' && d === 0) {
        parts.push(cur)
        cur = ''
      } else cur += ch
    }
    if (cur.trim()) parts.push(cur)

    for (const p of parts) {
      const t = p.trim()
      if (!t) continue
      // "a"  |  "a: expr"  |  "a = expr"
      let key = t
      if (t.includes(':')) key = t.slice(0, t.indexOf(':'))
      else if (t.includes('=')) key = t.slice(0, t.indexOf('='))
      key = key.trim()
      if (/^[\w$]+$/.test(key)) names.add(key)
    }
  }
  return names
}

/**
 * 模板 @event="fn" 里引用的函数名。
 *
 * ★ 不要对模板做 stripLiterals ★
 *   模板里到处是 placeholder="..." 这类属性值，
 *   把双引号内容清空会把 @submit-amount="onFinish" 变成 @submit-amount=""，
 *   handler 名直接丢失。这里直接用正则取属性值，不做剥离。
 */
function extractHandlerRefs(template) {
  const refs = new Set()
  const handlerRe = /(?:\@|v-on:)[a-zA-Z0-9_\-:.]+="([^"]+)"/g
  let m
  while ((m = handlerRe.exec(template)) !== null) {
    const expr = m[1].trim()
    // fn(...)  或  fn
    const callMatch = expr.match(/^([\w$]+)\s*\(/)
    if (callMatch) refs.add(callMatch[1])
    else if (/^[\w$]+$/.test(expr)) refs.add(expr)
  }
  return refs
}

const files = walk(ROOT)

for (const file of files) {
  const code = readFileSync(file, 'utf-8')
  const rel = relative(ROOT, file)

  const scriptMatch = code.match(/<script[^>]*>([\s\S]*?)<\/script>/)
  if (!scriptMatch) continue

  const body = extractSetupBody(scriptMatch[1])
  if (!body) continue

  const defined = extractDefinedFunctions(body)
  const returned = extractReturnedNames(body)

  const tmplMatch = code.match(/<template>([\s\S]*)<\/template>/)
  if (!tmplMatch) continue

  const refs = extractHandlerRefs(tmplMatch[1])

  for (const ref of refs) {
    if (BUILTIN.has(ref)) continue
    // 只关心「setup 里定义了、但没 return」的函数
    if (!defined.has(ref)) continue
    if (returned.has(ref)) continue
    errors.push(
      `${rel}: 模板的 @事件绑定了 \`${ref}\`，但 setup() 的 return 里没有它 —— ` +
      '事件不会触发（Vue 只报 warn，不报错）'
    )
  }
}

/* ------------------- scroll-into-view 的目标必须有对应的 id ------------------- */

/**
 * 踩过的坑：
 *   AI 助手页每次进去都跳到最顶部。
 *   原因是 scroll-into-view 绑的是 'bottom-anchor'，
 *   但那个元素**只有 class、没有 id** ——
 *   scroll-into-view 靠 id 找元素，找不到就什么都不做，
 *   列表停在初始位置（顶部）。
 *
 * 这里检查：模板里 :scroll-into-view="xxx" 的 xxx（如果是字面量），
 * 必须能在模板里找到一个 id="xxx" 的元素。
 */
for (const file of files) {
  const code = readFileSync(file, 'utf-8')
  const rel = relative(ROOT, file)

  const tmplMatch = code.match(/<template>([\s\S]*)<\/template>/)
  if (!tmplMatch) continue
  const tmpl = tmplMatch[1]

  // 只取字面量的 scroll-into-view（绑定变量的没法静态判断）
  const re = /:scroll-into-view\s*=\s*"([A-Za-z0-9_-]+)"/g
  let m
  while ((m = re.exec(tmpl)) !== null) {
    const target = m[1]
    // 绑定的是变量（不是字面量 id）-> 没法静态判断，跳过
    if (/^[a-z]/.test(target)) continue
    const idRe = new RegExp(`\\bid\\s*=\\s*["']${target}["']`)
    if (!idRe.test(tmpl)) {
      const lineNo = code.slice(0, code.indexOf(tmpl) + m.index).split('\n').length
      errors.push(
        `${rel}:${lineNo} scroll-into-view 指向 "${target}"，但模板里没有 id="${target}" 的元素 —— ` +
        'scroll-into-view 靠 id 定位，找不到就会停在当前位置（表现为列表跳到顶部）'
      )
    }
  }
}

if (errors.length > 0) {
  console.log(`❌ 发现 ${errors.length} 处模板绑定问题:\n`)
  errors.forEach((e) => console.log('   ' + e))
  console.log('\n提示: setup() 里定义的函数若要在模板里用，必须出现在 return 中')
  process.exit(1)
}

console.log(`检查了 ${files.length} 个 .vue 文件的模板事件绑定`)
console.log('✅ 所有模板绑定的处理函数都已正确暴露')
