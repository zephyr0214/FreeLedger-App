<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="报销管理" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
      <!--
        ★ 这一页是占位页 ★
          用户要的入口先立起来（「跳转到空页面，占位用，后续完善」），
          真正的报销台账还没设计。
          这里不放假的列表 / 假的按钮 —— 一个空壳页面配一段说明，
          比一堆点了没反应的界面诚实，也不会让人误以为功能已经能用。

        ★ 后续要在这里做什么（先记下来，省得下次重新想）★
          · 一笔支出标记「可报销」→ 报销中 → 已报销 的状态流转
          · 按人 / 按项目归集，与账户的「垫付」余额区分开
          · 报销到账时从「报销中」转成账户收入，而不是新建一笔支出
      -->
      <view class="placeholder">
        <view class="ph-icon">
          <LineIcon name="reimburse" :size="44" :color="primaryColor" />
        </view>
        <text class="ph-title">报销管理</text>
        <text class="ph-desc">这个功能还在路上。</text>
        <text class="ph-desc">记账和账户数据不受影响，先照常使用。</text>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
import { computed } from 'vue'
import PageNav from '@/components/PageNav.vue'
import LineIcon from '@/components/LineIcon.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'

export default {
  components: { PageNav, LineIcon, UpdateDialog },
  setup() {
    const settingStore = useSettingStore()

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    function goBack() {
      uni.navigateBack()
    }

    return { settingStore, primaryColor, pageStyle, goBack }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 96rpx 40rpx;
  margin-top: 20rpx;
  box-shadow: var(--app-shadow);
}

/* 图标底衬：与 EmptyState 的空态图标同一套视觉 */
.ph-icon {
  width: 132rpx;
  height: 132rpx;
  border-radius: 50%;
  background-color: var(--app-card-2);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12rpx;
}

.ph-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.ph-desc {
  font-size: 24rpx;
  color: var(--app-text-3);
  text-align: center;
  line-height: 1.6;
}
</style>
