<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <DetailShell :title="cycle ? cycleName : '周期详情'" @back="goBack">
      <template v-if="cycle">
        <view class="summary-card">
          <view class="summary-head">
            <view class="summary-icon" :style="{ backgroundColor: iconColor }">
              <text class="summary-icon-text">{{ cycle.iconChar }}</text>
            </view>
            <view class="summary-info">
              <text class="summary-name">{{ cycleName }}</text>
              <text class="summary-type">{{ typeName }} · {{ cycle.recurrenceText }}</text>
            </view>
          </view>

          <text class="summary-label">总支出</text>
          <MoneyText
            :cents="totalCents"
            :type="totalCount > 0 ? cycle.type : ''"
            :size="72"
            :weight="600"
            :color="totalColor"
          />

          <!--
            ★ 下方小条目 ★
              单次金额 / 总笔数 / 扣款账户 / 最近一次已扣款时间 / 最近一次将扣款时间
            「总支出」放在大数字位置（单次 × 已记笔数），
            其余都是围绕它的补充说明。
          -->
          <view class="summary-rows">
            <view class="summary-row">
              <text class="summary-row-label">单次金额</text>
              <MoneyText
                :cents="cycle.amount_cents"
                :type="cycle.type"
                :size="26"
              />
            </view>
            <view class="summary-row">
              <text class="summary-row-label">总笔数</text>
              <text class="summary-row-value">{{ totalCount }} 笔</text>
            </view>
            <view class="summary-row">
              <text class="summary-row-label">扣款账户</text>
              <text class="summary-row-value">{{ accountName }}</text>
            </view>
            <view class="summary-row">
              <text class="summary-row-label">最近一次已扣款</text>
              <text class="summary-row-value">{{ lastChargedText }}</text>
            </view>
            <view class="summary-row">
              <text class="summary-row-label">最近一次将扣款</text>
              <text class="summary-row-value">{{ nextChargeText }}</text>
            </view>
          </view>
        </view>

        <RecentTxnList
          :txns="txnList"
          :loading="loading"
          empty-text="这个周期还没有记过账"
          show-more
          @more="goAllTxn"
        />
      </template>

      <view v-else class="loading-wrap">
        <text class="loading-text">{{ notFound ? '这个周期不存在或已被删除' : '加载中…' }}</text>
      </view>
    </DetailShell>

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import DetailShell from '@/components/DetailShell.vue'
import RecentTxnList from '@/components/RecentTxnList.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import {
  getCycle, listRecentCycleTxns, countCycleTxns, recurrenceLabel, nextOccurrence
} from '@/api/cycle.js'
import { listCategories } from '@/api/category.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'

