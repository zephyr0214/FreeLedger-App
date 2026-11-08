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

        <view v-if="badges.length" class="row">
          <text class="row-label">标记</text>
          <view class="row-tags">
            <view
              v-for="b in badges"
              :key="b.key"
              class="tag-chip"
              :style="{ backgroundColor: b.bg, color: b.color, borderColor: b.border }"
            >
              <text class="tag-text" :style="{ color: b.color }">{{ b.name }}</text>
            </view>
          </view>
        </view>

        <view v-if="txn.note" class="row row-column">
          <text class="row-label">备注</text>
          <text class="row-note">{{ txn.note }}</text>
        </view>
      </view>

      <!--
        不计入预算 ｜ 待报销（只有支出才有意义）

        ★ 本轮用户第 1 条要求 ★
          不要再显示「报销与预算」这种标题，也不要那行说明小字；
          直接一条竖分割线，左边「不计入预算」、右边「待报销」，视觉居中。
          所以下面只剩【一行】，头部/说明已整体删掉。
        ★ 本轮用户第 3 条要求 ★
          勾「待报销」→「不计入预算」自动勾上且不可点；
          取消「待报销」→ 「不计入预算」一起取消并恢复可点。
          联动规则只写在 ExcludeFlags 组件里（三处调用点共用）。
        ★ 已报销（status=2）★
          「待报销」显示成「已报销」并锁死 ——
          待报销 → 已报销只能去「报销管理」页完成。
      -->
      <view v-if="txn.type === 'expense'" class="detail-card">
        <view class="row flags-row">
          <ExcludeFlags
            :exclude-budget="excludeFromBudget"
            :reimburse-status="reimburseStatus"
            :can-reimburse="txn.type === 'expense'"
            :done-locked="reimburseStatus === 2"
            :reimburse-disabled="reimburseDisabled"
            @update="onFlagsUpdate"
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

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
import { ref, computed } from 'vue'
import { onLoad, onShow, onBackPress } from '@dcloudio/uni-app'
import MoneyText from '@/components/MoneyText.vue'
import ExcludeFlags from '@/components/ExcludeFlags.vue'
import { handleBackPress } from '@/utils/layerStack.js'
import TxnPanel from '@/components/TxnPanel.vue'
import AppDialog from '@/components/AppDialog.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { getTransaction, deleteTransaction, getTxnTags, setExcludeFromBudget } from '@/api/transaction.js'
import { isSystemPresetName } from '@/api/category.js'
import { setTxnPendingReimburse } from '@/api/reimburse.js'
import { formatDayHeader, formatTime } from '@/utils/date.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'
import { buildTxnBadges } from '@/utils/txnBadges.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'

export default {
  components: { MoneyText, ExcludeFlags, TxnPanel, AppDialog, UpdateDialog },
  setup() {
    const settingStore = useSettingStore()
    const txnStore = useTransactionStore()

    const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20
    const txnId = ref('')
    const txn = ref(null)
    const tags = ref([])
    /** 标记徽标：周期 / 组合账户 / 用户标签，统一描边胶囊样式 */
    const badges = ref([])
    const showPanel = ref(false)
    const loadingText = ref('加载中…')

    const primaryColor = computed(() => settingStore.primaryColor)
    /** 组合账户徽标的固定颜色（独立标记，不是标签色） */
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

    /**
     * 报销状态：0 不报销 / 1 待报销 / 2 已报销
     *
     * ★ 已报销要锁死 ★
     *   钱已经到账、坏账/盈余也记好了，这时再取消「待报销」
     *   会让台账和账户余额对不上，所以只读。
     */
    const reimburseStatus = computed(() => Number(txn.value && txn.value.reimburse_status) || 0)

    /**
     * 「待报销」是否被禁用（用户本轮第 5 条）
     *
     * ★ 系统固定分类下的支出不能报销 ★
     *   借出 / 借入 / 对账这类是资金往来，不是消费。
     *   详情页是唯一能事后改标记的地方，这里不挡的话，
     *   用户可以在 AI 记错的借款上勾「待报销」，那笔就会永远挂在报销清单里。
     * ★ 判定用分类名 + type（isSystemPresetName）★
     *   和分类管理页「固定分类不可删改」是同一份名单，不依赖分类 id。
     */
    const reimburseDisabled = computed(() => {
      const t = txn.value
      if (!t || !t.category_name) return false
      return isSystemPresetName(t.category_name, t.type)
    })

    async function load() {
      try {
        const t = await getTransaction(txnId.value)
        if (!t) {
          loadingText.value = '这笔记录不存在或已删除'
          return
        }
        txn.value = t

        /*
         * ★ 徽标顺序唯一来源：utils/txnBadges.js（用户第 1 条）★
         *   用户标签 > 人员名称 > 待报销/已报销 > 周期 > 组合账户 > 不计收支
         *   以前这里手写了一份顺序（周期最前、标签最后），
         *   和列表页、首页都不一样 —— 同一笔账换个页面标签就换了顺序。
         */
        const all = t.tag_ids && t.tag_ids.length > 0 ? await getTxnTags(t.id) : []
        tags.value = all
        const tagMap = {}
        for (const tg of all) tagMap[tg.id] = { name: tg.name, color: tg.color || '' }
        badges.value = buildTxnBadges(t, {
          primaryColor: primaryColor.value,
          tagMap
        })
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
    /**
     * 双选框变化
     *
     * ★ 为什么要分两次调用 ★
     *   「待报销」要用 api/reimburse.js 的 setTxnPendingReimburse
     *   （它要连两个 exclude 标记一起改、还要校验类型和分类）；
     *   只改「不计入预算」用 transaction.js 的 setExcludeFromBudget。
     *   合成一把接口反而会让两边的校验互相打架。
     */
    async function onFlagsUpdate(next) {
      const t = txn.value
      if (!t) return
      try {
        if (next.reimburseStatus !== reimburseStatus.value) {
          if (next.reimburseStatus === 1) {
            await setTxnPendingReimburse(t.id, true)
            uni.showToast({ title: '已标记待报销', icon: 'none' })
          } else {
            await setTxnPendingReimburse(t.id, false)
            uni.showToast({ title: '已取消待报销', icon: 'none' })
          }
        } else if (next.excludeBudget !== excludeFromBudget.value) {
          await setExcludeFromBudget(t.id, next.excludeBudget)
          uni.showToast({
            title: next.excludeBudget ? '已不计入预算' : '已恢复计入预算',
            icon: 'none'
          })
        }
        await load()
        txnStore.loadHome(true)
      } catch (err) {
        await alertDialog({ title: '设置失败', content: err.message })
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
      settingStore, statusBarHeight, txn, tags, badges, showPanel, loadingText,
      primaryColor, pageStyle, typeLabel, iconChar,
      dayLabel, timeLabel, excludeFromBudget,
      onEdit, onSaved, onDelete, goBack,
      reimburseStatus, reimburseDisabled, onFlagsUpdate
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

/*
 * 「不计入预算 ｜ 待报销」那一行
 *
 * ★ 本轮用户第 1 条 ★
 *   删掉标题和说明小字后，这一行就是「一条竖分割线居中两栏」。
 *   用 .row 复用卡片里其它行的高度/背景/上下边框，
 *   内部横向居中交给 ExcludeFlags 自己（它 flex:1 + justify-content:center）。
 */
.flags-row {
  justify-content: center;
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
  border: 1rpx solid transparent;
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
