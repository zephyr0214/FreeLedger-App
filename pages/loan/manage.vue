<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <!--
      标题随类型变化：借出管理 / 借入管理

      ★ 右上角不再有「记一笔」★
        用户要求去掉。这一页现在回答的是「谁欠我多少」，
        不是「记流水」；要记一笔走首页的记账面板，
        在管理页再摆一个入口只会让两种入口抢注意力。
    -->
    <PageNav :title="pageTitle" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
      <!--
        汇总卡：只保留「现在还有多少钱在外面」这一个结论

        ★ 为什么不再显示「累计借出 / 借款收回 / 累计笔数」★
          那三项是「全部流水」视角的指标，而这页现在是按人看账：
          用户真正要的是「还有多少人没还清、一共多少钱」。
          累计数在统计页和交易列表里都能看到，这里重复三行只是噪音。
      -->
      <view class="summary-card">
        <view class="summary-head">
          <view class="summary-icon" :style="{ backgroundColor: accentColor + '22' }">
            <text class="summary-icon-text">{{ headEmoji }}</text>
          </view>
          <view class="summary-info">
            <text class="summary-name">{{ currentLabel }}</text>
            <text class="summary-type">{{ directionText }}</text>
          </view>
        </view>

        <MoneyText :cents="openTotal" :type="loanType" :size="64" :weight="600" />

        <view class="summary-rows">
          <view class="summary-row">
            <text class="summary-row-label">未结清人数</text>
            <text class="summary-row-value">{{ openCount }} 人</text>
          </view>
          <view class="summary-row">
            <text class="summary-row-label">已结清人数</text>
            <text class="summary-row-value">{{ settledCount }} 人</text>
          </view>
        </view>
      </view>

      <!--
        未结清 / 已结清

        ★ 复用全局分段切换（App.vue 的 .seg-toggle）★
          用户要求「复用年月日和自定义的 tab 切换组件」——
          就是记账/筛选里那套 `.seg-toggle` + `.seg-item`，
          不是另写一套 tab，否则同一批控件在 App 里会有三种长相。
      -->
      <view class="seg-toggle seg-toggle--block status-toggle">
        <text
          v-for="s in statusTabs"
          :key="s.key"
          class="seg-item"
          :class="{ active: status === s.key }"
          @click="switchStatus(s.key)"
        >{{ s.name }}（{{ s.key === 'open' ? openCount : settledCount }}）</text>
      </view>

      <!-- 空态 -->
      <view v-if="!loading && people.length === 0" class="empty-wrap">
        <EmptyState
          :emoji="headEmoji"
          :title="emptyTitle"
          :desc="emptyDesc"
        />
      </view>

      <!--
        人员列表：按金额从高到低

        ★ 排序口径在 api/loan.js 里 ★
          未结清在前、再按 |余额| 降序。这里不再排一遍 ——
          两处各排一次，迟早会出现「列表顺序和汇总对不上」。
      -->
      <view v-else class="person-list">
        <view v-for="p in people" :key="p.person" class="person-card">
          <!--
            一行：人名 + 余额
            点整行进明细（谁、什么时候、多少），
            结清按钮只在借出方向、且未结清时出现。
          -->
          <view class="person-head" @click="openDetail(p)">
            <view class="person-avatar" :style="{ backgroundColor: accentColor + '22' }">
              <text class="person-avatar-text" :style="{ color: accentColor }">{{ avatarText(p.person) }}</text>
            </view>

            <view class="person-info">
              <text class="person-name ellipsis">{{ p.person }}</text>
              <text class="person-sub">{{ personSub(p) }}</text>
            </view>

            <view class="person-amount">
              <text
                class="person-balance"
                :style="{ color: balanceColor(p) }"
              >{{ balanceText(p) }}</text>
              <text class="person-balance-label">{{ balanceLabel(p) }}</text>
            </view>
          </view>

          <!--
            ★ 手动结清：只有借出方向、只有未结清时才出现 ★
              用户明确要求「借入不显示未平衡逻辑」——
              借入的钱是「我欠别人」，怎么结清取决于对方，
              在这里给一个按钮反而会让人以为可以替对方销账。
          -->
          <view v-if="canSettle(p)" class="person-actions">
            <text class="settle-btn" :style="{ borderColor: accentColor, color: accentColor }" @click.stop="onSettle(p)">手动结清</text>
          </view>
        </view>

        <view class="bottom-space" />
      </view>
    </scroll-view>

    <!--
      人员明细弹层

      ★ 为什么用弹层而不是跳交易列表 ★
        交易列表按「分类」筛，筛不出「某个人」——
        人名存在备注入里，列表页没有按备注过滤的入口。
        而这里的明细天然只有这一个人十几条，弹层足够了。
    -->
    <wd-popup
      v-model="showDetail"
      position="bottom"
      :z-index="100"
      :safe-area-inset-bottom="true"
      custom-style="background-color: var(--app-card); border-radius: 28rpx 28rpx 0 0;"
    >
      <view class="detail-sheet">
        <view class="detail-head">
          <text class="detail-title">{{ detailPerson }}</text>
          <text class="detail-close" @click="showDetail = false">关闭</text>
        </view>
        <scroll-view class="detail-scroll" scroll-y>
          <view v-for="t in detailTxns" :key="t.id" class="detail-row" @click="goTxnDetail(t.id)">
            <view class="detail-left">
              <text class="detail-cat">{{ t.category_name || '未分类' }}</text>
              <text class="detail-day">{{ t.occurred_day }} · {{ t.account_name || '无账户' }}</text>
            </view>
            <MoneyText :cents="t.amount_cents" :type="t.type" :size="26" />
          </view>
          <view v-if="detailTxns.length === 0" class="detail-empty">
            <text class="detail-empty-text">没有流水</text>
          </view>
        </scroll-view>
      </view>
    </wd-popup>

    <!-- 全局弹窗宿主 -->
    <AppDialog />

    <!-- 更新弹窗 -->
    <UpdateDialog />
  </view>
