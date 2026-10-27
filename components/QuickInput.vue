<template>
  <view v-if="visible" class="quick-mask" @click="onMaskClick">
    <view
      class="quick-sheet"
      :class="{ 'is-top-aligned': fallbackTopAlign }"
      :style="sheetStyle"
      @click.stop
    >
      <!-- 顶部把手 + 标题 -->
      <view class="sheet-head">
        <text class="sheet-title">记一笔</text>
        <text class="sheet-close" @click="close">✕</text>
      </view>

      <!-- 输入框 -->
      <view class="input-wrap">
        <textarea
          ref="inputRef"
          v-model="text"
          class="quick-textarea"
          :focus="autoFocus"
          :maxlength="120"
          :auto-height="true"
          confirm-type="done"
          :show-confirm-bar="false"
          :cursor-spacing="24"
          placeholder="例如：昨天中午吃饭四十五"
          placeholder-class="quick-placeholder"
          @input="onInput"
          @confirm="onSubmit"
        />
        <text v-if="text" class="clear-btn" @click="clearText">✕</text>
      </view>

      <text class="input-hint">
        可用系统键盘的语音键说话，说完文字会出现在上面
      </text>

      <!-- 解析结果 -->
      <view class="result-area">
        <view class="result-head">
          <text class="result-title">解析结果</text>
          <text v-if="parsed.confidence > 0" class="conf-badge" :style="{ color: confColor }">
            {{ confLabel }}
          </text>
        </view>

        <view class="result-grid">
          <!-- 金额 -->
          <view
            class="result-chip"
            :class="{ 'is-missing': !parsed.amount_cents }"
            @click="openAmountEditor"
          >
            <text class="chip-label">金额</text>
            <text class="chip-value" :style="{ color: parsed.amount_cents ? 'var(--app-text)' : 'var(--app-text-3)' }">
              {{ parsed.amount_cents ? (parsed.amount_cents / 100).toFixed(2) : '待定' }}
            </text>
          </view>

          <!-- 类型 -->
          <view class="result-chip" @click="cycleType">
            <text class="chip-label">类型</text>
            <text class="chip-value">{{ typeLabel }}</text>
          </view>

          <!-- 分类 -->
          <view
            class="result-chip"
            :class="{ 'is-missing': !parsed.category_id && parsed.type !== 'transfer' }"
            @click="openCategoryPicker"
          >
            <text class="chip-label">分类</text>
            <text
              class="chip-value"
              :style="{ color: parsed.category_name ? 'var(--app-text)' : 'var(--app-text-3)' }"
            >{{ parsed.category_name || (parsed.type === 'transfer' ? '不适用' : '待选') }}</text>
          </view>

          <!-- 账户 -->
          <view
            class="result-chip"
            :class="{ 'is-missing': !parsed.account_id }"
            @click="openAccountPicker"
          >
            <text class="chip-label">{{ parsed.type === 'transfer' ? '转出' : '账户' }}</text>
            <text
              class="chip-value"
              :style="{ color: parsed.account_name ? 'var(--app-text)' : 'var(--app-text-3)' }"
            >{{ parsed.account_name || '待选' }}</text>
          </view>

          <!-- 转账目标 -->
          <view
            v-if="parsed.type === 'transfer'"
            class="result-chip"
            :class="{ 'is-missing': !parsed.to_account_id }"
            @click="openToAccountPicker"
          >
            <text class="chip-label">转入</text>
            <text
              class="chip-value"
              :style="{ color: parsed.to_account_name ? 'var(--app-text)' : 'var(--app-text-3)' }"
            >{{ parsed.to_account_name || '待选' }}</text>
          </view>

          <!-- 日期 -->
          <view class="result-chip" @click="openDatePicker">
            <text class="chip-label">日期</text>
            <text class="chip-value">{{ dateLabel }}</text>
          </view>

          <!-- 标签 -->
          <view class="result-chip" @click="openTagPicker">
            <text class="chip-label">标签</text>
            <text
              class="chip-value"
              :style="{ color: tagNames ? 'var(--app-text)' : 'var(--app-text-3)' }"
            >{{ tagNames || '无' }}</text>
          </view>
        </view>

        <!-- 备注（仅在有内容时显示） -->
        <view v-if="parsed.note" class="note-line">
          <text class="note-label">备注</text>
          <text class="note-value ellipsis">{{ parsed.note }}</text>
        </view>
      </view>

      <!-- 常用短语 -->
      <view v-if="!text && phrases.length > 0" class="phrase-area">
        <text class="phrase-title">常用短语</text>
        <view class="phrase-list">
          <view
            v-for="p in phrases"
            :key="p"
            class="phrase-chip"
            @click="applyPhrase(p)"
          >
            <text class="phrase-text">{{ p }}</text>
          </view>
        </view>
      </view>

      <!-- 底部按钮 -->
      <view class="sheet-actions" :style="{ paddingBottom: actionPaddingBottom }">
        <wd-button
          size="large"
          plain
          custom-class="btn-detail"
          @click="expandToPanel"
        >
          展开详细
        </wd-button>
        <wd-button
          size="large"
          type="primary"
          custom-class="btn-submit"
          :disabled="!canSubmit"
          @click="onSubmit"
        >
          记下
        </wd-button>
      </view>
    </view>
  </view>
