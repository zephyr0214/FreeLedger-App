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
          <!--
            ★ 为什么用 v-for 逐段渲染，而不是一段多行文本 ★
              uni-app 的 <text> 在编译期会把连续空白（含换行、缩进）
              压缩成单个空格，所以模板里手写的换行**渲染不出来**
              （white-space: pre-wrap 也救不了，因为换行符已经被吃掉了）。
              改成数据数组 + v-for，段落之间才是真的分行。
              新增/修改文案只改 setup 里的数组，不碰模板。

            ★ 有序列表怎么实现 ★
              用 <view class="prose-item"> 包一层，序号交给 CSS counter
              （见样式里的 counter-increment / ::before）——
              不用在文案里手写「1. 2. 3.」，否则增删条目要手动重排编号。
              type === 'text' 的条目（总起句）不参与编号。

            ★ 前两个字加粗 ★
              item 里若带 lead 字段，单独渲染成 <text class="list-lead">。
              加粗范围由数据决定，不靠正则切字 ——
              「AI 速记」这类带英文的，机械切两个字会切错。
          -->
          <template v-for="(p, i) in privacyParas" :key="'p' + i">
            <text v-if="p.type === 'text'" class="prose-lead">{{ p.text }}</text>
            <view v-else class="prose-item">
              <text v-if="p.lead" class="list-lead">{{ p.lead }}</text>
              <text class="list-text">{{ p.text }}</text>
            </view>
          </template>
        </view>
      </view>

      <view class="section">
        <text class="section-title">数据安全</text>
        <view class="prose-card">
          <template v-for="(p, i) in safetyParas" :key="'s' + i">
            <text v-if="p.type === 'text'" class="prose-lead">{{ p.text }}</text>
            <view v-else class="prose-item">
              <text v-if="p.lead" class="list-lead">{{ p.lead }}</text>
              <text class="list-text">{{ p.text }}</text>
            </view>
          </template>
        </view>
      </view>

      <view class="section">
        <text class="section-title">主要功能</text>
        <view class="prose-card">
          <template v-for="(p, i) in featureParas" :key="'f' + i">
            <text v-if="p.type === 'text'" class="prose-lead">{{ p.text }}</text>
            <view v-else class="prose-item">
              <text v-if="p.lead" class="list-lead">{{ p.lead }}</text>
              <text class="list-text">{{ p.text }}</text>
            </view>
          </template>
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

    /*
     * ★ 文案数据结构 ★
     *   分两种条目：
     *     { type: 'text', text }            普通段落（总起句）
     *     { type: 'item', text, lead? }     有序列表项
     *
     *   item 的 lead 是「要加粗的前两个字」（如「记账」「账户」），
     *   渲染时单独套一层 <text class="list-lead">。
     *   把 lead 显式写在数据里，而不是靠正则切前两个字 ——
     *   像「AI 速记」这种带英文/空格的，机械切前两个字会切错。
     *
     * ★ 为什么不再用「· 」前缀 ★
     *   用户要求改成有序列表。序号由 CSS counter 生成（1. 2. 3.），
     *   文案里就不该再带「·」，否则会出现「1. · 记账」这种重复符号。
     */
    const privacyParas = [
      { type: 'text', text: '本应用是一个完全本地化的个人记账工具。' },
      { type: 'item', text: '所有账户、交易、分类、标签、周期、预算与设置都保存在你手机本地的 SQLite 数据库中，不会上传到任何服务器。' },
      { type: 'item', text: '应用不含任何统计、埋点或广告 SDK。' },
      { type: 'item', text: '唯一的网络请求来自「AI 洞察 / 消费分析 / 速记兜底」功能：只有在你主动配置了 API Key 并触发这些功能时，才会把聚合后的账务摘要发送到你指定的接口地址。' },
      { type: 'item', text: '语音记账不录音、不调用麦克风，语音能力由你手机自带的输入法提供。' }
    ]

    const safetyParas = [
      { type: 'text', text: '因为数据只在本机，请务必注意：' },
      { type: 'item', text: '卸载应用会删除全部数据，卸载前请先导出备份。' },
      { type: 'item', text: '换手机时，用「数据与备份」导出后在新机导入即可搬过去。' },
      { type: 'item', text: '备份文件保存在手机本地，卸载应用会一并删除，请及时另存或发送到自己的网盘。' },
      { type: 'item', text: '应用每天首次启动会自动备份到 _doc/backup/，滚动保留最近 5 份，可在「数据与备份」中恢复。' },
      { type: 'item', text: '也可随时手动导出完整备份（含账户、交易、分类、标签、周期、预算与设置）。' }
    ]

    /*
     * 主要功能：每条都带 lead（前两个字加粗）。
     *
     * ★ 冒号要跟着 lead 走 ★
     *   原文是「记账：手动记账面板…」。拆成 lead + text 时，
     *   冒号若放进 text，它会变成不加粗的普通字，看着像漏了；
     *   放进 lead 则与「记账」一起加粗，和原文的视觉一致。
     *   所以这里的 lead 统一写成「功能名：」。
     */
    const featureParas = [
      { type: 'item', lead: '记账：', text: '手动记账面板，或一句话 AI 速记（「昨天午饭 45，打车 28」）' },
      { type: 'item', lead: '账户：', text: '多账户管理，支持自定义品牌图标，可右滑设为默认' },
      { type: 'item', lead: '统计：', text: '分类 / 账户 / 标签多维度分析，含趋势、占比与月度对比' },
      { type: 'item', lead: '周期：', text: '房租、订阅、工资这类重复收支，可按天 / 周 / 月自动提醒记一笔' },
      { type: 'item', lead: '预算：', text: '总预算与分类预算，随时看剩余额度' },
      { type: 'item', lead: '标签：', text: '跨分类的项目维度汇总（如「2026 装修」「日本旅行」）' },
      { type: 'item', lead: '主题：', text: '6 套主题色 + 跟随系统的深浅色' },
      { type: 'item', lead: '备份：', text: '自动备份 + 手动导入导出，换机不丢数据' }
    ]

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

    return {
      settingStore, primaryColor, pageStyle,
      privacyParas, safetyParas, featureParas,
      onDiagnose, goBack
    }
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

