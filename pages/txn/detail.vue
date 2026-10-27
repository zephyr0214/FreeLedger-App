<template>
  <view class="app-page" :style="pageStyle">
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="goBack">‹</text>
        <text class="nav-title">交易详情</text>
        <text class="nav-action" @click="onEdit">编辑</text>
      </view>
    </view>

    <scroll-view v-if="txn" class="page-scroll" scroll-y :style="{ height: scrollHeight }">
      <!-- 金额头 -->
      <view class="detail-head">
        <view class="head-icon" :style="{ backgroundColor: (txn.category_color || '#969799') + '22' }">
          <text class="head-icon-text" :style="{ color: txn.category_color || '#969799' }">
            {{ iconChar }}
          </text>
        </view>
        <MoneyText
          :cents="txn.amount_cents"
          :size="72"
          :weight="600"
          :color="txn.type === 'expense' ? 'var(--app-text)' : (txn.type === 'income' ? 'var(--app-success)' : 'var(--app-text)')"
        />
        <text class="head-type">{{ typeLabel }}</text>
      </view>

      <!-- 详情行 -->
      <view class="detail-card">
        <view class="row">
          <text class="row-label">{{ txn.type === 'transfer' ? '转出账户' : '账户' }}</text>
          <text class="row-value">{{ txn.account_name || '—' }}</text>
        </view>

        <view v-if="txn.type === 'transfer'" class="row">
          <text class="row-label">转入账户</text>
          <text class="row-value">{{ txn.to_account_name || '—' }}</text>
        </view>

        <view v-if="txn.type !== 'transfer'" class="row">
          <text class="row-label">分类</text>
          <text class="row-value">{{ txn.category_name || '未分类' }}</text>
        </view>

        <view class="row">
          <text class="row-label">日期</text>
          <text class="row-value">{{ dayLabel }}</text>
        </view>

        <view class="row">
          <text class="row-label">时间</text>
          <text class="row-value">{{ timeLabel }}</text>
        </view>

        <view v-if="tags.length" class="row">
          <text class="row-label">标签</text>
          <view class="row-tags">
            <view
              v-for="t in tags"
              :key="t.id"
              class="tag-chip"
              :style="{ backgroundColor: (t.color || primaryColor) + '22' }"
            >
              <text class="tag-text" :style="{ color: t.color || primaryColor }">{{ t.name }}</text>
            </view>
          </view>
        </view>

        <view v-if="txn.note" class="row row-column">
          <text class="row-label">备注</text>
          <text class="row-note">{{ txn.note }}</text>
        </view>

        <view class="row">
          <text class="row-label">来源</text>
          <text class="row-value">{{ sourceLabel }}</text>
        </view>

        <view v-if="txn.raw_text" class="row row-column">
          <text class="row-label">速记原文</text>
          <text class="row-note">{{ txn.raw_text }}</text>
        </view>
      </view>

      <!-- 操作 -->
      <view class="action-area">
        <wd-button size="large" plain custom-class="act-btn" @click="onEdit">
          编辑这笔
        </wd-button>
        <wd-button size="large" plain custom-class="act-btn act-danger" @click="onDelete">
          删除
        </wd-button>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <view v-else class="loading-wrap">
      <text class="loading-text">{{ loadingText }}</text>
    </view>

    <!-- 编辑面板 -->
    <TxnPanel v-model="showPanel" :editing="txn" @saved="onSaved" />
  </view>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import TxnPanel from '@/components/TxnPanel.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { getTransaction, deleteTransaction, getTxnTags } from '@/api/transaction.js'
import { formatDayHeader, formatTime } from '@/utils/date.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'

