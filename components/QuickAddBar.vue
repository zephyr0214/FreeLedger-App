<template>
  <view v-if="visible" class="quick-add-mask">
    <!--
      ★ 背景层：只负责「挡住页面 + 点空白关闭」★
        触摸拦截必须挂在这一层，而不是包着输入条的 .quick-add-mask 上。

        踩过的坑：以前 @touchmove.stop.prevent="noop" 挂在 .quick-add-mask，
        而输入条是它的**子节点** —— 手指在输入框里左右拖时，touchmove
        从 input 冒泡到遮罩就被 preventDefault 掉了，
        原生输入框的长按选中、拖动 caret、文本横向滚动全部被吞，
        表现为「文本太长时滑不动、看不到被遮住的部分」。

        现在改成兄弟层结构：
          背景层（拦截触摸） + 输入条（浮在上面，不拦截默认行为）
        输入框里的事件冒泡到 .quick-add-mask 时已无任何处理器，原生行为得以保留。
    -->
    <view
      class="quick-add-mask-bg"
      @click="onMaskClick"
      @touchmove.stop.prevent="noop"
    />

    <!--
      输入条：只保留 click 拦截（点条内不关闭）。
      @touchmove 只用 .stop 拦住「页面穿透滚动」，绝不能加 .prevent ——
      那会把输入框自己的横向滚动/选区一起废掉。
    -->
    <view class="quick-add-bar" :style="barStyle" @click.stop @touchmove.stop>
      <!-- 左侧：输入框 -->
      <input
        ref="inputRef"
        v-model="draft"
        class="bar-input"
        :focus="autoFocus"
        :disabled="submitting"
        :adjust-position="false"
        :cursor-spacing="12"
        confirm-type="send"
        :confirm-hold="true"
        placeholder="说一句话，如「昨天午饭45，打车28」"
        placeholder-class="bar-placeholder"
        @confirm="submit"
      />

      <!-- 右侧：发送按钮（+ 号变身） -->
      <view
        class="bar-send"
        :style="{ backgroundColor: canSend ? primaryColor : 'var(--app-line)' }"
        @touchstart.stop
        @click.stop="submit"
      >
        <text v-if="submitting" class="send-icon">···</text>
        <text v-else class="send-icon">↑</text>
      </view>
    </view>
  </view>

  <!-- 全局弹窗宿主（组件库重绘的确认框） -->
  <AppDialog />
</template>

<script>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import AppDialog from '@/components/AppDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { listCategories } from '@/api/category.js'
import { listTags } from '@/api/tag.js'
import { parseMessageToTransactions } from '@/api/aiParse.js'
import { combineDayTime } from '@/utils/date.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'
import { glassVars } from '@/utils/theme.js'
import { pushLayer } from '@/utils/layerStack.js'

