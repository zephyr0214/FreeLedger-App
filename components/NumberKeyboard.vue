<template>
  <view class="num-keyboard">
    <!--
      4 列 x 5 行
      ┌────┬────┬────┬────┐
      │ C  │ ÷  │ ×  │ ⌫  │
      │ 1  │ 2  │ 3  │ -  │
      │ 4  │ 5  │ 6  │ +  │
      │ 7  │ 8  │ 9  │    │
      │ () │ 0  │ .  │完成│
      └────┴────┴────┴────┘
                                  「完成」键占第 4、5 两行。

      ★ 为什么不用 CSS Grid ★
        uni-app 官方说明：App 端是系统 webview 渲染，较老的 Android/iOS
        不支持完整 CSS Grid，只保证 flex（见 uniapp.dcloud.net.cn/matter）。
        所以这里用 flex 实现：左边 3 列 + 右边 1 列（该列底部是跨两行的完成键）。
    -->
    <view class="kb-wrap">
      <!-- 左侧：3 列 x 5 行 -->
      <view class="kb-main">
        <view
          v-for="(k, i) in mainKeys"
          :key="i"
          class="kb-key"
          hover-class="kb-key-hover"
          @click="onKeyPress(k)"
        >
          <text class="kb-key-text kb-plain-text">{{ k }}</text>
        </view>
      </view>

      <!--
        右侧：⌫ / - / + / 完成（完成占最后两行）
        ★「完成」键不能加 kb-side-key ★
          kb-side-key 带 height:92rpx + flex-shrink:0，
          如果「完成」也带这个 class，它的 flex:1 会被 height 压制成 92rpx，
          同时右侧列比左侧矮一整行，布局就错位了。
      -->
      <view class="kb-side">
        <view
          v-for="(k, i) in sideKeys"
          :key="i"
          class="kb-key"
          :class="k === '完成' ? (disabled ? 'kb-finish is-disabled' : 'kb-finish') : 'kb-side-key'"
          hover-class="kb-key-hover"
          @click="onKeyPress(k)"
        >
          <text
            class="kb-key-text"
            :class="k === '完成' ? 'kb-finish-text' : 'kb-plain-text'"
          >{{ k }}</text>
        </view>
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
     * 键位分左右两区。
     *
     * 左侧 3 列 x 5 行 = 15 键
     * 右侧 1 列 = ⌫ / - / + / 完成（完成占两行）
     *
     *   C   ÷   ×   ⌫
     *   1   2   3   -
     *   4   5   6   +
     *   7   8   9   完成   ← 完成占第 4、5 两行
     *   ()  0   .
     */
    const mainKeys = [
      'C', '÷', '×',
      '1', '2', '3',
      '4', '5', '6',
      '7', '8', '9',
      '()', '0', '.'
    ]

    const sideKeys = ['⌫', '-', '+', '完成']

    const OPERATORS = ['+', '-', '×', '÷']
    const isOperator = (k) => OPERATORS.includes(k)

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
      console.log('[kb] key =', k)
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
      console.log('[kb] onFinish, modelValue =', JSON.stringify(props.modelValue), 'disabled =', props.disabled)
      // ★ 不要静默 return ★
      //   之前 disabled 时直接 return，用户点了「完成」毫无反应，
      //   也不知道为什么。改成给出提示。
      if (!props.modelValue) {
        uni.showToast({ title: '请先输入金额', icon: 'none' })
        return
      }
      if (props.disabled) {
        uni.showToast({ title: '请先输入金额', icon: 'none' })
        return
      }
      const v = props.modelValue
      if (hasUnmatchedParen(v)) {
        emit('finish', -1)   // -1 表示括号不匹配
        return
      }
      const result = evaluate(v)
      console.log('[kb] emit finish, value =', result)
      emit('finish', result)
    }

    return {
      mainKeys, sideKeys, primaryColor,
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

/* 整体：左边 3 列 + 右边 1 列 */
.kb-wrap {
  display: flex;
  gap: 8rpx;
}

/* 左侧主区：3 列 x 5 行 */
.kb-main {
  flex: 3;
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
}

/* 右侧列：⌫ / - / + / 完成 */
.kb-side {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.kb-key {
  background-color: var(--app-card);
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.kb-key-hover {
  background-color: var(--app-line);
}

/* 左侧普通键：宽 = 1/3，固定行高 */
.kb-main .kb-key {
  width: calc((100% - 16rpx) / 3);
  height: 92rpx;
}

/* 右侧普通键（⌫ - +）：与左侧同高 */
.kb-side-key {
  height: 92rpx;
  flex-shrink: 0;
}

/* 普通键：除「完成」外全部统一为白底深灰字 */
.kb-plain-text {
  font-size: 36rpx;
  color: var(--app-text-2);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

/**
 * 完成：唯一有别于其他键的样式。
 * 高度由 flex:1 撑满右侧剩余空间（正好两行），
 * 不能设 height —— 那样 flex:1 会失效。
 */
.kb-finish {
  background-color: var(--app-primary);
  flex: 1;
  min-height: 0;
  flex-shrink: 1;
}

/* 金额没填时「完成」键置灰，让用户知道它现在不可用 */
.kb-finish.is-disabled {
  background-color: var(--app-line);
}

.kb-finish.is-disabled .kb-finish-text {
  color: var(--app-text-3);
}

.kb-finish-text {
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 500;
}
</style>
