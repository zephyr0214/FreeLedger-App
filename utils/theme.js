/**
 * 主题 —— 三态（跟随系统 / 浅色 / 深色）+ 6 套预设色
 *
 * 设计要点：
 *   1. 组件库走 wd-config-provider 的 theme + themeVars；
 *   2. 自研组件与页面底色走 CSS 变量（--app-*），由 App.vue 注入到根节点；
 *   3. tabBar 已改为自绘组件（components/AppTabBar.vue），
 *      它直接读 store 的主题色，不再需要在这里刷原生样式；
 *   4. uni.onThemeChange 在部分 Android 不触发，onShow 时兜底重读系统值。
 */

export const THEME_PRESETS = [
  { key: 'green',  name: '收支绿', primary: '#07C160', light: '#E8F9EF', dark: '#0A8F4A' },
  { key: 'blue',   name: '账本蓝', primary: '#1989FA', light: '#E8F3FF', dark: '#1068C6' },
  { key: 'orange', name: '暖橘',   primary: '#FF8F1F', light: '#FFF3E6', dark: '#C96C0C' },
  { key: 'purple', name: '紫罗兰', primary: '#7D5FFF', light: '#F0ECFF', dark: '#5A3FD1' },
  { key: 'red',    name: '朱砂',   primary: '#EE0A24', light: '#FFE9EC', dark: '#B2081B' },
  { key: 'grey',   name: '墨黑',   primary: '#323233', light: '#F2F3F5', dark: '#1C1C1E' }
]

export const THEME_MODE = {
  SYSTEM: 'system',
  LIGHT: 'light',
  DARK: 'dark'
}

export function getPreset(key) {
  return THEME_PRESETS.find((p) => p.key === key) || THEME_PRESETS[0]
}

/**
 * 读系统当前是否深色。
 *
 * ★ 用 osTheme，不要用旧的 theme 字段 ★
 *   uni.getSystemInfoSync() 有三个主题相关字段：
 *     osTheme    操作系统主题（light/dark）—— App 平台正确
 *     hostTheme  宿主主题（小程序/UniMPSDK）
 *     theme      旧字段，**不推荐使用**
 *
 *   旧字段 theme 在 Android 上有个已知问题：
 *   明明系统已经是深色模式，它还是返回 'light'
 *   （只在冷启动或从后台唤醒时读一次系统主题快照，
 *     不监听深色模式变化广播）。
 *   社区实测：MIUI / 澎湃OS / 「日落到日出」自动切换全都读成 light。
 *
 *   所以这里优先读 osTheme，取不到再退回 theme。
 */
export function isSystemDark() {
  try {
    const info = uni.getSystemInfoSync()
    if (!info) return false

    // App 端：osTheme 才是系统主题
    const osTheme = info.osTheme
    if (osTheme === 'dark') return true
    if (osTheme === 'light') return false

    // 宿主（小程序 / UniMPSDK）
    const hostTheme = info.hostTheme
    if (hostTheme === 'dark') return true
    if (hostTheme === 'light') return false

    // 老版本兜底
    return info.theme === 'dark'
  } catch (e) {
    return false
  }
}

/**
 * 让 App 的原生 UI（状态栏、tabBar、窗口背景）跟随系统深浅色。
 *
 * ★ 为什么必须调这个 ★
 *   官方文档：「在 App 上需要先调用 plus.nativeUI.setUIStyle('auto')
 *   开启跟随系统主题切换的功能，才能监听到主题切换事件」。
 *   不调的话，uni.onThemeChange 根本收不到事件，
 *   原生 tabBar / 状态栏也不会跟着系统变色。
 *
 * 只在 App 端有效，其它平台忽略。
 */
export function enableNativeFollowSystem() {
  try {
    if (typeof plus !== 'undefined' && plus.nativeUI &&
        typeof plus.nativeUI.setUIStyle === 'function') {
      plus.nativeUI.setUIStyle('auto')
      // 记住当前原生样式，
      // 这样后面 applyNativeTheme 能发现「不一致」并重新设置一次
      lastNativeStyle = 'auto'
    }
  } catch (e) {
    console.warn('[theme] setUIStyle 失败:', e && e.message)
  }
}

