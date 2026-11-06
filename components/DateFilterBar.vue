<template>
  <view class="dfb">
    <!--
      ★ 时间筛选方式切换（用户指定）★
        文案固定为「年月日筛选 / 自定义筛选」。
        样式照抄统计页「一级/二级」那组 type-toggle，两个页面观感一致。
    -->
    <view class="mode-toggle">
      <text
        class="mode-tag"
        :class="{ active: mode === 'period' }"
        @click="pickMode('period')"
      >年月日筛选</text>
      <text
        class="mode-tag"
        :class="{ active: mode === 'custom' }"
        @click="pickMode('custom')"
      >自定义筛选</text>
    </view>

    <!-- 年月日筛选：沿用原来的三级联动，一行没改 -->
    <DateRangePicker
      v-if="mode === 'period'"
      ref="periodRef"
      :model-value="modelValue"
      @range-change="onPeriodChange"
    />

    <!--
      自定义筛选

      ★ 一行：预设下拉 + 开始日期 + 结束日期 ★
        用户原话「只显示开始日期和结束日期，其他不要，显示在一行」，
        后来又要求「在最左侧再增加一个下拉框，支持选择自定义 / 近一周 /
        近一月 / 近半年 / 近一年 / 近五年」。所以这一行现在是三格。

      ★ 预设与手动选择怎么保持一致 ★
        预设不单独存状态，而是**反推**出来的：
        当前起止日正好等于某个预设的区间，左边就显示那个预设；
        否则显示「自定义」。这样「手动改日期 → 左边自动变自定义」
        是自然结果，不需要在两个地方同步一个 activePreset 变量
        （那种写法一定会漏：改一处忘一处）。

      ★ 为什么点开的是 wd-calendar 而不是原生 picker ★
        用户要求「日期选择面板使用和记账面板日期选择一致」——
        记账面板（components/TxnPanel.vue）用的是 wd-calendar，
        同一个组件，翻月、今天高亮、选中态才会长得一模一样。
    -->
    <view v-else class="custom-row">
      <picker
        class="custom-preset"
        mode="selector"
        :range="PRESET_LABELS"
        :value="presetIndex"
        @change="onPresetChange"
      >
        <view class="preset-inner">
          <text class="preset-text">{{ activePresetLabel }}</text>
          <text class="preset-arrow">▾</text>
        </view>
      </picker>

      <view class="custom-cell" @click="openCalendar('start')">
        <text class="custom-value" :class="{ placeholder: !startDay }">
          {{ startDay || '开始日期' }}
        </text>
      </view>
      <view class="custom-cell" @click="openCalendar('end')">
        <text class="custom-value" :class="{ placeholder: !endDay }">
          {{ endDay || '结束日期' }}
        </text>
      </view>
    </view>

    <!--
      两个日历：开始 / 结束各一个。
      ★ with-cell=false + ref.open() ★
        和记账面板同一套用法（wd-calendar 没有 visible 属性）；
        给 with-cell=false 是为了不让它自己渲染一行 wd-cell，
        那一行会凭空多出一块 UI，我们只要弹层。
    -->
    <wd-calendar
      ref="startCalRef"
      v-model="startValue"
      :min-date="minDate"
      :max-date="maxDate"
      :with-cell="false"
      :z-index="CALENDAR_Z_INDEX"
      title="选择开始日期"
      confirm-text="确定"
      @confirm="onStartConfirm"
    />
    <wd-calendar
      ref="endCalRef"
      v-model="endValue"
      :min-date="minDate"
      :max-date="maxDate"
      :with-cell="false"
      :z-index="CALENDAR_Z_INDEX"
      title="选择结束日期"
      confirm-text="确定"
      @confirm="onEndConfirm"
    />
  </view>
</template>

<script>
import { ref, computed } from 'vue'
import DateRangePicker from '@/components/DateRangePicker.vue'
import { toDayKey, parseDayKey, shiftDay } from '@/utils/date.js'

