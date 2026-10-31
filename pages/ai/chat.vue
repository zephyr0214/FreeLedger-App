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

            <!--
              AI 消息：markdown 渲染 + 图表

              ★ 必须有 content 兜底 ★
                早期版本只渲染 msg.blocks，
                而 blocks 是「发送时算出来的」，历史记录里并没有 ——
                结果退出再进来，历史消息全是空白气泡。
                现在 blocks 为空就退回渲染纯文本 content，
                无论历史记录里有没有 blocks 都能正常显示。
            -->
            <view v-else class="ai-content">
              <template v-if="msg.blocks && msg.blocks.length">
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
              </template>

              <!-- 兜底：没有 blocks 就显示纯文本 -->
              <text v-else class="md-p">{{ msg.content }}</text>

              <!-- 图表 -->
              <view v-if="msg.charts && msg.charts.length" class="chart-list">
                <view v-for="(c, ci) in msg.charts" :key="ci" class="chart-card">
                  <text v-if="c.title" class="chart-title">{{ c.title }}</text>
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
import { buildAiChartUri } from '@/utils/aiChart.js'
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
     * ★ 除了 uri，还要把原始数据（items）留着 ★
     *   历史记录里要能还原图表。
     *   存 SVG 的 data URI 太大（一张 2.7 KB），
     *   而存 items 很小（一条 ~60 字节），
     *   读出来时用 buildAiChartUri 重新画一遍就行 ——
     *   画出来和当初一模一样（同样的数据、同样的配色）。
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

        /*
         * ★ 不再生成图例 ★
         *   环形图里已经在图的两侧标了「分类名 + 占比」，
         *   下面再来一份图例是重复的，还容易和图叠在一起。
         */
        out.push({
          type: spec.type,
          title: spec.title,
          uri,
          // ★ 原始数据：历史记录靠它还原图表 ★
          items: data.items
        })
      }
      return out
    }

    /**
     * 用存下来的原始数据重新画一张图。
     *
     * @param {object} chart 历史记录里的图表（含 type / title / items）
     * @returns {string} data URI（画不出来返回空串）
     */
    function rebuildChart(chart) {
      if (!chart || !chart.items || !chart.items.length) return ''
      try {
        const textColor = settingStore.isDark ? '#C8C8CC' : '#333333'
        return buildAiChartUri(chart.type, chart.items, {
          title: chart.title,
          textColor,
          color: primaryColor.value
        })
      } catch (e) {
        return ''
      }
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
        /*
         * ★ 截断的提示要能指导用户行动 ★
         *   「AI 返回内容为空：模型输出被 max_tokens 截断（正文为空）」
         *   这句话用户看不懂、也不知道该干嘛。
         *   告诉他「是推理模型的思考超了预算，去把上限调大」，
         *   用户就知道去哪儿改了。
         */
        let tip = e.message
        if (e && e.truncated) {
          tip =
            '模型思考超出了长度上限，正文没写出来。\n' +
            '请到「设置 → AI → AI 对话」把「回答长度上限」调大' +
            '（深度思考建议 8000 以上）。'
        }
        messages.value.push({
          role: 'assistant',
          content: `抱歉，出错了：${tip}`,
          blocks: renderMarkdown(`抱歉，出错了：${tip}`),
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

    /**
     * 保存历史对话。
     *
     * ★ 存什么 ★
     *   role + content + 图表的**原始数据**（items）。
     *
     *   为什么不存 SVG 的 data URI：
     *     一张环形图的 data URI 有 2.7 KB，30 条能到 50 KB ——
     *     uni.setStorageSync 在 App 端有容量上限，超了直接抛异常，
     *     一旦抛异常而 catch 是空的，整份历史一条都存不进去。
     *
     *   存 items 就小得多（一条 ~60 字节），
     *   读出来时用 buildAiChartUri 重新画一遍 ——
     *   同样的数据、同样的配色，画出来和当初一模一样。
     *
     * ★ 为什么以前会出现「历史里的图表不渲染」★
     *   1. 存的时候把 charts 整个丢掉了（只存了 content）；
     *   2. 读出来的时候写死 charts: []；
     *   3. 模板自然就没有图可画。
     *   现在存 items、读出来重画，图表就能还原了。
     */
    function saveHistory() {
      try {
        // 只存最近 30 条
        const toSave = messages.value.slice(-30).map((m) => {
          const item = { role: m.role, content: m.content }
          // ★ 图表只存原始数据，不存 SVG ★
          if (m.charts && m.charts.length) {
            item.charts = m.charts.map((c) => ({
              type: c.type,
              title: c.title,
              items: c.items || []
            }))
          }
          return item
        })
        uni.setStorageSync(HISTORY_KEY, JSON.stringify(toSave))
      } catch (e) {
        /*
         * ★ 存不下的时候，不能把旧记录一起弄丢 ★
         *   逐级减少条数重试：20 → 10 → 5 → 1。
         *   宁可只留下最近几条，也不能整个历史都没了。
         */
        console.warn('[ai] 保存历史失败，尝试精简:', e && e.message)
        for (const keep of [20, 10, 5, 1]) {
          try {
            const slim = messages.value.slice(-keep).map((m) => {
              const item = { role: m.role, content: m.content }
              if (m.charts && m.charts.length) {
                item.charts = m.charts.map((c) => ({
                  type: c.type,
                  title: c.title,
                  items: c.items || []
                }))
              }
              return item
            })
            uni.setStorageSync(HISTORY_KEY, JSON.stringify(slim))
            return
          } catch (e2) {
            // 继续试更少的条数
          }
        }
        console.warn('[ai] 历史记录保存失败')
      }
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
                // ★ blocks 在读出来时重算 ★
                //   历史记录里没有这个字段（存的时候只存了 content），
                //   这里重新渲染一遍 markdown。
                //   顺带兼容「老版本存过 blocks」的记录 —— 那种直接用。
                blocks: m.blocks && m.blocks.length
                  ? m.blocks
                  : (m.role === 'assistant' ? renderMarkdown(m.content) : null),
                // ★ 图表用存下来的原始数据重新画 ★
                //   这样退出再进来，图表照样显示。
                charts: restoreCharts(m.charts)
              }))
          }
        }
      } catch (e) {
        console.warn('[ai] 读取历史失败:', e && e.message)
      }
    }

    /**
     * 用存下来的原始数据把图表还原出来。
     *
     * @param {Array} charts 历史记录里的图表（{type, title, items}）
     * @returns {Array} 带 uri 的图表数组
     */
    function restoreCharts(charts) {
      if (!Array.isArray(charts) || charts.length === 0) return []
      const out = []
      for (const c of charts) {
        if (!c || !c.items || !c.items.length) continue
        const uri = rebuildChart(c)
        if (!uri) continue
        out.push({ type: c.type, title: c.title, uri, items: c.items })
      }
      return out
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