/**
 * 上一次设置给原生 UI 的样式。
 * 用来避免重复设置（setUIStyle 会触发原生层重绘，频繁调用有卡顿风险）。
 */
let lastNativeStyle = ''

/**
 * ★ 把原生 UI 的深浅色和 App 自己的深浅色对齐 ★
 *
 * 背景
 *   以前只在启动时调了一次 setUIStyle('auto')，让原生层「跟随系统」。
 *   于是当用户在 App 里手动选「始终深色 / 始终浅色」时：
 *     - App 自己的内容（CSS 变量 + wot-theme-dark class）变了
 *     - 原生层（状态栏文字色、原生 tabBar 底色、窗口背景）还跟着系统
 *   两边一旦不一致，就会出现「切回浅色没生效」的错觉：
 *   比如系统是深色，用户从「跟随系统」切到「深色」再切到「浅色」，
 *   App 内容确实变浅了，但状态栏 / 原生 tabBar 仍是深色，
 *   看上去就像「浅色没生效」。
 *
 * 做法
 *   按 mode 决定原生样式：
 *     system -> 'auto'（跟随系统）
 *     light  -> 'light'
 *     dark   -> 'dark'
 *
 * @param {boolean} dark  App 当前是否深色
 * @param {string} mode   system | light | dark
 */
export function applyNativeTheme(dark, mode) {
  const style = mode === THEME_MODE.SYSTEM ? 'auto' : (dark ? 'dark' : 'light')

  // 已经是这个样式了就不用重复设
  if (style === lastNativeStyle) return
  lastNativeStyle = style

  try {
    if (typeof plus !== 'undefined' && plus.nativeUI &&
        typeof plus.nativeUI.setUIStyle === 'function') {
      plus.nativeUI.setUIStyle(style)
    }
  } catch (e) {
    console.warn('[theme] setUIStyle 失败:', e && e.message)
  }

  applyStatusBarStyle(dark)
}

/**
 * 状态栏文字颜色。
 *
 * ★ navigationStyle: custom 下 uni.setNavigationBarColor 无效 ★
 *   那个 API 只管原生导航栏，而本项目所有页面都是自定义导航栏，
 *   状态栏由原生层绘制，要改它的文字颜色得用原生 API。
 *
 *   参数语义：'dark' = 深色文字（浅色背景用），'light' = 浅色文字（深色背景用）。
 */
function applyStatusBarStyle(dark) {
  const style = dark ? 'light' : 'dark'

  // 优先用 uni 的接口
  try {
    if (typeof uni !== 'undefined' && typeof uni.setStatusBarStyle === 'function') {
      uni.setStatusBarStyle({ style })
      return
    }
  } catch (e) {}

  // 兜底用 plus 的
  try {
    if (typeof plus !== 'undefined' && plus.navigator &&
        typeof plus.navigator.setStatusBarStyle === 'function') {
      plus.navigator.setStatusBarStyle(style)
    }
  } catch (e) {}
}

/**
 * 监听系统深浅色变化。
 *
 * ★ 为什么不能只靠 uni.onThemeChange ★
 *   1. App 端这个接口要求 manifest.json 里配了 darkmode: true，
 *      且社区实测在部分 Android 机型上运行期不触发。
 *   2. 它回调里的 res.theme 也不一定准 —— 收到事件后再用
 *      isSystemDark()（读 osTheme）复核一次更稳妥。
 *
 * 所以这里做双保险：
 *   - uni.onThemeChange：标准通道
 *   - plus.globalEvent 'themedchanged'：5+ 原生通道（App 端更可靠）
 *   - onShow 兜底：每次回前台重读一次
 *
 * @param {Function} callback 主题变化时调用（无参数）
 * @returns {Function} 取消监听的函数
 */
