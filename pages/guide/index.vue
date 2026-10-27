<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <view class="guide-page">
      <!-- 进度点 -->
      <view class="step-dots">
        <view
          v-for="(s, i) in steps"
          :key="i"
          class="dot"
          :class="{ active: step === i, done: step > i }"
          :style="{ backgroundColor: step >= i ? primaryColor : 'var(--app-line)' }"
        />
      </view>

      <!-- 步骤内容 -->
      <view class="step-body">
        <block v-if="step === 0">
          <text class="step-emoji">📒</text>
          <text class="step-title">欢迎使用记账本</text>
          <text class="step-desc">
            一个完全离线的个人记账工具。数据只存在你的手机里，不上传、不联网、不需要注册。
          </text>
        </block>

        <block v-else-if="step === 1">
          <text class="step-emoji">💳</text>
          <text class="step-title">先添加一个账户</text>
          <text class="step-desc">账户是记账的基础，可以是现金、银行卡或支付宝。</text>

          <view class="quick-create">
            <view
              v-for="preset in accountPresets"
              :key="preset.type"
              class="preset-row"
              :class="{ active: selectedPreset === preset.type }"
              @click="selectedPreset = preset.type"
            >
              <text class="preset-icon">{{ preset.icon }}</text>
              <view class="preset-info">
                <text class="preset-name">{{ preset.name }}</text>
                <text class="preset-desc">{{ preset.desc }}</text>
              </view>
              <view class="radio" :class="{ checked: selectedPreset === preset.type }">
                <view
                  v-if="selectedPreset === preset.type"
                  class="radio-dot"
                  :style="{ backgroundColor: primaryColor }"
                />
              </view>
            </view>
          </view>

          <input
            v-model="accountName"
            class="name-input"
            :placeholder="`给这个账户起个名字，如「${defaultAccountName}」`"
            placeholder-class="name-placeholder"
            :maxlength="12"
          />
        </block>

        <block v-else-if="step === 2">
          <text class="step-emoji">💰</text>
          <text class="step-title">设置初始余额</text>
          <text class="step-desc">填写账户当前的实际金额，之后所有交易会自动累加。</text>

          <view class="balance-input-wrap">
            <text class="balance-symbol" :style="{ color: primaryColor }">¥</text>
            <input
              v-model="initialBalance"
              class="balance-input"
              type="digit"
              placeholder="0.00"
              placeholder-class="balance-placeholder"
              :focus="true"
            />
          </view>
        </block>

        <block v-else-if="step === 3">
          <text class="step-emoji">🎉</text>
          <text class="step-title">一切就绪</text>
          <text class="step-desc">
            点击右下角的 + 记第一笔。长按 + 可以快速输入一句话记账，比如「昨天午饭四十五」。
          </text>

          <view class="tip-list">
            <view class="tip-item">
              <text class="tip-bullet">·</text>
              <text class="tip-text">数据在「我的 → 数据管理」中导出备份</text>
            </view>
            <view class="tip-item">
              <text class="tip-bullet">·</text>
              <text class="tip-text">主题色和深浅模式在「设置 → 主题外观」</text>
            </view>
            <view class="tip-item">
              <text class="tip-bullet">·</text>
              <text class="tip-text">AI 分析需要在设置中配置自己的 API Key</text>
            </view>
          </view>
        </block>
      </view>

      <!-- 按钮 -->
      <view class="step-actions">
        <wd-button
          v-if="step > 0"
          size="large"
          plain
          custom-class="btn-back"
          @click="prevStep"
        >上一步</wd-button>

        <wd-button
          size="large"
          type="primary"
          custom-class="btn-next"
          :loading="submitting"
          @click="nextStep"
        >{{ step === steps.length - 1 ? '开始记账' : '下一步' }}</wd-button>
      </view>
    </view>
  </view>
</template>

<script>
import { ref, computed } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { yuanToCents } from '@/utils/money.js'

