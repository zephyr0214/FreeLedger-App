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
        配置条目
        ★ 账户管理的入口已删除 ★
          账户已经在底部 tabBar 里了，再放一个入口是重复的。
      -->
      <view class="menu-group">
        <text class="menu-title">配置</text>
        <view class="menu-list">
          <view
            v-for="item in configItems"
            :key="item.key"
            class="menu-item"
            @click="onMenuClick(item)"
          >
            <text class="menu-icon">{{ item.icon }}</text>
            <text class="menu-name">{{ item.name }}</text>
            <text v-if="item.value" class="menu-value">{{ item.value }}</text>
            <text class="menu-arrow">›</text>
          </view>
        </view>
      </view>

      <view class="version-tip">
        <text class="version-text">记账本 v1.0.0 · 数据全部保存在本机</text>
      </view>

      <view class="bottom-space" />
    </scroll-view>
  </view>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppHeader from '@/components/AppHeader.vue'
import HeaderAction from '@/components/HeaderAction.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { queryOne } from '@/api/db/index.js'
import { daysSinceLastExport } from '@/api/backup.js'

export default {
  components: { AppHeader, HeaderAction },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    const stats = ref({ txnCount: 0, accountCount: 0, dayCount: 0 })
    const exportHint = ref('')
    const budgetCount = ref(0)
    const cycleCount = ref(0)

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    /**
     * 配置条目。
     *
     * ★ 顺序按用户要求 ★
     *   分类管理、标签管理、预算管理、周期管理、主题外观、
     *   AI 智能配置、导出/导入、备份
     *
     * 导出/导入 和 备份 是两个独立条目 —— 它们在同一个页面
     * （/pages/settings/data）里，但入口分开，各自更明确。
     */
    const configItems = computed(() => [
      { key: 'category', icon: '📂', name: '分类管理', route: '/pages/settings/category' },
      { key: 'tag', icon: '🏷️', name: '标签管理', route: '/pages/settings/tag' },
      { key: 'budget', icon: '🎯', name: '预算管理', value: budgetLabel.value, route: '/pages/settings/budget' },
      { key: 'cycle', icon: '🔄', name: '周期管理', value: cycleLabel.value, route: '/pages/settings/cycle' },
      { key: 'theme', icon: '🎨', name: '主题外观', value: themeLabel.value, route: '/pages/settings/theme' },
      { key: 'ai', icon: '🤖', name: 'AI 智能配置', value: aiLabel.value, route: '/pages/settings/ai' },
      { key: 'export', icon: '📤', name: '导出 / 导入', value: exportHint.value, route: '/pages/settings/data?tab=export' },
      { key: 'backup', icon: '💾', name: '备份', value: backupLabel.value, route: '/pages/settings/data?tab=backup' }
    ])

    const themeLabel = computed(() => {
      const modeMap = { system: '跟随系统', light: '浅色', dark: '深色' }
      return modeMap[settingStore.settings.themeMode] || '跟随系统'
    })

    const aiLabel = computed(() => {
      return settingStore.settings.ai && settingStore.settings.ai.apiKey ? '已配置' : '未配置'
    })

    /** 预算管理入口的副标题：已设几个预算 */
    const budgetLabel = computed(() => {
      const n = budgetCount.value
      if (n === 0) return '未设置'
      return `${n} 项`
    })

    /** 周期管理入口的副标题：已设几个固定支出周期 */
    const cycleLabel = computed(() => {
      const n = cycleCount.value
      if (n === 0) return '未设置'
      return `${n} 项`
    })

    /** 备份入口的副标题：自动备份开关状态 */
    const backupLabel = computed(() => {
      return settingStore.settings.autoBackup ? '自动' : '手动'
    })

    async function loadStats() {
      try {
        const txnRow = await queryOne('SELECT COUNT(*) AS c FROM txn WHERE deleted_at IS NULL')
        const dayRow = await queryOne(
          'SELECT COUNT(DISTINCT occurred_day) AS c FROM txn WHERE deleted_at IS NULL'
        )
        const budgetRow = await queryOne('SELECT COUNT(*) AS c FROM budget')
        stats.value = {
          txnCount: Number(txnRow ? txnRow.c : 0),
          accountCount: accountStore.list.length,
          dayCount: Number(dayRow ? dayRow.c : 0)
        }
        budgetCount.value = Number(budgetRow ? budgetRow.c : 0)

        // 周期数量：读 settings 里的 cycles 数组
        const cycles = settingStore.settings.cycles
        cycleCount.value = Array.isArray(cycles) ? cycles.length : 0

        const days = await daysSinceLastExport()
        if (days === Infinity) exportHint.value = '从未导出'
        else if (days === 0) exportHint.value = '今天已导出'
        else exportHint.value = `${days} 天前`
      } catch (e) {
        console.warn('[mine] stats failed', e)
      }
    }

    function onMenuClick(item) {
      if (item.route) {
        uni.navigateTo({ url: item.route })
      }
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
      settingStore, accountStore, stats, exportHint, budgetCount, cycleCount,
      primaryColor, pageStyle, configItems,
      themeLabel, aiLabel, budgetLabel, cycleLabel, backupLabel,
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

.menu-icon {
  font-size: 32rpx;
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
