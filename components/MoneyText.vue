<template>
  <text :class="classes" :style="styleObj">{{ display }}</text>
</template>

<script>
import { computed } from 'vue'
import { formatCents } from '@/utils/money.js'
import { useSettingStore } from '@/stores/setting.js'

/**
 * 金额文本 —— 全 App 唯一的金额展示出口。
 *
 * ★ 符号规则（全页面统一）★
 *   支出 → 前面显示 -
 *   收入 → 前面显示 +
 *   0.00 → 不显示符号（但金额本身要显示出来）
 *   「结余」类（variant="balance"） → 正数 +、负数 -、0 无符号
 *
 * ★ 颜色规则（全页面统一）★
 *   variant="amount"（默认，流水金额）：
 *     支出 → 无色（继承正文色）
 *     收入 → 绿色
 *     0    → 无色
 *   variant="balance"（结余 / 余额）：
 *     支出（负数）→ 红色
 *     收入（正数）→ 绿色
 *     0          → 无色
 *
 *   ★ 月历颜色不归这里管 ★
 *     月历的热力格子配色在 components/CalendarGrid.vue 内部，
 *     按用户要求「保持现状」，这里不做统一。
 *
 * ★ 为什么规则要收在这个组件里 ★
 *   以前每个调用点各传一份 :color 和手写三元表达式，
 *   于是同一笔钱在首页是黑字、在统计页是绿字、在详情页又是另一个色 ——
 *   只要有一个地方漏改就不一致。现在默认 color='auto' 走上面的统一规则，
 *   只有「预算已用/额度」这类明确要特殊着色的地方才显式传 color 覆盖。
 */
export default {
  name: 'MoneyText',
  props: {
    /** 金额（分） */
    cents: { type: Number, default: 0 },
    /** 是否显示正负号（type 为空时的兜底开关） */
    sign: { type: Boolean, default: false },
    /**
     * 交易类型：expense / income / transfer
     *
     * ★ 传了这个就不用自己算正负号了 ★
     *   收入前面自动加 +，支出前面自动加 -，
     *   转账不加符号。
     */
    type: { type: String, default: '' },
    /**
     * 语义变体：
     *   'amount'  —— 流水金额：支出无色、收入绿色（默认）
     *   'balance' —— 结余/余额：负数红色、正数绿色
     *   'muted'   —— 中性浅灰：转账、不计入资产的金额（永远无色无符号）
     */
    variant: { type: String, default: 'amount' },
    /**
     * 是否「不计入资产」的账户金额。
     *
     * ★ 只影响颜色，不影响符号 ★
     *   这类账户（include_in_total=0）的余额不参与总资产，
     *   用中性浅灰表示「它不在这本账里」。
     *   ★ 但账户详情页 / 交易详情页的余额不受此开关影响 ★
     *     那两个页面要按用户要求保持正常正文色，见各页面的调用。
     */
    muted: { type: Boolean, default: false },
    /** 是否显示货币符号 */
    symbol: { type: Boolean, default: true },
    /** 是否千分位 */
    grouping: { type: Boolean, default: true },
    /** 整数元时隐藏小数（0 元不隐藏，仍显示 0.00） */
    hideZeroDecimals: { type: Boolean, default: false },
    /** 字号，单位 rpx */
    size: { type: [Number, String], default: 32 },
    /** 字重 */
    weight: { type: [Number, String], default: 400 },
    /**
     * 颜色：
     *   'auto'（默认）→ 按 type / variant 走统一规则
     *   其他字符串     → 直接作为颜色覆盖（如 var(--app-danger)）
     */
    color: { type: String, default: 'auto' },
    /** 是否强制脱敏（隐私模式） */
    forceMask: { type: Boolean, default: false }
  },
  setup(props) {
    const settingStore = useSettingStore()

    const masked = computed(() => {
      return props.forceMask || settingStore.privacyMode
    })

    /** 原始分值（用于符号与配色判断，不含 type 带来的正负） */
    const rawCents = computed(() => Number(props.cents) || 0)

    /** 是否为 0 金额：符号与颜色都要按「无色无符号」处理 */
    const isZero = computed(() => rawCents.value === 0)

    /**
     * 实际参与展示的金额
     *
     * 传了 type 时由 type 决定正负：
     *   支出 -> 负数（前面显示 -）
     *   收入 -> 正数（前面显示 +）
     *   转账 -> 原值（不加符号）
     */
    const signedCents = computed(() => {
      const n = rawCents.value
      if (props.type === 'expense') return -Math.abs(n)
      if (props.type === 'income') return Math.abs(n)
      return n
    })

    /**
     * 是否显示正负号。
     *
     * ★ 0 一律不加符号 ★
     *   用户明确要求「0.00 无符号」——
     *   写成 +0.00 / -0.00 都会让人误以为有收支。
     */
    const showSign = computed(() => {
      if (isZero.value) return false
      // type 优先：支出 -、收入 +
      if (props.type === 'expense' || props.type === 'income') return true
      /*
       * type='transfer'：默认不加符号（转账不是收支），
       * 但调用方可以显式传 sign（如「某账户视角下区分转出/转入」）。
       */
      if (props.type) return props.sign
      // 结余：按数值正负加号
      if (props.variant === 'balance') return true
      return props.sign
    })

    const display = computed(() => {
      if (masked.value) return '****'
      /*
       * ★ 0 元必须显示两位小数 ★
       *   hideZeroDecimals 是为了「整数元不带 .00」，
       *   但 0 若也被压成「0」，用户会以为金额没加载出来。
       */
      const hideDecimals = props.hideZeroDecimals && !isZero.value
      return formatCents(signedCents.value, {
        sign: showSign.value,
        symbol: props.symbol ? settingStore.currencySymbol : '',
        grouping: props.grouping,
        hideZeroDecimals: hideDecimals
      })
    })

    /** 是否使用统一配色规则 */
    const autoColor = computed(() => props.color === 'auto')

    /**
     * 统一配色。
     *
     * 返回空字符串时表示「不设置颜色」，直接继承正文色 ——
     * 这就是需求里的「无色」，而不是写死某个灰色值。
     */
    const resolvedColor = computed(() => {
      if (!autoColor.value) return props.color
      /*
       * ★ 中性浅灰优先于一切 ★
       *   转账（type='transfer'）、variant='muted'、muted=true 这三种情况
       *   都属于「不是收支」的金额，统一浅灰，且不显示符号。
       *   放在 0 判断之前，是因为「转账 0 元」也该是浅灰（表示这笔不是收支）。
       */
      if (props.muted || props.variant === 'muted' || props.type === 'transfer') {
        return 'var(--app-muted, #b8bec7)'
      }
      // 0：无色
      if (isZero.value) return ''

      if (props.variant === 'balance') {
        // 结余：负数红（支出）、正数绿（收入）
        return rawCents.value < 0 ? 'var(--app-danger, #ee0a24)' : 'var(--app-success, #07c160)'
      }

      // 流水金额：支出无色、收入绿色
      return props.type === 'income' ? 'var(--app-success, #07c160)' : ''
    })

    const classes = computed(() => ['money-text'])

    const styleObj = computed(() => {
      const s = {
        fontSize: `${props.size}rpx`,
        fontWeight: String(props.weight)
      }
      const c = resolvedColor.value
      if (c && !masked.value) s.color = c
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
</style>
