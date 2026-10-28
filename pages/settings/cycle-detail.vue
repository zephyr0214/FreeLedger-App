<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <DetailShell :title="cycle ? cycle.name : '周期详情'" @back="goBack">
      <template v-if="cycle">
        <!-- 汇总卡：周期金额 + 描述 + 下次扣款日 + 历史支出 -->
        <view class="summary-card">
          <view class="summary-head">
            <view class="summary-icon">
              <text class="summary-icon-text">{{ cycle.icon || '🔁' }}</text>
            </view>
            <view class="summary-info">
              <text class="summary-name">{{ cycle.name }}</text>
              <text class="summary-type">{{ cycleDesc }}</text>
            </view>
          </view>

          <text class="summary-label">每期金额</text>
          <MoneyText
            :cents="cycle.amountCents"
            :size="72"
            :weight="600"
            color="var(--app-text)"
          />

          <view class="summary-rows">
            <view class="summary-row">
              <text class="summary-row-label">下次扣款</text>
              <text class="summary-row-value">{{ nextLabel }}</text>
            </view>
            <view class="summary-row">
              <text class="summary-row-label">扣款账户</text>
              <text class="summary-row-value">{{ accountName || '未指定' }}</text>
            </view>
            <view class="summary-row">
              <text class="summary-row-label">历史支出</text>
              <MoneyText :cents="historyStats.expense" :size="26" color="var(--app-text-2)" />
            </view>
            <view class="summary-row">
              <text class="summary-row-label">历史笔数</text>
              <text class="summary-row-value">{{ historyStats.count }} 笔</text>
            </view>
          </view>

          <text v-if="cycle.note" class="summary-tip">{{ cycle.note }}</text>
          <text v-if="!cycle.enabled" class="summary-tip">已停用</text>
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

        <!-- 最近流水 -->
        <RecentTxnList
          :txns="txnList"
          :loading="loading"
          empty-text="这个周期还没有相关流水"
          show-more
          @more="goAllTxn"
        />
      </template>

      <view v-else class="loading-wrap">
        <text class="loading-text">{{ notFound ? '这个周期不存在或已被删除' : '加载中…' }}</text>
      </view>
    </DetailShell>
  </view>
</template>

<script>
/**
 * 周期详情 —— 结构参考 pages/account/detail.vue
 *
 *   DetailShell（标题 = 周期名）
 *     汇总卡（周期金额 + 描述 + 下次扣款日 + 历史支出）
 *     本月收支卡
 *     RecentTxnList（按日期分组的最近流水 + 「全部 ›」）
 *
 * ★ 周期与交易没有强关联 ★
 *   周期只是「登记」——提醒用户每期要交多少钱，
 *   并不强制生成交易（实际记账仍走正常的新增交易流程）。
 *   所以这里的关联靠两条线索：
 *     1. 扣款账户（cycle.accountId）—— 账户维度最可靠
 *     2. 同名备注（备注里写了「房租」等）—— 用于统计「历史支出」
 */
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import DetailShell from '@/components/DetailShell.vue'
import RecentTxnList from '@/components/RecentTxnList.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { getCycles } from '@/api/settings.js'
import { listTransactions, sumTransactions } from '@/api/transaction.js'
import { toMonthKey, relativeDayLabel, parseDayKey } from '@/utils/date.js'

/** 周几的中文名（1 = 周一 … 7 = 周日） */
const WEEKDAY_CN = ['', '一', '二', '三', '四', '五', '六', '日']

