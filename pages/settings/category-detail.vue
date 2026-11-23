<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <DetailShell :title="category ? category.name : '分类详情'" @back="goBack">
      <template v-if="category">
        <!-- 汇总卡：本月支出/收入 + 笔数 + 占比 -->
        <view class="summary-card">
          <view class="summary-head">
            <DetailSummaryIcon
              :icon="category.icon"
              :name="category.name"
              :color="categoryColor"
            />
            <view class="summary-info">
              <text class="summary-name">{{ category.name }}</text>
              <text class="summary-type">
                {{ category.type === 'income' ? '收入分类' : '支出分类' }}
                <text v-if="isParent"> · 含二级分类</text>
              </text>
            </view>
          </view>

          <text class="summary-label">本月{{ statWord }}</text>
          <MoneyText
            :cents="monthAmount"
            :type="statType"
            :size="72"
            :weight="600"
          />

          <!--
            ★ 下方小条目 ★
              本月笔数 / 本月占比 / 总金额 / 总笔数 / 总占比

            ★ 文案与口径跟着分类方向走（本轮修复）★
              用户反馈：「收入详情页显示的应该是本月收入、总收入，
              怎么显示的支出」——
              原来这一整块写死了「支出」两个字和 monthStats.expense，
              收入分类点进来也显示「本月支出」，数字当然还是 0。
              现在 statWord 在支出分类下是「支出」、收入分类下是「收入」，
              金额、占比分子分母也全部跟着 category.type 取对应方向。

            ★ 占比的分母必须同方向 ★
              「本月收入占比」= 本分类本月收入 / 全部收入分类本月收入。
              用支出总额当分母会算出 >100% 或极小值，两个方向各查各的。
          -->
          <view class="summary-rows">
            <view class="summary-row">
              <text class="summary-row-label">本月笔数</text>
              <text class="summary-row-value">{{ monthStats.count }} 笔</text>
            </view>
            <view class="summary-row">
              <text class="summary-row-label">本月{{ statWord }}占比</text>
              <text class="summary-row-value">{{ sharePercent }}%</text>
            </view>
            <view class="summary-row">
              <text class="summary-row-label">总{{ statWord }}</text>
              <MoneyText :cents="totalAmount" :type="statType" :size="26" />
            </view>
            <view class="summary-row">
              <text class="summary-row-label">总笔数</text>
              <text class="summary-row-value">{{ totalStats.count }} 笔</text>
            </view>
            <view class="summary-row">
              <text class="summary-row-label">总{{ statWord }}占比</text>
              <text class="summary-row-value">{{ totalSharePercent }}%</text>
            </view>
          </view>
        </view>

        <!-- 最近流水 -->
        <RecentTxnList
          :txns="txnList"
          :loading="loading"
          empty-text="这个分类本月还没有交易"
          show-more
          show-footer-more
          :total-count="totalStats.count"
          @more="goAllTxn"
        />
      </template>

      <view v-else class="loading-wrap">
        <text class="loading-text">{{ notFound ? '这个分类不存在或已被删除' : '加载中…' }}</text>
      </view>
    </DetailShell>

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
/**
 * 分类详情 —— 结构参考 pages/account/detail.vue
 *
 *   DetailShell（标题 = 分类名）
 *     汇总卡（本月金额 + 笔数 + 占比，文案与口径跟着分类方向走）
 *     本月收支卡
 *     RecentTxnList（按日期分组的最近流水 + 「全部 ›」）
 *
 * ★ 一级 / 二级分类的差别 ★
 *   汇总卡与流水都按「该分类 + 它的所有二级」统计，
 *   所以二级分类点进来时只看它自己，一级分类点进来时看整个分类族。
 */
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import DetailShell from '@/components/DetailShell.vue'
import RecentTxnList from '@/components/RecentTxnList.vue'
import DetailSummaryIcon from '@/components/DetailSummaryIcon.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { getCategory } from '@/api/category.js'
import { listTransactions, sumTransactions } from '@/api/transaction.js'
import { toMonthKey } from '@/utils/date.js'