/**
 * 时间筛选条（全部交易页 / 统计页共用）
 *
 * ★ 为什么要抽成组件 ★
 *   两个页面原本各自写了一份完全一样的 toggle + 自定义区间代码，
 *   改文案、改日期面板就得改两遍，而且必然会改漏一处 ——
 *   之前那版就是因为一边用原生 picker 一边想用 wd-calendar，观感对不上。
 *   抽出来之后两页共用同一份实现，想不一致都难。
 *
 * ★ 状态仍然由页面持有 ★
 *   组件只负责「显示 + 把用户的选择抛出去」，不放自己的业务状态。
 *   来回切 tab 时状态不会丢，也不担心组件卸载后丢值。
 */

/**
 * 预设区间（用户指定的六项，顺序也照他说的）
 *
 * 除以「自定义」以外的跨度都是**含今天、往前数**：
 *   近一周 = 今天 + 前 6 天（共 7 天），而不是「上周一到现在」——
 *   后者会算出 8~14 天，用户会觉得自己选错了。
 */
const PRESETS = [
  { key: 'custom', label: '自定义' },
  { key: 'week', label: '近一周' },
  { key: 'month', label: '近一月' },
  { key: 'halfYear', label: '近半年' },
  { key: 'year', label: '近一年' },
  { key: 'fiveYear', label: '近五年' }
]

/**
 * 日历弹层的层级
 *
 * ★ 为什么必须显式抬到 1100 ★
 *   wd-calendar 内部用 wd-action-sheet 承载弹层，它的默认层级只有 15。
 *   而统计页底部有两个层级高得多的东西：悬浮底栏（AppTabBar，300）
 *   和「+」记账按钮（QuickAddBar，600）。
 *   15 小于 300，弹层就被底栏和「+」压住了 ——
 *   表现为日期面板下半截被遮，或者点了没反应（点到的其实是底栏）。
 *
 * ★ 为什么是 1100 而不是 9999 ★
 *   本项目的弹层层级排过序（数字从大到小）：
 *     DateFilterBar 的日历（1100） > AppDialog（1000）
 *       > UpdateDialog（900） > QuickAddBar（600） > AppTabBar（300）
 *   日历是「用户主动点开、必须能操作」的临时弹层，应该盖住所有常驻 UI；
 *   但系统原生的日期轮 / 键盘层级更高，不在这个体系里。
 */
const CALENDAR_Z_INDEX = 1100

const PRESET_LABELS = PRESETS.map((p) => p.label)

/** 把毫秒时间戳转成 YYYY-MM-DD（按本地时区，不能用 toISOString） */
function tsToDay(ts) {
  return toDayKey(new Date(ts))
}

/**
 * 某个预设对应的区间。
 *
 * ★ 为什么月/年用日历运算而不是天数乘法 ★
 *   「近一月」按 30 天算会落在 2 月时差一天，
 *   按日历减一个月再 +1 天才是用户的直觉（3-15 往前一月是 2-15）。
 *   这里统一用 Date 的月份/年份回退，再补一天含住当天。
 */
function presetRange(key) {
  const today = new Date()
  const todayKey = toDayKey(today)
  if (key === 'week') return { startDay: shiftDay(todayKey, -6), endDay: todayKey }
  if (key === 'month') return { startDay: shiftDay(todayKey, -29), endDay: todayKey }
  if (key === 'halfYear') {
    const d = new Date(today.getFullYear(), today.getMonth() - 6, today.getDate() + 1)
    return { startDay: toDayKey(d), endDay: todayKey }
  }
  if (key === 'year') {
    const d = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1)
    return { startDay: toDayKey(d), endDay: todayKey }
  }
  if (key === 'fiveYear') {
    const d = new Date(today.getFullYear() - 5, today.getMonth(), today.getDate() + 1)
    return { startDay: toDayKey(d), endDay: todayKey }
  }
  return { startDay: '', endDay: '' }
}