export default {
  name: 'QuickAddBar',
  props: {
    modelValue: { type: Boolean, default: false }
  },
  emits: ['update:modelValue', 'saved', 'parsing-start', 'parsing-end'],
  components: { AppDialog },
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()
    const txnStore = useTransactionStore()

    const draft = ref('')
    const submitting = ref(false)
    const autoFocus = ref(false)
    const inputRef = ref(null)
    const keyboardHeight = ref(0)

    /**
     * 遮罩是否可点击关闭。
     * ★ 防幽灵点击 ★
     *   触摸 FAB 抬起时会触发 openQuickAdd，同时浏览器还会补发一次 click。
     *   输入条是那一刻才渲染的，这次补发的 click 就会落到刚出现的遮罩上，
     *   于是「刚打开就被关闭」，表现为单击没反应。
     *   打开后 350ms 内忽略遮罩点击即可。
     */
    const maskEnabled = ref(false)
    let maskTimer = null

    /** 本次打开期间键盘是否曾真正弹出过（用于区分"还没弹"和"已收起"） */
    let keyboardEverShown = false

    /** close() 重入锁 */
    let closing = false

    /**
     * 聚焦兜底定时器。
     * ★ 必须保存并在关闭时清掉 ★
     *   原先这两个 setTimeout 没被引用，close() 时无法取消。
     *   组件已经关闭销毁后，定时器仍会执行 autoFocus=false→true，
     *   把下一次打开时的聚焦状态打乱，表现为「第二次起键盘不弹」。
     */
    let focusTimer = null

    function clearFocusTimers() {
      if (focusTimer) {
        clearTimeout(focusTimer)
        focusTimer = null
      }
    }

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    const primaryColor = computed(() => settingStore.primaryColor)
    const canSend = computed(() => draft.value.trim().length > 0 && !submitting.value)

    /**
     * 输入条位置：贴在 webview 底部。
     *
     * ★ 键盘高度不能叠加 ★
     *   softinputMode = adjustResize 时，webview 会收缩到键盘上沿，
     *   此时 position:fixed 的 bottom:0 天然就贴在键盘上沿。
     *   若 bottom 再写成键盘高度，等于又抬一次 ——
     *   表现为「输入框飞到屏幕中间」或「离键盘一大段距离」。
     *
     *   所以这里只加安全区，键盘高度一律不参与定位。
     *   （keyboardHeight 仅用于判断键盘是否被系统收起。）
     */
    /**
     * 输入条样式：定位 + 柔光玻璃配色。
     *
     * ★ 玻璃变量和底部 tabbar / 对话框同源 ★
     *   都走 utils/theme.js 的 glassVars()，三处观感一致，
     *   以后改玻璃参数只要动那一个函数。
     *   透明度取 tabbar 那一档（浅 0.62 / 深 0.48）：
     *   输入条是浮在页面内容上方的一小块，透一点更「浮」；
     *   上面的文字有 placeholder 深色衬底兜着，可读性没问题。
     */
    const barStyle = computed(() => ({
      bottom: 'calc(env(safe-area-inset-bottom) + 20rpx)',
      ...glassVars(settingStore.isDark, { blur: '24rpx' })
    }))

    /* ------------------------------------------------------ 键盘 */

    let keyboardTimer = null

    function bindKeyboard() {
      try {
        if (typeof uni.onKeyboardHeightChange === 'function') {
          uni.onKeyboardHeightChange((res) => {
            const h = res.height || 0
            keyboardHeight.value = h

            /**
             * 键盘被系统收起（点空白、按返回键）时，监听会收到 height=0。
             * 此时组件自己并不知道，若不主动收尾，会出现：
             *   - 输入条还在，但位置错乱/空白
             *   - FAB 因为 hidden=showQuickAdd 一直不显示
             * 所以高度归零且已经打开过时，直接关闭输入态。
             */
            if (h === 0 && visible.value && keyboardEverShown) {
              close()
            }
            if (h > 0) keyboardEverShown = true
          })
        }
      } catch (e) {}
    }

    function unbindKeyboard() {
      try {
        if (typeof uni.offKeyboardHeightChange === 'function') {
          uni.offKeyboardHeightChange()
        }
      } catch (e) {}
      if (keyboardTimer) clearTimeout(keyboardTimer)
    }

    /* ------------------------------------------------------ 提交 */

    async function submit() {
      const text = draft.value.trim()
      if (!text || submitting.value) return

      // 没配 API Key 直接提示，避免无谓请求
      const ai = settingStore.settings.ai || {}
      if (!ai.apiKey) {
        const goConfig = await confirmDialog({
          title: '需要先配置 AI',
          content: '智能记账需要调用大模型解析你的输入。请到「我的 → AI 大模型」填写 API Key。',
          confirmText: '去配置',
          cancelText: '取消'
        })
        // ★ 只有用户点了「去配置」才跳转，取消就什么都不做 ★
        if (goConfig) {
          close()
          uni.navigateTo({ url: '/pages/settings/ai' })
        }
        return
      }

      submitting.value = true

      // 通知首页在最近交易顶部插入「正在解析」占位行
      emit('parsing-start', { text: text.length > 18 ? text.slice(0, 18) + '…' : text })

      // 解析期间先收起输入态，让用户能看到列表里的占位行
      const pendingText = text
      close()

      try {
        const [categories, tags] = await Promise.all([listCategories(), listTags()])
        await accountStore.load()

        // ★ AI 解析要能识别组合账户 ★
        //   用户日常「碰一碰/自动续费」用组合记，AI 记账也该支持。
        //   组合是虚拟账户，AI 选了它，落库时由 api 层解析成真实账户，
        //   所以这里把**全部**账户（含组合）传给解析器。
        if (accountStore.list.length === 0) {
          throw new Error('还没有账户，请先添加一个账户')
        }

        // 默认账户必须是真实账户（组合不能当默认）
        const realAccounts = accountStore.list.filter((a) => !a.isCombo)
        const prefDefault = settingStore.settings.defaultAccountId || ''
        const defaultAccountId = accountStore.list.some((a) => a.id === prefDefault && !a.isCombo)
          ? prefDefault
          : (realAccounts[0] || accountStore.list[0] || {}).id || ''

        const result = await parseMessageToTransactions(pendingText, {
          categories,
          accounts: accountStore.list,
          tags,
          defaultAccountId,
          baseDate: new Date()
        })

        // 逐条落库
        let saved = 0
        const failures = []

        for (const item of result.items) {
          try {
            await txnStore.create({
              type: item.type,
              amount_cents: item.amount_cents,
              account_id: item.account_id,
              to_account_id: item.to_account_id,
              category_id: item.category_id,
              occurred_day: item.occurred_day,
              // ★ 模型识别出时刻就用它，否则由 store 按「此刻」处理
              occurred_at: item.occurred_time
                ? combineDayTime(item.occurred_day, item.occurred_time)
                : undefined,
              /*
               * 备注：优先用模型给的备注，没有就退回用户原话。
               * 用户原话仍作为「备注」保存 —— 这是他自己输入的说明，
               * 和已停用的「速记原文」不是同一件事。
               */
              note: item.note || pendingText,
              tag_ids: item.tag_ids
            })
            saved++
          } catch (e) {
            failures.push(e.message)
          }
        }

        if (saved > 0) {
          const summary = result.items
            .slice(0, 3)
            .map((i) => `${i.category_name || i.type} ¥${(i.amount_cents / 100).toFixed(2)}`)
            .join('、')
          const more = result.items.length > 3 ? ` 等 ${result.items.length} 笔` : ''

          uni.showToast({
            title: `已记 ${saved} 笔：${summary}${more}`,
            icon: 'none',
            duration: 2500
          })

          emit('saved')
        }

        // 部分失败或校验警告要告知用户
        const notes = [...result.warnings, ...failures]
        if (notes.length > 0 && saved > 0) {
          setTimeout(() => {
            alertDialog({
              title: '部分记录未保存',
              content: notes.slice(0, 5).join('\n')
            })
          }, 800)
        }
      } catch (e) {
        await alertDialog({
          title: '识别失败',
          content: e.message
        })
      } finally {
        submitting.value = false
        // 无论成功失败都要结束占位行动效
        emit('parsing-end')
      }
    }

    function onMaskClick() {
      if (!maskEnabled.value) return
      close()
    }

    /** 阻止遮罩上的滑动穿透到页面 */
    function noop() {}

    function close() {
      // 防重入：hideKeyboard() 会让键盘高度归零，
      // 而监听回调里 height===0 又会调 close()，不加锁会递归
      if (closing) return
      closing = true
      visible.value = false
      draft.value = ''
      autoFocus.value = false
      keyboardHeight.value = 0
      maskEnabled.value = false
      keyboardEverShown = false
      clearFocusTimers()
      if (maskTimer) {
        clearTimeout(maskTimer)
        maskTimer = null
      }
      unbindKeyboard()

      try {
        if (typeof uni.hideKeyboard === 'function') uni.hideKeyboard()
      } catch (e) {}

      /**
       * 解锁要快。
       * 这里只是防止 hideKeyboard 触发的回调递归，用不着等 50ms。
       * 等太久会让用户紧接着的下一次点击被这个锁挡住，
       * 表现为「第二次点 + 没反应」。
       */
      setTimeout(() => {
        closing = false
      }, 0)
    }

    /* ------------------------------------------------------ 生命周期 */

    /** 弹层栈注销函数 */
    let unregisterLayer = null

    onUnmounted(() => {
      if (unregisterLayer) {
        unregisterLayer()
        unregisterLayer = null
      }
    })

    watch(
      () => props.modelValue,
      async (open) => {
        if (!open) {
          if (unregisterLayer) {
            unregisterLayer()
            unregisterLayer = null
          }
          unbindKeyboard()
          clearFocusTimers()
          return
        }

        /*
         * ★ 登记到弹层栈 ★
         *   侧滑返回 / 返回键先收起输入条（走 close()，会顺带收起键盘、
         *   清空草稿），而不是直接退出整个首页。
         */
        if (!unregisterLayer) {
          unregisterLayer = pushLayer(() => close(), 'quickAddBar')
        }

        keyboardHeight.value = 0
        maskEnabled.value = false
        keyboardEverShown = false
        closing = false

        // 延迟启用遮罩，挡掉记账按钮抬起时补发的那次 click
        if (maskTimer) clearTimeout(maskTimer)
        maskTimer = setTimeout(() => {
          maskEnabled.value = true
          maskTimer = null
        }, 350)

        bindKeyboard()
        await nextTick()

        /**
         * 聚焦。
         *
         * ★ 不能再用「autoFocus 先 false 再 true」那招 ★
         *   把 focus 设为 false 会**真的收起键盘**。而键盘一收起，
         *   onKeyboardHeightChange 就会回调 height=0，触发 close()，
         *   于是：输入条刚出现就消失、tabBar 和 + 跑到键盘上方。
         *   （真机日志实测：第二次打开后 213ms 键盘就被这个技巧收掉了。）
         *
         *   现在组件是 v-if 挂载的，每次打开都是全新的 input 元素，
         *   :focus="true" 在挂载时就会生效，不需要再折腾。
         *   若某些机型仍不生效，用 ref 调 focus() 兜底，
         *   那不会引起键盘收起。
         */
        autoFocus.value = true

        clearFocusTimers()
        focusTimer = setTimeout(() => {
          focusTimer = null
          if (!visible.value) return
          // 兜底：用 ref 直接聚焦，不改 focus 属性，避免收起键盘
          try {
            if (inputRef.value && typeof inputRef.value.focus === 'function') {
              inputRef.value.focus()
            }
          } catch (e) {}
        }, 300)
      },
      { immediate: false }
    )

    return {
      visible, draft, submitting, autoFocus, inputRef,
      primaryColor, canSend, barStyle,
      submit, close, onMaskClick, noop
    }
  }
}
</script>

