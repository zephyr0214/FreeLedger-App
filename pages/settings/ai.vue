<template>
  <view class="app-page" :style="pageStyle">
    <PageNav title="AI 大模型" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
      <view class="hint-card">
        <text class="hint-text">
          账本本身完全离线。这里的配置只用于「AI 洞察 / 消费分析 / 速记兜底」，
          数据会直接发送到你自己填写的接口，不经过任何中间服务器。
        </text>
      </view>

      <view class="form-card">
        <view class="form-row form-row-column">
          <text class="form-label">接口地址 (Base URL)</text>
          <input
            v-model="form.baseUrl"
            class="form-input-full"
            placeholder="https://api.deepseek.com/v1"
            placeholder-class="form-placeholder"
          />
        </view>

        <view class="form-row form-row-column">
          <text class="form-label">API Key</text>
          <view class="key-row">
            <input
              v-model="form.apiKey"
              class="form-input-full"
              :password="!showKey"
              placeholder="sk-..."
              placeholder-class="form-placeholder"
            />
            <text class="key-toggle" @click="showKey = !showKey">
              {{ showKey ? '隐藏' : '显示' }}
            </text>
          </view>
        </view>

        <view class="form-row">
          <text class="form-label">模型名</text>
          <input
            v-model="form.model"
            class="form-input"
            placeholder="deepseek-chat"
            placeholder-class="form-placeholder"
          />
        </view>

        <view class="form-row">
          <text class="form-label">温度</text>
          <view class="slider-wrap">
            <slider
              :value="form.temperature * 100"
              :min="0"
              :max="100"
              :step="10"
              active-color="var(--app-primary)"
              block-size="20"
              style="flex: 1"
              @change="(e) => form.temperature = e.detail.value / 100"
            />
            <text class="slider-value">{{ form.temperature.toFixed(1) }}</text>
          </view>
        </view>

        <view class="form-row">
          <text class="form-label">超时（秒）</text>
          <input
            v-model="timeoutSec"
            class="form-input"
            type="number"
            placeholder="20"
            placeholder-class="form-placeholder"
          />
        </view>
      </view>

      <!-- 速记兜底 -->
      <view class="form-card">
        <view class="switch-row">
          <view class="switch-info">
            <text class="switch-name">速记 AI 兜底</text>
            <text class="switch-desc">
              规则解析失败时，把速记原文发给大模型解析成结构化交易
            </text>
          </view>
          <switch
            :checked="form.quickFallback"
            :color="primaryColor"
            @change="(e) => form.quickFallback = e.detail.value"
          />
        </view>
      </view>

      <!-- 测试与保存 -->
      <view class="action-area">
        <wd-button
          size="large"
          plain
          custom-class="act-btn"
          :loading="testing"
          @click="onTest"
        >
          测试连通性
        </wd-button>
        <wd-button
          size="large"
          type="primary"
          custom-class="act-btn"
          @click="onSave"
        >
          保存
        </wd-button>
      </view>

      <!-- 高级 -->
      <view class="form-card" style="margin-top: 32rpx">
        <view class="action-row" @click="clearCache">
          <text class="action-name">清除 AI 缓存</text>
          <text class="action-arrow">›</text>
        </view>
      </view>

      <view class="bottom-space" />
    </scroll-view>
  </view>
</template>

<script>
import { ref, reactive, computed, onMounted } from 'vue'
import PageNav from '@/components/PageNav.vue'
import { useSettingStore } from '@/stores/setting.js'
import { testConnection, clearAiCache } from '@/api/ai.js'

