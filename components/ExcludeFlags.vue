<template>
  <!--
    不计预算 / 待报销 双选框

    ★ 为什么抽成组件 ★
      这套选框出现在三个地方：交易详情页、记账面板、AI 速记条。
      三处各写一份的后果是「某处改了、另一处没改」——
      而它们表达的是同一个业务规则（第 6 条：勾待报销要自动勾上不计预算并锁死），
      规则写在组件里就只有一处会错。

    ★ 为什么不直接用 wd-checkbox ★
      组件库的复选框有自己的一套配色和尺寸，和项目里自绘的
      .check-box（预算页结转勾选用的是同一套）不一致；
      而且「锁死」状态下还要显示一条浅色说明，组件库那套塞不进去。
  -->
  <view class="flag-row">
    <!-- 不计预算 -->
    <view
      class="flag-item"
      :class="{ checked: budgetChecked, locked: budgetLocked }"
      @click="onToggleBudget"
    >
      <view class="flag-box" :class="{ on: budgetChecked }">
        <text v-if="budgetChecked" class="flag-tick">✓</text>
      </view>
      <text class="flag-label">不计预算</text>
      <text v-if="budgetLocked" class="flag-lock">·</text>
    </view>

    <!-- 待报销（只有支出才有意义） -->
    <view
      v-if="canReimburse"
      class="flag-item"
      :class="{ checked: reimburseChecked, locked: reimburseLocked }"
      @click="onToggleReimburse"
    >
      <view class="flag-box" :class="{ on: reimburseChecked }">
        <text v-if="reimburseChecked" class="flag-tick">✓</text>
      </view>
      <text class="flag-label">{{ reimburseChecked ? reimburseLabel : '待报销' }}</text>
    </view>
  </view>
</template>

<script>
import { computed } from 'vue'

/**
 * 不计预算 / 待报销 双选框
 *
 * 用法：
 *   <ExcludeFlags
 *     :exclude-budget="form.excludeBudget"
 *     :reimburse-status="form.reimburseStatus"
 *     :can-reimburse="form.type === 'expense'"
 *     @update="onFlagsChange"
 *   />
 *
 * 事件载荷：{ excludeBudget: boolean, reimburseStatus: 0|1|2 }
 *
 * ★ 规则（用户第 6 条）★
 *   勾上「待报销」→ 自动勾上「不计预算」并把它锁死；
 *   取消「待报销」→ 解除锁死，但**不自动取消**「不计预算」
 *   （用户可能本来就想同时排除预算，替他清掉是越权）。
 */
export default {
  name: 'ExcludeFlags',
  props: {
    /** 是否不计入预算 */
    excludeBudget: { type: Boolean, default: false },
    /** 报销状态：0 不报销 / 1 待报销 / 2 已报销 */
    reimburseStatus: { type: Number, default: 0 },
    /** 是否显示「待报销」（只有支出生效） */
    canReimburse: { type: Boolean, default: false },
    /**
     * 已报销时锁死
     *
     * ★ 用户第 3 条要求 ★
     *   「已报销的交易详情页面的待报销显示为显示已报销，锁死不可取消勾选」
     */
    doneLocked: { type: Boolean, default: false }
  },
  emits: ['update'],
  setup(props, { emit }) {
    const reimburseChecked = computed(() => props.reimburseStatus > 0)
    const reimburseLocked = computed(() => props.reimburseStatus === 2 || props.doneLocked)
    const budgetLocked = computed(() => reimburseChecked.value)
    const reimburseLabel = computed(() => (props.reimburseStatus === 2 ? '已报销' : '待报销'))

    function onToggleReimburse() {
      if (reimburseLocked.value) {
        uni.showToast({ title: '已报销，不能再改', icon: 'none' })
        return
      }
      const next = reimburseChecked.value ? 0 : 1
      emit('update', {
        reimburseStatus: next,
        // 规则：勾上待报销 → 自动勾上不计预算；取消时不反向取消
        excludeBudget: next === 1 ? true : props.excludeBudget
      })
    }

    function onToggleBudget() {
      if (budgetLocked.value) {
        uni.showToast({ title: '待报销的账本来就不计预算', icon: 'none' })
        return
      }
      emit('update', {
        excludeBudget: !props.excludeBudget,
        reimburseStatus: props.reimburseStatus
      })
    }

    return {
      reimburseChecked, reimburseLocked, budgetLocked, reimburseLabel,
      onToggleReimburse, onToggleBudget
    }
  }
}
</script>

<style scoped>
.flag-row {
  display: flex;
  align-items: center;
  gap: 48rpx;
  flex-wrap: wrap;
}

.flag-item {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

/* 自绘复选框：与预算页的结转勾选同一套视觉 */
.flag-box {
  width: 36rpx;
  height: 36rpx;
  border-radius: 8rpx;
  border: 2rpx solid var(--app-line);
  background-color: var(--app-card);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.flag-box.on {
  background-color: var(--app-primary);
  border-color: var(--app-primary);
}

.flag-tick {
  font-size: 22rpx;
  color: #ffffff;
  line-height: 1;
}

.flag-label {
  font-size: 26rpx;
  color: var(--app-text-2);
}

/* 选中态：文字也跟着浓郁一点，一眼看出是打开了的 */
.flag-item.checked .flag-label {
  color: var(--app-text);
}

/* 锁死态：整组降到次要色，表示「不能改」而不是「坏了」 */
.flag-item.locked .flag-label {
  color: var(--app-text-3);
}

.flag-item.locked .flag-box {
  opacity: 0.85;
}

.flag-lock {
  font-size: 22rpx;
  color: var(--app-text-3);
}
</style>
