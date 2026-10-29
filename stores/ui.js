/**
 * 跨页面的一次性 UI 意图
 *
 * ★ 为什么要这个东西 ★
 *   记账面板（TxnPanel）和速记输入条（QuickAddBar）目前只挂在首页。
 *   但底栏的「+」按钮在 4 个 tab 页都有（用户要求统一），
 *   在账户/统计/我的页点「+」时就需要：
 *     1. 先 switchTab 回首页
 *     2. 回到首页后把面板打开
 *   第 2 步不能直接调 —— 那时首页还没 onShow，
 *   所以在 store 里放一个「待办意图」，首页 onShow 时取走执行。
 *
 * ★ 为什么不用 URL 参数 ★
 *   switchTab 不支持带参数（官方限制），
 *   只能在全局状态里传递。
 */

import { defineStore } from 'pinia'

export const useUiStore = defineStore('ui', {
  state: () => ({
    /**
     * 待执行的记账打开意图：
     *   null      没有任何待办
     *   'ai'      回首页后打开 AI 速记输入条
     *   'manual'  回首页后打开手动记账面板
     */
    pendingAdd: null,

    /**
     * 上一次选中的 tab 序号（0..3）。
     *
     * ★ 为什么滑块动效需要这个 ★
     *   4 个 tab 是不同的页面，切 tab 时 uni-app 会切换 webview，
     *   AppTabBar 跟着**整个重新挂载**。新组件一渲染出来
     *   transform 就已经在「正确位置」了，从来没有发生过变化，
     *   所以 CSS transition 根本没机会触发 —— 表现就是「没有滑块」。
     *
     *   把上次位置存到全局 store 里，新挂载时就能：
     *     1. 先用旧位置渲染（那一帧滑块还在老地方）
     *     2. 下一帧再改成新位置
     *   这样 transform 有了「从 A 到 B」的变化，动画就出来了。
     *
     * -1 表示「还没有历史」，首次进入时不做位移动画。
     */
    lastTabIndex: -1
  }),

  actions: {
    /**
     * 记下「回首页后要打开记账」。
     * @param {'ai'|'manual'} mode
     */
    requestAdd(mode) {
      this.pendingAdd = mode === 'manual' ? 'manual' : 'ai'
    },

    /**
     * 取走待办意图（取走即清空，避免下次 onShow 又弹一次）。
     * @returns {'ai'|'manual'|null}
     */
    consumePendingAdd() {
      const mode = this.pendingAdd
      this.pendingAdd = null
      return mode
    },

    /** 记录当前选中的 tab 序号，供下一页挂载时做滑动动画 */
    setLastTabIndex(i) {
      this.lastTabIndex = Number(i) || 0
    }
  }
})
