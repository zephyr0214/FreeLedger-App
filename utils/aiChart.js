/**
 * AI 对话的图表渲染 —— 把本地取到的数据画成 SVG data URI
 *
 * ★ 为什么自己画而不用现成的 utils/donut.js ★
 *   donut.js 是给统计页用的「环形图 + 引导线标注」，尺寸固定（300×180），
 *   适合有完整标题和图例的卡片。
 *   对话气泡里的图要更紧凑、配色跟着主题走、还要支持条形图和折线图，
 *   所以这里单独做一套，风格与对话气泡统一。
 *
 * ★ uni-app 不认 <svg> 标签 ★
 *   只能把 SVG 拼成字符串，用 <image> 以 data:image/svg+xml;charset=utf-8 加载。
 *   （App 端跑在 WebView 上，WebView 支持 SVG。）
 *
 * ★ 纯函数，可单测 ★
 */

import { svgToDataUri } from './chart.js'

/** 图表默认配色（与统计页 PIE_PALETTE 同源，保证全 App 观感一致） */
export const AI_CHART_PALETTE = [
  '#1E88E5', '#FB8C00', '#43A047', '#E53935', '#8E24AA',
  '#F06292', '#6D4C41', '#9E9D24', '#26A69A', '#5C6BC0'
]

/** 折线图默认高度 */
const TREND_HEIGHT = 120
/** 条形图每根的高度 */
const BAR_ROW_HEIGHT = 34

/**
 * 转义 XML 特殊字符。
 *
 * ★ 分类名、账户名都来自用户输入 ★
 *   里面有 & < > 会把 SVG 撑坏（标签提前闭合，图就乱掉了）。
 */
export function escapeXml(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 环形图（分类构成）
 *
 * ★ 版面：环在左、标签在右 ★
 *   早先把标签摆在环的两侧（x=4 和 x=136），
 *   而环的范围是 38~222 —— **标签压在环上面**，糊成一团。
 *   现在把环缩到左边一块地方，标签全部排到右边，
 *   两者各占各的，互不干扰。
 *
 * ★ 标签带占比 ★
 *   以前标签只有分类名，读者还要自己心算占比。
 *   现在直接标出「餐饮 42%」，不用另配一份图例。
 *
 * @param {Array} items [{name, amount, color}]
 * @param {object} opts { title, textColor, total }
 * @returns {string} SVG 源码
 */
export function buildAiDonutSvg(items, opts = {}) {
  const list = (items || []).filter((x) => Number(x.amount) > 0)
  if (list.length === 0) return ''

  const { title = '', textColor = '#666666', total } = opts
  const sum = total !== undefined && total !== null
    ? Number(total)
    : list.reduce((a, b) => a + Number(b.amount), 0)
  if (!sum) return ''

  // 整体版面
  const width = 300
  const rowH = 26
  const height = Math.max(160, list.length * rowH + 24)

  // 环：放在左边
  const cx = 82
  const cy = height / 2
  const r = Math.min(58, (height - 40) / 2)
  const strokeWidth = 24

  const parts = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}">`
  )

  let acc = -90 // 从 12 点开始
  const gapDeg = 1.5

  list.forEach((item, i) => {
    const pct = (Number(item.amount) / sum) * 100
    const sweep = (pct / 100) * 360
    if (sweep <= 0) return

    // 太小的一块（小于间隙）画出来只是一条线，留白更干净
    if (sweep <= gapDeg) return

    const start = acc + gapDeg / 2
    const end = acc + sweep - gapDeg / 2
    acc += sweep

    const r1 = r - strokeWidth / 2
    const r2 = r + strokeWidth / 2
    const a1 = (start * Math.PI) / 180
    const a2 = (end * Math.PI) / 180

    const x1 = cx + r1 * Math.cos(a1)
    const y1 = cy + r1 * Math.sin(a1)
    const x2 = cx + r2 * Math.cos(a1)
    const y2 = cy + r2 * Math.sin(a1)
    const x3 = cx + r2 * Math.cos(a2)
    const y3 = cy + r2 * Math.sin(a2)
    const x4 = cx + r1 * Math.cos(a2)
    const y4 = cy + r1 * Math.sin(a2)

    const large = sweep > 180 ? 1 : 0
    const color = item.color || AI_CHART_PALETTE[i % AI_CHART_PALETTE.length]

    parts.push(
      `<path d="M ${x1} ${y1} L ${x2} ${y2} A ${r2} ${r2} 0 ${large} 1 ${x3} ${y3} ` +
      `L ${x4} ${y4} A ${r1} ${r1} 0 ${large} 0 ${x1} ${y1} Z" fill="${color}"/>`
    )
  })

  // 环中心：合计金额
  parts.push(
    `<text x="${cx}" y="${cy - 6}" fill="${textColor}" font-size="11" ` +
    'text-anchor="middle" dominant-baseline="middle" ' +
    'font-family="-apple-system, \'PingFang SC\', sans-serif">合计</text>'
  )
  parts.push(
    `<text x="${cx}" y="${cy + 12}" fill="${textColor}" font-size="15" font-weight="600" ` +
    'text-anchor="middle" dominant-baseline="middle" ' +
    'font-family="-apple-system, \'PingFang SC\', sans-serif">' +
    `${escapeXml(formatShortMoney(sum))}</text>`
  )

  /*
   * ★ 标签：全部排在环的右边，各占一行 ★
   *   每行 = 色块 + 分类名 + 占比。
   *   名字来自用户输入（含分类名），所以要转义。
   */
  const labelX = 158
  const startY = height / 2 - (list.length * rowH) / 2 + rowH / 2

  list.forEach((item, i) => {
    const y = startY + i * rowH
    const color = item.color || AI_CHART_PALETTE[i % AI_CHART_PALETTE.length]
    const pct = ((Number(item.amount) / sum) * 100).toFixed(1).replace(/\.0$/, '')

    // 色块
    parts.push(
      `<rect x="${labelX}" y="${y - 4.5}" width="9" height="9" rx="2" fill="${color}"/>`
    )
    // 分类名
    parts.push(
      `<text x="${labelX + 15}" y="${y}" fill="${textColor}" font-size="12" ` +
      'dominant-baseline="middle" ' +
      'font-family="-apple-system, \'PingFang SC\', sans-serif">' +
      `${escapeXml(truncate(item.name, 8))}</text>`
    )
    // 占比（右边对齐）
    parts.push(
      `<text x="${width}" y="${y}" fill="${textColor}" font-size="12" ` +
      'text-anchor="end" dominant-baseline="middle" ' +
      'font-family="-apple-system, \'PingFang SC\', sans-serif">' +
      `${escapeXml(pct + '%')}</text>`
    )
  })

  parts.push('</svg>')
  return parts.join('')
}

