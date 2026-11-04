<template>
  <!--
    更新弹窗

    ★ 视觉与应用其他页面一致 ★
      弹层是**居中卡片**（四角全圆、左右留白），内部发行说明按
      **更新日志页的卡片样式**渲染：段落小标题（新增 / 修复…）+ 圆点列表项。
      而不是之前那样把所有行平铺成一堆灰字。

      （曾试过底部弹出的 sheet 形态，用户明确要求改回中间弹出 ——
        更新提示是「读一下再决定」，居中卡片比贴底的 sheet 更像
        一个需要用户注意的提示，也与 AppDialog 的确认框同族。）

    ★ 文本格式解析 ★
      Gitee 发行版的 body 是 markdown：
        ## 新增
        - 某条改动
      parseNotes() 把它拆成 [{title, items[]}]，
      模板按 section 渲染 —— 和更新日志页的结构完全对齐。
      解析不出的行（普通段落、---分隔线、英文摘要）归到「无标题段落」，
      保证任何格式的说明都能完整显示，不会吞字。

    ★ 下载进度不在弹窗里 ★
      改到系统通知栏（api/update.js 的 createProgressNotifier）。
      点「立即下载更新」后弹窗直接关闭、退回 App，
      用户切出去干别的也能在通知栏看到进度，完成后再点安装。
  -->
  <view v-if="updateStore.dialogVisible" class="ud-mask" @click="dismiss">
    <view class="ud-sheet" @click.stop>
      <!--
        头部：版本号 + 「新版本」标记 + 包大小
        ★ 结构对齐更新日志页的 .rel-head ★
          版本号（大、粗）+ 主题色小标记 + 右侧灰色日期位（这里放大小）
      -->
      <view class="ud-head">
        <view class="ud-head-left">
          <text class="ud-version">v{{ info.version }}</text>
          <text
            class="ud-badge"
            :style="{ color: primaryColor, backgroundColor: primaryColor + '1A' }"
          >{{ info.forced ? '测试' : '新版本' }}</text>
        </view>
        <text v-if="sizeText" class="ud-size">{{ sizeText }}</text>
      </view>

      <!--
        测试模式的提示条
        ★ 为什么要有 ★
          测试入口跳过版本比较，弹窗里的版本可能**不比当前版本新**。
          不加提示的话，测完容易误以为「有新版但装不上」
          （其实是同一个版本，安卓会拒绝同版本覆盖安装）。
      -->
      <view
        v-if="info.forced"
        class="ud-tip"
        :style="{ backgroundColor: primaryColor + '14', color: primaryColor }"
      >测试模式：跳过了版本比较，下面是远端最新版</view>

      <!--
        发行说明
        ★ 与更新日志页的 rel-section / rel-items / rel-item 同款 ★
          段落标题加粗，条目用主题色圆点 + 正文，行高 1.7 便于阅读。
      -->
      <scroll-view class="ud-notes" scroll-y>
        <view v-for="(sec, si) in sections" :key="si" class="ud-section">
          <text v-if="sec.title" class="ud-section-title">{{ sec.title }}</text>
          <view class="ud-items">
            <view v-for="(line, li) in sec.items" :key="li" class="ud-item">
              <text class="ud-dot" :style="{ color: primaryColor }">·</text>
              <text class="ud-text">{{ line }}</text>
            </view>
          </view>
        </view>
      </scroll-view>

      <!--
        底部按钮
        ★ 取消在左、主操作在右 ★
          与其他弹层（修改余额）一致；下载中主按钮变灰不可点，
          但不能点太死 —— 用户可能想中止，所以取消按钮文案改成「取消下载」。
      -->
      <view class="ud-foot">
        <view class="ud-btn-cancel" @click="onCancel">
          {{ updateStore.phase === 'downloading' ? '取消下载' : '下次再说' }}
        </view>
        <view
          class="ud-btn-ok"
          :class="{ busy: updateStore.phase !== 'idle' }"
          :style="{ backgroundColor: updateStore.phase === 'idle' ? primaryColor : '' }"
          @click="onConfirm"
        >{{ updateStore.phase === 'idle' ? '立即下载更新' : '下载中，请查看通知栏' }}</view>
      </view>
    </view>
  </view>
</template>

<script>
import { computed, watch, onUnmounted } from 'vue'
import { useUpdateStore } from '@/stores/update.js'
import { useSettingStore } from '@/stores/setting.js'
import { pushLayer } from '@/utils/layerStack.js'

