/**
 * 「系统设置」中间页已删除
 *
 *   node scripts/test-no-settings-hub.mjs
 *
 * ★ 这个测试锁住一次页面删除 ★
 *   用户原话：「把点击左上角的头像进入的这个页面彻底删除」。
 *
 *   那个页面（pages/settings/index.vue）是个「设置聚合页」，
 *   但它上面的每一个条目在别处都有直达入口，
 *   反而造成两个问题：
 *     1. 多一层跳转（想改个设置要点两下）
 *     2. 「我的」页的菜单分组和它对不上，
 *        让人以为两处是同一批东西、却内容不同
 *
 *   删除后：
 *     首页/账户页/统计页的头像 -> 「个人信息」页
 *     所有设置项从「我的」页直达
 */

import fs from 'fs'
import path from 'path'

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

console.log('=== 页面文件已删除 ===')

check('pages/settings/index.vue 不存在', fs.existsSync(path.join(ROOT, 'pages/settings/index.vue')), false)

console.log('=== pages.json 里没有这个路由 ===')

const pagesJson = read('pages.json')
check('没有 settings/index 路由', /"pages\/settings\/index"/.test(pagesJson), false)
check('settings/profile 路由还在', /"pages\/settings\/profile"/.test(pagesJson), true)

console.log('=== 没有代码再指向这个页面 ===')

const SCAN = ['pages', 'components', 'api', 'stores', 'utils']
function walk(dir) {
  let out = []
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) out = out.concat(walk(p))
    else if (/\.(vue|js)$/.test(e.name)) out.push(p)
  }
  return out
}

for (const dir of SCAN) {
  for (const file of walk(dir)) {
    const src = read(file)
    check(`${file} 没有引用 /pages/settings/index`, src.includes('/pages/settings/index'), false)
  }
}

console.log('=== 三个 tab 页的头像改成了「个人信息」===')

for (const file of ['pages/index/index.vue', 'pages/account/index.vue', 'pages/stats/index.vue']) {
  const src = read(file)
  check(`${file} 头像跳个人信息`, /@avatar-click="goProfile"/.test(src), true)
  check(`${file} 有 goProfile 函数`, /function goProfile\(\)/.test(src), true)
  check(`${file} goProfile 指向 profile 页`, /\/pages\/settings\/profile/.test(src), true)
  check(`${file} 没有 goSettings 了`, /goSettings/.test(src), false)
}

console.log('=== 「我的」页是现在唯一��设置总入口 ===')

const mine = read('pages/mine/index.vue')
const ROUTES = [
  ['/pages/settings/category', '分类管理'],
  ['/pages/settings/tag', '标签管理'],
  ['/pages/settings/budget', '预算管理'],
  ['/pages/settings/quick-add', '记账按钮设置'],
  ['/pages/settings/ai', 'AI 智能配置'],
  ['/pages/settings/theme', '主题外观'],
  ['/pages/settings/data', '数据与备份']
]
for (const [route, name] of ROUTES) {
  check(`「我的」页有 ${name} 入口`, mine.includes(route), true)
}

console.log('=== 「默认账户」的 UI 入口删了，但功能没丢 ===')

// 用户选择「直接删掉这个功能」——
// 但账户页本身就有「设为默认」，所以 defaultAccountId 这套逻辑要完整保留。
const accountPage = read('pages/account/index.vue')
check('账户页还有「设为默认」入口', /设为默认/.test(accountPage), true)
check('defaultAccountId 的 getter 还在', /defaultAccountId/.test(read('stores/setting.js')), true)
check('QuickAddBar 还在用默认账户', /defaultAccountId/.test(read('components/QuickAddBar.vue')), true)
check('TxnPanel 还在用默认账户', /defaultAccountId/.test(read('components/TxnPanel.vue')), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
