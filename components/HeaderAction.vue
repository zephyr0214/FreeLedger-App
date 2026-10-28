<template>
  <!--
    头部右侧的胶囊按钮。

    ★ 为什么单独抽成组件 ★
      首页「AI 助手」、账户页「+ 添加账户」、统计页「AI 助手」、
      我的页「关于与说明」—— 四个按钮的视觉必须完全一致
      （同样的圆角、padding、字号、主题色文字）。
      以前是四处各抄一份 .ai-btn / .add-btn 样式，
      改一处忘另一处就会出现「风格不统一」。
      抽成组件后，样式只有这一份，天然一致。

    用法：
      <AppHeader @avatar-click="goProfile">
        <template #right>
          <HeaderAction @click="goAbout">关于与说明</HeaderAction>
        </template>
      </AppHeader>
  -->
  <view class="header-action" @click="onClick">
    <text class="header-action-text">{{ text }}</text>
  </view>
</template>

<script>
export default {
  name: 'HeaderAction',
  props: {
    /** 按钮文字 */
    text: { type: String, default: '' }
  },
  emits: ['action-click'],
  setup(props, { emit }) {
    function onClick() {
      emit('action-click')
    }
    return { onClick }
  }
}
</script>

<style scoped>
.header-action {
  padding: 8rpx 20rpx;
  border-radius: 20rpx;
  background-color: var(--app-card);
  flex-shrink: 0;
}

.header-action-text {
  font-size: 24rpx;
  color: var(--app-primary);
}
</style>
