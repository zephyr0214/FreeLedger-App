<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <!--
      标题随类型变化：借出管理 / 借入管理

      ★ 右上角没有「记一笔」★
        用户要求去掉。这一页回答的是「谁欠我多少」，
        不是「记流水」；要记一笔走首页的记账面板。
    -->
    <PageNav :title="pageTitle" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
      <!--
        汇总卡：只保留「现在还有多少钱在外面」这一个结论

        ★ 为什么不再显示「累计借出 / 借款收回 / 累计笔数」★
          那三项是「全部流水」视角的指标，而这页是按人看账：
          用户真正要的是「还有多少人没还清、一共多少钱」。
          累计数在统计页和交易列表里都能看到，重复三行只是噪音。
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
          就是筛选条上那套 `.seg-toggle` + `.seg-item`，
          不另写一套 tab，否则同一批控件在 App 里会有三种长相。
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
      <view v-if="!loading && groups.length === 0" class="empty-wrap">
        <EmptyState :emoji="headEmoji" :title="emptyTitle" :desc="emptyDesc" />
      </view>

      <!--
        人员分组列表

        ★ 形制照「按日期分组的流水列表」来（用户要求）★
          以前是「一张卡片 + 点开弹层看明细」，用户说不是他要的样子。
          现在每组就是：
            组头：人名 + 待归还/多归还金额 + 一个按钮
            组内：这个人的每一笔流水，直接铺在下面
          这样「谁、欠多少、怎么欠的」在同一屏看完，不用再点开。

        ★ v1.23：组内按「结清批次」分段 ★
          同一个人结清过又新借时，历史已结清的流水不能和现在的欠款
          混在一起平铺（用户要求「自动折叠之前已结清的流水，可展开」）。
          分段（余额何时回到 0）全部由 api/loan.js 的 splitLoanEpisodes 算好，
          页面只做展示，不在这边再推一遍余额 —— 公式只能有一份。
      -->
      <view v-else class="group-list">
        <view v-for="g in groups" :key="g.person" class="person-group">
          <!-- 组头 -->
          <view class="group-head">
            <view class="group-head-left">
              <view class="person-avatar" :style="{ backgroundColor: accentColor + '22' }">
                <text class="person-avatar-text" :style="{ color: accentColor }">{{ avatarText(g.person) }}</text>
              </view>
              <view class="person-meta">
                <text class="person-name ellipsis">{{ g.person }}</text>
                <text class="person-sub">{{ g.count }} 笔 · 最近 {{ g.lastDay || '—' }}</text>
              </view>
            </view>

            <!--
              ★ 标签 + 金额同一行（用户要求）★
                以前是「金额在上、待归还/多归还」在下，两行堆在右侧，
                和左边「人名 + N 笔 · 最近日期」两行挤在一起，
                视觉上成了四行，一行信息量低还占高度。
                改成横排后右侧只占一行，和左侧的人名对齐在同一基线。
            -->
            <!--
              ★ 右侧两行，和左侧「人名 + 副标题」等高（用户要求）★
                第一行：待归还/多归还 + 金额（横排）
                第二行：手动结清按钮
              以前按钮是组头下面单独一整行，右侧就显得比左侧「矮一截」，
              而且那一行只有一个小胶囊，横向拉出一条空白。
              挪进组头右列后，左右都是两行，整块成了一个规整的矩形。

              ★ 为什么金额和按钮都在右列 ★
                二者都是「这个人的结论」：多少钱、能不能结清。
                放在同一列上下排，眼睛从上到下一扫就看完，不用回头找。
            -->
            <view class="group-head-right">
              <view class="balance-row">
                <text class="person-balance-label">{{ balanceLabel(g) }}</text>
                <text
                  class="person-balance"
                  :style="{ color: balanceColor(g) }"
                >{{ balanceText(g) }}</text>
              </view>

              <!--
                ★ 手动结清：两个方向都有，只要还没平账 ★
                  用户要求「增加借入利息和借入未还两个系统分类，逻辑和借出保持一致，
                  界面按钮正常添加，两个页面逻辑基本一致化」。
                  所以借入页也有这个按钮，只是文案和记账方向相反：
                    借出：少还 → 借出坏账（我的损失）；多还 → 借出利息（我的收益）
                    借入：还不齐 → 借入未还（我的收益）；还多了 → 借入利息（我的损失）
              -->
              <text
                v-if="!g.settled"
                class="settle-btn"
                :style="{ borderColor: accentColor, color: accentColor }"
                @click.stop="onSettle(g)"
              >手动结清</text>
            </view>
          </view>

          <!--
            组内流水：按结清批次分段

            ★ 段内顺序与交易列表一致 ★
              切批次必须按时间正序走（余额何时回 0），所以
              splitLoanEpisodes 每段给的都是正序；页面从上往下要
              「最近的在前」，所以段内用 episodeTxns(ep) 取倒序副本。

            ★ 折叠 / 分割标注的规则在 api/loan.js 的 buildLoanEpisodeView 里 ★
              哪一段默认折叠、分割线画在哪一段前面、哪一段能收起，
              全都只是纯判断、不依赖 DOM，放在 api 层可以直接单测
              （node 跑不了 .vue）。页面只提供两样东西：
              当前 tab（决定默认规则）和「用户手动展开过哪些段」。
          -->
          <view class="group-txns">
            <template v-for="(ep, epIndex) in episodeViewOf(g)" :key="g.person + '#' + epIndex">
              <!--
                已结清 tab：每两段之间画一条分割标注
                文案里的日期是**上一段**收口那笔的 occurred_day ——
                分割线压在「那段结束」的位置，才读得通「这笔结清于哪天」。
                未结清 tab 不画：那边的已结清段本身就是折叠条，再画一条是重复信息。
              -->
              <view v-if="ep.showDividerBefore" class="episode-divider">
                <view class="episode-divider-line" />
                <text class="episode-divider-text">{{ ep.dividerText }}</text>
                <view class="episode-divider-line" />
              </view>

              <!--
                未结清 tab：历史已结清的段默认折叠成这一行
                ★ 折叠时只占一行高度 ★
                  点开才铺流水 —— 用户原话「自动折叠之前已结清的流水，可展开」。
              -->
              <view
                v-if="ep.collapsed"
                class="episode-collapsed"
                @click="toggleEpisode(g.person, ep.rowIndex)"
              >
                <text class="episode-collapsed-text">{{ ep.collapseText }}</text>
                <text class="episode-collapsed-arrow">›</text>
              </view>

              <view v-else class="episode-txns">
                <view
                  v-for="t in episodeTxns(ep)"
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
                    <MoneyText :cents="t.amount_cents" :type="t.type" :size="28" :weight="500" />
                    <text class="txn-time">{{ timeLabel(t.occurred_at) }}</text>
                  </view>
                </view>

                <!--
                  展开后的已结清段给一个「收起」入口
                  只有「未结清 tab 里手动展开过的段」会给（见 buildLoanEpisodeView），
                  已结清 tab 默认全展开，再给收起等于让用户把主要信息折叠掉。
                -->
                <view
                  v-if="ep.showCollapseBtn"
                  class="episode-collapse-btn"
                  @click="toggleEpisode(g.person, ep.rowIndex)"
                >
                  <text class="episode-collapse-text">收起已结清流水</text>
                  <text class="episode-collapsed-arrow up">›</text>
                </view>
              </view>
            </template>
          </view>
        </view>

        <view class="bottom-space" />
      </view>
    </scroll-view>

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
 *     · 下面一人一组：组头是人名 + 待归还金额 + 结清按钮，组内铺他的流水
 *     · 组内差额恰好为 0 就算已结清，不存状态字段
 *   聚合逻辑全在 api/loan.js，页面只负责展示。
 *
 * ★ 人员就是备注（note）★
 *   借入借出八类的备注存的是人名，管理页按 note 分组。
 *   不建人员表：既少一次迁移，也不会出现「人员表和流水对不上」。
 *
 * ★ 借出 / 借入两个方向完全对称 ★
 *   差别只有文案和「差额正负对应的分类」，都收敛在 api/loan.js 的 pairOf() 里。
 *   页面本身除 `isIncome` 影响文案外，逻辑一字不差。
 *
 * ★ 一个人的流水可能有很多「结清批次」（v1.23）★
 *   同一个人借了还、结清，过一阵又借 —— 用户原话：
 *   「若是某位用户已结清，又产生新的借入借出，则在未结清中，
 *     自动折叠之前已结清的流水，可展开。
 *     在已结清中默认全部展开，但每次结清的中间要做分割标注已结清。」
 *   所以组内不再是「一个平铺列表」，而是按结清批次分段：
 *     · 未结清 tab：历史已结清的段默认折叠成一行「已结清 N 笔 · 点击展开」
 *     · 已结清 tab：全部展开，段与段之间画一条「—— 已结清 · 日期 ——」
 *   分段逻辑（余额何时回 0）全在 api/loan.js 的 splitLoanEpisodes 里，
 *   页面只负责「按 api 给的批次渲染 + 记折叠状态」，不再自己推余额。
 */
