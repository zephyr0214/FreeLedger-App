<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="goBack">‹</text>
        <text class="nav-title">账户详情</text>
        <text class="nav-action" @click="goEdit">编辑</text>
      </view>
    </view>

    <scroll-view v-if="account" class="page-scroll" scroll-y>
      <!-- 余额头 -->
      <view class="balance-card">
        <view class="bal-head">
          <view class="bal-icon" :style="{ backgroundColor: (account.color || primaryColor) + '22' }">
            <text class="bal-icon-text" :style="{ color: account.color || primaryColor }">
              {{ account.name.slice(0, 1) }}
            </text>
          </view>
          <view class="bal-info">
            <view class="bal-name-row">
              <text class="bal-name">{{ account.name }}</text>
              <text v-if="account.card_tail" class="bal-tail">*{{ account.card_tail }}</text>
            </view>
            <text class="bal-type">{{ account.typeName }}</text>
          </view>
        </view>

        <text class="bal-label">当前余额</text>
        <MoneyText
          :cents="account.balance_cents"
          :size="80"
          :weight="600"
          :color="account.balance_cents < 0 ? 'var(--app-danger)' : 'var(--app-text)'"
        />

        <!-- 信用卡信息 -->
        <view v-if="account.isCredit && account.credit_limit_cents" class="credit-info">
          <view class="credit-row">
            <text class="credit-label">信用额度</text>
            <MoneyText :cents="account.credit_limit_cents" :size="26" color="var(--app-text-2)" />
          </view>
          <view class="credit-row">
            <text class="credit-label">已用额度</text>
            <text class="credit-value">
              {{ usedPercent }}%
            </text>
          </view>
          <view class="credit-bar">
            <view
              class="credit-fill"
              :style="{
                width: Math.min(usedPercent, 100) + '%',
                backgroundColor: usedPercent > 80 ? 'var(--app-danger)' : primaryColor
              }"
            />
          </view>
          <view v-if="account.repay_day" class="credit-row">
            <text class="credit-label">还款日</text>
            <text class="credit-value">{{ account.repay_day }} 号（{{ repayCountdown }}）</text>
          </view>
        </view>
      </view>

      <!-- 本月收支 -->
      <view class="month-card">
        <view class="month-item">
          <text class="month-label">本月支出</text>
          <MoneyText :cents="monthStats.expense" :size="32" :weight="500" color="var(--app-text)" />
        </view>
        <view class="month-divider" />
        <view class="month-item">
          <text class="month-label">本月收入</text>
          <MoneyText :cents="monthStats.income" :size="32" :weight="500" color="var(--app-success)" />
        </view>
      </view>

      <!-- 流水 -->
      <view class="section-head">
        <text class="section-title">最近流水</text>
        <text class="section-more" @click="goAllTxn">全部 ›</text>
      </view>

      <view v-if="txnList.length === 0" class="empty-wrap">
        <EmptyState emoji="📭" title="暂无流水" desc="这个账户还没有交易记录" compact />
      </view>

      <view v-else class="txn-list">
        <view
          v-for="txn in txnList"
          :key="txn.id"
          class="txn-item"
          @click="goTxnDetail(txn.id)"
        >
          <view
            class="txn-icon"
            :style="{ backgroundColor: (txn.category_color || '#969799') + '22' }"
          >
            <text class="txn-icon-text" :style="{ color: txn.category_color || '#969799' }">
              {{ iconChar(txn) }}
            </text>
          </view>
          <view class="txn-info">
            <text class="txn-name">{{ txnTitle(txn) }}</text>
            <text class="txn-sub">{{ shortDay(txn.occurred_day) }}</text>
          </view>
          <MoneyText
            :cents="txnAmount(txn)"
            :size="28"
            :weight="500"
            :sign="true"
            :color="txnAmount(txn) > 0 ? 'var(--app-success)' : 'var(--app-text)'"
          />
        </view>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <view v-else class="loading-wrap">
      <text class="loading-text">加载中…</text>
    </view>
  </view>
</template>

<script>
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { listTransactions, sumTransactions } from '@/api/transaction.js'
import { daysUntilMonthDay, toMonthKey, formatDayHeader } from '@/utils/date.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'

