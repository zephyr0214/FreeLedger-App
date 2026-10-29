<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="AI 大模型" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
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

        <view class="form-row form-row-column">
          <view class="label-row">
            <text class="form-label">回答的随机程度</text>
            <text class="label-value">{{ form.temperature.toFixed(1) }}</text>
          </view>
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
          </view>
          <!--
            ★ 把「温度」翻译成人话 ★
              原文写「温度」，用户根本不知道是什么意思、调了会怎样。
              它其实是采样随机性：越低越稳定保守，越高越发散有创意。
              记账场景要的是稳定，所以默认 0.3 偏低。
          -->
          <text class="form-hint">
            越低回答越稳定、越贴事实（记账推荐 0.1~0.3）；
            越高越灵活、越有创意，但也更容易不按格式来。
          </text>
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

      <!--
        ★ 「速记 AI 兜底」开关已删除 ★
          它是早期「规则解析 → 失败后走 AI」两段式设计的遗留开关。
          后来速记直接改成走 aiParse.js（本来就调模型），
          规则引擎那一段已经不在了，这个开关背后的
          api/ai.js:parseQuickWithAi() 从来没有任何地方调用 ——
          开了也没用，属于纯粹的误导。删掉。
      -->

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

    <!-- 全局弹窗宿主（组件库重绘的确认框） -->
    <AppDialog />
  </view>
</template>

<script>
import { ref, reactive, computed, onMounted } from 'vue'
import PageNav from '@/components/PageNav.vue'
import AppDialog from '@/components/AppDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { testConnection, clearAiCache } from '@/api/ai.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'

export default {
  components: { PageNav, AppDialog },
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
        await alertDialog({
          title: '连接成功',
          content: `模型已响应：${res.reply}`
        })
      } catch (e) {
        await alertDialog({
          title: '连接失败',
          content: e.message
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
        })
        uni.showToast({ title: '已保存', icon: 'success' })
      } catch (e) {
        await alertDialog({ title: '保存失败', content: e.message })
      }
    }

    async function clearCache() {
      const confirmed = await confirmDialog({
        title: '清除 AI 缓存？',
        content: '清除后下次进入会重新调用接口分析'
      })
      // ★ 取消就什么都不做 ★
      if (!confirmed) return

      await clearAiCache()
      uni.showToast({ title: '已清除', icon: 'success' })
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
      timeoutSec.value = String(Math.round((ai.timeoutMs || 20000) / 1000))
    })

    return {
      showKey, testing, timeoutSec, form,
      primaryColor, pageStyle,
      onTest, onSave, clearCache, goBack, settingStore
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
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
  min-width: 0;
  text-align: right;
  font-size: 28rpx;
  color: var(--app-text);
}

/**
 * 整行宽度的输入框（接口地址 / API Key）
 *
 * ★★ 两个坑叠在一起，都会让输入框「穿模 / 压扁」★★
 *
 * 坑 1：input 不在全局的 border-box 名单里 → 横向穿模
 *   App.vue 的全局样式里是
 *     view, text, scroll-view, image { box-sizing: border-box; }
 *   —— input **不在这个列表里**，所以 input 默认还是 content-box。
 *   .form-input-full 同时有 width: 100% 和 padding: 16rpx 20rpx，
 *   实际占位 = 100% + 40rpx，横向溢出容器右边（穿模）。
 *
 * 坑 2：补了 border-box 却没给高度 → 纵向压扁
 *   uni-app 的 <input> 编译成 <uni-input>，默认高度是 1.4em（≈ 1.4 × 字号），
 *   本身没有固定高度。一旦改成 border-box，又保留 padding: 16rpx 上下，
 *   那 16rpx×2 的 padding 就要从「1.4em 的内容高度」里扣，
 *   26rpx 的字号只剩 36rpx - 32rpx = 4rpx 的内容区 ——
 *   字被压成一条线，就是用户说的「被压扁了」。
 *
 * 修法（uni-app 的标准写法）：给固定 height + line-height，去掉上下 padding。
 *   height 管盒子高度，line-height 让文字在盒子里垂直居中，
 *   横向留白交给 padding: 0 20rpx。
 */
.form-input-full {
  width: 100%;
  height: 80rpx;
  line-height: 80rpx;
  box-sizing: border-box;
  font-size: 26rpx;
  color: var(--app-text);
  background-color: var(--app-card-2);
  border-radius: 10rpx;
  padding: 0 20rpx;
}

.form-placeholder {
  color: var(--app-text-3);
  font-size: 26rpx;
}

/**
 * API Key 那一行：输入框 + 「显示/隐藏」按钮并排
 *
 * ★ 输入框必须 flex: 1 + min-width: 0 ★
 *   flex 容器里，默认 flex-basis:auto 会让子项按内容宽度撑开，
 *   加上「显示/隐藏」按钮就容易被挤出容器右边。
 *   min-width: 0 允许它缩到比内容还窄（配合 input 自身的 overflow 处理），
 *   这样按钮永远留在容器内。
 *
 * ★ align-items: stretch ★
 *   默认是 center，输入框用自己的 height 撑着；
 *   改成 stretch 让它跟着行高走，两边（输入框 / 按钮）视觉上齐平，
 *   按钮文字用 line-height 对齐到同一个高度。
 */
.key-row {
  display: flex;
  align-items: stretch;
  gap: 16rpx;
  width: 100%;
}

.key-row .form-input-full {
  flex: 1;
  min-width: 0;
}

.key-toggle {
  font-size: 24rpx;
  line-height: 80rpx;
  color: var(--app-primary);
  flex-shrink: 0;
}

.slider-wrap {
  display: flex;
  align-items: center;
  gap: 16rpx;
  flex: 1;
  width: 100%;
  /* 同理：slider 也不在全局 border-box 名单里，min-width: 0 防止撑破容器 */
  min-width: 0;
}

.slider-value {
  font-size: 24rpx;
  color: var(--app-text-2);
  width: 60rpx;
  text-align: right;
}

/* 「回答的随机程度」：标签和数值同一行 */
.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.label-value {
  font-size: 26rpx;
  color: var(--app-primary);
  font-variant-numeric: tabular-nums;
}

/* 参数说明（把「温度」翻译成人话） */
.form-hint {
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.6;
  width: 100%;
  margin-top: 4rpx;
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
