<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="关于" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
      <view class="logo-area">
        <image class="logo-img" src="/static/app/logo.png" mode="aspectFit" />
        <text class="app-name">自由记</text>
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
          <text class="info-label">自动备份</text>
          <text class="info-value">_doc/backup/</text>
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

· 所有账户、交易、分类、标签、周期、预算与设置都保存在你手机本地的 SQLite 数据库中，不会上传到任何服务器。
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
· 换手机时，用「数据与备份」导出后在新机导入即可搬过去。
· 备份文件保存在手机本地，卸载应用会一并删除，请及时另存或发送到自己的网盘。
· 应用每天首次启动会自动备份到 _doc/backup/，滚动保留最近 5 份，可在「数据与备份」中恢复。
· 也可随时手动导出完整备份（含账户、交易、分类、标签、周期、预算与设置）。
          </text>
        </view>
      </view>

      <view class="section">
        <text class="section-title">主要功能</text>
        <view class="prose-card">
          <text class="prose">
            · 记账：手动记账面板，或一句话 AI 速记（「昨天午饭 45，打车 28」）
· 账户：多账户管理，支持自定义品牌图标，可右滑设为默认
· 统计：分类 / 账户 / 标签多维度分析，含趋势、占比与月度对比
· 周期：房租、订阅、工资这类重复收支，可按天 / 周 / 月自动提醒记一笔
· 预算：总预算与分类预算，随时看剩余额度
· 标签：跨分类的项目维度汇总（如「2026 装修」「日本旅行」）
· 主题：6 套主题色 + 跟随系统的深浅色
· 备份：自动备份 + 手动导入导出，换机不丢数据
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

/*
  App 图标
  用户提供的 1024x1024 源图（static/app/logo.png），
  本身已经是圆形浅底 + 蓝色记账铅笔，所以直接按原样显示，
  不再套一层圆角背景。
*/
.logo-img {
  width: 168rpx;
  height: 168rpx;
  border-radius: 50%;
  margin-bottom: 16rpx;
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
