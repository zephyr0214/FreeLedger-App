<template>
  <view class="cal-card">
    <!-- 星期头 -->
    <view class="week-head">
      <text
        v-for="(w, i) in weekNames"
        :key="w"
        class="week-name"
        :class="{ weekend: i === 0 || i === 6 }"
      >{{ w }}</text>
    </view>

    <!-- 日期网格 -->
    <view class="day-grid">
      <view
        v-for="(cell, idx) in cells"
        :key="idx"
        class="day-cell"
        :class="{
          'is-other': cell.otherMonth,
          'is-today': cell.isToday,
          'is-selected': cell.dayKey === selectedDay
        }"
        @click="onDayClick(cell)"
      >
        <view
          v-if="!cell.otherMonth"
          class="day-inner"
          :style="cell.dayData && cell.dayData.expense > 0
            ? { backgroundColor: heatColor(cell.dayData.expense) }
            : {}"
        >
          <text
            class="day-num"
            :style="{
              color: cell.isToday ? '#ffffff' : (cell.dayData && cell.dayData.expense > 0 && heatLevel(cell.dayData.expense) >= 3 ? '#ffffff' : 'var(--app-text)')
            }"
          >{{ cell.day }}</text>

          <!-- 支出额 -->
          <text
            v-if="cell.dayData && cell.dayData.expense > 0"
            class="day-amount"
            :style="{
              color: heatLevel(cell.dayData.expense) >= 3 ? 'rgba(255,255,255,0.9)' : 'var(--app-text-2)'
            }"
          >{{ formatAmount(cell.dayData.expense) }}</text>

          <!-- 收入圆点 -->
          <view
            v-if="cell.dayData && cell.dayData.income > 0"
            class="income-dot"
            :style="{ backgroundColor: heatLevel(cell.dayData.expense) >= 3 ? '#ffffff' : 'var(--app-success)' }"
          />
        </view>
      </view>
    </view>

    <!-- 图例 -->
    <view class="legend">
      <text class="legend-label">低</text>
      <view
        v-for="(lv, i) in 4"
        :key="i"
        class="legend-box"
        :style="{ backgroundColor: heatColorByLevel(i + 1) }"
      />
      <text class="legend-label">高</text>
      <view class="legend-spacer" />
      <view class="legend-item">
        <view class="legend-dot" />
        <text class="legend-label">有收入</text>
      </view>
    </view>
  </view>
</template>

<script>
import { computed } from 'vue'
import { toDayKey, parseDayKey } from '@/utils/date.js'
import { useSettingStore } from '@/stores/setting.js'

export default {
  name: 'CalendarGrid',
  props: {
    monthKey: { type: String, required: true },
    dayData: { type: Object, default: () => ({}) },
    selectedDay: { type: String, default: '' }
  },
  emits: ['day-click'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()

    const weekNames = ['日', '一', '二', '三', '四', '五', '六']

    const today = toDayKey()

    /** 计算本月所有日期格子，含前后补白 */
    const cells = computed(() => {
      const [y, m] = props.monthKey.split('-').map(Number)
      const firstDay = new Date(y, m - 1, 1)
      const totalDays = new Date(y, m, 0).getDate()
      const startWeekday = firstDay.getDay()  // 0 = 周日

      const list = []

      // 上月补白
      const prevMonthDays = new Date(y, m - 1, 0).getDate()
      for (let i = startWeekday - 1; i >= 0; i--) {
        const d = prevMonthDays - i
        list.push({
          day: d,
          dayKey: '',
          otherMonth: true,
          isToday: false,
          dayData: null
        })
      }

      // 本月
      for (let d = 1; d <= totalDays; d++) {
        const dayKey = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        list.push({
          day: d,
          dayKey,
          otherMonth: false,
          isToday: dayKey === today,
          dayData: props.dayData[dayKey] || null
        })
      }

      // 下月补白，补满整行
      const remainder = list.length % 7
      if (remainder !== 0) {
        for (let i = 1; i <= 7 - remainder; i++) {
          list.push({
            day: i,
            dayKey: '',
            otherMonth: true,
            isToday: false,
            dayData: null
          })
        }
      }

      return list
    })

    /** 当月支出的分位数阈值，用于热力分级 */
    const thresholds = computed(() => {
      const values = Object.values(props.dayData)
        .map((d) => d.expense)
        .filter((v) => v > 0)
        .sort((a, b) => a - b)

      if (values.length === 0) return [0, 0, 0, 0]

      const pick = (p) => values[Math.min(Math.floor(values.length * p), values.length - 1)]
      return [pick(0.25), pick(0.5), pick(0.75), pick(0.95)]
    })

    /** 0~4 级热力 */
    function heatLevel(amount) {
      if (!amount || amount <= 0) return 0
      const [t1, t2, t3, t4] = thresholds.value
      if (amount <= t1) return 1
      if (amount <= t2) return 2
      if (amount <= t3) return 3
      if (amount <= t4) return 4
      return 4
    }

    function heatColorByLevel(level) {
      const primary = settingStore.primaryColor
      const alpha = [0, 0.12, 0.24, 0.42, 0.62]
      return hexToRgba(primary, alpha[level] || 0.12)
    }

    function heatColor(amount) {
      return heatColorByLevel(heatLevel(amount))
    }

    function hexToRgba(hex, alpha) {
      const h = String(hex).replace('#', '')
      const full = h.length === 3
        ? h.split('').map((c) => c + c).join('')
        : h
      const r = parseInt(full.slice(0, 2), 16)
      const g = parseInt(full.slice(2, 4), 16)
      const b = parseInt(full.slice(4, 6), 16)
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }

    /** 金额缩写：12345 分 -> "123"；120000 分 -> "1.2k" */
    function formatAmount(cents) {
      const yuan = cents / 100
      if (yuan >= 10000) return `${(yuan / 10000).toFixed(1)}万`
      if (yuan >= 1000) return `${(yuan / 1000).toFixed(1)}k`
      return String(Math.round(yuan))
    }

    function onDayClick(cell) {
      if (cell.otherMonth || !cell.dayKey) return
      emit('day-click', cell.dayKey)
    }

    return {
      weekNames, cells, heatLevel, heatColor, heatColorByLevel,
      formatAmount, onDayClick
    }
  }
}
</script>

<style scoped>
.cal-card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 24rpx 20rpx;
}

.week-head {
  display: flex;
  margin-bottom: 12rpx;
}

.week-name {
  flex: 1;
  text-align: center;
  font-size: 22rpx;
  color: var(--app-text-3);
}

.week-name.weekend {
  color: var(--app-text-2);
}

.day-grid {
  display: flex;
  flex-wrap: wrap;
}

.day-cell {
  width: calc(100% / 7);
  aspect-ratio: 1;
  padding: 3rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.day-inner {
  width: 100%;
  height: 100%;
  border-radius: 12rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  gap: 2rpx;
}

.day-cell.is-today .day-inner {
  background-color: var(--app-primary) !important;
}

.day-cell.is-selected .day-inner {
  outline: 2rpx solid var(--app-primary);
  outline-offset: -2rpx;
}

.day-num {
  font-size: 24rpx;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.day-amount {
  font-size: 16rpx;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.income-dot {
  position: absolute;
  right: 6rpx;
  bottom: 6rpx;
  width: 6rpx;
  height: 6rpx;
  border-radius: 50%;
}

.legend {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 16rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid var(--app-line);
}

.legend-label {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.legend-box {
  width: 20rpx;
  height: 20rpx;
  border-radius: 4rpx;
}

.legend-spacer {
  flex: 1;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6rpx;
}

.legend-dot {
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background-color: var(--app-success);
}
</style>