import { ref, reactive, computed } from 'vue'
import { onLoad, onShow, onBackPress } from '@dcloudio/uni-app'
import PageNav from '@/components/PageNav.vue'
import MoneyText from '@/components/MoneyText.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppDialog from '@/components/AppDialog.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import {
  LOAN_DIRECTIONS, listLoanGroups, settleLoanPerson, buildLoanEpisodeView
} from '@/api/loan.js'
import { handleBackPress } from '@/utils/layerStack.js'
import { alertDialog, confirmDialog } from '@/utils/dialog.js'
import { formatTime } from '@/utils/date.js'

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
    /** 当前 tab 下的分组（每组带自己的流水） */
    const groups = ref([])
    /** 两个 tab 的人数 + 未结清总额（汇总卡要用，所以两边都要算） */
    const openCount = ref(0)
    const settledCount = ref(0)
    const openTotal = ref(0)

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

    /**
     * 余额文案与标签
     *
     * ★ 借出 / 借入的正数含义相反，但都表示「未结清的金额」★
     *   借出：正数 = 对方还欠我
     *   借入：正数 = 我还欠对方
     *   两边都显示绝对值，标签分开写（待收回 / 待归还 / 多归还），
     *   数字不变号 —— 变号会让用户以为算错了。
     */
    function balanceText(g) {
      if (g.settled) return '已结清'
      const v = Math.abs(g.balance)
      return `¥${(v / 100).toFixed(2)}`
    }

    function balanceLabel(g) {
      if (g.settled) return '账目已平'
      /*
       * 余额为负 = 反向多于正向：
       *   借出：对方多还了（我还欠他钱）
       *   借入：我多还了（他欠我钱）
       */
      if (g.balance < 0) return '多归还'
      return isIncome.value ? '待归还' : '待收回'
    }

    /** 余额颜色：结清走次要色，未结清走主题色 */
    function balanceColor(g) {
      return g.settled ? 'var(--app-text-3)' : accentColor.value
    }

    /**
     * 组内流水的分类图标
     *
     * ★ 按分类名取，不按 category_icon 的 key ★
     *   这几类的 icon key 在库里分别指向 lend/borrow/more/chart，
     *   要转成 emoji 还得再引一张 key 表；而这一页的分类最多就八种，
     *   直接按名字查一张 8 项的映射最直白，也不会因为图标库改名而失效。
     *
     * @param {{category_name?:string}} t
     * @returns {string} emoji，拿不到时给一个中性符号
     */
    function iconChar(t) {
      return ICON_FALLBACK[t && t.category_name] || '¥'
    }

    /** 组内流水的副标题：时间 · 账户 */
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

    /* ------------------------------------------------ 结清批次（分段展示） */

    /**
     * 折叠状态：key = `人员名#段序号`，值 true = 用户手动展开过。
     *
     * ★ 只记「展开」，不记「折叠」★
     *   默认折叠是页面规则（未结清 tab 里历史已结清的段），
     *   如果反过来记「折叠」，换 tab / 刷新后还要把默认值逐个补回去，
     *   一旦漏补就会回到「上次的样子」，和用户预期不符。
     *   现在「有没有这个 key」就是唯一真相：没有 = 按默认规则。
     *
     * ★ key 里必须带人员名 ★
     *   段序号从 0 开始，每个人都有自己的第 0 段；
     *   只用序号当 key 的话，展开张三的第 0 段会顺带展开李四的第 0 段。
     */
    const episodeOpen = reactive({})

    /** 人员 + 段序号 → 折叠状态 key */
    function episodeKey(person, index) {
      return `${person || ''}#${index}`
    }

    /**
     * 取某个人的分段。
     *
     * ★ 为什么要兜底 ★
     *   分段是 api/loan.js 的 listLoanGroups 附带的字段（episodes）。
     *   万一拿到的是旧数据 / 字段缺失，直接 v-for g.episodes 会什么都不渲染 ——
     *   页面看着像「这人的流水丢了」。兜底成一整段「未结清」，
     *   展示效果就退回到改造前的平铺，至少不丢信息。
     */
    function episodesOf(g) {
      const eps = g && Array.isArray(g.episodes) ? g.episodes : []
      if (eps.length > 0) return eps
      return [{
        settled: false,
        txns: (g && Array.isArray(g.txns)) ? g.txns : [],
        balance: Number(g && g.balance) || 0,
        fromDay: '',
        toDay: '',
        closingDay: ''
      }]
    }

    /**
     * 某个人这一组的「段视图」：分段 + 折叠 / 分割标注的展示规则。
     *
     * ★ 规则全在 api/loan.js 的 buildLoanEpisodeView 里 ★
     *   页面只提供两样东西：当前 tab（决定默认折叠规则）
     *   和「用户手动展开过哪些段」（episodeOpen）。
     *   这样「什么时候折叠、分割线画在哪」是纯函数，可以直接单测 ——
     *   放在页面里就只能靠读源码断言，改坏了测试也发现不了。
     *
     * ★ 为什么用 computed 思路而不是在 load() 里算死 ★
     *   折叠 / 展开是「点一下立刻变」的交互，只改 episodeOpen；
     *   如果视图是 load 时算死的，点折叠条页面不会有任何反应。
     *   这里做成 setup 内的普通函数 + 模板里直接调用：
     *   episodeOpen 是 reactive 的，读它会建立依赖，改了就重渲染。
     */
    function episodeViewOf(g) {
      return buildLoanEpisodeView(episodesOf(g), {
        status: status.value,
        isExpanded: (index) => !!episodeOpen[episodeKey(g.person, index)]
      })
    }

    /**
     * 段内流水按「最近的在前」返回。
     *
     * ★ 为什么倒序 ★
     *   splitLoanEpisodes 必须按时间正序走才能判断「余额何时回 0」，
     *   所以它返回的 txns 是正序的。但页面从上往下读，最近的一笔要在最上面
     *   （和首页、交易列表一致）。这里只反转返回副本，不动 api 给的数组。
     */
    function episodeTxns(ep) {
      const list = ep && Array.isArray(ep.txns) ? ep.txns : []
      return list.slice().reverse()
    }

    /** 点折叠条 / 收起按钮：翻转这一段的展开状态 */
    function toggleEpisode(person, index) {
      const key = episodeKey(person, index)
      if (episodeOpen[key]) delete episodeOpen[key]
      else episodeOpen[key] = true
    }

    /**
     * 清理已经不存在的折叠 key。
     *
     * ★ 为什么必须清 ★
     *   用户点「手动结清」/ 删了一笔之后再刷新，分段会重新算 ——
     *   原来 3 段可能变成 2 段。旧 key 留着不会报错，
     *   但下次这个人又长出第 3 段时，会莫名其妙地保持「上次展开过」的状态，
     *   用户没法解释为什么这一段的默认行为和别人不一样。
     *   做法和本页别处清理 swipeStates 一样：只留当前数据里还活着的 key。
     */
    function pruneEpisodeStates(list) {
      const alive = new Set()
      for (const g of list) {
        const eps = episodesOf(g)
        for (let i = 0; i < eps.length; i++) {
          if (eps[i].settled) alive.add(episodeKey(g.person, i))
        }
      }
      for (const key of Object.keys(episodeOpen)) {
        if (!alive.has(key)) delete episodeOpen[key]
      }
    }

    /**
     * 加载分组
     *
     * ★ 两个 tab 的人数都要算 ★
     *   汇总卡要显示「未结清 N 人 / 已结清 M 人」，
     *   只查当前 tab 的话另一个数字永远是 0。
     *   一次 all 查回来在 JS 里分两边，比查两次少一趟 SQL。
     */
    async function load() {
      loading.value = true
      try {
        const all = await listLoanGroups(direction.value, 'all')
        const open = all.filter((g) => !g.settled)
        const settled = all.filter((g) => g.settled)

        openCount.value = open.length
        settledCount.value = settled.length
        /*
         * 「当前借出 / 当前借入」= 所有未结清余额之和
         *
         * ★ 用 balance 而不是 total - back ★
         *   balance 已经把结清那两笔算进去了（结清过的人余额正好为 0），
         *   直接用 total - back 会把已经核销的坏账又算成欠款。
         */
        openTotal.value = open.reduce((acc, g) => acc + Math.abs(g.balance), 0)

        groups.value = status.value === 'open' ? open : settled
        /*
         * 刷新后清理失效的折叠 key（做法与别处清理 swipeStates 一致）。
         * 必须在 groups.value 赋值之后 —— 它的存活判断依赖刚拿到的分段。
         */
        pruneEpisodeStates(groups.value)
      } catch (e) {
        console.warn('[loan] 加载人员账目失败:', e && e.message)
        groups.value = []
        openCount.value = 0
        settledCount.value = 0
        openTotal.value = 0
      } finally {
        loading.value = false
      }
    }

    /**
     * 切换 未结清 / 已结清。
     *
     * ★ 切 tab 时折叠状态不清 ★
     *   折叠的默认值本来就随 tab 变（已结清 tab 一律展开，见 buildLoanEpisodeView），
     *   清掉反而会让用户「在未结清里展开过、切走再切回来」时又变回折叠。
     *   这里只负责重新取数，失效的 key 由 load() 里的 pruneEpisodeStates 清。
     */
    function switchStatus(key) {
      if (status.value === key) return
      status.value = key
      load()
    }

    /**
     * 手动结清
     *
     * ★ 不输入金额，差额自动算 ★
     *   用户原话「肯定是自动计算了，多还了的，少还了的还算不出来吗」。
     *   这里只做二次确认 + 说清会生成哪一笔：
     *     借出 余额 > 0 → 「还差 ¥x 收不回来，记为借出坏账（支出）」
     *     借出 余额 < 0 → 「对方多还了 ¥x，记为借出利息（收入）」
     *     借入 余额 > 0 → 「还差 ¥x 不用还了，记为借入未还（收入）」
     *     借入 余额 < 0 → 「多还了 ¥x，记为借入利息（支出）」
     */
    async function onSettle(g) {
      const diff = g.balance
      const yuan = (Math.abs(diff) / 100).toFixed(2)

      /*
       * ★ 余额已经是 0 就不该走到这里 ★
       *   列表是按 settled 分好的，理论不会出现；
       *   但用户可能在别处删了一笔，页面数据是旧的 ——
       *   这时提示刷新，而不是写一笔 0 元流水（金额必须 > 0，会保存失败）。
       */
      if (diff === 0) {
        await alertDialog({ title: '已经是结清状态', content: '刷新一下列表再试' })
        load()
        return
      }

      const isPositive = diff > 0
      const content = settleHint(isPositive, yuan)
      const title = settleTitle(isPositive)
      const ok = await confirmDialog({
        title,
        content,
        confirmText: '确认结清',
        cancelText: '取消'
      })
      if (!ok) return

      try {
        await settleLoanPerson(g.person, direction.value)
        uni.showToast({ title: '已结清', icon: 'success' })
        await load()
      } catch (e) {
        await alertDialog({ title: '结清失败', content: e.message || '请稍后重试' })
      }
    }

    /** 结清确认框标题（按方向 + 差额正负） */
    function settleTitle(isPositive) {
      if (isIncome.value) {
        return isPositive ? '确认记为借入未还？' : '确认记为借入利息？'
      }
      return isPositive ? '确认记为坏账？' : '确认记为利息？'
    }

    /** 结清确认框正文：说清楚会写哪一类、金额多少 */
    function settleHint(isPositive, yuan) {
      if (isIncome.value) {
        return isPositive
          ? `还差 ¥${yuan} 不用还了，将记为「借入未还」收入，计入收支。`
          : `你多还了 ¥${yuan}，将记为「借入利息」支出，计入收支。`
      }
      return isPositive
        ? `还有 ¥${yuan} 收不回来，将记为「借出坏账」支出，计入收支。`
        : `对方多还了 ¥${yuan}，将记为「借出利息」收入，计入收支。`
    }

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

    // 侧滑返回 / 物理返回键
    onBackPress(() => handleBackPress())

    return {
      settingStore, loanType, status, loading, groups, openCount, settledCount, openTotal,
      pageStyle, primaryColor, isIncome, pageTitle, headEmoji, currentLabel, directionText,
      accentColor, statusTabs, emptyTitle, emptyDesc,
      avatarText, balanceText, balanceLabel, balanceColor,
      iconChar, txnSub, timeLabel, goTxnDetail,
      // 结清批次分段：episodeViewOf 给出「分段 + 折叠 / 分割标注」的展示规则
      episodeViewOf, episodeTxns, toggleEpisode,
      switchStatus, onSettle, goBack
    }
  }
}

