/**
 * 账户图标：品牌官方矢量 + 通用语义线性
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
 *     通用（现金/银行/储蓄…）→ 本项目画的简单几何形，描边
 *
 *   这个测试防的是「以后有人又把品牌图标改回手绘」或者
 *   「预设列表里的 key 拼错」（拼错不会报错，只会画成兜底圆点）。
 */

import fs from 'fs'
import path from 'path'
import {
  ACCOUNT_ICONS,
  BRAND_ICON_KEYS,
  accountIconPaths,
  accountIconSvg,
  accountIconDataUri,
  isBrandIcon
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

check('有 18 个预设图标（3 行 × 6 列）', ACCOUNT_ICONS.length, 18)
check('key 不重复', new Set(ACCOUNT_ICONS.map(i => i.key)).size, 18)
check('每个都有中文 label', ACCOUNT_ICONS.every(i => i.label && i.label.length > 0), true)

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

console.log('=== 通用语义图标是线性的 ===')

for (const item of ACCOUNT_ICONS) {
  if (isBrandIcon(item.key)) continue
  const svg = accountIconSvg(item.key, { size: 24, color: '#333' })
  check(`${item.key} 用 fill=none 描边`, /fill="none"/.test(svg), true)
  check(`${item.key} 有 stroke`, /stroke="#333"/.test(svg), true)
  check(`${item.key} 至少有 1 条 path`, accountIconPaths(item.key).length >= 1, true)
}

console.log('=== 品牌和通用的混合不能出错 ===')

for (const item of ACCOUNT_ICONS) {
  const uri = accountIconDataUri(item.key, { size: 24, color: '#333' })
  check(`${item.key} 能生成 data URI`, uri.startsWith('data:image/svg+xml'), true)
  check(`${item.key} URI 里没有裸的 < >`, uri.includes('<svg'), false)
  // data URI 是 URL 编码的，</svg> 会被转义成 %3C%2Fsvg%3E
  check(`${item.key} SVG 结构完整`, decodeURIComponent(uri.split(',')[1]).endsWith('</svg>'), true)
  check(`${item.key} SVG 有 viewBox`, /viewBox="0 0 24 24"/.test(decodeURIComponent(uri.split(',')[1])), true)
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

const list = stripComments(read('pages/account/index.vue'))
const detail = stripComments(read('pages/account/detail.vue'))

check('列表页用 AccountIcon', /<AccountIcon[\s\S]{0,200}:name="acc\.icon"/.test(list), true)
check('列表页仍兼容旧的 SVG', /isSvgIcon\(acc\.icon\)/.test(list), true)
check('详情页用 AccountIcon', /<AccountIcon[\s\S]{0,200}:name="account\.icon"/.test(detail), true)
check('详情页仍兼容旧的 SVG', /isSvgIcon\(account\.icon\)/.test(detail), true)

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
