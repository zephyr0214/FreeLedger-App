<template>
  <view class="app-page" :style="pageStyle">
    <!-- 首次使用引导 -->
    <block v-if="settingStore.loaded && !hasAccounts">
      <AppHeader />
      <view class="guide-area">
        <EmptyState
          emoji="👋"
          title="欢迎使用记账本"
          desc="先添加一个账户，才能开始记账"
          action-text="添加账户"
          @action="goAddAccount"
        />
      </view>
    </block>

    <block v-else>
      <AppHeader @avatar-click="goSettings">
        <template #right>
          <view class="header-btn" @click="goAllTxn">
            <text class="header-btn-text">全部</text>
          </view>
        </template>
      </AppHeader>

      <scroll-view
        class="page-scroll"
        scroll-y
        :style="{ height: scrollHeight }"
        :refresher-enabled="true"
        :refresher-triggered="refreshing"
        @refresherrefresh="onRefresh"
      >
        <!-- ② 本月概览 -->
        <view class="overview-card">
          <view class="ov-head">
            <text class="ov-label">本月结余</text>
            <text class="ov-month">{{ monthLabel }}</text>
          </view>
          <MoneyText
            :cents="overview.monthBalance"
            :size="72"
            :weight="600"
            :sign="false"
            :color="overview.monthBalance >= 0 ? 'var(--app-text)' : 'var(--app-danger)'"
          />
          <view class="ov-split">
            <view class="ov-item">
              <text class="ov-item-label">支出</text>
              <MoneyText :cents="overview.monthExpense" :size="32" :weight="500" color="var(--app-text)" />
            </view>
            <view class="ov-divider" />
            <view class="ov-item">
              <text class="ov-item-label">收入</text>
              <MoneyText :cents="overview.monthIncome" :size="32" :weight="500" color="var(--app-text)" />
            </view>
            <view class="ov-divider" />
            <view class="ov-item">
              <text class="ov-item-label">今日支出</text>
              <MoneyText :cents="overview.todayExpense" :size="32" :weight="500" color="var(--app-text)" />
            </view>
          </view>
        </view>

        <!-- ③ AI 洞察 -->
        <view class="ai-card" @click="goAiChat">
          <view class="ai-head">
            <text class="ai-badge">AI</text>
            <text class="ai-title">本月洞察</text>
            <text class="ai-refresh" @click.stop="refreshInsight">
              {{ insightLoading ? '分析中…' : '刷新' }}
            </text>
          </view>
          <text v-if="insightLoading" class="ai-text ai-loading">正在分析本月消费…</text>
          <text v-else-if="insight" class="ai-text">{{ insight }}</text>
          <text v-else class="ai-text ai-empty" @click.stop="refreshInsight">
            点击生成本月消费洞察 ›
          </text>
        </view>

        <!-- ④ 最近交易 -->
        <view class="section">
          <view class="section-head">
            <text class="section-title">
              {{ txnStore.isTodayEmpty ? '最近交易' : '今日交易' }}
            </text>
            <text class="section-more" @click="goAllTxn">查看全部 ›</text>
          </view>

          <view v-if="txnStore.displayList.length === 0" class="section-empty">
            <EmptyState emoji="📝" title="还没有记账" desc="点击右下角 + 记一笔" compact />
          </view>

          <view v-else class="txn-list">
            <view
              v-for="txn in txnStore.displayList"
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
                <text class="txn-name">{{ txnTitle(txn) }}</text>
                <text class="txn-sub ellipsis">{{ txnSub(txn) }}</text>
              </view>

              <view class="txn-amount">
                <MoneyText
                  :cents="txn.type === 'expense' ? -txn.amount_cents : (txn.type === 'income' ? txn.amount_cents : txn.amount_cents)"
                  :size="30"
                  :weight="500"
                  :sign="false"
                  :color="txn.type === 'expense' ? 'var(--app-text)' : (txn.type === 'income' ? 'var(--app-success)' : 'var(--app-text-2)')"
                />
                <text v-if="txnStore.isTodayEmpty" class="txn-day">{{ dayLabel(txn.occurred_day) }}</text>
              </view>
            </view>
          </view>
        </view>

        <!-- ⑤ 预算 -->
        <view v-if="budget" class="section">
          <view class="section-head">
            <text class="section-title">本月预算</text>
            <text class="section-more" @click="goBudget">设置 ›</text>
          </view>
          <view class="budget-card" @click="goBudget">
            <view class="budget-top">
              <view class="budget-left">
                <MoneyText :cents="budget.used" :size="40" :weight="600" color="var(--app-text)" />
                <text class="budget-limit">/ {{ (budget.limit / 100).toFixed(0) }}</text>
              </view>
              <text
                class="budget-pct"
                :style="{ color: budget.over ? 'var(--app-danger)' : primaryColor }"
              >{{ budget.percent }}%</text>
            </view>
            <view class="budget-bar">
              <view
                class="budget-fill"
                :style="{
                  width: Math.min(budget.percent, 100) + '%',
                  backgroundColor: budget.over ? 'var(--app-danger)' : primaryColor
                }"
              />
            </view>
            <text class="budget-tip">
              {{ budget.over
                ? `已超支 ¥${((budget.used - budget.limit) / 100).toFixed(2)}`
                : `剩余 ¥${(budget.remaining / 100).toFixed(2)} · 日均可用 ¥${(budget.dailyAvailable / 100).toFixed(0)}` }}
            </text>
          </view>
        </view>

        <!-- ⑥ 月历 -->
        <view class="section">
          <view class="section-head">
            <text class="section-title">{{ calendarTitle }}</text>
            <view class="cal-nav">
              <text class="cal-nav-btn" @click="shiftCalMonth(-1)">‹</text>
              <text class="cal-nav-btn" @click="shiftCalMonth(1)">›</text>
            </view>
          </view>
          <CalendarGrid
            :month-key="txnStore.currentMonth"
            :day-data="txnStore.dailyTotals"
            :selected-day="selectedDay"
            @day-click="onDayClick"
          />
        </view>

        <view class="bottom-space" />
      </scroll-view>

      <!-- ⑦ 悬浮按钮 -->
      <FabButton
        @tap="openPanel"
        @hold-start="onHoldStart"
        @hold-end="onHoldEnd"
        @hold-cancel="onHoldCancel"
      />

      <!-- 记账面板 -->
      <TxnPanel v-model="showPanel" :preset="panelPreset" @saved="onSaved" />

      <!-- 速记输入层 -->
      <QuickInput v-model="showQuick" @expand="onExpandFromQuick" @saved="onSaved" />

      <!-- 当日明细 -->
      <wd-action-sheet
        v-model="showDayDetail"
        :actions="dayActions"
        :title="dayDetailTitle"
        cancel-text="关闭"
        @select="onDayTxnSelect"
      />
    </block>
  </view>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppHeader from '@/components/AppHeader.vue'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import FabButton from '@/components/FabButton.vue'
