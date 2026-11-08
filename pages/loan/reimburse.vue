<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <!--
      报销管理

      ★ 两个 tab 现在是两套读法 ★
        待报销 = 流水列表（还没成为一张单）：右滑单笔报销、长按多选批量报销。
        已报销 = 报销单卡片列表（v23 起）：一次报销就是一张单，
                 单头是「什么时候报的 / 报到哪个账户 / 实报多少」，
                 单里是被报销的那几笔 + 自动生成的到账/坏账/盈余。

      ★ 右上角「报销」只在多选模式出现 ★
        日常是「右滑单条报销」，批量时才是「勾几条一起报销」。
        两种入口都留着，但一次只让用户看见一个 ——
        右下角常驻一个「报销」按钮会和右滑手势打架（用户不知道该用哪个）。
    -->
    <PageNav title="报销管理" @back="goBack">
      <template #right>
        <text v-if="selectMode" class="nav-done" @click="onBatchReimburse">报销</text>
        <text v-else-if="pendingCount > 0" class="nav-done" @click="toggleSelectMode">多选</text>
      </template>
    </PageNav>

    <scroll-view class="page-scroll" scroll-y>
      <!--
        汇总卡（复用借入借出管理页那套）

        ★ 只放「待报销」的两个数 ★
          用户打开这一页 90% 是为了「还有多少钱没报下来」，
          已报销总额是历史数据，放在下面的 tab 里看就够了。
      -->
      <view class="summary-card">
        <view class="summary-head">
          <view class="summary-icon" :style="{ backgroundColor: accentColor + '22' }">
            <text class="summary-icon-text">🧾</text>
          </view>
          <view class="summary-info">
            <text class="summary-name">待报销</text>
            <text class="summary-type">等公司打钱回来的钱</text>
          </view>
        </view>

        <MoneyText :cents="summary.pendingAmount" :type="'expense'" :size="64" :weight="600" />

        <view class="summary-rows">
          <view class="summary-row">
            <text class="summary-row-label">待报销笔数</text>
            <text class="summary-row-value">{{ summary.pendingCount }} 笔</text>
          </view>
          <view class="summary-row">
            <text class="summary-row-label">累计已报销</text>
            <text class="summary-row-value">¥{{ yuan(summary.doneAmount) }}</text>
          </view>
        </view>
      </view>

      <!-- 待报销 / 已报销：复用全局分段控件，不另写一套 tab -->
      <view class="seg-toggle seg-toggle--block status-toggle">
        <text
          v-for="s in statusTabs"
          :key="s.key"
          class="seg-item"
          :class="{ active: status === s.key }"
          @click="switchStatus(s.key)"
        >{{ s.name }}（{{ s.key === 'pending' ? summary.pendingCount : summary.doneCount }}）</text>
      </view>

      <!-- 空态 -->
      <view v-if="!loading && isEmpty" class="empty-wrap">
        <EmptyState emoji="🧾" :title="emptyTitle" :desc="emptyDesc" />
      </view>

      <!--
        待报销：按「支出时间」分组（和交易列表同一个读法）

        ★ 每行右滑露出「报销」★
          wd-swipe-action 的整个右滑区只 emit 一个事件，分不出按了哪个按钮，
          所以按钮自己绑 @click.stop。
        ★ 每行可长按进入多选 ★
          长按任意一行 → 进入多选模式，行首出现勾选框，
          右上角出现「报销」。
      -->
      <view v-else-if="status === 'pending'" class="group-list">
        <view v-for="g in groups" :key="g.day" class="day-group">
          <text class="day-title">{{ g.title }}</text>

          <view class="day-card">
            <wd-swipe-action
              v-for="t in g.list"
              :key="t.id"
              v-model="swipeStates[t.id]"
              class="txn-swipe"
            >
              <view class="txn-item" @click="onRowClick(t)" @longpress="onRowLongPress(t)">
                <!-- 多选模式的勾选框 -->
                <view v-if="selectMode" class="row-check" :class="{ on: isSelected(t.id) }">
                  <text v-if="isSelected(t.id)" class="row-check-tick">✓</text>
                </view>

                <view
                  class="txn-icon"
                  :style="{ backgroundColor: (t.category_color || '#969799') + '22' }"
                >
                  <text class="txn-icon-text" :style="{ color: t.category_color || '#969799' }">
                    {{ iconChar(t) }}
                  </text>
                </view>

                <view class="txn-info">
                  <text class="txn-name ellipsis">{{ t.category_name || '未分类' }}</text>
                  <text class="txn-sub ellipsis">{{ txnSub(t) }}</text>
                </view>

                <view class="txn-right">
                  <!--
                    ★ 待报销：金额正常显示，不加删除线（用户要求）★
                      删除线表达的是「这笔的数已经不作数了」，
                      而待报销只是「还没报销」，金额本身没变，
                      划掉反而让人以为这笔账被作废了。
                      删除线只出现在下面「已报销」的单里。
                  -->
                  <view class="amount-pending">
                    <MoneyText :cents="t.amount_cents" :type="t.type" :size="28" :weight="500" />
                  </view>
                  <text class="txn-time">{{ timeLabel(t.occurred_at) }}</text>
                </view>
              </view>

              <template #right>
                <view class="swipe-do" :style="{ backgroundColor: primaryColor }" @click.stop="onSwipeReimburse(t)">
                  <text class="swipe-action-text">报销</text>
                </view>
              </template>
            </wd-swipe-action>
          </view>
        </view>

        <!--
          ★ 底部提示语已按用户要求删除 ★
            操作方式（右滑 / 长按）在列表本身已经能试出来，
            每次进页面都挂一段说明只是噪音。
        -->
        <view class="bottom-space" />
      </view>

      <!--
        已报销：报销单卡片列表（v23）

        ★ 用户原话 ★
          「每次选择报销时，自动创建一个报销单，类似于借款人那样的界面，
           显示报销金额，实报金额，报销时间，报销笔数；
           报销返还/盈余/坏账也列入下方报销单，但不计入报销笔数。」

        ★ 卡头 / 卡身 / 明细三层 ★
          卡头：报销时间 + 到账账户（左），实报金额（右，大号）—— 这一单的结论。
          卡身：报销笔数 + 原支出合计（两行小字）—— 这一单的规模。
          明细：被报销的 N 笔（原金额划删除线）+ 派生流水（正常金额、标注不计入笔数）。
            明细里**不再**重复显示实报金额：它已经在卡头上了，
            每行再来一个就成了同一张单里四五个一样的数字（用户明确要求去掉）。

        ★ 老数据（batch_id 为空）怎么办 ★
          v23 迁移故意不回填，列表由 api/reimburse.js 按
          「报销日 + 到账账户 + 实报金额」只读地拼成历史卡片，
          isLegacy 的卡片挂一个「历史」小标，又不写库也不造单。
      -->
      <view v-else class="batch-list">
        <view v-for="b in batches" :key="b.id" class="batch-card">
          <!--
            卡头（用户本轮第 6 条重排）
            ★ 修订后布局 ★
              第一行左：报销时间
              第一行右：上方小字「应报 ¥x」、下方「实报 ¥y」（金额前带「实报」二字）
              第二行左：到账账户 · N 笔（报销笔数并进来，不再单独一行）
            ★ 为什么把「笔数」并到账户后面 ★
              以前卡身有「报销笔数 / 报销金额」两行，各占一行高度却都只有一个数；
              笔数是「这一单的规模」，和账户同属「这单的抬头信息」，并成一行就够。
              「应报金额」挪到实报金额上方做小字 —— 两个数是同一件事的两个口径
              （该报多少、实报多少），上下紧挨着才比得出来。
          -->
          <view class="batch-head">
            <view class="batch-head-left">
              <view class="batch-day-row">
                <text class="batch-day">{{ dayTitle(b.day) }}</text>
                <text v-if="b.isLegacy" class="batch-legacy-tag">历史</text>
              </view>
              <text class="batch-account ellipsis">
                {{ b.accountName || '无账户' }}
                <text class="batch-count">· {{ b.txnCount }} 笔</text>
              </text>
            </view>
            <view class="batch-head-right">
              <!-- 应报金额：小字压在实报上面，两个数一上一下才比得出来 -->
              <text class="batch-origin-label">应报 ¥{{ yuan(b.originCents) }}</text>
              <view class="batch-done-row">
                <text class="batch-done-label">实报</text>
                <MoneyText
                  class="batch-done-amount"
                  :cents="b.doneCents"
                  :size="44"
                  :weight="600"
                />
              </view>
            </view>
          </view>

          <!-- 明细：派生流水在前（这张单的真实影响），被报销的原流水在后 -->
          <view class="batch-items">
            <!--
              ★ 派生流水放在最前（用户本轮第 6 条）★
                报销到账 / 盈余 / 坏账是**这次报销产生的结果**，
                原支出那几笔是「输入」。先看结果再回头核对输入，
                比先翻 5 笔原流水再滑到底看结果要顺手。
            -->
            <view
              v-for="d in b.derived"
              :key="d.id"
              class="txn-item txn-item-derived"
              @click="goTxnDetail(d.id)"
            >
              <view
                class="txn-icon"
                :style="{ backgroundColor: (d.category_color || '#969799') + '22' }"
              >
                <text class="txn-icon-text" :style="{ color: d.category_color || '#969799' }">
                  {{ iconChar(d) }}
                </text>
              </view>

              <view class="txn-info">
                <!--
                  ★ 不再标「不计入笔数」（本轮用户第 1 条）★
                    用户原话「不要显示不计入笔数」。
                    笔数只在卡头出现一次，明细行不必逐条解释自己算不算 ——
                    这几行本来就是「这次报销产生的结果」，语义已经清楚了。
                -->
                <text class="txn-name ellipsis">{{ d.category_name }}</text>
                <text class="txn-sub ellipsis">{{ txnSub(d) }}</text>
              </view>

              <view class="txn-right">
                <!-- 派生流水正常显示金额（不加删除线）：它们是这张单的真实影响 -->
                <MoneyText :cents="d.amount_cents" :type="d.type" :size="28" :weight="500" />
                <text class="txn-time">{{ timeLabel(d.occurred_at) }}</text>
              </view>
            </view>

            <!-- 被报销的原始支出（原金额划删除线） -->
            <view
              v-for="t in b.items"
              :key="t.id"
              class="txn-item"
              @click="goTxnDetail(t.id)"
            >
              <view
                class="txn-icon"
                :style="{ backgroundColor: (t.category_color || '#969799') + '22' }"
              >
                <text class="txn-icon-text" :style="{ color: t.category_color || '#969799' }">
                  {{ iconChar(t) }}
                </text>
              </view>

              <view class="txn-info">
                <text class="txn-name ellipsis">{{ t.category_name || '未分类' }}</text>
                <text class="txn-sub ellipsis">{{ txnSub(t) }}</text>
              </view>

              <view class="txn-right">
                <!--
                  ★ 只划掉原金额，不显示实报金额（用户要求）★
                    原支出这个数在报销之后就不作数了 —— 真正的影响由卡头的
                    实报金额和下面的坏账/盈余表达，所以这里只留一个划掉的数。
                    实报为空（老数据）时也照划：这张单的结论已经在卡头了。
                -->
                <text class="batch-origin-strike">¥{{ yuan(t.amount_cents) }}</text>
                <text class="txn-time">{{ timeLabel(t.occurred_at) }}</text>
              </view>
            </view>

            <!-- 单里一笔明细都没有（备份被裁过 / 明细被删光）：至少别显示成空白卡 -->
            <view v-if="b.items.length === 0 && b.derived.length === 0" class="batch-empty">
              <text class="batch-empty-text">这张单的流水已被删除</text>
            </view>
          </view>
        </view>

        <view class="bottom-space" />
      </view>
    </scroll-view>

    <!--
      报销弹层：报销金额 + 报销账户

      ★ 金额默认是待报销那一笔（或那一批）的原金额合计 ★
        用户不用改就能直接确认；改了就按差额记坏账/盈余。
      ★ 多选时显示「共 N 笔」★
        不然用户不知道自己正在报几笔。
    -->
    <wd-popup
      v-model="showSheet"
      position="bottom"
      :z-index="100"
      :safe-area-inset-bottom="true"
      custom-style="background-color: var(--app-card); border-radius: 28rpx 28rpx 0 0;"
    >
      <view class="sheet">
        <view class="sheet-head">
          <text class="sheet-cancel" @click="showSheet = false">取消</text>
          <text class="sheet-title">报销</text>
          <text class="sheet-save" :style="{ color: primaryColor }" @click="onConfirmReimburse">确认</text>
        </view>

        <view class="sheet-body">
          <view class="sheet-row">
            <text class="sheet-label">报销笔数</text>
            <text class="sheet-value">{{ sheet.ids.length }} 笔</text>
          </view>

          <view class="sheet-row">
            <text class="sheet-label">原支出合计</text>
            <text class="sheet-value">¥{{ yuan(sheet.originCents) }}</text>
          </view>

          <!--
            ★ 实际报销金额：和上面两行同一种排版（左标签 / 右数值）★
              用户要求「价签显示在右侧」，字号比普通行大一号，
              输入框右对齐，读起来和「原支出合计」在同一列上。
          -->
          <view class="sheet-row sheet-row-amount">
            <text class="sheet-label">实际报销金额</text>
            <view class="amount-input-wrap">
              <text class="amount-symbol">¥</text>
              <input
                v-model="sheet.amountText"
                class="amount-input"
                type="digit"
                placeholder="0.00"
                placeholder-class="amount-placeholder"
              />
            </view>
          </view>

          <!--
            ★ 差额提示（用户要求：类似「修改账户余额」弹层的风格）★
              左边说明「相对什么」，右边是带正负号的彩色差额。
              多了 = 会记「报销盈余」（收入），少了 = 会记「报销坏账」（支出），
              相等 = 不会有差额流水。
          -->
          <view class="sheet-diff">
            <text class="sheet-diff-label">相对原支出</text>
            <text class="sheet-diff-value" :style="{ color: diffColor }">{{ diffText }}</text>
          </view>

          <!-- 报销账户 -->
          <view class="sheet-row" @click="openAccountPicker">
            <text class="sheet-label">到账账户</text>
            <view class="sheet-value-row">
              <text
                class="sheet-value"
                :style="{ color: sheet.accountId ? 'var(--app-text)' : 'var(--app-text-3)' }"
              >{{ accountName || '请选择' }}</text>
              <text class="sheet-arrow">›</text>
            </view>
          </view>
        </view>
      </view>
    </wd-popup>

    <!-- 账户选择：和记账面板同一套 action-sheet -->
    <wd-action-sheet
      v-model="showAccountPicker"
      :actions="accountActions"
      cancel-text="取消"
      @select="onAccountSelect"
    />

    <!-- 全局弹窗宿主 -->
    <AppDialog />

    <!-- 更新弹窗 -->
    <UpdateDialog />
  </view>