export function watchSystemTheme(callback) {
  const handlers = []

  /** 收到事件后统一处理：复核一次当前主题，变了才回调 */
  const handle = () => {
    callback()
  }

  // 1) 标准通道
  try {
    if (typeof uni.onThemeChange === 'function') {
      uni.onThemeChange(handle)
      handlers.push(() => {
        if (typeof uni.offThemeChange === 'function') uni.offThemeChange(handle)
      })
    }
  } catch (e) {
    console.warn('[theme] onThemeChange 不可用:', e && e.message)
  }

  // 2) 5+ 原生通道（App 端更可靠）
  try {
    if (typeof plus !== 'undefined' && plus.globalEvent &&
        typeof plus.globalEvent.addEventListener === 'function') {
      // 5+ 的系统主题变化事件名
      const EVENTS = ['themedchanged', 'themechanged', 'darkmodechange']
      for (const name of EVENTS) {
        try {
          plus.globalEvent.addEventListener(name, handle)
          handlers.push(() => {
            try { plus.globalEvent.removeEventListener(name, handle) } catch (e) {}
          })
        } catch (e) {
          // 这个事件名当前平台不支持，忽略
        }
      }
    }
  } catch (e) {
    console.warn('[theme] plus.globalEvent 不可用:', e && e.message)
  }

  return () => {
    for (const off of handlers) {
      try { off() } catch (e) {}
    }
  }
}

/** 根据 mode 解析出最终是否深色 */
export function resolveDark(mode) {
  if (mode === THEME_MODE.DARK) return true
  if (mode === THEME_MODE.LIGHT) return false
  return isSystemDark()
}

/**
 * 把 #RRGGBB 主题色转成半透明色（暗色模式的浅色底用）。
 *
 * ★ 为什么不能再用 rgba(255,255,255,0.10) ★
 *   暗色下「浅色底」原本是一层纯白半透明，叠在 #1C1C1E 卡片上
 *   只是把卡片提亮一点点，看起来几乎和没上色一样 ——
 *   用户反馈的「tabbar 选中滑块 / 最高十笔 / 账户类型选中态」暗色下不明显，
 *   根源就是这个值不带主题色，也没有足够对比。
 *
 *   改成「主题色 + 一定透明度」后：
 *     · 底色带上主题色相，能看出「被选中/高亮」
 *     · 暗底上 22% 的主题色已经足够区分，又不会刺眼
 *   浅色模式仍用预设里的 p.light（那是调过的浅色，比算出来的更耐看）。
 *
 * @param {string} hex  #RRGGBB
 * @param {number} alpha 0~1
 * @returns {string} rgba(...)
 */
export function tintOf(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return `rgba(7,193,96,${alpha})`
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${alpha})`
}

/**
 * 暗色模式下「浅主题色底」的统一取色。
 *
 * 与 buildCssVars 里 --app-primary-light 的暗色值是同一个来源，
 * 保证「组件用 store.primaryLight 取色」和「CSS 用 var(--app-primary-light)」
 * 在暗色下完全一致，不会出现同一块高亮两种深浅。
 *
 * @param {string} primaryHex 主题主色
 * @param {boolean} dark 是否暗色
 * @returns {string}
 */
export function themePrimaryLightDark(primaryHex, dark) {
  return dark ? tintOf(primaryHex, 0.22) : primaryHex
}

/**
 * 把两个 #RRGGBB 按比例混合，返回不透明的 #RRGGBB。
 *
 * 用于「需要一个不透明的浅色块」的场景：
 * 半透明色叠在父层上会透出底色，圆角边缘尤其明显（看起来像发白的阴影），
 * 直接算出等价的不透明色就没有这个问题。
 *
 * @param {string} baseHex   底色（通常是卡片色）
 * @param {string} tintHex   要掺进去的颜色（通常是主题色）
 * @param {number} ratio     掺入比例 0~1
 * @returns {string} #RRGGBB
 */
export function mixHex(baseHex, tintHex, ratio) {
  const parse = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
    if (!m) return null
    const n = parseInt(m[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const a = parse(baseHex)
  const b = parse(tintHex)
  if (!a || !b) return baseHex

  const r = Math.round(a[0] + (b[0] - a[0]) * ratio)
  const g = Math.round(a[1] + (b[1] - a[1]) * ratio)
  const bl = Math.round(a[2] + (b[2] - a[2]) * ratio)
  const to2 = (v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')
  return `#${to2(r)}${to2(g)}${to2(bl)}`
}

