<template>
  <text :class="classes" :style="styleObj">{{ display }}</text>
</template>

<script>
import { computed } from 'vue'
import { formatCents } from '@/utils/money.js'
import { useSettingStore } from '@/stores/setting.js'

export default {
  name: 'MoneyText',
  props: {
    /** 金额（分） */
    cents: { type: Number, default: 0 },
    /** 是否显示正负号 */
    sign: { type: Boolean, default: false },
    /** 是否显示货币符号 */
    symbol: { type: Boolean, default: true },
    /** 是否千分位 */
    grouping: { type: Boolean, default: true },
    /** 整数元时隐藏小数 */
    hideZeroDecimals: { type: Boolean, default: false },
    /** 字号，单位 rpx */
    size: { type: [Number, String], default: 32 },
    /** 字重 */
    weight: { type: [Number, String], default: 400 },
    /** 颜色：auto 按正负自动着色 */
    color: { type: String, default: 'auto' },
    /** 是否强制脱敏（隐私模式） */
    forceMask: { type: Boolean, default: false }
  },
  setup(props) {
    const settingStore = useSettingStore()

    const masked = computed(() => {
      return props.forceMask || settingStore.privacyMode
    })

    const display = computed(() => {
      if (masked.value) return '****'
      return formatCents(props.cents, {
        sign: props.sign,
        symbol: props.symbol ? settingStore.currencySymbol : '',
        grouping: props.grouping,
        hideZeroDecimals: props.hideZeroDecimals
      })
    })

    const classes = computed(() => {
      const list = ['money-text']
      if (props.color === 'auto') {
        if (props.cents > 0) list.push('is-positive')
        else if (props.cents < 0) list.push('is-negative')
      }
      return list
    })

    const styleObj = computed(() => {
      const s = {
        fontSize: `${props.size}rpx`,
        fontWeight: String(props.weight)
      }
      if (props.color !== 'auto' && !masked.value) {
        s.color = props.color
      }
      return s
    })

    return { display, classes, styleObj }
  }
}
</script>

<style scoped>
.money-text {
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.5rpx;
  line-height: 1.2;
}

.is-positive {
  color: var(--app-success, #07c160);
}

.is-negative {
  color: var(--app-danger, #ee0a24);
}
</style>
