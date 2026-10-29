/**
 * 环形图 SVG 构建测试
 *
 *   node scripts/test-donut.mjs
 *
 * 覆盖 utils/donut.js：
 *   1. 扇区 path 数量、引导线数量（直线 line）、文字数量
 *   2. 文字内容（名称 + 占比）、低于 1% 不标注
 *   3. 左右两列对齐、竖向间距、不越界、引导直线互不交叉
 *   4. 起始角 330°（11 点钟）
 *   5. 空数据 / 单段 / 分段边界 / data URI 封装
 */

let pass = 0
let fail = 0

import { buildDonutSvg, donutToDataUri, DONUT_GEOM, DONUT_LABEL } from '../utils/donut.js'
import { svgToDataUri } from '../utils/chart.js'

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

console.log('=== 环形图 SVG 构建 ===')

const items = [
  { name: '餐饮', amount: 5000, color: '#1E88E5' },
  { name: '交通', amount: 3000, color: '#FB8C00' },
  { name: '购物', amount: 2000, color: '#43A047' }
]

{
  const svg = buildDonutSvg(items, { total: 10000 })
  check('以 <svg 开头', svg.startsWith('<svg '), true)
  check('以 </svg> 结尾', svg.trim().endsWith('</svg>'), true)
  check('含 viewBox', svg.includes('viewBox="0 0 300 180"'), true)
  check('含 xmlns', svg.includes('xmlns="http://www.w3.org/2000/svg"'), true)

  // 3 段环
  const paths = (svg.match(/<path /g) || []).length
  check('环段 path 数量', paths, 3)

  // 引导线（直线 line）+ 文字（前 topN 个都标注）
  const leads = (svg.match(/<line /g) || []).length
  check('直线引导线数量', leads, 3)
  check('不再用折线引导线', (svg.match(/<polyline /g) || []).length, 0)
  // 每条直线 2 个端点：环边缘 → 标签行
  const firstLine = svg.match(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/)
  check('直线有 2 个端点', firstLine ? 1 : 0, 1)
  const texts = (svg.match(/<text /g) || []).length
  check('文字数量', texts, 3)

  // 文字内容：名称 + 占比
  check('含餐饮 50%', svg.includes('餐饮 50%'), true)
  check('含交通 30%', svg.includes('交通 30%'), true)
  check('含购物 20%', svg.includes('购物 20%'), true)
}

{
  // 空数据
  check('空列表返回空串', buildDonutSvg([], { total: 0 }), '')
  check('total 为 0 返回空串', buildDonutSvg(items, { total: 0 }), '')
}

{
  // 单段：1 个 path + 1 条引导线 + 1 个文字
  const svg = buildDonutSvg([{ name: '全部', amount: 100, color: '#000' }], { total: 100 })
  check('单段 path', (svg.match(/<path /g) || []).length, 1)
  check('单段文字', (svg.match(/<text /g) || []).length, 1)
  check('单段 100%', svg.includes('全部 100%'), true)
}

{
  // 占比取整到一位小数
  const svg = buildDonutSvg([{ name: 'A', amount: 1, color: '#111' }, { name: 'B', amount: 2, color: '#222' }], { total: 3 })
  check('A 33.3%', svg.includes('A 33.3%'), true)
  check('B 66.7%', svg.includes('B 66.7%'), true)
}

{
  // 超过 topN 的部分不标注文字，但环段仍画
  const many = []
  for (let i = 0; i < 12; i++) many.push({ name: `C${i}`, amount: 10, color: `#${i}00000` })
  const svg = buildDonutSvg(many, { total: 120, topN: 5 })
  const paths = (svg.match(/<path /g) || []).length
  const texts = (svg.match(/<text /g) || []).length
  check('12 段全部画环', paths, 12)
  check('只标注前 5 段', texts, 5)
}

{
  // data URI 封装
  const uri = donutToDataUri(items, { total: 10000 })
  check('data URI 前缀', uri.startsWith('data:image/svg+xml;charset=utf-8,'), true)
  const decoded = decodeURIComponent(uri.replace('data:image/svg+xml;charset=utf-8,', ''))
  check('解码回原 SVG', decoded, buildDonutSvg(items, { total: 10000 }))
}

{
  // 几何常量合理性：外半径 > 内半径，引导线起点在外缘之外
  check('外半径 > 内半径', DONUT_GEOM.rOuter > DONUT_GEOM.rInner, true)
  check('引导线起点 > 外半径', DONUT_GEOM.leadFrom > DONUT_GEOM.rOuter, true)
  check('标签半径 > 引导线起点', DONUT_GEOM.labelR > DONUT_GEOM.leadFrom, true)
  check('右列在圆心右侧', DONUT_LABEL.colRightX > DONUT_GEOM.cx, true)
  check('左列在圆心左侧', DONUT_LABEL.colLeftX < DONUT_GEOM.cx, true)
  check('最小间距为正', DONUT_LABEL.minGap > 0, true)
  // ★ 起始角：11 点钟方向（330°，0=顶部顺时针）★
  check('起始角为 11 点钟（330°）', DONUT_GEOM.startDeg, 330)
}

