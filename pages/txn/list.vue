<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <!-- 自定义导航 -->
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="goBack">‹</text>
        <text class="nav-title">全部交易</text>
        <text class="nav-filter" @click="openFilter">
          筛选<text v-if="filterCount > 0" class="filter-dot">{{ filterCount }}</text>
        </text>
      </view>
    </view>

    <view class="summary-bar">
      <text class="summary-text">
        {{ rangeLabel }} · 共 {{ summary.count }} 笔
      </text>
      <view class="summary-right">
        <text class="summary-label">支出</text>
        <MoneyText :cents="summary.expense" :size="26" color="var(--app-text)" />
        <text class="summary-label" style="margin-left: 16rpx">收入</text>
        <MoneyText :cents="summary.income" :size="26" color="var(--app-success)" />
      </view>
    </view>

    <!-- 时间范围选择：年 / 月 / 日 三级联动下拉
         放在汇总条下面，下拉面板展开时不会被汇总条压住 -->
    <view class="month-bar">
      <DateRangePicker ref="datePickerRef" v-model="dateRange" @range-change="onDateChange" />
    </view>

    <scroll-view
      class="list-scroll"
      scroll-y
      @scrolltolower="loadMore"
    >
      <view v-if="groups.length === 0" class="empty-wrap">
        <EmptyState
          emoji="🔍"
          title="没有符合条件的交易"
          :desc="filterCount > 0 ? '试试调整筛选条件' : `${rangeLabel}还没有记账`"
        />
      </view>

      <view v-for="group in groups" :key="group.day" class="day-group">
        <view class="day-head">
          <text class="day-title">{{ group.title }}</text>
          <view class="day-sum">
            <text v-if="group.expense > 0" class="day-sum-text">
              支出 {{ (group.expense / 100).toFixed(2) }}
            </text>
            <text v-if="group.income > 0" class="day-sum-text day-income">
              收入 {{ (group.income / 100).toFixed(2) }}
            </text>
          </view>
        </view>

        <view class="day-list">
          <view
            v-for="txn in group.list"
            :key="txn.id"
            class="txn-item"
            @click="goDetail(txn.id)"
            @longpress="onLongPress(txn)"
          >
            <view
              class="txn-icon"
              :style="{ backgroundColor: (txn.category_color || '#969799') + '22' }"
            >
              <text class="txn-icon-text" :style="{ color: txn.category_color || '#969799' }">
                {{ iconChar(txn) }}
              </text>
            </view>

            <view class="txn-info">
              <view class="txn-name-row">
                <text class="txn-name">{{ txnTitle(txn) }}</text>
                <view v-if="txn.tag_ids && txn.tag_ids.length" class="tag-mini">
                  <text class="tag-mini-text">{{ txn.tag_ids.length }}标签</text>
                </view>
              </view>
              <text class="txn-sub ellipsis">{{ txnSub(txn) }}</text>
            </view>

            <view class="txn-right">
              <MoneyText
                :cents="txn.amount_cents"
                :size="30"
                :weight="500"
                :sign="txn.type === 'income'"
                :color="txn.type === 'expense' ? 'var(--app-text)' : (txn.type === 'income' ? 'var(--app-success)' : 'var(--app-text-2)')"
              />
              <text class="txn-time">{{ timeLabel(txn.occurred_at) }}</text>
            </view>
          </view>
        </view>
      </view>

      <view v-if="hasMore" class="load-more">
        <text class="load-text">加载中…</text>
      </view>
      <view v-else-if="groups.length > 0" class="load-more">
        <text class="load-text">没有更多了</text>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 筛选面板 -->
    <!-- z-index 100：明确高于日期选择器（5）与其它库弹层（10~15），
         避免下拉面板浮到筛选面板上面 -->
    <wd-popup
      v-model="showFilter"
      position="right"
      :z-index="100"
      custom-style="width: 78vw; height: 100vh; background-color: var(--app-bg);"
    >
      <view class="filter-panel">
        <!-- 状态栏占位：全面屏的摄像头/刘海会挡住标题。
             Android 上 env(safe-area-inset-top) 通常是 0，
             必须用 JS 读到的 statusBarHeight 补。
             （和 AppHeader / PageNav 同一套做法） -->
        <view class="filter-status-bar" :style="{ height: statusBarHeight + 'px' }" />

        <view class="filter-head">
          <text class="filter-title">筛选</text>
          <text class="filter-reset" @click="resetFilter">重置</text>
        </view>

        <scroll-view class="filter-body" scroll-y>
          <!-- 类型 -->
          <view class="filter-section">
            <text class="filter-label">类型</text>
            <view class="chip-wrap">
              <view
                v-for="t in typeOptions"
                :key="t.key"
                class="chip"
                :class="{ active: filter.type === t.key }"
                @click="filter.type = t.key"
              >
                <text class="chip-text" :style="{ color: filter.type === t.key ? primaryColor : 'var(--app-text-2)' }">
                  {{ t.name }}
                </text>
              </view>
            </view>
          </view>

          <!-- 账户 -->
          <view class="filter-section">
            <text class="filter-label">账户</text>
            <view class="chip-wrap">
              <view
                class="chip"
                :class="{ active: !filter.accountId }"
                @click="filter.accountId = ''"
              >
                <text class="chip-text" :style="{ color: !filter.accountId ? primaryColor : 'var(--app-text-2)' }">全部</text>
              </view>
              <view
                v-for="acc in accountStore.list"
                :key="acc.id"
                class="chip"
                :class="{ active: filter.accountId === acc.id }"
                @click="filter.accountId = acc.id"
              >
                <text class="chip-text" :style="{ color: filter.accountId === acc.id ? primaryColor : 'var(--app-text-2)' }">
                  {{ acc.name }}
                </text>
              </view>
            </view>
          </view>

          <!-- 分类 -->
          <view class="filter-section">
            <text class="filter-label">分类</text>
            <view class="chip-wrap">
              <view
                class="chip"
                :class="{ active: !filter.categoryId }"
                @click="filter.categoryId = ''"
              >
                <text class="chip-text" :style="{ color: !filter.categoryId ? primaryColor : 'var(--app-text-2)' }">全部</text>
              </view>
              <view
                v-for="cat in parentCategories"
                :key="cat.id"
                class="chip"
                :class="{ active: filter.categoryId === cat.id }"
                @click="filter.categoryId = cat.id"
              >
                <text class="chip-text" :style="{ color: filter.categoryId === cat.id ? primaryColor : 'var(--app-text-2)' }">
                  {{ cat.name }}
                </text>
              </view>
            </view>
          </view>

          <!-- 标签 -->
          <view class="filter-section">
            <text class="filter-label">标签</text>
            <view class="chip-wrap">
              <view
                class="chip"
                :class="{ active: !filter.tagId }"
                @click="filter.tagId = ''"
              >
                <text class="chip-text" :style="{ color: !filter.tagId ? primaryColor : 'var(--app-text-2)' }">全部</text>
              </view>
              <view
                v-for="t in tags"
                :key="t.id"
                class="chip"
                :class="{ active: filter.tagId === t.id }"
                @click="filter.tagId = t.id"
              >
                <text class="chip-text" :style="{ color: filter.tagId === t.id ? primaryColor : 'var(--app-text-2)' }">
                  {{ t.name }}
                </text>
              </view>
            </view>
          </view>

          <!-- 关键词 -->
          <view class="filter-section">
            <text class="filter-label">关键词</text>
            <input
              v-model="filter.keyword"
              class="filter-input"
              placeholder="搜索备注"
              placeholder-class="filter-placeholder"
            />
          </view>

          <!-- 金额区间 -->
          <view class="filter-section">
            <text class="filter-label">金额区间（元）</text>
            <view class="range-row">
              <input
                v-model="filter.minYuan"
                class="range-input"
                type="digit"
                placeholder="最小"
                placeholder-class="filter-placeholder"
              />
              <text class="range-sep">—</text>
              <input
                v-model="filter.maxYuan"
                class="range-input"
                type="digit"
                placeholder="最大"
                placeholder-class="filter-placeholder"
              />
            </view>
          </view>
        </scroll-view>

        <view class="filter-actions">
          <!-- 自绘按钮而不是 wd-button：
               wd-button type="primary" 的颜色来自库变量
               （--wot-color-theme），不跟我们的主题色走。
               这里直接用 primaryColor，保证与全 App 主题一致。 -->
          <view
            class="filter-apply"
            :style="{ backgroundColor: primaryColor }"
            @click="applyFilter"
          >
            <text class="filter-apply-text">应用筛选</text>
          </view>
        </view>
      </view>
    </wd-popup>
  </view>
