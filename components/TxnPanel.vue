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

      <!-- 金额：实时显示输入内容（算式或数字），点「完成」才结算 -->
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
        <!-- 算式时提示会算成多少 -->
        <text v-if="isRawInput" class="amount-preview">
          = {{ computedPreview }}
        </text>
      </view>

      <!--
        分类：分两行，每行独立横向滑动
        外层按行分组（每行 5 个），每行一个 scroll-view，
        这样两行互不影响，各自可以向右滑看更多分类。
      -->
      <view v-if="form.type !== 'transfer'" class="cat-rows">
        <scroll-view
          v-for="(row, ri) in categoryRows"
          :key="ri"
          class="cat-scroll"
          scroll-x
          :show-scrollbar="false"
        >
          <view class="cat-list">
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
          </view>
        </scroll-view>
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

        <!-- 标签：与账户一致，点击弹出选择 -->
        <view class="form-row" @click="openTagPicker">
          <text class="row-label">标签</text>
          <view class="row-value">
            <text
              class="row-text"
              :style="{ color: selectedTags.length ? 'var(--app-text)' : 'var(--app-text-3)' }"
            >{{ selectedTagNames || '请选择' }}</text>
            <text class="row-arrow">›</text>
          </view>
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
        :disabled="!amountFilled"
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

    <!-- 标签选择：单选，与账户用同一个 action-sheet -->
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

    /**
     * 分类按每行 6 个分组，渲染成两行。
     * 每行是一个独立的横向 scroll-view，行与行互不影响，
     * 分类多的时候每行都能各自向右滑。
     *
     * 6 个的宽度 = 6×108 + 5×8 = 688rpx，
     * 正好等于 750rpx 设计稿的视口宽（减去左右 32rpx 内边距），
     * 所以常规情况下不用滑动，分类超过 12 个才需要右滑。
     */
    const CATS_PER_ROW = 6

    const categoryRows = computed(() => {
      const list = categoryList.value
      const rows = []
      for (let i = 0; i < list.length; i += CATS_PER_ROW) {
        rows.push(list.slice(i, i + CATS_PER_ROW))
      }
      // 至少保留一行，避免空容器
      return rows.length > 0 ? rows : [[]]
    })

    /**
     * 金额行显示的内容。
     * 需求：输入过程中显示「整个运算式」，点「完成」才算出结果。
     *   - 输入 "12"      → 显示 12
     *   - 输入 "12+8"    → 显示 12+8（下面提示 = 20）
     */
    const amountDisplay = computed(() => {
      const raw = (form.amountRaw || '').trim()
      if (!raw) return ''
      // 单个数字时补两位小数显示更整齐；算式则原样显示
      if (!/[+\-×÷()]/.test(raw)) {
        const n = Number(raw)
        if (Number.isFinite(n)) return n.toFixed(2)
      }
      return raw
    })

    /** 当前是否是算式（含运算符或括号） */
    const isRawInput = computed(() => {
      const raw = (form.amountRaw || '').trim()
      return /[+\-×÷()]/.test(raw)
    })

    /** 算式的计算结果预览 */
    const computedPreview = computed(() => {
      const cents = evaluateAmount(form.amountRaw)
      if (!cents) return '0.00'
      return (cents / 100).toFixed(2)
    })

    /**
     * 金额是否已填。
     * 只看金额 —— 「完成」键的可点性不能依赖分类/账户是否已选，
     * 否则用户还没选分类就按不了完成，陷入死循环。
     */
    const amountFilled = computed(() => {
      const cents = evaluateAmount(form.amountRaw)
      return cents > 0
    })

    const canSave = computed(() => {
      if (!amountFilled.value) return false
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

    /** 标签选项（单选，与账户的 action-actions 同一格式） */
    const tagActions = computed(() =>
      tags.value.map((t) => ({ name: t.name, color: t.color }))
    )

    const selectedTags = computed(() =>
      tags.value.filter((t) => form.tag_ids.includes(t.id))
    )

    /** 已选标签的名字 */
    const selectedTagNames = computed(() =>
      selectedTags.value.map((t) => t.name).join('、')
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
      // 分类的切换逻辑统一交给 watch(form.type) 处理，避免两处逻辑打架
      form.type = key
      if (key !== 'transfer') {
        form.to_account_id = ''
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

    /** 标签单选：选中即替换，弹层自动关闭 */
    function onTagSelect({ index }) {
      const tag = tags.value[index]
      if (!tag) return
      form.tag_ids = [tag.id]
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
      form.account_id = settingStore.settings.defaultAccountId || (accountStore.list[0] || {}).id || ''
      // 默认选中第一个分类：这样用户输完金额直接按「完成」就能记一笔，
      // 不用先去点分类（之前不选分类就存不了，是「完成没反应」的真正原因）
      form.category_id = defaultCategoryId.value || ''
    }

    /** 当前类型下的默认分类（第一个一级分类） */
    const defaultCategoryId = computed(() => {
      const type = form.type === 'income' ? 'income' : 'expense'
      const list = categories.value.filter((c) => c.type === type && !c.isParent)
      return list.length > 0 ? list[0].id : ''
    })

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
      // 预置没给分类时用默认分类，保证「完成」键能直接用
      form.category_id = p.category_id || defaultCategoryId.value || ''
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
      // 逐项提示缺什么，而不是笼统的「请补全信息」
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
        showTabBar()
      } catch (e) {
        uni.showModal({ title: '保存失败', content: e.message, showCancel: false })
      }
    }

    function onClose() {
      visible.value = false
      showTabBar()
    }

    /* ------------------------------------------------------ tabBar 显隐 */

    /**
     * 打开记账面板时隐藏原生 tabBar。
     *
     * 原因：adjustResize 下键盘弹出会把 tabBar 顶到键盘上方，
     * 而记账面板是全屏弹层，底栏露在外面既突兀又可能被键盘压住。
     * 面板关闭（取消或保存成功）时恢复。
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

    /* ------------------------------------------------------ 生命周期 */

    watch(
      () => props.modelValue,
      async (open) => {
        if (!open) {
          // 面板关闭：恢复 tabBar
          showTabBar()
          return
        }
        // 面板打开：隐藏 tabBar，避免它被键盘顶起或与面板重叠
        hideTabBar()
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

    /**
     * 类型变化时重选分类。
     * 不只是「为空时选」—— 收支切换后原来的分类属于旧类型，
     * 必须换成新类型的第一个分类，否则保存时会报「请选择分类」。
     */
    watch(
      () => form.type,
      () => {
        if (form.type === 'transfer') {
          form.category_id = ''
          return
        }
        const valid = categoryList.value.some((c) => c.id === form.category_id)
        if (!valid && categoryList.value.length > 0) {
          form.category_id = categoryList.value[0].id
        }
      }
    )

    return {
      visible, types, form, primaryColor, currencySymbol,
      categoryList, categoryRows, amountDisplay, isRawInput, computedPreview, canSave, amountFilled,
      currentAccountName, toAccountName, accountActions, toAccountActions, tagActions,
      selectedTags, selectedTagNames, quickDays, isQuickDay, shortDate,
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

/* 算式输入时：字号略小，用等宽字体对齐运算符 */
.amount-value.is-raw {
  font-size: 48rpx;
  letter-spacing: 1rpx;
}

/* 算式结果预览 */
.amount-preview {
  font-size: 26rpx;
  color: var(--app-text-3);
  font-variant-numeric: tabular-nums;
}

/* 分类：两行，每行独立横向滑动 */
.cat-rows {
  padding: 16rpx 0 20rpx;
}

.cat-scroll {
  width: 100%;
  white-space: nowrap;
  /* 每行左右留白 */
  padding: 0 32rpx;
}

.cat-list {
  display: flex;
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