</template>

<script>
/**
 * 报销管理
 *
 * ★ 两种入口 ★
 *   单笔：右滑那一行 → 露出「报销」→ 弹层确认
 *   批量：长按任意行 → 多选 → 右上角「报销」→ 同一个弹层
 *
 * ★ 报销时到底发生什么 ★
 *   全部在 api/reimburse.js 的 reimburseTxns 里：
 *     0) 先建一张报销单（reimburse_batch）
 *     1) 记一笔「报销到账」收入进到账账户（不计收支）
 *     2) 实报 ≠ 原支出时，差额记「报销坏账」（支出）或「报销盈余」（收入）
 *     3) 把这些流水标成已报销（reimburse_status=2 + 报销日期/金额/账户）
 *     4) 上述所有流水都挂上这一单的 batch_id
 *   页面只负责收集「哪几笔 + 报了多少钱 + 报哪个账户」。
 *
 * ★ 为什么不在这里自己算差额 ★
 *   坏账/盈余的金额、分类、账户都要和台账保持唯一口径；
 *   放页面里算，换个入口（以后可能从详情页报销）就会算出两份不同的数。
 *
 * ★ 为什么「已报销」读的是单、不是流水 ★
 *   流水列表看不出「哪几笔是一次报的」。用户要的是「报销单」：
 *   一张单一个到账时间、一个实报总额、一笔笔原始支出。
 *   所以已报销 tab 用 listReimburseBatches()（单 + 单内明细），
 *   待报销 tab 仍然用 listReimburseTxns('pending')（它本来就是流水）。
 */
