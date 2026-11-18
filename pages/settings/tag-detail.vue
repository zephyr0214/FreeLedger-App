<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <DetailShell :title="tag ? tag.name : '标签详情'" @back="goBack">
      <template v-if="tag">
        <!-- 汇总卡：本月支出/收入 + 笔数 -->
        <view class="summary-card">
          <view class="summary-head">
            <DetailSummaryIcon icon="1F3F7" :color="tagColor" />
            <view class="summary-info">
              <text class="summary-name">{{ tag.name }}</text>
              <text class="summary-type">标签（项目）· 共 {{ totalStats.count }} 笔交易</text>
            </view>
            <!-- 数据统计：样式与首页「智能助手」同一个 HeaderAction -->
            <HeaderAction @action-click="goStats">数据统计</HeaderAction>
          </view>

          <text class="summary-label">总结余</text>
          <MoneyText
            :cents="totalStats.income - totalStats.expense"
            variant="balance"
            :size="72"
            :weight="600"
          />

          <!-- 下方小条目：总支出 / 总收入 / 总笔数 / 时间范围 -->
          <view class="summary-rows">
            <view class="summary-row">
              <text class="summary-row-label">总支出</text>
              <MoneyText :cents="totalStats.expense" type="expense" :size="26" />
            </view>
            <view class="summary-row">
              <text class="summary-row-label">总收入</text>
              <MoneyText :cents="totalStats.income" type="income" :size="26" />
            </view>
            <view class="summary-row">
              <text class="summary-row-label">总笔数</text>
              <text class="summary-row-value">{{ totalStats.count }} 笔</text>
            </view>
            <view class="summary-row">
              <text class="summary-row-label">时间范围</text>
              <text class="summary-row-value">{{ rangeText }}</text>
            </view>
          </view>
        </view>

        <!--
          本月收支卡
          ★ 这块在其他详情页已删除，本页按要求保留 ★
            它展示的是「本月」口径的收支，和汇总卡里的
            「总支出 / 总收入 / 总笔数」是不同区间，不是重复信息。
        -->
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

        <!-- 最近流水 -->
        <RecentTxnList
          :txns="txnList"
          :loading="loading"
          empty-text="这个标签本月还没有交易"
          show-more
          show-footer-more
          :total-count="totalStats.count"
          @more="goAllTxn"
        />
      </template>

      <view v-else class="loading-wrap">
        <text class="loading-text">{{ notFound ? '这个标签不存在或已被删除' : '加载中…' }}</text>
      </view>
    </DetailShell>

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
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
import DetailSummaryIcon from '@/components/DetailSummaryIcon.vue'
import HeaderAction from '@/components/HeaderAction.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { getTag, getTagTxnRange } from '@/api/tag.js'
import { listTransactions, sumTransactions } from '@/api/transaction.js'
import { toMonthKey, chineseDayLabel } from '@/utils/date.js'
import { openStatsWithFilter } from '@/utils/statsFilterNav.js'

export default {
  components: { MoneyText, DetailShell, RecentTxnList, HeaderAction, UpdateDialog, DetailSummaryIcon },
  setup() {
    const settingStore = useSettingStore()

    const tagId = ref('')
    const tag = ref(null)
    const txnList = ref([])
    const monthStats = ref({ expense: 0, income: 0, count: 0 })
    /**
     * 全部时间（不限月份）的本标签统计。
     * 汇总卡的大数字用它的 expense，下方小条目用它的 income / count。
     */
    const totalStats = ref({ expense: 0, income: 0, count: 0 })
    /** 这个标签所有关联流水的最早 / 最晚日期 */
    const tagRange = ref({ firstDay: '', lastDay: '' })
    const loading = ref(false)
    /** 已经加载完但没找到这个标签（被删了 / id 不对） */
    const notFound = ref(false)

    const pageStyle = computed(() => settingStore.cssVars)

    const tagColor = computed(() => (tag.value && tag.value.color) || '#1989FA')

    /** 时间范围：最早一条到最晚一条记录 */
    const rangeText = computed(() => {
      const r = tagRange.value
      if (!r.firstDay || !r.lastDay) return '暂无记录'
      return `${chineseDayLabel(r.firstDay)} - ${chineseDayLabel(r.lastDay)}`
    })

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
        const [list, sum, all, range] = await Promise.all([
          listTransactions({ tagId: tagId.value, limit: 10 }),
          sumTransactions({ tagId: tagId.value, monthKey: toMonthKey() }),
          sumTransactions({ tagId: tagId.value }),
          getTagTxnRange(tagId.value)
        ])
        txnList.value = list
        tagRange.value = range
        monthStats.value = {
          expense: sum.expense,
          income: sum.income,
          count: sum.count
        }
        totalStats.value = {
          expense: all.expense,
          income: all.income,
          // 总笔数含全部关联流水；金额仍按「计入收支」口径
          count: range.count
        }
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

    /** 跳统计页并只看这个标签 */
    function goStats() {
      openStatsWithFilter({ tagIds: [tagId.value] })
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
      settingStore, tag, txnList, monthStats, totalStats, tagRange, loading, notFound,
      pageStyle, tagColor, rangeText,
      goAllTxn, goStats, goBack
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

/* 本月收支卡 */
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
