<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <AppHeader @avatar-click="goSettings">
      <template #right>
        <!-- AI 对话入口：和首页一样，通向同一个子页面 -->
        <HeaderAction @action-click="goAiChat">AI 助手</HeaderAction>
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
                :class="{ active: categoryStatType === 'expense' }"
                @click="switchCategoryType('expense')"
              >支出</text>
              <text
                class="type-tag"
                :class="{ active: categoryStatType === 'income' }"
                @click="switchCategoryType('income')"
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

          <!-- 排行（按二级分类） -->
          <view class="rank-list">
            <view
              v-for="(cat, i) in categoryStats.slice(0, 10)"
              :key="cat.id"
              class="rank-item"
            >
              <view class="rank-dot" :style="{ backgroundColor: cat.color }" />
              <view class="rank-label-col">
                <text class="rank-name">{{ cat.name }}</text>
                <text class="rank-sub">{{ cat.parentName }}</text>
              </view>
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
              <view class="rank-amount">
                <MoneyText :cents="cat.amount" :size="26" color="var(--app-text)" />
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- ② 账户统计（按账户） -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">账户统计</text>
          <view class="type-toggle">
            <text
              class="type-tag"
              :class="{ active: accountStatType === 'expense' }"
              @click="switchAccountType('expense')"
            >支出</text>
            <text
              class="type-tag"
              :class="{ active: accountStatType === 'income' }"
              @click="switchAccountType('income')"
            >收入</text>
          </view>
        </view>

        <view v-if="accountStats.length === 0" class="card-empty">
          <text class="empty-text">{{ rangeLabel }}暂无数据</text>
        </view>

        <view v-else>
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
              <view class="rank-bar-wrap">
                <view
                  class="rank-bar"
                  :style="{
                    width: piePercent(acc.amount, accountTotal) + '%',
                    backgroundColor: accColor(acc, i)
                  }"
                />
              </view>
              <text class="rank-pct">{{ piePercent(acc.amount, accountTotal) }}%</text>
              <view class="rank-amount">
                <MoneyText :cents="acc.amount" :size="26" color="var(--app-text)" />
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- ③ 账户类别统计 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">账户类别统计</text>
          <view class="type-toggle">
            <text
              class="type-tag"
              :class="{ active: accountTypeStatType === 'expense' }"
              @click="switchAccountTypeType('expense')"
            >支出</text>
            <text
              class="type-tag"
              :class="{ active: accountTypeStatType === 'income' }"
              @click="switchAccountTypeType('income')"
            >收入</text>
          </view>
        </view>

        <view v-if="accountTypeStats.length === 0" class="card-empty">
          <text class="empty-text">{{ rangeLabel }}暂无数据</text>
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
              <view class="rank-bar-wrap">
                <view
                  class="rank-bar"
                  :style="{
                    width: piePercent(t.amount, accountTypeTotal) + '%',
                    backgroundColor: t.color
                  }"
                />
              </view>
              <text class="rank-pct">{{ piePercent(t.amount, accountTypeTotal) }}%</text>
              <view class="rank-amount">
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
          <view class="type-toggle">
            <text
              class="type-tag"
              :class="{ active: averageStatType === 'expense' }"
              @click="switchAverageType('expense')"
            >支出</text>
            <text
              class="type-tag"
              :class="{ active: averageStatType === 'income' }"
              @click="switchAverageType('income')"
            >收入</text>
          </view>
        </view>

        <!-- 总体 -->
        <view class="avg-grid">
          <view class="avg-item">
            <text class="avg-label">日均{{ averageStatType === 'expense' ? '支出' : '收入' }}</text>
            <MoneyText :cents="averages.avgPerDay" :size="34" :weight="600" color="var(--app-text)" />
            <text class="avg-hint">{{ averages.daysPassed }} 天</text>
          </view>
          <view class="avg-item">
            <text class="avg-label">笔均{{ averageStatType === 'expense' ? '支出' : '收入' }}</text>
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
            <!-- 笔均：字在上方，金额在下方 -->
            <view class="cat-avg-values">
              <text class="cat-avg-label">笔均</text>
              <MoneyText :cents="c.avgPerTxn" :size="26" color="var(--app-text)" />
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
            :class="{ 'top-item-hi': i < 3 }"
            @click="goTxnDetail(t.id)"
          >
            <text class="top-rank" :class="{ 'top-3': i < 3 }">{{ i + 1 }}</text>
            <view class="top-info">
              <text class="top-name">{{ t.category_name || '未分类' }}</text>
              <!-- ★ 账户被删除后 account_name 为空 —— 显示「无账户」而不是「无备注」 ★
                   （无备注是另一回事，两者别混） -->
              <text class="top-sub ellipsis">{{ t.note || t.account_name || '无账户' }}</text>
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
import HeaderAction from '@/components/HeaderAction.vue'
import { useSettingStore } from '@/stores/setting.js'
import {
  getOverviewRange, getSubCategoryStatsRange,
  getAccountStatsRange, getAccountTypeStatsRange, getCategoryAveragesRange,
  getDailyTrendRange, getAveragesRange, getTopExpensesRange,
  PIE_PALETTE
} from '@/api/stats.js'
import {
  selectionToRange, defaultSelection, selectionLabel
} from '@/utils/date.js'

