<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <AppHeader @avatar-click="goProfile">
      <!--
        右上角：关于与说明
        样式和首页 / 统计页的「AI 助手」胶囊完全一致，
        三个页面的头部按钮风格统一。
      -->
      <template #right>
        <HeaderAction @action-click="goAbout">关于与说明</HeaderAction>
      </template>
    </AppHeader>

    <scroll-view class="page-scroll" scroll-y>
      <!-- 个人信息卡 -->
      <view class="profile-card" @click="goProfile">
        <view class="profile-avatar" :style="{ backgroundColor: primaryColor }">
          <image v-if="settingStore.avatar" :src="settingStore.avatar" class="avatar-img" mode="aspectFill" />
          <text v-else class="avatar-letter">{{ settingStore.nickname.slice(0, 1) }}</text>
        </view>
        <view class="profile-info">
          <text class="profile-name">{{ settingStore.nickname }}</text>
          <text class="profile-sign">{{ settingStore.settings.signature || '点击设置个人信息' }}</text>
        </view>
        <text class="profile-arrow">›</text>
      </view>

      <!-- 数据概览 -->
      <view class="data-row">
        <view class="data-item">
          <text class="data-num">{{ stats.txnCount }}</text>
          <text class="data-label">总笔数</text>
        </view>
        <view class="data-divider" />
        <view class="data-item">
          <text class="data-num">{{ stats.accountCount }}</text>
          <text class="data-label">账户</text>
        </view>
        <view class="data-divider" />
        <view class="data-item">
          <text class="data-num">{{ stats.dayCount }}</text>
          <text class="data-label">记账天数</text>
        </view>
      </view>

      <!--
        配置条目分三部分

        ★ 记账功能（2×2 宫格）★
          分类、标签、周期、预算
          —— 这四个都是「账本内容本身」的管理入口，
             彼此平级、用途相近，用宫格排列更紧凑、也更好点。
             它们都**没有副标题**（不显示"几项"），
             宫格只放图标 + 名称，视觉干净。

        ★ 记账设置（列表）★
          记账按钮设置、AI 智能配置
          —— 这两个是「怎么记账」的行为配置，带副标题说明当前状态。

        ★ 系统设置（列表）★
          主题外观、数据与备份
          —— App 本身的表现，跟记账内容无关。

        ★ 账户管理的入口已删除 ★
          账户已经在底部 tabBar 里了，再放一个入口是重复的。
      -->

      <!-- 记账功能：2×2 宫格，一个大卡片里排 4 个小卡
           ★ 每格内部是横向排列 ★
             图标在左、文字居中偏左、› 在最右 ——
             和下面的列表条目同一个读法，只是两列并排。 -->
      <view class="menu-group">
        <text class="menu-title">记账功能</text>
        <view class="feature-grid">
          <view
            v-for="item in featureTiles"
            :key="item.key"
            class="feature-tile"
            @click="onMenuClick(item)"
          >
            <LineIcon
              :name="item.icon"
              :size="20"
              :color="primaryColor"
              class="feature-icon"
            />
            <text class="feature-name">{{ item.name }}</text>
            <text class="feature-arrow">›</text>
          </view>
        </view>
      </view>

      <!-- 记账设置 / 系统设置：沿用列表样式 -->
      <view v-for="group in menuGroups" :key="group.title" class="menu-group">
        <text class="menu-title">{{ group.title }}</text>
        <view class="menu-list">
          <view
            v-for="item in group.items"
            :key="item.key"
            class="menu-item"
            @click="onMenuClick(item)"
          >
            <!-- 线性简约图标，不用 emoji -->
            <LineIcon
              :name="item.icon"
              :size="20"
              :color="primaryColor"
              class="menu-icon"
            />
            <text class="menu-name">{{ item.name }}</text>
            <text v-if="item.value" class="menu-value">{{ item.value }}</text>
            <text class="menu-arrow">›</text>
          </view>
        </view>
      </view>

      <view class="version-tip">
        <text class="version-text">自由记 v1.0.0 · 数据全部保存在本机</text>
      </view>

      <view class="tabbar-space" />
    </scroll-view>

    <!-- 圆角悬浮底栏（与首页同一份组件） -->
    <AppTabBar
      current="mine"
      :hold-enabled="settingStore.quickAddHoldAction !== 'none'"
      @single-press="onAddTap"
      @hold-end="onAddHoldEnd"
    />
  </view>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppHeader from '@/components/AppHeader.vue'
import HeaderAction from '@/components/HeaderAction.vue'
import LineIcon from '@/components/LineIcon.vue'
import AppTabBar from '@/components/AppTabBar.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useUiStore } from '@/stores/ui.js'
import { queryOne } from '@/api/db/index.js'
import { daysSinceLastBackup } from '@/api/backup.js'
import { gotoHomeAndAdd } from '@/utils/tabBar.js'

