<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="goBack">‹</text>
        <text class="nav-title">交易详情</text>
        <text class="nav-action" @click="onEdit">编辑</text>
      </view>
    </view>

    <scroll-view v-if="txn" class="page-scroll" scroll-y>
      <!-- 金额头 -->
      <view class="detail-head">
        <view class="head-icon" :style="{ backgroundColor: (txn.category_color || '#969799') + '22' }">
          <text class="head-icon-text" :style="{ color: txn.category_color || '#969799' }">
            {{ iconChar }}
          </text>
        </view>
        <!--
          金额：支出 -、收入 +，转账不加符号（符号规则全页面统一）。
          ★ 转账在这里用正文色，不用浅灰 ★
            浅灰是「列表里区分非收支」的视觉降级，
            而交易详情是用户专门点进来看这一笔的，
            转账金额就是这页的主体，淡化反而看不清。
            所以转账时显式传 color，绕开 MoneyText 的浅灰默认。
        -->
        <MoneyText
          :cents="txn.amount_cents"
          :type="txn.type"
          :size="72"
          :weight="600"
          :color="txn.type === 'transfer' ? 'var(--app-text)' : 'auto'"
        />
        <text class="head-type">{{ typeLabel }}</text>
      </view>

      <!-- 详情行 -->
      <view class="detail-card">
        <view class="row">
          <text class="row-label">{{ txn.type === 'transfer' ? '转出账户' : '账户' }}</text>
          <text class="row-value">{{ txn.account_name || '无账户' }}</text>
        </view>

        <view v-if="txn.type === 'transfer'" class="row">
          <text class="row-label">转入账户</text>
          <text class="row-value">{{ txn.to_account_name || '无账户' }}</text>
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
      </view>

      <!-- 不计入预算（只有支出才有意义） -->
      <view v-if="txn.type === 'expense'" class="detail-card">
        <view class="row">
          <view class="row-label-col">
            <text class="row-label">不计入预算</text>
            <text class="row-hint">不占预算额度，余额照常计算</text>
          </view>
          <switch
            :checked="excludeFromBudget"
            :color="primaryColor"
            @change="onToggleExclude"
          />
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

    <!-- 全局弹窗宿主（组件库重绘的确认框） -->
    <AppDialog />
  </view>
</template>

<script>
import { ref, computed } from 'vue'
import { onLoad, onShow, onBackPress } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import { handleBackPress } from '@/utils/layerStack.js'
import TxnPanel from '@/components/TxnPanel.vue'
import AppDialog from '@/components/AppDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { getTransaction, deleteTransaction, getTxnTags, setExcludeFromBudget } from '@/api/transaction.js'
import { formatDayHeader, formatTime } from '@/utils/date.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'

export default {
  components: { MoneyText, TxnPanel, AppDialog },
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


    const typeLabel = computed(() => {
      if (!txn.value) return ''
      const map = { expense: '支出', income: '收入', transfer: '转账' }
      return map[txn.value.type] || ''
    })

    /*
     * 「来源」和「速记原文」已按需求移除 —— 详情页不再展示，
     * 数据库也不再记录（见 api/db/index.js 的 v10 迁移）。
     * 所以这里不再有 sourceLabel，模板里对应的两行也删掉了。
     */

    const iconChar = computed(() => {
      if (!txn.value) return ''
      if (txn.value.type === 'transfer') return '⇄'
      return txn.value.category_icon
        ? iconEmoji(txn.value.category_icon)
        : guessIconByName(txn.value.category_name)
    })

    const dayLabel = computed(() => txn.value ? formatDayHeader(txn.value.occurred_day) : '')
    const timeLabel = computed(() => txn.value ? formatTime(txn.value.occurred_at) : '')

    /** 这笔是否不计入预算 */
    const excludeFromBudget = computed(() => !!txn.value && txn.value.exclude_from_budget === true)

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

    /**
     * 切换「不计入预算」
     *
     * 只改标记，账户余额不受影响（这笔钱确实花出去了，
     * 只是不占预算额度）。
     */
    async function onToggleExclude(e) {
      const next = !!e.detail.value
      try {
        const updated = await setExcludeFromBudget(txnId.value, next)
        txn.value = updated
        uni.showToast({
          title: next ? '已不计入预算' : '已恢复计入预算',
          icon: 'none'
        })
        // 预算页面的数字要跟着变
        txnStore.loadHome(true)
      } catch (err) {
        await alertDialog({ title: '设置失败', content: err.message })
        // 失败就把开关拨回去
        await load()
      }
    }

    function onEdit() {
      showPanel.value = true
    }

    async function onSaved() {
      await load()
      txnStore.loadHome(true)
    }

    async function onDelete() {
      const confirmed = await confirmDialog({
        title: '删除这笔记录？',
        content: '删除后会同步修正账户余额',
        confirmText: '删除',
        danger: true
      })
      // ★ 取消就什么都不做 ★
      if (!confirmed) return

      try {
        await deleteTransaction(txnId.value)
        uni.showToast({ title: '已删除', icon: 'success' })
        await txnStore.loadHome(true)
        setTimeout(() => uni.navigateBack(), 600)
      } catch (e) {
        await alertDialog({ title: '删除失败', content: e.message })
      }
    }

    function goBack() {
      uni.navigateBack()
    }

    /**
     * ★ 必须用 onLoad(options) 取路由参数 ★
     *   之前用 onMounted + getCurrentPages()[last].options，
     *   在 uni-app 里 options 未必已挂到页面栈对象上，
     *   结果拿到空字符串 → 提示「缺少交易 ID」。
     *   onLoad 的 options 是框架直接给的，最可靠。
     */
    onLoad((options) => {
      txnId.value = (options && options.id) || ''
      if (!txnId.value) {
        loadingText.value = '缺少交易 ID'
        return
      }
      load()
    })

    onShow(() => {
      settingStore.syncSystemTheme()
    })

    // 侧滑返回：编辑面板打开时先收起面板，不退出本页
    onBackPress(() => handleBackPress())

    return {
      settingStore, statusBarHeight, txn, tags, showPanel, loadingText,
      primaryColor, pageStyle, typeLabel, iconChar,
      dayLabel, timeLabel, excludeFromBudget,
      onEdit, onSaved, onDelete, onToggleExclude, goBack
    }
  }
}
</script>

<style scoped>
.nav-bar {
  background-color: var(--app-bg);
  flex-shrink: 0;
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

/* 标签 + 副说明（两行），用于「不计入预算」这类带说明的条目 */
.row-label-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  min-width: 0;
}

.row-hint {
  font-size: 22rpx;
  color: var(--app-text-3);
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

</style>
