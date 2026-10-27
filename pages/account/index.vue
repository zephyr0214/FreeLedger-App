<template>
  <view class="app-page" :style="pageStyle">
    <AppHeader @avatar-click="goSettings">
      <template #right>
        <view class="add-btn" @click="goAddAccount">
          <text class="add-text">+ 添加账户</text>
        </view>
      </template>
    </AppHeader>

    <scroll-view class="page-scroll" scroll-y>
      <!-- 总资产 -->
      <view class="asset-card">
        <text class="asset-label">总资产</text>
        <MoneyText :cents="accountStore.totalAssets" :size="76" :weight="600" color="var(--app-text)" />

        <view class="asset-meta">
          <view class="meta-item">
            <text class="meta-label">总负债</text>
            <MoneyText :cents="accountStore.totalDebt" :size="28" color="var(--app-text-2)" />
          </view>
          <view class="meta-divider" />
          <view class="meta-item">
            <text class="meta-label">较上月</text>
            <text class="meta-value" :style="{ color: assetChange >= 0 ? 'var(--app-success)' : 'var(--app-danger)' }">
              {{ changeLabel }}
            </text>
          </view>
        </view>
      </view>

      <!-- 趋势图 -->
      <view class="trend-card">
        <view class="trend-head">
          <text class="trend-title">资产趋势</text>
          <view class="trend-tabs">
            <text
              v-for="r in ranges"
              :key="r.months"
              class="trend-tab"
              :class="{ active: trendRange === r.months }"
              @click="switchRange(r.months)"
            >{{ r.label }}</text>
          </view>
        </view>

        <view v-if="trendPoints.length < 2" class="trend-empty">
          <text class="trend-empty-text">数据积累中，连续记录几天就能看到趋势</text>
        </view>

        <view v-else class="trend-chart">
          <!-- 简易 SVG 折线：App 端 canvas 首绘易白屏，折线用 CSS 绘制更稳 -->
          <view class="chart-canvas">
            <view
              v-for="(pt, i) in trendPoints"
              :key="i"
              class="chart-bar-wrap"
            >
              <view
                class="chart-bar"
                :style="{
                  height: pt.heightPct + '%',
                  backgroundColor: i === trendPoints.length - 1 ? primaryColor : 'var(--app-line)'
                }"
              />
            </view>
          </view>
          <view class="chart-axis">
            <text class="axis-label">{{ trendLabels.first }}</text>
            <text class="axis-label">{{ trendLabels.last }}</text>
          </view>
        </view>
      </view>

      <!-- 账户分组列表 -->
      <view v-if="accountStore.grouped.length === 0" class="empty-wrap">
        <EmptyState
          emoji="💳"
          title="还没有账户"
          desc="添加现金、银行卡或支付宝账户"
          action-text="添加账户"
          @action="goAddAccount"
        />
      </view>

      <view v-for="group in accountStore.grouped" :key="group.key" class="group">
        <view class="group-head">
          <text class="group-title">{{ group.name }}</text>
          <text class="group-sum">
            {{ formatGroupSum(group) }}
          </text>
        </view>

        <view class="acc-list">
          <view
            v-for="acc in group.accounts"
            :key="acc.id"
            class="acc-item"
            @click="goDetail(acc.id)"
          >
            <view class="acc-icon" :style="{ backgroundColor: (acc.color || primaryColor) + '22' }">
              <text class="acc-icon-text" :style="{ color: acc.color || primaryColor }">
                {{ acc.name.slice(0, 1) }}
              </text>
            </view>

            <view class="acc-info">
              <view class="acc-name-row">
                <text class="acc-name">{{ acc.name }}</text>
                <text v-if="acc.card_tail" class="acc-tail">*{{ acc.card_tail }}</text>
                <view v-if="acc.id === defaultAccountId" class="default-badge">
                  <text class="default-badge-text">默认</text>
                </view>
              </view>
              <text class="acc-type">{{ acc.typeName }}</text>
            </view>

            <view class="acc-right">
              <MoneyText
                :cents="acc.balance_cents"
                :size="32"
                :weight="500"
                :color="acc.balance_cents < 0 ? 'var(--app-danger)' : 'var(--app-text)'"
              />
              <text v-if="acc.isCredit && acc.credit_limit_cents" class="acc-limit">
                额度 {{ (acc.credit_limit_cents / 100).toFixed(0) }}
              </text>
            </view>

            <!-- 设为默认账户 -->
            <view class="acc-set-default" @click.stop="setDefault(acc)">
              <text
                class="set-default-text"
                :style="{ color: acc.id === defaultAccountId ? 'var(--app-text-3)' : 'var(--app-primary)' }"
              >{{ acc.id === defaultAccountId ? '已默认' : '设默认' }}</text>
            </view>

            <text class="acc-arrow">›</text>
          </view>
        </view>
      </view>

      <view class="bottom-space" />
    </scroll-view>


  </view>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppHeader from '@/components/AppHeader.vue'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { getAssetTrend } from '@/api/account.js'
