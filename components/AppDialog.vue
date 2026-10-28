<template>
  <wd-popup
    v-model="visible"
    position="center"
    transition="zoom-in"
    :z-index="zIndex"
    :close-on-click-modal="false"
    custom-style="background-color: transparent;"
    modal-style="background-color: var(--app-mask);"
    @click-modal="onClickModal"
  >
    <view class="app-dialog">
      <!-- 标题 -->
      <view v-if="title" class="app-dialog__title">
        <text class="app-dialog__title-text">{{ title }}</text>
      </view>

      <!-- 内容 -->
      <view v-if="content" class="app-dialog__body">
        <text class="app-dialog__content">{{ content }}</text>
      </view>

      <!-- prompt 模式：输入框 -->
      <view v-if="mode === 'prompt'" class="app-dialog__input-wrap">
        <input
          v-model="inputValue"
          class="app-dialog__input"
          :placeholder="placeholder"
          placeholder-class="app-dialog__input-placeholder"
          :adjust-position="false"
          confirm-type="done"
          @confirm="onConfirm"
        />
      </view>

      <!-- 按钮 -->
      <view class="app-dialog__actions" :class="hasCancel ? 'is-row' : 'is-col'">
        <wd-button
          v-if="hasCancel"
          type="info"
          block
          custom-class="app-dialog__btn"
          @click="onCancel"
        >
          {{ cancelText }}
        </wd-button>

        <wd-button
          type="primary"
          block
          custom-class="app-dialog__btn"
          :custom-style="confirmStyle"
          @click="onConfirm"
        >
          {{ confirmText }}
        </wd-button>
      </view>
    </view>
  </wd-popup>
</template>

<script>
import { ref, computed, onMounted, onUnmounted, getCurrentInstance } from 'vue'
import { registerDialogHost, unregisterDialogHost, currentRoute } from '@/utils/dialog.js'

/**
 * 全局弹窗宿主
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 为什么需要它 ★
 *   wot-design-uni 的 wd-message-box 是「函数式 + provide/inject」的：
 *   useMessage() 必须在组件的 setup() 里调用，
 *   而且必须有一个 <wd-message-box> 作为子组件来承载。
 *
 *   而 utils/dialog.js 里的 confirmDialog() 是普通函数，
 *   业务代码在 api 层（api/db/diagnose.js）、App.vue 里也能调用，
 *   那些地方拿不到组件实例，也就用不了 useMessage()。
 *
 *   所以由本组件做「宿主」：
 *     - setup 里实现 confirm / alert / prompt 三个方法
 *     - 挂载时注册到 utils/dialog.js 的宿主栈
 *     - 卸载时注销
 *
 *   业务代码只管 await confirmDialog({...})，样式由这里统一。
 *
 * ★ 为什么自己画而不是直接用 <wd-message-box> ★
 *   1. 库的 msg 是用 {{ }} 插值渲染的，HTML 里 \n 会被折叠成空格 ——
 *      自检报告、导入明细、导出路径这些都是多行内容，必须自己处理换行；
 *   2. prompt 模式（输入「确认清空」这类）需要完全掌控输入框；
 *   3. 危险操作的红色确定按钮要跟页面里的删除按钮用同一个色值。
 *
 * ★ 为什么每个用得上的页面/组件都要挂一个 ★
 *   弹窗必须挂在「当前可见页面」里才能盖在页面上，
 *   所以凡是会调 confirmDialog / alertDialog 的页面或组件，
 *   都要在模板里放一个 <AppDialog />。
 *   utils/dialog.js 里用「宿主栈」管理多个实例，
 *   后挂载的（也就是最上层的）优先。
 */