export default {
  name: 'DateFilterBar',
  components: { DateRangePicker },
  props: {
    /** 'period'（年月日筛选）| 'custom'（自定义筛选） */
    mode: { type: String, default: 'period' },
    /** 年月日筛选的三级选择 { year, month, day } */
    modelValue: { type: Object, default: () => ({ year: 0, month: 0, day: 0 }) },
    /** 自定义区间的开始日 YYYY-MM-DD */
    startDay: { type: String, default: '' },
    /** 自定义区间的结束日 YYYY-MM-DD */
    endDay: { type: String, default: '' }
  },
  // ★ 事件名不能与原生事件同名（change / confirm / select 都在黑名单里）★
  emits: [
    'update:mode', 'mode-change',
    'update:modelValue', 'range-change',
    'update:startDay', 'update:endDay', 'custom-change'
  ],
  setup(props, { emit }) {
    const periodRef = ref(null)
    const startCalRef = ref(null)
    const endCalRef = ref(null)

    /**
     * 最晚可选：今天 23:59:59。
     *
     * ★ 为什么掐到今天 ★
     *   未来的账还没发生，允许选未来只会让用户选出一段没数据的时间，
     *   然后误以为筛选坏了。
     */
    const maxDate = computed(() => {
      const now = new Date()
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).getTime()
    })

    /**
     * 最早可选：5 年前的 1 月 1 日。
     *
     * ★ 为什么是 5 年 ★
     *   预设里有「近五年」，min-date 必须盖得住它，
     *   否则日历打开时会被压到边界、翻不到那么早（记账面板踩过
     *   「只能选本月」那个坑，原因就是 min-date 用了组件默认的 6 个月前）。
     */
    const minDate = computed(() => new Date(new Date().getFullYear() - 5, 0, 1).getTime())

    /** 两个日历的 v-model（毫秒时间戳），和 props 里的 day 字符串互转 */
    const startValue = ref(Date.now())
    const endValue = ref(Date.now())

    /**
     * 左边下拉当前应该显示哪一项 —— 反推出来的。
     *
     * 「自定义」永远能兜住：任何不等于预设的区间都会落到它上面。
     * 用户手动改完日期，这里自然就变成「自定义」了。
     */
    const activePresetKey = computed(() => {
      if (!props.startDay || !props.endDay) return 'custom'
      for (const p of PRESETS) {
        if (p.key === 'custom') continue
        const r = presetRange(p.key)
        if (r.startDay === props.startDay && r.endDay === props.endDay) return p.key
      }
      return 'custom'
    })

    const activePresetLabel = computed(() => {
      const hit = PRESETS.find((p) => p.key === activePresetKey.value)
      return hit ? hit.label : '自定义'
    })

    const presetIndex = computed(() =>
      Math.max(0, PRESETS.findIndex((p) => p.key === activePresetKey.value))
    )

    /* ------------------------------------------------------ 交互 */

    function pickMode(next) {
      if (props.mode === next) return
      emit('update:mode', next)
      emit('mode-change', next)
    }

    function onPeriodChange(sel) {
      emit('update:modelValue', sel)
      emit('range-change', sel)
    }

    /**
     * 切换左边预设下拉。
     *
     * ★ 选「自定义」时什么都不做 ★
     *   它不是一个区间，只是「当前不是预设」的显示状态；
     *   点了就清空日期反而会把用户已经选好的区间弄丢。
     */
    function onPresetChange(e) {
      const idx = Number(e.detail.value)
      const preset = PRESETS[idx]
      if (!preset || preset.key === 'custom') return
      const r = presetRange(preset.key)
      commit(r.startDay, r.endDay)
    }

    /** 打开某个日历（'start' / 'end'） */
    function openCalendar(which) {
      const target = which === 'start' ? startCalRef.value : endCalRef.value
      const day = which === 'start' ? props.startDay : props.endDay
      /*
       * ★ 必须先把当前值喂给日历再 open ★
       *   否则打开时会停在今天，而不是用户已选的那一天，
       *   选第二遍时看着像「上次选的没记住」。
       */
      const ts = day ? parseDayKey(day).getTime() : Date.now()
      if (which === 'start') startValue.value = ts
      else endValue.value = ts
      if (target && typeof target.open === 'function') target.open()
    }

    function onStartConfirm({ value }) {
      commit(tsToDay(value), props.endDay)
    }

    function onEndConfirm({ value }) {
      commit(props.startDay, tsToDay(value))
    }

    /**
     * 提交自定义区间。
     *
     * ★ 起止颠倒在这里交换 ★
     *   用户先选结束再改开始，很容易选出「开始 > 结束」；
     *   不交换的话查询结果永远是空，看着像「这段没数据」。
     *   交换只做这一处 —— 页面那边直接采用，不重复判断。
     */
    function commit(start, end) {
      let a = start
      let b = end
      if (a && b && a > b) {
        const t = a
        a = b
        b = t
      }
      emit('update:startDay', a)
      emit('update:endDay', b)
      emit('custom-change', { startDay: a, endDay: b })
    }

    /**
     * 收起所有下拉（给页面用）
     *
     * ★ 用来干什么 ★
     *   全部交易页的「筛选」按钮弹面板前要先收日期下拉，
     *   否则悬浮的下拉面板会盖在筛选面板上面。
     *   以前页面直接调 DateRangePicker 的 collapse()，
     *   现在中间隔了一层组件，得把这个方法透传出去。
     */
    function collapse() {
      if (periodRef.value && typeof periodRef.value.collapse === 'function') {
        periodRef.value.collapse()
      }
      if (startCalRef.value && typeof startCalRef.value.close === 'function') {
        startCalRef.value.close()
      }
      if (endCalRef.value && typeof endCalRef.value.close === 'function') {
        endCalRef.value.close()
      }
    }

    return {
      PRESET_LABELS,
      CALENDAR_Z_INDEX,
      periodRef, startCalRef, endCalRef,
      startValue, endValue,
      minDate, maxDate,
      activePresetKey, activePresetLabel, presetIndex,
      pickMode, onPeriodChange, onPresetChange, openCalendar,
      onStartConfirm, onEndConfirm,
      collapse
    }
  }
}
</script>

