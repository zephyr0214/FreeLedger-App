<template>
  <view class="recent-txn">
    <!-- 区块标题 + 右上角「全部 ›」 -->
    <view class="section-head">
      <text class="section-title">{{ title }}</text>
      <text v-if="showMore" class="section-more" @click="onMore">全部 ›</text>
    </view>

    <!-- 加载中 -->
    <view v-if="loading" class="state-wrap">
      <text class="state-text">加载中…</text>
    </view>

    <!-- 空态 -->
    <view v-else-if="visibleTxns.length === 0" class="empty-wrap">
      <EmptyState emoji="📭" title="暂无流水" :desc="emptyText" compact />
    </view>

    <!-- 按日期分组的流水 -->
    <view v-else class="group-list">
      <view v-for="group in groups" :key="group.day" class="day-group">
        <text class="day-title">{{ group.title }}</text>

        <view class="day-card">
          <view
            v-for="txn in group.list"
            :key="txn.id"
            class="txn-item"
            @click="goDetail(txn.id)"
          >
            <!-- 分类图标（带背景色） -->
            <view class="txn-icon" :style="iconBgStyle(txn)">
              <text class="txn-icon-text" :style="iconFgStyle(txn)">{{ iconChar(txn) }}</text>
            </view>

            <!-- 名称 + 副标题（时间 / 账户 / 备注） -->
            <view class="txn-info">
              <text class="txn-name ellipsis">{{ txnTitle(txn) }}</text>
              <text class="txn-sub ellipsis">{{ txnSub(txn) }}</text>
            </view>

            <!-- 金额：支出带 -，收入带 + -->
            <MoneyText
              :cents="amountCents(txn)"
              :type="amountType(txn)"
              :size="28"
              :weight="500"
              :color="amountColor(txn)"
            />
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
/**
 * 最近流水 —— 可复用的「按日期分组的交易列表」
 *
 * ★ 为什么单独抽出来 ★
 *   账户 / 分类 / 标签 / 预算 / 周期这 5 个详情页都需要同一块
 *   「最近流水 + 右上角全部 ›」，结构完全一样，只是筛选条件不同。
 *   抽出来以后，5 个详情页只管给数据，列表本身的样式只维护一份。
 *
 * ★ 展示规则 ★
 *   1. 按日期分组，组标题用 utils/date.js 的 formatDayHeader
 *      （返回「10月28日 周二」，今天/昨天/前天会带相对前缀）
 *   2. 总共显示 limit 条「交易」（不是 limit 个分组）
 *   3. 点某条交易 -> /pages/txn/detail?id=xxx
 *   4. 右上角「全部 ›」-> 抛 more 事件，由页面决定跳哪里
 */
import { computed } from 'vue'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import { formatDayHeader, formatTime } from '@/utils/date.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'