{
  /*
   * ★ 两列对齐 + 竖向间距 + 不越界 ★
   *   8 个扇区（含 4%/2% 这种小块），检查排布是否整齐。
   */
  const svg = buildDonutSvg([
    { name: '餐饮', amount: 3000, color: '#1E88E5' },
    { name: '交通', amount: 2200, color: '#FB8C00' },
    { name: '购物', amount: 1500, color: '#43A047' },
    { name: '住房', amount: 1200, color: '#E53935' },
    { name: '娱乐', amount: 900, color: '#8E24AA' },
    { name: '医疗', amount: 600, color: '#F06292' },
    { name: '教育', amount: 400, color: '#6D4C41' },
    { name: '其他', amount: 200, color: '#9E9D24' }
  ], { total: 10000 })

  const labels = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*text-anchor="([^"]+)"[^>]*>([^<]+)<\/text>/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]), anchor: m[3], text: m[4] }))

  const right = labels.filter((l) => l.anchor === 'start')
  const left = labels.filter((l) => l.anchor === 'end')

  check('标签总数 = 8', labels.length, 8)
  check('没有 middle 锚点（只分两列）', labels.filter((l) => l.anchor === 'middle').length, 0)
  check('右列 x 全部对齐', right.every((l) => l.x === DONUT_LABEL.colRightX), true)
  check('左列 x 全部对齐', left.every((l) => l.x === DONUT_LABEL.colLeftX), true)

  // 每列内部按 y 排序后，间距都 >= minGap
  for (const [name, col] of [['右列', right], ['左列', left]]) {
    const ys = col.map((l) => l.y).sort((a, b) => a - b)
    let minGap = Infinity
    for (let i = 1; i < ys.length; i++) minGap = Math.min(minGap, ys[i] - ys[i - 1])
    check(`${name}竖向间距 >= minGap`, col.length < 2 || minGap >= DONUT_LABEL.minGap, true)
  }

  // 全部落在 viewBox（300×180）的可用竖向范围内
  check('标签 y 都在可用范围内', labels.every((l) => l.y >= DONUT_LABEL.minY && l.y <= DONUT_LABEL.maxY), true)

  /*
   * ★ 直线不交叉的守门断言 ★
   *   直接做几何检测：任意两条引导直线之间不能有真交叉。
   *   这才是「不要交叉」这个需求的准确判据。
   */
  const leads = [...svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g)].map((m) => [
    { x: Number(m[1]), y: Number(m[2]) },
    { x: Number(m[3]), y: Number(m[4]) }
  ])
  check('直线数量 = 标签数', leads.length, labels.length)

  /** 向量叉积，用于判断两条线段是否真相交（端点相接不算） */
  function cross(p, q, r) {
    return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  }
  function segIntersect(a1, a2, b1, b2) {
    const d1 = cross(b1, b2, a1)
    const d2 = cross(b1, b2, a2)
    const d3 = cross(a1, a2, b1)
    const d4 = cross(a1, a2, b2)
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
           ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  }

  let crossingPairs = 0
  for (let i = 0; i < leads.length; i++) {
    for (let j = i + 1; j < leads.length; j++) {
      const A = leads[i], B = leads[j]
      let hit = false
      for (let a = 0; a < A.length - 1; a++) {
        for (let b = 0; b < B.length - 1; b++) {
          if (segIntersect(A[a], A[a + 1], B[b], B[b + 1])) hit = true
        }
      }
      if (hit) crossingPairs++
    }
  }
  check('引导直线互不交叉', crossingPairs, 0)
}

{
  /*
   * ★ 低于 1% 不标注 ★
   *   用户要求：占比小于 1% 的块不显示标签。
   */
  const svg = buildDonutSvg([
    { name: '大头', amount: 9900, color: '#111' },
    { name: '小块', amount: 100, color: '#222' }  // 100/10000 = 1%
  ], { total: 10000 })
  check('正好 1% 仍标注', svg.includes('小块 1%'), true)

  const svg2 = buildDonutSvg([
    { name: '大头', amount: 9950, color: '#111' },
    { name: '碎块', amount: 50, color: '#222' }  // 50/10000 = 0.5%
  ], { total: 10000 })
  check('低于 1% 不标注', svg2.includes('碎块'), false)
  // 但环段仍画（数据不能丢）
  check('低于 1% 仍画环段', (svg2.match(/<path /g) || []).length, 2)
}

{
  // 名称过长要截断，避免冲出 viewBox
  const svg = buildDonutSvg([
    { name: '非常长的分类名称啊啊啊', amount: 5000, color: '#111' },
    { name: '短', amount: 5000, color: '#222' }
  ], { total: 10000 })
  check('长名称被截断带省略号', svg.includes('非常长的…'), true)
}

{
  // 极小扇区（占比 < 间隙）跳过不画，避免负 sweep 产生怪异 path
  const svg = buildDonutSvg([
    { name: '大头', amount: 9999, color: '#111' },
    { name: '微尘', amount: 1, color: '#222' }
  ], { total: 10000 })
  const paths = (svg.match(/<path /g) || []).length
  check('极小扇区被跳过（只画 1 段）', paths, 1)
  // 微尘 sweep = 0.036° < 2°，不标注
  check('极小扇区不标注', svg.includes('微尘'), false)
}

// 与 svgToDataUri 一致
{
  check('donutToDataUri 与 svgToDataUri 一致',
    donutToDataUri(items, { total: 10000 }),
    svgToDataUri(buildDonutSvg(items, { total: 10000 })))
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
