<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <!-- 首次使用引导 -->
    <block v-if="settingStore.loaded && !hasAccounts">
      <AppHeader />
      <view class="guide-area">
        <EmptyState
          emoji="👋"
          title="欢迎使用自由记"
          desc="先添加一个账户，才能开始记账"
          action-text="添加账户"
          @action="goAddAccount"
        />
      </view>
    </block>

    <block v-else>
      <AppHeader @avatar-click="goProfile">
        <template #right>
          <HeaderAction @action-click="goAiChat">智能助手</HeaderAction>
        </template>
      </AppHeader>

      <scroll-view
        class="page-scroll"
        scroll-y
      >
        <!-- ② 本月概览 -->
        <view class="overview-card">
          <!--
            右上角：月份切换（概览和月历联动）

            ★ 「回到本月」放在「年月」和「左右箭头」中间（用户本轮第 1 条）★

            ★ 用户纠正了我一次 ★
              我先做成了「月历正中间浮一个按钮」，用户说：
              「我指的不是在日历正中间掐一个『回到本月』，
              而是在年月显示和左右切换的中间加一个『回到本月』」。
              —— 它属于**月份导航**这一行，不属于月历格子。

            ★ 为什么放在标题和箭头之间、而不是最右 ★
              用户明确指定了位置。从语义上看也合理：
              左半是「你现在在哪个月」，右半是「怎么换月」，
              而「回到本月」正是「换月」的快捷方式 ——
              贴在箭头左边、紧挨着它，操作路径最短。

            ★ 为什么非本月才显示 ★
              本月的账不需要「回到本月」，常驻只会多一个灰按钮占位。
              v-if 让它彻底不渲染（不是隐藏），本月的行距不受影响。
          -->
          <view class="ov-month-nav">
            <view class="ov-month-left">
              <text class="ov-month-title">{{ calendarTitle }}</text>
              <text
                v-if="!isCurrentMonth"
                class="ov-month-today"
                @click="backToCurrentMonth"
              >回到本月</text>
            </view>
            <view class="ov-month-btns">
              <text class="ov-month-btn" @click="shiftCalMonth(-1)">‹</text>
              <text class="ov-month-btn" @click="shiftCalMonth(1)">›</text>
            </view>
          </view>

          <!-- 上方：今日支出 / 本月支出
               ★ 带正负号：支出显示为「-¥xx」★
                 用 MoneyText 的 type="expense" 而不是手写「-」字符 ——
                 type 同时决定符号与正负（支出 = 负数），
                 手写符号容易和金额本身的正负重复或漏掉。 -->
          <view class="ov-top">
            <view class="ov-top-item">
              <text class="ov-top-label">今日支出</text>
              <view class="ov-top-amount">
                <MoneyText
                  :cents="overview.todayExpense"
                  type="expense"
                  :size="44"
                  :weight="600"
                />
              </view>
            </view>
            <view class="ov-top-divider" />
            <view class="ov-top-item">
              <text class="ov-top-label">本月支出</text>
              <view class="ov-top-amount">
                <MoneyText
                  :cents="overview.monthExpense"
                  type="expense"
                  :size="44"
                  :weight="600"
                />
              </view>
            </view>
          </view>

          <!-- 下方：今日收入 / 本月收入 / 本月结余
               ★ 结余按正负着色 ★ 正数绿、负数红，一眼看出盈亏 -->
          <view class="ov-split">
            <view class="ov-item">
              <text class="ov-item-label">今日收入</text>
              <MoneyText :cents="overview.todayIncome" type="income" :size="30" :weight="500" />
            </view>
            <view class="ov-divider" />
            <view class="ov-item">
              <text class="ov-item-label">本月收入</text>
              <MoneyText :cents="overview.monthIncome" type="income" :size="30" :weight="500" />
            </view>
            <view class="ov-divider" />
            <view class="ov-item">
              <text class="ov-item-label">本月结余</text>
              <MoneyText
                :cents="overview.monthBalance"
                variant="balance"
                :size="30"
                :weight="500"
              />
            </view>
          </view>

          <!--
            下方：预算进度条（月预算 + 可折叠的子预算）

            ★ 四角排布 ★
              左上：预算名称 + 百分比（一眼看"花了多少比例"）
              左下：已用 / 总额（具体数字）
              右上：日均可用（"还能花多少"）
              右下：留空，不放内容
            进度条夹在上下两行之间，视觉上仍是「头 → 条 → 脚」三段。

            ★ 子预算可折叠（用户本轮要求）★
              用户原话：「首页概览页面设置子预算可折叠起来，
              记住展开和折叠的状态」。
              子预算一多，概览卡会被撞到一个屏幕都装不下，
              而大多数时候用户只想看月预算那条。
              状态存 setting 表（不存内存）：下次打开 App 仍然是你上次的选择。
          -->
          <view
            v-if="totalBudget || categoryBudgets.length > 0"
            class="ov-budgets"
            @click="goBudget"
          >
            <view v-if="totalBudget" class="ov-budget">
              <view class="ov-budget-head">
                <view class="ov-budget-head-left">
                  <text class="ov-budget-name">月预算</text>
                  <text class="ov-budget-pct" :style="{ color: totalBudget.over ? 'var(--app-danger)' : primaryColor }">
                    {{ totalBudget.percent }}%
                  </text>
                </view>
                <text class="ov-budget-daily" :style="{ color: totalBudget.over ? 'var(--app-danger)' : 'var(--app-text-3)' }">
                  日均可用 ¥{{ formatWanYuan(totalBudget.dailyAvailable) }}
                </text>
              </view>
              <view class="ov-budget-bar">
                <view
                  class="ov-budget-fill"
                  :style="{
                    width: Math.min(totalBudget.percent, 100) + '%',
                    backgroundColor: totalBudget.over ? 'var(--app-danger)' : primaryColor
                  }"
                />
              </view>
              <!--
                脚行：左下角是已用 / 总额，右下角是子预算折叠条（用户本轮要求）

                ★ 用户原话 ★
                  「首页，子预算的折叠文字显示在月预算的右下角」。

                ★ 为什么放在脚行而不是另起一行 ★
                  脚行右侧本来就是空的（百分比已经上移到头行）。
                  把折叠条放进去，既填了那块空白，又不多占一行高度 ——
                  概览卡本来就很高，能少一行是一行。

                ★ @click.stop 不能少 ★
                  外层 .ov-budgets 整块是「点一下进预算页」，
                  不阻止冒泡就会「想展开结果跳页了」。
              -->
              <view class="ov-budget-foot">
                <view class="ov-budget-amount">
                  <MoneyText :cents="totalBudget.used" :size="20" color="var(--app-text-3)" />
                  <text class="ov-budget-slash">/</text>
                  <MoneyText :cents="totalBudget.limit" :size="20" color="var(--app-text-3)" />
                </view>
                <view
                  v-if="categoryBudgets.length > 0"
                  class="ov-subbudget-toggle"
                  @click.stop="toggleSubBudgets"
                >
                  <text class="ov-subbudget-toggle-text">子预算 {{ categoryBudgets.length }}项</text>
                  <text
                    class="ov-subbudget-toggle-arrow"
                    :class="{ open: !subBudgetsCollapsed }"
                  >›</text>
                </view>
              </view>
            </view>

            <!--
              兜底：只有子预算、没有月预算（老数据 / 导入异常）时，
              脚行不存在，折叠条就没地方放 —— 这时单独占一行。
              （正常情况下不会出现：没月预算不允许建子预算，但老库里可能残留。）
            -->
            <view
              v-if="!totalBudget && categoryBudgets.length > 0"
              class="ov-subbudget-toggle ov-subbudget-toggle-standalone"
              @click.stop="toggleSubBudgets"
            >
              <text class="ov-subbudget-toggle-text">子预算 {{ categoryBudgets.length }}项</text>
              <text
                class="ov-subbudget-toggle-arrow"
                :class="{ open: !subBudgetsCollapsed }"
              >›</text>
            </view>

            <!--
              ★ v-if 不能和 v-for 写在同一个元素上 ★
                Vue 3 里 v-if 优先级高于 v-for，写在一起时 v-if
                拿不到 v-for 的局部变量（这里是 b）——白屏。
                所以折叠判断包一层 <template>，列表本身保持干净的 v-for。
            -->
            <template v-if="!subBudgetsCollapsed">
              <view v-for="b in categoryBudgets" :key="b.id" class="ov-budget">
                <view class="ov-budget-head">
                  <view class="ov-budget-head-left">
                    <text class="ov-budget-name">{{ b.name }}</text>
                    <text class="ov-budget-pct" :style="{ color: b.over ? 'var(--app-danger)' : primaryColor }">
                      {{ b.percent }}%
                    </text>
                  </view>
                  <text class="ov-budget-daily" :style="{ color: b.over ? 'var(--app-danger)' : 'var(--app-text-3)' }">
                    日均可用 ¥{{ formatWanYuan(b.dailyAvailable) }}
                  </text>
                </view>
                <view class="ov-budget-bar">
                  <view
                    class="ov-budget-fill"
                    :style="{
                      width: Math.min(b.percent, 100) + '%',
                      backgroundColor: b.over ? 'var(--app-danger)' : primaryColor
                    }"
                  />
                </view>
                <view class="ov-budget-foot">
                  <view class="ov-budget-amount">
                    <MoneyText :cents="b.used" :size="20" color="var(--app-text-3)" />
                    <text class="ov-budget-slash">/</text>
                    <MoneyText :cents="b.limit" :size="20" color="var(--app-text-3)" />
                  </view>
                </view>
              </view>
            </template>
          </view>
        </view>

        <!-- ③ 最近收支 -->
        <view class="section">
          <view class="section-head">
            <text class="section-title">最近收支</text>
            <text class="section-more" @click="goAllTxn">查看全部 ›</text>
          </view>

          <!-- 空状态：但解析中时不要显示，否则占位行和空状态打架 -->
          <view
            v-if="recentGroups.length === 0 && !parsing"
            class="section-empty"
          >
            <EmptyState emoji="📝" title="还没有记账" desc="点击右下角 + 记一笔" compact />
          </view>

          <view v-else class="txn-list">
            <!-- 正在解析的占位行：让用户立刻看到"已提交，在处理" -->
            <view v-if="parsing" class="txn-item parsing-item">
              <view class="txn-icon parsing-icon" :style="{ backgroundColor: primaryColor + '22' }">
                <view class="parsing-dot" :style="{ backgroundColor: primaryColor }" />
              </view>
              <view class="txn-info">
                <text class="txn-name parsing-name">{{ parsingText || '正在解析…' }}</text>
                <text class="txn-sub">AI 正在识别时间、分类和金额</text>
              </view>
              <view class="txn-amount">
                <view class="parsing-bars">
                  <view class="pbar" :style="{ backgroundColor: primaryColor }" />
                  <view class="pbar" :style="{ backgroundColor: primaryColor }" />
                  <view class="pbar" :style="{ backgroundColor: primaryColor }" />
                </view>
              </view>
            </view>

            <!--
              按日期分组的最近收支
              显示范围见 recentDisplayList：当日 >= 5 条显示全部当日，否则最近 5 条
            -->
            <block v-for="group in recentGroups" :key="group.day">
              <view class="recent-day-head">
                <text class="recent-day-title">{{ group.title }}</text>
                <text class="recent-day-sum">
                  <!--
                    分组汇总：「支出 / 收入」标签无色，
                    数字按统一规则着色（支出无色、收入绿色），符号也统一（- / +）。
                    与「全部交易」页同一套做法。
                  -->
                  <text v-if="group.expense > 0" class="recent-day-exp">支出 -{{ formatWanYuan(group.expense) }}</text>
                  <text v-if="group.income > 0" class="recent-day-inc">收入 <text class="recent-day-income-num">+{{ formatWanYuan(group.income) }}</text></text>
                </text>
              </view>

              <!--
                ★ 每行右滑露出「标签 / 删除」（用户本轮第 4 条）★
                  用户原话：「设置首页和全部交易页面，
                  右滑某条流水可以快捷删除和添加标签」。
                  两个页面共用 components/TxnSwipeActions.vue，
                  按钮尺寸与颜色才能保证一致。
              -->
              <wd-swipe-action
                v-for="txn in group.list"
                :key="txn.id"
                v-model="swipeStates[txn.id]"
                class="txn-swipe"
              >
              <view
                class="txn-item"
                @click="goTxnDetail(txn.id)"
              >
              <view
                class="txn-icon"
                :style="{ backgroundColor: (txn.category_color || '#969799') + '22' }"
              >
                <text
                  class="txn-icon-text"
                  :style="{ color: txn.category_color || '#969799' }"
                >{{ iconChar(txn) }}</text>
              </view>

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

              <view class="txn-amount">
                <MoneyText
                  :cents="txn.amount_cents"
                  :type="txn.type"
                  :size="30"
                  :weight="500"
                />
                <!--
                  ★ 金额下面显示时间（用户本轮第 1 条）★

                  ★ 用户原话 ★
                    「首页流水也要跟其他页面的流水一样，在价钱下面显示时间」。

                  ★ 为什么首页原来没有 ★
                    首页按日期分组、分组头上已经写了「今天 / 昨天 / 10月3日」，
                    当时判断「时间重复」，所以副标题只放账户和备注。
                    但其他页面（全部交易 / 账户详情 / 分类详情…）都在金额下面
                    带一行 HH:mm —— 首页少了这一行，同一笔账在两个页面长得不一样。
                    用户要的是**统一**，而不是「信息最简」。
                -->
                <text class="txn-time">{{ timeLabel(txn.occurred_at) }}</text>
              </view>
              </view>

              <template #right>
                <TxnSwipeActions
                  @delete="onSwipeDelete(txn)"
                  @tag="onSwipeTag(txn)"
                />
              </template>
              </wd-swipe-action>
            </block>
          </view>
        </view>

        <!-- ④ 月历 -->
        <view class="section">
          <view class="section-head">
            <text class="section-title">月历</text>
          </view>
          <CalendarGrid
            :month-key="txnStore.currentMonth"
            :day-data="txnStore.dailyTotals"
            :selected-day="selectedDay"
            @day-click="onDayClick"
          />
        </view>

        <view class="tabbar-space" />
      </scroll-view>



      <!-- ⑦ 圆角悬浮底栏：4 个 tab + 右下角记账按钮
           ★ hidden 让它在全屏弹层打开时一起收起 ★
             记账面板 / 速记输入条是整屏弹层，底栏留在遮罩边缘会露一角，
             很难看，所以这两个场景把它藏起来（用户明确要求）。
             滚动时仍然永驻，不受影响。 -->
      <AppTabBar
        current="home"
        :hidden="showQuickAdd || showPanel"
        :hold-enabled="settingStore.quickAddHoldAction !== 'none'"
        @single-press="onFabTap"
        @hold-start="onHoldStart"
        @hold-end="onFabHoldEnd"
        @hold-cancel="onHoldCancel"
      />

      <!-- AI 智能记账输入条（替代原速记层） -->
      <QuickAddBar
        v-model="showQuickAdd"
        @saved="onSaved"
        @parsing-start="onParsingStart"
        @parsing-end="onParsingEnd"
      />

      <!-- 记账面板（长按或展开时打开） -->
      <TxnPanel v-model="showPanel" :preset="panelPreset" @saved="onSaved" />
    </block>

    <!--
      更新弹窗
      ★ 首页也挂一个的原因 ★
        开屏静默检查在 App.vue 的 onLaunch 里跑，
        那时用户正看着首页 —— 弹窗必须能在这里出现。
        组件读的是 stores/update.js 的同一份状态，
        多个页面各挂一个实例不会重复弹（dialogVisible 是单布尔）。
      ★ 必须放在 <block> 外面 ★
        上面两个分支是「有没有账户」的互斥渲染，放在 v-else 里的话，
        首次使用（还没账户）那个分支上弹窗根本不存在 ——
        而开屏检查恰恰就是那时候跑的。
    -->
    <!-- 弹窗宿主：外部打开 JSON 时可能在任意一页弹出，
         缺了这一行就退化成原生弹窗，样式与别处不一致 -->
    <!-- 右滑「标签」的标签选择弹层 -->
    <TxnTagSheet
      v-model="showTagSheet"
      :tags="tags"
      :selected-ids="tagSheetIds"
      title="选择标签"
      @picked="onTagSheetPicked"
    />

    <AppDialog />
    <UpdateDialog />
  </view>
