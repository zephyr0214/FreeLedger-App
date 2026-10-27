<template>
  <view class="app-page" :style="pageStyle">
    <AppHeader @avatar-click="goSettings" />

    <scroll-view class="page-scroll" scroll-y>
      <!-- 时间范围选择：年 / 月 / 日 三级联动 -->
      <view class="range-picker-bar">
        <DateRangePicker v-model="dateRange" mode="inline" @range-change="onRangeChange" />
      </view>

      <!-- 收支摘要 -->
      <view class="ov-summary">
        <view class="ov-item">
          <text class="ov-label">支出</text>
          <MoneyText :cents="overview.expense" :size="34" :weight="600" color="var(--app-text)" />
        </view>
        <view class="ov-line" />
        <view class="ov-item">
          <text class="ov-label">收入</text>
          <MoneyText :cents="overview.income" :size="34" :weight="600" color="var(--app-text)" />
        </view>
        <view class="ov-line" />
        <view class="ov-item">
          <text class="ov-label">结余</text>
          <MoneyText
            :cents="overview.balance"
            :size="34"
            :weight="600"
            :color="overview.balance >= 0 ? 'var(--app-success)' : 'var(--app-danger)'"
          />
        </view>
      </view>

      <!-- ① AI 分析 -->
      <view class="card ai-card">
        <view class="card-head">
          <view class="card-title-row">
            <text class="ai-badge">AI</text>
            <text class="card-title">消费分析</text>
          </view>
          <text class="card-action" @click="refreshAnalysis">
            {{ analysisLoading ? '分析中…' : (analysis ? '重新分析' : '生成') }}
          </text>
        </view>
        <text v-if="analysisLoading" class="ai-text ai-loading">正在分析…</text>
        <text v-else-if="analysis" class="ai-text">{{ analysis }}</text>
        <text v-else class="ai-text ai-empty" @click="refreshAnalysis">
          点击生成{{ rangeLabel }}消费分析 ›
        </text>
      </view>

      <!-- ② 分类统计 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">分类统计</text>
          <view class="type-toggle">
              <text
                class="type-tag"
                :class="{ active: statType === 'expense' }"
                @click="switchStatType('expense')"
              >支出</text>
              <text
                class="type-tag"
                :class="{ active: statType === 'income' }"
                @click="switchStatType('income')"
              >收入</text>
          </view>
        </view>

        <view v-if="categoryStats.length === 0" class="card-empty">
          <text class="empty-text">{{ rangeLabel }}暂无数据</text>
        </view>

        <view v-else>
          <!-- 环形图（用 CSS conic-gradient 实现，避免 canvas 白屏） -->
          <view class="donut-wrap">
            <view class="donut" :style="donutStyle">
              <view class="donut-hole">
                <text class="donut-label">合计</text>
                <MoneyText :cents="categoryTotal" :size="30" :weight="600" color="var(--app-text)" />
              </view>
            </view>
          </view>

          <!-- 排行 -->
          <view class="rank-list">
            <view
              v-for="(cat, i) in categoryStats.slice(0, 7)"
              :key="cat.id"
              class="rank-item"
            >
              <view class="rank-dot" :style="{ backgroundColor: cat.color }" />
              <text class="rank-name">{{ cat.name }}</text>
              <view class="rank-bar-wrap">
                <view
                  class="rank-bar"
                  :style="{
                    width: catPercent(cat) + '%',
                    backgroundColor: cat.color
                  }"
                />
              </view>
              <text class="rank-pct">{{ catPercent(cat) }}%</text>
              <MoneyText :cents="cat.amount" :size="26" color="var(--app-text)" />
            </view>
          </view>
        </view>
      </view>

      <!-- ③ 账户统计 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">账户统计</text>
        </view>
        <view v-if="accountStats.length === 0" class="card-empty">
          <text class="empty-text">暂无数据</text>
        </view>
        <view v-else class="simple-list">
          <view v-for="acc in accountStats" :key="acc.id" class="simple-item">
            <text class="simple-name">{{ acc.name }}</text>
            <text class="simple-count">{{ acc.count }} 笔</text>
            <MoneyText :cents="acc.amount" :size="26" color="var(--app-text)" />
          </view>
        </view>
      </view>

      <!-- ④ 项目（标签）统计 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">项目统计</text>
          <text class="card-sub">按标签聚合</text>
        </view>
        <view v-if="tagStats.length === 0" class="card-empty">
          <text class="empty-text">
            还没有打标签的交易{{ untagged > 0 ? `（未归类 ¥${(untagged / 100).toFixed(2)}）` : '' }}
          </text>
        </view>
        <view v-else class="simple-list">
          <view v-for="t in tagStats" :key="t.id" class="simple-item">
            <view class="tag-dot" :style="{ backgroundColor: t.color }" />
            <text class="simple-name">{{ t.name }}</text>
            <text class="simple-count">{{ t.count }} 笔</text>
            <MoneyText :cents="t.amount" :size="26" color="var(--app-text)" />
          </view>
        </view>
      </view>

      <!-- ⑤ 趋势 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">{{ trendTitle }}</text>
          <text class="card-sub">{{ trendSubtitle }}</text>
        </view>
        <view class="daily-chart">
          <view class="daily-bars">
            <view
              v-for="(d, i) in dailyTrend"
              :key="i"
              class="daily-bar-wrap"
            >
              <view
                class="daily-bar"
                :style="{
                  height: barHeight(d.expense) + '%',
                  backgroundColor: d.expense > 0 ? primaryColor : 'transparent'
                }"
              />
            </view>
          </view>
          <view class="daily-axis">
            <text class="axis-text">{{ dailyTrend.length ? dailyTrend[0].label + trendUnit : '—' }}</text>
            <text class="axis-text">{{ dailyTrend.length ? dailyTrend[dailyTrend.length - 1].label + trendUnit : '—' }}</text>
          </view>
        </view>
      </view>

      <!-- ⑥ 平均值 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">平均值</text>
        </view>
        <view class="avg-grid">
          <view class="avg-item">
            <text class="avg-label">日均支出</text>
            <MoneyText :cents="averages.avgPerDay" :size="34" :weight="600" color="var(--app-text)" />
            <text class="avg-hint">{{ averages.daysPassed }} 天</text>
          </view>
          <view class="avg-item">
            <text class="avg-label">笔均支出</text>
            <MoneyText :cents="averages.avgPerTxn" :size="34" :weight="600" color="var(--app-text)" />
            <text class="avg-hint">{{ averages.count }} 笔</text>
          </view>
          <view class="avg-item">
            <text class="avg-label">最高单日</text>
            <MoneyText :cents="averages.maxDay ? averages.maxDay.amount : 0" :size="34" :weight="600" color="var(--app-text)" />
            <text class="avg-hint">{{ averages.maxDay ? shortDay(averages.maxDay.day) : '—' }}</text>
          </view>
        </view>
      </view>

      <!-- ⑦ Top 10 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">最高的 10 笔消费</text>
        </view>
        <view v-if="topExpenses.length === 0" class="card-empty">
          <text class="empty-text">暂无数据</text>
        </view>
        <view v-else class="top-list">
          <view
            v-for="(t, i) in topExpenses"
            :key="t.id"
            class="top-item"
            @click="goTxnDetail(t.id)"
          >
            <text class="top-rank" :class="{ 'top-3': i < 3 }">{{ i + 1 }}</text>
            <view class="top-info">
              <text class="top-name">{{ t.category_name || '未分类' }}</text>
              <text class="top-sub ellipsis">{{ t.note || t.account_name || '无备注' }}</text>
            </view>
            <view class="top-right">
              <MoneyText :cents="t.amount_cents" :size="28" :weight="500" color="var(--app-text)" />
              <text class="top-day">{{ shortDay(t.occurred_day) }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- ⑧ 预算情况 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">预算情况</text>
          <text class="card-action" @click="goBudget">管理 ›</text>
        </view>
        <view v-if="budgets.length === 0" class="card-empty">
          <text class="empty-text">还没有设置预算</text>
        </view>
        <view v-else class="budget-list">
          <view v-for="b in budgets" :key="b.id" class="budget-item">
            <view class="budget-row">
              <text class="budget-name">{{ b.name }}</text>
              <text
                class="budget-pct"
                :style="{ color: b.over ? 'var(--app-danger)' : 'var(--app-text-2)' }"
              >{{ b.percent }}%</text>
            </view>
            <view class="budget-bar">
              <view
                class="budget-fill"
                :style="{
                  width: Math.min(b.percent, 100) + '%',
                  backgroundColor: b.over ? 'var(--app-danger)' : primaryColor
                }"
              />
            </view>
            <view class="budget-detail">
              <MoneyText :cents="b.used" :size="22" color="var(--app-text-3)" />
              <text class="budget-slash">/</text>
              <MoneyText :cents="b.limit" :size="22" color="var(--app-text-3)" />
            </view>
          </view>
        </view>
      </view>

      <view class="bottom-space" />
    </scroll-view>

      <!-- tabBar 上方分割线：原生 tabBar 的 borderStyle 只有 black/white，做不出浅灰 -->
      <view class="tabbar-divider" />

  </view>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppHeader from '@/components/AppHeader.vue'
