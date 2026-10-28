<template>
  <view class="cycle-list">
    <!-- 空态 -->
    <view v-if="cycles.length === 0" class="empty-wrap">
      <EmptyState
        emoji="🔁"
        title="还没有周期性支出"
        desc="添加房租、订阅、话费这类每隔一段时间要交的钱"
        compact
      />
    </view>

    <!-- 周期列表 -->
    <view v-else class="list-card">
      <view
        v-for="c in cycles"
        :key="c.id"
        class="cycle-item"
        :class="{ disabled: !c.enabled }"
        @click="onItemTap(c)"
      >
        <!-- 图标 -->
        <view class="cycle-icon">
          <text class="cycle-icon-text">{{ c.icon || '🔁' }}</text>
        </view>

        <!-- 名称 + 周期描述 + 下次扣款日 -->
        <view class="cycle-main">
          <view class="cycle-title-row">
            <text class="cycle-name">{{ c.name }}</text>
            <text v-if="!c.enabled" class="cycle-off">已停用</text>
          </view>
          <text class="cycle-desc">{{ describe(c) }}</text>
          <text v-if="c.nextDate" class="cycle-next">下次 {{ nextLabel(c.nextDate) }}</text>
          <text v-if="c.note" class="cycle-note">{{ c.note }}</text>
        </view>

        <!-- 金额 + 操作 -->
        <view class="cycle-right">
          <MoneyText :cents="c.amountCents" :size="30" :weight="500" color="var(--app-text)" />
          <view class="cycle-ops">
            <text class="cycle-op" @click.stop="onToggle(c)">{{ c.enabled ? '停用' : '启用' }}</text>
            <text class="cycle-op" @click.stop="onEdit(c)">编辑</text>
            <text class="cycle-op danger" @click.stop="onDelete(c)">删除</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
/**
 * 周期列表 —— 可复用的展示组件
 *
 * ★ 为什么单独抽出来 ★
 *   周期管理页（pages/settings/cycle.vue）只是它的一个壳子，
 *   后面还要把它套进「账户详情页」那种详情页布局里。
 *   所以这里只负责：
 *     1. 渲染周期列表
 *     2. 把「点整行 / 切换启用 / 编辑 / 删除」的意图抛给父组件
 *   数据的读写、编辑弹层都由父组件负责。
 *
 * 周期数据结构（见 api/settings.js 的 normalizeCycle）：
 *   {
 *     id, name, amountCents, icon, cycleType, interval,
 *     dayOfMonth, weekday, nextDate, accountId, enabled, note
 *   }
 *   cycleType: monthly（每月） | weekly（每周） | yearly（每年） | custom（自定义）
 */
import EmptyState from '@/components/EmptyState.vue'
import MoneyText from '@/components/MoneyText.vue'
import { parseDayKey, relativeDayLabel } from '@/utils/date.js'

/** 周几的中文名（1 = 周一 … 7 = 周日） */
const WEEKDAY_CN = ['', '一', '二', '三', '四', '五', '六', '日']

export default {
  name: 'CycleList',
  components: { EmptyState, MoneyText },
  props: {
    /** 周期数组 */
    cycles: { type: Array, default: () => [] }
  },
  emits: ['item-tap', 'item-toggle', 'item-edit', 'item-delete'],
  setup(props, { emit }) {
    /**
     * 周期的一句话描述
     *
     * monthly 每月 8 号
     * weekly  每周一
     * yearly  每年 3 月 15 日
     * custom  每 2 个月
     */
    function describe(c) {
      if (!c) return ''
      if (c.cycleType === 'weekly') {
        return `每周${WEEKDAY_CN[c.weekday] || '一'}`
      }
      if (c.cycleType === 'yearly') {
        return `每年 ${c.monthOfYear || 1} 月 ${c.dayOfMonth} 号`
      }
      if (c.cycleType === 'custom') {
        return `每 ${c.interval} 个月`
      }
      return `每月 ${c.dayOfMonth} 号`
    }

    /** 下次扣款日：今天就显示「今天」，否则显示「M月D日」 */
    function nextLabel(nextDate) {
      if (!nextDate) return ''
      const rel = relativeDayLabel(nextDate)
      if (rel) return rel
      try {
        const d = parseDayKey(nextDate)
        return `${d.getMonth() + 1}月${d.getDate()}日`
      } catch (e) {
        return nextDate
      }
    }

    function onItemTap(c) {
      emit('item-tap', c)
    }

    function onToggle(c) {
      emit('item-toggle', c)
    }

    function onEdit(c) {
      emit('item-edit', c)
    }

    function onDelete(c) {
      emit('item-delete', c)
    }

    return { describe, nextLabel, onItemTap, onToggle, onEdit, onDelete }
  }
}
</script>

<style scoped>
.cycle-list {
  width: 100%;
}

.empty-wrap {
  background-color: var(--app-card);
  border-radius: 20rpx;
}

.list-card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
}

.cycle-item {
  display: flex;
  align-items: flex-start;
  gap: 20rpx;
  padding: 28rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.cycle-item:last-child {
  border-bottom: none;
}

.cycle-item.disabled {
  opacity: 0.55;
}

/* 图标 */
.cycle-icon {
  width: 68rpx;
  height: 68rpx;
  border-radius: 50%;
  background-color: var(--app-primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.cycle-icon-text {
  font-size: 32rpx;
}

/* 名称与描述 */
.cycle-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.cycle-title-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.cycle-name {
  font-size: 28rpx;
  font-weight: 500;
  color: var(--app-text);
}

.cycle-off {
  font-size: 20rpx;
  color: var(--app-text-3);
  background-color: var(--app-card-2);
  border-radius: 8rpx;
  padding: 2rpx 10rpx;
}

.cycle-desc {
  font-size: 23rpx;
  color: var(--app-text-2);
}

.cycle-next {
  font-size: 21rpx;
  color: var(--app-text-3);
}

.cycle-note {
  font-size: 21rpx;
  color: var(--app-text-3);
}

/* 金额与操作 */
.cycle-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10rpx;
  flex-shrink: 0;
}

.cycle-ops {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.cycle-op {
  font-size: 22rpx;
  color: var(--app-primary);
}

.cycle-op.danger {
  color: var(--app-danger);
}
</style>
