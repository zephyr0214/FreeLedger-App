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
    /**
     * 交易类型：expense / income / transfer
     *
     * ★ 传了这个就不用自己算正负号了 ★
     *   收入前面自动加 +，支出前面自动加 -，
     *   转账不加符号。
     *   之前各页面自己用 :cents="txn.type === 'expense' ? -txn.amount_cents : ..." ，
     *   再配 :sign="false"，结果收支都看不到符号，还容易写错。
     */
    type: { type: String, default: '' },
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

    /**
     * 实际参与展示的金额
     *
     * 传了 type 时由 type 决定正负：
     *   支出 -> 负数（前面显示 -）
     *   收入 -> 正数（前面显示 +）
     *   转账 -> 原值（不加符号）
     */
    const signedCents = computed(() => {
      const n = Number(props.cents) || 0
      if (props.type === 'expense') return -Math.abs(n)
      if (props.type === 'income') return Math.abs(n)
      return n
    })

    /** 是否显示正负号 */
    const showSign = computed(() => {
      if (props.type) return props.type === 'expense' || props.type === 'income'
      return props.sign
    })

    const display = computed(() => {
      if (masked.value) return '****'
      return formatCents(signedCents.value, {
        sign: showSign.value,
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
