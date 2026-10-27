<template>
  <wd-popup
    v-model="visible"
    position="bottom"
    :safe-area-inset-bottom="true"
    :lock-scroll="true"
    custom-style="background-color: var(--app-card); border-radius: 28rpx 28rpx 0 0; max-height: 92vh;"
    @close="onClose"
  >
    <view class="panel">
      <!-- 顶栏：类型切换居中，取消放右上角（红色） -->
      <view class="panel-head">
        <view class="panel-head-spacer" />
        <view class="type-switch">
          <view
            v-for="t in types"
            :key="t.key"
            class="type-item"
            :class="{ active: form.type === t.key }"
            @click="switchType(t.key)"
          >
            <text
              class="type-text"
              :style="{ color: form.type === t.key ? primaryColor : 'var(--app-text-2)' }"
            >{{ t.name }}</text>
            <view
              v-if="form.type === t.key"
              class="type-bar"
              :style="{ backgroundColor: primaryColor }"
            />
          </view>
        </view>
        <text class="panel-cancel" @click="onClose">取消</text>
      </view>

      <!-- 金额 -->
      <view class="amount-area">
        <text class="amount-label">{{ form.type === 'transfer' ? '转账金额' : '金额' }}</text>
        <view class="amount-row">
          <text class="amount-symbol" :style="{ color: primaryColor }">{{ currencySymbol }}</text>
          <text
            class="amount-value"
            :style="{ color: form.amountRaw ? 'var(--app-text)' : 'var(--app-text-3)' }"
          >{{ displayAmount || '0.00' }}</text>
        </view>
      </view>

      <!-- 分类横向滚动（转账时隐藏） -->
      <scroll-view
        v-if="form.type !== 'transfer'"
        class="cat-scroll"
        scroll-x
        :show-scrollbar="false"
        enable-flex
      >
        <view class="cat-list">
          <view
            v-for="cat in categoryList"
            :key="cat.id"
            class="cat-item"
            :class="{ active: form.category_id === cat.id }"
            @click="pickCategory(cat)"
          >
            <view
              class="cat-icon-wrap"
              :style="{
                backgroundColor: form.category_id === cat.id
                  ? (cat.color || primaryColor)
                  : 'var(--app-card-2)'
              }"
            >
              <text class="cat-icon-text">{{ iconChar(cat) }}</text>
            </view>
            <text
              class="cat-name"
              :style="{
                color: form.category_id === cat.id ? 'var(--app-text)' : 'var(--app-text-2)'
              }"
            >{{ cat.name }}</text>
          </view>
        </view>
      </scroll-view>

      <!-- 表单行 -->
      <view class="form-rows">
        <!-- 账户 -->
        <view class="form-row" @click="openAccountPicker">
          <text class="row-label">账户</text>
          <view class="row-value">
            <text class="row-text">{{ currentAccountName }}</text>
            <text class="row-arrow">›</text>
          </view>
        </view>

        <!-- 转账目标账户 -->
        <view v-if="form.type === 'transfer'" class="form-row" @click="openToAccountPicker">
          <text class="row-label">转入</text>
          <view class="row-value">
            <text
              class="row-text"
              :style="{ color: form.to_account_id ? 'var(--app-text)' : 'var(--app-text-3)' }"
            >{{ toAccountName || '请选择' }}</text>
            <text class="row-arrow">›</text>
          </view>
        </view>

        <!-- 日期 -->
        <view class="form-row">
          <text class="row-label">日期</text>
          <view class="row-value row-value-right">
            <view
              v-for="d in quickDays"
              :key="d.key"
              class="day-chip"
              :class="{ active: isSameDay(form.occurred_day, d.day) }"
              @click="pickDay(d.day)"
            >
              <text
                class="day-chip-text"
                :style="{ color: isSameDay(form.occurred_day, d.day) ? primaryColor : 'var(--app-text-2)' }"
              >{{ d.label }}</text>
            </view>
            <view class="day-chip" @click="openCalendar">
              <text class="day-chip-text" style="color: var(--app-text-2)">
                {{ isQuickDay ? '选择' : shortDate }}
              </text>
            </view>
          </view>
        </view>

        <!-- 标签：单行横向滚动，不换行 -->
        <view class="form-row form-row-wrap">
          <text class="row-label">标签</text>
          <scroll-view class="tag-scroll" scroll-x :show-scrollbar="false">
            <view class="tag-area">
              <view
                v-for="tag in selectedTags"
                :key="tag.id"
                class="tag-chip"
                :style="{ backgroundColor: (tag.color || primaryColor) + '22', borderColor: tag.color || primaryColor }"
              >
                <text class="tag-chip-text" :style="{ color: tag.color || primaryColor }">{{ tag.name }}</text>
                <text class="tag-chip-x" @click.stop="removeTag(tag.id)">×</text>
              </view>
              <view class="tag-add" @click="openTagPicker">
                <text class="tag-add-text">+ 添加</text>
              </view>
            </view>
          </scroll-view>
        </view>

        <!-- 备注 -->
        <view class="form-row">
          <text class="row-label">备注</text>
          <input
            v-model="form.note"
            class="note-input"
            placeholder="写点什么…"
            placeholder-class="note-placeholder"
            :maxlength="80"
            confirm-type="done"
          />
        </view>
      </view>

      <!-- 数字键盘：4x5，支持 + - × ÷ 和括号 -->
      <NumberKeyboard
        v-model="form.amountRaw"
        :finish-text="form.type === 'transfer' ? '转账' : '保存'"
        :disabled="!canSave"
        @finish="onFinish"
      />
    </view>

    <!-- 账户选择 -->
    <wd-action-sheet
      v-model="showAccountPicker"
      :actions="accountActions"
      cancel-text="取消"
      @select="onAccountSelect"
    />

    <wd-action-sheet
      v-model="showToAccountPicker"
      :actions="toAccountActions"
      cancel-text="取消"
      @select="onToAccountSelect"
    />

    <!-- 标签选择 -->
    <wd-action-sheet
      v-model="showTagPicker"
      :actions="tagActions"
      cancel-text="取消"
      @select="onTagSelect"
    />

    <!-- 日期选择：wd-calendar 无 visible 属性，需 ref.open() -->
    <wd-calendar
      ref="calendarRef"
      v-model="calendarValue"
      :max-date="maxDate"
      :with-cell="false"
      @confirm="onCalendarConfirm"
    />
  </wd-popup>
