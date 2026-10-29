import { svgToDataUri } from './chart.js'

/**
 * 环形图（donut）SVG 构建工具。
 *
 * ★ 为什么不用 conic-gradient ★
 *   CSS conic-gradient 只能画纯色分段，无法在上面标注文字。
 *   需求是「环形图用引导线直接显示每个部分的名称和占比」，
 *   所以改用 SVG：每个扇区一条引导线，末端写「名称 占比%」。
 *
 * ★ 为什么是纯函数 ★
 *   与 utils/chart.js 的折线图工具同构：几何计算放这里，页面只负责渲染。
 *   这样能被 scripts/*.mjs 直接单测，不用起 App。
 *
 * ★ 布局约定 ★
 *   viewBox 是 300×180，圆心在 (150, 90)。
 *   环外半径 62、环内半径 44（环宽 18）。
 *   引导线从扇区外缘（r=64）引到 r=76，末端文字从 r=80 开始。
 *   上下左右都要留出文字空间，所以 viewBox 比环大一圈。
 */

/** 环的几何（viewBox 单位） */
export const DONUT_GEOM = {
  cx: 150,
  cy: 90,
  rOuter: 62,
  rInner: 44,
  leadFrom: 64,
  leadTo: 76,
  labelR: 82,
  labelGap: 4
}

/**
 * 把一个角度（度，0=顶部，顺时针）转成 viewBox 坐标的单位向量方向。
 * SVG 的 y 轴向下，所以：
 *   x = cx + r * sin(deg)
 *   y = cy - r * cos(deg)
 * 这样 0° 在顶部、90° 在右侧、180° 在底部、270° 在左侧。
 */
function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180
  return {
    x: cx + r * Math.sin(rad),
    y: cy - r * Math.cos(rad)
  }
}

/**
 * 环形扇区的 SVG path（两个同心圆弧 + 两端连线）。
 * 从 startDeg 到 endDeg（顺时针）。
 */
function donutSectorPath(g, startDeg, endDeg) {
  const { cx, cy, rOuter, rInner } = g
  const s1 = polar(cx, cy, rOuter, startDeg)
  const e1 = polar(cx, cy, rOuter, endDeg)
  const s2 = polar(cx, cy, rInner, endDeg)
  const e2 = polar(cx, cy, rInner, startDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0

  return [
    `M ${s1.x} ${s1.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${e1.x} ${e1.y}`,
    `L ${s2.x} ${s2.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${e2.x} ${e2.y}`,
    'Z'
  ].join(' ')
}

/**
 * 计算每个扇区的标注位置与文字对齐。
 *
 * 文字放在引导线末端，水平排布，不做旋转（可读性最好）。
 * 根据所在半侧决定 text-anchor：
 *   - 右半（0~180°）：文字在引导线右侧，text-anchor=start
 *   - 左半（180~360°）：文字在引导线左侧，text-anchor=end
 *   - 顶部/底部附近（cos 接近 0）：文字仍水平放，
 *     但为了不和相邻标签打架，稍微往圆外推一点。
 *
 * @param {number} midDeg 扇区中点角（0~360）
 * @returns {{x:number,y:number,anchor:'start'|'end'|'middle'}}
 */
function labelPos(g, midDeg) {
  const { cx, cy, labelR } = g
  // 文字锚点位置：引导线末端再往外一点
  const p = polar(cx, cy, labelR, midDeg)
  const cos = Math.cos((midDeg * Math.PI) / 180)
  const sin = Math.sin((midDeg * Math.PI) / 180)

  let anchor = 'middle'
  // 用 x 轴分量判断左右半侧（90° 正右、270° 正左）
  if (sin > 0.25) anchor = 'start'
  else if (sin < -0.25) anchor = 'end'

  return { x: p.x, y: p.y, anchor }
}

/**
 * 把环形图数据构建成 SVG 字符串。
 *
 * @param {Array<{name:string,amount:number,color:string}>} items
 *   按占比从大到小排好。amount 是金额（分），用于算占比。
 * @param {object} opts
 *   total   总金额（分），用于算百分比；缺省用 items 之和
 *   topN    最多标注前几个扇区（其余不画标注，只画环段）
 *   textColor  文字颜色
 *   leadColor  引导线颜色
 *   gapDeg  扇区之间的间隙（度），默认 1.2，让相邻块边界清晰
 *   showLead 是否画引导线+文字（默认 true）
 * @returns {string} SVG 字符串（不含 data: 前缀）
 */
export function buildDonutSvg(items = [], opts = {}) {
  const {
    total: rawTotal,
    topN = 8,
    textColor = '#666666',
    leadColor = '#B8BEC7',
    gapDeg = 1.2,
    showLead = true
  } = opts
  const g = DONUT_GEOM

  const list = (items || []).filter((x) => Number(x.amount) > 0)
  if (list.length === 0) return ''

  /*
   * ★ total 的两种语义 ★
   *   total === 0  → 调用方明确说「没有金额」，返回空（无数据）
   *   total == null → 调用方没传，用 items 之和兜底
   */
  let total
  if (rawTotal !== undefined && rawTotal !== null) {
    total = Number(rawTotal)
    if (total <= 0) return ''
  } else {
    total = list.reduce((acc, x) => acc + Number(x.amount), 0)
    if (!total) return ''
  }

  const parts = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 180" width="300" height="180">`
  )

  // 累计角度（从顶部顺时针）
  let accDeg = 0
  const sectors = []

  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    const pct = (Number(item.amount) / total) * 100
    const sweep = (pct / 100) * 360

    const start = accDeg + gapDeg / 2
    const end = accDeg + sweep - gapDeg / 2
    const mid = (start + end) / 2
    accDeg += sweep

    sectors.push({
      color: item.color,
      pct: Math.round(pct * 10) / 10,
      name: item.name,
      start,
      end,
      mid,
      // 极小扇区（小于间隙）无法画出，跳过不画，避免负 sweep 产生怪异 path
      valid: end - start > 0.01,
      // 只有前 topN 个且角度够大的才标注
      label: showLead && i < topN && sweep > 2
    })
  }

  // 画环段
  for (const s of sectors) {
    if (!s.valid) continue
    parts.push(
      `<path d="${donutSectorPath(g, Math.max(s.start, 0), Math.min(s.end, 360))}" fill="${s.color}"/>`
    )
  }

  // 画引导线 + 文字
  if (showLead) {
    for (const s of sectors) {
      if (!s.label) continue
      const from = polar(g.cx, g.cy, g.leadFrom, s.mid)
      const to = polar(g.cx, g.cy, g.leadTo, s.mid)
      const lp = labelPos(g, s.mid)

      // 引导线：从环外缘到文字前
      parts.push(
        `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" ` +
        `stroke="${leadColor}" stroke-width="1" stroke-linecap="round"/>`
      )
      // 文字：名称 + 占比
      const label = `${s.name} ${s.pct}%`
      const anchor = lp.anchor
      const dx = anchor === 'start' ? g.labelGap : anchor === 'end' ? -g.labelGap : 0
      parts.push(
        `<text x="${lp.x + dx}" y="${lp.y}" fill="${textColor}" ` +
        `font-size="10" font-family="-apple-system, 'PingFang SC', sans-serif" ` +
        `text-anchor="${anchor}" dominant-baseline="middle">${label}</text>`
      )
    }
  }

  parts.push('</svg>')
  return parts.join('')
}

/**
 * 便捷封装：直接生成 data URI（供 <image :src> 用）。
 */
export function donutToDataUri(items, opts) {
  const svg = buildDonutSvg(items, opts)
  if (!svg) return ''
  return svgToDataUri(svg)
}
