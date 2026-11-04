<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <AppHeader @avatar-click="goProfile">
      <template #right>
        <HeaderAction @action-click="goAddAccount">+ 添加账户</HeaderAction>
      </template>
    </AppHeader>

    <scroll-view class="page-scroll" scroll-y>
      <!-- 总资产 + 趋势（同一个面板） -->
      <view class="asset-card">
        <!--
          概览：上面是净资产大数字，下面一行「总资产 / 负债」。

          ★ 为什么不给大数字加「净资产」这三个字 ★
            用户明确要求删掉 —— 三个金额一起看，中间那个大字
            天然就是「主数」，再加标题反而显得啰嗦。
            左右两个小字已经让用户对出大数是什么。

          ★ 三个数的口径 ★
            总资产 = 计入资产的账户正余额之和
            负  债 = 账户负余额绝对值之和 + **未归还的借入**
            净资产 = 总资产 - 负债
          全部来自 accountStore（一条 SQL 同时算出，
          见 api/account.js 的 getAssetOverview），
          所以三块数字永远自洽，不会出现「负债 0、净资产却是负的」。

          ★ 借入为什么要算进负债 ★
            借来的钱进了真实账户（已计入总资产），
            但它同时是一笔要还的债；不算进负债，净资产会凭空多出这一笔。
            算的是净额（借入 - 借款归还），还清后负债自动回落。
        -->
        <view class="asset-overview">
          <MoneyText
            :cents="accountStore.netAssets"
            :size="56"
            :weight="600"
            color="var(--app-text)"
          />

          <view class="asset-sub-row">
            <view class="asset-sub-item">
              <text class="asset-sub-label">总资产</text>
              <MoneyText
                :cents="accountStore.totalAssets"
                :size="26"
                :weight="500"
                color="var(--app-text-2)"
              />
            </view>
            <view class="asset-sub-divider" />
            <view class="asset-sub-item">
              <text class="asset-sub-label">负债</text>
              <MoneyText
                :cents="accountStore.totalDebt"
                :size="26"
                :weight="500"
                color="var(--app-text-2)"
              />
            </view>
          </view>
        </view>

        <!-- 总资产趋势：每次总资产变化打一个点 -->
        <view class="asset-trend">
          <view class="trend-head">
            <text class="trend-title">总资产趋势图</text>
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

          <!-- 图表外层：横向出血，让曲线不被卡片内边距挤窄 -->
          <view class="trend-chart">
            <SmoothLineChart
              :points="trendPoints"
              :color="primaryColor"
              :height="150"
              :format-amount="formatAmount"
            />
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
            :disabled="acc.isCombo"
            class="acc-swipe"
            @click="onSwipeClick(acc, $event)"
          >
            <view class="acc-item" @click="goDetail(acc)">
              <view class="acc-icon" :style="{ backgroundColor: (acc.color || primaryColor) + '22' }">
                <!--
                  账户图标：预设 key（用 AccountIcon 渲染，
                  品牌图标是官方填充矢量，通用图标是线性描边）。
                  没有图标就退回首字符。
                -->
                <AccountIcon
                  v-if="acc.icon"
                  :name="acc.icon"
                  :size="22"
                  :color="acc.color || primaryColor"
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
                <text class="acc-type">{{ acc.isCombo ? '按顺序扣款' : acc.typeName }}</text>
              </view>

              <view class="acc-right">
                <!--
                  组合账户不显示余额 —— 它没有钱，显示 0.00 会误导。
                  只放一个「组合账户」标签说明它是什么。
                -->
                <text v-if="acc.isCombo" class="acc-combo-tag">组合账户</text>
                <!--
                  账户余额：无论正负都不加颜色、不加符号（用户要求）。
                  ★ 唯一例外：不计入资产的账户用中性浅灰 ★
                    这类账户不参与总资产，浅灰提示「它不算在这本账里」。
                -->
                <MoneyText
                  v-else
                  :cents="acc.balance_cents"
                  :muted="!acc.include_in_total"
                  :size="32"
                  :weight="500"
                />
                <text v-if="acc.isCredit && acc.credit_limit_cents" class="acc-limit">
                  额度 {{ (acc.credit_limit_cents / 100).toFixed(0) }}
                </text>
              </view>

              <text class="acc-arrow">›</text>
            </view>

            <!-- 右滑操作区（组合账户 disabled，不会滑出） -->
            <template #right>
              <view
                v-if="!acc.isCombo"
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

      <view class="tabbar-space" />
    </scroll-view>

    <!-- 圆角悬浮底栏（与首页同一份组件，图标/主题色自动跟随） -->
    <AppTabBar
      current="account"
      :hold-enabled="settingStore.quickAddHoldAction !== 'none'"
      @single-press="onAddTap"
      @hold-end="onAddHoldEnd"
    />

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
import AppTabBar from '@/components/AppTabBar.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useUiStore } from '@/stores/ui.js'
import { getAssetChangePoints, fillChangePoints } from '@/api/account.js'
import { gotoHomeAndAdd } from '@/utils/tabBar.js'
import { formatCents } from '@/utils/money.js'