export default {
  name: 'UpdateDialog',
  setup() {
    const updateStore = useUpdateStore()
    const settingStore = useSettingStore()

    const primaryColor = computed(() => settingStore.primaryColor)

    const info = computed(() => updateStore.info || {})
    const sizeText = computed(() => {
      const mb = (info.value.sizeBytes || 0) / 1048576
      return mb > 0 ? mb.toFixed(1) + ' MB' : ''
    })

    /**
     * 把 markdown 发行说明解析成段落数组
     *
     * ★ 为什么在前端解析而不是让服务端给结构化数据 ★
     *   Gitee 发行版的 body 就是 markdown 原文，我们没法改它的格式。
     *   这里做一层宽容解析：
     *     '## 新增' / '### 修复' / '# 标题'  → 段落标题
     *     '- xxx' / '* xxx'                → 列表项
     *     '---'                            → 分隔线，跳过
     *     其它非空行                        → 归到「无标题段落」的条目里
     *   好处是任何格式的说明都能完整显示，最差退化成纯文本行，
     *   不会因为格式不认识就把内容吞掉。
     */
    const sections = computed(() => {
      const raw = String(info.value.notes || '')
      const out = []
      /** 当前正在累积的段落（没有 title 时是「无标题段落」） */
      let cur = { title: '', items: [] }

      const push = () => {
        if (cur.items.length > 0 || cur.title) out.push(cur)
        cur = { title: '', items: [] }
      }

      for (const rawLine of raw.split('\n')) {
        const line = rawLine.trim()
        if (!line) continue
        // 分隔线（Gitee 的自动生成说明里常见 '---'）
        if (/^-{3,}$/.test(line)) { push(); continue }

        // 标题：# / ## / ###
        const h = /^#{1,6}\s+(.+)$/.exec(line)
        if (h) { push(); cur.title = h[1].trim(); continue }

        // 列表项：- / *
        const li = /^[-*]\s+(.+)$/.exec(line)
        if (li) { cur.items.push(li[1].trim()); continue }

        // 普通行：当作条目正文（保留，不丢内容）
        cur.items.push(line)
      }
      push()

      // 全是空段落（说明为空）时给一句兜底，避免弹窗正文空白
      if (out.length === 0) {
        return [{ title: '', items: ['本次更新包含若干改进与修复。'] }]
      }
      return out
    })

    function dismiss() {
      updateStore.dismiss()
    }

    /** 「下次再说」/「取消下载」 */
    function onCancel() {
      updateStore.dismiss()
    }

    /** 「立即下载更新」：关弹窗、进度交给通知栏 */
    function onConfirm() {
      if (updateStore.phase !== 'idle') return
      updateStore.confirmDownload()
    }

    /*
     * 弹层栈登记：侧滑返回 / 返回键先收弹窗，不退出页面
     * （BalanceSheet 同款模式）
     */
    let unregister = null
    watch(
      () => updateStore.dialogVisible,
      (open) => {
        if (open) {
          if (!unregister) {
            unregister = pushLayer(() => { updateStore.dismiss() }, 'updateDialog')
          }
          return
        }
        if (unregister) {
          unregister()
          unregister = null
        }
      }
    )
    onUnmounted(() => {
      if (unregister) {
        unregister()
        unregister = null
      }
    })

    return {
      updateStore, info, sizeText, sections, primaryColor,
      dismiss, onCancel, onConfirm
    }
  }
}
</script>

<style scoped>
.ud-mask {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.45);
  /*
   * z-index 用 9（项目约定：页面内自绘浮层 1~9，
   * 低于 wot 库弹层 15 与 AppDialog 1000），
   * 保证「下载失败」的确认框能盖在它上面。
   */
  z-index: 9;
  display: flex;
  align-items: center;
  justify-content: center;
}

/*
 * 居中卡片（用户明确要求：不是从下面弹出，要在中间）
 *
 * ★ 和底部 sheet 的区别 ★
 *   底部 sheet 贴着屏幕下缘、只有上方两个圆角、宽 100%；
 *   这里是居中浮起的卡片：四角全圆、左右留边、高度受内容约束。
 *
 * ★ 为什么宽度用 640rpx 而不是 100% ★
 *   居中卡片必须有左右留白，否则在宽屏上会变成一条横幅。
 *   640rpx ≈ 320px，在常见手机上左右各留约 40rpx，
 *   和 AppDialog 的确认框宽度接近，视觉上是同一族群。
 */
