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
                :type="txn.type"
                :size="30"
                :weight="500"
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
                @click="onTypeChange(t.key)"
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

          <!-- 分类：两级联动
               一级（父分类）→ 二级（子分类）
               只选一级 = 该一级下所有二级；一级 + 二级 = 精确到二级 -->
          <view class="filter-section">
            <text class="filter-label">分类</text>

            <!-- 一级分类 -->
            <view class="chip-wrap">
              <view
                class="chip"
                :class="{ active: !filter.parentCategoryId }"
                @click="onParentCategoryChange('')"
              >
                <text class="chip-text" :style="{ color: !filter.parentCategoryId ? primaryColor : 'var(--app-text-2)' }">全部</text>
              </view>
              <view
                v-for="cat in parentCategories"
                :key="cat.id"
                class="chip"
                :class="{ active: filter.parentCategoryId === cat.id }"
                @click="onParentCategoryChange(cat.id)"
              >
                <text class="chip-text" :style="{ color: filter.parentCategoryId === cat.id ? primaryColor : 'var(--app-text-2)' }">
                  {{ cat.name }}
                </text>
              </view>
            </view>

            <!-- 二级分类：随一级分类动态变化 -->
            <view v-if="filter.parentCategoryId" class="subcat-wrap">
              <view class="subcat-head">
                <text class="subcat-label">二级分类</text>
                <text
                  v-if="filter.categoryId"
                  class="subcat-clear"
                  @click="onSubCategoryChange('')"
                >清除</text>
              </view>
              <view class="chip-wrap">
                <view
                  class="chip chip-sub"
                  :class="{ active: !filter.categoryId }"
                  @click="onSubCategoryChange('')"
                >
                  <text class="chip-text" :style="{ color: !filter.categoryId ? primaryColor : 'var(--app-text-2)' }">
                    全部
                  </text>
                </view>
                <view
                  v-for="cat in subCategories"
                  :key="cat.id"
                  class="chip chip-sub"
                  :class="{ active: filter.categoryId === cat.id }"
                  @click="onSubCategoryChange(cat.id)"
                >
                  <text class="chip-text" :style="{ color: filter.categoryId === cat.id ? primaryColor : 'var(--app-text-2)' }">
                    {{ cat.name }}
                  </text>
                </view>
              </view>
              <text v-if="subCategories.length === 0" class="subcat-empty">
                该分类下没有二级分类，将匹配全部子分类
              </text>
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

    <!-- 弹窗宿主：确定框统一用组件库样式 -->
    <AppDialog />
  </view>
</template>

<script>
import { ref, reactive, computed, onMounted } from 'vue'
import { onShow, onLoad } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import DateRangePicker from '@/components/DateRangePicker.vue'
import AppDialog from '@/components/AppDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { listTransactions, sumTransactions, deleteTransaction, parseTxnQueryOptions } from '@/api/transaction.js'
import { listCategories } from '@/api/category.js'
import { listTags } from '@/api/tag.js'
import { formatDayHeader, formatTime, selectionToRange, defaultSelection, selectionFromDayKey } from '@/utils/date.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'
import { parseAmountInput } from '@/utils/money.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'

const PAGE_SIZE = 50