<style scoped>
.quick-add-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 600;
  background-color: transparent;
}

/**
 * ★ 背景层：只负责「挡住页面」与「点空白关闭」★
 *   独立成一个铺满全屏的层，触摸拦截绑在它身上（见模板注释）。
 *
 *   transparent 而不是半透明黑 —— 保持原有观感：
 *   输入条浮起时页面内容不被压暗，只是单纯不能再点。
 */
.quick-add-mask-bg {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background-color: transparent;
}

/*
 * ★ 柔光玻璃输入条（与底部 tabbar 同款）★
 *   底色走 --glass-* 变量（barStyle 里由 glassVars 注入）。
 *   兜底顺序和 tabbar 一致：先给高不透明度实色，
 *   @supports 命中 backdrop-filter 后才换成更透的 + 模糊。
 *   不支持模糊的设备（多数安卓 WebView）走实色，不会「透出内容却不糊」显脏。
 *
 *   圆角保持 48rpx 胶囊，描边用玻璃内高光而不是实线，
 *   这样浮在页面内容上时边界是「折射感」而不是「画了个框」。
 */
.quick-add-bar {
  position: fixed;
  left: 32rpx;
  right: 32rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 12rpx 12rpx 12rpx 28rpx;
  background-color: var(--glass-bg-solid, var(--app-card));
  border-radius: 48rpx;
  border-width: 1rpx;
  border-style: solid;
  border-color: var(--glass-border, rgba(255, 255, 255, 0.75));
  box-shadow: var(--glass-shadow, 0 8rpx 32rpx rgba(0, 0, 0, 0.16));
  transition: bottom 0.18s ease;
}

