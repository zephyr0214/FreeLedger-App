<template>
  <view class="app-page" :style="pageStyle">
    <AppHeader :show-date="false" @avatar-click="goProfile" />

    <scroll-view class="page-scroll" scroll-y :style="{ height: scrollHeight }">
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

      <!-- 菜单分组 -->
      <view v-for="group in menuGroups" :key="group.title" class="menu-group">
        <text class="menu-title">{{ group.title }}</text>
        <view class="menu-list">
          <view
            v-for="item in group.items"
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
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { getOverview } from '@/api/stats.js'
import { queryOne } from '@/api/db/index.js'
import { daysSinceLastExport } from '@/api/backup.js'

export default {
  components: { AppHeader },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    const stats = ref({ txnCount: 0, accountCount: 0, dayCount: 0 })
    const exportHint = ref('')

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    const scrollHeight = computed(() => {
      const info = uni.getSystemInfoSync()
      return `${info.windowHeight - (info.statusBarHeight || 20) - 60 - 50}px`
    })

    const menuGroups = computed(() => [
      {
        title: '记账配置',
        items: [
          { key: 'category', icon: '📂', name: '分类管理' },
          { key: 'tag', icon: '🏷️', name: '标签管理' },
          { key: 'account', icon: '💳', name: '账户管理', value: `${stats.value.accountCount} 个` }
        ]
      },
      {
        title: '外观',
        items: [
          { key: 'theme', icon: '🎨', name: '主题外观', value: themeLabel.value }
        ]
      },
      {
        title: '智能',
        items: [
          { key: 'ai', icon: '🤖', name: 'AI 大模型设置', value: aiLabel.value }
        ]
      },
      {
        title: '数据',
        items: [
          { key: 'data', icon: '💾', name: '导出 / 导入 / 备份', value: exportHint.value },
          { key: 'about', icon: 'ℹ️', name: '关于与说明' }
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

        const days = await daysSinceLastExport()
        if (days === Infinity) exportHint.value = '从未导出'
        else if (days === 0) exportHint.value = '今天已导出'
        else exportHint.value = `${days} 天前`
      } catch (e) {
        console.warn('[mine] stats failed', e)
      }
    }

    function onMenuClick(item) {
      const routes = {
        category: '/pages/settings/category',
        tag: '/pages/settings/tag',
        account: '/pages/account/index',
        theme: '/pages/settings/theme',
        ai: '/pages/settings/ai',
        data: '/pages/settings/data',
        about: '/pages/settings/about'
      }
      if (item.key === 'account') {
        uni.switchTab({ url: routes.account })
        return
      }
      if (routes[item.key]) {
        uni.navigateTo({ url: routes[item.key] })
      }
    }

    function goProfile() {
      uni.navigateTo({ url: '/pages/settings/profile' })
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
    })

    return {
      settingStore, accountStore, stats, exportHint,
      primaryColor, pageStyle, scrollHeight, menuGroups, themeLabel, aiLabel,
      onMenuClick, goProfile
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

.bottom-space {
  height: 60rpx;
}
</style>
