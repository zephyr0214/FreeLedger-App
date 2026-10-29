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
      <!-- 顶栏：类型切换居中，编辑时左上角放删除，取消放右上角（红色） -->
      <view class="panel-head">
        <view class="panel-head-left">
          <view v-if="editing" class="panel-delete" @click="onDelete">
            <LineIcon name="trash" :size="20" :color="'var(--app-danger)'" />
          </view>
          <view v-else class="panel-head-spacer" />
        </view>
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
            :class="{ 'is-raw': isRawInput }"
            :style="{ color: form.amountRaw ? 'var(--app-text)' : 'var(--app-text-3)' }"
          >{{ amountDisplay || '0.00' }}</text>
        </view>
        <text v-if="isRawInput" class="amount-preview">
          = {{ computedPreview }}
        </text>
      </view>

      <!-- 分类：固定两行，每行 6 个，第 12 个位置是「更多」 -->
      <view v-if="form.type !== 'transfer'" class="cat-rows">
        <view v-for="(row, ri) in categoryRows" :key="ri" class="cat-row">
          <view
            v-for="cat in row"
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
          <view
            v-if="ri === 1 && moreRowItems.length > 0"
            class="cat-item cat-more"
            @click="openMoreCategories"
          >
            <view class="cat-icon-wrap cat-more-wrap">
              <text class="cat-more-dots">···</text>
            </view>
            <text class="cat-name">更多</text>
          </view>
        </view>
      </view>

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

        <!-- 周期：每天 / 每周周几 / 每月几号 -->
        <view class="form-row" @click="openRecurrencePicker">
          <text class="row-label">周期</text>
          <view class="row-value">
            <text class="row-text">{{ recurrenceLabel }}</text>
            <text class="row-arrow">›</text>
          </view>
        </view>

        <!-- 周几（每周） -->
        <view v-if="form.recurrence === 'weekly'" class="form-row" @click="openWeekdayPicker">
          <text class="row-label">周几</text>
          <view class="row-value">
            <text class="row-text">{{ weekdayLabel }}</text>
            <text class="row-arrow">›</text>
          </view>
        </view>

        <!-- 几号（每月） -->
        <view v-if="form.recurrence === 'monthly'" class="form-row" @click="openDayPicker">
          <text class="row-label">几号</text>
          <view class="row-value">
            <text class="row-text">{{ dayOfMonthLabel }}</text>
            <text class="row-arrow">›</text>
          </view>
        </view>

        <!-- 备注 -->
        <view class="form-row">
          <text class="row-label">备注</text>
          <input
            v-model="form.note"
            class="note-input"
            placeholder="如 房租、订阅…"
            placeholder-class="note-placeholder"
            :maxlength="80"
            confirm-type="done"
          />
        </view>
      </view>

      <!-- 数字键盘 -->
      <NumberKeyboard
        v-model="form.amountRaw"
        finish-text="创建周期"
        :disabled="!amountFilled"
        @submit-amount="onFinish"
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

    <!-- 周期规则 -->
    <wd-action-sheet
      v-model="showRecurrencePicker"
      :actions="recurrenceActions"
      title="触发周期"
      cancel-text="取消"
      @select="onRecurrenceSelect"
    />
    <wd-action-sheet
      v-model="showWeekdayPicker"
      :actions="weekdayActions"
      title="每周几"
      cancel-text="取消"
      @select="onWeekdaySelect"
    />
    <wd-action-sheet
      v-model="showDayPicker"
      :actions="dayActions"
      title="每月几号"
      cancel-text="取消"
      @select="onDaySelect"
    />

    <!-- 更多分类 -->
    <wd-popup
      v-model="showMoreCategories"
      position="bottom"
      :safe-area-inset-bottom="true"
      custom-style="background-color: var(--app-card); border-radius: 28rpx 28rpx 0 0;"
    >
      <view class="more-sheet">
        <view class="more-sheet-head">
          <text class="more-sheet-title">选择分类</text>
          <text class="more-sheet-close" @click="showMoreCategories = false">关闭</text>
        </view>
        <scroll-view class="more-sheet-scroll" scroll-y>
          <view class="more-grid">
            <view
              v-for="cat in allCategoryItems"
              :key="cat.id"
              class="more-item"
              :class="{ active: form.category_id === cat.id }"
              @click="pickCategoryFromMore(cat)"
            >
              <view
                class="more-icon-wrap"
                :style="{
                  backgroundColor: form.category_id === cat.id
                    ? (cat.color || primaryColor)
                    : 'var(--app-card-2)'
                }"
              >
                <text class="more-icon-text">{{ iconChar(cat) }}</text>
              </view>
              <text
                class="more-name"
                :style="{
                  color: form.category_id === cat.id ? 'var(--app-text)' : 'var(--app-text-2)'
                }"
              >{{ cat.name }}</text>
            </view>
          </view>
        </scroll-view>
      </view>
    </wd-popup>

    <AppDialog />
  </wd-popup>
