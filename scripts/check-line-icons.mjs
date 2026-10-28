/**
 * 线性描边图标的校验
 *
 *   node scripts/check-line-icons.mjs
 *
 * 检查项：
 *   1. 必备的图标 key 一个都不能少
 *   2. 每个 key 都有 path，且是描边风格（SVG 根节点 fill="none" + stroke）
 *   3. 生成的 data URI 能正确解码回原 SVG
 *   4. 未知 key 有兜底（返回通用圆点，不抛异常、不返回空）
 *   5. 组件里用到的 key 都在 LINE_ICON_KEYS 里
 *   6. 组件模板里不许出现 <svg> 标签（uni-app 不解析它）
 *   7. 组件用 <image> + data URI 加载（不是 <svg> 标签）
 *
 * ★ 为什么要有这个检查 ★
 *   图标是「拼字符串」出来的，错了不会报错，只会显示一片空白或者
 *   一个方框（比如 '#' 没编码就被当成 URL fragment）。
 *   这些都必须靠检查脚本拦。
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, dirname, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import { LINE_ICON_KEYS, lineIconSvg, lineIconDataUri, lineIconPaths, isFallbackIcon } from '../utils/lineIcons.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

let errors = []
let warnings = []

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    errors.push(`${name}\n      实际 ${a}\n      期望 ${e}`)
  }
}

/* ------------------------------------------------- 1. 必备的图标 key */

const REQUIRED_KEYS = [
  'category', 'tag', 'budget', 'theme', 'ai',
  'data', 'backup', 'about', 'cycle', 'account',
  'home', 'stats', 'mine', 'plus', 'edit',
  'trash', 'check', 'close'
]

for (const key of REQUIRED_KEYS) {
  check(`必备图标 key「${key}」存在`, LINE_ICON_KEYS.includes(key), true)
}

/* ------------------------------------------- 2. 每个 key 都是描边风格 */

for (const key of LINE_ICON_KEYS) {
  const paths = lineIconPaths(key)
  check(`图标「${key}」至少有一条 path`, Array.isArray(paths) && paths.length > 0, true)

  const svg = lineIconSvg(key, { size: 24, color: '#07C160', strokeWidth: 1.8 })

  // 描边风格：根节点 fill="none"，并且有 stroke
  check(`图标「${key}」是描边风格（fill=none）`, svg.includes('fill="none"'), true)
  check(`图标「${key}」有 stroke`, /stroke="[^"]+"/.test(svg), true)
  check(`图标「${key}」有 stroke-width`, /stroke-width="[\d.]+"/.test(svg), true)
  check(`图标「${key}」圆角端点`, svg.includes('stroke-linecap="round"'), true)
  check(`图标「${key}」圆角连接`, svg.includes('stroke-linejoin="round"'), true)
  check(`图标「${key}」viewBox 是 24x24`, svg.includes('viewBox="0 0 24 24"'), true)
  check(`图标「${key}」带 xmlns`, svg.includes('xmlns="http://www.w3.org/2000/svg"'), true)

  // 只允许 path 元素 —— 圆/椭圆也要写成 path，风格才统一
  const tags = svg.match(/<[a-zA-Z][^>\s]*/g) || []
  const badTags = tags.filter((t) => !['<svg', '<path', '</svg>'].includes(t))
  check(`图标「${key}」只用 path 元素`, badTags, [])

  // path 的 d 不能为空
  for (const d of paths) {
    check(`图标「${key}」的 path d 非空`, typeof d === 'string' && d.trim().length > 0, true)
  }
}

/* ------------------------------------- 3. data URI 编码正确、能解码回来 */

{
  const key = LINE_ICON_KEYS[0]
  const opts = { size: 24, color: '#07C160', strokeWidth: 1.8 }
  const uri = lineIconDataUri(key, opts)

  check('data URI 前缀正确', uri.startsWith('data:image/svg+xml;charset=utf-8,'), true)
  // '#' 必须被编码，否则会被当成 URL 的 fragment
  check("data URI 里的 '#' 已编码", uri.includes('%23'), true)

  const decoded = decodeURIComponent(uri.replace('data:image/svg+xml;charset=utf-8,', ''))
  check('data URI 解码回来等于原 SVG', decoded, lineIconSvg(key, opts))
  check('解码回来的 SVG 有 path', decoded.includes('<path'), true)
}

/* ---------------------------------------------- 4. 未知 key 必须有兜底 */

{
  const fallbackSvg = lineIconSvg('__not_a_real_key__', { color: '#07C160' })
  check('未知 key 不返回空', fallbackSvg.length > 0, true)
  check('未知 key 有 path（兜底圆点）', fallbackSvg.includes('<path'), true)
  check('未知 key 也是描边风格', fallbackSvg.includes('fill="none"'), true)

  // 兜底的 data URI 也要能用
  const uri = lineIconDataUri('__not_a_real_key__', { color: '#07C160' })
  check('未知 key 的 data URI 非空', uri.startsWith('data:image/svg+xml;charset=utf-8,'), true)

  // 兜底图标跟真实图标要长得不一样（否则测不出来）
  const real = lineIconSvg('category', { color: '#07C160' })
  check('兜底图标跟真实图标不同', fallbackSvg !== real, true)

  // isFallbackIcon 要能正确分辨
  check('isFallbackIcon：未知 key 是兜底', isFallbackIcon('__not_a_real_key__'), true)
  check('isFallbackIcon：真实 key 不是兜底', isFallbackIcon('category'), false)
  check('isFallbackIcon：空 key 是兜底', isFallbackIcon(''), true)
}

/* --------------------------- 5. currentColor 在 data URI 里要换成真色 */

