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

          <text class="summary-label">单次金额</text>
          <MoneyText :cents="cycle.amount_cents" :size="72" :weight="600" color="var(--app-text)" />

          <view class="summary-rows">
            <view class="summary-row">
              <text class="summary-row-label">已记笔数</text>
              <text class="summary-row-value">{{ totalCount }} 笔</text>
            </view>
            <view class="summary-row">
              <text class="summary-row-label">账户</text>
              <text class="summary-row-value">{{ accountName }}</text>
            </view>
            <!-- 总金额 = 单次金额 × 已记笔数，支出带 - / 收入带 + / 转账不带符号。
                 没有记录时（总金额 0）不带符号，避免出现「+¥0.00」这种怪显示 -->
            <view class="summary-row">
              <text class="summary-row-label">总金额</text>
              <MoneyText
                :cents="totalCents"
                :type="totalCount > 0 ? cycle.type : ''"
                :size="26"
                :color="totalColor"
              />
            </view>
          </view>

          <view class="summary-actions">
            <view class="record-btn" :style="{ backgroundColor: primaryColor }" @click="onRecord">
              <text class="record-btn-text">记一笔</text>
            </view>
          </view>
        </view>

        <RecentTxnList
          :txns="txnList"
          :loading="loading"
          empty-text="这个周期还没有记过账"
          show-more
          hide-cycle-tag
          @more="goAllTxn"
        />
      </template>

      <view v-else class="loading-wrap">
        <text class="loading-text">{{ notFound ? '这个周期不存在或已被删除' : '加载中…' }}</text>
      </view>
    </DetailShell>
  </view>
</template>

<script>
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import DetailShell from '@/components/DetailShell.vue'
import RecentTxnList from '@/components/RecentTxnList.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import {
  getCycle, listRecentCycleTxns, countCycleTxns, recordCycle, recurrenceLabel
} from '@/api/cycle.js'
import { listCategories } from '@/api/category.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'
import { alertDialog } from '@/utils/dialog.js'

export default {
  components: { MoneyText, DetailShell, RecentTxnList },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

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

    /** 总金额颜色：支出深色 / 收入绿色 / 转账中性（与全 App 流水金额一致） */
    const totalColor = computed(() => {
      const t = cycle.value && cycle.value.type
      if (t === 'income') return 'var(--app-success)'
      if (t === 'expense') return 'var(--app-text)'
      return 'var(--app-text-2)'
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

    async function onRecord() {
      try {
        await recordCycle(cycleId.value)
        uni.showToast({ title: '已记一笔', icon: 'success' })
        await load()
      } catch (e) {
        await alertDialog({ title: '记账失败', content: e.message })
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
      totalCents, totalColor,
      onRecord, goAllTxn, goBack
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

.summary-actions {
  margin-top: 28rpx;
}

.record-btn {
  height: 80rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.record-btn-text {
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
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