/**
 * 「柔光玻璃」配色 —— tabbar 和 + 弹出的对话框共用同一套。
 *
 * ★ 为什么要抽出来 ★
 *   两个组件都要半透明底 + 模糊 + 内高光描边，
 *   各自写一份迟早会飘（深浅色、透明度、阴影不一致）。
 *   抽成一个函数后，改一处两处同时变。
 *
 * ★ 三个要素凑出玻璃感 ★
 *   1. 半透明底色 —— 让下面的内容隐约透出来
 *   2. 模糊（@supports 检测，不支持时用高不透明度兜底）
 *   3. 内高光描边 —— 玻璃边缘的折射，缺了就只是块半透明色
 *
 * ★ 返回的是 CSS 变量 ★
 *   因为 @supports 管不到内联样式，颜色必须走变量，
 *   支持模糊的那段 CSS 才能覆盖掉降级值。
 *
 * @param {boolean} dark 是否暗色
 * @param {object} opt
 *   opt.blur     模糊半径（如 '24rpx'）
 *   opt.tintDark / opt.tintLight  覆盖默认底色（对话框想更实一点时用）
 * @returns {object} 可直接展开到 :style 的变量对象
 */
export function glassVars(dark, opt = {}) {
  const blur = opt.blur || '24rpx'
  const solidDark = opt.solidDark || 'rgba(28,28,30,0.94)'
  const solidLight = opt.solidLight || 'rgba(255,255,255,0.96)'
  return {
    '--glass-bg': dark
      ? (opt.tintDark || 'rgba(28,28,30,0.48)')
      : (opt.tintLight || 'rgba(255,255,255,0.62)'),
    '--glass-bg-solid': dark ? solidDark : solidLight,
    '--glass-border': dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.75)',
    '--glass-blur': blur,
    '--glass-shadow': dark
      ? '0 12rpx 40rpx rgba(0,0,0,0.55), inset 0 1rpx 0 rgba(255,255,255,0.10)'
      : '0 12rpx 40rpx rgba(0,0,0,0.10), inset 0 1rpx 0 rgba(255,255,255,0.90)'
  }
}

/**
 * 生成注入到页面的 CSS 变量字符串。
 * 自研组件只使用这些变量，不写死色值。
 *
 * ★ 同时注入组件库（wot-design-uni）的变量 ★
 *   库的按钮、弹层等组件颜色全部来自 CSS 变量
 *   （见 node_modules/wot-design-uni/components/common/abstracts/variable.scss）：
 *     --wot-color-theme                主色
 *     --wot-dark-background / --wot-dark-color...  深色模式的一整套
 *   项目里没有渲染 <wd-config-provider>（App.vue 的 template 在 App 端不渲染），
 *   所以改成把变量直接注入到 .app-page 的 style 上，
 *   库的组件就会跟着主题色和深浅色走。
 */
