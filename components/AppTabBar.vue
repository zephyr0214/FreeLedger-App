<template>
  <view class="tabbar-host" :class="{ pressing }">
    <!--
      圆角悬浮底栏
      ★ 为什么不用原生 tabBar ★
        原生 tabBar 由系统绘制，做不了圆角、悬浮、留白、阴影，
        App 端也没有「自定义 tabBar」选项（只有小程序有 custom:true）。
        所以这里用原生 tabBar 只保留「页面切换」的能力（pages.json 里的声明），
        运行时把它隐藏掉（uni.hideTabBar），视觉全部由本组件负责。

      ★ 底栏和 + 按钮是「两块独立的悬浮块」★
        用户要求两者不要连在一起，所以这里是两个分开的圆角容器：
          · 左边 pill：4 个 tab 平分
          · 右边圆形：记账 +
        中间留出 GAP 的透明空隙，不共用一个外框。
    -->
    <view class="tabbar-row">
      <!-- 左：tab pill -->
      <view class="tabbar" :style="barStyle">
        <view
          v-for="item in items"
          :key="item.name"
          class="tab-item"
          @click="onTabClick(item)"
        >
          <image
            class="tab-icon"
            :src="iconOf(item)"
            mode="aspectFit"
          />
          <text class="tab-text" :style="{ color: item.active ? primaryColor : fontColor }">
            {{ item.text }}
          </text>
        </view>
      </view>

      <!-- 右：记账 + 按钮，独立圆形，与 pill 之间留空隙
           ★ 形状不变 ★ 还是圆形，高度与 pill 一致，视觉上齐平 -->
      <view
        class="tab-add"
        :class="{ pressing }"
        :style="{ backgroundColor: primaryColor }"
        @touchstart.stop.prevent="onTouchStart"
        @touchend.stop.prevent="onTouchEnd"
        @touchcancel.stop.prevent="onTouchCancel"
        @touchmove.stop.prevent="onTouchMove"
      >
        <text class="add-icon" :class="{ rotated: pressing }">+</text>

        <!-- 长按进度环：转满一圈即打开手动记账 -->
        <view v-if="pressing && holdEnabled" class="add-ring">
          <view class="add-ring-inner" :style="ringStyle" />
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { ref, computed } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { TABBAR_ICON_VERSION } from '@/utils/theme.js'

/**
 * 长按触发时长（ms）
 * 与旧 FabButton 保持一致：300ms 按住即弹面板，不用等松手。
 */
const HOLD_MS = 300

/**
 * 四个 tab 的定义。
 *
 * ★ 必须与 pages.json 的 tabBar.list 顺序一致 ★
 *   点击时用 uni.switchTab 跳页面，路径写错会静默失败（不报错、不跳转）。
 *   scripts/check-tabbar.mjs 有一条断言在校验这一点。
 */
const TABS = [
  { name: 'home', text: '首页', path: '/pages/index/index' },
  { name: 'account', text: '账户', path: '/pages/account/index' },
  { name: 'stats', text: '统计', path: '/pages/stats/index' },
  { name: 'mine', text: '我的', path: '/pages/mine/index' }
]

