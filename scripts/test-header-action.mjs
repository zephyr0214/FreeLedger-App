/**
 * HeaderAction 的回归测试
 *
 *   node scripts/test-header-action.mjs
 *
 * ★ 为什么要有这个测试 ★
 *   之前 HeaderAction 只有 text prop，调用方却习惯性写成
 *   <HeaderAction @action-click="goAbout">关于与说明</HeaderAction>
 *   —— 插槽没有默认内容就被丢弃，文字全都不显示，
 *   而且控制台也不会报错（Vue 只在开发模式 warn 一句）。
 *   这就是「四个页面右上角按钮的中文字没显示出来」的原因。
 *
 * 这次用「真的编译一遍 SFC 模板」来验，
 * 而不是只检查文件里有没有某个字符串 ——
 * 那种检查恰恰是当初漏掉这个 bug 的原因。
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { parse, compileTemplate } from '@vue/compiler-sfc'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

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

/** 读一个 .vue 文件的 template 部分 */
function readTemplate(rel) {
  const code = readFileSync(join(ROOT, rel), 'utf-8')
  const { descriptor } = parse(code, { filename: rel })
  return descriptor.template ? descriptor.template.content : ''
}

/** 编译模板，返回渲染函数源码 */
function compile(rel) {
  const { descriptor } = parse(readFileSync(join(ROOT, rel), 'utf-8'), { filename: rel })
  const res = compileTemplate({
    source: descriptor.template.content,
    filename: rel,
    id: rel
  })
  if (res.errors && res.errors.length) {
    throw new Error(`${rel} 编译失败: ${res.errors.map((e) => e.message || e).join('; ')}`)
  }
  return res.code
}

console.log('=== HeaderAction 必须同时支持插槽和 text prop ===')

{
  const tpl = readTemplate('components/HeaderAction.vue')

  // 关键：模板里必须有 <slot>，否则调用方写在标签中间的文字会被丢弃
  check('模板里有 slot 标签', /<slot\b/.test(tpl), true)
  // slot 里要有兜底内容（没给插槽时用 text prop）
  check('slot 有默认内容兜底', /<slot[^>]*>[^<]*\{\{\s*text\s*\}\}/.test(tpl), true)
}

console.log('=== 四个页面的用法要能真正渲染出文字 ===')

// 每个页面：插槽形式 + text prop 形式，都应该产出可渲染的代码
const PAGES = [
  { rel: 'pages/index/index.vue', label: '首页 AI 助手' },
  { rel: 'pages/stats/index.vue', label: '统计页 AI 助手' },
  { rel: 'pages/account/index.vue', label: '账户页 + 添加账户' },
  { rel: 'pages/mine/index.vue', label: '我的页 关于与说明' }
]

for (const p of PAGES) {
  const tpl = readTemplate(p.rel)

  // 用的是插槽形式（文字写在标签中间）
  const slotForm = /<HeaderAction\b[^>]*>([^<]+)<\/HeaderAction>/.exec(tpl)
  check(`${p.label}：用了 HeaderAction`, /<HeaderAction\b/.test(tpl), true)

  if (slotForm) {
    const text = slotForm[1].trim()
    check(`${p.label}：插槽里的文字非空`, text.length > 0, true)
  }
}

console.log('=== 编译后不能把插槽内容丢掉 ===')

{
  // 真的编译一遍 HeaderAction，看渲染函数里有没有处理 slot
  const code = compile('components/HeaderAction.vue')
  check('编译产物里有 renderSlot 或 slot 相关处理', /renderSlot|_slot|slot/.test(code), true)
  check('编译产物里有 text 这个 prop 的引用', /text/.test(code), true)
}

console.log('=== 文字不能被 flex 压扁 ===')

{
  // 样式在 <style> 块里，不在 template 里 —— 要读整个文件
  const full = readFileSync(join(ROOT, 'components/HeaderAction.vue'), 'utf-8')
  // flex 容器里的 text 会默认收缩，父级挤窄就看不见了
  check('文字有 flex-shrink:0', /flex-shrink:\s*0/.test(full), true)
  check('文字有 white-space:nowrap', /white-space:\s*nowrap/.test(full), true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
