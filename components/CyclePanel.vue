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
          <!-- 编辑时左上角删除：用文字而非 LineIcon —— LineIcon 是 SVG data URI，
              传 var(--app-danger) 会被兜底成灰色（SVG 拿不到 CSS 变量） -->
          <view v-if="editing" class="panel-delete" @click="onDelete">
            <text class="panel-delete-text">删除</text>
          </view>
          <view v-else class="panel-head-spacer" />
        </view>
        <!-- 编辑时不显示类型切换 tab（支出/收入/转账只在新建时可选），
             居中展示当前类型名作为标题 -->
        <view v-if="editing" class="type-static">
          <text class="type-static-text" :style="{ color: primaryColor }">{{ typeName }}</text>
        </view>
        <view v-else class="type-switch">
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
        <view class="amount-label-row">
          <text class="amount-label">{{ form.type === 'transfer' ? '转账金额' : '金额' }}</text>
          <!-- 汇率只读显示（与记账面板同款，不可手动改） -->
          <text v-if="isForeign && exchangeRate > 0" class="rate-inline">
            汇率 {{ formatRate(exchangeRate) }}
          </text>
        </view>

        <!-- 币种选择（显示 ISO 缩写）：与记账面板保持一致 -->
        <view class="currency-row">
          <picker
            :value="currencyIndex"
            :range="currencyNames"
            @change="onCurrencyChange"
          >
            <view class="currency-picker">
              <text
                class="currency-code"
                :style="{ color: form.currency === 'CNY' ? 'var(--app-text-2)' : primaryColor }"
              >{{ form.currency }}</text>
              <text class="currency-arrow">▾</text>
            </view>
          </picker>
          <view class="amount-row">
            <text
              class="amount-value"
              :class="{ 'is-raw': isRawInput }"
              :style="{ color: form.amountRaw ? 'var(--app-text)' : 'var(--app-text-3)' }"
            >{{ amountDisplay || '0.00' }}</text>
          </view>
        </view>
        <text v-if="isRawInput" class="amount-preview">
          = {{ computedPreview }}
        </text>
        <text v-if="isForeign && convertedPreview" class="fx-converted-line">
          {{ convertedPreview }}
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
            <!--
              图标配色与交易流水一致：浅色底 + 分类本色图标。
              （以前这里是「深色实底 + 白图标」，选中时整块分类色，和流水对不上）
            -->
            <view class="cat-icon-wrap" :style="catIconStyle(cat, form.category_id === cat.id)">
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

    <!--
      更多分类：按一级分类分组的网格面板。
      ★ 与记账弹层共用同一个组件（components/CategoryPickerSheet.vue）★
    -->
    <CategoryPickerSheet
      v-model="showMoreCategories"
      :categories="allCategoryItems"
      :all-categories="categories"
      :selected-id="form.category_id"
      @pick-category="pickCategoryFromMore"
    />

    <AppDialog />
  </wd-popup>
</template>

<script>
import { ref, reactive, computed, watch, onUnmounted } from 'vue'
import NumberKeyboard from './NumberKeyboard.vue'
import AppDialog from '@/components/AppDialog.vue'
import CategoryPickerSheet from '@/components/CategoryPickerSheet.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { listCategories } from '@/api/category.js'
import { createCycle, updateCycle, deleteCycle, occursOnDay, recordCycleForDay, skipCycleDay } from '@/api/cycle.js'
import { SUPPORTED_CURRENCIES, BASE_SYMBOL, getCurrencyMeta } from '@/utils/currency.js'
import { fetchLatestRates } from '@/api/exchangeRate.js'
import { evaluateAmount } from '@/utils/money.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'
import { sortCategoriesByUsage, isSelectableCategory } from '@/utils/categorySort.js'
import { categoryIconFullStyle } from '@/utils/categoryIcon.js'
import { getCategoryUsageCounts } from '@/api/stats.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'
import { toDayKey } from '@/utils/date.js'
import { pushLayer } from '@/utils/layerStack.js'

const WEEKDAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
const RECURRENCES = [
  { key: 'daily', name: '每天' },
  { key: 'weekly', name: '每周' },
  { key: 'monthly', name: '每月' }
]