<style scoped>
.dfb {
  position: relative;
  /*
   * 层级 5：
   *   高于下方 scroll-view（无 z-index），下拉面板才不会被内容盖住；
   *   低于库弹层（wd-popup / wd-calendar 默认 10~15），弹层打开时不会浮上去。
   */
  z-index: 5;
}

/* 筛选方式切换（年月日筛选 ｜ 自定义筛选） */
.mode-toggle {
  display: flex;
  gap: 8rpx;
  background-color: var(--app-card-2);
  border-radius: 16rpx;
  padding: 4rpx;
  margin-bottom: 12rpx;
}

.mode-tag {
  flex: 1;
  text-align: center;
  font-size: 24rpx;
  color: var(--app-text-3);
  padding: 12rpx 0;
  border-radius: 12rpx;
}

.mode-tag.active {
  background-color: var(--app-card);
  color: var(--app-text);
  font-weight: 500;
}

/*
 * 自定义筛选：一行三格「预设 ▾ ｜ 开始日期 ｜ 结束日期」
 *
 * ★ 与年月日筛选那一行逐项对齐（用户要求「做到高度一致」）★
 *   .drp-bar 的实际参数（components/DateRangePicker.vue:229-253）：
 *     background var(--app-card) / border-radius 16rpx / overflow hidden
 *     .drp-cell 高度 72rpx、flex:1、居中、gap 8rpx、border-right 1rpx 分隔
 *   这里照抄同一组数值，所以两个 tab 切来切去时高度、圆角、分隔线完全一样，
 *   下面的内容不会因为换了个 tab 就上下跳一下。
 */
.custom-row {
  display: flex;
  align-items: center;
  background-color: var(--app-card);
  border-radius: 16rpx;
  overflow: hidden;
}

.custom-preset,
.custom-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  height: 72rpx;
  padding: 0 16rpx;
}

/* 预设下拉固定宽度：它是「模式」不是「日期」，不需要和日期格平分 */
.custom-preset {
  flex: none;
  width: 168rpx;
  border-right: 1rpx solid var(--app-line);
}

.custom-cell {
  flex: 1;
  min-width: 0;
  border-right: 1rpx solid var(--app-line);
}

.custom-cell:last-child {
  border-right: none;
}

.preset-inner {
  display: flex;
  align-items: center;
  gap: 6rpx;
}

.preset-text {
  font-size: 26rpx;
  color: var(--app-text-2);
}

.preset-arrow {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.custom-value {
  font-size: 26rpx;
  color: var(--app-text-2);
}

.custom-value.placeholder {
  color: var(--app-text-3);
}
</style>
