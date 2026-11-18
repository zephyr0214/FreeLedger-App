<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <AppHeader @avatar-click="goProfile">
      <!--
        右上角：更新日志
        样式和首页 / 统计页 / 账户页的胶囊按钮完全一致。

        ★ 为什么这里不再是「关于与说明」★
          「关于与说明」是「App 本身是什么」的说明性内容，
          和「记账按钮设置 / AI 配置 / 主题 / 数据与备份」一样属于系统设置，
          所以它被移进了下面的「系统设置」列表。
          右上角这个位置留给「更新日志」—— 用户想看「这次更新了什么」
          时不用先点进设置列表，一步直达。
      -->
      <template #right>
        <HeaderAction @action-click="goChangelog">更新日志</HeaderAction>
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

        ★ 记账功能（2×4 宫格）★
          分类、汇率、预算、标签 / 借入、借出、周期、报销
          —— 原「基础功能 / 拓展功能」合并为一个宫格，
             上图标下文字。

        ★ 记账设置（列表）★
          记账按钮设置、AI 智能配置
          —— 「怎么记账」的行为配置，带副标题说明当前状态。

        ★ 系统设置（列表）★
          主题外观、数据与备份、关于与说明、检查更新
          —— App 本身的表现，跟记账内容无关。

        ★ 账户管理的入口已删除 ★
          账户已经在底部 tabBar 里了，再放一个入口是重复的。
      -->

      <!--
        记账功能：2 行 × 4 列宫格

        ★ 原「基础功能 / 拓展功能」两组合并 ★
          用户要求合并为一个「记账功能」，用 8 个格子（2×4）展示，
          上图标、下文字。顺序保持原来的阅读顺序：
            分类 / 标签 / 预算 / 汇率
            借入 / 借出 / 周期 / 报销
      -->
      <view class="menu-group">
        <text class="menu-title">记账功能</text>
        <view class="feature-grid">
          <view
            v-for="item in featureItems"
            :key="item.key"
            class="feature-tile"
            @click="onMenuClick(item)"
          >
            <LineIcon
              :name="item.icon"
              :size="24"
              :color="primaryColor"
              class="feature-icon"
            />
            <text class="feature-name">{{ item.name }}</text>
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
        <text class="version-text">自由记 v{{ APP_VERSION }}</text>
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

    <!-- 更新弹窗（检查更新入口 / 开屏静默检查共用同一份 store 状态） -->
    <!-- 弹窗宿主：外部打开 JSON 时可能在任意一页弹出，
         缺了这一行就退化成原生弹窗，样式与别处不一致 -->
    <AppDialog />
    <UpdateDialog />
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
import { APP_VERSION } from '@/utils/version.js'
import { useUpdateStore } from '@/stores/update.js'
import AppDialog from '@/components/AppDialog.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'