export default {
  name: 'RecentTxnList',
  components: { MoneyText, EmptyState },
  props: {
    /** 交易列表（已按时间倒序） */
    txns: { type: Array, default: () => [] },
    /** 加载中 */
    loading: { type: Boolean, default: false },
    /** 空态文案 */
    emptyText: { type: String, default: '这里还没有交易记录' },
    /** 是否显示右上角「全部 ›」 */
    showMore: { type: Boolean, default: false },
    /** 区块标题 */
    title: { type: String, default: '最近流水' },
    /** 最多显示多少条交易（不是多少个分组） */
    limit: { type: Number, default: 10 },
    /**
     * 当前视角账户 id
     *
     * 给了它，转账的方向才能算清楚：
     *   转出 = 负数（-），转入 = 正数（+）。
     * 不给则转账不显示正负号（用中性色）。
     */
    accountId: { type: String, default: '' }
  },
  emits: ['more'],
  setup(props, { emit }) {
    /** 截断到 limit 条 */
    const visibleTxns = computed(() => (props.txns || []).slice(0, props.limit))

    /**
     * 按日期分组
     *
     * 交易本身已经是按时间倒序的（接口 ORDER BY occurred_at DESC），
     * 所以只要按 occurred_day 归组，组内顺序天然就是对的。
     */
    const groups = computed(() => {
      const map = new Map()
      for (const txn of visibleTxns.value) {
        const day = txn.occurred_day || ''
        if (!map.has(day)) {
          map.set(day, { day, title: day ? formatDayHeader(day) : '', list: [] })
        }
        map.get(day).list.push(txn)
      }
      return Array.from(map.values())
    })

    /* ------------------------------------------------------ 展示内容 */

    /** 图标 */
    function iconChar(txn) {
      if (txn.type === 'transfer') return '⇄'
      return txn.category_icon
        ? iconEmoji(txn.category_icon)
        : guessIconByName(txn.category_name)
    }

    /** 图标背景色（分类色 + 浅色底；转账走中性变量） */
    function iconBgStyle(txn) {
      if (txn.type === 'transfer') {
        return { backgroundColor: 'var(--app-card-2)' }
      }
      const c = txn.category_color || '#969799'
      return { backgroundColor: c + '22' }
    }

    /** 图标前景色 */
    function iconFgStyle(txn) {
      if (txn.type === 'transfer') {
        return { color: 'var(--app-text-2)' }
      }
      return { color: txn.category_color || '#969799' }
    }

    /** 标题（分类名 / 转账对象） */
    function txnTitle(txn) {
      if (txn.type === 'transfer') {
        if (props.accountId) {
          return txn.account_id === props.accountId
            ? `转出至 ${txn.to_account_name || '-'}`
            : `来自 ${txn.account_name || '-'}`
        }
        return txn.to_account_name ? `转出至 ${txn.to_account_name}` : '转账'
      }
      return txn.category_name || '未分类'
    }

    /** 副标题：时间 · 账户 · 备注 */
    function txnSub(txn) {
      const parts = []
      if (txn.occurred_at) parts.push(formatTime(txn.occurred_at))
      if (txn.account_name) parts.push(txn.account_name)
      if (txn.note) parts.push(txn.note)
      return parts.join(' · ')
    }

    /** 金额（含符号）：转账按当前账户的视角算方向 */
    function amountCents(txn) {
      if (txn.type === 'transfer' && props.accountId) {
        return txn.account_id === props.accountId
          ? -Math.abs(txn.amount_cents)
          : Math.abs(txn.amount_cents)
      }
      return txn.amount_cents
    }

    /** 传给 MoneyText 的 type（决定 +/- 号） */
    function amountType(txn) {
      if (txn.type === 'transfer') {
        if (!props.accountId) return 'transfer'
        return amountCents(txn) < 0 ? 'expense' : 'income'
      }
      return txn.type
    }

    /** 金额颜色 */
    function amountColor(txn) {
      if (txn.type === 'transfer' && !props.accountId) return 'var(--app-text-2)'
      if (amountCents(txn) < 0) return 'var(--app-text)'
      return 'var(--app-success)'
    }

    /* ------------------------------------------------------ 交互 */

    function goDetail(id) {
      uni.navigateTo({ url: `/pages/txn/detail?id=${id}` })
    }

    function onMore() {
      emit('more')
    }

    return {
      visibleTxns, groups,
      iconChar, iconBgStyle, iconFgStyle,
      txnTitle, txnSub, amountCents, amountType, amountColor,
      goDetail, onMore
    }
  }
}
</script>

<style scoped>
/* 区块标题 */
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 32rpx;
  margin-bottom: 12rpx;
  padding: 0 4rpx;
}

.section-title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--app-text);
}

.section-more {
  font-size: 24rpx;
  color: var(--app-text-3);
}

/* 加载中 / 空态 */
.state-wrap {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 48rpx 0;
  text-align: center;
}

.state-text {
  font-size: 26rpx;
  color: var(--app-text-3);
}

.empty-wrap {
  background-color: var(--app-card);
  border-radius: 20rpx;
}

/* 日期分组 */
.group-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.day-title {
  font-size: 22rpx;
  color: var(--app-text-3);
  padding: 0 4rpx 10rpx;
  display: block;
}

.day-card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
}

.txn-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx 28rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.txn-item:last-child {
  border-bottom: none;
}

/* 图标 */
.txn-icon {
  width: 68rpx;
  height: 68rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.txn-icon-text {
  font-size: 26rpx;
  font-weight: 500;
}

/* 名称与副标题 */
.txn-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  min-width: 0;
}

.txn-name {
  font-size: 26rpx;
  color: var(--app-text);
}

.txn-sub {
  font-size: 20rpx;
  color: var(--app-text-3);
}
</style>
