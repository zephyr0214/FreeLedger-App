<template>
  <wd-popup
    v-model="visible"
    position="bottom"
    :z-index="zIndex"
    :safe-area-inset-bottom="true"
    custom-style="background-color: var(--app-card); border-radius: 28rpx 28rpx 0 0;"
  >
    <view class="opt-sheet">
      <view class="opt-head">
        <text class="opt-title">{{ title }}</text>
        <text class="opt-close" @click="close">关闭</text>
      </view>

      <scroll-view class="opt-scroll" scroll-y>
        <view
          v-for="opt in options"
          :key="opt.key"
          class="opt-row"
          :class="{ active: opt.key === selectedKey }"
          @click="pick(opt)"
        >
          <!-- 图标：线性图标 / 图片预览（没有图标时不占位） -->
          <view v-if="opt.icon || opt.image" class="opt-icon">
            <LineIcon
              v-if="opt.icon"
              :name="opt.icon"
              :size="20"
              :color="primaryColor"
            />
            <image
              v-else-if="opt.image"
              class="opt-image"
              :src="opt.image"
              mode="aspectFit"
            />
          </view>

          <view class="opt-info">
            <text class="opt-name">{{ opt.label }}</text>
            <text v-if="opt.desc" class="opt-sub">{{ opt.desc }}</text>
          </view>

          <!-- 单选当前值：纯对勾，和账户选择面板一致 -->
          <text v-if="opt.key === selectedKey" class="opt-tick">✓</text>
        </view>
      </scroll-view>
    </view>
  </wd-popup>
</template>

<script>
/**
 * 通用单选弹层 —— 样式与 AccountPickerSheet 保持一致
 *
 * 用途：主题外观的「深浅模式」「图标样式」等少量固定选项。
 * 每行 = 图标/预览图 + 名称 + 说明 + 当前值对勾，底部弹层。
 *
 * ★ 事件名用 picked ★
 *   select / change / confirm 都是原生事件名，会与组件事件冲突。
 */
import { computed, watch, onUnmounted } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { pushLayer } from '@/utils/layerStack.js'
import LineIcon from '@/components/LineIcon.vue'

export default {
  name: 'OptionPickerSheet',
  components: { LineIcon },
  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, default: '请选择' },
    /** [{ key, label, desc?, icon?, image? }] */
    options: { type: Array, default: () => [] },
    selectedKey: { type: String, default: '' },
    zIndex: { type: Number, default: 120 }
  },
  emits: ['update:modelValue', 'picked'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const primaryColor = computed(() => settingStore.primaryColor)

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    function pick(opt) {
      emit('picked', opt)
      visible.value = false
    }

    function close() {
      visible.value = false
    }

    let unregisterLayer = null

    watch(
      () => props.modelValue,
      (open) => {
        if (open) {
          if (!unregisterLayer) {
            unregisterLayer = pushLayer(() => { visible.value = false }, 'optionPickerSheet')
          }
          return
        }
        if (unregisterLayer) {
          unregisterLayer()
          unregisterLayer = null
        }
      }
    )

    onUnmounted(() => {
      if (unregisterLayer) unregisterLayer()
    })

    return { visible, primaryColor, pick, close }
  }
}
</script>

<style scoped>
.opt-sheet {
  display: flex;
  flex-direction: column;
  max-height: 72vh;
}

.opt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx 16rpx;
}

.opt-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
}

.opt-close {
  font-size: 26rpx;
  color: var(--app-text-3);
}

.opt-scroll {
  flex: 1;
  min-height: 200rpx;
  max-height: 60vh;
  padding: 0 20rpx 24rpx;
}

.opt-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 16rpx 12rpx;
  border-radius: 20rpx;
}

.opt-row.active {
  background-color: var(--app-card-2);
}

.opt-icon {
  width: 68rpx;
  height: 68rpx;
  border-radius: 18rpx;
  background-color: var(--app-card-2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.opt-image {
  width: 48rpx;
  height: 48rpx;
}

.opt-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.opt-name {
  font-size: 28rpx;
  color: var(--app-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.opt-sub {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.opt-tick {
  font-size: 30rpx;
  color: var(--app-primary);
  flex-shrink: 0;
}
</style>
