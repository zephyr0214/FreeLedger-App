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
        <MoneyText :cents="summary.expense" type="expense" :size="26" />
        <text class="summary-label" style="margin-left: 16rpx">收入</text>
        <MoneyText :cents="summary.income" type="income" :size="26" />
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
            <!--
              分组汇总：「支出 / 收入」这两个**标签**无色，
              紧跟的**数字**仍按全 App 统一规则着色（支出无色、收入绿色）。
              ★ 符号也统一 ★ 支出 -、收入 +
              ★ 这里不用 MoneyText ★
                它嵌在 <text> 里，组件在 text 内布局不可靠；
                金额是两位小数、不需要千分位/货币符号，直接拼字符串最稳。
            -->
            <text v-if="group.expense > 0" class="day-sum-text">
              支出 -{{ (group.expense / 100).toFixed(2) }}
            </text>
            <text v-if="group.income > 0" class="day-sum-text">
              收入 <text class="day-sum-income">+{{ (group.income / 100).toFixed(2) }}</text>
            </text>
          </view>
        </view>

        <view class="day-list">
          <view
            v-for="txn in group.list"
            :key="txn.id"
            class="txn-item"
            @click="goDetail(txn.id)"
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
                <text class="txn-name ellipsis">{{ txnTitle(txn) }}</text>
              </view>
              <!-- 徽标：周期 / 组合账户 / 标签，统一描边胶囊，全部跟在分类名下面 -->
              <view v-if="txnBadges(txn).length" class="txn-tag-list">
                <text
                  v-for="t in txnBadges(txn)"
                  :key="t.key"
                  class="txn-tag"
                  :style="{ backgroundColor: t.bg, color: t.color, borderColor: t.border }"
                >{{ t.name }}</text>
              </view>
              <text class="txn-sub ellipsis">{{ txnSub(txn) }}</text>
            </view>

            <view class="txn-right">
              <MoneyText
                :cents="txn.amount_cents"
                :type="txn.type"
                :size="30"
                :weight="500"
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
          <!-- 类型：只有 4 个选项，做成一行分段控件（不占用下拉框） -->
          <view class="filter-section">
            <text class="filter-label">类型</text>
            <view class="seg">
              <view
                v-for="t in typeOptions"
                :key="t.key"
                class="seg-item"
                :class="{ active: filter.type === t.key }"
                :style="{ backgroundColor: filter.type === t.key ? primaryColor : 'transparent' }"
                @click="onTypeChange(t.key)"
              >
                <text class="seg-text" :style="{ color: filter.type === t.key ? '#ffffff' : 'var(--app-text-2)' }">
                  {{ t.name }}
                </text>
              </view>
            </view>
          </view>

          <!-- 账户 -->
          <view class="filter-section">
            <view class="filter-row" @click="openPicker('account')">
              <text class="filter-row-label">账户</text>
              <view class="filter-row-right">
                <text class="filter-row-value" :class="{ placeholder: !filter.accountId }">
                  {{ accountLabel }}
                </text>
                <text class="filter-row-arrow">›</text>
              </view>
            </view>
          </view>

          <!-- 分类（一级）
               一级 + 二级两级联动：
               只选一级 = 该一级下所有二级；一级 + 二级 = 精确到二级 -->
          <view class="filter-section">
            <view class="filter-row" @click="openPicker('parent')">
              <text class="filter-row-label">分类</text>
              <view class="filter-row-right">
                <text class="filter-row-value" :class="{ placeholder: !filter.parentCategoryId }">
                  {{ parentCategoryLabel }}
                </text>
                <text class="filter-row-arrow">›</text>
              </view>
            </view>
          </view>

          <!-- 二级分类：随一级分类动态变化 -->
          <view class="filter-section">
            <view
              class="filter-row"
              :class="{ disabled: !filter.parentCategoryId }"
              @click="openPicker('sub')"
            >
              <text class="filter-row-label">二级分类</text>
              <view class="filter-row-right">
                <text class="filter-row-value" :class="{ placeholder: !filter.categoryId }">
                  {{ subCategoryLabel }}
                </text>
                <text class="filter-row-arrow">›</text>
              </view>
            </view>
            <text v-if="filter.parentCategoryId && subCategories.length === 0" class="filter-hint">
              该分类下没有二级分类，将匹配全部子分类
            </text>
          </view>

          <!-- 标签 -->
          <view class="filter-section">
            <view class="filter-row" @click="openPicker('tag')">
              <text class="filter-row-label">标签</text>
              <view class="filter-row-right">
                <text class="filter-row-value" :class="{ placeholder: !filter.tagId }">
                  {{ tagLabel }}
                </text>
                <text class="filter-row-arrow">›</text>
              </view>
            </view>
          </view>

          <!-- 周期（筛选周期产生的流水，周期详情「全部」深链也会带 cycleId） -->
          <view class="filter-section">
            <view class="filter-row" @click="openPicker('cycle')">
              <text class="filter-row-label">周期</text>
              <view class="filter-row-right">
                <text class="filter-row-value" :class="{ placeholder: !filter.cycleId }">
                  {{ filter.cycleId ? cycleFilterLabel : '全部周期' }}
                </text>
                <text class="filter-row-arrow">›</text>
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

    <!-- 选项选择器：账户 / 一级分类 / 二级分类 / 标签 共用一个底部选项表 -->
    <wd-action-sheet
      v-model="showPicker"
      :title="pickerTitle"
      :actions="pickerActions"
      :z-index="120"
      cancel-text="取消"
      @select="onPickerSelect"
    />

    <!-- 弹窗宿主：确定框统一用组件库样式 -->
    <AppDialog />
  </view>
