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
  /** 引导线起点半径（紧贴环外缘） */
  leadFrom: 64,
  /** 计算标签理想 y 时用的半径 */
  labelR: 82
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
 * 标签排布参数。
 *
 * ★ 为什么是「左右两列」★
 *   之前按扇区角度把文字散落在圆周边（start/end/middle 三种锚点混用），
 *   标签跟着角度浮动、起点参差，看着像一圈蛛网 —— 这就是「丑」的根源。
 *
 *   改成两列：右半侧的标签统一从 colRightX 左对齐，
 *   左半侧的标签统一到 colLeftX 右对齐，
 *   竖向按等距排布。视觉上是一左一右两条整齐的列表，最耐看。
 */
export const DONUT_LABEL = {
  /** 右列文字的起始 x（text-anchor=start） */
  colRightX: 226,
  /** 左列文字的结束 x（text-anchor=end） */
  colLeftX: 74,
  /** 相邻标签的最小竖向间距（viewBox 单位） */
  minGap: 16,
  /** 标签字号 */
  fontSize: 10,
  /** 占比低于这个值就不标注（用户要求：低于 1% 不显示） */
  minPct: 1,
  /** 名称最多保留几个字，超出用省略号 */
  maxNameLen: 5,
  /** 标签可用的竖向范围（留出上下边距，别贴 viewBox 边） */
  minY: 12,
  maxY: 168,
  /** 引导线端点与文字之间留的空隙 */
  gap: 4,
  /**
   * 折线拐点的半径。
   * 引导线分两段：环边缘 → 沿半径走到这个半径（拐点）→ 折向标签所在行。
   */
  bendR: 72
}

/** 名称超长时截断并补省略号 */
function clipName(name) {
  const s = String(name || '')
  if (s.length <= DONUT_LABEL.maxNameLen) return s
  return `${s.slice(0, DONUT_LABEL.maxNameLen - 1)}…`
}

/**
 * 计算一列标签的竖向位置。
 *
 * 标签贴着各自扇区的径向位置（idealY），只有在挨得太近时才向下微调，
 * 保证相邻间距 >= minGap。
 *
 * ★ 为什么不做「等距重排」★
 *   等距会把标签挪到与扇区无关的行，折线引导线就必然彼此交叉 ——
 *   试过等距版本，几何检测出来 3 对交叉，比原来更乱。
 *   贴着径向位置+微调，标签上下顺序与扇区在圆周上的顺序一致，
 *   折线不交叉，这才是「整齐」的真正来源。
 *   代价是列内间距不绝对均匀，但不会重叠，也不会打结。
 *
 * @param {Array<{idealY:number}>} items 该列的标签
 * @returns {number[]} 与 items 同序的 y 值
 */
function stackColumn(items) {
  const L = DONUT_LABEL
  const n = items.length
  if (n === 0) return []

  // 记录原始下标，按理想 y 排序（保持扇区顺序，不会乱序）
  const order = items.map((_, i) => i).sort((a, b) => items[a].idealY - items[b].idealY)
  const ys = new Array(n)

  // 依次向下推挤，保证间距
  let prev = null
  for (const i of order) {
    let y = items[i].idealY
    if (prev !== null && y - prev < L.minGap) y = prev + L.minGap
    ys[i] = y
    prev = y
  }

  // 整体夹回可用范围（平移不改变间距，不会重新引入重叠）
  let top = Math.min(...ys)
  let bottom = Math.max(...ys)
  if (top < L.minY) {
    const d = L.minY - top
    for (let i = 0; i < n; i++) ys[i] += d
    bottom += d
  }
  if (bottom > L.maxY) {
    const d = bottom - L.maxY
    for (let i = 0; i < n; i++) ys[i] -= d
  }

  return ys
}

/**
 * 把要标注的扇区排成左右两列，返回每条折线引导线与文字的位置。
 *
 * ★ 引导线为什么是折线 ★
 *   一条直线斜着从环边缘连到标签，标签一多就会互相交叉（像一团乱麻）。
 *   改成折线：先沿半径向外走到拐点（bendR），再从拐点折向标签那一行。
 *   因为同一列的标签 y 是单调递增的、拐点的极角顺序也一致，
 *   两条折线就不会交叉 —— 视觉上是一排干净的「弯钩」。
 *
 * @param {Array<{name:string,pct:number,mid:number}>} sectors 需要标注的扇区
 * @param {object} g 环形几何
 * @returns {Array<{p1:{x,y},p2:{x,y},p3:{x,y},text:string,x:number,y:number,anchor:'start'|'end'}>}
 */
function layoutLabels(sectors, g) {
  const L = DONUT_LABEL
  const right = []
  const left = []

  for (const s of sectors) {
    const rad = (s.mid * Math.PI) / 180
    // sin >= 0 归右列，否则左列（顶部/底部扇区也归到就近的一侧）
    const side = Math.sin(rad) >= 0 ? 'right' : 'left'
    const idealY = polar(g.cx, g.cy, g.labelR, s.mid).y
    const entry = {
      sector: s,
      idealY,
      p1: polar(g.cx, g.cy, g.leadFrom, s.mid),
      p2: polar(g.cx, g.cy, L.bendR, s.mid),
      toX: side === 'right' ? L.colRightX - L.gap : L.colLeftX + L.gap
    }
    ;(side === 'right' ? right : left).push(entry)
  }

  const out = []

  for (const [items, anchor, textX] of [
    [right, 'start', L.colRightX],
    [left, 'end', L.colLeftX]
  ]) {
    const ys = stackColumn(items)
    items.forEach((it, i) => {
      const y = ys[i]
      out.push({
        p1: it.p1,
        p2: it.p2,
        // 拐点 → 标签行：水平折过去（x 落在列位内侧）
        p3: { x: it.toX, y },
        text: `${clipName(it.sector.name)} ${it.sector.pct}%`,
        x: textX,
        y,
        anchor
      })
    })
  }

  return out
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
      // 前 topN 个、且占比 >= 1% 才标注（低于 1% 的块太小，标了只会挤）
      label: showLead && i < topN && pct >= DONUT_LABEL.minPct
    })
  }

  // 画环段
  for (const s of sectors) {
    if (!s.valid) continue
    parts.push(
      `<path d="${donutSectorPath(g, Math.max(s.start, 0), Math.min(s.end, 360))}" fill="${s.color}"/>`
    )
  }

  // 画引导线 + 文字（左右两列对齐，引导线是折线）
  if (showLead) {
    const labels = layoutLabels(sectors.filter((s) => s.label), g)
    const fontSize = DONUT_LABEL.fontSize

    for (const l of labels) {
      // 折线：环边缘 →（沿半径）→ 拐点 →（水平）→ 标签行
      const pts = `${l.p1.x},${l.p1.y} ${l.p2.x},${l.p2.y} ${l.p3.x},${l.p3.y}`
      parts.push(
        `<polyline points="${pts}" fill="none" ` +
        `stroke="${leadColor}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`
      )
      parts.push(
        `<text x="${l.x}" y="${l.y}" fill="${textColor}" ` +
        `font-size="${fontSize}" font-family="-apple-system, 'PingFang SC', sans-serif" ` +
        `text-anchor="${l.anchor}" dominant-baseline="middle">${l.text}</text>`
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
