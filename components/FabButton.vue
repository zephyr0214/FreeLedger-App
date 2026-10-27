<template>
  <view
    class="fab-wrap"
    :class="{ pressing }"
    :style="wrapStyle"
  >
    <view
      class="fab-btn"
      :style="{ backgroundColor: primaryColor }"
      @touchstart.stop.prevent="onTouchStart"
      @touchend.stop.prevent="onTouchEnd"
      @touchcancel.stop.prevent="onTouchCancel"
      @touchmove.stop.prevent="onTouchMove"
    >
      <text class="fab-icon" :class="{ rotated: pressing }">+</text>
    </view>

    <!-- 长按提示 -->
    <view v-if="pressing" class="fab-hint">
      <text class="hint-text">松手开始速记</text>
    </view>
  </view>
</template>

<script>
import { ref, computed } from 'vue'
import { useSettingStore } from '@/stores/setting.js'

/** 长按阈值（ms）—— 低于此值视为单击 */
const HOLD_MS = 260

export default {
  name: 'FabButton',
  props: {
    /** 距底部距离，默认避开 tabBar */
    bottom: { type: String, default: 'calc(env(safe-area-inset-bottom) + 140rpx)' },
    right: { type: String, default: '40rpx' }
  },
  emits: ['tap', 'hold-start', 'hold-end', 'hold-cancel'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const pressing = ref(false)

    let startTs = 0
    let longFired = false
    let timer = null
    let startX = 0
    let startY = 0

    const primaryColor = computed(() => settingStore.primaryColor)

    const wrapStyle = computed(() => ({
      bottom: props.bottom,
      right: props.right
    }))

    function clearTimer() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    function onTouchStart(e) {
      const t = e.touches && e.touches[0]
      if (t) {
        startX = t.clientX
        startY = t.clientY
      }
      startTs = Date.now()
      longFired = false

      timer = setTimeout(() => {
        longFired = true
        pressing.value = true
        // 触觉反馈：告知已进入速记态
        try {
          uni.vibrateShort({ type: 'medium' })
        } catch (err) {}
        emit('hold-start')
      }, HOLD_MS)
    }

    function onTouchEnd(e) {
      clearTimer()
      const delta = Date.now() - startTs
      const wasLong = longFired || delta >= HOLD_MS

      if (wasLong) {
        pressing.value = false
        emit('hold-end')
      } else {
        emit('tap')
      }
      longFired = false
    }

    function onTouchCancel() {
      clearTimer()
      if (longFired) {
        pressing.value = false
        longFired = false
        emit('hold-cancel')
      }
    }

    function onTouchMove(e) {
      const t = e.touches && e.touches[0]
      if (!t) return

      // 长按期间手指大幅移动 → 视为取消，避免误触
      const dx = Math.abs(t.clientX - startX)
      const dy = Math.abs(t.clientY - startY)
      if (dx > 30 || dy > 30) {
        clearTimer()
        if (longFired) {
          pressing.value = false
          longFired = false
          emit('hold-cancel')
        }
      }
    }

    return {
      pressing, primaryColor, wrapStyle,
      onTouchStart, onTouchEnd, onTouchCancel, onTouchMove
    }
  }
}
</script>

<style scoped>
.fab-wrap {
  position: fixed;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.fab-btn {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.18);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.fab-wrap.pressing .fab-btn {
  transform: scale(1.12);
  box-shadow: 0 12rpx 32rpx rgba(0, 0, 0, 0.24);
}

.fab-icon {
  color: #ffffff;
  font-size: 64rpx;
  font-weight: 300;
  line-height: 1;
  margin-top: -6rpx;
  transition: transform 0.18s ease;
}

.fab-icon.rotated {
  transform: rotate(45deg);
}

.fab-hint {
  position: absolute;
  bottom: 128rpx;
  background-color: rgba(0, 0, 0, 0.78);
  padding: 10rpx 24rpx;
  border-radius: 24rpx;
  white-space: nowrap;
}

.hint-text {
  color: #ffffff;
  font-size: 22rpx;
}
</style>
