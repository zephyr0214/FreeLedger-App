<template>
  <!--
    余额修改弹层

    ★ 为什么做成组件 ★
      账户详情页和账户编辑页都要用这套弹层
      （金额输入 + 两种口径的单选 + 差额预览）。
      写成组件后，改一处两边都生效，不会出现
      「详情页改了、编辑页还是老样子」。

    ★ 两种口径 ★
      · 计入对账收支（默认）—— 差额记一笔「对账支出 / 对账收入」流水，
        余额公式（期初 + 收入 - 支出）仍然成立，流水里看得见这笔调整。
      · 修改当前余额 —— 直接改期初余额，不产生任何流水。
  -->
  <view v-if="visible" class="bs-mask" @click="close">
    <view class="bs-sheet" @click.stop>
      <view class="bs-head">
        <text class="bs-title">修改余额</text>
        <text class="bs-close" @click="close">✕</text>
      </view>

      <view class="bs-body">
        <view class="bs-amount-row">
          <text class="bs-currency">{{ currencySymbol }}</text>
          <input
            v-model="draft"
            class="bs-input"
            type="digit"
            placeholder="0.00"
            placeholder-class="bs-placeholder"
            :focus="autoFocus"
          />
        </view>

        <!-- 差额预览：让用户改之前就知道会发生什么 -->
        <view class="bs-diff">
          <text class="bs-diff-label">相对当前余额</text>
          <text
            class="bs-diff-value"
            :style="{ color: diffColor }"
          >{{ diffText }}</text>
        </view>

        <view class="bs-options">
          <view
            v-for="opt in modes"
            :key="opt.key"
            class="bs-option"
            @click="mode = opt.key"
          >
            <!-- 单选圆圈：不引第三方单选组件，避免和弹层层级打架 -->
            <view class="bs-radio" :class="{ checked: mode === opt.key }">
              <view v-if="mode === opt.key" class="bs-radio-dot" />
            </view>
            <view class="bs-option-text">
              <text class="bs-option-label">{{ opt.label }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="bs-foot">
        <view class="bs-btn-cancel" @click="close">取消</view>
        <view class="bs-btn-ok" :style="{ backgroundColor: primaryColor }" @click="confirm">确定</view>
      </view>
    </view>
  </view>
</template>

<script>
/**
 * 余额修改弹层（账户详情页 / 账户编辑页共用）
 *
 * 用法：
 *   <BalanceSheet
 *     v-model:visible="showBalanceSheet"
 *     :account-id="accountId"
 *     :current-balance-cents="account.balance_cents"
 *     @saved="onBalanceSaved"
 *   />
 *
 * ★ 组件自己负责落库 ★
 *   调 API（按口径走 adjustAccountBalance / setAccountBalanceDirect）、
 *   刷账户 store、弹提示，都在组件内部做完，
 *   页面只管一个 @saved 回调去刷新自己的显示。
 */
import { ref, computed, watch, onUnmounted } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { adjustAccountBalance, setAccountBalanceDirect } from '@/api/account.js'
import { yuanToCents, formatCents } from '@/utils/money.js'
import { alertDialog } from '@/utils/dialog.js'
import { pushLayer, handleBackPress } from '@/utils/layerStack.js'

export default {
  name: 'BalanceSheet',
  props: {
    /** 弹层是否显示（v-model:visible） */
    visible: { type: Boolean, default: false },
    /** 要改余额的账户 id */
    accountId: { type: String, default: '' },
    /** 当前余额（分）—— 用于算差额预览 */
    currentBalanceCents: { type: Number, default: 0 }
  },
  emits: ['update:visible', 'saved'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    /** 弹层里正在输入的金额（元，字符串） */
    const draft = ref('')
    /** 口径：'reconcile' | 'direct' */
    const mode = ref('reconcile')
    /** 打开时自动聚焦金额输入框 */
    const autoFocus = ref(false)

    const primaryColor = computed(() => settingStore.primaryColor)
    const currencySymbol = computed(() => settingStore.currencySymbol)

    /** 两种口径的说明 */
    const modes = [
      { key: 'reconcile', label: '计入对账收支' },
      { key: 'direct', label: '修改当前余额' }
    ]

    /** 输入的金额（分） */
    const targetCents = computed(() => yuanToCents(draft.value || 0))
    /** 差额（分） */
    const diffCents = computed(() => targetCents.value - (props.currentBalanceCents || 0))
    const diffText = computed(() => {
      const d = diffCents.value
      if (d === 0) return '无变化'
      return `${d > 0 ? '+' : '-'}${formatCents(Math.abs(d), { symbol: currencySymbol.value })}`
    })
    const diffColor = computed(() => {
      if (diffCents.value === 0) return 'var(--app-text-3)'
      return diffCents.value > 0 ? 'var(--app-income, #07C160)' : 'var(--app-danger)'
    })

    /**
     * 打开时预填当前余额 + 重置口径。
     *
     * ★ 口径每次都重置成「计入对账收支」★
     *   这是默认口径（差额留痕，账对得上）。
     *   用户主动切到「修改当前余额」说明他知道自己在干什么，
     *   不该让上一次的选择「粘」到这一次。
     */
    watch(
      () => props.visible,
      (open) => {
        if (!open) {
          autoFocus.value = false
          return
        }
        draft.value = ((props.currentBalanceCents || 0) / 100).toFixed(2)
        mode.value = 'reconcile'
        autoFocus.value = false
        // 下一帧再聚焦：弹层刚渲染时 input 还不存在，直接 true 不生效
        setTimeout(() => { autoFocus.value = true }, 60)
      }
    )

    function close() {
      emit('update:visible', false)
    }

    async function confirm() {
      if (!props.accountId) return

      const target = targetCents.value
      const current = props.currentBalanceCents || 0
      if (target === current) {
        close()
        uni.showToast({ title: '余额没有变化', icon: 'none' })
        return
      }

      try {
        let res
        if (mode.value === 'reconcile') {
          res = await adjustAccountBalance(props.accountId, target)
        } else {
          res = await setAccountBalanceDirect(props.accountId, target)
        }

        await accountStore.refresh()
        close()
        emit('saved', res)

        if (res && res.changed) {
          const diff = res.delta
          uni.showToast({
            title: `${mode.value === 'reconcile' ? '已记对账' : '已改余额'} ${diff > 0 ? '+' : ''}${(diff / 100).toFixed(2)}`,
            icon: 'none'
          })
        } else {
          uni.showToast({ title: '已保存', icon: 'none' })
        }
      } catch (e) {
        await alertDialog({ title: '修改失败', content: e.message })
      }
    }

    /**
     * 弹层登记进弹层栈。
     *
     * ★ 为什么要登记 ★
     *   全面屏左缘右滑 / 安卓返回键应该先收起这个弹层，
     *   而不是直接退出整个页面、把用户输了一半的金额丢掉。
     */
    let unregister = null
    watch(
      () => props.visible,
      (open) => {
        if (open) {
          if (!unregister) {
            unregister = pushLayer(() => { emit('update:visible', false) }, 'balanceSheet')
          }
          return
        }
        if (unregister) {
          unregister()
          unregister = null
        }
      }
    )

    onUnmounted(() => {
      if (unregister) {
        unregister()
        unregister = null
      }
    })

    return {
      draft, mode, autoFocus, modes, primaryColor, currencySymbol,
      targetCents, diffCents, diffText, diffColor,
      close, confirm, handleBackPress
    }
  }
}
</script>

<style scoped>
.bs-mask {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.45);
  /*
   * ★ z-index 用 9 ★
   *   项目的层级约定（见 scripts/check-layout.mjs）：
   *     页面内自绘浮层 1~9，
   *     wot 组件库的弹层默认 15，
   *     AppDialog 的确认框是 1000。
   *   本弹层要低于库弹层，
   *   这样「修改失败」时弹出的 AppDialog 能盖在它上面。
   */
  z-index: 9;
  display: flex;
  align-items: flex-end;
}

