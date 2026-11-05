<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <!-- 标题随类型变化：借出管理 / 借入管理 -->
    <PageNav :title="pageTitle" @back="goBack">
      <template #right>
        <text class="nav-add" @click="onNavAdd">{{ navAddText }}</text>
      </template>
    </PageNav>

    <scroll-view class="page-scroll" scroll-y>
      <!--
        汇总卡

        ★ 大数字是「当前」而不是「本月」★
          用户要看的是「现在还有多少钱在外面没收回来」
          （借出）/「现在还欠别人多少」（借入），不是本月发生额。
          本月发生额没有业务含义 —— 借出去 5 笔、收回 3 笔，
          「本月 5 笔合计」既不能说明还剩多少，也不是收支。

        ★ 大数字怎么算 ★
          借出：借出（支出）- 借款收回（收入）
          借入：借入（收入）- 借款归还（支出）
          不会出现负数（收多了/还多了按 0 处理）。

        ★ 下方三项 ★
          借出：累计借出、借款收回、累计笔数
          借入：累计借入、借款归还、累计笔数
      -->
      <view class="summary-card">
        <view class="summary-head">
          <view class="summary-icon" :style="{ backgroundColor: accentColor + '22' }">
            <text class="summary-icon-text">{{ headEmoji }}</text>
          </view>
          <view class="summary-info">
            <text class="summary-name">{{ currentLabel }}</text>
            <text class="summary-type">{{ directionText }}</text>
          </view>
        </view>

        <MoneyText
          :cents="currentAmount"
          :type="loanType"
          :size="72"
          :weight="600"
        />

        <view class="summary-rows">
          <view class="summary-row">
            <text class="summary-row-label">{{ totalLabel }}</text>
            <MoneyText :cents="totalAmount" :type="loanType" :size="26" />
          </view>
          <view class="summary-row">
            <text class="summary-row-label">{{ backLabel }}</text>
            <MoneyText :cents="backAmount" :type="backType" :size="26" />
          </view>
          <view class="summary-row">
            <text class="summary-row-label">累计笔数</text>
            <text class="summary-row-value">{{ totalCount }} 笔</text>
          </view>
        </view>
      </view>

      <!--
        Tab 切换流水范围

        ★ 三个 tab 的口径 ★
          借出：全部流水 / 借出 / 借款收回
          借入：全部流水 / 借入 / 借款归还

        ★ 「全部流水」不显示「全部 ›」★
          用户明确要求。理由也成立：
          「全部流水」这个 tab 本身已经是全部了，
          再给一个「全部 ›」跳到交易列表是语义重复，
          而另外两个 tab 的「全部 ›」才有意义（进交易列表时带上分类筛选）。
      -->
      <view class="loan-tabs">
        <view
          v-for="t in tabs"
          :key="t.key"
          class="loan-tab"
          :class="{ active: activeTab === t.key }"
          @click="switchTab(t.key)"
        >
          <text
            class="loan-tab-text"
            :style="{ color: activeTab === t.key ? primaryColor : 'var(--app-text-2)' }"
          >{{ t.name }}</text>
          <view
            v-if="activeTab === t.key"
            class="loan-tab-indicator"
            :style="{ backgroundColor: primaryColor }"
          />
        </view>
      </view>

      <!-- 空态：这个 tab 下没有任何记录 -->
      <view v-if="isEmpty && !loading" class="empty-wrap">
        <EmptyState
          :emoji="headEmoji"
          :title="emptyText"
          :desc="emptyDesc"
          :action-text="emptyActionText"
          @action="onEmptyAction"
        />
      </view>

      <!-- 流水列表：按日期分组 -->
      <RecentTxnList
        v-else
        :txns="txnList"
        :loading="loading"
        :empty-text="emptyText"
        title="流水"
        :show-more="showListMore"
        @more="goAllTxn"
      />

      <view class="bottom-space" />
    </scroll-view>

    <!-- 记账面板：预填类型 + 对应分类，省得用户再选一遍 -->
    <TxnPanel v-model="showPanel" :preset="panelPreset" @saved="onSaved" />

    <!-- 全局弹窗宿主 -->
    <AppDialog />

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
/**
 * 借入 / 借出管理
 *
 *   onLoad 读 ?type=expense（借出）| income（借入），默认 expense。
 *   两个方向共用这一个页面，只是分类、文案、金额方向不同。
 *
 * ★ 一笔借出涉及两个分类（v15 起）★
 *   借出      expense  钱从我账户出去
 *   借款收回  income   钱回到我账户
 *   借入      income   钱进我账户
 *   借款归还  expense  钱从我账户出去
 *   这四个分类都挂在「系统预置分类」下，由 ensureLoanCategories() 保证存在。
 *
 * ★ 当前借出 / 当前借入 = 正 - 反 ★
 *   借出：借出合计 - 借款收回合计
 *   借入：借入合计 - 借款归还合计
 *   不会出现负数。
 *
 * ★ 结构与其它详情页一致 ★
 *   .app-page → PageNav → scroll-view.page-scroll → 汇总卡 + tab + 列表，
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
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { ensureLoanCategories, listCategories } from '@/api/category.js'
import { listTransactions, sumTransactions } from '@/api/transaction.js'
import { handleBackPress } from '@/utils/layerStack.js'

/** 收入方向的图标底色（真实 hex，用来拼 `+ '22'` 半透明） */
const INCOME_COLOR = '#07C160'