export default {
  components: { AppHeader, HeaderAction, LineIcon, AppTabBar },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()
    const uiStore = useUiStore()

    const stats = ref({ txnCount: 0, accountCount: 0, dayCount: 0 })
    const backupHint = ref('')

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    /**
     * ★ 记账功能：2×2 宫格 ★
     *   分类 / 标签 / 周期 / 预算 —— 这四个是「账本内容本身」的管理入口，
     *   彼此平级、用途相近，用宫格排更紧凑。
     *
     * ★ 刻意不带副标题 ★
     *   用户明确要求「预算管理不要显示几项」。
     *   宫格只放图标 + 名称，四个格子视觉一致；
     *   否则只有「预算管理」底下有行小字，四格会显得不齐。
     *
     *   所以原来给预算入口算「N 项」的 budgetLabel、以及
     *   那条统计预算条数的 SQL 查询都删掉了 ——
     *   现在没有任何入口要用它，留着只会每次进页面白跑一次查询。
     */
    const featureTiles = computed(() => [
      { key: 'category', icon: 'category', name: '分类管理', route: '/pages/settings/category' },
      { key: 'tag', icon: 'tag', name: '标签管理', route: '/pages/settings/tag' },
      { key: 'cycle', icon: 'cycle', name: '周期管理', route: '/pages/settings/cycle' },
      { key: 'budget', icon: 'budget', name: '预算管理', route: '/pages/settings/budget' }
    ])

    /**
     * 列表形式的设置项，分两组。
     *
     * ★ 记账设置 ★
     *   记账按钮设置、AI 智能配置
     *   —— 「怎么记账」的行为配置，带副标题说明当前状态。
     *
     * ★ 系统设置 ★
     *   主题外观、数据与备份
     *   —— App 本身的表现设置，跟记账内容无关。
     *
     * ★ 「数据与备份」入口 ★
     *   它们本来在同一个页面（/pages/settings/data）里，
     *   拆成两个入口反而让人以为是两回事。合成「数据与备份」，
     *   进页面后按区块看。
     *
     * icon 字段是 utils/lineIcons.js 里的 key（线性描边图标，不是 emoji）
     */
    const menuGroups = computed(() => [
      {
        title: '记账设置',
        items: [
          {
            key: 'quickAdd',
            icon: 'plus',
            name: '记账按钮设置',
            value: quickAddLabel.value,
            route: '/pages/settings/quick-add'
          },
          { key: 'ai', icon: 'ai', name: 'AI 智能配置', value: aiLabel.value, route: '/pages/settings/ai' }
        ]
      },
      {
        title: '系统设置',
        items: [
          { key: 'theme', icon: 'theme', name: '主题外观', value: themeLabel.value, route: '/pages/settings/theme' },
          { key: 'data', icon: 'data', name: '数据与备份', value: backupHint.value, route: '/pages/settings/data' }
        ]
      }
    ])

    const themeLabel = computed(() => {
      const modeMap = { system: '跟随系统', light: '浅色', dark: '深色' }
      return modeMap[settingStore.settings.themeMode] || '跟随系统'
    })

    const aiLabel = computed(() => {
      return settingStore.settings.ai && settingStore.settings.ai.apiKey ? '已配置' : '未配置'
    })

    /**
     * 记账按钮设置的副标题：长按/短按分别触发什么。
     *
     * 一眼看懂当前配置，不用进设置页才知道。
     */
    const quickAddLabel = computed(() => {
      const nameOf = (a) => (a === 'ai' ? 'AI' : a === 'manual' ? '手动' : '无')
      return `短按${nameOf(settingStore.quickAddTapAction)} / 长按${nameOf(settingStore.quickAddHoldAction)}`
    })

    async function loadStats() {
      try {
        const txnRow = await queryOne('SELECT COUNT(*) AS c FROM txn WHERE deleted_at IS NULL')
        const dayRow = await queryOne(
          'SELECT COUNT(DISTINCT occurred_day) AS c FROM txn WHERE deleted_at IS NULL'
        )
        stats.value = {
          txnCount: Number(txnRow ? txnRow.c : 0),
          accountCount: accountStore.list.length,
          dayCount: Number(dayRow ? dayRow.c : 0)
        }

        const days = await daysSinceLastBackup()
        if (days === Infinity) backupHint.value = '尚未备份'
        else if (days === 0) backupHint.value = '今天已备份'
        else backupHint.value = `${days} 天前备份`
      } catch (e) {
        console.warn('[mine] stats failed', e)
      }
    }

    function onMenuClick(item) {
      if (item.route) {
        uni.navigateTo({ url: item.route })
      }
    }

    /* ------------------------------------------------------ 记账按钮 */

    /** 短按：记下意图并切回首页（面板只挂在首页） */
    function onAddTap() {
      gotoHomeAndAdd(settingStore.quickAddTapAction === 'manual' ? 'manual' : 'ai', uiStore)
    }

    /** 长按：同上，按长按的配置打开 */
    function onAddHoldEnd() {
      gotoHomeAndAdd(settingStore.quickAddHoldAction === 'manual' ? 'manual' : 'ai', uiStore)
    }

    function goProfile() {
      uni.navigateTo({ url: '/pages/settings/profile' })
    }

    /** 右上角：关于与说明 */
    function goAbout() {
      uni.navigateTo({ url: '/pages/settings/about' })
    }

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await accountStore.load()
      await loadStats()
    })

    onShow(async () => {
      if (settingStore.loaded) {
        await accountStore.load(true)
        await loadStats()
      }
      settingStore.syncSystemTheme()
      // 重刷原生 tabBar：只有 tab 页才有 tabBar 实例，
      // 主题设置页改完主题后要靠这里把颜色刷回来
      settingStore.refreshTabBar()
    })

    return {
      settingStore, accountStore, stats, backupHint,
      primaryColor, pageStyle, menuGroups, featureTiles,
      themeLabel, aiLabel, quickAddLabel,
      onAddTap, onAddHoldEnd,
      onMenuClick, goProfile, goAbout
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

/* 个人信息卡 */
.profile-card {
  display: flex;
  align-items: center;
  gap: 24rpx;
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 32rpx 28rpx;
  margin-top: 8rpx;
  box-shadow: var(--app-shadow);
}

.profile-avatar {
  width: 104rpx;
  height: 104rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.avatar-img {
  width: 100%;
  height: 100%;
}

.avatar-letter {
  color: #ffffff;
  font-size: 44rpx;
  font-weight: 600;
}

.profile-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  min-width: 0;
}

.profile-name {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--app-text);
}