export default {
  components: { AppHeader, MoneyText, DateRangePicker, HeaderAction },
  setup() {
    const settingStore = useSettingStore()

    /** 三级联动选择：year / month / day，0 表示「全部」 */
    const dateRange = ref(defaultSelection())
    /**
     * 每张卡片的「支出/收入」各自独立控制。
     *
     * 之前三张卡共用一个 statType，切换分类统计的收支，
     * 账户统计也跟着变 —— 但这两者的收支对比是不同的事，
     * 用户想同时看「支出的分类」和「收入的账户」。
     */
    const categoryStatType = ref('expense')
    const accountStatType = ref('expense')
    const accountTypeStatType = ref('expense')
    const averageStatType = ref('expense')

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
     *
     * @param {Array} list [{ amount, color }]
     * @param {number} total
     * @param {number} topN 画前几项，剩下的合并成一段
     */
    function buildDonut(list, total, topN = 7) {
      const all = (list || []).filter((x) => Number(x.amount) > 0)
      if (all.length === 0 || !total) {
        return { background: 'var(--app-card-2)' }
      }

      const items = all.slice(0, topN)
      const rest = all.slice(topN)
      const restAmount = rest.reduce((acc, x) => acc + Number(x.amount || 0), 0)

      let acc = 0
      const stops = []
      for (const item of items) {
        const pct = (Number(item.amount) / total) * 100
        const from = acc
        acc += pct
        stops.push(`${item.color} ${from}% ${acc}%`)
      }
      // 剩下的合并成一段
      if (restAmount > 0) {
        const from = acc
        acc += (restAmount / total) * 100
        stops.push(`var(--app-line) ${from}% ${acc}%`)
      }
      // 不足 100%（比如总额里还有没归类的）用浅色补齐
      if (acc < 100) {
        stops.push(`var(--app-line) ${acc}% 100%`)
      }

      return { background: `conic-gradient(${stops.join(', ')})` }
    }

    /** 用 conic-gradient 画环形图，避开 canvas 在 App 端首绘白屏的问题 */
    const donutStyle = computed(() =>
      buildDonut(categoryStats.value, categoryTotal.value, 10)
    )

    /** 按账户分的环形图 */
    const accountDonutStyle = computed(() =>
      buildDonut(
        accountStats.value.map((a, i) => ({ amount: a.amount, color: accColor(a, i) })),
        accountTotal.value,
        10
      )
    )

    /** 按账户类别分的环形图 */
    const accountTypeDonutStyle = computed(() =>
      buildDonut(accountTypeStats.value, accountTypeTotal.value)
    )

    /**
     * 账户配色
     *
     * ★ 统一从调色板按序取色 ★
     *   账户自带的颜色可能重复（用户建账户时颜色是可选项，
     *   很容易好几个账户都是同一个默认色），
     *   饼图上就分不开了。
     *   排行里的色点跟着饼图的色走，用同一套取色规则。
     */
    function accColor(acc, index) {
      return PIE_PALETTE[index % PIE_PALETTE.length]
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

    /**
     * 加载各卡片的数据。
     *
     * ★ 每张卡片用自己的 statType ★
     *   分类统计、账户统计、账户类别统计、平均值
     *   四张卡的「支出/收入」互相独立，
     *   所以每张卡的数据要按各自的 type 单独查。
     */
    async function loadAll() {
      const r = range.value
      try {
        const [ov, cats, accs, accTypes, catAvgs, daily, avg, top] = await Promise.all([
          getOverviewRange(r),
          // 分类统计展示**二级分类**（午餐、外卖、房租…）
          getSubCategoryStatsRange(r, categoryStatType.value),
          getAccountStatsRange(r, accountStatType.value),
          getAccountTypeStatsRange(r, accountTypeStatType.value),
          getCategoryAveragesRange(r, averageStatType.value),
          getDailyTrendRange(r),
          getAveragesRange(r, averageStatType.value),
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

    /* ------------------------------------------------ 各卡片独立切换 */

    /** 分类统计：切换支出/收入 */
    async function switchCategoryType(type) {
      if (categoryStatType.value === type) return
      categoryStatType.value = type
      try {
        categoryStats.value = await getSubCategoryStatsRange(range.value, type)
      } catch (e) {
        console.error('[stats] 分类统计切换失败', e)
      }
    }

    /** 账户统计：切换支出/收入 */
    async function switchAccountType(type) {
      if (accountStatType.value === type) return
      accountStatType.value = type
      try {
        accountStats.value = await getAccountStatsRange(range.value, type)
      } catch (e) {
        console.error('[stats] 账户统计切换失败', e)
      }
    }

    /** 账户类别统计：切换支出/收入 */
    async function switchAccountTypeType(type) {
      if (accountTypeStatType.value === type) return
      accountTypeStatType.value = type
      try {
        accountTypeStats.value = await getAccountTypeStatsRange(range.value, type)
      } catch (e) {
        console.error('[stats] 账户类别统计切换失败', e)
      }
    }

    /** 平均值：切换支出/收入 */
    async function switchAverageType(type) {
      if (averageStatType.value === type) return
      averageStatType.value = type
      try {
        const [avgs, catAvgs] = await Promise.all([
          getAveragesRange(range.value, type),
          getCategoryAveragesRange(range.value, type)
        ])
        averages.value = avgs
        categoryAverages.value = catAvgs
      } catch (e) {
        console.error('[stats] 平均值切换失败', e)
      }
    }

    return {
      settingStore,
      dateRange,
      categoryStatType, accountStatType, accountTypeStatType, averageStatType,
      categoryStats, accountStats, accountTypeStats, categoryAverages,
      dailyTrend, averages, topExpenses, overview,
      primaryColor, pageStyle, rangeLabel, trendTitle, trendSubtitle, trendUnit,
      categoryTotal, donutStyle, accountTotal, accountTypeTotal,
      accountDonutStyle, accountTypeDonutStyle,
      barHeight, catPercent, shortDay, accColor, piePercent,
      loadAll, onRangeChange,
      switchCategoryType, switchAccountType, switchAccountTypeType, switchAverageType,
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

/* AI 对话入口已抽成 components/HeaderAction.vue，四页共用同一套样式 */

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

/* 排行：名称列宽度统一，三处排行（分类/账户/账户类别）的进度条才能左右对齐 */
.rank-name {
  font-size: 24rpx;
  color: var(--app-text);
  width: 150rpx;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 分类名 + 所属一级分类（两行） */
.rank-label-col {
  width: 150rpx;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2rpx;
  overflow: hidden;
}

.rank-label-col .rank-name {
  width: auto;
  /* text 上省略号要 block 布局才生效 */
  display: block;
}

.rank-sub {
  font-size: 19rpx;
  color: var(--app-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* 金额列固定宽度：不然金额位数一变，进度条右端就跟着移 */
.rank-amount {
  width: 150rpx;
  flex-shrink: 0;
  /* 用 flex 右对齐：text-align 对行内元素在 App WebView 上不可靠 */
  display: flex;
  justify-content: flex-end;
  overflow: hidden;
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
  align-items: center;
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

/* 笔均：字在上方，金额在下方 */
.cat-avg-values {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
  flex-shrink: 0;
}

.cat-avg-label {
  font-size: 20rpx;
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

/* 前三名：浅浅的主题色背景 */
.top-item-hi {
  background-color: var(--app-primary-light);
  border-radius: 12rpx;
  padding-left: 16rpx;
  padding-right: 16rpx;
  margin-bottom: 8rpx;
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