export default {
  components: { PageNav, MoneyText, EmptyState, RecentTxnList, TxnPanel, AppDialog, UpdateDialog },
  setup() {
    const settingStore = useSettingStore()

    /** 一笔都没有时的统计占位（放在 setup 内，脚本的作用域检查才扫得到） */
    function emptyStats() {
      return { count: 0, expense: 0, income: 0, transfer: 0 }
    }

    /** 'expense' = 借出管理，'income' = 借入管理 */
    const loanType = ref('expense')

    /**
     * 四个分类的 id（找到后缓存，重新加载不用再查）
     *   lendOutId    借出（expense）
     *   lendBackId   借款收回（income）
     *   borrowInId   借入（income）
     *   borrowBackId 借款归还（expense）
     */
    const catIds = ref({
      lendOutId: '', lendBackId: '', borrowInId: '', borrowBackId: ''
    })

    const txnList = ref([])
    /** 主方向合计（借出 / 借入）—— 全部时间 */
    const mainStats = ref(emptyStats())
    /** 反向合计（借款收回 / 借款归还）—— 全部时间 */
    const backStats = ref(emptyStats())
    const loading = ref(true)

    /**
     * 当前 tab
     *   'all'   全部流水（主 + 反向，按时间倒序）
     *   'main'  只看主方向（借出 / 借入）
     *   'back'  只看反向（借款收回 / 借款归还）
     */
    const activeTab = ref('all')

    const showPanel = ref(false)
    /** 首屏加载完成后，onShow 才需要再刷一次（避免和 onLoad 重复加载） */
    let ready = false

    const pageStyle = computed(() => settingStore.cssVars)
    const primaryColor = computed(() => settingStore.primaryColor)

    const isIncome = computed(() => loanType.value === 'income')

    const pageTitle = computed(() => (isIncome.value ? '借入管理' : '借出管理'))
    const headEmoji = computed(() => (isIncome.value ? '📥' : '📤'))

    /** 大数字的标题：当前借出 / 当前借入 */
    const currentLabel = computed(() => (isIncome.value ? '当前借入' : '当前借出'))
    /** 副标题说明这个数字是什么 */
    const directionText = computed(() =>
      isIncome.value ? '还欠别人多少' : '还有多少没收回来'
    )
    /** 主方向累计的文案：累计借出 / 累计借入 */
    const totalLabel = computed(() => (isIncome.value ? '累计借入' : '累计借出'))
    /** 反向累计的文案：借款收回 / 借款归还 */
    const backLabel = computed(() => (isIncome.value ? '借款归还' : '借款收回'))

    /**
     * 汇总卡图标底色。
     *
     * ★ 必须是真实 hex，不能是 var(--app-xxx) ★
     *   下面是 `accentColor + '22'` 拼出来的半透明底色，
     *   拼在 CSS 变量上会得到 `var(--app-success)22` 这种非法值，
     *   背景直接不生效（图标底色消失）。所以收入方向用固定绿值。
     */
    const accentColor = computed(() => (isIncome.value ? INCOME_COLOR : primaryColor.value))

    /** 主方向 id / 反向 id（当前页面视角） */
    const mainCatId = computed(() =>
      isIncome.value ? catIds.value.borrowInId : catIds.value.lendOutId
    )
    const backCatId = computed(() =>
      isIncome.value ? catIds.value.borrowBackId : catIds.value.lendBackId
    )
    /** 反向交易的 type：借款收回是 income，借款归还是 expense */
    const backType = computed(() => (isIncome.value ? 'expense' : 'income'))

    /** 累计借出 / 累计借入（主方向合计） */
    const totalAmount = computed(() =>
      isIncome.value ? mainStats.value.income : mainStats.value.expense
    )
    /** 借款收回 / 借款归还（反向合计） */
    const backAmount = computed(() =>
      isIncome.value ? backStats.value.expense : backStats.value.income
    )
    /** 累计笔数：主 + 反向 */
    const totalCount = computed(() => mainStats.value.count + backStats.value.count)

    /**
     * 当前借出 / 当前借入
     *
     * ★ 为什么用 Math.max(0, …) ★
     *   如果用户多记了一笔收回（收回 > 借出），
     *   差额会变成负数 —— 界面显示「-200」没有意义
     *   （不是「他欠我 -200」，而是数据可能记重了）。
     *   按 0 显示更诚实。
     */
    const currentAmount = computed(() => {
      const diff = totalAmount.value - backAmount.value
      return diff > 0 ? diff : 0
    })

    /** 三个 tab */
    const tabs = computed(() => [
      { key: 'all', name: '全部流水' },
      { key: 'main', name: isIncome.value ? '借入' : '借出' },
      { key: 'back', name: isIncome.value ? '借款归还' : '借款收回' }
    ])

    /** 一条记录都没有 */
    const isEmpty = computed(() =>
      txnList.value.length === 0 && totalCount.value === 0
    )

    /** 空态文案随 tab 变化 */
    const emptyText = computed(() => {
      if (activeTab.value === 'back') return `还没有${backLabel.value}记录`
      if (activeTab.value === 'main') {
        return isIncome.value ? '还没有借入记录' : '还没有借出记录'
      }
      return isIncome.value ? '还没有借入记录' : '还没有借出记录'
    })
    const emptyDesc = computed(() => {
      if (activeTab.value === 'back') {
        return isIncome.value ? '还钱给别人记在这里' : '借出去的钱收回来记在这里'
      }
      return isIncome.value ? '向别人借来的钱记在这里' : '借给别人的钱记在这里'
    })

    /** 空态按钮文案：在反向 tab 上要引导记反向的那一笔 */
    const emptyActionText = computed(() =>
      activeTab.value === 'back' ? `记一笔${backLabel.value}` : '记一笔'
    )

    /** 顶部「+ …」的文案 */
    const navAddText = computed(() =>
      activeTab.value === 'back' ? `+ ${backLabel.value}` : '+ 记一笔'
    )

    /**
     * 列表右上角「全部 ›」是否显示
     *
     * ★ 「全部流水」tab 不显示 ★
     *   用户明确要求：这个 tab 本身就是全部了，
     *   再给一个「全部 ›」跳去交易列表是语义重复。
     *   另外两个 tab 显示它 —— 那里点「全部」= 看该分类的全部流水，有意义。
     */
    const showListMore = computed(() => activeTab.value !== 'all')

    /**
     * 记账面板的预填
     *
     * tab 决定预填哪个分类：
     *   全部流水 / 主方向 -> 主方向分类（借出 / 借入）
     *   反向 tab          -> 反向分类（借款收回 / 借款归还）
     */
    const panelPreset = computed(() => {
      if (activeTab.value === 'back') {
        return { type: backType.value, category_id: backCatId.value }
      }
      return { type: loanType.value, category_id: mainCatId.value }
    })

    /**
     * 拿到四个分类的 id。
     *
     * 首选 ensureLoanCategories()（幂等，不存在会自动建），
     * 失败时退回按名字在分类表里找，页面不至于整块空掉。
     */
    async function resolveCategoryIds() {
      if (catIds.value.lendOutId && catIds.value.lendBackId &&
          catIds.value.borrowInId && catIds.value.borrowBackId) {
        return catIds.value
      }

      try {
        const ids = await ensureLoanCategories()
        catIds.value = {
          lendOutId: ids.lendOutId || ids.expenseId || '',
          lendBackId: ids.lendBackId || '',
          borrowInId: ids.borrowInId || ids.incomeId || '',
          borrowBackId: ids.borrowBackId || ''
        }
        if (catIds.value.lendOutId && catIds.value.borrowInId) return catIds.value
      } catch (e) {
        console.warn('[loan] ensureLoanCategories 失败，改为按名称查找:', e && e.message)
      }

      // 兜底：按名字在分类表里找（不区分层级，直接按 type 查）
      const [expenseList, incomeList] = await Promise.all([
        listCategories('expense'),
        listCategories('income')
      ])
      const find = (list, name) => {
        const hit = list.find((c) => c.name === name)
        return hit ? hit.id : ''
      }
      catIds.value = {
        lendOutId: find(expenseList, '借出'),
        lendBackId: find(incomeList, '借款收回'),
        borrowInId: find(incomeList, '借入'),
        borrowBackId: find(expenseList, '借款归还')
      }
      return catIds.value
    }

    /**
     * 按当前 tab 拉流水
     *
     * ★ 三个 tab 各自查一次，而不是查全部再前端过滤 ★
     *   过滤放在 SQL 里，列表的 limit 才有意义
     *   （前端过滤会让「只要 10 条」变成「查 10 条再筛掉一半」，
     *    列表可能只剩 3 条，看起来像丢数据）。
     */
    async function loadList() {
      const ids = catIds.value
      const main = ids[isIncome.value ? 'borrowInId' : 'lendOutId']
      const back = ids[isIncome.value ? 'borrowBackId' : 'lendBackId']

      if (activeTab.value === 'main') {
        if (!main) return []
        return listTransactions({ categoryId: main, limit: 10 })
      }
      if (activeTab.value === 'back') {
        if (!back) return []
        return listTransactions({ categoryId: back, limit: 10 })
      }

      // 全部流水：主 + 反向各取一批，按时间倒序合并，再截前 10
      const tasks = []
      if (main) tasks.push(listTransactions({ categoryId: main, limit: 10 }))
      if (back) tasks.push(listTransactions({ categoryId: back, limit: 10 }))
      if (tasks.length === 0) return []

      const results = await Promise.all(tasks)
      const merged = []
      for (const list of results) {
        for (const t of list) merged.push(t)
      }
      merged.sort((a, b) => {
        // 与 listTransactions 的 ORDER BY 一致：occurred_at DESC, created_at DESC
        if (b.occurred_at !== a.occurred_at) return b.occurred_at - a.occurred_at
        return (b.created_at || 0) - (a.created_at || 0)
      })
      return merged.slice(0, 10)
    }

    async function load() {
      loading.value = true
      try {
        await resolveCategoryIds()
        const ids = catIds.value
        const main = ids[isIncome.value ? 'borrowInId' : 'lendOutId']
        const back = ids[isIncome.value ? 'borrowBackId' : 'lendBackId']

        // 分类都没找到（极端情况）：清空，交给空态兜住
        if (!main && !back) {
          txnList.value = []
          mainStats.value = emptyStats()
          backStats.value = emptyStats()
          return
        }

        const [list, mainSum, backSum] = await Promise.all([
          loadList(),
          main ? sumTransactions({ categoryId: main }) : Promise.resolve(emptyStats()),
          back ? sumTransactions({ categoryId: back }) : Promise.resolve(emptyStats())
        ])

        txnList.value = list
        mainStats.value = mainSum
        backStats.value = backSum
      } catch (e) {
        console.warn('[loan] 加载借入借出失败:', e && e.message)
        txnList.value = []
        mainStats.value = emptyStats()
        backStats.value = emptyStats()
      } finally {
        loading.value = false
      }
    }

    /** 切 tab：只重拉列表，汇总不变（汇总是全部时间口径） */
    async function switchTab(key) {
      if (activeTab.value === key) return
      activeTab.value = key
      loading.value = true
      try {
        txnList.value = await loadList()
      } catch (e) {
        txnList.value = []
      } finally {
        loading.value = false
      }
    }

    /** 右上角「+ 记一笔」/「+ 借款收回」：打开记账面板 */
    function onNavAdd() {
      showPanel.value = true
    }

    /** 空态里的「记一笔」：同上 */
    function onEmptyAction() {
      showPanel.value = true
    }

    /** 面板保存后重新拉列表与汇总 */
    function onSaved() {
      load()
    }

    /**
     * 「全部 ›」→ 交易列表
     *
     * ★ 「全部流水」tab 不走这里 ★
     *   那个 tab 不显示「全部 ›」（见 showListMore 的注释）。
     *   另外两个 tab 按当前 tab 的分类带筛选条件过去。
     */
    function goAllTxn() {
      const catId = activeTab.value === 'back' ? backCatId.value : mainCatId.value
      if (!catId) return
      uni.navigateTo({ url: `/pages/txn/list?categoryId=${catId}` })
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
      settingStore, loanType, catIds, txnList, mainStats, backStats, loading,
      activeTab, showPanel, pageStyle, primaryColor, isIncome,
      pageTitle, headEmoji, currentLabel, directionText, totalLabel, backLabel,
      accentColor, backType, totalAmount, backAmount, totalCount, currentAmount,
      tabs, isEmpty, emptyText, emptyDesc, emptyActionText, navAddText,
      showListMore, panelPreset,
      switchTab, onNavAdd, onEmptyAction, onSaved, goAllTxn, goBack
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

/* ------------------------------------------------------- Tab 切换 */

/*
 * 三个 tab：全部流水 / 借出（借入） / 借款收回（借款归还）
 *
 * ★ 视觉对齐「分类管理」页的 type-bar ★
 *   同一个 App 里两处 tab 长得不一样会显得零散，
 *   这里沿用文字 + 底部短横线的写法。
 */
.loan-tabs {
  display: flex;
  gap: 40rpx;
  padding: 28rpx 8rpx 12rpx;
}

.loan-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  padding-bottom: 10rpx;
}

.loan-tab-text {
  font-size: 28rpx;
  font-weight: 500;
}

.loan-tab-indicator {
  position: absolute;
  bottom: 0;
  width: 32rpx;
  height: 4rpx;
  border-radius: 2rpx;
}

/* 空态 */
.empty-wrap {
  background-color: var(--app-card);
  border-radius: 20rpx;
  margin-top: 16rpx;
}
</style>
