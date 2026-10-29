<template>
  <view class="tabbar-host" :class="{ pressing }">
    <!--
      圆角悬浮底栏
      ★ 为什么不用原生 tabBar ★
        原生 tabBar 由系统绘制，做不了圆角、悬浮、留白、阴影，
        App 端也没有「自定义 tabBar」选项（只有小程序有 custom:true）。
        所以这里用原生 tabBar 只保留「页面切换」的能力（pages.json 里的声明），
        运行时把它隐藏掉（uni.hideTabBar），视觉全部由本组件负责。

      ★ 底栏和 + 按钮是「两块独立的悬浮块」★
        用户要求两者不要连在一起，所以这里是两个分开的圆角容器：
          · 左边 pill：4 个 tab 平分
          · 右边圆形：记账 +
        中间留出 GAP 的透明空隙，不共用一个外框。
    -->
    <view class="tabbar-row">
      <!-- 左：tab pill -->
      <view class="tabbar" :style="barStyle">
        <!-- ★ 滑块必须在 tab-item 之前渲染 ★
             它在每个 tab 里绝对定位、z-index 低于图标文字，
             靠 transform 横向位移到当前 tab 下面（见 .tab-slider）。
             放在后面也能显示，但会盖住图标，所以顺序有讲究。 -->
        <view class="tab-slider" :style="sliderStyle" />

        <view
          v-for="item in items"
          :key="item.name"
          class="tab-item"
          :class="{ active: item.active }"
          @click="onTabClick(item)"
        >
          <image
            class="tab-icon"
            :src="iconOf(item)"
            mode="aspectFit"
          />
          <text class="tab-text" :style="{ color: item.active ? primaryColor : fontColor }">
            {{ item.text }}
          </text>
        </view>
      </view>

      <!-- 右：记账 + 按钮，独立圆形，与 pill 之间留空隙
           ★ 形状不变 ★ 还是圆形，高度与 pill 一致，视觉上齐平 -->
      <view
        class="tab-add"
        :class="{ pressing }"
        :style="{ backgroundColor: primaryColor }"
        @touchstart.stop.prevent="onTouchStart"
        @touchend.stop.prevent="onTouchEnd"
        @touchcancel.stop.prevent="onTouchCancel"
        @touchmove.stop.prevent="onTouchMove"
      >
        <text class="add-icon" :class="{ rotated: pressing }">+</text>

        <!-- 长按进度环：转满一圈即打开手动记账 -->
        <view v-if="pressing && holdEnabled" class="add-ring">
          <view class="add-ring-inner" :style="ringStyle" />
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { ref, computed } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { TABBAR_ICON_VERSION } from '@/utils/theme.js'

/**
 * 长按触发时长（ms）
 * 与旧 FabButton 保持一致：300ms 按住即弹面板，不用等松手。
 */
const HOLD_MS = 300

/**
 * 四个 tab 的定义。
 *
 * ★ 必须与 pages.json 的 tabBar.list 顺序一致 ★
 *   点击时用 uni.switchTab 跳页面，路径写错会静默失败（不报错、不跳转）。
 *   scripts/check-tabbar.mjs 有一条断言在校验这一点。
 */
const TABS = [
  { name: 'home', text: '首页', path: '/pages/index/index' },
  { name: 'account', text: '账户', path: '/pages/account/index' },
  { name: 'stats', text: '统计', path: '/pages/stats/index' },
  { name: 'mine', text: '我的', path: '/pages/mine/index' }
]

