<template>
  <image
    class="line-icon"
    :src="src"
    :style="styleObj"
    mode="aspectFit"
  />
</template>

<script>
import { computed } from 'vue'
import { lineIconDataUri, isFallbackIcon } from '@/utils/lineIcons.js'

/**
 * 线性描边图标
 *
 * 用法：
 *   <LineIcon name="category" :size="32" :color="primaryColor" />
 *
 * ★ 为什么用 <image> 加载 SVG ★
 *   uni-app 的 template 不做 HTML 解析，只认 view / text / image 等内置组件。
 *   直接写 <svg>...</svg> 会被当成文本节点忽略 ——
 *   编译期不报错，运行时就是一片空白。
 *   （项目里踩过这个坑，scripts/check-layout.mjs 有一条规则专门拦它。）
 *
 *   所以把 SVG 拼成字符串，用 <image> 以 data URI 加载。
 *   App 端跑在系统 WebView 上，WebView 支持 SVG。
 *
 * ★ 颜色必须传真实色值 ★
 *   SVG 被当作独立图片文档加载，拿不到外层元素的 color，
 *   currentColor 在这里不生效（会被兜底成中性灰）。
 */
export default {
  name: 'LineIcon',
  props: {
    /** 图标名（utils/lineIcons.js 里的 key，未知 key 自动兜底成圆点） */
    name: { type: String, default: '' },
    /** 边长，单位 px（默认 24） */
    size: { type: [Number, String], default: 24 },
    /** 描边颜色（主题色等真实色值） */
    color: { type: String, default: 'currentColor' },
    /** 描边宽度 */
    strokeWidth: { type: [Number, String], default: 1.8 }
  },
  setup(props) {
    /** 图标的 data URI */
    const src = computed(() => lineIconDataUri(props.name, {
      size: Number(props.size) || 24,
      color: props.color,
      strokeWidth: Number(props.strokeWidth) || 1.8
    }))

    /** 外框尺寸：跟着 size 走，避免图标被拉伸变形 */
    const styleObj = computed(() => {
      const s = Number(props.size) || 24
      return {
        width: `${s}px`,
        height: `${s}px`
      }
    })

    /**
     * 当前图标是不是兜底图标（key 拼错了）。
     * 外部可以问这个，避免「图标不显示」时不知道是 key 写错了。
     */
    const isFallback = computed(() => isFallbackIcon(props.name))

    return { src, styleObj, isFallback }
  }
}
</script>

<style scoped>
.line-icon {
  /* 图标不吃触摸事件，避免挡住外层的点击 */
  pointer-events: none;
  flex-shrink: 0;
}
</style>
