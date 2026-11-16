<template>
  <!--
    详情页汇总卡左上角的分类图标

    ★ 所有详情页共用这一个组件 ★
      用户要求：交易详情、预算详情、标签详情、借入/借出、报销、周期详情、
      分类详情左上角的图标永远保持一致 ——
        固定 88rpx 圆角方底（圆角 20rpx）
        + 固定 44rpx 图标（极小档）
        + 图标库样式跟随「主题外观 → 图标样式」
      以前各页各写一套：有 56rpx 圆形的、有 88rpx 主题色底的、
      有直接塞文字 emoji 的，同一个 App 里出现四种观感。
      统一成一个组件后，改尺寸/圆角/底色只改这里。

    ★ 系统 emoji 兜底也是这套壳 ★
      断网时 CategoryGlyph 回退系统 emoji（最大 44rpx），
      仍然落在固定的圆角分类色底上，
      即用户说的「系统默认样式 = 圆角背景色 + 极小」。
  -->
  <view class="detail-summary-icon" :style="boxStyle">
    <CategoryGlyph
      :icon="icon"
      :name="name"
      :symbol="symbol"
      :color="color"
      size="44rpx"
      :remote-size="60"
      :loading-fallback="false"
    />
  </view>
</template>

<script>
import { computed } from 'vue'
import CategoryGlyph from '@/components/CategoryGlyph.vue'
import { useSettingStore } from '@/stores/setting.js'
import { categoryTint } from '@/utils/categoryIcon.js'

export default {
  name: 'DetailSummaryIcon',
  components: { CategoryGlyph },
  props: {
    /** 分类 icon 码点（转账为空） */
    icon: { type: String, default: '' },
    /** 分类名（icon 为空时按名字猜） */
    name: { type: String, default: '' },
    /** 转账等非分类符号（⇄） */
    symbol: { type: String, default: '' },
    /** 分类 / 标签 / 页面强调色，决定浅色底和符号颜色 */
    color: { type: String, default: '#969799' }
  },
  setup(props) {
    const settingStore = useSettingStore()

    /**
     * 固定圆角方底
     *
     * 尺寸 / 圆角写死在 CSS 里，不跟「流水图标大小」设置走 ——
     * 这是详情页的信息头，不是流水行；全 App 详情页必须一样大。
     * 只有底色跟随具体分类色，深浅色透明度由 categoryTint 统一处理。
     */
    const boxStyle = computed(() => ({
      backgroundColor: categoryTint(props.color || '#969799', settingStore.isDark)
    }))

    return { boxStyle }
  }
}
</script>

<style scoped>
.detail-summary-icon {
  width: 88rpx;
  height: 88rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
</style>
