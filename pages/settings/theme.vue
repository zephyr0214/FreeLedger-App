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

      <view class="section">
        <text class="section-title">图标样式</text>
        <view class="mode-list">
          <view
            v-for="s in emojiStyles"
            :key="s.key"
            class="mode-row"
            @click="setEmojiStyle(s.key)"
          >
            <view class="style-preview">
              <text v-if="s.key === 'system'" class="style-emoji">😀</text>
              <image
                v-else
                class="style-img"
                :src="emojiPreview(s.key)"
                mode="aspectFit"
              />
            </view>
            <view class="mode-info">
              <text class="mode-name">{{ s.name }}</text>
              <text class="mode-desc">{{ s.desc }}</text>
            </view>
            <view class="radio" :class="{ checked: settingStore.emojiStyle === s.key }">
              <view
                v-if="settingStore.emojiStyle === s.key"
                class="radio-dot"
                :style="{ backgroundColor: primaryColor }"
              />
            </view>
          </view>
        </view>
      </view>

      <view class="section">
        <text class="section-title">交易流水图标</text>
        <view class="card txn-setting-card">
          <view class="txn-size-head">
            <view class="txn-size-preview">
              <CategoryGlyph icon="1F35C" :size="txnPreviewMetrics.icon + 'rpx'" />
            </view>
            <view class="txn-size-info">
              <text class="txn-size-name">图标大小</text>
              <text class="txn-size-desc">{{ txnSizeLabel }}</text>
            </view>
          </view>

          <view class="size-slider">
            <!-- 用 uni-app 原生 slider，避免引入额外 TS 组件 -->
            <slider
              :value="txnSizeIndex"
              :min="0"
              :max="4"
              :step="1"
              :active-color="primaryColor"
              :background-color="sliderInactiveColor"
              block-size="20"
              @changing="onSizeMove"
              @change="onSizeEnd"
            />
          </view>

          <view class="size-labels">
            <text
              v-for="(s, i) in txnIconSizes"
              :key="s.key"
              class="size-label"
              :class="{ active: txnSizeIndex === i }"
              @click="setTxnSize(i)"
            >{{ s.name }}</text>
          </view>

          <view class="setting-row">
            <view class="setting-row-text">
              <text class="setting-row-name">分类背景色</text>
              <text class="setting-row-desc">流水左侧图标显示浅色圆底</text>
            </view>
            <switch
              :checked="settingStore.txnIconShowBg"
              :color="primaryColor"
              @change="onTxnBgChange"
            />
          </view>
        </view>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
import { ref, computed, watch } from 'vue'
import PageNav from '@/components/PageNav.vue'
import LineIcon from '@/components/LineIcon.vue'
import CategoryGlyph from '@/components/CategoryGlyph.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { THEME_PRESETS, THEME_MODE } from '@/utils/theme.js'
import { EMOJI_STYLES, emojiImageSrc } from '@/utils/emoji.js'
import { TXN_ICON_SIZES, getTxnIconMetrics, txnIconSizeIndex } from '@/utils/txnIcon.js'

export default {
  components: { PageNav, LineIcon, CategoryGlyph, UpdateDialog },
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

    /* ------------------------------------------------ 图标样式 */

    const emojiStyles = EMOJI_STYLES

    /** 样式选择行里的预览图（60 档缩略图） */
    function emojiPreview(styleKey) {
      return emojiImageSrc('1F600', 60, styleKey)
    }

    async function setEmojiStyle(key) {
      await settingStore.setEmojiStyle(key)
    }

    /* ------------------------------------------------ 交易流水图标 */

    const txnIconSizes = TXN_ICON_SIZES
    const txnSizeIndex = ref(txnIconSizeIndex(settingStore.txnIconSize))

    // 如果别处改了尺寸（例如备份导入），滑块跟着同步
    watch(() => settingStore.txnIconSize, () => {
      txnSizeIndex.value = txnIconSizeIndex(settingStore.txnIconSize)
    })

    const txnSizeLabel = computed(() => {
      const s = TXN_ICON_SIZES[txnSizeIndex.value] || TXN_ICON_SIZES[3]
      return s.name
    })

    const txnPreviewMetrics = computed(() => {
      const s = TXN_ICON_SIZES[txnSizeIndex.value] || TXN_ICON_SIZES[3]
      return getTxnIconMetrics(s.key)
    })

    /** 原生 slider 的未激活轨道色（深浅模式各一个） */
    const sliderInactiveColor = computed(() => (settingStore.isDark ? '#2E2E31' : '#EBEDF0'))

    /** uni-app 原生 slider / switch 的事件值都在 e.detail.value 里 */
    function eventValue(e) {
      if (e && e.detail && e.detail.value !== undefined) return Number(e.detail.value)
      return Number(e && e.value)
    }

    function onSizeMove(e) {
      const v = eventValue(e)
      if (Number.isFinite(v)) txnSizeIndex.value = Math.max(0, Math.min(4, Math.round(v)))
    }

    function onSizeEnd(e) {
      onSizeMove(e)
      const s = TXN_ICON_SIZES[txnSizeIndex.value] || TXN_ICON_SIZES[3]
      settingStore.setTxnIconSize(s.key)
    }

    function setTxnSize(index) {
      const i = Math.max(0, Math.min(4, Number(index) || 0))
      txnSizeIndex.value = i
      settingStore.setTxnIconSize(TXN_ICON_SIZES[i].key)
    }

    function onTxnBgChange(e) {
      const v = e && e.detail ? e.detail.value : (e && e.value)
      settingStore.setTxnIconShowBg(!!v)
    }

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
      emojiStyles, setEmojiStyle, emojiPreview,
      txnIconSizes, txnSizeIndex, txnSizeLabel, txnPreviewMetrics, sliderInactiveColor,
      onSizeMove, onSizeEnd, setTxnSize, onTxnBgChange,
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

/* 图标样式预览 */
.style-preview {
  width: 64rpx;
  height: 64rpx;
  border-radius: 16rpx;
  background-color: var(--app-card-2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.style-emoji {
  font-size: 40rpx;
  line-height: 1;
}

.style-img {
  width: 48rpx;
  height: 48rpx;
}

/* 交易流水图标设置 */
.txn-setting-card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 24rpx 28rpx;
}

.txn-size-head {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-bottom: 20rpx;
}

.txn-size-preview {
  width: 108rpx;
  height: 108rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.txn-size-info {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.txn-size-name {
  font-size: 28rpx;
  color: var(--app-text);
}

.txn-size-desc {
  font-size: 22rpx;
  color: var(--app-primary);
}

.size-slider {
  padding: 0 8rpx;
}

.size-labels {
  display: flex;
  justify-content: space-between;
  padding: 8rpx 4rpx 20rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.size-label {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.size-label.active {
  color: var(--app-primary);
  font-weight: 600;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding-top: 22rpx;
}

.setting-row-text {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.setting-row-name {
  font-size: 28rpx;
  color: var(--app-text);
}

.setting-row-desc {
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
