<template>
  <view class="cat-glyph" :style="boxStyle">
    <!-- 特殊符号（转账 ⇄ 等）仍然用文字：它们不是分类 -->
    <text v-if="symbol" class="cat-glyph-symbol" :style="symbolStyle">{{ symbol }}</text>

    <template v-else>
      <!--
        图片加载中 / 加载失败时的兜底：系统 emoji。
        加载成功后隐藏，避免和图片叠在一起。
      -->
      <text v-if="!loaded" class="cat-glyph-emoji" :style="emojiStyle">{{ char }}</text>
      <image
        v-if="!failed && src"
        class="cat-glyph-img"
        :src="src"
        mode="aspectFit"
        @load="onLoad"
        @error="onError"
      />
    </template>
  </view>
</template>

<script>
/**
 * 分类图标（Noto / Twemoji / OpenMoji 三样式）
 *
 * 用法：
 *   <CategoryGlyph :icon="cat.icon" :name="cat.name" size="80rpx" />
 *   <CategoryGlyph :icon="row.hex" size="68rpx" :remote-size="60" />
 *   <CategoryGlyph symbol="⇄" size="64rpx" />
 *
 * ★ 图片是联网的 ★
 *   utils/emoji.js 按当前样式拼 CDN 地址，
 *   图片加载成功前 / 失败后显示系统 emoji 字符（emojiChar），
 *   所以断网时分类图标退化成系统 emoji，不会出现空白或裂图。
 *
 * ★ 为什么抽组件 ★
 *   分类图标在首页、流水、详情、面板、选择页里出现，
 *   旧 key → 码点、按名字猜、联网地址、失败兜底这一套只写一份。
 *
 * ★ 尺寸单位 ★
 *   size 传字符串时原样使用（'44rpx' / '20px'）；
 *   传数字时按 rpx 处理。remote-size 只影响请求 60 还是 120 的图。
 */
import { ref, computed, watch } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { categoryIconCode, categoryIconSrc, emojiChar } from '@/utils/emoji.js'

export default {
  name: 'CategoryGlyph',
  props: {
    /** 分类 icon 字段（Unicode 码点或旧 key） */
    icon: { type: String, default: '' },
    /** 分类名（icon 为空时按名字猜） */
    name: { type: String, default: '' },
    /** 显示边长 */
    size: { type: [String, Number], default: '40rpx' },
    /** 请求的远程图片尺寸：60（缩略图）或 120（列表 / 详情） */
    remoteSize: { type: Number, default: 120 },
    /** 非分类图标（转账 ⇄ / 未知 ❔）用文字渲染 */
    symbol: { type: String, default: '' },
    /** 文字符号的颜色（图片本身是彩色的，不受它影响） */
    color: { type: String, default: '' }
  },
  setup(props) {
    const settingStore = useSettingStore()

    /** 图片是否已成功加载 */
    const loaded = ref(false)
    /** 图片是否加载失败 */
    const failed = ref(false)

    const sizeText = computed(() =>
      typeof props.size === 'number' ? `${props.size}rpx` : props.size
    )

    const boxStyle = computed(() => ({
      width: sizeText.value,
      height: sizeText.value
    }))

    const code = computed(() => categoryIconCode(props.icon, props.name))
    const style = computed(() => settingStore.emojiStyle)
    const src = computed(() => categoryIconSrc(props.icon, props.name, props.remoteSize, style.value))
    const char = computed(() => emojiChar(code.value))

    const emojiStyle = computed(() => ({
      fontSize: sizeText.value,
      lineHeight: 1
    }))

    const symbolStyle = computed(() => ({
      fontSize: sizeText.value,
      lineHeight: 1,
      color: props.color || undefined
    }))

    function onLoad() {
      loaded.value = true
      failed.value = false
    }

    function onError() {
      failed.value = true
      loaded.value = false
    }

    // 换图标 / 换样式 / 换图片尺寸时重新尝试加载
    watch([code, style, () => props.remoteSize], () => {
      loaded.value = false
      failed.value = false
    })

    return {
      sizeText, boxStyle, src, char, emojiStyle, symbolStyle,
      loaded, failed, onLoad, onError
    }
  }
}
</script>

<style scoped>
.cat-glyph {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 图标不吃触摸事件，避免挡住外层整行的点击 */
  pointer-events: none;
}

.cat-glyph-img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.cat-glyph-emoji,
.cat-glyph-symbol {
  text-align: center;
}

.cat-glyph-symbol {
  /* 颜色继承外层（转账用 --app-text-2，未知用分类色） */
  flex-shrink: 0;
}
</style>
