<template>
  <view class="card">
    <view class="card-head">
      <text class="card-title">{{ title }}</text>
      <view class="card-head-right">
        <!-- ★ 一级/二级分类切换：与分类统计同款，放左边 ★ -->
        <view class="seg-toggle seg-toggle--sm">
          <text
            class="seg-item"
            :class="{ active: level === 'sub' }"
            @click="pickLevel('sub')"
          >二级</text>
          <text
            class="seg-item"
            :class="{ active: level === 'root' }"
            @click="pickLevel('root')"
          >一级</text>
        </view>
        <view class="seg-toggle seg-toggle--sm">
          <text
            class="seg-item"
            :class="{ active: type === 'expense' }"
            @click="pickType('expense')"
          >支出</text>
          <text
            class="seg-item"
            :class="{ active: type === 'income' }"
            @click="pickType('income')"
          >收入</text>
        </view>
      </view>
    </view>

    <!-- 对比窗口说明：区间被今天截断时把「到今天」写清楚 -->
    <text class="cmp-range-hint">{{ rangeHint }}</text>

    <template v-if="comparison">
      <!--
        上半：两项变化并排
        ★ 为什么并排而不是上下堆 ★
          「支出变化」和「结余变化」是同一层的两个结论，
          并排后一眼能对照着看（花了更多但结余反而更多 = 收入涨得更凶）；
          上下堆会让第二项掉出首屏，用户只看到一半。
      -->
      <view class="cmp-top">
        <view class="cmp-top-item">
          <text class="cmp-top-label">{{ type === 'expense' ? '支出变化' : '收入变化' }}</text>
          <view class="cmp-top-values">
            <text class="cmp-top-pct" :style="{ color: top1.color }">{{ top1.pctText }}</text>
            <MoneyText
              :cents="top1.diff"
              variant="balance"
              :size="30"
              :weight="600"
            />
          </view>
          <text class="cmp-top-sub">{{ top1.subText }}</text>
        </view>

        <view class="cmp-top-line" />

        <view class="cmp-top-item">
          <text class="cmp-top-label">结余变化</text>
          <view class="cmp-top-values">
            <text class="cmp-top-pct" :style="{ color: balancePart.color }">{{ balancePart.pctText }}</text>
            <MoneyText
              :cents="balanceDiff"
              variant="balance"
              :size="30"
              :weight="600"
            />
          </view>
          <text class="cmp-top-sub">{{ balancePart.subText }}</text>
        </view>
      </view>

      <!-- 下半：各分类变化（一行一个分类，紧凑） -->
      <view v-if="comparison.categories.length === 0" class="card-empty">
        <text class="empty-text">这两段时间都没有可比的{{ type === 'expense' ? '支出' : '收入' }}</text>
      </view>
      <view v-else class="cmp-chart">
        <view
          v-for="c in comparison.categories"
          :key="c.id"
          class="cmp-row"
        >
          <view class="rank-dot" :style="{ backgroundColor: c.color }" />
          <text class="cmp-row-name ellipsis">{{ c.name }}</text>
          <!-- 变化金额 + 百分比同一格，右对齐，扫视时数字成列 -->
          <view class="cmp-row-num">
            <text
              class="cmp-row-diff"
              :style="{ color: diffColor(c.diff) }"
            >{{ diffText(c.diff) }}</text>
            <text
              class="cmp-row-pct"
              :style="{ color: diffColor(c.diff) }"
            >{{ percentText(c.pct, c.current) }}</text>
          </view>
          <!-- 双向柱：中线固定在中点，向右多、向左少 -->
          <view class="cmp-row-bar">
            <view class="cmp-axis" />
            <view
              v-if="c.diff !== 0"
              class="cmp-bar"
              :style="{
                width: barWidth(c.diff) + '%',
                backgroundColor: diffColor(c.diff),
                left: c.diff > 0 ? '50%' : (50 - barWidth(c.diff)) + '%'
              }"
            />
          </view>
        </view>
      </view>
    </template>

    <view v-else class="card-empty">
      <text class="empty-text">这段区间没有可对比的上一段</text>
    </view>
  </view>
</template>

<script>
/**
 * 同比 / 环比面板（同一套 UI，两个口径各用一次）
 *
 * ★ 为什么抽成组件 ★
 *   同比和环比的**数据形状完全一样**（两段总账 + 每个分类的增减），
 *   只是「对比窗口怎么算」不同（见 utils/compareRange.js 的 mode）。
 *   页面上写两份模板 = 两份「上半两项 + 下半分类行 + 双向柱」的标记，
 *   以后调一次间距就要改两处，迟早改歪一处、两个面板长得不一样。
 *   抽成组件后：UI 只有这一份，统计页传反正就好的 comparison 进来。
 *
 * ★ 组件不认识「同比 / 环比」★
 *   它只负责渲染 `comparison`，标题与窗口说明都由调用方/数据给定 ——
 *   这样以后再加「去年同月」「自定义基准」，这里一行都不用改。
 */
