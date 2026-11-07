<template>
  <!--
    不计入预算 ｜ 待报销 —— 一行两栏，中间一条竖分割线

    ★ 为什么抽成组件 ★
      这套选框出现在三个地方：交易详情页、记账面板、AI 速记条。
      三处各写一份的后果是「某处改了、另一处没改」——
      而它们表达的是同一个业务规则（勾待报销要自动勾上不计入预算并锁死），
      规则写在组件里就只有一处会错。

    ★ 为什么不用勾选框了（本轮用户要求）★
      用户原话：不要「报销与预算」这种标题和说明文字，
      「直接一个竖的分割线，左边显示不计入预算，右边显示待报销，视觉居中」。
      所以这里去掉小方块勾选框，改成两个可点的文字；
      选中态用主题色表达（见样式里的 .checked），一眼能看出开没开。

    ★ 为什么保留可点击 ★
      用户明确说「仍可点击切换，选中态用主题色表示」——
      这条行既是状态展示，也是手动开关，三处行为必须一致。
  -->
  <view class="flag-row">
    <!-- 不计入预算 -->
    <view
      class="flag-item"
      :class="{ checked: budgetChecked, locked: budgetLocked }"
      @click="onToggleBudget"
    >
      <text class="flag-label">不计入预算</text>
    </view>

    <!-- 竖分割线：只有两个选项都在时才画 -->
    <view v-if="canReimburse" class="flag-divider" />

    <!-- 待报销 / 已报销（只有支出才有意义） -->
    <view
      v-if="canReimburse"
      class="flag-item"
      :class="{ checked: reimburseChecked, locked: reimburseLocked }"
      @click="onToggleReimburse"
    >
      <text class="flag-label">{{ reimburseChecked ? reimburseLabel : '待报销' }}</text>
    </view>
  </view>
</template>

<script>
import { computed } from 'vue'

/**
 * 不计入预算 ｜ 待报销 双栏行
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
 * ★ 规则（用户本轮第 3 条）★
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
         * ★ 双向联动（用户本轮第 3 条）★
         *   勾上 → 自动勾上不计入预算；
         *   取消 → 一起取消，并恢复「不计入预算」可点。
         *   （旧版取消时保留了不计入预算，用户明确否掉了这种半联动。）
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
   *   等宽 + 各自居中后，分割线落在行正中，左右两块文字各自水平居中。
   */
  flex: 1;
  padding: 10rpx 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.flag-label {
  font-size: 26rpx;
  color: var(--app-text-2);
  line-height: 1.2;
}

/* 选中态：主题色文字 + 半粗，不额外加底色（避免和卡片底色打架） */
.flag-item.checked .flag-label {
  color: var(--app-primary);
  font-weight: 500;
}

/* 锁死态：降到第三级文字色，表达「现在改不了」而不是「坏了」 */
.flag-item.locked .flag-label {
  color: var(--app-primary);
  opacity: 0.55;
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