import { ref, computed, reactive, watch } from 'vue'
import { onLoad, onShow, onBackPress } from '@dcloudio/uni-app'
import PageNav from '@/components/PageNav.vue'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppDialog from '@/components/AppDialog.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { listReimburseTxns, listReimburseBatches, getReimburseSummary, reimburseTxns } from '@/api/reimburse.js'
import { handleBackPress, pushLayer } from '@/utils/layerStack.js'
import { alertDialog } from '@/utils/dialog.js'
import { formatDayHeader, formatTime, toDayKey } from '@/utils/date.js'

/** 汇总卡图标底色（真实 hex，用来拼 `+ '22'` 半透明） */
const ACCENT_COLOR = '#FF8F1F'

/** 分类名 → 图标 emoji（这几类的 icon key 在库里是固定的） */
const ICON_FALLBACK = {
  借出: '📤', 借款收回: '📥', 借入: '📥', 借款归还: '📤',
  借出坏账: '📦', 借出利息: '📈', 借入未还: '📦', 借入利息: '📈',
  报销到账: '🧾', 报销坏账: '📦', 报销盈余: '📈'
}

export default {
  components: { PageNav, MoneyText, EmptyState, AppDialog, UpdateDialog },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    /** 'pending' 待报销 / 'done' 已报销（按报销单） */
    const status = ref('pending')
    const loading = ref(true)
    /** 待报销 tab 的分组（按支出日期聚合后的流水） */
    const groups = ref([])
    /** 已报销 tab 的报销单列表 */
    const batches = ref([])
    const summary = ref({ pendingCount: 0, pendingAmount: 0, doneCount: 0, doneAmount: 0 })

    /** 右滑展开状态（每行一个） */
    const swipeStates = reactive({})

    /* ------------------------------------------------------ 多选 */

    const selectMode = ref(false)
    const selectedIds = ref([])

    /* ------------------------------------------------------ 报销弹层 */

    const showSheet = ref(false)
    const showAccountPicker = ref(false)
    const sheet = reactive({
      ids: [],
      originCents: 0,
      amountText: '',
      accountId: ''
    })

    let ready = false

    const pageStyle = computed(() => settingStore.cssVars)
    const primaryColor = computed(() => settingStore.primaryColor)
    const accentColor = computed(() => ACCENT_COLOR)

    const statusTabs = [
      { key: 'pending', name: '待报销' },
      { key: 'done', name: '已报销' }
    ]

    /**
     * 当前 tab 是不是空的
     *
     * ★ 两个 tab 的数据结构不同，空态判断也必须分开 ★
     *   待报销看 groups，已报销看 batches ——
     *   合并成一个布尔会在切换 tab 的瞬间误判（旧数据还在 ref 里）。
     */
    const isEmpty = computed(() =>
      status.value === 'pending' ? groups.value.length === 0 : batches.value.length === 0
    )

    const emptyTitle = computed(() =>
      status.value === 'pending' ? '没有待报销的账' : '还没有报销记录'
    )
    const emptyDesc = computed(() =>
      status.value === 'pending'
        ? '在交易详情或记账面板里勾上「待报销」，那笔就会出现在这里'
        : '报销完成之后这里会按报销单展示：实报金额、报销笔数、每一笔原始支出'
    )

    /** 到账账户名 */
    const accountName = computed(() => {
      const acc = accountStore.list.find((a) => a.id === sheet.accountId)
      return acc ? acc.name : ''
    })

    const accountActions = computed(() =>
      accountStore.list
        .filter((a) => !a.isCombo)
        .map((a) => ({ name: a.name, subname: `余额 ${(a.balance_cents / 100).toFixed(2)}` }))
    )

    /**
     * 差额（分）：实报 - 原支出
     *
     * ★ 为什么单独抽出来 ★
     *   文案（多了/少了/相等）和颜色（绿/红/灰）都要用它，
     *   分两处各算一遍迟早会算出两个数。
     */
    const diffCents = computed(() => {
      const cents = parseAmountCents(sheet.amountText)
      if (!cents) return null // 还没填金额：不下结论
      return cents - sheet.originCents
    })

    /**
     * 差额提示（与「修改账户余额」弹层同一套写法）
     *
     * ★ 实时告诉用户「这一报会发生什么」★
     *   用户改金额时最怕「不知道多报/少报会怎么记」，
     *   这里提前把结果说清楚，确认前就能想明白。
     */
    const diffText = computed(() => {
      const d = diffCents.value
      if (d === null) return '填了金额才知道差额'
      if (d === 0) return '刚好相等'
      const value = (Math.abs(d) / 100).toFixed(2)
      return d > 0 ? `多了 ¥${value}` : `少了 ¥${value}`
    })

    /** 差额颜色：多了绿（收入）、少了红（损失）、相等灰 */
    const diffColor = computed(() => {
      const d = diffCents.value
      if (d === null || d === 0) return 'var(--app-text-3)'
      return d > 0 ? 'var(--app-income, #07C160)' : 'var(--app-danger)'
    })

    /* ------------------------------------------------------ 工具 */

    function parseAmountCents(text) {
      const n = Number(String(text || '').replace(/[^\d.]/g, ''))
      if (!isFinite(n) || n <= 0) return 0
      return Math.round(n * 100)
    }

    /**
     * 分 → 「123.45」字符串
     *
     * ★ 页面里只保留这一处金额格式化 ★
     *   卡片头、卡身、明细的删除线金额都是纯文本（不是 MoneyText），
     *   各写一句 (x/100).toFixed(2) 的话，以后改精度就要满页面找。
     */
    function yuan(cents) {
      return ((Number(cents) || 0) / 100).toFixed(2)
    }

    function iconChar(t) {
      return ICON_FALLBACK[t && t.category_name] || '🧾'
    }

    /** 报销单卡头的日期：和流水列表的日期条同一套文案（今天/昨天 + 月日 周几） */
    function dayTitle(day) {
      return day ? formatDayHeader(day) : '未记录日期'
    }

    /** 副标题：时间 · 账户 */
    function txnSub(t) {
      const parts = []
      if (t.occurred_at) parts.push(formatTime(t.occurred_at))
      parts.push(t.account_name || '无账户')
      return parts.join(' · ')
    }

    function timeLabel(ts) {
      return formatTime(ts)
    }

    function goTxnDetail(id) {
      uni.navigateTo({ url: `/pages/txn/detail?id=${id}` })
    }

    /**
     * 把流水按日期分组
     *
     * ★ 待报销用支出日期 ★
     *   待报销关心「什么时候花的」；已报销已经按报销单展示了，
     *   所以这个函数现在只服务待报销 tab。
     */
    function groupBy(list, dayField) {
      const map = new Map()
      for (const t of list) {
        const day = t[dayField] || ''
        if (!map.has(day)) {
          map.set(day, { day, title: day ? formatDayHeader(day) : '未记录日期', list: [] })
        }
        map.get(day).list.push(t)
      }
      return Array.from(map.values())
    }

    /* ------------------------------------------------------ 数据 */

    async function load() {
      loading.value = true
      try {
        await accountStore.load()
        const [pending, batchList, sum] = await Promise.all([
          listReimburseTxns('pending'),
          /*
           * ★ 只有已报销 tab 需要单 ★
           *   待报销 tab 用不到它，但两个一起查能少一次切换 tab 时的白屏；
           *   数据量小（默认最多 300 单），代价可以接受。
           */
          listReimburseBatches(),
          getReimburseSummary()
        ])
        summary.value = sum
        batches.value = batchList || []

        if (status.value === 'pending') {
          groups.value = groupBy(pending, 'occurred_day')
        } else {
          groups.value = []
        }

        // 清掉已经不存在的行的右滑状态，避免状态泄漏
        const alive = new Set((groups.value || []).flatMap((g) => g.list.map((t) => t.id)))
        Object.keys(swipeStates).forEach((id) => {
          if (!alive.has(id)) delete swipeStates[id]
        })
      } catch (e) {
        console.warn('[reimburse] 加载失败:', e && e.message)
        groups.value = []
        batches.value = []
      } finally {
        loading.value = false
      }
    }

    function switchStatus(key) {
      if (status.value === key) return
      status.value = key
      exitSelectMode()
      load()
    }

    /* ------------------------------------------------------ 多选 */

    function toggleSelectMode() {
      if (selectMode.value) exitSelectMode()
      else {
        selectMode.value = true
        selectedIds.value = []
      }
    }

    function exitSelectMode() {
      selectMode.value = false
      selectedIds.value = []
    }

    function isSelected(id) {
      return selectedIds.value.includes(id)
    }

    /** 点行：多选模式切换勾选；否则进详情 */
    function onRowClick(t) {
      if (!selectMode.value) {
        goTxnDetail(t.id)
        return
      }
      toggleSelect(t.id)
    }

    function toggleSelect(id) {
      const idx = selectedIds.value.indexOf(id)
      if (idx >= 0) selectedIds.value.splice(idx, 1)
      else selectedIds.value.push(id)
    }

    /** 长按：进入多选并选中这一行 */
    function onRowLongPress(t) {
      if (!selectMode.value) {
        selectMode.value = true
        selectedIds.value = []
      }
      if (!isSelected(t.id)) toggleSelect(t.id)
      // 长按后平台可能补一次 tap，这里只标一下不去重，双击勾选是可接受的
    }

    /** 批量报销：把所有选中行打开弹层 */
    function onBatchReimburse() {
      if (selectedIds.value.length === 0) {
        uni.showToast({ title: '先勾选要报销的流水', icon: 'none' })
        return
      }
      const all = (groups.value || []).flatMap((g) => g.list)
      const picked = all.filter((t) => selectedIds.value.includes(t.id))
      openSheet(picked)
    }

    /* ------------------------------------------------------ 报销弹层 */

    /** 右滑单笔报销 */
    function onSwipeReimburse(t) {
      if (swipeStates[t.id]) swipeStates[t.id] = 'close'
      openSheet([t])
    }

    function openSheet(list) {
      if (!list || list.length === 0) return
      const originCents = list.reduce((a, t) => a + (Number(t.amount_cents) || 0), 0)
      sheet.ids = list.map((t) => t.id)
      sheet.originCents = originCents
      // 默认金额 = 原支出合计，用户不改就能直接确认
      sheet.amountText = (originCents / 100).toFixed(2)
      // 默认账户沿用上一次选的；没有就用第一个真实账户
      if (!sheet.accountId) {
        const firstReal = accountStore.list.find((a) => !a.isCombo)
        sheet.accountId = firstReal ? firstReal.id : ''
      }
      showSheet.value = true
    }

    function openAccountPicker() {
      if (accountActions.value.length === 0) {
        uni.showToast({ title: '请先添加账户', icon: 'none' })
        return
      }
      showAccountPicker.value = true
    }

    function onAccountSelect({ index }) {
      const list = accountStore.list.filter((a) => !a.isCombo)
      const acc = list[index]
      if (acc) sheet.accountId = acc.id
      showAccountPicker.value = false
    }

    async function onConfirmReimburse() {
      const cents = parseAmountCents(sheet.amountText)
      if (!cents) {
        uni.showToast({ title: '请输入报销金额', icon: 'none' })
        return
      }
      if (!sheet.accountId) {
        uni.showToast({ title: '请选择到账账户', icon: 'none' })
        return
      }

      try {
        const r = await reimburseTxns({
          ids: sheet.ids,
          totalCents: cents,
          accountId: sheet.accountId,
          day: toDayKey()
        })
        showSheet.value = false
        exitSelectMode()

        /*
         * 差额要说清楚
         *
         * ★ 为什么不让 API 弹窗 ★
         *   它是纯数据层，塞 toast/alert 以后复用就麻烦。
         *   这里根据返回的坏账/盈余金额自己拼一句话。
         */
        let msg = '已报销'
        if (r.badDebtCents > 0) msg = `已报销，坏账 ¥${(r.badDebtCents / 100).toFixed(2)}`
        else if (r.surplusCents > 0) msg = `已报销，盈余 ¥${(r.surplusCents / 100).toFixed(2)}`
        uni.showToast({ title: msg, icon: 'none', duration: 2000 })

        await load()
      } catch (e) {
        await alertDialog({ title: '报销失败', content: e.message || '请稍后重试' })
      }
    }

    /*
     * 弹层登记到弹层栈
     *
     * ★ 不登记的话侧滑返回会直接退出整个页面 ★
     *   用户只是想关掉「报销」弹层，结果回到了「我的」页 ——
     *   这个坑在记账面板、账户选择等所有自绘弹层上都踩过。
     */
    let unregisterSheet = null
    watch(showSheet, (open) => {
      if (open) {
        if (!unregisterSheet) {
          unregisterSheet = pushLayer(() => { showSheet.value = false }, 'reimburseSheet')
        }
        return
      }
      if (unregisterSheet) {
        unregisterSheet()
        unregisterSheet = null
      }
    })

    let unregisterAccountSheet = null
    watch(showAccountPicker, (open) => {
      if (open) {
        if (!unregisterAccountSheet) {
          unregisterAccountSheet = pushLayer(() => { showAccountPicker.value = false }, 'reimburseAccount')
        }
        return
      }
      if (unregisterAccountSheet) {
        unregisterAccountSheet()
        unregisterAccountSheet = null
      }
    })

    function goBack() {
      // 多选模式里点返回先退出多选，而不是直接退页面
      if (selectMode.value) {
        exitSelectMode()
        return
      }
      uni.navigateBack()
    }

    onLoad(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await load()
      ready = true
    })

    onShow(async () => {
      settingStore.syncSystemTheme()
      if (ready) await load()
    })

    onBackPress(() => {
      if (selectMode.value) {
        exitSelectMode()
        return true
      }
      return handleBackPress()
    })

    return {
      settingStore, status, loading, groups, batches, summary, isEmpty,
      pageStyle, primaryColor, accentColor, statusTabs, emptyTitle, emptyDesc,
      swipeStates, selectMode, selectedIds,
      showSheet, showAccountPicker, sheet, accountName, accountActions, diffText, diffColor,
      iconChar, txnSub, timeLabel, goTxnDetail, formatTime, yuan, dayTitle,
      switchStatus, toggleSelectMode, isSelected, onRowClick, onRowLongPress,
      onBatchReimburse, onSwipeReimburse, openAccountPicker, onAccountSelect,
      onConfirmReimburse, goBack
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

/* 右上角文字按钮 */
.nav-done {
  font-size: 28rpx;
  color: var(--app-primary);
  padding: 8rpx 4rpx;
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

/* 待报销 / 已报销：外观全部来自全局 .seg-toggle，这里只补间距 */
.status-toggle {
  margin: 24rpx 0 8rpx;
}

/* ------------------------------------------------------- 分组列表 */

.group-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  margin-top: 16rpx;
}

.day-title {
  font-size: 24rpx;
  color: var(--app-text-3);
  padding: 0 8rpx 10rpx;
}

.day-card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
  box-shadow: var(--app-shadow);
}

