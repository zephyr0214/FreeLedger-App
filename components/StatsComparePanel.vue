<template>
  <view class="card">
    <!--
      ★ 标题 + 对比说明同一行（本轮用户第 9b 条）★
        用户原话「「对比...」后面的两个括号及其内容删除，保持现有字号
        显示在同比变化和环比变化之后，同行」。
        所以「对比 10/01~10/08」跟在标题后面、同字号同色，不再单独占一行。
    -->
    <view class="card-head">
      <view class="card-head-left">
        <text class="card-title">{{ title }}</text>
        <text class="cmp-range-hint">{{ rangeHint }}</text>
      </view>
      <view class="card-head-right">
        <!-- ★ 一级/二级切换：一级在前、默认选中一级（本轮第 11 条）★ -->
        <view class="seg-toggle seg-toggle--sm">
          <text
            class="seg-item"
            :class="{ active: level === 'root' }"
            @click="pickLevel('root')"
          >一级</text>
          <text
            class="seg-item"
            :class="{ active: level === 'sub' }"
            @click="pickLevel('sub')"
          >二级</text>
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

    <template v-if="comparison">
      <!--
        上半：两项变化并排
        ★ 为什么并排而不是上下堆 ★
          「支出变化」和「结余变化」是同一层的两个结论，
          并排后一眼能对照着看（花了更多但结余反而更多 = 收入涨得更凶）；
          上下堆会让第二项掉出首屏，用户只看到一半。
      -->
      <!--
        上半两项（本轮用户第 9c 条）
        ★ 不显示正负号，改用上下箭头 ★
          带符号的 -1234.00 要先看符号再看数，箭头一眼就知道方向。
        ★ 百分比字号大、金额字号小 ★
          百分比是「变化多剧烈」的结论，金额是补充证据。
        ★ 本期 / 上期分两行 ★
          金额不带符号、不带颜色语义：又带箭头又带正负号会重复表达。
      -->
      <view class="cmp-top">
        <view class="cmp-top-item">
          <text class="cmp-top-label">{{ type === 'expense' ? '支出变化' : '收入变化' }}</text>
          <!-- ★ 箭头在前、数字在后（用户本轮第 3 条）★ -->
          <view class="cmp-top-main">
            <text v-if="top1.arrow" class="cmp-top-arrow" :style="{ color: top1.color }">{{ top1.arrow }}</text>
            <text class="cmp-top-pct" :style="{ color: top1.color }">{{ top1.pctText }}</text>
          </view>
          <view class="cmp-top-amounts">
            <text class="cmp-top-amount">本期 ¥{{ top1.curText }}</text>
            <text class="cmp-top-amount">上期 ¥{{ top1.prevText }}</text>
          </view>
        </view>

        <view class="cmp-top-line" />

        <view class="cmp-top-item">
          <text class="cmp-top-label">结余变化</text>
          <view class="cmp-top-main">
            <text v-if="balancePart.arrow" class="cmp-top-arrow" :style="{ color: balancePart.color }">{{ balancePart.arrow }}</text>
            <text class="cmp-top-pct" :style="{ color: balancePart.color }">{{ balancePart.pctText }}</text>
          </view>
          <view class="cmp-top-amounts">
            <text class="cmp-top-amount">本期 ¥{{ balancePart.curText }}</text>
            <text class="cmp-top-amount">上期 ¥{{ balancePart.prevText }}</text>
          </view>
        </view>
      </view>

      <!--
        下半：每个分类一行（本轮用户第 9d 条）
        ★ 金额 / 百分比 / 柱状图左边缘都要对齐 ★
          三列都用固定宽度 + 左对齐，不再按内容长度各自浮动。
        ★ 柱状图宽度缩短 ★
          原来柱子 flex:1 吃掉剩余全部宽度，窄屏上数字被挤没；
          现在给一个固定上限宽度。
      -->
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
          <text
            class="cmp-row-diff"
            :style="{ color: diffColor(c.diff) }"
          >{{ diffText(c.diff) }}</text>
          <text
            class="cmp-row-pct"
            :style="{ color: diffColor(c.diff) }"
          >{{ percentText(c.pct, c.current) }}</text>
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
    level: { type: String, default: 'root' },
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
      if (!c) {
        return { diff: 0, pctText: '—', arrow: '', color: 'var(--app-text-3)', curText: '0.00', prevText: '0.00' }
      }
      const cur = isExp ? c.current.expense : c.current.income
      const prev = isExp ? c.previous.expense : c.previous.income
      const diff = cur - prev
      const p = Number(prev) || 0
      const pct = p === 0 ? null : Math.round(((cur - p) / p) * 1000) / 10
      return {
        diff,
        pctText: percentText(pct, cur),
        /*
         * ★ 用箭头代替正负号（用户第 9c 条）★
         *   上升 ↑ / 下降 ↓ / 持平—。与百分比同色，
         *   因为它们表达的是同一件事（方向 + 幅度）。
         */
        /*
         * ★ 「新增」不显示箭头（用户本轮第 3 条）★
         *   上期为 0、本期有数 → 百分比算不出来，文案是「新增」。
         *   这时候给一个 ↑ 是错的：从 0 到有 不是「上涨多少%」，
         *   只是「上期没有这一项」。
         */
        arrow: (pct === null) ? '' : (diff > 0 ? '↑' : diff < 0 ? '↓' : '—'),
        color: diffColor(diff),
        curText: (cur / 100).toFixed(2),
        prevText: (prev / 100).toFixed(2)
      }
    })

    /** 上半第二项：结余变化 */
    const balancePart = computed(() => {
      const c = props.comparison
      if (!c) {
        return { pctText: '—', arrow: '', color: 'var(--app-text-3)', curText: '0.00', prevText: '0.00' }
      }
      /*
       * ★ 结余的百分比要单独算 ★
       *   结余可以是负数，用普通百分比公式时分母为负会把方向翻反
       *   （上期 -100、本期 +50 会算成 -150%，明明是变好）。
       *   所以上期结余 <= 0 时不给百分比。
       */
      const pct = balanceChangePercent(c.current.balance, c.previous.balance)
      return {
        pctText: percentOnly(pct),
        arrow: balanceDiff.value > 0 ? '↑' : balanceDiff.value < 0 ? '↓' : '—',
        color: balanceDiff.value > 0
          ? 'var(--app-success)'
          : balanceDiff.value < 0 ? 'var(--app-danger)' : 'var(--app-text-3)',
        curText: (c.current.balance / 100).toFixed(2),
        prevText: (c.previous.balance / 100).toFixed(2)
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
/*
 * 对比窗口说明：跟在标题后面、同行、**小字号灰色**（用户本轮第 3 条）
 *
 * ★ 为什么要小字号灰色 ★
 *   它只是「这两个数是哪两段时间」的注解，
 *   和标题同级的黑字会让用户以为它也是一个标题。
 */
.cmp-range-hint {
  font-size: 20rpx;
  font-weight: 400;
  color: var(--app-text-3);
  margin-left: 10rpx;
}

/*
 * 上半：两项并排
 * ★ 为什么并排而不是上下堆 ★
 *   两个结论是同一层的，并排能一眼对照；上下堆会让第二项掉出首屏。
 */
.cmp-top {
  display: flex;
  align-items: stretch;
  padding: 12rpx 0 24rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.cmp-top-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
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

/* 百分比 + 箭头：字号大（用户要求「比例字号要大」） */
.cmp-top-main {
  display: flex;
  align-items: baseline;
  gap: 6rpx;
}

.cmp-top-pct {
  font-size: 40rpx;
  font-weight: 600;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}

.cmp-top-arrow {
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1;
}

/* 本期 / 上期：两行小字（用户要求「金额字号要小」） */
.cmp-top-amounts {
  display: flex;
  flex-direction: column;
  gap: 2rpx;
}

.cmp-top-amount {
  font-size: 20rpx;
  color: var(--app-text-3);
  font-variant-numeric: tabular-nums;
}

/*
 * 下半：每个分类一行（用户要求「紧凑」）
 *
 * ★ 四列都左对齐、固定宽度 ★
 *   用户原话「不同行的金额和百分比、柱状图左侧都左对齐」。
 *   固定宽度才能让每一行的同一列落在同一个 x 坐标上；
 *   用 flex 自适应的话，长名字那行会把后面三列往右挤。
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
  gap: 10rpx;
  min-width: 0;
}

/* 分类名：超长省略（已有 .ellipsis），宽度固定 */
.cmp-row-name {
  font-size: 24rpx;
  color: var(--app-text-2);
  width: 170rpx;
  flex-shrink: 0;
}

/* 变化金额：左对齐、固定宽，让每行的数字成列 */
.cmp-row-diff {
  font-size: 24rpx;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  width: 130rpx;
  flex-shrink: 0;
}

/* 百分比：左对齐、固定宽 */
.cmp-row-pct {
  font-size: 22rpx;
  font-variant-numeric: tabular-nums;
  width: 110rpx;
  flex-shrink: 0;
}

/*
 * 柱状槽：宽度缩短（用户第 9d 条）
 *   原来 flex:1 吃掉剩余全部宽度，窄屏上数字被挤没。
 *   现在给一个固定上限宽度，对齐右侧但不再拉满。
 */
.cmp-row-bar {
  position: relative;
  width: 180rpx;
  flex-shrink: 0;
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

/* 左侧：标题 + 对比说明同行，长度不够时自己缩（不挤右侧切换器） */
.card-head-left {
  display: flex;
  align-items: baseline;
  min-width: 0;
  flex: 1;
  overflow: hidden;
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