export default {
  components: { MoneyText, EmptyState },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20
    const accountId = ref('')
    const account = ref(null)
    const txnList = ref([])
    const monthStats = ref({ expense: 0, income: 0 })

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)


    const usedPercent = computed(() => {
      if (!account.value || !account.value.credit_limit_cents) return 0
      const used = Math.abs(account.value.balance_cents)
      return Math.round((used / account.value.credit_limit_cents) * 100)
    })

    const repayCountdown = computed(() => {
      if (!account.value || !account.value.repay_day) return ''
      const d = daysUntilMonthDay(account.value.repay_day)
      if (d === 0) return '今天'
      return `${d} 天后`
    })

    function iconChar(txn) {
      if (txn.type === 'transfer') return '⇄'
      return txn.category_icon
        ? iconEmoji(txn.category_icon)
        : guessIconByName(txn.category_name)
    }

    function txnTitle(txn) {
      if (txn.type === 'transfer') {
        return txn.account_id === accountId.value
          ? `转出至 ${txn.to_account_name || '-'}`
          : `来自 ${txn.account_name || '-'}`
      }
      return txn.category_name || '未分类'
    }

    /** 从该账户视角看的方向：支出为负，收入/转入为正 */
    function txnAmount(txn) {
      if (txn.type === 'income') return txn.amount_cents
      if (txn.type === 'transfer') {
        return txn.account_id === accountId.value ? -txn.amount_cents : txn.amount_cents
      }
      return -txn.amount_cents
    }

    function shortDay(dayKey) {
      const [, m, d] = dayKey.split('-')
      return `${Number(m)}/${Number(d)}`
    }

    async function load() {
      const acc = await accountStore.getById(accountId.value)
      if (!acc) return
      account.value = acc

      const [list, sum] = await Promise.all([
        listTransactions({ accountId: accountId.value, limit: 30 }),
        sumTransactions({ accountId: accountId.value, monthKey: toMonthKey() })
      ])
      txnList.value = list
      monthStats.value = { expense: sum.expense, income: sum.income }
    }

    function goEdit() {
      uni.navigateTo({ url: `/pages/account/edit?id=${accountId.value}` })
    }

    function goTxnDetail(id) {
      uni.navigateTo({ url: `/pages/txn/detail?id=${id}` })
    }

    function goAllTxn() {
      uni.navigateTo({ url: '/pages/txn/list' })
    }

    function goBack() {
      uni.navigateBack()
    }

    // 用 onLoad(options) 取参数，比 getCurrentPages().options 可靠
    onLoad(async (options) => {
      accountId.value = (options && options.id) || ''
      if (!settingStore.loaded) await settingStore.load()
      await accountStore.load()
      if (accountId.value) await load()
    })

    onShow(async () => {
      settingStore.syncSystemTheme()
      if (accountId.value && settingStore.loaded) {
        await accountStore.refresh()
        await load()
      }
    })

    return {
      settingStore, statusBarHeight, account, txnList, monthStats,
      primaryColor, pageStyle, usedPercent, repayCountdown,
      iconChar, txnTitle, txnAmount, shortDay,
      goEdit, goTxnDetail, goAllTxn, goBack
    }
  }
}
</script>

<style scoped>
.nav-bar {
  background-color: var(--app-bg);
  flex-shrink: 0;
}

.nav-inner {
  height: 88rpx;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
}

.nav-back {
  font-size: 48rpx;
  color: var(--app-text);
  width: 100rpx;
  line-height: 1;
}

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.nav-action {
  font-size: 28rpx;
  color: var(--app-primary);
  width: 100rpx;
  text-align: right;
}

.page-scroll {
  padding: 0 32rpx;
}

/* 余额卡 */
.balance-card {
  background: linear-gradient(135deg, var(--app-primary-light), var(--app-card));
  border-radius: 24rpx;
  padding: 32rpx;
  margin-top: 16rpx;
  box-shadow: var(--app-shadow);
}

.bal-head {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-bottom: 32rpx;
}

.bal-icon {
  width: 88rpx;
  height: 88rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bal-icon-text {
  font-size: 36rpx;
  font-weight: 600;
}

.bal-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.bal-name-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.bal-name {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.bal-tail {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.bal-type {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.bal-label {
  font-size: 24rpx;
  color: var(--app-text-3);
  display: block;
  margin-bottom: 8rpx;
}

/* 信用卡 */
.credit-info {
  margin-top: 32rpx;
  padding-top: 24rpx;
  border-top: 1rpx solid var(--app-line);
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.credit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.credit-label {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.credit-value {
  font-size: 26rpx;
  color: var(--app-text-2);
}

.credit-bar {
  height: 10rpx;
  background-color: var(--app-card-2);
  border-radius: 5rpx;
  overflow: hidden;
}

.credit-fill {
  height: 100%;
  border-radius: 5rpx;
}

/* 本月 */
.month-card {
  display: flex;
  align-items: center;
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 28rpx 0;
  margin-top: 20rpx;
}

.month-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.month-label {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.month-divider {
  width: 1rpx;
  height: 48rpx;
  background-color: var(--app-line);
}

/* 区块 */
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 32rpx;
  margin-bottom: 12rpx;
  padding: 0 4rpx;
}

.section-title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--app-text);
}

.section-more {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.txn-list {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
}

.txn-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx 28rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.txn-item:last-child {
  border-bottom: none;
}

.txn-icon {
  width: 68rpx;
  height: 68rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.txn-icon-text {
  font-size: 26rpx;
  font-weight: 500;
}

.txn-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  min-width: 0;
}

.txn-name {
  font-size: 26rpx;
  color: var(--app-text);
}

.txn-sub {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.empty-wrap {
  background-color: var(--app-card);
  border-radius: 20rpx;
}

.loading-wrap {
  padding-top: 200rpx;
  text-align: center;
}

.loading-text {
  font-size: 26rpx;
  color: var(--app-text-3);
}

</style>