export default {
  name: 'AppDialog',
  setup() {
    const instance = getCurrentInstance()

    /**
     * 自己所属的页面路径。
     *
     * 用来让 utils/dialog.js 判断「这个弹窗该显示在哪个页面上」——
     * 否则在下面页面触发的弹窗会跑到上面那个页面去。
     *
     * ★ 两种取法 ★
     *   1. 页面里的 <AppDialog />：组件实例上有 __route（uni-app 给页面组件挂的）
     *   2. 组件里的 <AppDialog />（如 QuickAddBar）：
     *      没有 __route，但它是跟着当前页面走的，
     *      直接用「当前栈顶页面」就是对的。
     *
     * @returns {string}
     */
    function resolveRoute() {
      const own = instance && instance.type && instance.type.__route
      if (own) return own
      return currentRoute()
    }

    /**
     * 弹层层级。
     *
     * 必须高于页面里自绘的整屏浮层：
     *   - QuickAddBar 的输入条遮罩是 600
     *   - 交易列表的筛选面板是 100
     * 不然弹窗会被压住，表现为「弹窗看不见也点不到」。
     */
    const zIndex = 1000

    const visible = ref(false)
    /** 'confirm' | 'alert' | 'prompt' */
    const mode = ref('alert')
    const title = ref('')
    const content = ref('')
    const confirmText = ref('确定')
    const cancelText = ref('取消')
    const placeholder = ref('')
    const inputValue = ref('')
    const danger = ref(false)

    /** 当前这次弹窗的 resolve 回调 */
    let pending = null
    /** 本次是否已经结算过（防止重复 resolve） */
    let settled = false

    const hasCancel = computed(() => mode.value === 'confirm' || mode.value === 'prompt')

    const confirmStyle = computed(() => {
      // 危险操作（删除、清空、覆盖）用红色确定按钮
      if (!danger.value) return ''
      return 'background-color: var(--app-danger); color: #ffffff;'
    })

    /**
     * 打开弹窗。
     *
     * ★ 顺序很重要 ★
     *   先挂上 resolve，再把 visible 置 true ——
     *   否则极端情况下（同一帧内用户就点了按钮）会 resolve 不到。
     *
     * ★ 串行队列在 utils/dialog.js 里 ★
     *   全 App 同时只允许一个弹窗，
     *   排队逻辑放在全局（而不是每个宿主各一条），
     *   才不会出现「两个页面的弹窗同时开、互相覆盖」。
     *
     * @param {Object} next
     * @returns {Promise<any>}
     */
    function open(next) {
      return new Promise((resolve) => {
        pending = resolve
        settled = false
        mode.value = next.mode
        title.value = next.title || ''
        content.value = next.content || ''
        confirmText.value = next.confirmText || '确定'
        cancelText.value = next.cancelText || '取消'
        placeholder.value = next.placeholder || ''
        inputValue.value = ''
        danger.value = !!next.danger
        visible.value = true
      })
    }

    /**
     * 关闭弹窗并把结果交回给调用方。
     *
     * @param {boolean} ok true = 点了确定
     */
    function finish(ok) {
      if (settled) return
      settled = true
      visible.value = false

      const resolve = pending
      pending = null
      if (!resolve) return

      if (mode.value === 'prompt') {
        // 取消返回 null，让调用方能区分「取消」和「输入了空串」
        resolve(ok ? inputValue.value : null)
      } else {
        resolve(ok)
      }
    }

    function onConfirm() {
      finish(true)
    }

    function onCancel() {
      finish(false)
    }

    /**
     * 点蒙层。
     *
     * 原生 showModal 点蒙层不会关闭，但自绘弹窗如果点蒙层没反应，
     * 用户会以为卡住了 —— 所以这里把「点蒙层」当成「取消」。
     *
     * 注意 wd-popup 的 close-on-click-modal 传的是 false，
     * 所以关闭得由我们自己做（finish 里会置 visible = false）。
     */
    function onClickModal() {
      finish(false)
    }

    /**
     * 确认框
     * @param {Object} opts
     * @returns {Promise<boolean>}
     */
    function doConfirm(opts) {
      return open({
        ...opts,
        mode: 'confirm'
      })
    }

    /**
     * 单按钮提示框
     * @param {Object} opts
     * @returns {Promise<void>}
     */
    function doAlert(opts) {
      return open({
        ...opts,
        mode: 'alert'
      }).then(() => undefined)
    }

    /**
     * 输入框弹窗
     * @param {Object} opts
     * @returns {Promise<string|null>}
     */
    function doPrompt(opts) {
      return open({
        ...opts,
        mode: 'prompt'
      }).then((v) => (v === null ? null : String(v)))
    }

    const host = {
      confirm: doConfirm,
      alert: doAlert,
      prompt: doPrompt
    }

    onMounted(() => {
      registerDialogHost(host, resolveRoute())
    })

    onUnmounted(() => {
      unregisterDialogHost(host)
      // 页面被销毁时如果弹窗还开着，把等待方叫醒（按「取消」处理），
      // 否则调用方的 await 会永远挂在那里。
      if (pending && !settled) {
        settled = true
        const resolve = pending
        pending = null
        resolve(false)
      }
    })

    return {
      zIndex, visible, mode, title, content, confirmText, cancelText,
      placeholder, inputValue, confirmStyle, hasCancel,
      onConfirm, onCancel, onClickModal
    }
  }
}
</script>

<style scoped>
/**
 * 弹窗卡片
 *
 * 颜色全部走 --app-* 变量（由页面的 settingStore.cssVars 注入），
 * 所以深浅色、主题色自动跟随，和页面完全一致。
 */
.app-dialog {
  width: 600rpx;
  max-width: 80vw;
  border-radius: 24rpx;
  background-color: var(--app-card);
  overflow: hidden;
  box-shadow: 0 16rpx 64rpx rgba(0, 0, 0, 0.18);
}

.app-dialog__title {
  padding: 44rpx 40rpx 8rpx;
  text-align: center;
}

.app-dialog__title-text {
  font-size: 34rpx;
  font-weight: 600;
  line-height: 1.4;
  color: var(--app-text);
}

.app-dialog__body {
  padding: 12rpx 40rpx 8rpx;
}

.app-dialog__content {
  display: block;
  text-align: center;
  font-size: 28rpx;
  line-height: 1.65;
  color: var(--app-text-2);
  /* ★ 内容里可能有换行（如自检报告、导入明细）★ */
  white-space: pre-wrap;
  word-break: break-word;
}

.app-dialog__input-wrap {
  padding: 8rpx 40rpx 0;
}

.app-dialog__input {
  height: 80rpx;
  padding: 0 24rpx;
  border-radius: 12rpx;
  background-color: var(--app-card-2);
  font-size: 28rpx;
  color: var(--app-text);
}

.app-dialog__input-placeholder {
  color: var(--app-text-3);
  font-size: 26rpx;
}

.app-dialog__actions {
  display: flex;
  padding: 32rpx 40rpx 40rpx;
  gap: 20rpx;
}

.app-dialog__actions.is-row {
  flex-direction: row;
}

.app-dialog__actions.is-col {
  flex-direction: column;
}

/**
 * 两个按钮等宽
 *
 * wd-button 的 is-block 只是 display:block，
 * 在 flex 容器里宽度还是按内容算，所以要显式 flex: 1。
 */
:deep(.app-dialog__btn) {
  flex: 1;
  margin-left: 0;
  margin-right: 0;
}
</style>