import { computed } from 'vue'
import MoneyText from './MoneyText.vue'
import { compareRangeLabel, percentText, percentOnly, balanceChangePercent } from '@/utils/compareRange.js'

export default {
  name: 'StatsComparePanel',
  components: { MoneyText },
  props: {
    /** 面板标题：同比变化 / 环比变化 */
    title: { type: String, default: '同比变化' },
    /**
     * getPeriodComparison() 的返回值（null = 还没加载 / 算不出对比）
     */
    comparison: { type: Object, default: null },
    /** 分类层级：'sub' 二级 / 'root' 一级 */
    level: { type: String, default: 'sub' },
    /** 收支方向：'expense' / 'income' */
    type: { type: String, default: 'expense' }
  },
  emits: ['update:level', 'update:type'],
  setup(props, { emit }) {
    function pickLevel(v) {
      if (v !== props.level) emit('update:level', v)
    }
    function pickType(v) {
      if (v !== props.type) emit('update:type', v)
    }

    /**
     * 对比窗口说明
     *
     * ★ 文案由 utils/compareRange.js 生成 ★
     *   「对比 10/01~10/08（上月同期）」这种话要跟着对齐方式变
     *   （去年同期 / 上月同期 / 等长区间），跨年时还得把年份带出来。
     */
    const rangeHint = computed(() => {
      const c = props.comparison
      if (!c) return ''
      const base = compareRangeLabel(c)
      /*
       * ★ 区间被今天截断时必须说明 ★
       *   用户选「本月」，实际比的是「11/1~11/8」，
       *   不写清楚会让人以为对比窗口算错了。
       */
      return c.clipped ? `${base}（本段到今天）` : base
    })

    /** 结余变化（正 = 比上一段更宽松） */
    const balanceDiff = computed(() => {
      const c = props.comparison
      if (!c) return 0
      return (c.current.balance || 0) - (c.previous.balance || 0)
    })

    /**
     * 上半第一项：支出 / 收入的变化
     *
     * ★ 百分比与金额都给（用户明确要求）★
     *   百分比说明「相对变化多剧烈」，金额说明「实际差多少钱」，
     *   只看一个都得自己心算。
     */
    const top1 = computed(() => {
      const c = props.comparison
      const isExp = props.type === 'expense'
      if (!c) return { diff: 0, pctText: '—', color: 'var(--app-text-3)', subText: '' }
      const cur = isExp ? c.current.expense : c.current.income
      const prev = isExp ? c.previous.expense : c.previous.income
      const diff = cur - prev
      const p = Number(prev) || 0
      const pct = p === 0 ? null : Math.round(((cur - p) / p) * 1000) / 10
      return {
        diff,
        pctText: percentText(pct, cur),
        color: diffColor(diff),
        subText: `本期 ¥${(cur / 100).toFixed(2)} · 上期 ¥${(prev / 100).toFixed(2)}`
      }
    })

    /** 上半第二项：结余变化 */
    const balancePart = computed(() => {
      const c = props.comparison
      if (!c) return { pctText: '—', color: 'var(--app-text-3)', subText: '' }
      /*
       * ★ 结余的百分比要单独算 ★
       *   结余可以是负数，用普通百分比公式时分母为负会把方向翻反
       *   （上期 -100、本期 +50 会算成 -150%，明明是变好）。
       *   所以上期结余 <= 0 时不给百分比。
       */
      const pct = balanceChangePercent(c.current.balance, c.previous.balance)
      return {
        pctText: percentOnly(pct),
        color: balanceDiff.value > 0
          ? 'var(--app-success)'
          : balanceDiff.value < 0 ? 'var(--app-danger)' : 'var(--app-text-3)',
        subText: `本期 ¥${(c.current.balance / 100).toFixed(2)} · 上期 ¥${(c.previous.balance / 100).toFixed(2)}`
      }
    })

    /**
     * 双向柱子的长度（百分比）
     *
     * ★ 为什么要除以最大值 ★
     *   各分类的金额差可能相差两个数量级（房租涨 500、奶茶涨 5），
     *   直接按金额画，小的那几根全是看不见的细线。
     *   除以最大绝对值后，长短只表达「相对变化强弱」——
     *   绝对金额已经写在每行左边了。
     */
    const maxAbs = computed(() => {
      const c = props.comparison
      if (!c || !c.categories.length) return 1
      return Math.max(1, ...c.categories.map((x) => Math.abs(x.diff)))
    })

    function barWidth(diff) {
      // 半幅最多 48%，留一点边距不让柱子顶到框
      return Math.min(48, Math.round((Math.abs(diff) / maxAbs.value) * 48))
    }

    /**
     * 颜色的方向语义
     *
     * ★ 支出与收入方向相反 ★
     *   支出变多是「坏」（红），收入变多是「好」（绿）；
     *   所以同一个 +100，支出行是红的、收入行是绿的。
     *   直接写死「正数红」会让收入面板看起来全在报警。
     */
    function diffColor(diff) {
      if (diff === 0) return 'var(--app-text-3)'
      const isExpense = props.type === 'expense'
      const good = isExpense ? diff < 0 : diff > 0
      return good ? 'var(--app-success)' : 'var(--app-danger)'
    }

    /** 变化金额文案：+¥12.00 / -¥8.50 */
    function diffText(diff) {
      const abs = Math.abs(Number(diff) || 0) / 100
      const sign = diff > 0 ? '+' : diff < 0 ? '-' : ''
      return `${sign}¥${abs.toFixed(2)}`
    }

    return {
      pickLevel, pickType,
      rangeHint, balanceDiff, top1, balancePart,
      barWidth, diffColor, diffText, percentText
    }
  }
}
</script>

