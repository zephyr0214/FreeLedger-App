/**
 * 组件事件检查 —— 防止「自定义事件名撞原生事件」导致监听失效
 *
 *   node scripts/check-events.mjs
 *
 * 背景：
 *   FabButton 原来声明 emits: ['tap', ...]，父组件写 <FabButton @tap="openQuickAdd">。
 *   但 tap 在 uni-app 模板里是原生事件的别名，@tap 会被编译成
 *   监听根节点的原生 tap/click，而不是监听组件 emit 出来的自定义事件，
 *   结果单击毫无反应，且不报任何错。
 *
 * 检查：
 *   1. 组件 emits 里不许出现与原生事件同名的项
 *   2. 父组件对自定义组件的 @xxx 绑定，必须在对方 emits 里声明过
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

/**
 * uni-app / 浏览器原生事件名，组件自定义事件不要用这些。
 *
 * ★ finish 也在列表里 ★
 *   finish 是 HTML 规范中的表单事件（<form> 的 finish）。
 *   踩过的坑：NumberKeyboard 用 emits: ['finish']，父组件写 @finish，
 *   模板编译把 @finish 当成原生事件透传到根节点（wd-popup），
 *   组件 emit('finish') 父组件收不到 —— 表现为「点完成毫无反应」，
 *   控制台报 Property "onFinish" was accessed during render but is not defined。
 *   改名为 submit-amount 后正常。
 */
const RESERVED_EVENTS = new Set([
  'tap', 'longtap', 'longpress', 'click', 'dblclick',
  'touchstart', 'touchmove', 'touchend', 'touchcancel',
  'input', 'change', 'focus', 'blur', 'submit', 'reset', 'finish',
  'scroll', 'scrolltoupper', 'scrolltolower',
  'load', 'error', 'open', 'close',
  'confirm', 'cancel', 'play', 'pause', 'ended',
  'resize', 'keydown', 'keyup',
  'select', 'invalid', 'toggle', 'beforeinput', 'compositionstart'
])

let errors = []
let warnings = []

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

const files = walk(ROOT)

/* ------------------------------------- 1. 检查组件 emits 是否撞原生事件 */

/** 收集每个组件声明的 emits 和 name */
const componentEmits = {}   // name -> Set(emits)

for (const file of files) {
  const code = readFileSync(file, 'utf-8')
  const rel = relative(ROOT, file)
  if (!rel.startsWith('components')) continue

  // name
  const nameMatch = code.match(/name:\s*['"]([\w-]+)['"]/)
  const compName = nameMatch ? nameMatch[1] : null

  // emits 数组
  const emitsMatch = code.match(/emits:\s*\[([^\]]*)\]/)
  if (!emitsMatch) continue

  const emits = emitsMatch[1]
    .split(',')
    .map((s) => s.trim().replace(/['"]/g, ''))
    .filter(Boolean)

  if (compName) componentEmits[compName] = new Set(emits)

  for (const e of emits) {
    if (RESERVED_EVENTS.has(e)) {
      errors.push(
        `${rel}: 自定义事件 \`${e}\` 与原生事件同名 —— ` +
        `父组件 @${e} 会被编译成原生事件监听，组件 emit('${e}') 收不到。请改名`
      )
    }
  }
}

/* -------------------------- 2. 检查父组件绑定的自定义事件是否已声明 */

for (const file of files) {
  const code = readFileSync(file, 'utf-8')
  const rel = relative(ROOT, file)
  if (!rel.startsWith('pages')) continue

  // 找所有 <Component @xxx="..."> 形式，只针对已知组件
  for (const [compName, emits] of Object.entries(componentEmits)) {
    // 匹配 <CompName ...> 或 <comp-name ...>
    const tagRe = new RegExp(`<${compName}\\b([^>]*)>`, 'g')
    let m
    while ((m = tagRe.exec(code)) !== null) {
      const attrs = m[1]
      const bindRe = /@([\w-]+)/g
      let b
      while ((b = bindRe.exec(attrs)) !== null) {
        const evt = b[1]
        // v-model 展开的是 update:modelValue
        if (evt === 'update') continue
        if (!emits.has(evt)) {
          warnings.push(
            `${rel}: <${compName}> 绑定了 @${evt}，但组件没声明该事件`
          )
        }
      }
    }
  }
}

/* ---------------------------------------------------------------- 输出 */

if (warnings.length > 0) {
  console.log(`警告 ${warnings.length} 条:`)
  warnings.forEach((w) => console.log('   ' + w))
  console.log()
}

if (errors.length > 0) {
  console.log(`❌ 错误 ${errors.length} 条:`)
  errors.forEach((e) => console.log('   ' + e))
  process.exit(1)
}

console.log(`检查了 ${files.length} 个 .vue 文件的事件声明`)
console.log('✅ 事件名无冲突')