{
  const uri = lineIconDataUri('category', { color: 'currentColor' })
  check('currentColor 在 data URI 里被替换掉', uri.includes('currentColor'), false)
  check('currentColor 被换成真实颜色', decodeURIComponent(uri).includes('stroke="#333333"'), true)
}

/* ------------------------------------- 6/7. 组件本身：key 对得上 + 不用 <svg> */

const COMPONENT_REL = 'components/LineIcon.vue'
const COMPONENT_PATH = join(ROOT, COMPONENT_REL)

if (!existsSync(COMPONENT_PATH)) {
  errors.push(`${COMPONENT_REL}: 文件不存在`)
} else {
  const code = readFileSync(COMPONENT_PATH, 'utf-8')
  const { descriptor } = parse(code, { filename: COMPONENT_REL })
  const template = descriptor.template ? descriptor.template.content : ''

  // 模板里不许直接写 <svg>（uni-app 不解析它）
  check('组件模板里没有 <svg> 标签', /<\s*svg[\s>]/i.test(template), false)
  // 必须用 <image> 加载
  check('组件模板里用了 <image>', /<image\b/.test(template), true)
  check('组件模板里绑定了 src', /:src="src"/.test(template), true)

  // 模板能编译通过
  const compiled = compileTemplate({
    source: template,
    filename: COMPONENT_REL,
    id: COMPONENT_REL
  })
  check('组件模板编译无错误', (compiled.errors || []).length, 0)

  // 组件引用的图标 key 必须在 LINE_ICON_KEYS 里
  const keyRe = /name="([a-zA-Z0-9_]+)"/g
  let m
  while ((m = keyRe.exec(code)) !== null) {
    // 只查模板里 name="xxx" 这种字面量（默认值 'currentColor' 之类不算）
    if (!template.includes(m[0])) continue
    check(`组件里用到的 key「${m[1]}」在图标库里`, LINE_ICON_KEYS.includes(m[1]), true)
  }

  // 组件必须正确引入图标库
  check('组件引入了 utils/lineIcons.js', /from\s+['"]@\/utils\/lineIcons\.js['"]/.test(code), true)
}

/* ------------------- 6b. 用 LineIcon 的页面，icon 取值必须都在图标库里 */

{
  const pagesDir = join(ROOT, 'pages')
  const files = readdirSync(pagesDir, { recursive: true })
    .filter((f) => f.endsWith('.vue'))
    .map((f) => join(pagesDir, f))

  for (const file of files) {
    const code = readFileSync(file, 'utf-8')
    // 这个页面用了 LineIcon
    if (!/<LineIcon\b/.test(code)) continue

    const rel = relative(ROOT, file).replace(/\\/g, '/')

    // ★ 只查 <LineIcon name="xxx"> 的字面量 name ★
    //   页面里其它地方出现的 icon: 'more' 之类是**分类的 emoji** key
    //   （见 utils/icons.js 的 ICON_MAP），跟线性图标库没关系 ——
    //   混在一起查会误报。
    const literalRe = /<LineIcon\b[^>]*?\bname="([a-zA-Z0-9_-]+)"/g
    let m
    while ((m = literalRe.exec(code)) !== null) {
      check(`${rel}: <LineIcon name="${m[1]}"> 在图标库里`, LINE_ICON_KEYS.includes(m[1]), true)
    }

    // 绑定变量的写法：<LineIcon :name="item.icon" />
    // 这时要顺着变量找到真正的 icon 取值。
    const bindRe = /<LineIcon\b[^>]*?:name="([\w.]+)"/g
    while ((m = bindRe.exec(code)) !== null) {
      const expr = m[1]
      // 只有形如 xxx.icon / xxx.yyy.icon 的才顺着找
      if (!/\.icon$/.test(expr)) continue

      // 找页面里所有 icon: 'key' 的字面量取值
      // （这些就是最终传给 LineIcon 的值）
      const TOAST_ICONS = new Set(['success', 'none', 'error', 'loading'])
      const iconRe = /\bicon\s*:\s*'([a-zA-Z0-9_-]+)'/g
      let im
      while ((im = iconRe.exec(code)) !== null) {
        const key = im[1]
        if (TOAST_ICONS.has(key)) continue
        check(`${rel}: icon「${key}」在图标库里`, LINE_ICON_KEYS.includes(key), true)
      }
    }
  }
}

/* ------------------------------------------- 8. 图标库自身的文件级检查 */

{
  const rel = relative(ROOT, join(ROOT, 'utils/lineIcons.js')).replace(/\\/g, '/')
  const code = readFileSync(join(ROOT, 'utils/lineIcons.js'), 'utf-8')

  // 不能出现 <svg 字面量在模板里……（这里是 js 文件，出现 <svg 构造标签是正常的）
  check(`${rel} 导出了 lineIconSvg`, /export function lineIconSvg/.test(code), true)
  check(`${rel} 导出了 lineIconDataUri`, /export function lineIconDataUri/.test(code), true)
  check(`${rel} 导出了 LINE_ICON_KEYS`, /export const LINE_ICON_KEYS/.test(code), true)
}

/* ---------------------------------------------------------------- 输出 */

if (warnings.length > 0) {
  console.log(`警告 ${warnings.length} 条:`)
  warnings.forEach((w) => console.log('   ' + w))
  console.log()
}

if (errors.length > 0) {
  console.log(`❌ 发现 ${errors.length} 处问题:\n`)
  errors.forEach((e) => console.log('   ' + e))
  process.exit(1)
}

console.log(`检查了 ${LINE_ICON_KEYS.length} 个线性图标`)
console.log('✅ 线性图标检查通过')
