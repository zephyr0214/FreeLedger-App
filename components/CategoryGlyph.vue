<template>
  <!--
    特殊符号（转账 ⇄ 等）仍然用文字：
    它们不是分类，没有 OpenMoji 图标可对应。
  -->
  <text v-if="symbol" class="cat-glyph-symbol" :style="symbolStyle">{{ symbol }}</text>
  <image
    v-else
    class="cat-glyph-img"
    :src="src"
    :style="imgStyle"
    mode="aspectFit"
  />
</template>

<script>
/**
 * 分类图标（OpenMoji）
 *
 * 用法：
 *   <CategoryGlyph :icon="cat.icon" :name="cat.name" size="44rpx" />
 *   <CategoryGlyph symbol="⇄" size="30rpx" />   // 转账等非分类图标
 *
 * ★ 为什么要抽组件 ★
 *   分类图标在 11 个页面 / 组件里出现，旧的写法是
 *   `iconEmoji(cat.icon)` 返回一个 emoji 字符塞进 <text>。
 *   换成 OpenMoji 后要统一处理：
 *     1. 旧 key → 码点（历史数据 / 老备份）
 *     2. 没图标 → 按分类名猜
 *     3. 码点 → /static/openmoji/<code>.svg
 *   这套解析只写一份，显示处只给 icon / name。
 *
 * ★ 尺寸单位 ★
 *   size 传字符串时原样使用（'44rpx' / '20px'）；
 *   传数字时按 rpx 处理（项目里的尺寸基本都是 rpx）。
 */
import { computed } from 'vue'
import { categoryIconSrc } from '@/utils/openmoji.js'

export default {
  name: 'CategoryGlyph',
  props: {
    /** 分类 icon 字段（OpenMoji 码点或旧 key） */
    icon: { type: String, default: '' },
    /** 分类名（icon 为空时按名字猜） */
    name: { type: String, default: '' },
    /** 边长 */
    size: { type: [String, Number], default: '40rpx' },
    /** 非分类图标（转账 ⇄ / 未知 ❔）用文字渲染 */
    symbol: { type: String, default: '' },
    /** 文字符号的颜色（OpenMoji 图片本身是多色的，不受它影响） */
    color: { type: String, default: '' }
  },
  setup(props) {
    const sizeText = computed(() =>
      typeof props.size === 'number' ? `${props.size}rpx` : props.size
    )

    const src = computed(() => categoryIconSrc(props.icon, props.name))

    const imgStyle = computed(() => ({
      width: sizeText.value,
      height: sizeText.value
    }))

    const symbolStyle = computed(() => ({
      fontSize: sizeText.value,
      lineHeight: 1,
      color: props.color || undefined
    }))

    return { src, imgStyle, symbolStyle }
  }
}
</script>

<style scoped>
.cat-glyph-img {
  /* 图标不吃触摸事件，避免挡住外层整行的点击 */
  pointer-events: none;
  flex-shrink: 0;
  display: block;
}

.cat-glyph-symbol {
  /* 颜色继承外层（转账用 --app-text-2，未知用分类色） */
  flex-shrink: 0;
}
</style>
