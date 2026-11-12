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
        <view class="amount-label-row">
          <text class="amount-label">{{ form.type === 'transfer' ? '转账金额' : '金额' }}</text>
          <!--
            汇率只读显示在「金额」后面
            ★ 用户要求：不要输入框、不允许手动改 ★
              汇率是客观数据，手改只会记错账；显示出来是让用户知道
              这笔折算按什么价算的。取不到汇率时不显示（保存会拦）。
          -->
          <text v-if="isForeign && exchangeRate > 0" class="rate-inline">
            汇率 {{ formatRate(exchangeRate) }}
          </text>
        </view>

        <!--
          币种选择：金额左侧，显示 ISO 缩写（CNY / JPY / USD），默认 CNY
          ★ 为什么显示缩写而不是符号 ★
            日元和人民币符号都是 ¥，符号根本分不清是哪种钱。
            缩写是最不容易误读的标识。
        -->
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
              <!--
                线性向下箭头

                ★ color 必须是真实色值，不能传 CSS 变量 ★
                  LineIcon 把 SVG 编成 data URI 交给 <image> 加载，
                  那是独立图片文档，解析不了 var(--app-text-3) ——
                  传变量会得到无效 stroke，图标整个不显示（已踩）。
                  所以用 iconInk 计算属性给出深浅两套真实色。
              -->
              <LineIcon name="chevronDown" :size="14" :color="iconInk" />
            </view>
          </picker>
          <view class="amount-row">
            <text class="amount-value"
              :class="{ 'is-raw': isRawInput }"
              :style="{ color: form.amountRaw ? 'var(--app-text)' : 'var(--app-text-3)' }"
            >{{ amountDisplay || '0.00' }}</text>
          </view>
        </view>

        <!--
          预览行：算式结果 + 外币折算，**同一行**
          ★ 为什么要合并 ★
            「= 20.00」和「≈ ¥144.80」原来是上下两行，
            小屏上把下面的分类区挤下去了，而且两个都是为了
            确认「这个数对不对」，放一起看才连贯。
          两者互不冲突：算式时显示左边，外币时显示右边，
          外币用算式输入时两个都显示。
        -->
        <view v-if="isRawInput || (isForeign && convertedPreview)" class="amount-sub-row">
          <text v-if="isRawInput" class="amount-preview">
            = {{ computedPreview }}
          </text>
          <text v-if="isForeign && convertedPreview" class="fx-converted-inline">
            {{ convertedPreview }}
          </text>
        </view>
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
        <!--
          ★ 账户 + 标签同一行、各占一半（用户要求）★
            以前是两整行，一行只有一个短词（「现金」「日常」），
            面板下方留白很多却把数字键盘挤到屏幕外。
            合并成一行后省下 96rpx 高度，两种选择互不干扰。

          ★ 转账时这一行只显示账户 ★
            转账没有分类/标签语义，右边那一格让给「转入」，
            否则「转入」还得再占一整行，又多出 96rpx。
        -->
        <view class="form-row form-row-split">
          <view class="form-cell" @click="openAccountPicker">
            <text class="cell-label">账户</text>
            <view class="cell-value">
              <text class="cell-text">{{ currentAccountName }}</text>
              <text class="cell-arrow">›</text>
            </view>
          </view>

          <!-- 转账目标账户：占右半边 -->
          <view v-if="form.type === 'transfer'" class="form-cell cell-right" @click="openToAccountPicker">
            <text class="cell-label">转入</text>
            <view class="cell-value">
              <text
                class="cell-text"
                :style="{ color: form.to_account_id ? 'var(--app-text)' : 'var(--app-text-3)' }"
              >{{ toAccountName || '请选择' }}</text>
              <text class="cell-arrow">›</text>
            </view>
          </view>

          <!-- 标签：占右半边 -->
          <view v-else class="form-cell cell-right" @click="openTagPicker">
            <text class="cell-label">标签</text>
            <view class="cell-value">
              <text
                class="cell-text"
                :style="{ color: selectedTags.length ? 'var(--app-text)' : 'var(--app-text-3)' }"
              >{{ selectedTagDisplay || '请选择' }}</text>
              <text class="cell-arrow">›</text>
            </view>
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

        <!--
          ★ 借入借出四类：备注 = 人员，且必填 ★
            用户要求：「记账面板上的选择这四个分类时，记账面板上的备注
            两个字修改为人员，此时该项为必填项」。
            · 借出 / 借入：可以是没见过的新人，直接输入；
            · 借款归还 / 借款收回：必须是之前记过的人，
              点右侧 › 从「已添加过的人员」里选（还错人不会触发新分组）。

          ★ 为什么必须是必填 ★
            管理页按人员分组，备注空着这一笔就变成孤儿：
            既不在任何人的账上，也不会出现在「未结清」里，
            用户会以为钱记丢了。
        -->
        <view v-if="isPersonCategory" class="form-row form-row-person">
          <text class="row-label">人员</text>
          <view class="row-value person-value">
            <input
              v-model="form.note"
              class="note-input person-input"
              :placeholder="personPlaceholder"
              placeholder-class="note-placeholder"
              :maxlength="20"
              confirm-type="done"
            />
            <text class="person-pick" @click="openPersonPicker">选择</text>
          </view>
        </view>

        <!-- 备注：普通分类才显示 -->
        <view v-else class="form-row">
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

        <!--
          ★ 不计入预算 ｜ 待报销（本轮用户第 1 / 3 条）★
            位置：备注下方一行。
          ★ 没有标题、没有说明小字 ★
            就是一条竖分割线居中两栏 —— 和交易详情页完全一致，
            两边都交给 ExcludeFlags 组件（联动规则只写一份）。
          ★ 只有支出才显示 ★
            收入/转账既没有预算额度概念，也不可能「报销」。
        -->
        <view v-if="form.type === 'expense' && !isPersonCategory" class="form-row form-row-flags">
          <ExcludeFlags
            :exclude-budget="form.excludeBudget"
            :reimburse-status="form.reimburseStatus"
            :can-reimburse="form.type === 'expense'"
            :reimburse-disabled="reimburseDisabled"
            @update="onFlagsUpdate"
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

    <!--
      ★ 账户选择改成自绘弹层（用户本轮要求）★
        「重写一下这个账户选择的面板，单选，显示图标和金额，
        用在筛选面板 / 记账面板 / 报销弹层」

      ★ 为什么不用 wd-action-sheet 了 ★
        它每行只有 name + subname 两行纯文字，**没有图标**。
        而账户在 App 里是有视觉身份的（账户页、流水行都是
        「圆角方框 + 账户色浅底 + 图标」），选择器里只剩名字，
        用户得靠读字认账户。现在每行带图标 + 名字 + 余额，
        和账户页那一行是同一套信息。
    -->
    <AccountPickerSheet
      v-model="showAccountPicker"
      :accounts="sourceAccountList"
      :selected-id="form.account_id"
      title="选择账户"
      :z-index="120"
      @picked="onAccountPicked"
    />

    <AccountPickerSheet
      v-model="showToAccountPicker"
      :accounts="toAccountList"
      :selected-id="form.to_account_id"
      title="选择转入账户"
      :z-index="120"
      @picked="onToAccountPicked"
    />

    <!--
      标签选择：多选（用户反馈修正）

      ★ 为什么从 wd-action-sheet 换成 TxnTagSheet ★
        用户原话：「标签只能做单选」。
        wd-action-sheet 的 @select 每次只回一个索引，
        而表单里 form.tag_ids 本来就是数组、
        徽标也是按数组渲染的 —— 能力一直在，
        只是选择器被限成了单选。
        换成和右滑/批量同一个多选弹层，三处交互也就统一了。
    -->
    <TxnTagSheet
      v-model="showTagPicker"
      :tags="tags"
      :selected-ids="form.tag_ids"
      title="选择标签"
      @picked="onTagSheetPicked"
    />

    <!-- 人员选择：已经从流水里出现过的人名（借款归还/借款收回用它匹配） -->
    <wd-action-sheet
      v-model="showPersonPicker"
      :actions="personActions"
      cancel-text="取消"
      @select="onPersonSelect"
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

    <!--
      日期选择：wd-calendar 无 visible 属性，需 ref.open()

      ★ min-date / max-date 必须显式给，否则无法切换月份（用户反馈）★
        wd-calendar-view 的默认 minDate 是「6 个月前」、maxDate 是「6 个月后」。
        但本项目只传了 max-date（今天），min-date 走默认值 ——
        在某些版本的实现里，一旦传了 max-date 而 min-date 用默认的相对日期，
        月份切换会被限制在极窄的范围（表现为「只能选本月」）。
        显式给出两端：往前 3 年（记账常见回溯范围，也够覆盖周期补记），
        往后到今天（不接受未来日期）。
    -->
    <wd-calendar
      ref="calendarRef"
      v-model="calendarValue"
      :min-date="minDate"
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
import ExcludeFlags from '@/components/ExcludeFlags.vue'
import CategoryPickerSheet from '@/components/CategoryPickerSheet.vue'
import LineIcon from '@/components/LineIcon.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { listCategories, isSystemPresetName } from '@/api/category.js'
import { listTags } from '@/api/tag.js'
import TxnTagSheet from '@/components/TxnTagSheet.vue'
import AccountPickerSheet from '@/components/AccountPickerSheet.vue'
import { getCategoryUsageCounts } from '@/api/stats.js'
import {
  isLoanPersonCategory, isLoanSettleCategory, allowsNewPerson, listLoanPeople
} from '@/api/loan.js'
import { toDayKey, shiftDay, formatDayHeader, formatTime, currentTimeText, combineDayTime } from '@/utils/date.js'
import { parseAmountInput, evaluateAmount } from '@/utils/money.js'
import { SUPPORTED_CURRENCIES, BASE_SYMBOL, getCurrencyMeta, buildOriginalNoteTag, applyNoteTag, stripNoteTag } from '@/utils/currency.js'
import { fetchLatestRates } from '@/api/exchangeRate.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'
import { sortCategoriesByUsage, isSelectableCategory, isInternalOnlyCategory } from '@/utils/categorySort.js'
import { categoryIconFullStyle } from '@/utils/categoryIcon.js'
import { alertDialog } from '@/utils/dialog.js'
import { pushLayer } from '@/utils/layerStack.js'