import MoneyText from '@/components/MoneyText.vue'
import DateRangePicker from '@/components/DateRangePicker.vue'
import { useSettingStore } from '@/stores/setting.js'
import {
  getOverviewRange, getCategoryStatsRange, getAccountStatsRange, getTagStatsRange,
  getDailyTrendRange, getAveragesRange, getTopExpensesRange, getBudgetUsageRange,
  getUntaggedAmountRange
} from '@/api/stats.js'
import { getAnalysisRange } from '@/api/ai.js'
import {
  selectionToRange, defaultSelection, selectionLabel
} from '@/utils/date.js'

export default {
  components: { AppHeader, MoneyText, DateRangePicker },
  setup() {
    const settingStore = useSettingStore()

    /** 三级联动选择：year / month / day，0 表示「全部」 */
    const dateRange = ref(defaultSelection())
    const statType = ref('expense')

    const categoryStats = ref([])
    const accountStats = ref([])
    const tagStats = ref([])
    const dailyTrend = ref([])
    const averages = ref({ avgPerDay: 0, avgPerTxn: 0, count: 0, daysPassed: 0, maxDay: null })
    const topExpenses = ref([])
    const budgets = ref([])
    const untagged = ref(0)
    const overview = ref({ expense: 0, income: 0, balance: 0 })

    const analysis = ref('')
    const analysisLoading = ref(false)

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    /** 当前选择对应的查询区间 */
    const range = computed(() => selectionToRange(dateRange.value))

    /** 当前选择的展示文案 */
    const rangeLabel = computed(() => selectionLabel(dateRange.value))

    /** 趋势图标题：按天还是按月 */
    const trendTitle = computed(() => {
      const sel = dateRange.value
      if (!sel.year) return '月趋势'
      if (!sel.month) return '月趋势'
      if (!sel.day) return '日趋势'
      return '当日支出'
    })

    /** 趋势图副标题 */
    const trendSubtitle = computed(() => {
      const sel = dateRange.value
      if (!sel.year) return '每月支出'
      if (!sel.month) return '每月支出'
      if (!sel.day) return '每日支出'
      return '当天支出'
    })

    /** 趋势图坐标轴单位 */
    const trendUnit = computed(() => {
      const sel = dateRange.value
      if (!sel.year) return '月'
      if (!sel.month) return '月'
      return '日'
    })

    const categoryTotal = computed(() =>
      categoryStats.value.reduce((acc, c) => acc + c.amount, 0)
    )

    /** 用 conic-gradient 画环形图，避开 canvas 在 App 端首绘白屏的问题 */
    const donutStyle = computed(() => {
      const list = categoryStats.value.slice(0, 7)
      const total = categoryTotal.value || 1

      if (list.length === 0) {
        return { background: 'var(--app-card-2)' }
      }

      let acc = 0
      const stops = []
      for (const cat of list) {
        const pct = (cat.amount / total) * 100
        const from = acc
        acc += pct
        stops.push(`${cat.color} ${from}% ${acc}%`)
      }
      // 剩余归其他
      if (acc < 100) {
        stops.push(`var(--app-line) ${acc}% 100%`)
      }

      return { background: `conic-gradient(${stops.join(', ')})` }
    })

    const maxDailyExpense = computed(() => {
      const vals = dailyTrend.value.map((d) => d.expense)
      return Math.max(...vals, 1)
    })

    function barHeight(v) {
      if (!v) return 0
      return Math.round((v / maxDailyExpense.value) * 100)
    }

    function catPercent(cat) {
      if (!categoryTotal.value) return 0
      return Math.round((cat.amount / categoryTotal.value) * 1000) / 10
    }

    function shortDay(dayKey) {
      if (!dayKey) return ''
      const [, m, d] = dayKey.split('-')
      return `${Number(m)}/${Number(d)}`
    }

    /* ------------------------------------------------------ 加载 */

    async function loadAll() {
      const r = range.value
      try {
        const [ov, cats, accs, tgs, daily, avg, top, buds, untag] = await Promise.all([
          getOverviewRange(r),
          getCategoryStatsRange(r, statType.value),
          getAccountStatsRange(r, statType.value),
          getTagStatsRange(r, statType.value),
          getDailyTrendRange(r),
          getAveragesRange(r),
          getTopExpensesRange(r, 10),
          getBudgetUsageRange(r),
          getUntaggedAmountRange(r)
        ])

        overview.value = ov
        categoryStats.value = cats
        accountStats.value = accs
        tagStats.value = tgs
        dailyTrend.value = daily
        averages.value = avg
        topExpenses.value = top
        budgets.value = buds
        untagged.value = untag
      } catch (e) {
        console.error('[stats] load failed', e)
        uni.showToast({ title: e.message, icon: 'none' })
      }
    }

    async function refreshAnalysis() {
      if (analysisLoading.value) return
      analysisLoading.value = true
      try {
        const res = await getAnalysisRange(range.value, rangeLabel.value)
        analysis.value = res.text
      } catch (e) {
        analysis.value = ''
        uni.showToast({ title: e.message, icon: 'none' })
      } finally {
        analysisLoading.value = false
      }
    }

    /** 三级联动选择变化：重新拉全部统计 */
    function onRangeChange(sel) {
      dateRange.value = { ...sel }
      analysis.value = ''
      loadAll()
    }

    function goTxnDetail(id) {
      uni.navigateTo({ url: `/pages/txn/detail?id=${id}` })
    }

    function goBudget() {
      uni.navigateTo({ url: '/pages/settings/index' })
    }

    function goSettings() {
      uni.navigateTo({ url: '/pages/settings/index' })
    }

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await loadAll()
    })

    onShow(async () => {
      if (settingStore.loaded) await loadAll()
      settingStore.syncSystemTheme()
    })

    // 切换支出/收入时重新拉分类与账户统计
    function switchStatType(type) {
      statType.value = type
      loadAll()
    }

    return {
      settingStore,
      dateRange, statType,
      categoryStats, accountStats, tagStats, dailyTrend, averages,
      topExpenses, budgets, untagged, overview,
      analysis, analysisLoading,
      primaryColor, pageStyle, rangeLabel, trendTitle, trendSubtitle, trendUnit,
      categoryTotal, donutStyle,
      barHeight, catPercent, shortDay,
      loadAll, refreshAnalysis, onRangeChange, switchStatType,
      goTxnDetail, goBudget, goSettings
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

/* 时间范围选择 */
.range-picker-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8rpx 0 20rpx;
}

