<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <!-- 首次使用引导 -->
    <block v-if="settingStore.loaded && !hasAccounts">
      <AppHeader />
      <view class="guide-area">
        <EmptyState
          emoji="👋"
          title="欢迎使用自由记"
          desc="先添加一个账户，才能开始记账"
          action-text="添加账户"
          @action="goAddAccount"
        />
      </view>
    </block>

    <block v-else>
      <AppHeader @avatar-click="goProfile">
        <template #right>
          <HeaderAction @action-click="goAiChat">AI 助手</HeaderAction>
        </template>
      </AppHeader>

      <scroll-view
        class="page-scroll"
        scroll-y
      >
        <!-- ② 本月概览 -->
        <view class="overview-card">
          <!-- 右上角：月份切换（概览和月历联动） -->
          <view class="ov-month-nav">
            <text class="ov-month-title">{{ calendarTitle }}</text>
            <view class="ov-month-btns">
              <text class="ov-month-btn" @click="shiftCalMonth(-1)">‹</text>
              <text class="ov-month-btn" @click="shiftCalMonth(1)">›</text>
            </view>
          </view>

          <!-- 上方：并联显示本月支出 / 本月收入 -->
          <view class="ov-top">
            <view class="ov-top-item">
              <text class="ov-top-label">本月支出</text>
              <view class="ov-top-amount">
                <text class="ov-top-sign">-</text>
                <MoneyText
                  :cents="overview.monthExpense"
                  :size="44"
                  :weight="600"
                  color="var(--app-text)"
                />
              </view>
            </view>
            <view class="ov-top-divider" />
            <view class="ov-top-item">
              <text class="ov-top-label">本月收入</text>
              <view class="ov-top-amount">
                <text class="ov-top-sign">+</text>
                <MoneyText
                  :cents="overview.monthIncome"
                  :size="44"
                  :weight="600"
                  color="var(--app-text)"
                />
              </view>
            </view>
          </view>

          <!-- 中间：今日支出 / 今日收入 / 本月结余 -->
          <view class="ov-split">
            <view class="ov-item">
              <text class="ov-item-label">今日支出</text>
              <MoneyText :cents="overview.todayExpense" :size="30" :weight="500" color="var(--app-text)" />
            </view>
            <view class="ov-divider" />
            <view class="ov-item">
              <text class="ov-item-label">今日收入</text>
              <MoneyText :cents="overview.todayIncome" :size="30" :weight="500" color="var(--app-text)" />
            </view>
            <view class="ov-divider" />
            <view class="ov-item">
              <text class="ov-item-label">本月结余</text>
              <MoneyText
                :cents="overview.monthBalance"
                :size="30"
                :weight="500"
                :color="overview.monthBalance >= 0 ? 'var(--app-text)' : 'var(--app-danger)'"
              />
            </view>
          </view>

          <!-- 下方：预算进度条（总预算 + 分类预算） -->
          <view
            v-if="totalBudget || categoryBudgets.length > 0"
            class="ov-budgets"
            @click="goBudget"
          >
            <view class="ov-budget">
              <view class="ov-budget-head">
                <text class="ov-budget-name">总预算</text>
                <text class="ov-budget-daily" :style="{ color: totalBudget.over ? 'var(--app-danger)' : 'var(--app-text-3)' }">
                  日均可用 ¥{{ (totalBudget.dailyAvailable / 100).toFixed(0) }}
                </text>
              </view>
              <view class="ov-budget-bar">
                <view
                  class="ov-budget-fill"
                  :style="{
                    width: Math.min(totalBudget.percent, 100) + '%',
                    backgroundColor: totalBudget.over ? 'var(--app-danger)' : primaryColor
                  }"
                />
              </view>
              <view class="ov-budget-foot">
                <text class="ov-budget-pct" :style="{ color: totalBudget.over ? 'var(--app-danger)' : primaryColor }">
                  {{ totalBudget.percent }}%
                </text>
                <view class="ov-budget-amount">
                  <MoneyText :cents="totalBudget.used" :size="20" color="var(--app-text-3)" />
                  <text class="ov-budget-slash">/</text>
                  <MoneyText :cents="totalBudget.limit" :size="20" color="var(--app-text-3)" />
                </view>
              </view>
            </view>

            <view v-for="b in categoryBudgets" :key="b.id" class="ov-budget">
              <view class="ov-budget-head">
                <text class="ov-budget-name">{{ b.name }}</text>
                <text class="ov-budget-daily" :style="{ color: b.over ? 'var(--app-danger)' : 'var(--app-text-3)' }">
                  日均可用 ¥{{ (b.dailyAvailable / 100).toFixed(0) }}
                </text>
              </view>
              <view class="ov-budget-bar">
                <view
                  class="ov-budget-fill"
                  :style="{
                    width: Math.min(b.percent, 100) + '%',
                    backgroundColor: b.over ? 'var(--app-danger)' : primaryColor
                  }"
                />
              </view>
              <view class="ov-budget-foot">
                <text class="ov-budget-pct" :style="{ color: b.over ? 'var(--app-danger)' : primaryColor }">
                  {{ b.percent }}%
                </text>
                <view class="ov-budget-amount">
                  <MoneyText :cents="b.used" :size="20" color="var(--app-text-3)" />
                  <text class="ov-budget-slash">/</text>
                  <MoneyText :cents="b.limit" :size="20" color="var(--app-text-3)" />
                </view>
              </view>
            </view>
          </view>
        </view>

        <!-- ③ 最近收支 -->
        <view class="section">
          <view class="section-head">
            <text class="section-title">最近收支</text>
            <text class="section-more" @click="goAllTxn">查看全部 ›</text>
          </view>

          <!-- 空状态：但解析中时不要显示，否则占位行和空状态打架 -->
          <view
            v-if="recentGroups.length === 0 && !parsing"
            class="section-empty"
          >
            <EmptyState emoji="📝" title="还没有记账" desc="点击右下角 + 记一笔" compact />
          </view>

          <view v-else class="txn-list">
            <!-- 正在解析的占位行：让用户立刻看到"已提交，在处理" -->
            <view v-if="parsing" class="txn-item parsing-item">
              <view class="txn-icon parsing-icon" :style="{ backgroundColor: primaryColor + '22' }">
                <view class="parsing-dot" :style="{ backgroundColor: primaryColor }" />
              </view>
              <view class="txn-info">
                <text class="txn-name parsing-name">{{ parsingText || '正在解析…' }}</text>
                <text class="txn-sub">AI 正在识别时间、分类和金额</text>
              </view>
              <view class="txn-amount">
                <view class="parsing-bars">
                  <view class="pbar" :style="{ backgroundColor: primaryColor }" />
                  <view class="pbar" :style="{ backgroundColor: primaryColor }" />
                  <view class="pbar" :style="{ backgroundColor: primaryColor }" />
                </view>
              </view>
            </view>

            <!-- 按日期分组的最近 5 条 -->
            <block v-for="group in recentGroups" :key="group.day">
              <view class="recent-day-head">
                <text class="recent-day-title">{{ group.title }}</text>
                <text class="recent-day-sum">
                  <text v-if="group.expense > 0" class="recent-day-exp">支出 {{ (group.expense / 100).toFixed(2) }}</text>
                  <text v-if="group.income > 0" class="recent-day-inc">收入 {{ (group.income / 100).toFixed(2) }}</text>
                </text>
              </view>

              <view
                v-for="txn in group.list"
                :key="txn.id"
                class="txn-item"
                @click="goTxnDetail(txn.id)"
              >
              <view
                class="txn-icon"
                :style="{ backgroundColor: (txn.category_color || '#969799') + '22' }"
              >
                <text
                  class="txn-icon-text"
                  :style="{ color: txn.category_color || '#969799' }"
                >{{ iconChar(txn) }}</text>
              </view>

              <view class="txn-info">
                <view class="txn-name-row">
                  <text class="txn-name ellipsis">{{ txnTitle(txn) }}</text>
                  <!-- 周期记账标记：周期产生的流水打上「周期」徽标 -->
                  <text v-if="txn.cycle_id" class="txn-cycle-tag">周期</text>
                  <!-- 标签：跟在分类名后面的小胶囊（名字 + 自己的颜色做浅底） -->
                  <view v-if="txnTags(txn).length" class="txn-tag-list">
                    <text
                      v-for="t in txnTags(txn)"
                      :key="t.key"
                      class="txn-tag"
                      :style="t.bg ? { backgroundColor: t.bg, color: t.color } : null"
                    >{{ t.name }}</text>
                  </view>
                </view>
                <text class="txn-sub ellipsis">{{ txnSub(txn) }}</text>
              </view>

              <view class="txn-amount">
                <MoneyText
                  :cents="txn.amount_cents"
                  :type="txn.type"
                  :size="30"
                  :weight="500"
                  :color="txn.type === 'expense' ? 'var(--app-text)' : (txn.type === 'income' ? 'var(--app-success)' : 'var(--app-text-2)')"
                />
              </view>
              </view>
            </block>
          </view>
        </view>

        <!-- ④ 月历 -->
        <view class="section">
          <view class="section-head">
            <text class="section-title">月历</text>
          </view>
          <CalendarGrid
            :month-key="txnStore.currentMonth"
            :day-data="txnStore.dailyTotals"
            :selected-day="selectedDay"
            @day-click="onDayClick"
          />
        </view>

        <view class="tabbar-space" />
      </scroll-view>



      <!-- ⑦ 圆角悬浮底栏：4 个 tab + 右下角记账按钮
           ★ hidden 让它在全屏弹层打开时一起收起 ★
             记账面板 / 速记输入条是整屏弹层，底栏留在遮罩边缘会露一角，
             很难看，所以这两个场景把它藏起来（用户明确要求）。
             滚动时仍然永驻，不受影响。 -->
      <AppTabBar
        current="home"
        :hidden="showQuickAdd || showPanel"
        :hold-enabled="settingStore.quickAddHoldAction !== 'none'"
        @single-press="onFabTap"
        @hold-start="onHoldStart"
        @hold-end="onFabHoldEnd"
        @hold-cancel="onHoldCancel"
      />

      <!-- AI 智能记账输入条（替代原速记层） -->
      <QuickAddBar
        v-model="showQuickAdd"
        @saved="onSaved"
        @parsing-start="onParsingStart"
        @parsing-end="onParsingEnd"
      />

      <!-- 记账面板（长按或展开时打开） -->
      <TxnPanel v-model="showPanel" :preset="panelPreset" @saved="onSaved" />
    </block>
  </view>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppHeader from '@/components/AppHeader.vue'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppTabBar from '@/components/AppTabBar.vue'
