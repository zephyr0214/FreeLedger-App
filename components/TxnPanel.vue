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
        分类：固定两行，每行 6 个，共 12 个位置
        第 12 个位置是「更多」按钮（有超出分类时显示），
        点它弹出完整分类面板。
      -->
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

          <!-- 第 12 个位置：更多 -->
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

        <!-- 日期 + 时间 -->
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
            <!-- 时间：点开选时/分 -->
            <view class="day-chip time-chip" @click="openTimePicker">
              <text class="day-chip-text time-chip-text">
                {{ form.occurred_time }}
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

      <!-- 数字键盘：4x5，支持 + - × ÷ 和括号
           事件名用 submit-amount 而不是 finish：
           finish 是 HTML 原生事件名，@finish 会被透传出去导致父组件收不到 -->
      <NumberKeyboard
        v-model="form.amountRaw"
        :finish-text="form.type === 'transfer' ? '转账' : '保存'"
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

    <!-- 标签选择：单选，与账户用同一个 action-sheet -->
    <wd-action-sheet
      v-model="showTagPicker"
      :actions="tagActions"
      cancel-text="取消"
      @select="onTagSelect"
    />

    <!--
      更多分类：按一级分类分组的网格面板。
      ★ 与周期弹层共用同一个组件（components/CategoryPickerSheet.vue）★
      -->
    <CategoryPickerSheet
      v-model="showMoreCategories"
      :categories="allCategoryItems"
      :all-categories="categories"
      :selected-id="form.category_id"
      @pick-category="pickCategoryFromMore"
    />

    <!-- 日期选择：wd-calendar 无 visible 属性，需 ref.open() -->
    <wd-calendar
      ref="calendarRef"
      v-model="calendarValue"
      :max-date="maxDate"
      :with-cell="false"
      @confirm="onCalendarConfirm"
    />

    <!--
      时间选择：type="time" 的 modelValue 是 'HH:mm' 字符串。
      ★ 必须给一个空的默认插槽 ★
        wd-datetime-picker 在「没有默认插槽」时，会自己渲染一个 wd-cell，
        于是面板最下方就多出一条独立的「选择时间」行（label + 箭头）。
        给一个空插槽后走 v-else 分支，只保留弹层，
        选择入口统一放在上面「日期」行里的时间胶囊上。
    -->
    <wd-datetime-picker
      ref="timePickerRef"
      v-model="timePickerValue"
      type="time"
      title="选择时间"
      @confirm="onTimeConfirm"
    >
      <view class="time-picker-anchor" />
    </wd-datetime-picker>
  </wd-popup>

  <!-- 全局弹窗宿主（组件库重绘的确认框） -->
  <AppDialog />
</template>

<script>
import { ref, reactive, computed, watch, onUnmounted } from 'vue'
import NumberKeyboard from './NumberKeyboard.vue'
import AppDialog from '@/components/AppDialog.vue'
import CategoryPickerSheet from '@/components/CategoryPickerSheet.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { listCategories, isSystemPresetName } from '@/api/category.js'
import { listTags } from '@/api/tag.js'
import { getCategoryUsageCounts } from '@/api/stats.js'
import { toDayKey, shiftDay, formatDayHeader, formatTime, currentTimeText, combineDayTime } from '@/utils/date.js'
import { parseAmountInput, evaluateAmount } from '@/utils/money.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'
import { sortCategoriesByUsage, isSelectableCategory } from '@/utils/categorySort.js'
import { categoryIconStyle } from '@/utils/categoryIcon.js'
import { alertDialog } from '@/utils/dialog.js'
import { pushLayer } from '@/utils/layerStack.js'

