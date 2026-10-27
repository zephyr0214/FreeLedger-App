/**
 * 统计页饼图与平均值的计算测试
 *
 *   node scripts/test-stats-chart.mjs
 *
 * 覆盖统计页新加/改的三个计算：
 *   1. 环形图（conic-gradient）的分段是否正确
 *   2. 饼图百分比
 *   3. 各分类平均值的笔均/日均
 */

let pass = 0
let fail = 0

import { shadeColor } from '../api/stats.js'

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
/* ---------------------------------------------- 环形图（与页面同逻辑） */

function buildDonut(list, total) {
  const items = (list || []).slice(0, 7)
  if (items.length === 0 || !total) {
    return { background: 'var(--app-card-2)' }
  }
  let acc = 0
  const stops = []
  for (const item of items) {
    const pct = (item.amount / total) * 100
    const from = acc
    acc += pct
    stops.push(`${item.color} ${from}% ${acc}%`)
  }
  if (acc < 100) {
    stops.push(`var(--app-line) ${acc}% 100%`)
  }
  return { background: `conic-gradient(${stops.join(', ')})` }
}

/** 把 conic-gradient 的字符串解析回分段数组 */
function parseStops(background) {
  const inner = background.replace(/^conic-gradient\(/, '').replace(/\)$/, '')
  return inner.split(', ').map((s) => s.split(' '))
}

console.log('=== 环形图分段 ===')

{
  const bg = buildDonut([
    { amount: 300, color: '#A' },
    { amount: 100, color: '#B' }
  ], 400)
  const stops = parseStops(bg.background)
  check('金额加正好 100% 时只有 2 段', stops.length, 2)
  check('第1段从 0% 开始', stops[0][1], '0%')
  check('第1段到 75%', stops[0][2], '75%')
  check('第2段从 75%', stops[1][1], '75%')
  check('第2段到 100%', stops[1][2], '100%')
}

{
  // 金额加起来不足 total 时要有收尾段
  const bg = buildDonut([{ amount: 300, color: '#A' }], 500)
  const stops = parseStops(bg.background)
  check('不足 100% 有收尾段', stops.length, 2)
  check('收尾段到 100%', stops[1][2], '100%')
  check('收尾段用 line 色', stops[1][0], 'var(--app-line)')
}

{
  // 空数据
  check('空列表 -> 灰色', buildDonut([], 0).background, 'var(--app-card-2)')
  check('total 为 0 -> 灰色', buildDonut([{ amount: 1, color: '#A' }], 0).background, 'var(--app-card-2)')
}

{
  // 最多 7 段
  const many = []
  for (let i = 0; i < 12; i++) many.push({ amount: 10, color: `#${i}` })
  const stops = parseStops(buildDonut(many, 120).background)
  check('最多 7 段 + 收尾', stops.length, 8)
}

console.log('=== 饼图百分比 ===')

function piePercent(amount, total) {
  if (!total) return 0
  return Math.round((amount / total) * 1000) / 10
}

check('一半', piePercent(50, 100), 50)
check('三分之一', piePercent(1, 3), 33.3)
check('全部', piePercent(100, 100), 100)
check('total 为 0', piePercent(10, 0), 0)

console.log('=== 二级分类的色阶派生 ===')

{
  // 同一父级下的二级分类要能区分开（同一色系的不同深浅）
  check('第一个用原色', shadeColor('#1989FA', 0), '#1989FA')
  check('第二个变暗', shadeColor('#1989FA', 1) !== '#1989FA', true)
  check('第三个比第二个更暗', shadeColor('#1989FA', 2) !== shadeColor('#1989FA', 1), true)
  // 不能黑到看不见
  check('序号很大也不会全黑', shadeColor('#1989FA', 20).slice(1, 3) !== '00', true)
  // 非法输入兜底
  check('非法颜色兜底', shadeColor('不是颜色', 1), '#1989FA')
  check('空值兜底', shadeColor('', 0), '#1989FA')
  // 颜色格式合法
  check('输出是 7 位十六进制', /^#[0-9a-f]{6}$/.test(shadeColor('#1989FA', 3)), true)
}

console.log('=== 各分类平均值 ===')
/** 与 getCategoryAveragesRange 同逻辑 */
function calcCategoryAverages(rows, daysPassed) {
  return rows.map((r) => {
    const amount = Number(r.amt) || 0
    const count = Number(r.cnt) || 0
    return {
      name: r.name,
      amount,
      count,
      avgPerTxn: count > 0 ? Math.round(amount / count) : 0,
      avgPerDay: daysPassed > 0 ? Math.round(amount / daysPassed) : 0
    }
  })
}

{
  const rows = [
    { name: '餐饮', amt: 100000, cnt: 10 },   // 1000 元 / 10 笔
    { name: '交通', amt: 20000, cnt: 4 }      // 200 元 / 4 笔
  ]
  const avgs = calcCategoryAverages(rows, 30)

  check('餐饮笔均', avgs[0].avgPerTxn, 10000)
  check('餐饮日均', avgs[0].avgPerDay, 3333)
  check('交通笔均', avgs[1].avgPerTxn, 5000)
  check('交通日均', avgs[1].avgPerDay, 667)
}

{
  // 边界：0 笔、0 天
  const avgs = calcCategoryAverages([{ name: 'X', amt: 0, cnt: 0 }], 0)
  check('0 笔时笔均为 0', avgs[0].avgPerTxn, 0)
  check('0 天时日均为 0', avgs[0].avgPerDay, 0)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
