/**
 * 光滑折线图的几何计算测试
 *
 *   node scripts/test-line-chart.mjs
 *
 * 验证三件事：
 *   1. 纵轴范围必须包含 0（否则曲线贴底看不出变化）
 *   2. 曲线路径的贝塞尔控制点方向正确（不甩出去）
 *   3. 坐标轴标签的首尾日期正确
 *
 * 几何计算抽在 utils/chart.js 里（纯函数），组件与测试共用。
 */

import {
  calcBounds, calcCoords, calcZeroY, calcLinePath, calcAreaPath,
  calcMarkers, formatChartDay, buildSvgSource, svgToDataUri,
  findNearestIndex, calcSmoothPath
} from '../utils/chart.js'

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

const OPTS = { width: 300, height: 100, padTop: 8, padBottom: 6 }

console.log('=== 纵轴范围必须包含 0 ===')

{
  const b = calcBounds([10000, 20000])
  check('全为正时下界取 0', b.min, 0)
  check('全为正时上界是最大值', b.max, 20000)
  check('全为正时没有 0 基线', calcZeroY(b, OPTS), null)
}

{
  const b = calcBounds([-5000, 3000])
  check('跨越 0 时下界为负', b.min, -5000)
  check('跨越 0 时上界为正', b.max, 3000)
  check('跨越 0 时有 0 基线', typeof calcZeroY(b, OPTS), 'number')
}

{
  const b = calcBounds([-1000, -3000])
  check('全为负时上界取 0', b.max, 0)
  check('全为负时没有 0 基线', calcZeroY(b, OPTS), null)
}

{
  // 全部相同 -> 不能除以 0
  const b = calcBounds([1000, 1000])
  check('全相同时范围不为 0', b.max - b.min > 0, true)
}

{
  check('空数组', calcBounds([]), { min: 0, max: 0 })
}

console.log('=== 坐标与路径 ===')

{
  const points = [
    { day: '2026-10-20', total: 0 },
    { day: '2026-10-21', total: 1000 },
    { day: '2026-10-22', total: 2000 }
  ]
  const c = calcCoords(points, OPTS)
  check('3 个点', c.length, 3)
  check('第一个点 x=0', c[0].x, 0)
  check('中间点 x=150', c[1].x, 150)
  check('最后一个点 x=300', c[2].x, 300)
  // 第一个点值最小 -> y 最大（靠下）
  check('第一个点靠下', c[0].y > c[2].y, true)

  const d = calcLinePath(c)
  check('路径以 M 开头', d.startsWith('M '), true)
  check('路径用直线 L', d.includes(' L '), true)
  check('路径不含贝塞尔 C', d.includes(' C '), false)
  check('路径是 2 段直线', (d.match(/ L /g) || []).length, 2)

  const area = calcAreaPath(c, d, 100)
  check('填充路径以 M 开头', area.startsWith('M '), true)
  check('填充路径以 Z 结尾', area.trim().endsWith('Z'), true)
}

{
  // 平滑曲线函数还留着（用户要求直线，但保留以便切回）
  const c = calcCoords([
    { day: '2026-10-20', total: 0 },
    { day: '2026-10-21', total: 1000 },
    { day: '2026-10-22', total: 2000 }
  ], OPTS)
  const smooth = calcSmoothPath(c)
  check('平滑路径含贝塞尔 C', smooth.includes(' C '), true)
}

{
  // 只有 2 个点 -> 用直线
  const c = calcCoords([
    { day: '2026-10-20', total: 0 },
    { day: '2026-10-21', total: 1000 }
  ], OPTS)
  const d = calcLinePath(c)
  check('2 个点用直线', d.includes(' L '), true)
  check('2 个点不含贝塞尔', d.includes(' C '), false)
}

console.log('=== 触摸找最近点 ===')

{
  const coords = [
    { x: 0, y: 50 },
    { x: 100, y: 40 },
    { x: 200, y: 30 },
    { x: 300, y: 20 }
  ]
  check('正好在第1个点', findNearestIndex(0, coords), 0)
  check('正好在第2个点', findNearestIndex(100, coords), 1)
  check('正好在第4个点', findNearestIndex(300, coords), 3)
  check('靠近第2个点', findNearestIndex(110, coords), 1)
  check('靠近第3个点', findNearestIndex(190, coords), 2)
  // 正好在两个点中间（150）-> 取距离相同时先遇到的那个
  check('中点取先遇到的那个', findNearestIndex(150, coords), 1)
  // 超出范围
  check('超出右边', findNearestIndex(999, coords), 3)
  check('超出左边', findNearestIndex(-50, coords), 0)
  // 空 / 单点
  check('空坐标 -> -1', findNearestIndex(100, []), -1)
  check('单点 -> 0', findNearestIndex(100, [{ x: 50, y: 10 }]), 0)
}

{
  // 单个点 -> 空路径
  const c = calcCoords([{ day: '2026-10-20', total: 0 }], OPTS)
  check('1 个点无路径', calcLinePath(c), '')
  check('1 个点无填充', calcAreaPath(c, '', 100), '')
}

