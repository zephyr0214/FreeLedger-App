<template>
  <image
    class="account-icon"
    :src="src"
    :style="styleObj"
    mode="aspectFit"
  />
</template>

<script>
import { computed } from 'vue'
import { accountIconDataUri, isBrandIcon } from '@/utils/accountIcons.js'

/**
 * 账户图标
 *
 * 用法：
 *   <AccountIcon name="wechat" :size="24" :color="primaryColor" />
 *
 * ★ 和 LineIcon 的区别 ★
 *   LineIcon      纯描边的线性图标（菜单、设置页那些）
 *   AccountIcon   账户图标，**同时支持**：
 *                    - 品牌标识（微信/支付宝/Visa…）→ 官方填充矢量
 *                    - 通用语义（现金/银行/储蓄…）  → 线性描边
 *   两类放在同一个圆角方框里，靠方框提供统一的视觉边界。
 *
 * ★ 为什么用 <image> 加载 SVG ★
 *   uni-app 的 template 不做 HTML 解析，只认 view / text / image 等内置组件。
 *   直接写 <svg>...</svg> 会被当成文本节点忽略 ——
 *   编译期不报错，运行时就是一片空白。
 *   （项目里踩过这个坑，scripts/check-layout.mjs 有一条规则专门拦它。）
 *
 * ★ 颜色必须传真实色值 ★
 *   SVG 被当作独立图片文档加载，拿不到外层元素的 color，
 *   currentColor 和 var(--app-x) 在这里都不生效。
 */
export default {
  name: 'AccountIcon',
  props: {
    /** 图标名（utils/accountIcons.js 的 ACCOUNT_ICONS 里的 key） */
    name: { type: String, default: '' },
    /** 边长，单位 px（默认 24） */
    size: { type: [Number, String], default: 24 },
    /** 颜色（主题色等真实色值） */
    color: { type: String, default: 'currentColor' }
  },
  setup(props) {
    /** 图标的 data URI */
    const src = computed(() =>
      accountIconDataUri(props.name, {
        size: Number(props.size) || 24,
        color: props.color
      })
    )

    /** 外框尺寸：跟着 size 走，避免图标被拉伸变形 */
    const styleObj = computed(() => {
      const s = Number(props.size) || 24
      return {
        width: `${s}px`,
        height: `${s}px`
      }
    })

    /** 是不是品牌图标（填充）—— 外部可能要区别对待 */
    const isBrand = computed(() => isBrandIcon(props.name))

    return { src, styleObj, isBrand }
  }
}
</script>

<style scoped>
.account-icon {
  /* 图标不吃触摸事件，避免挡住外层的点击 */
  pointer-events: none;
  flex-shrink: 0;
}
</style>
