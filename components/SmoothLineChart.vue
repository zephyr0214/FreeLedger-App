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
      <image
        v-if="chartSrc"
        class="slc-img"
        :src="chartSrc"
        mode="scaleToFill"
      />

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
  calcMarkers, formatChartDay, buildSvgSource, svgToDataUri
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
    // viewBox 坐标系：宽 300、高 100，横纵比靠 scaleToFill 拉伸
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

    /**
     * 整张图的 data URI。
     * <image> 只能加载位图或 data URI，
     * 但 data:image/svg+xml 在 App 端（WebView）是可以渲染的。
     */
    const chartSrc = computed(() => {
      const svg = buildSvgSource({
        coords: coords.value,
        linePath: linePath.value,
        areaPath: props.fill ? areaPath.value : '',
        markers: markers.value,
        color: props.color,
        zeroY: zeroY.value,
        width: vbWidth,
        height: vbHeight
      })
      return svgToDataUri(svg)
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
      linePath, areaPath, markers, chartSrc,
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

/* 图表本体：用 <image> 加载 SVG 的 data URI */
.slc-img {
  width: 100%;
  flex: 1;
  min-height: 0;
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
