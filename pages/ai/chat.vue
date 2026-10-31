<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="AI 助手" @back="goBack">
      <template #right>
        <text class="nav-clear" @click="clearHistory">清空</text>
      </template>
    </PageNav>

    <scroll-view
      class="chat-scroll"
      scroll-y
      :scroll-into-view="scrollTarget"
      :scroll-with-animation="true"
    >
      <view class="chat-body">
        <!-- 空状态：快捷提问 -->
        <view v-if="messages.length === 0" class="welcome">
          <text class="welcome-emoji">💬</text>
          <text class="welcome-title">问我任何账务问题</text>
          <text class="welcome-desc">基于你本月的真实记账数据回答</text>

          <view class="suggest-list">
            <view
              v-for="s in suggestions"
              :key="s"
              class="suggest-chip"
              @click="askSuggestion(s)"
            >
              <text class="suggest-text">{{ s }}</text>
            </view>
          </view>
        </view>

        <!-- 消息列表 -->
        <view
          v-for="(msg, idx) in messages"
          :key="idx"
          :id="'msg-' + idx"
          class="msg-row"
          :class="msg.role === 'user' ? 'is-user' : 'is-ai'"
        >
          <view class="msg-bubble" :style="msg.role === 'user' ? { backgroundColor: primaryColor } : {}">
            <!-- 用户消息：纯文本 -->
            <text
              v-if="msg.role === 'user'"
              class="msg-text"
              :style="{ color: '#ffffff' }"
            >{{ msg.content }}</text>

            <!-- AI 消息：markdown 渲染 + 图表 -->
            <view v-else class="ai-content">
              <view v-for="(blk, bi) in msg.blocks" :key="bi" class="md-block">
                <!-- 标题 -->
                <text v-if="blk.type === 'h'" class="md-h" :class="'md-h' + blk.level">
                  <text
                    v-for="(seg, si) in blk.segments"
                    :key="si"
                    :class="{ 'md-bold': seg.bold, 'md-code': seg.code }"
                  >{{ seg.text }}</text>
                </text>

                <!-- 段落 -->
                <text v-else-if="blk.type === 'p'" class="md-p">
                  <text
                    v-for="(seg, si) in blk.segments"
                    :key="si"
                    :class="{ 'md-bold': seg.bold, 'md-code': seg.code }"
                  >{{ seg.text }}</text>
                </text>

                <!-- 列表 -->
                <view v-else-if="blk.type === 'ul'" class="md-ul">
                  <view v-for="(item, ii) in blk.items" :key="ii" class="md-li">
                    <text class="md-li-dot">•</text>
                    <text class="md-li-text">
                      <text
                        v-for="(seg, si) in item.segments"
                        :key="si"
                        :class="{ 'md-bold': seg.bold, 'md-code': seg.code }"
                      >{{ seg.text }}</text>
                    </text>
                  </view>
                </view>
              </view>

              <!-- 图表 -->
              <view v-if="msg.charts && msg.charts.length" class="chart-list">
                <view v-for="(c, ci) in msg.charts" :key="ci" class="chart-card">
                  <text v-if="c.title" class="chart-title">{{ c.title }}</text>
                  <view v-if="c.legend" class="chart-legend">
                    <view v-for="(lg, li) in c.legend" :key="li" class="legend-item">
                      <view class="legend-dot" :style="{ backgroundColor: lg.color }" />
                      <text class="legend-name">{{ lg.name }}</text>
                      <text class="legend-value">{{ lg.value }}</text>
                    </view>
                  </view>
                  <image
                    v-if="c.uri"
                    class="chart-img"
                    :src="c.uri"
                    mode="widthFix"
                  />
                  <text v-else class="chart-empty">这张图没有数据</text>
                </view>
              </view>
            </view>
          </view>
        </view>

        <!--
          思考状态。
          ★ 不再只是一句「正在分析…」★
            深度思考下响应可能要好几秒甚至几十秒，
            干等着用户会以为卡死了。
            所以这里做成一组「阶段」提示 + 呼吸动画，
            让用户知道系统确实在干活。
        -->
        <view v-if="thinking" class="msg-row is-ai">
          <view class="msg-bubble think-bubble">
            <view class="think-head">
              <view class="think-dots">
                <view class="think-dot d1" />
                <view class="think-dot d2" />
                <view class="think-dot d3" />
              </view>
              <text class="think-stage">{{ thinkStage }}</text>
            </view>
            <view class="think-bar">
              <view class="think-bar-fill" />
            </view>
          </view>
        </view>

        <!-- 底部锚点：scroll-into-view 要靠 id 找元素，
             只有 class 的话 scroll-into-view 找不到目标，
             列表会停在顶部 -->
        <view id="bottom-anchor" class="bottom-anchor" />
      </view>
    </scroll-view>

    <!-- 输入区：用 input 而非 textarea，空态时不会占两行 -->
    <view class="input-bar">
      <input
        v-model="draft"
        class="chat-input"
        :disabled="thinking"
        :maxlength="200"
        confirm-type="send"
        placeholder="问点什么，比如「这个月花了多少」"
        placeholder-class="input-placeholder"
        :show-confirm-bar="false"
        :cursor-spacing="20"
        @confirm="send"
      />
      <view
        class="send-btn"
        :style="{ backgroundColor: canSend ? primaryColor : 'var(--app-line)' }"
        @click="send"
      >
        <text class="send-text" :style="{ color: canSend ? '#ffffff' : 'var(--app-text-3)' }">发送</text>
      </view>
    </view>

    <!-- 全局弹窗宿主（组件库重绘的确认框） -->
    <AppDialog />
  </view>
