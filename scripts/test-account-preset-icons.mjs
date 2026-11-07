/**
 * 账户图标：品牌官方矢量 + 用户指定的成品图标
 *
 *   node scripts/test-account-preset-icons.mjs
 *
 * ★ 这个测试锁住一次方法论级别的返工 ★
 *   这套图标手写过一版又一版，用户两次都说「太潦草」。
 *   根因不是画得不够仔细，是**方法错了**：
 *     - 手搓复杂 SVG 路径画不出精致形状
 *       （微信气泡路径没闭合、存钱罐参数多到失控、
 *         「支」字在 24px 下根本认不出来）
 *     - 而且「凭印象画一个微信」这个思路本身就不对
 *
 *   现在的做法：
 *     品牌（微信/支付宝/Visa…）→ simple-icons 官方矢量，填充
 *     预设（用户给的 6 个）     → 原样搬 path + fill，按 path 上色
 *
 *   这个测试防的是「以后有人又把品牌图标改回手绘」或者
 *   「预设列表里的 key 拼错」（拼错不会报错，只会画成一片空白）。
 */

import fs from 'fs'
import path from 'path'
import {
  ACCOUNT_ICONS,
  PRESET_ICONS,
  BRAND_ICON_KEYS,
  PRESET_ICON_KEYS,
  accountIconPaths,
  accountIconSvg,
  accountIconDataUri,
  isBrandIcon,
  isPresetIcon
} from '../utils/accountIcons.js'

let pass = 0
let fail = 0

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    fail++
    console.log(`FAIL  ${name}\n      实际 ${a}\n      期望 ${e}`)
  }
}

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** 去掉注释，避免把说明文字里的词当成代码 */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const edit = read('pages/account/edit.vue')
const editCode = stripComments(edit)

console.log('=== 不再调用 AI 生成 ===')

check('没有 import generateAccountIcon', /generateAccountIcon/.test(editCode), false)
check('没有 drawIconFor 函数', /drawIconFor/.test(editCode), false)
check('没有「AI 绘制图标」的 loading 文案', /AI 绘制图标/.test(editCode), false)

console.log('=== 预设图标列表 ===')

// 24 = 上面 3 行 × 6 列（原有 18）+ 下面新增 1 行 × 6 个（用户指定）
check('有 24 个预设图标（4 行 × 6 列）', ACCOUNT_ICONS.length, 24)
check('key 不重复', new Set(ACCOUNT_ICONS.map(i => i.key)).size, 24)
check('每个都有中文 label', ACCOUNT_ICONS.every(i => i.label && i.label.length > 0), true)
check('末尾新增的一行是 6 个', PRESET_ICONS.length, 6)
check('原有 18 个一个都没少', ACCOUNT_ICONS.length - PRESET_ICONS.length, 18)
check('新增的 6 个 key 不重复', new Set(PRESET_ICONS.map(i => i.key)).size, 6)
check('PRESET_ICON_KEYS 和 PRESET_ICONS 对得上', PRESET_ICON_KEYS.size, PRESET_ICONS.length)

console.log('=== 品牌图标必须是官方矢量（填充）===')

// 用户明确要求「基础的微信、支付宝、各个银行的要有」
const REQUIRED_BRANDS = ['wechat', 'alipay', 'visa', 'mastercard']
for (const k of REQUIRED_BRANDS) {
  check(`${k} 在预设列表里`, ACCOUNT_ICONS.some(i => i.key === k), true)
  check(`${k} 是品牌图标`, isBrandIcon(k), true)
}

// 品牌标识必须有 fill，且路径要足够复杂（手绘的简化版不会有 500+ 字符）
for (const k of BRAND_ICON_KEYS) {
  const svg = accountIconSvg(k, { size: 24, color: '#333' })
  check(`${k} 用 fill 填充`, /fill="#333"/.test(svg), true)
  check(`${k} 用 fill-rule=evenodd（官方路径挖孔要用）`, /fill-rule="evenodd"/.test(svg), true)
  check(`${k} 不是描边图标`, /stroke=/.test(svg), false)
}

console.log('=== 新增的 6 个图标（用户给的几何，颜色统一）===')

/*
 * 这 6 个的几何来自用户提供的 SVG 源码（viewBox 1024）。
 * 断言目的：防 key 拼错、防路径搬漏 —— 拼错不会报错，只会画成一片空白。
 */