</template>

<script>
import { ref, reactive, computed, watch } from 'vue'
import NumberKeyboard from './NumberKeyboard.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { listCategories } from '@/api/category.js'
import { listTags } from '@/api/tag.js'
import { toDayKey, shiftDay, formatDayHeader } from '@/utils/date.js'
import { parseAmountInput, evaluateAmount } from '@/utils/money.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'

export default {
  name: 'TxnPanel',
  components: { NumberKeyboard },
  props: {
    modelValue: { type: Boolean, default: false },
    /** 编辑模式传入已有交易 */
    editing: { type: Object, default: null },
    /** 预填数据（速记展开时用） */
    preset: { type: Object, default: null }
  },
  emits: ['update:modelValue', 'saved'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()
    const txnStore = useTransactionStore()

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    const primaryColor = computed(() => settingStore.primaryColor)
    const currencySymbol = computed(() => settingStore.currencySymbol)

    const types = [
      { key: 'expense', name: '支出' },
      { key: 'income', name: '收入' },
      { key: 'transfer', name: '转账' }
    ]

    const form = reactive({
      type: 'expense',
      amountRaw: '',
      account_id: '',
      to_account_id: '',
      category_id: '',
      occurred_day: toDayKey(),
      note: '',
      tag_ids: []
    })

    const categories = ref([])
    const tags = ref([])
    const showAccountPicker = ref(false)
    const showToAccountPicker = ref(false)
    const showTagPicker = ref(false)
    const calendarRef = ref(null)
    const calendarValue = ref(Date.now())
    const maxDate = ref(Date.now())

    /* ------------------------------------------------------ 计算属性 */

    const categoryList = computed(() => {
      const type = form.type === 'income' ? 'income' : 'expense'
      return categories.value.filter((c) => c.type === type && !c.isParent)
    })

    const displayAmount = computed(() => {
      // 数字键盘支持 12+8 这类表达式，必须用 evaluateAmount 而不是 parseAmountInput
      const n = evaluateAmount(form.amountRaw)
      if (!n) return ''
      return (n / 100).toFixed(2)
    })

    const canSave = computed(() => {
      const cents = evaluateAmount(form.amountRaw)
      if (!cents || cents <= 0) return false
      if (!form.account_id) return false
      if (form.type === 'transfer') {
        return !!form.to_account_id && form.to_account_id !== form.account_id
      }
      return !!form.category_id
    })

    const currentAccountName = computed(() => {
      const acc = accountStore.list.find((a) => a.id === form.account_id)
      return acc ? acc.name : '请选择'
    })

    const toAccountName = computed(() => {
      const acc = accountStore.list.find((a) => a.id === form.to_account_id)
      return acc ? acc.name : ''
    })

    // wd-action-sheet 的 select 回传 { item, index }，按索引回查真实 id
    const accountActions = computed(() =>
      accountStore.list.map((a) => ({
        name: a.name,
        subname: `余额 ${(a.balance_cents / 100).toFixed(2)}`,
        color: a.color
      }))
    )

    const toAccountList = computed(() => accountStore.list.filter((a) => a.id !== form.account_id))

    const toAccountActions = computed(() =>
      toAccountList.value.map((a) => ({
        name: a.name,
        subname: `余额 ${(a.balance_cents / 100).toFixed(2)}`
      }))
    )

    const tagActions = computed(() =>
      tags.value.map((t) => ({ name: t.name, color: t.color }))
    )

    const selectedTags = computed(() =>
      tags.value.filter((t) => form.tag_ids.includes(t.id))
    )

    const quickDays = computed(() => [
      { key: 'today', label: '今天', day: toDayKey() },
      { key: 'yesterday', label: '昨天', day: shiftDay(toDayKey(), -1) },
      { key: 'before', label: '前天', day: shiftDay(toDayKey(), -2) }
    ])

    const isQuickDay = computed(() =>
      quickDays.value.some((d) => d.day === form.occurred_day)
    )

    const shortDate = computed(() => {
      const [, m, d] = form.occurred_day.split('-')
      return `${Number(m)}/${Number(d)}`
    })

    /* ------------------------------------------------------ 方法 */

    function iconChar(cat) {
      return cat.icon ? iconEmoji(cat.icon) : guessIconByName(cat.name)
    }

    function isSameDay(a, b) {
      return a === b
    }

    function switchType(key) {
      form.type = key
      if (key === 'transfer') {
        form.category_id = ''
      } else {
        form.to_account_id = ''
        // 切换收支时若当前分类不属于该类型，清空
        const valid = categoryList.value.some((c) => c.id === form.category_id)
        if (!valid) form.category_id = ''
      }
    }

    function pickCategory(cat) {
      form.category_id = cat.id
    }

    function pickDay(day) {
      form.occurred_day = day
    }

    function openAccountPicker() {
      if (accountStore.list.length === 0) {
        uni.showToast({ title: '请先添加账户', icon: 'none' })
        return
      }
      showAccountPicker.value = true
    }

    function openToAccountPicker() {
      showToAccountPicker.value = true
    }

    function openTagPicker() {
      if (tags.value.length === 0) {
        uni.showToast({ title: '还没有标签，可到「设置 → 标签管理」创建', icon: 'none' })
        return
      }
      showTagPicker.value = true
    }

    function onAccountSelect({ index }) {
      const acc = accountStore.list[index]
      if (!acc) return
      form.account_id = acc.id
      // 转账时若目标账户与新的源账户相同，清空
      if (form.to_account_id === acc.id) form.to_account_id = ''
      showAccountPicker.value = false
    }

    function onToAccountSelect({ index }) {
      const acc = toAccountList.value[index]
      if (!acc) return
      form.to_account_id = acc.id
      showToAccountPicker.value = false
    }

    function onTagSelect({ index }) {
      const tag = tags.value[index]
      if (!tag) return
      if (!form.tag_ids.includes(tag.id)) {
        form.tag_ids.push(tag.id)
      }
      showTagPicker.value = false
    }

    function removeTag(id) {
      form.tag_ids = form.tag_ids.filter((t) => t !== id)
    }

    function openCalendar() {
      calendarValue.value = new Date(`${form.occurred_day}T12:00:00`).getTime()
      if (calendarRef.value && typeof calendarRef.value.open === 'function') {
        calendarRef.value.open()
      }
    }

    function onCalendarConfirm({ value }) {
      const d = new Date(value)
      form.occurred_day = toDayKey(d)
    }

    async function loadOptions() {
      const [cats, tgs] = await Promise.all([listCategories(), listTags()])
      categories.value = cats
      tags.value = tgs
    }

    /** 重置表单 */
    function resetForm() {
      form.type = 'expense'
      form.amountRaw = ''
      form.note = ''
      form.tag_ids = []
      form.occurred_day = toDayKey()
      form.to_account_id = ''
      form.category_id = ''
      form.account_id = settingStore.settings.defaultAccountId || (accountStore.list[0] || {}).id || ''
    }

    /** 用已有交易填充 */
    function fillFromTxn(txn) {
      form.type = txn.type
      form.amountRaw = String(txn.amount_cents / 100)
      form.account_id = txn.account_id
      form.to_account_id = txn.to_account_id || ''
      form.category_id = txn.category_id || ''
      form.occurred_day = txn.occurred_day
      form.note = txn.note || ''
      form.tag_ids = Array.isArray(txn.tag_ids) ? [...txn.tag_ids] : []
    }

    function fillFromPreset(p) {
      form.type = p.type || 'expense'
      form.amountRaw = p.amount_cents ? String(p.amount_cents / 100) : ''
      form.account_id = p.account_id || (accountStore.list[0] || {}).id || ''
      form.to_account_id = p.to_account_id || ''
      form.category_id = p.category_id || ''
      form.occurred_day = p.occurred_day || toDayKey()
      form.note = p.note || ''
      form.tag_ids = Array.isArray(p.tag_ids) ? [...p.tag_ids] : []
    }

    /**
     * 键盘的「完成」。
     * 键盘已经把算式求好值传过来了（value），-1 表示括号不匹配。
     */
    function onFinish(value) {
      if (value === -1) {
        uni.showToast({ title: '括号没有闭合', icon: 'none' })
        return
      }
      if (value !== undefined && value !== null) {
        // 用算好的值回填，界面上显示的是最终金额
        form.amountRaw = String(Math.round(value * 100) / 100)
      }
      onSave()
    }

    async function onSave() {
      if (!canSave.value) {
        uni.showToast({ title: '请补全信息', icon: 'none' })
        return
      }

      const cents = evaluateAmount(form.amountRaw)
      const payload = {
        type: form.type,
        amount_cents: cents,
        account_id: form.account_id,
        to_account_id: form.type === 'transfer' ? form.to_account_id : null,
        category_id: form.type === 'transfer' ? null : form.category_id,
        occurred_day: form.occurred_day,
        note: form.note.trim(),
        tag_ids: form.tag_ids,
        source: 'manual'
      }

      try {
        if (props.editing) {
          await txnStore.update(props.editing.id, payload)
          uni.showToast({ title: '已更新', icon: 'success' })
        } else {
          await txnStore.create(payload)
          uni.showToast({ title: '已记一笔', icon: 'success' })
          // 记住本次账户，下次默认
          await settingStore.update({ defaultAccountId: form.account_id })
        }
        emit('saved')
        visible.value = false
      } catch (e) {
        uni.showModal({ title: '保存失败', content: e.message, showCancel: false })
      }
    }

    function onClose() {
      visible.value = false
    }

    /* ------------------------------------------------------ 生命周期 */

    watch(
      () => props.modelValue,
      async (open) => {
        if (!open) return
        await accountStore.load()
        await loadOptions()

        if (props.editing) {
          fillFromTxn(props.editing)
        } else if (props.preset) {
          fillFromPreset(props.preset)
        } else {
          resetForm()
        }
      }
    )

    // 类型变化时自动选第一个分类，减少一次点击
    watch(
      () => form.type,
      () => {
        if (form.type !== 'transfer' && !form.category_id && categoryList.value.length > 0) {
          form.category_id = categoryList.value[0].id
        }
      }
    )

    return {
      visible, types, form, primaryColor, currencySymbol,
      categoryList, displayAmount, canSave,
      currentAccountName, toAccountName, accountActions, toAccountActions, tagActions,
      selectedTags, quickDays, isQuickDay, shortDate,
      showAccountPicker, showToAccountPicker, showTagPicker, calendarRef, calendarValue, maxDate,
      iconChar, isSameDay, switchType, pickCategory, pickDay,
      openAccountPicker, openToAccountPicker, openTagPicker, openCalendar,
      onAccountSelect, onToAccountSelect, onTagSelect, removeTag,
      onCalendarConfirm, onSave, onClose
    }
  }
}
</script>

