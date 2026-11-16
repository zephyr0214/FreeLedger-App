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
 *   - txnIconSize：五档尺寸（极小…极大），默认「大」(68rpx)
 *   - txnIconShowBg：是否显示分类浅色方底，默认关
 *   - txnIconBgRound：背景形状 0..4（方形 → 圆形）
 *   - emojiStyle：图标样式（noto / twemoji / openmoji）
 *   首页、全部交易、账户/分类/标签/预算/周期详情、借入借出、报销页
 *   全部用这一个组件，改设置后所有流水同步变化。
 *
 * ★ 背景色是固定尺寸的方底 ★
 *   打开时统一 84rpx（能包住最大档 76rpx 图标），
 *   不随图标大小档位变化；圆角由 txnIconBgRound 控制（方形→圆形）。
 *
 * ★ 转账用符号 ★
 *   传 symbol='⇄' 时不渲染分类图片，直接显示符号；
 *   尺寸跟随当前档位（图标 80%），颜色用分类色 / 次要色。
 */
import { computed } from 'vue'
import CategoryGlyph from '@/components/CategoryGlyph.vue'
import { useSettingStore } from '@/stores/setting.js'
import { TXN_ICON_BG_BOX, getTxnIconMetrics } from '@/utils/txnIcon.js'
import { categoryTint } from '@/utils/categoryIcon.js'
import { emojiStyleFailed } from '@/utils/emojiLoad.js'

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

    /**
     * 是否整套图标样式都加载不出来（断网 / CDN 挂了）
     *
     * ★ 系统默认样式：圆角背景色 + 极小 ★
     *   用户要求无网状态使用「圆角背景色 + 极小」：
     *   图标缩到极小档（44rpx 图标 / 48rpx 底），
     *   强制打开圆角分类色底，而不是按用户的流水图标设置放大。
     */
    const offline = computed(() => emojiStyleFailed(settingStore.emojiStyle))

    const metrics = computed(() =>
      offline.value ? getTxnIconMetrics('xs') : settingStore.txnIconMetrics
    )
    const showBg = computed(() => offline.value || settingStore.txnIconShowBg)
    const bgRadius = computed(() => (offline.value ? '18rpx' : settingStore.txnIconBgRadius))

    const boxStyle = computed(() => {
      const bgOn = showBg.value
      /*
       * 在线时按用户的「图标配置」：打开背景 = 固定 84rpx 方底；
       * 断网系统样式 = 极小档 48rpx 圆角底（和 44rpx 系统 emoji 贴合）。
       */
      const size = bgOn
        ? (offline.value ? metrics.value.box : TXN_ICON_BG_BOX)
        : metrics.value.box
      return {
        width: `${size}rpx`,
        height: `${size}rpx`,
        borderRadius: bgOn ? bgRadius.value : '0',
        backgroundColor: bgOn
          ? categoryTint(props.color || '#969799', settingStore.isDark)
          : 'transparent'
      }
    })

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
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  /* 圆角大小由内联样式控制：背景色关闭时是 0，打开时 18rpx */
  transition: width 0.15s, height 0.15s, border-radius 0.15s, background-color 0.15s;
  /* 图标不吃触摸事件，点击仍然落在整行上 */
  pointer-events: none;
}

.txn-icon-symbol {
  text-align: center;
  font-weight: 500;
}
</style>