/**
 * 条形图（分类对比）
 *
 * @param {Array} items [{name, amount, color}]
 * @param {object} opts { title, textColor, subTextColor, color }
 * @returns {string} SVG 源码
 */
export function buildAiBarSvg(items, opts = {}) {
  const list = (items || []).filter((x) => Number(x.amount) > 0)
  if (list.length === 0) return ''

  const {
    textColor = '#333333',
    subTextColor = '#999999',
    color = '#07C160'
  } = opts

  const width = 300
  const labelW = 84
  const valueW = 62
  const barMaxW = width - labelW - valueW - 12
  const height = list.length * BAR_ROW_HEIGHT + 6

  const max = Math.max(...list.map((x) => Number(x.amount)), 1)

  const parts = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}">`
  )

  list.forEach((item, i) => {
    const y = i * BAR_ROW_HEIGHT + 4
    const barH = 16
    const barY = y + (BAR_ROW_HEIGHT - barH) / 2 - 4
    const w = Math.max(2, (Number(item.amount) / max) * barMaxW)
    const c = item.color || color

    // 名称（左边，超长截断）
    parts.push(
      `<text x="0" y="${barY + barH / 2 + 1}" fill="${textColor}" font-size="11" ` +
      'dominant-baseline="middle" ' +
      'font-family="-apple-system, \'PingFang SC\', sans-serif">' +
      `${escapeXml(truncate(item.name, 6))}</text>`
    )

    // 条
    parts.push(
      `<rect x="${labelW}" y="${barY}" width="${barMaxW}" height="${barH}" rx="${barH / 2}" fill="#F2F3F5"/>`
    )
    parts.push(
      `<rect x="${labelW}" y="${barY}" width="${w}" height="${barH}" rx="${barH / 2}" fill="${c}"/>`
    )

    // 金额（右边）
    parts.push(
      `<text x="${width}" y="${barY + barH / 2 + 1}" fill="${subTextColor}" font-size="11" ` +
      'text-anchor="end" dominant-baseline="middle" ' +
      'font-family="-apple-system, \'PingFang SC\', sans-serif">' +
      `${escapeXml(formatShortMoney(item.amount))}</text>`
    )
  })

  parts.push('</svg>')
  return parts.join('')
}