export default {
  components: { MoneyText, DetailShell, RecentTxnList },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    const cycleId = ref('')
    const cycle = ref(null)
    const txnList = ref([])
    const monthStats = ref({ expense: 0, income: 0 })
    const historyStats = ref({ expense: 0, count: 0 })
    const loading = ref(false)
    /** 已经加载完但没找到这个周期（被删了 / id 不对） */
    const notFound = ref(false)

    const pageStyle = computed(() => settingStore.cssVars)

    /** 周期的一句话描述：每月 8 号 / 每周一 / 每 2 个月 */
    const cycleDesc = computed(() => {
      const c = cycle.value
      if (!c) return ''
      if (c.cycleType === 'weekly') return `每周${WEEKDAY_CN[c.weekday] || '一'}`
      if (c.cycleType === 'yearly') {
        const m = c.monthOfYear || c.dayOfMonth ? (c.monthOfYear || 1) : 1
        return `每年 ${m} 月 ${c.dayOfMonth || 1} 号`
      }
      if (c.cycleType === 'custom') return `每 ${c.interval || 1} 个月`
      return `每月 ${c.dayOfMonth || 1} 号`
    })

    /** 下次扣款日文案 */
    const nextLabel = computed(() => {
      const d = cycle.value && cycle.value.nextDate
      if (!d) return '未设置'
      const rel = relativeDayLabel(d)
      if (rel) return rel
      try {
        const day = parseDayKey(d)
        return `${day.getMonth() + 1}月${day.getDate()}日`
      } catch (e) {
        return d
      }
    })

    /** 扣款账户名称 */
    const accountName = computed(() => {
      const id = cycle.value && cycle.value.accountId
      if (!id) return ''
      const acc = accountStore.list.find((a) => a.id === id)
      return acc ? acc.name : ''
    })

    async function load() {
      const cycles = await getCycles()
      const c = cycles.find((x) => x.id === cycleId.value)
      cycle.value = c || null
      if (!c) {
        notFound.value = true
        txnList.value = []
        monthStats.value = { expense: 0, income: 0 }
        historyStats.value = { expense: 0, count: 0 }
        return
      }
      notFound.value = false

      loading.value = true
      try {
        /**
         * 流水筛选条件
         *
         * 有扣款账户 -> 按账户看这个周期的相关流水
         * 没有         -> 看全部流水
         */
        const filter = c.accountId ? { accountId: c.accountId } : {}

        /**
         * 历史支出口径
         *
         * 周期只是「登记」，交易与它没有外键关联，
         * 所以只能按「扣款账户 + 备注里提到周期名」来近似：
         *   有账户 -> 该账户下备注提到「房租」的支出
         *   无账户 -> 全部备注里提到「房租」的支出
         */
        const historyFilter = {
          keyword: c.name,
          ...(c.accountId ? { accountId: c.accountId } : {})
        }

        const [list, sum, history] = await Promise.all([
          listTransactions({ ...filter, limit: 10 }),
          sumTransactions({ ...filter, monthKey: toMonthKey() }),
          sumTransactions(historyFilter)
        ])
        txnList.value = list
        monthStats.value = { expense: sum.expense, income: sum.income }
        historyStats.value = { expense: history.expense, count: history.count }
      } finally {
        loading.value = false
      }
    }

    /**
     * 「全部 ›」-> 交易列表
     *
     * ★ 周期没有独立的筛选参数 ★
     *   交易列表页支持的筛选是 accountId / categoryId / tagId / monthKey，
     *   周期不属于其中任何一个。
     *   所以这里用最贴近的两个口径：
     *     有扣款账户 -> ?accountId=xxx（这个账户的全部流水）
     *     没有       -> ?monthKey=YYYY-MM（本月的全部流水）
     */
    function goAllTxn() {
      const c = cycle.value
      const url = c && c.accountId
        ? `/pages/txn/list?accountId=${c.accountId}`
        : `/pages/txn/list?monthKey=${toMonthKey()}`
      uni.navigateTo({ url })
    }

    function goBack() {
      uni.navigateBack()
    }

    onLoad(async (options) => {
      cycleId.value = (options && options.id) || ''
      if (!settingStore.loaded) await settingStore.load()
      await accountStore.load()
      if (cycleId.value) await load()
    })

    onShow(async () => {
      settingStore.syncSystemTheme()
      if (cycleId.value && settingStore.loaded) await load()
    })

    return {
      settingStore, cycle, txnList, monthStats, historyStats, loading, notFound,
      pageStyle, cycleDesc, nextLabel, accountName,
      goAllTxn, goBack
    }
  }
}
</script>

<style scoped>
/* 汇总卡 */
.summary-card {
  background: linear-gradient(135deg, var(--app-primary-light), var(--app-card));
  border-radius: 24rpx;
  padding: 32rpx;
  margin-top: 16rpx;
  box-shadow: var(--app-shadow);
}

.summary-head {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-bottom: 32rpx;
}

.summary-icon {
  width: 88rpx;
  height: 88rpx;
  border-radius: 20rpx;
  background-color: var(--app-card);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.summary-icon-text {
  font-size: 40rpx;
}

.summary-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  min-width: 0;
}

.summary-name {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.summary-type {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.summary-label {
  font-size: 24rpx;
  color: var(--app-text-3);
  display: block;
  margin-bottom: 8rpx;
}

.summary-rows {
  margin-top: 28rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid var(--app-line);
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.summary-row-label {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.summary-row-value {
  font-size: 26rpx;
  color: var(--app-text-2);
}

.summary-tip {
  font-size: 22rpx;
  color: var(--app-text-3);
  margin-top: 16rpx;
  display: block;
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