</template>

<script>
import { ref, reactive, computed, onMounted } from 'vue'
import { onShow, onLoad } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import DateRangePicker from '@/components/DateRangePicker.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { listTransactions, sumTransactions, deleteTransaction } from '@/api/transaction.js'
import { listCategories } from '@/api/category.js'
import { listTags } from '@/api/tag.js'
import { formatDayHeader, formatTime, selectionToRange, defaultSelection, selectionFromDayKey } from '@/utils/date.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'
import { parseAmountInput } from '@/utils/money.js'

const PAGE_SIZE = 50

export default {
  components: { MoneyText, EmptyState, DateRangePicker },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()
    const txnStore = useTransactionStore()

    const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20

    /** 三级联动选择：year / month / day，0 表示「全部」 */
    const dateRange = ref(defaultSelection())
    const list = ref([])
    const summary = ref({ count: 0, expense: 0, income: 0, transfer: 0 })
    const offset = ref(0)
    const hasMore = ref(true)
    const loading = ref(false)
    const showFilter = ref(false)
    /** 日期选择器实例（打开筛选时要先收起它的下拉） */
    const datePickerRef = ref(null)

    const categories = ref([])
    const tags = ref([])

    const filter = reactive({
      type: 'all',
      accountId: '',
      categoryId: '',
      tagId: '',
      keyword: '',
      minYuan: '',
      maxYuan: ''
    })

    // 已应用的筛选（与面板里的编辑态分离）
    const appliedFilter = reactive({ ...filter })

    const typeOptions = [
      { key: 'all', name: '全部' },
      { key: 'expense', name: '支出' },
      { key: 'income', name: '收入' },
      { key: 'transfer', name: '转账' }
    ]

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    const rangeLabel = computed(() => {
      const sel = dateRange.value
      if (!sel.year) return '全部年'
      if (!sel.month) return `${sel.year}年`
      if (!sel.day) return `${sel.year}年${sel.month}月`
      return `${sel.year}年${sel.month}月${sel.day}日`
    })


    const parentCategories = computed(() =>
      categories.value.filter((c) => c.isParent && c.type !== 'income')
    )

    const filterCount = computed(() => {
      let n = 0
      if (appliedFilter.type && appliedFilter.type !== 'all') n++
      if (appliedFilter.accountId) n++
      if (appliedFilter.categoryId) n++
      if (appliedFilter.tagId) n++
      if (appliedFilter.keyword) n++
      if (appliedFilter.minYuan || appliedFilter.maxYuan) n++
      return n
    })

    /** 按天分组 */
    const groups = computed(() => {
      const map = new Map()
      for (const txn of list.value) {
        const day = txn.occurred_day
        if (!map.has(day)) {
          map.set(day, { day, title: formatDayHeader(day), list: [], expense: 0, income: 0 })
        }
        const g = map.get(day)
        g.list.push(txn)
        if (txn.type === 'expense') g.expense += txn.amount_cents
        if (txn.type === 'income') g.income += txn.amount_cents
      }
      return Array.from(map.values())
    })

    /* ------------------------------------------------------ 查询 */

    function buildQuery() {
      const sel = dateRange.value
      const r = selectionToRange(sel)
      const q = {
        limit: PAGE_SIZE,
        offset: offset.value
      }
      // 整月用 month_key（走 idx_txn_month_type），其余用 occurred_day 区间
      if (sel.year && sel.month && !sel.day) {
        q.monthKey = r.monthKey
      } else {
        if (r.startDay) q.startDay = r.startDay
        if (r.endDay) q.endDay = r.endDay
      }
      if (appliedFilter.type !== 'all') q.type = appliedFilter.type
      if (appliedFilter.accountId) q.accountId = appliedFilter.accountId
      if (appliedFilter.categoryId) q.categoryId = appliedFilter.categoryId
      if (appliedFilter.tagId) q.tagId = appliedFilter.tagId
      if (appliedFilter.keyword) q.keyword = appliedFilter.keyword

      const min = parseAmountInput(appliedFilter.minYuan)
      const max = parseAmountInput(appliedFilter.maxYuan)
      if (appliedFilter.minYuan && min) q.minCents = min
      if (appliedFilter.maxYuan && max) q.maxCents = max

      return q
    }

    async function loadFirstPage() {
      loading.value = true
      offset.value = 0
      try {
        const q = buildQuery()
        const [rows, sum] = await Promise.all([
          listTransactions(q),
          sumTransactions({ ...q, limit: undefined, offset: undefined })
        ])
        list.value = rows
        summary.value = sum
        hasMore.value = rows.length >= PAGE_SIZE
        offset.value = rows.length
      } finally {
        loading.value = false
      }
    }

    async function loadMore() {
      if (!hasMore.value || loading.value) return
      loading.value = true
      try {
        const q = buildQuery()
        const rows = await listTransactions(q)
        if (rows.length === 0) {
          hasMore.value = false
          return
        }
        list.value = list.value.concat(rows)
        offset.value += rows.length
        hasMore.value = rows.length >= PAGE_SIZE
      } finally {
        loading.value = false
      }
    }

    function applyFilter() {
      Object.assign(appliedFilter, filter)
      showFilter.value = false
      loadFirstPage()
    }

    function resetFilter() {
      Object.assign(filter, {
        type: 'all', accountId: '', categoryId: '', tagId: '',
        keyword: '', minYuan: '', maxYuan: ''
      })
    }

    /** 三级联动选择变化：重新查询 */
    function onDateChange(sel) {
      dateRange.value = { ...sel }
      loadFirstPage()
    }

    /**
     * 打开筛选面板
     *
     * 先把日期选择器的下拉收起来：
     *   否则下拉面板和它的遮罩会留在屏幕上，
     *   看起来像是浮在筛选面板上面。
     */
    function openFilter() {
      if (datePickerRef.value && typeof datePickerRef.value.collapse === 'function') {
        datePickerRef.value.collapse()
      }
      showFilter.value = true
    }

    /* ------------------------------------------------------ 交互 */

    function iconChar(txn) {
      if (txn.type === 'transfer') return '⇄'
      return txn.category_icon
        ? iconEmoji(txn.category_icon)
        : guessIconByName(txn.category_name)
    }

    function txnTitle(txn) {
      if (txn.type === 'transfer') {
        return `${txn.account_name || '-'} → ${txn.to_account_name || '-'}`
      }
      return txn.category_name || '未分类'
    }

    function txnSub(txn) {
      const parts = []
      if (txn.note) parts.push(txn.note)
      if (txn.type !== 'transfer') parts.push(txn.account_name || '')
      return parts.filter(Boolean).join(' · ') || '无备注'
    }

    function timeLabel(ts) {
      return formatTime(ts)
    }

    function goDetail(id) {
      uni.navigateTo({ url: `/pages/txn/detail?id=${id}` })
    }

    function goBack() {
      uni.navigateBack()
    }

    /** 长按删除（软删除 + 二次确认） */
    function onLongPress(txn) {
      uni.showModal({
        title: '删除这笔记录？',
        content: `${txnTitle(txn)} ¥${(txn.amount_cents / 100).toFixed(2)}`,
        confirmText: '删除',
        confirmColor: '#ee0a24',
        success: async (res) => {
          if (!res.confirm) return
          try {
            await deleteTransaction(txn.id)
            uni.showToast({ title: '已删除', icon: 'success' })
            await loadFirstPage()
          } catch (e) {
            uni.showModal({ title: '删除失败', content: e.message, showCancel: false })
          }
        }
      })
    }

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await accountStore.load()
      const [cats, tgs] = await Promise.all([listCategories(), listTags()])
      categories.value = cats
      tags.value = tgs
      await loadFirstPage()
    })

    /**
     * 深链：从首页月历点某一天进来时带 ?day=YYYY-MM-DD
     * 没有 day 参数则显示当月（全部日）
     */
    onLoad((options) => {
      const day = options && options.day
      if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
        dateRange.value = selectionFromDayKey(day)
      }
    })

    onShow(() => {
      settingStore.syncSystemTheme()
    })

    return {
      settingStore, accountStore, statusBarHeight,
      dateRange, datePickerRef, list, summary, hasMore, loading, showFilter,
      filter, appliedFilter, typeOptions, categories, tags,
      primaryColor, pageStyle, rangeLabel, parentCategories, filterCount, groups,
      loadMore, applyFilter, resetFilter, onDateChange, openFilter,
      iconChar, txnTitle, txnSub, timeLabel, goDetail, goBack, onLongPress
    }
  }
}
</script>