</template>

<script>
import { ref, computed, nextTick } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import PageNav from '@/components/PageNav.vue'
import AppDialog from '@/components/AppDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import {
  getAiSummary, getOverview, getMonthComparison, getDailyTrendRange,
  getCategoryStatsRange, getSubCategoryStatsRange
} from '@/api/stats.js'
import { askFinance } from '@/api/aiParse.js'
import { normalizeChartSpec, fetchChartData } from '@/api/aiChartData.js'
import { renderMarkdown } from '@/utils/markdown.js'
import { buildAiChartUri, formatShortMoney } from '@/utils/aiChart.js'
import { toMonthKey, toDayKey, shiftDay, monthRange } from '@/utils/date.js'
import { confirmDialog } from '@/utils/dialog.js'

const HISTORY_KEY = 'aiChatHistory'

/**
 * 思考阶段的提示文案（按顺序轮换）。
 *
 * ★ 为什么要有阶段提示 ★
 *   深度思考模式下响应可能要十几秒，
 *   一直显示同一句话会让人以为死机了。
 *   换着显示几段，用户就知道系统还在跑。
 */
const THINK_STAGES = [
  '正在读取你的账单…',
  '正在汇总本月数据…',
  '正在对比分类占比…',
  '正在分析趋势…',
  '正在组织回答…'
]

