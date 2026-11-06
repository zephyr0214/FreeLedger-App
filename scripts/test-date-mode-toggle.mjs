/**
 * 「日/月/年 ｜ 自定义」时间筛选切换的形态检查
 *
 *   node scripts/test-date-mode-toggle.mjs
 *
 * 用户需求（原话）：
 *   「在全部交易页面和统计页面上方，时间筛选面板上方新增一个 tab 切换按钮，
 *     类似于统计页面一级二级的切换 tab，分别为日月年筛选和自定义筛选，
 *     日月年下方使用当前逻辑，自定义支持选择开始日和结束日进行筛选」
 *
 * ★ 为什么要静态检查 ★
 *   这套切换涉及「两套状态 + 两个查询分支」，写错时编译不报、运行也不报，
 *   只在真机上表现为「切了没反应」或「跨月只查得到一个月」——
 *   都是很难从报错里看出来的。所以把关键形态钉死：
 *     1. 两个页面都有 toggle，且都叫「日/月/年」和「自定义」
 *     2. toggle 在日期选择器**上方**（用户明确说的位置）
 *     3. 两套状态各存各的（dateMode / dateRange / customStart / customEnd）
 *     4. 切换时立刻重新查询（不刷新等于没切换）
 *     5. 自定义分支不给 monthKey（给了会把跨月查询掐成一个月）
 *     6. 起止颠倒要自动纠正（否则永远是空结果）
 *     7. styles 里有 .mode-toggle / .mode-tag.active 和 .custom-bar
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

let pass = 0
let fail = 0
const fails = []

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    fail++
    fails.push(`${name}\n      实际 ${a}\n      期望 ${e}`)
    console.log(`FAIL  ${name}\n      实际 ${a}\n      期望 ${e}`)
  }
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf-8')
}

/**
 * 去掉注释再断言。
 *
 * ★ 必须做 ★
 *   这两个页面的注释里写了大量「monthKey」「dateMode」这类词，
 *   直接在原文上正则匹配会大量误判 —— 之前 test-share-intent 就吃过这个亏。
 */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const PAGES = [
  { name: '全部交易', file: 'pages/txn/list.vue' },
  { name: '统计', file: 'pages/stats/index.vue' }
]