export default {
  name: 'TxnPanel',
  components: { NumberKeyboard, AppDialog, CategoryPickerSheet },
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
      /** 发生时刻（当天 HH:mm），默认当前时间 */
      occurred_time: currentTimeText(),
      note: '',
      tag_ids: []
    })

    const categories = ref([])
    const tags = ref([])
    /** 最近 30 天各分类的使用次数，用于分类排序 */
    const usageCounts = ref({})
    const showAccountPicker = ref(false)
    const showToAccountPicker = ref(false)
    const showTagPicker = ref(false)
    /** 「更多分类」面板 */
    const showMoreCategories = ref(false)
    const calendarRef = ref(null)
    const calendarValue = ref(Date.now())
    const maxDate = ref(Date.now())
    /** 时间选择器（wd-datetime-picker，type=time，值是 'HH:mm' 字符串） */
    const timePickerRef = ref(null)
    const timePickerValue = ref(currentTimeText())

    /* ------------------------------------------------------ 计算属性 */

    /**
     * 当前类型下的分类（已按使用频率排序）。
     *
     * 排序规则见 utils/categorySort.js：
     *   1. 已选中的排第一
     *   2. 最近 30 天用过的按次数降序
     *   3. 没用过的按用户设定的 sort 升序
     */
    const categoryList = computed(() => {
      const type = form.type === 'income' ? 'income' : 'expense'
      // ★ isSelectableCategory：二级 + 「无二级的一级」都可选，
      //   修复选「收入」时分类列表空白的问题（收入默认分类都没有二级）。
      const list = categories.value.filter(
        (c) => c.type === type && isSelectableCategory(c, categories.value)
      )
      return sortCategoriesByUsage(list, usageCounts.value, form.category_id)
    })

    /**
     * 分类固定两行，每行 6 个位置（最多 12 个）。
     *
     * 规则：
     *   - 分类 ≤ 11 个：全部直接显示，不需要「更多」
     *   - 分类 > 11 个：前 11 个直接显示，第 12 个位置是「更多」按钮，
     *     点它弹出完整分类面板选其余的
     */
    const CAT_SLOTS = 12
    const PER_ROW = 6
    /** 「更多」按钮占掉一个位置，实际直接显示的分类上限 */
    const DIRECT_MAX = 11

    const categoryRows = computed(() => {
      const list = categoryList.value
      const hasMore = list.length > DIRECT_MAX
      const direct = hasMore ? list.slice(0, DIRECT_MAX) : list.slice(0, CAT_SLOTS)

      const row1 = direct.slice(0, PER_ROW)
      const row2 = direct.slice(PER_ROW, PER_ROW * 2)
      return [row1, row2]
    })

    /** 「更多」面板里要显示的分类（第 12 个位置之后的） */
    const moreRowItems = computed(() => {
      const list = categoryList.value
      return list.length > DIRECT_MAX ? list.slice(DIRECT_MAX) : []
    })

    /** 「更多」面板显示的全部分类（含前 11 个，方便在面板里切换） */
    const allCategoryItems = computed(() => categoryList.value)

    /** 打开「更多」分类面板 */
    function openMoreCategories() {
      showMoreCategories.value = true
    }

    /** 从「更多」面板里选一个分类 */
    function pickCategoryFromMore(cat) {
      form.category_id = cat.id
      showMoreCategories.value = false
    }

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
      if (!acc) return '请选择'
      return acc.isCombo ? `${acc.name}（组合）` : acc.name
    })

    const toAccountName = computed(() => {
      const acc = accountStore.list.find((a) => a.id === form.to_account_id)
      return acc ? acc.name : ''
    })

    /**
     * 源账户可选列表（按当前类型过滤）。
     *
     * ★ 组合账户按类型决定是否出现 ★
     *   · 支出：显示（顶部，标注「组合」）—— 用户日常支付想省事就选它
     *   · 收入 / 转账：不显示 —— 组合只能用于支出，钱不能进虚拟账户，
     *     转账两端都必须落到真实账户。
     *
     * ★ 组合排在最前 ★
     *   listAccounts 按 include_in_total DESC 排（真实账户在前、组合在后），
     *   但这里用户就是想快速选组合，所以手动把组合提到顶部。
     */
    const sourceAccountList = computed(() => {
      if (form.type !== 'expense') {
        return accountStore.list.filter((a) => !a.isCombo)
      }
      const combos = accountStore.list.filter((a) => a.isCombo)
      const reals = accountStore.list.filter((a) => !a.isCombo)
      return [...combos, ...reals]
    })

    // wd-action-sheet 的 select 回传 { item, index }，按索引回查真实 id
    const accountActions = computed(() =>
      sourceAccountList.value.map((a) => ({
        name: a.name,
        subname: a.isCombo ? '组合账户' : `余额 ${(a.balance_cents / 100).toFixed(2)}`,
        color: a.color
      }))
    )

    // 转入方不能是组合账户（钱只能「从组合出」，不能「进组合」）
    const toAccountList = computed(() =>
      accountStore.list.filter((a) => a.id !== form.account_id && !a.isCombo)
    )

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

    /**
     * 分类图标的配色。
     *
     * ★ 与交易流水保持一致 ★
     *   浅色底（分类色 + '22'）+ 分类本色图标。
     *   以前这里是「深色实底 + 白图标」，选中时整块分类色，
     *   同一个分类在流水里和记账弹层里完全是两种观感。
     *
     * @param {object} cat 分类对象
     * @param {boolean} active 是否选中（选中时加一圈同色描边）
     */
    function catIconStyle(cat, active) {
      return categoryIconStyle(cat, primaryColor.value, active)
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

    function pickDay(day) {
      form.occurred_day = day
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

    function openTagPicker() {
      if (tags.value.length === 0) {
        uni.showToast({ title: '还没有标签，可到「设置 → 标签管理」创建', icon: 'none' })
        return
      }
      showTagPicker.value = true
    }

    function onAccountSelect({ index }) {
      const acc = sourceAccountList.value[index]
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

    /** 打开时间选择器 */
    function openTimePicker() {
      timePickerValue.value = form.occurred_time
      if (timePickerRef.value && typeof timePickerRef.value.open === 'function') {
        timePickerRef.value.open()
      }
    }

    /** 确认时间 */
    function onTimeConfirm({ value }) {
      form.occurred_time = value || currentTimeText()
    }

    async function loadOptions() {
      const [cats, tgs, counts] = await Promise.all([
        listCategories(),
        listTags(),
        // 用不到排序统计时不能影响主流程
        getCategoryUsageCounts(30).catch(() => ({}))
      ])
      categories.value = cats
      tags.value = tgs
      usageCounts.value = counts || {}
    }

    /** 重置表单 */
    function resetForm() {
      form.type = 'expense'
      form.amountRaw = ''
      form.note = ''
      form.tag_ids = []
      form.occurred_day = toDayKey()
      // 新记录默认是「此刻」
      form.occurred_time = currentTimeText()
      form.to_account_id = ''
      // ★ 默认账户不能是组合账户 ★
      //   组合是虚拟账户，作默认会让「记账」默认走它，用户可能没注意到。
      //   先取设置里的默认，若它指向组合（或没有），退回第一个真实账户。
      let def = settingStore.settings.defaultAccountId || ''
      const defAcc = accountStore.list.find((a) => a.id === def)
      if (!defAcc || defAcc.isCombo) {
        const firstReal = accountStore.list.find((a) => !a.isCombo)
        def = firstReal ? firstReal.id : ''
      }
      form.account_id = def
      // 默认选中第一个分类：这样用户输完金额直接按「完成」就能记一笔，
      // 不用先去点分类（之前不选分类就存不了，是「完成没反应」的真正原因）
      form.category_id = defaultCategoryId.value || ''
    }

    /**
     * 当前类型下的默认分类（第一个可选的分类）
     *
     * ★ 为什么不能直接取「第一个二级分类」★
     *   「系统预置分类」下面挂着「借出 / 对账支出」（支出）、
     *   「借入 / 对账收入」（收入）——
     *   如果取到的第一个是「借出」，用户新建一笔日常支出时
     *   分类默认变成「借出」，就莫名其妙记成借钱了。
     *
     *   所以这里显式跳过系统预置分类（借出/借入/对账支出/对账收入），
     *   只在用户自己的分类里挑第一个。
     *   如果用户的分类全被删光了（只剩系统预置的），
     *   再退回第一个可选分类 —— 至少不会「完成键点了没反应」。
     */
    const defaultCategoryId = computed(() => {
      const type = form.type === 'income' ? 'income' : 'expense'
      const list = categories.value.filter((c) => c.type === type && !c.isParent)
      const userList = list.filter((c) => !isSystemPresetName(c.name, type))
      const pick = userList.length > 0 ? userList[0] : list[0]
      return pick ? pick.id : ''
    })

    /** 用已有交易填充 */
    function fillFromTxn(txn) {
      form.type = txn.type
      form.amountRaw = String(txn.amount_cents / 100)
      form.account_id = txn.account_id
      form.to_account_id = txn.to_account_id || ''
      form.category_id = txn.category_id || ''
      form.occurred_day = txn.occurred_day
      // 编辑时保留原来的时刻
      form.occurred_time = formatTime(txn.occurred_at)
      form.note = txn.note || ''
      form.tag_ids = Array.isArray(txn.tag_ids) ? [...txn.tag_ids] : []
    }

    function fillFromPreset(p) {
      form.type = p.type || 'expense'
      form.amountRaw = p.amount_cents ? String(p.amount_cents / 100) : ''
      form.account_id = p.account_id || (accountStore.list[0] || {}).id || ''
      // 防御：组合账户只能用于支出，预置里带了组合 + 收入/转账就退回第一个真实账户
      if (form.type !== 'expense') {
        const cur = accountStore.list.find((a) => a.id === form.account_id)
        if (cur && cur.isCombo) {
          const firstReal = accountStore.list.find((a) => !a.isCombo)
          form.account_id = firstReal ? firstReal.id : ''
        }
      }
      form.to_account_id = p.to_account_id || ''
      // 预置没给分类时用默认分类，保证「完成」键能直接用
      form.category_id = p.category_id || defaultCategoryId.value || ''
      form.occurred_day = p.occurred_day || toDayKey()
      form.occurred_time = p.occurred_time || currentTimeText()
      form.note = p.note || ''
      form.tag_ids = Array.isArray(p.tag_ids) ? [...p.tag_ids] : []
    }

    /**
     * 键盘的「完成」。
     * 键盘已经把算式求好值传过来了（value），-1 表示括号不匹配。
     */
    function onFinish(value) {
      console.log('[panel] onFinish, value =', value, 'amountRaw =', JSON.stringify(form.amountRaw), 'category =', form.category_id, 'account =', form.account_id)
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
        // ★ 带上具体时刻，不再固定 12:00 ★
        occurred_at: combineDayTime(form.occurred_day, form.occurred_time),
        note: form.note.trim(),
        tag_ids: form.tag_ids
      }

      try {
        if (props.editing) {
          await txnStore.update(props.editing.id, payload)
          uni.showToast({ title: '已更新', icon: 'success' })
        } else {
          await txnStore.create(payload)
          uni.showToast({ title: '已记一笔', icon: 'success' })
          // 记住本次账户，下次默认（组合账户不能当默认）
          const srcAcc = accountStore.list.find((a) => a.id === form.account_id)
          if (srcAcc && !srcAcc.isCombo) {
            await settingStore.update({ defaultAccountId: form.account_id })
          }
        }
        emit('saved')
        visible.value = false
      } catch (e) {
        await alertDialog({ title: '保存失败', content: e.message })
      }
    }

    function onClose() {
      visible.value = false
    }

    /** 弹层栈注销函数（打开时登记、关闭/卸载时摘掉） */
    let unregisterLayer = null

    /*
     * ★ 面板内部的选择器也要能侧滑收起 ★
     *   账户 / 转入账户 / 标签 / 更多分类 都是叠在记账面板之上的弹层，
     *   侧滑返回时应该先关掉最上面这个，而不是连记账面板一起关掉、
     *   更不能直接退出页面。
     *   统一用一个小工具批量登记，避免 4 段重复代码。
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

    bindSheet('txnAccountPicker', showAccountPicker)
    bindSheet('txnToAccountPicker', showToAccountPicker)
    bindSheet('txnTagPicker', showTagPicker)
    /*
     * ★ 「更多分类」不在这里登记 ★
     *   它现在是独立组件 CategoryPickerSheet，
     *   由那个组件自己 pushLayer / 摘掉（见 components/CategoryPickerSheet.vue）。
     *   两边都登记的话栈里会有两条记录，
     *   侧滑返回要按两次才关得掉记账面板。
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

    /* ------------------------------------------------------ 生命周期 */

    watch(
      () => props.modelValue,
      async (open) => {
        if (!open) {
          // 关闭时从弹层栈摘掉，避免登记残留
          if (unregisterLayer) {
            unregisterLayer()
            unregisterLayer = null
          }
          return
        }

        /*
         * ★ 打开时登记到弹层栈 ★
         *   这样全面屏侧滑返回 / 安卓返回键会先收起面板，
         *   而不是直接退出整个页面（见 utils/layerStack.js）。
         */
        if (!unregisterLayer) {
          unregisterLayer = pushLayer(() => { visible.value = false }, 'txnPanel')
        }

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
      categories, categoryList, categoryRows, moreRowItems, allCategoryItems, usageCounts,
      showMoreCategories, openMoreCategories, pickCategoryFromMore,
      amountDisplay, isRawInput, computedPreview, canSave, amountFilled,
      currentAccountName, toAccountName, accountActions, toAccountActions, tagActions,
      selectedTags, selectedTagNames, quickDays, isQuickDay, shortDate,
      showAccountPicker, showToAccountPicker, showTagPicker, calendarRef, calendarValue, maxDate,
      timePickerRef, timePickerValue, openTimePicker, onTimeConfirm,
      iconChar, catIconStyle, isSameDay, switchType, pickCategory, pickDay,
      openAccountPicker, openToAccountPicker, openTagPicker, openCalendar,
      onAccountSelect, onToAccountSelect, onTagSelect, removeTag,
      onCalendarConfirm, onFinish, onSave, onClose
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

/* 分类：固定两行，每行 6 个位置 */
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

/* 「更多」按钮 */
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

/* 时间：和日期区分开，用等宽数字，一眼看出是时刻 */
.time-chip {
  padding: 8rpx 16rpx;
}

.time-chip-text {
  font-size: 24rpx;
  color: var(--app-text-2);
  font-variant-numeric: tabular-nums;
}

/*
  时间选择器的占位插槽。
  wd-datetime-picker 没有默认插槽时会自己渲染一整行 wd-cell，
  那就是面板底部多出来的「选择时间」独立行。
  给一个空的插槽后组件只保留弹层，这个锚点不占位、不显示。
*/
.time-picker-anchor {
  display: none;
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
