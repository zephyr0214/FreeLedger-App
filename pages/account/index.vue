<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <AppHeader @avatar-click="goSettings">
      <template #right>
        <HeaderAction @action-click="goAddAccount">+ 添加账户</HeaderAction>
      </template>
    </AppHeader>

    <scroll-view class="page-scroll" scroll-y>
      <!-- 总资产 + 趋势（同一个面板） -->
      <view class="asset-card">
        <!-- 总资产：只显示金额 -->
        <MoneyText :cents="accountStore.totalAssets" :size="56" :weight="600" color="var(--app-text)" />

        <!-- 资产趋势：每次资产变化打一个点 -->
        <view class="asset-trend">
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

          <SmoothLineChart
            :points="trendPoints"
            :color="primaryColor"
            :height="200"
            :format-amount="formatAmount"
          />
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
          <!--
            右滑显示「设为默认」：
            用 wd-swipe-action 的 right 插槽。
            ★ 用组件自己的 @click 事件，不用插槽内容的 @click ★
               插槽内容所在的容器上已经绑了 @click="onClick('right')"，
               它会先把滑动关掉再冒泡；
               自己的 @click.stop 虽然能拦住冒泡，
               但在真机上事件顺序不稳（先关滑动 -> 按钮消失 -> 处理器还没跑）。
               组件的 @click 事件在关闭之后才 emit，是它设计的用法。
          -->
          <wd-swipe-action
            v-for="acc in group.accounts"
            :key="acc.id"
            v-model="swipeStates[acc.id]"
            class="acc-swipe"
            @click="onSwipeClick(acc, $event)"
          >
            <view class="acc-item" @click="goDetail(acc.id)">
              <view class="acc-icon" :style="{ backgroundColor: (acc.color || primaryColor) + '22' }">
                <!--
                  账户图标：新数据存的是预设 key（用 AccountIcon 渲染，
                  品牌图标是官方填充矢量，通用图标是线性描边）；
                  旧数据可能是 AI 生成的 SVG data URI，仍按图片显示。
                  两者都没有就退回首字符。
                -->
                <AccountIcon
                  v-if="acc.icon && !isSvgIcon(acc.icon)"
                  :name="acc.icon"
                  :size="22"
                  :color="acc.color || primaryColor"
                />
                <image
                  v-else-if="isSvgIcon(acc.icon)"
                  :src="acc.icon"
                  class="acc-icon-img"
                  mode="aspectFit"
                />
                <text
                  v-else
                  class="acc-icon-text"
                  :style="{ color: acc.color || primaryColor }"
                >
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

              <text class="acc-arrow">›</text>
            </view>

            <!-- 右滑操作区 -->
            <template #right>
              <view
                class="swipe-default"
                :style="{ backgroundColor: acc.id === defaultAccountId ? 'var(--app-text-3)' : primaryColor }"
              >
                <text class="swipe-default-text">
                  {{ acc.id === defaultAccountId ? '已默认' : '设为默认' }}
                </text>
              </view>
            </template>
          </wd-swipe-action>
        </view>
      </view>

      <view class="bottom-space" />
    </scroll-view>


  </view>
</template>

