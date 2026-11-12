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
        <!--
          ★ 色块缩小到只包住日期数字，金额在色块下方（用户本轮反馈）★

          ★ 用户两条反馈合起来才是完整需求 ★
            1. 「月历上的主题色遮挡了，任何绿色的收入支出就不太显眼了。
               我想让它只包括日期的数字，不要包括下面的收入支出数字」
               → 意思是**色块只包日期**，不是把金额删掉。
            2. 「我指的是月历上的那个色块缩小，只包含那个日期数字，
               没说让你把我的手指给去掉！」
               → 金额必须加回来，只是不能再在色块里面。

          ★ 现在的结构 ★
            .day-cell（整个方格，保证 7 列对齐、点击热区大）
              ├─ .day-inner（小圆块，**只包日期数字**，热力/今天/选中三种底色都只染这里）
              ├─ .day-amount.day-expense（支出，红色）
              └─ .day-amount.day-income（收入，绿色）

            彩色面积只剩小圆块，主题色不再“遮挡”整个日期；
            金额写在白（黑）底上，红/绿对比度恢复正常。
        -->
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
        </view>

        <!--
          ★ 两个金额槽位永远渲染，无值时留空占位（用户本轮第 2 条）★

          ★ 用户原话 ★
            「现在下面加一条金额和加两条金额时，
            色块的横向包括金额的横向都不对齐。
            在没有收入、没有支出或者收支都没有的时候，
            你添加一点占位符，让它的高度保持一致」。

          ★ 为什么之前不对齐 ★
            旧写法是 v-if ：没支出就不渲染那一行。
            而 .day-cell 是 justify-content: center，
            所以「日期 + 1 行金额」会比「日期 + 2 行金额」整体偏下一点 ——
            于是相邻日期的色块不在同一水平线上，看着就是一排参差不齐的圆点。
            现在两个槽位始终存在（隐藏而不删除），
            格子内容总高度恒定 → 色块始终在同一水平线上。

          ★ 为什么用 visibility 而不是空字符串 ★
            空字符串在 uni-app 的 <text> 里高度会塔陷为 0（没有字符就没有行盒），
            占位失效。用 visibility: hidden 保留它的盒子尺寸。
            （display: none 也不行——那就是变回不占位了）。
        -->
        <text
          class="day-amount day-expense"
          :class="{ 'is-blank': !(cell.dayData && cell.dayData.expense > 0) }"
          :style="{ color: expenseColor() }"
        >{{ cell.dayData && cell.dayData.expense > 0 ? '-' + formatAmount(cell.dayData.expense) : '' }}</text>

        <text
          class="day-amount day-income"
          :class="{ 'is-blank': !(cell.dayData && cell.dayData.income > 0) }"
          :style="{ color: incomeColor() }"
        >{{ cell.dayData && cell.dayData.income > 0 ? '+' + formatAmount(cell.dayData.income) : '' }}</text>
      </view>
    </view>

    <!-- 图例 -->
    <view class="legend">
      <text class="legend-label">支出少</text>
      <view
        v-for="(lv, i) in 4"
        :key="i"
        class="legend-box"
        :style="{ backgroundColor: heatColorByLevel(i + 1) }"
      />
      <text class="legend-label">多</text>
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

    /**
     * 金额格式化：精确到小数点后两位。
     * 整数元不显示小数位（省空间），有零头时显示两位。
     *   1200 分 -> "12"      1234 分 -> "12.34"
     *
     * ★ 为什么不走 formatWanYuan（本轮大额衷算那个）★
     *   月历格子宽度只有约 100rpx（屏幕宽 / 7），
     *   「123.46W」比「123.46」多一个字符就会溢出。
     *   而且月历本身是「看趋势」的地方：
     *   色块深浅 + 两位小数已经够看出量级，更大额点进去看列表。
     */
    function formatAmount(cents) {
      const yuan = Number(cents || 0) / 100
      if (Number.isInteger(yuan)) return String(yuan)
      return yuan.toFixed(2)
    }

    /**
     * 支出金额的颜色：支出红（恢复原来的颜色）
     *
     * ★ 用户最新指示 ★
     *   「月历的那个支出还是恢复原来的颜色吧」。
     *
     * ★ 中间经历了一次改动 ★
     *   上一版按「支出浅色黑 / 深色白」改成了 var(--app-text)，
     *   理由是「一个小格子里同时出现主题绿 + 收入绿 + 支出红」。
     *   但用户看过之后要求改回来——
     *   说明「支出就该是红的」这个直觉比「少一种颜色」更重要，
     *   而且红绿对比本身就是记账 App 最熟悉的语言。
     *
     * ★ 为什么不能写死具体红色值 ★
     *   一旦写死 #D9363E 这类值，就会和首页/统计页/详情页的红不同——
     *   历史上真出过「两种红」。所以始终取 --app-danger，
     *   与全 App 其他地方的支出红严格同值，浅深色自动跟着主题走。
     */
    function expenseColor() {
      return 'var(--app-danger)'
    }

    /**
     * 收入金额的颜色。
     *
     * 同理：始终取 --app-success，不按档位换色，
     * 与全 App 其它地方的绿严格同值。
     */
    function incomeColor() {
      return 'var(--app-success)'
    }

    function onDayClick(cell) {
      if (cell.otherMonth || !cell.dayKey) return
      emit('day-click', cell.dayKey)
    }

    return {
      weekNames, cells, heatLevel, heatColor, heatColorByLevel,
      formatAmount, expenseColor, incomeColor, onDayClick
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
  /*
   * ★ 竖向排列：圆块在上、金额在下（用户本轮反馈）★
   *   之前是横向「居中放一个子元素」——
   *   那是因为当时格子里只有一个 .day-inner。
   *   现在 .day-inner 后面还跟着支出/收入两行金额，
   *   必须改成竖向列，否则三个元素会横着挤成一排。
   */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/*
 * ★ 色块缩小到只包住日期数字（用户本轮第 2 条）★
 *
 * ★ 用户原话 ★
 *   「我指的是月历上的那个色块缩小，只包含那个日期数字，
 *   没说让你把我的手指给去掉！」
 *   还有一句：「月历上我的收支没加回来啊」。
 *
 * ★ 上一版为什么错了 ★
 *   用户要的是「色块变小」，我却把**金额**整行删了。
 *   他要的是「色块只包日期」，不是「月历不要金额」。
 *
 * ★ 正确做法 ★
 *   外层 .day-cell 仍然是完整方格（7 列对齐、点击热区大、放得下三行），
 *   内层 .day-inner 只占中间一个小圆块。
 *   热力度 / 今天 / 选中 三种底色全部只染在圆块上，
 *   金额写在圆块下方的白（黑）底上——
 *   彩色面积只剩个小圆，红/绿金额对比度恢复正常。
 *
 * ★ 为什么圆块只有 44rpx ★
 *   格子宽度 = 屏幕宽 / 7 ≈ 100rpx。
 *   下面还要放两行 16rpx 的金额（支出 + 收入），
 *   圆块太大就会把金额顶出格子。
 *   44 + 16 + 16 ≈ 76rpx，留余量给行高和 padding。
 */
.day-inner {
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  /*
   * ★ 色块与下方金额之间留一丝距离（用户本轮第 1 条）★
   *   用户原话：「这个月历上这个色块和下面的收支金额
   *   相隔得太近了，你稍微空一丝丝的距离」。
   *
   *   为什么放在 .day-inner 而不是 .day-amount 上 ★
   *     .day-amount 有两个（支出 + 收入），写在金额上就变成
   *     两段间距（圈→支出、支出→收入），后一段是多余的。
   *     写在圈上只推开第一行，两行金额之间保持紧凑。
   */
  margin-bottom: 4rpx;
}

.day-cell.is-today .day-inner {
  background-color: var(--app-primary) !important;
}

.day-cell.is-selected .day-inner {
  outline: 2rpx solid var(--app-primary);
  outline-offset: -2rpx;
}

.day-num {
  /*
   * 字号从 24rpx 收到 22rpx：圆块直径 44rpx，
   * 双位日期（28/30/31）在 24rpx 时会撞到圆边。
   */
  font-size: 22rpx;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

/*
 * 金额行（用户要求加回来）
 *
 * ★ 字号 16rpx 是历史值，不要随便改 ★
 *   格子宽度只有 ~100rpx，「-123.45」在 16rpx 下刚好放得下；
 *   再大一号就会被裁切成「-123.4」，金额看错可不行。
 *
 * ★ 定高 + 居中 —— 解决「横向对不齐」（用户本轮第 2 条）★
 *   height: 20rpx  —— 保证无金额时槽位也占同样高度；
 *   width: 100%    —— 让每行都是多宽，
 *   text-align: center —— 短金额（如 -5）也与色块水平居中对齐。
 *
 *   旧写法是 max-width: 100% + 默认左对齐：
 *   宽度随内容收缩，容器是 center 对齐时看着没事，
 *   但一旦金额超过格子宽度就从左边开始裁切，
 *   看上去就是「往右偏了」。
 */
.day-amount {
  font-size: 16rpx;
  height: 20rpx;
  line-height: 20rpx;
  width: 100%;
  text-align: center;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.6rpx;
  overflow: hidden;
  white-space: nowrap;
}

/*
 * 空槽位：保留盒子尺寸，不显示内容
 *
 * ★ 为什么不能用 opacity: 0 ★
 *   opacity 在部分小程序渲染层里会发生合成层优化，
 *   而 visibility 是标准的「占位但不画」，一直很稳。
 */
.day-amount.is-blank {
  visibility: hidden;
}

/* 支出在上 */
.day-expense {
  font-weight: 500;
}

/* 收入在下 */
.day-income {
  font-weight: 600;
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
</style>
