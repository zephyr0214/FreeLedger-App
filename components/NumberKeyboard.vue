<template>
  <view class="num-keyboard">
    <!--
      4 列 x 5 行
      ┌────┬────┬────┬────┐
      │ C  │ ÷  │ ×  │ ⌫  │
      │ 1  │ 2  │ 3  │ -  │
      │ 4  │ 5  │ 6  │ +  │
      │ 7  │ 8  │ 9  │完成│
      │ () │ 0  │ .  │    │
      └────┴────┴────┴────┘

      「完成」键同时承担求值和保存：
        - 输入是算式（如 12+8）→ 先算出结果再保存
        - 输入是单个数字 → 直接保存
      所有键（除「完成」）样式完全一致：白底、深灰字。
    -->
    <view class="kb-grid">
      <view
        v-for="(k, i) in keys"
        :key="i"
        class="kb-key"
        :class="kbKeyClass(k)"
        hover-class="kb-key-hover"
        @click="onKeyPress(k)"
      >
        <text v-if="k" class="kb-key-text" :class="kbTextClass(k)">{{ k }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import { computed } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { evaluateAmount } from '@/utils/money.js'

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

    /**
     * 4x5 键位表（按行排列，每行 4 个）
     *
     *   C   ÷   ×   ⌫
     *   1   2   3   -
     *   4   5   6   +
     *   7   8   9   完成
     *   ()  0   .   (空)
     *
     * 没有单独的 = 键：「完成」键按下时会先把算式算出结果再保存。
     */
    const keys = [
      'C', '÷', '×', '⌫',
      '1', '2', '3', '-',
      '4', '5', '6', '+',
      '7', '8', '9', '完成',
      '()', '0', '.', ''
    ]

    const OPERATORS = ['+', '-', '×', '÷']
    const isOperator = (k) => OPERATORS.includes(k)

    function kbKeyClass(k) {
      if (k === '完成') return 'kb-finish'
      if (k === '') return 'kb-blank'
      // 除「完成」外，所有键样式完全一致
      return 'kb-plain'
    }

    function kbTextClass(k) {
      if (k === '完成') return 'kb-finish-text'
      return 'kb-plain-text'
    }

    /**
     * 求值：直接复用 utils/money.js 的 evaluateAmount（返回「分」），
     * 避免同一套运算逻辑在两个地方各写一份而不同步。
     * 那里是手写递归下降解析，不用 eval，优先级：括号 > 乘除 > 加减。
     */
    function evaluate(expr) {
      const cents = evaluateAmount(expr)
      return cents / 100
    }

    /** 括号配对检查 */
    function hasUnmatchedParen(expr) {
      let depth = 0
      for (const c of String(expr || '')) {
        if (c === '(') depth++
        else if (c === ')') depth--
        if (depth < 0) return true
      }
      return depth !== 0
    }

    function onKeyPress(k) {
      if (!k) return   // 空白占位键
      if (k === '完成') {
        onFinish()
        return
      }
      if (k === '⌫') {
        onBackspace()
        return
      }
      if (k === 'C') {
        emit('update:modelValue', '')
        return
      }
      if (k === '()') {
        onSmartParen()
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

      // 段边界：运算符和括号都算，"(3" 是一个独立的数字段
      const segOf = (s) => s.split(/[+\-×÷()]/).pop()

      if (k === '.') {
        // 当前段已有小数点则忽略
        const seg = segOf(v)
        if (seg && seg.includes('.')) return
        if (!seg) v += '0'
        v += '.'
      } else {
        // 限制整数部分长度，防止溢出
        const seg = segOf(v)
        if (seg && seg.replace('.', '').length >= 9) return
        // 前导 0 处理
        if (seg === '0') v = v.slice(0, -1)
        v += k
      }
      emit('update:modelValue', v)
    }

    function onOp(op) {
      const v = props.modelValue || ''
      if (!v) {
        // 空输入时按运算符开头无效（金额恒为正）
        return
      }
      // 末尾已是运算符则替换
      if (/[+\-×÷]$/.test(v)) {
        emit('update:modelValue', v.slice(0, -1) + op)
      } else {
        emit('update:modelValue', v + op)
      }
    }

    /**
     * 智能括号键。
     * 一个键同时管左右括号：
     *   - 当前没有未闭合的左括号 → 补 '('
     *   - 已有未闭合的左括号      → 补 ')'
     * 这样用户不用判断该按哪个括号。
     */
    function onSmartParen() {
      const v = props.modelValue || ''

      // 统计未闭合的左括号数
      let depth = 0
      for (const c of v) {
        if (c === '(') depth++
        else if (c === ')') depth--
      }

      if (depth > 0) {
        // 有未闭合的左括号 → 补右括号
        const last = v.slice(-1)
        if (!v || /[+\-×÷(]/.test(last)) return
        emit('update:modelValue', v + ')')
        return
      }

      // 没有未闭合的左括号 → 补左括号
      const last = v.slice(-1)
      if (v && /[0-9.)]/.test(last)) {
        // 前面是数字或右括号时补乘号（隐式乘法）
        emit('update:modelValue', v + '×(')
      } else {
        emit('update:modelValue', v + '(')
      }
    }

    function onBackspace() {
      const v = props.modelValue || ''
      emit('update:modelValue', v.slice(0, -1))
    }

    function onFinish() {
      if (props.disabled || !props.modelValue) return
      const v = props.modelValue
      if (hasUnmatchedParen(v)) {
        emit('finish', -1)   // -1 表示括号不匹配
        return
      }
      emit('finish', evaluate(v))
    }

    return {
      keys, primaryColor, kbKeyClass, kbTextClass,
      onKeyPress, onKey, onOp, onSmartParen, onBackspace, onFinish, evaluate
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
  height: 92rpx;
  background-color: var(--app-card);
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.kb-key-hover {
  background-color: var(--app-line);
}

/* 普通键：除「完成」外全部统一为白底深灰字 */
.kb-plain-text {
  font-size: 36rpx;
  color: var(--app-text-2);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

/* 空白占位 */
.kb-blank {
  background-color: transparent;
}

/* 完成：唯一有别于其他键的样式 */
.kb-finish {
  background-color: var(--app-primary);
}

.kb-finish-text {
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 500;
}
</style>
