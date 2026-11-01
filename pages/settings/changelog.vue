<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="更新日志" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
      <!--
        更新日志

        ★ 排版参考「关于」页 ★
          每个版本一张卡：
            版本号 + 日期（标题行）
            若干段落，每段一个小标题（新增 / 优化 / 修复 / 数据迁移）
            + 句子列表
          段落之间用和关于页一样的分隔方式，读起来是同一套语言。

        ★ 为什么句子里不用手写换行 ★
          uni-app 的 <text> 在编译期会把连续空白（含换行、缩进）
          压缩成单个空格，手写的换行渲染不出来。
          所以每条句子都是数组里的一个元素、用 v-for 逐条渲染。
          （关于页的隐私/安全/功能三段也是同样的处理，见那边的注释。）

        ★ 数据从哪来 ★
          全部在 utils/version.js 的 RELEASES 里，倒序（最新在最前）。
          这里只负责渲染，不写任何文案 ——
          改日志只改那一个文件，不用碰模板。
      -->
      <view v-for="(rel, ri) in releases" :key="rel.version" class="rel-card">
        <view class="rel-head">
          <view class="rel-version-wrap">
            <text class="rel-version">v{{ rel.version }}</text>
            <!-- 最新一版加个标记，用户一眼知道这次更新了什么 -->
            <text v-if="ri === 0" class="rel-badge" :style="{ color: primaryColor, backgroundColor: primaryColor + '1A' }">当前</text>
          </view>
          <text class="rel-date">{{ rel.date }}</text>
        </view>

        <view
          v-for="(sec, si) in rel.sections"
          :key="si"
          class="rel-section"
        >
          <text class="rel-section-title">{{ sec.title }}</text>
          <view class="rel-items">
            <view
              v-for="(line, li) in sec.items"
              :key="li"
              class="rel-item"
            >
              <text class="rel-dot" :style="{ color: primaryColor }">·</text>
              <text class="rel-text">{{ line }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="footer">
        <text class="footer-text">用心记录每一笔</text>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 全局弹窗宿主 -->
    <AppDialog />
  </view>
</template>

<script>
import { computed } from 'vue'
import PageNav from '@/components/PageNav.vue'
import AppDialog from '@/components/AppDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { RELEASES } from '@/utils/version.js'

export default {
  components: { PageNav, AppDialog },
  setup() {
    const settingStore = useSettingStore()

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    /** 更新日志（来自 utils/version.js，已按时间倒序） */
    const releases = RELEASES

    function goBack() {
      uni.navigateBack()
    }

    return {
      settingStore, primaryColor, pageStyle,
      releases, goBack
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

/*
 * 每个版本一张卡。
 *
 * ★ 卡片间距 24rpx ★
 *   比「关于」页的 section 间距（32rpx）略小：
 *   更新日志是一串结构相同的卡片，间距过大会显得零散；
 *   同一版本内部的段落才用大一点的间距分组。
 */
.rel-card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 28rpx;
  margin-top: 24rpx;
}

.rel-card:first-child {
  margin-top: 16rpx;
}

/* 版本号 + 日期 */
.rel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 18rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.rel-version-wrap {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.rel-version {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

/*
 * 「当前」标记
 *
 * 底色用主题色 + 13% 透明度（内联注入，跟主题走），
 * 文字用主题色本身 —— 和「分类管理」页的固定分类标记同一套做法。
 */
.rel-badge {
  font-size: 18rpx;
  padding: 2rpx 10rpx;
  border-radius: 8rpx;
  line-height: 1.5;
}

.rel-date {
  font-size: 22rpx;
  color: var(--app-text-3);
}

/* 段落 */
.rel-section {
  margin-top: 24rpx;
}

.rel-section-title {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: var(--app-text);
  margin-bottom: 12rpx;
}

.rel-items {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

/*
 * 列表项：圆点 + 正文
 *
 * ★ flex 布局而不是 text-indent ★
 *   圆点用独立的 <text>，正文换行时会自动对齐到正文起点，
 *   不会顶到圆点下面（和「关于」页的有序列表同一个思路）。
 */
.rel-item {
  display: flex;
  align-items: flex-start;
  gap: 10rpx;
}

.rel-dot {
  font-size: 26rpx;
  line-height: 1.7;
  flex-shrink: 0;
  font-weight: 600;
}

.rel-text {
  flex: 1;
  font-size: 26rpx;
  color: var(--app-text-2);
  line-height: 1.7;
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