export default {
  name: 'AppTabBar',
  props: {
    /**
     * 当前选中的 tab 名（home / account / stats / mine）。
     * 由各 tab 页自己传 —— 组件不猜当前路由，
     * 因为 uni-app 没有可靠的「同步获取当前页」接口。
     */
    current: { type: String, default: 'home' },
    /**
     * 长按 + 是否启用。
     * 「设置 → 记账按钮设置」里长按可以被设成「不响应」，
     * 这时连进度环和震动一起关掉——转完却什么都不发生比没反应更困惑。
     */
    holdEnabled: { type: Boolean, default: true }
  },
  /**
   * ★ 事件名不要用 tap / click ★
   *   它们是 uni-app 模板的原生事件别名，会与自定义 emit 撞车
   *   （旧 FabButton 踩过这个坑）。
   */
  emits: ['single-press', 'hold-start', 'hold-end', 'hold-cancel'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()

    const pressing = ref(false)
    const progress = ref(0)

    let startTs = 0
    let longFired = false
    let timer = null
    let rafTimer = null
    let startX = 0
    let startY = 0

    const primaryColor = computed(() => settingStore.primaryColor)

    /** 未选中态的文字色：跟着深浅模式走，与 theme.json 的 tabFontColor 一致 */
    const fontColor = computed(() => (settingStore.isDark ? '#A1A1A6' : '#646566'))

    /**
     * 底栏玻璃质感：只负责传「颜色变量」，样式规则在 CSS 里。
     *
     * ★ 为什么拆成 CSS 变量，而不是全用内联样式 ★
     *   毛玻璃的关键是 backdrop-filter，但它在 App 端支持得很差：
     *     · iOS：14+ 的 WKWebView 才有
     *     · Android：多数系统 WebView 直接忽略
     *     · 小程序 / nvue：完全不支持
     *   不支持时，半透明底会「透出下面的内容却不模糊」，
     *   看起来是脏的、花的，比实色还难看。
     *   所以必须做降级：用 @supports 检测，支持才走真·毛玻璃，
     *   不支持就用不透明度更高的「仿玻璃」。
     *   @supports 管不到内联样式，所以颜色得走 CSS 变量。
     *
     * ★ 三个要素凑出玻璃感 ★
     *   1. 半透明底色 —— 让页面内容隐约透出来
     *   2. 模糊（支持时）—— 把透出来的糊成雾面
     *   3. 内高光描边 —— 玻璃边缘的折射，缺了就只是块半透明色
     */
    const barStyle = computed(() => {
      const dark = settingStore.isDark
      return {
        // 真·玻璃：比较透
        '--bar-bg': dark ? 'rgba(28,28,30,0.58)' : 'rgba(255,255,255,0.70)',
        // 降级：不模糊时用更高的不透明度，避免透出内容显脏
        '--bar-bg-solid': dark ? 'rgba(28,28,30,0.94)' : 'rgba(255,255,255,0.96)',
        '--bar-border': dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.75)',
        '--bar-shadow': dark
          ? '0 12rpx 40rpx rgba(0,0,0,0.55), inset 0 1rpx 0 rgba(255,255,255,0.10)'
          : '0 12rpx 40rpx rgba(0,0,0,0.10), inset 0 1rpx 0 rgba(255,255,255,0.90)'
      }
    })

    /** 进度环描边比例 */
    const ringStyle = computed(() => ({
      background: `conic-gradient(${primaryColor.value} ${progress.value * 360}deg, transparent ${progress.value * 360}deg)`
    }))

    /** tab 列表（补上 active 标记） */
    const items = computed(() =>
      TABS.map((t) => ({ ...t, active: t.name === props.current }))
    )

    /**
     * 当前 tab 的序号（0..3）。
     * 找不到时退回 0，避免 current 传错导致滑块飞到屏幕外。
     */
    const currentIndex = computed(() => {
      const i = TABS.findIndex((t) => t.name === props.current)
      return i < 0 ? 0 : i
    })

    /**
     * 滑块位置与颜色。
     *
     * ★ 用 translateX 而不是改 left ★
     *   transform 由合成器处理，切 tab 时能走 CSS transition，
     *   过渡是「滑过去」而不是「跳过去」。
     *   改 left 也能动，但会和布局回流搅在一起，动画掉帧。
     *
     * ★ 位移 = 序号 × 100% ★
     *   百分比基准是滑块自身宽度，而滑块宽度正好等于单格宽度
     *   （见 .tab-slider 的 calc），所以第 N 格恰好落在 (N × 100%)。
     *
     * ★ 颜色走 CSS 变量 ★
     *   真正上色的是 .tab-slider::after（它比格子小一圈），
     *   伪元素读不到内联 backgroundColor，所以用变量中转。
     *
     * ★ iOS 观感的关键：滑块也要「玻璃」★
     *   iOS 的 tab 指示器半透明、带一点点内高光，
     *   不是一块实心色。所以：
     *     浅色 → 浅主题色 + 一道白色内高光（像玻璃片）
     *     深色 → 白色 14% + 内高光（iOS 深色就是这么做的）
     */
    const sliderStyle = computed(() => {
      const dark = settingStore.isDark
      return {
        transform: `translateX(${currentIndex.value * 100}%)`,
        '--slider-color': dark
          ? 'rgba(255,255,255,0.14)'
          : settingStore.primaryLight,
        '--slider-highlight': dark
          ? 'inset 0 1rpx 0 rgba(255,255,255,0.16)'
          : 'inset 0 1rpx 0 rgba(255,255,255,0.85)'
      }
    })

    /**
     * 图标路径。
     *
     * ★ 复用 static/tabbar/ 下那套 PNG ★
     *   文件名带版本号（-v2），是覆盖安装时绕过原生位图缓存用的。
     *   现在图标由我们自己绘制，理论上不再走原生缓存；
     *   但路径保持一致，就不要为了「看起来没用了」再去改文件名。
     */
    function iconOf(item) {
      const dark = settingStore.isDark
      const preset = settingStore.settings.themePreset
      const suffix = dark ? '-dark' : ''
      if (item.active) {
        return `/static/tabbar/${item.name}-active-${preset}${TABBAR_ICON_VERSION}.png`
      }
      return `/static/tabbar/${item.name}${suffix}${TABBAR_ICON_VERSION}.png`
    }

    /* ------------------------------------------------------ tab 点击 */

    /**
     * 点 tab 切换页面。
     *
     * ★ 必须用 switchTab ★
     *   这 4 个页面在 pages.json 里声明为 tabBar 页，
     *   navigateTo / redirectTo 都会失败。
     *   点当前 tab 则什么都不做（避免重复通知原生栏重建页面）。
     */
    function onTabClick(item) {
      if (item.active) return
      try {
        uni.switchTab({ url: item.path })
      } catch (e) {}
    }

    /* ------------------------------------------------------ 长按手势 */

    function clearTimer() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    function clearRaf() {
      if (rafTimer) {
        cancelAnimationFrame(rafTimer)
        rafTimer = null
      }
      progress.value = 0
    }

    /** 进度环逐帧推进 */
    function tick() {
      if (!pressing.value) return
      const elapsed = Date.now() - startTs
      progress.value = Math.min(elapsed / HOLD_MS, 1)
      if (progress.value < 1) {
        rafTimer = requestAnimationFrame(tick)
      }
    }

    function onTouchStart(e) {
      const t = e.touches && e.touches[0]
      if (t) {
        startX = t.clientX
        startY = t.clientY
      }
      startTs = Date.now()
      longFired = false
      pressing.value = true
      progress.value = 0

      // 长按被关掉：不启动计时器、不震动、不发 hold 事件，
      // 松手时按短按处理（短按仍然可用）
      if (!props.holdEnabled) return

      timer = setTimeout(() => {
        longFired = true
        try {
          uni.vibrateShort({ type: 'medium' })
        } catch (err) {}
        emit('hold-start')
        emit('hold-end')
        pressing.value = false
        clearRaf()
        clearTimer()
      }, HOLD_MS)

      if (typeof requestAnimationFrame === 'function') {
        rafTimer = requestAnimationFrame(tick)
      }
    }

    function onTouchEnd() {
      clearTimer()
      clearRaf()
      const delta = Date.now() - startTs
      const wasLong = props.holdEnabled && (longFired || delta >= HOLD_MS)

      if (wasLong) {
        // 到达阈值时已经自动触发过了，这里不重复
        if (!longFired) emit('hold-end')
      } else {
        emit('single-press')
      }
      longFired = false
      pressing.value = false
    }

    function onTouchCancel() {
      clearTimer()
      clearRaf()
      if (longFired) {
        longFired = false
        emit('hold-cancel')
      }
      pressing.value = false
    }

    function onTouchMove(e) {
      const t = e.touches && e.touches[0]
      if (!t) return
      // 手指明显移动 → 取消长按
      const dx = Math.abs(t.clientX - startX)
      const dy = Math.abs(t.clientY - startY)
      if (dx > 30 || dy > 30) {
        clearTimer()
        clearRaf()
        if (longFired) {
          longFired = false
          emit('hold-cancel')
        }
        pressing.value = false
      }
    }

    return {
      items, primaryColor, fontColor, barStyle, ringStyle, sliderStyle, pressing,
      iconOf, onTabClick,
      onTouchStart, onTouchEnd, onTouchCancel, onTouchMove
    }
  }
}
</script>

