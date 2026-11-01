<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <DetailShell title="账户详情" @back="goBack">
      <template #right>
        <text class="nav-action" @click="goEdit">编辑</text>
      </template>

      <template v-if="account">
        <!-- 余额头 -->
        <view class="balance-card">
          <view class="bal-head">
            <view class="bal-icon" :style="{ backgroundColor: (account.color || primaryColor) + '22' }">
              <!-- 预设图标 key 用 AccountIcon；没有图标就退回首字符 -->
              <AccountIcon
                v-if="account.icon"
                :name="account.icon"
                :size="26"
                :color="account.color || primaryColor"
              />
              <text
                v-else
                class="bal-icon-text"
                :style="{ color: account.color || primaryColor }"
              >
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
          <!--
            余额：不加颜色、不加符号（与账户页一致）。
            ★ 这里刻意不传 muted ★
              账户详情页是用户主动打开来看的，正文色最清楚；
              浅灰只用在「账户列表里区分不计入资产」，不用在这里。
          -->
          <MoneyText
            :cents="account.balance_cents"
            :size="80"
            :weight="600"
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
            <MoneyText :cents="monthStats.expense" type="expense" :size="32" :weight="500" />
          </view>
          <view class="month-divider" />
          <view class="month-item">
            <text class="month-label">本月收入</text>
            <MoneyText :cents="monthStats.income" type="income" :size="32" :weight="500" />
          </view>
        </view>

        <!-- 最近流水（按日期分组，10 条） -->
        <RecentTxnList
          :txns="txnList"
          :loading="loading"
          :account-id="accountId"
          empty-text="这个账户还没有交易记录"
          show-more
          @more="goAllTxn"
        />
      </template>

      <view v-else class="loading-wrap">
        <text class="loading-text">加载中…</text>
      </view>
    </DetailShell>
  </view>
</template>

<script>
/**
 * 账户详情 —— 详情页结构的样板
 *
 * ★ 结构 ★
 *   DetailShell（顶部导航 + 滚动区）
 *     余额卡
 *     本月收支卡
 *     RecentTxnList（按日期分组的最近流水 + 「全部 ›」）
 *
 * 分类 / 标签 / 预算 / 周期这 4 个详情页都照这个结构写。
 */
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import DetailShell from '@/components/DetailShell.vue'
import RecentTxnList from '@/components/RecentTxnList.vue'
import AccountIcon from '@/components/AccountIcon.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { listTransactions, sumTransactions } from '@/api/transaction.js'
import { daysUntilMonthDay, toMonthKey } from '@/utils/date.js'
import { backAfterAccountDelete } from '@/utils/navBack.js'

export default {
  components: { MoneyText, DetailShell, RecentTxnList, AccountIcon },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    const accountId = ref('')
    const account = ref(null)
    const txnList = ref([])
    const monthStats = ref({ expense: 0, income: 0 })
    const loading = ref(false)

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

    async function load() {
      const acc = await accountStore.getById(accountId.value)
      /*
       * ★ 账户没了（被删掉）→ 回账户列表，而不是留在这个页面 ★
       *   以前这里直接 return，页面就停在「加载中…」——
       *   用户删完账户返回时看到一片空白，不知道发生了什么。
       *
       *   现在：账户不存在（getById 返回 null）就走安全回退。
       *   ★ 为什么不能在 onShow 里也用 backAfterAccountDelete ★
       *     详情页是用户主动进来的，只有「账户真的没了」才该退；
       *     正常返回时 onShow 也会跑一遍 load()，那时账户还在，什么都不做。
       */
      if (!acc) {
        uni.showToast({ title: '账户已被删除', icon: 'none' })
        setTimeout(() => backAfterAccountDelete(), 300)
        return
      }
      // ★ 组合账户没有详情页（无流水、无余额）★
      //   万一被直接跳到（历史入口/分享链接），重定向到编辑页，
      //   避免本页用「无余额」渲染出奇怪的详情。
      if (acc.isCombo) {
        uni.redirectTo({ url: `/pages/account/edit?id=${accountId.value}` })
        return
      }
      account.value = acc

      loading.value = true
      try {
        // 只取最近 10 条：RecentTxnList 按日期分组后也是显示这 10 条
        const [list, sum] = await Promise.all([
          listTransactions({ accountId: accountId.value, limit: 10 }),
          sumTransactions({ accountId: accountId.value, monthKey: toMonthKey() })
        ])
        txnList.value = list
        monthStats.value = { expense: sum.expense, income: sum.income }
      } finally {
        loading.value = false
      }
    }

    function goEdit() {
      uni.navigateTo({ url: `/pages/account/edit?id=${accountId.value}` })
    }

    /**
     * 「全部 ›」-> 交易列表，并带上账户筛选条件
     *
     * URL 契约见 api/transaction.js 的 parseTxnQueryOptions：
     *   ?accountId=acc_xxx 按账户筛选
     */
    function goAllTxn() {
      uni.navigateTo({ url: `/pages/txn/list?accountId=${accountId.value}` })
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
      settingStore, accountId, account, txnList, monthStats, loading,
      primaryColor, pageStyle, usedPercent, repayCountdown,
      goEdit, goAllTxn, goBack
    }
  }
}
</script>

<style scoped>
.nav-action {
  font-size: 28rpx;
  color: var(--app-primary);
  text-align: right;
}

/* 余额卡 */
.balance-card {
  background: linear-gradient(135deg, var(--app-hero-from), var(--app-card));
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
  overflow: hidden;
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

.loading-wrap {
  padding-top: 200rpx;
  text-align: center;
}

.loading-text {
  font-size: 26rpx;
  color: var(--app-text-3);
}
</style>