export default {
  components: { MoneyText, DetailShell, RecentTxnList, UpdateDialog },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    /**
     * YYYY-MM-DD → 「2026年10月30日」
     *
     * 不直接显示 ISO 日期：中文界面里「2026-10-30」读起来像参数，
     * 而且和周期列表里「下次于 2026年11月1日」的写法不一致。
     */
    function formatYmd(day) {
      if (!day) return ''
      const [y, m, d] = String(day).split('-').map(Number)
      if (!y || !m || !d) return String(day)
      return `${y}年${m}月${d}日`
    }

    const cycleId = ref('')
    const cycle = ref(null)
    const txnList = ref([])
    const totalCount = ref(0)
    const loading = ref(false)
    const notFound = ref(false)
    const categories = ref([])

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    const typeName = computed(() => {
      const t = cycle.value && cycle.value.type
      return t === 'income' ? '收入' : t === 'transfer' ? '转账' : '支出'
    })

    const cycleName = computed(() => {
      const c = cycle.value
      if (!c) return ''
      if (c.type === 'transfer') {
        const from = accountStore.list.find((a) => a.id === c.account_id)
        const to = accountStore.list.find((a) => a.id === c.to_account_id)
        return `${from ? from.name : '账户'} → ${to ? to.name : '账户'}`
      }
      const cat = categories.value.find((x) => x.id === c.category_id)
      return cat ? cat.name : '未分类'
    })

    const iconColor = computed(() => {
      const c = cycle.value
      if (!c) return primaryColor.value
      if (c.type === 'transfer') return '#7D5FFF'
      const cat = categories.value.find((x) => x.id === c.category_id)
      return (cat && cat.color) || primaryColor.value
    })

    const cycleIconChar = computed(() => {
      const c = cycle.value
      if (!c) return '❔'
      if (c.type === 'transfer') return '⇄'
      const cat = categories.value.find((x) => x.id === c.category_id)
      return cat && cat.icon ? iconEmoji(cat.icon) : guessIconByName(cat ? cat.name : '')
    })

    const accountName = computed(() => {
      const c = cycle.value
      if (!c) return ''
      const acc = accountStore.list.find((a) => a.id === c.account_id)
      return acc ? acc.name : '未选择'
    })

    /** 总金额 = 单次金额 × 已记笔数 */
    const totalCents = computed(() => {
      const c = cycle.value
      if (!c) return 0
      return (Number(c.amount_cents) || 0) * totalCount.value
    })

    /**
     * 最近一次「已扣款」时间。
     *
     * listCycleTxns 按 occurred_at 倒序返回，第一条就是最近一笔；
     * 直接读它的 occurred_day，比再查一次 MAX(occurred_day) 省一次往返。
     * 还没有任何流水时显示占位文案，不要留空。
     */
    const lastChargedText = computed(() => {
      const first = txnList.value && txnList.value[0]
      if (!first || !first.occurred_day) return '暂无记录'
      return formatYmd(first.occurred_day)
    })

    /** 最近一次「将扣款」时间（下一次触发日，含今天） */
    const nextChargeText = computed(() => {
      const c = cycle.value
      if (!c) return '—'
      try {
        const next = nextOccurrence(c)
        return next ? formatYmd(next) : '—'
      } catch (e) {
        return '—'
      }
    })

    /**
     * 总金额颜色。
     *
     * ★ 交给 MoneyText 的统一规则 ★
     *   支出无色 / 收入绿色 / 转账中性 / 0 无色，
     *   全 App 一套规则，这里不再各自维护色值。
     *   唯一的例外是转账：它不是收支，用中性色。
     */
    const totalColor = computed(() => {
      const t = cycle.value && cycle.value.type
      if (t === 'transfer') return 'var(--app-text-2)'
      return 'auto'
    })

    // 把派生字段挂到 cycle 上，供模板直接读
    const cycleView = computed(() => {
      if (!cycle.value) return null
      return Object.assign({}, cycle.value, {
        iconChar: cycleIconChar.value,
        recurrenceText: recurrenceLabel(cycle.value)
      })
    })

    async function load() {
      const c = await getCycle(cycleId.value)
      if (!c) {
        cycle.value = null
        notFound.value = true
        return
      }
      cycle.value = c
      notFound.value = false
      loading.value = true
      try {
        const [list, cats, cnt] = await Promise.all([
          listRecentCycleTxns(cycleId.value),
          listCategories(),
          countCycleTxns(cycleId.value)
        ])
        txnList.value = list
        categories.value = cats
        totalCount.value = cnt
      } catch (e) {
        console.warn('[cycle-detail] load failed', e)
      } finally {
        loading.value = false
      }
    }

    function goAllTxn() {
      uni.navigateTo({ url: `/pages/txn/list?cycleId=${cycleId.value}` })
    }

    function goBack() {
      uni.navigateBack()
    }

    onLoad(async (options) => {
      cycleId.value = (options && options.id) || ''
      if (!settingStore.loaded) await settingStore.load()
      if (!accountStore.loaded) await accountStore.load()
      if (cycleId.value) await load()
    })

    onShow(async () => {
      settingStore.syncSystemTheme()
      if (cycleId.value && settingStore.loaded) await load()
    })

    return {
      settingStore, cycle: cycleView, txnList, totalCount, loading, notFound, pageStyle,
      typeName, cycleName, iconColor, accountName, primaryColor,
      totalCents, totalColor, lastChargedText, nextChargeText,
      goAllTxn, goBack
    }
  }
}
</script>

<style scoped>
.summary-card {
  background: linear-gradient(135deg, var(--app-hero-from), var(--app-card));
  border-radius: 24rpx;
  padding: 32rpx;
  margin-top: 16rpx;
}

.summary-head {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-bottom: 28rpx;
}

.summary-icon {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.summary-icon-text {
  font-size: 28rpx;
  color: #fff;
  font-weight: 500;
}

.summary-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  min-width: 0;
}

.summary-name {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.summary-type {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.summary-label {
  font-size: 24rpx;
  color: var(--app-text-3);
  display: block;
  margin-bottom: 8rpx;
}

.summary-rows {
  margin-top: 24rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid var(--app-line);
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.summary-row-label {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.summary-row-value {
  font-size: 26rpx;
  color: var(--app-text-2);
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
