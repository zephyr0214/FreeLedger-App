<template>
  <view class="drp">
    <!-- 三个下拉框：年 / 月 / 日 -->
    <view class="drp-bar">
      <view
        v-for="col in cols"
        :key="col.key"
        class="drp-cell"
        :class="{ 'is-open': activeKey === col.key }"
        @click="toggle(col.key)"
      >
        <text class="drp-cell-label">{{ col.label }}</text>
        <text class="drp-cell-arrow">▾</text>
      </view>
    </view>

    <!-- 点击空白处收起 -->
    <view v-if="activeKey" class="drp-mask" @click="close" @touchmove.stop />

    <!-- 下拉面板：列出当前列的所有选项 -->
    <view v-if="activeKey" class="drp-panel">
      <scroll-view class="drp-panel-scroll" scroll-y>
        <view
          v-for="opt in activeOptions"
          :key="String(opt.value)"
          class="drp-opt"
          :class="{ 'is-active': opt.value === activeValue }"
          @click="pick(opt)"
        >
          <text class="drp-opt-label">{{ opt.label }}</text>
          <text v-if="opt.value === activeValue" class="drp-opt-check">✓</text>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script>
import { ref, reactive, computed, watch } from 'vue'
import { cascadeSelection } from '@/utils/date.js'

/**
 * 年 / 月 / 日 三级联动下拉选择器
 *
 * 三个下拉框横向排开，点哪个哪个展开，选项列表在下方。
 * 每列第 0 项都是「全部」：
 *   年列 → 全部年（不限时间）
 *   月列 → 全部月（整年）
 *   日列 → 全部日（整月）
 *
 * 层级语义（0 表示「全部」）：
 *   year=0                 → 全部年：不限时间
 *   year>0, month=0        → 全部月：整年
 *   year>0, month>0, day=0 → 全部日：整月
 *   year>0, month>0, day>0 → 具体某一天
 */
export default {
  name: 'DateRangePicker',
  props: {
    /** { year, month, day }，0 表示「全部」 */
    modelValue: { type: Object, default: null }
  },
  // 注意：事件名不能与原生事件同名（change / confirm / close 都在黑名单里）
  emits: ['update:modelValue', 'range-change'],
  setup(props, { emit }) {
    /** 本地编辑态 */
    const local = reactive({ year: 0, month: 0, day: 0 })

    /** 当前展开的下拉框：'' | 'year' | 'month' | 'day' */
    const activeKey = ref('')

    /* ------------------------------------------------- 层级约束 */

    /** 当前选中的月有几号（未选到具体年月时为 0） */
    const maxDay = computed(() => {
      const y = local.year
      const m = local.month
      if (!y || !m) return 0
      return new Date(y, m, 0).getDate()
    })

    /* ------------------------------------------------- 各列选项 */

    /** 年列：全部年 + 近 6 年到今年 */
    const yearOptions = computed(() => {
      const now = new Date().getFullYear()
      const list = [{ value: 0, label: '全部年' }]
      for (let y = now; y >= now - 5; y--) list.push({ value: y, label: `${y}年` })
      return list
    })

    /** 月列：全部月 + 1~12 */
    const monthOptions = computed(() => {
      const list = [{ value: 0, label: '全部月' }]
      for (let m = 1; m <= 12; m++) list.push({ value: m, label: `${m}月` })
      return list
    })

    /**
     * 日列：全部日 + 当月所有日期
     * 未选到具体年月时跨月/跨年没有「某一天」的意义，只留「全部日」。
     */
    const dayOptions = computed(() => {
      const list = [{ value: 0, label: '全部日' }]
      const last = maxDay.value
      for (let d = 1; d <= last; d++) list.push({ value: d, label: `${d}日` })
      return list
    })

    /* ------------------------------------------------- 展示 */

    /** 三个下拉框的标题 */
    const cols = computed(() => [
      { key: 'year', label: local.year ? `${local.year}年` : '全部年' },
      { key: 'month', label: local.month ? `${local.month}月` : '全部月' },
      { key: 'day', label: local.day ? `${local.day}日` : '全部日' }
    ])

    /** 当前展开列的选项 */
    const activeOptions = computed(() => {
      if (activeKey.value === 'year') return yearOptions.value
      if (activeKey.value === 'month') return monthOptions.value
      if (activeKey.value === 'day') return dayOptions.value
      return []
    })

    /** 当前展开列的选中值 */
    const activeValue = computed(() => {
      if (activeKey.value === 'year') return local.year
      if (activeKey.value === 'month') return local.month
      if (activeKey.value === 'day') return local.day
      return 0
    })

    /* ------------------------------------------------- 交互 */

    function toggle(key) {
      activeKey.value = activeKey.value === key ? '' : key
    }

    function close() {
      activeKey.value = ''
    }

    /** 选中一项：更新本地态 + 级联修正其它列 + 通知父组件 */
    function pick(opt) {
      const v = Number(opt.value) || 0

      // 级联修正规则统一放在 utils/date.js 的 cascadeSelection 里
      const next = cascadeSelection({
        year: activeKey.value === 'year' ? v : local.year,
        month: activeKey.value === 'month' ? v : local.month,
        day: activeKey.value === 'day' ? v : local.day
      }, activeKey.value)

      local.year = next.year
      local.month = next.month
      local.day = next.day

      close()
      syncOut()
    }

    /** 把本地选择同步到父组件 */
    function syncOut() {
      const value = {
        year: local.year,
        month: local.month,
        day: local.day
      }
      emit('update:modelValue', value)
      emit('range-change', value)
    }

    /* ------------------------------------------------- 外部同步 */

    watch(
      () => props.modelValue,
      (v) => {
        if (!v) return
        const next = cascadeSelection({
          year: Number(v.year) || 0,
          month: Number(v.month) || 0,
          day: Number(v.day) || 0
        }, 'day')
        local.year = next.year
        local.month = next.month
        local.day = next.day
      },
      { immediate: true, deep: true }
    )

    /**
     * 收起下拉（不改变选中值）
     * 父组件在打开其它弹层时调用，避免下拉面板和遮罩留在屏幕上
     */
    function collapse() {
      activeKey.value = ''
    }

    return {
      local, activeKey, cols, activeOptions, activeValue,
      toggle, close, collapse, pick
    }
  }
}
</script>