<style scoped>
/* 对比窗口说明（区间被今天截断时也写清楚） */
.cmp-range-hint {
  font-size: 22rpx;
  color: var(--app-text-3);
  display: block;
  padding-bottom: 16rpx;
}

/*
 * 上半：两项并排
 * ★ 为什么并排而不是上下堆 ★
 *   两个结论是同一层的，并排能一眼对照；上下堆会让第二项掉出首屏。
 */
.cmp-top {
  display: flex;
  align-items: stretch;
  padding: 8rpx 0 20rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.cmp-top-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  min-width: 0;
}

/* 中间竖分隔：和「不计入预算 ｜ 待报销」同一套视觉语言 */
.cmp-top-line {
  width: 1rpx;
  background-color: var(--app-line);
  margin: 4rpx 20rpx;
  flex-shrink: 0;
}

.cmp-top-label {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.cmp-top-values {
  display: flex;
  align-items: baseline;
  gap: 10rpx;
  flex-wrap: wrap;
}

/* 百分比跟在金额旁边，字号小一号但同色 —— 两者是一件事的两种说法 */
.cmp-top-pct {
  font-size: 26rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* 本期 / 上期的绝对值：小字，回答「从多少变到多少」 */
.cmp-top-sub {
  font-size: 20rpx;
  color: var(--app-text-3);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 下半：每个分类一行（用户要求「紧凑」）
 *
 * ★ 一行装下四样东西 ★
 *   色点 + 分类名 + （变化金额 / 百分比）+ 双向柱。
 *   原来名称和金额一行、柱子另起一行，几个分类就要占双倍行数。
 */
.cmp-chart {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  margin-top: 20rpx;
}

.cmp-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  min-width: 0;
}

.cmp-row-name {
  font-size: 24rpx;
  color: var(--app-text-2);
  /*
   * ★ 固定宽度而不是 flex:1 ★
   *   让所有行的「金额 + 百分比」落在同一列上，扫视时数字成列；
   *   flex:1 会让长名字那一行把数字挤到右边、短的又缩回来，参差不齐。
   */
  width: 180rpx;
  flex-shrink: 0;
}

/* 变化金额 + 百分比：右对齐成两列数字 */
.cmp-row-num {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 10rpx;
  width: 200rpx;
  flex-shrink: 0;
}

.cmp-row-diff {
  font-size: 24rpx;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.cmp-row-pct {
  font-size: 20rpx;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}

/*
 * 柱状槽：高 14rpx，中线在 50%
 * 柱子用绝对定位往左/往右长，正数向右、负数向左。
 */
.cmp-row-bar {
  position: relative;
  flex: 1;
  min-width: 100rpx;
  height: 14rpx;
  background-color: var(--app-card-2);
  border-radius: 7rpx;
  overflow: hidden;
}

.cmp-axis {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1rpx;
  background-color: var(--app-line);
}

.cmp-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 7rpx;
}

/* ---- 以下三个类名来自统计页的通用卡片样式，组件内需要自己复制一份 ---- */

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

.card-head-right {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;
}

.card-title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--app-text);
}

.card-empty {
  padding: 32rpx 0;
  text-align: center;
}

.empty-text {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.rank-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  flex-shrink: 0;
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 分段切换（一级/二级、支出/收入）
 * ★ 全局 .seg-toggle 定义在 App.vue，scoped 样式拿不到 ★
 *   这里补一份最小实现，保证组件独立可用时不塌。
 */
.seg-toggle {
  display: flex;
  align-items: center;
  background-color: var(--app-card-2);
  border-radius: 12rpx;
  padding: 3rpx;
}

.seg-toggle--sm .seg-item {
  font-size: 20rpx;
  padding: 4rpx 12rpx;
  border-radius: 9rpx;
}

.seg-item {
  color: var(--app-text-2);
  line-height: 1.4;
}

.seg-item.active {
  background-color: var(--app-card);
  color: var(--app-text);
  font-weight: 500;
}
</style>
