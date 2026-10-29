/**
 * 线性描边图标 —— 24x24 viewBox、stroke-width 1.8、圆角端点、无填充
 *
 * ★ 为什么不用 emoji ★
 *   emoji 是彩色位图，字体不同系统长得完全不一样，
 *   而且没法跟随主题色（「我的」页菜单图标要跟主色一致）。
 *   线性描边图标跟 tabBar 的 PNG 图标是同一套视觉语言，整齐得多。
 *
 * ★ 为什么用 <image> 加载而不是直接写 <svg> 标签 ★
 *   uni-app 的 template 不做 HTML 解析，只认 view / text / image 等内置组件。
 *   直接写 <svg>...</svg> 会被当成文本节点忽略 ——
 *   编译期不报错，运行时就是一片空白。
 *   （项目里踩过这个坑，scripts/check-layout.mjs 专门有一条规则拦它。）
 *
 *   所以这里的做法是：把 SVG 拼成字符串，
 *   用 <image> 以 data:image/svg+xml;charset=utf-8 加载。
 *   App 端跑在系统 WebView 上，WebView 支持 SVG。
 *
 * ★ 关于 currentColor ★
 *   SVG 被当作「独立的图片文档」加载时，currentColor 不会继承外层元素的
 *   color（它只会在文档内部解析），所以 data URI 里必须换成真实颜色值。
 *   lineIconDataUri() 会把 currentColor 兜底成中性灰。
 *
 * ★ 图标内部只用 <path> ★
 *   圆、椭圆也都写成 path（用 arc 指令），
 *   这样一整套图标结构统一，描边风格也统一。
 */

/**
 * 圆 -> path
 *
 * 用两段 arc 拼一个整圆，比 <circle> 更好控制，
 * 也让 ICON_PATHS 里只出现 path 这一种元素。
 *
 * @param {number} cx 圆心 x
 * @param {number} cy 圆心 y
 * @param {number} r 半径
 * @returns {string} path 的 d 属性
 */
function circlePath(cx, cy, r) {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0z`
}

/**
 * 椭圆 -> path（rx / ry 分别给半径）
 *
 * @param {number} cx 圆心 x
 * @param {number} cy 圆心 y
 * @param {number} rx 横向半径
 * @param {number} ry 纵向半径
 * @returns {string} path 的 d 属性
 */
function ellipsePath(cx, cy, rx, ry) {
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0z`
}

/**
 * 图标库 —— key -> path 的 d 属性数组
 *
 * 全部是描边图形（fill="none"），颜色由外层 svg 的 stroke 决定。
 */
