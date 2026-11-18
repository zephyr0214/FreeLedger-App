<template>
  <!--
    交易多选批量操作条

    ★ 为什么抽成组件 ★
      首页「最近收支」和「全部交易」多选后要显示完全相同的操作条：
      删除 / 标签 / 不计预算 / 待报销。
      页面各写一份的话，按钮宽度、玻璃透明度、间距很容易长歪。
  -->
  <view class="batch-bar">
    <view class="batch-inner" :style="batchBarStyle">
      <view class="batch-item" @click="$emit('delete')">
        <text class="batch-item-text batch-item-text--danger">删除</text>
      </view>
      <view class="batch-item" @click="$emit('tag')">
        <text class="batch-item-text">标签</text>
      </view>
      <view class="batch-item" @click="$emit('exclude-budget')">
        <text class="batch-item-text">不计预算</text>
      </view>
      <view class="batch-item" @click="$emit('pending-reimburse')">
        <text class="batch-item-text">待报销</text>
      </view>
    </view>
  </view>
</template>

<script>
import { computed } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { glassVars } from '@/utils/theme.js'

export default {
  name: 'TxnBatchBar',
  emits: ['delete', 'tag', 'exclude-budget', 'pending-reimburse'],
  setup() {
    const settingStore = useSettingStore()
    /** 与底栏同一套磨砂玻璃变量，深浅色由 glassVars 统一处理 */
    const batchBarStyle = computed(() => glassVars(settingStore.isDark, { blur: '24rpx' }))
    return { batchBarStyle }
  }
}
</script>

<style scoped>
.batch-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(24rpx + env(safe-area-inset-bottom));
  z-index: 9;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.batch-inner {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  height: 96rpx;
  padding: 0 8rpx;
  border-radius: 999rpx;
  border-width: 1rpx;
  border-style: solid;
  border-color: var(--glass-border, rgba(0, 0, 0, 0.05));
  background-color: var(--glass-bg-solid, rgba(255, 255, 255, 0.96));
  box-shadow: var(--glass-shadow, 0 12rpx 40rpx rgba(0, 0, 0, 0.1));
}

@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .batch-inner {
    background-color: var(--glass-bg, rgba(255, 255, 255, 0.70));
    -webkit-backdrop-filter: saturate(180%) blur(var(--glass-blur, 24rpx));
    backdrop-filter: saturate(180%) blur(var(--glass-blur, 24rpx));
  }
}

/* 按钮宽按内容自适应，不四等分 —— 「删除」2 字和「不计预算」4 字等分会空一大截 */
.batch-item {
  flex-shrink: 0;
  height: 80rpx;
  padding: 0 22rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999rpx;
}

.batch-item:active {
  background-color: var(--app-card-2);
}

/* 分隔竖线：用伪元素，避免最后一项右侧多一条 */
.batch-item + .batch-item {
  position: relative;
}

.batch-item + .batch-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 1rpx;
  height: 32rpx;
  background-color: var(--app-line);
}

.batch-item-text {
  font-size: 26rpx;
  color: var(--app-text);
  white-space: nowrap;
}

.batch-item-text--danger {
  color: var(--app-danger);
}
</style>
