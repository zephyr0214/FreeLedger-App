<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <!-- 标题随类型变化：借出管理 / 借入管理 -->
    <PageNav :title="pageTitle" @back="goBack">
      <template #right>
        <text class="nav-add" @click="openPanel">+ 记一笔</text>
      </template>
    </PageNav>

    <scroll-view class="page-scroll" scroll-y>
      <!--
        汇总卡
        ★ 两张口径一起看 ★
          本月合计（本月笔数）  —— 本月借出/借入了多少
          全部时间累计（累计笔数）—— 一共借出/借入了多少
        借出用支出方向（红/无色 + 负号），借入用收入方向（绿 + 正号），
        符号和配色全部交给 MoneyText 的统一规则，这里只传 type。
      -->
      <view class="summary-card">
        <view class="summary-head">
          <view class="summary-icon" :style="{ backgroundColor: accentColor + '22' }">
            <text class="summary-icon-text">{{ headEmoji }}</text>
          </view>
          <view class="summary-info">
            <text class="summary-name">{{ pageLabel }}</text>
            <text class="summary-type">{{ directionText }}</text>
          </view>
        </view>

        <text class="summary-label">本月{{ pageLabel }}</text>
        <MoneyText
          :cents="monthAmount"
          :type="loanType"
          :size="72"
          :weight="600"
        />

        <view class="summary-rows">
          <view class="summary-row">
            <text class="summary-row-label">本月笔数</text>
            <text class="summary-row-value">{{ monthStats.count }} 笔</text>
          </view>
          <view class="summary-row">
            <text class="summary-row-label">累计{{ pageLabel }}</text>
            <MoneyText :cents="totalAmount" :type="loanType" :size="26" />
          </view>
          <view class="summary-row">
            <text class="summary-row-label">累计笔数</text>
            <text class="summary-row-value">{{ totalStats.count }} 笔</text>
          </view>
        </view>
      </view>

      <!-- 空态：还没有任何借出/借入记录（加载中先让下面的列表显示「加载中…」） -->
      <view v-if="isEmpty && !loading" class="empty-wrap">
        <EmptyState
          :emoji="headEmoji"
          :title="emptyText"
          :desc="emptyDesc"
          action-text="记一笔"
          @action="openPanel"
        />
      </view>

      <!-- 最近记录（按日期分组 + 「全部 ›」进交易列表） -->
      <RecentTxnList
        v-else
        :txns="txnList"
        :loading="loading"
        :empty-text="emptyText"
        title="最近记录"
        show-more
        @more="goAllTxn"
      />

      <view class="bottom-space" />
    </scroll-view>

    <!-- 记账面板：预填类型 + 「借出」/「借入」二级分类，省得用户再选一遍 -->
    <TxnPanel v-model="showPanel" :preset="panelPreset" @saved="onSaved" />

    <!-- 全局弹窗宿主 -->
    <AppDialog />
  </view>
</template>

<script>
/**
 * 借入 / 借出管理
 *
 *   onLoad 读 ?type=expense（借出）| income（借入），默认 expense。
 *   两个方向共用这一个页面，只是分类、文案、金额方向不同。
 *
 * ★ 数据口径 ★
 *   「借出」是 type=expense 下的二级分类，「借入」是 type=income 下的二级分类，
 *   都由 api/category.js 的 ensureLoanCategories() 保证存在（幂等），
 *   这里拿到 id 之后按 categoryId 精确统计 —— 二级分类本身没有子分类，
 *   所以不需要 includeSubcategories。
 *
 * ★ 结构与其它详情页一致 ★
 *   .app-page → PageNav → scroll-view.page-scroll → 汇总卡 + 列表 + .bottom-space，
 *   AppDialog 挂在页面根节点。
 */
import { ref, computed } from 'vue'
import { onLoad, onShow, onBackPress } from '@dcloudio/uni-app'
import PageNav from '@/components/PageNav.vue'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import RecentTxnList from '@/components/RecentTxnList.vue'
import TxnPanel from '@/components/TxnPanel.vue'
import AppDialog from '@/components/AppDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { ensureLoanCategories, listCategories } from '@/api/category.js'
import { listTransactions, sumTransactions } from '@/api/transaction.js'
import { toMonthKey } from '@/utils/date.js'
import { handleBackPress } from '@/utils/layerStack.js'

/** 借出 = 支出方向，借入 = 收入方向 */
const LOAN_NAMES = { expense: '借出', income: '借入' }

/** 收入方向的图标底色（真实 hex，用来拼 `+ '22'` 半透明） */
const INCOME_COLOR = '#07C160'

