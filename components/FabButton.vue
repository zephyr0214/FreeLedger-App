<template>
  <view
    v-if="!hidden"
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
      <text class="hint-text">松手打开记账面板</text>
    </view>
  </view>
</template>

<script>
import { ref, computed } from 'vue'
import { useSettingStore } from '@/stores/setting.js'

/**
 * 长按阈值（ms）
 *
 * ★ 不能设太短 ★
 *   原来 260ms —— 普通人一次点击的按压时长常见 200~350ms，
 *   稍慢一点就被判成长按，于是「单击没反应」（实际打开了记账面板）。
 *   400ms 是移动端长按的常见阈值（微信、支付宝都在 400~500ms）。
 */
const HOLD_MS = 400

export default {
  name: 'FabButton',
  props: {
    /** 距底部距离，默认避开 tabBar 并贴近底部 */
    bottom: { type: String, default: 'calc(env(safe-area-inset-bottom) + 40rpx)' },
    right: { type: String, default: '36rpx' },
    /** 是否隐藏（输入条展开时隐藏） */
    hidden: { type: Boolean, default: false }
  },
  /**
   * ★ 事件名不要用 tap / click / longpress ★
   *   这些是 uni-app 模板里的原生事件别名，
   *   `<FabButton @tap="xxx">` 会被编译成监听根节点的原生 tap(click)，
   *   而不是监听本组件 emit('tap')，结果就是单击毫无反应。
   *   所以用 single-press / long-press 这类自定义名，避免与原生事件撞车。
   */
  emits: ['single-press', 'hold-start', 'hold-end', 'hold-cancel'],
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
        emit('single-press')
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
