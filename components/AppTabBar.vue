<template>
  <view
    v-if="!hidden"
    class="tabbar-host"
    :class="{ pressing }"
    :style="hostStyle"
  >
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
import { ref, computed, watch, onMounted } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { useUiStore } from '@/stores/ui.js'
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
    holdEnabled: { type: Boolean, default: true },
    /**
     * 是否隐藏整个底栏（含 + 按钮）。
     *
     * ★ 什么时候要隐藏 ★
     *   记账面板（TxnPanel）、速记输入条（QuickAddBar）是全屏弹层，
     *   底栏留在下面会「露一角」在遮罩边缘，很碍眼。
     *   用户明确要求这两个场景把底栏一起收起来。
     *
     * ★ 和「永驻」不冲突 ★
     *   「永驻」指的是它不会因为滚动、滑动而消失；
     *   被全屏弹层盖住时收起来是正常的层级关系。
     */
    hidden: { type: Boolean, default: false }
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
     * ★ 跨页面切换时动画为什么难做 ★
     *   4 个 tab 是不同页面，切 tab 时本组件整个重新挂载。
     *   如果一挂载就渲染在目标位置，transform 没有过变化，
     *   CSS transition 就不会触发 —— 看到的就是「没有滑块」。
     *
     * ★ 上一版为什么只生效一次 ★
     *   两段式位移依赖 uiStore.lastTabIndex，
     *   但那个值只在 onMounted 里更新 —— 等新页面挂载后才写，
     *   那时已经晚了：新页面读到的「上次位置」就是它自己。
     *   于是除第一次外，起点 == 终点，位移为 0，动画自然没有。
     *
     * ★ 现在的做法：点击时就写目标位 ★
     *   onTabClick 里先把「要去第几格」记到 store（此时旧页面还在），
     *   新页面挂载时就能读到它，从那个位置滑到自己的位置。
     *   这样每一级切换都有一段真实位移。
     */
    const uiStore = useUiStore()

    /**
     * 滑块当前渲染用的序号。
     *
     * 初始值 = 上一页留下的位置（通常就是「用户刚点的那一格」），
     * 于是新页面上滑块会**从上一页的位置滑到本页位置**。
     * 若没有历史（首次进入），直接落在本页，不做动画。
     */
    const sliderIndex = ref(
      uiStore.lastTabIndex >= 0 ? uiStore.lastTabIndex : currentIndex.value
    )

    onMounted(() => {
      // 两帧之后再切到本页位置：
      //   第一帧用「旧位置」渲染出去（用户看到滑块在上一页那格），
      //   第二帧改成新位置，transition 才有 A→B 的变化可播。
      // 用 requestAnimationFrame 而不是 setTimeout(20)：
      //   前者紧跟渲染节奏，后者在慢机型上可能和首帧撞在一起。
      const raf = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn) => setTimeout(fn, 16)

      raf(() => {
        raf(() => {
          sliderIndex.value = currentIndex.value
        })
      })
    })

    // ★ 同一页面内 current 变化时也要跟着动 ★
    //   目前每个页面 current 是写死的，这层是为将来页内切换留的。
    watch(currentIndex, (i) => {
      sliderIndex.value = i
    })

    const sliderStyle = computed(() => {
      const dark = settingStore.isDark
      return {
        transform: `translateX(${sliderIndex.value * 100}%)`,
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
     *
     * ★ 点的时候就记下目标序号 ★
     *   这是「每次切换都有滑动动画」的关键：
     *   此刻当前页面还活着，把「要去第几格」写进 store，
     *   新页面挂载时读到的 lastTabIndex 就是这一格，
     *   于是滑块会从这一格滑到它自己的位置。
     *   若等新页面挂载后才写，读到的就是它自己，位移为 0 —— 没动画。
     */
    function onTabClick(item) {
      if (item.active) return
      const idx = TABS.findIndex((t) => t.name === item.name)
      if (idx >= 0) uiStore.setLastTabIndex(idx)
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

    /**
     * 键盘高度。
     *
     * ★ 为什么需要它 ★
     *   pages.json 里 softinputMode 是 adjustResize：
     *   键盘弹出时 webview 会**整体收缩**，高度变小。
     *   底栏是 position: fixed + bottom: 0，
     *   它贴在 webview 底部 —— webview 一收缩，底栏就被顶上去了，
     *   表现就是「tabbar 和 + 跟着键盘上移」，看着像粘在键盘上。
     *
     * ★ 平时不会看到这个问题 ★
     *   短按/长按打开弹层时，底栏已经被 hidden 收起来了
     *   （见 pages/index/index.vue 的 :hidden 绑定）。
     *   但万一某个场景没藏到（比如将来的页内输入框），
     *   这里用「键盘高度反向偏移」兜住：把底栏往下推回去，
     *   让它待在屏幕底部原地不动。
     *
     * 注意不要和 QuickAddBar 的定位逻辑搞混：
     *   输入条是**主动**贴到键盘上方（它要跟着键盘走）；
     *   底栏是**保持原位**（它不应该跟着键盘走）。
     */
    const keyboardHeight = ref(0)

    const hostStyle = computed(() => {
      // 键盘弹出时往下顶回去，抵消 webview 收缩带来的上移
      return keyboardHeight.value > 0
        ? { transform: `translateY(${keyboardHeight.value}px)` }
        : null
    })

    function bindKeyboard() {
      try {
        if (typeof uni.onKeyboardHeightChange === 'function') {
          uni.onKeyboardHeightChange((res) => {
            keyboardHeight.value = res.height || 0
          })
        }
      } catch (e) {}
    }

    onMounted(() => {
      bindKeyboard()
    })

    return {
      items, primaryColor, fontColor, barStyle, ringStyle, sliderStyle, pressing,
      hostStyle,
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
 * ★ 选中滑块：圆角矩形（不是全圆角胶囊），铺满整格 ★
 *
 * ★ 为什么不用 999rpx 全圆角 ★
 *   999rpx 会让滑块两端变成**完整的半圆**（半径 = 高度一半 = 58rpx）。
 *   但它左右只有 10rpx 的余量，半圆一画出来就像被狠狠削掉两块，
 *   而且和外面那颗胶囊（半径 64rpx，但它的轮廓很长、弧度很缓）
 *   放在一起，两者的「弧度走势」完全不同 —— 所以会显得怪。
 *   现在改成和胶囊同量级的圆角（44rpx）：两端是缓和的圆角矩形，
 *   既能看出是「一块圆角块」，又不会在格子边上出现突兀的半圆切口。
 *
 * ★ 宽度必须**正好等于单格宽度** ★
 *   内联 style 给的是 translateX(N × 100%)，
 *   百分比相对的是滑块**自身宽度**。
 *   只有自身宽度 == 单格宽度时，位移才会精确落在每格上；
 *   差一点就会越滑越偏（第 4 格最明显）。
 *   所以用 calc 从 pill 宽度和 padding 反推，不写死数字。
 *
 * ★ 高度铺满，只留 6rpx 呼吸 ★
 *   116rpx（128 格高 - 上下各 6rpx），饱满但不顶到边。
 *
 * ★ 用 transform 位移 + transition ★
 *   位移由内联 transform 驱动，切线曲线是 iOS 的
 *   cubic-bezier(0.32, 0.72, 0, 1)：起步快、收尾长、几乎不回弹。
 *
 * z-index 必须低于 .tab-item，否则会盖住图标和文字。
 */
.tab-slider {
  position: absolute;
  top: 50%;
  left: 10rpx;
  /* 单格宽 = (pill 宽 - 左右 padding) / 4 */
  width: calc((560rpx - 20rpx) / 4);
  /* 高度几乎铺满整格，只留 6rpx 呼吸 */
  height: 116rpx;
  margin-top: -58rpx;
  /*
   * 圆角与胶囊同量级（胶囊高 128 用 999rpx 时视觉半径约 64rpx，
   * 但滑块矮一点、窄一点，取 44rpx 看起来才是「同一套弧度」）。
   */
  border-radius: 44rpx;
  background-color: var(--slider-color, transparent);
  box-shadow: var(--slider-highlight, none);
  /*
   * ★ iOS 的滑动曲线 ★
   *   0.38s + cubic-bezier(0.32, 0.72, 0, 1)
   *   这是 iOS 系统动画的经典曲线（也是 Apple 自己常用的）：
   *   起步快、尾巴长、末尾几乎没有回弹但收得住。
   */
  transition: transform 0.38s cubic-bezier(0.32, 0.72, 0, 1);
  pointer-events: none;
  z-index: 0;
  will-change: transform;
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