<style scoped>
/* 导航 */
.nav-bar {
  background-color: var(--app-bg);
  flex-shrink: 0;
}

.nav-inner {
  height: 88rpx;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
}

.nav-back {
  font-size: 48rpx;
  color: var(--app-text);
  width: 60rpx;
  line-height: 1;
}

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.nav-filter {
  font-size: 26rpx;
  color: var(--app-text-2);
  width: 100rpx;
  text-align: right;
  position: relative;
}

.filter-dot {
  font-size: 18rpx;
  color: #ffffff;
  background-color: var(--app-primary);
  border-radius: 50%;
  padding: 0 8rpx;
  margin-left: 4rpx;
}

/* 时间范围选择 */
.month-bar {
  flex-shrink: 0;
  position: relative;
  /*
   * 层级 5：
   *   高于下方的 scroll-view（无 z-index）——下拉面板才不会被列表盖住；
   *   低于 wd-popup 筛选面板（z-index 10）——筛选打开时下拉面板不会浮在上面。
   */
  z-index: 5;
  padding: 0 32rpx 12rpx;
}

/* 汇总 */
.summary-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12rpx 32rpx 20rpx;
}

.summary-text {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.summary-right {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.summary-label {
  font-size: 22rpx;
  color: var(--app-text-3);
}

/* 列表 */
.list-scroll {
  padding: 0 32rpx;
}

.day-group {
  margin-bottom: 24rpx;
}

.day-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12rpx 4rpx;
}

.day-title {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.day-sum {
  display: flex;
  gap: 16rpx;
}

.day-sum-text {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.day-income {
  color: var(--app-success);
}

.day-list {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
}

.txn-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx 28rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.txn-item:last-child {
  border-bottom: none;
}

.txn-icon {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.txn-icon-text {
  font-size: 28rpx;
  font-weight: 500;
}

.txn-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  min-width: 0;
}

.txn-name-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.txn-name {
  font-size: 28rpx;
  color: var(--app-text);
  font-weight: 500;
}

.tag-mini {
  background-color: var(--app-primary-light);
  border-radius: 8rpx;
  padding: 2rpx 10rpx;
}

.tag-mini-text {
  font-size: 18rpx;
  color: var(--app-primary);
}

.txn-sub {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.txn-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
  flex-shrink: 0;
}

.txn-time {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.empty-wrap {
  padding-top: 80rpx;
}

.load-more {
  text-align: center;
  padding: 24rpx 0;
}

.load-text {
  font-size: 22rpx;
  color: var(--app-text-3);
}

/* 筛选面板 */
.filter-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 状态栏占位：避让全面屏的摄像头/刘海 */
.filter-status-bar {
  flex-shrink: 0;
  width: 100%;
}

.filter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 32rpx 28rpx 20rpx;
}

.filter-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.filter-reset {
  font-size: 26rpx;
  color: var(--app-text-3);
}

.filter-body {
  flex: 1;
  padding: 0 28rpx;
}

.filter-section {
  margin-bottom: 32rpx;
}

.filter-label {
  font-size: 24rpx;
  color: var(--app-text-2);
  display: block;
  margin-bottom: 14rpx;
}

.chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.chip {
  padding: 10rpx 22rpx;
  border-radius: 20rpx;
  background-color: var(--app-card);
}

.chip.active {
  background-color: var(--app-primary-light);
}

.chip-text {
  font-size: 24rpx;
}

.filter-input {
  background-color: var(--app-card);
  border-radius: 12rpx;
  padding: 18rpx 20rpx;
  font-size: 26rpx;
  color: var(--app-text);
}

.filter-placeholder {
  color: var(--app-text-3);
  font-size: 26rpx;
}

.range-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.range-input {
  flex: 1;
  background-color: var(--app-card);
  border-radius: 12rpx;
  padding: 18rpx 20rpx;
  font-size: 26rpx;
  color: var(--app-text);
  text-align: center;
}

.range-sep {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.filter-actions {
  flex-shrink: 0;
  padding: 20rpx 28rpx calc(env(safe-area-inset-bottom) + 20rpx);
}

/* 应用筛选按钮：背景色由 primaryColor 内联指定，跟随主题色
   尺寸对齐库的 wd-button size="large"（44px 高 / 8px 圆角） */
.filter-apply {
  width: 100%;
  height: 88rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 1;
  transition: opacity 0.15s;
}

.filter-apply:active {
  opacity: 0.8;
}

.filter-apply-text {
  color: #ffffff;
  font-size: 30rpx;
  font-weight: 500;
}
</style>
