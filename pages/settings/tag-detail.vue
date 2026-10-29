<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <DetailShell :title="tag ? tag.name : '标签详情'" @back="goBack">
      <template v-if="tag">
        <!-- 汇总卡：本月支出/收入 + 笔数 -->
        <view class="summary-card">
          <view class="summary-head">
            <view class="summary-dot" :style="{ backgroundColor: tagColor }" />
            <view class="summary-info">
              <text class="summary-name">{{ tag.name }}</text>
              <text class="summary-type">标签（项目）· 共 {{ totalCount }} 笔交易</text>
            </view>
          </view>

          <text class="summary-label">本月支出</text>
          <MoneyText
            :cents="monthStats.expense"
            :size="72"
            :weight="600"
            color="var(--app-text)"
          />

          <view class="summary-rows">
            <view class="summary-row">
              <text class="summary-row-label">本月收入</text>
              <MoneyText :cents="monthStats.income" :size="26" color="var(--app-success)" />
            </view>
            <view class="summary-row">
              <text class="summary-row-label">本月笔数</text>
              <text class="summary-row-value">{{ monthStats.count }} 笔</text>
            </view>
            <view class="summary-row">
              <text class="summary-row-label">全部笔数</text>
              <text class="summary-row-value">{{ totalCount }} 笔</text>
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

        <!-- 最近流水 -->
        <RecentTxnList
          :txns="txnList"
          :loading="loading"
          empty-text="这个标签本月还没有交易"
          show-more
          @more="goAllTxn"
        />
      </template>

      <view v-else class="loading-wrap">
        <text class="loading-text">{{ notFound ? '这个标签不存在或已被删除' : '加载中…' }}</text>
      </view>
    </DetailShell>
  </view>
</template>

<script>
/**
 * 标签详情 —— 结构参考 pages/account/detail.vue
 *
 *   DetailShell（标题 = 标签名）
 *     汇总卡（本月支出/收入 + 笔数）
 *     本月收支卡
 *     RecentTxnList（按日期分组的最近流水 + 「全部 ›」）
 *
 * 标签是「项目」：一笔交易可以打多个标签，
 * 所以这里的「笔数」是按 txn 去重后的数量。
 */
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import DetailShell from '@/components/DetailShell.vue'
import RecentTxnList from '@/components/RecentTxnList.vue'
import { useSettingStore } from '@/stores/setting.js'
import { getTag } from '@/api/tag.js'
import { listTransactions, sumTransactions } from '@/api/transaction.js'
import { toMonthKey } from '@/utils/date.js'

export default {
  components: { MoneyText, DetailShell, RecentTxnList },
  setup() {
    const settingStore = useSettingStore()

    const tagId = ref('')
    const tag = ref(null)
    const txnList = ref([])
    const monthStats = ref({ expense: 0, income: 0, count: 0 })
    /** 全部时间（不限月份）的笔数 */
    const totalCount = ref(0)
    const loading = ref(false)
    /** 已经加载完但没找到这个标签（被删了 / id 不对） */
    const notFound = ref(false)

    const pageStyle = computed(() => settingStore.cssVars)

    const tagColor = computed(() => (tag.value && tag.value.color) || '#1989FA')

    async function load() {
      const t = await getTag(tagId.value)
      if (!t) {
        tag.value = null
        notFound.value = true
        return
      }
      tag.value = t
      notFound.value = false

      loading.value = true
      try {
        const [list, sum, all] = await Promise.all([
          listTransactions({ tagId: tagId.value, limit: 10 }),
          sumTransactions({ tagId: tagId.value, monthKey: toMonthKey() }),
          sumTransactions({ tagId: tagId.value })
        ])
        txnList.value = list
        monthStats.value = {
          expense: sum.expense,
          income: sum.income,
          count: sum.count
        }
        totalCount.value = all.count
      } finally {
        loading.value = false
      }
    }

    /**
     * 「全部 ›」-> 交易列表
     *
     * URL 契约（见 api/transaction.js 的 parseTxnQueryOptions）：
     *   ?tagId=tag_xxx   按标签筛选
     */
    function goAllTxn() {
      uni.navigateTo({ url: `/pages/txn/list?tagId=${tagId.value}` })
    }

    function goBack() {
      uni.navigateBack()
    }

    onLoad(async (options) => {
      tagId.value = (options && options.id) || ''
      if (!settingStore.loaded) await settingStore.load()
      if (tagId.value) await load()
    })

    onShow(async () => {
      settingStore.syncSystemTheme()
      if (tagId.value && settingStore.loaded) await load()
    })

    return {
      settingStore, tag, txnList, monthStats, totalCount, loading, notFound,
      pageStyle, tagColor,
      goAllTxn, goBack
    }
  }
}
</script>

<style scoped>
/* 汇总卡 */
.summary-card {
  background: linear-gradient(135deg, var(--app-hero-from), var(--app-card));
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

.summary-dot {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  flex-shrink: 0;
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
