/**
 * 环形图 SVG 构建测试
 *
 *   node scripts/test-donut.mjs
 *
 * 覆盖 utils/donut.js：
 *   1. 扇区 path 数量、引导线数量、文字数量
 *   2. 文字内容（名称 + 占比）
 *   3. 空数据 / 单段 / 分段边界
 *   4. data URI 封装
 */

let pass = 0
let fail = 0

import { buildDonutSvg, donutToDataUri, DONUT_GEOM } from '../utils/donut.js'
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

  // 引导线 + 文字（前 topN 个都标注）
  const lines = (svg.match(/<line /g) || []).length
  check('引导线数量', lines, 3)
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
  // 几何常量合理性：外半径 > 内半径，引导线外端 > 外半径
  check('外半径 > 内半径', DONUT_GEOM.rOuter > DONUT_GEOM.rInner, true)
  check('引导线起点 > 外半径', DONUT_GEOM.leadFrom > DONUT_GEOM.rOuter, true)
  check('引导线终点 > 起点', DONUT_GEOM.leadTo > DONUT_GEOM.leadFrom, true)
  check('文字半径 > 引导线终点', DONUT_GEOM.labelR > DONUT_GEOM.leadTo, true)
}

{
  // 文字防重叠：顶部/底部相邻标签保证 y 间距，不再互相叠
  // 复刻「教育 4% / 其他 2%」这种曾重叠的场景（8 个扇区，占比小）
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

  // 解析所有 text 的位置
  const ys = [...svg.matchAll(/<text x="[\d.]+" y="([\d.]+)"[^>]*text-anchor="([^"]+)"[^>]*>([^<]+)<\/text>/g)]
    .map((m) => ({ y: Number(m[1]), anchor: m[2], label: m[3] }))

  // 顶部区域（y < 90）的标签，任意两个 y 间距 >= 10（文字高约 12，去掉一半）
  const top = ys.filter((t) => t.y < 90).sort((a, b) => a.y - b.y)
  let minGap = Infinity
  for (let i = 1; i < top.length; i++) {
    minGap = Math.min(minGap, top[i].y - top[i - 1].y)
  }
  check('顶部标签 y 间距 >= 10', minGap >= 10, true)

  // 底部区域同理
  const bottom = ys.filter((t) => t.y >= 90).sort((a, b) => a.y - b.y)
  let minGapB = Infinity
  for (let i = 1; i < bottom.length; i++) {
    minGapB = Math.min(minGapB, bottom[i].y - bottom[i - 1].y)
  }
  check('底部标签 y 间距 >= 10', minGapB >= 10, true)
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