@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .quick-add-bar {
    background-color: var(--glass-bg, var(--app-card));
    -webkit-backdrop-filter: saturate(180%) blur(var(--glass-blur, 24rpx));
    backdrop-filter: saturate(180%) blur(var(--glass-blur, 24rpx));
  }
}

/**
 * ★ 输入框必须能在 flex 行里被压缩 ★
 *
 *   App 端 <input> 编译成 <uni-input>，它在 flex 容器里默认 min-width:auto
 *   —— 「auto」意味着最小宽度等于内容宽度。
 *   文本一长，这个最小宽度跟着涨，于是整条输入条被撑开、
 *   把右侧发送按钮挤出去；输入框自身的可视宽度却没变，
 *   用户看到的就是「文本被遮住、还滑不动」。
 *
 *   三步一起给才有效：
 *     flex: 1      —— 占满剩余空间
 *     width: 0     —— 把基准宽度归零，否则 flex-basis:auto 还是按内容算
 *     min-width: 0 —— 允许缩到比内容更窄（关键的一条）
 *   三者齐备后，输入框宽度只由容器决定，溢出的文字交给原生输入框
 *   自己的横向滚动处理，左右拖动就能看到被遮住的部分。
 *
 *   视觉不变：height / line-height / font-size 原样保留。
 */
.bar-input {
  flex: 1;
  width: 0;
  min-width: 0;
  height: 64rpx;
  font-size: 28rpx;
  color: var(--app-text);
  line-height: 64rpx;
}

.bar-placeholder {
  color: var(--app-text-3);
  font-size: 26rpx;
}

.bar-send {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.send-icon {
  color: #ffffff;
  font-size: 36rpx;
  font-weight: 600;
  line-height: 1;
}
</style>
