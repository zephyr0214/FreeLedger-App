/**
 * 「记账按钮设置」的契约测试
 *
 *   node scripts/test-quick-add-action.mjs
 *
 * 背景（用户反馈）
 *   「系统设置新增记账按钮设置，可以自定义长按、短按 + 时，
 *     触发的是 ai 记账还是传统记账，还是无触发」
 *
 * 覆盖：
 *   1. 归一化函数 normalizeQuickAddAction —— 非法值必须回落到默认值
 *   2. 默认值 = 改动前的行为（长按 manual、短按 ai），老用户行为不变
 *   3. store 的 getter / setQuickAddAction
 *   4. 首页接线：短按与长按各自按配置分发
 *   5. 长按设为 none 时，FabButton 要连震动和进度环一起关掉
 *      （否则用户会看到「转了一圈但什么也没发生」）
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  normalizeQuickAddAction, QUICK_ADD_ACTIONS, DEFAULT_SETTINGS
} from '../api/settings.js'

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

console.log('=== 归一化 ===')

check('ai 合法', normalizeQuickAddAction('ai'), 'ai')
check('manual 合法', normalizeQuickAddAction('manual'), 'manual')
check('none 合法', normalizeQuickAddAction('none'), 'none')

// 非法值必须回落，不能把脏值写进库
check('空值 -> 回落 ai', normalizeQuickAddAction(''), 'ai')
check('undefined -> 回落 ai', normalizeQuickAddAction(undefined), 'ai')
check('null -> 回落 ai', normalizeQuickAddAction(null), 'ai')
check('乱值 -> 回落 ai', normalizeQuickAddAction('xxx'), 'ai')
check('大小写敏感', normalizeQuickAddAction('AI'), 'ai')
check('带空格会 trim', normalizeQuickAddAction(' manual '), 'manual')

// 显式指定回落值
check('指定回落 manual', normalizeQuickAddAction('xxx', 'manual'), 'manual')
check('回落值本身也非法时兜底 ai', normalizeQuickAddAction('xxx', 'yyy'), 'ai')

console.log('=== 选项表 ===')

check('三个选项', QUICK_ADD_ACTIONS.map((a) => a.key), ['ai', 'manual', 'none'])
check('选项名', QUICK_ADD_ACTIONS.map((a) => a.name), ['AI 速记', '手动记账', '不响应'])

console.log('=== 默认值 ===')

check('默认长按 = manual（保持改动前行为）', DEFAULT_SETTINGS.quickAddHoldAction, 'manual')
check('默认短按 = ai（保持改动前行为）', DEFAULT_SETTINGS.quickAddTapAction, 'ai')

console.log('=== 首页接线 ===')

const homeCode = readFileSync(join(ROOT, 'pages', 'index', 'index.vue'), 'utf-8')
const homeScript = (homeCode.match(/<script[^>]*>([\s\S]*?)<\/script>/) || [])[1] || ''

check('首页引用了 settingStore', /useSettingStore\(\)/.test(homeScript), true)
check('短按按 quickAddTapAction 分发', /settingStore\.quickAddTapAction/.test(homeScript), true)
check('长按按 quickAddHoldAction 分发', /settingStore\.quickAddHoldAction/.test(homeScript), true)
check('ai -> 打开 AI 速记', /act === 'ai'[\s\S]{0,120}showQuickAdd\.value = true/.test(homeScript), true)
check('manual -> 打开手动面板', /act === 'manual'[\s\S]{0,160}showPanel\.value = true/.test(homeScript), true)
// 旧的事件名不能残留（openQuickAdd / onHoldEnd 已经被新的分发函数取代）
check('旧的 openQuickAdd 已移除', /function openQuickAdd\s*\(/.test(homeScript), false)
check('旧的 onHoldEnd 已移除', /function onHoldEnd\s*\(/.test(homeScript), false)
check('模板里用 onFabTap', /@single-press="onFabTap"/.test(homeCode), true)
check('模板里用 onFabHoldEnd', /@hold-end="onFabHoldEnd"/.test(homeCode), true)

console.log('=== AppTabBar：长按 none 时要连震动一起关 ===')

// ★ 组件已从 FabButton 换成 AppTabBar ★
//   记账按钮不再单独悬浮，而是并进圆角底栏的右端（见 components/AppTabBar.vue）。
//   长按/短按的语义完全保留，所以这些断言照旧，只换文件。
const fabCode = readFileSync(join(ROOT, 'components', 'AppTabBar.vue'), 'utf-8')

check('有 holdEnabled prop', /holdEnabled:\s*\{\s*type:\s*Boolean/.test(fabCode), true)
check('长按关掉时不启动计时器', /if \(!props\.holdEnabled\) return/.test(fabCode), true)
check('进度环受 holdEnabled 控制', /v-if="pressing && holdEnabled"/.test(fabCode), true)
// 震动在计时器回调里，计时器不启动就不会震动
check('震动在计时器回调内', /setTimeout[\s\S]{0,320}vibrateShort/.test(fabCode), true)
check('长按关掉时按短按处理', /props\.holdEnabled && \(longFired \|\| delta >= HOLD_MS\)/.test(fabCode), true)

console.log('=== 设置页与入口 ===')

const quickAddCode = readFileSync(join(ROOT, 'pages', 'settings', 'quick-add.vue'), 'utf-8')
const quickAddScript = (quickAddCode.match(/<script[^>]*>([\s\S]*?)<\/script>/) || [])[1] || ''

check('页面存在且有长按/短按两行', /长按 \+ 号/.test(quickAddCode) && /短按 \+ 号/.test(quickAddCode), true)
check('页面有保存动作', /setQuickAddAction/.test(quickAddScript), true)

// pages.json 必须注册新页面
const pagesJson = JSON.parse(
  readFileSync(join(ROOT, 'pages.json'), 'utf-8')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
)
check('pages.json 注册了 quick-add 页面',
  (pagesJson.pages || []).some((p) => p.path === 'pages/settings/quick-add'), true)

// 「我的」页要有入口
// ★ 注意：设置聚合页（pages/settings/index.vue）已经删除了 ★
//   用户要求「把点击左上角头像进入的这个页面彻底删除」，
//   所有设置项现在都从「我的」页直达。
const mineCode = readFileSync(join(ROOT, 'pages', 'mine', 'index.vue'), 'utf-8')
check('「我的」页有「记账按钮设置」入口', /记账按钮设置/.test(mineCode), true)
check('入口指向新页面', /\/pages\/settings\/quick-add/.test(mineCode), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