/**
 * 分类名 → 图标 emoji
 *
 * ★ 为什么在页面里写死一张小表 ★
 *   组内流水用的是「八类借款分类」，图标固定就这几个；
 *   走 utils/icons.js 的 iconEmoji(key) 也能拿到，但那张表是按 key 取的，
 *   而这里手上只有分类名。写一张 8 项的映射最直白，也省一次 import。
 *   取值与 api/db/schema.js 的 SYSTEM_PRESET_CHILDREN 对齐。
 */
const ICON_FALLBACK = {
  借出: '📤',
  借款收回: '📥',
  借入: '📥',
  借款归还: '📤',
  借出坏账: '📦',
  借出利息: '📈',
  借入未还: '📦',
  借入利息: '📈'
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

/* ------------------------------------------------------- 人员分组 */

.group-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  margin-top: 16rpx;
}

/*
 * 一个人员分组 = 组头 + 按钮 + 他自己的流水
 *
 * 视觉上做成一张卡片：组头是浅一层底（--app-card-2），
 * 下面的流水是卡片底色，两者用圆角套着 ——
 * 和首页「按日期分组」的观感一致（日期条 → 当天流水）。
 */
.person-group {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
  box-shadow: var(--app-shadow);
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 20rpx 24rpx;
  background-color: var(--app-card-2);
}