.txn-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 18rpx 24rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.txn-item:last-child {
  border-bottom: none;
}

/* 多选勾选框 */
.row-check {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  border: 2rpx solid var(--app-line);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.row-check.on {
  background-color: var(--app-primary);
  border-color: var(--app-primary);
}

.row-check-tick {
  font-size: 22rpx;
  color: #ffffff;
  line-height: 1;
}

.txn-icon {
  width: 72rpx;
  height: 72rpx;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.txn-icon-text {
  font-size: 32rpx;
}

.txn-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.txn-name {
  font-size: 28rpx;
  color: var(--app-text);
}

.txn-sub {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.txn-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
  flex-shrink: 0;
}

/* 待报销：金额正常显示（不划删除线） */
.amount-pending {
  display: flex;
  align-items: baseline;
}

.txn-time {
  font-size: 20rpx;
  color: var(--app-text-3);
  font-variant-numeric: tabular-nums;
}

/* 右滑「报销」按钮 */
.swipe-do {
  width: 140rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.swipe-action-text {
  font-size: 26rpx;
  color: #ffffff;
}

/* ---------------------------------------------------- 报销单卡片 */

.batch-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  margin-top: 16rpx;
}

/*
 * 一张报销单 = 卡头 + 卡身 + 明细
 *
 * ★ 形制照借入借出管理页的人员分组 ★
 *   卡头用浅一层底（--app-card-2），明细用卡片底色，圆角套着 ——
 *   用户说的「类似于借款人那样的界面」就是这个意思：
 *   一块区域里先把「结论」给出来，下面才是支撑这个结论的流水。
 */
/*
 * 报销单卡片
 *
 * ★ 为什么加一圈描边（用户本轮第 6 条：卡片和背景融为一体）★
 *   浅色下 --app-card（纯白）与页面底色 --app-bg（#F7F8FA）都是近白，
 *   只靠 --app-shadow 那点柔光分不出边界；补 1rpx --app-line 描边后，
 *   深浅色模式下轮廓都清楚（阴影负责层次，描边负责轮廓）。
 */
.batch-card {
  background-color: var(--app-card);
  border: 1rpx solid var(--app-line);
  border-radius: 20rpx;
  overflow: hidden;
  box-shadow: var(--app-shadow);
}

.batch-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 20rpx 24rpx;
  background-color: var(--app-card-2);
}

.batch-head-left {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  min-width: 0;
  flex: 1;
}

.batch-day-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
}

