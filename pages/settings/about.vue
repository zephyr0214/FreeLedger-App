<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="关于" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
      <view class="logo-area">
        <view class="logo-box" :style="{ backgroundColor: primaryColor }">
          <text class="logo-text">记</text>
        </view>
        <text class="app-name">记账本</text>
        <text class="app-version">v1.0.0</text>
      </view>

      <view class="card">
        <view class="info-row">
          <text class="info-label">数据存储</text>
          <text class="info-value">本机 SQLite</text>
        </view>
        <view class="info-row">
          <text class="info-label">网络请求</text>
          <text class="info-value">仅 AI 功能</text>
        </view>
        <view class="info-row">
          <text class="info-label">数据位置</text>
          <text class="info-value">_doc/books.db</text>
        </view>
        <view class="info-row">
          <text class="info-label">导出目录</text>
          <text class="info-value">_doc/export/</text>
        </view>
      </view>

      <view class="section">
        <text class="section-title">隐私说明</text>
        <view class="prose-card">
          <text class="prose">
            本应用是一个完全本地化的个人记账工具。

· 所有账户、交易、分类、标签、预算与设置都保存在你手机本地的 SQLite 数据库中，不会上传到任何服务器。
· 应用不含任何统计、埋点或广告 SDK。
· 唯一的网络请求来自「AI 洞察 / 消费分析 / 速记兜底」功能：只有在你主动配置了 API Key 并触发这些功能时，才会把聚合后的账务摘要发送到你指定的接口地址。
· 语音记账不录音、不调用麦克风，语音能力由你手机自带的输入法提供。
          </text>
        </view>
      </view>

      <view class="section">
        <text class="section-title">数据安全</text>
        <view class="prose-card">
          <text class="prose">
            因为数据只在本机，请务必注意：

· 卸载应用会删除全部数据，卸载前请先导出备份。
· 换手机时，先用「导出 JSON」保存文件，在新机「导入」即可。
· 建议定期导出并保存到网盘或电脑。
· 应用每天自动备份到 _doc/backup/，保留最近 5 份，可在「数据管理」中恢复。
          </text>
        </view>
      </view>

      <view class="section">
        <text class="section-title">技术栈</text>
        <view class="card">
          <view class="tech-row">
            <text class="tech-name">uni-app + Vue 3</text>
            <text class="tech-desc">跨端框架</text>
          </view>
          <view class="tech-row">
            <text class="tech-name">wot-design-uni</text>
            <text class="tech-desc">组件库</text>
          </view>
          <view class="tech-row">
            <text class="tech-name">Pinia</text>
            <text class="tech-desc">状态管理</text>
          </view>
          <view class="tech-row">
            <text class="tech-name">plus.sqlite</text>
            <text class="tech-desc">本地数据库</text>
          </view>
        </view>
      </view>

      <view class="section">
        <text class="section-title">排查</text>
        <view class="card">
          <view class="info-row" @click="onDiagnose">
            <text class="info-label">数据库自检</text>
            <text class="info-value" style="color: var(--app-primary)">点击运行</text>
          </view>
        </view>
      </view>

      <view class="footer">
        <text class="footer-text">用心记录每一笔</text>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 全局弹窗宿主（组件库重绘的确认框） -->
    <AppDialog />
  </view>
</template>

<script>
import { computed } from 'vue'
import PageNav from '@/components/PageNav.vue'
import AppDialog from '@/components/AppDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { showDbDiagnostics } from '@/api/db/diagnose.js'
import { alertDialog } from '@/utils/dialog.js'

export default {
  components: { PageNav, AppDialog },
  setup() {
    const settingStore = useSettingStore()

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)


    async function onDiagnose() {
      try {
        await showDbDiagnostics()
      } catch (e) {
        await alertDialog({ title: '自检失败', content: e.message })
      }
    }

    function goBack() {
      uni.navigateBack()
    }

    return { settingStore, primaryColor, pageStyle, onDiagnose, goBack }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

.logo-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60rpx 0 48rpx;
  gap: 12rpx;
}

.logo-box {
  width: 140rpx;
  height: 140rpx;
  border-radius: 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12rpx;
}

.logo-text {
  color: #ffffff;
  font-size: 64rpx;
  font-weight: 600;
}

.app-name {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--app-text);
}

.app-version {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 0 28rpx;
}

.info-row,
.tech-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 88rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.info-row:last-child,
.tech-row:last-child {
  border-bottom: none;
}

.info-label,
.tech-name {
  font-size: 26rpx;
  color: var(--app-text);
}

.info-value,
.tech-desc {
  font-size: 24rpx;
  color: var(--app-text-3);
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

.prose-card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 28rpx;
}

.prose {
  font-size: 24rpx;
  color: var(--app-text-2);
  line-height: 1.9;
  white-space: pre-wrap;
}

.footer {
  text-align: center;
  padding: 60rpx 0 20rpx;
}

.footer-text {
  font-size: 22rpx;
  color: var(--app-text-3);
}

</style>
