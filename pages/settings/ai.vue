<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="AI 大模型" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
      <!--
        ★ 分区标题的写法跟着别的设置页走 ★
          「深浅模式」「主题色」「导出」「数据管理」那些页
          都是「灰色小标题 + 下面的卡片」，
          这里原来把「AI 对话」写成了卡片里的第一行（.card-title），
          跟其他页长得不一样。改成一样的 section 结构。
      -->
      <view class="section">
        <text class="section-title">模型配置</text>
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
            <text class="form-label">记账解析超时（秒）</text>
            <input
              v-model="timeoutSec"
              class="form-input"
              type="number"
              placeholder="30"
              placeholder-class="form-placeholder"
            />
          </view>
        </view>
      </view>

      <!--
        ★ AI 对话专属设置 ★
          对话和记账的诉求完全不同，所以配置分开：
            · AI 记账：要稳定，temperature 固定 0，不思考
            · AI 对话：要发散和透彻，有自己的温度、开着深度思考
          以前两边共用一个 temperature 滑块，调哪个都会影响另一个。
      -->
      <view class="section">
        <text class="section-title">AI 对话</text>
        <view class="form-card">
          <view class="form-row">
            <view class="label-row">
              <text class="form-label">深度思考</text>
              <switch
                :checked="chatForm.deepThinking"
                :color="primaryColor"
                @change="(e) => chatForm.deepThinking = e.detail.value"
              />
            </view>
          </view>

          <view class="form-row">
            <view class="label-row">
              <text class="form-label">回答附带图表</text>
              <switch
                :checked="chatForm.showCharts"
                :color="primaryColor"
                @change="(e) => chatForm.showCharts = e.detail.value"
              />
            </view>
          </view>

          <view class="form-row">
            <text class="form-label">回答长度上限（token）</text>
            <input
              v-model="chatForm.maxTokens"
              class="form-input"
              type="number"
              placeholder="8000"
              placeholder-class="form-placeholder"
            />
          </view>

          <view class="form-row">
            <text class="form-label">回答超时（秒）</text>
            <input
              v-model="chatTimeoutSec"
              class="form-input"
              type="number"
              placeholder="120"
              placeholder-class="form-placeholder"
            />
          </view>
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
          @click="onTest"
        >
          <!--
            ★ 加载效果自己画，不用 wd-button 的 :loading ★
              组件内置的加载圈又小又挤在文字前面、还不跟主题色。
              换成自绘 CSS 旋转圈：主题色、尺寸可控、和文字垂直对齐；
              文案同步变成「测试中…」。测试期间重复点击由 onTest 里的
              testing 防重入挡掉。
          -->
          <view class="test-inner">
            <view v-if="testing" class="test-spinner" />
            <text>{{ testing ? '测试中…' : '测试连通性' }}</text>
          </view>
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

      <!--
        ★ 「清除 AI 缓存」入口已删除 ★
          它背后的缓存机制**从来就没有生效过**：
            · api/ai.js 里的 readCache / writeCache / hashSummary
              全都没有调用方（它们服务的是早已下线的「首页洞察」「统计页分析」）
            · 也就是说 setting 表里的 aiCache 这一项永远是空的
          唯一的作用是往数据库写一条空记录 —— 纯误导，删掉。
          顺带把 api/ai.js 里那套死缓存代码也清了。
      -->

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
import { testConnection } from '@/api/ai.js'
import { alertDialog } from '@/utils/dialog.js'

