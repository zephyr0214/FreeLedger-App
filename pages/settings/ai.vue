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
        ★ AI 对话专属设置 ★
          对话和记账的诉求完全不同，所以配置分开：
            · AI 记账：要稳定，temperature 固定 0，不思考
            · AI 对话：要发散和透彻，有自己的温度、开着深度思考
          以前两边共用一个 temperature 滑块，调哪个都会影响另一个。
      -->
      <view class="form-card" style="margin-top: 32rpx">
        <view class="card-title">AI 对话</view>

        <view class="form-row form-row-column">
          <view class="label-row">
            <text class="form-label">深度思考</text>
            <switch
              :checked="chatForm.deepThinking"
              :color="primaryColor"
              @change="(e) => chatForm.deepThinking = e.detail.value"
            />
          </view>
          <text class="form-hint">
            开启后模型会先推演再回答，分析更透彻，但响应更慢、消耗更多额度。
            需要模型本身支持推理（如 deepseek-reasoner）。
          </text>
        </view>

        <view class="form-row form-row-column">
          <view class="label-row">
            <text class="form-label">回答附带图表</text>
            <switch
              :checked="chatForm.showCharts"
              :color="primaryColor"
              @change="(e) => chatForm.showCharts = e.detail.value"
            />
          </view>
          <text class="form-hint">
            回答涉及「构成 / 占比 / 排名」时附上图。图表里的数字取自你的本地账本，不会被 AI 编造。
          </text>
        </view>

        <view class="form-row form-row-column">
          <text class="form-label">回答长度上限（token）</text>
          <input
            v-model="chatForm.maxTokens"
            class="form-input-full"
            type="number"
            placeholder="2000"
            placeholder-class="form-placeholder"
          />
          <text class="form-hint">
            越大回答越详细（深度思考建议 2000 以上），也越费额度。
          </text>
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
    })

    /**
     * AI 对话专属配置。
     *
     * ★ 温度没有滑块了 ★
     *   用户不需要调「采样随机性」这种技术参数，
     *   固定用 0.6（比原来的 0.3 略高，适合聊天发挥）。
     */
    const chatForm = reactive({
      deepThinking: true,
      showCharts: true,
      maxTokens: 2000
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
          timeoutMs: Number(timeoutSec.value) * 1000,
        })
        // ★ 对话配置单独存 ★
        //   记账解析那边不碰（它的 temperature 固定 0、不思考）
        await settingStore.setAiChat({
          deepThinking: chatForm.deepThinking,
          showCharts: chatForm.showCharts,
          maxTokens: Math.max(500, Number(chatForm.maxTokens) || 2000)
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
      timeoutSec.value = String(Math.round((ai.timeoutMs || 20000) / 1000))

      // 对话专属配置
      const chat = settingStore.settings.aiChat || {}
      chatForm.deepThinking = chat.deepThinking !== false
      chatForm.showCharts = chat.showCharts !== false
      chatForm.maxTokens = chat.maxTokens || 2000
    })

    return {
      showKey, testing, timeoutSec, form, chatForm,
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

/*
  ★ 滑块相关的样式删掉了 ★
    「回答的随机程度」滑块已移除（temperature 固定 0.6，不再给用户调），
    slider-wrap / slider-value / label-value 都不再使用。
*/

/* 「深度思考」这类开关：标签和开关同一行 */
.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

/* 卡片小标题（AI 对话 / AI 记账 分区） */
.card-title {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--app-text-2);
  display: block;
  padding-bottom: 8rpx;
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