export default {
  components: { AppHeader, HeaderAction, LineIcon, AppTabBar, AppDialog, UpdateDialog },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()
    const uiStore = useUiStore()

    const stats = ref({ txnCount: 0, accountCount: 0, dayCount: 0 })
    const backupHint = ref('')

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    /**
     * 记账功能：8 个入口，按 2 行 × 4 列展示
     *
     * 顺序：
     *   第一行：分类 / 汇率 / 预算 / 标签
     *   第二行：借入 / 借出 / 周期 / 报销
     *
     * ★ 原「基础功能 / 拓展功能」两组已合并 ★
     *   用户要求合并为一个「记账功能」宫格，不再分两段标题。
     *   借入 / 借出仍用 ?type 区分方向：
     *     income  = 借入（钱借进来，收入方向）
     *     expense = 借出（钱借出去，支出方向）
     */
    const featureItems = [
      { key: 'category', icon: 'category', name: '分类管理', route: '/pages/settings/category' },
      { key: 'rate', icon: 'rate', name: '今日汇率', route: '/pages/rate/index' },
      { key: 'budget', icon: 'budget', name: '预算管理', route: '/pages/settings/budget' },
      { key: 'tag', icon: 'tag', name: '标签管理', route: '/pages/settings/tag' },
      { key: 'loanIn', icon: 'loan-in', name: '借入管理', route: '/pages/loan/manage?type=income' },
      { key: 'loanOut', icon: 'loan-out', name: '借出管理', route: '/pages/loan/manage?type=expense' },
      { key: 'cycle', icon: 'cycle', name: '周期管理', route: '/pages/settings/cycle' },
      { key: 'reimburse', icon: 'reimburse', name: '报销管理', route: '/pages/loan/reimburse' }
    ]

    /**
     * 列表形式的设置项，分两组。
     *
     * ★ 记账设置 ★
     *   记账按钮设置、AI 智能配置
     *   —— 「怎么记账 / 记完看什么」的行为配置，带副标题说明当前状态。
     *
     * ★ 系统设置 ★
     *   主题外观、数据与备份、关于与说明、检查更新
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
        { key: 'ai', icon: 'ai', name: 'AI 智能配置', value: aiLabel.value, route: '/pages/settings/ai' },
        {
          key: 'statsPanels',
          icon: 'stats',
          name: '统计组件管理',
          route: '/pages/settings/stats-panels'
        },
      ]
      },
      {
        title: '系统设置',
        items: [
          { key: 'theme', icon: 'theme', name: '主题外观', value: themeLabel.value, route: '/pages/settings/theme' },
          { key: 'data', icon: 'data', name: '数据与备份', value: backupHint.value, route: '/pages/settings/data' },
          /*
           * 「关于与说明」从右上角移到这里。
           *
           * ★ 为什么放系统设置而不是别处 ★
           *   它讲的是「App 本身」（隐私说明、数据安全、技术栈），
           *   和记账内容无关 —— 和「主题外观 / 数据与备份」同一类。
           *   放这一组里，用户想找它时会自然往下翻到这里。
           */
          { key: 'about', icon: 'about', name: '关于与说明', route: '/pages/settings/about' },
          /*
           * 「检查更新」没有 route —— onMenuClick 对它走 store 动作
           * （手动检查，无新版/失败都有提示），
           * 有新版本时更新弹窗直接出现在本页（UpdateDialog 读 store）。
           */
          /*
           * ★ 「测试更新」已删除（用户本轮要求）★
           *   用户原话：「删除测试弹窗的入口及其逻辑」。
           *
           *   这个入口的生命周期：加 → 删 → 加 → 删 → 加 → **本次再删**。
           *   它每次都是「为了验证更新链路临时加上」，
           *   验证完就该消失 —— 它会把当前版本当新版本弹给用户，
           *   留在正式版里是一个误报源。
           *
           *   ★ 这次连能力一起删 ★
           *     api 的 ignoreVersion 选项、store 的 checkForUpdateTest、
           *     弹窗的 isTest 徽标全部去掉，
           *     不留「以后顺手接回去」的暗路。
           */
          { key: 'update', icon: 'auto', name: '检查更新' }
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
      if (item.key === 'update') {
        // 检查更新：手动检查，无新版/失败都有提示
        useUpdateStore().checkForUpdate(false)
        return
      }
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

    /** 右上角：更新日志 */
    function goChangelog() {
      uni.navigateTo({ url: '/pages/settings/changelog' })
    }

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await accountStore.load()
      await loadStats()
    })

    onShow(async () => {
      if (settingStore.loaded) {
        /*
         * ★ 必须重新读库，不能只依赖内存里的 store ★
         *   「我的」页的副标题（主题外观 / AI 智能配置 / 记账按钮）
         *   全都读 settingStore.settings。
         *
         *   问题：用户在 AI 页保存后返回，setAi() 确实更新了内存 store，
         *   但下面这些场景内存值会落后 ——
         *     · App 重启后（store 是初始默认值，ai.apiKey 为空）
         *     · 从别处（如备份导入）改了设置
         *   表现就是「明明配置了，这里还显示未配置」。
         *
         *   所以每次进入本页都重新 load() 一次。
         *   load() 只是读一张很小的 setting 表，开销可以忽略。
         */
        await settingStore.load()
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
      // 版本号从 utils/version.js 取，和「关于」页共用同一个来源
      APP_VERSION,
      primaryColor, pageStyle, menuGroups, featureItems,
      themeLabel, aiLabel, quickAddLabel,
      onAddTap, onAddHoldEnd,
      onMenuClick, goProfile, goChangelog
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

/* 个人信息卡 */
/*
 * 个人信息卡（头像 + 名称 + 签名）：主题色渐变
 *
 * ★ 用户本轮第 2 条 ★
 *   用户原话「我的页面最上方的头像名称个签组件也添加渐变主题色，暗色删除」。
 *   底色用和首页概览卡完全相同的那条 gradient（--app-hero-from → --app-card），
 *   不另写一条：同一个设计语言写两次，迟早会一边改了另一边没改。
 *   ★ 暗色下不显示渐变 ★
 *     不需要这里写媒体查询：--app-hero-from 在暗色下等于 --app-card，
 *     gradient 两端同色就是「没有渐变」。
 */
.profile-card {
  display: flex;
  align-items: center;
  gap: 24rpx;
  background: linear-gradient(135deg, var(--app-hero-from), var(--app-card));
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
 * ★ 记账功能：2 行 × 4 列宫格 ★
 *
 * 外层是一张大卡片（和白底列表同款圆角/底色），
 * 内部用 grid 排成四列，8 个格子自然折成两行。
 *
 * ★ 每格内部是纵向排列 ★
 *   上图标、下文字，居中显示；不再放右侧箭头，
 *   8 个入口在视觉上保持同样重量。
 */
.feature-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rpx;
  background-color: var(--app-line);
  border-radius: 20rpx;
  overflow: hidden;
}

.feature-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  padding: 26rpx 6rpx;
  background-color: var(--app-card);
  min-width: 0;
}

/* 点按反馈：轻微压暗，确认点中了 */
.feature-tile:active {
  background-color: var(--app-card-2);
}

.feature-icon {
  width: 48rpx;
  height: 48rpx;
  flex-shrink: 0;
}

.feature-name {
  max-width: 100%;
  font-size: 24rpx;
  color: var(--app-text);
  text-align: center;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
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