</template>

<script>
import { ref, reactive, computed, onMounted, watch, onUnmounted } from 'vue'
import { onShow, onLoad, onBackPress } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import DateRangePicker from '@/components/DateRangePicker.vue'
import AppDialog from '@/components/AppDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { listTransactions, sumTransactions, parseTxnQueryOptions } from '@/api/transaction.js'
import { listCategories } from '@/api/category.js'
import { listTags } from '@/api/tag.js'
import { listCycles, recurrenceLabel } from '@/api/cycle.js'
import { formatDayHeader, formatTime, selectionToRange, defaultSelection, selectionFromDayKey } from '@/utils/date.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'
import { parseAmountInput } from '@/utils/money.js'
import { pushLayer, handleBackPress } from '@/utils/layerStack.js'

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
    /** 周期列表（筛选面板里可按周期筛，详情页「全部」也会带 cycleId 深链） */
    const cycles = ref([])

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
      /** 周期筛选：'' = 不限；非 '' 时只显示该周期产生的流水 */
      cycleId: '',
      keyword: '',
      minYuan: '',
      maxYuan: ''
    })

    // 已应用的筛选（与面板里的编辑态分离）
    const appliedFilter = reactive({ ...filter })

    /* ------------------------------------------------- 下拉选择器 */

    /**
     * 下拉框形式的筛选
     *
     * 面板里的每一项（账户 / 一级分类 / 二级分类 / 标签）都是
     * 「左标签 + 右当前值 + ›」的一行，点一下弹出选项列表。
     * 四个下拉共用一个 wd-action-sheet（底部选项表），
     * 切换的是 pickerKind 指向的那一组选项。
     */
    /** 当前打开的是哪个下拉：account | parent | sub | tag */
    const pickerKind = ref('')
    const showPicker = ref(false)

    const PICKER_TITLES = {
      account: '选择账户',
      parent: '选择分类',
      sub: '选择二级分类',
      tag: '选择标签',
      cycle: '选择周期'
    }

    const pickerTitle = computed(() => PICKER_TITLES[pickerKind.value] || '请选择')

    /**
     * 当前下拉的选项列表
     *
     * wd-action-sheet 的 actions 只认 { name, subname, color, disabled, loading }，
     * 所以每项统一转成 { name, value } 的形状，value 放在自定义字段里传回。
     */
    const pickerActions = computed(() => {
      const kind = pickerKind.value
      if (kind === 'account') {
        const list = [{ name: '全部账户', value: '' }]
        // 组合账户没有流水（交易都解析到真实账户名下），筛它只会得到空列表
        for (const acc of accountStore.list) {
          if (acc.isCombo) continue
          list.push({ name: acc.name, value: acc.id })
        }
        return list
      }
      if (kind === 'parent') {
        const list = [{ name: '全部分类', value: '' }]
        for (const cat of parentCategories.value) list.push({ name: cat.name, value: cat.id })
        return list
      }
      if (kind === 'sub') {
        const list = [{ name: '全部', value: '' }]
        for (const cat of subCategories.value) list.push({ name: cat.name, value: cat.id })
        return list
      }
      if (kind === 'tag') {
        const list = [{ name: '全部标签', value: '' }]
        for (const t of tags.value) list.push({ name: t.name, value: t.id })
        return list
      }
      if (kind === 'cycle') {
        const list = [{ name: '全部周期', value: '' }]
        for (const c of cycles.value) {
          list.push({ name: cycleLabel(c), value: c.id })
        }
        return list
      }
      return []
    })

    /** 打开某个下拉 */
    function openPicker(kind) {
      // 二级分类必须先选一级分类
      if (kind === 'sub' && !filter.parentCategoryId) {
        uni.showToast({ title: '请先选择一级分类', icon: 'none' })
        return
      }
      pickerKind.value = kind
      showPicker.value = true
    }

    /** 选中某个下拉里的选项 */
    function onPickerSelect(e) {
      const item = e && e.item ? e.item : null
      if (!item) return
      const value = item.value
      const kind = pickerKind.value
      if (kind === 'account') {
        filter.accountId = value
      } else if (kind === 'parent') {
        onParentCategoryChange(value)
      } else if (kind === 'sub') {
        onSubCategoryChange(value)
      } else if (kind === 'tag') {
        filter.tagId = value
      } else if (kind === 'cycle') {
        filter.cycleId = value
      }
    }

    const typeOptions = [
      { key: 'all', name: '全部' },
      { key: 'expense', name: '支出' },
      { key: 'income', name: '收入' },
      { key: 'transfer', name: '转账' }
    ]

    const primaryColor = computed(() => settingStore.primaryColor)

    /** 组合账户徽标的固定颜色（独立标记，不是标签色） */
    const COMBO_BADGE_COLOR = '#8B5CF6'
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

    /* ------------------------------------------------- 下拉当前值文案 */

    /** 账户当前值 */
    const accountLabel = computed(() => {
      if (!filter.accountId) return '全部'
      const acc = accountStore.list.find((a) => a.id === filter.accountId)
      return acc ? acc.name : '全部'
    })

    /** 一级分类当前值 */
    const parentCategoryLabel = computed(() => {
      if (!filter.parentCategoryId) return '全部'
      const cat = categories.value.find((c) => c.id === filter.parentCategoryId)
      return cat ? cat.name : '全部'
    })

    /** 二级分类当前值 */
    const subCategoryLabel = computed(() => {
      if (!filter.parentCategoryId) return '请先选择一级分类'
      if (!filter.categoryId) return '全部'
      const cat = categories.value.find((c) => c.id === filter.categoryId)
      return cat ? cat.name : '全部'
    })

    /** 标签当前值 */
    const tagLabel = computed(() => {
      if (!filter.tagId) return '全部'
      const t = tags.value.find((x) => x.id === filter.tagId)
      return t ? t.name : '全部'
    })

    const filterCount = computed(() => {
      let n = 0
      if (appliedFilter.type && appliedFilter.type !== 'all') n++
      if (appliedFilter.accountId) n++
      if (appliedFilter.parentCategoryId || appliedFilter.categoryId) n++
      if (appliedFilter.tagId) n++
      if (appliedFilter.cycleId) n++
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
      if (appliedFilter.cycleId) q.cycleId = appliedFilter.cycleId
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
        includeSubcategories: false, tagId: '', cycleId: '',
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

    /**
     * 标签 id -> { name, color } 的映射
     *
     * 交易里只存了 tag_id（tag_ids），要显示名字和颜色得靠本页已加载的标签表反查。
     * 建一张 map，避免每行都去 list 里线性找。
     */
    const tagNameMap = computed(() => {
      const m = {}
      for (const t of tags.value) m[t.id] = { name: t.name, color: t.color || '' }
      return m
    })

    /** 周期的展示名（筛选面板 / 周期徽标用） */
    function cycleLabel(c) {
      if (!c) return '周期'
      if (c.type === 'transfer') {
        const from = accountStore.list.find((a) => a.id === c.account_id)
        const to = accountStore.list.find((a) => a.id === c.to_account_id)
        return `${from ? from.name : '账户'} → ${to ? to.name : '账户'}`
      }
      const cat = categories.value.find((x) => x.id === c.category_id)
      return cat ? cat.name : '未分类'
    }

    /** 筛选面板里「周期」一行的当前值（周期名 + 规则） */
    const cycleFilterLabel = computed(() => {
      if (!appliedFilter.cycleId) return '全部周期'
      const c = cycles.value.find((x) => x.id === appliedFilter.cycleId)
      if (!c) return '周期'
      return `${cycleLabel(c)} · ${recurrenceLabel(c)}`
    })

    /**
     * 这笔交易的标签（显示名字 + 用自己的颜色做背景）
     *
     * ★ 背景用标签自己的颜色，但只用 12% 左右的透明度 ★
     *   纯色背景配白字虽然对比强，但一排标签全是纯色块会非常刺眼，
     *   而且中文名（2026装修）在纯色底上可读性差。
     *   所以：背景 = 标签色 + '22'（约 12% 透明），文字 = 标签本色。
     *
     * 兜底：标签没设颜色（color 为空）时，bg 传空字符串，
     *   样式回落到 CSS 里的 --app-card-2 背景 + --app-text-2 文字。
     *
     * 最多取前 2 个：标签太多会撑破一行，
     * 剩下的用「+N」在最后一个位置表示。
     */
    /**
     * 一笔交易的「徽标」集合：周期 / 组合账户 / 用户标签，按固定顺序。
     *
     * ★ 用户要求 ★
     *   周期、组合账户、标签都统一成同一种「描边胶囊」样式（见 .txn-tag），
     *   颜色/内容各不相同，但样式一致；全部跟在分类名下面。
     *   组合账户不是标签，是独立标记（来自 via_combo_id）。
     */
    function txnBadges(txn) {
      const list = []
      // 周期
      if (txn.cycle_id) {
        const c = primaryColor.value
        list.push({ key: '__cycle__', name: '周期', color: c, bg: c + '22', border: c })
      }
      // 组合账户（独立标记，不是标签）
      if (txn.via_combo_id) {
        list.push({ key: '__combo__', name: '组合账户', color: COMBO_BADGE_COLOR, bg: COMBO_BADGE_COLOR + '22', border: COMBO_BADGE_COLOR })
      }
      // 用户标签
      const ids = txn.tag_ids
      if (ids && ids.length) {
        for (const id of ids) {
          const t = tagNameMap.value[id]
          if (!t) continue
          const c = t.color || 'var(--app-text-2)'
          const bd = t.color || 'var(--app-text-3)'
          list.push({ key: id, name: t.name, color: c, bg: t.color ? t.color + '22' : 'var(--app-card-2)', border: bd })
        }
      }
      return list
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

      // 周期（周期详情「全部」深链会带 cycleId）
      filter.cycleId = q.cycleId

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
      const [tgs, cys] = await Promise.all([listTags(), listCycles().catch(() => [])])
      tags.value = tgs
      cycles.value = cys

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

    /*
     * ★ 筛选面板 / 选择器也要能侧滑收起 ★
     *   两者都是本页内的弹层，不登记的话右滑会直接退出「全部交易」页。
     */
    watch(showFilter, (open) => {
      if (open) {
        if (!unregisterFilter) {
          unregisterFilter = pushLayer(() => { showFilter.value = false }, 'txnFilter')
        }
        return
      }
      if (unregisterFilter) {
        unregisterFilter()
        unregisterFilter = null
      }
    })

    watch(showPicker, (open) => {
      if (open) {
        if (!unregisterPicker) {
          unregisterPicker = pushLayer(() => { showPicker.value = false }, 'txnPicker')
        }
        return
      }
      if (unregisterPicker) {
        unregisterPicker()
        unregisterPicker = null
      }
    })

    let unregisterFilter = null
    let unregisterPicker = null

    onUnmounted(() => {
      if (unregisterFilter) unregisterFilter()
      if (unregisterPicker) unregisterPicker()
    })

    onBackPress(() => handleBackPress())

    return {
      settingStore, accountStore, statusBarHeight,
      dateRange, datePickerRef, list, summary, hasMore, loading, showFilter,
      filter, appliedFilter, typeOptions, categories, tags,
      primaryColor, pageStyle, rangeLabel, parentCategories, subCategories, filterCount, groups,
      // 下拉选择器
      showPicker, pickerTitle, pickerActions, openPicker, onPickerSelect,
      // 下拉当前值
      accountLabel, parentCategoryLabel, subCategoryLabel, tagLabel, cycleFilterLabel,
      loadMore, applyFilter, resetFilter, onDateChange, openFilter,
      onTypeChange, onParentCategoryChange, onSubCategoryChange,
      iconChar, txnTitle, txnSub, txnBadges, timeLabel, goDetail, goBack
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

/*
 * ★ 分组头：「支出 / 收入」标签无色，数字按统一规则着色 ★
 *   用户要求标签本身无色（不要整段泛绿），
 *   但收入的**数字**仍要是绿色 —— 和流水金额的观感一致。
 *   所以颜色只加在内层数字的 <text> 上，外层标签保持 text-3。
 */
.day-sum-income {
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
  min-width: 0;
}

.txn-name {
  font-size: 28rpx;
  color: var(--app-text);
  font-weight: 500;
  flex-shrink: 1;
  min-width: 0;
}

/**
 * 标签：单独一行，可换行，全部展示
 *
 * ★ 改法 ★
 *   之前是「跟分类名同一行、不换行、最多 2 个 + +N」。
 *   用户要求显示全部 tag，所以把标签从名称行挪到独立一行，
 *   用 flex-wrap: wrap 让多标签自动换行，不把行高撑爆。
 */
.txn-tag-list {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6rpx;
  min-width: 0;
}

/**
 * 徽标：周期 / 组合账户 / 标签统一成同一种「描边胶囊」。
 *
 * ★ 用户要求（以周期的样式为准）★
 *   颜色、内容可不同，但边框描边、圆角、字号、内边距一致：
 *   1rpx 实线描边 + 12% 同色浅底 + 同色文字。
 *   color / background-color / border-color 由模板内联覆盖（见 txnBadges）。
 *   这里只是「标签没设颜色」时的中性灰兜底。
 */
.txn-tag {
  flex-shrink: 0;
  font-size: 18rpx;
  line-height: 1;
  padding: 4rpx 10rpx;
  border-radius: 8rpx;
  color: var(--app-text-2);
  background-color: var(--app-card-2);
  border: 1rpx solid var(--app-text-3);
  font-weight: 500;
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

/* 类型分段控件 */
.seg {
  display: flex;
  align-items: center;
  background-color: var(--app-card);
  border-radius: 16rpx;
  padding: 6rpx;
}

.seg-item {
  flex: 1;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12rpx;
}

.seg-text {
  font-size: 26rpx;
}

/* 下拉行：左标签 + 右当前值 + 箭头 */
.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 88rpx;
  padding: 20rpx 24rpx;
  background-color: var(--app-card);
  border-radius: 16rpx;
}

.filter-row.disabled {
  opacity: 0.5;
}

.filter-row-label {
  font-size: 26rpx;
  color: var(--app-text-2);
  flex-shrink: 0;
}

.filter-row-right {
  display: flex;
  align-items: center;
  gap: 8rpx;
  flex: 1;
  min-width: 0;
  justify-content: flex-end;
}

.filter-row-value {
  font-size: 26rpx;
  color: var(--app-text);
  max-width: 380rpx;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.filter-row-value.placeholder {
  color: var(--app-text-3);
}

.filter-row-arrow {
  font-size: 28rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
}

.filter-hint {
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
