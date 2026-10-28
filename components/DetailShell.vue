<template>
  <view class="detail-shell">
    <!-- 顶部导航：返回 + 标题 + 右侧插槽 -->
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text v-if="showBack" class="nav-back" @click="onBack">‹</text>
        <view v-else class="nav-back" />
        <text class="nav-title">{{ title }}</text>
        <view class="nav-right">
          <slot name="right" />
        </view>
      </view>
    </view>

    <!-- 内容滚动区 -->
    <scroll-view class="page-scroll" scroll-y>
      <slot />
      <view class="bottom-space" />
    </scroll-view>
  </view>
</template>

<script>
/**
 * 详情页外壳 —— 顶部导航 + 内容滚动区
 *
 * ★ 为什么单独抽出来 ★
 *   账户 / 分类 / 标签 / 预算 / 周期这 5 个详情页的骨架完全一样：
 *     顶部导航（返回 + 标题 + 右侧操作）+ 可滚动的内容区。
 *   抽出来以后，5 个页面只写内容，导航样式只维护一份，
 *   以后要统一改标题栏只改这一个文件。
 *
 * 用法：
 *   <DetailShell title="分类详情" @back="goBack">
 *     <template #right><text @click="goEdit">编辑</text></template>
 *     ...内容...
 *   </DetailShell>
 */
export default {
  name: 'DetailShell',
  props: {
    /** 标题 */
    title: { type: String, default: '' },
    /** 是否显示返回按钮 */
    showBack: { type: Boolean, default: true }
  },
  emits: ['back'],
  setup(props, { emit }) {
    /**
     * 状态栏高度
     *
     * Android 上 env(safe-area-inset-top) 通常为 0，
     * 必须用 JS 读到的 statusBarHeight 补，否则标题会被状态栏压住。
     */
    const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20

    function onBack() {
      emit('back')
    }

    return { statusBarHeight, onBack }
  }
}
</script>

<style scoped>
/**
 * ★ 高度约束 ★
 *   .detail-shell 是 .app-page 的直接子元素（flex column），
 *   所以它自己要吃掉剩余空间并再开一层纵向 flex，
 *   里面的 scroll-view 才能用 flex:1 吃满。
 *   （App.vue 里的 .app-page > .page-scroll 规则作用不到这里，
 *    因为 scroll-view 已经不是 .app-page 的直接子元素了。）
 */
.detail-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
  align-items: center;
}

.page-scroll {
  flex: 1;
  height: 0;
  overflow: hidden;
  padding: 0 32rpx;
}
</style>