<style scoped>
/*
 * 宿主容器：固定在底部，只负责「贴底 + 让内容居中」。
 *
 * ★ 不再用 left:0 + right:0 铺满 ★
 *   铺满时内部 pill 会被拉成一条横条（之前的 flex:1 就是这么变的），
 *   看着像「原生底栏换了个皮」，没有悬浮感。
 *   现在用 left/right 双向 auto 让容器宽度由内容决定、水平居中，
 *   两侧留出页面背景，才是浮起来的一小块。
 *
 * ★ z-index 要比页面内容和大部分弹层高，但低于全屏记账面板 ★
 *   记账面板是 wd-popup（z-index 默认 500+），
 *   底栏 300 —— 面板打开时盖住底栏，底栏本身不消失。
 */
.tabbar-host {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 300;
  /* 内容整体居中；padding 只负责离屏幕底边和安全区的距离 */
  display: flex;
  justify-content: center;
  padding: 0 24rpx calc(env(safe-area-inset-bottom) + 16rpx) 24rpx;
  /* 容器不吃触摸事件，只有内部两块吃，避免整条透明区域挡点击 */
  pointer-events: none;
}

/*
 * 横向排布：左 pill + 右圆按钮，两者**分开**且整体居中。
 *
 * ★ gap 是这一版的关键 ★
 *   用户明确要求「tabbar 和 + 按钮不要连在一起」，
 *   所以这里不用「一个大外框里塞两半」的做法，
 *   而是两个独立浮块 + 中间 20rpx 的透明间隔。
 *
 * ★ 不撑满宽度 ★
 *   以前 pill 用 flex:1 吃满剩余空间，看着像一条「通到底的横条」，
 *   失去悬浮感。现在整体居中、pill 给固定宽度，
 *   两侧露出页面背景，才是「浮起来的一块」。
 */
