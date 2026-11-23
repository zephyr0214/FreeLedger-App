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
      @scroll="onListScroll"
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
              支出 -{{ formatWanYuan(group.expense) }}
            </text>
            <text v-if="group.income > 0" class="day-sum-text">
              收入 <text class="day-sum-income">+{{ formatWanYuan(group.income) }}</text>
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
          <!--
            ★ 长按进多选：自己判定，不用平台的 @longpress（用户反馈：滑动时误触多选）★
              平台 @longpress 是按下 350ms、移动超过 10px 才取消，
              10px 只有两三毫米，滑列表起步时轻松达到，
              于是「滑动一下」就进了多选。
              这里改由 utils/rowPress.js 统一判定（450ms + 12px + 滚动抑制），
              两个页面的手势规则完全一致。
          -->
          <view
            class="txn-item"
            @click="onRowClick(txn)"
            @touchstart="onRowTouchStart(txn, $event)"
            @touchmove="onRowTouchMove($event)"
            @touchend="onRowTouchEnd"
            @touchcancel="onRowTouchEnd"
          >
            <!-- 多选勾选框：只在多选模式出现 -->
            <view v-if="selectMode" class="row-check" :class="{ on: isSelected(txn.id) }">
              <text v-if="isSelected(txn.id)" class="row-check-tick">✓</text>
            </view>
            <TxnIcon
              :icon="txn.category_icon"
              :name="txn.category_name"
              :color="txn.category_color"
              :symbol="txn.type === 'transfer' ? '⇄' : ''"
            />

            <view class="txn-info">
              <view class="txn-name-row">
                <text class="txn-name ellipsis">{{ txnTitle(txn) }}</text>
              </view>
              <!-- 徽标：周期 / 组合账户 / 标签，统一描边胶囊，全部跟在分类名下面 -->
              <view v-if="(badgeMap[txn.id] || []).length" class="txn-tag-list">
                <text
                  v-for="t in (badgeMap[txn.id] || [])"
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
              @edit="onSwipeEdit(txn)"
              @tag="onSwipeTag(txn)"
            />
          </template>
          </wd-swipe-action>
        </view>
      </view>

      <view v-if="hasMore" class="load-more">
        <text v-if="loading" class="load-text">加载中…</text>
        <!--
          ★ 手动加载更多（用户要求）★
            首屏 100 条，点一次追加 100 条；不再随滚动自动追加。
            样式直接复用首页「智能助手」的 HeaderAction 胶囊，
            保证与首页按钮一致，不另写一套。
        -->
        <HeaderAction
          v-else
          text="加载更多"
          @action-click="loadMore"
        />
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
      <!-- 多选浮动操作条：与首页共用同一个组件 -->
      <TxnBatchBar
        v-if="selectMode"
        @delete="onBatchDelete"
        @tag="openBatchTag"
        @exclude-budget="onBatchExcludeBudget"
        @pending-reimburse="onBatchPendingReimburse"
      />

      <view class="bottom-space" :class="{ 'bottom-space--batch': selectMode }" />
    </scroll-view>

    <!--
      筛选面板：与统计页共用 components/TxnFilterSheet.vue

      ★ 为什么抽成组件 ★
        用户要求统计页的「更多筛选」复用本页的筛选面板。
        继续把模板留在页面里，统计页只能复制一份，
        字段、分类展开、标签多选语义迟早会分叉。
    -->
    <TxnFilterSheet
      v-model="showFilter"
      :filter="appliedFilter"
      @apply="onFilterApply"
    />

    <!-- 右滑 / 批量「标签」共用的标签选择弹层 -->
    <TxnTagSheet
      v-model="showTagSheet"
      :tags="tags"
      :selected-ids="tagSheetIds"
      :title="tagSheetBatch ? '批量添加标签' : '选择标签'"
      @picked="onTagSheetPicked"
      @tag-created="onTagCreated"
    />

    <!-- 右滑「编辑」打开的记账面板（编辑已有交易） -->
    <TxnPanel
      v-model="showTxnPanel"
      :editing="editingTxn"
      @saved="onTxnSaved"
    />

    <!-- 弹窗宿主：确定框统一用组件库样式 -->
    <AppDialog />

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { onShow, onLoad, onBackPress } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import DateFilterBar from '@/components/DateFilterBar.vue'
import TxnFilterSheet from '@/components/TxnFilterSheet.vue'
import TxnSwipeActions from '@/components/TxnSwipeActions.vue'
import TxnTagSheet from '@/components/TxnTagSheet.vue'
import TxnPanel from '@/components/TxnPanel.vue'
import TxnBatchBar from '@/components/TxnBatchBar.vue'
import AppDialog from '@/components/AppDialog.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import {
  listTransactions, sumTransactions, sumByDay, parseTxnQueryOptions,
  deleteTransaction, updateTransaction,
  batchDeleteTransactions, batchSetExcludeFlags, batchSetTxnTags
} from '@/api/transaction.js'
import { batchSetPendingReimburse } from '@/api/reimburse.js'
import { listCategories } from '@/api/category.js'
import { listTags } from '@/api/tag.js'
import {
  formatDayHeader, formatTime, selectionToRange, defaultSelection, selectionFromDayKey,
  customToRange, customRangeLabel, defaultCustomRange, toDayKey
} from '@/utils/date.js'
import TxnIcon from '@/components/TxnIcon.vue'
import HeaderAction from '@/components/HeaderAction.vue'
import { isLoanPersonCategory } from '@/api/loan.js'
import { buildTxnBadges } from '@/utils/txnBadges.js'
import { formatWanYuan } from '@/utils/money.js'
import { buildTxnFilterQuery, countActiveFilters } from '@/utils/txnFilter.js'
import { handleBackPress } from '@/utils/layerStack.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'
import { createRowPressController } from '@/utils/rowPress.js'