export default {
  components: { PageNav, AppDialog },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()
    const txnStore = useTransactionStore()

    const messages = ref([])
    const draft = ref('')
    const thinking = ref(false)
    const scrollTarget = ref('')
    /** 当前思考阶段的文案 */
    const thinkStage = ref(THINK_STAGES[0])

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)
    const canSend = computed(() => draft.value.trim().length > 0 && !thinking.value)

    /** 对话专属配置 */
    const aiChat = computed(() => settingStore.settings.aiChat || {})
    /** 深度思考是否开启（默认开） */
    const deepThinking = computed(() => aiChat.value.deepThinking !== false)

    const suggestions = [
      '这个月花了多少钱',
      '本月支出比上月多还是少',
      '哪类消费最多',
      '这周的收支情况',
      '给我一份本月消费月报'
    ]

    /* ------------------------------------------------------ 滚动到底 */

    /**
     * 滚动到底部
     *
     * scroll-into-view 的值不变时不会再次触发，
     * 所以先置空再置成目标 id，强制触发一次。
     * （目标元素是 id="bottom-anchor" 那个，
     *  之前只有 class 没有 id，scroll-into-view 根本找不到目标，
     *  列表就停在最顶部了。）
     */
    async function scrollToBottom() {
      await nextTick()
      scrollTarget.value = ''
      await nextTick()
      scrollTarget.value = 'bottom-anchor'
    }

    /* ---------------------------------------------------- 构造数据包 */

    /**
     * 根据问题类型决定给模型哪些数据。
     *
     * ★ 为什么给这么多 ★
     *   「分析透彻」的前提是模型看得到足够的数据。
     *   以前只给月度聚合，模型看不到「每天怎么花的」、
     *   也看不到二级分类的细分 ——
     *   再强的推理也分析不出数据里没有的东西。
     *
     *   现在补上：
     *     · 每日趋势（看波动、看出哪天异常）
     *     · 二级分类细分（哪一细分最花钱）
     *     · 环比对比（和上个月比）
     *   全部是**聚合数据**，不含单笔流水明细。
     */
    async function buildContext(question) {
      const q = String(question)
      const thisMonth = toMonthKey()
      const today = toDayKey()

      // 周报：最近 7 天
      if (/周|七天|最近7天|这周/.test(q)) {
        const start = shiftDay(today, -6)
        const sum = await txnStore.list({ startDay: start, endDay: today, limit: 500 })
        const overview = await getOverview(thisMonth)

        let expense = 0
        let income = 0
        const byCat = {}
        for (const t of sum) {
          if (t.type === 'expense') {
            expense += t.amount_cents
            const k = t.category_name || '未分类'
            byCat[k] = (byCat[k] || 0) + t.amount_cents
          } else if (t.type === 'income') {
            income += t.amount_cents
          }
        }

        return {
          range: `${start} 至 ${today}`,
          rangeType: 'week',
          expense: Math.round(expense / 100),
          income: Math.round(income / 100),
          balance: Math.round((income - expense) / 100),
          txnCount: sum.length,
          categories: Object.entries(byCat)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([name, cents]) => ({ name, amount: Math.round(cents / 100) })),
          monthExpenseSoFar: Math.round(overview.monthExpense / 100)
        }
      }

      // 月报 / 默认：整月聚合 + 趋势 + 二级细分 + 环比
      const summary = await getAiSummary(thisMonth)
      const comparison = await getMonthComparison(thisMonth)
      const scope = monthRange(thisMonth)

      // 每日趋势（本月）
      const trend = await getDailyTrendRange(scope)
      const daily = (trend || []).map((t) => ({
        day: t.label,
        expense: Math.round((Number(t.expense) || 0) / 100),
        income: Math.round((Number(t.income) || 0) / 100)
      }))

      // 二级分类细分（本月支出 Top 8）
      const subs = await getSubCategoryStatsRange(scope, 'expense')
      const subCategories = (subs || [])
        .filter((s) => Number(s.amount) > 0)
        .slice(0, 8)
        .map((s) => ({
          name: s.parentName ? `${s.parentName}/${s.name}` : s.name,
          amount: Math.round((Number(s.amount) || 0) / 100),
          count: Number(s.count) || 0
        }))

      return {
        ...summary,
        range: thisMonth,
        rangeType: 'month',
        compare: {
          expenseChangePct: comparison.expenseChangePct,
          prevExpense: Math.round(comparison.prevExp / 100),
          prevIncome: Math.round(comparison.prevInc / 100)
        },
        today: {
          date: today,
          expense: Math.round((await getOverview(thisMonth)).todayExpense / 100)
        },
        daily,
        subCategories
      }
    }

    /* ------------------------------------------------------ 图表渲染 */

    /**
     * 把模型给的图表规格变成可显示的图表。
     *
     * ★ 数据全部由本地库取 ★
     *   模型只说「画哪张图」，数字由 fetchChartData 从 SQLite 取，
     *   所以图表上的数一定是准的。
     *
     * @param {Array} specs 模型给的规格数组
     * @param {object} ctx   本次查询的区间信息
     * @returns {Promise<Array>} 可直接显示的图表数组
     */
    async function buildCharts(specs, ctx) {
      const out = []
      if (!Array.isArray(specs) || specs.length === 0) return out

      const list = specs.slice(0, 2)
      for (const raw of list) {
        const spec = normalizeChartSpec(raw)
        if (!spec) continue

        const scope = ctx && ctx.rangeType === 'week'
          ? { startDay: ctx.startDay, endDay: ctx.endDay }
          : monthRange(ctx && ctx.monthKey ? ctx.monthKey : toMonthKey())

        let data
        try {
          data = await fetchChartData(spec, scope)
        } catch (e) {
          continue
        }
        if (!data || !data.items || data.items.length === 0) continue

        const textColor = settingStore.isDark ? '#C8C8CC' : '#333333'
        const uri = buildAiChartUri(spec.type, data.items, {
          title: spec.title,
          textColor,
          color: primaryColor.value
        })
        if (!uri) continue

        // 图例：环形图有引导线太挤，用图例更清楚
        // ★ 颜色直接用 item.color ★
        //   和环形图上的色块同源，不会出现「色块一个色、图例另一个色」
        const legend = data.items.slice(0, 6).map((it) => ({
          name: it.name,
          color: it.color,
          value: formatShortMoney(it.amount) + '元'
        }))

        out.push({
          type: spec.type,
          title: spec.title,
          uri,
          legend: spec.type === 'donut' ? legend : null
        })
      }
      return out
    }

    /* ---------------------------------------------------------- 发送 */

    /** 思考阶段轮换定时器 */
    let stageTimer = null

    function startStageRotation() {
      let i = 0
      thinkStage.value = THINK_STAGES[0]
      stageTimer = setInterval(() => {
        i = (i + 1) % THINK_STAGES.length
        thinkStage.value = THINK_STAGES[i]
      }, 2200)
    }

    function stopStageRotation() {
      if (stageTimer) {
        clearInterval(stageTimer)
        stageTimer = null
      }
    }

    async function send() {
      const text = draft.value.trim()
      if (!text || thinking.value) return

      messages.value.push({ role: 'user', content: text })
      draft.value = ''
      thinking.value = true
      startStageRotation()
      await scrollToBottom()

      try {
        const ctx = await buildContext(text)

        // 只带最近 4 轮对话，控制 token
        const history = messages.value
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content }))

        const res = await askFinance(history, ctx, {
          maxTokens: aiChat.value.maxTokens || 2000,
          thinking: deepThinking.value,
          allowCharts: aiChat.value.showCharts !== false
        })

        // 图表：规格 → 本地取数 → 画成 SVG
        const charts = await buildCharts(res.charts, {
          rangeType: ctx.rangeType,
          monthKey: ctx.month ? ctx.month : toMonthKey(),
          startDay: ctx.range ? String(ctx.range).slice(0, 10) : '',
          endDay: todayKey()
        })

        messages.value.push({
          role: 'assistant',
          content: res.text,
          blocks: renderMarkdown(res.text),
          charts
        })
        saveHistory()
      } catch (e) {
        messages.value.push({
          role: 'assistant',
          content: `抱歉，出错了：${e.message}`,
          blocks: renderMarkdown(`抱歉，出错了：${e.message}`),
          charts: []
        })
      } finally {
        stopStageRotation()
        thinking.value = false
        await scrollToBottom()
      }
    }

    /** 今天的日期 key */
    function todayKey() {
      return toDayKey()
    }

    function askSuggestion(s) {
      draft.value = s
      send()
    }

    /* ---------------------------------------------------------- 历史 */

    function saveHistory() {
      try {
        // 只存最近 30 条
        const toSave = messages.value.slice(-30)
        uni.setStorageSync(HISTORY_KEY, JSON.stringify(toSave))
      } catch (e) {}
    }

    function loadHistory() {
      try {
        const raw = uni.getStorageSync(HISTORY_KEY)
        if (raw) {
          const arr = JSON.parse(raw)
          if (Array.isArray(arr)) {
            messages.value = arr
              .filter(
                (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
              )
              .map((m) => ({
                role: m.role,
                content: m.content,
                // ★ 历史消息要重新渲染 markdown、并且不保留图表 ★
                //   图表是 SVG data URI，存进 localStorage 又大又没必要
                //   （下次问同样的问题时模型会重新给规格）
                blocks: m.role === 'assistant' ? renderMarkdown(m.content) : null,
                charts: []
              }))
          }
        }
      } catch (e) {}
    }

    async function clearHistory() {
      const confirmed = await confirmDialog({
        title: '清空对话记录？'
      })
      // ★ 取消就什么都不做 ★
      if (!confirmed) return

      messages.value = []
      try {
        uni.removeStorageSync(HISTORY_KEY)
      } catch (e) {}
    }

    function goBack() {
      uni.navigateBack()
    }

    onLoad(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await accountStore.load()
      loadHistory()
      await scrollToBottom()
    })

    return {
      settingStore, messages, draft, thinking, scrollTarget, thinkStage,
      primaryColor, pageStyle, canSend, suggestions,
      send, askSuggestion, clearHistory, goBack
    }
  }
}
</script>

