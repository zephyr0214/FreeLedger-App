<template>
  <view class="txn-icon" :style="boxStyle">
    <text v-if="symbol" class="txn-icon-symbol" :style="symbolStyle">{{ symbol }}</text>
    <CategoryGlyph v-else :icon="icon" :name="name" :size="metrics.icon + 'rpx'" />
  </view>
</template>

<script>
/**
 * 交易流水左侧图标
 *
 * ★ 统一读设置 ★
 *   - txnIconSize：五档尺寸（极小…极大），默认「大」(80rpx)
 *   - txnIconShowBg：是否显示分类浅色圆底，默认关
 *   - emojiStyle：图标样式（system / noto / twemoji / openmoji）
 *   首页、全部交易、账户/分类/标签/预算/周期详情、借入借出、报销页
 *   全部用这一个组件，改设置后所有流水同步变化。
 *
 * ★ 转账用符号 ★
 *   传 symbol='⇄' 时不渲染分类图片，直接显示符号；
 *   尺寸跟随当前档位（图标 80%），颜色用分类色 / 次要色。
 */
import { computed } from 'vue'
import CategoryGlyph from '@/components/CategoryGlyph.vue'
import { useSettingStore } from '@/stores/setting.js'

export default {
  name: 'TxnIcon',
  components: { CategoryGlyph },
  props: {
    /** 分类 icon（码点或旧 key） */
    icon: { type: String, default: '' },
    /** 分类名（icon 为空时按名字猜） */
    name: { type: String, default: '' },
    /** 分类颜色（背景色开关打开时用来拼浅色圆底） */
    color: { type: String, default: '' },
    /** 非分类图标（转账 ⇄） */
    symbol: { type: String, default: '' }
  },
  setup(props) {
    const settingStore = useSettingStore()

    const metrics = computed(() => settingStore.txnIconMetrics)
    const showBg = computed(() => settingStore.txnIconShowBg)

    const boxStyle = computed(() => ({
      width: `${metrics.value.box}rpx`,
      height: `${metrics.value.box}rpx`,
      backgroundColor: showBg.value
        ? (props.color || '#969799') + '22'
        : 'transparent'
    }))

    const symbolStyle = computed(() => ({
      fontSize: `${Math.round(metrics.value.icon * 0.8)}rpx`,
      lineHeight: 1,
      color: props.color || 'var(--app-text-2)'
    }))

    return { metrics, boxStyle, symbolStyle }
  }
}
</script>

<style scoped>
.txn-icon {
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  /* 图标不吃触摸事件，点击仍然落在整行上 */
  pointer-events: none;
  transition: width 0.15s, height 0.15s, background-color 0.15s;
}

.txn-icon-symbol {
  text-align: center;
  font-weight: 500;
}
</style>
