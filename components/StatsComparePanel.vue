<template>
  <view class="card">
    <!--
      ★ 「对比 xx/xx~xx/xx」改到标题下方（用户本轮）★
        用户原话「把同比和环比中的对比xx-xx移动到环比变化/同比变化下方」。
        之前它跟在标题同行，但标题右侧还挤着两组切换器，
        屏宽一窄「对比 10/01~10/08」就被截断；
        它本身又只是标题的注解，放到标题正下方最自然。
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
          <!--
            ★ 上方两个大的变化居中（用户本轮第 2 条）★
              用户原话「上方两个大的变化居中显示」。
              箭头前置、百分比大字号，整块水平居中。
          -->
          <view class="cmp-top-main">
            <text v-if="top1.arrow" class="cmp-top-arrow" :style="{ color: top1.color }">{{ top1.arrow }}</text>
            <text class="cmp-top-pct" :style="{ color: top1.color }">{{ top1.pctText }}</text>
          </view>
          <!-- ★ 本期 / 上期左右对齐（像恩格尔那样：标签左、金额右）★ -->
          <view class="cmp-top-amounts">
            <view class="cmp-top-amount-row">
              <text class="cmp-top-amount-label">本期</text>
              <text class="cmp-top-amount-value">¥{{ top1.curText }}</text>
            </view>
            <view class="cmp-top-amount-row">
              <text class="cmp-top-amount-label">上期</text>
              <text class="cmp-top-amount-value">¥{{ top1.prevText }}</text>
            </view>
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
            <view class="cmp-top-amount-row">
              <text class="cmp-top-amount-label">本期</text>
              <text class="cmp-top-amount-value">¥{{ balancePart.curText }}</text>
            </view>
            <view class="cmp-top-amount-row">
              <text class="cmp-top-amount-label">上期</text>
              <text class="cmp-top-amount-value">¥{{ balancePart.prevText }}</text>
            </view>
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
          <!--
            ★ 金额也不显示正负号，改用上下箭头（用户本轮第 2 条）★
              箭头 + 绝对值，比「+¥12.00 / -¥8.50」少一个符号、多一个方向。
          -->
          <view class="cmp-row-num">
            <text v-if="arrowOf(c.diff)" class="cmp-row-arrow" :style="{ color: diffColor(c.diff) }">{{ arrowOf(c.diff) }}</text>
            <text
              class="cmp-row-diff"
              :style="{ color: diffColor(c.diff) }"
            >{{ absDiffText(c.diff) }}</text>
            <!--
              ★ 百分比前面也要箭头（用户本轮第 1 条）★
                两个数各自带一个箭头：金额和百分比是两个独立的量，
                只给金额配箭头时，百分比那一列看上去是「无方向」的。
            -->
            <!--
              ★ 上期为 0 也给箭头（用户本轮）★
                之前这种情况显示「新增」且不给箭头；
                现在改成正常显示「100%」，那就必须有箭头指方向。
            -->
            <text
              v-if="arrowOfPct(c)"
              class="cmp-row-arrow cmp-row-arrow-pct"
              :style="{ color: diffColor(c.diff) }"
            >{{ arrowOfPct(c) }}</text>
            <text
              class="cmp-row-pct"
              :style="{ color: diffColor(c.diff) }"
            >{{ absPercentText(c.pct, c.current) }}</text>
          </view>
          <!-- 双向柱：中线固定在中点，向右多、向左少 -->
          <view class="cmp-row-bar">
            <view class="cmp-axis" />
            <view
              v-if="c.diff !== 0"
              class="cmp-bar"
              :style="{
                width: barWidth(c) + '%',
                backgroundColor: diffColor(c.diff),
                left: c.diff > 0 ? '50%' : (50 - barWidth(c)) + '%'
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
import { compareRangeLabel, balanceChangePercent } from '@/utils/compareRange.js'

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
       * ★ 不再追加「（本段到今天）」（用户本轮第 2 条）★
       *   用户原话「同比环比不要显示（本段到今天）这种东西」。
       *   「对比 10/01~10/08」已经把话说清了；
       *   再挂一个括号说明只会把标题行撞得更长。
       */
      return base
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
        /*
         * ★ 百分比不带正负号（用户本轮要求）★
         *   用户原话：「四个大的变化率的值还是箭头和符号共存的，
         *   我要的是只保留箭头，不显示 +- 号」。
         *
         *   之前用 percentText()，它返回的是 '+12.3%' / '-8%'——
         *   前面已经有一个 ↑/↓ 箭头了，再带一个正负号就是
         *   同一件事说两遍（↑+12.3% / ↓-8%），看起来很乱。
         *   用 absPercentText 只给绝对值：↑ 12.3% / ↓ 8%。
         */
        pctText: absPercentText(pct, cur),
        /*
         * ★ 用箭头代替正负号（用户第 9c 条）★
         *   上升 ↑ / 下降 ↓ / 持平—。与百分比同色，
         *   因为它们表达的是同一件事（方向 + 幅度）。
         */
        /*
         * ★ 上期为 0 也要箭头（用户本轮）★
         *   上期为 0、本期有数时，百分比已经显示为「100%」，
         *   配一个 ↑ 才能读成「从 0 涨到有」。
         *   持平时不画破折号（会和数字挤在一起像负号）。
         */
        arrow: diff > 0 ? '↑' : diff < 0 ? '↓' : '',
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
        /*
         * ★ 结余也一样：只给绝对值百分比，方向交给箭头 ★
         *   这里不能用 absPercentText：它在 pct 为 null 时返回 '100%'，
         *   那是「上期为 0」的语义；而结余的 null 是「上期结余 <= 0」，
         *   算不出百分比，应当显示破折号。
         */
        pctText: pct === null || pct === undefined ? '—'
          : `${Math.abs(Number(pct)) % 1 === 0 ? Math.abs(Number(pct)).toFixed(0) : Math.abs(Number(pct)).toFixed(1)}%`,
        arrow: balanceDiff.value > 0 ? '↑' : balanceDiff.value < 0 ? '↓' : '',
        color: balanceDiff.value > 0
          ? 'var(--app-success)'
          : balanceDiff.value < 0 ? 'var(--app-danger)' : 'var(--app-text-3)',
        curText: (c.current.balance / 100).toFixed(2),
        prevText: (c.previous.balance / 100).toFixed(2)
      }
    })

    /**
     * 双向柱状图的刻度：固定 ±100%
     *
     * ★ 按百分比绘制，不按金额（用户要求）★
     *   按金额画时，房租涨 500 元的柱子比奶茶涨 5 元长 100 倍；
     *   但「房租涨 5%、奶茶涨 50%」时，真正该被看见的反而是奶茶。
     *   按比例画，柱长就是「这一项涨跌得有多凶」，和旁边那个百分比数字
     *   表达的是同一件事。
     *
     * ★ 刻度固定在 ±100%，超出的一律截断（用户要求）★
     *   用户原话「绘制时只取 -100% 到 100%，多余的或者少于的绘制为 -100% 到 100%」。
     *
     *   ★ 为什么不能用「除以本页最大值」★
     *     之前是除以本页最大绝对值，长短只能表达「这一页里谁相对更大」——
     *     换一个月、多一个分类，同一个 30% 就会变长变短，无法跨月对比。
     *     固定到 ±100% 后，柱长只取决于它自己，看图就能知道「涨了一倍」还是「涨了一成」。
     *
     *   ★ 为什么要截断而不是缩放★
     *     涨 500% 和涨 200% 都超出了一倍，对用户来说都是「翻了好几倍」，
     *     再细分已经没意义；截断反而保住了 0~100% 区间的可读性（大多数分类在这里）。
     *     具体百分比数字仍然完整显示在旁边，不会因截断而丢信息。
     */
    const PCT_CAP = 100

    /** 一行的变化幅度（百分比）：null（上期为 0）当 100 看 */
    function pctOf(c) {
      if (!c) return 0
      if (c.pct === null || c.pct === undefined) return Number(c.current) > 0 ? PCT_CAP : 0
      return Number(c.pct) || 0
    }

    function barWidth(row) {
      // 先截断到 ±100%，再映射到半幅最多 48%（留边距不让柱子顶到框）
      const v = Math.min(PCT_CAP, Math.abs(pctOf(row)))
      return Math.round((v / PCT_CAP) * 48)
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

    /**
     * 变化金额：**不带正负号**，只给绝对值（用户本轮第 2 条）
     *
     * ★ 为什么不带符号 ★
     *   方向已经由前面那个 ↑/↓ 箭头表达了，
     *   数字上再带一个 + / - 就是同一件事说两遍，而且两个符号一定会有一天对不上。
     */
    function absDiffText(diff) {
      return `¥${(Math.abs(Number(diff) || 0) / 100).toFixed(2)}`
    }

/**
     * 百分比也去掉正负号（方向交给箭头）
     *
     * ★ 不再显示「新增」（用户本轮）★
     *   用户原话「不要显示新增了，就是上箭头100%」。
     *   上期为 0 → 从 0 到有，比例上就看作 100%，配一个 ↑ 一起读。
     */
    function absPercentText(pct, cur) {
      if (pct === null || pct === undefined) return Number(cur) > 0 ? '100%' : '—'
      const v = Math.abs(Number(pct))
      return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}%`
    }

    /**
     * 方向箭头（0 = 不显示）
     *
     * ★ 0 不给箭头，也不给破折号 ★
     *   持平时画一个「—」会和数字挤在一起像负号；
     *   不画反而最清楚。
     */
    function arrowOf(diff) {
      const d = Number(diff) || 0
      if (d === 0) return ''
      return d > 0 ? '↑' : '↓'
    }

    /**
     * 百分比前面的箭头
     *
     * ★ 上期为 0 也要箭头（用户本轮）★
     *   之前它返回空字符串，因为当时文案是「新增」，
     *   给箭头会重复表达。现在文案已改成「100%」，
     *   没有箭头就不知道是涨还是跌了。
     *
     * @param {{diff:number, pct:number|null}} c 分类行数据
     * @returns {string} '↑' / '↓' / ''（不显示）
     */
    function arrowOfPct(c) {
      if (!c) return ''
      return arrowOf(c.diff)
    }

    return {
      pickLevel, pickType,
      rangeHint, balanceDiff, top1, balancePart,
      barWidth, diffColor,
      absDiffText, absPercentText, arrowOf, arrowOfPct
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
/*
 * 对比窗口说明（用户本轮：移到标题下方）
 *
 * ★ 小字号灰色 ★
 *   它只是「这两个数是哪两段时间」的注解，
 *   和标题同级的黑字会让用户以为它也是一个标题。
 *   现在它在标题正下方，所以不需要 margin-left（那是同行时才要的间距）。
 */
.cmp-range-hint {
  font-size: 20rpx;
  font-weight: 400;
  color: var(--app-text-3);
  line-height: 1.2;
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
  align-items: center;
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

/* 四个标签（支出变化 / 结余变化…）也要跟数字一起居中（用户反馈） */
.cmp-top-label {
  font-size: 22rpx;
  color: var(--app-text-3);
  text-align: center;
}

/*
 * 百分比 + 箭头：居中、字号大（用户本轮第 2 条）
 *
 * ★ 居中而不是左对齐 ★
 *   用户原话「上方两个大的变化居中显示」。
 *   这两个数是整个面板的结论，居中看起来像「一个数字」而不是「一行文字」。
 */
.cmp-top-main {
  display: flex;
  align-items: baseline;
  justify-content: center;
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
/*
 * 本期 / 上期：两行，标签左、金额右（用户本轮第 2 条）
 *
 * ★ 为什么要左右对齐 ★
 *   用户原话「下方的本期上期左右对齐，类似于恩格尔系数一样」。
 *   恩格尔那块就是「标签在左、数字在右」，
 *   两行的数字落在同一列，才能上下直接相减。
 */
.cmp-top-amounts {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  /*
   * ★ 必须占满整列宽度 ★
   *   父级已 align-items: center，如果这里不给 100%，
   *   它会被内容撑开成「两个数字宽度」，
   *   左右对齐就变成了居中挤在一起，看不出对照关系。
   */
  width: 100%;
  margin-top: 4rpx;
}

.cmp-top-amount-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8rpx;
}

.cmp-top-amount-label {
  font-size: 20rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
}

.cmp-top-amount-value {
  font-size: 22rpx;
  color: var(--app-text-2);
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
/*
 * 变化金额 + 百分比（带前置箭头）
 *
 * ★ 左对齐、固定宽 ★
 *   用户要求「不同行的金额和百分比、柱状图左侧都左对齐」。
 *   固定宽才能让每一行的同一列落在同一个 x 坐标上。
 */
.cmp-row-num {
  display: flex;
  align-items: baseline;
  gap: 4rpx;
  /* 两个箭头 + 金额 + 百分比，宽度跟着加 */
  width: 238rpx;
  flex-shrink: 0;
}

/* 箭头：固定宽度，没有箭头的行也不会往左挪 */
.cmp-row-arrow {
  font-size: 22rpx;
  font-weight: 600;
  width: 22rpx;
  flex-shrink: 0;
  text-align: center;
}

/* 百分比前面那个箭头：比金额前的再小一点，免得两个箭头争戏 */
.cmp-row-arrow-pct {
  font-size: 18rpx;
  width: 18rpx;
  opacity: 0.85;
}

.cmp-row-diff {
  font-size: 24rpx;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  width: 118rpx;
  flex-shrink: 0;
}

/* 百分比：左对齐、固定宽 */
.cmp-row-pct {
  font-size: 22rpx;
  font-variant-numeric: tabular-nums;
  width: 82rpx;
  flex-shrink: 0;
}

/*
 * 柱状槽：宽度缩短（用户第 9d 条）
 *   原来 flex:1 吃掉剩余全部宽度，窄屏上数字被挤没。
 *   现在给一个固定上限宽度，对齐右侧但不再拉满。
 */
.cmp-row-bar {
  position: relative;
  /*
   * ★ 固定宽度 + 靠右 ★
   *   用户反馈「双向柱状图为什么没有紧贴到右边？合理分散开」。
   *   固定宽度是为了不让柱子随屏宽变长变短；
   *   再用 margin-left: auto 把它推到行尾——
   *   这样数字列和柱子之间的空白全部集中在中间，
   *   两端各自靠边，色块才不会漂在半空中间。
   */
  width: 130rpx;
  margin-left: auto;
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

/*
 * 左侧：标题 在上、对比说明 在下（用户本轮）
 *
 * ★ 为什么从「同行」改成「上下两行」 ★
 *   标题右侧挤着两组切换器（一级/二级、支出/收入），
 *   “对比 10/01~10/08”跟在标题后面时，屏宽一窄就被截断成“对比 10/0…”；
 *   它又只是标题的注解，两行一直排下来更好读。
 */
.card-head-left {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4rpx;
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
 *
 * ★ 不在这里重写样式（用户反馈：和分类统计的 tab 长得不一样）★
 *   之前这个组件里拄了一份 .seg-toggle / .seg-item 的局部样式，
 *   而 scoped 样式会被编译成 `.seg-toggle[data-v-xxx]`，
 *   优先级高于 App.vue 里的全局 `.seg-toggle` ——
 *   于是同一个控件在同一个页面（统计页）上模样不一致：
 *   分类统计用全局那套（底槽 --app-line + 白块阴影），
 *   同比环比用这套（底槽 --app-card-2、无阴影、尺寸偏小）。
 *   删掉本地样式 = 两处用同一套，以后要改也只改 App.vue 一处。
 */

</style>
