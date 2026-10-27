/**
 * 折线图的几何计算 —— 纯函数，组件与测试共用
 *
 * 单独放一个文件是为了能直接跑单测：
 * .vue 里的 setup 不好在 Node 里直接跑。
 */

/**
 * 纵轴范围
 *
 * ★ 必须包含 0 ★
 *   数据全为正时，下界取 0 —— 否则曲线贴着底边，
 *   看起来像「资产一直没变」，看不出波动。
 *   全为负时，上界取 0。
 *
 * @param {Array<number>} values
 * @returns {{min:number, max:number}}
 */
export function calcBounds(values = []) {
  if (values.length === 0) return { min: 0, max: 0 }

  let min = Math.min(...values)
  let max = Math.max(...values)
  if (min > 0) min = 0
  if (max < 0) max = 0
  if (min === max) {
    // 全是同一个值，给点余量避免除以 0
    max = min + 1
  }
  return { min, max }
}

/**
 * 每个数据点的坐标
 *
 * @param {Array<{day:string,total:number}>} points
 * @param {object} opts { width, height, padTop, padBottom }
 * @returns {Array<{x:number,y:number,value:number,day:string,index:number}>}
 */
export function calcCoords(points = [], opts = {}) {
  const width = opts.width || 300
  const height = opts.height || 100
  const padTop = opts.padTop === undefined ? 8 : opts.padTop
  const padBottom = opts.padBottom === undefined ? 6 : opts.padBottom

  if (!points || points.length === 0) return []

  const values = points.map((p) => Number(p.total) || 0)
  const { min, max } = calcBounds(values)
  const range = max - min || 1
  const usableH = height - padTop - padBottom
  const n = points.length

  return points.map((p, i) => {
    const v = Number(p.total) || 0
    const x = n === 1 ? 0 : (i / (n - 1)) * width
    const y = padTop + (1 - (v - min) / range) * usableH
    return { x, y, value: v, day: p.day, index: i }
  })
}

/**
 * 0 值基线的 y 坐标（数据跨越 0 时才有，否则 null）
 */
export function calcZeroY(bounds, opts = {}) {
  const height = opts.height || 100
  const padTop = opts.padTop === undefined ? 8 : opts.padTop
  const padBottom = opts.padBottom === undefined ? 6 : opts.padBottom

  const { min, max } = bounds
  if (min >= 0 || max <= 0) return null

  const range = max - min || 1
  const usableH = height - padTop - padBottom
  return padTop + (1 - (0 - min) / range) * usableH
}

/**
 * 平滑曲线路径（Catmull-Rom 转三次贝塞尔）
 *
 * 对相邻点 P1、P2，控制点取：
 *   C1 = P1 + (P2 - P0) / 6
 *   C2 = P2 - (P3 - P1) / 6
 * 端点处用相邻点兜底，保证曲线不甩出去。
 *
 * @param {Array<{x:number,y:number}>} coords
 * @returns {string} SVG path 的 d 属性
 */
export function calcLinePath(coords = []) {
  if (!coords || coords.length < 2) return ''
  if (coords.length === 2) {
    return `M ${coords[0].x} ${coords[0].y} L ${coords[1].x} ${coords[1].y}`
  }

  let d = `M ${coords[0].x} ${coords[0].y}`

  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i - 1] || coords[i]
    const p1 = coords[i]
    const p2 = coords[i + 1]
    const p3 = coords[i + 2] || coords[i + 1]

    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6

    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`
  }
  return d
}

/**
 * 填充区域路径 = 折线路径 + 向下闭合到底部
 */
export function calcAreaPath(coords = [], linePath = '', baseY = 100) {
  if (!coords || coords.length < 2) return ''
  const last = coords[coords.length - 1]
  const first = coords[0]
  return `${linePath} L ${last.x} ${baseY} L ${first.x} ${baseY} Z`
}

/**
 * 数据点标记：最后一个点画大一点、实心高亮
 *
 * @param {Array} coords
 * @param {string} color 主题色
 * @param {string} bgColor 背景色（空心点的填充）
 */
export function calcMarkers(coords = [], color = '#07C160', bgColor = 'var(--app-card)') {
  const last = coords.length - 1
  return coords.map((p, i) => ({
    x: p.x,
    y: p.y,
    r: i === last ? 3.2 : 2,
    fill: i === last ? color : bgColor
  }))
}

/** YYYY-MM-DD -> M/D */
export function formatChartDay(day) {
  if (!day) return ''
  const parts = String(day).split('-')
  if (parts.length < 3) return day
  return `${Number(parts[1])}/${Number(parts[2])}`
}
