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

    <!-- 长按进度环：达到 3 秒时自动打开记账面板 -->
    <view v-if="pressing" class="fab-ring">
      <view class="fab-ring-inner" :style="ringStyle" />
    </view>
  </view>
</template>

<script>
import { ref, computed } from 'vue'
import { useSettingStore } from '@/stores/setting.js'

/**
 * 长按触发时长（ms）
 * 300ms：快速按住就自动打开手动记账面板，不用等松手。
 */
const HOLD_MS = 300

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
    const progress = ref(0)

    let startTs = 0
    let longFired = false
    let timer = null
    let rafTimer = null
    let startX = 0
    let startY = 0

    const primaryColor = computed(() => settingStore.primaryColor)

    const wrapStyle = computed(() => ({
      bottom: props.bottom,
      right: props.right
    }))

    /** 进度环的描边比例 */
    const ringStyle = computed(() => ({
      background: `conic-gradient(${primaryColor.value} ${progress.value * 360}deg, transparent ${progress.value * 360}deg)`
    }))

    function clearTimer() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    function clearRaf() {
      if (rafTimer) {
        cancelAnimationFrame(rafTimer)
        rafTimer = null
      }
      progress.value = 0
    }

    /** 进度环逐帧推进 */
    function tick() {
      if (!pressing.value) return
      const elapsed = Date.now() - startTs
      progress.value = Math.min(elapsed / HOLD_MS, 1)
      if (progress.value < 1) {
        rafTimer = requestAnimationFrame(tick)
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
      pressing.value = true
      progress.value = 0

      // 300ms 后自动打开，不需要等用户松手
      timer = setTimeout(() => {
        longFired = true
        try {
          uni.vibrateShort({ type: 'medium' })
        } catch (err) {}
        emit('hold-start')
        emit('hold-end')
        // 面板已弹出，这里直接复位，不再等待 touchend
        pressing.value = false
        clearRaf()
        clearTimer()
      }, HOLD_MS)

      // 进度环动画
      if (typeof requestAnimationFrame === 'function') {
        rafTimer = requestAnimationFrame(tick)
      }
    }

    function onTouchEnd(e) {
      clearTimer()
      clearRaf()
      const delta = Date.now() - startTs
      const wasLong = longFired || delta >= HOLD_MS

      if (wasLong) {
        // 到达阈值时已经自动触发过了，这里不重复
        if (!longFired) {
          emit('hold-end')
        }
      } else {
        emit('single-press')
      }
      longFired = false
      pressing.value = false
    }

    function onTouchCancel() {
      clearTimer()
      clearRaf()
      if (longFired) {
        longFired = false
        emit('hold-cancel')
      }
      pressing.value = false
    }

    function onTouchMove(e) {
      const t = e.touches && e.touches[0]
      if (!t) return

      // 手指明显移动 → 取消长按
      const dx = Math.abs(t.clientX - startX)
      const dy = Math.abs(t.clientY - startY)
      if (dx > 30 || dy > 30) {
        clearTimer()
        clearRaf()
        if (longFired) {
          longFired = false
          emit('hold-cancel')
        }
        pressing.value = false
      }
    }

    return {
      pressing, progress, primaryColor, wrapStyle, ringStyle,
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
  position: relative;
  z-index: 2;
}

.fab-wrap.pressing .fab-btn {
  transform: scale(1.08);
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

/* 长按进度环：绕着按钮画一圈，走满即打开面板 */
.fab-ring {
  position: absolute;
  top: 0;
  left: 0;
  width: 112rpx;
  height: 112rpx;
  z-index: 1;
  pointer-events: none;
}

.fab-ring-inner {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  -webkit-mask: radial-gradient(circle, transparent 62rpx, #000 64rpx);
  mask: radial-gradient(circle, transparent 62rpx, #000 64rpx);
}
</style>
