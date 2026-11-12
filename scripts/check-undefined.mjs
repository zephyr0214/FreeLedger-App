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
/**
 * 取 setup() 的函数体文本
 *
 * ★ 必须先跳过参数括号（bug 修复）★
 *   旧写法「从 setup 开头找第一个 {」对 setup() { ... } 没问题，
 *   但 **setup(props, { emit }) { ... }** 的第一个 { 是**解构参数**的括号，
 *   于是取到的 body 只有「emit」几个字符，
 *   后面所有检查（return 字段、未定义变量）全部空转 ——
 *   相当于本项目 19 个用这种写法的组件根本没被检查过。
 *
 *   真实代价：TxnPanel.vue 删掉了 onTagSelect 的定义，
 *   但 return 里忘了删 → 运行时 ReferenceError → 整个记账面板白屏（长按弹不出来），
 *   而专门查这类问题的脚本报了「未发现未定义变量」。
 */
function extractSetupBody(script) {
  /*
   * ★ 先把注释挖成空白再搜索（bug 修复）★
   *   直接 script.search(/setup\(/) 会命中**注释**里的提及。
   *   AppDialog.vue 的注释写着：
   *     「useMessage() 必须在组件的 setup() 里调用」
   *   于是找到的是那个假的 setup()，
   *   拿到的 body 只有 3 个字符 —— 后面所有检查全部空转。
   *
   *   做法：先生成一份「长度一致、注释部分全换成空白」的副本，
   *   在副本上搜索位置，再拿同一个下标去原文本里取内容 ——
   *   位置天然对齐，不用担心剥注释导致偏移。
   */
  const masked = script
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))

  const idx = masked.search(/\bsetup\s*\(/)
  if (idx === -1) return null

  // 1) 跳过参数区：setup 名后那对 ( ... )
  const parenStart = script.indexOf('(', idx)
  if (parenStart === -1) return null
  let pd = 0
  let pi = parenStart
  for (; pi < script.length; pi++) {
    if (script[pi] === '(') pd++
    else if (script[pi] === ')') {
      pd--
      if (pd === 0) break
    }
  }

  // 2) 参数之后的第一个 { 才是函数体
  let i = script.indexOf('{', pi)
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

/**
 * 取组件 props 声明里的名字
 *
 * ★ 为什么需要 ★
 *   props 在模板里是直接可见的（Vue 会把它们合并进渲染作用域），
 *   不需要 return。
 *   不收集就会把每个组件的 props 全部误报成「模板用了但没 return」。
 *
 * 支持两种写法：
 *   props: { foo: {...}, bar: {...} }        （Options API）
 *   props: ['foo', 'bar']                    （数组简写）
 */
function extractPropNames(script) {
  const names = new Set()
  const idx = script.search(/\bprops\s*:/)
  if (idx === -1) return names

  const objStart = script.indexOf('{', idx)
  const arrStart = script.indexOf('[', idx)
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    const end = script.indexOf(']', arrStart)
    if (end === -1) return names
    for (const part of script.slice(arrStart + 1, end).split(',')) {
      const n = part.trim().replace(/['"]/g, '')
      if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n)
    }
    return names
  }
  if (objStart === -1) return names

  let depth = 0
  const start = objStart
  let j = objStart
  for (; j < script.length; j++) {
    if (script[j] === '{') depth++
    else if (script[j] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  // ★ 先剥注释再切分★
  //   本仓库的 props 逐个都带 JSDoc 说明，不剥就会拿到「/** ... */ tags」这种片段，
  //   用 ^name: 匹配全部失败，props 一个都收不到。
  const inner = script
    .slice(start + 1, j)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join('\n')

  let d = 0
  let cur = ''
  const parts = []
  let str = null
  for (const ch of inner) {
    if (str) {
      cur += ch
      if (ch === str) str = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { str = ch; cur += ch; continue }
    if ('{[('.includes(ch)) d++
    if ('}])'.includes(ch)) d--
    if (ch === ',' && d === 0) { parts.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur)

  for (const part of parts) {
    const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(part.trim())
    if (m) names.add(m[1])
  }
  return names
}

/**
 * 取 setup 里声明的名字
 */
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
function extractReturnedNames(body, out) {
  /*
   * ★ 为什么要分两个集合（bug 修复）★
   *   return { cycle: cycleView } 这种「改名导出」里，
   *     · **键** cycle      → 模板能看见的名字
   *     · **值** cycleView  → 必须在 setup 里定义的变量
   *   旧写法只收一个 names 数组，无法区分两者：
   *     · 只收键 → cycleView 漏查（变量未定义报不出来）
   *     · 只收值 → cycle 被当成未定义（模板检查误报）
   *   所以两个都要。
   *
   * @param {string} body setup 函数体
   * @param {{keys:Set<string>, refs:Set<string>}} out 输出容器
   */
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
      /*
       * ★ 先剥注释再拆顶层逗号（bug 修复）★
       *   return 里大量带行注释，如：
       *     // 时间筛选方式（日/月/年 或 自定义起止日）
       *     dateMode, customStart,
       *   不剥的话拆出来的片段是「\n // 注释\n dateMode」，
       *   用 ^[\w$]+$ 匹配失败 → dateMode 被静默丢弃。
       *   后果很隐蔽：模板检查会把 dateMode 误报成「没 return」。
       */
      const inner = body
        .slice(start, k)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
        .join('\n')

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
        /*
         * ★ 只需要检查「缩写属性」与「值是单一标识符」的情况（bug 修复）★
         *    return { a, b: c }
         *      · a  → 缩写，要求 setup 里有 a
         *      · b: c → b 是**对象键**，不需要声明；c 才是引用，要查
         *   旧写法一律取冒号前面那个，于是
         *     return { reimburseDisabled: computed(() => props.reimburseDisabled) }
         *   会报「reimburseDisabled 未定义」—— 它明明是个键。
         */
        if (t.includes(':')) {
          const keyPart = t.slice(0, t.indexOf(':')).trim()
          const valPart = t.slice(t.indexOf(':') + 1).trim()
          // 键是模板看得见的名字
          if (/^[\w$]+$/.test(keyPart) && out) out.keys.add(keyPart)
          // 值是需要定义的变量（只有值本身就是裸标识符时）
          if (/^[\w$]+$/.test(valPart)) names.push(valPart)
          continue
        }
        if (/^[\w$]+$/.test(t)) {
          names.push(t)
          if (out) out.keys.add(t)
        }
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
  /*
   * ★ 模块级声明也要算「已定义」（bug 修复）★
   *   DateFilterBar.vue 在 export default 之外定义了
   *     const CALENDAR_Z_INDEX = 1100
   *     const PRESET_LABELS = PRESETS.map(...)
   *     function tsToDay(ts) { ... }
   *     function presetRange(key) { ... }
   *   setup 里直接用它们完全合法（模块作用域就在外面），
   *   但旧检查只看 setup 内部 —— 不补上就会把它们全部误报成未定义。
   *   取法：把 setup 食掉后剩下的部分再扫一遍声明。
   */
  const outerBody = script.replace(body, '')
  for (const n of extractDeclaredNames(outerBody)) declared.add(n)
  // props 在模板里自带可见，不需要 return
  const propNames = extractPropNames(script)
  const returnedOut = { keys: new Set(), refs: new Set() }
  const returnedRefs = extractReturnedNames(body, returnedOut)
  // 模板能看见的名字（键）
  const returnedKeys = returnedOut.keys
  // 必须定义的变量（值）—— 兼容旧变量名
  const returned = returnedRefs

  for (const name of returned) {
    if (declared.has(name) || imported.has(name)) continue
    // 常见内建，跳过
    if (['undefined', 'null', 'true', 'false', 'this'].includes(name)) continue
    errors.push(`${rel}: return 里引用了未定义的 \`${name}\``)
  }

  /* ---- 模板里引用的标识符 ----
   * 踩过的坑（这一批连续踩了两次）：
   *   TxnPanel.vue / pages/index/index.vue 里写了
   *     <TxnTagSheet :tags="tags" />
   *   setup 里 const tags = ref([]) 声明了、数据也加载了，就是**忘了 return**。
   *   模板读到 undefined，标签弹层永远是空的，
   *   而 Vue 只在控制台打一句
   *     "Property tags was accessed during render but is not defined on instance"
   *   —— 不报错、不白屏，上面所有检查也全绿。
   *
   *   return 检查只覆盖了「return 里有、声明没有」这一个方向，
   *   反过来「模板要用、return 里没有」它管不到。这里补上。
   *
   * ★ 只用「单标识符」保守判断 ★
   *   模板表达式可以很复杂（三元、调用、属性链），全量解析不值得也很容易误报。
   *   这里只查三种最确定的形态：
   *     · :prop="ident"        （绑定属性的值就是一个裸标识符）
   *     · v-if / v-else-if / v-show="ident"
   *     · {{ ident }}
   *   函数调用的处理函数（@click="foo(t)"）只在「foo 是裸调用名」时查一次。
   */
  /*
   * ★ 只在「<script 之前」找模板★
   *   贪婪正则 /<template[\s\S]*<\/template>/ 会一直匹配到文件最后一个
   *   </template>，而仓库里的 JSDoc 注释恰好写了用法示例：
   *     <template #right><text @click="goEdit">编辑</text></template>
   *   于是脚本注释被当成真模板，报出 goBack / goEdit 未定义。
   *   先把 code 截断到 <script 之前就干净了。
   */
  const scriptAt = code.search(/<script[^>]*>/)
  const tplSource = scriptAt === -1 ? code : code.slice(0, scriptAt)
  const tplMatch = tplSource.match(/<template[^>]*>([\s\S]*)<\/template>/)
  if (tplMatch) {
    /*
     * ★ 先剥掉 HTML 注释 ★
     *   本仓库注释里大量出现示例代码（如 .vue 说明里写
     *   `@click="onClick('right')"`），不剥掉就会被当成真实模板
     *   而误报「onClick 未定义」。
     */
    const tpl = tplMatch[1].replace(/<!--[\s\S]*?-->/g, '')

    /*
     * ★ v-for 的循环变量是模板作用域内的局部名字 ★
     *   v-for="(item, ii) in blk.items" 里的 item / ii
     *   只在那个元素内可见，不需要 setup return。
     *   不收集它们会把 useTemplate 里常见的 (v, i) 全误报。
     */
    const loopVars = new Set()
    const forRe = /v-for\s*=\s*"\s*\(?([^)"]+?)\)?\s+in\s/g
    let fm
    while ((fm = forRe.exec(tpl)) !== null) {
      for (const part of fm[1].split(',')) {
        const n = part.trim().split(/\s/)[0]
        if (/^[A-Za-z_$][\w$]*$/.test(n)) loopVars.add(n)
      }
    }

    const returnedSet = returnedKeys
    // 模板里合法可见的额外名字：组件（PascalCase）、以及上面已判定的声明/导入
    const templateOk = new Set([
      'true', 'false', 'null', 'undefined', 'this',
      // 模板常用的小工具（Vue 内置 / uni-app 注入）
      'Math', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object',
      'Date', 'parseInt', 'parseFloat', 'uni', 'plus', '$event', 'item', 'index',
      // 模板里内置可用的实例属性
      '$emit', '$refs', '$attrs', '$slots', '$props', '$el', '$parent'
    ])
    /*
     * ★ 模板作用域只看 return / props / v-for 变量（关键）★
     *   这里**故意不包含** declared 和 imported ——
     *   setup() 写法下，模板能看见的只有「setup 返回的东西」+ props + 循环变量。
     *   一个在 setup 内部声明却没 return 的变量，模板拿到的是 undefined；
     *   这正是本次要抓的 bug（tags / onTagSelect 两次都栽在这）。
     *   把 declared 放进来等于把要查的问题本身当成豁免条件。
     */
    const isSkippable = (n) =>
      returnedSet.has(n) || templateOk.has(n) ||
      loopVars.has(n) || propNames.has(n) ||
      // 组件名（PascalCase / 带连字符）不是表达式里的变量
      /^[A-Z]/.test(n) || n.includes('-')

    const tplNames = new Set()

    // 1) 绑定属性 / 条件指令：值是一个裸标识符
    const bareRe = /(?::[\w.-]+|v-if|v-else-if|v-show|v-model|v-for)\s*=\s*"([^"]*)"/g
    let tm
    while ((tm = bareRe.exec(tpl)) !== null) {
      const expr = tm[1].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(expr)) tplNames.add(expr)
    }

    // 2) 插值 {{ ident }}
    const mustacheRe = /\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}/g
    while ((tm = mustacheRe.exec(tpl)) !== null) tplNames.add(tm[1])

    // 3) 事件处理函数：@click="foo" 或 @click="foo(...)"
    const handlerRe = /@[\w.-]+(?:\.[\w-]+)*\s*=\s*"\s*([A-Za-z_$][\w$]*)/g
    while ((tm = handlerRe.exec(tpl)) !== null) tplNames.add(tm[1])

    for (const name of tplNames) {
      if (isSkippable(name)) continue
      errors.push(`${rel}: 模板里用了 \`${name}\`，但 setup 的 return 里没有它 —— 渲染时拿到 undefined`)
    }
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
    /*
     * ★ 前面是 $ 的也要跳过 ★
     *   正则里 `$` 算标识符字符（[\w$]），但 JS 的 \b 不把 `$` 当词字符 ——
     *   于是 `uni.$on(...)` 会拆出「on」并命中（$ 与 o 之间存在 \b，
     *   而 before 检查只排除了 `.`）。
     *   uni.$emit / $off / $nextTick 同理会误报。
     *   修法：before 以 $ 结尾时，这个「调用名」其实是 $xxx 的一部分。
     *
     *   ★ 这条修复曾经加过又被弄丢 ★
     *     它和「桌面小组件」那次提交绑在一起，
     *     后来整体回退时一并消失，于是 uni.$on 又开始误报。
     *     写在这里并说明来历，避免下次再被顺手删掉。
     */
    if (before.endsWith('$')) continue
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
