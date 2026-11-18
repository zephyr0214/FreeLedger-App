<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="记账按钮" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
      <!--
        ★ 顶部预览 ★
          和原来的「底部一句话说明」相比，这里直接画出记账按钮本体：
          左边是悬浮的 +，右边分别写清短按 / 长按当前会做什么。
          用户一进页面就能看到结果，不用先读两段设置再自己脑补。
      -->
      <view class="preview-card">
        <view class="preview-fab-wrap">
          <view class="preview-fab" :style="{ backgroundColor: primaryColor }">
            <text class="preview-plus">+</text>
          </view>
        </view>

        <view class="preview-info">
          <text class="preview-kicker">当前效果</text>
          <view class="preview-line">
            <text class="preview-key">短按</text>
            <text class="preview-val">{{ tapLabel }}</text>
          </view>
          <view class="preview-line">
            <text class="preview-key">长按</text>
            <text class="preview-val">{{ holdLabel }}</text>
          </view>
        </view>
      </view>

      <!-- 长按 + 号 -->
      <view class="section">
        <text class="section-title">长按 + 号</text>
        <view class="card">
          <view
            v-for="opt in actionOptions"
            :key="opt.key"
            class="opt-row"
            :class="{ active: holdAction === opt.key }"
            @click="pick('hold', opt.key)"
          >
            <view class="opt-icon">
              <LineIcon
                v-if="opt.key === 'ai'"
                name="ai"
                :size="20"
                :color="primaryColor"
              />
              <LineIcon
                v-else-if="opt.key === 'manual'"
                name="plusLine"
                :size="20"
                :color="primaryColor"
              />
              <text v-else class="opt-dash">—</text>
            </view>

            <view class="opt-info">
              <text class="opt-name">{{ opt.name }}</text>
              <text class="opt-desc">{{ opt.desc }}</text>
            </view>

            <text
              v-if="holdAction === opt.key"
              class="opt-tick"
              :style="{ color: primaryColor }"
            >✓</text>
          </view>
        </view>
      </view>

      <!-- 短按 + 号 -->
      <view class="section">
        <text class="section-title">短按 + 号</text>
        <view class="card">
          <view
            v-for="opt in actionOptions"
            :key="opt.key"
            class="opt-row"
            :class="{ active: tapAction === opt.key }"
            @click="pick('tap', opt.key)"
          >
            <view class="opt-icon">
              <LineIcon
                v-if="opt.key === 'ai'"
                name="ai"
                :size="20"
                :color="primaryColor"
              />
              <LineIcon
                v-else-if="opt.key === 'manual'"
                name="plusLine"
                :size="20"
                :color="primaryColor"
              />
              <text v-else class="opt-dash">—</text>
            </view>

            <view class="opt-info">
              <text class="opt-name">{{ opt.name }}</text>
              <text class="opt-desc">{{ opt.desc }}</text>
            </view>

            <text
              v-if="tapAction === opt.key"
              class="opt-tick"
              :style="{ color: primaryColor }"
            >✓</text>
          </view>
        </view>
      </view>

      <text class="page-tip">短按和长按互不影响；选择「不响应」后，该手势不会触发任何操作。修改会立即生效，无需保存。</text>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 全局弹窗宿主（组件库重绘的确认框） -->
    <AppDialog />

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import PageNav from '@/components/PageNav.vue'
import LineIcon from '@/components/LineIcon.vue'
import AppDialog from '@/components/AppDialog.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { QUICK_ADD_ACTIONS, normalizeQuickAddAction } from '@/api/settings.js'

/**
 * 每个动作的补充说明
 *
 * ★ 为什么不写进 api/settings.js ★
 *   那里是「存进库的值 + 给选择器看的短名称」的唯一来源，
 *   多放一段解释会让设置层背 UI 文案。这里只服务本页展示。
 */
const ACTION_DESCS = {
  ai: '说一句话，自动识别并记账',
  manual: '打开完整的手动记账面板',
  none: '该手势不执行任何操作'
}