export default {
  components: { MoneyText, TxnPanel },
  setup() {
    const settingStore = useSettingStore()
    const txnStore = useTransactionStore()

    const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20
    const txnId = ref('')
    const txn = ref(null)
    const tags = ref([])
    const showPanel = ref(false)
    const loadingText = ref('加载中…')

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    const scrollHeight = computed(() => {
      const info = uni.getSystemInfoSync()
      return `${info.windowHeight - statusBarHeight - 44}px`
    })

    const typeLabel = computed(() => {
      if (!txn.value) return ''
      const map = { expense: '支出', income: '收入', transfer: '转账' }
      return map[txn.value.type] || ''
    })

    const sourceLabel = computed(() => {
      if (!txn.value) return ''
      const map = { manual: '手动记账', quick: '速记', import: '导入', recurring: '周期记账' }
      return map[txn.value.source] || '手动记账'
    })

    const iconChar = computed(() => {
      if (!txn.value) return ''
      if (txn.value.type === 'transfer') return '⇄'
      return txn.value.category_icon
        ? iconEmoji(txn.value.category_icon)
        : guessIconByName(txn.value.category_name)
    })

    const dayLabel = computed(() => txn.value ? formatDayHeader(txn.value.occurred_day) : '')
    const timeLabel = computed(() => txn.value ? formatTime(txn.value.occurred_at) : '')

    async function load() {
      try {
        const t = await getTransaction(txnId.value)
        if (!t) {
          loadingText.value = '这笔记录不存在或已删除'
          return
        }
        txn.value = t

        if (t.tag_ids && t.tag_ids.length > 0) {
          const all = await getTxnTags(t.id)
          tags.value = all
        }
      } catch (e) {
        loadingText.value = e.message
      }
    }

    function onEdit() {
      showPanel.value = true
    }

    async function onSaved() {
      await load()
      txnStore.loadHome(true)
    }

    function onDelete() {
      uni.showModal({
        title: '删除这笔记录？',
        content: '删除后会同步修正账户余额',
        confirmText: '删除',
        confirmColor: '#ee0a24',
        success: async (res) => {
          if (!res.confirm) return
          try {
            await deleteTransaction(txnId.value)
            uni.showToast({ title: '已删除', icon: 'success' })
            await txnStore.loadHome(true)
            setTimeout(() => uni.navigateBack(), 600)
          } catch (e) {
            uni.showModal({ title: '删除失败', content: e.message, showCancel: false })
          }
        }
      })
    }

    function goBack() {
      uni.navigateBack()
    }

    onMounted(() => {
      // 从页面参数取 id
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      txnId.value = (page && page.options && page.options.id) || ''
      if (!txnId.value) {
        loadingText.value = '缺少交易 ID'
        return
      }
      load()
    })

    onShow(() => {
      settingStore.syncSystemTheme()
    })

    return {
      settingStore, statusBarHeight, txn, tags, showPanel, loadingText,
      primaryColor, pageStyle, scrollHeight, typeLabel, sourceLabel, iconChar,
      dayLabel, timeLabel,
      onEdit, onSaved, onDelete, goBack
    }
  }
}
</script>

<style scoped>
.nav-bar {
  background-color: var(--app-bg);
}

.nav-inner {
  height: 88rpx;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
}

.nav-back {
  font-size: 48rpx;
  color: var(--app-text);
  width: 100rpx;
  line-height: 1;
}

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.nav-action {
  font-size: 26rpx;
  color: var(--app-primary);
  width: 100rpx;
  text-align: right;
}

.page-scroll {
  padding: 0 32rpx;
}

/* 头部 */
.detail-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40rpx 0 48rpx;
  gap: 16rpx;
}

.head-icon {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.head-icon-text {
  font-size: 44rpx;
  font-weight: 500;
}

.head-type {
  font-size: 24rpx;
  color: var(--app-text-3);
}

/* 详情卡 */
.detail-card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 8rpx 28rpx;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 88rpx;
  border-bottom: 1rpx solid var(--app-line);
  gap: 20rpx;
}

.row:last-child {
  border-bottom: none;
}

.row-column {
  flex-direction: column;
  align-items: flex-start;
  padding: 20rpx 0;
  gap: 8rpx;
}

.row-label {
  font-size: 26rpx;
  color: var(--app-text-2);
  flex-shrink: 0;
}

.row-value {
  font-size: 28rpx;
  color: var(--app-text);
  text-align: right;
  flex: 1;
}

.row-note {
  font-size: 26rpx;
  color: var(--app-text);
  line-height: 1.6;
  white-space: pre-wrap;
}

.row-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  justify-content: flex-end;
  flex: 1;
}

.tag-chip {
  padding: 4rpx 16rpx;
  border-radius: 16rpx;
}

.tag-text {
  font-size: 22rpx;
}

/* 操作 */
.action-area {
  display: flex;
  gap: 20rpx;
  margin-top: 32rpx;
}

.act-btn {
  flex: 1;
}

.act-danger {
  color: #ee0a24 !important;
  border-color: #ee0a24 !important;
}

.loading-wrap {
  padding-top: 200rpx;
  text-align: center;
}

.loading-text {
  font-size: 26rpx;
  color: var(--app-text-3);
}

.bottom-space {
  height: 60rpx;
}
</style>