export function buildCssVars(presetKey, dark) {
  const p = getPreset(presetKey)
  const vars = dark
    ? {
        '--app-bg': '#000000',
        '--app-bg-2': '#0D0D0F',
        '--app-card': '#1C1C1E',
        '--app-card-2': '#2C2C2E',
        '--app-line': '#2E2E31',
        '--app-text': '#F5F5F7',
        '--app-text-2': '#A1A1A6',
        '--app-text-3': '#6E6E73',
        '--app-primary': p.primary,
        '--app-primary-light': tintOf(p.primary, 0.22),
        /*
         * ★ 不透明的「浅主题色底」——大面积色块专用 ★
         *   --app-primary-light 是半透明色，用在徽标、胶囊这类小面积没问题；
         *   但铺成整行背景（如统计页前三名）时，圆角和条目间隙会和
         *   父卡片底色叠加，在深色背景上看起来像一圈发白的阴影。
         *   这里把主题色按 22% 直接混进卡片色，得到等价的观感但不透明，
         *   色块边缘干净、不会透出底下的颜色。
         */
        '--app-primary-light-solid': mixHex('#1C1C1E', p.primary, 0.22),
        /*
         * ★ 顶部渐变卡片的起始色（暗色下 = 卡片色，等于没有渐变）★
         *   浅色下用主题浅色做出「顶部泛一层淡淡的主题色」的效果，
         *   但暗色下那层浅色会把深底「提亮成灰」，很糊、很脏
         *   （rgba(255,255,255,0.10) 叠在黑卡片上就是一片灰）。
         *   暗色下刻意让它等于 --app-card：
         *   渐变从卡片色到卡片色，视觉上就是纯净的卡片底。
         *   这样「概览卡 / 详情页头部」在暗色下不再泛白，
         *   而代码里那条 linear-gradient 不用按模式写两遍。
         */
        /*
         * ★ 顶部渐变卡的起始色 ★
         *
         * ★ 暗色下「不显示渐变」（用户本轮第 4 条）★
         *   用户原话「和首页一样，暗色模式下不显示渐变」。
         *   所以这里刻意让它**等于 --app-card**：
         *   linear-gradient 两端同色 ≈ 没有渐变，但代码里那条
         *   gradient 不用按模式写两遍。
         *   （之前改成「混 18% 主题色」是度过了 ——
         *     黑底上泛一层绿会看起来很脏，这正是原来写死
         *     卡片色的原因。）
         */
        '--app-hero-from': '#1C1C1E',
        /*
         * ★ 卡片内部「小标题栏」的起始色（人名 / 应报实报）★
         *
         * ★ 暗色下它只是「一种灰」，已不参与渐变（用户本轮第 3 条）★
         *   用户原话：「它应该是一个平均铺满的灰色，而不是渐变色。
         *   这个灰色要跟下面交易记录背景的黑色有一定的区分度」。
         *   所以这个变量在暗色下已经**没有作用**，
         *   真正生效的是下面的 --app-subhead-bg。
         *   保留它只是为了不让旧代码引用到 undefined。
         */
        '--app-hero-soft-from': '#2C2C2E',
        /*
         * ★ 卡片内小标题栏的**整个背景**（用户本轮第 3 条）★
         *
         *   用户原话：
         *     「在「借入借出」名字背后，或者说报销单头部金额的位置，
         *     在深色模式下：它应该是一个平均铺满的灰色，而不是渐变色。
         *     这个灰色要跟下面交易记录背景的黑色有一定的区分度」。
         *
         *   ★ 为什么要单独一个变量，不能用 gradient 两端同色代替 ★
         *     两端同色虽然看不出渐变，但它仍然是一层 linear-gradient，
         *     在部分渲染层会多一个合成层；而且本质上「平铺灰」和
         *     「两端同色的渐变」是两回事，写成同一个变量以后只会让人误以为它还在渐变。
         *     直接给一个纯色值，意图明确，也没有渲染开销。
         *
         *   ★ 为什么取 #2C2C2E ★
         *     交易记录行的底色是 --app-card（#1C1C1E），小标题栏用 --app-card-2（#2C2C2E）。
         *     两者在黑底上相差一档亮度：能分出「这是头、那是明细」，
         *     但又不会像主题色渐变那样抢眼。
         *     正好复用已有 token，不引入新的灰色值（避免又一套「不同的黑/灰」）。
         */
        '--app-subhead-bg': '#2C2C2E',
        '--app-danger': '#FF453A',
        '--app-success': '#32D74B',
        '--app-warning': '#FFD60A',
        /*
         * ★ 中性的「浅灰」—— 转账、不计入资产的余额用 ★
         *   暗色下用一个比 --app-text-2 更淡的灰：
         *   --app-text-2(#A1A1A6) 在白底上算「次要文字」，
         *   但暗底上它会显得偏亮、抢正文；这里取 #8E8E93，
         *   明显弱于正文却仍清晰可读。
         */
        '--app-muted': '#8E8E93',
        '--app-mask': 'rgba(0,0,0,0.65)',
        '--app-shadow': '0 2rpx 16rpx rgba(0,0,0,0.4)'
      }
    : {
        '--app-bg': '#F7F8FA',
        '--app-bg-2': '#FFFFFF',
        '--app-card': '#FFFFFF',
        '--app-card-2': '#F7F8FA',
        '--app-line': '#EBEDF0',
        '--app-text': '#323233',
        '--app-text-2': '#646566',
        '--app-text-3': '#969799',
        '--app-primary': p.primary,
        '--app-primary-light': p.light,
        /* 浅色：预设的 light 本身就是不透明色，直接复用即可 */
        '--app-primary-light-solid': p.light,
        /*
         * ★ 浅色下「主题色渐变」（用户本轮第 4 条）★
         *   用户反馈「怎么还是灰色的」。
         *   根因：以前这里用的是预设的 `light`，
         *   而「墨黑」这一套主题的 light 本身就是 #F2F3F5（**灰白**）——
         *   选了它就是一片灰，看不出主题色。
         *   现在改成「白色混入 14% 主题色」：不论哪套主题，
         *   起始色都带上对应色相，与卡片底色之间形成一层淡淡的主题色渐变。
         *   ★ 为什么是混色而不是直接用主题色 ★
         *     直接用 #07C160 会让卡片上半截变成满绿，
         *     上面的数字（尤其是绿色金额）就看不清了。
         */
        '--app-hero-from': mixHex('#FFFFFF', p.primary, 0.14),
        /*
         * 卡片内部小标题栏：比大卡片更淡一档的主题色
         *
         * ★ 为什么不直接用 --app-hero-from ★
         *   大卡片的起始色要在整张卡上铺开看得出渐变，
         *   而这一条只有 70rpx 高，同样浓度会看起来像一块深色色带。
         *   所以混入比例降到 8%，浅浅一层「这是小标题」的暗示。
         */
        '--app-hero-soft-from': mixHex('#FFFFFF', p.primary, 0.08),
        /*
         * 浅色下保持渐变（用户只提了暗色模式）
         *
         * ★ 为什么浅色要用渐变 ★
         *   浅色卡片是白的，小标题栏如果也是一块纯白（或纯灰），
         *   那就变成「一条硬切的色带」，很僳硬。
         *   叠一层淡主题色到白的渐变，过渡自然，
         *   而且暗色下反过来用平铺灰也是同理：黑底上渐变反而显脏。
         */
        '--app-subhead-bg': `linear-gradient(135deg, ${mixHex('#FFFFFF', p.primary, 0.08)}, #FFFFFF)`,
        '--app-danger': '#EE0A24',
        '--app-success': '#07C160',
        '--app-warning': '#FF976A',
        /* 浅色下的中性浅灰：比 --app-text-3(#969799) 更淡一档 */
        '--app-muted': '#B8BEC7',
        '--app-mask': 'rgba(0,0,0,0.45)',
        '--app-shadow': '0 2rpx 16rpx rgba(0,0,0,0.06)'
      }

  // ---- 组件库（wot-design-uni）的变量 ----
  Object.assign(vars, buildWotCssVars(presetKey, dark))

  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')
}