<style scoped>
.panel {
  background-color: var(--app-card);
  padding-bottom: env(safe-area-inset-bottom);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 32rpx 0;
}

/* 左侧占位，让类型切换真正居中 */
.panel-head-spacer {
  width: 80rpx;
  flex-shrink: 0;
}

/* 取消：右上角 + 红色 */
.panel-cancel {
  font-size: 28rpx;
  color: var(--app-danger);
  min-width: 80rpx;
  text-align: right;
  flex-shrink: 0;
}

.type-switch {
  display: flex;
  gap: 48rpx;
  flex: 1;
  justify-content: center;
}

.type-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  padding-bottom: 12rpx;
}

.type-text {
  font-size: 32rpx;
  font-weight: 500;
  transition: color 0.2s;
}

.type-bar {
  position: absolute;
  bottom: 0;
  width: 40rpx;
  height: 4rpx;
  border-radius: 2rpx;
}

.amount-area {
  padding: 32rpx 32rpx 16rpx;
  display: flex;
  align-items: baseline;
  gap: 16rpx;
}

.amount-label {
  font-size: 26rpx;
  color: var(--app-text-3);
}

.amount-row {
  display: flex;
  align-items: baseline;
  flex: 1;
}

.amount-symbol {
  font-size: 36rpx;
  font-weight: 500;
  margin-right: 8rpx;
}