for (const page of PAGES) {
  const raw = read(page.file)
  const code = stripComments(raw)
  const template = stripComments((raw.match(/<template>([\s\S]*)<\/template>/) || [])[1] || '')
  const style = (raw.match(/<style[^>]*>([\s\S]*)<\/style>/) || [])[1] || ''

  console.log(`\n=== ${page.name}页（${page.file}）===`)

  /* ---------------------------------------------- 1. toggle 存在且文案正确 */

  check(`${page.name}页有「日/月/年」按钮`, />日\/月\/年</.test(template), true)
  check(`${page.name}页有「自定义」按钮`, />自定义</.test(template), true)
  check(`${page.name}页用 .mode-toggle 包住两个按钮`, /class="mode-toggle"/.test(template), true)
  check(
    `${page.name}页按钮用 .mode-tag`,
    (template.match(/class="mode-tag"/g) || []).length >= 2,
    true
  )
  check(
    `${page.name}页选中态是 .active`,
    /:class="\{ active: dateMode === 'period' \}"/.test(template) &&
      /:class="\{ active: dateMode === 'custom' \}"/.test(template),
    true
  )
  check(
    `${page.name}页点按钮会切模式`,
    /@click="switchDateMode\('period'\)"/.test(template) &&
      /@click="switchDateMode\('custom'\)"/.test(template),
    true
  )

  /* ---------------------------------- 2. toggle 必须在日期选择器上方 */

  /*
   * ★ 位置是用户明说的 ★
   *   「时间筛选面板上方新增一个 tab 切换按钮」——
   *   放在选择器下面就成了「筛选结果的说明」，语义不对。
   *   用人话的判据：.mode-toggle 的 index < DateRangePicker 的 index。
   */
  const iToggle = template.indexOf('class="mode-toggle"')
  const iPicker = template.indexOf('<DateRangePicker')
  check(`${page.name}页 DateRangePicker 存在`, iPicker > 0, true)
  check(`${page.name}页 toggle 在日期选择器上方`, iToggle > 0 && iToggle < iPicker, true)

  /* -------------------------------- 3. 「日/月/年」下方仍是原来那套逻辑 */

  check(
    `${page.name}页日/月/年分支仍渲染 DateRangePicker`,
    /v-if="dateMode === 'period'"/.test(template) &&
      /<DateRangePicker[\s\S]{0,300}?\/>/.test(template),
    true
  )

  /* ------------------------------------------ 4. 自定义分支的两个日期格 */

  check(`${page.name}页自定义分支用 v-else`, /v-else class="custom-bar"/.test(template), true)
  check(
    `${page.name}页有「开始」「结束」两个日期格`,
    />开始</.test(template) && />结束</.test(template),
    true
  )
  check(
    `${page.name}页用原生 picker mode="date"`,
    (template.match(/<picker mode="date"/g) || []).length >= 2,
    true
  )
  check(
    `${page.name}页结束日不能超过今天`,
    /:end="todayKey"/.test(template),
    true
  )

  /* -------------------------------------- 5. 两套状态各存各的（不互相覆盖） */

  check(`${page.name}页有 dateMode 状态`, /const dateMode = ref\('period'\)/.test(code), true)
  check(`${page.name}页有 customStart 状态`, /const customStart = ref\(/.test(code), true)
  check(`${page.name}页有 customEnd 状态`, /const customEnd = ref\(/.test(code), true)
  check(`${page.name}页有 todayKey`, /const todayKey = toDayKey\(\)/.test(code), true)
  check(
    `${page.name}页仍然保留 dateRange（旧逻辑没被拆掉）`,
    /const dateRange = ref\(/.test(code),
    true
  )
  check(
    `${page.name}页的 switchDateMode 直接改 ref 而不是重建`,
    /function switchDateMode\(mode\)[\s\S]{0,200}?dateMode\.value = mode/.test(code),
    true
  )

  /* ------------------------------------ 6. 切换后必须立刻重新查询 */

  /*
   * ★ 不重查 = 切换没生效 ★
   *   两个页面的刷新函数不同（loadFirstPage / loadAll），
   *   所以这里只看「switchDateMode 里有没有调刷新」。
   */
  check(
    `${page.name}页切换模式会立刻重查`,
    /function switchDateMode\(mode\)[\s\S]{0,300}?(loadFirstPage|loadAll)\(\)/.test(code),
    true
  )
  check(
    `${page.name}页改开始日会重查`,
    /function onCustomStart\(e\)[\s\S]{0,300}?(loadFirstPage|loadAll)\(\)/.test(code),
    true
  )
  check(
    `${page.name}页改结束日会重查`,
    /function onCustomEnd\(e\)[\s\S]{0,300}?(loadFirstPage|loadAll)\(\)/.test(code),
    true
  )

  /* -------------------- 7. 起止颠倒自动纠正 + 自定义分支不给 monthKey */

  check(
    `${page.name}页开始日晚于结束日时自动纠正`,
    /function onCustomStart\(e\)[\s\S]{0,300}?customStart\.value > customEnd\.value[\s\S]{0,120}?customEnd\.value = customStart\.value/.test(code),
    true
  )
  check(
    `${page.name}页结束日早于开始日时自动纠正`,
    /function onCustomEnd\(e\)[\s\S]{0,300}?customEnd\.value < customStart\.value[\s\S]{0,120}?customStart\.value = customEnd\.value/.test(code),
    true
  )

  /*
   * ★ 自定义分支为什么要单独判 monthKey ★
   *   给了 monthKey，api/transaction.js 与 api/stats.js 会按 month_key 等值过滤，
   *   跨月区间只剩一个月的数据。customToRange 只在「正好整月」时回填，
   *   所以这里断言的是「用了 customToRange」，而不是「绝对不能有 monthKey」。
   */
  check(
    `${page.name}页自定义分支走 customToRange`,
    /customToRange\(customStart\.value, customEnd\.value\)/.test(code),
    true
  )

  /* --------------------------------------- 8. 模板引用的东西都从 setup 返回 */

  for (const key of ['dateMode', 'customStart', 'customEnd', 'todayKey']) {
    check(
      `${page.name}页 return 里有 ${key}`,
      new RegExp(`return \\{[\\s\\S]*?\\b${key}\\b`).test(code),
      true
    )
  }
  for (const fn of ['switchDateMode', 'onCustomStart', 'onCustomEnd']) {
    check(
      `${page.name}页 return 里有 ${fn}`,
      new RegExp(`return \\{[\\s\\S]*?\\b${fn}\\b`).test(code),
      true
    )
  }

  /* ------------------------------------------------ 9. 样式必须跟上 */

  check(`${page.name}页有 .mode-toggle 样式`, /\.mode-toggle\s*\{/.test(style), true)
  check(`${page.name}页有 .mode-tag 样式`, /\.mode-tag\s*\{/.test(style), true)
  check(`${page.name}页有选中态样式`, /\.mode-tag\.active\s*\{/.test(style), true)
  check(`${page.name}页有 .custom-bar 样式`, /\.custom-bar\s*\{/.test(style), true)
  check(`${page.name}页有 .custom-cell 样式`, /\.custom-cell\s*\{/.test(style), true)
}

/* -------------------------------- 10. 两个页面的样式必须一致（观感统一） */

console.log('\n=== 两页样式一致性 ===')

function modeStyle(file) {
  const style = (read(file).match(/<style[^>]*>([\s\S]*)<\/style>/) || [])[1] || ''
  const grab = (sel) => {
    const m = style.match(new RegExp(`\\${sel}\\s*\\{[^}]*\\}`))
    return m ? m[0].replace(/\s+/g, ' ').trim() : ''
  }
  return { toggle: grab('.mode-toggle'), tag: grab('.mode-tag'), bar: grab('.custom-bar') }
}

const a = modeStyle('pages/txn/list.vue')
const b = modeStyle('pages/stats/index.vue')
check('.mode-toggle 两页一致', a.toggle, b.toggle)
check('.mode-tag 两页一致', a.tag, b.tag)
check('.custom-bar 两页一致', a.bar, b.bar)

/* ------------------------------------------ 11. 账户名在备注左边（用户第 2 条） */

console.log('\n=== 账户名显示在备注左边 ===')

/*
 * 用户原话：「在所有出现交易、流水信息的地方，将账户名显示在备注的左边」
 * 判据：拼副标题时 account_name 的 push 必须出现在 note 的 push 之前。
 */
const SUB_FILES = [
  'pages/txn/list.vue',
  'pages/index/index.vue',
  'components/RecentTxnList.vue'
]
for (const file of SUB_FILES) {
  const code = stripComments(read(file))
  const fn = code.match(/function txnSub\(txn\)[\s\S]*?\n    \}/)
  const body = fn ? fn[0] : ''
  const iAcc = body.indexOf('account_name')
  const iNote = body.indexOf('txn.note')
  check(`${file} 的 txnSub 里账户名在备注之前`, iAcc > 0 && iNote > 0 && iAcc < iNote, true)
}

// 统计页 Top10 是模板里的一行三元表达式，单独判
const statsTpl = stripComments(read('pages/stats/index.vue'))
check(
  '统计页 Top10 副标题账户名在前',
  /t\.account_name \|\| t\.note/.test(statsTpl),
  true
)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) {
  console.log('\n失败项：')
  for (const f of fails) console.log('  · ' + f.split('\n')[0])
  process.exit(1)
}