export default {
  components: { PageNav, AppDialog },
  setup() {
    const settingStore = useSettingStore()

    const showKey = ref(false)
    const testing = ref(false)
    /** 记账解析超时（秒） */
    const timeoutSec = ref('30')
    /** AI 回答超时（秒）—— 深度思考慢，要给得比解析宽松得多 */
    const chatTimeoutSec = ref('120')

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
      maxTokens: 8000
    })

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)


    async function onTest() {
      if (!form.apiKey) {
        uni.showToast({ title: '请先填写 API Key', icon: 'none' })
        return
      }
      // ★ 防重入：测试进行中再点无效（加载态换成了自绘圈，没有内置禁用）
      if (testing.value) return

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
          maxTokens: Math.max(1000, Number(chatForm.maxTokens) || 8000),
          // ★ 回答超时：至少 30 秒，最多 10 分钟 ★
          //   深度思考 + 2000 token 的完整分析可能要一两分钟，
          //   太短必然超时，太长用户干等受不了。
          timeoutMs: Math.min(600000, Math.max(30000, Number(chatTimeoutSec.value) * 1000 || 120000))
        })
        uni.showToast({ title: '已保存', icon: 'success' })
      } catch (e) {
        await alertDialog({ title: '保存失败', content: e.message })
      }
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
      // ★ 记账解析超时默认 30 秒 ★
      timeoutSec.value = String(Math.round((ai.timeoutMs || 30000) / 1000))

      // 对话专属配置
      const chat = settingStore.settings.aiChat || {}
      chatForm.deepThinking = chat.deepThinking !== false
      chatForm.showCharts = chat.showCharts !== false
      chatForm.maxTokens = chat.maxTokens || 8000
      // ★ 回答超时默认 120 秒 ★
      //   深度思考 + 2000 token 的完整分析，30 秒远远不够 ——
      //   这正是「AI 请求超时」的老大难。
      chatTimeoutSec.value = String(Math.round((chat.timeoutMs || 120000) / 1000))
    })

    return {
      showKey, testing, timeoutSec, chatTimeoutSec, form, chatForm,
      primaryColor, pageStyle,
      onTest, onSave, goBack, settingStore
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

/*
  ★ 分区结构 ★
    跟「主题外观」「数据与备份」那些页保持一致：
    灰色小标题（section-title）+ 下面的白色卡片（form-card）。
    以前「AI 对话」是写在卡片里的第一行（.card-title），
    跟别的设置页长得不一样。
*/
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

.form-card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 0 28rpx;
  margin-top: 20rpx;
}

/* 分区里的第一张卡片不用再留上边距（标题已经隔开了） */
.section .form-card {
  margin-top: 0;
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

/*
 * 接口地址输入框：高度被压扁
 *
 * ★ 根因 ★
 *   App.vue 的全局 uni-input { flex: 1 } 本意是给横向 flex 行用的
 *   （让输入框吃掉剩余宽度）。
 *   但「接口地址」的输入框是 .form-row-column（纵向列）的直接子元素 ——
 *   纵向列的主轴是**高度**，flex: 1 变成 flex-basis: 0%（作用在高度上），
 *   把 .form-input-full 的 height: 80rpx 顶掉，输入框被压成一条。
 *   API Key 那行没事：它的输入框在 .key-row（横向行）里，
 *   flex: 1 作用在宽度上，height 正常生效。
 *
 * ★ 修法 ★
 *   只对「列布局的直接子输入框」关掉全局 flex（用 > 限定直接子级，
 *   不影响 .key-row 里的 API Key 输入框），让 height: 80rpx 正常生效；
 *   宽度仍由 width: 100% 撑满整行。
 */
.form-row-column > .form-input-full {
  flex: none;
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

/* 操作 */
.action-area {
  display: flex;
  gap: 20rpx;
  margin-top: 32rpx;
}

.act-btn {
  flex: 1;
}

/* 「测试连通性」按钮的自绘加载态 */
.test-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
}

/*
 * 旋转圈：主题色 + 透明顶边，转起来才有「圈在动」的观感。
 * 尺寸 26rpx 与按钮文字（wot large 按钮字号）相近，
 * 和文字垂直居中排 —— 不会像组件内置 loading 那样挤成一坨。
 */
.test-spinner {
  width: 26rpx;
  height: 26rpx;
  border-radius: 50%;
  border: 3rpx solid var(--app-primary);
  border-top-color: transparent;
  animation: test-spin 0.7s linear infinite;
}

@keyframes test-spin {
  to {
    transform: rotate(360deg);
  }
}

</style>
