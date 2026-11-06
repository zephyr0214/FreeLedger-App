<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <DetailShell title="账户详情" @back="goBack">
      <template #right>
        <text class="nav-action" @click="goEdit">编辑</text>
      </template>

      <template v-if="account">
        <!-- 余额头 -->
        <view class="balance-card">
          <view class="bal-head">
            <view class="bal-icon" :style="{ backgroundColor: (account.color || primaryColor) + '22' }">
              <!-- 预设图标 key 用 AccountIcon；没有图标就退回首字符 -->
              <AccountIcon
                v-if="account.icon"
                :name="account.icon"
                :size="26"
                :color="account.color || primaryColor"
              />
              <text
                v-else
                class="bal-icon-text"
                :style="{ color: account.color || primaryColor }"
              >
                {{ account.name.slice(0, 1) }}
              </text>
            </view>
            <view class="bal-info">
              <view class="bal-name-row">
                <text class="bal-name">{{ account.name }}</text>
              </view>
              <text class="bal-type">{{ account.typeName }}</text>
            </view>
          </view>

          <text class="bal-label">当前余额</text>
          <!--
            余额：不加颜色、不加符号（与账户页一致）。
            ★ 这里刻意不传 muted ★
              账户详情页是用户主动打开来看的，正文色最清楚；
              浅灰只用在「账户列表里区分不计入资产」，不用在这里。
          -->
          <view class="bal-amount-row">
            <MoneyText
              :cents="account.balance_cents"
              :size="80"
              :weight="600"
            />

            <!--
              「修改」入口：放在余额数字的右下角。

              ★ 为什么放这里而不是放右上角的「编辑」★
                「编辑」改的是账户资料（名字、类型、图标、颜色）。
                改余额是另一件事 —— 它动的是账（要么记一笔对账，
                要么改期初余额），口径必须让用户当场选。
                放在余额旁边，用户看到数字就能就地改，
                不用先想「编辑里是不是也能改余额」。

              ★ 组合账户没有余额，不显示这个入口 ★
            -->
            <text v-if="!account.isCombo" class="bal-edit-link" @click="openBalanceSheet">修改</text>
          </view>
          <!--
            ★ 这里原来有一整块「信用卡信息」（信用额度 / 已用额度进度条 / 还款日）★
              用户要求把信用卡的额度、账单日、还款日、卡号后四位整套删掉，
              不只是隐藏 —— 所以这块连同 usedPercent / repayCountdown
              两个 computed 一起删了（它们只服务这块 UI）。
              网络借贷沿用信用卡的条目，也就自然没有这一块了。
          -->
        </view>

        <!-- 本月收支 -->
        <view class="month-card">
          <view class="month-item">
            <text class="month-label">本月支出</text>
            <MoneyText :cents="monthStats.expense" type="expense" :size="32" :weight="500" />
          </view>
          <view class="month-divider" />
          <view class="month-item">
            <text class="month-label">本月收入</text>
            <MoneyText :cents="monthStats.income" type="income" :size="32" :weight="500" />
          </view>
        </view>

        <!-- 最近流水（按日期分组，10 条） -->
        <RecentTxnList
          :txns="txnList"
          :loading="loading"
          :account-id="accountId"
          empty-text="这个账户还没有交易记录"
          show-more
          @more="goAllTxn"
        />
      </template>

      <view v-else class="loading-wrap">
        <text class="loading-text">加载中…</text>
      </view>
    </DetailShell>

    <!--
      余额修改弹层

      ★ 入口在上面的「当前余额」右下角 ★
        改余额是「动账」，和「编辑」（改资料）是两件事，
        所以入口放在余额旁边，而不是塞进编辑页。

      ★ 弹层本体是共享组件 ★
        编辑页也用同一个 components/BalanceSheet.vue，
        两处的口径规则、差额预览、落库逻辑完全一致。
    -->
    <BalanceSheet
      v-model:visible="showBalanceSheet"
      :account-id="accountId"
      :current-balance-cents="account ? account.balance_cents : 0"
      @saved="onBalanceSaved"
    />

    <!-- 全局弹窗宿主（组件库重绘的确认框） -->
    <AppDialog />

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
/**
 * 账户详情 —— 详情页结构的样板
 *
 * ★ 结构 ★
 *   DetailShell（顶部导航 + 滚动区）
 *     余额卡
 *     本月收支卡
 *     RecentTxnList（按日期分组的最近流水 + 「全部 ›」）
 *
 * 分类 / 标签 / 预算 / 周期这 4 个详情页都照这个结构写。
 */
import { ref, computed } from 'vue'
import { onLoad, onShow, onBackPress } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import DetailShell from '@/components/DetailShell.vue'
import RecentTxnList from '@/components/RecentTxnList.vue'
import AccountIcon from '@/components/AccountIcon.vue'
import BalanceSheet from '@/components/BalanceSheet.vue'
import AppDialog from '@/components/AppDialog.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { listTransactions, sumTransactions } from '@/api/transaction.js'
import { toMonthKey } from '@/utils/date.js'
import { backAfterAccountDelete } from '@/utils/navBack.js'
import { handleBackPress } from '@/utils/layerStack.js'

