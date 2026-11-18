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
          <text class="bs-amount" :class="{ 'bs-amount--raw': isExpression, 'bs-amount--empty': !draft }">
            {{ amountDisplay || '0.00' }}
          </text>
        </view>
        <!-- 原始余额灰色显示在底部：不输入新值时直接沿用 -->
        <text class="bs-original">当前余额 {{ originalBalanceText }}</text>
        <text v-if="isExpression" class="bs-preview">= {{ computedPreview }}</text>

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

      <!--
        记账面板同款数字键盘
        ★ 没有取消/确定按钮 ★
          用户要求「去掉取消和确定，换成记账面板的输入区」，
          键盘右下角的「保存」就是提交入口，右上角 ✕ 仍可退出。
        ★ 允许负数 ★
          信用卡欠款余额是负的，且支持 1000-200 这类四则运算。
      -->
      <view class="bs-keyboard">
        <NumberKeyboard
          v-model="draft"
          finish-text="保存"
          allow-negative
          allow-empty
          @submit-amount="onKeyboardFinish"
        />
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
import { useAccountStore } from '@/stores/account.js'
import { adjustAccountBalance, setAccountBalanceDirect } from '@/api/account.js'
import { evaluateSignedAmount, formatCents } from '@/utils/money.js'
import NumberKeyboard from '@/components/NumberKeyboard.vue'
import { BASE_SYMBOL } from '@/utils/currency.js'
import { alertDialog } from '@/utils/dialog.js'
import { pushLayer, handleBackPress } from '@/utils/layerStack.js'

export default {
  name: 'BalanceSheet',
  components: { NumberKeyboard },
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
    const accountStore = useAccountStore()

    /** 弹层里正在输入的金额算式（元，字符串，可含 + - × ÷ 和括号） */
    const draft = ref('')
    /** 口径：'reconcile' | 'direct' */
    const mode = ref('reconcile')

    /*
     * ★ 输入框左边的币种符号定死为 ¥ ★
     *   原来读 settingStore.currencySymbol（个人信息页可改），
     *   但本位币恒为人民币，符号跟着用户改只会自相矛盾，
     *   那个输入框已按用户要求删除。
     */
    const currencySymbol = BASE_SYMBOL

    /** 两种口径的说明 */
    const modes = [
      { key: 'reconcile', label: '计入对账收支' },
      { key: 'direct', label: '修改当前余额' }
    ]

    /** 输入的金额（分，可为负）；没输入时沿用原始余额 */
    const targetCents = computed(() => {
      if (!String(draft.value || '').trim()) return props.currentBalanceCents || 0
      const cents = evaluateSignedAmount(draft.value)
      return Number.isFinite(cents) ? cents : 0
    })

    /** 原始余额（灰色提示用） */
    const originalBalanceText = computed(() => {
      const cents = props.currentBalanceCents || 0
      return `${cents < 0 ? '-' : ''}${formatCents(Math.abs(cents), { symbol: currencySymbol })}`
    })

    /** 输入区展示：纯数字补两位小数，算式原样显示 */
    const amountDisplay = computed(() => {
      const raw = String(draft.value || '').trim()
      if (!raw) return ''
      if (!isExpression.value) {
        const n = Number(raw)
        if (Number.isFinite(n)) return n.toFixed(2)
      }
      return raw
    })

    /**
     * 是否是算式
     *
     * 开头的负号不算算式（-500 是普通数字），
     * 这样负余额打开时直接显示 -500.00，而不是「-500 = -500.00」两行。
     */
    const isExpression = computed(() => {
      const raw = String(draft.value || '').trim()
      return /[+×÷()]/.test(raw) || /-/.test(raw.slice(1))
    })

    /** 算式结果预览 */
    const computedPreview = computed(() => {
      const cents = targetCents.value
      return `${cents < 0 ? '-' : ''}${formatCents(Math.abs(cents), { symbol: currencySymbol })}`
    })
    /** 差额（分） */
    const diffCents = computed(() => targetCents.value - (props.currentBalanceCents || 0))
    const diffText = computed(() => {
      const d = diffCents.value
      if (d === 0) return '无变化'
      return `${d > 0 ? '+' : '-'}${formatCents(Math.abs(d), { symbol: currencySymbol })}`
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
        if (!open) return
        // 不预填原始余额：输入区保持空白，原始值在下方灰色提示
        draft.value = ''
        mode.value = 'reconcile'
      }
    )

    function close() {
      emit('update:visible', false)
    }

    /** 键盘「保存」：把元换算成分后走原来的落库逻辑 */
    function onKeyboardFinish(value) {
      // 没输入新值时沿用原始余额（键盘对空输入会回传 0，不能直接用）
      if (!String(draft.value || '').trim()) {
        confirm(props.currentBalanceCents || 0)
        return
      }
      if (value === -1) {
        uni.showToast({ title: '算式括号不匹配', icon: 'none' })
        return
      }
      if (!Number.isFinite(value)) {
        uni.showToast({ title: '算式无效', icon: 'none' })
        return
      }
      confirm(Math.round(value * 100))
    }

    async function confirm(target) {
      if (!props.accountId) return

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
      draft, mode, modes, currencySymbol,
      amountDisplay, isExpression, computedPreview, originalBalanceText,
      targetCents, diffCents, diffText, diffColor,
      close, onKeyboardFinish, handleBackPress
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
  max-height: 92vh;
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
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8rpx 32rpx 24rpx;
}

/* 金额展示：和记账面板同款大字号 + 货币符号 */
.bs-amount-row {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  padding: 20rpx 0 8rpx;
  border-bottom: 1rpx solid var(--app-line);
  min-height: 92rpx;
}

.bs-currency {
  font-size: 34rpx;
  color: var(--app-text-2);
  flex-shrink: 0;
}

.bs-amount {
  flex: 1;
  min-width: 0;
  font-size: 56rpx;
  font-weight: 600;
  color: var(--app-text);
  line-height: 1.2;
  word-break: break-all;
}

/* 算式原样显示时字号小一档，避免长算式撑破一行 */
.bs-amount--raw {
  font-size: 44rpx;
}

/* 没输入时显示占位 0.00，用灰色区分「这是占位，不是已填金额」 */
.bs-amount--empty {
  color: var(--app-text-3);
}

.bs-original {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--app-text-3);
}

.bs-preview {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--app-text-3);
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

/* 数字键盘：底部留安全区，避免被手势条压住 */
.bs-keyboard {
  flex-shrink: 0;
  padding-bottom: env(safe-area-inset-bottom);
  background-color: var(--app-card-2);
}
</style>
