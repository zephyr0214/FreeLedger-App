<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="主题外观" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
      <!-- 深浅模式 -->
      <view class="section">
        <text class="section-title">深浅模式</text>
        <view class="mode-list">
          <view
            v-for="m in modes"
            :key="m.key"
            class="mode-row"
            @click="setMode(m.key)"
          >
            <view class="mode-icon">
              <LineIcon :name="m.icon" :size="20" :color="primaryColor" />
            </view>
            <view class="mode-info">
              <text class="mode-name">{{ m.name }}</text>
              <text class="mode-desc">{{ m.desc }}</text>
            </view>
            <view class="radio" :class="{ checked: themeMode === m.key }">
              <view
                v-if="themeMode === m.key"
                class="radio-dot"
                :style="{ backgroundColor: primaryColor }"
              />
            </view>
          </view>
        </view>
      </view>

      <!-- 主题色 -->
      <view class="section">
        <text class="section-title">主题色</text>
        <view class="preset-grid">
          <view
            v-for="p in presets"
            :key="p.key"
            class="preset-cell"
            @click="setPreset(p.key)"
          >
            <view
              class="preset-swatch"
              :class="{ active: themePreset === p.key }"
              :style="{ backgroundColor: p.primary }"
            >
              <text v-if="themePreset === p.key" class="preset-check">✓</text>
            </view>
            <text
              class="preset-name"
              :style="{ color: themePreset === p.key ? 'var(--app-text)' : 'var(--app-text-3)' }"
            >{{ p.name }}</text>
          </view>
        </view>
      </view>

      <view class="bottom-space" />
    </scroll-view>
  </view>
</template>

<script>
import { computed } from 'vue'
import PageNav from '@/components/PageNav.vue'
import LineIcon from '@/components/LineIcon.vue'
import { useSettingStore } from '@/stores/setting.js'
import { THEME_PRESETS, THEME_MODE } from '@/utils/theme.js'

export default {
  components: { PageNav, LineIcon },
  setup() {
    const settingStore = useSettingStore()

    const presets = THEME_PRESETS

    /**
     * 深浅模式的三种选项
     *
     * ★ 用线性图标，不用 emoji ★
     *   emoji 是彩色位图，各系统长得完全不一样，
     *   也没法跟随主题色。改成 utils/lineIcons.js 里的描边图标：
     *     auto —— 半亮半暗的圆（跟随系统）
     *     sun  —— 太阳（浅色）
     *     moon —— 月亮（深色）
     */
    const modes = [
      { key: THEME_MODE.SYSTEM, icon: 'auto', name: '跟随系统', desc: '随手机深浅色自动切换' },
      { key: THEME_MODE.LIGHT, icon: 'sun', name: '浅色', desc: '始终使用浅色主题' },
      { key: THEME_MODE.DARK, icon: 'moon', name: '深色', desc: '始终使用深色主题' }
    ]

    const themeMode = computed(() => settingStore.settings.themeMode)
    const themePreset = computed(() => settingStore.settings.themePreset)
    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    async function setMode(key) {
      await settingStore.setThemeMode(key)
      uni.showToast({ title: '已切换', icon: 'none' })
    }

    async function setPreset(key) {
      await settingStore.setThemePreset(key)
    }

    function goBack() {
      uni.navigateBack()
    }

    return {
      presets, modes, themeMode, themePreset,
      primaryColor, pageStyle,
      setMode, setPreset, goBack, settingStore
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

.section {
  margin-top: 32rpx;
}

.section-title {
  font-size: 24rpx;
  color: var(--app-text-3);
  padding-left: 8rpx;
  display: block;
  margin-bottom: 12rpx;
}

/* 模式 */
.mode-list {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
}

.mode-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 28rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.mode-row:last-child {
  border-bottom: none;
}

/* 模式图标（线性描边图标，size 单位是 px） */
.mode-icon {
  width: 40rpx;
  height: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.mode-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.mode-name {
  font-size: 28rpx;
  color: var(--app-text);
}

.mode-desc {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.radio {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 2rpx solid var(--app-line);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.radio.checked {
  border-color: var(--app-primary);
}

.radio-dot {
  width: 22rpx;
  height: 22rpx;
  border-radius: 50%;
}

/* 预设色 */
.preset-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 24rpx;
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 28rpx;
}

.preset-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10rpx;
  width: calc((100% - 96rpx) / 4);
}

.preset-swatch {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preset-swatch.active {
  outline: 4rpx solid var(--app-text);
  outline-offset: 4rpx;
}

.preset-check {
  color: #ffffff;
  font-size: 36rpx;
  font-weight: 600;
}

.preset-name {
  font-size: 22rpx;
}

</style>
