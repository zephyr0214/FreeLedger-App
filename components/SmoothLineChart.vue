<template>
  <view class="slc" :style="{ height: height + 'rpx' }">
    <!-- 空数据 -->
    <view v-if="!hasData" class="slc-empty">
      <text class="slc-empty-text">{{ emptyText }}</text>
    </view>

    <!-- 折线图 -->
    <view v-else class="slc-body">
      <!--
        ★ 为什么用 image 而不是直接写 SVG 标签 ★
          uni-app 的 template 里不解析 SVG 标签 ——
          它会被当成文本节点忽略，编译期不报错，运行时就是空白。
          （uni-app 不做 HTML 解析，只认 view / text / image 等内置组件。）
          App 端（Vue3）跑在 WebView 上，WebView 支持 SVG，
          所以把 SVG 拼成字符串，用 image 以 data URI 加载。
      -->
      <!--
        触摸层：盖在图上，捕捉触摸位置。

        ★ 触摸事件绑在**外层** .slc-body 上，不绑在 .slc-touch 里 ★
          绑在里面的话，触摸落在 image / 气泡这些子元素上时，
          事件不会冒泡到处理器，手指按在图上（image 铺满整个区域）
          反而没反应 —— 这就是之前「一直只显示第一个点」的原因。
          绑在外层，落在任何子元素上都能收到。

        ★ touchmove 不用 prevent ★
          图表在 scroll-view 里，prevent 会让整个图表区域都不能滚页面。
      -->
      <view
        class="slc-body"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      >
        <view class="slc-touch">
          <image
            v-if="chartSrc"
            class="slc-img"
            :src="chartSrc"
            mode="scaleToFill"
          />

          <!-- 叠加图：只画当前命中的点和辅助竖线 -->
          <image
            v-if="activeSrc"
            class="slc-img slc-img-active"
            :src="activeSrc"
            mode="scaleToFill"
          />

          <!-- 触摸提示气泡：显示该点的日期和金额 -->
          <view
            v-if="activeIndex >= 0"
            class="slc-tip"
            :style="tipStyle"
          >
            <text class="slc-tip-day">{{ activeDay }}</text>
            <text class="slc-tip-amount">{{ activeAmount }}</text>
          </view>
        </view>
      </view>

      <!-- 坐标轴标签 -->
      <view class="slc-axis">
        <text class="slc-axis-text">{{ axisFirst }}</text>
        <text v-if="axisMid" class="slc-axis-text">{{ axisMid }}</text>
        <text class="slc-axis-text">{{ axisLast }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import { ref, computed, onMounted, getCurrentInstance } from 'vue'
import {
  calcBounds, calcCoords, calcZeroY, calcLinePath, calcAreaPath,
  calcMarkers, formatChartDay, buildSvgSource, svgToDataUri, findNearestIndex
} from '@/utils/chart.js'

/**
 * 折线图（直线折线 + 触摸提示）
 *
 * 为什么用 SVG 而不是 canvas：
 *   App 端 canvas 首绘容易白屏，项目里已经踩过（统计页的甜甜圈图
 *   最后是用 conic-gradient 绕过去的）。SVG 稳定得多。
 *
 * 为什么不用 CSS Grid：App 端跑在系统 WebView，Grid 支持不可靠。
 *
 * 交互：数据点默认不显示，手指触摸时在最近的那个点上显示气泡（日期 + 金额）。
 *
 * 几何计算都在 utils/chart.js 里（纯函数，可单测）。
 */
export default {
  name: 'SmoothLineChart',
  props: {
    /** 数据点 [{ day: 'YYYY-MM-DD', total: 金额(分) }] */
    points: { type: Array, default: () => [] },
    /** 折线颜色（主题色） */
    color: { type: String, default: '#07C160' },
    /** 图表高度（rpx） */
    height: { type: Number, default: 200 },
    /** 是否画渐变填充 */
    fill: { type: Boolean, default: true },
    /** 空数据提示 */
    emptyText: { type: String, default: '数据积累中，连续记录几天就能看到趋势' },
    /** 金额格式化（传函数进来，保证与页面一致） */
    formatAmount: { type: Function, default: null }
  },
  setup(props) {
    // viewBox 坐标系：宽 300、高 100，横纵比靠 scaleToFill 拉伸
    const vbWidth = 300
    const vbHeight = 100
    const padTop = 8
    const padBottom = 6

    const opts = { width: vbWidth, height: vbHeight, padTop, padBottom }

    /** 当前触摸命中的点下标，-1 表示没有选中 */
    const activeIndex = ref(-1)

    const hasData = computed(() => props.points && props.points.length >= 2)

    const values = computed(() =>
      (props.points || []).map((p) => Number(p.total) || 0)
    )

    /** 纵轴范围（必含 0） */
    const bounds = computed(() => calcBounds(values.value))

    /** 每个点的坐标 */
    const coords = computed(() => calcCoords(props.points || [], opts))

    /** 0 值基线的 y（数据跨越 0 时才有） */
    const zeroY = computed(() => calcZeroY(bounds.value, opts))

    /** 折线路径（直线） */
    const linePath = computed(() => calcLinePath(coords.value))

    /** 填充区域路径 */
    const areaPath = computed(() =>
      calcAreaPath(coords.value, linePath.value, vbHeight)
    )

    /** 数据点标记 */
    const markers = computed(() => calcMarkers(coords.value, props.color))

    /**
     * 底层图（折线 + 填充 + 0 基线）的 data URI。
     *
     * ★ 分成两张图 ★
     *   底层图不随触摸变化，命中点画在另一张叠加图上。
     *   如果合成一张，每次触摸都要重新生成 data URI 让 image 换 src，
     *   会闪一下，而且换 src 的瞬间触摸坐标会错位（手指没动，选中的点却跳了）。
     */
    const chartSrc = computed(() => {
      const svg = buildSvgSource({
        coords: coords.value,
        linePath: linePath.value,
        areaPath: props.fill ? areaPath.value : '',
        markers: [],
        color: props.color,
        zeroY: zeroY.value,
        width: vbWidth,
        height: vbHeight,
        activeIndex: -1
      })
      return svgToDataUri(svg)
    })

    /** 叠加图：只画当前命中的那个点和辅助竖线 */
    const activeSrc = computed(() => {
      if (activeIndex.value < 0) return ''
      const svg = buildSvgSource({
        coords: coords.value,
        linePath: linePath.value,
        areaPath: '',
        markers: markers.value,
        color: props.color,
        zeroY: null,
        width: vbWidth,
        height: vbHeight,
        activeIndex: activeIndex.value,
        onlyActive: true
      })
      return svgToDataUri(svg)
    })

    /** 触摸命中的点的日期 */
    const activeDay = computed(() => {
      const p = props.points[activeIndex.value]
      if (!p) return ''
      const parts = String(p.day || '').split('-')
      if (parts.length < 3) return p.day
      return `${Number(parts[1])}/${Number(parts[2])}`
    })

    /** 触摸命中的点的金额 */
    const activeAmount = computed(() => {
      const p = props.points[activeIndex.value]
      if (!p) return ''
      const cents = Number(p.total) || 0
      if (props.formatAmount) return props.formatAmount(cents)
      return (cents / 100).toFixed(2)
    })

    /** 气泡的位置：跟着命中点走，贴边时收回来 */
    const tipStyle = computed(() => {
      const c = coords.value
      const i = activeIndex.value
      if (i < 0 || !c[i]) return {}
      // 百分比位置（相对图表容器）
      const leftPct = (c[i].x / vbWidth) * 100
      const topPct = (c[i].y / vbHeight) * 100
      // 左右贴边时改对齐方式，避免气泡被裁掉
      const align = leftPct < 20 ? 'left: 0' : (leftPct > 80 ? 'right: 0' : `left: ${leftPct}%`)
      return {
        [align.split(':')[0]]: align.split(':')[1].trim(),
        top: `${Math.max(topPct - 6, 0)}%`
      }
    })

    /* ------------------------------------------------- 触摸交互 */

    /**
     * 图表容器的位置信息。
     * 用 uni.createSelectorQuery 量一次并缓存 —— 异步查询在 touch 回调里
     * 等它回来会慢一拍，指针跟手会不准。
     * 首次触摸前先量好（onMounted + 首次 touchstart 兜底量一次）。
     *
     * ★ 量的是 .slc-touch（真正画图的那块）★
     *   触摸事件绑在 .slc-body 上，坐标是相对 .slc-body 的，
     *   而图的横向范围是 .slc-touch 的，两者宽度一致，
     *   但 left 可能有细微差别 —— 两个都算一遍，取落在范围内的。
     */
    const chartRect = ref(null)

    function measureChart() {
      try {
        const query = uni.createSelectorQuery().in(getCurrentInstance().proxy)
        query.select('.slc-touch').boundingClientRect((r) => {
          if (r && r.width) chartRect.value = { left: r.left, width: r.width }
        }).exec()
      } catch (e) {
        // 量不到就用估算值
      }
    }

    /**
     * 触摸位置 -> viewBox 坐标
     *
     * touch.x 的含义在不同平台不一样：
     *   - 相对**目标元素**（App 端大多数情况）
     *   - 相对**页面**（部分平台 / 滚动后）
     * 两种都算一遍，取落在图表范围内的那个。
     */
    function touchToChartX(touch) {
      const c = coords.value
      if (!c || c.length === 0) return 0

      const rect = chartRect.value
      const winWidth = (() => {
        try { return uni.getSystemInfoSync().windowWidth || 375 } catch (e) { return 375 }
      })()

      const candidates = []
      if (rect && rect.width) {
        // 相对元素
        candidates.push((touch.x / rect.width) * vbWidth)
        // 相对页面
        candidates.push(((touch.x - rect.left) / rect.width) * vbWidth)
      } else {
        // 量不到容器：按「窗口宽度减去页面左右各 32rpx 的内边距」估算
        const padPx = (32 / 750) * winWidth * 2
        const chartWidth = Math.max(winWidth - padPx, 1)
        candidates.push((touch.x / chartWidth) * vbWidth)
      }

      // 选一个落在图表范围内的
      for (const x of candidates) {
        if (x >= 0 && x <= vbWidth) return x
      }
      // 都不在范围内就夹一下
      return Math.max(0, Math.min(vbWidth, candidates[0]))
    }

    function onTouchStart(e) {
      const t = e.touches && e.touches[0]
      if (!t) return
      // 第一次触摸时容器可能还没量过
      if (!chartRect.value) measureChart()
      activeIndex.value = findNearestIndex(touchToChartX(t), coords.value)
    }

    function onTouchMove(e) {
      const t = e.touches && e.touches[0]
      if (!t) return
      activeIndex.value = findNearestIndex(touchToChartX(t), coords.value)
    }

    function onTouchEnd() {
      // 松手后保留选中状态（用户要求「触碰上去会显示日期和金额」）
    }

    // 挂载后量一次容器尺寸（触摸换算要用）
    onMounted(() => {
      measureChart()
    })

    const axisFirst = computed(() => {
      const c = coords.value
      return c.length ? formatChartDay(c[0].day) : ''
    })
    const axisLast = computed(() => {
      const c = coords.value
      return c.length ? formatChartDay(c[c.length - 1].day) : ''
    })
    const axisMid = computed(() => {
      const c = coords.value
      if (c.length < 3) return ''
      return formatChartDay(c[Math.floor(c.length / 2)].day)
    })

    return {
      vbWidth, vbHeight, hasData, bounds, coords, zeroY,
      linePath, areaPath, markers, chartSrc, activeSrc,
      activeIndex, activeDay, activeAmount, tipStyle,
      onTouchStart, onTouchMove, onTouchEnd,
      axisFirst, axisMid, axisLast
    }
  }
}
</script>

<style scoped>
.slc {
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.slc-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 触摸层：盖在图上，捕捉触摸位置 */
.slc-touch {
  position: relative;
  flex: 1;
  min-height: 0;
}

/* 图表本体：用 <image> 加载 SVG 的 data URI */
.slc-img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  /* ★ 不接收触摸 ★
     image 铺满整个图表区域，会把 touch 事件吃掉，
     导致手指按在图上没反应。触摸交给外层 .slc-body 处理。 */
  pointer-events: none;
}

/* 叠加图：命中点和辅助线，盖在底图上面 */
.slc-img-active {
  z-index: 1;
}

/* 触摸提示气泡 */
.slc-tip {
  position: absolute;
  transform: translateY(-100%);
  background-color: var(--app-card-2);
  border-radius: 10rpx;
  padding: 8rpx 16rpx;
  display: flex;
  align-items: center;
  gap: 12rpx;
  white-space: nowrap;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.16);
  z-index: 2;
}

.slc-tip-day {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.slc-tip-amount {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--app-text);
}

/* 坐标轴 */
.slc-axis {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8rpx;
}

.slc-axis-text {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* 空状态 */
.slc-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.slc-empty-text {
  font-size: 24rpx;
  color: var(--app-text-3);
}
</style>
