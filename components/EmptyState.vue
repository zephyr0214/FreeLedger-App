<template>
  <view class="empty-state" :class="{ compact }">
    <view class="empty-icon">
      <text class="empty-emoji">{{ emoji }}</text>
    </view>
    <text class="empty-title">{{ title }}</text>
    <text v-if="desc" class="empty-desc">{{ desc }}</text>
    <wd-button
      v-if="actionText"
      size="small"
      plain
      type="primary"
      custom-class="empty-action"
      @click="$emit('action')"
    >
      {{ actionText }}
    </wd-button>
  </view>
</template>

<script>
export default {
  name: 'EmptyState',
  props: {
    emoji: { type: String, default: '📒' },
    title: { type: String, default: '还没有记录' },
    desc: { type: String, default: '' },
    actionText: { type: String, default: '' },
    compact: { type: Boolean, default: false }
  },
  emits: ['action']
}
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80rpx 40rpx;
}

.empty-state.compact {
  padding: 40rpx 20rpx;
}

.empty-icon {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  background-color: var(--app-card-2);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24rpx;
}

.compact .empty-icon {
  width: 88rpx;
  height: 88rpx;
  margin-bottom: 16rpx;
}

.empty-emoji {
  font-size: 52rpx;
}

.compact .empty-emoji {
  font-size: 40rpx;
}

.empty-title {
  font-size: 28rpx;
  color: var(--app-text-2);
  margin-bottom: 8rpx;
}

.empty-desc {
  font-size: 24rpx;
  color: var(--app-text-3);
  text-align: center;
  line-height: 1.5;
  margin-bottom: 24rpx;
}

.empty-action {
  margin-top: 16rpx;
}
</style>