.amount-value {
  font-size: 68rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.cat-scroll {
  width: 100%;
  white-space: nowrap;
}

.cat-list {
  display: flex;
  padding: 16rpx 32rpx 24rpx;
  gap: 8rpx;
}

.cat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  width: 108rpx;
  gap: 8rpx;
}

.cat-icon-wrap {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

.cat-icon-text {
  font-size: 30rpx;
  color: #ffffff;
  font-weight: 500;
}

.cat-name {
  font-size: 22rpx;
  text-align: center;
  transition: color 0.2s;
}

.form-rows {
  padding: 0 32rpx;
  border-top: 1rpx solid var(--app-line);
}

.form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 88rpx;
  border-bottom: 1rpx solid var(--app-line);
  gap: 16rpx;
}

.form-row-wrap {
  align-items: flex-start;
  padding: 20rpx 0;
  flex-direction: column;
  gap: 12rpx;
}

.row-label {
  font-size: 28rpx;
  color: var(--app-text-2);
  flex-shrink: 0;
}

.row-value {
  display: flex;
  align-items: center;
  gap: 8rpx;
  flex: 1;
  justify-content: flex-end;
}

.row-value-right {
  gap: 12rpx;
}

.row-text {
  font-size: 28rpx;
  color: var(--app-text);
}