.tabbar-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20rpx;
  pointer-events: none;
}

/*
 * 左：4 个 tab 的胶囊
 *
 * ★ 圆角用 999rpx（全圆角胶囊），不用固定值 ★
 *   右侧 + 按钮是正圆（border-radius: 50%），
 *   曲率 = 直径的一半。pill 用 999rpx 后半径也自动等于高度的一半，
 *   两端正好是半圆，和圆按钮的弧度看起来才是一套的。
 *
 * ★ 高度 128rpx ★
 *   96rpx 那版偏扁，像「一条横杠」，不好看。
 *   128rpx 能容下 48rpx 图标 + 24rpx 文字 + 上下留白，
 *   视觉上更挺、更有分量，也更像一块「浮起来的托盘」。
 *
 * ★ 宽度 560rpx（不撑满，但也不抠）★
 *   4 格各 136rpx，图标文字都不挤；
 *   屏幕两侧仍留出背景，保持悬浮感。
 *   上一版 420rpx 太紧凑了。
 */
.tabbar {
  position: relative;
  width: 560rpx;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 128rpx;
  border-radius: 999rpx;
  border-width: 1rpx;
  border-style: solid;
  border-color: var(--bar-border, rgba(0, 0, 0, 0.05));
  /*
   * ★ 默认走「仿玻璃」：不透明度高，不依赖模糊 ★
   *   支持 backdrop-filter 时下面那段 @supports 会覆盖成真玻璃。
   *   先写降级版是刻意的 —— 不支持模糊的设备占相当比例，
   *   与其让它们「透出内容但不糊」显脏，不如直接给干净的高不透明底。
   */
  background-color: var(--bar-bg-solid, rgba(255, 255, 255, 0.96));
  box-shadow: var(--bar-shadow, 0 12rpx 40rpx rgba(0, 0, 0, 0.1));
  padding: 0 10rpx;
  /* 只有 pill 本体吃点击 */
  pointer-events: auto;
}

