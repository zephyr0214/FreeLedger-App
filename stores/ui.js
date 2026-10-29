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
    pendingAdd: null

    /*
     * ★ 这里曾经有 lastTabIndex（记录上次选中的 tab 序号）★
     *   它是为了「跨页面滑块位移动画」而加的：切 tab 时记下旧位置，
     *   新页面挂载时从旧位置滑到新位置。
     *   但 4 个 tab 是不同 webview，新页面的渲染过程用户看不到，
     *   位移早已跑完 —— 这个方案在真机上从未生效过。
     *   用户最终要求「删除滑块动效，硬切即可」，所以一并删掉了。
     */
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
    }
  }
})