/* 报销时间：卡头第一行，字号和流水列表的日期条一致 */
.batch-day {
  font-size: 28rpx;
  font-weight: 500;
  color: var(--app-text);
}

/*
 * 「历史」小标：v23 之前报销的单没有 batch_id，是列表按
 * 「报销日 + 到账账户 + 实报金额」只读拼出来的。
 * 标出来是为了诚实 —— 这些单的笔数/金额口径和老数据完全一致，
 * 但它们的「单」是展示层兜底，不是库里真有一行。
 */
.batch-legacy-tag {
  font-size: 20rpx;
  line-height: 1;
  padding: 4rpx 10rpx;
  border-radius: 8rpx;
  color: var(--app-text-3);
  background-color: var(--app-card);
  flex-shrink: 0;
}

/*
 * 到账账户 + 报销笔数同一行
 *
 * ★ 为什么笔数并到账户后面（用户本轮第 6 条）★
 *   用户原话「报销笔数直接显示在账户后面 · X 笔」。
 *   笔数和账户同属「这单的抬头信息」，各占一行只是浪费高度。
 */
.batch-account {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.batch-count {
  /* 和账户名同色但略微压暗一点，读起来是「账户 · 3 笔」一个整体 */
  opacity: 0.85;
}

/*
 * 卡头右列：应报（小字）在上、实报（大号）在下
 *
 * ★ 为什么两个数都要有、而且一上一下 ★
 *   用户原话「实报两个字显示在金额前，上方小小的写上应报金额」。
 *   应报和实报是同一件事的两个口径（该报多少 / 实际到账多少），
 *   上下紧挨着，差值一眼就能看出来，不用去翻明细加总。
 */
.batch-head-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2rpx;
  flex-shrink: 0;
}