/*
 * ★ 真·毛玻璃：只在支持 backdrop-filter 的环境生效 ★
 *
 * 覆盖顺序很重要：
 *   上面先给了高不透明度的 --bar-bg-solid 兜底，
 *   这里再换成更透的 --bar-bg + blur。
 *   如果浏览器支持 @supports 但不支持 backdrop-filter 的模糊
 *   （安卓 WebView 常见），这条规则不会命中，仍走兜底。
 *
 * saturate(180%) 是把透出来的颜色「提纯」一下，
 * 否则糊完会发灰 —— iOS 的毛玻璃就是这个配比。
 */
@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .tabbar {
    background-color: var(--bar-bg, rgba(255, 255, 255, 0.70));
    -webkit-backdrop-filter: saturate(180%) blur(24rpx);
    backdrop-filter: saturate(180%) blur(24rpx);
  }
}

/*
 * ★ 选中滑块：全圆角的浅主题色色块 ★
 *
 * ★ 关键：滑块宽度必须**正好等于单格宽度** ★
 *   内联 style 给的是 translateX(N × 100%)，
 *   百分比相对的是滑块**自身宽度**。
 *   只有自身宽度 == 单格宽度时，位移才会精确落在每格中央；
 *   差一点就会越滑越偏（第 4 格最明显）。
 *   所以下面用 calc 从 pill 宽度和 padding 反推，不写死数字。
 *
 * ★ 视觉内缩靠 margin，不靠改 width ★
 *   想让色块比格子小一圈、露出托盘底色，
 *   用 margin: 0 6rpx 收窄**显示区域**？不行 —— margin 不会改变
 *   translateX 的百分比基准，仍按自身宽度算，所以是安全的；
 *   但更省事的做法是直接用内层 padding 表现。这里选择：
 *   宽度 == 单格宽，高度略矮（104 < 108），上下露出一点边，
 *   横向则由 border-radius: 999rpx 撑成胶囊，不与相邻格贴边。
 *
 * ★ 过渡 ★
 *   transition 写在 .tab-slider 上，位移由内联 transform 驱动，
 *   所以每次切 tab 都是从旧位置滑到新位置（0.28s 轻微回弹），
 *   而不是瞬间跳过去。
 *
 * z-index 必须低于 .tab-item，否则会盖住图标和文字。
 */
.tab-slider {
  position: absolute;
  top: 50%;
  left: 10rpx;
  /*
   * 单格宽 = (pill 宽 - 左右 padding) / 4
   * 这里保持「正好一格」，靠下面的 ::after 内缩显示区域。
   */
  width: calc((560rpx - 20rpx) / 4);
  height: 108rpx;
  margin-top: -54rpx;
  /*
   * ★ iOS 的滑动曲线 ★
   *   0.38s + cubic-bezier(0.32, 0.72, 0, 1)
   *   这是 iOS 系统动画的经典曲线（也是 Apple 自己常用的）：
   *   起步快、尾巴长、末尾几乎没有回弹但收得住。
   *   之前用的 (0.34, 1.2, 0.64, 1) 回弹太夸张，
   *   像廉价 H5，反而不像 iOS。
   */
  transition: transform 0.38s cubic-bezier(0.32, 0.72, 0, 1);
  pointer-events: none;
  z-index: 0;
  will-change: transform;
}

