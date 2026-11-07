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
              <view class="txn-name-row">
                <text class="txn-name ellipsis">{{ txnTitle(txn) }}</text>
              </view>
              <!-- 徽标：周期 / 组合账户 / 标签，统一描边胶囊，全部跟在分类名下面 -->
              <view v-if="txnBadges(txn).length" class="txn-tag-list">
                <text
                  v-for="t in txnBadges(txn)"
                  :key="t.key"
                  class="txn-tag"
                  :style="{ backgroundColor: t.bg, color: t.color, borderColor: t.border }"
                >{{ t.name }}</text>
              </view>
              <text class="txn-sub ellipsis">{{ txnSub(txn) }}</text>
            </view>

            <!-- 金额：符号与颜色全部交给 MoneyText 的统一规则
                 （支出 -、收入 +、转账浅灰、0 无符号无色） -->
            <MoneyText
              :cents="amountCents(txn)"
              :type="amountType(txn)"
              :sign="amountSign(txn)"
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
import { computed, ref, onMounted, watch } from 'vue'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import { formatDayHeader, formatTime } from '@/utils/date.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'
import { listTags } from '@/api/tag.js'
import { isLoanPersonCategory } from '@/api/loan.js'
import { useSettingStore } from '@/stores/setting.js'

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
    accountId: { type: String, default: '' },
  },
  emits: ['more'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const primaryColor = computed(() => settingStore.primaryColor)
    /** 组合账户徽标的固定颜色（独立标记，不是标签色） */
    const COMBO_BADGE_COLOR = '#8B5CF6'
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

    /* ------------------------------------------------------ 标签 */

    /**
     * 标签表缓存。
     *
     * ★ 为什么要在这里自己读 ★
     *   交易行只存 tag_ids，要显示「名字 + 自己的颜色」必须反查标签表。
     *   首页和全部交易页各自都做了这件事，这个公共列表组件之前缺了，
     *   所以详情页的最近流水一直看不到标签。
     *
     * ★ 只读一次 ★
     *   标签是低频变更的小表，组件挂载时读一次即可；
     *   流水刷新（props.txns 变化）不需要重读标签。
     */
    const tags = ref([])

    async function loadTags() {
      try {
        tags.value = await listTags()
      } catch (e) {
        tags.value = []
      }
    }

    onMounted(loadTags)
    // 标签在别处被改动后回到本页（如标签管理），重新进来时补一次
    watch(() => props.txns, () => {
      if (tags.value.length === 0) loadTags()
    })

    /** id -> { name, color } 映射 */
    const tagNameMap = computed(() => {
      const m = {}
      for (const t of tags.value) m[t.id] = { name: t.name, color: t.color || '' }
      return m
    })

    /**
     * 一笔交易的「徽标」集合：周期 / 组合账户 / 用户标签，按固定顺序。
     * 样式统一描边胶囊（见 .txn-tag），全部跟在分类名下面。
     */
    function txnBadges(txn) {
      const list = []
      // 周期（所有用到 RecentTxnList 的详情页都展示，包括周期详情页）
      if (txn.cycle_id) {
        const c = primaryColor.value
        list.push({ key: '__cycle__', name: '周期', color: c, bg: c + '22', border: c })
      }
      // 组合账户（独立标记，不是标签）
      if (txn.via_combo_id) {
        list.push({ key: '__combo__', name: '组合账户', color: COMBO_BADGE_COLOR, bg: COMBO_BADGE_COLOR + '22', border: COMBO_BADGE_COLOR })
      }
      /*
       * ★ 借入借出的「人员」也渲染成徽标（用户要求）★
       *   这六类的备注存的就是人名，但它在业务上不是「备注」而是「谁」——
       *   直接当普通副标题文字混在「12:30 · 现金 · 张三」里，
       *   用户根本注意不到这笔是记在谁头上的。
       *   所以单独提成一个胶囊，和标签同样的视觉分量，一眼就能扫到。
       *
       * ★ 只是「显示成 tag」，不写 tag 表 ★
       *   用户明确要求不加标签记录：这些名字是流水的属性，
       *   写进 tag 表会污染标签统计（「项目统计」里凭空多出人名）。
       */
      if (txn && txn.note && isLoanPersonCategory(txn.category_name)) {
        const c = primaryColor.value
        list.push({ key: '__person__', name: txn.note, color: c, bg: c + '22', border: c })
      }

      // 用户标签
      const ids = txn && txn.tag_ids
      if (ids && ids.length) {
        for (const id of ids) {
          const t = tagNameMap.value[id]
          if (!t) continue
          const c = t.color || 'var(--app-text-2)'
          const bd = t.color || 'var(--app-text-3)'
          list.push({ key: id, name: t.name, color: c, bg: t.color ? t.color + '22' : 'var(--app-card-2)', border: bd })
        }
      }
      return list
    }

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
        // ★ 账户被删除后 account_name 为空 —— 显示「无账户」而不是 '-' ★
        if (props.accountId) {
          return txn.account_id === props.accountId
            ? `转出至 ${txn.to_account_name || '无账户'}`
            : `来自 ${txn.account_name || '无账户'}`
        }
        return txn.to_account_name ? `转出至 ${txn.to_account_name}` : '转账'
      }
      return txn.category_name || '未分类'
    }

    /** 副标题：时间 · 账户 · 备注 */
    function txnSub(txn) {
      const parts = []
      if (txn.occurred_at) parts.push(formatTime(txn.occurred_at))
      // ★ 账户被删除后 account_name 为空 —— 显示「无账户」 ★
      if (txn.type === 'transfer') {
        parts.push(txn.to_account_name ? `转出至 ${txn.to_account_name}` : '转账')
      } else {
        parts.push(txn.account_name || '无账户')
      }
      /*
       * ★ 人员类流水的 note 不再重复出现在副标题 ★
       *   它已经在上面作为胶囊显示了，这里再来一遍就是同一个名字出现两次。
       */
      if (txn.note && !isLoanPersonCategory(txn.category_name)) parts.push(txn.note)
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

    /**
     * 传给 MoneyText 的 type（决定 +/- 号）。
     *
     * ★ 转账一律返回 'transfer' ★
     *   即便在账户视角下（知道转出/转入方向），也保持 transfer：
     *   符号按方向在 amountCents 里已经算好（负/正），
     *   而配色要的是「转账统一浅灰」，不能因为方向被染成红或绿。
     *   以前这里在账户视角下返回 expense/income，转账就被着色了，
     *   和用户要求的「转账用浅灰」冲突。
     */
    function amountType(txn) {
      if (txn.type === 'transfer') return 'transfer'
      return txn.type
    }

    /**
     * 转账在账户视角下是否需要显示正负号。
     *
     * ★ 为什么单独一个开关 ★
     *   type='transfer' 时 MoneyText 默认不加符号（转账本来不算收支），
     *   但在某个账户的流水里，「转出」和「转入」必须能一眼分清，
     *   所以有账户视角时强制显示符号（负 = 转出，正 = 转入）。
     *   非转账的情况货币符号交给 type 决定，这里一律 false。
     */
    function amountSign(txn) {
      return !!(txn.type === 'transfer' && props.accountId)
    }

    /**
     * 金额颜色。
     *
     * ★ 全部交给 MoneyText 的统一规则 ★
     *   支出无色 / 收入绿色 / 0 无色 / 转账浅灰。
     *   以前这里对转账写死了 var(--app-text-2)，
     *   和别处的浅灰不是一个色值，暗色下也不一致；
     *   现在统一走 variant 的 muted 语义（--app-muted）。
     */
    function amountColor() {
      return 'auto'
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
      txnTitle, txnSub, txnBadges, amountCents, amountType, amountSign, amountColor,
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

.txn-name-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
}

.txn-name {
  font-size: 26rpx;
  color: var(--app-text);
}

/**
 * 徽标：周期 / 组合账户 / 标签统一成同一种「描边胶囊」。
 * 颜色、内容可不同，但边框描边、圆角、字号、内边距一致。
 * color / background-color / border-color 由模板内联覆盖（见 txnBadges）。
 * 这里只是「标签没设颜色」时的中性灰兜底。
 */
.txn-tag-list {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6rpx;
  min-width: 0;
}

.txn-tag {
  flex-shrink: 0;
  font-size: 18rpx;
  line-height: 1;
  padding: 4rpx 10rpx;
  border-radius: 8rpx;
  color: var(--app-text-2);
  background-color: var(--app-card-2);
  border: 1rpx solid var(--app-text-3);
  font-weight: 500;
}

.txn-sub {
  font-size: 20rpx;
  color: var(--app-text-3);
}
</style>