export default {
  components: { PageNav, LineIcon, AppDialog, UpdateDialog },
  setup() {
    const settingStore = useSettingStore()

    /** 本地编辑态：hold = 长按，tap = 短按 */
    const holdAction = ref('manual')
    const tapAction = ref('ai')

    const actionOptions = QUICK_ADD_ACTIONS.map((a) => ({
      ...a,
      desc: ACTION_DESCS[a.key] || ''
    }))
    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    /** 选项名 */
    function labelOf(key) {
      const opt = actionOptions.find((a) => a.key === key)
      return opt ? opt.name : '不响应'
    }

    const holdLabel = computed(() => labelOf(holdAction.value))
    const tapLabel = computed(() => labelOf(tapAction.value))

    /** 选中一项并立刻保存 */
    async function pick(which, key) {
      const value = normalizeQuickAddAction(key, which === 'hold' ? 'manual' : 'ai')
      if (which === 'hold') {
        holdAction.value = value
      } else {
        tapAction.value = value
      }
      await settingStore.setQuickAddAction(which, value)
    }

    function goBack() {
      uni.navigateBack()
    }

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      // 从 store 读初值（store 里的 getter 已经做过归一化）
      holdAction.value = settingStore.quickAddHoldAction
      tapAction.value = settingStore.quickAddTapAction
    })

    return {
      settingStore, primaryColor, pageStyle,
      holdAction, tapAction, actionOptions,
      holdLabel, tapLabel,
      pick, goBack
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

/*
 * ★ 顶部预览卡 ★
 *   渐变方向/阴影与账户页的概览卡同源（--app-hero-from + --app-shadow），
 *   这样它看起来像「应用里的一张卡」，而不是又一块普通设置。
 */
.preview-card {
  display: flex;
  align-items: center;
  gap: 28rpx;
  margin-top: 8rpx;
  padding: 28rpx;
  border-radius: 24rpx;
  background: linear-gradient(135deg, var(--app-hero-from), var(--app-card));
  box-shadow: var(--app-shadow);
}

.preview-fab-wrap {
  width: 116rpx;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/*
 * 记账按钮缩略图
 *
 * ★ 用主题浅色光晕而不是描边 ★
 *   实际底栏上的 + 是独立悬浮圆，没有外框；
 *   这里加一圈 --app-primary-light 的光晕，既保留「悬浮」感，
 *   又能让 92rpx 的小圆在渐变卡上站得住。
 */
.preview-fab {
  width: 92rpx;
  height: 92rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    0 0 0 12rpx var(--app-primary-light),
    0 8rpx 24rpx rgba(0, 0, 0, 0.18);
}

.preview-plus {
  color: #ffffff;
  font-size: 54rpx;
  font-weight: 400;
  line-height: 1;
  /* + 号在圆里视觉重心略偏下，往上提一点才居中 */
  margin-top: -4rpx;
}

.preview-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.preview-kicker {
  font-size: 22rpx;
  color: var(--app-text-3);
  letter-spacing: 1rpx;
}

.preview-line {
  display: flex;
  align-items: baseline;
  gap: 16rpx;
  min-width: 0;
}

.preview-key {
  width: 64rpx;
  flex-shrink: 0;
  font-size: 22rpx;
  color: var(--app-text-3);
}

.preview-val {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--app-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 分区标题：与主题外观 / 数据管理保持一致 */
.section {
  margin-top: 36rpx;
}

.section-title {
  font-size: 24rpx;
  color: var(--app-text-3);
  padding-left: 8rpx;
  display: block;
  margin-bottom: 12rpx;
}

.card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
}

/*
 * 选项行
 *
 * ★ 为什么用「图标 + 名称 + 说明 + 对勾」★
 *   和 OptionPickerSheet / 主题外观的下拉行是同一套语言：
 *   左边给形状，右边给结果，用户扫一眼就知道选的是哪个。
 *   只写三个名称会显得空，像一张没做完的表格。
 */
.opt-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 22rpx 28rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.opt-row:last-child {
  border-bottom: none;
}

/* 选中行用主题浅底，和白色卡片分层；不额外加边框，避免「框中框」 */
.opt-row.active {
  background-color: var(--app-primary-light);
}

.opt-icon {
  width: 64rpx;
  height: 64rpx;
  border-radius: 18rpx;
  background-color: var(--app-card-2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.opt-row.active .opt-icon {
  background-color: var(--app-primary-light-solid);
}

/* 「不响应」没有合适的线性图标，用一条短横线表示「什么都不做」 */
.opt-dash {
  font-size: 34rpx;
  line-height: 1;
  color: var(--app-text-3);
}

.opt-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.opt-name {
  font-size: 28rpx;
  color: var(--app-text);
}

.opt-desc {
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.4;
}

.opt-tick {
  font-size: 30rpx;
  font-weight: 600;
  flex-shrink: 0;
}

.page-tip {
  display: block;
  margin: 28rpx 12rpx 0;
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.7;
}
</style>