<style scoped>
.nav-clear {
  font-size: 26rpx;
  color: var(--app-text-3);
}

.chat-scroll {
  flex: 1;
  height: 0;
  overflow: hidden;
}

.chat-body {
  padding: 24rpx 32rpx 40rpx;
}

/* 欢迎态 */
.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80rpx 20rpx 40rpx;
}

.welcome-emoji {
  font-size: 80rpx;
  margin-bottom: 24rpx;
}

.welcome-title {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--app-text);
  margin-bottom: 10rpx;
}

.welcome-desc {
  font-size: 24rpx;
  color: var(--app-text-3);
  margin-bottom: 48rpx;
}

.suggest-list {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  justify-content: center;
}

.suggest-chip {
  padding: 16rpx 28rpx;
  background-color: var(--app-card);
  border-radius: 28rpx;
}

.suggest-text {
  font-size: 25rpx;
  color: var(--app-text-2);
}

/* 消息 */
.msg-row {
  display: flex;
  margin-bottom: 24rpx;
}

.msg-row.is-user {
  justify-content: flex-end;
}

.msg-row.is-ai {
  justify-content: flex-start;
}

.msg-bubble {
  max-width: 86%;
  padding: 20rpx 26rpx;
  border-radius: 20rpx;
  background-color: var(--app-card);
}

