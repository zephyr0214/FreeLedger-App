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

    ★ 文字有两种给法 ★
      1. 默认插槽（推荐）：
         <HeaderAction @action-click="goAbout">关于与说明</HeaderAction>
      2. text prop：
         <HeaderAction text="关于与说明" @action-click="goAbout" />

      两种都支持。插槽优先，没给插槽就用 text prop。
      （之前只支持 prop，调用方习惯性写成插槽形式，
        结果文字全都不显示 —— 插槽没有默认插槽兜底就被丢弃了。）
  -->
  <view class="header-action" @click="onClick">
    <text class="header-action-text"><slot>{{ text }}</slot></text>
  </view>
</template>

<script>
export default {
  name: 'HeaderAction',
  props: {
    /** 按钮文字（不给插槽时用这个） */
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
  display: flex;
  align-items: center;
}

.header-action-text {
  font-size: 24rpx;
  color: var(--app-primary);
  line-height: 1.4;
  /* ★ 防止文字被压扁 ★
     flex 容器里的 text 默认可以收缩，
     父级 header-center 是 flex:1，会把这一列挤窄，
     文字就看不见了。加上 flex-shrink:0 + white-space:nowrap。 */
  flex-shrink: 0;
  white-space: nowrap;
}
</style>