/**
 * 组件库用的 CSS 变量。
 *
 * 主色：--wot-color-theme 是库的根变量，按钮、开关、单选等都从它派生。
 * 深色：库的深色样式是靠祖先上的 .wot-theme-dark 类切换的
 *       （见 wd-button/index.scss 等），所以除了颜色变量，
 *       还要给页面根节点加这个类 —— 见 utils/theme.js 的 wotThemeClass。
 *       这里同时把深色变量也注入，避免个别组件不认类名时颜色不对。
 */
export function buildWotCssVars(presetKey, dark) {
  const p = getPreset(presetKey)
  const vars = {
    '--wot-color-theme': p.primary,
    '--wot-color-primary': p.primary,
    '--wot-button-primary-bg-color': p.primary,
    '--wot-switch-checked-bg-color': p.primary,
    '--wot-checkbox-checked-color': p.primary,
    '--wot-radio-checked-color': p.primary,
    '--wot-slider-active-bg-color': p.primary,
    '--wot-tag-primary-color': p.primary,
    '--wot-pager-indicator-active-color': p.primary,
    '--wot-tabbar-item-active-color': p.primary
  }

  if (dark) {
    Object.assign(vars, {
      '--wot-dark-background': '#0D0D0F',
      '--wot-dark-background2': '#1C1C1E',
      '--wot-dark-background3': '#141414',
      '--wot-dark-background4': '#2C2C2E',
      '--wot-dark-background5': '#3A3A3C',
      '--wot-dark-background6': '#380e08',
      '--wot-dark-background7': '#707070',
      '--wot-dark-color': '#FFFFFF',
      '--wot-dark-color2': '#f2270c',
      '--wot-dark-color3': 'rgba(232, 230, 227, 0.8)',
      '--wot-dark-color-gray': '#A1A1A6'
    })
  }

  return vars
}

