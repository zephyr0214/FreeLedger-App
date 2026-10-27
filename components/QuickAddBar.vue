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
</template>

<script>
import { ref, computed, watch, nextTick } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { listCategories } from '@/api/category.js'
import { listTags } from '@/api/tag.js'
import { parseMessageToTransactions } from '@/api/aiParse.js'

export default {
  name: 'QuickAddBar',
  props: {
    modelValue: { type: Boolean, default: false }
  },
  emits: ['update:modelValue', 'saved', 'parsing-start', 'parsing-end'],
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

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    const primaryColor = computed(() => settingStore.primaryColor)
    const canSend = computed(() => draft.value.trim().length > 0 && !submitting.value)

    /**
     * 输入条位置。
     *
     * 键盘模式是 adjustPan（见 pages.json）：
     *   - 窗口高度不变，所以在原生 tabBar 不会被顶起来
     *   - 但 webview 内容会被系统整体平移，需要我们自己把页面「按住」
     *
     * 因此这里用 bottom = 键盘高度，让输入条浮到键盘上沿；
     * 同时页面根节点在键盘弹出时做反向 translateY 补偿（见 App.vue 的
     * handleKeyboardShift），保证用户看到的画面不发生整体位移。
     */
    const barStyle = computed(() => {
      const bottom = keyboardHeight.value > 0
        ? keyboardHeight.value + 'px'
        : 'calc(env(safe-area-inset-bottom) + 20rpx)'
      return { bottom }
    })

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
        uni.showModal({
          title: '需要先配置 AI',
          content: '智能记账需要调用大模型解析你的输入。请到「我的 → AI 大模型」填写 API Key。',
          confirmText: '去配置',
          success: (res) => {
            if (res.confirm) {
              close()
              uni.navigateTo({ url: '/pages/settings/ai' })
            }
          }
        })
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
            uni.showModal({
              title: '部分记录未保存',
              content: notes.slice(0, 5).join('\n'),
              showCancel: false
            })
          }, 800)
        }
      } catch (e) {
        uni.showModal({
          title: '识别失败',
          content: e.message,
          showCancel: false
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

      try {
        if (typeof uni.hideKeyboard === 'function') uni.hideKeyboard()
      } catch (e) {}

      visible.value = false
      draft.value = ''
      autoFocus.value = false
      keyboardHeight.value = 0
      maskEnabled.value = false
      keyboardEverShown = false
      if (maskTimer) {
        clearTimeout(maskTimer)
        maskTimer = null
      }
      unbindKeyboard()

      // 恢复 tabBar，否则退出输入态后底栏一直不见了
      showTabBar()

      // 等这一轮事件循环结束再解锁
      setTimeout(() => {
        closing = false
      }, 50)
    }

    /* ------------------------------------------------------ 生命周期 */

    watch(
      () => props.modelValue,
      async (open) => {
        if (!open) {
          unbindKeyboard()
          showTabBar()
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
         * 显式聚焦。
         * 只靠 :focus="autoFocus" 在 v-if 首次渲染时经常不生效
         * （组件挂载与属性求值时序问题），表现为「输入条出来了但键盘不弹」。
         * 先置 true 触发一次，再延时兜底一次，两者都不贵。
         */
        autoFocus.value = true
        setTimeout(() => {
          if (!visible.value) return
          autoFocus.value = false
          setTimeout(() => {
            if (visible.value) autoFocus.value = true
          }, 60)
        }, 220)
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