/* 应报金额：小字，弱化（它是「原来的数」，结论是下面那行） */
.batch-origin-label {
  font-size: 20rpx;
  color: var(--app-text-3);
  font-variant-numeric: tabular-nums;
}

/* 「实报」二字 + 金额同一行，字在钱前面 */
.batch-done-row {
  display: flex;
  align-items: baseline;
  gap: 6rpx;
}

.batch-done-label {
  font-size: 22rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
}

/* 明细容器：卡片底色，无内边距（行自己带） */
.batch-items {
  display: flex;
  flex-direction: column;
}

/*
 * 被报销的原始支出：只显示划掉的原金额
 *
 * ★ 为什么不是 MoneyText ★
 *   MoneyText 是所有金额的统一出口，给它加删除线开关会污染其它调用点。
 *   这里是一个纯文本 + text-decoration，符号规则固定为 ¥ 金额，
 *   因为「划过」的数不该再带 +/- 号（那会让人以为它还在算收支）。
 *
 * ★ 为什么不显示实报金额（用户明确要求）★
 *   实报金额是整张单的结论，已经写在卡头（大号数字）上了；
 *   明细里每行再挂一个实报金额，同一张单里会出现四五个一样的数，
 *   而且那几行原本是一笔笔独立的支出，各自并没有「实报多少」这个属性。
 */