/**
 * 组件库深色模式需要的 class。
 * 库的深色样式是 `.wot-theme-dark .wd-button { ... }` 这种后代选择器，
 * 必须有一个祖先带这个类才生效。
 */
export function wotThemeClass(dark) {
  return dark ? 'wot-theme-dark' : 'wot-theme-light'
}

/** 组件库主题变量（只覆盖主色，其余用默认） */
export function buildWotThemeVars(presetKey) {
  const p = getPreset(presetKey)
  return {
    colorTheme: p.primary,
    colorPrimary: p.primary
  }
}

/**
 * tabBar 文字与图标的配色
 *
 * ★ 未选中态刻意加深（比最早的 #969799 深一档）★
 *   原来浅色用 #969799（在白底上几乎糊成一片），
 *   未选中 / 选中之间的对比太弱，切换 tab 时体感不明显。
 *   现在浅色用 #646566、深色用 #A1A1A6。
 *
 *   ★ 注意：颜色深浅和线条粗细是两回事 ★
 *   用户说「tabBar 太粗了」指的是**图标的线条**，
 *   颜色这版没被抱怨过，所以深浅维持在第一版的水平，
 *   没有继续往正文色（#323233）加深。
 */
export const TABBAR_FONT_COLOR_LIGHT = '#646566'
export const TABBAR_FONT_COLOR_DARK = '#A1A1A6'

/**
 * tabBar 图标的版本后缀。
 *
 * ★ 现在还需要它吗 ★
 *   底栏已改为自绘组件（components/AppTabBar.vue），图标由我们自己
 *   用 <image> 加载，不再经过原生 tabBar 的位图缓存，
 *   所以「改完图标必须重新打包才生效」那个老坑已经不适用了。
 *
 *   但这个常量仍然有用：static/tabbar/ 下 32 个 PNG 的文件名
 *   就带这个后缀（*-v2.png），theme.json 里也是同一批路径。
 *   保留它是为了「文件名 ⇄ 代码」一致，避免有一天想改图标时
 *   两边对不上。
 *
 * ★ 要不要 bump ★
 *   不必。自绘不走原生缓存，重新打包即可。
 *   真要改名，需同步：这里 + theme.json（8 处）+ scripts/gen-tabbar-icons.py。
 */
export const TABBAR_ICON_VERSION = '-v2'

/** 状态栏与导航栏文字颜色 */
export function applyNavigationBarTheme(dark) {
  try {
    uni.setNavigationBarColor({
      frontColor: dark ? '#ffffff' : '#000000',
      backgroundColor: dark ? '#000000' : '#F7F8FA'
    })
  } catch (e) {}
}