</template>

<script>
import { ref, reactive, computed, onMounted } from 'vue'
import { onShow, onBackPress } from '@dcloudio/uni-app'
import AppHeader from '@/components/AppHeader.vue'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppTabBar from '@/components/AppTabBar.vue'
import TxnPanel from '@/components/TxnPanel.vue'
import QuickAddBar from '@/components/QuickAddBar.vue'
import CalendarGrid from '@/components/CalendarGrid.vue'
import HeaderAction from '@/components/HeaderAction.vue'
import AppDialog from '@/components/AppDialog.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import TxnSwipeActions from '@/components/TxnSwipeActions.vue'
import TxnTagSheet from '@/components/TxnTagSheet.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { useUiStore } from '@/stores/ui.js'
import { getBudgetUsage } from '@/api/stats.js'
import { getSetting, setSetting } from '@/api/settings.js'
import { listTags } from '@/api/tag.js'
import { toMonthKey, shiftMonth, formatDayHeader, relativeDayLabel, formatTime } from '@/utils/date.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'
import { isLoanPersonCategory } from '@/api/loan.js'
import { buildTxnBadges } from '@/utils/txnBadges.js'
import { formatWanYuan } from '@/utils/money.js'
import { handleBackPress } from '@/utils/layerStack.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'
import { pickRecentDisplayList, isShowingAllToday } from '@/utils/recentDisplay.js'