<script>
import { ref, reactive, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppHeader from '@/components/AppHeader.vue'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import SmoothLineChart from '@/components/SmoothLineChart.vue'
import HeaderAction from '@/components/HeaderAction.vue'
import AccountIcon from '@/components/AccountIcon.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { getAssetChangePoints, fillChangePoints } from '@/api/account.js'
import { isSvgIcon } from '@/api/accountIcon.js'
import { formatCents } from '@/utils/money.js'

export default {
  components: { AppHeader, MoneyText, EmptyState, SmoothLineChart, HeaderAction, AccountIcon },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    const trendRange = ref(1)
    const trendData = ref([])

    /**
     * 每个账户的右滑开合状态。
     * key 是账户 id，值是 wd-swipe-action 的 modelValue：
     *   'left' / 'right' 展开，'close' 收起。
     */
    const swipeStates = reactive({})

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

    /**
     * 折线图的数据点。
     *
     * ★ 补 0 ★
     *   用户要求「没数据的时刻就记为 0 来画图」——
     *   否则两个变化点之间会直接连成一条直线，
     *   看起来像「这段时间资产没动过」，与事实不符。
     *
     *   实际实现是：没快照的那天沿用上一个已知值（资产确实没变），
     *   只有区间开头还没任何数据时才记 0。
     */
    const trendPoints = computed(() =>
      fillChangePoints(trendData.value, trendRange.value * 31)
    )

    async function loadTrend() {
      try {
        trendData.value = await getAssetChangePoints(trendRange.value)
      } catch (e) {
        trendData.value = []
      }
    }

    /** 归一化为百分比柱高 */
    const trendBars = computed(() => {
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

    function switchRange(months) {
      trendRange.value = months
      loadTrend()
    }

    function formatGroupSum(group) {
      const sum = group.accounts.reduce((acc, a) => acc + a.balance_cents, 0)
      return formatCents(sum, { symbol: settingStore.currencySymbol })
    }

    /** 折线图触摸气泡里的金额（与页面其它地方保持一致） */
    function formatAmount(cents) {
      return formatCents(cents, { symbol: settingStore.currencySymbol })
    }

    /**
     * 设为默认账户 —— AI 记账和手动记账都会优先用它
     *
     * 点完要把右滑的按钮收起来：
     * 不收的话它一直露在那儿，用户会以为还能再点什么。
     */
    async function setDefault(acc) {
      if (acc.id === defaultAccountId.value) {
        uni.showToast({ title: '已经是默认账户了', icon: 'none' })
        return
      }
      await settingStore.update({ defaultAccountId: acc.id })
      uni.showToast({ title: `已设为默认：${acc.name}`, icon: 'none' })
    }

    /**
     * wd-swipe-action 的 click 事件
     *
     * 组件在关闭滑动之后才 emit 这个事件，
     * 事件参数是 { value: 'left' | 'right' | 'inside' }。
     * 只有点到了右边的操作区（'right'）才算「点了设为默认」。
     */
    function onSwipeClick(acc, event) {
      const position = event && event.value
      if (position !== 'right') return
      setDefault(acc)
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
      // 重刷原生 tabBar：只有 tab 页才有 tabBar 实例，
      // 主题设置页改完主题后要靠这里把颜色刷回来
      settingStore.refreshTabBar()
    })

    return {
      settingStore, accountStore,
      trendRange, ranges, trendData, trendPoints, swipeStates,
      primaryColor, pageStyle, defaultAccountId, isSvgIcon,
      switchRange, formatGroupSum, formatAmount, setDefault, onSwipeClick,
      goAddAccount, goDetail, goSettings
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

/* 「+ 添加账户」按钮已抽成 components/HeaderAction.vue，四页共用同一套样式 */

/* 总资产卡（总资产金额 + 趋势折线，同一个面板） */
.asset-card {
  background: linear-gradient(135deg, var(--app-primary-light), var(--app-card));
  border-radius: 24rpx;
  padding: 36rpx 32rpx 28rpx;
  margin-top: 8rpx;
  box-shadow: var(--app-shadow);
}

/* 趋势区：与总资产同面板，用一条细分割线隔开 */
.asset-trend {
  margin-top: 28rpx;
  padding-top: 24rpx;
  border-top: 1rpx solid var(--app-line);
}

.trend-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
}

.trend-title {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--app-text-2);
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

/* 右滑容器：每一行独立包一层 */
.acc-swipe {
  border-bottom: 1rpx solid var(--app-line);
}

.acc-swipe:last-child {
  border-bottom: none;
}

.acc-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 26rpx 28rpx;
  background-color: var(--app-card);
}

/* 右滑操作区：「设为默认」 */
.swipe-default {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 200rpx;
  height: 100%;
}

.swipe-default-text {
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 500;
}

.acc-icon {
  width: 76rpx;
  height: 76rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

/* AI 画的 SVG 图标 */
.acc-icon-img {
  width: 52rpx;
  height: 52rpx;
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

.empty-wrap {
  margin-top: 60rpx;
  background-color: var(--app-card);
  border-radius: 20rpx;
}

</style>