/*
 * ★ 显示区域比格子小一圈，形成「嵌在托盘里」的观感 ★
 *
 * 为什么用一个内层而不是直接把 width 改小：
 *   translateX 的百分比基准是滑块自身宽度，
 *   宽度一旦不是「正好一格」，第 2/3/4 格就会越滑越偏。
 *   所以外层保持一格宽（负责定位），
 *   真正的色块交给这个伪元素（负责外观）。
 *
 * ★ 内高光 ★
 *   顶部一道 1rpx 的亮线（inset shadow），
 *   模拟玻璃片的边缘反光 —— iOS 的胶囊指示器就有这一道，
 *   去掉它立刻会变成「一块扁平的色块」。
 *
 * 背景色由内联 style 通过 CSS 变量传进来（伪元素读不到父级内联样式）。
 */
.tab-slider::after {
  content: '';
  position: absolute;
  top: 10rpx;
  bottom: 10rpx;
  left: 8rpx;
  right: 8rpx;
  border-radius: 999rpx;
  background-color: var(--slider-color, transparent);
  box-shadow: var(--slider-highlight, none);
}

.tab-item {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  /* 点击反馈由文字/图标变色体现，不做缩放，避免抖动 */
}

/*
 * 图标尺寸
 * ★ 48rpx ≈ 24px ★
 *   底栏加高后图标也跟着放大，否则会显得空。
 *   原生素材是 81px 画布，缩到 48rpx 仍然清晰。
 *
 * ★ 过渡要和滑块同一条曲线 ★
 *   滑块 0.38s cubic-bezier(0.32,0.72,0,1)，
 *   图标/文字的变色也用相近的时长，
 *   三者同步进行才有「整体一起动」的 iOS 感。
 *   未选中态略微缩小并降低不透明度，
 *   选中的那个浮起来 —— iOS 就是这个轻微的层级差。
 */
.tab-icon {
  width: 48rpx;
  height: 48rpx;
  pointer-events: none;
  transition: opacity 0.3s ease, transform 0.38s cubic-bezier(0.32, 0.72, 0, 1);
  opacity: 0.82;
  transform: scale(0.94);
}

.tab-item.active .tab-icon {
  opacity: 1;
  transform: scale(1);
}

.tab-text {
  font-size: 24rpx;
  line-height: 1;
  margin-top: 8rpx;
  pointer-events: none;
  transition: color 0.3s ease;
}

/* ------------------------------------------------------ + 按钮 */

/*
 * ★ 形状不变：还是圆形 ★
 *   它是**独立的一块**，不和左边 pill 连成一条。
 *   直径与 pill 高度相同（128rpx），所以两块上下齐平。
 *
 * ★ 圆角与 pill 的统一关系 ★
 *   border-radius: 50% 时，半径 = 128 / 2 = 64rpx。
 *   pill 用 999rpx 封顶后半径同样是「高度的一半」= 64rpx。
 *   两者曲率相同，看起来才是一套的 —— 改这里的高度时，
 *   pill 的 999rpx 会自动跟着对齐，无需同步改数字。
 */
.tab-add {
  position: relative;
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 6rpx 18rpx rgba(0, 0, 0, 0.18);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  /* 独立浮块：自己吃点击 */
  pointer-events: auto;
}

.tabbar-host.pressing .tab-add,
.tab-add:active {
  transform: scale(1.06);
}

.add-icon {
  color: #ffffff;
  font-size: 64rpx;
  font-weight: 300;
  line-height: 1;
  margin-top: -4rpx;
  transition: transform 0.18s ease;
}

.add-icon.rotated {
  transform: rotate(45deg);
}

/* 长按进度环：绕着按钮画一圈，走满即打开面板 */
.add-ring {
  position: absolute;
  top: 0;
  left: 0;
  width: 128rpx;
  height: 128rpx;
  z-index: 1;
  pointer-events: none;
}

.add-ring-inner {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  -webkit-mask: radial-gradient(circle, transparent 70rpx, #000 72rpx);
  mask: radial-gradient(circle, transparent 70rpx, #000 72rpx);
}
</style>