/*
 * 首屏 100 条；点「加载更多」再追加 100 条。
 * 原来 50 条 + 滚动到底自动追加，用户要求改成手动按钮。
 */
const PAGE_SIZE = 100

export default {
  components: { MoneyText, EmptyState, DateFilterBar, TxnFilterSheet, TxnSwipeActions, TxnTagSheet, TxnPanel, TxnBatchBar, AppDialog, UpdateDialog, TxnIcon, HeaderAction },
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
    /**
     * 当前筛选条件下按天的收支合计
     *
     * 由 sumByDay 单独查（包含隐藏的六类结算差额），
     * 不能再用 list 里可见行本地累加 —— 那会把隐藏差额漏掉。
     */
    const dayTotals = ref({})
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
    const catCache = { expense: [], income: [] }
    const catLoaded = { expense: false, income: false }

    const tags = ref([])

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
      /*
       * 筛选的标签：多选 id 数组（空数组 = 不限）
       *
       * ★ 用户本轮第 1 条 ★
       *   「筛选页面标签复用设置标签的面板，
       *   只有一个标签时，显示选中的标签名；
       *   有两个以上标签时，显示「已选中 x 个标签」」。
       *   —— 明确要多选。
       *
       * 为什么不保留单选的 tagId：
       *   两个字段并存就要处处判断「到底用哪个」，
       *   一定会出现「一处改了另一处没改」。
       *   单选只是多选里只勾一个的特例，和分类那边同一套做法。
       */
      tagIds: [],
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

    /** 标签弹层：是否打开、批量还是单笔、回显 id */
    const showTagSheet = ref(false)
    const tagSheetBatch = ref(false)
    const tagSheetTxn = ref(null)
    const tagSheetIds = ref([])

    /** 右滑「编辑」：记账面板 + 当前编辑的交易 */
    const showTxnPanel = ref(false)
    const editingTxn = ref(null)


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

    /**
     * 点行：多选模式切换勾选；否则进详情
     *
     * ★ 长按刚成立时的那次 click 要忽略 ★
     *   钩子内存（App 端）里长按成立后松手还会补发一次 click，
     *   不挡掉就是「长按选中这一行 → 松手又把它取消掉」，
     *   表现成「怎么长按都选不上这一行」。
     *   闸门里给了 500ms 的屏蔽窗口。
     */
    function onRowClick(txn) {
      if (rowPress.clickBlocked()) return
      if (!selectMode.value) {
        goDetail(txn.id)
        return
      }
      toggleSelect(txn.id)
    }

    /** 长按成立：进入多选并选中这一行（由 utils/rowPress.js 判定后回调） */
    function onRowLongPress(txn) {
      if (!selectMode.value) {
        selectMode.value = true
        selectedIds.value = []
      }
      if (!isSelected(txn.id)) toggleSelect(txn.id)
      // ★ 轻震动：告诉用户「进多选是被识别到的」，不是页面自己跳了 ★
      //   和账户页长按设默认、底栏长按记账同一套反馈。
      try {
        uni.vibrateShort({ type: 'light' })
      } catch (e) {}
    }

    /*
     * 行手势闸门（长按进多选）
     *
     * ★ 为什么不再直接用 @longpress（用户反馈：滑动时误触多选）★
     *   平台 @longpress = 按下 350ms 且移动不超过 10px。
     *   10px 在手机上只有两三毫米，手指从静止开始滑列表的第一步
     *   （以及按下后「酝酿」那一下）都很容易落在 10px 以内、350ms 以外，
     *   于是普通滑动被判成长按 → 进多选 → 松手补发的 click 又勾一行。
     *
     *   现在换成 utils/rowPress.js：
     *     · 450ms 才算长按
     *     · 移动超过 12px 立刻判为滑动
     *     · 列表正在滚（250ms 内有 scroll）时一律不判
     *     · 多指触摸不判
     *     · 长按成立后 500ms 内屏蔽 click
     *   规则与报销页完全一致（同一个模块，不是两份复制）。
     */
    const rowPress = createRowPressController({ onLongPress: onRowLongPress })

    /** scroll-view 滚动：告诉闸门「列表在动」，并撤销进行中的长按 */
    function onListScroll() {
      rowPress.onScroll()
    }

    const onRowTouchStart = (txn, e) => rowPress.onTouchStart(txn, e)
    const onRowTouchMove = (e) => rowPress.onTouchMove(e)
    const onRowTouchEnd = () => rowPress.onTouchEnd()

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
        // 通知首页/统计/我的标脏，下次显示时重查
        uni.$emit('txn:changed')
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

    /** 右滑「编辑」：收起右滑，打开记账面板并回填这笔交易 */
    function onSwipeEdit(txn) {
      if (swipeStates[txn.id]) swipeStates[txn.id] = 'close'
      editingTxn.value = txn
      showTxnPanel.value = true
    }

    /** 编辑保存后刷新列表，同时刷新首页 store，切回去能看到新值 */
    async function onTxnSaved() {
      await loadFirstPage()
      txnStore.loadHome(true)
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

    /** 标签面板里新建了标签：刷新列表，面板保持打开 */
    async function onTagCreated() {
      try {
        tags.value = await listTags()
      } catch (e) {
        console.warn('[txnList] 刷新标签失败:', e && e.message)
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
          uni.$emit('txn:changed')
          uni.showToast({ title: '标签已更新', icon: 'none' })
          await loadFirstPage()
        }
      } catch (e) {
        await alertDialog({ title: '保存标签失败', content: e.message })
      }
    }

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

    /** 已应用的筛选条件数量（导航栏角标 / 空态文案） */
    const filterCount = computed(() => countActiveFilters(appliedFilter))

    /**
     * 按天分组；每组的支出/收入小计来自 sumByDay() 的聚合结果。
     *
     * ★ 为什么不本地累加 list ★
     *   list 只包含「可见流水」，而报销坏账/盈余、借出坏账/利息、
     *   借入未还/利息这六类已经被列表隐藏，但用户要求它们的金额
     *   仍然进每日小计和顶部合计。所以小计必须查全量聚合，
     *   不能拿 list 里露出来的行去加。
     *
     * ★ 小计仍然排除 exclude_from_stats ★
     *   借出 / 借入 / 借款归还 / 借款收回、待报销、报销到账
     *   是资金往来，不是真实收支；sumByDay 内部已经按这个口径过滤。
     *   列表行照常显示（这些行是用户要看的），只是不进金额小计。
     */
    const groups = computed(() => {
      const map = new Map()
      const totals = dayTotals.value || {}
      for (const txn of list.value) {
        const day = txn.occurred_day
        if (!map.has(day)) {
          const total = totals[day] || { expense: 0, income: 0 }
          map.set(day, {
            day,
            title: formatDayHeader(day),
            list: [],
            expense: total.expense,
            income: total.income
          })
        }
        map.get(day).list.push(txn)
      }
      return Array.from(map.values())
    })

    /*
     * ★ 徽标缓存 ★
     *   模板每行调用两次 txnBadges(txn)（v-if + v-for），
     *   一行两遍、还要各自 new 数组。按 id 预算一次，模板查表即可。
     */
    const badgeMap = computed(() => {
      const map = {}
      for (const txn of list.value) {
        map[txn.id] = txnBadges(txn)
      }
      return map
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
      /*
       * 筛选条件统一交给 utils/txnFilter.js 生成
       *
       * ★ 和统计页共用同一段转换 ★
       *   账户、分类展开、标签多选、周期、关键词、金额区间的语义
       *   只在这里定义一次，避免两页对「账户是否含转入」之类细节分叉。
       */
      const allCategories = [...catCache.expense, ...catCache.income]
      Object.assign(q, buildTxnFilterQuery(appliedFilter, allCategories))

      return q
    }

    async function loadFirstPage() {
      loading.value = true
      offset.value = 0
      try {
        const q = buildQuery()
        const [rows, sum, byDay] = await Promise.all([
          listTransactions(q),
          sumTransactions({ ...q, limit: undefined, offset: undefined }),
          sumByDay({ ...q, limit: undefined, offset: undefined })
        ])
        list.value = rows
        summary.value = sum
        dayTotals.value = byDay
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

    /**
     * 筛选面板应用
     *
     * 组件内部已经管好编辑态，这里只接收最终条件并重查；
     * 与统计页的 onFilterApply 语义一致。
     */
    function onFilterApply(next) {
      Object.assign(appliedFilter, next)
      loadFirstPage()
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
      /*
       * 标签深链：tagId 单个、tagIds 多个，都归并成数组
       * （页面内部只认 tagIds 这一种形式）。
       */
      filter.tagIds = q.tagIds && q.tagIds.length > 0
        ? q.tagIds
        : (q.tagId ? [q.tagId] : [])

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
     *   传一级 → [那个一级]（查询时由 utils/txnFilter.js 的 expandCategoryIds 展开成整支）
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
      tags.value = await listTags()

      // 筛选面板要按类型分组，两种分类缓存都先备齐
      await Promise.all([loadCategoryType('expense'), loadCategoryType('income')])

      // URL 上的条件要先生效
      if (urlOptions.value) {
        await applyUrlOptions(urlOptions.value)
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
     * 筛选面板的弹层栈登记在 TxnFilterSheet 组件内部完成，
     * 页面不再重复登记（重复会让一次返回只关掉一层空壳）。
     */
    onUnmounted(() => {
      // 手势闸门里可能还挂着一个长按计时器，页面走了要清掉
      rowPress.dispose()
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
      formatWanYuan,
      settingStore, accountStore, statusBarHeight,
      dateRange, filterBarRef, list, summary, hasMore, loading, showFilter,
      // 时间筛选方式（日/月/年 或 自定义起止日）
      dateMode, customStart, customEnd, todayKey,
      onModeChange, onCustomChange,
      appliedFilter, tags,
      primaryColor, pageStyle, rangeLabel, filterCount, groups,
      loadMore, onFilterApply, onDateChange, openFilter,
      // 右滑 + 多选批量
      swipeStates, selectMode, selectedIds, batchBusy,
      showTagSheet, tagSheetBatch, tagSheetIds,
      showTxnPanel, editingTxn,
      isSelected, toggleSelect, exitSelectMode,
      onRowClick, onRowLongPress, onBack,
      // 行手势（长按进多选）—— 见 utils/rowPress.js
      onRowTouchStart, onRowTouchMove, onRowTouchEnd, onListScroll,
      onSwipeDelete, onSwipeEdit, onSwipeTag, onTxnSaved,
      onBatchDelete, openBatchTag, onBatchExcludeBudget, onBatchPendingReimburse,
      onTagSheetPicked, onTagCreated,
      txnTitle, txnSub, txnBadges, badgeMap, timeLabel, goDetail, goBack
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

/*
 * ★ 行高收紧（用户本轮第 2 条）★
 *   数值必须与首页 .txn-item 完全一致 ——
 *   同一笔账在两个页面里行高不同，切换时会明显感到“跳”。
 */
/*
 * ★ 分隔线用 1px，不用 1rpx（与首页同一原因）★
 *   1rpx ≈ 0.5 CSS px，骑在物理像素缝里会被抗锯齿摊薄；行高随徽标 /
 *   副标题行数变化，落点不同，于是有的线可见、有的像没画。
 *   暗色下线条与卡片对比度本来就低，被摊薄后更容易整条消失。
 */
.txn-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 24rpx;
  border-bottom: 1px solid var(--app-line);
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
  /* 让 HeaderAction 以内容宽度显示成胶囊，而不是撑满整行 */
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 24rpx 0;
}

.load-text {
  font-size: 22rpx;
  color: var(--app-text-3);
}

</style>
