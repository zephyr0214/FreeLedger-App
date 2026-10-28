/**
 * 账户图标：预设选择器 + 不再调 AI
 *
 *   node scripts/test-account-preset-icons.mjs
 *
 * ★ 这个测试锁住一次功能替换 ★
 *   用户原话：「ai 生成图标又报错了，修改下逻辑吧，
 *   删除生成图标功能，给定几个待选项，让用户选择图标」。
 *
 *   AI 画图在真机上反复出问题（max_tokens 截断、推理模型不吃关思考参数、
 *   页面销毁后回调崩溃……），而收益远不如不稳定带来的麻烦。
 *   换成预设图标后：立刻可选、零失败、完全可控。
 *
 *   这个测试防的是「以后有人又把 AI 生成接回去」或者
 *   「预设列表里的 key 拼错」（拼错不会报错，只会画成一个兜底圆点）。
 */

import fs from 'fs'
import path from 'path'
import { LINE_ICON_KEYS, lineIconPaths, isFallbackIcon } from '../utils/lineIcons.js'

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

/* ------------------------------------------------ 阅读页面的源码 */

const edit = read('pages/account/edit.vue')

/** 去掉注释，避免把说明文字里的词当成代码 */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const editCode = stripComments(edit)

console.log('=== 不再调用 AI 生成 ===')

check('没有 import generateAccountIcon', /generateAccountIcon/.test(editCode), false)
check('没有 drawIconFor 函数', /drawIconFor/.test(editCode), false)
check('没有「AI 绘制图标」的 loading 文案', /AI 绘制图标/.test(editCode), false)
check('没有调用 accountIcon.generate', /generateAccountIcon\s*\(/.test(editCode), false)

console.log('=== 预设图标列表 ===')

// 从源码里抠出 ACCOUNT_ICONS 的 key
const listMatch = editCode.match(/const\s+ACCOUNT_ICONS\s*=\s*\[([\s\S]*?)\]/)
check('模板/脚本里有 ACCOUNT_ICONS', !!listMatch, true)

const iconKeys = listMatch
  ? [...listMatch[1].matchAll(/key:\s*'([^']+)'/g)].map((m) => m[1])
  : []

check('至少有 8 个预设图标', iconKeys.length >= 8, true)
check('预设图标 key 不重复', new Set(iconKeys).size, iconKeys.length)

console.log('=== 每个 key 都必须真实存在（拼错会静默画成兜底圆点）===')

const missing = iconKeys.filter((k) => !LINE_ICON_KEYS.includes(k))
check('没有拼错的 key', missing, [])

const fallbacks = iconKeys.filter((k) => isFallbackIcon(k))
check('没有走兜底的 key', fallbacks, [])

const emptyPaths = iconKeys.filter((k) => !lineIconPaths(k) || lineIconPaths(k).length === 0)
check('每个 key 都至少有 1 条 path', emptyPaths, [])

console.log('=== 新增的账户图标质量 ===')

// 这几个是这次为账户选择器专门画的
const NEW_KEYS = [
  'creditcard', 'cash', 'wechat', 'alipay', 'bank', 'piggy',
  'safe', 'prepaid', 'huabei', 'invest', 'car', 'phone', 'gift', 'more'
]
for (const k of NEW_KEYS) {
  check(`${k} 存在于图标库`, LINE_ICON_KEYS.includes(k), true)
  check(`${k} 不是兜底`, isFallbackIcon(k), false)
}

console.log('=== 语义化取舍：支付宝不画「支」字 ===')

// 支 是 7 画，在 24px 描边图里画汉字很容易变成看不懂的形状。
// 前面三版分别试过「笔画挤在圆心」「曲线抖动像叶子」「按字形结构摆开」，
// 渲染出来都不理想。最后改成「钱包 + ¥」——
// 表达的是「支付/钱包」这个类别，不是复刻品牌字形。
{
  const paths = lineIconPaths('alipay')
  check('alipay 不是圆形徽章（说明已放弃画支字）', !paths.some((d) => d.startsWith('M12 3a9 9')), true)
  check('alipay 含有 ¥ 的横笔画', paths.some((d) => /M9 16\.8h5\.8|M9\.2 16\.8h5\.8/.test(d)), true)
}

console.log('=== 选择器 UI ===')

check('模板里有 icon-grid 容器', /class="icon-grid"/.test(edit), true)
check('模板里有 icon-cell', /class="icon-cell"/.test(edit), true)
check('有 LineIcon 组件引用', /LineIcon/.test(edit), true)
check('LineIcon 注册进 components', /components:\s*\{[^}]*LineIcon/.test(editCode), true)
check('ACCOUNT_ICONS 暴露给模板', /return\s*\{[^}]*ACCOUNT_ICONS/s.test(editCode), true)
check('可以再点一次取消（清空 icon）', /form\.icon\s*=\s*''/.test(editCode), true)

console.log('=== 保存时写入 icon ===')

check('payload 里带 icon 字段', /icon:\s*form\.icon/.test(editCode), true)

console.log('=== 列表页 / 详情页要能渲染预设 key ===')

const list = stripComments(read('pages/account/index.vue'))
const detail = stripComments(read('pages/account/detail.vue'))

check('列表页用 LineIcon 渲染 icon', /<LineIcon[\s\S]{0,200}:name="acc\.icon"/.test(list), true)
check('列表页仍兼容旧的 SVG', /isSvgIcon\(acc\.icon\)/.test(list), true)
check('详情页用 LineIcon 渲染 icon', /<LineIcon[\s\S]{0,200}:name="account\.icon"/.test(detail), true)
check('详情页仍兼容旧的 SVG', /isSvgIcon\(account\.icon\)/.test(detail), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