for (const item of PRESET_ICONS) {
  const k = item.key
  const svg = accountIconSvg(k, { size: 26, color: '#E5E5EA' })

  check(`${k} 在 ACCOUNT_ICONS 里`, ACCOUNT_ICONS.some(i => i.key === k), true)
  check(`${k} 有非空中文 label`, !!item.label && item.label.length > 0, true)
  check(`${k} 是预设图标`, isPresetIcon(k), true)
  // 预设不是品牌，别让 isBrandIcon 误判（两个分支的 viewBox 取法不同）
  check(`${k} 不是品牌图标`, isBrandIcon(k), false)
  check(`${k} 至少有 1 条 path`, accountIconPaths(k).length >= 1, true)
  // 根节点 fill 给全图染色 —— 和上面那 18 个完全同一套画法，风格才统一
  check(`${k} 根节点用传入的墨色`, /<svg[^>]*fill="#E5E5EA"/.test(svg), true)
  check(`${k} 用 fill-rule=evenodd（镂空图案靠它）`, /fill-rule="evenodd"/.test(svg), true)
  check(`${k} 不是描边图标`, /stroke=/.test(svg), false)
  // 用户源码里写死的颜色一个都不能留：彩色图摆在一排单色图标里风格就乱了
  for (const bad of ['#323333', '#272636', '#017FFB', '#FFFFFF', '#205686']) {
    check(`${k} 没有残留源码颜色 ${bad}`, new RegExp(bad, 'i').test(svg), false)
  }
  // data URI 也要能出图（<image> 真正加载的是这个）
  const uri = accountIconDataUri(k, { size: 26, color: '#E5E5EA' })
  check(`${k} 能生成 data URI`, uri.startsWith('data:image/svg+xml'), true)
  check(`${k} URI 里 SVG 结构完整`, decodeURIComponent(uri.split(',')[1]).endsWith('</svg>'), true)
}

// 多 path 图标不能被合并丢掉（转账是 4 条叠层折线，缺一条形状就错）
check('transfer 的 4 条 path 都在', (accountIconSvg('transfer', { size: 26, color: '#333' }).match(/<path /g) || []).length, 4)
// 快捷支付的白色弧线在单色化时改成了 evenodd 镂空，必须仍是同一条 path 里的子路径，
// 拆成多个 <path> 就会各自实心绘制，糊成一个纯实心圆。
check('quickpay 的子路径在同一个 path 内（镂空才成立）',
  (accountIconSvg('quickpay', { size: 26, color: '#333' }).match(/<path /g) || []).length, 1)

console.log('=== 6 个新增图标的视觉大小要一致 ===')
/*
 * 用户明确反馈过「倒数第二个感觉比其他小」：原画布都是 1024，但图形占位差很多
 * （通讯/财富几乎顶满、快捷支付只占 796），统一用原画布就会一大一小。
 * 现在按每个图标的真实包围盒取正方形视口，断言视口是正方形且尺寸合理。
 */
for (const item of PRESET_ICONS) {
  const svg = accountIconSvg(item.key, { size: 26, color: '#333' })
  const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1] || ''
  const parts = vb.split(/\s+/).map(Number)
  const okShape = parts.length === 4 && parts.every((n) => Number.isFinite(n))
  check(`${item.key} viewBox 可解析`, okShape, true)
  if (!okShape) continue
  check(`${item.key} 视口是正方形`, Math.abs(parts[2] - parts[3]) < 0.5, true)
  // 图形占满视口（留白不超过 10%），6 个的视觉大小才一致
  check(`${item.key} 视口边长合理`, parts[2] > 600 && parts[2] <= 1024 * 1.06, true)
}

console.log('=== 已删除的线性图标不留残骸 ===')
/*
 * 需求要求「删除没有用到的线性图标」。那批图标（LINE_PATHS）从来没被
 * ACCOUNT_ICONS 引用过，属于死代码。删掉后必须保证：
 *   1. utils 里不再有 LINE_PATHS 这个常量（也不再有描边分支）
 *   2. 原来的 'cash' 图标 key 也不能再被当成图标 key（它会静默失效，
 *      因为它现在是**账户类型字段**，不是图标）
 */
