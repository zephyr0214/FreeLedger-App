<template>
  <view class="app-header" :style="{ paddingTop: statusBarHeight + 'px' }">
    <view class="header-inner">
      <!-- 左侧：头像 -->
      <view class="header-left" @click="$emit('avatar-click')">
        <wd-avatar
          v-if="avatarUrl"
          :src="avatarUrl"
          size="72rpx"
          shape="round"
        />
        <view v-else class="avatar-placeholder" :style="{ backgroundColor: primaryColor }">
          <text class="avatar-text">{{ avatarText }}</text>
        </view>
      </view>

      <!-- 中间：问候语 + 日期 -->
      <view class="header-center">
        <text class="greeting">{{ greeting }}</text>
        <text class="date-line">{{ dateText }}</text>
      </view>

      <!-- 右侧：页面专属操作 -->
      <view class="header-right">
        <slot name="right" />
      </view>
    </view>
  </view>
</template>

<script>
import { computed } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { toDayKey, weekdayLabel } from '@/utils/date.js'

export default {
  name: 'AppHeader',
  props: {
    /** 自定义问候语，默认按当前时段生成 */
    greetingText: { type: String, default: '' },
    /** 是否显示日期 */
    showDate: { type: Boolean, default: true }
  },
  emits: ['avatar-click'],
  setup(props) {
    const settingStore = useSettingStore()

    const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20

    const greeting = computed(() => {
      if (props.greetingText) return props.greetingText
      const h = new Date().getHours()
      let base = '你好'
      if (h < 6) base = '夜深了'
      else if (h < 11) base = '早上好'
      else if (h < 14) base = '中午好'
      else if (h < 18) base = '下午好'
      else base = '晚上好'
      return `${base}，${settingStore.nickname}`
    })

    const dateText = computed(() => {
      if (!props.showDate) return ''
      const today = toDayKey()
      const d = new Date()
      return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdayLabel(today)}`
    })

    const avatarUrl = computed(() => settingStore.avatar)

    const avatarText = computed(() => {
      const name = settingStore.nickname || '记账人'
      return name.slice(0, 1)
    })

    const primaryColor = computed(() => settingStore.primaryColor)

    return { statusBarHeight, greeting, dateText, avatarUrl, avatarText, primaryColor }
  }
}
</script>

<style scoped>
.app-header {
  background-color: var(--app-bg);
  padding-left: 32rpx;
  padding-right: 32rpx;
  /* 父级是 flex column，固定头部不被压缩 */
  flex-shrink: 0;
}

.header-inner {
  display: flex;
  align-items: center;
  /*
   * ★ 从 120rpx 收到 96rpx（用户本轮第 3 条）★
   *   用户原话：「希望四个主页面最上方的头像、昵称和按钮，
   *   整体高度也能矮一点」。
   *
   *   ★ 为什么能收到 96rpx ★
   *     头像 72rpx 是最高的元素，96 - 72 = 24，上下各 12rpx 留白，
   *     仍然比头像高一圈，不会贴边。
   *
   *   ★ 为什么不连头像一起缩 ★
   *     72rpx 是头像的经典尺寸（再小就看不清头像里的字）；
   *     而且用户说的是「整体高度」，不是「头像变小」。
   */
  height: 96rpx;
  gap: 20rpx;
}

.header-left {
  flex-shrink: 0;
}

.avatar-placeholder {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-text {
  color: #ffffff;
  font-size: 32rpx;
  font-weight: 600;
}

.header-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}

.greeting {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
  line-height: 1.3;
}

.date-line {
  font-size: 24rpx;
  color: var(--app-text-3);
  line-height: 1.3;
  margin-top: 4rpx;
}

.header-right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16rpx;
}
</style>
