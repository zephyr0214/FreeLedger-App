<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <AppHeader @avatar-click="goProfile">
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
          <view class="card-head-right">
            <!-- ★ 一级/二级分类切换：与支出/收入同款按钮，放左边 ★ -->
            <view class="type-toggle">
              <text
                class="type-tag"
                :class="{ active: categoryLevel === 'sub' }"
                @click="switchCategoryLevel('sub')"
              >二级</text>
              <text
                class="type-tag"
                :class="{ active: categoryLevel === 'root' }"
                @click="switchCategoryLevel('root')"
              >一级</text>
            </view>
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
        </view>

        <view v-if="categoryStats.length === 0" class="card-empty">
          <text class="empty-text">{{ rangeLabel }}暂无数据</text>
        </view>

        <view v-else>
          <!-- 环形图：SVG，引导线直接标注「分类名 占比%」，中央显示总计 -->
          <view class="donut-wrap">
            <image class="donut-img" :src="categoryDonutUri" mode="widthFix" />
            <view class="donut-center">
              <text class="donut-center-label">合计</text>
              <MoneyText :cents="categoryTotal" :size="28" :weight="600" color="var(--app-text)" />
            </view>
          </view>

          <!-- 下方：色点 + 分类名 + 笔数 + 总金额（不再显示占比和进度条） -->
          <view class="rank-list">
            <view
              v-for="(cat, i) in categoryStats.slice(0, 10)"
              :key="cat.id"
              class="rank-item"
            >
              <view class="rank-dot" :style="{ backgroundColor: cat.color }" />
              <view class="rank-label-col">
                <text class="rank-name">{{ cat.name }}</text>
                <text v-if="categoryLevel === 'sub'" class="rank-sub">{{ cat.parentName }}</text>
              </view>
              <view class="rank-count">
                <text class="rank-count-num">{{ cat.count }}</text>
                <text class="rank-count-unit">笔</text>
              </view>
              <view class="rank-amount">
                <MoneyText :cents="cat.amount" :size="26" color="var(--app-text)" />
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- ② 账户统计（按账户 / 按账户类别，合并为一个面板） -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">账户统计</text>
          <view class="card-head-right">
            <!-- ★ 账户/账户类别切换：与支出/收入同款按钮，放左边 ★ -->
            <view class="type-toggle">
              <text
                class="type-tag"
                :class="{ active: accountViewMode === 'account' }"
                @click="switchAccountViewMode('account')"
              >账户</text>
              <text
                class="type-tag"
                :class="{ active: accountViewMode === 'type' }"
                @click="switchAccountViewMode('type')"
              >类别</text>
            </view>
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
        </view>

        <view v-if="accountViewList.length === 0" class="card-empty">
          <text class="empty-text">{{ rangeLabel }}暂无数据</text>
        </view>

        <view v-else>
          <view class="donut-wrap">
            <image class="donut-img" :src="accountViewDonutUri" mode="widthFix" />
            <view class="donut-center">
              <text class="donut-center-label">合计</text>
              <MoneyText
                :cents="accountViewMode === 'type' ? accountTypeTotal : accountTotal"
                :size="28"
                :weight="600"
                color="var(--app-text)"
              />
            </view>
          </view>
          <view class="rank-list">
            <view v-for="(acc, i) in accountViewList" :key="acc.key || acc.id" class="rank-item">
              <view class="rank-dot" :style="{ backgroundColor: acc.color }" />
              <text class="rank-name">{{ acc.name }}</text>
              <view class="rank-count">
                <text class="rank-count-num">{{ acc.count }}</text>
                <text class="rank-count-unit">笔</text>
              </view>
              <view class="rank-amount">
                <MoneyText :cents="acc.amount" :size="26" color="var(--app-text)" />
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
          <!-- ★ 最高日 / 最低日：左右两边对齐，价签黑色 ★ -->
          <view v-if="dailyExtremes" class="daily-extremes">
            <view class="daily-extreme">
              <text class="extreme-label">最高{{ trendUnit === '月' ? '月' : '日' }}</text>
              <text class="extreme-value">{{ dailyExtremes.max.label }}{{ trendUnit }} · </text>
              <MoneyText :cents="dailyExtremes.max.expense" :size="24" color="var(--app-text)" />
            </view>
            <view class="daily-extreme">
              <text class="extreme-label">最低{{ trendUnit === '月' ? '月' : '日' }}</text>
              <text class="extreme-value">{{ dailyExtremes.min.label }}{{ trendUnit }} · </text>
              <MoneyText :cents="dailyExtremes.min.expense" :size="24" color="var(--app-text)" />
            </view>
          </view>
        </view>
      </view>

      <!-- ④ 平均值：总体 + 各分类 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">平均值</text>
          <view class="card-head-right">
            <!-- ★ 一级/二级分类切换：与支出/收入同款按钮，放左边 ★ -->
            <view class="type-toggle">
              <text
                class="type-tag"
                :class="{ active: averageLevel === 'sub' }"
                @click="switchAverageLevel('sub')"
              >二级</text>
              <text
                class="type-tag"
                :class="{ active: averageLevel === 'root' }"
                @click="switchAverageLevel('root')"
              >一级</text>
            </view>
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
              <!-- 二级分类时显示所属一级分类；一级分类时不显示 -->
              <text v-if="averageLevel === 'sub'" class="cat-avg-hint">{{ c.parentName }} · {{ c.count }} 笔</text>
              <text v-else class="cat-avg-hint">{{ c.count }} 笔</text>
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

      <view class="tabbar-space" />
    </scroll-view>

    <!-- 圆角悬浮底栏（与首页同一份组件） -->
    <AppTabBar
      current="stats"
      :hold-enabled="settingStore.quickAddHoldAction !== 'none'"
      @single-press="onAddTap"
      @hold-end="onAddHoldEnd"
    />

  </view>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppHeader from '@/components/AppHeader.vue'