</template>

<script>
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { listCategories, DEFAULT_ALIAS } from '@/api/category.js'
import { listTags } from '@/api/tag.js'
import { parseQuickInput } from '@/api/quick/parser.js'
import { toDayKey, relativeDayLabel, formatDayHeader } from '@/utils/date.js'

export default {
  name: 'QuickInput',
  props: {
    modelValue: { type: Boolean, default: false }
  },
  emits: ['update:modelValue', 'expand', 'saved'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()
    const txnStore = useTransactionStore()

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    const text = ref('')
    const autoFocus = ref(false)
    const inputRef = ref(null)
    const keyboardHeight = ref(0)
    /**
     * 键盘高度读不到时的降级开关。
     * 部分定制 ROM 的 uni.onKeyboardHeightChange 不触发或返回 0，
     * 此时切换为顶部对齐 + 固定高度布局，保证输入框永不被遮挡。
     */
    const fallbackTopAlign = ref(false)

    const categories = ref([])
    const tags = ref([])

    const parsed = reactive({
      amount_cents: 0,
      type: 'expense',
      category_id: '',
      category_name: '',
      account_id: '',
      account_name: '',
      to_account_id: null,
      to_account_name: '',
      tag_ids: [],
      note: '',
      occurred_day: toDayKey(),
      occurred_at: Date.now(),
      confidence: 0,
      missing: [],
      canSubmit: false
    })

    // 各种选择器的开关
    const showAmountEditor = ref(false)
    const showCategoryPicker = ref(false)
    const showAccountPicker = ref(false)
    const showToAccountPicker = ref(false)
    const showTagPicker = ref(false)
    const showDatePicker = ref(false)

    const phrases = ref(['午饭20', '打车', '买烟', '咖啡', '地铁'])

    let debounceTimer = null
    let keyboardTimer = null

    /* ---------------------------------------------------- 计算属性 */

    const typeLabel = computed(() => {
      const map = { expense: '支出', income: '收入', transfer: '转账' }
      return map[parsed.type] || '支出'
    })

    const dateLabel = computed(() => {
      const rel = relativeDayLabel(parsed.occurred_day)
      if (rel) return rel
      const [, m, d] = parsed.occurred_day.split('-')
      return `${Number(m)}/${Number(d)}`
    })

    const tagNames = computed(() => {
      if (!parsed.tag_ids || parsed.tag_ids.length === 0) return ''
      return tags.value
        .filter((t) => parsed.tag_ids.includes(t.id))
        .map((t) => t.name)
        .join('、')
    })

    const canSubmit = computed(() => {
      if (!parsed.amount_cents || parsed.amount_cents <= 0) return false
      if (!parsed.account_id) return false
      if (parsed.type === 'transfer') {
        return !!parsed.to_account_id && parsed.to_account_id !== parsed.account_id
      }
      return !!parsed.category_id
    })

    const confLabel = computed(() => {
      const c = parsed.confidence
      if (c >= 0.9) return '识别完整'
      if (c >= 0.7) return '需确认'
      if (c > 0) return '信息不足'
      return ''
    })

    const confColor = computed(() => {
      const c = parsed.confidence
      if (c >= 0.9) return 'var(--app-success)'
      if (c >= 0.7) return 'var(--app-warning)'
      return 'var(--app-danger)'
    })

    /** 弹出层 style：正常情况按键盘高度抬升 */
    const sheetStyle = computed(() => {
      if (fallbackTopAlign.value) {
        return { height: '78vh', marginTop: '0' }
      }
      return { paddingBottom: keyboardHeight.value + 'px' }
    })

    const actionPaddingBottom = computed(() => {
      return fallbackTopAlign.value ? 'env(safe-area-inset-bottom)' : '0'
    })

    /* ------------------------------------------------------ 解析 */

    function runParse() {
      const result = parseQuickInput(text.value, {
        categories: categories.value,
        accounts: accountStore.list,
        tags: tags.value,
        aliasMap: DEFAULT_ALIAS,
        defaultAccountId: settingStore.settings.defaultAccountId || (accountStore.list[0] || {}).id || '',
        baseDate: new Date()
      })
      Object.assign(parsed, result)
    }

    function onInput() {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(runParse, 260)
    }

    function clearText() {
      text.value = ''
      runParse()
    }

    function applyPhrase(p) {
      text.value = p
      runParse()
    }

    /* ------------------------------------------------- 用户修正项 */

    function cycleType() {
      const order = ['expense', 'income', 'transfer']
      const idx = order.indexOf(parsed.type)
      parsed.type = order[(idx + 1) % order.length]
      if (parsed.type === 'transfer') {
        parsed.category_id = ''
        parsed.category_name = ''
      }
      recountConfidence()
    }

    function recountConfidence() {
      let c = 0
      if (parsed.amount_cents > 0) c += 0.5
      if (parsed.category_id || parsed.type === 'transfer') c += 0.25
      if (parsed.account_id) c += 0.15
      c += 0.1
      parsed.confidence = Math.round(Math.min(1, c) * 100) / 100
    }

    function pickCategoryFromManual(cat) {
      parsed.category_id = cat.id
      parsed.category_name = cat.name
      recountConfidence()
    }

    function pickAccountFromManual(acc) {
      parsed.account_id = acc.id
      parsed.account_name = acc.name
      recountConfidence()
    }

    function pickToAccountFromManual(acc) {
      parsed.to_account_id = acc.id
      parsed.to_account_name = acc.name
    }

    function pickTagFromManual(tag) {
      if (!parsed.tag_ids.includes(tag.id)) {
        parsed.tag_ids.push(tag.id)
      }
    }

    function pickDayFromManual(day) {
      parsed.occurred_day = day
      parsed.occurred_at = new Date(`${day}T12:00:00`).getTime()
    }

    // 选择器统一用原生 picker，避免在浮层里嵌套弹窗
    function openAmountEditor() {
      uni.showModal({
        title: '输入金额',
        editable: true,
        placeholderText: '例如 45.5',
        success: (res) => {
          if (!res.confirm) return
          const n = Number(res.content)
          if (Number.isFinite(n) && n > 0) {
            parsed.amount_cents = Math.round(n * 100)
            recountConfidence()
          }
        }
      })
    }

    function openCategoryPicker() {
      const pool = categories.value.filter(
        (c) => !c.isParent && c.type === (parsed.type === 'income' ? 'income' : 'expense')
      )
      if (pool.length === 0) return
      uni.showActionSheet({
        itemList: pool.slice(0, 10).map((c) => c.name),
        success: (res) => {
          pickCategoryFromManual(pool[res.tapIndex])
        }
      })
    }

    function openAccountPicker() {
      const list = accountStore.list
      if (list.length === 0) return
      uni.showActionSheet({
        itemList: list.slice(0, 10).map((a) => a.name),
        success: (res) => {
          pickAccountFromManual(list[res.tapIndex])
        }
      })
    }

    function openToAccountPicker() {
      const list = accountStore.list.filter((a) => a.id !== parsed.account_id)
      if (list.length === 0) return
      uni.showActionSheet({
        itemList: list.slice(0, 10).map((a) => a.name),
        success: (res) => {
          pickToAccountFromManual(list[res.tapIndex])
        }
      })
    }

    function openTagPicker() {
      if (tags.value.length === 0) {
        uni.showToast({ title: '还没有标签', icon: 'none' })
        return
      }
      uni.showActionSheet({
        itemList: tags.value.slice(0, 10).map((t) => t.name),
        success: (res) => {
          pickTagFromManual(tags.value[res.tapIndex])
        }
      })
    }

    function openDatePicker() {
      const days = [
        { label: '今天', day: toDayKey() },
        { label: '昨天', day: shift(toDayKey(), -1) },
        { label: '前天', day: shift(toDayKey(), -2) }
      ]
      uni.showActionSheet({
        itemList: days.map((d) => d.label),
        success: (res) => {
          pickDayFromManual(days[res.tapIndex].day)
        }
      })
    }

    function shift(dayKey, delta) {
      const [y, m, d] = dayKey.split('-').map(Number)
      const dt = new Date(y, m - 1, d)
      dt.setDate(dt.getDate() + delta)
      return toDayKey(dt)
    }

    /* ------------------------------------------------------ 提交 */

    async function onSubmit() {
      if (!canSubmit.value) {
        uni.showToast({ title: '请补全金额和分类', icon: 'none' })
        return
      }

      const payload = {
        type: parsed.type,
        amount_cents: parsed.amount_cents,
        account_id: parsed.account_id,
        to_account_id: parsed.type === 'transfer' ? parsed.to_account_id : null,
        category_id: parsed.type === 'transfer' ? null : parsed.category_id,
        occurred_day: parsed.occurred_day,
        note: parsed.note || '',
        tag_ids: parsed.tag_ids || [],
        source: 'quick',
        raw_text: text.value
      }

      try {
        await txnStore.create(payload)
        close()

        // 记住默认账户
        if (parsed.account_id) {
          await settingStore.update({ defaultAccountId: parsed.account_id })
        }

        showUndoToast()
        emit('saved')
      } catch (e) {
        uni.showModal({ title: '保存失败', content: e.message, showCancel: false })
      }
    }

    /** 3 秒内可撤销 —— 速记最大的风险是记错却看不见 */
    function showUndoToast() {
      const summary = [
        parsed.category_name || typeLabel.value,
        `${(parsed.amount_cents / 100).toFixed(2)} 元`,
        parsed.account_name
      ].filter(Boolean).join(' · ')

      uni.showToast({
        title: `已记 · ${summary}`,
        icon: 'none',
        duration: 5000
      })

      // 同时提供撤销入口（toast 不支持按钮，用浮层代替由页面处理）
      emit('saved', { undoable: true, summary })
    }

    /** 展开到完整记账面板 */
    function expandToPanel() {
      emit('expand', {
        type: parsed.type,
        amount_cents: parsed.amount_cents,
        account_id: parsed.account_id,
        to_account_id: parsed.to_account_id,
        category_id: parsed.category_id,
        occurred_day: parsed.occurred_day,
        note: parsed.note,
        tag_ids: parsed.tag_ids
      })
      close()
    }

    function close() {
      visible.value = false
      text.value = ''
      autoFocus.value = false
    }

    function onMaskClick() {
      close()
    }

    /* ------------------------------------------------- 键盘与生命周期 */

    function bindKeyboard() {
      try {
        if (typeof uni.onKeyboardHeightChange === 'function') {
          uni.onKeyboardHeightChange((res) => {
            keyboardHeight.value = res.height || 0
            // height 为 0 且此前也为 0 → 视为不可用，切降级
            if (!res.height) {
              scheduleFallbackCheck()
            } else {
              fallbackTopAlign.value = false
            }
          })
        } else {
          fallbackTopAlign.value = true
        }
      } catch (e) {
        fallbackTopAlign.value = true
      }

      // 300ms 后仍未收到键盘高度 → 判定为不可用，启用降级
      scheduleFallbackCheck()
    }

    function scheduleFallbackCheck() {
      if (keyboardTimer) clearTimeout(keyboardTimer)
      keyboardTimer = setTimeout(() => {
        if (keyboardHeight.value === 0) {
          fallbackTopAlign.value = true
        }
      }, 400)
    }

    function unbindKeyboard() {
      try {
        if (typeof uni.offKeyboardHeightChange === 'function') {
          uni.offKeyboardHeightChange()
        }
      } catch (e) {}
      if (keyboardTimer) clearTimeout(keyboardTimer)
      if (debounceTimer) clearTimeout(debounceTimer)
    }

    watch(
      () => props.modelValue,
      async (open) => {
        if (!open) {
          unbindKeyboard()
          return
        }

        // 打开时加载依赖数据
        await accountStore.load()
        const [cats, tgs] = await Promise.all([listCategories(), listTags()])
        categories.value = cats
        tags.value = tgs

        text.value = ''
        keyboardHeight.value = 0
        fallbackTopAlign.value = false
        runParse()

        bindKeyboard()

        await nextTick()
        autoFocus.value = true
      }
    )

    return {
      visible, text, autoFocus, inputRef, fallbackTopAlign, sheetStyle, actionPaddingBottom,
      parsed, typeLabel, dateLabel, tagNames, canSubmit, confLabel, confColor,
      phrases,
      showAmountEditor, showCategoryPicker, showAccountPicker, showToAccountPicker,
      showTagPicker, showDatePicker,
      onInput, clearText, applyPhrase, cycleType,
      openAmountEditor, openCategoryPicker, openAccountPicker, openToAccountPicker,
      openTagPicker, openDatePicker,
      onSubmit, expandToPanel, close, onMaskClick
    }
  }
}
</script>

