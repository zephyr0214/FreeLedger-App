<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <DetailShell :title="category ? category.name : '分类详情'" @back="goBack">
      <template v-if="category">
        <!-- 汇总卡：本月支出/收入 + 笔数 + 占比 -->
        <view class="summary-card">
          <view class="summary-head">
            <view class="summary-icon" :style="{ backgroundColor: categoryColor + '22' }">
              <text class="summary-icon-text" :style="{ color: categoryColor }">{{ iconChar }}</text>
            </view>
            <view class="summary-info">
              <text class="summary-name">{{ category.name }}</text>
              <text class="summary-type">
                {{ category.type === 'income' ? '收入分类' : '支出分类' }}
                <text v-if="isParent"> · 含二级分类</text>
              </text>
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
              <text class="summary-row-label">支出占比</text>
              <text class="summary-row-value">{{ sharePercent }}%</text>
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
          empty-text="这个分类本月还没有交易"
          show-more
          @more="goAllTxn"
        />
      </template>

      <view v-else class="loading-wrap">
        <text class="loading-text">{{ notFound ? '这个分类不存在或已被删除' : '加载中…' }}</text>
      </view>
    </DetailShell>
  </view>
</template>

<script>
/**
 * 分类详情 —— 结构参考 pages/account/detail.vue
 *
 *   DetailShell（标题 = 分类名）
 *     汇总卡（本月支出/收入 + 笔数 + 占比）
 *     本月收支卡
 *     RecentTxnList（按日期分组的最近流水 + 「全部 ›」）
 *
 * ★ 一级 / 二级分类的差别 ★
 *   汇总卡与流水都按「该分类 + 它的所有二级」统计，
 *   所以二级分类点进来时只看它自己，一级分类点进来时看整个分类族。
 */
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import DetailShell from '@/components/DetailShell.vue'
import RecentTxnList from '@/components/RecentTxnList.vue'
import { useSettingStore } from '@/stores/setting.js'
import { getCategory } from '@/api/category.js'
import { listTransactions, sumTransactions } from '@/api/transaction.js'
import { toMonthKey } from '@/utils/date.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'

export default {
  components: { MoneyText, DetailShell, RecentTxnList },
  setup() {
    const settingStore = useSettingStore()

    const categoryId = ref('')
    const category = ref(null)
    const txnList = ref([])
    const monthStats = ref({ expense: 0, income: 0, count: 0 })
    /** 本月全部支出，用来算这个分类的占比 */
    const monthTotalExpense = ref(0)
    const loading = ref(false)
    /** 已经加载完但没找到这个分类（被删了 / id 不对） */
    const notFound = ref(false)

    const pageStyle = computed(() => settingStore.cssVars)

    /** 一级分类（没有 parent_id） */
    const isParent = computed(() => !!category.value && !category.value.parent_id)

    const categoryColor = computed(() =>
      (category.value && category.value.color) || '#969799'
    )

    const iconChar = computed(() => {
      if (!category.value) return '📦'
      return category.value.icon
        ? iconEmoji(category.value.icon)
        : guessIconByName(category.value.name)
    })

    /** 该分类本月支出占本月总支出的百分比 */
    const sharePercent = computed(() => {
      const total = monthTotalExpense.value
      if (!total) return 0
      return Math.round((monthStats.value.expense / total) * 1000) / 10
    })

    async function load() {
      const cat = await getCategory(categoryId.value)
      if (!cat) {
        category.value = null
        notFound.value = true
        return
      }
      category.value = cat
      notFound.value = false

      loading.value = true
      try {
        const [list, sum, all] = await Promise.all([
          listTransactions({
            categoryId: categoryId.value,
            includeSubcategories: isParent.value,
            limit: 10
          }),
          sumTransactions({
            categoryId: categoryId.value,
            includeSubcategories: isParent.value,
            monthKey: toMonthKey()
          }),
          sumTransactions({ monthKey: toMonthKey() })
        ])
        txnList.value = list
        monthStats.value = {
          expense: sum.expense,
          income: sum.income,
          count: sum.count
        }
        monthTotalExpense.value = all.expense
      } finally {
        loading.value = false
      }
    }

    /**
     * 「全部 ›」-> 交易列表
     *
     * URL 契约（见 api/transaction.js 的 parseTxnQueryOptions）：
     *   ?categoryId=cat_xxx           按分类筛选
     *   ?includeSubcategories=1       categoryId 是一级分类时，匹配其所有二级
     *
     * ★ 一级分类要带 includeSubcategories=1 ★
     *   一级分类本身往往没有直接挂在它上面的交易（都在二级上），
     *   不带这个参数会看到空列表。
     *   二级分类就精确匹配自己，不用带。
     */
    function goAllTxn() {
      const url = isParent.value
        ? `/pages/txn/list?categoryId=${categoryId.value}&includeSubcategories=1`
        : `/pages/txn/list?categoryId=${categoryId.value}`
      uni.navigateTo({ url })
    }

    function goBack() {
      uni.navigateBack()
    }

    onLoad(async (options) => {
      categoryId.value = (options && options.id) || ''
      if (!settingStore.loaded) await settingStore.load()
      if (categoryId.value) await load()
    })

    onShow(async () => {
      settingStore.syncSystemTheme()
      if (categoryId.value && settingStore.loaded) await load()
    })

    return {
      settingStore, category, txnList, monthStats, loading, notFound,
      pageStyle, isParent, categoryColor, iconChar, sharePercent,
      goAllTxn, goBack
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

.summary-icon {
  width: 88rpx;
  height: 88rpx;
  border-radius: 20rpx;
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