.group-head-left {
  display: flex;
  align-items: center;
  gap: 16rpx;
  min-width: 0;
  flex: 1;
}

/* 头像：名字首字，主题色 13% 底 */
.person-avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.person-avatar-text {
  font-size: 26rpx;
  font-weight: 600;
}

.person-meta {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  min-width: 0;
  flex: 1;
}

.person-name {
  font-size: 30rpx;
  font-weight: 500;
  color: var(--app-text);
}

.person-sub {
  font-size: 21rpx;
  color: var(--app-text-3);
}

/*
 * 组头右列：第一行「标签 + 金额」，第二行「手动结清」
 *
 * ★ 两行对两行 ★
 *   左列是「人名 / N 笔 · 最近日期」两行，右列也是两行 ——
 *   整块高度由两边共同撑起，不会出现一侧空一截。
 *   这也是用户要求的「右边金额+按钮高度和左边一致」。
 *
 * ★ 右列内容整体靠右对齐 ★
 *   姓名在左、金额在右是列表的常规读法；
 *   两行都贴右边界，纵向看是一条整齐的线。
 */
.group-head-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  gap: 8rpx;
  flex-shrink: 0;
}

/*
 * 金额那一行：标签 + 数字横排
 *
 * ★ 为什么 label 在金额左边 ★
 *   「待归还 ¥300」是中文习惯的读法（先说是什么，再说多少）；
 *   反过来「¥300 待归还」在小屏上会让数字和左边界不齐，眼睛要来回找。
 *   金额用 tabular-nums，多行之间小数点自然对齐。
 */