<style scoped>
.quick-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background-color: var(--app-mask);
  z-index: 500;
  display: flex;
  align-items: flex-end;
}

.quick-sheet {
  width: 100%;
  max-height: 88vh;
  background-color: var(--app-card);
  border-radius: 28rpx 28rpx 0 0;
  padding: 24rpx 32rpx 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

/* 降级：顶部对齐，输入框永远在上半屏 */
.quick-sheet.is-top-aligned {
  border-radius: 0;
  margin-top: 0;
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 20rpx;
}

.sheet-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.sheet-close {
  font-size: 32rpx;
  color: var(--app-text-3);
  padding: 8rpx 16rpx;
}

.input-wrap {
  position: relative;
  background-color: var(--app-card-2);
  border-radius: 16rpx;
  padding: 20rpx 24rpx;
  min-height: 120rpx;
}

.quick-textarea {
  width: 100%;
  min-height: 80rpx;
  font-size: 32rpx;
  color: var(--app-text);
  line-height: 1.5;
}

.quick-placeholder {
  color: var(--app-text-3);
  font-size: 32rpx;
}

.clear-btn {
  position: absolute;
  right: 20rpx;
  top: 20rpx;
  font-size: 26rpx;
  color: var(--app-text-3);
  padding: 4rpx 12rpx;
}

.input-hint {
  display: block;
  font-size: 22rpx;
  color: var(--app-text-3);
  margin-top: 12rpx;
  padding-left: 4rpx;
}

.result-area {
  margin-top: 24rpx;
  background-color: var(--app-card-2);
  border-radius: 16rpx;
  padding: 20rpx 24rpx;
}

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
}