</template>

<script>
/**
 * 借入 / 借出管理
 *
 *   onLoad 读 ?type=expense（借出）| income（借入），默认 expense。
 *
 * ★ 这一页的口径：按「人」看账，不按流水看账 ★
 *   用户原来看到的是「全部流水 / 借出 / 借款收回」三个 tab 的流水列表，
 *   但真正想知道的是「谁还欠我多少」。所以：
 *     · 上面切 未结清 / 已结清
 *     · 下面一人一行，金额 = Σ借出 - Σ借款收回（借入方向相反）
 *     · 一行内部的差额恰好为 0 就算已结清，不存状态字段
 *   聚合逻辑全在 api/loan.js，页面只负责展示。
 *
 * ★ 人员就是备注（note）★
 *   借入借出六类的备注存的是人名，管理页按 note 分组。
 *   不建人员表：既少一次迁移，也不会出现「人员表和流水对不上」。
 *
 * ★ 手动结清只在借出方向 ★
 *   差额 > 0（对方少还）→ 支出「借出坏账」
 *   差额 < 0（对方多还）→ 收入「借出利息」
 *   两笔由 api/loan.js 自动写，计入收支、不占预算。
 */
import { ref, computed, watch } from 'vue'
import { onLoad, onShow, onBackPress } from '@dcloudio/uni-app'
import PageNav from '@/components/PageNav.vue'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppDialog from '@/components/AppDialog.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import {
  LOAN_DIRECTIONS,
  listLoanByPerson,
  listLoanTxnsOfPerson,
  settleLendPerson
} from '@/api/loan.js'
import { handleBackPress, pushLayer } from '@/utils/layerStack.js'
import { alertDialog, confirmDialog } from '@/utils/dialog.js'

/** 收入方向的图标底色（真实 hex，用来拼 `+ '22'` 半透明） */
const INCOME_COLOR = '#07C160'

