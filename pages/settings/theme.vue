<template>
  <view class="app-page" :style="pageStyle">
    <PageNav title="主题外观" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y :style="{ height: scrollHeight }">
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
            <text class="mode-icon">{{ m.icon }}</text>
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

      <!-- 预览 -->
      <view class="section">
        <text class="section-title">预览</text>
        <view class="preview-card">
          <view class="preview-head">
            <view class="preview-avatar" :style="{ backgroundColor: primaryColor }">
              <text class="preview-avatar-text">记</text>
            </view>
            <view class="preview-info">
              <text class="preview-name">记账人</text>
              <text class="preview-date">10月27日 周一</text>
            </view>
          </view>
          <text class="preview-label">本月结余</text>
          <text class="preview-amount" :style="{ color: 'var(--app-text)' }">¥ 2,480.50</text>
          <view class="preview-row">
            <view class="preview-item">
              <text class="preview-item-label">支出</text>
              <text class="preview-item-value">¥ 1,519.50</text>
            </view>
            <view class="preview-item">
              <text class="preview-item-label">收入</text>
              <text class="preview-item-value">¥ 4,000.00</text>
            </view>
          </view>
          <view class="preview-btn" :style="{ backgroundColor: primaryColor }">
            <text class="preview-btn-text">记一笔</text>
          </view>
        </view>
      </view>

      <!-- 隐私模式 -->
      <view class="section">
        <text class="section-title">隐私</text>
        <view class="switch-row">
          <view class="switch-info">
            <text class="switch-name">金额脱敏</text>
            <text class="switch-desc">打开后所有页面金额显示为 ****</text>
          </view>
          <switch
            :checked="privacyMode"
            :color="primaryColor"
            @change="onPrivacyChange"
          />
        </view>
      </view>

      <view class="bottom-space" />
    </scroll-view>
  </view>
</template>

<script>
import { computed } from 'vue'
import PageNav from '@/components/PageNav.vue'
import { useSettingStore } from '@/stores/setting.js'
import { THEME_PRESETS, THEME_MODE } from '@/utils/theme.js'

export default {
  components: { PageNav },
  setup() {
    const settingStore = useSettingStore()

    const presets = THEME_PRESETS

    const modes = [
      { key: THEME_MODE.SYSTEM, icon: '🌗', name: '跟随系统', desc: '随手机深浅色自动切换' },
      { key: THEME_MODE.LIGHT, icon: '☀️', name: '浅色', desc: '始终使用浅色主题' },
      { key: THEME_MODE.DARK, icon: '🌙', name: '深色', desc: '始终使用深色主题' }
    ]

    const themeMode = computed(() => settingStore.settings.themeMode)
    const themePreset = computed(() => settingStore.settings.themePreset)
    const privacyMode = computed(() => settingStore.privacyMode)
    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    const scrollHeight = computed(() => {
      const info = uni.getSystemInfoSync()
      return `${info.windowHeight - (info.statusBarHeight || 20) - 44}px`
    })

    async function setMode(key) {
      await settingStore.setThemeMode(key)
      uni.showToast({ title: '已切换', icon: 'none' })
    }

    async function setPreset(key) {
      await settingStore.setThemePreset(key)
    }

    async function onPrivacyChange(e) {
      await settingStore.setPrivacyMode(e.detail.value)
    }

    function goBack() {
      uni.navigateBack()
    }

    return {
      presets, modes, themeMode, themePreset, privacyMode,
      primaryColor, pageStyle, scrollHeight,
      setMode, setPreset, onPrivacyChange, goBack
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

.mode-icon {
  font-size: 34rpx;
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

/* 预览 */
.preview-card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 28rpx;
}

.preview-head {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 28rpx;
}

.preview-avatar {
  width: 68rpx;
  height: 68rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-avatar-text {
  color: #ffffff;
  font-size: 30rpx;
  font-weight: 600;
}

.preview-info {
  display: flex;
  flex-direction: column;
  gap: 2rpx;
}

.preview-name {
  font-size: 26rpx;
  color: var(--app-text);
  font-weight: 500;
}

.preview-date {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.preview-label {
  font-size: 22rpx;
  color: var(--app-text-3);
  display: block;
}

.preview-amount {
  font-size: 56rpx;
  font-weight: 600;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
}

.preview-row {
  display: flex;
  gap: 40rpx;
  margin-top: 20rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid var(--app-line);
}

.preview-item {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.preview-item-label {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.preview-item-value {
  font-size: 26rpx;
  color: var(--app-text-2);
}

.preview-btn {
  margin-top: 24rpx;
  height: 80rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-btn-text {
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 500;
}

/* 开关 */
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 28rpx;
  gap: 20rpx;
}

.switch-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.switch-name {
  font-size: 28rpx;
  color: var(--app-text);
}

.switch-desc {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.bottom-space {
  height: 60rpx;
}
</style>
