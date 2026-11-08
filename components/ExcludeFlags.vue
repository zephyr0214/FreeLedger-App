<template>
  <!--
    不计入预算 ｜ 待报销 —— 一行两栏，中间一条竖分割线

    ★ 为什么抽成组件 ★
      这套选框出现在四个地方：交易详情页、记账面板、周期面板、AI 速记条。
      各写一份的后果是「某处改了、另一处没改」——
      而它们表达的是同一个业务规则（勾待报销要自动勾上不计入预算并锁死），
      规则写在组件里就只有一处会错。

    ★ 为什么用勾选框而不是纯文字（用户要求）★
      布局上保留用户认可的「一条竖分割线居中、左右各一项」，
      但每一项必须由**勾选框 + 文字**组成 ——
      纯文字变色的样式看着像按钮，用户明确否掉了。
  -->
  <view class="flag-row">
    <!-- 不计入预算 -->
    <view
      class="flag-item"
      :class="{ locked: budgetLocked }"
      @click="onToggleBudget"
    >
      <view class="flag-box" :class="{ on: budgetChecked, dim: budgetLocked }">
        <text v-if="budgetChecked" class="flag-tick">✓</text>
      </view>
      <text class="flag-label" :class="{ on: budgetChecked }">不计入预算</text>
    </view>

    <!-- 竖分割线：只有两个选项都在时才画 -->
    <view v-if="canReimburse" class="flag-divider" />

    <!-- 待报销 / 已报销（只有支出才有意义） -->
    <view
      v-if="canReimburse"
      class="flag-item"
      :class="{ locked: reimburseLocked }"
      @click="onToggleReimburse"
    >
      <view class="flag-box" :class="{ on: reimburseChecked, dim: reimburseLocked }">
        <text v-if="reimburseChecked" class="flag-tick">✓</text>
      </view>
      <text class="flag-label" :class="{ on: reimburseChecked }">
        {{ reimburseChecked ? reimburseLabel : '待报销' }}
      </text>
    </view>
  </view>
</template>

<script>
import { computed } from 'vue'

/**
 * 不计入预算 ｜ 待报销 双栏勾选行
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
 * ★ 联动规则 ★
 *   勾上「待报销」→ 自动勾上「不计入预算」并把它锁死（不可点）；
 *   取消「待报销」→ **同时取消**「不计入预算」并解锁（可点）。
 *
 * ★ 已报销（status=2）★
 *   显示成「已报销」并锁死，不允许在这里取消 ——
 *   待报销 → 已报销只能由「报销管理」页完成（AI / 手动记账都不能改）。
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
    /** 已报销时锁死（父层再兜一层，避免调用点忘传 reimburseStatus===2） */
    doneLocked: { type: Boolean, default: false }
  },
  emits: ['update'],
  setup(props, { emit }) {
    const reimburseChecked = computed(() => props.reimburseStatus > 0)
    const reimburseLocked = computed(() => props.reimburseStatus === 2 || props.doneLocked)
    const budgetLocked = computed(() => reimburseChecked.value)
    /** 待报销的状态下「不计入预算」必然是被勾上的（真实值是 props，这里只影响显示） */
    const budgetChecked = computed(() => props.excludeBudget || reimburseChecked.value)
    const reimburseLabel = computed(() => (props.reimburseStatus === 2 ? '已报销' : '待报销'))

    function onToggleReimburse() {
      if (reimburseLocked.value) {
        uni.showToast({ title: '已报销，不能再改', icon: 'none' })
        return
      }
      const next = reimburseChecked.value ? 0 : 1
      emit('update', {
        reimburseStatus: next,
        /*
         * ★ 双向联动 ★
         *   勾上 → 自动勾上不计入预算；
         *   取消 → 一起取消，并恢复「不计入预算」可点。
         */
        excludeBudget: next === 1
      })
    }

    function onToggleBudget() {
      if (budgetLocked.value) {
        uni.showToast({ title: '待报销的账本来就不计入预算', icon: 'none' })
        return
      }
      emit('update', {
        excludeBudget: !props.excludeBudget,
        reimburseStatus: props.reimburseStatus
      })
    }

    return {
      reimburseChecked, reimburseLocked, budgetLocked, budgetChecked, reimburseLabel,
      onToggleReimburse, onToggleBudget
    }
  }
}
</script>

<style scoped>
/*
 * 一行两栏 + 居中
 *
 * 不写 padding：外层（详情页的卡片 / 记账面板的表单行）已经给了横向内边距，
 * 这里再给一次会让左右两端和同卡片里其它行对不齐。
 */
.flag-row {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 72rpx;
}

.flag-item {
  /*
   * 两栏等宽
   *
   * ★ 为什么要 flex:1 ★
   *   「不计入预算」5 个字、「待报销」3 个字，不撑开的话两栏宽度不等，
   *   竖分割线就不在正中间了（用户要求「视觉居中」）。
   *   等宽 + 各自居中后，分割线落在行正中，左右两块各自水平居中。
   */
  flex: 1;
  padding: 10rpx 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
}

/*
 * 自绘勾选框
 *
 * 和预算页的结转勾选、报销管理页的多选圈是同一套视觉语言：
 * 方框 + 主题色实底 + 白色对勾。不用 wd-checkbox ——
 * 组件库那套配色/尺寸和项目其它自绘勾选框不一致。
 */
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

/* 锁死态：勾还在，但压暗一点表示「现在不能取消」 */
.flag-box.dim {
  opacity: 0.6;
}

.flag-tick {
  font-size: 22rpx;
  color: #ffffff;
  line-height: 1;
}

.flag-label {
  font-size: 26rpx;
  color: var(--app-text-2);
  line-height: 1.2;
}

/* 选中态：文字跟着浓郁一点 */
.flag-label.on {
  color: var(--app-text);
}

/* 锁死态整项降权，表达「不能改」而不是「坏了」 */
.flag-item.locked .flag-label {
  color: var(--app-text-3);
}

/* 竖分割线：和详情卡里其它行用的是同一条 --app-line */
.flag-divider {
  width: 1rpx;
  height: 28rpx;
  background-color: var(--app-line);
  margin: 0 16rpx;
  flex-shrink: 0;
}
</style>