import TxnPanel from '@/components/TxnPanel.vue'
import QuickInput from '@/components/QuickInput.vue'
import CalendarGrid from '@/components/CalendarGrid.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { getBudgetUsage } from '@/api/stats.js'
import { getInsight } from '@/api/ai.js'
import { toMonthKey, shiftMonth, formatDayHeader, relativeDayLabel } from '@/utils/date.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'

export default {
  components: { AppHeader, MoneyText, EmptyState, FabButton, TxnPanel, QuickInput, CalendarGrid },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()
    const txnStore = useTransactionStore()

    const refreshing = ref(false)
    const showPanel = ref(false)
    const showQuick = ref(false)
    const panelPreset = ref(null)
    const budget = ref(null)
    const insight = ref('')
    const insightLoading = ref(false)
    const selectedDay = ref('')
    const showDayDetail = ref(false)
    const dayActions = ref([])
    const dayDetailTitle = ref('')

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    const hasAccounts = computed(() => accountStore.hasAccounts)

    const overview = computed(() => txnStore.overview)

    const monthLabel = computed(() => {
      const [, m] = txnStore.currentMonth.split('-')
      return `${Number(m)}月`
    })

    const calendarTitle = computed(() => {
      const [y, m] = txnStore.currentMonth.split('-')
      return `${y}年${Number(m)}月`
    })

    const scrollHeight = computed(() => {
      const info = uni.getSystemInfoSync()
      const headerH = (info.statusBarHeight || 20) + 60
      const tabH = 50
      return `${info.windowHeight - headerH - tabH}px`
    })

    /* ------------------------------------------------------ 数据加载 */

    async function loadAll(force = false) {
      await accountStore.load(force)
      if (!accountStore.hasAccounts) return

      await txnStore.loadHome(force)

      // 预算
      try {
        const list = await getBudgetUsage(txnStore.currentMonth)
        budget.value = list.find((b) => b.scope === 'total') || list[0] || null
      } catch (e) {
        budget.value = null
      }
    }

    async function onRefresh() {
      refreshing.value = true
      try {
        await loadAll(true)
      } finally {
        refreshing.value = false
      }
    }

    /* ------------------------------------------------------ AI 洞察 */

    async function refreshInsight() {
      if (insightLoading.value) return
      insightLoading.value = true
      try {
        const res = await getInsight(txnStore.currentMonth)
        insight.value = res.text
      } catch (e) {
        insight.value = ''
        uni.showToast({ title: e.message, icon: 'none' })
      } finally {
        insightLoading.value = false
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
        budget.value = list.find((b) => b.scope === 'total') || list[0] || null
      }).catch(() => {})
    }

    async function onDayClick(dayKey) {
      selectedDay.value = dayKey
      const data = txnStore.dayData(dayKey)
      if (!data || data.count === 0) {
        uni.showToast({ title: '这天没有记录', icon: 'none' })
        return
      }

      // 加载该日交易
      const list = await txnStore.list({ startDay: dayKey, endDay: dayKey, limit: 50 })
      dayDetailTitle.value = formatDayHeader(dayKey)
      dayActions.value = list.map((t) => ({
        name: `${txnTitle(t)}  ¥${(t.amount_cents / 100).toFixed(2)}`,
        subname: t.note || ''
      }))
      showDayDetail.value = true

      // 暂存列表，选中后跳详情
      dayTxnCache = list
    }

    let dayTxnCache = []

    function onDayTxnSelect({ index }) {
      const txn = dayTxnCache[index]
      if (txn) {
        uni.navigateTo({ url: `/pages/txn/detail?id=${txn.id}` })
      }
      showDayDetail.value = false
    }

    /* ------------------------------------------------------ 交互 */

    function openPanel() {
      panelPreset.value = null
      showPanel.value = true
    }

    /** 长按 → 速记；松手后拉起输入层（不需要持续按住） */
    function onHoldStart() {
      // 触觉反馈已在 FabButton 内触发
    }

    function onHoldEnd() {
      showQuick.value = true
    }

    function onHoldCancel() {
      // 取消不处理
    }

    function onExpandFromQuick(preset) {
      panelPreset.value = preset
      showPanel.value = true
    }

    function onSaved() {
      loadAll(true)
      if (insight.value) {
        // 数据变了，洞察需要重算
        insight.value = ''
      }
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

    function dayLabel(dayKey) {
      const rel = relativeDayLabel(dayKey)
      if (rel) return rel
      const [, m, d] = dayKey.split('-')
      return `${Number(m)}/${Number(d)}`
    }

    /* ------------------------------------------------------ 路由 */

    function goAddAccount() {
      uni.navigateTo({ url: '/pages/account/edit' })
    }

    function goSettings() {
      uni.navigateTo({ url: '/pages/settings/index' })
    }

    function goAllTxn() {
      uni.navigateTo({ url: '/pages/txn/list' })
    }

    function goTxnDetail(id) {
      uni.navigateTo({ url: `/pages/txn/detail?id=${id}` })
    }

    function goBudget() {
      uni.navigateTo({ url: '/pages/settings/index' })
    }

    function goAiChat() {
      // AI 对话页暂未单独实现，先触发洞察刷新
      refreshInsight()
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
    })

    return {
      settingStore, accountStore, txnStore,
      refreshing, showPanel, showQuick, panelPreset,
      budget, insight, insightLoading, selectedDay,
      showDayDetail, dayActions, dayDetailTitle,
      primaryColor, pageStyle, hasAccounts, overview, monthLabel, calendarTitle, scrollHeight,
      onRefresh, refreshInsight, shiftCalMonth, onDayClick, onDayTxnSelect,
      openPanel, onHoldStart, onHoldEnd, onHoldCancel, onExpandFromQuick, onSaved,
      iconChar, txnTitle, txnSub, dayLabel,
      goAddAccount, goSettings, goAllTxn, goTxnDetail, goBudget, goAiChat
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

.header-btn {
  padding: 8rpx 20rpx;
  border-radius: 20rpx;
  background-color: var(--app-card);
}

.header-btn-text {
  font-size: 24rpx;
  color: var(--app-text-2);
}

.guide-area {
  padding-top: 120rpx;
}

/* 概览卡 */
.overview-card {
  background-color: var(--app-card);
  border-radius: 24rpx;
  padding: 36rpx 32rpx;
  margin-top: 8rpx;
  box-shadow: var(--app-shadow);
}

.ov-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
}