<style scoped>
.drp {
  position: relative;
  /*
   * 组件整体的层级。
   *
   * ★ 必须在库弹层之下 ★
   *   wot-design-uni 的弹层默认层级：
   *     wd-popup / wd-action-sheet = 10
   *     wd-calendar / wd-datetime-picker = 15
   *   这里用 5，保证「筛选面板」这类弹层打开时，
   *   下拉面板和遮罩不会浮到弹层上面去。
   *
   *   同时它要高于页面里的 scroll-view（无 z-index，等同 auto），
   *   5 刚好卡在中间。
   */
  z-index: 5;
}

/* 三个下拉框 */
.drp-bar {
  position: relative;
  /* 高于遮罩：展开时仍能点到别的列切换 */
  z-index: 3;
  display: flex;
  align-items: center;
  background-color: var(--app-card);
  border-radius: 16rpx;
  overflow: hidden;
}

.drp-cell {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  height: 72rpx;
  border-right: 1rpx solid var(--app-line);
}

.drp-cell:last-child {
  border-right: none;
}

.drp-cell-label {
  font-size: 26rpx;
  color: var(--app-text-2);
}

.drp-cell-arrow {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.drp-cell.is-open .drp-cell-label {
  color: var(--app-primary);
  font-weight: 600;
}

.drp-cell.is-open .drp-cell-arrow {
  color: var(--app-primary);
}

/* 遮罩：盖住下方内容，点它收起 */
.drp-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 1;
}

/* 下拉面板：贴在下拉框下方 */
.drp-panel {
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  z-index: 2;
  margin-top: 8rpx;
  background-color: var(--app-card);
  border-radius: 16rpx;
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.drp-panel-scroll {
  max-height: 520rpx;
}

.drp-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22rpx 28rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.drp-opt:last-child {
  border-bottom: none;
}

.drp-opt-label {
  font-size: 27rpx;
  color: var(--app-text);
}

.drp-opt.is-active .drp-opt-label {
  color: var(--app-primary);
  font-weight: 600;
}

.drp-opt-check {
  font-size: 26rpx;
  color: var(--app-primary);
}
</style>