import { formatCents } from '@/utils/money.js'

export default {
  components: { AppHeader, MoneyText, EmptyState },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    const trendRange = ref(6)
    const trendData = ref([])

    const ranges = [
      { months: 1, label: '1月' },
      { months: 3, label: '3月' },
      { months: 6, label: '6月' },
      { months: 12, label: '1年' }
    ]

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    /** 当前默认账户 id */
    const defaultAccountId = computed(() => settingStore.settings.defaultAccountId || '')


    /** 较上月变化：取趋势最后两个点 */
    const assetChange = computed(() => {
      const pts = trendData.value
      if (pts.length < 2) return 0
      return pts[pts.length - 1].total - pts[pts.length - 2].total
    })

    const changeLabel = computed(() => {
      if (trendData.value.length < 2) return '—'
      const v = assetChange.value
      const sign = v >= 0 ? '+' : ''
      return `${sign}${(v / 100).toFixed(2)}`
    })

    /** 归一化为百分比柱高 */
    const trendPoints = computed(() => {
      const pts = trendData.value
      if (pts.length === 0) return []

      const values = pts.map((p) => p.total)
      const max = Math.max(...values)
      const min = Math.min(...values)
      const range = max - min || 1

      return pts.map((p) => ({
        day: p.day,
        total: p.total,
        heightPct: Math.round(((p.total - min) / range) * 70 + 25)
      }))
    })

    const trendLabels = computed(() => {
      const pts = trendData.value
      if (pts.length === 0) return { first: '', last: '' }
      const fmt = (d) => {
        const [, m, day] = d.split('-')
        return `${Number(m)}/${Number(day)}`
      }
      return {
        first: fmt(pts[0].day),
        last: fmt(pts[pts.length - 1].day)
      }
    })

    async function loadTrend() {
      try {
        trendData.value = await getAssetTrend(trendRange.value)
      } catch (e) {
        trendData.value = []
      }
    }

    function switchRange(months) {
      trendRange.value = months
      loadTrend()
    }

    function formatGroupSum(group) {
      const sum = group.accounts.reduce((acc, a) => acc + a.balance_cents, 0)
      return formatCents(sum, { symbol: settingStore.currencySymbol })
    }

    /** 设为默认账户 —— AI 记账和手动记账都会优先用它 */
    async function setDefault(acc) {
      if (acc.id === defaultAccountId.value) return
      await settingStore.update({ defaultAccountId: acc.id })
      uni.showToast({ title: `已设为默认：${acc.name}`, icon: 'none' })
    }

    function goAddAccount() {
      uni.navigateTo({ url: '/pages/account/edit' })
    }

    function goDetail(id) {
      uni.navigateTo({ url: `/pages/account/detail?id=${id}` })
    }

    function goSettings() {
      uni.navigateTo({ url: '/pages/settings/index' })
    }

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await accountStore.load(true)
      await loadTrend()
    })

    onShow(async () => {
      if (settingStore.loaded) {
        await accountStore.refresh()
        await loadTrend()
      }
      settingStore.syncSystemTheme()
    })

    return {
      settingStore, accountStore,
      trendRange, ranges, trendData, trendPoints, trendLabels,
      primaryColor, pageStyle, defaultAccountId,
      assetChange, changeLabel,
      switchRange, formatGroupSum, setDefault,
      goAddAccount, goDetail, goSettings
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

.add-btn {
  padding: 8rpx 20rpx;
  border-radius: 20rpx;
  background-color: var(--app-card);
}

.add-text {
  font-size: 24rpx;
  color: var(--app-primary);
}

/* 总资产卡 */
.asset-card {
  background: linear-gradient(135deg, var(--app-primary-light), var(--app-card));
  border-radius: 24rpx;
  padding: 36rpx 32rpx;
  margin-top: 8rpx;
  box-shadow: var(--app-shadow);
}

.asset-label {
  font-size: 26rpx;
  color: var(--app-text-2);
  display: block;
  margin-bottom: 12rpx;
}

.asset-meta {
  display: flex;
  align-items: center;
  margin-top: 28rpx;
  padding-top: 24rpx;
  border-top: 1rpx solid var(--app-line);
}

.meta-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.meta-label {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.meta-value {
  font-size: 28rpx;
  font-weight: 500;
}

.meta-divider {
  width: 1rpx;
  height: 48rpx;
  background-color: var(--app-line);
}

/* 趋势卡 */
.trend-card {
  margin-top: 24rpx;
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 28rpx;
}

.trend-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24rpx;
}

.trend-title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--app-text);
}

