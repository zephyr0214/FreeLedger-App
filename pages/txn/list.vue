<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <!-- 自定义导航 -->
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="onBack">‹</text>
        <text class="nav-title">{{ selectMode ? `已选 ${selectedIds.length} 笔` : '全部交易' }}</text>
        <!--
          ★ 多选模式下右侧变成「全选 / 取消」★
            用户要求底部悬浮按钮做批量操作，
            但「全选」放底部会和 4 个操作按钮挤在一起，
            放顶部导航右侧最自然（与借出/借入多选同位置）。
        -->
        <!--
          ★ 多选态只留一个「取消」（用户本轮第 2 条）★
            用户原话：「删除交易多选时，右上角的全选功能按钮」。
            上一版把「全选 / 取消全选」和「取消」并排放在右侧，
            两个都是小字，且「取消全选」四字很容易把导航栏拄得很挤。
            全选本身也少用（列表很长时用户一般只选几条），
            所以直接去掉，只留退出入口。
        -->
        <text v-if="selectMode" class="nav-filter nav-cancel" @click="exitSelectMode">取消</text>
        <text v-else class="nav-filter" @click="openFilter">
          筛选<text v-if="filterCount > 0" class="filter-dot">{{ filterCount }}</text>
        </text>
      </view>
    </view>

    <view class="summary-bar">
      <!--
        ★ 只显示笔数，不显示日期范围（用户要求）★
          日期范围在上面的筛选条里已经能看到（三级联动是「2026年3月」，
          自定义是「2026-03-01 — 2026-03-15」），这里再写一遍是重复信息，
          而且那段文字一长就把右边的收支数字挤掉。
      -->
      <text class="summary-text">共 {{ summary.count }} 笔</text>
      <view class="summary-right">
        <text class="summary-label">支出</text>
        <MoneyText :cents="summary.expense" type="expense" :size="26" />
        <text class="summary-label" style="margin-left: 16rpx">收入</text>
        <MoneyText :cents="summary.income" type="income" :size="26" />
      </view>
    </view>

    <!--
      时间筛选：年月日筛选（三级联动）｜ 自定义筛选（wd-calendar 选起止日）

      ★ 为什么抽成 DateFilterBar 组件 ★
        统计页有一模一样的一份，以前两页各写一遍，
        改文案就得改两处，日期面板还容易一边用原生 picker
        一边用 wd-calendar，观感对不上。共用一份实现后想不一致都难。
    -->
    <view class="month-bar">
      <DateFilterBar
        ref="filterBarRef"
        :mode="dateMode"
        :model-value="dateRange"
        :start-day="customStart"
        :end-day="customEnd"
        @update:mode="onModeChange"
        @range-change="onDateChange"
        @custom-change="onCustomChange"
      />
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
          <!--
            ★ 右滑快捷操作 + 多选（用户本轮第 4 / 5 条）★
              第 4 条：右滑某条流水可以快捷删除和添加标签。
              第 5 条：可以多选，下方弹出悬浮按钮批量处理。
              两者共存：多选模式下右滑被禁用（否则手势会互相干扰）。
          -->
          <wd-swipe-action
            v-for="txn in group.list"
            :key="txn.id"
            v-model="swipeStates[txn.id]"
            :disabled="selectMode"
            class="txn-swipe"
          >
          <view
            class="txn-item"
            @click="onRowClick(txn)"
            @longpress="onRowLongPress(txn)"
          >
            <!-- 多选勾选框：只在多选模式出现 -->
            <view v-if="selectMode" class="row-check" :class="{ on: isSelected(txn.id) }">
              <text v-if="isSelected(txn.id)" class="row-check-tick">✓</text>
            </view>
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

          <template #right>
            <TxnSwipeActions
              @delete="onSwipeDelete(txn)"
              @tag="onSwipeTag(txn)"
            />
          </template>
          </wd-swipe-action>
        </view>
      </view>

      <view v-if="hasMore" class="load-more">
        <text class="load-text">加载中…</text>
      </view>
      <view v-else-if="groups.length > 0" class="load-more">
        <text class="load-text">没有更多了</text>
      </view>

      <!--
        ★ 多选浮动操作条（用户本轮第 5 条）★
          用户原话：「可以多选，下方弹出悬浮按钮可以批量删除、
          添加标签、不计预算、不计收支（标签样式类似于首页 tab，
          但是不添加图标）」。

          ★ 为什么用 .seg-toggle 那套样式 ★
            用户说「类似于首页 tab」，项目里那一套就是
            App.vue 的 .seg-toggle / .seg-item（分段切换）。
            直接复用全局样式，不重写一份，也就不会长歪。

          ★ 不添加图标 ★
            用户明确要求。四个操作名都很短（删除 2 字、
            标签 2 字、不计预算 4 字、不计收支 4 字），加图标反而挤。
      -->
      <view v-if="selectMode" class="batch-bar">
        <view class="batch-inner" :style="batchBarStyle">
          <view class="batch-item" @click="onBatchDelete">
            <text class="batch-item-text batch-item-text--danger">删除</text>
          </view>
          <view class="batch-item" @click="openBatchTag">
            <text class="batch-item-text">标签</text>
          </view>
          <view class="batch-item" @click="onBatchExcludeBudget">
            <text class="batch-item-text">不计预算</text>
          </view>
          <view class="batch-item" @click="onBatchPendingReimburse">
            <text class="batch-item-text">待报销</text>
          </view>
        </view>
      </view>

      <view class="bottom-space" :class="{ 'bottom-space--batch': selectMode }" />
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

          <!--
            分类（多选）

            ★ 为什么只有一个「分类」行 ★
              以前是「一级分类 + 二级分类」两级联动的单选，
              只能表达「一个分类」这一种条件。
              但预算页一条子预算可以挂好几个类别，点「全部交易」带过来的是
              一组分类 id，单选装不下 —— 用户再点一次分类就会把整组条件
              覆盖掉，看到的流水比预算页算的少。
              所以统一成多选：单选只是「多选里只勾一个」的特例，
              从任何页面跳进来的 categoryId 都会被换算成这组多选条件。
          -->
          <view class="filter-section">
            <view class="filter-row" @click="openMultiCatPicker">
              <text class="filter-row-label">分类</text>
              <view class="filter-row-right">
                <text class="filter-row-value" :class="{ placeholder: filter.categoryIds.length === 0 }">
                  {{ multiCatLabel }}
                </text>
                <text class="filter-row-arrow">›</text>
              </view>
            </view>
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

    <!--
      类别多选弹层
      ★ 与预算页的「子预算 → 选择类别」是同一个组件 ★
        两边共用一套分组与勾选规则，从子预算跳过来时能原样回显多选的类别。
    -->
    <CategoryMultiPickerSheet
      v-model="showMultiCat"
      :categories="multiCatSource"
      :selected-ids="filter.categoryIds"
      title="选择分类"
      @picked="onMultiCatConfirm"
    />

    <!-- 右滑 / 批量「标签」共用的标签选择弹层 -->
    <TxnTagSheet
      v-model="showTagSheet"
      :tags="tags"
      :selected-ids="tagSheetIds"
      :title="tagSheetBatch ? '批量添加标签' : '选择标签'"
      :hint="tagSheetBatch ? `将给已选的 ${selectedIds.length} 笔流水都加上这些标签（不会影响原有标签）` : ''"
      @picked="onTagSheetPicked"
    />

    <!-- 弹窗宿主：确定框统一用组件库样式 -->
    <AppDialog />

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
import { ref, reactive, computed, onMounted, watch, onUnmounted } from 'vue'
import { onShow, onLoad, onBackPress } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import DateFilterBar from '@/components/DateFilterBar.vue'
import CategoryMultiPickerSheet from '@/components/CategoryMultiPickerSheet.vue'
import TxnSwipeActions from '@/components/TxnSwipeActions.vue'
import TxnTagSheet from '@/components/TxnTagSheet.vue'
import AppDialog from '@/components/AppDialog.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import {
  listTransactions, sumTransactions, parseTxnQueryOptions,
  deleteTransaction, updateTransaction,
  batchDeleteTransactions, batchSetExcludeFlags, batchSetTxnTags
} from '@/api/transaction.js'
import { batchSetPendingReimburse } from '@/api/reimburse.js'
import { listCategories } from '@/api/category.js'
import { listTags } from '@/api/tag.js'
import { listCycles, recurrenceLabel } from '@/api/cycle.js'
import {
  formatDayHeader, formatTime, selectionToRange, defaultSelection, selectionFromDayKey,
  customToRange, customRangeLabel, defaultCustomRange, toDayKey
} from '@/utils/date.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'
import { isLoanPersonCategory } from '@/api/loan.js'
import { buildTxnBadges } from '@/utils/txnBadges.js'
import { parseAmountInput } from '@/utils/money.js'
import { glassVars } from '@/utils/theme.js'
import { pushLayer, handleBackPress } from '@/utils/layerStack.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'