export default {
  name: 'AppTabBar',
  props: {
    /**
     * 当前选中的 tab 名（home / account / stats / mine）。
     * 由各 tab 页自己传 —— 组件不猜当前路由，
     * 因为 uni-app 没有可靠的「同步获取当前页」接口。
     */
    current: { type: String, default: 'home' },
    /**
     * 长按 + 是否启用。
     * 「设置 → 记账按钮设置」里长按可以被设成「不响应」，
     * 这时连进度环和震动一起关掉——转完却什么都不发生比没反应更困惑。
     */
    holdEnabled: { type: Boolean, default: true }
  },
  /**
   * ★ 事件名不要用 tap / click ★
   *   它们是 uni-app 模板的原生事件别名，会与自定义 emit 撞车
   *   （旧 FabButton 踩过这个坑）。
   */
  emits: ['single-press', 'hold-start', 'hold-end', 'hold-cancel'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()

    const pressing = ref(false)
    const progress = ref(0)

    let startTs = 0
    let longFired = false
    let timer = null
    let rafTimer = null
    let startX = 0
    let startY = 0

    const primaryColor = computed(() => settingStore.primaryColor)

    /** 未选中态的文字色：跟着深浅模式走，与 theme.json 的 tabFontColor 一致 */
    const fontColor = computed(() => (settingStore.isDark ? '#A1A1A6' : '#646566'))

    /**
     * 底栏外观：圆角 + 边框 + 阴影，深浅色各一套。
     *
     * 用 primaryColor 之外的固定值，是因为底栏属于「容器」，
     * 主题只换主色和文字/图标选中色，容器底色跟卡片保持一致。
     */
    const barStyle = computed(() => {
      const dark = settingStore.isDark
      return {
        backgroundColor: dark ? '#1C1C1E' : '#FFFFFF',
        borderColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
        boxShadow: dark
          ? '0 8rpx 32rpx rgba(0,0,0,0.55)'
          : '0 8rpx 32rpx rgba(0,0,0,0.10)'
      }
    })

    /** 进度环描边比例 */
    const ringStyle = computed(() => ({
      background: `conic-gradient(${primaryColor.value} ${progress.value * 360}deg, transparent ${progress.value * 360}deg)`
    }))

    /** tab 列表（补上 active 标记） */
    const items = computed(() =>
      TABS.map((t) => ({ ...t, active: t.name === props.current }))
    )

    /**
     * 图标路径。
     *
     * ★ 复用 static/tabbar/ 下那套 PNG ★
     *   文件名带版本号（-v2），是覆盖安装时绕过原生位图缓存用的。
     *   现在图标由我们自己绘制，理论上不再走原生缓存；
     *   但路径保持一致，就不要为了「看起来没用了」再去改文件名。
     */
    function iconOf(item) {
      const dark = settingStore.isDark
      const preset = settingStore.settings.themePreset
      const suffix = dark ? '-dark' : ''
      if (item.active) {
        return `/static/tabbar/${item.name}-active-${preset}${TABBAR_ICON_VERSION}.png`
      }
      return `/static/tabbar/${item.name}${suffix}${TABBAR_ICON_VERSION}.png`
    }

    /* ------------------------------------------------------ tab 点击 */

    /**
     * 点 tab 切换页面。
     *
     * ★ 必须用 switchTab ★
     *   这 4 个页面在 pages.json 里声明为 tabBar 页，
     *   navigateTo / redirectTo 都会失败。
     *   点当前 tab 则什么都不做（避免重复通知原生栏重建页面）。
     */
    function onTabClick(item) {
      if (item.active) return
      // 点走之前先收起可能存在的右滑/弹层状态由各页面自理
      try {
        uni.switchTab({ url: item.path })
      } catch (e) {}
    }

    /* ------------------------------------------------------ 长按手势 */

    function clearTimer() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    function clearRaf() {
      if (rafTimer) {
        cancelAnimationFrame(rafTimer)
        rafTimer = null
      }
      progress.value = 0
    }

    /** 进度环逐帧推进 */
    function tick() {
      if (!pressing.value) return
      const elapsed = Date.now() - startTs
      progress.value = Math.min(elapsed / HOLD_MS, 1)
      if (progress.value < 1) {
        rafTimer = requestAnimationFrame(tick)
      }
    }

    function onTouchStart(e) {
      const t = e.touches && e.touches[0]
      if (t) {
        startX = t.clientX
        startY = t.clientY
      }
      startTs = Date.now()
      longFired = false
      pressing.value = true
      progress.value = 0

      // 长按被关掉：不启动计时器、不震动、不发 hold 事件，
      // 松手时按短按处理（短按仍然可用）
      if (!props.holdEnabled) return

      timer = setTimeout(() => {
        longFired = true
        try {
          uni.vibrateShort({ type: 'medium' })
        } catch (err) {}
        emit('hold-start')
        emit('hold-end')
        pressing.value = false
        clearRaf()
        clearTimer()
      }, HOLD_MS)

      if (typeof requestAnimationFrame === 'function') {
        rafTimer = requestAnimationFrame(tick)
      }
    }

    function onTouchEnd() {
      clearTimer()
      clearRaf()
      const delta = Date.now() - startTs
      const wasLong = props.holdEnabled && (longFired || delta >= HOLD_MS)

      if (wasLong) {
        // 到达阈值时已经自动触发过了，这里不重复
        if (!longFired) emit('hold-end')
      } else {
        emit('single-press')
      }
      longFired = false
      pressing.value = false
    }

    function onTouchCancel() {
      clearTimer()
      clearRaf()
      if (longFired) {
        longFired = false
        emit('hold-cancel')
      }
      pressing.value = false
    }

    function onTouchMove(e) {
      const t = e.touches && e.touches[0]
      if (!t) return
      // 手指明显移动 → 取消长按
      const dx = Math.abs(t.clientX - startX)
      const dy = Math.abs(t.clientY - startY)
      if (dx > 30 || dy > 30) {
        clearTimer()
        clearRaf()
        if (longFired) {
          longFired = false
          emit('hold-cancel')
        }
        pressing.value = false
      }
    }

    return {
      items, primaryColor, fontColor, barStyle, ringStyle, pressing,
      iconOf, onTabClick,
      onTouchStart, onTouchEnd, onTouchCancel, onTouchMove
    }
  }
}
</script>