.row-arrow {
  font-size: 32rpx;
  color: var(--app-text-3);
}

.day-chip {
  padding: 8rpx 20rpx;
  border-radius: 20rpx;
  background-color: var(--app-card-2);
}

.day-chip.active {
  background-color: var(--app-primary-light);
}

.day-chip-text {
  font-size: 24rpx;
}

/* 标签：单行横向滚动，不换行 */
.tag-scroll {
  width: 100%;
  white-space: nowrap;
}

.tag-area {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 12rpx;
  padding-right: 24rpx;
}

.tag-chip {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 8rpx 16rpx;
  border-radius: 20rpx;
  border: 1rpx solid;
  flex-shrink: 0;
  white-space: nowrap;
}

.tag-chip-text {
  font-size: 24rpx;
}

.tag-chip-x {
  font-size: 26rpx;
  color: var(--app-text-3);
}

.tag-add {
  padding: 8rpx 20rpx;
  border-radius: 20rpx;
  border: 1rpx dashed var(--app-line);
  flex-shrink: 0;
  white-space: nowrap;
}

.tag-add-text {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.note-input {
  flex: 1;
  font-size: 28rpx;
  color: var(--app-text);
  text-align: right;
}

.note-placeholder {
  color: var(--app-text-3);
  font-size: 28rpx;
}
</style>