const PAGE_SIZE = 50

export default {
  components: { MoneyText, EmptyState, DateFilterBar, CategoryMultiPickerSheet, TxnSwipeActions, TxnTagSheet, AppDialog, UpdateDialog },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()
    const txnStore = useTransactionStore()

    const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20

    /** 三级联动选择：year / month / day，0 表示「全部」 */
    const dateRange = ref(defaultSelection())

    /**
     * 时间筛选方式：'period'（日/月/年三级联动）| 'custom'（自定义起止日）
     *
     * ★ 两套状态各存各的，互不覆盖 ★
     *   用户切回「日/月/年」时应该看到他上次选的那个月，
     *   而不是被自定义区间重置掉。
     */
    const dateMode = ref('period')
    const customStart = ref(defaultCustomRange().startDay)
    const customEnd = ref(defaultCustomRange().endDay)
    /** 原生 picker 的结束日上限：不允许选未来（未来的账还没发生） */
    const todayKey = toDayKey()

    const list = ref([])
    const summary = ref({ count: 0, expense: 0, income: 0, transfer: 0 })
    const offset = ref(0)
    const hasMore = ref(true)
    const loading = ref(false)
    const showFilter = ref(false)
    /** 时间筛选条实例（打开筛选面板前要先收起它的下拉） */
    const filterBarRef = ref(null)

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
      /**
       * 分类筛选：多选 id 数组（空数组 = 不限）
       *
       * ★ 只有这一种分类条件 ★
       *   以前是 parentCategoryId + categoryId + includeSubcategories 三个字段
       *   拼出来的单选，现在统一成一组 id：
       *     - 选一个二级     -> [那个二级]
       *     - 选一个一级     -> 展开成它所有二级（没有二级就 [它自己]）
       *     - 从预算页带多选 -> 原样一组
       *   查询时统一走 IN，不用再推导「要不要带子分类」。
       */
      categoryIds: [],
      tagId: '',
      /** 周期筛选：'' = 不限；非 '' 时只显示该周期产生的流水 */
      cycleId: '',
      keyword: '',
      minYuan: '',
      maxYuan: ''
    })

    // 已应用的筛选（与面板里的编辑态分离）
    const appliedFilter = reactive({ ...filter })

    /* ------------------------------------------------- 右滑 + 多选 */

    /**
     * 每行的右滑状态：txnId -> 'close' | 'right'
     *
     * ★ 多选态下禁用右滑 ★
     *   两种手势都要横向移动，同时生效会互相干扰。
     *   多选模式下点行就是勾选，不需要右滑。
     */
    const swipeStates = reactive({})

    /** 多选模式 */
    const selectMode = ref(false)
    const selectedIds = ref([])
    /** 批量操作进行中（防重复点） */
    const batchBusy = ref(false)

    /**
     * 批量操作条的玻璃变量
     *
     * ★ 直接复用底栏那套 glassVars() ★
     *   用户要求「和 tabbar 一样的磨砂玻璃感」。
     *   自己再写一套 rgba 值只会“看起来差不多”，
     *   用同一个函数才能保证两处的透明度、描边、投影完全一致；
     *   且深色主题下的取值也由它统一处理。
     *
     * 模板里绑在 .batch-inner 上（外层 .batch-bar 只管定位）。
     */
    const batchBarStyle = computed(() => glassVars(settingStore.isDark, { blur: '24rpx' }))

    /** 标签弹层：是否打开、批量还是单笔、回显 id */
    const showTagSheet = ref(false)
    const tagSheetBatch = ref(false)
    const tagSheetTxn = ref(null)
    const tagSheetIds = ref([])


    function isSelected(id) {
      return selectedIds.value.includes(id)
    }

    function toggleSelect(id) {
      const i = selectedIds.value.indexOf(id)
      if (i >= 0) selectedIds.value.splice(i, 1)
      else selectedIds.value.push(id)
      // 一个都不剩就自动退出多选，免得底部空留一条操作栏
      if (selectedIds.value.length === 0) selectMode.value = false
    }

    function exitSelectMode() {
      selectMode.value = false
      selectedIds.value = []
    }

    /** 点行：多选模式切换勾选；否则进详情 */
    function onRowClick(txn) {
      if (!selectMode.value) {
        goDetail(txn.id)
        return
      }
      toggleSelect(txn.id)
    }

    /** 长按：进入多选并选中这一行 */
    function onRowLongPress(txn) {
      if (!selectMode.value) {
        selectMode.value = true
        selectedIds.value = []
      }
      if (!isSelected(txn.id)) toggleSelect(txn.id)
    }

    /** 返回：多选态先退出多选，不退出页面 */
    function onBack() {
      if (selectMode.value) {
        exitSelectMode()
        return
      }
      goBack()
    }

    /* ------------------------------------------- 右滑快捷操作 */

    /**
     * 右滑删除（单笔）
     *
     * ★ 为什么要确认 ★
     *   右滑很容易误触（单手滑列表时尤其），
     *   而删除在界面上看不到撤销入口。确认框是最后一道防线。
     */
    async function onSwipeDelete(txn) {
      if (swipeStates[txn.id]) swipeStates[txn.id] = 'close'
      const ok = await confirmDialog({
        title: '删除这笔流水？',
        content: `${txnTitle(txn)} · ¥${(Number(txn.amount_cents || 0) / 100).toFixed(2)}`,
        confirmText: '删除',
        cancelText: '取消',
        danger: true
      })
      if (!ok) return
      try {
        await deleteTransaction(txn.id)
        uni.showToast({ title: '已删除', icon: 'none' })
        await loadFirstPage()
      } catch (e) {
        await alertDialog({ title: '删除失败', content: e.message })
      }
    }

    /** 右滑标签（单笔）：打开弹层，回显这笔已有的标签 */
    function onSwipeTag(txn) {
      if (swipeStates[txn.id]) swipeStates[txn.id] = 'close'
      tagSheetBatch.value = false
      tagSheetTxn.value = txn
      tagSheetIds.value = Array.isArray(txn.tag_ids) ? txn.tag_ids.slice() : []
      showTagSheet.value = true
    }

    /* ------------------------------------------- 批量操作 */

    /** 批量删除 */
    async function onBatchDelete() {
      if (batchBusy.value) return
      const ids = selectedIds.value.slice()
      if (ids.length === 0) return
      const ok = await confirmDialog({
        title: `删除这 ${ids.length} 笔流水？`,
        content: '删除后账户余额会重新计算，这个操作不可撤销。',
        confirmText: '删除',
        cancelText: '取消',
        danger: true
      })
      if (!ok) return
      batchBusy.value = true
      try {
        const r = await batchDeleteTransactions(ids)
        uni.showToast({
          title: r.failed > 0
            ? `已删除 ${r.deleted} 笔，${r.failed} 笔失败`
            : `已删除 ${r.deleted} 笔`,
          icon: 'none'
        })
        exitSelectMode()
        await loadFirstPage()
      } catch (e) {
        await alertDialog({ title: '批量删除失败', content: e.message })
      } finally {
        batchBusy.value = false
      }
    }

    /** 批量加标签：打开弹层（hint 说明是「追加」而不是覆盖） */
    function openBatchTag() {
      if (selectedIds.value.length === 0) return
      tagSheetBatch.value = true
      tagSheetTxn.value = null
      tagSheetIds.value = []
      showTagSheet.value = true
    }

    /**
     * 批量「不计预算」
     *
     * ★ 为什么是开关式切换而不是直接置 1 ★
     *   用户点这个按钮时，一半情况是想标记「不计」，
     *   另一半是标错了想取消。所以先看选中的里有没有已经不计的：
     *   全部都是就取消，否则全部设成不计。
     *   （混选时走「全部设成不计」—— 用户意图多半是要标齐。）
     */
    async function onBatchExcludeBudget() {
      const picked = (list.value || []).filter((t) => selectedIds.value.includes(t.id))
      if (picked.length === 0) return
      const allExcluded = picked.every((t) => Number(t.exclude_from_budget) === 1)
      const next = !allExcluded
      await applyBatchFlags(
        { budget: next },
        next ? '已设为不计预算' : '已取消不计预算'
      )
    }

    /**
     * 批量「待报销」（用户本轮第 3 条）
     *
     * ★ 用户原话 ★
     *   「多选的悬浮按钮不计收支修改为待报销」。
     *
     * ★ 为什么换 ★
     *   列表里选一批流水，最常见的意图是「这批要报销」；
     *   「不计收支」是个很少用的高级标记，
     *   放在四个位置里占了最宝贵的一个。
     *
     * ★ 为什么不能直接用 applyBatchFlags ★
     *   待报销不只是改一个标记位：
     *     · 要同时把 reimburse_status 置 1、两个 exclude 置 1
     *     · 只有支出可以，借款类不行，已报销的不能动
     *   这些校验在 api/reimburse.js 的 batchSetPendingReimburse 里。
     *
     * ★ 开关式（全部已待报销就取消）★
     *   和不计预算那个按钮同一套交互习惯。
     */
    async function onBatchPendingReimburse() {
      if (batchBusy.value) return
      const picked = (list.value || []).filter((t) => selectedIds.value.includes(t.id))
      if (picked.length === 0) return
      const allPending = picked.every((t) => Number(t.reimburse_status) === 1)
      const next = !allPending
      batchBusy.value = true
      try {
        const r = await batchSetPendingReimburse(selectedIds.value.slice(), next)
        if (r.changed === 0) {
          uni.showToast({ title: '所选的流水都不能报销', icon: 'none' })
        } else if (r.skipped > 0) {
          uni.showToast({
            title: next
              ? `已标 ${r.changed} 笔，${r.skipped} 笔不支持报销`
              : `已取消 ${r.changed} 笔，${r.skipped} 笔跳过`,
            icon: 'none'
          })
        } else {
          uni.showToast({
            title: next ? `已标为待报销 ${r.changed} 笔` : `已取消待报销 ${r.changed} 笔`,
            icon: 'none'
          })
        }
        await loadFirstPage()
      } catch (e) {
        await alertDialog({ title: '批量设置失败', content: e.message })
      } finally {
        batchBusy.value = false
      }
    }

    /** 写批量标记 + 刷新 + 提示（两个按钮共用） */
    async function applyBatchFlags(flags, okText) {
      if (batchBusy.value) return
      batchBusy.value = true
      try {
        await batchSetExcludeFlags(selectedIds.value.slice(), flags)
        uni.showToast({ title: okText, icon: 'none' })
        // 不退出多选：用户很可能还要接着标另一个标记
        await loadFirstPage()
      } catch (e) {
        await alertDialog({ title: '批量设置失败', content: e.message })
      } finally {
        batchBusy.value = false
      }
    }

    /**
     * 标签弹层确定
     *
     * ★ 单笔用覆盖（set）、批量用追加（add）★
     *   单笔弹层里回显的就是它当前的标签，用户取消勾选 = 想移除，
     *   用 add 就永远删不掉标签了。
     *   批量是「给这批都加上」，各笔原有标签必须保留。
     */
    async function onTagSheetPicked(ids) {
      showTagSheet.value = false
      try {
        if (tagSheetBatch.value) {
          await batchSetTxnTags(selectedIds.value.slice(), ids, 'add')
          uni.showToast({ title: '标签已添加', icon: 'none' })
          await loadFirstPage()
        } else {
          const txn = tagSheetTxn.value
          if (!txn) return
          await updateTransaction(txn.id, { tag_ids: ids })
          uni.showToast({ title: '标签已更新', icon: 'none' })
          await loadFirstPage()
        }
      } catch (e) {
        await alertDialog({ title: '保存标签失败', content: e.message })
      }
    }

    /* ------------------------------------------------- 下拉选择器 */

    /**
     * 下拉框形式的筛选
     *
     * 面板里的每一项（账户 / 一级分类 / 二级分类 / 标签）都是
     * 「左标签 + 右当前值 + ›」的一行，点一下弹出选项列表。
     * 四个下拉共用一个 wd-action-sheet（底部选项表），
     * 切换的是 pickerKind 指向的那一组选项。
     */
    /** 类别多选弹层是否打开 */
    const showMultiCat = ref(false)

    /** 当前打开的是哪个下拉：account | parent | sub | tag */
    const pickerKind = ref('')
    const showPicker = ref(false)

    const PICKER_TITLES = {
      account: '选择账户',
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
    const pageStyle = computed(() => settingStore.cssVars)

    const rangeLabel = computed(() => {
      if (dateMode.value === 'custom') {
        return customRangeLabel(customStart.value, customEnd.value)
      }
      const sel = dateRange.value
      if (!sel.year) return '全部年'
      if (!sel.month) return `${sel.year}年`
      if (!sel.day) return `${sel.year}年${sel.month}月`
      return `${sel.year}年${sel.month}月${sel.day}日`
    })


    /**
     * 多选分类的数据源（扁平列表，含 parent_id / isParent）
     *
     * ★ 只传白名单字段 ★
     *   弹层只需要 id / parent_id / name 这些，传整行会把 icon/color
     *   之类无关字段带到组件里，改起来容易误以为能改库。
     */
    const multiCatSource = computed(() =>
      categories.value.map((c) => ({
        id: c.id,
        parent_id: c.parent_id || '',
        name: c.name,
        isParent: !!c.isParent
      }))
    )

    /**
     * 多选分类那一行的当前值
     *
     * 没选 → 全部（占位态）；
     * 选了 → 「A、B 等N项」，太多名字一行放不下。
     */
    const multiCatLabel = computed(() => {
      const ids = filter.categoryIds || []
      if (ids.length === 0) return '全部'
      const all = [...catCache.expense, ...catCache.income]
      /*
       * ★ 显示成「一级-二级」而不是只给二级名 ★
       *   只写「午餐」看不出它属于餐饮食品还是别的分支；
       *   和预算页的类别标签保持同一套写法（那里也是 ${p.name}-${k.name}）。
       */
      const names = ids
        .map((id) => {
          const c = all.find((x) => x.id === id)
          if (!c) return ''
          if (!c.parent_id) return c.name
          const p = all.find((x) => x.id === c.parent_id)
          return p ? `${p.name}-${c.name}` : c.name
        })
        .filter(Boolean)
      if (names.length === 0) return `${ids.length} 个分类`
      /*
       * ★ 只给第一个名字 + 等N项 ★
       *   用户要求「分类如果多选的话，显示一个分类名加等X项」。
       *   两个名字并排在小屏上就会换行，把筛选项的行高顶高一倍；
       *   而这一格只是让人确认「按哪一类筛的」。
       */
      if (names.length === 1) return names[0]
      return `${names[0]} 等${names.length}项`
    })

    /**
     * 把「用户勾的分类」展开成「实际要查的分类 id」
     *
     * ★ 为什么要展开一级分类 ★
     *   用户勾「餐饮食品」这个一级分类，意思显然是「餐饮下所有支出」，
     *   而不是「直接记在餐饮食品这一级上的那几笔」。
     *   而交易只会落在二级分类上（记账面板里一级分类若有二级就不可选，
     *   见 utils/categorySort.js 的 isSelectableCategory），
     *   所以一级必须展开成它的所有二级，否则勾了只会查出 0 笔。
     *
     * ★ 没有二级的一级分类保持原样 ★
     *   「娱乐」「住房」这类没有子分类的一级，交易是直接挂在它身上的，
     *   展开成空数组会把条件抹掉（变成「不限分类」）—— 那就是灾难性的错。
     *
     * ★ 重复 id 要去掉 ★
     *   同时勾了「餐饮食品」和它下面的「日常三餐」时，
     *   展开后会出现两个「日常三餐」，IN 里重复不影响结果，但显得脏。
     */
    function expandCategoryIds(ids) {
      const out = []
      const seen = new Set()
      const push = (id) => {
        if (!id || seen.has(id)) return
        seen.add(id)
        out.push(id)
      }
      for (const id of ids || []) {
        const cat = categories.value.find((c) => c.id === id)
        if (!cat) continue
        const kids = categories.value.filter((c) => c.parent_id === id)
        if (kids.length === 0) {
          push(id)
          continue
        }
        /*
         * ★ 一级分类要把自己也算进去 ★
         *   旧版两级联动勾一级时走的是
         *     t.category_id IN (SELECT id FROM category WHERE id = ? OR parent_id = ?)
         *   也就是「一级自己 + 所有二级」。
         *   正常记账不会记在一级上（一级有二级时不可选，见 utils/categorySort.js），
         *   所以多带一个 id 不会多查出错单，但能保证与旧链接的结果**逐条一致** ——
         *   老数据里万一有直接挂在一级上的流水，不会因为这次改造凭空消失。
         */
        push(id)
        kids.forEach((k) => push(k.id))
      }
      return out
    }

    /* ------------------------------------------------- 下拉当前值文案 */

    /** 账户当前值 */
    const accountLabel = computed(() => {
      if (!filter.accountId) return '全部'
      const acc = accountStore.list.find((a) => a.id === filter.accountId)
      return acc ? acc.name : '全部'
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
      if ((appliedFilter.categoryIds || []).length > 0) n++
      if (appliedFilter.tagId) n++
      if (appliedFilter.cycleId) n++
      if (appliedFilter.keyword) n++
      if (appliedFilter.minYuan || appliedFilter.maxYuan) n++
      return n
    })

    /**
     * 按天分组，并算每组的「支出 / 收入」小计。
     *
     * ★ 分组小计必须排除 exclude_from_stats 的流水（踩过的坑）★
     *   借出 / 借入 / 借款归还 / 借款收回是资金往来，待报销、报销到账
     *   也不是真实收支 —— 它们都带 exclude_from_stats = 1。
     *   顶部 summary 走的是 api/transaction.js 的 sumTransactions，
     *   那里用 `COALESCE(t.exclude_from_stats, 0) = 0` 把这几笔剔掉了。
     *   以前这里只是无脑累加 type，结果同一天借出去 500，
     *   顶部写「支出 0」，切到那天的分组头却写「支出 -500.00」，
     *   两个数字对不上，用户以为哪边算错了。
     *
     * ★ 只影响汇总，不影响列表 ★
     *   这些流水仍然 push 进 g.list 照常显示（用户要看到借款、待报销的记录），
     *   只是不参与 g.expense / g.income。某天全部被排除时两个数都是 0，
     *   模板里的 v-if="group.expense > 0" 会让组头干脆不显示金额 ——
     *   而不是显示「支出 -0.00」。
     *
     * ★ transfer 也天然不进汇总 ★
     *   下面只认 type === 'expense' / 'income'，转账的 type 是 'transfer'，
     *   既不是支出也不是收入（钱只是从左口袋到右口袋），确认不用额外判断。
     */
    const groups = computed(() => {
      const map = new Map()
      for (const txn of list.value) {
        const day = txn.occurred_day
        if (!map.has(day)) {
          map.set(day, { day, title: formatDayHeader(day), list: [], expense: 0, income: 0 })
        }
        const g = map.get(day)
        g.list.push(txn)
        // 不计入收支的流水只列出来，不进小计（口径对齐 sumTransactions）
        if (txn.exclude_from_stats) continue
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

      /*
       * 分类条件跟着类型清理
       *
       *   从「全部」切到「支出」时，之前勾的收入分类已经不在 categories 里了；
       *   留着它不会报错，但查询会带上一个永远匹配不到的 id，
       *   用户看到的是「列表突然变空」，却看不出原因。
       *   所以把已经不存在的分类 id 摘掉。
       */
      if ((filter.categoryIds || []).length > 0) {
        const alive = new Set(categories.value.map((c) => c.id))
        const kept = filter.categoryIds.filter((id) => alive.has(id))
        if (kept.length !== filter.categoryIds.length) filter.categoryIds = kept
      }
    }

    /** 打开多选分类弹层 */
    function openMultiCatPicker() {
      if (multiCatSource.value.length === 0) {
        uni.showToast({ title: '没有可选的分类', icon: 'none' })
        return
      }
      showMultiCat.value = true
    }

    /**
     * 多选分类确定
     *
     * ★ 这里存的是「用户勾的那几个」，不是展开后的 ★
     *   勾了一级分类，回显时要显示一级分类的名字；
     *   展开成二级是查询时才做的事（见 buildQuery 里的 expandCategoryIds）。
     *   如果这里就存展开结果，界面上会变成「餐饮食品」突然显示成
     *   「日常三餐、奶茶饮料…」一串，用户会以为自己勾错了。
     */
    function onMultiCatConfirm(ids) {
      filter.categoryIds = Array.isArray(ids) ? ids.slice() : []
    }

    /* ------------------------------------------------------ 查询 */

    function buildQuery() {
      const q = {
        limit: PAGE_SIZE,
        offset: offset.value
      }

      /*
       * ★ 两套筛选方式只走其中一条 ★
       *   自定义区间不写 monthKey（理由见 utils/date.js 的 customToRange），
       *   否则跨月查询会被 month_key 的等值条件掐死，只能查到一个月。
       */
      if (dateMode.value === 'custom') {
        const r = customToRange(customStart.value, customEnd.value)
        if (r.monthKey) q.monthKey = r.monthKey
        else {
          if (r.startDay) q.startDay = r.startDay
          if (r.endDay) q.endDay = r.endDay
        }
      } else {
        const sel = dateRange.value
        const r = selectionToRange(sel)
        // 整月用 month_key（走 idx_txn_month_type），其余用 occurred_day 区间
        if (sel.year && sel.month && !sel.day) {
          q.monthKey = r.monthKey
        } else {
          if (r.startDay) q.startDay = r.startDay
          if (r.endDay) q.endDay = r.endDay
        }
      }
      if (appliedFilter.type !== 'all') q.type = appliedFilter.type
      if (appliedFilter.accountId) q.accountId = appliedFilter.accountId
      /*
       * 分类过滤
       *
       * ★ 只有多选这一条路 ★
       *   面板上勾的是「用户想看的分类」，勾一级分类表示「这一整支」，
       *   所以这里先展开成实际的二级 id，再拼成 IN 查询。
       *   展开逻辑见 expandCategoryIds（勾了没有二级的一级分类时原样保留）。
       */
      const pickedCats = expandCategoryIds(appliedFilter.categoryIds || [])
      if (pickedCats.length > 0) q.categoryIds = pickedCats.join(',')
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
        type: 'all', accountId: '', categoryIds: [],
        tagId: '', cycleId: '', keyword: '', minYuan: '', maxYuan: ''
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
     * 切换时间筛选方式。
     *
     * ★ 切过去就立刻查一次 ★
     *   两套状态各存各的，切过去如果不查，列表还停在上一种方式的结果上，
     *   用户会以为切换没生效。
     */
    function onModeChange(mode) {
      if (dateMode.value === mode) return
      dateMode.value = mode
      loadFirstPage()
    }

    /**
     * 自定义区间的起止日变化。
     *
     * ★ 颠倒纠正交给组件了 ★
     *   DateFilterBar 的 commit() 内部会交换起止（统计页、交易页共用同一份），
     *   这里直接采用即可，不再重复判断 —— 两处都判断反而容易改漏一处。
     */
    function onCustomChange({ startDay, endDay }) {
      customStart.value = startDay
      customEnd.value = endDay
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
      if (filterBarRef.value && typeof filterBarRef.value.collapse === 'function') {
        filterBarRef.value.collapse()
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
      /*
       * ★ 账户在前、备注在后（用户指定）★
       *   和首页、账户详情页保持同一顺序，
       *   否则同一笔交易在不同页面看起来像两条不同的记录。
       */
      // ★ 账户被删除后 account_name 为空 —— 显示「无账户」 ★
      if (txn.type !== 'transfer') parts.push(txn.account_name || '无账户')
      // 人员类流水的 note 已在徽标里显示，副标题不再重复一次
      if (txn.note && !isLoanPersonCategory(txn.category_name)) parts.push(txn.note)
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
    /**
     * 一笔交易的徽标集合
     *
     * ★ 顺序唯一来源：utils/txnBadges.js（本轮用户第 1 条）★
     *   用户标签 > 人员名称 > 待报销/已报销 > 周期 > 组合账户 > 不计收支
     */
    function txnBadges(txn) {
      return buildTxnBadges(txn, {
        primaryColor: primaryColor.value,
        tagMap: tagNameMap.value
      })
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
    /**
     * URL 上待换算的分类 id
     *
     * 分类列表是异步加载的，applyUrlOptions 里拿到 id 时还不能判断
     * 「这是一级还是二级」，先存这里，等两个类型的分类缓存都齐了
     * 再调 normalizeUrlCategory 换算（见 onMounted）。
     */
    let pendingUrlCategoryId = ''
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

      /*
       * 分类：两种 URL 写法都要接
       *
       *   ?categoryIds=a,b,c  子预算的「全部交易」带的一组分类，直接用
       *   ?categoryId=x      账户/分类/标签/周期详情页的「全部」带单个分类，
       *                      换算成一组
       *
       * ★ 单选的那个 id 不一定存在于分类列表里 ★
       *   URL 上的分类可能已经被删了，或者 type 参数不对（比如只传了
       *   categoryId 而 type 仍是「全部」）。所以先记下来，
       *   等分类加载完再换算（见 normalizeUrlCategory）。
       */
      filter.categoryIds = Array.isArray(q.categoryIds) ? q.categoryIds.slice() : []
      pendingUrlCategoryId = q.categoryId || ''

      await syncCategories(filter.type)
      // 换算 URL 上的分类时可能要查另一种类型的分类，所以两个缓存都备齐
      await loadCategoryType('expense')
      await loadCategoryType('income')
      normalizeUrlCategory(q.includeSubcategories)

      // URL 带来的条件直接生效，不用再点「应用筛选」
      Object.assign(appliedFilter, filter)
    }

    /**
     * 把 URL 上单个 categoryId 折算成「一组已选分类」
     *
     *   传二级 → [那个二级]
     *   传一级 → [那个一级]（查询时由 expandCategoryIds 展开成整支）
     *
     * 两个类型的缓存都找一遍 —— URL 上的分类可能与 type 参数不同源
     * （比如只传了 categoryId，type 仍是「全部」）。
     *
     * includeSub 参数已不再影响结果（一级一律按整支处理），
     * 保留形参只是为了让调用处看着仍然「考虑过这个参数」——
     * 老链接 ?categoryId=x&includeSubcategories=1 的结果保持不变。
     */
    function normalizeUrlCategory(includeSub) {
      const cid = pendingUrlCategoryId
      if (!cid) return
      pendingUrlCategoryId = ''

      const all = [...catCache.expense, ...catCache.income]
      const cat = all.find((c) => c.id === cid)
      if (!cat) {
        // 分类不存在（已删除 / id 写错）—— 退回「不按分类筛」
        return
      }

      /*
       * ★ 一级分类按「整支」理解 ★
       *   详情页的「全部」跳过来时带的是那个分类本身。
       *   如果它是一级分类，用户的意思是「这一整支的流水」，
       *   所以把它的二级都加进来。
       *
       *   includeSubcategories=1 是旧链接的写法，现在不需要它也知道该展开；
       *   但为了老链接行为不变，这里仍然接受这个参数 ——
       *   反正一级一律展开，与传不传参数的结果一致。
       *   （includeSub 只在「只想看这一级、不看子级」时才有区别，
       *     而那种用法在旧版界面里就不存在。）
       */
      /*
       * ★ 只存这一个 id，展开留给查询时做 ★
       *   如果这里就把一级展开成一串二级，筛选面板上会显示成
       *   「日常三餐、奶茶饮料 等N项」—— 用户明明是从「餐饮食品」
       *   的详情页点过来的，看到一串陌生的子分类会以为自己点错了。
       *   存原 id 的话面板显示「餐饮食品」，查询时再展开，
       *   显示与命中范围两头都对。
       */
      filter.categoryIds = [cid]
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

    /**
     * ★ 回到本页时必须重查一次 ★
     *   从详情页删掉一笔、或改完一笔再返回时，本页还是离开前的旧列表 ——
     *   用户看到的就是「删了但没消失」，只能手动下拉刷新。
     *   onShow 是唯一能覆盖「返回」「切后台再回来」的钩子，所以放这儿。
     *
     * ★ 但要跳过第一次 onShow ★
     *   首次进入时 onShow 和 onMounted 都会触发，
     *   onMounted 里已经查过一遍了，这里再查就是重复请求。
     */
    let shownOnce = false
    onShow(() => {
      settingStore.syncSystemTheme()
      if (!shownOnce) {
        shownOnce = true
        return
      }
      // 页面还没挂载完时不要查（onMounted 里会查）
      if (!mounted.value) return
      loadFirstPage()
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

    /*
     * ★ 返回键：先收弹层，再退多选，最后才退页面（用户本轮第 2 条）★
     *   用户原话：「在全部交易页面多选时，右滑应该取消多选而不是退出页面」。
     *
     *   顺序必须是这样：
     *     1) 有弹层（筛选面板 / 标签弹层 / 选项表）→ 先关弹层
     *     2) 多选态 → 退出多选（这是用户此刻最想撤回的操作）
     *     3) 都不是 → 正常返回上一页
     *
     *   旧写法只调 handleBackPress()，没有多选这一层：
     *   多选态下侧滑会直接退出整个「全部交易」页，勾了半天的选择全丢。
     */
    onBackPress(() => {
      if (handleBackPress()) return true
      if (selectMode.value) {
        exitSelectMode()
        return true
      }
      return false
    })

    return {
      settingStore, accountStore, statusBarHeight,
      dateRange, filterBarRef, list, summary, hasMore, loading, showFilter,
      // 时间筛选方式（日/月/年 或 自定义起止日）
      dateMode, customStart, customEnd, todayKey,
      onModeChange, onCustomChange,
      filter, appliedFilter, typeOptions, categories, tags,
      primaryColor, pageStyle, rangeLabel, filterCount, groups,
      showMultiCat, multiCatSource, multiCatLabel, openMultiCatPicker, onMultiCatConfirm,
      // 下拉选择器
      showPicker, pickerTitle, pickerActions, openPicker, onPickerSelect,
      // 下拉当前值
      accountLabel, tagLabel, cycleFilterLabel,
      loadMore, applyFilter, resetFilter, onDateChange, openFilter,
      onTypeChange,
      // 右滑 + 多选批量
      swipeStates, selectMode, selectedIds, batchBusy,
      showTagSheet, tagSheetBatch, tagSheetIds, batchBarStyle,
      isSelected, toggleSelect, exitSelectMode,
      onRowClick, onRowLongPress, onBack,
      onSwipeDelete, onSwipeTag,
      onBatchDelete, openBatchTag, onBatchExcludeBudget, onBatchPendingReimburse,
      onTagSheetPicked,
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

/*
 * 标题占满剩余空间，右侧按钮按内容取宽
 * ★ 多选态标题是「已选 N 笔」，会和其他按钮抢空间 ——
 *   给它 flex:1 + 省略号，宁可标题截断也别让按钮换行。
 */
.nav-back {
  font-size: 48rpx;
  color: var(--app-text);
  width: 60rpx;
  line-height: 1;
}

.nav-title {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
  /* 多选态标题是「已选 N 笔」+ 右侧两个按钮，空间紧张时宁可标题截断 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-filter {
  font-size: 26rpx;
  color: var(--app-text-2);
  /*
   * ★ 不再写死宽度（bug 修复）★
   *   原来是 width: 100rpx —— 只够「筛选」两个字。
   *   多选态右侧变成「取消全选」四个字，100rpx 装不下就换行，
   *   导航栏被撑高、文字拆成两行（用户反馈）。
   *   改成按内容自适应 + 不换行。
   */
  flex-shrink: 0;
  white-space: nowrap;
  text-align: right;
  position: relative;
}

/*
 * 多选态的两个按钮之间留间距
 * 它们现在是 flex 兄弟，没有间距会粘在一起
 */
.nav-cancel {
  margin-left: 24rpx;
  color: var(--app-text-3);
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
/*
 * ★ 这里不能设层级 ★
 *   之前写了 `z-index: 5` 本意是让年月日筛的下拉面板别被下面的列表盖住，
 *   但 position + z-index 会创建**层叠上下文**：wd-calendar 弹层哪怕自己
 *   设了 1100，也只是在这个 5 的上下文里当老大，跟页面上的底栏（300）、
 *   「+」按钮（600）比，整棵子树还是 5 —— 于是弹层被压在下面。
 *   层叠只看同一上下文里的兄弟，所以父级一概不设 z-index。
 */
.month-bar {
  flex-shrink: 0;
  position: relative;
  padding: 0 32rpx 12rpx;
}

/*
 * 时间筛选（toggle + 自定义起止日）的样式已经搬进
 * components/DateFilterBar.vue —— 两页共用一份，改一处两页都变。
 */

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

/* 最后一行不画分隔线（加了右滑容器后要选进去，见下） */
.txn-swipe:last-child .txn-item {
  border-bottom: none;
}

.txn-swipe {
  background-color: var(--app-card);
}

/* 多选勾选框，与借款/报销页同一套 */
.row-check {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 2rpx solid var(--app-line);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.row-check.on {
  background-color: var(--app-primary);
  border-color: var(--app-primary);
}

.row-check-tick {
  font-size: 24rpx;
  /* 主题色底上只有白字能保证对比度 */
  color: #ffffff;
}

/*
 * 批量操作条：与底栏同一套磨砂玻璃目形状（用户本轮第 3 条）
 *
 * ★ 用户原话 ★
 *   「多选之后的这个悬浮按钮做成和 tabbar 一样的磨砂玻璃感，
 *   可以整体窄一点，按钮宽不用必须一致」。
 *
 * ★ 三处改动 ★
 *   1. 磨砂玻璃：直接复用 utils/theme.js 的 glassVars()
 *      —— 底栏用的就是它，两处共用同一套
 *      透明底 / 描边 / 投影 / blur 参数，真正一致而不是“看起来差不多”。
 *      backdrop-filter 的 @supports 降级也照搬底栏（安卓 WebView 常见不支持）。
 *   2. 整体窄一点：不再铺满屏宽，改成居中自适应宽度（width: fit-content）。
 *   3. 按钮宽不必一致：去掉 flex:1，每项按文字长度 + 固定左右内距自然展开。
 *
 * ★ 为什么用内层 .batch-inner 而不是直接给 .batch-bar 上样式 ★
 *   底栏那套 CSS 里有 @supports 块，要覆盖的必须是**同一个元素**。
 *   外层只管定位（fixed 居中），内层负责玻璃外观 ——
 *   和 AppTabBar 的 .tabbar-host / .tabbar 分工完全一致。
 */
.batch-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(24rpx + env(safe-area-inset-bottom));
  /*
   * z-index 9：页面内自绘浮层（项目约定 1~9）
   * 标签弹层是 wd-popup（z-index 700），本来就该盖在它上面。
   */
  z-index: 9;
  display: flex;
  justify-content: center;
  /* 外层不吃点击：两侧空白区域不该拦住下面的列表 */
  pointer-events: none;
}

.batch-inner {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  height: 96rpx;
  padding: 0 8rpx;
  border-radius: 999rpx;
  border-width: 1rpx;
  border-style: solid;
  border-color: var(--glass-border, rgba(0, 0, 0, 0.05));
  /*
   * ★ 默认走「仿玻璃」高不透明度 ★
   *   和底栏一样：不支持 backdrop-filter 的设备上，
   *   透明但不糊反而显脏。
   */
  background-color: var(--glass-bg-solid, rgba(255, 255, 255, 0.96));
  box-shadow: var(--glass-shadow, 0 12rpx 40rpx rgba(0, 0, 0, 0.1));
}

/* 真·毛玻璃：仅支持 backdrop-filter 的环境生效（与 AppTabBar 同一套判定） */
@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .batch-inner {
    background-color: var(--glass-bg, rgba(255, 255, 255, 0.70));
    -webkit-backdrop-filter: saturate(180%) blur(var(--glass-blur, 24rpx));
    backdrop-filter: saturate(180%) blur(var(--glass-blur, 24rpx));
  }
}

/*
 * ★ 按钮宽按内容自适应（不再四等分）★
 *   「删除」2 字、「不计预算」4 字 ——
 *   强行等分会让短的那几项两侧空一大截，
 *   整条又因为要铺满屏宽而变得很长。自然宽度 + 居中最耐看。
 */
.batch-item {
  flex-shrink: 0;
  height: 80rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 22rpx;
  border-radius: 999rpx;
}

.batch-item:active {
  background-color: var(--app-card-2);
}

/* 分隔竖线：用伪元素，避免最后一项右侧多一条 */
.batch-item + .batch-item {
  position: relative;
}

.batch-item + .batch-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 1rpx;
  height: 32rpx;
  background-color: var(--app-line);
}

.batch-item-text {
  font-size: 26rpx;
  color: var(--app-text);
  white-space: nowrap;
}

.batch-item-text--danger {
  color: var(--app-danger);
}

/*
 * 多选态下底部要多留出操作条的高度
 *
 * ★ 必须保留安全区 ★
 *   全局 .bottom-space 是 calc(env(safe-area-inset-bottom) + 40rpx)，
 *   这里如果只写固定 rpx，全面屏底部的操作条会压到手势条上。
 *   操作条本身约 96rpx + 底边距 24rpx，再留 40rpx 呼吸空间 → 160rpx。
 */
.bottom-space--batch {
  height: calc(env(safe-area-inset-bottom) + 160rpx);
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