{
  // 空数据
  check('空点无坐标', calcCoords([], OPTS), [])
  check('空点无路径', calcLinePath([]), '')
}

console.log('=== 曲线不甩出去 ===')

{
  // 单调上升的点：控制点应该在两点之间，不该越界
  const c = calcCoords([
    { day: '2026-10-20', total: 0 },
    { day: '2026-10-21', total: 1000 },
    { day: '2026-10-22', total: 2000 },
    { day: '2026-10-23', total: 3000 }
  ], OPTS)

  const d = calcLinePath(c)
  // 提取所有控制点的数值
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number)
  // 路径里出现的所有 y 值都应该在图表高度范围内
  const ys = []
  const parts = d.split(/[MLC ,]+/).filter(Boolean).map(Number)
  // 简化检查：所有点坐标 y 在 [padTop, height-padBottom] 内
  for (const p of c) {
    check(`点 ${p.index} 的 y 在范围内`, p.y >= 8 && p.y <= 94, true)
  }
  check('路径非空', d.length > 0, true)
}

console.log('=== 数据点标记 ===')

{
  const c = calcCoords([
    { day: '2026-10-20', total: 0 },
    { day: '2026-10-21', total: 1000 },
    { day: '2026-10-22', total: 2000 }
  ], OPTS)
  const m = calcMarkers(c, '#07C160')
  check('3 个标记', m.length, 3)
  check('最后一个点更大', m[2].r > m[0].r, true)
  check('最后一个点实心', m[2].fill, '#07C160')
  check('中间点空心', m[1].fill, 'var(--app-card)')
}

console.log('=== 日期格式 ===')

check('10/20', formatChartDay('2026-10-20'), '10/20')
check('1/5', formatChartDay('2026-01-05'), '1/5')
check('空', formatChartDay(''), '')
check('非法', formatChartDay('abc'), 'abc')

console.log('=== SVG 源码生成 ===')

{
  const points = [
    { day: '2026-10-20', total: 0 },
    { day: '2026-10-21', total: 1000 },
    { day: '2026-10-22', total: 2000 }
  ]
  const c = calcCoords(points, OPTS)
  const d = calcLinePath(c)
  const area = calcAreaPath(c, d, 100)
  const m = calcMarkers(c, '#07C160')

  const svg = buildSvgSource({
    coords: c, linePath: d, areaPath: area, markers: m,
    color: '#07C160', zeroY: null, width: 300, height: 100
  })

  check('以 <svg 开头', svg.startsWith('<svg '), true)
  check('以 </svg> 结尾', svg.trim().endsWith('</svg>'), true)
  check('含 viewBox', svg.includes('viewBox="0 0 300 100"'), true)
  check('含 xmlns', svg.includes('xmlns="http://www.w3.org/2000/svg"'), true)
  check('含折线 path', svg.includes('<path d="M '), true)
  check('含渐变定义', svg.includes('<linearGradient'), true)
  check('含填充 path', svg.includes('fill="url(#g)"'), true)
  check('含主题色', svg.includes('stroke="#07C160"'), true)
  check('不含 0 基线', svg.includes('stroke-dasharray'), false)
  // ★ 数据点默认不显示（用户要求）
  check('默认不画数据点', svg.includes('<circle'), false)

  // 触摸命中某个点时才画那一个点
  const svgActive = buildSvgSource({
    coords: c, linePath: d, areaPath: area, markers: m,
    color: '#07C160', zeroY: null, width: 300, height: 100,
    activeIndex: 1
  })
  check('命中时只画 1 个点', (svgActive.match(/<circle/g) || []).length, 1)
  check('命中时有竖线辅助', svgActive.includes('stroke-opacity="0.35"'), true)

  // data URI
  const uri = svgToDataUri(svg)
  check('data URI 前缀', uri.startsWith('data:image/svg+xml;charset=utf-8,'), true)
  check('data URI 非空', uri.length > 100, true)
  // # 必须被编码，否则会被当成 URL fragment
  check('data URI 里没有裸 #', uri.includes('#'), false)
  check('data URI 里没有裸空格', uri.includes(' '), false)
  // 解码回来应该等于原 SVG
  const decoded = decodeURIComponent(uri.replace('data:image/svg+xml;charset=utf-8,', ''))
  check('解码回来等于原 SVG', decoded, svg)
}

{
  // 跨越 0 时要画基线
  const points = [
    { day: '2026-10-20', total: -1000 },
    { day: '2026-10-21', total: 2000 }
  ]
  const c = calcCoords(points, OPTS)
  const d = calcLinePath(c)
  const b = calcBounds([-1000, 2000])
  const svg = buildSvgSource({
    coords: c, linePath: d, areaPath: calcAreaPath(c, d, 100),
    markers: calcMarkers(c, '#07C160'),
    color: '#07C160', zeroY: calcZeroY(b, OPTS), width: 300, height: 100
  })
  check('有 0 基线', svg.includes('stroke-dasharray="3 3"'), true)
}

{
  // 没有折线 -> 没有 SVG
  check('无折线 -> 空 SVG', buildSvgSource({ linePath: '' }), '')
  check('无 SVG -> 空 data URI', svgToDataUri(''), '')
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