export default {
  components: { MoneyText, DetailShell, RecentTxnList, UpdateDialog, DetailSummaryIcon },
  setup() {
    const settingStore = useSettingStore()

    const categoryId = ref('')
    const category = ref(null)
    const txnList = ref([])
    const monthStats = ref({ expense: 0, income: 0, count: 0 })
    /** 本月同方向的全部金额（支出分类=本月总支出，收入分类=本月总收入），占比分母 */
    const monthTotal = ref(0)
    /**
     * 全部时间（不限月份）的本分类统计与同方向总额，
     * 用于「总支出 / 总收入 / 总笔数 / 总占比」。
     */
    const totalStats = ref({ expense: 0, income: 0, count: 0 })
    const allTotal = ref(0)
    const loading = ref(false)
    /** 已经加载完但没找到这个分类（被删了 / id 不对） */
    const notFound = ref(false)

    const pageStyle = computed(() => settingStore.cssVars)

    /** 一级分类（没有 parent_id） */
    const isParent = computed(() => !!category.value && !category.value.parent_id)

    const categoryColor = computed(() =>
      (category.value && category.value.color) || '#969799'
    )

    /**
     * 这个分类是收入还是支出
     *
     * ★ 全页文案和数字都由它决定（本轮修复）★
     *   用户反馈收入详情页显示的是「本月支出」。
     *   根因是这一整页写死了 expense 字段和「支出」两个字 ——
     *   收入分类的 expense 恒为 0，于是大数字永远是 0.00。
     */
    const statType = computed(() =>
      category.value && category.value.type === 'income' ? 'income' : 'expense'
    )

    /** 「支出」/「收入」两个字，拼进各条小条目的文案 */
    const statWord = computed(() => (statType.value === 'income' ? '收入' : '支出'))

    /** 本分类本月金额（方向跟着分类走） */
    const monthAmount = computed(() =>
      statType.value === 'income' ? monthStats.value.income : monthStats.value.expense
    )

    /** 本分类全部时间金额（方向跟着分类走） */
    const totalAmount = computed(() =>
      statType.value === 'income' ? totalStats.value.income : totalStats.value.expense
    )

    /** 该分类本月金额占同方向本月总额的百分比 */
    const sharePercent = computed(() => {
      const total = monthTotal.value
      if (!total) return 0
      return Math.round((monthAmount.value / total) * 1000) / 10
    })

    /** 该分类全部金额占同方向全部总额的百分比（不限月份） */
    const totalSharePercent = computed(() => {
      const total = allTotal.value
      if (!total) return 0
      return Math.round((totalAmount.value / total) * 1000) / 10
    })

    async function load() {
      const cat = await getCategory(categoryId.value)
      if (!cat) {
        category.value = null
        notFound.value = true
        return
      }
      category.value = cat
      notFound.value = false

      loading.value = true
      try {
        /*
         * ★ 占比的分母必须和分子同方向（本轮修复）★
         *   收入分类拿「全部支出」当分母会算出 >100% 或 0%，
         *   所以分母查询带上 type —— 支出分类查支出总额、
         *   收入分类查收入总额。
         */
        const listType = statType.value
        const [list, sum, monthAll, totalSum, allTotalSum] = await Promise.all([
          /*
           * 列表不加 type 过滤 —— 一个分类只会挂同方向的流水，
           * 加 type 是重复条件；万一有历史脏数据，过滤反而让流水消失。
           */
          listTransactions({
            categoryId: categoryId.value,
            includeSubcategories: isParent.value,
            limit: 50
          }),
          sumTransactions({
            categoryId: categoryId.value,
            includeSubcategories: isParent.value,
            monthKey: toMonthKey()
          }),
          sumTransactions({ monthKey: toMonthKey(), type: listType }),
          // 不限月份：本分类的全部金额 / 总笔数
          sumTransactions({
            categoryId: categoryId.value,
            includeSubcategories: isParent.value
          }),
          // 不限月份：全部分类的同方向金额（占比分母）
          sumTransactions({ type: listType })
        ])
        txnList.value = list
        monthStats.value = {
          expense: sum.expense,
          income: sum.income,
          count: sum.count
        }
        monthTotal.value =
          listType === 'income' ? monthAll.income : monthAll.expense
        totalStats.value = {
          expense: totalSum.expense,
          income: totalSum.income,
          count: totalSum.count
        }
        allTotal.value =
          listType === 'income' ? allTotalSum.income : allTotalSum.expense
      } finally {
        loading.value = false
      }
    }

    /**
     * 「全部 ›」-> 交易列表
     *
     * URL 契约（见 api/transaction.js 的 parseTxnQueryOptions）：
     *   ?categoryId=cat_xxx           按分类筛选
     *   ?includeSubcategories=1       categoryId 是一级分类时，匹配其所有二级
     *
     * ★ 一级分类要带 includeSubcategories=1 ★
     *   一级分类本身往往没有直接挂在它上面的交易（都在二级上），
     *   不带这个参数会看到空列表。
     *   二级分类就精确匹配自己，不用带。
     */
    function goAllTxn() {
      const url = isParent.value
        ? `/pages/txn/list?categoryId=${categoryId.value}&includeSubcategories=1`
        : `/pages/txn/list?categoryId=${categoryId.value}`
      uni.navigateTo({ url })
    }

    function goBack() {
      uni.navigateBack()
    }

    onLoad(async (options) => {
      categoryId.value = (options && options.id) || ''
      if (!settingStore.loaded) await settingStore.load()
      if (categoryId.value) await load()
    })

    onShow(async () => {
      settingStore.syncSystemTheme()
      if (categoryId.value && settingStore.loaded) await load()
    })

    return {
      settingStore, category, txnList, monthStats, totalStats, loading, notFound,
      pageStyle, isParent, categoryColor,
      statType, statWord, monthAmount, totalAmount,
      sharePercent, totalSharePercent,
      goAllTxn, goBack
    }
  }
}
</script>

<style scoped>
.nav-action {
  font-size: 28rpx;
  color: var(--app-primary);
  text-align: right;
}

/* 汇总卡 */
.summary-card {
  background: linear-gradient(135deg, var(--app-hero-from), var(--app-card));
  border-radius: 24rpx;
  padding: 32rpx;
  margin-top: 16rpx;
  box-shadow: var(--app-shadow);
}

.summary-head {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-bottom: 32rpx;
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
  margin-top: 28rpx;
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
