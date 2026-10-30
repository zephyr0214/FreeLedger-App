<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <DetailShell :title="budgetTitle" @back="goBack">
      <template v-if="usage">
        <!-- 汇总卡：额度 / 已用 / 剩余 / 百分比 + 进度条 -->
        <view class="summary-card">
          <view class="summary-head">
            <view class="summary-icon" :style="{ backgroundColor: iconBg }">
              <text class="summary-icon-text" :style="{ color: iconFg }">{{ iconChar }}</text>
            </view>
            <view class="summary-info">
              <text class="summary-name">{{ usage.name }}</text>
              <text class="summary-type">
                {{ usage.scope === 'total' ? '总预算' : '分类预算' }} · {{ monthKey }}
              </text>
            </view>
          </view>

          <text class="summary-label">已用</text>
          <MoneyText
            :cents="usage.used"
            :size="72"
            :weight="600"
            :color="usage.over ? 'var(--app-danger)' : 'var(--app-text)'"
          />

          <!-- 进度条 -->
          <view class="usage-bar">
            <view
              class="usage-fill"
              :style="{
                width: Math.min(usage.percent, 100) + '%',
                backgroundColor: usage.over ? 'var(--app-danger)' : primaryColor
              }"
            />
          </view>

          <view class="summary-pct">
            <text class="summary-pct-text" :style="{ color: usage.over ? 'var(--app-danger)' : primaryColor }">
              {{ usage.percent }}%
            </text>
            <text class="summary-pct-text">{{ usage.limit / 100 }} 元</text>
          </view>

          <view class="summary-rows">
            <view class="summary-row">
              <text class="summary-row-label">预算额度</text>
              <MoneyText :cents="usage.limit" :size="26" color="var(--app-text-2)" />
            </view>
            <view class="summary-row">
              <text class="summary-row-label">剩余</text>
              <MoneyText
                :cents="usage.remaining"
                :size="26"
                :color="usage.remaining < 0 ? 'var(--app-danger)' : 'var(--app-text-2)'"
              />
            </view>
            <view class="summary-row">
              <text class="summary-row-label">日均可用</text>
              <MoneyText :cents="usage.dailyAvailable" :size="26" color="var(--app-text-2)" />
            </view>
            <view class="summary-row">
              <text class="summary-row-label">本月笔数</text>
              <text class="summary-row-value">{{ monthStats.count }} 笔</text>
            </view>
          </view>

          <text v-if="usage.over" class="summary-tip danger">
            已超支 {{ (Math.abs(usage.remaining) / 100).toFixed(2) }} 元
          </text>
        </view>

        <!-- 最近流水 -->
        <RecentTxnList
          :txns="txnList"
          :loading="loading"
          empty-text="本月还没有支出记录"
          show-more
          @more="goAllTxn"
        />
      </template>

      <view v-else class="loading-wrap">
        <text class="loading-text">{{ notFound ? '没有找到对应的预算' : '加载中…' }}</text>
      </view>
    </DetailShell>
  </view>
</template>

<script>
/**
 * 预算详情 —— 结构参考 pages/account/detail.vue
 *
 *   DetailShell（标题 = 预算名）
 *     汇总卡（额度 / 已用 / 剩余 / 百分比 + 进度条）
 *     RecentTxnList（按日期分组的最近流水 + 「全部 ›」）
 *
 * ★ 中间那块「本月收支」已删除 ★
 *   它和汇总卡里的「已用」是同一笔钱，重复展示；
 *   预算页关心的是「额度还剩多少、都花在哪」，
 *   收入跟预算没有关系，放在这里只是噪音。
 *
 * ★ URL 参数 ★
 *   id  预算 id（可选）
 *       不传就当作「总预算」—— 总预算是 scope='total' 的那一条，
 *       没有 id 也能定位到它。
 */
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import DetailShell from '@/components/DetailShell.vue'
import RecentTxnList from '@/components/RecentTxnList.vue'
import { useSettingStore } from '@/stores/setting.js'
import { getBudgetUsage } from '@/api/stats.js'
import { getCategory, listCategories } from '@/api/category.js'
import { listTransactions, sumTransactions } from '@/api/transaction.js'
import { toMonthKey } from '@/utils/date.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'

