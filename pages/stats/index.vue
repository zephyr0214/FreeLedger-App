<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <AppHeader @avatar-click="goSettings">
      <template #right>
        <!-- AI 对话入口：和首页一样，通向同一个子页面 -->
        <view class="ai-btn" @click="goAiChat">
          <text class="ai-btn-text">AI 助手</text>
        </view>
      </template>
    </AppHeader>

    <!-- 时间范围选择：年 / 月 / 日 三级联动下拉 -->
    <view class="range-picker-bar">
      <DateRangePicker v-model="dateRange" @range-change="onRangeChange" />
    </view>

    <scroll-view class="page-scroll" scroll-y>
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

      <!-- ① 分类统计 -->
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

      <!-- ② 账户统计：按账户 / 按账户类别，两个饼图 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">账户统计</text>
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

        <view v-if="accountStats.length === 0" class="card-empty">
          <text class="empty-text">{{ rangeLabel }}暂无数据</text>
        </view>

        <view v-else>
          <!-- 按账户 -->
          <text class="pie-title">按账户</text>
          <view class="donut-wrap">
            <view class="donut" :style="accountDonutStyle">
              <view class="donut-hole">
                <text class="donut-label">合计</text>
                <MoneyText :cents="accountTotal" :size="30" :weight="600" color="var(--app-text)" />
              </view>
            </view>
          </view>
          <view class="rank-list">
            <view v-for="(acc, i) in accountStats" :key="acc.id" class="rank-item">
              <view class="rank-dot" :style="{ backgroundColor: accColor(acc, i) }" />
              <text class="rank-name">{{ acc.name }}</text>
              <text class="rank-pct">{{ piePercent(acc.amount, accountTotal) }}%</text>
              <MoneyText :cents="acc.amount" :size="26" color="var(--app-text)" />
            </view>
          </view>

          <!-- 按账户类别 -->
          <text class="pie-title">按账户类别</text>
          <view v-if="accountTypeStats.length === 0" class="card-empty">
            <text class="empty-text">暂无数据</text>
          </view>
          <view v-else>
            <view class="donut-wrap">
              <view class="donut" :style="accountTypeDonutStyle">
                <view class="donut-hole">
                  <text class="donut-label">合计</text>
                  <MoneyText :cents="accountTypeTotal" :size="30" :weight="600" color="var(--app-text)" />
                </view>
              </view>
            </view>
            <view class="rank-list">
              <view v-for="t in accountTypeStats" :key="t.key" class="rank-item">
                <view class="rank-dot" :style="{ backgroundColor: t.color }" />
                <text class="rank-name">{{ t.name }}</text>
                <text class="rank-pct">{{ piePercent(t.amount, accountTypeTotal) }}%</text>
                <MoneyText :cents="t.amount" :size="26" color="var(--app-text)" />
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- ③ 趋势 -->
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

      <!-- ④ 平均值：总体 + 各分类 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">平均值</text>
        </view>

        <!-- 总体 -->
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
        </view>

        <!-- 各分类的平均值 -->
        <text class="pie-title">各分类平均</text>
        <view v-if="categoryAverages.length === 0" class="card-empty">
          <text class="empty-text">{{ rangeLabel }}暂无数据</text>
        </view>
        <view v-else class="simple-list">
          <view v-for="c in categoryAverages" :key="c.id" class="simple-item cat-avg-item">
            <view class="rank-dot" :style="{ backgroundColor: c.color }" />
            <view class="cat-avg-name">
              <text class="simple-name">{{ c.name }}</text>
              <text class="cat-avg-hint">{{ c.count }} 笔</text>
            </view>
            <view class="cat-avg-values">
              <view class="cat-avg-value">
                <text class="cat-avg-label">笔均</text>
                <MoneyText :cents="c.avgPerTxn" :size="24" color="var(--app-text)" />
              </view>
              <view class="cat-avg-value">
                <text class="cat-avg-label">日均</text>
                <MoneyText :cents="c.avgPerDay" :size="24" color="var(--app-text-2)" />
              </view>
            </view>
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

      <view class="bottom-space" />
    </scroll-view>


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
  getOverviewRange, getCategoryStatsRange, getAccountStatsRange,
  getAccountTypeStatsRange, getCategoryAveragesRange,
  getDailyTrendRange, getAveragesRange, getTopExpensesRange
} from '@/api/stats.js'
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
    const accountTypeStats = ref([])
    const categoryAverages = ref([])
    const dailyTrend = ref([])
    const averages = ref({ avgPerDay: 0, avgPerTxn: 0, count: 0, daysPassed: 0, maxDay: null })
    const topExpenses = ref([])
    const overview = ref({ expense: 0, income: 0, balance: 0 })

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

    /** 账户合计 */
    const accountTotal = computed(() =>
      accountStats.value.reduce((acc, c) => acc + c.amount, 0)
    )

    /** 账户类别合计 */
    const accountTypeTotal = computed(() =>
      accountTypeStats.value.reduce((acc, c) => acc + c.amount, 0)
    )

    /**
     * 画环形图的通用实现（conic-gradient，避开 canvas 首绘白屏）
     * @param {Array} list [{ amount, color }]
     * @param {number} total
     */
    function buildDonut(list, total) {
      const items = (list || []).slice(0, 7)
      if (items.length === 0 || !total) {
        return { background: 'var(--app-card-2)' }
      }

      let acc = 0
      const stops = []
      for (const item of items) {
        const pct = (item.amount / total) * 100
        const from = acc
        acc += pct
        stops.push(`${item.color} ${from}% ${acc}%`)
      }
      // 剩余归其他
      if (acc < 100) {
        stops.push(`var(--app-line) ${acc}% 100%`)
      }

      return { background: `conic-gradient(${stops.join(', ')})` }
    }

    /** 用 conic-gradient 画环形图，避开 canvas 在 App 端首绘白屏的问题 */
    const donutStyle = computed(() =>
      buildDonut(categoryStats.value, categoryTotal.value)
    )

    /** 按账户分的环形图 */
    const accountDonutStyle = computed(() =>
      buildDonut(
        accountStats.value.map((a, i) => ({ amount: a.amount, color: accColor(a, i) })),
        accountTotal.value
      )
    )

    /** 按账户类别分的环形图 */
    const accountTypeDonutStyle = computed(() =>
      buildDonut(accountTypeStats.value, accountTypeTotal.value)
    )

    /** 账户配色：优先用账户自己的颜色，没有就按顺序取主题色系 */
    const ACCOUNT_PIE_COLORS = [
      '#1989FA', '#07C160', '#FF8F1F', '#7D5FFF', '#FF976A',
      '#EE0A24', '#0A8F4A', '#FF6B9D'
    ]
    function accColor(acc, index) {
      if (acc && acc.color) return acc.color
      return ACCOUNT_PIE_COLORS[index % ACCOUNT_PIE_COLORS.length]
    }

    /** 饼图里的百分比 */
    function piePercent(amount, total) {
      if (!total) return 0
      return Math.round((amount / total) * 1000) / 10
    }

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
        const [ov, cats, accs, accTypes, catAvgs, daily, avg, top] = await Promise.all([
          getOverviewRange(r),
          getCategoryStatsRange(r, statType.value),
          getAccountStatsRange(r, statType.value),
          getAccountTypeStatsRange(r, statType.value),
          getCategoryAveragesRange(r, statType.value),
          getDailyTrendRange(r),
          getAveragesRange(r),
          getTopExpensesRange(r, 10)
        ])

        overview.value = ov
        categoryStats.value = cats
        accountStats.value = accs
        accountTypeStats.value = accTypes
        categoryAverages.value = catAvgs
        dailyTrend.value = daily
        averages.value = avg
        topExpenses.value = top
      } catch (e) {
        console.error('[stats] load failed', e)
        uni.showToast({ title: e.message, icon: 'none' })
      }
    }

    /** 三级联动选择变化：重新拉全部统计 */
    function onRangeChange(sel) {
      dateRange.value = { ...sel }
      loadAll()
    }

    function goTxnDetail(id) {
      uni.navigateTo({ url: `/pages/txn/detail?id=${id}` })
    }

    /** AI 对话（和首页同一个子页面） */
    function goAiChat() {
      uni.navigateTo({ url: '/pages/ai/chat' })
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
      // 重刷原生 tabBar：只有 tab 页才有 tabBar 实例，
      // 主题设置页改完主题后要靠这里把颜色刷回来
      settingStore.refreshTabBar()
    })

    // 切换支出/收入时重新拉分类与账户统计
    function switchStatType(type) {
      statType.value = type
      loadAll()
    }

    return {
      settingStore,
      dateRange, statType,
      categoryStats, accountStats, accountTypeStats, categoryAverages,
      dailyTrend, averages, topExpenses, overview,
      primaryColor, pageStyle, rangeLabel, trendTitle, trendSubtitle, trendUnit,
      categoryTotal, donutStyle, accountTotal, accountTypeTotal,
      accountDonutStyle, accountTypeDonutStyle,
      barHeight, catPercent, shortDay, accColor, piePercent,
      loadAll, onRangeChange, switchStatType,
      goTxnDetail, goAiChat, goSettings
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
  flex-shrink: 0;
  position: relative;
  /*
   * 层级 5：
   *   高于下方的 scroll-view（无 z-index）——下拉面板才不会被内容盖住；
   *   低于库弹层（wd-popup 等默认 10）——弹层打开时不会浮在上面。
   */
  z-index: 5;
  padding: 8rpx 32rpx 20rpx;
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

/* AI 对话入口（和首页同一套样式） */
.ai-btn {
  padding: 8rpx 20rpx;
  border-radius: 20rpx;
  background-color: var(--app-card);
}

.ai-btn-text {
  font-size: 24rpx;
  color: var(--app-primary);
}

/* 饼图小标题（按账户 / 按账户类别） */
.pie-title {
  font-size: 24rpx;
  color: var(--app-text-2);
  display: block;
  margin: 24rpx 0 8rpx;
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

/* 各分类平均：名称 + 笔均/日均 */
.cat-avg-item {
  gap: 14rpx;
}

.cat-avg-name {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  min-width: 0;
}

.cat-avg-hint {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.cat-avg-values {
  display: flex;
  align-items: center;
  gap: 24rpx;
  flex-shrink: 0;
}

.cat-avg-value {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2rpx;
}

.cat-avg-label {
  font-size: 19rpx;
  color: var(--app-text-3);
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

</style>
