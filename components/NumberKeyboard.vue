<template>
  <view class="num-keyboard">
    <!-- 第一行：运算符 -->
    <view class="kb-row kb-ops">
      <view
        v-for="op in ops"
        :key="op"
        class="kb-key kb-op"
        hover-class="kb-key-hover"
        @click="onOp(op)"
      >
        <text class="kb-op-text">{{ op }}</text>
      </view>
    </view>

    <!-- 数字区 3x4 -->
    <view class="kb-grid">
      <view
        v-for="k in digits"
        :key="k"
        class="kb-key"
        :class="{ 'kb-key-zero': k === '0' }"
        hover-class="kb-key-hover"
        @click="onKey(k)"
      >
        <text class="kb-key-text">{{ k }}</text>
      </view>

      <!-- 退格 -->
      <view class="kb-key" hover-class="kb-key-hover" @click="onBackspace">
        <text class="kb-key-text kb-backspace">⌫</text>
      </view>

      <!-- 小数点 -->
      <view class="kb-key" hover-class="kb-key-hover" @click="onKey('.')">
        <text class="kb-key-text">.</text>
      </view>

      <!-- 完成 -->
      <view
        class="kb-key kb-finish"
        :style="{ backgroundColor: finishDisabled ? 'var(--app-line)' : primaryColor }"
        hover-class="kb-finish-hover"
        @click="onFinish"
      >
        <text class="kb-finish-text">{{ finishText }}</text>
      </view>
    </view>

    <!-- 快捷金额 -->
    <view v-if="quickAmounts.length > 0" class="kb-quick">
      <view
        v-for="amt in quickAmounts"
        :key="amt"
        class="quick-chip"
        hover-class="quick-chip-hover"
        @click="onQuick(amt)"
      >
        <text class="quick-text">+{{ amt }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import { computed } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { formatCents } from '@/utils/money.js'

export default {
  name: 'NumberKeyboard',
  props: {
    /** 当前输入的原始字符串，如 "12.5" 或算式 "12+8" */
    modelValue: { type: String, default: '' },
    /** 完成按钮文字 */
    finishText: { type: String, default: '完成' },
    /** 禁用完成 */
    disabled: { type: Boolean, default: false },
    /** 快捷金额（元） */
    quickAmounts: { type: Array, default: () => [10, 20, 50, 100] }
  },
  emits: ['update:modelValue', 'finish'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const primaryColor = computed(() => settingStore.primaryColor)

    const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
    const ops = ['+', '-', '=']

    const finishDisabled = computed(() => props.disabled || !props.modelValue)

    /** 安全求值：只允许数字与 + - */
    function evaluate(expr) {
      const s = String(expr).replace(/[^0-9+\-.]/g, '')
      if (!s) return 0
      // 避免 eval，手动分词求和
      const tokens = s.match(/[+\-]?[0-9.]+/g) || []
      let total = 0
      for (const tk of tokens) {
        const n = Number(tk)
        if (Number.isFinite(n)) total += n
      }
      return Math.max(0, total)
    }

    function onKey(k) {
      let v = props.modelValue || ''

      if (k === '.') {
        // 当前段已有小数点则忽略
        const seg = v.split(/[+\-]/).pop()
        if (seg && seg.includes('.')) return
        if (!seg) v += '0'
        v += '.'
      } else {
        // 限制整数部分长度，防止溢出
        const seg = v.split(/[+\-]/).pop()
        if (seg && seg.replace('.', '').length >= 9) return
        // 前导 0 处理
        if (seg === '0') v = v.slice(0, -1)
        v += k
      }
      emit('update:modelValue', v)
    }

    function onOp(op) {
      const v = props.modelValue || ''
      if (op === '=') {
        const result = evaluate(v)
        emit('update:modelValue', result === 0 ? '' : String(Math.round(result * 100) / 100))
        return
      }
      // + - 作为连接符
      if (!v) {
        if (op === '-') return  // 不允许以负号开头（金额恒为正）
        return
      }
      // 末尾已是运算符则替换
      if (/[+\-]$/.test(v)) {
        emit('update:modelValue', v.slice(0, -1) + op)
      } else {
        emit('update:modelValue', v + op)
      }
    }

    function onBackspace() {
      const v = props.modelValue || ''
      emit('update:modelValue', v.slice(0, -1))
    }

    function onQuick(amt) {
      const v = props.modelValue || ''
      const cur = evaluate(v)
      const next = Math.round((cur + Number(amt)) * 100) / 100
      emit('update:modelValue', String(next))
    }

    function onFinish() {
      if (finishDisabled.value) return
      emit('finish', evaluate(props.modelValue))
    }

    return {
      digits, ops, primaryColor, finishDisabled,
      onKey, onOp, onBackspace, onQuick, onFinish,
      evaluate
    }
  }
}
</script>

<style scoped>
.num-keyboard {
  background-color: var(--app-card-2);
  padding: 8rpx;
}

.kb-row {
  display: flex;
  gap: 8rpx;
  margin-bottom: 8rpx;
}

.kb-ops {
  justify-content: flex-start;
}

.kb-op {
  flex: 1;
  height: 80rpx;
  background-color: var(--app-card);
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.kb-op-text {
  font-size: 36rpx;
  color: var(--app-text-2);
  line-height: 1;
}

.kb-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
}

.kb-key {
  width: calc((100% - 16rpx) / 3);
  height: 104rpx;
  background-color: var(--app-card);
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.kb-key-hover {
  background-color: var(--app-line);
}

.kb-key-text {
  font-size: 44rpx;
  color: var(--app-text);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.kb-backspace {
  font-size: 40rpx;
  color: var(--app-text-2);
}

.kb-finish {
  border-radius: 12rpx;
}

.kb-finish-hover {
  opacity: 0.85;
}

.kb-finish-text {
  color: #ffffff;
  font-size: 32rpx;
  font-weight: 500;
}

.kb-quick {
  display: flex;
  gap: 12rpx;
  margin-top: 12rpx;
  padding: 0 4rpx;
  flex-wrap: wrap;
}

.quick-chip {
  padding: 8rpx 24rpx;
  background-color: var(--app-card);
  border-radius: 24rpx;
}

.quick-chip-hover {
  background-color: var(--app-line);
}

.quick-text {
  font-size: 24rpx;
  color: var(--app-text-2);
}
</style>