import TxnPanel from '@/components/TxnPanel.vue'
import QuickAddBar from '@/components/QuickAddBar.vue'
import CalendarGrid from '@/components/CalendarGrid.vue'
import HeaderAction from '@/components/HeaderAction.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { useUiStore } from '@/stores/ui.js'
import { getBudgetUsage } from '@/api/stats.js'
import { listTags } from '@/api/tag.js'
import { toMonthKey, shiftMonth, formatDayHeader, relativeDayLabel } from '@/utils/date.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'

export default {
  components: { AppHeader, MoneyText, EmptyState, AppTabBar, TxnPanel, QuickAddBar, CalendarGrid, HeaderAction },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()
    const txnStore = useTransactionStore()
    const uiStore = useUiStore()

    const showPanel = ref(false)
    const showQuickAdd = ref(false)

    /** 正在 AI 解析中：在最近交易顶部插入一条占位行 */
    const parsing = ref(false)
    const parsingText = ref('')
    const panelPreset = ref(null)
    const selectedDay = ref('')

    /** 预算列表（总预算 + 各分类预算） */
    const budgets = ref([])

    /** 标签表（最近收支行里显示标签胶囊，按 tag_ids 反查名字/颜色） */
    const tags = ref([])

    /**
     * 本月是否有任何交易记录。
     *
     * ★ 曾经用于「滑到底部隐藏悬浮按钮」的豁免判断 ★
     *   按钮现在永驻在底栏里，不再随滚动隐藏，
     *   这条判断暂时没人用了；保留它是因为
     *   「本月无数据」这个语义别处可能还要用（如空态文案），
     *   删掉容易在下次需要时重复实现。
     */
    const isMonthEmpty = computed(() => {
      const daily = txnStore.dailyTotals || {}
      return Object.keys(daily).length === 0
    })

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    const hasAccounts = computed(() => accountStore.hasAccounts)

    const overview = computed(() => txnStore.overview)

    /** 总预算（scope=total） */
    const totalBudget = computed(
      () => budgets.value.find((b) => b.scope === 'total') || null
    )

    /** 分类预算（没有则为空数组，概览卡里不显示） */
    const categoryBudgets = computed(
      () => budgets.value.filter((b) => b.scope === 'category')
    )

    /** 预算剩余：优先用总预算，没有总预算就用分类预算合计 */
    const budgetRemaining = computed(() => {
      if (totalBudget.value) return totalBudget.value.remaining
      if (categoryBudgets.value.length > 0) {
        return categoryBudgets.value.reduce((acc, b) => acc + b.remaining, 0)
      }
      return 0
    })

    /**
     * 最近收支：近 5 条，按日期分组。
     * 数据源统一走 txnStore.recentList（最近 5 笔），
     * 不再优先显示今天的 —— 「最近收支」顾名思义就是最近的 5 条。
     */
    const recentGroups = computed(() => {
      const list = txnStore.recentList || []
      const groups = []
      for (const txn of list) {
        let g = groups.find((x) => x.day === txn.occurred_day)
        if (!g) {
          g = {
            day: txn.occurred_day,
            title: formatDayHeader(txn.occurred_day),
            list: [],
            expense: 0,
            income: 0
          }
          groups.push(g)
        }
        g.list.push(txn)
        if (txn.type === 'expense') g.expense += txn.amount_cents
        if (txn.type === 'income') g.income += txn.amount_cents
      }
      return groups
    })

    const monthLabel = computed(() => {
      const [, m] = txnStore.currentMonth.split('-')
      return `${Number(m)}月`
    })

    const calendarTitle = computed(() => {
      const [y, m] = txnStore.currentMonth.split('-')
      return `${y}年${Number(m)}月`
    })

    /* ------------------------------------------------------ 滚动监听 */

    /*
     * ★ 这里删掉了原来「滑到底部隐藏悬浮按钮」的整套逻辑 ★
     *   （fabHidden / scrollViewHeight / measureScrollView / onScroll）
     *   记账按钮改成永驻在底栏右端，不再随滚动隐藏，
     *   滚动监听没有别的用途，留着只会白跑计算。
     */

    /* ------------------------------------------------------ 数据加载 */

    async function loadAll(force = false) {
      await accountStore.load(force)
      if (!accountStore.hasAccounts) return

      await txnStore.loadHome(force)

      // 标签（最近收支行的标签胶囊用）
      try {
        tags.value = await listTags()
      } catch (e) {
        tags.value = []
      }

      // 预算
      try {
        budgets.value = await getBudgetUsage(txnStore.currentMonth)
      } catch (e) {
        budgets.value = []
      }
    }

    /* ------------------------------------------------------ 月历 */

    function shiftCalMonth(delta) {
      const next = shiftMonth(txnStore.currentMonth, delta)
      txnStore.loadMonth(next).then(({ daily }) => {
        txnStore.dailyTotals = daily
      })
      // 同步预算
      getBudgetUsage(next).then((list) => {
        budgets.value = list
      }).catch(() => {})
    }

    /** 点击月历某一天 → 跳到「全部交易」页并定位到当天 */
    function onDayClick(dayKey) {
      selectedDay.value = dayKey
      uni.navigateTo({ url: `/pages/txn/list?day=${dayKey}` })
    }

    /* ------------------------------------------------------ 交互 */

    /**
     * 打开某种记账入口
     * @param {string} act ai | manual
     */
    function openQuickAddFor(act) {
      if (act === 'ai') {
        showQuickAdd.value = true
        return
      }
      if (act === 'manual') {
        panelPreset.value = null
        showPanel.value = true
      }
      // none：什么都不做
    }

    /**
     * 短按 + 号
     * 触发什么由「设置 → 记账按钮设置」决定（默认 AI 速记）
     */
    function onFabTap() {
      openQuickAddFor(settingStore.quickAddTapAction)
    }

    /**
     * 长按 + 号
     * 触发什么由「设置 → 记账按钮设置」决定（默认手动记账）
     */
    function onFabHoldEnd() {
      openQuickAddFor(settingStore.quickAddHoldAction)
    }

    /** 长按开始（触觉反馈在 AppTabBar 内，这里只占位） */
    function onHoldStart() {}

    function onHoldCancel() {}

    /**
     * QuickAddBar 开始请求 AI 时触发。
     * 在最近交易顶部插入「正在解析」占位行，让用户立刻看到反馈，
     * 而不是盯着一个没反应的输入框等几秒。
     */
    function onParsingStart(payload) {
      parsingText.value = (payload && payload.text) || ''
      parsing.value = true
    }

    function onParsingEnd() {
      parsing.value = false
      parsingText.value = ''
    }

    function onSaved() {
      parsing.value = false
      parsingText.value = ''
      loadAll(true)
    }

    /* ------------------------------------------------------ 展示辅助 */

    function iconChar(txn) {
      if (txn.type === 'transfer') return '⇄'
      // 优先用分类自带的 icon 键，没有就按名称猜
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

    /**
     * 标签 id -> { name, color } 映射（和全部交易页同一套做法）
     * 交易里只存 tag_ids，要显示名字/颜色得靠标签表反查。
     */
    const tagNameMap = computed(() => {
      const m = {}
      for (const t of tags.value) m[t.id] = { name: t.name, color: t.color || '' }
      return m
    })

    /**
     * 这笔交易的标签胶囊（名字 + 用自己的颜色做浅底），最多显示 2 个 +「+N」。
     * 与 pages/txn/list.vue 的 txnTags 保持一致。
     */
    function txnTags(txn) {
      const ids = txn.tag_ids
      if (!ids || !ids.length) return []
      const list = []
      for (const id of ids) {
        const t = tagNameMap.value[id]
        if (!t) continue
        list.push({
          key: id,
          name: t.name,
          color: t.color || 'var(--app-text-2)',
          bg: t.color ? t.color + '22' : ''
        })
      }
      if (list.length <= 2) return list
      const rest = list.slice(0, 2)
      rest.push({ key: '__more__', name: `+${list.length - 2}`, color: 'var(--app-text-3)', bg: '' })
      return rest
    }

    /* ------------------------------------------------------ 路由 */

    function goAddAccount() {
      uni.navigateTo({ url: '/pages/account/edit' })
    }

    function goProfile() {
    uni.navigateTo({ url: '/pages/settings/profile' })
  }

    function goAllTxn() {
      uni.navigateTo({ url: '/pages/txn/list' })
    }

    function goTxnDetail(id) {
      uni.navigateTo({ url: `/pages/txn/detail?id=${id}` })
    }

    function goBudget() {
      uni.navigateTo({ url: '/pages/settings/budget' })
    }

    function goAiChat() {
      uni.navigateTo({ url: '/pages/ai/chat' })
    }

    /* ------------------------------------------------------ 生命周期 */

    onMounted(() => {
      if (!settingStore.loaded) {
        settingStore.load().then(() => loadAll())
      } else {
        loadAll()
      }
    })

    onShow(() => {
      // 每次回到首页刷新，保证记账后数据即时可见
      if (settingStore.loaded) {
        loadAll(true)
      }
      settingStore.syncSystemTheme()
      // 隐藏原生 tabBar（自绘底栏已经在显示，见 AppTabBar）
      settingStore.refreshTabBar()
      // 在别的 tab 页点了记账按钮 → 这里补上打开动作
      const pending = uiStore.consumePendingAdd()
      if (pending) openQuickAddFor(pending)
    })

    return {
      settingStore, accountStore, txnStore,
      showPanel, panelPreset,
      selectedDay, showQuickAdd, parsing, parsingText,
      primaryColor, pageStyle, hasAccounts, overview, calendarTitle,
      totalBudget, categoryBudgets, budgetRemaining, recentGroups,
      shiftCalMonth, onDayClick,
      openQuickAddFor, onFabTap, onFabHoldEnd, onHoldStart, onHoldCancel,
      onParsingStart, onParsingEnd, onSaved,
      iconChar, txnTitle, txnSub, txnTags,
      goAddAccount, goProfile, goAllTxn, goTxnDetail, goBudget, goAiChat
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

/* AI 助手按钮已抽成 components/HeaderAction.vue，
   首页 / 统计页 / 账户页 / 我的页 共用同一套样式 */

.guide-area {
  padding-top: 120rpx;
}

/* 概览卡：与账户页总资产卡同款渐变底色 */
.overview-card {
  background: linear-gradient(135deg, var(--app-primary-light), var(--app-card));
  border-radius: 24rpx;
  padding: 32rpx 32rpx 28rpx;
  margin-top: 8rpx;
  box-shadow: var(--app-shadow);
}

/* 右上角月份切换 */
.ov-month-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

.ov-month-title {
  font-size: 26rpx;
  color: var(--app-text-2);
  font-weight: 500;
}

.ov-month-btns {
  display: flex;
  gap: 10rpx;
}

.ov-month-btn {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background-color: var(--app-card);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  color: var(--app-text-2);
}

/* 上方并联：本月支出 / 本月收入
   整组相对卡片居中，而不是各自撑满一半 */
.ov-top {
  display: flex;
  align-items: center;
  justify-content: center;
  padding-bottom: 24rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.ov-top-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
  /* 不设 flex:1，宽度由内容决定，整组才能真正居中 */
  min-width: 180rpx;
}

.ov-top-label {
  font-size: 24rpx;
  color: var(--app-text-2);
}

/* 金额行：正负号 + 金额 */
.ov-top-amount {
  display: flex;
  align-items: baseline;
  gap: 2rpx;
}

.ov-top-sign {
  font-size: 40rpx;
  font-weight: 600;
  line-height: 1;
  color: var(--app-text-2);
}

.ov-top-divider {
  width: 1rpx;
  height: 52rpx;
  background-color: var(--app-line);
  margin: 0 40rpx;
}

/* 中间三个：今日支出 / 本月结余 / 预算剩余 */
.ov-split {
  display: flex;
  align-items: center;
  margin-top: 24rpx;
}

.ov-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
}

.ov-item-label {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.ov-divider {
  width: 1rpx;
  height: 48rpx;
  background-color: var(--app-line);
}

/* 下方预算进度条 */
.ov-budgets {
  margin-top: 24rpx;
  padding-top: 24rpx;
  border-top: 1rpx solid var(--app-line);
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.ov-budget {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.ov-budget-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* 左侧：名称 */
.ov-budget-name {
  font-size: 24rpx;
  color: var(--app-text-2);
}

/* 右侧：剩余日均预算 */
.ov-budget-daily {
  font-size: 21rpx;
  color: var(--app-text-3);
}

.ov-budget-pct {
  font-size: 22rpx;
  font-weight: 500;
}

.ov-budget-bar {
  height: 10rpx;
  background-color: var(--app-card-2);
  border-radius: 5rpx;
  overflow: hidden;
}

.ov-budget-fill {
  height: 100%;
  border-radius: 5rpx;
  transition: width 0.35s ease;
}

/* 进度条下方一行：左百分比，右金额 */
.ov-budget-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ov-budget-amount {
  display: flex;
  align-items: center;
  gap: 6rpx;
}

.ov-budget-slash {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* 最近收支的日期分组头 */
.recent-day-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 28rpx 8rpx;
  background-color: var(--app-card);
}

.recent-day-title {
  font-size: 24rpx;
  color: var(--app-text-2);
  font-weight: 500;
}

.recent-day-sum {
  display: flex;
  gap: 16rpx;
}

.recent-day-exp {
  font-size: 21rpx;
  color: var(--app-text-3);
}

.recent-day-inc {
  font-size: 21rpx;
  color: var(--app-success);
}

/* 区块 */
.section {
  margin-top: 32rpx;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
  padding: 0 4rpx;
}

.section-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
}

.section-more {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.section-empty {
  background-color: var(--app-card);
  border-radius: 20rpx;
}

/* 交易列表 */
.txn-list {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
}

.txn-item {
  display: flex;
  align-items: center;
  padding: 24rpx 28rpx;
  gap: 20rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.txn-item:last-child {
  border-bottom: none;
}

.txn-icon {
  width: 76rpx;
  height: 76rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.txn-icon-text {
  font-size: 30rpx;
  font-weight: 500;
}

.txn-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  min-width: 0;
}

.txn-name {
  font-size: 28rpx;
  color: var(--app-text);
  font-weight: 500;
}

/* 名称行：分类名 + 周期徽标 + 标签胶囊，一行横排 */
.txn-name-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
}

.txn-name.ellipsis {
  flex-shrink: 1;
  min-width: 0;
}

/* 周期记账标记：小徽标，主题色描边 + 浅底，和标签胶囊区分开 */
.txn-cycle-tag {
  flex-shrink: 0;
  font-size: 18rpx;
  line-height: 1;
  padding: 4rpx 10rpx;
  border-radius: 8rpx;
  color: var(--app-primary);
  background-color: var(--app-primary-light);
  border: 1rpx solid var(--app-primary);
  font-weight: 500;
}

/* 标签：跟在分类名后面的一排小胶囊（同全部交易页） */
.txn-tag-list {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 6rpx;
  flex-shrink: 0;
  max-width: 220rpx;
  overflow: hidden;
}

.txn-tag {
  flex-shrink: 0;
  font-size: 20rpx;
  line-height: 20rpx;
  color: var(--app-text-2);
  background-color: var(--app-card-2);
  border-radius: 6rpx;
  padding: 2rpx 8rpx;
}

.txn-sub {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.txn-amount {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
  flex-shrink: 0;
}

.txn-day {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* ============ 正在解析占位行 ============ */
.parsing-item {
  /* 轻微高亮，与真实记录区分 */
  background-color: var(--app-primary-light);
}

.parsing-icon {
  position: relative;
}

/* 呼吸中的圆点 */
.parsing-dot {
  width: 24rpx;
  height: 24rpx;
  border-radius: 50%;
  animation: parsing-pulse 1.1s ease-in-out infinite;
}

@keyframes parsing-pulse {
  0%, 100% {
    transform: scale(0.6);
    opacity: 0.45;
  }
  50% {
    transform: scale(1);
    opacity: 1;
  }
}

.parsing-name {
  /* 文字做微弱的明暗流动，暗示"处理中" */
  animation: parsing-fade 1.4s ease-in-out infinite;
}

@keyframes parsing-fade {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 1; }
}

/* 三根跳动的竖条 */
.parsing-bars {
  display: flex;
  align-items: flex-end;
  gap: 6rpx;
  height: 32rpx;
}

.pbar {
  width: 8rpx;
  border-radius: 4rpx;
  animation: parsing-bar 0.9s ease-in-out infinite;
}

.pbar:nth-child(1) {
  animation-delay: 0s;
}
.pbar:nth-child(2) {
  animation-delay: 0.15s;
}
.pbar:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes parsing-bar {
  0%, 100% { height: 10rpx; opacity: 0.45; }
  50%      { height: 30rpx; opacity: 1; }
}

/* 月历导航（已移到概览卡右上角，这里只保留月历自身样式） */

</style>
