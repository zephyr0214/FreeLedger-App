/**
 * 统计页「组件管理」+ 恩格尔系数改手选的回归测试
 *
 *   node scripts/test-stats-panels.mjs
 *
 * 覆盖本轮用户需求：
 *   统计页右上方改成「组件管理」入口 → 新页面可排序 + 勾选显隐；
 *   恩格尔系数面板右侧可展开设置，用多选分类弹层让用户手选「算食品的支出分类」；
 *   **AI 识别食品分类的逻辑全部删除**，改成纯 storage。
 *
 * 检查项：
 *   1. utils/statsPanels.js：面板定义 key 齐全且唯一、默认顺序一致
 *   2. normalizeStatsPanels 容错（未知 key / 缺字段 / 脏数据 / 重复）
 *   3. moveStatPanel 越界不动、同分组内换位（隐藏项不占用户的视觉顺序）
 *   4. toggleStatPanel 勾选/取消
 *   5. visibleStatsPanels 顺序正确、hiddenStatsPanels 互补
 *   6. api/engel.js 不再引用 chat()，导出新的纯存储接口
 *   7. api/settings.js 有 statsPanels / engelFoodCategories 默认值，且做过对象合并
 *   8. pages.json 注册了 pages/settings/stats-panels
 *   9. pages/settings/stats-panels.vue 有勾选框 / 上下箭头 / 展开箭头 / 多选弹层
 *  10. components/CategoryMultiPickerSheet.vue 的 flat prop 默认 false（老调用方不变）
 *  11. pages/settings/category.vue 已彻底移除恩格尔相关调用
 */

import { readFileSync, existsSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import {
  STATS_PANEL_DEFS,
  DEFAULT_PANEL_ORDER,
  normalizeStatsPanels,
  visibleStatsPanels,
  hiddenStatsPanels,
  moveStatPanel,
  toggleStatPanel,
  isStatsPanelKey,
  getStatsPanelDef
} from '../utils/statsPanels.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf-8')
}

/**
 * 只留代码、剥掉注释
 *
 * ★ 为什么要剥 ★
 *   api/engel.js 的头注释里**故意**写了「refreshEngelFoodCategories 等已删除」，
 *   讲清楚这轮删了什么、为什么删 —— 那是这个仓库的注释风格（解释设计与坑）。
 *   整文件搜索会把注释也当成命中，断言就必须改成「连注释都不许提」，
 *   等于逼着以后的人不敢写来历。所以断言一律针对剥掉注释后的代码。
 */