export default {
  components: { AppHeader, MoneyText, EmptyState, SmoothLineChart, HeaderAction, AccountIcon, AppTabBar },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()
    const uiStore = useUiStore()

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

    function switchRange(months) {
      trendRange.value = months
      loadTrend()
    }

    function formatGroupSum(group) {
      // ★ 组合账户组不显示金额合计 ★
      //   组合没有余额（恒 0），显示「0.00」只会误导。
      //   按用户要求：只保留「组合账户」这个组名，右侧留空。
      if (group.key === 'combo') return ''
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
      // 组合账户不能作为默认账户（它是虚拟账户，不能直接记账）
      if (acc.isCombo) {
        uni.showToast({ title: '组合账户不能设为默认', icon: 'none' })
        return
      }
      if (acc.id === defaultAccountId.value) {
        uni.showToast({ title: '已经是默认账户了', icon: 'none' })
        return
      }
      await settingStore.update({ defaultAccountId: acc.id })
      uni.showToast({ title: `已设为默认：${acc.name}`, icon: 'none' })
    }

    /* ------------------------------------------------------ 记账按钮 */

    /**
     * 短按记账按钮：记下意图并切回首页。
     *
     * ★ 为什么不在本页打开面板 ★
     *   TxnPanel / QuickAddBar 只挂在首页（见 stores/ui.js 的说明），
     *   本页没有这两个组件，就地打开无处安放。
     */
    function onAddTap() {
      gotoHomeAndAdd(settingStore.quickAddTapAction === 'manual' ? 'manual' : 'ai', uiStore)
    }

    /** 长按记账按钮：同样回首页，按长按的配置打开 */
    function onAddHoldEnd() {
      gotoHomeAndAdd(settingStore.quickAddHoldAction === 'manual' ? 'manual' : 'ai', uiStore)
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

    function goDetail(acc) {
      // ★ 组合账户没有流水、没有详情页 ★
      //   点击直接进编辑页（成员配置、排序都在编辑页里）。
      if (acc.isCombo) {
        uni.navigateTo({ url: `/pages/account/edit?id=${acc.id}` })
        return
      }
      uni.navigateTo({ url: `/pages/account/detail?id=${acc.id}` })
    }

    function goProfile() {
    uni.navigateTo({ url: '/pages/settings/profile' })
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

    /*
     * 周期补记完成后立刻刷新
     *
     * 周期流水会改变账户余额（补记的收支落在实际账户上），
     * 而 App.vue onShow 里的补记是异步写库、本页 refresh 不等它，
     * 余额和资产趋势就会停在补记前的数字。
     * App.vue 补记成功且有新增时 emit 这个事件，这里重新拉一次。
     */
    uni.$on('cycle:caughtup', async () => {
      if (settingStore.loaded) {
        await accountStore.refresh()
        await loadTrend()
      }
    })

    return {
      settingStore, accountStore,
      trendRange, ranges, trendData, trendPoints, swipeStates,
      primaryColor, pageStyle, defaultAccountId,
      switchRange, formatGroupSum, formatAmount, setDefault, onSwipeClick,
      onAddTap, onAddHoldEnd,
      goAddAccount, goDetail, goProfile
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
  background: linear-gradient(135deg, var(--app-hero-from), var(--app-card));
  border-radius: 24rpx;
  /*
   * ★ 上下内边距收紧 ★
   *   原来是 36rpx 32rpx 28rpx，整块面板偏高。
   *   用户要求「矮一些」，所以上 28、下 20 ——
   *   总资产数字本身有行高，不需要再多垫。
   */
  padding: 28rpx 32rpx 20rpx;
  margin-top: 8rpx;
  box-shadow: var(--app-shadow);
}

/* --------------------------------------------------------- 资产概览 */

/**
 * 概览区：上面净资产大数字，下面一行「总资产 / 负债」。
 *
 * ★ 上下排而不是左右排 ★
 *   用户要求「总资产和负债排列在净资产下方」。
 *   左右排时净资产被挤在左边一条，金额一长（比如百万级）
 *   右侧两个数字就得换行；上下排之后大数字占满整行宽度，
 *   再长的金额也不会被挤。
 *
 * ★ 大数字不再带「净资产」标签 ★
 *   用户要求删掉。下面的「总资产 / 负债」两行已经把事情说清楚了。
 */
.asset-overview {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

/* 下方一行：总资产 | 负债（中间一条竖线分隔） */
.asset-sub-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.asset-sub-item {
  display: flex;
  align-items: baseline;
  gap: 10rpx;
}

.asset-sub-label {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.asset-sub-divider {
  width: 1rpx;
  height: 24rpx;
  background-color: var(--app-line);
}

/* 趋势区：与总资产同面板，用一条细分割线隔开 */
.asset-trend {
  margin-top: 20rpx;
  padding-top: 18rpx;
  border-top: 1rpx solid var(--app-line);
}

.trend-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
}

/*
 * ★ 折线图与上方内容对齐（不出边）★
 *
 * 「横向太窄」的真正原因不是容器窄，而是 SVG 的缩放模式：
 *   buildSvgSource 以前没写 preserveAspectRatio，默认是 "xMidYMid meet"
 *   —— 等比缩放并居中。viewBox 是 300×100（3:1），
 *   而容器实际是 622×150（4.15:1），比例不同，
 *   meet 按较小的缩放比适配，宽度方向只用了 300×1.5 = 450rpx，
 *   剩下的 172rpx 变成左右各约 86rpx 的空白，
 *   折线看着就像「缩在中间一小条」。
 *
 *   改成 preserveAspectRatio="none" 之后（见 utils/chart.js），
 *   曲线会拉伸铺满整个容器宽度，空白自然消失 ——
 *   所以这里不需要再用负 margin 把图表拉到卡片边缘。
 *   出血到边缘反而会和上面的资产数字、趋势标题行错开，
 *   破坏左对齐。
 *
 * ★ 所以这里只做一件事：不出血，跟上方共用卡片的内边距 ★
 *   宽度就是卡片的 622rpx，左边缘和「总资产」金额、
 *   「总资产趋势图」标题完全对齐。
 *
 * ★ 为什么包一层 view 而不是给组件加 class ★
 *   SmoothLineChart 的根节点在子组件内部，
 *   父组件的 scoped 样式作用到子组件根元素在 App 端不可靠
 *   （编译后可能带不上 data-v 属性）。
 *   包一层本页自己的 view，样式必然生效。
 */
.trend-chart {
  padding: 0;
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

/* 组合账户标签（替代余额，说明它是记账用的虚拟账户） */
.acc-combo-tag {
  font-size: 24rpx;
  color: var(--app-primary);
  background-color: var(--app-primary-light);
  padding: 8rpx 18rpx;
  border-radius: 14rpx;
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