.result-title {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.conf-badge {
  font-size: 22rpx;
}

.result-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.result-chip {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  padding: 12rpx 20rpx;
  background-color: var(--app-card);
  border-radius: 12rpx;
  min-width: 140rpx;
}

.result-chip.is-missing {
  border: 1rpx dashed var(--app-warning);
}

.chip-label {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.chip-value {
  font-size: 26rpx;
  color: var(--app-text);
  font-weight: 500;
}

.note-line {
  display: flex;
  gap: 12rpx;
  margin-top: 16rpx;
  align-items: center;
}

.note-label {
  font-size: 22rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
}

.note-value {
  font-size: 24rpx;
  color: var(--app-text-2);
  flex: 1;
}

.phrase-area {
  margin-top: 24rpx;
}

.phrase-title {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.phrase-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 12rpx;
}

.phrase-chip {
  padding: 10rpx 24rpx;
  background-color: var(--app-card-2);
  border-radius: 24rpx;
}

.phrase-text {
  font-size: 24rpx;
  color: var(--app-text-2);
}

.sheet-actions {
  display: flex;
  gap: 20rpx;
  padding: 28rpx 0;
  margin-top: auto;
}

.btn-detail {
  flex: 1;
}

.btn-submit {
  flex: 1.4;
}
</style>
