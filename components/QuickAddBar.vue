<template>
  <view v-if="visible" class="quick-add-mask" @click="onMaskClick">
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
  emits: ['update:modelValue', 'saved'],
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

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    const primaryColor = computed(() => settingStore.primaryColor)
    const canSend = computed(() => draft.value.trim().length > 0 && !submitting.value)

    /** 输入条跟随键盘上移 */
    const barStyle = computed(() => {
      const bottom = keyboardHeight.value > 0
        ? keyboardHeight.value + 'px'
        : 'calc(env(safe-area-inset-bottom) + 20rpx)'
      return { bottom }
    })

    /* ------------------------------------------------------ 键盘 */

    let keyboardTimer = null

    function bindKeyboard() {
      try {
        if (typeof uni.onKeyboardHeightChange === 'function') {
          uni.onKeyboardHeightChange((res) => {
            keyboardHeight.value = res.height || 0
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

      try {
        const [categories, tags] = await Promise.all([listCategories(), listTags()])
        await accountStore.load()

        if (accountStore.list.length === 0) {
          throw new Error('还没有账户，请先添加一个账户')
        }

        const defaultAccountId =
          settingStore.settings.defaultAccountId || accountStore.list[0].id

        const result = await parseMessageToTransactions(text, {
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
              note: item.note || text,
              tag_ids: item.tag_ids,
              source: 'quick',
              raw_text: text
            })
            saved++
          } catch (e) {
            failures.push(e.message)
          }
        }

        draft.value = ''

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
          close()
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
      }
    }

    function onMaskClick() {
      if (!maskEnabled.value) return
      close()
    }

    function close() {
      visible.value = false
      draft.value = ''
      autoFocus.value = false
      keyboardHeight.value = 0
      maskEnabled.value = false
      if (maskTimer) {
        clearTimeout(maskTimer)
        maskTimer = null
      }
      unbindKeyboard()
    }

    /* ------------------------------------------------------ 生命周期 */

    watch(
      () => props.modelValue,
      async (open) => {
        if (!open) {
          unbindKeyboard()
          return
        }
        keyboardHeight.value = 0
        maskEnabled.value = false

        // 延迟启用遮罩，挡掉 FAB 抬起时补发的那次 click
        if (maskTimer) clearTimeout(maskTimer)
        maskTimer = setTimeout(() => {
          maskEnabled.value = true
          maskTimer = null
        }, 350)

        bindKeyboard()
        await nextTick()
        autoFocus.value = true
      },
      { immediate: false }
    )

    return {
      visible, draft, submitting, autoFocus, inputRef,
      primaryColor, canSend, barStyle,
      submit, close, onMaskClick
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