export default {
  components: { AppHeader, MoneyText, EmptyState, AppTabBar, TxnPanel, QuickAddBar, CalendarGrid, HeaderAction, AppDialog, UpdateDialog , TxnSwipeActions, TxnTagSheet },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()
    const txnStore = useTransactionStore()
    const uiStore = useUiStore()

    const showPanel = ref(false)
    const showQuickAdd = ref(false)

    /** 正在 AI 解析中：在最近交易顶部插入一条占位行 */
    const parsing = ref(false)
    const parsingText = ref('')
    const panelPreset = ref(null)
    const selectedDay = ref('')

    /** 预算列表（总预算 + 各分类预算） */
    const budgets = ref([])

    /** 标签表（最近收支行里显示标签胶囊，按 tag_ids 反查名字/颜色） */
    const tags = ref([])

    /* ------------------------------------------------- 右滑快捷操作 */

    /**
     * 每行的右滑状态：txnId -> 'close' | 'right'
     *
     * ★ 为什么用对象而不是给每行一个 ref ★
     *   v-for 里没法为每一行单独声明状态；用对象当字典，
     *   新数据进来时按需赋值即可（未出现过的 id 读出来是 undefined，
     *   wd-swipe-action 会当成初始收起状态）。
     */
    const swipeStates = reactive({})

    /** 标签弹层：是否打开、当前操作的那笔流水、回显的已选标签 */
    const showTagSheet = ref(false)
    const tagSheetTxn = ref(null)
    const tagSheetIds = ref([])

    /**
     * 右滑删除
     *
     * ★ 为什么先确认再删 ★
     *   右滑是很容易误触的手势（尤其单手滑列表时）。
     *   删除虽然只是软删除，但用户界面上看不到「撤销」入口，
     *   误删一笔账要恢复得去翻数据库 —— 确认框是最后一道防线。
     */
    async function onSwipeDelete(txn) {
      if (swipeStates[txn.id]) swipeStates[txn.id] = 'close'
      const ok = await confirmDialog({
        title: '删除这笔流水？',
        content: `${txnTitle(txn)} · ¥${(Number(txn.amount_cents || 0) / 100).toFixed(2)}`,
        confirmText: '删除',
        cancelText: '取消',
        danger: true
      })
      if (!ok) return
      try {
        await txnStore.remove(txn.id)
        uni.showToast({ title: '已删除', icon: 'none' })
      } catch (e) {
        await alertDialog({ title: '删除失败', content: e.message })
      }
    }

    /** 右滑标签：打开弹层，回显这笔已有的标签 */
    function onSwipeTag(txn) {
      if (swipeStates[txn.id]) swipeStates[txn.id] = 'close'
      tagSheetTxn.value = txn
      tagSheetIds.value = Array.isArray(txn.tag_ids) ? txn.tag_ids.slice() : []
      showTagSheet.value = true
    }

    /**
     * 标签弹层确定
     *
     * ★ 用 'set' 语义（覆盖）而不是 'add' ★
     *   这是「给单笔流水选标签」，弹层里回显的就是它当前的标签，
     *   用户取消勾选某个 = 想移除它。如果用 add，就永远删不掉标签了。
     *   （批量多选那边才用 add，语义不同，见 list.vue）
     */
    async function onTagSheetPicked(ids) {
      const txn = tagSheetTxn.value
      showTagSheet.value = false
      if (!txn) return
      try {
        await txnStore.update(txn.id, { tag_ids: ids })
        uni.showToast({ title: '标签已更新', icon: 'none' })
      } catch (e) {
        await alertDialog({ title: '保存标签失败', content: e.message })
      }
    }

    /**
     * 本月是否有任何交易记录。
     *
     * ★ 曾经用于「滑到底部隐藏悬浮按钮」的豁免判断 ★
     *   按钮现在永驻在底栏里，不再随滚动隐藏，
     *   这条判断暂时没人用了；保留它是因为
     *   「本月无数据」这个语义别处可能还要用（如空态文案），
     *   删掉容易在下次需要时重复实现。
     */
    const isMonthEmpty = computed(() => {
      const daily = txnStore.dailyTotals || {}
      return Object.keys(daily).length === 0
    })

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    const hasAccounts = computed(() => accountStore.hasAccounts)

    const overview = computed(() => txnStore.overview)

    /** 月预算（scope=total） */
    const totalBudget = computed(
      () => budgets.value.find((b) => b.scope === 'total') || null
    )

    /**
     * 子预算列表（没有则为空数组，概览卡里不显示）
     *
     * ★ 变量名仍叫 categoryBudgets ★
     *   数据结构的 scope 还是 'category'（v18 只是改了用户能看到的叫法），
     *   模板里 b.name / b.percent / b.used / b.limit / b.dailyAvailable 都不变，
     *   改名只会带来无谓的 diff。
     */
    const categoryBudgets = computed(
      () => budgets.value.filter((b) => b.scope === 'category')
    )

    /*
     * 子预算是否折叠（用户本轮要求）
     *
     * ★ 为什么存 setting 而不是存内存 ★
     *   用户要的是「记住展开和折叠的状态」——
     *   只存内存的话，下次冷启动 App 又变回默认值，
     *   用户会觉得「我明明折起来了，怎么又展开了」。
     *   跟 statsPanels 同一套做法：getSetting/setSetting 走 setting 表 KV。
     *
     * ★ 默认值 false = 默认展开 ★
     *   刚装 App 的人不该先看到一个收起来的区块 ——
     *   那会让人以为「子预算没了」。
     */
    const subBudgetsCollapsed = ref(false)

    /** 切换子预算展开 / 折叠，立即写库 */
    function toggleSubBudgets() {
      subBudgetsCollapsed.value = !subBudgetsCollapsed.value
      setSetting('subBudgetsCollapsed', subBudgetsCollapsed.value).catch(() => {})
    }

    /** 预算剩余：优先用月预算，没有月预算就用子预算合计 */
    const budgetRemaining = computed(() => {
      if (totalBudget.value) return totalBudget.value.remaining
      if (categoryBudgets.value.length > 0) {
        return categoryBudgets.value.reduce((acc, b) => acc + b.remaining, 0)
      }
      return 0
    })

    /**
     * 最近收支的显示列表（用户定规则，见 utils/recentDisplay.js）
     *
     * ★ 规则 ★
     *   当日记录 < 5 条  -> 显示最近 5 条（可能跨好几天）
     *   当日记录 >= 5 条 -> 显示**全部**当日记录
     *
     * ★ 为什么数据源是 todayAll 而不是 todayList ★
     *   todayAll 是 listAllTransactionsOfDay()（不限条数）；
     *   todayList 是 listTodayTransactions(20)，有 20 条上限 ——
     *   用它做数据源，记了 25 笔的那天会少显示 5 笔，
     *   和「显示全部当日记录」直接矛盾。
     *
     * 规则本身抽在纯函数里，边界条件（4/5 两条）有单测钉着。
     */
    const recentDisplayList = computed(() =>
      pickRecentDisplayList({
        todayAll: txnStore.todayAll || [],
        recentList: txnStore.recentList || []
      })
    )

    /** 当前是否处于「显示全部当日」模式（标题可据此标注范围） */
    const showingAllToday = computed(() =>
      isShowingAllToday(txnStore.todayAll || [])
    )

    /**
     * 按日期分组的最近收支
     *
     * ★ 分组右边的「支出 / 收入」必须是当日全部流水的合计 ★
     *   以前这个数是**把显示出来的这几条**累加出来的：
     *     某天记了 10 笔，列表里只露出 2 笔，
     *     那一组右边就只写这 2 笔的合计，和当天的真实收支对不上，
     *     看着像少记了钱。
     *   现在改成查「按天聚合的全部流水」（txnStore.allDailyTotals）：
     *     右侧的合计永远是该日真实发生的全部收支，
     *     与列表里露出几条无关。
     *
     * ★ 为什么用 allDailyTotals 而不是 dailyTotals ★
     *   dailyTotals 只含当月，而「最近 5 条」可能跨月
     *   （上个月最后一笔 + 这个月几笔），
     *   跨月的那天在 dailyTotals 里查不到，合计就会变成 0。
     */
    const recentGroups = computed(() => {
      const list = recentDisplayList.value
      const totals = txnStore.allDailyTotals || {}
      const groups = []
      for (const txn of list) {
        let g = groups.find((x) => x.day === txn.occurred_day)
        if (!g) {
          // 当日全部流水的合计（不是这几条显示出来的记录）
          const dayTotal = totals[txn.occurred_day] || { expense: 0, income: 0, count: 0 }
          g = {
            day: txn.occurred_day,
            title: formatDayHeader(txn.occurred_day),
            list: [],
            expense: dayTotal.expense,
            income: dayTotal.income,
            // 当日总笔数 —— 和合计同源，避免「合计是当日的、笔数是显示出来的」这种混搭
            count: dayTotal.count
          }
          groups.push(g)
        }
        g.list.push(txn)
      }
      return groups
    })

    const monthLabel = computed(() => {
      const [, m] = txnStore.currentMonth.split('-')
      return `${Number(m)}月`
    })

    const calendarTitle = computed(() => {
      const [y, m] = txnStore.currentMonth.split('-')
      return `${y}年${Number(m)}月`
    })

    /* ------------------------------------------------------ 滚动监听 */

    /*
     * ★ 这里删掉了原来「滑到底部隐藏悬浮按钮」的整套逻辑 ★
     *   （fabHidden / scrollViewHeight / measureScrollView / onScroll）
     *   记账按钮改成永驻在底栏右端，不再随滚动隐藏，
     *   滚动监听没有别的用途，留着只会白跑计算。
     */

    /* ------------------------------------------------------ 数据加载 */

    async function loadAll(force = false) {
      await accountStore.load(force)
      if (!accountStore.hasAccounts) return

      await txnStore.loadHome(force)

      // 标签（最近收支行的标签胶囊用）
      try {
        tags.value = await listTags()
      } catch (e) {
        tags.value = []
      }

      // 预算
      try {
        budgets.value = await getBudgetUsage(txnStore.currentMonth)
      } catch (e) {
        budgets.value = []
      }

      // 子预算的折叠状态（跟预算数据一起刷，保证跨设备/跨启动一致）
      try {
        const collapsed = await getSetting('subBudgetsCollapsed', false)
        subBudgetsCollapsed.value = collapsed === true
      } catch (e) {
        subBudgetsCollapsed.value = false
      }
    }

    /* ------------------------------------------------------ 月历 */

    function shiftCalMonth(delta) {
      const next = shiftMonth(txnStore.currentMonth, delta)
      txnStore.loadMonth(next).then(({ daily }) => {
        txnStore.dailyTotals = daily
      })
      // 同步预算
      getBudgetUsage(next).then((list) => {
        budgets.value = list
      }).catch(() => {})
    }

    /**
     * 当前月历是不是「本月」
     *
     * ★ 为什么要单独一个 computed ★
     *   模板里要用它决定「回到本月」按钮显不显示，
     *   而 toMonthKey() 是「此刻」的结果；
     *   写在模板里每次渲染都要调一次（且不是响应式的）。
     *   放进 computed 依赖 txnStore.currentMonth，切月时自动重算。
     *
     *   ★ 为什么不把 toMonthKey() 也放进 computed 的依赖 ★
     *     它不是响应式数据，放进去也不会重新触发；
     *     而「跨过月分界的午夜」本身也是极罕见场景（那时会走 loadHome 刷新）。
     */
    const isCurrentMonth = computed(() => txnStore.currentMonth === toMonthKey())

    /** 一键回到本月（和 shiftCalMonth 走完全相同的刷新链） */
    function backToCurrentMonth() {
      const mk = toMonthKey()
      if (txnStore.currentMonth === mk) return
      txnStore.loadMonth(mk).then(({ daily }) => {
        txnStore.dailyTotals = daily
      })
      getBudgetUsage(mk).then((list) => {
        budgets.value = list
      }).catch(() => {})
    }

    /** 点击月历某一天 → 跳到「全部交易」页并定位到当天 */
    function onDayClick(dayKey) {
      selectedDay.value = dayKey
      uni.navigateTo({ url: `/pages/txn/list?day=${dayKey}` })
    }

    /* ------------------------------------------------------ 交互 */

    /**
     * 打开某种记账入口
     * @param {string} act ai | manual
     */
    function openQuickAddFor(act) {
      if (act === 'ai') {
        showQuickAdd.value = true
        return
      }
      if (act === 'manual') {
        panelPreset.value = null
        showPanel.value = true
      }
      // none：什么都不做
    }

    /**
     * 短按 + 号
     * 触发什么由「设置 → 记账按钮设置」决定（默认 AI 速记）
     */
    function onFabTap() {
      openQuickAddFor(settingStore.quickAddTapAction)
    }

    /**
     * 长按 + 号
     * 触发什么由「设置 → 记账按钮设置」决定（默认手动记账）
     */
    function onFabHoldEnd() {
      openQuickAddFor(settingStore.quickAddHoldAction)
    }

    /** 长按开始（触觉反馈在 AppTabBar 内，这里只占位） */
    function onHoldStart() {}

    function onHoldCancel() {}

    /**
     * QuickAddBar 开始请求 AI 时触发。
     * 在最近交易顶部插入「正在解析」占位行，让用户立刻看到反馈，
     * 而不是盯着一个没反应的输入框等几秒。
     */
    function onParsingStart(payload) {
      parsingText.value = (payload && payload.text) || ''
      parsing.value = true
    }

    function onParsingEnd() {
      parsing.value = false
      parsingText.value = ''
    }

    function onSaved() {
      parsing.value = false
      parsingText.value = ''
      loadAll(true)
    }

    /* ------------------------------------------------------ 展示辅助 */

    function iconChar(txn) {
      if (txn.type === 'transfer') return '⇄'
      // 优先用分类自带的 icon 键，没有就按名称猜
      return txn.category_icon
        ? iconEmoji(txn.category_icon)
        : guessIconByName(txn.category_name)
    }

    function txnTitle(txn) {
      if (txn.type === 'transfer') {
        return `${txn.account_name || '-'} → ${txn.to_account_name || '-'}`
      }
      return txn.category_name || '未分类'
    }

    /**
     * 时间标签（金额下面那一行 HH:mm）
     *
     * ★ 为什么单独一个函数而不是模板里直接调 formatTime ★
     *   这笔流水没有 occurred_at 时（老数据 / 导入异常）要显示空串，
     *   而不是 "NaN:NaN"。统一在这一层兜住，模板保持干净。
     *   和其他页面（RecentTxnList、pages/txn/list.vue）同一套做法。
     */
    function timeLabel(ts) {
      return formatTime(ts)
    }

    function txnSub(txn) {
      const parts = []
      /*
       * ★ 账户在前、备注在后（用户指定）★
       *   账户名是「这笔钱从哪出」的定位信息，比备注更该先被看到；
       *   备注长短不一，放前面会把账户名挤到省略号里。
       */
      if (txn.type !== 'transfer') parts.push(txn.account_name || '')
      // 人员类流水的 note 已在胶囊里显示，副标题不再重复一次
      if (txn.note && !isLoanPersonCategory(txn.category_name)) parts.push(txn.note)
      return parts.filter(Boolean).join(' · ') || '无备注'
    }

    /**
     * 标签 id -> { name, color } 映射（和全部交易页同一套做法）
     * 交易里只存 tag_ids，要显示名字/颜色得靠标签表反查。
     */
    const tagNameMap = computed(() => {
      const m = {}
      for (const t of tags.value) m[t.id] = { name: t.name, color: t.color || '' }
      return m
    })

    /**
     * 一笔交易的「徽标」集合：周期 / 组合账户 / 用户标签，按固定顺序。
     *
     * ★ 用户要求 ★
     *   周期、组合账户、标签都统一成同一种「描边胶囊」样式（见 .txn-tag），
     *   颜色/内容各不相同，但样式一致；全部跟在分类名下面。
     *   组合账户不是标签，是独立标记（来自 via_combo_id）。
     */
    /**
     * 一笔交易的徽标集合
     *
     * ★ 顺序唯一来源：utils/txnBadges.js（本轮用户第 1 条）★
     *   用户标签 > 人员名称 > 待报销/已报销 > 周期 > 组合账户 > 不计收支
     *   以前这个顺序在五个页面各写一份，改一次要改五处；
     *   现在只剩 utils/txnBadges.js 一份，五个页面调同一个函数。
     */
    function txnBadges(txn) {
      return buildTxnBadges(txn, {
        primaryColor: primaryColor.value,
        tagMap: tagNameMap.value
      })
    }

    /* ------------------------------------------------------ 路由 */

    function goAddAccount() {
      uni.navigateTo({ url: '/pages/account/edit' })
    }

    function goProfile() {
    uni.navigateTo({ url: '/pages/settings/profile' })
  }

    function goAllTxn() {
      uni.navigateTo({ url: '/pages/txn/list' })
    }

    function goTxnDetail(id) {
      uni.navigateTo({ url: `/pages/txn/detail?id=${id}` })
    }

    function goBudget() {
      uni.navigateTo({ url: '/pages/settings/budget' })
    }

    function goAiChat() {
      uni.navigateTo({ url: '/pages/ai/chat' })
    }

    /* ------------------------------------------------------ 生命周期 */

    onMounted(() => {
      if (!settingStore.loaded) {
        settingStore.load().then(() => loadAll())
      } else {
        loadAll()
      }
    })

    onShow(() => {
      // 每次回到首页刷新，保证记账后数据即时可见
      if (settingStore.loaded) {
        loadAll(true)
      }
      settingStore.syncSystemTheme()
      // 隐藏原生 tabBar（自绘底栏已经在显示，见 AppTabBar）
      settingStore.refreshTabBar()
      // 在别的 tab 页点了记账按钮 → 这里补上打开动作
      const pending = uiStore.consumePendingAdd()
      if (pending) openQuickAddFor(pending)
    })

    /*
     * ★ 周期补记完成后立刻刷新（用户反馈的 bug）★
     *
     *   竞态：App.vue 的 onShow 里 runCycleCatchUp() 是异步写库，
     *   而本页 onShow 的 loadAll(true) 不等它 —— 先读出旧数据渲染，
     *   补记才落库，于是「补记了却看不见」，要等下次刷新。
     *
     *   App.vue 在补记成功且确有新增时 emit 'cycle:caughtup'，
     *   这里收到就再拉一次。只在真补了账时才触发，
     *   没补账的日子不会有任何多余查询。
     */
    uni.$on('cycle:caughtup', () => {
      if (settingStore.loaded) loadAll(true)
    })

    /* 外部文件导入完成 → 整库换掉，首页概览 / 日历 / 今日列表全部重查 */
    uni.$on('data:imported', () => {
      if (settingStore.loaded) loadAll(true)
    })

    /*
     * ★ 侧滑返回 / 返回键：有弹层时先收起弹层，不退出页面 ★
     *   TxnPanel / QuickAddBar 打开时会登记进弹层栈（utils/layerStack.js），
     *   这里返回 true 表示「本次返回已消费」，页面不动。
     */
    onBackPress(() => handleBackPress())

    return {
      formatWanYuan,
      settingStore, accountStore, txnStore,
      showPanel, panelPreset,
      selectedDay, showQuickAdd, parsing, parsingText,
      primaryColor, pageStyle, hasAccounts, overview, calendarTitle,
      totalBudget, categoryBudgets, budgetRemaining, subBudgetsCollapsed,
      toggleSubBudgets, recentGroups, showingAllToday,
      shiftCalMonth, backToCurrentMonth, isCurrentMonth, onDayClick,
      openQuickAddFor, onFabTap, onFabHoldEnd, onHoldStart, onHoldCancel,
      onParsingStart, onParsingEnd, onSaved,
      iconChar, txnTitle, txnSub, txnBadges, timeLabel,
      /*
       * ★ tags 必须暴露给模板（bug 修复）★
       *   <TxnTagSheet :tags="tags"> 读的是模板作用域里的 tags，
       *   setup 里声明了但没 return，模板拿到的是 undefined ——
       *   Vue 只会 print 一句 "Property tags was accessed during render
       *   but is not defined on instance"，然后标签弹层永远是空的。
       *   控制台那一大片警告就是这个。
       */
      tags,
      // 右滑快捷操作
      swipeStates, showTagSheet, tagSheetIds, onSwipeDelete, onSwipeTag, onTagSheetPicked,
      goAddAccount, goProfile, goAllTxn, goTxnDetail, goBudget, goAiChat
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

/* 智能助手按钮已抽成 components/HeaderAction.vue，
   首页 / 统计页 / 账户页 / 我的页 共用同一套样式 */

.guide-area {
  padding-top: 120rpx;
}

/* 概览卡：与账户页总资产卡同款渐变底色 */
.overview-card {
  background: linear-gradient(135deg, var(--app-hero-from), var(--app-card));
  border-radius: 24rpx;
  padding: 32rpx 32rpx 28rpx;
  margin-top: 8rpx;
  box-shadow: var(--app-shadow);
}

/* 右上角月份切换 */
.ov-month-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

.ov-month-title {
  font-size: 26rpx;
  color: var(--app-text-2);
  font-weight: 500;
}

.ov-month-btns {
  display: flex;
  gap: 10rpx;
}

.ov-month-btn {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background-color: var(--app-card);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  color: var(--app-text-2);
}

/* 上方并联：今日支出 / 本月支出
   整组相对卡片居中，而不是各自撑满一半 */
.ov-top {
  display: flex;
  align-items: center;
  justify-content: center;
  padding-bottom: 24rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.ov-top-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
  /* 不设 flex:1，宽度由内容决定，整组才能真正居中 */
  min-width: 180rpx;
}

.ov-top-label {
  font-size: 24rpx;
  color: var(--app-text-2);
}

/* 金额行：只放金额本身
   ★ 不再套「+ / -」符号 ★
     上方两项都是「支出额」，前面加「-」会让人以为是负数，
     跟下面带正负号的结余摆在一起更容易混淆。 */
.ov-top-amount {
  display: flex;
  align-items: baseline;
  gap: 2rpx;
}

.ov-top-divider {
  width: 1rpx;
  height: 52rpx;
  background-color: var(--app-line);
  margin: 0 40rpx;
}

/* 下方三项：今日收入 / 本月收入 / 本月结余 */
.ov-split {
  display: flex;
  align-items: center;
  margin-top: 24rpx;
}

.ov-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
}

.ov-item-label {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.ov-divider {
  width: 1rpx;
  height: 48rpx;
  background-color: var(--app-line);
}

/* 下方预算进度条 */
.ov-budgets {
  margin-top: 24rpx;
  padding-top: 24rpx;
  border-top: 1rpx solid var(--app-line);
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

/*
 * 预算区：每个预算一条「头 → 进度条 → 脚」
 *
 * ★ 四角排布 ★
 *   头行左边：预算名称 + 百分比      头行右边：日均可用
 *   脚行左边：已用 / 总额            脚行右边：留空
 *   百分比从脚行挪到名称后面，是因为它和名称一起才构成
 *   「哪个预算、花了多少比例」这个完整信息；
 *   脚行只留纯金额，右侧刻意空着，让左侧数字不被挤到中间。
 */
.ov-budget {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.ov-budget-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16rpx;
}

/* 头行左侧：名称 + 百分比，两者作为一组靠左 */
.ov-budget-head-left {
  display: flex;
  align-items: baseline;
  gap: 10rpx;
  min-width: 0;
}

.ov-budget-name {
  font-size: 24rpx;
  color: var(--app-text-2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 右侧：剩余日均预算 */
.ov-budget-daily {
  font-size: 21rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
}

/* 百分比紧跟在名称后，与名称同基线，比名称稍重一点才不被忽略 */
.ov-budget-pct {
  font-size: 22rpx;
  font-weight: 500;
  flex-shrink: 0;
}

.ov-budget-bar {
  height: 10rpx;
  background-color: var(--app-card-2);
  border-radius: 5rpx;
  overflow: hidden;
}

.ov-budget-fill {
  height: 100%;
  border-radius: 5rpx;
  transition: width 0.35s ease;
}

/*
 * 脚行：只放金额（左对齐）。
 *
 * ★ 右侧为什么是空的 ★
 *   百分比已经上移到头行，脚行右边没有内容了。
 *   保留 justify-content: flex-start 让金额自然贴左，
 *   不要用 space-between —— 那会在只有一个子元素时也把它推到最左，
 *   行为一样但语义不清（将来加元素会立刻变成两端对齐）。
 */
/*
 * 脚行：左边已用 / 总额，右边子预算折叠条
 *
 * ★ 从 flex-start 改成 space-between ★
 *   用户要求把折叠文字放到「月预算的右下角」。
 *   脚行右侧本来是空的，现在刚好装下它。
 */
.ov-budget-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.ov-budget-amount {
  display: flex;
  align-items: center;
  gap: 6rpx;
}

.ov-budget-slash {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/*
 * 子预算折叠条
 *
 * ★ 为什么需要它 ★
 *   子预算一多，概览卡会被撞到一个屏幕都装不下，
 *   而大多数时候用户只想看月预算那一条。
 *   它只是一行小字，不抢以下任何一条预算的注意力。
 */
/*
 * 子预算折叠条
 *
 * ★ 两种位置共用同一套样式 ★
 *   常规：在月预算的脚行右侧（用户本轮要求）；
 *   兜底：没有月预算时单独占一行（.ov-subbudget-toggle-standalone）。
 *   两者只差一个外距，不值得写两份。
 */
.ov-subbudget-toggle {
  display: flex;
  align-items: center;
  gap: 8rpx;
  flex-shrink: 0;
}

/* 兜底版：单独占一行时自己补一点上下留白 */
.ov-subbudget-toggle-standalone {
  padding: 4rpx 0 2rpx;
}

.ov-subbudget-toggle-text {
  font-size: 21rpx;
  color: var(--app-text-3);
}

/* 箭头：折叠时朝右，展开时转下 */
.ov-subbudget-toggle-arrow {
  font-size: 24rpx;
  color: var(--app-text-3);
  line-height: 1;
  transition: transform 0.18s ease;
}

.ov-subbudget-toggle-arrow.open {
  transform: rotate(90deg);
}

/* 最近收支的日期分组头 */
.recent-day-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 28rpx 8rpx;
  background-color: var(--app-card);
}

.recent-day-title {
  font-size: 24rpx;
  color: var(--app-text-2);
  font-weight: 500;
}

.recent-day-sum {
  display: flex;
  gap: 16rpx;
}

/*
 * ★ 分组头：「支出 / 收入」标签无色，数字按统一规则着色 ★
 *   标签本身保持 text-3（不要整段泛绿），
 *   收入的**数字**仍是绿色，和流水金额的观感一致。
 */
.recent-day-exp {
  font-size: 21rpx;
  color: var(--app-text-3);
}

.recent-day-inc {
  font-size: 21rpx;
  color: var(--app-text-3);
}

/* 收入金额数字：绿色（只有数字着色，标签保持无色） */
.recent-day-income-num {
  color: var(--app-success);
}

/* 区块 */
.section {
  margin-top: 32rpx;
}

/*
 * 月份导航左侧：年月 + 「回到本月」
 *
 * ★ 用户两次纠正后的位置 ★
 *   第一次：「我指的不是在日历正中间掐一个『回到本月』，
 *   而是在年月显示和左右切换的中间加一个『回到本月』」。
 *   第二次：「回到本月的按钮应该显示在年月之后，而不是按钮之前」。
 *
 *   → 它紧跟「2026年11月」后面，和年月同属左侧一组；
 *     箭头单独留在右边。
 *     2026年11月  回到本月            ‹ ›
 *
 * ★ 为什么不能和箭头挤在同一组 ★
 *   那样「回到本月」就贴在箭头左边、离年月很远，
 *   看起来像是箭头按钮的附属物，而不是「对当前月份的说明」。
 *   包一层 .ov-month-left，让它和标题用 gap 紧挨着。
 */
.ov-month-left {
  display: flex;
  align-items: center;
  gap: 12rpx;
  min-width: 0;
}

/*
 * 「回到本月」
 *
 * ★ 尺寸要比箭头那对小圆钮矮一点、宽一点 ★
 *   它是文字按钮，不是图标按钮；如果做成和箭头一样的圆，
 *   四个汉字放不下，只能缩字号，反而更小气。
 *   用胶囊形（height 44rpx + 左右 padding），比箭头（48rpx 圆）略矮，
 *   视觉上「次要操作」的层级是对的。
 *
 * ★ 底色用浅主题色，不用实心主题色 ★
 *   它旁边就是两个箭头，实心主题色会把这一整行压得很重；
 *   浅底 + 主题色文字，既有可点提示又不抢戏。
 *   --app-primary-light 是半透明主题色，浅深色都自带正确观感。
 */
.ov-month-today {
  height: 44rpx;
  display: flex;
  align-items: center;
  padding: 0 16rpx;
  border-radius: 999rpx;
  background-color: var(--app-primary-light);
  color: var(--app-primary);
  font-size: 22rpx;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
  padding: 0 4rpx;
}

.section-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
}

.section-more {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.section-empty {
  background-color: var(--app-card);
  border-radius: 20rpx;
}

/* 交易列表 */
.txn-list {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
}

/*
 * ★ 行高收紧（用户本轮第 2 条）★
 *   用户原话：「我希望各个页面的流水都能够显示得紧凑一点，
 *   但是不要改变现有的布局」。
 *
 * ★ 为什么只改 padding/gap，不动字号和图标尺寸 ★
 *   字号一变，整个页面的字号层级（分组头 30 / 正文 28 / 副标题 22）
 *   就得跟着重排，那就是“改布局”了。
 *   图标直径同理：它决定了左侧栏宽度。
 *   真正只影响“密度”、不影响层级的，就是行内边距和元素间距。
 *
 *   padding 24 → 18rpx：上下共省 12rpx，一屏多出约半条流水；
 *   gap 20 → 16rpx：图标与文字之间稍收，横向也更连贯。
 */
.txn-item {
  display: flex;
  align-items: center;
  padding: 18rpx 24rpx;
  gap: 16rpx;
  border-bottom: 1rpx solid var(--app-line);
}

/*
 * 最后一行不画分隔线
 *
 * ★ 选择器必须从 .txn-swipe 选进去 ★
 *   加了右滑容器后，.txn-item 不再是卡片容器的直接子元素，
 *   `.txn-item:last-child` 永远匹配不到 —— 最后一行会多出一条线。
 */
.txn-swipe:last-child .txn-item {
  border-bottom: none;
}

/* 右滑容器高度由内容撑开；按钮要占满整行高度，必须显式 inherit */
.txn-swipe {
  background-color: var(--app-card);
}

.txn-icon {
  width: 76rpx;
  height: 76rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.txn-icon-text {
  font-size: 30rpx;
  font-weight: 500;
}

.txn-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  min-width: 0;
}

.txn-name {
  font-size: 28rpx;
  color: var(--app-text);
  font-weight: 500;
}

/* 名称行：分类名 + 周期徽标 + 标签胶囊，一行横排 */
.txn-name-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
}

.txn-name.ellipsis {
  flex-shrink: 1;
  min-width: 0;
}

/**
 * 徽标：周期 / 组合账户 / 标签统一成同一种「描边胶囊」。
 *
 * ★ 用户要求（以周期的样式为准）★
 *   颜色、内容可不同，但边框描边、圆角、字号、内边距一致：
 *   1rpx 实线描边 + 12% 同色浅底 + 同色文字。
 *   color / background-color / border-color 由模板内联覆盖（见 txnBadges）。
 *   这里只是「标签没设颜色」时的中性灰兜底。
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
  font-size: 22rpx;
  color: var(--app-text-3);
}

.txn-amount {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
  flex-shrink: 0;
}

/*
 * 金额下面的时间
 *
 * ★ 数值与 pages/txn/list.vue 的 .txn-time 严格一致 ★
 *   字号 20rpx、--app-text-3。两个页面同一笔账，右边这一列必须长得一样；
 *   如果这里用 22 或者 text-2，切页面时会觉得「同一行字怎么粗细不同」。
 */
.txn-time {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.txn-day {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* ============ 正在解析占位行 ============ */
.parsing-item {
  /* 轻微高亮，与真实记录区分 */
  background-color: var(--app-primary-light);
}

.parsing-icon {
  position: relative;
}

/* 呼吸中的圆点 */
.parsing-dot {
  width: 24rpx;
  height: 24rpx;
  border-radius: 50%;
  animation: parsing-pulse 1.1s ease-in-out infinite;
}

@keyframes parsing-pulse {
  0%, 100% {
    transform: scale(0.6);
    opacity: 0.45;
  }
  50% {
    transform: scale(1);
    opacity: 1;
  }
}

.parsing-name {
  /* 文字做微弱的明暗流动，暗示"处理中" */
  animation: parsing-fade 1.4s ease-in-out infinite;
}

@keyframes parsing-fade {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 1; }
}

/* 三根跳动的竖条 */
.parsing-bars {
  display: flex;
  align-items: flex-end;
  gap: 6rpx;
  height: 32rpx;
}

.pbar {
  width: 8rpx;
  border-radius: 4rpx;
  animation: parsing-bar 0.9s ease-in-out infinite;
}

.pbar:nth-child(1) {
  animation-delay: 0s;
}
.pbar:nth-child(2) {
  animation-delay: 0.15s;
}
.pbar:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes parsing-bar {
  0%, 100% { height: 10rpx; opacity: 0.45; }
  50%      { height: 30rpx; opacity: 1; }
}

/* 月历导航（已移到概览卡右上角，这里只保留月历自身样式） */

</style>