.balance-row {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 8rpx;
}

.person-balance {
  font-size: 32rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.person-balance-label {
  font-size: 21rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
}

/*
 * 结清按钮：右列的第二行
 *
 * ★ 尺寸要克制 ★
 *   它挂在组头里，不能再是 48rpx 高的大按钮 ——
 *   否则会把这行撑高，右侧又比左侧长一截，白改。
 *   22rpx 字 + 上下 6rpx 内边距，整行高度约 36rpx，
 *   和左边「N 笔 · 最近日期」那行视觉重量相当。
 */
.settle-btn {
  font-size: 22rpx;
  line-height: 1;
  padding: 6rpx 18rpx;
  border-radius: 14rpx;
  border: 1rpx solid;
  background-color: transparent;
  white-space: nowrap;
}

/* 组内流水 */
.group-txns {
  display: flex;
  flex-direction: column;
}

/*
 * 一批已结清的流水（一段）
 *
 * 本身不画任何边框 —— 段内的 .txn-item 自己带上边框，
 * 这里只负责让段与段之间能塞下折叠条 / 分割标注。
 */
.episode-txns {
  display: flex;
  flex-direction: column;
}

/*
 * 折叠条：未结清 tab 里「之前已结清」的那几段
 *
 * ★ 高度要压到最低 ★
 *   折叠的意义就是「不占地方」。这里只有一行小字 + 一个箭头，
 *   上下 16rpx 内边距，视觉上接近一条分割线而不是一行列表项 ——
 *   一眼能看出它是「折叠摘要」，不会误当成一笔流水。
 *
 * ★ 底色用 --app-card-2 ★
 *   和组头同色，表示它是「组的附属信息」而不是明细；
 *   深色模式下也是同一套变量，不用另写深色覆盖。
 */
.episode-collapsed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 16rpx 24rpx;
  border-top: 1rpx solid var(--app-line);
  background-color: var(--app-card-2);
}

