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

/* ------------------- 1b. 不能被压扁：要有固定高度，且上下不留 padding */

/**
 * ★★ 为什么会被压扁 ★★
 *   uni-app 的 <input> 编译成 <uni-input>，默认高度是 1.4em，
 *   本身没有固定高度。
 *   补了 box-sizing: border-box 之后，如果还保留 padding: 16rpx 上下，
 *   那 32rpx 的上下 padding 要从 1.4em（约 36rpx）的内容高度里扣，
 *   26rpx 的字号只剩 4rpx 的内容区 —— 字被压成一条线。
 *
 *   修法：给 height + line-height，padding 只留左右。
 */
check('.form-input-full 有固定高度', /height:\s*\d+rpx/.test(full), true)
check('.form-input-full 有 line-height', /line-height:\s*\d+rpx/.test(full), true)

// 上下 padding 必须是 0（只留左右）
const padding = (full.match(/padding:\s*([^;]+);/) || [])[1] || ''
check('.form-input-full 的 padding 上下为 0', /^\s*0\s+\d+rpx\s*$/.test(padding.trim()), true)

/* --------------------------- 2. 不能有会撑破容器的固定宽度 */

// width 只能出现 100%（或没有 width），出现具体 px/rpx 就是撑破
const widths = (full.match(/(^|[^-\w])width:\s*([^;]+);/g) || []).map((w) => w.replace(/.*width:\s*|;/g, '').trim())
check('没有固定宽度', widths.every((w) => w === '100%' || w === 'auto'), true)

/* ------------------------- 3. API Key 行的输入框不能挤掉按钮 */

const keyRow = (style.match(/\.key-row\s*\{([^}]*)\}/) || [])[1] || ''
check('.key-row 是 flex 容器', /display:\s*flex/.test(keyRow), true)

// .key-row 里的 input 要 flex:1 + min-width:0
const keyInput = (style.match(/\.key-row\s+\.form-input-full\s*\{([^}]*)\}/) || [])[1] || ''
check('API Key 输入框有 flex: 1', /flex:\s*1/.test(keyInput), true)
check('API Key 输入框有 min-width: 0', /min-width:\s*0/.test(keyInput), true)

// 「显示/隐藏」按钮不能被压扁，且要跟输入框等高
const keyToggle = (style.match(/\.key-toggle\s*\{([^}]*)\}/) || [])[1] || ''
check('「显示/隐藏」按钮有 flex-shrink: 0', /flex-shrink:\s*0/.test(keyToggle), true)
check('「显示/隐藏」按钮有 line-height 与输入框对齐', /line-height:\s*\d+rpx/.test(keyToggle), true)
// align-items: stretch 让输入框跟着行高走
check('.key-row 用 align-items: stretch', /align-items:\s*stretch/.test(keyRow), true)

/* --------------------------- 4. 其它 input 也不能撑破容器 */

const formInput = (style.match(/\.form-input\s*\{([^}]*)\}/) || [])[1] || ''
check('.form-input 有 min-width: 0', /min-width:\s*0/.test(formInput), true)
// 注意：不能写成 /width:\s*\d/ —— 那会连 min-width 一起匹配上
check('.form-input 没有固定宽度', !/(^|[^-\w])width:\s*\d/.test(formInput), true)

/*
 * ★ 「回答的随机程度」滑块已删除 ★
 *   温度固定 0.6，不再给用户调 —— 技术参数不该暴露给普通用户。
 *   原来这里检查 .slider-wrap 的 min-width，现在改查新的开关行布局：
 *   .label-row 里标签和 switch 要分居两端，不能挤在一起。
 */
const labelRow = (style.match(/\.label-row\s*\{([^}]*)\}/) || [])[1] || ''
check('.label-row 存在', labelRow.length > 0, true)
check('.label-row 用 space-between 分居两端', /justify-content:\s*space-between/.test(labelRow), true)
check('.label-row 铺满整行', /width:\s*100%/.test(labelRow), true)

// 滑块相关样式应该整个消失，避免留下死 CSS
check('不再有 .slider-wrap 规则', /\.slider-wrap/.test(style), false)
check('不再有 .slider-value 规则', /\.slider-value/.test(style), false)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