const ICON_PATHS = {
  /* ---------------- 「我的」页菜单用 ---------------- */

  /** 分类管理：文件夹 */
  category: [
    'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'
  ],

  /** 标签管理：标签牌 */
  tag: [
    'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z',
    circlePath(7, 7, 1.3)
  ],

  /** 预算管理：靶心 */
  budget: [
    circlePath(12, 12, 9),
    circlePath(12, 12, 5),
    circlePath(12, 12, 1.6)
  ],

  /** 主题外观：调色板 */
  theme: [
    'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c.93 0 1.66-.75 1.66-1.67 0-.44-.18-.84-.44-1.15-.29-.29-.44-.65-.44-1.15 0-.89.72-1.61 1.61-1.61h2.09C19.4 16.42 21.8 13.9 21.8 10.8 21.8 5.9 17.52 2 12 2z',
    circlePath(7.5, 12.5, 1.1),
    circlePath(9.5, 7.5, 1.1),
    circlePath(14.5, 7, 1.1),
    circlePath(17.5, 11, 1.1)
  ],

  /** AI 智能配置：星光 */
  ai: [
    'M12 2.6l2.1 6.3 6.3 2.1-6.3 2.1-2.1 6.3-2.1-6.3L3.6 11l6.3-2.1z',
    'M18.4 15.2l.85 2.2 2.2.85-2.2.85-.85 2.2-.85-2.2-2.2-.85 2.2-.85z'
  ],

  /** 数据与备份：数据库 */
  data: [
    ellipsePath(12, 5, 9, 3),
    'M21 12c0 1.66-4 3-9 3s-9-1.34-9-3',
    'M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5'
  ],

  /** 备份：云上传 */
  backup: [
    'M6.8 19a4.4 4.4 0 0 1-.4-8.78 5.9 5.9 0 0 1 11.5-1.18A4.4 4.4 0 0 1 17.4 19z',
    'M12 16.5v-5.6',
    'M9.6 13.4L12 11l2.4 2.4'
  ],

  /** 关于：信息 */
  about: [
    circlePath(12, 12, 9),
    'M12 16.6v-4.8',
    circlePath(12, 8.2, 1)
  ],

  /** 周期：循环箭头 */
  cycle: [
    'M19.8 8.2a8 8 0 0 0-13.9-2.4L3.2 8.4',
    'M3.2 4.2v4.2h4.2',
    'M4.2 15.8a8 8 0 0 0 13.9 2.4l2.7-2.6',
    'M20.8 19.8v-4.2h-4.2'
  ],

  /** 账户：钱包 */
  account: [
    'M19 7.6V6.5A2.5 2.5 0 0 0 16.5 4H5.5A2.5 2.5 0 0 0 3 6.5v11A2.5 2.5 0 0 0 5.5 20h13a2 2 0 0 0 2-2v-1.6',
    'M3 9h15.6A1.4 1.4 0 0 1 20 10.4v3.2A1.4 1.4 0 0 1 18.6 15H3',
    circlePath(16.4, 12, 1)
  ],

  /* ---------------- tabBar / 通用 ---------------- */

  /** 首页：房子 */
  home: [
    'M3 9.6L12 3l9 6.6V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
    'M9.5 21v-6.2h5V21'
  ],

  /** 统计：柱状图 */
  stats: [
    'M4 3v17.5h16.5',
    'M8 20.5v-5',
    'M12.5 20.5V6',
    'M17 20.5v-8.5'
  ],

  /** 我的：用户 */
  mine: [
    'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2',
    circlePath(12, 7, 4)
  ],

  /* ---------------- 操作类 ---------------- */

  /** 加号 */
  plus: [
    'M12 5v14',
    'M5 12h14'
  ],

  /** 编辑：铅笔 */
  edit: [
    'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z'
  ],

  /** 删除：垃圾桶 */
  trash: [
    'M3 6h18',
    'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    'M10 11v6',
    'M14 11v6'
  ],

  /** 勾 */
  check: [
    'M20 6.5L9.5 17 4 11.5'
  ],

  /** 叉 */
  close: [
    'M18 6L6 18',
    'M6 6l12 12'
  ],

  /* ---------------- 深浅模式（主题外观页） ---------------- */

  /**
   * 跟随系统：半亮半暗的圆
   *
   * ★ 怎么画「一半亮一半暗」★
   *   整个图标库是「纯描边、无填充」的风格，
   *   所以这里不用「填一半颜色」的做法，而是：
   *     - 整圆由两段半圆弧拼成（左半 + 右半）
   *     - 中间一条竖直分隔线把圆劈成两半
   *   这是「跟随系统 / 昼夜」最通用的表达方式。
   */
  auto: [
    // 左半圆
    'M12 3a9 9 0 0 0 0 18',
    // 右半圆
    'M12 3a9 9 0 0 1 0 18',
    // 左右分界线
    'M12 3v18'
  ],

  /**
   * 浅色：太阳
   *
   * 圆心 r=4，外围 8 根光芒（上下左右 + 四个斜角）。
   * 光芒从 r=6.5 到 r=9，与圆心留出 2.5 的间隙，
   * 这样既有「发光」的感觉，又不会挤成一团。
   */
  sun: [
    circlePath(12, 12, 4),
    'M12 3v2.5',
    'M12 18.5v2.5',
    'M3 12h2.5',
    'M18.5 12h2.5',
    'M5.6 5.6l1.8 1.8',
    'M18.4 5.6l-1.8 1.8',
    'M18.4 18.4l-1.8-1.8',
    'M5.6 18.4l1.8-1.8'
  ],

  /**
   * 深色：月亮
   *
   * 月牙用一段外弧 + 一段内弧拼出来（经典的新月画法）。
   * 右上角空出来的位置点两颗小星（用极短的对角线段表示点）。
   */
  moon: [
    // 月牙
    'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
    // 两颗小星
    'M17.4 4.6l.45 1.15',
    'M19.75 6.95l-1.15.45'
  ],

  /** 其它 / 更多：三个点 */
  more: [
    circlePath(5, 12, 1.3),
    circlePath(12, 12, 1.3),
    circlePath(19, 12, 1.3)
  ]
}