/**
 * 折线图（每日趋势）
 *
 * @param {Array} items [{day, total}]（total 单位「元」）
 * @param {object} opts { title, color, textColor, gridColor }
 * @returns {string} SVG 源码
 */
export function buildAiTrendSvg(items, opts = {}) {
  const list = (items || []).filter((x) => x)
  if (list.length === 0) return ''

  const {
    color = '#07C160',
    textColor = '#999999',
    gridColor = '#EBEDF0'
  } = opts

  const width = 300
  const height = TREND_HEIGHT
  const padLeft = 6
  const padRight = 6
  const padTop = 10
  const padBottom = 16

  const values = list.map((x) => Number(x.total) || 0)
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const usableH = height - padTop - padBottom
  const usableW = width - padLeft - padRight

  const parts = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}">`
  )

  // 网格线（3 条）
  for (let i = 0; i <= 2; i++) {
    const y = padTop + (usableH / 2) * i
    parts.push(
      `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" ` +
      `stroke="${gridColor}" stroke-width="1" stroke-dasharray="3 3"/>`
    )
  }

  const n = list.length
  const coords = list.map((item, i) => {
    const v = Number(item.total) || 0
    const x = n === 1 ? padLeft : padLeft + (i / (n - 1)) * usableW
    const y = padTop + (1 - (v - min) / range) * usableH
    return { x, y, v, day: item.day }
  })

  // 面积
  if (coords.length > 1) {
    const area = `M ${coords[0].x} ${coords[0].y}` +
      coords.slice(1).map((c) => ` L ${c.x} ${c.y}`).join('') +
      ` L ${coords[coords.length - 1].x} ${height - padBottom}` +
      ` L ${coords[0].x} ${height - padBottom} Z`
    parts.push(`<path d="${area}" fill="${color}" fill-opacity="0.12"/>`)
  }

  // 折线
  if (coords.length > 1) {
    const line = `M ${coords[0].x} ${coords[0].y}` +
      coords.slice(1).map((c) => ` L ${c.x} ${c.y}`).join('')
    parts.push(
      `<path d="${line}" fill="none" stroke="${color}" stroke-width="2" ` +
      'stroke-linecap="round" stroke-linejoin="round"/>'
    )
  }

  // 首尾点
  if (coords.length) {
    const first = coords[0]
    const last = coords[coords.length - 1]
    parts.push(`<circle cx="${first.x}" cy="${first.y}" r="2.5" fill="${color}"/>`)
    parts.push(`<circle cx="${last.x}" cy="${last.y}" r="3.5" fill="${color}"/>`)

    // 首尾标签
    parts.push(
      `<text x="${first.x}" y="${height - 4}" fill="${textColor}" font-size="10" ` +
      'dominant-baseline="middle" font-family="-apple-system, sans-serif">' +
      `${escapeXml(first.day)}</text>`
    )
    parts.push(
      `<text x="${last.x}" y="${height - 4}" fill="${textColor}" font-size="10" ` +
      'text-anchor="end" dominant-baseline="middle" font-family="-apple-system, sans-serif">' +
      `${escapeXml(last.day)}</text>`
    )
  }

  parts.push('</svg>')
  return parts.join('')
}

/**
 * 按类型选一个画法，产出 data URI。
 *
 * @param {string} type donut | bar | trend
 * @param {Array} items 数据
 * @param {object} opts 透传给具体画法
 * @returns {string} data URI（画不出来时返回空串）
 */
export function buildAiChartUri(type, items, opts = {}) {
  let svg = ''
  if (type === 'donut') svg = buildAiDonutSvg(items, opts)
  else if (type === 'bar') svg = buildAiBarSvg(items, opts)
  else if (type === 'trend') svg = buildAiTrendSvg(items, opts)
  if (!svg) return ''
  return svgToDataUri(svg)
}

/** 截断文本 */
export function truncate(s, max) {
  const str = String(s || '')
  return str.length > max ? str.slice(0, max) + '…' : str
}

/**
 * 金额缩写：1234 → 1234，12345 → 1.2万
 */
export function formatShortMoney(v) {
  const n = Number(v) || 0
  if (Math.abs(n) >= 10000) {
    const w = n / 10000
    return (Math.round(w * 10) / 10) + '万'
  }
  if (Number.isInteger(n)) return String(n)
  return String(Math.round(n * 100) / 100)
}
