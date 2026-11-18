<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <DetailShell :title="cycle ? cycleName : '周期详情'" @back="goBack">
      <template v-if="cycle">
        <view class="summary-card">
          <view class="summary-head">
            <DetailSummaryIcon
              :icon="cycle.icon"
              :name="cycle.iconName"
              :symbol="cycle.iconSymbol"
              :color="iconColor"
            />
            <view class="summary-info">
              <text class="summary-name">{{ cycleName }}</text>
              <text class="summary-type">{{ typeName }} · {{ cycle.recurrenceText }}</text>
            </view>
          </view>

          <text class="summary-label">总结余</text>
          <MoneyText
            :cents="summary.balance"
            variant="balance"
            :size="72"
            :weight="600"
          />

          <!--
            ★ 下方小条目（用户本轮第 2 条）★
              总支出 / 总收入 / 总笔数 / 时间范围
            全部来自实际流水（getCycleTxnSummary），
            不再用「单次金额 × 笔数」推算。
          -->
          <view class="summary-rows">
            <view class="summary-row">
              <text class="summary-row-label">总支出</text>
              <MoneyText
                :cents="summary.expense"
                type="expense"
                :size="26"
              />
            </view>
            <view class="summary-row">
              <text class="summary-row-label">总收入</text>
              <MoneyText
                :cents="summary.income"
                type="income"
                :size="26"
              />
            </view>
            <view class="summary-row">
              <text class="summary-row-label">总笔数</text>
              <text class="summary-row-value">{{ summary.count }} 笔</text>
            </view>
            <view class="summary-row">
              <text class="summary-row-label">时间范围</text>
              <text class="summary-row-value">{{ rangeText }}</text>
            </view>
          </view>
        </view>

        <RecentTxnList
          :txns="txnList"
          :loading="loading"
          empty-text="这个周期还没有记过账"
          show-more
          show-footer-more
          :total-count="summary.count"
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
import DetailSummaryIcon from '@/components/DetailSummaryIcon.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import {
  getCycle, listRecentCycleTxns, getCycleTxnSummary, recurrenceLabel
} from '@/api/cycle.js'
import { listCategories } from '@/api/category.js'
import { chineseDayLabel } from '@/utils/date.js'

export default {
  components: { MoneyText, DetailShell, RecentTxnList, UpdateDialog, DetailSummaryIcon },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    const cycleId = ref('')
    const cycle = ref(null)
    const txnList = ref([])
    /**
     * 实际流水汇总
     *
     * ★ 不再用「单次金额 × 笔数」★
     *   周期金额改过 / 外币模板 / 单笔被改过金额时，推算值会和流水对不上。
     *   这里的数据直接来自 txn 表，和「全部」列表同源。
     */
    const summary = ref({
      count: 0,
      income: 0,
      expense: 0,
      balance: 0,
      firstDay: '',
      lastDay: ''
    })
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

    const cycleIcon = computed(() => {
      const c = cycle.value
      if (!c) return { symbol: '❔', icon: '', name: '' }
      if (c.type === 'transfer') return { symbol: '⇄', icon: '', name: '' }
      const cat = categories.value.find((x) => x.id === c.category_id)
      return { symbol: '', icon: cat ? cat.icon : '', name: cat ? cat.name : '' }
    })

    /**
     * 时间范围：最早一条到最晚一条记录
     *
     * 没有任何流水时显示「暂无记录」，不要拼出「 - 」这种空区间。
     */
    const rangeText = computed(() => {
      const s = summary.value
      if (!s.firstDay || !s.lastDay) return '暂无记录'
      return `${chineseDayLabel(s.firstDay)} - ${chineseDayLabel(s.lastDay)}`
    })

    // 把派生字段挂到 cycle 上，供模板直接读
    const cycleView = computed(() => {
      if (!cycle.value) return null
      return Object.assign({}, cycle.value, {
        icon: cycleIcon.value.icon,
        iconName: cycleIcon.value.name,
        iconSymbol: cycleIcon.value.symbol,
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
        const [list, cats, sum] = await Promise.all([
          listRecentCycleTxns(cycleId.value),
          listCategories(),
          getCycleTxnSummary(cycleId.value)
        ])
        txnList.value = list
        categories.value = cats
        summary.value = sum
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
      settingStore, cycle: cycleView, txnList, summary, loading, notFound, pageStyle,
      typeName, cycleName, iconColor, primaryColor, rangeText,
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
