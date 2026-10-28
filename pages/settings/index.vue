<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="goBack">‹</text>
        <text class="nav-title">设置</text>
        <text class="nav-placeholder" />
      </view>
    </view>

    <scroll-view class="page-scroll" scroll-y>
      <view v-for="group in groups" :key="group.title" class="menu-group">
        <text class="menu-title">{{ group.title }}</text>
        <view class="menu-list">
          <view
            v-for="item in group.items"
            :key="item.key"
            class="menu-item"
            @click="onClick(item)"
          >
            <text class="menu-icon">{{ item.icon }}</text>
            <text class="menu-name">{{ item.name }}</text>
            <text v-if="item.value" class="menu-value">{{ item.value }}</text>
            <text class="menu-arrow">›</text>
          </view>
        </view>
      </view>

      <view class="bottom-space" />
    </scroll-view>
  </view>
</template>

<script>
import { computed, onMounted } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'

export default {
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20
    const pageStyle = computed(() => settingStore.cssVars)


    const groups = computed(() => [
      {
        title: '个人',
        items: [
          { key: 'profile', icon: '👤', name: '个人信息', route: '/pages/settings/profile' }
        ]
      },
      {
        title: '记账配置',
        items: [
          { key: 'category', icon: '📂', name: '分类管理', route: '/pages/settings/category' },
          { key: 'tag', icon: '🏷️', name: '标签管理', route: '/pages/settings/tag' },
          {
            key: 'defaultAccount',
            icon: '💳',
            name: '默认账户',
            value: defaultAccountName.value,
            route: '__pickDefaultAccount'
          }
        ]
      },
      {
        title: '外观',
        items: [
          {
            key: 'theme',
            icon: '🎨',
            name: '主题外观',
            value: themeLabel.value,
            route: '/pages/settings/theme'
          }
        ]
      },
      {
        title: '智能',
        items: [
          {
            key: 'ai',
            icon: '🤖',
            name: 'AI 大模型',
            value: aiLabel.value,
            route: '/pages/settings/ai'
          }
        ]
      },
      {
        title: '数据',
        items: [
          { key: 'data', icon: '💾', name: '导出 / 导入 / 备份', route: '/pages/settings/data' },
          { key: 'about', icon: 'ℹ️', name: '关于', route: '/pages/settings/about' }
        ]
      }
    ])

    const defaultAccountName = computed(() => {
      const id = settingStore.settings.defaultAccountId
      const acc = accountStore.list.find((a) => a.id === id)
      return acc ? acc.name : '未设置'
    })

    const themeLabel = computed(() => {
      const modeMap = { system: '跟随系统', light: '浅色', dark: '深色' }
      return modeMap[settingStore.settings.themeMode] || '跟随系统'
    })

    const aiLabel = computed(() =>
      settingStore.settings.ai && settingStore.settings.ai.apiKey ? '已配置' : '未配置'
    )

    function onClick(item) {
      if (item.route === '__pickDefaultAccount') {
        pickDefaultAccount()
        return
      }
      uni.navigateTo({ url: item.route })
    }

    function pickDefaultAccount() {
      const list = accountStore.list
      if (list.length === 0) {
        uni.showToast({ title: '请先添加账户', icon: 'none' })
        return
      }
      uni.showActionSheet({
        itemList: list.map((a) => a.name),
        success: async (res) => {
          const acc = list[res.tapIndex]
          await settingStore.update({ defaultAccountId: acc.id })
          uni.showToast({ title: '已设为默认', icon: 'success' })
        }
      })
    }

    function goBack() {
      uni.navigateBack()
    }

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await accountStore.load()
    })

    return {
      statusBarHeight, pageStyle, groups,
      defaultAccountName, themeLabel, aiLabel,
      onClick, goBack, settingStore
    }
  }
}
</script>

<style scoped>
.nav-bar {
  background-color: var(--app-bg);
  flex-shrink: 0;
}

.nav-inner {
  height: 88rpx;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
}

.nav-back {
  font-size: 48rpx;
  color: var(--app-text);
  width: 100rpx;
  line-height: 1;
}

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.nav-placeholder {
  width: 100rpx;
}

.page-scroll {
  padding: 0 32rpx;
}

.menu-group {
  margin-top: 28rpx;
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

</style>