export default {
  components: { MoneyText, EmptyState, DateRangePicker, AppDialog },
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

    /**
     * 分类缓存
     *
     * 分类按 type（expense / income）分别缓存，
     * 切换「支出 / 收入」时按需加载 —— 这样类型与分类列表是联动的，
     * 不会出现「选着收入却列着支出分类」。
     */
    const categories = ref([])
    const catCache = { expense: [], income: [] }
    const catLoaded = { expense: false, income: false }

    const tags = ref([])

    const filter = reactive({
      type: 'all',
      accountId: '',
      /** 选中的一级分类 id（'' = 不限） */
      parentCategoryId: '',
      /** 选中的二级分类 id（'' = 该一级下全部二级） */
      categoryId: '',
      /**
       * 是否把一级分类展开成「一级 + 所有二级」。
       * 正常由界面状态推导；URL 带入时由 parseTxnQueryOptions 解析。
       */
      includeSubcategories: false,
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


    /**
     * 一级分类
     *
     * 列表本身已按当前类型过滤（见 syncCategories），
     * 这里只取没有父级的那一层。
     */
    const parentCategories = computed(() =>
      categories.value.filter((c) => c.isParent)
    )

    /**
     * 二级分类：随一级分类的选择动态更新
     */
    const subCategories = computed(() => {
      const pid = filter.parentCategoryId
      if (!pid) return []
      return categories.value.filter((c) => c.parent_id === pid)
    })

    const filterCount = computed(() => {
      let n = 0
      if (appliedFilter.type && appliedFilter.type !== 'all') n++
      if (appliedFilter.accountId) n++
      if (appliedFilter.parentCategoryId || appliedFilter.categoryId) n++
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

    /* ------------------------------------------------------ 分类加载 */

    /**
     * 按类型加载分类（带缓存）
     */
    async function loadCategoryType(type) {
      if (catLoaded[type]) return
      catCache[type] = await listCategories(type)
      catLoaded[type] = true
    }

    /**
     * 让分类列表跟随筛选类型
     *
     * 支出 → 只列支出分类
     * 收入 → 只列收入分类
     * 全部 → 支出 + 收入都列
     * 转账 → 转账没有分类，不列
     */
    async function syncCategories(type) {
      const need = type === 'expense'
        ? ['expense']
        : type === 'income'
          ? ['income']
          : type === 'all'
            ? ['expense', 'income']
            : []
      for (const t of need) await loadCategoryType(t)
      const list = []
      for (const t of need) list.push(...catCache[t])
      categories.value = list
    }

    /* ------------------------------------------------------ 交互 */

    /**
     * 切换类型：分类列表要跟着换
     *
     * 换了类型以后，原来选的分类可能不再属于新类型
     * （比如选了「支出 / 餐饮」，再切到「收入」就选不了餐饮了），
     * 这时要把它清掉，否则查询会落空。
     */
    async function onTypeChange(type) {
      filter.type = type
      await syncCategories(type)

      const pid = filter.parentCategoryId
      if (pid) {
        const still = categories.value.find((c) => c.id === pid)
        if (!still) {
          // 选中的父级属于另一种类型，这个类型下选不了它 —— 清掉
          filter.parentCategoryId = ''
          filter.categoryId = ''
          filter.includeSubcategories = false
          return
        }
      }
      if (filter.categoryId) {
        const still = categories.value.find((c) => c.id === filter.categoryId)
        if (!still) filter.categoryId = ''
      }
      // 只选一级 = 该一级下所有二级
      filter.includeSubcategories = !filter.categoryId && !!filter.parentCategoryId
    }

    /**
     * 选一级分类
     *
     * 换了父级以后，之前选的二级多半已经不属于新的父级 —— 清空它。
     * 只选一级（不选二级）表示「该一级下的所有二级」。
     */
    function onParentCategoryChange(id) {
      filter.parentCategoryId = id
      if (id) {
        const sub = categories.value.find((c) => c.id === id)
        // 选中的父级变了，二级若不属于新父级就清空
        if (filter.categoryId) {
          const child = categories.value.find((c) => c.id === filter.categoryId)
          if (!child || child.parent_id !== id) filter.categoryId = ''
        }
        // 选中的父级在这个类型下不存在时，说明它属于另一种类型
        if (!sub) filter.parentCategoryId = ''
      } else {
        filter.categoryId = ''
      }
      // 只选一级 = 该一级下所有二级
      filter.includeSubcategories = !filter.categoryId && !!filter.parentCategoryId
    }

    /** 选二级分类（'' = 该一级下的全部二级） */
    function onSubCategoryChange(id) {
      filter.categoryId = id
      filter.includeSubcategories = !id && !!filter.parentCategoryId
    }

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
      /**
       * 分类过滤
       *
       *   选到二级 → 精确匹配那个二级
       *   只选一级 → 用子查询匹配「一级 + 它的所有二级」
       *
       * includeSubcategories 由「是否选到二级」推导，
       * 不需要额外存一份状态。
       */
      if (appliedFilter.categoryId) {
        q.categoryId = appliedFilter.categoryId
        if (appliedFilter.includeSubcategories) q.includeSubcategories = true
      } else if (appliedFilter.parentCategoryId) {
        q.categoryId = appliedFilter.parentCategoryId
        q.includeSubcategories = true
      }
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
        type: 'all', accountId: '', parentCategoryId: '', categoryId: '',
        includeSubcategories: false, tagId: '',
        keyword: '', minYuan: '', maxYuan: ''
      })
      // 重置后类型回到「全部」，分类列表也要跟着回到全量
      syncCategories('all')
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
        // ★ 账户被删除后 account_name 为空 —— 显示「无账户」而不是 '-' ★
        return `${txn.account_name || '无账户'} → ${txn.to_account_name || '无账户'}`
      }
      return txn.category_name || '未分类'
    }

    function txnSub(txn) {
      const parts = []
      if (txn.note) parts.push(txn.note)
      // ★ 账户被删除后 account_name 为空 —— 显示「无账户」 ★
      if (txn.type !== 'transfer') parts.push(txn.account_name || '无账户')
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
    async function onLongPress(txn) {
      const ok = await confirmDialog({
        title: '删除这笔记录？',
        content: `${txnTitle(txn)} ¥${(txn.amount_cents / 100).toFixed(2)}`,
        confirmText: '删除',
        danger: true
      })
      if (!ok) return
      try {
        await deleteTransaction(txn.id)
        uni.showToast({ title: '已删除', icon: 'success' })
        await loadFirstPage()
      } catch (e) {
        await alertDialog({ title: '删除失败', content: e.message })
      }
    }

    /* ------------------------------------------------- URL 参数（深链） */

    /**
     * 从别处跳进来时带的查询参数
     *
     * 契约（见 api/transaction.js 的 parseTxnQueryOptions）：
     *   ?accountId=acc_xxx            按账户筛选
     *   ?categoryId=cat_xxx           按分类筛选（一级或二级都行）
     *   ?includeSubcategories=1       categoryId 是一级分类时，匹配其所有二级
     *   ?tagId=tag_xxx                按标签筛选
     *   ?monthKey=2026-10             按月份筛选
     *   ?type=expense|income|transfer 按类型筛选
     *   ?day=2026-10-27               按某一天筛选（首页日历深链）
     */
    const urlOptions = ref(null)
    /** 页面是否已经挂载完成（用来判断 onLoad 是不是来得比 onMounted 晚） */
    const mounted = ref(false)

    /**
     * 把 URL 上的时间参数套到日期选择器上
     *
     *   ?day=2026-10-27  -> 那一天
     *   ?monthKey=2026-10 -> 那个月
     *   带筛选条件但没给时间 -> 放宽到全部时间
     *                       （用户要的是「这个账户 / 这个分类下的全部流水」，
     *                         只看当月会漏掉大半）
     */
    function applyDateFromOptions(q) {
      if (q.day) {
        dateRange.value = selectionFromDayKey(q.day)
      } else if (q.monthKey) {
        const [y, m] = q.monthKey.split('-').map(Number)
        dateRange.value = { year: y, month: m, day: 0 }
      } else if (q.hasFilter) {
        dateRange.value = { year: 0, month: 0, day: 0 }
      }
    }

    /**
     * 应用 URL 上的筛选条件
     *
     * onLoad 与 onMounted 都会调它（幂等）——
     * uni-app 里 onLoad 与组件 mounted 的先后顺序在不同平台不完全一致，
     * 两边都调一次最保险。
     */
    async function applyUrlOptions(options) {
      if (!options) return
      const q = parseTxnQueryOptions(options)

      // 类型
      filter.type = q.type

      // 账户 / 标签
      filter.accountId = q.accountId
      filter.tagId = q.tagId

      // 时间范围
      applyDateFromOptions(q)

      // 分类：先记下，等分类加载完再解析它是一级还是二级
      filter.categoryId = q.categoryId
      filter.parentCategoryId = ''
      filter.includeSubcategories = q.includeSubcategories

      await syncCategories(filter.type)
      // 解析分类归属时可能要查另一种类型的分类，所以两个缓存都备齐
      await loadCategoryType('expense')
      await loadCategoryType('income')
      resolveUrlCategory(q.includeSubcategories)

      // URL 带来的条件直接生效，不用再点「应用筛选」
      Object.assign(appliedFilter, filter)
    }

    /**
     * 解析 URL 里的 categoryId 到底是一级还是二级
     *
     *   传的是二级 → 选中该二级（一级也高亮）
     *   传的是一级 → 选中该一级，不选二级，查询时匹配它的所有二级
     *
     * 两个类型的缓存都找一遍 —— URL 上的分类可能与 type 参数不同源
     * （比如只传了 categoryId，type 仍是「全部」）。
     */
    function resolveUrlCategory(includeSub) {
      const cid = filter.categoryId
      if (!cid) {
        filter.parentCategoryId = ''
        return
      }
      const all = [...catCache.expense, ...catCache.income]
      const cat = all.find((c) => c.id === cid)
      if (!cat) {
        // 分类不存在（已删除 / id 写错）—— 退回「不按分类筛」
        filter.parentCategoryId = ''
        filter.categoryId = ''
        filter.includeSubcategories = false
        return
      }
      if (cat.isParent) {
        filter.parentCategoryId = cid
        filter.categoryId = ''
        filter.includeSubcategories = true
      } else {
        filter.parentCategoryId = cat.parent_id || ''
        filter.categoryId = cid
        // URL 明确带了 includeSubcategories=1 就尊重它
        filter.includeSubcategories = !!includeSub
      }
    }

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await accountStore.load()
      const [tgs] = await Promise.all([listTags()])
      tags.value = tgs

      // URL 上的条件要先生效，分类列表才知道该按哪个类型加载
      if (urlOptions.value) {
        await applyUrlOptions(urlOptions.value)
      } else {
        await syncCategories(filter.type)
      }

      mounted.value = true
      await loadFirstPage()
    })

    /**
     * 深链：
     *   ?day=YYYY-MM-DD               首页月历点某一天
     *   ?accountId / ?categoryId / …  账户详情 / 分类 / 标签 / 预算页点「全部」
     * 没有这些参数则显示当月（全部日）
     */
    onLoad((options) => {
      urlOptions.value = options || {}

      // 先同步日期（不依赖分类数据，可以立刻做）
      applyDateFromOptions(parseTxnQueryOptions(options))

      // onLoad 晚于 onMounted 的平台：这时才把完整条件补上并重新查一次
      if (mounted.value) {
        applyUrlOptions(options).then(() => loadFirstPage())
      }
    })

    onShow(() => {
      settingStore.syncSystemTheme()
    })

    return {
      settingStore, accountStore, statusBarHeight,
      dateRange, datePickerRef, list, summary, hasMore, loading, showFilter,
      filter, appliedFilter, typeOptions, categories, tags,
      primaryColor, pageStyle, rangeLabel, parentCategories, subCategories, filterCount, groups,
      loadMore, applyFilter, resetFilter, onDateChange, openFilter,
      onTypeChange, onParentCategoryChange, onSubCategoryChange,
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

/* 二级分类：缩进一级，视觉上从属于上面的一级 */
.subcat-wrap {
  margin-top: 18rpx;
  padding-left: 20rpx;
  border-left: 4rpx solid var(--app-line);
}

.subcat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
}

.subcat-label {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.subcat-clear {
  font-size: 22rpx;
  color: var(--app-primary);
}

.chip-sub {
  background-color: var(--app-card-2);
}

.chip-sub.active {
  background-color: var(--app-primary-light);
}

.subcat-empty {
  display: block;
  margin-top: 10rpx;
  font-size: 21rpx;
  color: var(--app-text-3);
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