export default {
  name: 'TxnPanel',
  components: { AccountPickerSheet, NumberKeyboard, AppDialog, CategoryPickerSheet, LineIcon, ExcludeFlags , TxnTagSheet },
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

    /**
     * 线性图标的描边色（深/浅两套真实 hex）
     *
     * ★ 不能传 CSS 变量 ★
     *   LineIcon 用 <image> 加载 SVG data URI，那是独立文档，
     *   currentColor / var() 都解析不了，会让图标变成不可见。
     *   项目里 account/edit.vue 也是同样的处理（iconInk）。
     */
    const iconInk = computed(() => (settingStore.isDark ? '#A1A1A6' : '#646566'))

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
      tag_ids: [],
      /*
       * 报销与预算标记（v21）
       *   excludeBudget    是否不计入预算
       *   reimburseStatus  0 不报销 / 1 待报销 / 2 已报销
       * 两者由 ExcludeFlags 组件联动：勾待报销会自动勾上「不计入预算」。
       */
      excludeBudget: false,
      reimburseStatus: 0,
      /** 外币：币种代码（'CNY' = 本位币）与用户可改的汇率 */
      currency: 'CNY',
    })

    /* ------------------------------------------------------ 外币与汇率 */

    /**
     * 汇率缓存（当前最新一次拉取结果）
     * day/source 用于在界面上标注汇率日期，让用户知道用的哪天的价。
     */
    const fxCache = ref({ rates: {}, day: '', source: '' })

    /** 支持的币种（下拉列表，显示 ISO 缩写） */
    const currencyOptions = [{ code: 'CNY', symbol: BASE_SYMBOL, name: '人民币' }]
      .concat(SUPPORTED_CURRENCIES.map((c) => ({ code: c.code, symbol: c.symbol, name: c.name })))
    /*
     * ★ 下拉里显示「缩写 + 中文名」★
     *   列表本身要给不熟悉代码的人看懂（CNY 人民币），
     *   但面板上那个小按钮只显示缩写（CNY/JPY）——省地方且不易误读。
     */
    const currencyNames = currencyOptions.map((c) => `${c.code} ${c.name}`)
    const currencyIndex = computed(() => {
      const idx = currencyOptions.findIndex((c) => c.code === form.currency)
      return idx >= 0 ? idx : 0
    })

    /** 选中的币种元信息（CNY 返回 null） */
    const currencyMeta = computed(() => getCurrencyMeta(form.currency))

    /** 是否外币记账 */
    const isForeign = computed(() => !!currencyMeta.value)

    /**
     * 汇率（1 外币 = ? CNY）
     *
     * ★ 只读，来自缓存，不支持手动修改（用户明确要求）★
     *   汇率是客观数据，手改只会记错账；
     *   显示的汇率同时也是折算依据，两者必须同一个数。
     */
    const exchangeRate = computed(() => {
      if (!isForeign.value) return 1
      return Number(fxCache.value.rates[form.currency]) || 0
    })

    /** 原币金额（分）—— 用户输入的原币数字 */
    const originalCents = computed(() => evaluateAmount(form.amountRaw))

    /** 折算后的 CNY 分（amount_cents 将存这个值） */
    const convertedCents = computed(() => {
      if (!isForeign.value) return originalCents.value
      const rate = exchangeRate.value
      if (!rate || rate <= 0) return 0
      return Math.round(originalCents.value * rate)
    })

    /** 折算预览：「≈ ¥1,440.00」 */
    const convertedPreview = computed(() => {
      if (!convertedCents.value) return ''
      return '≈ ¥' + (convertedCents.value / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
      })
    })

    /**
     * 汇率展示格式
     *
     * 日元这类汇率很小（0.048），直接 toFixed(2) 会显示成 0.05 —— 精度丢失。
     * 按量级决定小数位：>=1 用 4 位，<1 用 6 位。
     */
    function formatRate(rate) {
      const n = Number(rate) || 0
      if (n <= 0) return ''
      return n >= 1 ? n.toFixed(4) : n.toFixed(6)
    }

    /** 换币种：只切币种，汇率自动从缓存取 */
    function onCurrencyChange(e) {
      const idx = Number(e.detail.value) || 0
      const opt = currencyOptions[idx]
      if (!opt) return
      form.currency = opt.code
    }

    /** 面板每次打开时拉一次最新汇率（静默，失败用缓存） */
    async function prefetchRates() {
      // #ifdef APP-PLUS
      try {
        const res = await fetchLatestRates()
        fxCache.value = { rates: res.rates, day: res.day, source: res.source }
      } catch (e) {}
      // #endif
    }

    const categories = ref([])
    const tags = ref([])
    /**
     * 已出现过的人员（借入借出的备注）
     *
     * ★ 只用来给「借款归还 / 借款收回」挑选 ★
     *   那两类是把钱还回/收回某笔旧账，人一定是之前记过的；
     *   手输一个错别字就会凭空多出一个「新人员」，
     *   管理页里同一笔账被拆成两行。
     *   而「借出 / 借入」是第一次打交道，允许直接输入新名字。
     */
    const loanPeople = ref([])
    const showPersonPicker = ref(false)
    /** 最近 30 天各分类的使用次数，用于分类排序 */
    const usageCounts = ref({})
    const showAccountPicker = ref(false)
    const showToAccountPicker = ref(false)
    const showTagPicker = ref(false)
    /** 「更多分类」面板 */
    const showMoreCategories = ref(false)
    const calendarRef = ref(null)
    const calendarValue = ref(Date.now())
    /** 最晚可选：今天（不接受未来日期） */
    const maxDate = ref(Date.now())
    /**
     * 最早可选：3 年前
     *
     * ★ 为什么必须显式给 ★
     *   只给 max-date 时，min-date 会落到组件默认值（相对今天 6 个月），
     *   实测会导致日历月份切换范围异常（用户反馈「只能选本月」）。
     *   显式给一个足够早的固定下界，月份就能正常前后翻。
     *   3 年对个人记账足够（更早的账基本靠导入）。
     */
    const minDate = ref(new Date(new Date().getFullYear() - 3, 0, 1).getTime())
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

    /**
     * 当前选中的分类对象（没有则 null）
     *
     * ★ 不能只看 category_id ★
     *   分类可能刚被删掉，id 还在 form 里但 categories 里找不到 ——
     *   这时 isPersonCategory 要按「不在列表里 = 普通分类」处理。
     */
    const currentCategory = computed(() =>
      categories.value.find((c) => c.id === form.category_id) || null
    )

    /**
     * 当前分类是不是「借入借出」六类之一
     *
     * 是的话：备注变成「人员」、必填、这笔默认不计入收支。
     */
    const isPersonCategory = computed(() => {
      const cat = currentCategory.value
      if (!cat) return false
      return isLoanPersonCategory(cat.name)
    })

    /**
     * 当前分类是不是「结清派生分类」（借出坏账 / 借出利息 / 借入未还 / 借入利息）
     *
     * ★ 它们和前面四类的区别只有一个：计不计入收支 ★
     *   借出/借入/借款归还/借款收回是**资金往来** → 不计收支、不占预算；
     *   四个结清分类是**真实损益**（坏账是损失、利息是收益）→ 计入收支，
     *   只是不占预算。
     *
     * ★ 人员语义完全一样 ★
     *   「谁的坏账」「谁多还的利息」不写清楚，管理页就没法归到人头上，
     *   所以这两类照样走「人员」输入框 + 必填校验。
     */
    const isSettleCategory = computed(() => {
      const cat = currentCategory.value
      if (!cat) return false
      return isLoanSettleCategory(cat.name)
    })

    /**
     * 「待报销」是否被禁用（用户本轮第 5 条）
     *
     * ★ 系统固定分类下的支出不能报销 ★
     *   借出 / 借入 / 对账这类是资金往来，不是消费 ——
     *   「报销」这个词对它们没有意义。
     * ★ 判定用 isSystemPresetName（同步、只看名字和 type）★
     *   它和分类管理页「固定分类不可删改」用的是同一份名单，
     *   不会因为分类 id 重建而变化（名字才是稳定语义）。
     */
    const reimburseDisabled = computed(() => {
      const cat = currentCategory.value
      if (!cat) return false
      return isSystemPresetName(cat.name, cat.type)
    })

    /** 人员输入框的占位文案随分类变化 */
    const personPlaceholder = computed(() => {
      const name = currentCategory.value ? currentCategory.value.name : ''
      if (allowsNewPerson(name)) return '输入人名，如 张三 / 姐姐'
      return '选择已记过的人'
    })

    /**
     * 人员候选项（action-sheet 用）
     *
     * ★ 借款归还 / 借款收回 只允许选已有人名 ★
     *   这两类是在结一笔旧账，人名必须能和原流水对上；
     *   允许手输新名字等于允许「还给了不存在的人」，账永远结不清。
     *   所以这两类点「选择」时给的是历史人员列表，列表为空就提示。
     */
    const personActions = computed(() =>
      loanPeople.value.map((name) => ({ name }))
    )

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

    // 转入方不能是组合账户（钱只能「从组合出」，不能「进组合」）
    const toAccountList = computed(() =>
      accountStore.list.filter((a) => a.id !== form.account_id && !a.isCombo)
    )

    const selectedTags = computed(() =>
      tags.value.filter((t) => form.tag_ids.includes(t.id))
    )

    /** 已选标签的名字（全部，逗号分隔） */
    const selectedTagNames = computed(() =>
      selectedTags.value.map((t) => t.name).join('、')
    )

    /**
     * 标签格里展示的文案
     *
     * ★ 用户明确要求 ★
     *   「如果选择一个，就显示标签名，显示不下就用省略号；
     *   选择两个及以上的时候，显示『已选择两项』」。
     *
     * ★ 为什么集合成名字而不是拼标签名 ★
     *   上一版写成了「标签 A、标签 B」。
     *   但标签名长短不一（两个字到六个字都有），
     *   两个四字标签就会把那一行挤满并被截断，
     *   反而看不全。而且用户选三个时，只显示两个名字
     *   会让他以为"只选了两个"。
     *   直接告诉他「已选择 N 项」，既准确又不会溢出。
     *
     * ★ 为什么用中文数字而不是阿拉伯数字 ★
     *   「已选择两项」比「已选择 2 项」更像中文 App 的说法，
     *   也和界面上其他文案一致。
     *   N 超过十也不会出现——标签总数就那么几个。
     */
    const selectedTagDisplay = computed(() => {
      const list = selectedTags.value
      if (list.length === 0) return ''
      if (list.length === 1) return list[0].name
      const CN = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十']
      const n = list.length
      const nText = n <= 10 ? CN[n] : String(n)
      return `已选择${nText}项`
    })

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

    /** 打开人员选择（历史人员列表） */
    /**
     * 双栏状态变化（不计入预算 ｜ 待报销）
     *
     * ★ 规则已经在 ExcludeFlags 里实现了 ★
     *   组件发出来的载荷已经算好「勾待报销要自动勾上不计入预算」，
     *   面板这边只负责把值写回 form，不再重复判断一遍 ——
     *   两处都判断，迟早会出现两边结论不一致的诡异状态。
     */
    function onFlagsUpdate(next) {
      form.excludeBudget = !!next.excludeBudget
      form.reimburseStatus = Number(next.reimburseStatus) || 0
    }

    /*
     * ★ 切到系统分类时要把「待报销」清掉 ★
     *   用户可能先选了普通分类、勾了待报销，再改成「借出」。
     *   组件那边已经把「待报销」置灰了，但如果不清 form 里的值，
     *   保存时还是会带着 reimburse_status = 1 落库。
     *   （api/transaction.js 还有一道兜底会让它变成 0，但界面状态要先自洽：
     *    保存完再打开详情，勾选框不该是勾着的。）
     */
    watch(reimburseDisabled, (disabled) => {
      if (disabled && form.reimburseStatus === 1) {
        form.reimburseStatus = 0
        form.excludeBudget = false
      }
    })

    function openPersonPicker() {
      if (loanPeople.value.length === 0) {
        uni.showToast({ title: '还没有记过人员，直接输入名字即可', icon: 'none' })
        return
      }
      showPersonPicker.value = true
    }

    function onPersonSelect({ index }) {
      const name = loanPeople.value[index]
      if (name) form.note = name
      showPersonPicker.value = false
    }

    /**
     * 选中源账户
     *
     * ★ 回参从 { index } 变成整条账户对象（本轮改动）★
     *   原来走 wd-action-sheet，它只回索引，得拿索引回查列表；
     *   自绘面板直接把账户对象丢出来，页面不用再按下标反查
     *   —— 下拉选项的顺序一改，按下标反查就是错的，这是个隐患。
     */
    function onAccountPicked(acc) {
      if (!acc) return
      form.account_id = acc.id
      // 转账时若目标账户与新的源账户相同，清空
      if (form.to_account_id === acc.id) form.to_account_id = ''
      showAccountPicker.value = false
    }

    function onToAccountPicked(acc) {
      if (!acc) return
      form.to_account_id = acc.id
      showToAccountPicker.value = false
    }

    /**
     * 标签多选确定：直接覆盖成这一组
     *
     * ★ 这里是覆盖语义（不是追加）★
     *   弹层里回显的就是这笔当前的标签，
     *   用户取消勾选某个 = 想移除它。
     *   用追加语义就永远删不掉标签了。
     */
    function onTagSheetPicked(ids) {
      form.tag_ids = Array.isArray(ids) ? ids.slice() : []
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
      const [cats, tgs, counts, people] = await Promise.all([
        listCategories(),
        listTags(),
        // 用不到排序统计时不能影响主流程
        getCategoryUsageCounts(30).catch(() => ({})),
        // 人员列表同样不该拖垮面板：拿不到就当没有可选人员
        listLoanPeople().catch(() => [])
      ])
      categories.value = cats
      tags.value = tgs
      usageCounts.value = counts || {}
      loanPeople.value = Array.isArray(people) ? people : []
    }

    /** 重置表单 */
    function resetForm() {
      form.type = 'expense'
      form.amountRaw = ''
      form.note = ''
      form.tag_ids = []
      /*
       * ★ 币种每次重置回人民币 ★
       *   外币是偶发场景（出游/海淘），绝大多数记账是人民币。
       *   让上一次选的 JPY 粘到下一次会让人误记 ——
       *   用户不会每次注意金额旁边的小币种标签。
       */
      form.currency = 'CNY'
      /*
       * ★ 报销/预算标记每次重置 ★
       *   这是「这一笔」的属性，粘到下一笔会让人误记 ——
       *   上一笔记了待报销，下一笔日常支出还带着待报销标记，
       *   这笔账就永远不会进收支统计。
       */
      form.excludeBudget = false
      form.reimburseStatus = 0
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
     *   「系统分类」下面挂着「借出 / 对账支出」（支出）、
     *   「借入 / 对账收入」（收入）——
     *   如果取到的第一个是「借出」，用户新建一笔日常支出时
     *   分类默认变成「借出」，就莫名其妙记成借钱了。
     *
     *   所以这里显式跳过系统分类（借出/借入/对账支出/对账收入），
     *   只在用户自己的分类里挑第一个。
     *   如果用户的分类全被删光了（只剩系统预置的），
     *   再退回第一个可选分类 —— 至少不会「完成键点了没反应」。
     */
    const defaultCategoryId = computed(() => {
      const type = form.type === 'income' ? 'income' : 'expense'
      /*
       * ★ 内部口径分类不能当默认（本轮用户第 6 条）★
       *   借入利息 / 借出坏账 / 借出利息 / 借入未还 / 报销坏账 / 报销盈余
       *   是结清、报销自动写的，用户既不能选，就更不能默认落到它们头上。
       *   兜底那一档（list[0]）也要过滤 —— 用户把自己的分类全删光时，
       *   剩下的就只有系统分类，不过滤就会默认选中「借出坏账」这种。
       */
      const list = categories.value.filter(
        (c) => c.type === type && !c.isParent && !isInternalOnlyCategory(c.name)
      )
      const userList = list.filter((c) => !isSystemPresetName(c.name, type))
      const pick = userList.length > 0 ? userList[0] : list[0]
      return pick ? pick.id : ''
    })

    /** 用已有交易填充 */
    function fillFromTxn(txn) {
      form.type = txn.type

      /*
       * ★ 外币交易回显的是**原币金额**，不是折算后的人民币 ★
       *   库里 amount_cents 是折算后的人民币，直接回填会让用户
       *   看到 9.60 而不是他当时输入的 2000 日元 —— 编辑一次金额就错了。
       *   所以有原币快照时优先用它，并恢复币种与汇率。
       */
      if (txn.original_currency && txn.original_amount_cents) {
        form.currency = txn.original_currency
        form.amountRaw = String(txn.original_amount_cents / 100)
      } else {
        form.currency = 'CNY'
        form.amountRaw = String(txn.amount_cents / 100)
      }

      form.account_id = txn.account_id
      form.to_account_id = txn.to_account_id || ''
      form.category_id = txn.category_id || ''
      // 报销/预算标记随交易回显（编辑时不该把它们清掉）
      form.excludeBudget = txn.exclude_from_budget === true
      form.reimburseStatus = Number(txn.reimburse_status) || 0
      form.occurred_day = txn.occurred_day
      // 编辑时保留原来的时刻
      form.occurred_time = formatTime(txn.occurred_at)
      /*
       * ★ 备注要剥掉自动追加的原币标记 ★
       *   否则编辑时把「JPY 2,000 · 晚饭」整串显示给用户，
       *   保存时 applyNoteTag 再追加一次就成了「JPY 2,000 · JPY 2,000 · 晚饭」。
       *   （applyNoteTag 本身有剥离逻辑，这里剥一次让用户看到纯正文更清爽）
       */
      form.note = stripNoteTag(txn.note || '')
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
      // 速记面板可能在预置里带「待报销」（用户输入里提到报销）
      form.excludeBudget = p.exclude_budget === true || p.reimburse_status === 1
      form.reimburseStatus = Number(p.reimburse_status) || 0
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

      /*
       * ★ 外币折算（核心逻辑）★
       *   amount_cents 存**折算后的 CNY 分** —— 统计/预算/资产全部零改动。
       *   原币金额、币种、汇率作为快照字段一起入库，供展示与回溯。
       *   汇率缺失时不允许保存：否则会记成 0 元或错误金额。
       */
      let cents = evaluateAmount(form.amountRaw)
      let originalCurrency = null
      let originalAmountCents = null

      if (isForeign.value) {
        const rate = exchangeRate.value
        if (!rate || rate <= 0) {
          /*
           * ★ 汇率拿不到就不让存 ★
           *   汇率不可手动填写，只能来自接口/缓存。
           *   这时存下去要么折成 0 元、要么按 1:1 记错 ——
           *   明确告诉用户原因（多半是网络问题），比记错账好得多。
           */
          uni.showToast({ title: '汇率未获取，请稍后重试或换人民币记账', icon: 'none' })
          return
        }
        // 原币金额（分）：用户输入的原始数字
        originalAmountCents = cents
        originalCurrency = form.currency
        // 折算成人民币分
        cents = Math.round(cents * rate)
        if (cents <= 0) {
          uni.showToast({ title: '折算后金额无效', icon: 'none' })
          return
        }
      }

      /*
       * ★ 备注自动追加原币标记（幂等）★
       *   格式「JPY 2,000」，用 applyNoteTag 做替换而非追加：
       *   编辑三次金额不会留下三个标记，用户手写的正文永远保留。
       */
      let note = form.note.trim()
      /*
       * ★ 借入借出六类：人员必填 ★
       *   管理页按 note 分组，空备注这一笔会变成「孤儿流水」——
       *   不在任何人的账上、也不进未结清列表，用户会以为记丢了。
       */
      if (isPersonCategory.value && !note) {
        uni.showToast({ title: '请填写人员姓名', icon: 'none' })
        return
      }
      /*
       * ★ 借款归还 / 借款收回：人名必须是已经记过的 ★
       *   这两类是在结旧账，名字对不上就永远结不清。
       */
      if (isPersonCategory.value) {
        const catName = currentCategory.value ? currentCategory.value.name : ''
        if (!allowsNewPerson(catName) && !loanPeople.value.includes(note)) {
          uni.showToast({ title: '请选择已记过的人员', icon: 'none' })
          return
        }
      }
      if (isForeign.value) {
        const tag = buildOriginalNoteTag(originalAmountCents, originalCurrency)
        note = applyNoteTag(note, tag)
      } else {
        // 从外币改回人民币：剥掉遗留的标记
        note = applyNoteTag(note, null)
      }

      const payload = {
        type: form.type,
        amount_cents: cents,
        account_id: form.account_id,
        to_account_id: form.type === 'transfer' ? form.to_account_id : null,
        category_id: form.type === 'transfer' ? null : form.category_id,
        occurred_day: form.occurred_day,
        // ★ 带上具体时刻，不再固定 12:00 ★
        occurred_at: combineDayTime(form.occurred_day, form.occurred_time),
        note,
        tag_ids: form.tag_ids,
        // 外币快照（人民币交易为 null）
        original_currency: originalCurrency,
        original_amount_cents: originalAmountCents,
        exchange_rate: isForeign.value ? exchangeRate.value : null,
        /*
         * ★ 借入借出六类默认不进预算、不进收支（用户要求）★
         *   资金往来不是消费：借给姐姐 500，本月支出不该多 500；
         *   姐姐还我 500，也不是我赚了 500。
         *   这两笔在账户余额里照常计算 —— 钱确实动了。
         *
         * ★ 编辑普通交易时保留它原有的标记 ★
         *   用户在详情页手动勾过「不计入预算」，进来改个金额不该被清掉。
         */
        /*
         * ★ 预算：八类借款语义分类都不占预算 ★
         *   资金往来不占；坏账/利息也不是消费，同样不占。
         */
        /*
         * ★ 预算排除的三条来源 ★
         *   1) 借款类 / 结清类语义 → 一定排除
         *   2) 用户在本面板勾了「不计入预算」或「待报销」→ 排除
         *   3) 编辑老数据时保留它原有的标记
         */
        /*
         * ★ 编辑态怎么继承旧标记（本轮用户第 3 条）★
         *   一般情况：用户在详情页勾过「不计入预算」，进来改个金额不该被清掉，
         *   所以编辑时保留原值。
         *   例外：原来是「待报销」自动带出来的排除 —— 现在取消待报销，
         *   这两个标记必须跟着放开，否则取消完这笔账仍然不计收支/预算。
         */
        exclude_from_budget: (isPersonCategory.value || isSettleCategory.value || form.excludeBudget)
          ? true
          : !!(props.editing && props.editing.exclude_from_budget
            && Number(props.editing.reimburse_status) !== 1),
        /*
         * ★ 收支：只有前四类排除，结清分类必须计入 ★
         *   坏账是实实在在的损失、利息是实实在在的收益，
         *   把它们也排除掉，用户统计页就看不到「这笔钱亏了/赚了」。
         */
        /*
         * ★ 收支排除 ★
         *   结清类必须计入（false）；借款类不计入（true）；
         *   其余看「待报销」—— 待报销的钱还没回来，先别算收支。
         */
        exclude_from_stats: isSettleCategory.value
          ? false
          : (isPersonCategory.value
            ? true
            : (form.reimburseStatus === 1
              ? true
              : !!(props.editing && props.editing.exclude_from_stats
                && Number(props.editing.reimburse_status) !== 1))),
        /* 报销状态：只有支出才可能是待报销 */
        reimburse_status: form.type === 'expense' ? (Number(form.reimburseStatus) || 0) : 0
      }

      try {
        if (props.editing) {
          await txnStore.update(props.editing.id, payload)
          uni.showToast({ title: '已更新', icon: 'success' })
        } else {
          await txnStore.create(payload)
          uni.showToast({ title: '已记一笔', icon: 'success' })
          /*
           * ★ 不再把本次账户写成默认账户（bug 修复）★
           *   用户反馈：「记账面板选择账户会修改手动设置的默认账户」。
           *
           *   旧写法：每次新建流水都把 form.account_id 写回 defaultAccountId。
           *   后果：用户在账户页长按设好了「现金」为默认，
           *   下次买东西时临时选了一次「信用卡」——
           *   从此默认账户就变成了信用卡，用户根本没有改过设置。
           *
           *   ★ 为什么当初会这么写 ★
           *     想做「记得你上次用了哪个账户」的便利。
           *     但它和「默认账户」是两个不同的东西：
           *       · 默认账户 = 用户在账户页**显式设定**的账户
           *       · 上次账户 = 一个隐式的使用习惯
           *     把隐式钙点写进显式设置，等于用户的选择被系统静默覆盖。
           *     现在只保留显式设定：账户页长按「设为默认」、
           *     新建第一个真实账户时的自动默认（pages/account/edit.vue）。
           *   ★ 上次账户的便利不丢 ★
           *      它本来就存在于「form.account_id 的初始值 / AI 推断」那一层，
           *      不需要污染用户的显式设定。
           */
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
    bindSheet('txnPersonPicker', showPersonPicker)
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

        /*
         * 静默预取汇率（不阻塞面板打开、失败无声）
         * 用户切到外币时 fxCache 里已经有值，不用等网络。
         */
        prefetchRates()
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
        if (valid) return

        /*
         * ★ 编辑内部口径分类的老流水时不要强行改分类（本轮用户第 6 条）★
         *   借出坏账 / 报销坏账这类分类是结清、报销自动写的，已经从
         *   面板可选列表里剔掉了。但要编辑这样一笔时，如果这里按
         *   「不在列表里 = 无效」把它换成第一个分类，用户只改个备注
         *   就会把这笔结清流水的分类改错，管理页的账立刻对不上。
         *   所以：编辑态下只要原分类还在分类表里，就原样保留。
         */
        if (props.editing && form.category_id) {
          const exists = categories.value.some((c) => c.id === form.category_id)
          if (exists) return
        }

        if (categoryList.value.length > 0) {
          form.category_id = categoryList.value[0].id
        }
      }
    )

    return {
      visible, types, form, primaryColor,
      categories, categoryList, categoryRows, moreRowItems, allCategoryItems, usageCounts,
      showMoreCategories, openMoreCategories, pickCategoryFromMore,
      amountDisplay, isRawInput, computedPreview, canSave, amountFilled,
      /* 外币记账 */
      currencyNames, currencyIndex, isForeign, exchangeRate, formatRate,
      convertedPreview, onCurrencyChange, iconInk,
      currentCategory, isPersonCategory, isSettleCategory, personPlaceholder, personActions, onFlagsUpdate,
      reimburseDisabled,
      showPersonPicker, openPersonPicker, onPersonSelect,
      sourceAccountList, toAccountList, currentAccountName, toAccountName,
      /*
       * ★ tags 必须暴露给模板（bug 修复）★
       *   <TxnTagSheet :tags="tags"> 读的是模板作用域里的 tags。
       *   setup 里 const tags = ref([]) 声明了、也加载了数据（listTags），
       *   但没 return —— 模板拿到 undefined，标签弹层永远是空的
       *   （用户反馈「记账面板没有加载出标签条目」）。
       *   Vue 只在控制台打一句 "Property tags was accessed during render
       *   but is not defined on instance"，不报错、不白屏，很难发现。
       */
      tags,
      selectedTags, selectedTagNames, selectedTagDisplay, quickDays, isQuickDay, shortDate,
      showAccountPicker, showToAccountPicker, showTagPicker, onTagSheetPicked, calendarRef, calendarValue, maxDate, minDate,
      timePickerRef, timePickerValue, openTimePicker, onTimeConfirm,
      iconChar, catIconStyle, isSameDay, switchType, pickCategory, pickDay,
      openAccountPicker, openToAccountPicker, openTagPicker, openCalendar,
      onAccountPicked, onToAccountPicked, removeTag,
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

/* 币种选择器（金额左侧） */
.currency-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex: 1;
  min-width: 0;
}

/*
 * 币种选择器：缩写 + 右侧箭头（横排）
 *
 * ★ 为什么改成 row 而不是 column ★
 *   原来箭头在文字**下方**，看起来像「CNY 下面挂了个小三角」，
 *   既占高度又不像下拉控件。改成横排后是标准的
 *   「值 + 展开箭头」形态，和系统下拉框的观感一致。
 */
.currency-picker {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6rpx;
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
/*
 * 预览行：算式结果 + 外币折算，紧挨在一起
 *
 * ★ 为什么不用 space-between ★
 *   两者是同一句话的两个部分（「= 2000 ≈ ¥144.80」），
 *   两端对齐中间拉出大空隙，看起来像两个无关的信息。
 *   靠左连排、只留一个小 gap，读起来是一个整体。
 */
.amount-sub-row {
  display: flex;
  align-items: baseline;
  justify-content: flex-start;
  gap: 10rpx;
  margin-top: 6rpx;
}

.amount-preview {
  font-size: 26rpx;
  color: var(--app-text-3);
  font-variant-numeric: tabular-nums;
}

/* 外币：金额标签行的汇率（只读，紧跟在「金额」后面） */
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

/* 外币：折算预览（金额下方一行） */
.fx-converted-inline {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--app-text);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
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
  /*
   * ★ 必须 border-box ★
   *   选中时这一圈描边是 3rpx 的 border（见 utils/categoryIcon.js）。
   *   默认的 content-box 会把 border 加在 80rpx 之外 ——
   *   选中项变成 86rpx，一排分类跟着抖动。
   *   加上 border-box 之后描边画在 80rpx 内部，尺寸恒定。
   */
  box-sizing: border-box;
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

/* -------------------------------------------------- 账户 + 标签同一行 */

/*
 * 一行两格、等分
 *
 * ★ 为什么用 50% 而不是 flex:1 ★
 *   两格的内容长度差别很大（「现金」vs「日常开销」），
 *   flex:1 会让内容长的那格把另一格挤扁，两行文字一长就会换行错位。
 *   固定等分保证「账户」「标签」两个标签始终对齐在同一列。
 */
.form-row-split {
  padding: 0;
  gap: 0;
}

.form-cell {
  flex: 1;
  width: 50%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8rpx;
  min-height: 88rpx;
  min-width: 0;
}

/* 右半格：左边一条竖分隔，视觉上分成两栏 */
.form-cell.cell-right {
  padding-left: 20rpx;
  margin-left: 20rpx;
  border-left: 1rpx solid var(--app-line);
}

.cell-label {
  font-size: 28rpx;
  color: var(--app-text-2);
  flex-shrink: 0;
}

.cell-value {
  display: flex;
  align-items: center;
  gap: 6rpx;
  min-width: 0;
  flex: 1;
  justify-content: flex-end;
}

.cell-text {
  font-size: 28rpx;
  color: var(--app-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-arrow {
  font-size: 30rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
}

/* ------------------------------------------------------- 人员（借入借出） */

/*
 * 人员行：输入框在左、右侧「选择」胶囊
 *
 * ★ 比备注行多一个「选择」 ★
 *   借款归还/借款收回必须挑已有的人名，光给输入框等于让用户
 *   凭记忆拼写，拼错就多出一个不存在的人员，账永远结不清。
 */
.person-value {
  gap: 12rpx;
}

.person-input {
  text-align: right;
  min-width: 0;
}

/*
 * 「不计入预算 ｜ 待报销」那一行
 *
 * ★ 本轮用户第 1 条 ★
 *   去掉标题与说明小字后，这一行就是竖分割线居中两栏。
 *   ExcludeFlags 自己 flex:1 + 居中，这里只把行内边距收掉，
 *   让分割线落在面板可视区的正中间。
 */
.form-row-flags {
  justify-content: center;
  min-height: 84rpx;
}

.person-pick {
  font-size: 24rpx;
  color: var(--app-primary);
  padding: 6rpx 16rpx;
  border-radius: 16rpx;
  background-color: var(--app-primary-light);
  flex-shrink: 0;
}

.note-placeholder {
  color: var(--app-text-3);
  font-size: 28rpx;
}
</style>