/** 未知 key 时的兜底图标：通用圆点 */
const FALLBACK_PATHS = [circlePath(12, 12, 4)]

/** 所有可用的图标 key */
export const LINE_ICON_KEYS = Object.keys(ICON_PATHS)

/** 兜底图标的 key（不在 LINE_ICON_KEYS 里，是内部用的） */
const FALLBACK_KEY = '__fallback__'

/** currentColor 在 data URI 里不生效时的兜底颜色 */
const CURRENT_COLOR_FALLBACK = '#333333'

/**
 * 取某个 key 的 path 列表，未知 key 走兜底。
 *
 * @param {string} key 图标 key
 * @returns {string[]} path 的 d 属性数组
 */
export function lineIconPaths(key) {
  return ICON_PATHS[key] || FALLBACK_PATHS
}

/**
 * 判断某个 key 是不是走了兜底。
 *
 * 用来排查「图标怎么不显示」——
 * key 拼错时不会报错，只会画出一个通用圆点。
 *
 * @param {string} key 图标 key
 * @returns {boolean} true 表示这个 key 不存在、用了兜底
 */
export function isFallbackIcon(key) {
  return !ICON_PATHS[key]
}

/**
 * 生成 SVG 源码。
 *
 * @param {string} key 图标 key（未知 key 自动兜底成通用圆点）
 * @param {object} opts 选项
 * @param {number} opts.size 图形边长（SVG 的 width/height 属性，单位 px）
 * @param {string} opts.color 描边颜色
 * @param {number} opts.strokeWidth 描边宽度
 * @returns {string} SVG 源码
 */
export function lineIconSvg(key, opts = {}) {
  const size = Number(opts.size) > 0 ? Number(opts.size) : 24
  const color = opts.color || 'currentColor'
  const strokeWidth = Number(opts.strokeWidth) > 0 ? Number(opts.strokeWidth) : 1.8

  const paths = lineIconPaths(key)
  const body = paths.map((d) => `<path d="${d}"/>`).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ` +
    `width="${size}" height="${size}" fill="none" stroke="${color}" ` +
    `stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">` +
    body +
    `</svg>`
  )
}

/**
 * 生成 data URI（给 <image> 的 src 用）。
 *
 * 用 encodeURIComponent 而不是 base64：
 *   - base64 需要 btoa，中文和特殊字符要额外处理，容易出错
 *   - URI 编码更简单，<image> 同样认这个形式
 *   - '#' 必须编码，否则会被当成 URL 的 fragment
 *
 * ★ 为什么必须把颜色「解析成真实色值」★
 *   SVG 被当作**独立图片文档**加载（data: URI）时，
 *   它不在宿主页面的 CSS 上下文里 ——
 *     写 currentColor  -> 拿不到外层 color，只得到一个说不清的颜色
 *     写 var(--app-x)  -> **CSS 变量根本不存在，等同于无效值**
 *                          stroke 变成 transparent，图标完全看不见
 *
 *   这是实际踩到的 bug：账户图标选择器里传了
 *   `'var(--app-text-2)'`，结果 12 个图标全是空白，
 *   用户看不到样式、只有点中之后（换成真实主题色）才显示出来。
 *
 *   所以这里做统一兜底：非真实色值（currentColor / var(...) / 空）
 *   一律换成中性灰。调用方想精确控制颜色就传 hex。
 *
 * @param {string} key 图标 key（未知 key 自动兜底）
 * @param {object} opts 选项，同 lineIconSvg
 * @returns {string} data URI
 */
export function lineIconDataUri(key, opts = {}) {
  const svg = lineIconSvg(key, opts)
  const resolved = svg.replace(
    /stroke="currentColor"/,
    `stroke="${resolveStrokeColor(opts.color)}"`
  )
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(resolved)}`
}

/**
 * 把传进来的颜色解析成一个「独立 SVG 文档里真的能用」的色值。
 *
 * @param {string} color 调用方传的颜色
 * @returns {string} 真实色值
 */
function resolveStrokeColor(color) {
  if (!color || color === 'currentColor') return CURRENT_COLOR_FALLBACK
  // CSS 变量在独立 SVG 里无效，换成中性灰
  if (/^var\(/i.test(String(color).trim())) return CURRENT_COLOR_FALLBACK
  // inherit / unset 之类同样无效
  if (/^(inherit|unset|initial|revert)$/i.test(String(color).trim())) {
    return CURRENT_COLOR_FALLBACK
  }
  return String(color)
}
