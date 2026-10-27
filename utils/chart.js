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
 * 折线路径（直线，不用贝塞尔曲线）
 *
 * ★ 为什么改成直线 ★
 *   用户要求「不要圆滑的折线图了，就直线折线图就行」。
 *   直线的好处是每个数据点的位置一眼能对上，
 *   不会因为平滑插值而「看起来」在两个点之间多出了波动。
 *
 * @param {Array<{x:number,y:number}>} coords
 * @returns {string} SVG path 的 d 属性
 */
export function calcLinePath(coords = []) {
  if (!coords || coords.length < 2) return ''
  let d = `M ${coords[0].x} ${coords[0].y}`
  for (let i = 1; i < coords.length; i++) {
    d += ` L ${coords[i].x} ${coords[i].y}`
  }
  return d
}

/**
 * 平滑曲线路径（Catmull-Rom 转三次贝塞尔）
 *
 * 保留着不用：之前版本用过，用户反馈要直线。
 * 要是以后想切回平滑曲线，直接换 calcLinePath 的实现即可。
 *
 * @param {Array<{x:number,y:number}>} coords
 * @returns {string} SVG path 的 d 属性
 */
export function calcSmoothPath(coords = []) {
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
 * 根据触摸位置找到最近的数据点
 *
 * 用户要求：「点要做到不显示出来，但是手触碰上去会显示日期和金额」。
 * 所以数据点默认隐藏，触摸时才在最近的那个点显示气泡。
 *
 * @param {number} touchX 触摸点的 x 坐标（与 coords 同一坐标系）
 * @param {Array<{x:number}>} coords
 * @returns {number} 命中的点下标；没有命中返回 -1
 */
export function findNearestIndex(touchX, coords = []) {
  if (!coords || coords.length === 0) return -1
  if (coords.length === 1) return 0

  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < coords.length; i++) {
    const dist = Math.abs(coords[i].x - touchX)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
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

/**
 * 生成 SVG 源码（整张图，包括折线、填充、数据点）
 *
 * ★ 为什么是「一整张 SVG」而不是多个元素 ★
 *   uni-app 的 template 里不解析 <svg> 标签 ——
 *   它会被当成文本节点忽略，编译期不报错，运行时就是空白。
 *   （uni-app 不做 HTML 解析，只认 view / text / image 等内置组件。）
 *
 *   所以只能把 SVG 拼成字符串，再用 <image> 以
 *   data:image/svg+xml;base64 的形式加载。
 *   App 端（Vue3）跑在 WebView 上，WebView 支持 SVG。
 *
 * @param {object} opts
 * @param {Array} opts.coords 坐标
 * @param {string} opts.linePath 折线路径
 * @param {string} opts.areaPath 填充路径
 * @param {Array} opts.markers 数据点
 * @param {number} opts.activeIndex 当前触摸命中的点下标（-1 表示不显示任何点）
 * @param {string} opts.color 主题色
 * @param {number} opts.zeroY 0 基线的 y（null 表示不画）
 * @param {number} opts.width viewBox 宽
 * @param {number} opts.height viewBox 高
 * @param {string} opts.bgColor 背景色（数据点的空心填充）
 * @param {boolean} opts.onlyActive 只画命中的点和辅助线，不画折线和填充
 *   （叠在底图上用，避免每次触摸都重画整张图导致闪烁）
 * @returns {string} SVG 源码
 */
export function buildSvgSource(opts = {}) {
  const {
    coords = [], linePath = '', areaPath = '', markers = [],
    color = '#07C160', zeroY = null,
    width = 300, height = 100, bgColor = '#FFFFFF',
    activeIndex = -1, onlyActive = false
  } = opts

  if (!linePath) return ''

  const parts = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
  )

  // 渐变填充
  if (areaPath) {
    parts.push(
      '<defs>' +
      '<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      `<stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>` +
      `<stop offset="100%" stop-color="${color}" stop-opacity="0"/>` +
      '</linearGradient></defs>'
    )
    parts.push(`<path d="${areaPath}" fill="url(#g)"/>`)
  }

  // 0 值基线
  if (zeroY !== null && zeroY !== undefined) {
    parts.push(
      `<line x1="0" y1="${zeroY}" x2="${width}" y2="${zeroY}" ` +
      'stroke="#EBEDF0" stroke-width="1" stroke-dasharray="3 3"/>'
    )
  }

  // 折线（onlyActive 时不画，叠在底图上）
  if (!onlyActive) {
    parts.push(
      `<path d="${linePath}" fill="none" stroke="${color}" ` +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    )
  }

  // 数据点：默认不显示，只画当前触摸命中的那个
  if (activeIndex >= 0 && markers[activeIndex]) {
    const m = markers[activeIndex]
    parts.push(
      `<circle cx="${m.x}" cy="${m.y}" r="${m.r}" ` +
      `fill="${color}" stroke="${color}" stroke-width="1.5"/>`
    )
    // 命中点画一条竖线，方便对齐看
    parts.push(
      `<line x1="${m.x}" y1="${m.y}" x2="${m.x}" y2="${height}" ` +
      `stroke="${color}" stroke-width="1" stroke-opacity="0.35"/>`
    )
  }

  parts.push('</svg>')
  return parts.join('')
}

/**
 * SVG 源码 -> data URI（给 <image> 的 src 用）
 *
 * 用 encodeURIComponent 而不是 base64：
 *   - base64 需要 btoa，中文/特殊字符要额外处理，容易出错
 *   - URI 编码更简单，而且 <image> 同样认这个形式
 *   - 注意：# 必须编码，否则会被当成 URL fragment
 */
export function svgToDataUri(svg) {
  if (!svg) return ''
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
