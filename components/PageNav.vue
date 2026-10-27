<template>
  <view class="nav-container">
    <!-- 状态栏占位：Android 上 env(safe-area-inset-top) 通常为 0，
         必须用 JS 读到的 statusBarHeight 补，否则标题会被状态栏压住 -->
    <view :style="{ height: statusBarHeight + 'px' }" />
    <view class="nav-bar">
      <view class="nav-inner">
        <text class="nav-back" @click="onBack">‹</text>
        <text class="nav-title">{{ title }}</text>
        <view class="nav-right">
          <slot name="right" />
        </view>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  name: 'PageNav',
  props: {
    title: { type: String, default: '' }
  },
  emits: ['back'],
  setup(props, { emit }) {
    const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20

    function onBack() {
      emit('back')
    }

    return { statusBarHeight, onBack }
  }
}
</script>

<style scoped>
.nav-container {
  flex-shrink: 0;
  background-color: var(--app-bg);
}

.nav-bar {
  background-color: var(--app-bg);
  flex-shrink: 0;
}

.nav-inner {
  height: 88rpx;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
}

.nav-back {
  font-size: 48rpx;
  color: var(--app-text);
  width: 100rpx;
  line-height: 1;
}

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.nav-right {
  width: 100rpx;
  display: flex;
  justify-content: flex-end;
}
</style>