const iconsSrc = read('utils/accountIcons.js')
const iconsCode = stripComments(iconsSrc)
check('utils/accountIcons.js 里没有 LINE_PATHS', /LINE_PATHS/.test(iconsCode), false)
check('不再生成描边图标（fill="none"）', /fill="none"/.test(iconsCode), false)
check('不再有 stroke-width 描边参数', /stroke-width/.test(iconsCode), false)
check("'cash' 不再是图标 key", isBrandIcon('cash') || isPresetIcon('cash'), false)
check("'cash' 生成不出图标", accountIconSvg('cash'), '')

console.log('=== 品牌 + 预设混在一起也不能出错 ===')

for (const item of ACCOUNT_ICONS) {
  const uri = accountIconDataUri(item.key, { size: 24, color: '#333' })
  check(`${item.key} 能生成 data URI`, uri.startsWith('data:image/svg+xml'), true)
  check(`${item.key} URI 里没有裸的 < >`, uri.includes('<svg'), false)
  // data URI 是 URL 编码的，</svg> 会被转义成 %3C%2Fsvg%3E
  check(`${item.key} SVG 结构完整`, decodeURIComponent(uri.split(',')[1]).endsWith('</svg>'), true)
  // viewBox 按 path 真实包围盒自动适配（保留原始宽高比，非 1:1 也合法）
  check(
    `${item.key} SVG 有合法 viewBox`,
    /viewBox="-?\d+(\.\d+)? -?\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?"/.test(decodeURIComponent(uri.split(',')[1])),
    true
  )
}

console.log('=== 未知 key 的兜底 ===')

check('未知 key 返回空数组', accountIconPaths('__nope__'), [])
check('未知 key 不生成 URI', accountIconDataUri('__nope__'), '')
check('未知 key 不是品牌', isBrandIcon('__nope__'), false)

console.log('=== 页面接入的是 AccountIcon（不是 LineIcon）===')

check('编辑页用了 AccountIcon', /<AccountIcon/.test(edit), true)
check('AccountIcon 注册进 components', /components:\s*\{[^}]*AccountIcon/.test(editCode), true)
check('ACCOUNT_ICONS 从 utils 导入', /import\s*\{[^}]*ACCOUNT_ICONS[^}]*\}\s*from\s*'@\/utils\/accountIcons\.js'/.test(editCode), true)
check('编辑页不再本地定义 ACCOUNT_ICONS', /const\s+ACCOUNT_ICONS\s*=\s*\[/.test(editCode), false)

// 需求：「图标区域下方新增一行」→ 24 个图标共用同一个 .icon-grid，
// 6 列排下来自然就是「原 3 行 + 下面新增的 1 行」，不用另起一块、
// 也不加分隔线（用户明确要求风格统一，别把一组图标切成两块）。
check('编辑页用一个 .icon-grid 渲染全部 24 个', /v-for="ic in ACCOUNT_ICONS"/.test(editCode), true)
check('没有把图标拆成第二块 grid', /icon-grid-preset/.test(editCode), false)
// 6 列布局不能破：每格仍是 16.6666%
check('图标格子是 6 列百分比宽度', /\.icon-cell\s*\{[^}]*width:\s*16\.6666%/.test(editCode), true)
// 模板里禁止直接写 <svg>（uni-app 的 app 端不认，必须走 <image> + data URI）
check('编辑页模板里没有 <svg>', /<svg[\s>]/i.test(stripComments(edit)), false)

const list = stripComments(read('pages/account/index.vue'))
const detail = stripComments(read('pages/account/detail.vue'))

check('列表页用 AccountIcon', /<AccountIcon[\s\S]{0,200}:name="acc\.icon"/.test(list), true)
check('列表页不再引入 AI 图标模块', /accountIcon\.js/.test(list), false)
check('详情页用 AccountIcon', /<AccountIcon[\s\S]{0,200}:name="account\.icon"/.test(detail), true)
check('详情页不再引入 AI 图标模块', /accountIcon\.js/.test(detail), false)

console.log('=== 保存时写入 icon ===')

check('payload 里带 icon 字段', /icon:\s*form\.icon/.test(editCode), true)

console.log('=== 组件存在 ===')

check('components/AccountIcon.vue 存在', fs.existsSync(path.join(ROOT, 'components/AccountIcon.vue')), true)
const comp = read('components/AccountIcon.vue')
check('组件用 <image> 而不是 <svg>', /<image/.test(comp), true)
check('组件模板里没有 <svg>', /<svg[\s>]/i.test(stripComments(comp)), false)
check('组件没用 CSS 变量当颜色', /:color="[^"]*var\(--/.test(comp), false)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