.trend-tabs {
  display: flex;
  gap: 8rpx;
}

.trend-tab {
  font-size: 22rpx;
  color: var(--app-text-3);
  padding: 6rpx 16rpx;
  border-radius: 16rpx;
}

.trend-tab.active {
  background-color: var(--app-primary-light);
  color: var(--app-primary);
}

.trend-empty {
  padding: 40rpx 0;
  text-align: center;
}

.trend-empty-text {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.trend-chart {
  padding-top: 8rpx;
}

.chart-canvas {
  display: flex;
  align-items: flex-end;
  height: 180rpx;
  gap: 4rpx;
}

.chart-bar-wrap {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
}

.chart-bar {
  width: 100%;
  border-radius: 4rpx 4rpx 0 0;
  min-height: 4rpx;
  transition: height 0.3s ease;
}

.chart-axis {
  display: flex;
  justify-content: space-between;
  margin-top: 12rpx;
}

.axis-label {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* 分组 */
.group {
  margin-top: 32rpx;
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
  padding: 0 4rpx;
}

.group-title {
  font-size: 26rpx;
  color: var(--app-text-2);
  font-weight: 500;
}

.group-sum {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.acc-list {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
}

.acc-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 26rpx 28rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.acc-item:last-child {
  border-bottom: none;
}

.acc-icon {
  width: 76rpx;
  height: 76rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.acc-icon-text {
  font-size: 30rpx;
  font-weight: 600;
}

.acc-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  min-width: 0;
}

.acc-name-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.acc-name {
  font-size: 28rpx;
  color: var(--app-text);
  font-weight: 500;
}

.acc-tail {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.acc-type {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.acc-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
  flex-shrink: 0;
}

.acc-limit {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.acc-arrow {
  font-size: 32rpx;
  color: var(--app-text-3);
}

/* 默认账户标记 */
.default-badge {
  padding: 0 10rpx;
  height: 30rpx;
  border-radius: 8rpx;
  background-color: var(--app-primary-light);
  display: flex;
  align-items: center;
}

.default-badge-text {
  font-size: 18rpx;
  color: var(--app-primary);
  line-height: 1;
}

.acc-set-default {
  padding: 8rpx 12rpx;
  flex-shrink: 0;
}

.set-default-text {
  font-size: 21rpx;
}

.empty-wrap {
  margin-top: 60rpx;
  background-color: var(--app-card);
  border-radius: 20rpx;
}

</style>