import MoneyText from '@/components/MoneyText.vue'
import DateRangePicker from '@/components/DateRangePicker.vue'
import HeaderAction from '@/components/HeaderAction.vue'
import AppTabBar from '@/components/AppTabBar.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useUiStore } from '@/stores/ui.js'
import { gotoHomeAndAdd } from '@/utils/tabBar.js'
import { donutToDataUri } from '@/utils/donut.js'
import {
  getOverviewRange, getCategoryStatsRange, getSubCategoryStatsRange,
  getAccountStatsRange, getAccountTypeStatsRange, getCategoryAveragesRange,
  getSubCategoryAveragesRange,
  getDailyTrendRange, getAveragesRange, getTopExpensesRange,
  PIE_PALETTE
} from '@/api/stats.js'
import {
  selectionToRange, defaultSelection, selectionLabel
} from '@/utils/date.js'

export default {
  components: { AppHeader, MoneyText, DateRangePicker, HeaderAction, AppTabBar },
  setup() {
    const settingStore = useSettingStore()
    const uiStore = useUiStore()

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
    const averageStatType = ref('expense')

    /*
     * ★ 账户统计视图：按账户 / 按账户类别 ★
     *   两个视图合并在一个面板里，用与支出/收入同款的按钮切换。
     *   'account' = 按具体账户分（每个账户一块）
     *   'type' = 按账户类别分（网络支付、信用卡…）
     */
    const accountViewMode = ref('account')

    /*
     * ★ 分类层级：一级分类 / 二级分类 ★
     *   分类统计、平均值两个面板各有独立的切换（与支出/收入同款按钮）。
     *   'sub' = 二级分类（午餐、外卖…，默认，贴近用户实际记的）
     *   'root' = 一级分类（餐饮、居住…，统计口径）
     */
    const categoryLevel = ref('sub')
    const averageLevel = ref('sub')

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
     * 环形图：用 SVG 构建（扇区 + 引导线 + 文字标注），生成 data URI。
     *
     * ★ 为什么不用 conic-gradient ★
     *   需求是「环形图用引导线直接显示每个部分的名称和占比」，
     *   CSS 渐变无法在图上标注文字，所以改用 SVG（见 utils/donut.js）。
     *   文字颜色要传给纯函数，因为 SVG 是 data URI 独立文档，
     *   拿不到页面上的 CSS 变量。
     */
    const donutTextColor = computed(() => {
      // 深色主题用浅字，浅色主题用深字
      const isDark = /dark/i.test(settingStore.theme || '')
      return isDark ? '#9CA3AF' : '#666666'
    })

    /** 分类统计环形图（SVG data URI） */
    const categoryDonutUri = computed(() =>
      donutToDataUri(categoryStats.value, {
        total: categoryTotal.value,
        topN: 10,
        textColor: donutTextColor.value
      })
    )

    /**
     * 账户统计的列表：按视图返回账户或账户类别。
     * 统一为 { key, name, color, amount, count }，方便模板一处渲染。
     */
    const accountViewList = computed(() => {
      if (accountViewMode.value === 'type') {
        return accountTypeStats.value.map((t) => ({
          key: t.key,
          name: t.name,
          color: t.color,
          amount: t.amount,
          count: t.count
        }))
      }
      return accountStats.value.map((a, i) => ({
        key: a.id,
        name: a.name,
        color: accColor(a, i),
        amount: a.amount,
        count: a.count
      }))
    })

    /** 账户统计的环形图：按视图返回账户或账户类别的 SVG */
    const accountViewDonutUri = computed(() => {
      if (accountViewMode.value === 'type') {
        return donutToDataUri(accountTypeStats.value, {
          total: accountTypeTotal.value,
          topN: 8,
          textColor: donutTextColor.value
        })
      }
      return donutToDataUri(
        accountStats.value.map((a, i) => ({ name: a.name, amount: a.amount, color: accColor(a, i) })),
        { total: accountTotal.value, topN: 10, textColor: donutTextColor.value }
      )
    })

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

    const maxDailyExpense = computed(() => {
      const vals = dailyTrend.value.map((d) => d.expense)
      return Math.max(...vals, 1)
    })

    function barHeight(v) {
      if (!v) return 0
      return Math.round((v / maxDailyExpense.value) * 100)
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
          // 分类统计：按面板的层级（一级/二级）查询
          categoryLevel.value === 'root'
            ? getCategoryStatsRange(r, categoryStatType.value)
            : getSubCategoryStatsRange(r, categoryStatType.value),
          getAccountStatsRange(r, accountStatType.value),
          getAccountTypeStatsRange(r, accountStatType.value),
          // 平均值：按面板的层级（一级/二级）查询
          averageLevel.value === 'root'
            ? getCategoryAveragesRange(r, averageStatType.value)
            : getSubCategoryAveragesRange(r, averageStatType.value),
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

    function goProfile() {
    uni.navigateTo({ url: '/pages/settings/profile' })
  }

    /* ------------------------------------------------------ 记账按钮 */

    /** 短按：记下意图并切回首页（面板只挂在首页） */
    function onAddTap() {
      gotoHomeAndAdd(settingStore.quickAddTapAction === 'manual' ? 'manual' : 'ai', uiStore)
    }

    /** 长按：同上，按长按的配置打开 */
    function onAddHoldEnd() {
      gotoHomeAndAdd(settingStore.quickAddHoldAction === 'manual' ? 'manual' : 'ai', uiStore)
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

    /** 分类统计：切换支出/收入（按当前层级查询） */
    async function switchCategoryType(type) {
      if (categoryStatType.value === type) return
      categoryStatType.value = type
      try {
        categoryStats.value = categoryLevel.value === 'root'
          ? await getCategoryStatsRange(range.value, type)
          : await getSubCategoryStatsRange(range.value, type)
      } catch (e) {
        console.error('[stats] 分类统计切换失败', e)
      }
    }

    /**
     * 账户统计：切换支出/收入。
     * ★ 同时加载「按账户」和「按账户类别」两个数据源 ★
     *   面板合并后，用户可能在任一视图下切换支出/收入，
     *   必须两个都更新，切回另一视图时数据才是新的。
     */
    async function switchAccountType(type) {
      if (accountStatType.value === type) return
      accountStatType.value = type
      try {
        const [accs, accTypes] = await Promise.all([
          getAccountStatsRange(range.value, type),
          getAccountTypeStatsRange(range.value, type)
        ])
        accountStats.value = accs
        accountTypeStats.value = accTypes
      } catch (e) {
        console.error('[stats] 账户统计切换失败', e)
      }
    }

    /**
     * 账户统计：切换「按账户 / 按账户类别」视图。
     * 两个数据源已在 loadAll 加载，这里只切显示，不用重新查询。
     */
    function switchAccountViewMode(mode) {
      if (accountViewMode.value === mode) return
      accountViewMode.value = mode
    }

    /** 平均值：切换支出/收入（按当前层级查询） */
    async function switchAverageType(type) {
      if (averageStatType.value === type) return
      averageStatType.value = type
      try {
        const [avgs, catAvgs] = await Promise.all([
          getAveragesRange(range.value, type),
          averageLevel.value === 'root'
            ? getCategoryAveragesRange(range.value, type)
            : getSubCategoryAveragesRange(range.value, type)
        ])
        averages.value = avgs
        categoryAverages.value = catAvgs
      } catch (e) {
        console.error('[stats] 平均值切换失败', e)
      }
    }

    /* ------------------------------------------------ 一级/二级分类切换 */

    /** 分类统计：切换一级/二级分类 */
    async function switchCategoryLevel(level) {
      if (categoryLevel.value === level) return
      categoryLevel.value = level
      try {
        categoryStats.value = categoryLevel.value === 'root'
          ? await getCategoryStatsRange(range.value, categoryStatType.value)
          : await getSubCategoryStatsRange(range.value, categoryStatType.value)
      } catch (e) {
        console.error('[stats] 分类统计层级切换失败', e)
      }
    }

    /** 平均值：切换一级/二级分类 */
    async function switchAverageLevel(level) {
      if (averageLevel.value === level) return
      averageLevel.value = level
      try {
        categoryAverages.value = averageLevel.value === 'root'
          ? await getCategoryAveragesRange(range.value, averageStatType.value)
          : await getSubCategoryAveragesRange(range.value, averageStatType.value)
      } catch (e) {
        console.error('[stats] 平均值层级切换失败', e)
      }
    }

    /** 日趋势的最高/最低（含花销），无数据或全为 0 时返回 null */
    const dailyExtremes = computed(() => {
      const list = dailyTrend.value.filter((d) => Number(d.expense) > 0)
      if (list.length === 0) return null
      let max = list[0]
      let min = list[0]
      for (const d of list) {
        if (Number(d.expense) > Number(max.expense)) max = d
        if (Number(d.expense) < Number(min.expense)) min = d
      }
      return { max: { label: max.label, expense: max.expense }, min: { label: min.label, expense: min.expense } }
    })

    return {
      settingStore,
      dateRange,
      categoryStatType, accountStatType, averageStatType,
      categoryLevel, averageLevel, accountViewMode,
      categoryStats, accountStats, accountTypeStats, categoryAverages,
      dailyTrend, averages, topExpenses, overview,
      primaryColor, pageStyle, rangeLabel, trendTitle, trendSubtitle, trendUnit,
      categoryTotal, categoryDonutUri, accountTotal, accountTypeTotal,
      accountViewList, accountViewDonutUri,
      dailyExtremes,
      barHeight, shortDay, accColor,
      loadAll, onRangeChange,
      switchCategoryType, switchAccountType, switchAverageType,
      switchCategoryLevel, switchAverageLevel, switchAccountViewMode,
      onAddTap, onAddHoldEnd,
      goTxnDetail, goAiChat, goProfile
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

/* 标题右侧：层级切换 + 支出/收入切换并排 */
.card-head-right {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;
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

/* 环形图：SVG 图（引导线+文字标注），用 image 加载 data URI */
.donut-wrap {
  position: relative;
  display: flex;
  justify-content: center;
  padding: 16rpx 0 28rpx;
}

.donut-img {
  /*
   * ★ 横向撑满卡片 ★
   *   SVG viewBox 是 300×180（5:3），mode="widthFix" 会按比例撑高，
   *   所以这里不需要写死 height —— 让它随宽度等比缩放，
   *   引导线和文字才不会变形。
   *   width: 100% 让图撑满卡片内容区（630rpx），
   *   引导线文字左右正好贴卡片内边距，视觉上横贯整张卡。
   */
  width: 100%;
}

/*
 * ★ 环形图中央：总计 ★
 *   绝对定位在环的洞中心。洞的内径 44（viewBox 300），
 *   撑满 630rpx 后洞直径约 185rpx，足够放「合计 + 金额」。
 *   left/top 用 50% 居中，再靠 flex 列排内容。
 */
.donut-center {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2rpx;
  /* 不挡住下面的列表点击（虽然图本身无点击） */
  pointer-events: none;
  /* 洞宽约 185rpx，内容最宽不能超过它 */
  max-width: 200rpx;
}

.donut-center-label {
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

/* 排行：名称列占满剩余空间，右侧依次是笔数、金额 */
.rank-name {
  font-size: 24rpx;
  color: var(--app-text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 分类名 + 所属一级分类（两行），占满剩余空间 */
.rank-label-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2rpx;
  overflow: hidden;
}

.rank-label-col .rank-name {
  flex: none;
  width: 100%;
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

/* 笔数：数字 + 「笔」，右对齐到金额前面 */
.rank-count {
  display: flex;
  align-items: baseline;
  gap: 2rpx;
  flex-shrink: 0;
  margin-right: 12rpx;
  min-width: 64rpx;
  justify-content: flex-end;
}

.rank-count-num {
  font-size: 24rpx;
  color: var(--app-text-2);
  font-weight: 500;
}

.rank-count-unit {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* 金额列固定宽度：金额位数变了，右端也不漂移 */
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

/* 日趋势下方的最高/最低日：左右两边对齐 */
.daily-extremes {
  display: flex;
  justify-content: space-between;
  margin-top: 20rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid var(--app-line);
}

.daily-extreme {
  display: flex;
  align-items: baseline;
  gap: 4rpx;
}

.extreme-label {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.extreme-value {
  font-size: 24rpx;
  color: var(--app-text-2);
  font-weight: 500;
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