<style scoped>
/*
 * 宿主容器：固定在底部，只负责「贴底 + 让内容居中」。
 *
 * ★ 不再用 left:0 + right:0 铺满 ★
 *   铺满时内部 pill 会被拉成一条横条（之前的 flex:1 就是这么变的），
 *   看着像「原生底栏换了个皮」，没有悬浮感。
 *   现在用 left/right 双向 auto 让容器宽度由内容决定、水平居中，
 *   两侧留出页面背景，才是浮起来的一小块。
 *
 * ★ z-index 要比页面内容和大部分弹层高，但低于全屏记账面板 ★
 *   记账面板是 wd-popup（z-index 默认 500+），
 *   底栏 300 —— 面板打开时盖住底栏，底栏本身不消失。
 */
.tabbar-host {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 300;
  /* 内容整体居中；padding 只负责离屏幕底边和安全区的距离 */
  display: flex;
  justify-content: center;
  padding: 0 24rpx calc(env(safe-area-inset-bottom) + 16rpx) 24rpx;
  /* 容器不吃触摸事件，只有内部两块吃，避免整条透明区域挡点击 */
  pointer-events: none;
}

/*
 * 横向排布：左 pill + 右圆按钮，两者**分开**且整体居中。
 *
 * ★ gap 是这一版的关键 ★
 *   用户明确要求「tabbar 和 + 按钮不要连在一起」，
 *   所以这里不用「一个大外框里塞两半」的做法，
 *   而是两个独立浮块 + 中间 20rpx 的透明间隔。
 *
 * ★ 不撑满宽度 ★
 *   以前 pill 用 flex:1 吃满剩余空间，看着像一条「通到底的横条」，
 *   失去悬浮感。现在整体居中、pill 给固定宽度，
 *   两侧露出页面背景，才是「浮起来的一块」。
 */
.tabbar-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20rpx;
  pointer-events: none;
}

/*
 * 左：4 个 tab 的胶囊
 *
 * ★ 圆角用 999rpx（全圆角胶囊），不用固定值 ★
 *   右侧 + 按钮是正圆（border-radius: 50%），
 *   曲率 = 直径的一半。pill 高度 108rpx 时，
 *   只有半径取到 54rpx（= 高度的一半，用 999rpx 直接封顶）
 *   两端才是半圆，和圆按钮的弧度看起来才是一套的。
 *   之前写 36rpx 明显比圆按钮「方」，所以显得不统一。
 *
 * ★ 宽度收窄到 440rpx ★
 *   4 个 tab 各 110rpx，图标 44rpx + 文字，够用且更紧凑。
 */
.tabbar {
  width: 420rpx;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 96rpx;
  border-radius: 999rpx;
  border-width: 1rpx;
  border-style: solid;
  padding: 0 8rpx;
  /* 只有 pill 本体吃点击 */
  pointer-events: auto;
}

.tab-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  /* 点击反馈由文字/图标变色体现，不做缩放，避免抖动 */
}

/*
 * 图标尺寸
 * ★ 22px ≈ 44rpx ★
 *   与原生 tabBar 那时的 iconWidth 同一个视觉量级。
 *   换成自绘后不再受 pages.json 影响，所以这里就是唯一来源。
 */
.tab-icon {
  width: 44rpx;
  height: 44rpx;
  pointer-events: none;
}

.tab-text {
  font-size: 22rpx;
  line-height: 1;
  margin-top: 6rpx;
  pointer-events: none;
}

/* ------------------------------------------------------ + 按钮 */

/*
 * ★ 形状不变：还是圆形 ★
 *   它是**独立的一块**，不和左边 pill 连成一条。
 *   高度与 pill 相同（108rpx），所以两块上下齐平；
 *   宽度也取 108rpx 让它是个正圆。
 *
 * ★ 圆角与 pill 的统一关系 ★
 *   border-radius: 50% 时，半径 = 108 / 2 = 54rpx。
 *   pill 用 999rpx 封顶后半径同样是「高度的一半」= 54rpx。
 *   两者曲率相同，看起来才是一套的 —— 改这里的高度时，
 *   pill 的 999rpx 会自动跟着对齐，无需同步改数字。
 */
.tab-add {
  position: relative;
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 6rpx 18rpx rgba(0, 0, 0, 0.18);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  /* 独立浮块：自己吃点击 */
  pointer-events: auto;
}

.tabbar-host.pressing .tab-add,
.tab-add:active {
  transform: scale(1.06);
}

.add-icon {
  color: #ffffff;
  font-size: 56rpx;
  font-weight: 300;
  line-height: 1;
  margin-top: -4rpx;
  transition: transform 0.18s ease;
}

.add-icon.rotated {
  transform: rotate(45deg);
}

/* 长按进度环：绕着按钮画一圈，走满即打开面板 */
.add-ring {
  position: absolute;
  top: 0;
  left: 0;
  width: 96rpx;
  height: 96rpx;
  z-index: 1;
  pointer-events: none;
}

.add-ring-inner {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  -webkit-mask: radial-gradient(circle, transparent 52rpx, #000 54rpx);
  mask: radial-gradient(circle, transparent 52rpx, #000 54rpx);
}
</style>