export default {
  components: { MoneyText, DetailShell, RecentTxnList, AccountIcon, BalanceSheet, AppDialog, UpdateDialog },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    const accountId = ref('')
    const account = ref(null)
    const txnList = ref([])
    const monthStats = ref({ expense: 0, income: 0 })
    const loading = ref(false)

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    async function load() {
      const acc = await accountStore.getById(accountId.value)
      /*
       * ★ 账户没了（被删掉）→ 回账户列表，而不是留在这个页面 ★
       *   以前这里直接 return，页面就停在「加载中…」——
       *   用户删完账户返回时看到一片空白，不知道发生了什么。
       *
       *   现在：账户不存在（getById 返回 null）就走安全回退。
       *   ★ 为什么不能在 onShow 里也用 backAfterAccountDelete ★
       *     详情页是用户主动进来的，只有「账户真的没了」才该退；
       *     正常返回时 onShow 也会跑一遍 load()，那时账户还在，什么都不做。
       */
      if (!acc) {
        uni.showToast({ title: '账户已被删除', icon: 'none' })
        setTimeout(() => backAfterAccountDelete(), 300)
        return
      }
      // ★ 组合账户没有详情页（无流水、无余额）★
      //   万一被直接跳到（历史入口/分享链接），重定向到编辑页，
      //   避免本页用「无余额」渲染出奇怪的详情。
      if (acc.isCombo) {
        uni.redirectTo({ url: `/pages/account/edit?id=${accountId.value}` })
        return
      }
      account.value = acc

      loading.value = true
      try {
        // 只取最近 10 条：RecentTxnList 按日期分组后也是显示这 10 条
        const [list, sum] = await Promise.all([
          listTransactions({ accountId: accountId.value, limit: 10 }),
          sumTransactions({ accountId: accountId.value, monthKey: toMonthKey() })
        ])
        txnList.value = list
        monthStats.value = { expense: sum.expense, income: sum.income }
      } finally {
        loading.value = false
      }
    }

    function goEdit() {
      uni.navigateTo({ url: `/pages/account/edit?id=${accountId.value}` })
    }

    /* ------------------------------------------------------ 余额弹层 */

    /** 余额修改弹层是否显示 */
    const showBalanceSheet = ref(false)

    /** 打开余额弹层（入口在「当前余额」右下角） */
    function openBalanceSheet() {
      showBalanceSheet.value = true
    }

    /**
     * 弹层改完余额
     *
     * ★ 要重新拉一次账户 ★
     *   余额变了，头部的大数字要跟着变；
     *   「修改」是唯一改余额的入口，所以这里重新 load() 一次就够了。
     */
    async function onBalanceSaved() {
      await load()
    }

    /**
     * 「全部 ›」-> 交易列表，并带上账户筛选条件
     *
     * URL 契约见 api/transaction.js 的 parseTxnQueryOptions：
     *   ?accountId=acc_xxx 按账户筛选
     */
    function goAllTxn() {
      uni.navigateTo({ url: `/pages/txn/list?accountId=${accountId.value}` })
    }

    function goBack() {
      uni.navigateBack()
    }

    // 用 onLoad(options) 取参数，比 getCurrentPages().options 可靠
    onLoad(async (options) => {
      accountId.value = (options && options.id) || ''
      if (!settingStore.loaded) await settingStore.load()
      await accountStore.load()
      if (accountId.value) await load()
    })

    onShow(async () => {
      settingStore.syncSystemTheme()
      if (accountId.value && settingStore.loaded) {
        await accountStore.refresh()
        await load()
      }
    })

    // 侧滑返回 / 返回键：有弹层先收起弹层，不退出页面
    onBackPress(() => handleBackPress())

    return {
      settingStore, accountId, account, txnList, monthStats, loading,
      primaryColor, pageStyle,
      showBalanceSheet, openBalanceSheet, onBalanceSaved,
      goEdit, goAllTxn, goBack
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

/* 余额卡 */
.balance-card {
  background: linear-gradient(135deg, var(--app-hero-from), var(--app-card));
  border-radius: 24rpx;
  padding: 32rpx;
  margin-top: 16rpx;
  box-shadow: var(--app-shadow);
}

.bal-head {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-bottom: 32rpx;
}

.bal-icon {
  width: 88rpx;
  height: 88rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.bal-icon-text {
  font-size: 36rpx;
  font-weight: 600;
}

.bal-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.bal-name-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.bal-name {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.bal-type {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.bal-label {
  font-size: 24rpx;
  color: var(--app-text-3);
  display: block;
  margin-bottom: 8rpx;
}

/*
 * 余额行：金额 + 右下角的「修改」
 *
 * ★ 为什么用 flex 而不是让 MoneyText 独占一行 ★
 *   「修改」要贴在金额数字的**右下角**（用户明确要求的位置），
 *   所以金额和按钮必须在同一行里，垂直方向底部对齐。
 *   align-items: flex-end 让小字按钮和大数字的底边对齐，
 *   视觉上就是「数字右下角挂一个小链接」。
 */
.bal-amount-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16rpx;
}

.bal-edit-link {
  font-size: 26rpx;
  color: var(--app-primary);
  font-weight: 500;
  padding: 8rpx 0 8rpx 16rpx;
  flex-shrink: 0;
}

/* 本月 */
.month-card {
  display: flex;
  align-items: center;
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 28rpx 0;
  margin-top: 20rpx;
}

.month-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.month-label {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.month-divider {
  width: 1rpx;
  height: 48rpx;
  background-color: var(--app-line);
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
