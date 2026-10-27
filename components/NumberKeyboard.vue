<template>
  <view class="num-keyboard">
    <!--
      4 列 x 4 行 = 16 个键
      ┌────┬────┬────┬────┐
      │ 1  │ 2  │ 3  │ ⌫  │  退格
      │ 4  │ 5  │ 6  │ 7  │
      │ 8  │ 9  │ 0  │ .  │  小数点
      │ +  │ -  │ =  │完成 │  运算符 + 确认
      └────┴────┴────┴────┘
    -->
    <view class="kb-grid">
      <view
        v-for="k in keys"
        :key="k"
        class="kb-key"
        :class="kbKeyClass(k)"
        hover-class="kb-key-hover"
        @click="onKeyPress(k)"
      >
        <text class="kb-key-text" :class="kbTextClass(k)">{{ k }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import { computed } from 'vue'
import { useSettingStore } from '@/stores/setting.js'

export default {
  name: 'NumberKeyboard',
  props: {
    /** 当前输入的原始字符串，如 "12.5" 或算式 "12+8" */
    modelValue: { type: String, default: '' },
    /** 完成按钮文字 */
    finishText: { type: String, default: '完成' },
    /** 禁用完成 */
    disabled: { type: Boolean, default: false }
  },
  emits: ['update:modelValue', 'finish'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const primaryColor = computed(() => settingStore.primaryColor)

    /** 4x4 键位表：前三行是数字/退格/小数点，最后一行是运算符和确认 */
    const keys = ['1', '2', '3', '⌫', '4', '5', '6', '7', '8', '9', '0', '.', '+', '-', '=', '完成']

    const OPERATORS = ['+', '-', '=']
    const isOperator = (k) => OPERATORS.includes(k)

    function kbKeyClass(k) {
      if (k === '完成') return 'kb-finish'
      if (isOperator(k)) return 'kb-op'
      if (k === '⌫') return 'kb-backspace'
      return ''
    }

    function kbTextClass(k) {
      if (k === '完成') return 'kb-finish-text'
      if (isOperator(k)) return 'kb-op-text'
      if (k === '⌫') return 'kb-backspace-text'
      return ''
    }

    /** 安全求值：只允许数字与 + -，不用 eval */
    function evaluate(expr) {
      const s = String(expr).replace(/[^0-9+\-.]/g, '')
      if (!s) return 0
      const tokens = s.match(/[+\-]?[0-9.]+/g) || []
      let total = 0
      for (const tk of tokens) {
        const n = Number(tk)
        if (Number.isFinite(n)) total += n
      }
      return Math.max(0, total)
    }

    function onKeyPress(k) {
      if (k === '完成') {
        onFinish()
        return
      }
      if (k === '⌫') {
        onBackspace()
        return
      }
      if (isOperator(k)) {
        onOp(k)
        return
      }
      onKey(k)
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

    function onFinish() {
      if (props.disabled || !props.modelValue) return
      emit('finish', evaluate(props.modelValue))
    }

    return {
      keys, primaryColor, kbKeyClass, kbTextClass,
      onKeyPress, onKey, onOp, onBackspace, onFinish, evaluate
    }
  }
}
</script>

<style scoped>
.num-keyboard {
  background-color: var(--app-card-2);
  padding: 8rpx;
}

/* 4 列固定网格 */
.kb-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
}

.kb-key {
  width: calc((100% - 24rpx) / 4);
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
  font-size: 40rpx;
  color: var(--app-text);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

/* 运算符 */
.kb-op {
  background-color: var(--app-card-2);
}

.kb-op-text {
  font-size: 36rpx;
  color: var(--app-text-2);
}

/* 退格 */
.kb-backspace-text {
  font-size: 34rpx;
  color: var(--app-text-2);
}

/* 完成 */
.kb-finish {
  background-color: var(--app-primary);
}

.kb-finish-text {
  color: #ffffff;
  font-size: 30rpx;
  font-weight: 500;
}
</style>