.episode-collapsed-text {
  font-size: 22rpx;
  color: var(--app-text-3);
}

/* 折叠箭头：展开时 rotate(90deg) 朝下，收起时朝右 */
.episode-collapsed-arrow {
  font-size: 26rpx;
  color: var(--app-text-3);
  line-height: 1;
  transform: rotate(90deg);
}

.episode-collapsed-arrow.up {
  transform: rotate(-90deg);
}

/* 展开后的「收起」入口：同样是低存在感的一行小字 */
.episode-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  padding: 14rpx 24rpx;
  border-top: 1rpx solid var(--app-line);
}

.episode-collapse-text {
  font-size: 21rpx;
  color: var(--app-text-3);
}

/*
 * 「已结清」分割标注（只在已结清 tab、段与段之间）
 *
 * ★ 两侧细线 + 中间文字 ★
 *   用户要求「每次结清的中间要做分割标注已结清」。
 *   两边各一条 --app-line 的线，中间夹一行 --app-text-3 的小字，
 *   和微信/支付宝账单里「以下为历史账单」那种分隔同一个观感。
 *
 * ★ 不给它加背景色 ★
 *   它压在两段流水之间，底色跟着卡片走最自然；
 *   加一层 --app-card-2 会在深色模式里变成一道明显的色带，
 *   看起来像「这两笔之间缺了一块」。
 */
.episode-divider {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 24rpx 6rpx;
}

.episode-divider-line {
  flex: 1;
  height: 1rpx;
  background-color: var(--app-line);
}

.episode-divider-text {
  font-size: 20rpx;
  color: var(--app-text-3);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.txn-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 18rpx 24rpx;
  border-top: 1rpx solid var(--app-line);
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

.txn-time {
  font-size: 20rpx;
  color: var(--app-text-3);
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