export default {
  components: { PageNav, MoneyText, EmptyState, AppDialog, UpdateDialog },
  setup() {
    const settingStore = useSettingStore()

    /** 'expense' = 借出管理，'income' = 借入管理 */
    const loanType = ref('expense')

    /** 'open' 未结清 / 'settled' 已结清 */
    const status = ref('open')

    const loading = ref(true)
    /** 当前 tab 下的人员列表（已按金额排好序） */
    const people = ref([])
    /** 两个 tab 的人数（汇总卡要用，所以两边都要算） */
    const openCount = ref(0)
    const settledCount = ref(0)
    const openTotal = ref(0)

    const showDetail = ref(false)
    const detailPerson = ref('')
    const detailTxns = ref([])

    /** 首屏加载完成后，onShow 才需要再刷一次（避免和 onLoad 重复加载） */
    let ready = false

    const pageStyle = computed(() => settingStore.cssVars)
    const primaryColor = computed(() => settingStore.primaryColor)

    const isIncome = computed(() => loanType.value === 'income')
    const direction = computed(() =>
      isIncome.value ? LOAN_DIRECTIONS.borrow : LOAN_DIRECTIONS.lend
    )

    const pageTitle = computed(() => (isIncome.value ? '借入管理' : '借出管理'))
    const headEmoji = computed(() => (isIncome.value ? '📥' : '📤'))
    const currentLabel = computed(() => (isIncome.value ? '当前借入' : '当前借出'))
    const directionText = computed(() =>
      isIncome.value ? '还欠别人多少' : '还有多少没收回来'
    )

    /**
     * 汇总卡图标底色
     *
     * ★ 必须是真实 hex ★
     *   下面用 `accentColor + '22'` 拼半透明底色，
     *   拼在 CSS 变量上会得到 `var(--app-success)22` 这种非法值，底色直接消失。
     */
    const accentColor = computed(() => (isIncome.value ? INCOME_COLOR : primaryColor.value))

    const statusTabs = [
      { key: 'open', name: '未结清' },
      { key: 'settled', name: '已结清' }
    ]

    const emptyTitle = computed(() =>
      status.value === 'open'
        ? (isIncome.value ? '没有未结清的借入' : '没有未结清的借出')
        : '还没有结清的记录'
    )
    const emptyDesc = computed(() =>
      status.value === 'open'
        ? (isIncome.value ? '向别人借的钱、还没还的部分会列在这里' : '借出去还没收回的钱会列在这里')
        : '一笔账收付相等之后，这个人会自动出现在这里'
    )

    /** 头像里显示的第一个字（没有名字时用「?」兜底） */
    function avatarText(name) {
      const s = String(name || '').trim()
      return s ? s.slice(0, 1) : '?'
    }

    /** 副标题：笔数 · 最近一次往来 */
    function personSub(p) {
      const parts = [`${p.count} 笔`]
      if (p.lastDay) parts.push(`最近 ${p.lastDay}`)
      return parts.join(' · ')
    }

    /**
     * 余额文案
     *
     * ★ 借出和借入的符号一样、含义相反 ★
     *   借出：正数 = 对方还欠我
     *   借入：正数 = 我还欠对方（余额口径同样是「主方向 - 反向」）
     *   两边的数字都是「未结清金额」，只是叙述方向不同，
     *   所以标签分开写，数字不必变号 —— 变号会让用户以为算错了。
     */
    function balanceText(p) {
      const v = Math.abs(p.balance)
      const yuan = (v / 100).toFixed(2)
      return `¥${yuan}`
    }

    function balanceLabel(p) {
      if (p.settled) return '已结清'
      return isIncome.value ? '待归还' : '待收回'
    }

    /** 余额颜色：结清走次要色，未结清走主题色/绿色 */
    function balanceColor(p) {
      return p.settled ? 'var(--app-text-3)' : accentColor.value
    }

    /** 只有借出方向、且还有差额时才给「手动结清」 */
    function canSettle(p) {
      return !isIncome.value && !p.settled && p.balance !== 0
    }

    /**
     * 加载人员列表
     *
     * ★ 两个 tab 的人数都要算 ★
     *   汇总卡要显示「未结清 N 人 / 已结清 M 人」，
     *   只查当前 tab 的话另一个数字永远是 0。
     *   一次 all 查回来在 JS 里分两边，比查两次省一趟 SQL。
     */
    async function load() {
      loading.value = true
      try {
        const all = await listLoanByPerson(direction.value, 'all')
        const open = all.filter((p) => !p.settled)
        const settled = all.filter((p) => p.settled)

        openCount.value = open.length
        settledCount.value = settled.length
        /*
         * 「当前借出 / 当前借入」= 所有未结清余额之和
         *
         * ★ 用 balance 而不是 total - back ★
         *   balance 已经把「借出坏账 / 借出利息」算进去了
         *   （结清过的那些人的余额正好抵消为 0），
         *   直接用 total-back 会把已经核销的坏账又算成欠款。
         */
        openTotal.value = open.reduce((acc, p) => acc + Math.abs(p.balance), 0)

        people.value = status.value === 'open' ? open : settled
      } catch (e) {
        console.warn('[loan] 加载人员账目失败:', e && e.message)
        people.value = []
        openCount.value = 0
        settledCount.value = 0
        openTotal.value = 0
      } finally {
        loading.value = false
      }
    }

    function switchStatus(key) {
      if (status.value === key) return
      status.value = key
      load()
    }

    /** 打开人员明细 */
    async function openDetail(p) {
      detailPerson.value = p.person
      detailTxns.value = []
      showDetail.value = true
      try {
        detailTxns.value = await listLoanTxnsOfPerson(direction.value, p.person)
      } catch (e) {
        detailTxns.value = []
      }
    }

    function goTxnDetail(id) {
      showDetail.value = false
      uni.navigateTo({ url: `/pages/txn/detail?id=${id}` })
    }

    /**
     * 手动结清
     *
     * ★ 不输入金额，差额自动算 ★
     *   用户原话「肯定是自动计算了，多还了的，少还了的还算不出来吗」。
     *   所以这里只做二次确认 + 说明会生成哪一笔：
     *     余额 > 0 → 「还差 ¥x 收不回来，记为借出坏账」
     *     余额 < 0 → 「多还了 ¥x，记为借出利息」
     *   确认后由 api/loan.js 写库，写完刷新列表（这个人会落到已结清）。
     */
    async function onSettle(p) {
      const diff = p.balance
      const yuan = (Math.abs(diff) / 100).toFixed(2)

      /*
       * ★ 余额已经是 0 就不该走到这里 ★
       *   列表是按 settled 分好的，理论不会出现；
       *   但用户可能在别处删了一笔，弹层数据是旧的 ——
       *   这时提示刷新，而不是写一笔 0 元流水（金额必须 > 0，会保存失败）。
       */
      if (diff === 0) {
        await alertDialog({ title: '已经是结清状态', content: '刷新一下列表再试' })
        load()
        return
      }

      const isBadDebt = diff > 0
      const content = isBadDebt
        ? `还有 ¥${yuan} 收不回来，将记为「借出坏账」支出，计入收支。`
        : `对方多还了 ¥${yuan}，将记为「借出利息」收入，计入收支。`
      const ok = await confirmDialog({
        title: isBadDebt ? '确认记为坏账？' : '确认记为利息？',
        content,
        confirmText: '确认结清',
        cancelText: '取消'
      })
      if (!ok) return

      try {
        await settleLendPerson(p.person)
        uni.showToast({ title: '已结清', icon: 'success' })
        await load()
      } catch (e) {
        await alertDialog({ title: '结清失败', content: e.message || '请稍后重试' })
      }
    }

    /*
     * 明细弹层登记到弹层栈
     *
     * ★ 不登记的话侧滑返回会直接退出整个页面 ★
     *   用户只是想关掉「张三的明细」，结果回到了「我的」页 ——
     *   这个坑在记账面板（TxnPanel）和其它弹层上都踩过，
     *   所以凡是自己画的 wd-popup 都要 pushLayer（见 utils/layerStack.js）。
     */
    let unregisterDetail = null
    watch(showDetail, (open) => {
      if (open) {
        if (!unregisterDetail) {
          unregisterDetail = pushLayer(() => { showDetail.value = false }, 'loanPersonDetail')
        }
        return
      }
      if (unregisterDetail) {
        unregisterDetail()
        unregisterDetail = null
      }
    })

    function goBack() {
      uni.navigateBack()
    }

    onLoad(async (options) => {
      const raw = String((options && options.type) || '').toLowerCase()
      loanType.value = raw === 'income' ? 'income' : 'expense'

      if (!settingStore.loaded) await settingStore.load()
      await load()
      ready = true
    })

    onShow(async () => {
      settingStore.syncSystemTheme()
      if (ready) await load()
    })

    // 侧滑返回 / 物理返回键：明细弹层打开时先收起弹层，不退出本页
    onBackPress(() => handleBackPress())

    return {
      settingStore, loanType, status, loading, people, openCount, settledCount, openTotal,
      pageStyle, primaryColor, isIncome, pageTitle, headEmoji, currentLabel, directionText,
      accentColor, statusTabs, emptyTitle, emptyDesc,
      showDetail, detailPerson, detailTxns,
      avatarText, personSub, balanceText, balanceLabel, balanceColor, canSettle,
      switchStatus, openDetail, goTxnDetail, onSettle, goBack
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

/* 汇总卡：与其它详情页同一套渐变 + 阴影 */
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
  margin-bottom: 28rpx;
}

.summary-icon {
  width: 88rpx;
  height: 88rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.summary-icon-text {
  font-size: 40rpx;
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

/* ------------------------------------------------- 未结清 / 已结清 切换 */

/*
 * 只补外距，外观全部来自 App.vue 的全局 .seg-toggle
 * ★ 不在这里重写底色/圆角 ★
 *   一旦这里覆盖，分段控件又会和记账页、筛选条长得不一样 ——
 *   那正是这轮要消灭的问题。
 */
.status-toggle {
  margin: 24rpx 0 8rpx;
}

/* ------------------------------------------------------- 人员卡片 */

.person-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 16rpx;
}

.person-card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 20rpx 24rpx;
  box-shadow: var(--app-shadow);
}

.person-head {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

/* 头像：名字首字，主题色 13% 底 */
.person-avatar {
  width: 76rpx;
  height: 76rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.person-avatar-text {
  font-size: 30rpx;
  font-weight: 600;
}

.person-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.person-name {
  font-size: 30rpx;
  font-weight: 500;
  color: var(--app-text);
}

.person-sub {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.person-amount {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
  flex-shrink: 0;
}

.person-balance {
  font-size: 32rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.person-balance-label {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* 操作区：右对齐一个描边按钮 */
.person-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid var(--app-line);
}

.settle-btn {
  font-size: 24rpx;
  padding: 8rpx 24rpx;
  border-radius: 16rpx;
  border: 1rpx solid;
  background-color: transparent;
}

/* ------------------------------------------------------- 明细弹层 */

.detail-sheet {
  padding: 24rpx 0 12rpx;
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 32rpx 20rpx;
}

.detail-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.detail-close {
  font-size: 26rpx;
  color: var(--app-text-3);
}

.detail-scroll {
  max-height: 60vh;
}

.detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 20rpx 32rpx;
  border-top: 1rpx solid var(--app-line);
}

.detail-left {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  min-width: 0;
  flex: 1;
}

.detail-cat {
  font-size: 28rpx;
  color: var(--app-text);
}

.detail-day {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.detail-empty {
  padding: 60rpx 0;
  display: flex;
  justify-content: center;
}

.detail-empty-text {
  font-size: 26rpx;
  color: var(--app-text-3);
}

/* 空态卡片 */
.empty-wrap {
  background-color: var(--app-card);
  border-radius: 20rpx;
  margin-top: 16rpx;
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
