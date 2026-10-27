/**
 * 主题检查 —— 防止「切了主题但某处没跟上」这类问题复发
 *
 *   node scripts/check-theme.mjs
 *
 * 检查项：
 *   1. buildCssVars() 必须注入组件库的主色变量（--wot-color-theme 等）
 *   2. 每个页面的根节点必须带 :class="settingStore.wotClass"
 *      （组件库的深色样式靠祖先的 .wot-theme-dark 类切换，不是靠 CSS 变量）
 *   3. 4 个 tab 页的 onShow 必须调 refreshTabBar()
 *      （uni.setTabBarStyle 在非 tabBar 页面调用无效，
 *        主题设置页是子页面，所以只能靠 tab 页 onShow 刷）
 *   4. setThemeMode / setThemePreset 里 applyTheme() 必须在 await 写库之前
 *      （否则主题切换慢一拍）
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
    if (['node_modules', 'unpackage', '.git', 'dist', 'scripts'].includes(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (name.endsWith('.vue') || name.endsWith('.js')) out.push(full)
  }
  return out
}

const files = walk(ROOT)

/* ---------------------------------------- 1. 组件库主色变量 */

const themeCode = readFileSync(join(ROOT, 'utils/theme.js'), 'utf-8')

if (!themeCode.includes('--wot-color-theme')) {
  errors.push(
    'utils/theme.js: buildCssVars() 必须注入 --wot-color-theme —— ' +
    '否则 wd-button type="primary" 用的是库默认蓝，不跟主题色走'
  )
}
if (!themeCode.includes('--wot-dark-background')) {
  errors.push(
    'utils/theme.js: buildCssVars() 必须注入 --wot-dark-background 等深色变量'
  )
}
if (!themeCode.includes('wotThemeClass')) {
  errors.push(
    'utils/theme.js: 必须导出 wotThemeClass() —— ' +
    "组件库的深色样式靠祖先的 .wot-theme-dark 类切换（见 wd-button/index.scss）"
  )
}

/* ------------------------------------ 2. 页面根节点要带 wot class */

/**
 * 取 setup() 的函数体（按大括号配对，跳过参数列表）。
 * 与 check-template-bindings.mjs 里的同名函数保持一致。
 */
function extractSetupBody(script) {
  const idx = script.search(/\bsetup\s*\(/)
  if (idx === -1) return null
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
  const braceIdx = script.indexOf('{', i)
  if (braceIdx === -1) return null
  let depth = 0
  for (let j = braceIdx; j < script.length; j++) {
    if (script[j] === '{') depth++
    else if (script[j] === '}') {
      depth--
      if (depth === 0) return script.slice(braceIdx + 1, j)
    }
  }
  return null
}

/** setup 的 return 里暴露的名字 */
function extractReturnedNames(body) {
  const code = body
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
  const names = new Set()
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
    let d = 0
    let cur = ''
    const parts = []
    for (const ch of inner) {
      if ('{[('.includes(ch)) d++
      else if ('}])'.includes(ch)) d--
      if (ch === ',' && d === 0) { parts.push(cur); cur = '' } else cur += ch
    }
    if (cur.trim()) parts.push(cur)
    for (const p of parts) {
      const t = p.trim()
      if (!t) continue
      let key = t
      if (t.includes(':')) key = t.slice(0, t.indexOf(':'))
      else if (t.includes('=')) key = t.slice(0, t.indexOf('='))
      key = key.trim()
      if (/^[\w$]+$/.test(key)) names.add(key)
    }
  }
  return names
}

for (const file of files) {
  if (!file.endsWith('.vue')) continue
  const rel = relative(ROOT, file)
  if (!rel.startsWith('pages')) continue

  const code = readFileSync(file, 'utf-8')
  const rootMatch = code.match(/<view class="app-page"[^>]*>/)
  if (!rootMatch) continue

  if (!rootMatch[0].includes('settingStore.wotClass')) {
    errors.push(
      `${rel}: 根节点缺少 :class="settingStore.wotClass" —— ` +
      '组件库的深色样式（弹层背景、按钮文字）不会跟着切换'
    )
  }

  /* ---- 模板里用了 settingStore.xxx，setup() 就必须 return settingStore ----
   * 踩过的坑：批量加 class 时只改了模板、没改 setup() 的 return，
   * 9 个页面（含「主题外观」页）在模板里读 settingStore.wotClass，
   * 而 settingStore 在 setup 里是 undefined → 读属性抛 TypeError → 整页白屏。
   * Vue 只在控制台 warn，不报错，check-template-bindings.mjs 又只查函数绑定，
   * 所以必须单独查。
   */
  const sm = code.match(/<script[^>]*>([\s\S]*?)<\/script>/)
  const tm = code.match(/<template>([\s\S]*)<\/template>/)
  if (!sm || !tm) continue
  if (!/settingStore\s*\./.test(tm[1])) continue

  const body = extractSetupBody(sm[1])
  if (!body) continue
  const returned = extractReturnedNames(body)
  if (!returned.has('settingStore')) {
    errors.push(
      `${rel}: 模板里用了 settingStore.，但 setup() 的 return 里没有 settingStore —— ` +
      '模板里读的是 undefined 的属性，会抛 TypeError 导致整页白屏'
    )
  }
}

/* ------------------------------- 3. tab 页 onShow 要刷 tabBar */

const TAB_PAGES = [
  'pages/index/index.vue',
  'pages/account/index.vue',
  'pages/stats/index.vue',
  'pages/mine/index.vue'
]

for (const rel of TAB_PAGES) {
  const file = join(ROOT, rel)
  const code = readFileSync(file, 'utf-8')

  if (!code.includes('refreshTabBar')) {
    errors.push(
      `${rel}: onShow 里缺少 settingStore.refreshTabBar() —— ` +
      '主题设置页是子页面（没有 tabBar 实例），uni.setTabBarStyle 在那里无效，' +
      '只能靠 tab 页 onShow 刷新'
    )
  }
}

/* ----------------------- 4. applyTheme 要在 await 写库之前 */

const storeCode = readFileSync(join(ROOT, 'stores/setting.js'), 'utf-8')

for (const fn of ['setThemeMode', 'setThemePreset']) {
  const re = new RegExp(`async ${fn}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n  \\}`)
  const m = storeCode.match(re)
  if (!m) {
    warnings.push(`stores/setting.js: 找不到 ${fn}()`)
    continue
  }
  const body = m[1]
  const applyIdx = body.indexOf('applyTheme()')
  const awaitIdx = body.indexOf('await setSettings(')

  if (applyIdx === -1) {
    errors.push(`stores/setting.js: ${fn}() 里没有调 applyTheme()`)
  } else if (awaitIdx !== -1 && applyIdx > awaitIdx) {
    errors.push(
      `stores/setting.js: ${fn}() 里 applyTheme() 在 await setSettings() 之后 —— ` +
      '写库是异步的，会让主题切换慢一拍，应该先更新 UI 再写库'
    )
  }
}

/* ------------------------------------------------------------ 输出 */

if (warnings.length > 0) {
  console.log(`警告 ${warnings.length} 条:`)
  warnings.forEach((w) => console.log('   ' + w))
  console.log()
}

if (errors.length > 0) {
  console.log(`❌ 主题检查发现 ${errors.length} 个问题:\n`)
  errors.forEach((e) => console.log('   ' + e))
  process.exit(1)
}

console.log('检查了主题变量、页面根节点 class、tabBar 刷新')
console.log('✅ 主题检查通过')