.batch-origin-strike {
  font-size: 26rpx;
  color: var(--app-text-3);
  text-decoration: line-through;
  font-variant-numeric: tabular-nums;
}

/* 派生流水那一行：整行略微退后一档，视觉上从属于这张单 */
/*
 * 派生流水（报销到账 / 盈余 / 坏账）
 *
 * ★ 底色和普通流水一致（本轮用户第 1 条）★
 *   用户原话「底色与正常流水一致，不要灰色」。
 *   以前给了一档 --app-card-2 的浅灰，本意是「这行不是普通支出」，
 *   但同一张单里一半灰一半白，反而像加载中的占位行。
 *   现在只靠分类名（报销到账/盈余/坏账）和金额颜色区分，底色统一。
 */
.txn-item-derived {
  background-color: var(--app-card);
}

/* 单里没有明细时的兜底（明细被删光 / 备份被裁过） */
.batch-empty {
  padding: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.batch-empty-text {
  font-size: 22rpx;
  color: var(--app-text-3);
}

/* ------------------------------------------------------- 报销弹层 */

.sheet {
  padding-bottom: 12rpx;
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 32rpx 12rpx;
}

.sheet-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.sheet-cancel {
  font-size: 28rpx;
  color: var(--app-text-3);
}

.sheet-save {
  font-size: 28rpx;
  font-weight: 500;
}

.sheet-body {
  padding: 0 32rpx;
}

.sheet-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 96rpx;
  border-bottom: 1rpx solid var(--app-line);
  gap: 16rpx;
}