.profile-sign {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.profile-arrow {
  font-size: 36rpx;
  color: var(--app-text-3);
}

/* 数据概览 */
.data-row {
  display: flex;
  align-items: center;
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 28rpx 0;
  margin-top: 20rpx;
}

.data-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
}

.data-num {
  font-size: 40rpx;
  font-weight: 600;
  color: var(--app-text);
}

.data-label {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.data-divider {
  width: 1rpx;
  height: 48rpx;
  background-color: var(--app-line);
}

/* 菜单 */
.menu-group {
  margin-top: 32rpx;
}

.menu-title {
  font-size: 24rpx;
  color: var(--app-text-3);
  padding-left: 8rpx;
  display: block;
  margin-bottom: 12rpx;
}

/*
 * ★ 记账功能：2×2 宫格 ★
 *
 * 外层是一个大卡片（和白底列表同款圆角/底色），
 * 内部用 grid 排成两行两列，四个格子等宽等高。
 *
 * ★ 为什么用 grid 而不是 flex 换行 ★
 *   flex + flex-basis: 50% 时，最后一行若不满会自动拉伸，
 *   而且拿不准间隙怎么扣；grid 的 1fr 1fr 天生等宽，
 *   gap 也不会把格子挤出容器。
 */
.feature-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rpx;
  background-color: var(--app-line);
  border-radius: 20rpx;
  overflow: hidden;
}

/*
 * 单个格子：横排 —— 图标 · 文字 · ›
 *
 * ★ 与列表条目对齐的数值 ★
 *   字号 28rpx、图标 40rpx、上下内边距 28rpx —— 全部跟 .menu-item 一致。
 *   之前这里用了 26rpx 字号 + 12rpx 间距，比列表小一圈、也挤，
 *   看上去就像「宫格的字变mini了」，所以统一回来。
 *
 * ★ 尺寸比列表大一档 ★
 *   条目高度取 100rpx（列表约 96rpx），两列并排时格子更舒展，
 *   点击热区也大一点，不容易点偏。
 */
.feature-tile {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 30rpx 24rpx;
  background-color: var(--app-card);
}

/* 点按反馈：轻微压暗，确认点中了 */
.feature-tile:active {
  background-color: var(--app-card-2);
}

/*
 * 图标：与列表条目同尺寸（40rpx 方框 / 20px），
 * 换成弹性宽度把剩余空间让给文字和箭头。
 */
.feature-icon {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
}

/* 文字占满中间，把 › 顶到最右
   ★ 字号与列表条目一致（28rpx），不要为了"放得下"而缩小 ★ */
.feature-name {
  flex: 1;
  font-size: 28rpx;
  color: var(--app-text);
  /* 名字过长时省略，不要撑破格子 */
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 右侧箭头：与列表条目的 menu-arrow 同一视觉 */
.feature-arrow {
  font-size: 28rpx;
  color: var(--app-text-3);
  line-height: 1;
  flex-shrink: 0;
}

.menu-list {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 28rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.menu-item:last-child {
  border-bottom: none;
}

/*
  菜单图标：线性描边图标（components/LineIcon.vue）
  固定一个 40rpx 的方框，图标在里面居中 ——
  这样每个条目的图标对齐，不会因为图形本身宽窄不一而参差不齐。

  ★ 尺寸换算 ★
    LineIcon 的 size 单位是 px（20px ≈ 40rpx，按 750rpx 设计稿算），
    外框也用 rpx，两者对得上。
*/
.menu-icon {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
}

.menu-name {
  flex: 1;
  font-size: 28rpx;
  color: var(--app-text);
}

.menu-value {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.menu-arrow {
  font-size: 32rpx;
  color: var(--app-text-3);
}

.version-tip {
  text-align: center;
  margin-top: 48rpx;
}

.version-text {
  font-size: 22rpx;
  color: var(--app-text-3);
}

</style>