export default {
  components: { MoneyText, DetailShell, RecentTxnList },
  setup() {
    const settingStore = useSettingStore()

    const budgetId = ref('')
    const usage = ref(null)
    const txnList = ref([])
    const monthStats = ref({ expense: 0, income: 0, count: 0 })
    /** 分类列表：用来把分类预算的 categoryId 归到一级 */
    const categories = ref([])
    const loading = ref(false)
    /** 已经加载完但没找到预算 */
    const notFound = ref(false)

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    const monthKey = computed(() => toMonthKey())

    const budgetTitle = computed(() => (usage.value ? usage.value.name : '预算详情'))

    const iconChar = computed(() => {
      if (!usage.value) return '📊'
      return usage.value.icon
        ? iconEmoji(usage.value.icon)
        : guessIconByName(usage.value.name)
    })

    const iconBg = computed(() =>
      usage.value && usage.value.over ? 'var(--app-danger)' : 'var(--app-primary-light)'
    )

    const iconFg = computed(() =>
      usage.value && usage.value.over ? 'var(--app-danger)' : 'var(--app-primary)'
    )

    /**
     * 找到当前要展示的预算
     *
     * 传了 id 就按 id 找（分类预算）；
     * 没传 id 就取 scope='total' 的那条（总预算）。
     */
    function pickUsage(list) {
      if (!list || list.length === 0) return null
      if (budgetId.value) {
        const found = list.find((b) => b.id === budgetId.value)
        if (found) return found
      }
      return list.find((b) => b.scope === 'total') || list[0]
    }

    async function load() {
      loading.value = true
      try {
        const [usages, cats] = await Promise.all([
          getBudgetUsage(toMonthKey()),
          listCategories()
        ])
        categories.value = cats
        const u = pickUsage(usages)
        usage.value = u
        if (!u) {
          notFound.value = true
          txnList.value = []
          monthStats.value = { expense: 0, income: 0, count: 0 }
          return
        }
        notFound.value = false

        /**
         * 流水筛选条件 —— 必须和这条预算真正的归属分类一致。
         *
         * ★ 原来的 bug ★
         *   这里无条件把分类归到一级：
         *     rootId = (cat && cat.parent_id) || u.categoryId
         *   于是「二级分类预算」（比如只给「午餐」设了预算）
         *   下方流水却按「餐饮」一级去查、且 includeSubcategories，
         *   把「外卖」「聚餐」等同级分类的交易也列了出来 ——
         *   和上方「已用」对不上。
         *
         * ★ 正确口径 ★
         *   预算的 category_id 就是用户当时选的分类：
         *     · 选的是二级 → 只统计这一个二级分类自己
         *     · 选的是 一级 → 统计整个分类族（含所有二级）
         *   所以要先判断该分类有没有 parent_id 再决定。
         */
        let filter = {}
        if (u.scope === 'category' && u.categoryId) {
          const cat = await getCategory(u.categoryId)
          const isLeaf = !!(cat && cat.parent_id)
          filter = isLeaf
            ? { categoryId: u.categoryId, includeSubcategories: false }
            : { categoryId: u.categoryId, includeSubcategories: true }
        }

        const [list, sum] = await Promise.all([
          listTransactions({ ...filter, monthKey: toMonthKey(), limit: 10 }),
          sumTransactions({ ...filter, monthKey: toMonthKey() })
        ])
        txnList.value = list
        monthStats.value = {
          expense: sum.expense,
          income: sum.income,
          count: sum.count
        }
      } finally {
        loading.value = false
      }
    }

    /**
     * 「全部 ›」-> 交易列表
     *
     * URL 契约（见 api/transaction.js 的 parseTxnQueryOptions）：
     *   ?monthKey=YYYY-MM   按月份筛选
     *
     * 预算是按自然月算的，所以这里带上当前月份，
     * 让列表页直接落在同一口径上。
     *
     * 分类预算再额外带上 categoryId + includeSubcategories=1，
     * 这样列表里看到的每一笔都确实是占这个预算额度的支出
     * （与汇总卡的「已用」口径一致）。
     */
    function goAllTxn() {
      const u = usage.value
      if (u && u.scope === 'category' && u.categoryId) {
        const cat = categories.value.find((c) => c.id === u.categoryId)
        /*
         * ★ 与上方「已用」保持同一口径 ★
         *   这块之前和列表查询犯了同一个错：无条件归到一级 →
         *   二级分类预算点「全部」也会跳到一级，看到别的二级分类。
         *   现在按「是不是叶子」分别处理：
         *     二级 → 只带自己，不带 includeSubcategories
         *     一级 → 带上 includeSubcategories，看整个分类族
         */
        const isLeaf = !!(cat && cat.parent_id)
        const param = isLeaf
          ? `categoryId=${u.categoryId}`
          : `categoryId=${u.categoryId}&includeSubcategories=1`
        uni.navigateTo({
          url: `/pages/txn/list?monthKey=${toMonthKey()}&${param}`
        })
        return
      }
      uni.navigateTo({ url: `/pages/txn/list?monthKey=${toMonthKey()}` })
    }

    function goBack() {
      uni.navigateBack()
    }

    onLoad(async (options) => {
      budgetId.value = (options && options.id) || ''
      if (!settingStore.loaded) await settingStore.load()
      await load()
    })

    onShow(async () => {
      settingStore.syncSystemTheme()
      if (settingStore.loaded) await load()
    })

    return {
      settingStore, usage, txnList, monthStats, categories, loading, notFound,
      primaryColor, pageStyle, monthKey, budgetTitle, iconChar, iconBg, iconFg,
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

/* 进度条 */
.usage-bar {
  height: 12rpx;
  background-color: var(--app-card-2);
  border-radius: 6rpx;
  overflow: hidden;
  margin-top: 24rpx;
}

.usage-fill {
  height: 100%;
  border-radius: 6rpx;
  transition: width 0.35s ease;
}

.summary-pct {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 10rpx;
}

.summary-pct-text {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.summary-rows {
  margin-top: 24rpx;
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
}

.summary-tip.danger {
  color: var(--app-danger);
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