</template>

<script>
import { ref, reactive, computed, watch } from 'vue'
import NumberKeyboard from './NumberKeyboard.vue'
import AppDialog from '@/components/AppDialog.vue'
import LineIcon from '@/components/LineIcon.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { listCategories } from '@/api/category.js'
import { createCycle, updateCycle, deleteCycle, occursOnDay, recordCycleForDay } from '@/api/cycle.js'
import { evaluateAmount } from '@/utils/money.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'
import { sortCategoriesByUsage } from '@/utils/categorySort.js'
import { getCategoryUsageCounts } from '@/api/stats.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'
import { toDayKey } from '@/utils/date.js'

const WEEKDAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
const RECURRENCES = [
  { key: 'daily', name: '每天' },
  { key: 'weekly', name: '每周' },
  { key: 'monthly', name: '每月' }
]

export default {
  name: 'CyclePanel',
  components: { NumberKeyboard, AppDialog, LineIcon },
  props: {
    modelValue: { type: Boolean, default: false },
    /** 编辑已有周期时传入 */
    editing: { type: Object, default: null }
  },
  emits: ['update:modelValue', 'saved'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    // 模板里直接绑定 editing 用（props 在 setup 里不会自动暴露为局部变量）
    const editing = computed(() => props.editing)

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
      note: '',
      recurrence: 'monthly',
      weekday: 1,
      day_of_month: 1
    })

    const categories = ref([])
    const usageCounts = ref({})
    const showAccountPicker = ref(false)
    const showToAccountPicker = ref(false)
    const showRecurrencePicker = ref(false)
    const showWeekdayPicker = ref(false)
    const showDayPicker = ref(false)
    const showMoreCategories = ref(false)

    /* ------------------------------------------------------ 计算属性 */

    // ★ 与首页「+」记账面板统一：按最近 30 天使用频率排序，已选中的排第一
    const categoryList = computed(() => {
      const type = form.type === 'income' ? 'income' : 'expense'
      const list = categories.value.filter((c) => c.type === type && !c.isParent)
      return sortCategoriesByUsage(list, usageCounts.value, form.category_id)
    })

    const CAT_SLOTS = 12
    const PER_ROW = 6
    const DIRECT_MAX = 11

    const categoryRows = computed(() => {
      const list = categoryList.value
      const hasMore = list.length > DIRECT_MAX
      const direct = hasMore ? list.slice(0, DIRECT_MAX) : list.slice(0, CAT_SLOTS)
      return [direct.slice(0, PER_ROW), direct.slice(PER_ROW, PER_ROW * 2)]
    })

    const moreRowItems = computed(() => {
      const list = categoryList.value
      return list.length > DIRECT_MAX ? list.slice(DIRECT_MAX) : []
    })

    const allCategoryItems = computed(() => categoryList.value)

    const amountDisplay = computed(() => {
      const raw = (form.amountRaw || '').trim()
      if (!raw) return ''
      if (!/[+\-×÷()]/.test(raw)) {
        const n = Number(raw)
        if (Number.isFinite(n)) return n.toFixed(2)
      }
      return raw
    })

    const isRawInput = computed(() => /[+\-×÷()]/.test((form.amountRaw || '').trim()))

    const computedPreview = computed(() => {
      const cents = evaluateAmount(form.amountRaw)
      return cents ? (cents / 100).toFixed(2) : '0.00'
    })

    const amountFilled = computed(() => evaluateAmount(form.amountRaw) > 0)

    const currentAccountName = computed(() => {
      const acc = accountStore.list.find((a) => a.id === form.account_id)
      return acc ? acc.name : '请选择'
    })

    const toAccountName = computed(() => {
      const acc = accountStore.list.find((a) => a.id === form.to_account_id)
      return acc ? acc.name : ''
    })

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

    const recurrenceActions = computed(() => RECURRENCES.map((r) => ({ name: r.name })))

    const recurrenceLabel = computed(() => {
      const r = RECURRENCES.find((x) => x.key === form.recurrence)
      return r ? r.name : '每月'
    })

    const weekdayActions = computed(() =>
      [1, 2, 3, 4, 5, 6, 7].map((w) => ({ name: WEEKDAY_NAMES[w] }))
    )

    const weekdayLabel = computed(() => WEEKDAY_NAMES[Number(form.weekday) || 1])

    const dayActions = computed(() =>
      Array.from({ length: 31 }, (_, i) => ({ name: `${i + 1} 号` }))
    )

    const dayOfMonthLabel = computed(() => `${Number(form.day_of_month) || 1} 号`)

    /* ------------------------------------------------------ 方法 */

    function iconChar(cat) {
      return cat.icon ? iconEmoji(cat.icon) : guessIconByName(cat.name)
    }

    /** 周期简称（弹窗文案用）：分类名 / 转账两端名 */
    function cycleNamePreview(cycle) {
      if (cycle.type === 'transfer') {
        const from = accountStore.list.find((a) => a.id === cycle.account_id)
        const to = accountStore.list.find((a) => a.id === cycle.to_account_id)
        return `${from ? from.name : '账户'} → ${to ? to.name : '账户'}`
      }
      const cat = categories.value.find((x) => x.id === cycle.category_id)
      return cat ? cat.name : '未分类'
    }

    function switchType(key) {
      form.type = key
      if (key !== 'transfer') {
        form.to_account_id = ''
        // 切换到支出/收入时，默认选中该类型下的第一个分类（与首页「+」一致）
        if (!categoryList.value.some((c) => c.id === form.category_id)) {
          form.category_id = defaultCategoryId.value || ''
        }
      }
    }

    function pickCategory(cat) {
      form.category_id = cat.id
    }

    function openMoreCategories() {
      showMoreCategories.value = true
    }

    function pickCategoryFromMore(cat) {
      form.category_id = cat.id
      showMoreCategories.value = false
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

    function openRecurrencePicker() {
      showRecurrencePicker.value = true
    }

    function openWeekdayPicker() {
      showWeekdayPicker.value = true
    }

    function openDayPicker() {
      showDayPicker.value = true
    }

    function onAccountSelect({ index }) {
      const acc = accountStore.list[index]
      if (!acc) return
      form.account_id = acc.id
      if (form.to_account_id === acc.id) form.to_account_id = ''
      showAccountPicker.value = false
    }

    function onToAccountSelect({ index }) {
      const acc = toAccountList.value[index]
      if (!acc) return
      form.to_account_id = acc.id
      showToAccountPicker.value = false
    }

    function onRecurrenceSelect({ index }) {
      const r = RECURRENCES[index]
      if (!r) return
      form.recurrence = r.key
      showRecurrencePicker.value = false
    }

    function onWeekdaySelect({ index }) {
      form.weekday = index + 1
      showWeekdayPicker.value = false
    }

    function onDaySelect({ index }) {
      form.day_of_month = index + 1
      showDayPicker.value = false
    }

    async function loadOptions() {
      const [cats, counts] = await Promise.all([
        listCategories(),
        getCategoryUsageCounts(30).catch(() => ({}))
      ])
      categories.value = cats
      usageCounts.value = counts || {}
    }

    function resetForm() {
      form.type = 'expense'
      form.amountRaw = ''
      form.note = ''
      form.recurrence = 'monthly'
      form.weekday = 1
      form.day_of_month = 1
      form.to_account_id = ''
      form.account_id = settingStore.settings.defaultAccountId || (accountStore.list[0] || {}).id || ''
      // ★ 与首页「+」一致：默认选中排序后的第一个分类，避免「完成没反应」
      form.category_id = defaultCategoryId.value || ''
    }

    // ★ 与首页「+」一致：默认分类 = 当前类型下排序后的第一个
    const defaultCategoryId = computed(() => {
      const list = categoryList.value
      return list.length > 0 ? list[0].id : ''
    })

    function fillFromCycle(c) {
      form.type = c.type
      form.amountRaw = String(c.amount_cents / 100)
      form.account_id = c.account_id
      form.to_account_id = c.to_account_id || ''
      // 编辑时沿用周期自己的分类；万一分类被删了则退回默认第一个
      form.category_id = c.category_id && c.type !== 'transfer'
        ? c.category_id
        : (defaultCategoryId.value || '')
      form.note = c.note || ''
      form.recurrence = c.recurrence || 'monthly'
      form.weekday = Number(c.weekday) || 1
      form.day_of_month = Number(c.day_of_month) || 1
    }

    function onFinish(value) {
      if (value === -1) {
        uni.showToast({ title: '括号没有闭合', icon: 'none' })
        return
      }
      if (value !== undefined && value !== null) {
        form.amountRaw = String(Math.round(value * 100) / 100)
      }
      onSave()
    }

    async function onSave() {
      if (!amountFilled.value) {
        uni.showToast({ title: '请输入金额', icon: 'none' })
        return
      }
      if (!form.account_id) {
        uni.showToast({ title: '请选择账户', icon: 'none' })
        return
      }
      if (form.type === 'transfer') {
        if (!form.to_account_id) {
          uni.showToast({ title: '请选择转入账户', icon: 'none' })
          return
        }
        if (form.to_account_id === form.account_id) {
          uni.showToast({ title: '转入账户不能与转出相同', icon: 'none' })
          return
        }
      } else if (!form.category_id) {
        uni.showToast({ title: '请选择分类', icon: 'none' })
        return
      }

      const cents = evaluateAmount(form.amountRaw)
      const patch = {
        type: form.type,
        amount_cents: cents,
        account_id: form.account_id,
        to_account_id: form.type === 'transfer' ? form.to_account_id : null,
        category_id: form.type === 'transfer' ? null : form.category_id,
        note: form.note.trim(),
        recurrence: form.recurrence,
        weekday: form.recurrence === 'weekly' ? Number(form.weekday) : null,
        day_of_month: form.recurrence === 'monthly' ? Number(form.day_of_month) : null
      }
      try {
        if (props.editing) {
          // 编辑：只改规则，不动已产生的流水；不弹「今天记一笔」
          await updateCycle(props.editing.id, patch)
          await settingStore.update({ defaultAccountId: form.account_id })
          uni.showToast({ title: '周期已更新', icon: 'success' })
          emit('saved')
          visible.value = false
          return
        }

        // ★ 新建：不默认立刻记第一笔；只有当「今天本就该发生」时才弹窗询问 ★
        //   每天：今天必然发生
        //   每周：今天恰好是该周几
        //   每月：今天恰好是该日（clamp 后仍是今天）
        const cycle = await createCycle(patch)
        await settingStore.update({ defaultAccountId: form.account_id })

        const today = toDayKey()
        if (occursOnDay(cycle, today)) {
          const ok = await confirmDialog({
            title: '今天要记一笔吗？',
            content: `「${cycleNamePreview(cycle)}」按规则今天应该记一笔，是否现在记？`,
            confirmText: '记一笔',
            cancelText: '先不记'
          })
          if (ok) {
            await recordCycleForDay(cycle.id, today)
            uni.showToast({ title: '已记一笔', icon: 'success' })
          }
        }

        uni.showToast({ title: '周期已创建', icon: 'success' })
        emit('saved')
        visible.value = false
      } catch (e) {
        await alertDialog({ title: props.editing ? '保存失败' : '创建失败', content: e.message })
      }
    }

    function onClose() {
      visible.value = false
    }

    /** 编辑时左上角删除：软删除周期（保留已记流水） */
    async function onDelete() {
      if (!props.editing) return
      const c = props.editing
      const ok = await confirmDialog({
        title: '删除这个周期？',
        content: '已记的流水会保留，只是不再按这个周期提醒',
        confirmText: '删除',
        danger: true
      })
      if (!ok) return
      try {
        await deleteCycle(c.id)
        uni.showToast({ title: '已删除', icon: 'success' })
        emit('saved')
        visible.value = false
      } catch (e) {
        await alertDialog({ title: '删除失败', content: e.message })
      }
    }

    function hideTabBar() {
      try { uni.hideTabBar({ animation: false }) } catch (e) {}
    }

    function showTabBar() {
      try { uni.showTabBar({ animation: false }) } catch (e) {}
    }

    watch(
      () => props.modelValue,
      async (open) => {
        if (!open) { showTabBar(); return }
        hideTabBar()
        await accountStore.load()
        await loadOptions()
        if (props.editing) {
          fillFromCycle(props.editing)
        } else {
          resetForm()
        }
      }
    )

    watch(
      () => form.type,
      () => {
        if (form.type === 'transfer') {
          form.category_id = ''
          return
        }
        // 非转账：保持当前选中（若仍有效），否则回落到该类型第一个分类
        if (!categoryList.value.some((c) => c.id === form.category_id)) {
          form.category_id = defaultCategoryId.value || ''
        }
      }
    )

    return {
      visible, editing, types, form, primaryColor, currencySymbol,
      categoryRows, moreRowItems, allCategoryItems,
      showMoreCategories, openMoreCategories, pickCategoryFromMore,
      amountDisplay, isRawInput, computedPreview, amountFilled,
      currentAccountName, toAccountName, accountActions, toAccountActions,
      recurrenceActions, recurrenceLabel, weekdayActions, weekdayLabel,
      dayActions, dayOfMonthLabel,
      showAccountPicker, showToAccountPicker, showRecurrencePicker,
      showWeekdayPicker, showDayPicker,
      iconChar, switchType, pickCategory,
      openAccountPicker, openToAccountPicker, openRecurrencePicker,
      openWeekdayPicker, openDayPicker,
      onAccountSelect, onToAccountSelect, onRecurrenceSelect,
      onWeekdaySelect, onDaySelect,
      onFinish, onClose, onDelete
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

.panel-head-spacer {
  width: 80rpx;
  flex-shrink: 0;
}

.panel-head-left {
  width: 80rpx;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.panel-delete {
  width: 60rpx;
  height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

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
  flex-direction: column;
  gap: 4rpx;
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

.amount-value.is-raw {
  font-size: 48rpx;
  letter-spacing: 1rpx;
}

.amount-preview {
  font-size: 26rpx;
  color: var(--app-text-3);
  font-variant-numeric: tabular-nums;
}

.cat-rows {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  padding: 16rpx 32rpx 20rpx;
}

.cat-row {
  display: flex;
  gap: 8rpx;
  flex-shrink: 0;
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

.cat-more-wrap {
  background-color: var(--app-card-2);
  border: 2rpx dashed var(--app-line);
}

.cat-more-dots {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--app-text-3);
  line-height: 1;
  letter-spacing: 2rpx;
}

.more-sheet {
  background-color: var(--app-card);
  padding-bottom: env(safe-area-inset-bottom);
  max-height: 72vh;
  display: flex;
  flex-direction: column;
}

.more-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx 20rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.more-sheet-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
}

.more-sheet-close {
  font-size: 28rpx;
  color: var(--app-text-3);
}

.more-sheet-scroll {
  max-height: 54vh;
}

.more-grid {
  display: flex;
  flex-wrap: wrap;
  padding: 16rpx 32rpx 24rpx;
}

.more-item {
  width: 20%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
  padding: 12rpx 0;
}

.more-icon-wrap {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.more-icon-text {
  font-size: 30rpx;
  color: #ffffff;
  font-weight: 500;
}

.more-name {
  font-size: 22rpx;
  text-align: center;
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

.row-text {
  font-size: 28rpx;
  color: var(--app-text);
}

.row-arrow {
  font-size: 32rpx;
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
