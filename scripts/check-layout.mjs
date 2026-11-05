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

/* ---------------------------------- 4. z-index 不得高于库弹层默认层级 */

// wot-design-uni 的弹层默认 z-index：
//   wd-popup / wd-action-sheet = 10
//   wd-calendar / wd-datetime-picker = 15
// 页面里自绘的浮层（如下拉面板）如果用了比这些更大的 z-index，
// 就会浮到弹层上面去（踩过的坑：日期下拉面板浮在筛选面板上）。
const LIBRARY_MODAL_Z = 15
// 自绘浮层允许的最大 z-index（要盖住页面内容，但不能盖住库弹层）
const CUSTOM_LAYER_MAX = 9

/**
 * 允许使用高层级的自绘浮层。
 * 这些都是「整屏覆盖」型的组件，与库弹层互斥出现：
 *   - AppTabBar    圆角悬浮底栏 + 记账按钮，永驻在页面最上层，
 *                  但低于记账面板/速记条（那两个要盖住它）
 *   - QuickAddBar  速记输入条
 *   - UpdateDialog 更新提示，见下方理由
 */
const HIGH_LAYER_ALLOWLIST = [
  { file: 'components/AppTabBar.vue', reason: '悬浮底栏，需压住页面内容但低于弹层' },
  { file: 'components/QuickAddBar.vue', reason: '速记输入条，与弹层互斥' },
  {
    file: 'components/UpdateDialog.vue',
    /*
     * ★ 它不是「页面内浮层」，而是全局提示 ★
     *   用户实测反馈：更新弹窗弹出来时，底下的悬浮底栏（300）
     *   和中间的 + 按钮（600）从遮罩里穿出来、还能点 ——
     *   因为它按「页面内浮层」的约定写了 z-index: 9。
     *
     *   更新提示要盖住整屏，所以取 900：
     *     · 高于底栏 300 / 速记条 600 / 库弹层 15
     *     · 低于 AppDialog 的 1000 —— 下载失败、授权引导的确认框
     *       要能盖在它上面（那才是用户要看的最后一层）
     *   它与记账面板（wd-popup）互斥出现，不会出现「盖住库弹层」的问题。
     */
    reason: '全局更新提示，需压住悬浮底栏与速记条，但低于 AppDialog'
  }
]

for (const file of files) {
  if (!file.endsWith('.vue')) continue
  const code = readFileSync(file, 'utf-8')
  const rel = relative(ROOT, file).replace(/\\/g, '/')

  const allowed = HIGH_LAYER_ALLOWLIST.find((a) => rel.endsWith(a.file))

  // 找出所有 z-index: N
  const re = /z-index:\s*(\d+)/g
  let m
  while ((m = re.exec(code)) !== null) {
    const z = Number(m[1])
    if (z <= CUSTOM_LAYER_MAX) continue

    const lineStart = code.lastIndexOf('\n', m.index) + 1
    const lineEnd = code.indexOf('\n', m.index)
    const line = code.slice(lineStart, lineEnd === -1 ? code.length : lineEnd)
    const lineNo = code.slice(0, m.index).split('\n').length

    // 明确标注为「库弹层」的 z-index 是允许的
    if (/弹层|popup|modal|filter-panel|筛选/i.test(line)) continue

    // 白名单组件：整文件放行（它们是整屏覆盖型，与库弹层互斥）
    if (allowed) continue

    errors.push(
      `${rel}:${lineNo} z-index: ${z} 高于库弹层默认层级（${LIBRARY_MODAL_Z}）—— ` +
      `自绘浮层会盖在 wd-popup 等弹层上面。页面内浮层建议用 1~${CUSTOM_LAYER_MAX}；` +
      `确实需要整屏覆盖请加进 HIGH_LAYER_ALLOWLIST 并写清理由`
    )
  }
}

/* ------------------------------- 5. template 里不许直接写 <svg> 标签 */

/**
 * ★ 踩过的坑 ★
 *   uni-app 的 template 不做 HTML 解析，只认 view / text / image 等内置组件。
 *   直接写 <svg>...</svg> 会被当成文本节点忽略：
 *   编译期不报错，运行时就是一片空白。
 *   （折线图用 <svg> 画过，结果真机上什么都看不到。）
 *
 *   要画 SVG，只能把 SVG 拼成字符串，
 *   用 <image> 以 data:image/svg+xml;base64（或 URI 编码）加载。
 *   App 端跑在 WebView 上，WebView 支持 SVG。
 */
for (const file of files) {
  if (!file.endsWith('.vue')) continue
  const code = readFileSync(file, 'utf-8')
  const rel = relative(ROOT, file).replace(/\\/g, '/')

  const tm = code.match(/<template>([\s\S]*)<\/template>/)
  if (!tm) continue

  const svgRe = /<\s*svg[\s>]/g
  let m
  while ((m = svgRe.exec(tm[1])) !== null) {
    // tm[1] 是模板内容，用它的起始位置换算行号
    const tplStart = code.indexOf('<template>')
    const lineNo = code.slice(0, tplStart + m.index).split('\n').length
    errors.push(
      `${rel}:${lineNo} template 里直接写了 <svg> 标签 —— ` +
      'uni-app 不解析它，会被当文本节点忽略，运行时一片空白。' +
      '请把 SVG 拼成字符串，用 <image> 以 data:image/svg+xml 加载'
    )
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
