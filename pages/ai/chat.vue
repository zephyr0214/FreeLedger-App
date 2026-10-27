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
            <text
              class="msg-text"
              :style="{ color: msg.role === 'user' ? '#ffffff' : 'var(--app-text)' }"
            >{{ msg.content }}</text>
          </view>
        </view>

        <!-- 思考中 -->
        <view v-if="thinking" class="msg-row is-ai">
          <view class="msg-bubble">
            <text class="msg-text msg-thinking">正在分析你的账单…</text>
          </view>
        </view>

        <view class="bottom-anchor" />
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
  </view>
</template>

<script>
import { ref, computed, nextTick } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import PageNav from '@/components/PageNav.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { getAiSummary, getOverview, getMonthComparison } from '@/api/stats.js'
import { askFinance } from '@/api/aiParse.js'
import { toMonthKey, toDayKey, shiftDay, shiftMonth } from '@/utils/date.js'

const HISTORY_KEY = 'aiChatHistory'

export default {
  components: { PageNav },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()
    const txnStore = useTransactionStore()

    const messages = ref([])
    const draft = ref('')
    const thinking = ref(false)
    const scrollTarget = ref('')

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)
    const canSend = computed(() => draft.value.trim().length > 0 && !thinking.value)

    const suggestions = [
      '这个月花了多少钱',
      '本月支出比上月多还是少',
      '哪类消费最多',
      '这周的收支情况',
      '给我一份本月消费月报'
    ]

    /* ------------------------------------------------------ 滚动到底 */

    async function scrollToBottom() {
      await nextTick()
      scrollTarget.value = ''
      await nextTick()
      scrollTarget.value = 'bottom-anchor'
    }

    /* ---------------------------------------------------- 构造数据包 */

    /**
     * 根据问题类型决定给模型哪些数据。
     * 关键：不把所有明细塞进去，按问题范围给聚合数据。
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

      // 月报 / 默认：整月聚合
      const summary = await getAiSummary(thisMonth)
      const comparison = await getMonthComparison(thisMonth)

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
        }
      }
    }

    /* ---------------------------------------------------------- 发送 */

    async function send() {
      const text = draft.value.trim()
      if (!text || thinking.value) return

      messages.value.push({ role: 'user', content: text })
      draft.value = ''
      thinking.value = true
      await scrollToBottom()

      try {
        const ctx = await buildContext(text)

        // 只带最近 4 轮对话，控制 token
        const history = messages.value
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content }))

        const reply = await askFinance(history, ctx)
        messages.value.push({ role: 'assistant', content: reply })
        saveHistory()
      } catch (e) {
        messages.value.push({
          role: 'assistant',
          content: `抱歉，出错了：${e.message}`
        })
      } finally {
        thinking.value = false
        await scrollToBottom()
      }
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
            messages.value = arr.filter(
              (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
            )
          }
        }
      } catch (e) {}
    }

    function clearHistory() {
      uni.showModal({
        title: '清空对话记录？',
        success: (res) => {
          if (!res.confirm) return
          messages.value = []
          try {
            uni.removeStorageSync(HISTORY_KEY)
          } catch (e) {}
        }
      })
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
      settingStore, messages, draft, thinking, scrollTarget,
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
  max-width: 76%;
  padding: 20rpx 26rpx;
  border-radius: 20rpx;
  background-color: var(--app-card);
}

.msg-row.is-user .msg-bubble {
  border-bottom-right-radius: 6rpx;
}

.msg-row.is-ai .msg-bubble {
  border-bottom-left-radius: 6rpx;
}

.msg-text {
  font-size: 28rpx;
  line-height: 1.65;
  word-break: break-word;
  white-space: pre-wrap;
}

.msg-thinking {
  color: var(--app-text-3);
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
