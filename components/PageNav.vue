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

/*
 * 右侧动作区
 *
 * ★ 为什么用 min-width 而不是固定 width ★
 *   原来是写死的 width: 100rpx —— 对「+」图标按钮（约 60rpx）
 *   和「保存」这种两个字（约 90rpx）刚好够用。
 *   但更新日志页放的是 HeaderAction 胶囊按钮（「检查更新」四个字
 *   + 左右各 20rpx 内边距 ≈ 160rpx），固定 100rpx 会把它压扁。
 *
 *   改成 min-width: 100rpx + 让内容自己撑开：
 *     · 窄内容（图标）→ 仍占 100rpx，标题居中不变
 *     · 宽内容（胶囊按钮）→ 自动变宽，标题相应左移但仍居中于剩余空间
 *   配合 left 的「‹」也固定 100rpx，两侧基线在窄内容时依旧对称。
 */
.nav-right {
  min-width: 100rpx;
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
}
</style>