function codeOf(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/* ==================================== 1. 面板定义 */

console.log('=== 1. 面板定义：key 齐全且唯一 ===')

const KEYS = STATS_PANEL_DEFS.map((d) => d.key)
/*
 * ★ 面板清单会随需求增长，不写死数量 ★
 *   原来这里钉的是 7 个（第一版统计页的 7 块），
 *   本轮加了环比 / 储蓄率 / 预算执行三块，写死的断言就全废了。
 *   真正要守的是「定义顺序 = 默认渲染顺序」「key 唯一」「每个都有 name/desc」，
 *   数量本身没有意义 —— 改成一个下限断言，防止误删。
 */
const EXPECTED_KEYS = [
  'category', 'account', 'trend', 'comparison', 'mom', 'engel',
  'savings', 'budget', 'average', 'top'
]

check('面板数量与预期清单一致', STATS_PANEL_DEFS.length, EXPECTED_KEYS.length)

/*
 * ★ 期望值从 EXPECTED_KEYS 推导，不手抄整串 ★
 *   面板清单会增长（本轮从 7 加到 10），手抄的整串每加一块就要改一遍。
 *   这里只断言「用户排的两个在前、其余按默认顺序补齐、总数不变」。
 */
const trailingExpected = ['top', 'category']
  .concat(EXPECTED_KEYS.filter((k) => k !== 'top' && k !== 'category'))
check('key 顺序与统计页渲染顺序一致', KEYS, EXPECTED_KEYS)
check('key 无重复', new Set(KEYS).size, KEYS.length)
check('DEFAULT_PANEL_ORDER 与定义一致', DEFAULT_PANEL_ORDER, KEYS)
check('每个面板都有 name', STATS_PANEL_DEFS.every((d) => !!d.name), true)
check('每个面板都有 desc', STATS_PANEL_DEFS.every((d) => !!d.desc), true)
check('只有恩格尔系数可编辑', STATS_PANEL_DEFS.filter((d) => d.editable).map((d) => d.key), ['engel'])
check('isStatsPanelKey 认合法 key', isStatsPanelKey('engel'), true)
check('isStatsPanelKey 拒未知 key', isStatsPanelKey('nope'), false)
check('isStatsPanelKey 拒空值', isStatsPanelKey(null), false)
check('getStatsPanelDef 取到定义', getStatsPanelDef('top').name, '最高的 10 笔消费')
check('getStatsPanelDef 未知 key 返回 null', getStatsPanelDef('nope'), null)

/* ==================================== 2. normalize 容错 */

console.log('\n=== 2. normalizeStatsPanels 容错 ===')

check('null → 默认全量顺序', normalizeStatsPanels(null).order, EXPECTED_KEYS)
check('null → 没有隐藏项', normalizeStatsPanels(null).hidden, [])

const dirty = normalizeStatsPanels({
  order: ['top', 'unknown_key', 'top', '', null, 42, 'category'],
  hidden: ['engel', 'engel', 'bogus', null]
})
check('剔除未知 key / 非字符串', dirty.order, trailingExpected)
check('hidden 只保留合法 key 且去重', dirty.hidden, ['engel'])

check('raw 是数组 → 走默认值', normalizeStatsPanels([]).order, EXPECTED_KEYS)
check('raw 是字符串 → 走默认值', normalizeStatsPanels('oops').order, EXPECTED_KEYS)
check('缺 order 字段 → 补齐默认', normalizeStatsPanels({ hidden: [] }).order, EXPECTED_KEYS)
check('缺 hidden 字段 → 空数组', normalizeStatsPanels({ order: [] }).hidden, [])
check('order 为空数组 → 补齐默认顺序', normalizeStatsPanels({ order: [] }).order, EXPECTED_KEYS)

// 用户只排了 3 个：剩下的按默认顺序追加在尾部，不能插回中间打乱用户排好的结果
check(
  '缺的 key 追加在尾部（不打乱用户排序）',
  normalizeStatsPanels({ order: ['top', 'category'] }).order,
  trailingExpected
)

// 不能修改入参
const rawInput = { order: ['top'], hidden: ['engel'] }
const rawSnapshot = JSON.stringify(rawInput)
normalizeStatsPanels(rawInput)
check('不修改入参', JSON.stringify(rawInput), rawSnapshot)

/* ==================================== 3. moveStatPanel */

console.log('\n=== 3. moveStatPanel：上移/下移 ===')

check(
  '中间项上移一格',
  moveStatPanel(null, 'account', -1).order.slice(0, 2),
  ['account', 'category']
)
check(
  '中间项下移一格',
  moveStatPanel(null, 'account', 1).order.slice(1, 3),
  ['trend', 'account']
)
check('首项上移不动', moveStatPanel(null, 'category', -1).order, EXPECTED_KEYS)
check('末项下移不动', moveStatPanel(null, 'top', 1).order, EXPECTED_KEYS)
check('未知 key 不动', moveStatPanel(null, 'nope', -1).order, EXPECTED_KEYS)
check('delta=0 不动', moveStatPanel(null, 'trend', 0).order, EXPECTED_KEYS)
check('移动不影响 hidden', moveStatPanel({ order: [], hidden: ['top'] }, 'average', 1).hidden, ['top'])

/*
 * 隐藏项占着 order 里的位置，但用户在「已显示」列表里看的是连续的一项。
 * 上移必须跳过隐藏项，否则点了箭头「什么都不发生」。
 */
const withHidden = { order: [...EXPECTED_KEYS], hidden: ['trend'] }
// 已显示序列是 category, account, comparison, engel, average, top
// 对 comparison 点 ↑：跨过隐藏的 trend，换到 account 之前
check(
  '上移跳过隐藏项',
  moveStatPanel(withHidden, 'comparison', -1).order.slice(0, 4),
  ['category', 'comparison', 'account', 'trend']
)
check(
  '下移跳过隐藏项',
  moveStatPanel(withHidden, 'account', 1).order.slice(0, 4),
  ['category', 'trend', 'comparison', 'account']
)

/*
 * 隐藏项自己也能在「未显示」分组外被移动时保持隔离：
 * 未显示列表里没有箭头，但函数层面不能把隐藏项和可见项互换（会造成视觉错位）。
 */
const singleHidden = { order: [...EXPECTED_KEYS], hidden: ['top'] }
check(
  '隐藏项的上移只和其它隐藏项换位（只有一个隐藏项 → 不动）',
  moveStatPanel(singleHidden, 'top', -1).order,
  EXPECTED_KEYS
)

/* ==================================== 4. toggleStatPanel */

console.log('\n=== 4. toggleStatPanel：显隐 ===')

check('取消勾选 → 进 hidden', toggleStatPanel(null, 'engel', false).hidden, ['engel'])
check(
  '取消勾选后 order 不变（位置留着）',
  toggleStatPanel(null, 'engel', false).order,
  EXPECTED_KEYS
)
check('重新勾选 → 从 hidden 移除', toggleStatPanel({ order: [], hidden: ['engel'] }, 'engel', true).hidden, [])
check('重复取消不产生重复项', toggleStatPanel({ order: [], hidden: ['engel'] }, 'engel', false).hidden, ['engel'])
check('隐藏与顺序互不影响', toggleStatPanel({ order: [], hidden: ['engel'] }, 'top', false).hidden, ['engel', 'top'])
check('未知 key 勾选无效', toggleStatPanel(null, 'nope', false).hidden, [])

/* ==================================== 5. visibleStatsPanels */

console.log('\n=== 5. visibleStatsPanels / hiddenStatsPanels ===')

check('默认全显示', visibleStatsPanels(null).map((p) => p.key), EXPECTED_KEYS)
check(
  '隐藏一个后少一个',
  visibleStatsPanels({ order: [], hidden: ['trend'] }).map((p) => p.key),
  EXPECTED_KEYS.filter((k) => k !== 'trend')
)
check(
  '按用户排的顺序返回',
  visibleStatsPanels({ order: ['top', 'category'], hidden: [] }).map((p) => p.key),
  trailingExpected
)
check(
  '返回的是带 key 的 def（统计页 panelVisible 依赖）',
  visibleStatsPanels({ order: ['top'], hidden: [] })[0],
  { key: 'top', name: '最高的 10 笔消费', desc: '这段时间最大的几笔', editable: false }
)
check('hiddenStatsPanels 与可见项互补', hiddenStatsPanels({ order: [], hidden: ['engel'] }).map((p) => p.key), ['engel'])
check(
  '可见 + 隐藏 = 全量面板',
  visibleStatsPanels({ order: [], hidden: ['engel'] }).length +
    hiddenStatsPanels({ order: [], hidden: ['engel'] }).length,
  STATS_PANEL_DEFS.length
)

/* ==================================== 6. api/engel.js 纯存储 */

console.log('\n=== 6. api/engel.js：AI 判定逻辑已删除 ===')

const ENGEL = codeOf(read('api/engel.js'))
const ENGEL_RAW = read('api/engel.js')

check('不再引用 chat(', /chat\s*\(/.test(ENGEL), false)
check('不再有 AI 判定入口 ensureEngelFoodCategories', /ensureEngelFoodCategories/.test(ENGEL), false)
check('不再有 refreshEngelFoodCategories', /refreshEngelFoodCategories/.test(ENGEL), false)
check('不再有 getEngelCacheState', /getEngelCacheState/.test(ENGEL), false)
check('不再有 getCachedEngelFoodIds', /getCachedEngelFoodIds/.test(ENGEL), false)
check('不再 import ai.js', /from\s+['"][^'"]*\/ai\.js['"]/.test(ENGEL), false)
check('保留 ENGEL_FOOD_KEY 导出', /export const ENGEL_FOOD_KEY = 'engelFoodCategories'/.test(ENGEL), true)
check('导出 getEngelFoodIds', /export async function getEngelFoodIds\s*\(/.test(ENGEL), true)
check('导出 setEngelFoodIds', /export async function setEngelFoodIds\s*\(/.test(ENGEL), true)
check('导出 clearEngelFoodIds', /export async function clearEngelFoodIds\s*\(/.test(ENGEL), true)
check('注释里说明了为什么改成手选', /AI 判定/.test(ENGEL_RAW), true)

/* ==================================== 7. api/settings.js */

console.log('\n=== 7. api/settings.js：新增默认设置项 ===')

const SETTINGS = read('api/settings.js')

check('DEFAULT_SETTINGS 有 statsPanels', /statsPanels:\s*\{\s*order:\s*\[\],\s*hidden:\s*\[\]\s*\}/.test(SETTINGS), true)
check('DEFAULT_SETTINGS 有 engelFoodCategories', /engelFoodCategories:\s*\[\]/.test(SETTINGS), true)
check(
  'getAllSettings 对 statsPanels 做对象展开合并',
  /out\.statsPanels\s*=\s*mergeObjectSetting\(/.test(SETTINGS),
  true
)
check('没有把 statsPanels 直接赋值覆盖默认值', /out\.statsPanels\s*=\s*JSON\.parse/.test(SETTINGS), false)

/* ==================================== 8. pages.json 路由 */

console.log('\n=== 8. pages.json：注册组件管理页 ===')

const rawPages = read('pages.json')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const pagesJson = JSON.parse(rawPages)
const route = pagesJson.pages.find((p) => p.path === 'pages/settings/stats-panels')

check('路由已注册', !!route, true)
check('navigationStyle 是 custom', route && route.style.navigationStyle, 'custom')
check('navigationBarTitleText 是「组件管理」', route && route.style.navigationBarTitleText, '组件管理')
check('页面文件存在', existsSync(join(ROOT, 'pages/settings/stats-panels.vue')), true)

/* ==================================== 9. 组件管理页形态 */

console.log('\n=== 9. pages/settings/stats-panels.vue：勾选框 + 箭头 + 设置区 ===')

const PANEL_PAGE_RAW = read('pages/settings/stats-panels.vue')
const panelTemplate = (PANEL_PAGE_RAW.match(/<template>([\s\S]*)<\/template>/) || [])[1] || ''
const panelStyle = (PANEL_PAGE_RAW.match(/<style[^>]*>([\s\S]*)<\/style>/) || [])[1] || ''

check('用 PageNav 且标题「组件管理」', /<PageNav title="组件管理"/.test(panelTemplate), true)
check('有自绘勾选框', /class="panel-box/.test(panelTemplate), true)
check('勾选框里有 ✓', /class="panel-tick">✓/.test(panelTemplate), true)
check('勾选框选中态用主题色实底', /\.panel-box\.on\s*\{[\s\S]{0,160}?background-color:\s*var\(--app-primary\)/.test(panelStyle), true)
check('有上移箭头 ↑', /@click="onMove\(p\.key, -1\)"[\s\S]{0,40}?>↑</.test(panelTemplate), true)
check('有下移箭头 ↓', /@click="onMove\(p\.key, 1\)"[\s\S]{0,40}?>↓</.test(panelTemplate), true)
check('首行 ↑ 置灰', /disabled:\s*idx === 0/.test(panelTemplate), true)
check('末行 ↓ 置灰', /disabled:\s*idx === shownRows\.length - 1/.test(panelTemplate), true)
check('置灰态降透明度', /\.panel-op\.disabled\s*\{[\s\S]{0,120}?opacity:\s*0\.4/.test(panelStyle), true)
check('有「已显示」分组', /已显示（/.test(panelTemplate), true)
check('有「未显示」分组', /未显示（/.test(panelTemplate), true)
check('只有 editable 面板才给展开箭头', /v-if="p\.editable"/.test(panelTemplate), true)
check('展开箭头是 chevronDown', /name="chevronDown"/.test(panelTemplate), true)
check('展开/收起有旋转态', /\.expand-icon\.open\s*\{[\s\S]{0,120}?rotate\(180deg\)/.test(panelStyle), true)
check('设置区里有「食品分类」', /食品分类/.test(panelTemplate), true)
check('接了多选分类弹层', /<CategoryMultiPickerSheet/.test(panelTemplate), true)
check('弹层走 flat 平铺模式', /:flat="true"/.test(panelTemplate), true)
check('弹层标题「选择食品分类」', /title="选择食品分类"/.test(panelTemplate), true)
check('选完写 setEngelFoodIds', /setEngelFoodIds\(/.test(PANEL_PAGE_RAW), true)
check('顺序/显隐逻辑复用 utils/statsPanels.js', /from '@\/utils\/statsPanels\.js'/.test(PANEL_PAGE_RAW), true)
check('没有自己再写一套排序逻辑', /const arr = .*order\.slice\(\)/.test(PANEL_PAGE_RAW), false)
check('页面根节点带 wotClass', /<view class="app-page" :class="settingStore\.wotClass"/.test(panelTemplate), true)

/* ==================================== 10. 多选弹层 flat prop 兼容性 */

console.log('\n=== 10. CategoryMultiPickerSheet：flat prop 默认 false ===')

const PICKER = read('components/CategoryMultiPickerSheet.vue')

check('新增 flat prop', /flat:\s*\{\s*type:\s*Boolean,\s*default:\s*false\s*\}/.test(PICKER), true)
check('flat 默认 false（老调用方行为不变）', /flat:\s*\{\s*type:\s*Boolean,\s*default:\s*false\s*\}/.test(PICKER), true)
check('flat 分支在分组逻辑里', /if\s*\(props\.flat\)/.test(PICKER), true)

// 老调用方没有传 flat
const budgetPage = read('pages/settings/budget.vue')
const txnList = read('pages/txn/list.vue')
check('预算页调用未传 flat', /<CategoryMultiPickerSheet[\s\S]{0,400}?\/>/.test(budgetPage) && !/:flat=/.test(budgetPage), true)
check('全部交易页调用未传 flat', !/:flat=/.test(txnList), true)

/* ==================================== 11. 分类管理页已清干净 */

console.log('\n=== 11. pages/settings/category.vue：恩格尔调用已移除 ===')

const CATPAGE = codeOf(read('pages/settings/category.vue'))

check('不再 import refreshEngelFoodCategories', /refreshEngelFoodCategories/.test(CATPAGE), false)
check('不再有 rejudgeEngel 函数与调用', /rejudgeEngel/.test(CATPAGE), false)
check('不再引用 api/engel.js', /@\/api\/engel\.js/.test(CATPAGE), false)

/* ==================================== 12. 深浅色：只用 CSS 变量 */

console.log('\n=== 12. 深浅色适配 ===')

const styleVarsOnly = panelStyle
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => /(background-color|color|border-color|border):/.test(line))
  .filter((line) => /#[0-9a-fA-F]{3,8}\b/.test(line))

/*
 * 白勾是唯一允许的固定色（和 ExcludeFlags / 多选弹层一致）：
 * 主题色实底上只有白色对勾看得清，深浅色模式下都一样。
 */
const badHex = styleVarsOnly.filter((line) => !/#ffffff\b/i.test(line))
check('样式里除了白色对勾没有写死颜色', badHex, [])

/* ==================================== 输出 */

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