.msg-row.is-user .msg-bubble {
  border-bottom-right-radius: 6rpx;
  max-width: 76%;
}

.msg-row.is-ai .msg-bubble {
  border-bottom-left-radius: 6rpx;
  padding-bottom: 16rpx;
}

.msg-text {
  font-size: 28rpx;
  line-height: 1.65;
  word-break: break-word;
  white-space: pre-wrap;
}

/* ---------------- AI 回答的 markdown 排版 ---------------- */

.ai-content {
  display: flex;
  flex-direction: column;
}

.md-block {
  margin-bottom: 8rpx;
}

/* 标题：## 稍大加粗，### 再小一点 */
.md-h {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
  line-height: 1.5;
  margin-top: 10rpx;
  margin-bottom: 4rpx;
}

.md-h3 {
  font-size: 28rpx;
}

.md-h4 {
  font-size: 27rpx;
}

.md-p {
  font-size: 28rpx;
  line-height: 1.7;
  color: var(--app-text);
  word-break: break-word;
  white-space: pre-wrap;
}

/* 行内加粗 / 代码 */
.md-bold {
  font-weight: 600;
  color: var(--app-text);
}

.md-code {
  font-family: monospace;
  font-size: 26rpx;
  color: var(--app-primary);
}

/* 列表 */
.md-ul {
  display: flex;
  flex-direction: column;
  margin: 4rpx 0;
}

