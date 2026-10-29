<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="记账按钮设置" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
      <!-- 长按 + 号 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">长按 + 号</text>
          <text class="card-value">{{ holdLabel }}</text>
        </view>
        <view class="opt-list">
          <view
            v-for="opt in actionOptions"
            :key="opt.key"
            class="opt-item"
            :class="{ active: holdAction === opt.key }"
            @click="pick('hold', opt.key)"
          >
            <text
              class="opt-name"
              :style="{ color: holdAction === opt.key ? primaryColor : 'var(--app-text)' }"
            >{{ opt.name }}</text>
            <text v-if="holdAction === opt.key" class="opt-check" :style="{ color: primaryColor }">✓</text>
          </view>
        </view>
      </view>

      <!-- 短按 + 号 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">短按 + 号</text>
          <text class="card-value">{{ tapLabel }}</text>
        </view>
        <view class="opt-list">
          <view
            v-for="opt in actionOptions"
            :key="opt.key"
            class="opt-item"
            :class="{ active: tapAction === opt.key }"
            @click="pick('tap', opt.key)"
          >
            <text
              class="opt-name"
              :style="{ color: tapAction === opt.key ? primaryColor : 'var(--app-text)' }"
            >{{ opt.name }}</text>
            <text v-if="tapAction === opt.key" class="opt-check" :style="{ color: primaryColor }">✓</text>
          </view>
        </view>
      </view>

      <!-- 当前效果预览 -->
      <view class="card">
        <text class="card-title">当前效果</text>
        <text class="preview-text">{{ previewText }}</text>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 全局弹窗宿主（组件库重绘的确认框） -->
    <AppDialog />
  </view>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import PageNav from '@/components/PageNav.vue'
import AppDialog from '@/components/AppDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { QUICK_ADD_ACTIONS, normalizeQuickAddAction } from '@/api/settings.js'

export default {
  components: { PageNav, AppDialog },
  setup() {
    const settingStore = useSettingStore()

    /** 本地编辑态：hold = 长按，tap = 短按 */
    const holdAction = ref('manual')
    const tapAction = ref('ai')

    const actionOptions = QUICK_ADD_ACTIONS
    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    /** 选项名 */
    function labelOf(key) {
      const opt = actionOptions.find((a) => a.key === key)
      return opt ? opt.name : '不响应'
    }

    const holdLabel = computed(() => labelOf(holdAction.value))
    const tapLabel = computed(() => labelOf(tapAction.value))

    /** 当前效果的一句话说明 */
    const previewText = computed(() => {
      const hold = holdAction.value
      const tap = tapAction.value
      const desc = (k) => {
        if (k === 'ai') return '打开 AI 速记'
        if (k === 'manual') return '打开手动记账面板'
        return '不响应'
      }
      return `长按 + 号：${desc(hold)}；短按 + 号：${desc(tap)}。`
    })

    /** 选中一项并立刻保存 */
    async function pick(which, key) {
      const value = normalizeQuickAddAction(key, which === 'hold' ? 'manual' : 'ai')
      if (which === 'hold') {
        holdAction.value = value
      } else {
        tapAction.value = value
      }
      await settingStore.setQuickAddAction(which, value)
    }

    function goBack() {
      uni.navigateBack()
    }

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      // 从 store 读初值（store 里的 getter 已经做过归一化）
      holdAction.value = settingStore.quickAddHoldAction
      tapAction.value = settingStore.quickAddTapAction
    })

    return {
      settingStore, primaryColor, pageStyle,
      holdAction, tapAction, actionOptions,
      holdLabel, tapLabel, previewText,
      pick, goBack
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

/* 说明 */
/* 卡片 */
.card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 8rpx 28rpx 12rpx;
  margin-top: 20rpx;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 0 12rpx;
}

.card-title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--app-text);
  display: block;
  padding-top: 24rpx;
}

.card-head .card-title {
  padding-top: 0;
}

.card-value {
  font-size: 24rpx;
  color: var(--app-text-3);
}

/* 选项行 */
.opt-list {
  border-top: 1rpx solid var(--app-line);
}

.opt-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 26rpx 4rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.opt-item:last-child {
  border-bottom: none;
}

.opt-name {
  font-size: 28rpx;
}

.opt-check {
  font-size: 28rpx;
  font-weight: 600;
}

/* 预览 */
.preview-text {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: var(--app-text-2);
  line-height: 1.7;
}
</style>