/*
 * ★ 有序列表（1. 2. 3.）★
 *
 * ★ 为什么用 CSS counter 而不是在文案里写编号 ★
 *   写死编号的话，增删一条就要手动重排后面所有条目的序号，
 *   极易出错。counter 由渲染顺序自动累加，改文案不用管编号。
 *
 * ★ 计数器在每个 .prose-card 里重置 ★
 *   counter-reset 写在 .prose-card 上，所以「隐私说明」的编号
 *   从 1 开始，「数据安全」也从 1 开始，互不干扰。
 *
 * ★ 悬挂缩进 ★
 *   ::before 里放「1. 」，用 absolute 定位到左侧，
 *   正文块 padding-left 让出 44rpx ——
 *   这样文字换行后会与上一行对齐，不会顶到序号下面。
 */
.prose-card {
  counter-reset: item;
}

/*
 * 每个列表项占一行，内部是「序号（伪元素）+ 正文」。
 * 用 flex 让序号和正文各自成为一个独立的盒子，
 * 比 text-indent 负值更稳（负缩进遇到多行文字容易错位）。
 */
.prose-item {
  position: relative;
  padding-left: 44rpx;
  margin-bottom: 12rpx;
  font-size: 26rpx;
  color: var(--app-text-2);
  line-height: 1.7;
}

.prose-item:last-child {
  margin-bottom: 0;
}

/* 序号：1. 2. 3. …，用主题色区分，和正文拉开层次 */
.prose-item::before {
  counter-increment: item;
  content: counter(item) ".";
  position: absolute;
  left: 0;
  top: 0;
  width: 36rpx;
  font-size: 26rpx;
  color: var(--app-primary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/*
 * 功能名前缀加粗（主要功能用来标「记账：」「账户：」这类标签）。
 *
 * ★ 为什么单独一个 <text> ★
 *   加粗范围由数据里的 lead 字段决定，只包住「功能名 + 冒号」，
 *   后面的说明保持正常字重。用 CSS 的 ::first-letter 做不到多字，
 *   用富文本 v-html 又太重（还要处理转义），所以直接拆成两个 text。
 *
 * ★ 冒号要放进 lead ★
 *   原文是「记账：手动记账面板…」。若把冒号留在 text 里，
 *   它会变成不加粗的普通字，看着像「漏了冒号」。
 *   放进 lead 与功能名一起加粗，才是原文的视觉。
 */
.list-lead {
  font-weight: 600;
  color: var(--app-text);
}

.list-text {
  /* 冒号在 lead 里，正文直接接上即可，不需要额外间距 */
  margin-left: 0;
}

/*
 * 总起句：深色 + 半粗。
 * 它给整节定调（「因为数据只在本机，请务必注意：」），
 * 比正文重一点才立得住，否则和下面的列表项混成一片。
 */
.prose-lead {
  display: block;
  font-size: 27rpx;
  font-weight: 600;
  color: var(--app-text);
  line-height: 1.6;
  margin-bottom: 20rpx;
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
