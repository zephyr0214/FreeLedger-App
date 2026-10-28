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

  /* ---------------- 账户图标（添加账户页的预设选择器） ---------------- */

  /**
   * 信用卡：卡片 + 磁条
   *
   * 用户给账户挑图标时，「银行卡」「信用卡」是两个高频但不同的东西，
   * 所以和 account（钱包）区分开：这里画一张带磁条的卡。
   */
  creditcard: [
    'M2.5 7.5A2.5 2.5 0 0 1 5 5h14a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 19 19H5a2.5 2.5 0 0 1-2.5-2.5z',
    // 磁条
    'M2.5 10.5h19',
    // 卡号示意
    'M6 15h4'
  ],

  /** 现金：纸币 + 中间的圈 */
  cash: [
    'M2.5 7h19v10h-19z',
    circlePath(12, 12, 2.6),
    'M6 10.2v3.6',
    'M18 10.2v3.6'
  ],

  /**
   * 支付宝：圆形徽章 + 「支」字骨架
   *
   * 第一版笔画都挤在圆心附近，渲染出来比同排的图标小一圈。
   * 第二版把整个字形撑到圆的内切范围（约 7.5 半径），
   * 让视觉大小和其他图标一致。
   */
  alipay: [
    circlePath(12, 12, 9),
    // 「支」的横（拉宽到圆的 2/3）
    'M6.6 9.2h10.8',
    // 竖
    'M12 5.6v4.6',
    // 撇
    'M7.4 13.6c2.2.2 4.4 1.3 5.8 3',
    // 竖弯钩的简化（右侧包回来）
    'M17.2 12.4c0 3.1-2.3 5.4-5.4 5.4-1.7 0-3.2-.7-4.1-1.9'
  ],

  /**
   * 银行：古典柱式建筑（柱廊 + 三角山花）
   *
   * 这是「银行」最通用的视觉符号（全世界的银行都用它），
   * 比画某个具体银行的 logo 合适得多，也能覆盖所有银行。
   */
  bank: [
    // 三角山花
    'M3 9.6L12 4l9 5.6',
    // 横梁
    'M4.4 9.6h15.2',
    // 四根柱子
    'M6.6 12.4v5',
    'M10.2 12.4v5',
    'M13.8 12.4v5',
    'M17.4 12.4v5',
    // 底座
    'M3.6 19.6h16.8'
  ],

  /** 储蓄 / 存钱罐：罐身 + 投币口 */
  piggy: [
    'M4.2 13.2c0-3.3 3.5-6 7.8-6s7.8 2.7 7.8 6c0 1.6-.8 3-2.1 4v2.2h-2.6v-1.2c-.9.2-1.9.4-3.1.4s-2.2-.2-3.1-.4v1.2H6.3V17c-1.3-1-2.1-2.4-2.1-4z',
    // 投币口
    'M9.6 8.4l1.2-1.6h2.4l1.2 1.6',
    // 眼睛
    circlePath(15.6, 12.4, 0.9)
  ],

  /** 保险箱 / 定期：箱体 + 转盘 + 把手 */
  safe: [
    'M4 4.6h13a2 2 0 0 1 2 2v10.8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6.6a2 2 0 0 1 2-2z',
    circlePath(10.5, 12, 3.2),
    'M10.5 8.8v1.4',
    'M10.5 13.8v1.4',
    'M16.6 10.4v3.2'
  ],

  /**
   * 工资 / 收入：工资袋（¥ 在袋子中间）
   *
   * 第一版画的是「钞票 + 圈」，和 cash 几乎一样，两个图标分不出来。
   * 改成**工资袋**：上方一个收口 + 袋身，中间一个 ¥。
   * 这个符号在记账 App 里就是「收入/工资」的通用表达。
   */
  salary: [
    // 袋身
    'M4.6 8.4h14.8l1.4 11.2a1.6 1.6 0 0 1-1.6 1.8H4.8a1.6 1.6 0 0 1-1.6-1.8z',
    // 收口
    'M7.6 8.4c0-2.2 1.9-4 4.4-4s4.4 1.8 4.4 4',
    // ¥ 符号
    'M9.8 11.6l2.2 2.6 2.2-2.6',
    'M9.6 15.6h4.8',
    'M12 14.2v3.6'
  ],

  /** 微信 / 网络支付：两个叠起来的对话气泡 */
  wechat: [
    'M9.2 3.5c-3.9 0-7 2.6-7 5.8 0 1.8 1 3.4 2.6 4.5l-.7 2.2 2.5-1.3c.8.2 1.7.4 2.6.4',
    'M22 14.4c0-2.7-2.5-4.9-5.6-4.9s-5.6 2.2-5.6 4.9 2.5 4.9 5.6 4.9c.7 0 1.4-.1 2-.3l2 1-.6-1.7c1.3-.9 2.2-2.3 2.2-3.9z'
  ],

  /**
   * 花呗 / 先享后付：时钟 + 循环箭头（先花、后还）
   *
   * 第一版画了朵花，渲染出来像个莲花，和「先享后付」没关系。
   * 改成语义更直接的表达：一个表盘（账单周期）外面绕一圈箭头（还款）。
   */
  huabei: [
    circlePath(12, 12, 6.2),
    // 指针
    'M12 8.4V12l2.6 1.6',
    // 外面绕一圈的还款箭头
    'M20.4 8.4a9 9 0 0 0-15.7-1.2',
    'M20.4 3.9v4.5h-4.5',
    'M3.6 15.6a9 9 0 0 0 15.7 1.2',
    'M3.6 20.1v-4.5h4.5'
  ],

  /** 投资 / 理财：上升折线 + 箭头 */
  invest: [
    'M3 17.5l5.2-5.2 3.4 3.4L21 6.3',
    'M16.5 6.3H21v4.5'
  ],

  /** 车辆：车身 + 两个轮子 */
  car: [
    'M4 16.5V13l1.9-4.2A2 2 0 0 1 7.7 7.5h8.6a2 2 0 0 1 1.8 1.3L20 13v3.5',
    'M4 13h16',
    circlePath(7.5, 17.5, 1.6),
    circlePath(16.5, 17.5, 1.6)
  ],

  /** 手机：机身 + home 键 */
  phone: [
    'M8 2.5h8a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z',
    'M10 5.5h4',
    circlePath(12, 18.5, 1)
  ],

  /** 礼品 / 红包：礼盒 + 蝴蝶结 */
  gift: [
    'M3.5 9.5h17v11h-17z',
    'M2.5 6h19v3.5h-19z',
    'M12 6v14.5',
    'M12 6C12 6 10.8 2.5 8.4 2.5a2.2 2.2 0 0 0 0 4.4H12z',
    'M12 6C12 6 13.2 2.5 15.6 2.5a2.2 2.2 0 0 1 0 4.4H12z'
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
export function resolveStrokeColor(color) {
  if (!color || color === 'currentColor') return CURRENT_COLOR_FALLBACK
  // CSS 变量在独立 SVG 里无效，换成中性灰
  if (/^var\(/i.test(String(color).trim())) return CURRENT_COLOR_FALLBACK
  // inherit / unset 之类同样无效
  if (/^(inherit|unset|initial|revert)$/i.test(String(color).trim())) {
    return CURRENT_COLOR_FALLBACK
  }
  return String(color)
}
