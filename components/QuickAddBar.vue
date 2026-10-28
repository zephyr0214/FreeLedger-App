<template>
  <view
    v-if="visible"
    class="quick-add-mask"
    @click="onMaskClick"
    @touchmove.stop.prevent="noop"
  >
    <view class="quick-add-bar" :style="barStyle" @click.stop>
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
import { ref, computed, watch, nextTick } from 'vue'
import AppDialog from '@/components/AppDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { listCategories } from '@/api/category.js'
import { listTags } from '@/api/tag.js'
import { parseMessageToTransactions } from '@/api/aiParse.js'
import { combineDayTime } from '@/utils/date.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'

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
    const barStyle = computed(() => ({
      bottom: 'calc(env(safe-area-inset-bottom) + 20rpx)'
    }))

    /* ------------------------------------------------------ 键盘 */

    let keyboardTimer = null

    /**
     * 进入/退出输入态时切换原生 tabBar 的显隐。
     *
     * 为什么必须隐藏：
     *   adjustPan 会把整个 webview（含原生 tabBar）整体上推。
     *   tabBar 藏起来后就不会跟着移动；输入条由我们按键盘高度自己定位，
     *   视觉上就是「底栏消失，输入框贴键盘浮出」。
     */
    function hideTabBar() {
      try {
        uni.hideTabBar({ animation: false })
      } catch (e) {}
    }

    function showTabBar() {
      try {
        uni.showTabBar({ animation: false })
      } catch (e) {}
    }

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

        if (accountStore.list.length === 0) {
          throw new Error('还没有账户，请先添加一个账户')
        }

        const defaultAccountId =
          settingStore.settings.defaultAccountId || accountStore.list[0].id

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
              note: item.note || pendingText,
              tag_ids: item.tag_ids,
              source: 'quick',
              raw_text: pendingText
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

      /**
       * 恢复 tabBar 要快。
       *
       * 之前等键盘高度归零才显示（最长 400ms），
       * 用户感觉就是「底栏卡一下才回来」。
       * 现在改成：先收键盘，紧接着就显示 tabBar。
       * 键盘收起是系统动画，两者几乎同步，感知不到延迟。
       */
      showTabBar()

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

    watch(
      () => props.modelValue,
      async (open) => {
        if (!open) {
          // 注意：这里不要再调 showTabBar()。
          // 关闭流程由 close() 负责 —— 它会等键盘真正收起后才恢复 tabBar，
          // 否则 tabBar 会渲染在「键盘上沿」，看起来像浮在键盘上面。
          unbindKeyboard()
          clearFocusTimers()
          return
        }
        keyboardHeight.value = 0
        maskEnabled.value = false
        keyboardEverShown = false
        closing = false

        // 隐藏 tabBar，避免它被 adjustResize 顶到键盘上方
        hideTabBar()

        // 延迟启用遮罩，挡掉 FAB 抬起时补发的那次 click
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

.quick-add-bar {
  position: fixed;
  left: 32rpx;
  right: 32rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 12rpx 12rpx 12rpx 28rpx;
  background-color: var(--app-card);
  border-radius: 48rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.16);
  transition: bottom 0.18s ease;
}

.bar-input {
  flex: 1;
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