.md-li {
  display: flex;
  align-items: flex-start;
  margin-bottom: 6rpx;
}

.md-li-dot {
  font-size: 28rpx;
  line-height: 1.7;
  color: var(--app-text-2);
  margin-right: 10rpx;
  flex-shrink: 0;
}

.md-li-text {
  flex: 1;
  font-size: 28rpx;
  line-height: 1.7;
  color: var(--app-text);
  word-break: break-word;
}

/* ---------------- 图表 ---------------- */

.chart-list {
  margin-top: 12rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.chart-card {
  background-color: var(--app-card-2);
  border-radius: 16rpx;
  padding: 18rpx;
}

.chart-title {
  display: block;
  font-size: 25rpx;
  font-weight: 600;
  color: var(--app-text-2);
  margin-bottom: 12rpx;
}

.chart-img {
  width: 100%;
  display: block;
}

.chart-empty {
  display: block;
  font-size: 24rpx;
  color: var(--app-text-3);
  text-align: center;
  padding: 20rpx 0;
}

.chart-legend {
  margin-top: 12rpx;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.legend-item {
  display: flex;
  align-items: center;
}

.legend-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  margin-right: 10rpx;
  flex-shrink: 0;
}

.legend-name {
  flex: 1;
  font-size: 24rpx;
  color: var(--app-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.legend-value {
  font-size: 24rpx;
  color: var(--app-text-3);
  margin-left: 12rpx;
  flex-shrink: 0;
}

/* ---------------- 思考状态 ---------------- */

.think-bubble {
  padding: 22rpx 26rpx;
  min-width: 320rpx;
}

.think-head {
  display: flex;
  align-items: center;
}

.think-dots {
  display: flex;
  align-items: center;
  gap: 6rpx;
  margin-right: 14rpx;
}

.think-dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  background-color: var(--app-text-3);
  animation: think-bounce 1.2s infinite ease-in-out;
}

.think-dot.d2 {
  animation-delay: 0.18s;
}

.think-dot.d3 {
  animation-delay: 0.36s;
}

@keyframes think-bounce {
  0%, 60%, 100% {
    opacity: 0.35;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-5rpx);
  }
}

.think-stage {
  font-size: 26rpx;
  color: var(--app-text-3);
}

/* 进度条：来回滑动，表示「还在跑」 */
.think-bar {
  margin-top: 14rpx;
  height: 6rpx;
  border-radius: 3rpx;
  background-color: var(--app-card-2);
  overflow: hidden;
}

.think-bar-fill {
  height: 100%;
  width: 40%;
  border-radius: 3rpx;
  background-color: var(--app-text-3);
  opacity: 0.5;
  animation: think-slide 1.6s infinite ease-in-out;
}

@keyframes think-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(250%);
  }
}

.bottom-anchor {
  height: 20rpx;
}

/* 输入区 */
.input-bar {
  display: flex;
  align-items: flex-end;
  gap: 16rpx;
  padding: 16rpx 32rpx calc(env(safe-area-inset-bottom) + 16rpx);
  background-color: var(--app-card);
  border-top: 1rpx solid var(--app-line);
  flex-shrink: 0;
}

.chat-input {
  flex: 1;
  /* 单行输入：固定高度，不随内容增长 */
  height: 76rpx;
  padding: 0 24rpx;
  background-color: var(--app-card-2);
  border-radius: 16rpx;
  font-size: 28rpx;
  color: var(--app-text);
  line-height: 76rpx;
}

.input-placeholder {
  color: var(--app-text-3);
  font-size: 26rpx;
}

.send-btn {
  height: 76rpx;
  padding: 0 32rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.send-text {
  font-size: 28rpx;
  font-weight: 500;
}
</style>
