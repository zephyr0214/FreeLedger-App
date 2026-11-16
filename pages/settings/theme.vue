<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="主题外观" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
      <!-- 深浅模式：下拉选择 -->
      <view class="section">
        <text class="section-title">深浅模式</text>
        <view class="select-row" @click="showModeSheet = true">
          <view class="select-left">
            <LineIcon :name="currentMode.icon" :size="20" :color="primaryColor" />
            <view class="select-texts">
              <text class="select-name">{{ currentMode.name }}</text>
              <text class="select-desc">{{ currentMode.desc }}</text>
            </view>
          </view>
          <text class="select-arrow">›</text>
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
        <text class="section-title">图标配置</text>
        <view class="card txn-setting-card">
          <view class="txn-size-head">
            <view class="txn-preview-area">
              <view class="txn-preview-box" :style="txnPreviewBoxStyle">
                <CategoryGlyph icon="1F35C" :size="txnPreviewMetrics.icon + 'rpx'" />
              </view>
            </view>
            <view class="txn-size-info">
              <text class="txn-size-name">当前预览</text>
              <text class="txn-size-desc">{{ txnPreviewDesc }}</text>
            </view>
          </view>

          <!-- 图标样式：放在预览和大小调整之间 -->
          <view class="style-inline" @click="showStyleSheet = true">
            <view class="style-inline-left">
              <image class="select-style-img" :src="emojiPreview(currentStyle.key)" mode="aspectFit" />
              <view class="select-texts">
                <text class="select-name">图标样式</text>
                <text class="select-desc">{{ currentStyle.name }} {{ currentStyle.desc }}</text>
              </view>
            </view>
            <text class="select-arrow">›</text>
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
              :block-size="20"
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
              <text class="setting-row-desc">流水左侧图标显示浅色方底</text>
            </view>
            <switch
              :checked="settingStore.txnIconShowBg"
              :color="primaryColor"
              @change="onTxnBgChange"
            />
          </view>

          <view v-if="settingStore.txnIconShowBg" class="shape-settings">
            <view class="setting-divider" />

            <view class="setting-subhead">
              <text class="setting-row-name">背景形状</text>
              <text class="setting-row-desc">{{ txnBgRoundName }}</text>
            </view>

            <view class="size-slider">
              <slider
                :value="txnBgRoundIndex"
                :min="0"
                :max="4"
                :step="1"
                :active-color="primaryColor"
                :background-color="sliderInactiveColor"
                :block-size="20"
                @changing="onRoundMove"
                @change="onRoundEnd"
              />
            </view>

            <view class="size-labels size-labels--last">
              <text
                v-for="(r, i) in txnIconRounds"
                :key="r.key"
                class="size-label"
                :class="{ active: txnBgRoundIndex === i }"
                @click="setTxnRound(i)"
              >{{ r.name }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 深浅模式 / 图标样式：与账户选择面板同款底部单选弹层 -->
    <OptionPickerSheet
      v-model="showModeSheet"
      title="深浅模式"
      :options="modeOptions"
      :selected-key="themeMode"
      @picked="onModePicked"
    />
    <OptionPickerSheet
      v-model="showStyleSheet"
      title="图标样式"
      :options="emojiStyleOptions"
      :selected-key="settingStore.emojiStyle"
      @picked="onStylePicked"
    />

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
import { ref, computed, watch } from 'vue'
import PageNav from '@/components/PageNav.vue'
import LineIcon from '@/components/LineIcon.vue'
import CategoryGlyph from '@/components/CategoryGlyph.vue'
import OptionPickerSheet from '@/components/OptionPickerSheet.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { THEME_PRESETS, THEME_MODE } from '@/utils/theme.js'
import { EMOJI_STYLES, emojiImageSrc } from '@/utils/emoji.js'
import { TXN_ICON_SIZES, TXN_ICON_ROUNDS, TXN_ICON_BG_BOX, getTxnIconMetrics, txnIconSizeIndex, getTxnIconRadius } from '@/utils/txnIcon.js'

export default {
  components: { PageNav, LineIcon, CategoryGlyph, OptionPickerSheet, UpdateDialog },
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

    /* ------------------------------------------------ 下拉选择 */

    const showModeSheet = ref(false)
    const showStyleSheet = ref(false)

    const modeOptions = computed(() =>
      modes.map((m) => ({ key: m.key, label: m.name, desc: m.desc, icon: m.icon }))
    )

    const currentMode = computed(() => {
      const m = modes.find((x) => x.key === themeMode.value)
      return m || modes[0]
    })

    function onModePicked(opt) {
      if (opt && opt.key) setMode(opt.key)
    }

    /* ------------------------------------------------ 图标样式 */

    const emojiStyles = EMOJI_STYLES

    const currentStyle = computed(() => {
      const s = emojiStyles.find((x) => x.key === settingStore.emojiStyle)
      return s || emojiStyles[0]
    })

    const emojiStyleOptions = computed(() =>
      emojiStyles.map((s) => ({
        key: s.key,
        label: s.name,
        desc: s.desc,
        image: emojiPreview(s.key)
      }))
    )

    /** 样式选择行里的预览图（60 档缩略图） */
    function emojiPreview(styleKey) {
      return emojiImageSrc('1F600', 60, styleKey)
    }

    function onStylePicked(opt) {
      if (opt && opt.key) settingStore.setEmojiStyle(opt.key)
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

    /* ------------------------------------------------ 背景形状 */

    const txnIconRounds = TXN_ICON_ROUNDS
    const txnBgRoundIndex = ref(settingStore.txnIconBgRound)

    watch(() => settingStore.txnIconBgRound, (v) => {
      txnBgRoundIndex.value = v
    })

    const txnBgRoundName = computed(() => {
      const r = TXN_ICON_ROUNDS[txnBgRoundIndex.value] || TXN_ICON_ROUNDS[2]
      return r.name
    })

    /** 预览下方的说明：背景关闭时不再显示形状名 */
    const txnPreviewDesc = computed(() => {
      if (!settingStore.txnIconShowBg) return `${txnSizeLabel.value} · 无背景`
      return `${txnSizeLabel.value} · ${txnBgRoundName.value}`
    })

    /**
     * 左上角预览：真实尺寸 + 真实背景色 + 当前圆角
     *
     * 背景开关关闭时预览不画底色（和实际流水一致），
     * 但外框仍按当前图标尺寸显示，用户能看到大小变化。
     */
    const txnPreviewBoxStyle = computed(() => {
      const bgOn = settingStore.txnIconShowBg
      const size = bgOn ? TXN_ICON_BG_BOX : txnPreviewMetrics.value.box
      return {
        width: `${size}rpx`,
        height: `${size}rpx`,
        borderRadius: bgOn ? getTxnIconRadius(txnBgRoundIndex.value) : '0',
        backgroundColor: bgOn ? primaryColor.value + '22' : 'transparent'
      }
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

    function onRoundMove(e) {
      const v = eventValue(e)
      if (Number.isFinite(v)) txnBgRoundIndex.value = Math.max(0, Math.min(4, Math.round(v)))
    }

    function onRoundEnd(e) {
      onRoundMove(e)
      settingStore.setTxnIconBgRound(txnBgRoundIndex.value)
    }

    function setTxnRound(index) {
      const i = Math.max(0, Math.min(4, Number(index) || 0))
      txnBgRoundIndex.value = i
      settingStore.setTxnIconBgRound(i)
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
      presets, themeMode, themePreset,
      showModeSheet, showStyleSheet, modeOptions, currentMode, onModePicked,
      emojiStyles, emojiStyleOptions, currentStyle, onStylePicked, emojiPreview,
      txnIconSizes, txnSizeIndex, txnSizeLabel, txnPreviewMetrics, txnPreviewBoxStyle, txnPreviewDesc, sliderInactiveColor,
      txnIconRounds, txnBgRoundIndex, txnBgRoundName,
      onSizeMove, onSizeEnd, setTxnSize, onTxnBgChange,
      onRoundMove, onRoundEnd, setTxnRound,
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
/* 下拉选择行 */
.select-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 24rpx 28rpx;
  background-color: var(--app-card);
  border-radius: 20rpx;
}

.select-left {
  display: flex;
  align-items: center;
  gap: 20rpx;
  min-width: 0;
}

.select-texts {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  min-width: 0;
}

.select-name {
  font-size: 28rpx;
  color: var(--app-text);
}

.select-desc {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.select-style-img {
  width: 44rpx;
  height: 44rpx;
  flex-shrink: 0;
}

.select-arrow {
  font-size: 32rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
}

/* 图标配置卡片里的样式行（预览下方、大小滑块上方） */
.style-inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 20rpx 0;
  border-top: 1rpx solid var(--app-line);
  border-bottom: 1rpx solid var(--app-line);
  margin-bottom: 18rpx;
}

.style-inline-left {
  display: flex;
  align-items: center;
  gap: 16rpx;
  min-width: 0;
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

.txn-preview-area {
  width: 120rpx;
  height: 120rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* 真实尺寸 + 真实底色 + 当前圆角的预览块 */
.txn-preview-box {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: width 0.15s, height 0.15s, border-radius 0.15s, background-color 0.15s;
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

.size-labels--last {
  border-bottom: none;
  padding-bottom: 0;
}

.setting-divider {
  height: 1rpx;
  background-color: var(--app-line);
  margin-top: 22rpx;
}

.setting-subhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 0 4rpx;
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