export default {
  name: 'CyclePanel',
  components: { NumberKeyboard, AppDialog, CategoryPickerSheet },
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
      day_of_month: 1,
      /** 外币：币种代码（CNY = 本位币），与记账面板一致 */
      currency: 'CNY'
    })

    /* ------------------------------------------------------ 外币与汇率 */

    /** 汇率缓存（与 TxnPanel 同一份接口，各自拉一份即可） */
    const fxCache = ref({ rates: {}, day: '', source: '' })

    const currencyOptions = [{ code: 'CNY', symbol: BASE_SYMBOL, name: '人民币' }]
      .concat(SUPPORTED_CURRENCIES.map((c) => ({ code: c.code, symbol: c.symbol, name: c.name })))
    const currencyNames = currencyOptions.map((c) => `${c.code} ${c.name}`)
    const currencyIndex = computed(() => {
      const idx = currencyOptions.findIndex((c) => c.code === form.currency)
      return idx >= 0 ? idx : 0
    })

    const currencyMeta = computed(() => getCurrencyMeta(form.currency))
    const isForeign = computed(() => !!currencyMeta.value)

    /**
     * 汇率（1 外币 = ? CNY）—— 只读，来自缓存
     * ★ 周期是模板，这里显示的汇率只是「创建时的参考」
     *   实际补记时会按每笔发生日重新取（见 api/cycle.js 的 recordCycleForDay）★
     */
    const exchangeRate = computed(() => {
      if (!isForeign.value) return 1
      return Number(fxCache.value.rates[form.currency]) || 0
    })

    const originalCents = computed(() => evaluateAmount(form.amountRaw))
    const convertedCents = computed(() => {
      if (!isForeign.value) return originalCents.value
      const rate = exchangeRate.value
      if (!rate || rate <= 0) return 0
      return Math.round(originalCents.value * rate)
    })
    const convertedPreview = computed(() => {
      if (!convertedCents.value) return ''
      return '≈ ¥' + (convertedCents.value / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
      })
    })

    function formatRate(rate) {
      const n = Number(rate) || 0
      if (n <= 0) return ''
      return n >= 1 ? n.toFixed(4) : n.toFixed(6)
    }

    function onCurrencyChange(e) {
      const idx = Number(e.detail.value) || 0
      const opt = currencyOptions[idx]
      if (opt) form.currency = opt.code
    }

    /** 静默预取汇率 */
    async function prefetchRates() {
      // #ifdef APP-PLUS
      try {
        const res = await fetchLatestRates()
        fxCache.value = { rates: res.rates, day: res.day, source: res.source }
      } catch (e) {}
      // #endif
    }

    /** 当前类型名（编辑时顶栏不显示切换 tab，居中展示它） */
    const typeName = computed(() => {
      const t = types.find((x) => x.key === form.type)
      return t ? t.name : ''
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

    // ★ 与首页「+」记账面板统一：按最近 30 天使用频率排序，已选中的排第一。
    //   ★ 用 isSelectableCategory：二级 + 「无二级的一级」（如收入默认分类）都可选，
    //     修复选「收入」时分类列表空白的问题。
    const categoryList = computed(() => {
      const type = form.type === 'income' ? 'income' : 'expense'
      const list = categories.value.filter(
        (c) => c.type === type && isSelectableCategory(c, categories.value)
      )
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
      if (!acc) return '请选择'
      return acc.isCombo ? `${acc.name}（组合）` : acc.name
    })

    const toAccountName = computed(() => {
      const acc = accountStore.list.find((a) => a.id === form.to_account_id)
      return acc ? acc.name : ''
    })

    /**
     * 源账户可选列表（按当前类型过滤，规则同 TxnPanel）：
     *   支出显示组合（置顶）、收入/转账不显示（组合只能用于支出）。
     */
    const sourceAccountList = computed(() => {
      if (form.type !== 'expense') {
        return accountStore.list.filter((a) => !a.isCombo)
      }
      const combos = accountStore.list.filter((a) => a.isCombo)
      const reals = accountStore.list.filter((a) => !a.isCombo)
      return [...combos, ...reals]
    })

    const accountActions = computed(() =>
      sourceAccountList.value.map((a) => ({
        name: a.name,
        subname: a.isCombo ? '组合账户' : `余额 ${(a.balance_cents / 100).toFixed(2)}`,
        color: a.color
      }))
    )

    // 转入方不能是组合账户
    const toAccountList = computed(() =>
      accountStore.list.filter((a) => a.id !== form.account_id && !a.isCombo)
    )

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

    /**
     * 分类图标的配色。
     *
     * ★ 与交易流水保持一致 ★
     *   浅色底（分类色 + '22'）+ 分类本色图标。
     *   以前这里是「深色实底 + 白图标」，选中时整块分类色，
     *   同一个分类在流水里和记账弹层里完全是两种观感。
     *
     * ★ 选中态还要多一圈主题色描边 ★
     *   只靠底色区分在浅色主题下太弱（选中「分类色 + 22」≈ 13% 透明，
     *   未选中是 --app-card-2 浅灰），扫一眼看不出选的是哪个。
     *   加一圈 3rpx 主题色描边后一眼可辨，见 utils/categoryIcon.js。
     *
     * @param {object} cat 分类对象
     * @param {boolean} active 是否选中
     */
    function catIconStyle(cat, active) {
      return categoryIconFullStyle(cat, primaryColor.value, active)
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
      // 组合账户只能用于支出：切到收入/转账时，若当前还是组合，换成第一个真实账户
      if (key !== 'expense') {
        const cur = accountStore.list.find((a) => a.id === form.account_id)
        if (cur && cur.isCombo) {
          const firstReal = accountStore.list.find((a) => !a.isCombo)
          form.account_id = firstReal ? firstReal.id : ''
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
      if (sourceAccountList.value.length === 0) {
        uni.showToast({ title: form.type === 'income' ? '收入需要选择真实账户' : '请先添加账户', icon: 'none' })
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
      const acc = sourceAccountList.value[index]
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
      // ★ 默认账户不能是组合账户 ★
      let def = settingStore.settings.defaultAccountId || ''
      const defAcc = accountStore.list.find((a) => a.id === def)
      if (!defAcc || defAcc.isCombo) {
        const firstReal = accountStore.list.find((a) => !a.isCombo)
        def = firstReal ? firstReal.id : ''
      }
      form.account_id = def
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
      // 外币模板：回显原币金额与币种（amount_cents 就是原币金额）
      if (c.original_currency && c.original_currency !== 'CNY') {
        form.currency = c.original_currency
        form.amountRaw = String((c.original_amount_cents || c.amount_cents) / 100)
      } else {
        form.currency = 'CNY'
        form.amountRaw = String(c.amount_cents / 100)
      }
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

      /*
       * ★ 周期的金额语义：存**原币金额** ★
       *   与普通交易不同 —— 周期是模板，还没有「某一天」可言，
       *   实际折算发生在每次补记时（按发生日汇率，见 recordCycleForDay）。
       *   所以这里直接把用户输入的原币金额和币种存进模板。
       */
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
        day_of_month: form.recurrence === 'monthly' ? Number(form.day_of_month) : null,
        // 外币模板（人民币为 null）
        original_currency: isForeign.value ? form.currency : null,
        original_amount_cents: isForeign.value ? cents : null
      }
      try {
        if (props.editing) {
          // 编辑：只改规则，不动已产生的流水；不弹「今天记一笔」
          await updateCycle(props.editing.id, patch)
          // 组合账户不能作为默认账户
          const src = accountStore.list.find((a) => a.id === form.account_id)
          if (src && !src.isCombo) {
            await settingStore.update({ defaultAccountId: form.account_id })
          }
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
        // 组合账户不能作为默认账户
        const src = accountStore.list.find((a) => a.id === form.account_id)
        if (src && !src.isCombo) {
          await settingStore.update({ defaultAccountId: form.account_id })
        }

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
          } else {
            /*
             * ★ 用户选了「先不记」= 明确表达今天不要 ★
             *   必须记进 cycle_skip，否则下次进 App 的自动补记会发现
             *   「今天还没有流水」，又替他补上 —— 等于没问过。
             */
            await skipCycleDay(cycle.id, today)
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

    /*
     * ★ 这里原来有 hideTabBar / showTabBar，已经删掉 ★
     *   底栏换成自绘悬浮组件（AppTabBar）后，原生 tabBar 是被
     *   stores/setting.js 的 refreshTabBar() 永久隐藏的。
     *   若这里再调 showTabBar()，会把已藏起来的原生栏重新显示出来，
     *   和自绘底栏叠成两条 —— 这是必须删掉的原因。
     *   弹层打开时隐藏自绘底栏由页面侧的 :hidden 绑定负责。
     */

    watch(
      () => props.modelValue,
      async (open) => {
        if (!open) {
          if (unregisterLayer) {
            unregisterLayer()
            unregisterLayer = null
          }
          return
        }

        // 打开时登记到弹层栈：侧滑返回先收起面板，而不是退出页面
        if (!unregisterLayer) {
          unregisterLayer = pushLayer(() => { visible.value = false }, 'cyclePanel')
        }

        await accountStore.load()
        await loadOptions()
        if (props.editing) {
          fillFromCycle(props.editing)
        } else {
          resetForm()
        }
        // 静默预取汇率（不阻塞打开，失败无声）
        prefetchRates()
      }
    )

    /** 弹层栈注销函数 */
    let unregisterLayer = null

    /*
     * ★ 面板内部的选择器同样要能侧滑收起 ★
     *   账户 / 转入账户 / 重复方式 / 周几 / 几号 / 更多分类，
     *   都叠在周期面板之上。侧滑返回应逐层关闭：
     *   先关最上面的选择器，再关周期面板，而不是一次退出页面。
     */
    const sheetUnregisters = {}
    function bindSheet(name, refObj) {
      watch(refObj, (open) => {
        if (open) {
          if (!sheetUnregisters[name]) {
            sheetUnregisters[name] = pushLayer(() => { refObj.value = false }, name)
          }
          return
        }
        if (sheetUnregisters[name]) {
          sheetUnregisters[name]()
          sheetUnregisters[name] = null
        }
      })
    }

    bindSheet('cycAccountPicker', showAccountPicker)
    bindSheet('cycToAccountPicker', showToAccountPicker)
    bindSheet('cycRecurrencePicker', showRecurrencePicker)
    bindSheet('cycWeekdayPicker', showWeekdayPicker)
    bindSheet('cycDayPicker', showDayPicker)
    /*
     * ★ 「更多分类」不在这里登记 ★
     *   它现在是独立组件 CategoryPickerSheet，
     *   由那个组件自己 pushLayer / 摘掉（见 components/CategoryPickerSheet.vue）。
     *   两边都登记的话栈里会有两条记录，
     *   侧滑返回要按两次才关得掉周期面板。
     */

    onUnmounted(() => {
      if (unregisterLayer) {
        unregisterLayer()
        unregisterLayer = null
      }
      Object.keys(sheetUnregisters).forEach((k) => {
        if (sheetUnregisters[k]) sheetUnregisters[k]()
        sheetUnregisters[k] = null
      })
    })

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
      visible, editing, types, typeName, form, primaryColor,
      categories, categoryRows, moreRowItems, allCategoryItems,
      showMoreCategories, openMoreCategories, pickCategoryFromMore,
      amountDisplay, isRawInput, computedPreview, amountFilled,
      /* 外币记账（与 TxnPanel 同款） */
      currencyNames, currencyIndex, isForeign, exchangeRate, formatRate,
      convertedPreview, onCurrencyChange,
      currentAccountName, toAccountName, accountActions, toAccountActions,
      recurrenceActions, recurrenceLabel, weekdayActions, weekdayLabel,
      dayActions, dayOfMonthLabel,
      showAccountPicker, showToAccountPicker, showRecurrencePicker,
      showWeekdayPicker, showDayPicker,
      iconChar, catIconStyle, switchType, pickCategory,
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
  min-width: 60rpx;
  height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.panel-delete-text {
  font-size: 26rpx;
  color: var(--app-danger);
  font-weight: 500;
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

/* 编辑时顶栏居中的静态类型标题（类型切换 tab 已隐藏） */
.type-static {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.type-static-text {
  font-size: 30rpx;
  font-weight: 600;
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

/* 金额标签行：标签 + 只读汇率（与 TxnPanel 同款） */
.amount-label-row {
  display: flex;
  align-items: baseline;
  gap: 14rpx;
}

.rate-inline {
  font-size: 22rpx;
  color: var(--app-text-3);
  font-variant-numeric: tabular-nums;
}

/* 币种选择器 */
.currency-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex: 1;
  min-width: 0;
}

.currency-picker {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8rpx 16rpx;
  border-radius: 14rpx;
  background-color: var(--app-card-2);
  flex-shrink: 0;
}

.currency-code {
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1.2;
}

.currency-arrow {
  font-size: 16rpx;
  color: var(--app-text-3);
  line-height: 1.2;
}

/* 折算预览 */
.fx-converted-line {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: var(--app-text);
  font-variant-numeric: tabular-nums;
  margin-top: 6rpx;
}

.amount-row {
  display: flex;
  align-items: baseline;
  flex: 1;
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
  /*
   * ★ 必须 border-box ★
   *   选中态是一圈 3rpx 主题色 border。
   *   默认 content-box 会把它加在 80rpx 之外（选中项变 86rpx），
   *   一排分类会跟着抖。border-box 让描边画在内部，尺寸恒定。
   */
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

/*
  图标文字颜色由内联样式给（分类本色，见 utils/categoryIcon.js），
  这里不写死颜色 —— 写成 #ffffff 会盖掉内联的浅色底 + 本色图标。
*/
.cat-icon-text {
  font-size: 30rpx;
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
