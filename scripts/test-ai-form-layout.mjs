/**
 * 「AI 大模型」配置页的输入框布局检查
 *
 *   node scripts/test-ai-form-layout.mjs
 *
 * 背景（用户反馈「AI 智能配置接口地址的输入框穿模了」）
 *
 *   ★ 根因：input 不在全局的 border-box 名单里 ★
 *     App.vue 的全局样式写的是
 *       view, text, scroll-view, image { box-sizing: border-box; }
 *     —— input **不在这个列表里**，所以 input 默认是 content-box。
 *     而 .form-input-full 同时有 width: 100% 和 padding: 16rpx 20rpx，
 *     实际占位 = 100% + 40rpx，横向溢出容器右边，看着就是「穿模」。
 *
 *   修法有两种：
 *     1. 全局把 input 也加进 border-box 名单（影响所有页面）
 *     2. 只在本页给 .form-input-full 显式写 box-sizing: border-box
 *   项目选了 2（影响面小），这个脚本守住它不退回去。
 *
 * 检查项：
 *   1. .form-input-full 必须有 box-sizing: border-box
 *   2. .form-input-full 不能有会撑破容器的固定 width（除了 100%）
 *   3. API Key 那一行的输入框要 flex: 1 + min-width: 0（不挤掉「显示/隐藏」）
 *   4. 同页其它 input 也不能是 content-box 撑破型
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const FILE = join(ROOT, 'pages', 'settings', 'ai.vue')

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

const code = readFileSync(FILE, 'utf-8')
const style = (code.match(/<style[^>]*>([\s\S]*)<\/style>/) || [])[1] || ''

/* ---------------------------- 1. .form-input-full 必须是 border-box */

const full = (style.match(/\.form-input-full\s*\{([^}]*)\}/) || [])[1] || ''
check('找到 .form-input-full 样式', full.length > 0, true)
check('.form-input-full 有 box-sizing: border-box', /box-sizing:\s*border-box/.test(full), true)

/* --------------------------- 2. 不能有会撑破容器的固定宽度 */

// width 只能出现 100%（或没有 width），出现具体 px/rpx 就是撑破
const widths = (full.match(/width:\s*([^;]+);/g) || []).map((w) => w.replace(/width:\s*|;/g, '').trim())
check('没有固定宽度', widths.every((w) => w === '100%' || w === 'auto'), true)

/* ------------------------- 3. API Key 行的输入框不能挤掉按钮 */

const keyRow = (style.match(/\.key-row\s*\{([^}]*)\}/) || [])[1] || ''
check('.key-row 是 flex 容器', /display:\s*flex/.test(keyRow), true)

// .key-row 里的 input 要 flex:1 + min-width:0
const keyInput = (style.match(/\.key-row\s+\.form-input-full\s*\{([^}]*)\}/) || [])[1] || ''
check('API Key 输入框有 flex: 1', /flex:\s*1/.test(keyInput), true)
check('API Key 输入框有 min-width: 0', /min-width:\s*0/.test(keyInput), true)

// 「显示/隐藏」按钮不能被压扁
const keyToggle = (style.match(/\.key-toggle\s*\{([^}]*)\}/) || [])[1] || ''
check('「显示/隐藏」按钮有 flex-shrink: 0', /flex-shrink:\s*0/.test(keyToggle), true)

/* --------------------------- 4. 其它 input 也不能撑破容器 */

const formInput = (style.match(/\.form-input\s*\{([^}]*)\}/) || [])[1] || ''
check('.form-input 有 min-width: 0', /min-width:\s*0/.test(formInput), true)
// 注意：不能写成 /width:\s*\d/ —— 那会连 min-width 一起匹配上
check('.form-input 没有固定宽度', !/(^|[^-\w])width:\s*\d/.test(formInput), true)

const sliderWrap = (style.match(/\.slider-wrap\s*\{([^}]*)\}/) || [])[1] || ''
check('.slider-wrap 有 min-width: 0', /min-width:\s*0/.test(sliderWrap), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