export default {
  components: { PageNav, MoneyText, EmptyState, RecentTxnList, TxnPanel, AppDialog },
  setup() {
    const settingStore = useSettingStore()

    /** 一笔都没有时的统计占位（放在 setup 内，脚本的作用域检查才扫得到） */
    function emptyStats() {
      return { count: 0, expense: 0, income: 0, transfer: 0 }
    }

    /** 'expense' = 借出管理，'income' = 借入管理 */
    const loanType = ref('expense')
    /** 「借出」/「借入」二级分类的 id（找到后缓存，重新加载列表不用再查） */
    const categoryId = ref('')

    const txnList = ref([])
    const monthStats = ref(emptyStats())
    const totalStats = ref(emptyStats())
    const loading = ref(true)

    const showPanel = ref(false)
    /** 首屏加载完成后，onShow 才需要再刷一次（避免和 onLoad 重复加载） */
    let ready = false

    const pageStyle = computed(() => settingStore.cssVars)
    const primaryColor = computed(() => settingStore.primaryColor)

    const isIncome = computed(() => loanType.value === 'income')

    const pageTitle = computed(() => (isIncome.value ? '借入管理' : '借出管理'))
    const pageLabel = computed(() => LOAN_NAMES[loanType.value])
    const headEmoji = computed(() => (isIncome.value ? '📥' : '📤'))
    const directionText = computed(() =>
      isIncome.value ? '收入方向 · 向别人借入的钱' : '支出方向 · 借给别人的钱'
    )
    const emptyText = computed(() =>
      isIncome.value ? '还没有借入记录' : '还没有借出记录'
    )
    const emptyDesc = computed(() =>
      isIncome.value ? '向别人借来的钱记在这里' : '借给别人的钱记在这里'
    )
    /**
     * 汇总卡图标底色。
     *
     * ★ 必须是真实 hex，不能是 var(--app-xxx) ★
     *   下面是 `accentColor + '22'` 拼出来的半透明底色，
     *   拼在 CSS 变量上会得到 `var(--app-success)22` 这种非法值，
     *   背景直接不生效（图标底色消失）。所以收入方向用固定绿值。
     */
    const accentColor = computed(() => (isIncome.value ? INCOME_COLOR : primaryColor.value))

    /** 本月合计：借出看 expense，借入看 income */
    const monthAmount = computed(() =>
      isIncome.value ? monthStats.value.income : monthStats.value.expense
    )
    /** 全部时间累计，口径同本月 */
    const totalAmount = computed(() =>
      isIncome.value ? totalStats.value.income : totalStats.value.expense
    )

    /** 一条记录都没有（用来在列表上方换成整块空态） */
    const isEmpty = computed(() => txnList.value.length === 0 && totalStats.value.count === 0)

    /** 记账面板的预填：类型 + 借贷分类 */
    const panelPreset = computed(() => ({
      type: loanType.value,
      category_id: categoryId.value
    }))

    /**
     * 拿到「借出」/「借入」的二级分类 id。
     *
     * 首选 api/category.js 的 ensureLoanCategories()（幂等，不存在会自动建）；
     * 万一它不可用（旧版本），退化成按名字在分类表里找，页面不至于整块空掉。
     */
    async function resolveCategoryId() {
      if (categoryId.value) return categoryId.value

      try {
        const ids = await ensureLoanCategories()
        const id = isIncome.value ? ids.incomeId : ids.expenseId
        if (id) {
          categoryId.value = id
          return id
        }
      } catch (e) {
        console.warn('[loan] ensureLoanCategories 失败，改为按名称查找:', e && e.message)
      }

      const all = await listCategories(loanType.value, true)
      const hit = all.find((c) => c.name === LOAN_NAMES[loanType.value])
      categoryId.value = hit ? hit.id : ''
      return categoryId.value
    }

    async function load() {
      loading.value = true
      try {
        const id = await resolveCategoryId()

        // 分类没找到（极端情况）：清空，交给空态兜住，不要留上一批数据
        if (!id) {
          txnList.value = []
          monthStats.value = emptyStats()
          totalStats.value = emptyStats()
          return
        }

        const [list, month, total] = await Promise.all([
          listTransactions({ categoryId: id, limit: 10 }),
          sumTransactions({ categoryId: id, monthKey: toMonthKey() }),
          sumTransactions({ categoryId: id })
        ])

        txnList.value = list
        monthStats.value = month
        totalStats.value = total
      } catch (e) {
        console.warn('[loan] 加载借入借出失败:', e && e.message)
        txnList.value = []
        monthStats.value = emptyStats()
        totalStats.value = emptyStats()
      } finally {
        loading.value = false
      }
    }

    /** 「+ 记一笔」：打开记账面板（预填借贷分类） */
    function openPanel() {
      showPanel.value = true
    }

    /** 面板保存后重新拉列表与汇总 */
    function onSaved() {
      load()
    }

    /**
     * 「全部 ›」→ 交易列表
     * categoryId 是二级分类，精确匹配自己，不用带 includeSubcategories。
     */
    function goAllTxn() {
      if (!categoryId.value) return
      uni.navigateTo({ url: `/pages/txn/list?categoryId=${categoryId.value}` })
    }

    function goBack() {
      uni.navigateBack()
    }

    onLoad(async (options) => {
      const raw = String((options && options.type) || '').toLowerCase()
      loanType.value = raw === 'income' ? 'income' : 'expense'

      if (!settingStore.loaded) await settingStore.load()
      await load()
      ready = true
    })

    onShow(async () => {
      settingStore.syncSystemTheme()
      if (ready) await load()
    })

    // 侧滑返回 / 物理返回键：记账面板打开时先收起面板，不退出本页
    onBackPress(() => handleBackPress())

    return {
      settingStore, loanType, categoryId, txnList, monthStats, totalStats, loading,
      showPanel, pageStyle, primaryColor, isIncome, pageTitle, pageLabel, headEmoji,
      directionText, emptyText, emptyDesc, accentColor, monthAmount, totalAmount,
      isEmpty, panelPreset,
      openPanel, onSaved, goAllTxn, goBack
    }
  }
}
</script>

<style scoped>
/* 右上角：+ 记一笔（视觉对齐 pages/settings/profile.vue 的 .nav-save） */
.nav-add {
  font-size: 26rpx;
  color: var(--app-primary);
  font-weight: 500;
  white-space: nowrap;
}

.page-scroll {
  padding: 0 32rpx;
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

/* 空态 */
.empty-wrap {
  background-color: var(--app-card);
  border-radius: 20rpx;
  margin-top: 24rpx;
}
</style>