.bs-sheet {
  width: 100%;
  background-color: var(--app-bg);
  border-radius: 28rpx 28rpx 0 0;
  display: flex;
  flex-direction: column;
  max-height: 86vh;
}

.bs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx 16rpx;
}

.bs-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
}

.bs-close {
  font-size: 32rpx;
  color: var(--app-text-3);
  padding: 8rpx;
}

.bs-body {
  padding: 8rpx 32rpx 24rpx;
}

/* 金额输入：大字号 + 货币符号 */
.bs-amount-row {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  padding: 20rpx 0 16rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.bs-currency {
  font-size: 34rpx;
  color: var(--app-text-2);
  flex-shrink: 0;
}

.bs-input {
  flex: 1;
  min-width: 0;
  width: 0;
  font-size: 56rpx;
  font-weight: 600;
  color: var(--app-text);
  text-align: left;
  line-height: 1.2;
}

.bs-placeholder {
  color: var(--app-text-3);
  font-size: 56rpx;
  font-weight: 600;
}

/* 差额预览 */
.bs-diff {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 0;
}

.bs-diff-label {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.bs-diff-value {
  font-size: 26rpx;
  font-weight: 500;
}

/* 口径单选 */
.bs-options {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
}

.bs-option {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 26rpx 24rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.bs-option:last-child {
  border-bottom: none;
}

.bs-radio {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 2rpx solid var(--app-text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.bs-radio.checked {
  border-color: var(--app-primary);
}

.bs-radio-dot {
  width: 22rpx;
  height: 22rpx;
  border-radius: 50%;
  background-color: var(--app-primary);
}

.bs-option-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  min-width: 0;
}

.bs-option-label {
  font-size: 28rpx;
  color: var(--app-text);
}

/* 底部按钮 */
.bs-foot {
  display: flex;
  gap: 20rpx;
  padding: 16rpx 32rpx calc(16rpx + env(safe-area-inset-bottom));
}

.bs-btn-cancel,
.bs-btn-ok {
  flex: 1;
  height: 88rpx;
  border-radius: 22rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  font-weight: 600;
}

/*
 * 取消按钮
 *
 * ★ 必须有可见的外框 ★
 *   原来是 --app-card-2 底色，和弹层背景 --app-bg 太接近，
 *   看着像「没有边框、和背景融成一片」。
 *   现在给一条实色描边，任何主题下边界都清楚。
 */
.bs-btn-cancel {
  background-color: var(--app-card);
  color: var(--app-text-2);
  border: 2rpx solid var(--app-line);
}

.bs-btn-ok {
  color: #ffffff;
}
</style>