.ud-sheet {
  width: 640rpx;
  background-color: var(--app-card);
  border-radius: 24rpx;
  display: flex;
  flex-direction: column;
  /*
   * ★ 不设 max-height ★
   *   正文区已经定死 46vh，头部和底部按钮是固定高度，
   *   卡片总高天然稳定（约 46vh + 200rpx 左右）。
   *   再加一条 max-height 反而会在小屏上把正文区压矮，
   *   破坏「固定滑动区域」这个约定。
   *   只在极端小屏（总高超屏）时由下面的 min() 兜一层。
   */
  max-height: min(88vh, 46vh + 260rpx);
  overflow: hidden;
}

/* 头部：版本号 + 新版本标记 + 大小 —— 结构对齐更新日志页 .rel-head */
.ud-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 32rpx 32rpx 24rpx;
  border-bottom: 1rpx solid var(--app-line);
  /* 卡片顶部圆角内不能溢出内容 */
  flex-shrink: 0;
}

.ud-head-left {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.ud-version {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--app-text);
}

/* 主题色小标记（同更新日志页的「当前」徽标：主题色文字 + 13% 底色） */
.ud-badge {
  font-size: 18rpx;
  padding: 2rpx 10rpx;
  border-radius: 8rpx;
  line-height: 1.5;
}

.ud-size {
  font-size: 22rpx;
  color: var(--app-text-3);
}

/* 测试模式提示条 */
.ud-tip {
  margin: 20rpx 32rpx 0;
  padding: 14rpx 20rpx;
  border-radius: 12rpx;
  font-size: 22rpx;
  line-height: 1.5;
  flex-shrink: 0;
}

/*
 * 发行说明区 —— **固定高度**
 *
 * ★ 用户要求：「更新内容过长时要能够滑动，固定滑动区域大小」★
 *   之前是 max-height: 50vh + flex: 1 混合，这是错的：
 *     · max-height 只封顶、不兜底 —— 内容短时区域会缩成两行高，
 *       卡片跟着忽大忽小，弹窗每次打开尺寸都不一样
 *     · flex: 1 又让它去抢剩余空间，和 max-height 语义打架，
 *       在 uni-app 各端表现还不一致
 *   现在直接用 height 定死：不管内容是 3 条还是 30 条，
 *   这块区域永远是同一个高度，超出的部分在内部滚动。
 *   卡片外观因此完全稳定，用户不会看到弹窗「跳」一下。
 *
 * ★ 为什么用 vh 而不是 rpx ★
 *   大屏手机上固定的 rpx 可能不够看，小屏可能超出。
 *   46vh 在主流手机上都落在一个「能看到 5~6 行正文」的合理区间，
 *   同时给头部和底部按钮留足空间（卡片总高上限 76vh）。
 */
.ud-notes {
  padding: 24rpx 32rpx 8rpx;
  height: 46vh;
  /*
   * ★ flex-shrink: 0 必须加 ★
   *   父级是 flex 列，默认允许收缩 ——
   *   不加的话当 header+footer 占位多时，这块会被压缩到比 46vh 矮，
   *   固定高度就失效了。
   */
  flex-shrink: 0;
}

.ud-section {
  margin-bottom: 24rpx;
}

.ud-section-title {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: var(--app-text);
  margin-bottom: 12rpx;
}

.ud-items {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

/*
 * 列表项：圆点 + 正文
 * ★ flex 而不是 text-indent ★
 *   圆点是独立 text，正文换行时对齐到正文起点（同更新日志页做法）。
 */
.ud-item {
  display: flex;
  align-items: flex-start;
  gap: 10rpx;
}

.ud-dot {
  font-size: 26rpx;
  line-height: 1.7;
  flex-shrink: 0;
  font-weight: 600;
}

.ud-text {
  flex: 1;
  font-size: 26rpx;
  color: var(--app-text-2);
  line-height: 1.7;
}

/* 底部按钮：左右并排，卡片内收边距 */
.ud-foot {
  display: flex;
  gap: 20rpx;
  padding: 24rpx 32rpx 32rpx;
  /* 卡片底部圆角内不能溢出，且不随正文滚动 */
  flex-shrink: 0;
}

.ud-btn-cancel,
.ud-btn-ok {
  flex: 1;
  height: 88rpx;
  border-radius: 22rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  font-weight: 600;
}

/*
 * 取消按钮必须有可见外框
 * （用户反馈过「和背景糊在一起」：--app-card-2 与 --app-bg 太接近）
 */
.ud-btn-cancel {
  background-color: var(--app-card);
  color: var(--app-text-2);
  border: 2rpx solid var(--app-line);
}

.ud-btn-ok {
  color: #ffffff;
}

/* 下载中：主按钮置灰，提示去通知栏看进度 */
.ud-btn-ok.busy {
  background-color: var(--app-card-2);
  color: var(--app-text-3);
  font-size: 26rpx;
}
</style>