export default {
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    const step = ref(0)
    const steps = [0, 1, 2, 3]
    const selectedPreset = ref('wechat')
    const accountName = ref('')
    const initialBalance = ref('')
    const submitting = ref(false)

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    const accountPresets = [
      { type: 'wechat', icon: '💬', name: '微信', desc: '微信钱包、零钱通' },
      { type: 'alipay', icon: '🔵', name: '支付宝', desc: '余额宝、花呗' },
      { type: 'debit', icon: '💳', name: '储蓄卡', desc: '银行卡活期账户' },
      { type: 'cash', icon: '💵', name: '现金', desc: '手上的现钞票' }
    ]

    const defaultAccountName = computed(() => {
      const p = accountPresets.find((x) => x.type === selectedPreset.value)
      return p ? p.name : '账户'
    })

    async function nextStep() {
      if (step.value === 1) {
        // 校验名称
        if (!accountName.value.trim() && !defaultAccountName.value) {
          uni.showToast({ title: '请填写账户名称', icon: 'none' })
          return
        }
        step.value++
        return
      }

      if (step.value === 2) {
        // 创建账户
        submitting.value = true
        try {
          const name = accountName.value.trim() || defaultAccountName.value
          const acc = await accountStore.create({
            name,
            type: selectedPreset.value,
            initial_balance_cents: yuanToCents(initialBalance.value || 0),
            include_in_total: true
          })
          await settingStore.update({ defaultAccountId: acc.id, firstRunDone: true })
          step.value++
        } catch (e) {
          uni.showModal({ title: '创建失败', content: e.message, showCancel: false })
        } finally {
          submitting.value = false
        }
        return
      }

      if (step.value === steps.length - 1) {
        uni.reLaunch({ url: '/pages/index/index' })
        return
      }

      step.value++
    }

    function prevStep() {
      if (step.value > 0) step.value--
    }

    return {
      step, steps, selectedPreset, accountName, initialBalance, submitting,
      primaryColor, pageStyle, accountPresets, defaultAccountName,
      nextStep, prevStep, settingStore
    }
  }
}
</script>

<style scoped>
.guide-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: calc(env(safe-area-inset-top) + 40rpx) 48rpx calc(env(safe-area-inset-bottom) + 40rpx);
}

.step-dots {
  display: flex;
  justify-content: center;
  gap: 12rpx;
  padding: 20rpx 0 60rpx;
}

.dot {
  width: 40rpx;
  height: 6rpx;
  border-radius: 3rpx;
  transition: background-color 0.25s;
}

.step-body {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.step-emoji {
  font-size: 96rpx;
  margin-bottom: 32rpx;
}

.step-title {
  font-size: 48rpx;
  font-weight: 600;
  color: var(--app-text);
  margin-bottom: 20rpx;
}

.step-desc {
  font-size: 28rpx;
  color: var(--app-text-2);
  line-height: 1.8;
  margin-bottom: 40rpx;
}

/* 账户预设 */
.quick-create {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-bottom: 28rpx;
}

.preset-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx 28rpx;
  background-color: var(--app-card);
  border-radius: 20rpx;
  border: 2rpx solid transparent;
}

.preset-row.active {
  border-color: var(--app-primary);
}

.preset-icon {
  font-size: 40rpx;
}

.preset-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.preset-name {
  font-size: 28rpx;
  color: var(--app-text);
  font-weight: 500;
}

.preset-desc {
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
}

.radio.checked {
  border-color: var(--app-primary);
}

.radio-dot {
  width: 22rpx;
  height: 22rpx;
  border-radius: 50%;
}

.name-input {
  background-color: var(--app-card);
  border-radius: 16rpx;
  padding: 26rpx 28rpx;
  font-size: 28rpx;
  color: var(--app-text);
}

.name-placeholder {
  color: var(--app-text-3);
  font-size: 26rpx;
}

/* 余额输入 */
.balance-input-wrap {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  padding: 40rpx 0;
  border-bottom: 2rpx solid var(--app-line);
}

.balance-symbol {
  font-size: 48rpx;
  font-weight: 500;
}

.balance-input {
  flex: 1;
  font-size: 72rpx;
  font-weight: 600;
  color: var(--app-text);
}

.balance-placeholder {
  color: var(--app-text-3);
  font-size: 72rpx;
  font-weight: 600;
}

/* 提示列表 */
.tip-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  padding: 28rpx;
  background-color: var(--app-card);
  border-radius: 20rpx;
}

.tip-item {
  display: flex;
  gap: 12rpx;
}

.tip-bullet {
  font-size: 26rpx;
  color: var(--app-primary);
}

.tip-text {
  flex: 1;
  font-size: 25rpx;
  color: var(--app-text-2);
  line-height: 1.6;
}

/* 按钮 */
.step-actions {
  display: flex;
  gap: 20rpx;
  padding-top: 40rpx;
  flex-shrink: 0;
}

.btn-back {
  flex: 1;
}

.btn-next {
  flex: 2;
}
</style>