export default {
  components: { PageNav },
  setup() {
    const settingStore = useSettingStore()

    const showKey = ref(false)
    const testing = ref(false)
    const timeoutSec = ref('20')

    const form = reactive({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
      temperature: 0.3,
      quickFallback: false
    })

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)


    async function onTest() {
      if (!form.apiKey) {
        uni.showToast({ title: '请先填写 API Key', icon: 'none' })
        return
      }

      testing.value = true
      try {
        // 测试时先把当前表单值临时保存，否则 chat() 读的是旧配置
        await settingStore.setAi({
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey.trim(),
          model: form.model.trim(),
          temperature: form.temperature,
          timeoutMs: Number(timeoutSec.value) * 1000
        })
        const res = await testConnection()
        uni.showModal({
          title: '连接成功',
          content: `模型已响应：${res.reply}`,
          showCancel: false
        })
      } catch (e) {
        uni.showModal({
          title: '连接失败',
          content: e.message,
          showCancel: false
        })
      } finally {
        testing.value = false
      }
    }

    async function onSave() {
      try {
        await settingStore.setAi({
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey.trim(),
          model: form.model.trim(),
          temperature: form.temperature,
          timeoutMs: Number(timeoutSec.value) * 1000,
          quickFallback: form.quickFallback
        })
        uni.showToast({ title: '已保存', icon: 'success' })
      } catch (e) {
        uni.showModal({ title: '保存失败', content: e.message, showCancel: false })
      }
    }

    function clearCache() {
      uni.showModal({
        title: '清除 AI 缓存？',
        content: '清除后下次进入会重新调用接口分析',
        success: async (res) => {
          if (!res.confirm) return
          await clearAiCache()
          uni.showToast({ title: '已清除', icon: 'success' })
        }
      })
    }

    function goBack() {
      uni.navigateBack()
    }

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      const ai = settingStore.settings.ai || {}
      form.baseUrl = ai.baseUrl || 'https://api.deepseek.com/v1'
      form.apiKey = ai.apiKey || ''
      form.model = ai.model || 'deepseek-chat'
      form.temperature = ai.temperature !== undefined ? ai.temperature : 0.3
      form.quickFallback = !!ai.quickFallback
      timeoutSec.value = String(Math.round((ai.timeoutMs || 20000) / 1000))
    })

    return {
      showKey, testing, timeoutSec, form,
      primaryColor, pageStyle,
      onTest, onSave, clearCache, goBack
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

.hint-card {
  background-color: var(--app-card);
  border-radius: 16rpx;
  padding: 24rpx;
  margin-top: 16rpx;
}

.hint-text {
  font-size: 23rpx;
  color: var(--app-text-3);
  line-height: 1.7;
}

.form-card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 0 28rpx;
  margin-top: 20rpx;
}

.form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 96rpx;
  border-bottom: 1rpx solid var(--app-line);
  gap: 20rpx;
}

.form-row:last-child {
  border-bottom: none;
}

.form-row-column {
  flex-direction: column;
  align-items: flex-start;
  padding: 24rpx 0;
  gap: 12rpx;
}

.form-label {
  font-size: 26rpx;
  color: var(--app-text-2);
  flex-shrink: 0;
}

.form-input {
  flex: 1;
  text-align: right;
  font-size: 28rpx;
  color: var(--app-text);
}

.form-input-full {
  width: 100%;
  font-size: 26rpx;
  color: var(--app-text);
  background-color: var(--app-card-2);
  border-radius: 10rpx;
  padding: 16rpx 20rpx;
}

.form-placeholder {
  color: var(--app-text-3);
  font-size: 26rpx;
}

.key-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  width: 100%;
}

.key-toggle {
  font-size: 24rpx;
  color: var(--app-primary);
  flex-shrink: 0;
}

.slider-wrap {
  display: flex;
  align-items: center;
  gap: 16rpx;
  flex: 1;
}

.slider-value {
  font-size: 24rpx;
  color: var(--app-text-2);
  width: 60rpx;
  text-align: right;
}

/* 开关行 */
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 0;
  gap: 20rpx;
}

.switch-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.switch-name {
  font-size: 28rpx;
  color: var(--app-text);
}

.switch-desc {
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.5;
}

/* 操作 */
.action-area {
  display: flex;
  gap: 20rpx;
  margin-top: 32rpx;
}

.act-btn {
  flex: 1;
}

.action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 0;
}

.action-name {
  font-size: 28rpx;
  color: var(--app-text);
}

.action-arrow {
  font-size: 32rpx;
  color: var(--app-text-3);
}

</style>