.ov-label {
  font-size: 26rpx;
  color: var(--app-text-2);
}

.ov-month {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.ov-split {
  display: flex;
  align-items: center;
  margin-top: 28rpx;
  padding-top: 24rpx;
  border-top: 1rpx solid var(--app-line);
}

.ov-item {
  flex: 1;
  display: flex;
  flex-direction: column;
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

/* AI 卡 */
.ai-card {
  margin-top: 24rpx;
  background: linear-gradient(135deg, var(--app-primary-light), var(--app-card));
  border-radius: 20rpx;
  padding: 24rpx 28rpx;
  border: 1rpx solid var(--app-line);
}

.ai-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 12rpx;
}

.ai-badge {
  font-size: 20rpx;
  font-weight: 600;
  color: #ffffff;
  background-color: var(--app-primary);
  padding: 2rpx 12rpx;
  border-radius: 8rpx;
}

.ai-title {
  font-size: 24rpx;
  color: var(--app-text-2);
  flex: 1;
}

.ai-refresh {
  font-size: 22rpx;
  color: var(--app-primary);
}

.ai-text {
  font-size: 27rpx;
  color: var(--app-text);
  line-height: 1.6;
}

.ai-loading {
  color: var(--app-text-3);
}

.ai-empty {
  color: var(--app-primary);
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

/* 预算 */
.budget-card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 28rpx;
}

.budget-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 16rpx;
}

.budget-left {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
}

.budget-limit {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.budget-pct {
  font-size: 28rpx;
  font-weight: 600;
}

.budget-bar {
  height: 12rpx;
  background-color: var(--app-card-2);
  border-radius: 6rpx;
  overflow: hidden;
}

.budget-fill {
  height: 100%;
  border-radius: 6rpx;
  transition: width 0.35s ease;
}

.budget-tip {
  display: block;
  font-size: 22rpx;
  color: var(--app-text-3);
  margin-top: 12rpx;
}

/* 月历导航 */
.cal-nav {
  display: flex;
  gap: 8rpx;
}

.cal-nav-btn {
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

.bottom-space {
  height: 200rpx;
}
</style>