/* 收支摘要 */
.ov-summary {
  display: flex;
  align-items: center;
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 28rpx 0;
  margin-bottom: 24rpx;
}

.ov-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.ov-label {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.ov-line {
  width: 1rpx;
  height: 48rpx;
  background-color: var(--app-line);
}

/* 卡片 */
.card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.card-title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--app-text);
}

.card-sub {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.card-action {
  font-size: 24rpx;
  color: var(--app-primary);
}

.card-empty {
  padding: 32rpx 0;
  text-align: center;
}

.empty-text {
  font-size: 24rpx;
  color: var(--app-text-3);
}

/* AI 卡 */
.ai-card {
  background: linear-gradient(135deg, var(--app-primary-light), var(--app-card));
}

.ai-badge {
  font-size: 20rpx;
  font-weight: 600;
  color: #ffffff;
  background-color: var(--app-primary);
  padding: 2rpx 12rpx;
  border-radius: 8rpx;
}

.ai-text {
  font-size: 26rpx;
  color: var(--app-text);
  line-height: 1.7;
  white-space: pre-wrap;
}

.ai-loading {
  color: var(--app-text-3);
}

.ai-empty {
  color: var(--app-primary);
}

/* 类型切换 */
.type-toggle {
  display: flex;
  gap: 8rpx;
  background-color: var(--app-card-2);
  border-radius: 16rpx;
  padding: 4rpx;
}

.type-tag {
  font-size: 22rpx;
  color: var(--app-text-3);
  padding: 6rpx 18rpx;
  border-radius: 12rpx;
}

.type-tag.active {
  background-color: var(--app-card);
  color: var(--app-text);
  font-weight: 500;
}

/* 环形图 */
.donut-wrap {
  display: flex;
  justify-content: center;
  padding: 16rpx 0 28rpx;
}

.donut {
  width: 260rpx;
  height: 260rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.donut-hole {
  width: 170rpx;
  height: 170rpx;
  border-radius: 50%;
  background-color: var(--app-card);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
}

.donut-label {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* 排行 */
.rank-list {
  display: flex;
  flex-direction: column;
  gap: 18rpx;
}

.rank-item {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.rank-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  flex-shrink: 0;
}

.rank-name {
  font-size: 24rpx;
  color: var(--app-text);
  width: 110rpx;
  flex-shrink: 0;
}

.rank-bar-wrap {
  flex: 1;
  height: 10rpx;
  background-color: var(--app-card-2);
  border-radius: 5rpx;
  overflow: hidden;
}

.rank-bar {
  height: 100%;
  border-radius: 5rpx;
  min-width: 4rpx;
}

.rank-pct {
  font-size: 20rpx;
  color: var(--app-text-3);
  width: 70rpx;
  text-align: right;
  flex-shrink: 0;
}

/* 简单列表 */
.simple-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.simple-item {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.simple-name {
  font-size: 26rpx;
  color: var(--app-text);
  flex: 1;
}

.simple-count {
  font-size: 22rpx;
  color: var(--app-text-3);
  margin-right: 12rpx;
}

.tag-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  flex-shrink: 0;
}

/* 日趋势 */
.daily-chart {
  padding-top: 12rpx;
}

.daily-bars {
  display: flex;
  align-items: flex-end;
  height: 160rpx;
  gap: 2rpx;
}

.daily-bar-wrap {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
}

.daily-bar {
  width: 100%;
  border-radius: 2rpx 2rpx 0 0;
  min-height: 2rpx;
}

.daily-axis {
  display: flex;
  justify-content: space-between;
  margin-top: 10rpx;
}

.axis-text {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* 平均值 */
.avg-grid {
  display: flex;
  gap: 16rpx;
}

.avg-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  padding: 20rpx;
  background-color: var(--app-card-2);
  border-radius: 16rpx;
}

.avg-label {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.avg-hint {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* Top 10 */
.top-list {
  display: flex;
  flex-direction: column;
}

.top-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 0;
  border-bottom: 1rpx solid var(--app-line);
}

.top-item:last-child {
  border-bottom: none;
}

.top-rank {
  width: 40rpx;
  font-size: 24rpx;
  color: var(--app-text-3);
  font-weight: 600;
  text-align: center;
  flex-shrink: 0;
}

.top-rank.top-3 {
  color: var(--app-primary);
}

.top-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  min-width: 0;
}

.top-name {
  font-size: 26rpx;
  color: var(--app-text);
}

.top-sub {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.top-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
  flex-shrink: 0;
}

.top-day {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* 预算 */
.budget-list {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.budget-item {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.budget-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.budget-name {
  font-size: 26rpx;
  color: var(--app-text);
}

.budget-pct {
  font-size: 24rpx;
  font-weight: 500;
}

.budget-bar {
  height: 10rpx;
  background-color: var(--app-card-2);
  border-radius: 5rpx;
  overflow: hidden;
}

.budget-fill {
  height: 100%;
  border-radius: 5rpx;
}

.budget-detail {
  display: flex;
  align-items: center;
  gap: 6rpx;
}

.budget-slash {
  font-size: 22rpx;
  color: var(--app-text-3);
}

</style>
