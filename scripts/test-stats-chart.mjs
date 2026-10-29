/**
 * 统计页饼图与平均值的计算测试
 *
 *   node scripts/test-stats-chart.mjs
 *
 * 覆盖统计页新加/改的计算：
 *   1. 饼图百分比
 *   2. 各分类平均值的笔均/日均（一级）
 *   3. 二级分类平均值的映射（新增 getSubCategoryAveragesRange）
 *   4. 日趋势的最高/最低日（新增）
 */

let pass = 0
let fail = 0

import { PIE_PALETTE } from '../api/stats.js'

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

console.log('=== 饼图百分比 ===')

function piePercent(amount, total) {
  if (!total) return 0
  return Math.round((amount / total) * 1000) / 10
}

check('一半', piePercent(50, 100), 50)
check('三分之一', piePercent(1, 3), 33.3)
check('全部', piePercent(100, 100), 100)
check('total 为 0', piePercent(10, 0), 0)

console.log('=== 饼图调色板 ===')

{
  // 每块颜色都要不同，否则饼图分不开
  check('调色板有 10 色', PIE_PALETTE.length, 10)
  check('没有重复色', new Set(PIE_PALETTE).size, PIE_PALETTE.length)
  check('都是合法十六进制', PIE_PALETTE.every((c) => /^#[0-9a-fA-F]{6}$/.test(c)), true)

  // 相邻两块要有明显的色相/明度差
  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  function dist(a, b) {
    const [r1, g1, b1] = rgb(a)
    const [r2, g2, b2] = rgb(b)
    return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
  }
  let minDist = Infinity
  for (let i = 0; i < PIE_PALETTE.length; i++) {
    for (let j = i + 1; j < PIE_PALETTE.length; j++) {
      minDist = Math.min(minDist, dist(PIE_PALETTE[i], PIE_PALETTE[j]))
    }
  }
  // 任意两块之间的 RGB 距离都要够大（>= 75 才算一眼能分开）
  check('最接近的两块也差得开', minDist >= 75, true)
}

console.log('=== 各分类平均值（一级） ===')

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

console.log('=== 二级分类平均值映射 ===')

/**
 * 与 getSubCategoryAveragesRange 的 map 同逻辑。
 * 验证：二级平均值按调色板取色、保留 parentName、笔均/日均正确。
 */
function calcSubCategoryAverages(rows, daysPassed) {
  return rows.map((r, i) => {
    const amount = Number(r.amt) || 0
    const count = Number(r.cnt) || 0
    return {
      id: r.id || 'none',
      name: r.name || '未分类',
      color: PIE_PALETTE[i % PIE_PALETTE.length],
      parentName: r.parent_name || '未分类',
      amount,
      count,
      avgPerTxn: count > 0 ? Math.round(amount / count) : 0,
      avgPerDay: daysPassed > 0 ? Math.round(amount / daysPassed) : 0,
      totalDays: daysPassed
    }
  })
}

{
  const rows = [
    { id: 1, name: '午餐', parent_name: '餐饮', amt: 50000, cnt: 10 },
    { id: 2, name: '地铁', parent_name: '交通', amt: 10000, cnt: 5 }
  ]
  const avgs = calcSubCategoryAverages(rows, 30)

  check('二级保留父分类名', avgs[0].parentName, '餐饮')
  check('二级按调色板取色', avgs[0].color, PIE_PALETTE[0])
  check('午餐笔均', avgs[0].avgPerTxn, 5000)
  check('地铁日均', avgs[1].avgPerDay, 333)
}

{
  // 已删除分类（id 为 null）
  const avgs = calcSubCategoryAverages([{ id: null, name: null, parent_name: null, amt: 100, cnt: 1 }], 10)
  check('已删除分类 id 用 none', avgs[0].id, 'none')
  check('已删除分类名用未分类', avgs[0].name, '未分类')
  check('已删除分类父名用未分类', avgs[0].parentName, '未分类')
}

console.log('=== 日趋势最高/最低日 ===')

/**
 * 与页面的 dailyExtremes 同逻辑。
 * 排除 expense = 0 的日期，取最大/最小。
 */
function calcDailyExtremes(list) {
  const filtered = (list || []).filter((d) => Number(d.expense) > 0)
  if (filtered.length === 0) return null
  let max = filtered[0]
  let min = filtered[0]
  for (const d of filtered) {
    if (Number(d.expense) > Number(max.expense)) max = d
    if (Number(d.expense) < Number(min.expense)) min = d
  }
  return { max: { label: max.label, expense: max.expense }, min: { label: min.label, expense: min.expense } }
}

{
  const trend = [
    { label: '1', expense: 0 },
    { label: '2', expense: 500 },
    { label: '3', expense: 1200 },
    { label: '4', expense: 200 },
    { label: '5', expense: 0 }
  ]
  const ext = calcDailyExtremes(trend)
  check('最高日', ext.max, { label: '3', expense: 1200 })
  check('最低日', ext.min, { label: '4', expense: 200 })
}

{
  // 全为 0 / 空 → null
  check('全 0 返回 null', calcDailyExtremes([{ label: '1', expense: 0 }]), null)
  check('空数组返回 null', calcDailyExtremes([]), null)
}

{
  // 并列最高/最低：取第一个
  const ext = calcDailyExtremes([
    { label: '1', expense: 100 },
    { label: '2', expense: 100 },
    { label: '3', expense: 50 }
  ])
  check('并列最高取第一个', ext.max.label, '1')
  check('最低取唯一', ext.min.label, '3')
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