.sheet-row:last-child {
  border-bottom: none;
}

.sheet-label {
  font-size: 28rpx;
  color: var(--app-text-2);
  flex-shrink: 0;
}

.sheet-value {
  font-size: 28rpx;
  color: var(--app-text);
}

.sheet-value-row {
  display: flex;
  align-items: center;
  gap: 8rpx;
  min-width: 0;
}

.sheet-arrow {
  font-size: 32rpx;
  color: var(--app-text-3);
}

/* 实际报销金额：和上面两行同一种「左标签 / 右数值」排版 */
.sheet-row-amount {
  align-items: center;
}

.amount-input-wrap {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 6rpx;
  flex: 1;
  min-width: 0;
}

.amount-symbol {
  font-size: 28rpx;
  color: var(--app-text-2);
  flex-shrink: 0;
}

/*
 * 金额输入
 *
 * ★ 字号比普通行大一号（34rpx vs 28rpx）★
 *   这是整个弹层唯一要用户填的地方，值得更醒目；
 *   但又不能像余额弹层那样 56rpx —— 那会把「实际报销金额」
 *   这一行的标签挤得换行。
 * ★ 右对齐 ★
 *   和上面「原支出合计」的数字落在同一列上，视线不用来回找。
 */
.amount-input {
  flex: 1;
  min-width: 0;
  width: 0;
  font-size: 34rpx;
  font-weight: 600;
  color: var(--app-text);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.amount-placeholder {
  color: var(--app-text-3);
  font-weight: 400;
}

/* 差额提示：与「修改账户余额」弹层同一套排版（左说明 / 右彩色差值） */
.sheet-diff {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 0 8rpx;
}

.sheet-diff-label {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.sheet-diff-value {
  font-size: 26rpx;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
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
