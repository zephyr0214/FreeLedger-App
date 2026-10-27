<template>
  <view class="slc" :style="{ height: height + 'rpx' }">
    <!-- 空数据 -->
    <view v-if="!hasData" class="slc-empty">
      <text class="slc-empty-text">{{ emptyText }}</text>
    </view>

    <!-- 折线图 -->
    <view v-else class="slc-body">
      <svg
        class="slc-svg"
        :viewBox="'0 0 ' + vbWidth + ' ' + vbHeight"
        :width="vbWidth"
        :height="vbHeight"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" :stop-color="color" stop-opacity="0.22" />
            <stop offset="100%" :stop-color="color" stop-opacity="0" />
          </linearGradient>
        </defs>

        <!-- 0 值基线（数据跨越 0 时才画） -->
        <line
          v-if="zeroY !== null"
          :x1="0"
          :y1="zeroY"
          :x2="vbWidth"
          :y2="zeroY"
          class="slc-zero-line"
        />

        <!-- 渐变填充 -->
        <path v-if="fill" :d="areaPath" :fill="'url(#' + gradientId + ')'" />

        <!-- 折线 -->
        <path :d="linePath" fill="none" :stroke="color" class="slc-line" />

        <!-- 数据点 -->
        <circle
          v-for="(p, i) in markers"
          :key="i"
          :cx="p.x"
          :cy="p.y"
          :r="p.r"
          :fill="p.fill"
          :stroke="color"
          class="slc-dot"
        />
      </svg>

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
import { computed } from 'vue'
import {
  calcBounds, calcCoords, calcZeroY, calcLinePath, calcAreaPath,
  calcMarkers, formatChartDay
} from '@/utils/chart.js'

/**
 * 光滑折线图（SVG path + 贝塞尔曲线）
 *
 * 为什么用 SVG 而不是 canvas：
 *   App 端 canvas 首绘容易白屏，项目里已经踩过（统计页的甜甜圈图
 *   最后是用 conic-gradient 绕过去的）。SVG 稳定得多。
 *
 * 为什么不用 CSS Grid：App 端跑在系统 WebView，Grid 支持不可靠。
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
    emptyText: { type: String, default: '数据积累中，连续记录几天就能看到趋势' }
  },
  setup(props) {
    // 渐变 id 要唯一，否则多个图表会共用同一个 defs
    const gradientId = `slc-grad-${Math.random().toString(36).slice(2, 10)}`

    // viewBox 坐标系：宽 300、高 100，横纵比靠 preserveAspectRatio="none" 拉伸
    const vbWidth = 300
    const vbHeight = 100
    const padTop = 8
    const padBottom = 6

    const opts = { width: vbWidth, height: vbHeight, padTop, padBottom }

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

    /** 平滑曲线路径 */
    const linePath = computed(() => calcLinePath(coords.value))

    /** 填充区域路径 */
    const areaPath = computed(() =>
      calcAreaPath(coords.value, linePath.value, vbHeight)
    )

    /** 数据点标记 */
    const markers = computed(() => calcMarkers(coords.value, props.color))

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
      gradientId, vbWidth, vbHeight, hasData, bounds, coords, zeroY,
      linePath, areaPath, markers, axisFirst, axisMid, axisLast
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

.slc-svg {
  width: 100%;
  flex: 1;
  min-height: 0;
}

.slc-line {
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  /* 关掉默认的矢量缩放，线条粗细保持一致 */
  vector-effect: non-scaling-stroke;
}

.slc-dot {
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.slc-zero-line {
  stroke: var(--app-line, #ebedf0);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  vector-effect: non-scaling-stroke;
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
