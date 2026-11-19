<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <AppHeader @avatar-click="goProfile">
      <template #right>
        <!-- 更多筛选：复用全部交易页的筛选面板，条件作用于所有交易类统计 -->
        <HeaderAction @action-click="openFilter">
          更多筛选<text v-if="filterCount > 0" class="filter-dot">{{ filterCount }}</text>
        </HeaderAction>
      </template>
    </AppHeader>

    <!--
      时间筛选：年月日筛选（三级联动）｜ 自定义筛选（一行起止日 + wd-calendar）

      ★ 与「全部交易」页共用 DateFilterBar ★
        文案、样式、日期面板全部一致；
        以前两页各写一份，改一处忘一处，日期面板还会一边原生一边组件库。
    -->
    <view class="range-picker-bar">
      <DateFilterBar
        ref="filterBarRef"
        :mode="dateMode"
        :model-value="dateRange"
        :start-day="customStart"
        :end-day="customEnd"
        @update:mode="onModeChange"
        @range-change="onRangeChange"
        @custom-change="onCustomChange"
      />
    </view>

    <scroll-view class="page-scroll" scroll-y>
      <!--
        ★ 面板排序容器（本轮用户第 2 条）★
          统计页的面板顺序必须跟随「组件管理」页里用户排的顺序。
          uni-app 里没法动态渲染一堆 .vue 模板片段，所以这里用
          CSS flex 的 `order` 做重排：模板顺序写死无所谓，
          视觉顺序由每个子元素的 order 数值决定（小的在上）。
          ★ 为什么套一层包裹 view ★
            scroll-view 的内容需要单一容器，而且 flex 容器不能同时
            承担滚动职责（部分安卓内核对 scroll-view 的 flex 支持不稳）。
          ★ ov-summary / tabbar-space 也参与排序 ★
            收支摘要固定 order:0（永远最上），占位块给 9999（永远最下），
            否则它们会被面板的 order 挤到中间去。
      -->
      <view class="panel-flow">
      <!-- 收支摘要 -->
      <view class="ov-summary" :style="{ order: 0 }">
        <view class="ov-item">
          <text class="ov-label">支出</text>
          <MoneyText :cents="overview.expense" type="expense" :size="34" :weight="600" />
        </view>
        <view class="ov-line" />
        <view class="ov-item">
          <text class="ov-label">收入</text>
          <MoneyText :cents="overview.income" type="income" :size="34" :weight="600" />
        </view>
        <view class="ov-line" />
        <view class="ov-item">
          <text class="ov-label">结余</text>
          <MoneyText
            :cents="overview.balance"
            variant="balance"
            :size="34"
            :weight="600"
          />
        </view>
      </view>

      <!-- ① 分类统计 -->
      <view v-if="panelVisible('category')" class="card" :style="panelOrderStyle('category')">
        <view class="card-head">
          <text class="card-title">分类统计</text>
          <view class="card-head-right">
            <!-- ★ 一级/二级分类切换：与支出/收入同款按钮，放左边 ★ -->
            <view class="seg-toggle seg-toggle--sm">
              <text
                class="seg-item"
                :class="{ active: categoryLevel === 'root' }"
                @click="switchCategoryLevel('root')"
              >一级</text>
              <text
                class="seg-item"
                :class="{ active: categoryLevel === 'sub' }"
                @click="switchCategoryLevel('sub')"
              >二级</text>
            </view>
            <view class="seg-toggle seg-toggle--sm">
              <text
                class="seg-item"
                :class="{ active: categoryStatType === 'expense' }"
                @click="switchCategoryType('expense')"
              >支出</text>
              <text
                class="seg-item"
                :class="{ active: categoryStatType === 'income' }"
                @click="switchCategoryType('income')"
              >收入</text>
            </view>
          </view>
        </view>

        <view v-if="categoryStats.length === 0" class="card-empty">
          <text class="empty-text">{{ rangeLabel }}暂无数据</text>
        </view>

        <view v-else>
          <!-- 环形图：SVG，引导线直接标注「分类名 占比%」，中央显示总计 -->
          <view class="donut-wrap">
            <image class="donut-img" :src="categoryDonutUri" mode="widthFix" />
            <view class="donut-center">
              <text class="donut-center-label">合计</text>
              <MoneyText
                :cents="categoryTotal"
                :type="categoryStatType"
                :size="28"
                :weight="600"
              />
            </view>
          </view>

          <!-- 下方：色点 + 分类名 + 笔数 + 总金额
               ★ 一级/二级都用这一套 ★
                 二级模式下不再带「所属一级分类」那行副标题，
                 和一级模式一样紧凑：一行一个分类，显示全部、不省略。 -->
          <view class="rank-list">
            <view
              v-for="cat in categoryStats"
              :key="cat.id"
              class="rank-item"
            >
              <view class="rank-dot" :style="{ backgroundColor: cat.color }" />
              <text class="rank-name">{{ cat.name }}</text>
              <view class="rank-count">
                <text class="rank-count-num">{{ cat.count }}</text>
                <text class="rank-count-unit">笔</text>
              </view>
              <view class="rank-amount">
                <MoneyText :cents="cat.amount" :type="categoryStatType" :size="26" />
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- ② 账户统计（按账户 / 按账户类别，合并为一个面板） -->
      <view v-if="panelVisible('account')" class="card" :style="panelOrderStyle('account')">
        <view class="card-head">
          <text class="card-title">账户统计</text>
          <view class="card-head-right">
            <!-- ★ 账户/账户类别切换：与支出/收入同款按钮，放左边 ★ -->
            <view class="seg-toggle seg-toggle--sm">
              <text
                class="seg-item"
                :class="{ active: accountViewMode === 'account' }"
                @click="switchAccountViewMode('account')"
              >账户</text>
              <text
                class="seg-item"
                :class="{ active: accountViewMode === 'type' }"
                @click="switchAccountViewMode('type')"
              >类别</text>
            </view>
            <view class="seg-toggle seg-toggle--sm">
              <text
                class="seg-item"
                :class="{ active: accountStatType === 'expense' }"
                @click="switchAccountType('expense')"
              >支出</text>
              <text
                class="seg-item"
                :class="{ active: accountStatType === 'income' }"
                @click="switchAccountType('income')"
              >收入</text>
            </view>
          </view>
        </view>

        <view v-if="accountViewList.length === 0" class="card-empty">
          <text class="empty-text">{{ rangeLabel }}暂无数据</text>
        </view>

        <view v-else>
          <view class="donut-wrap">
            <image class="donut-img" :src="accountViewDonutUri" mode="widthFix" />
            <view class="donut-center">
              <text class="donut-center-label">合计</text>
              <MoneyText
                :cents="accountViewMode === 'type' ? accountTypeTotal : accountTotal"
                :type="accountStatType"
                :size="28"
                :weight="600"
              />
            </view>
          </view>
          <view class="rank-list">
            <view v-for="(acc, i) in accountViewList" :key="acc.key || acc.id" class="rank-item">
              <view class="rank-dot" :style="{ backgroundColor: acc.color }" />
              <text class="rank-name">{{ acc.name }}</text>
              <view class="rank-count">
                <text class="rank-count-num">{{ acc.count }}</text>
                <text class="rank-count-unit">笔</text>
              </view>
              <view class="rank-amount">
                <MoneyText :cents="acc.amount" :type="accountStatType" :size="26" />
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- ③ 趋势 -->
      <view v-if="panelVisible('trend')" class="card" :style="panelOrderStyle('trend')">
        <!--
          标题行：标题（左）+ 右侧一个位置两种内容

          ★ 右侧是「互斥的两个状态」，不是两个元素（用户本轮要求）★
            用户原话：「显示在中间有点丑，靠右对齐替代掉『每日支出』四个字吧，
            松手则还原这四个字」。
            所以它不是「在副标题旁边再加一个读数」，
            而是「同一个位置上二选一」：
              没按下  → 副标题「每日支出」
              按住拖动 → 换成「11/9 · ¥123.45」
              松手    → 又变回「每日支出」
            这样标题行宽度恒定，不会因为多了一段字而拖得很长。
        -->
        <view class="card-head">
          <text class="card-title">{{ trendTitle }}</text>
          <view v-if="selectedBar" class="head-pick">
            <text class="head-pick-day">{{ selectedBar.label }}{{ trendUnit }}</text>
            <text class="head-pick-dot">·</text>
            <MoneyText :cents="selectedBar.expense" type="expense" :size="22" />
          </view>
          <text v-else class="card-sub">{{ trendSubtitle }}</text>
        </view>
        <view class="daily-chart">
          <!--
            ★ 按住拖动就能从容滑动选中，松手就消失（用户本轮要求）★
              用户原话：「丝滑一点，我在上面滑动他可以随心变这样，松开就不显示了」。

            ★ 为什么从「每根柱 @click」改成「整块一个触摸层」 ★
              1) 每根柱各绑一个 click，手指从一根划到另一根没法“随心变”——
                 touchmove 不会触发别的元素的 click，不能跟手；
              2) 柱子可能很短（零花销的日子高度 0），根本点不中；
              3) 整块一个层能用 touchmove 算出手指在第几根上，跟手丝滑。
          -->
          <view
            class="daily-touch"
            @touchstart="onTrendTouchStart"
            @touchmove="onTrendTouchMove"
            @touchend="onTrendTouchEnd"
            @touchcancel="onTrendTouchEnd"
          >
            <view class="daily-bars">
              <view
                v-for="(d, i) in dailyTrend"
                :key="i"
                class="daily-bar-wrap"
              >
                <view
                  class="daily-bar"
                  :style="{
                    height: barHeight(d.expense) + '%',
                    backgroundColor: d.expense > 0 ? barColor(i) : 'transparent'
                  }"
                />
              </view>
            </view>
          </view>

          <view class="daily-axis">
            <text class="axis-text">{{ dailyTrend.length ? dailyTrend[0].label + trendUnit : '—' }}</text>
            <text class="axis-text">{{ dailyTrend.length ? dailyTrend[dailyTrend.length - 1].label + trendUnit : '—' }}</text>
          </view>
          <!-- ★ 最高日 / 最低日：左右两边对齐，价签黑色 ★ -->
          <view v-if="dailyExtremes" class="daily-extremes">
            <view class="daily-extreme">
              <text class="extreme-label">最高{{ trendUnit === '月' ? '月' : '日' }}</text>
              <text class="extreme-value">{{ dailyExtremes.max.label }}{{ trendUnit }} · </text>
              <MoneyText :cents="dailyExtremes.max.expense" type="expense" :size="24" />
            </view>
            <view class="daily-extreme">
              <text class="extreme-label">最低{{ trendUnit === '月' ? '月' : '日' }}</text>
              <text class="extreme-value">{{ dailyExtremes.min.label }}{{ trendUnit }} · </text>
              <MoneyText :cents="dailyExtremes.min.expense" type="expense" :size="24" />
            </view>
          </view>
        </view>
      </view>

      <!--
        ③b 同比变化 / ③b2 环比变化

        ★ 两个面板共用组件 components/StatsComparePanel.vue ★
          数据形状完全一样，只有对比窗口不同（同比=去年同期，
          环比=上一周期）。UI 写两份迟早长歪。

        ★ 对比窗口怎么算 ★
          全部在 utils/compareRange.js 的 buildCompareRange(range, today, mode)，
          有 scripts/test-compare-range.mjs 逐条钉住（月末夹取 / 闰年 / 跨年 / 今天截断）。
      -->
      <StatsComparePanel
        v-if="panelVisible('comparison')"
        :style="panelOrderStyle('comparison')"
        class="card"
        title="同比变化"
        :comparison="comparison"
        :level="comparisonLevel"
        :type="comparisonType"
        @update:level="switchComparisonLevel"
        @update:type="switchComparisonType"
      />

      <StatsComparePanel
        v-if="panelVisible('mom')"
        :style="panelOrderStyle('mom')"
        class="card"
        title="环比变化"
        :comparison="momComparison"
        :level="momLevel"
        :type="momType"
        @update:level="switchMomLevel"
        @update:type="switchMomType"
      />

      <!--
        ③c 恩格尔系数

        ★ 「哪些分类算食品」由用户自己选（本轮第 3 条）★
          入口在「我的 → 记账设置 → 统计组件管理」→ 恩格尔系数面板的展开设置，
          用多选分类弹层手选。原来的「AI 识别食品分类」逻辑已全部删除。
          没选任何分类时这里显示一句引导，而不是 0% ——
          0% 会被误读成「我没在吃饭上花钱」。

        ★ 为什么要在页面上解释这个数 ★
          恩格尔系数是个学术名词，绝大多数用户没见过。
          只给一个 32.5% 等于什么都没说 —— 必须配一句人话（见下面的等级文案）。
      -->
      <view v-if="panelVisible('engel')" class="card" :style="panelOrderStyle('engel')">
        <view class="card-head">
          <text class="card-title">恩格尔系数</text>
          <text class="card-sub">食品支出占总支出的比例</text>
        </view>

        <view v-if="!engel" class="card-empty">
          <text class="empty-text">正在计算…</text>
        </view>
        <view v-else-if="engel.total === 0" class="card-empty">
          <text class="empty-text">这段时间没有支出</text>
        </view>
        <view v-else-if="engel.foodIds.length === 0" class="card-empty">
          <text class="empty-text">还没选食品分类，去「我的 → 记账设置 → 统计组件管理」里选一下</text>
        </view>
        <view v-else-if="engel.food === 0" class="card-empty">
          <text class="empty-text">这段时间在选中的食品分类上没有支出</text>
        </view>
        <!--
          ★ 左右两列（本轮用户第 10 条）★
            左：选定区间的系数
            右：所有数据合起来的系数（全部时间）
            同一个数字在不同区间下会差很多，并列才能判断
            「这段时间是不是偏离了我平时的水平」。
          ★ 不再罗列食品分类名 ★
            用户原话「恩格尔系数不要罗列出来下方分类名」。
            那几个标签占一整行却只说明「选了哪几个分类」，
            而那件事去组件管理里看就行。
        -->
        <view v-else class="engel-split">
          <!-- 左：选定区间 -->
          <view class="engel-col">
            <text class="engel-col-label">本区间</text>
            <text class="engel-value" :style="{ color: engelColor }">{{ engel.ratio }}<text class="engel-unit">%</text></text>
            <text class="engel-level" :style="{ color: engelColor }">{{ engelLevel }}</text>
            <!--
              ★ 食品 / 总额 分两行，下面画一条占比轴（用户本轮第 3 条）★
                用户原话「下方的食品/总、结余/收入显示为两行，
                并画一个轴显示占比」。
                两行是因为两个数叠在一行时，长金额（总支出）会把短金额挤得看不清；
                轴是因为百分比数字本身看不出「大概占多少」，一根条形图更直观。
            -->
            <view class="engel-costs">
              <view class="engel-cost-row">
                <text class="engel-cost-label">食品</text>
                <text class="engel-cost-value">¥{{ formatWanYuan(engel.food) }}</text>
              </view>
              <view class="engel-cost-row">
                <text class="engel-cost-label">总支出</text>
                <text class="engel-cost-value">¥{{ formatWanYuan(engel.total) }}</text>
              </view>
            </view>
          </view>

          <view class="engel-split-line" />

          <!-- 右：全部数据 -->
          <view class="engel-col">
            <text class="engel-col-label">全部</text>
            <text class="engel-value" :style="{ color: engelAllColor }">{{ engelAllText }}<text class="engel-unit">%</text></text>
            <text class="engel-level" :style="{ color: engelAllColor }">{{ engelAllLevel }}</text>
            <view class="engel-costs">
              <view class="engel-cost-row">
                <text class="engel-cost-label">食品</text>
                <text class="engel-cost-value">¥{{ formatWanYuan(engelAll.food) }}</text>
              </view>
              <view class="engel-cost-row">
                <text class="engel-cost-label">总支出</text>
                <text class="engel-cost-value">¥{{ formatWanYuan(engelAll.total) }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!--
        ③d 储蓄率

        ★ 为什么用「结余 ÷ 收入」★
          这是「赚的钱里存下了多少」最直白的定义。
          支出占比、结余绝对值都回答不了这个问题 ——
          月入 2 万花 1.5 万（存 25%）和月入 5 千花 4 千（存 20%），
          光看花多少完全分不出谁更会存。

        ★ 收入为 0 时不给百分比 ★
          「没收入」和「一分没存」是两件事，显示 0% 会误导。
          API 在这种情况下返回 rate: null，这里显示「—」+ 说明。
      -->
      <view
        v-if="panelVisible('savings')"
        class="card"
        :style="panelOrderStyle('savings')"
      >
        <view class="card-head">
          <text class="card-title">储蓄率</text>
          <text class="card-sub">结余占收入的比例</text>
        </view>

        <!--
          ★ 左右两列（本轮用户第 10 条）★
            左：选定区间的储蓄率
            右：所有数据的储蓄率
            ★ 两边都没收入时才整块空态 ★
              只要一边有数就该显示对比（比如选中一个没收入的月，
              但全部数据里有收入，那正是用户需要看的对比）。
        -->
        <view v-if="savings.income === 0 && savingsAll.income === 0" class="card-empty">
          <text class="empty-text">这段时间没有收入，算不出储蓄率</text>
        </view>
        <view v-else class="savings-split">
          <view class="savings-col">
            <text class="savings-col-label">本区间</text>
            <text class="savings-value" :style="{ color: savingsColor }">{{ savings.rate === null ? '—' : savings.rate }}<text v-if="savings.rate !== null" class="savings-unit">%</text></text>
            <text class="savings-level" :style="{ color: savingsColor }">{{ savingsHint }}</text>
            <!-- ★ 结余 / 收入 分两行 + 占比轴（用户本轮第 3 条）★ -->
            <view class="savings-costs">
              <view class="savings-cost-row">
                <text class="savings-cost-label">结余</text>
                <text class="savings-cost-value">{{ signedWanYuan(savings.balance) }}</text>
              </view>
              <view class="savings-cost-row">
                <text class="savings-cost-label">收入</text>
                <text class="savings-cost-value">¥{{ formatWanYuan(savings.income) }}</text>
              </view>
            </view>
          </view>

          <view class="savings-split-line" />

          <view class="savings-col">
            <text class="savings-col-label">全部</text>
            <text class="savings-value" :style="{ color: savingsAllColor }">{{ savingsAll.rate === null ? '—' : savingsAll.rate }}<text v-if="savingsAll.rate !== null" class="savings-unit">%</text></text>
            <text class="savings-level" :style="{ color: savingsAllColor }">{{ savingsAllHint }}</text>
            <view class="savings-costs">
              <view class="savings-cost-row">
                <text class="savings-cost-label">结余</text>
                <text class="savings-cost-value">{{ signedWanYuan(savingsAll.balance) }}</text>
              </view>
              <view class="savings-cost-row">
                <text class="savings-cost-label">收入</text>
                <text class="savings-cost-value">¥{{ formatWanYuan(savingsAll.income) }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!--
        ③e 预算执行情况

        ★ 只看「守住了没有」，不重复预算页的明细 ★
          预算页负责编辑和管理，这里只回答「这段时间的额度用得怎么样」。
          数据直接复用 getBudgetUsageRange（口径与预算页逐字一致），
          不在统计层重写一遍算法 —— 两个地方各写一份，迟早一份漏了
          「不计入预算」那个条件，用户就会看到两个不一样的百分比。
      -->
      <view
        v-if="panelVisible('budget')"
        class="card"
        :style="panelOrderStyle('budget')"
      >
        <view class="card-head">
          <text class="card-title">预算执行情况</text>
          <text class="card-sub">{{ budgetExecution.over ? '已超支' : '未超支' }}</text>
        </view>

        <view v-if="!budgetExecution.hasBudget" class="card-empty">
          <text class="empty-text">还没设预算，去「预算管理」加一个</text>
        </view>
        <view v-else>
          <view class="budget-top">
            <text class="budget-used" :style="{ color: budgetExecution.over ? 'var(--app-danger)' : 'var(--app-text)' }">
              ¥{{ formatWanYuan(budgetExecution.used) }}
            </text>
            <text class="budget-limit">/ ¥{{ formatWanYuan(budgetExecution.limit) }}</text>
            <text
              class="budget-percent"
              :style="{ color: budgetExecution.over ? 'var(--app-danger)' : 'var(--app-text-2)' }"
            >{{ budgetExecution.percent }}%</text>
          </view>
          <view class="budget-bar">
            <view
              class="budget-bar-fill"
              :style="{
                width: Math.min(budgetExecution.percent, 100) + '%',
                backgroundColor: budgetExecution.over ? 'var(--app-danger)' : primaryColor
              }"
            />
          </view>

          <view class="budget-list">
            <view v-for="b in budgetExecution.items" :key="b.id" class="budget-item">
              <text class="budget-item-name ellipsis">{{ b.name }}</text>
              <view class="budget-item-bar">
                <view
                  class="budget-item-fill"
                  :style="{
                    width: Math.min(b.percent, 100) + '%',
                    backgroundColor: b.over ? 'var(--app-danger)' : primaryColor
                  }"
                />
              </view>
              <text
                class="budget-item-pct"
                :style="{ color: b.over ? 'var(--app-danger)' : 'var(--app-text-2)' }"
              >{{ b.percent }}%</text>
            </view>
          </view>
        </view>
      </view>

      <!-- ④ 平均值：总体 + 各分类 -->
      <view v-if="panelVisible('average')" class="card" :style="panelOrderStyle('average')">
        <view class="card-head">
          <text class="card-title">平均值</text>
          <view class="card-head-right">
            <!-- ★ 一级/二级分类切换：与支出/收入同款按钮，放左边 ★ -->
            <view class="seg-toggle seg-toggle--sm">
              <text
                class="seg-item"
                :class="{ active: averageLevel === 'root' }"
                @click="switchAverageLevel('root')"
              >一级</text>
              <text
                class="seg-item"
                :class="{ active: averageLevel === 'sub' }"
                @click="switchAverageLevel('sub')"
              >二级</text>
            </view>
            <view class="seg-toggle seg-toggle--sm">
              <text
                class="seg-item"
                :class="{ active: averageStatType === 'expense' }"
                @click="switchAverageType('expense')"
              >支出</text>
              <text
                class="seg-item"
                :class="{ active: averageStatType === 'income' }"
                @click="switchAverageType('income')"
              >收入</text>
            </view>
          </view>
        </view>

        <!-- 总体 -->
        <view class="avg-grid">
          <view class="avg-item">
            <text class="avg-label">日均{{ averageStatType === 'expense' ? '支出' : '收入' }}</text>
            <MoneyText :cents="averages.avgPerDay" :type="averageStatType" :size="34" :weight="600" />
            <text class="avg-hint">{{ averages.daysPassed }} 天</text>
          </view>
          <view class="avg-item">
            <text class="avg-label">笔均{{ averageStatType === 'expense' ? '支出' : '收入' }}</text>
            <MoneyText :cents="averages.avgPerTxn" :type="averageStatType" :size="34" :weight="600" />
            <text class="avg-hint">{{ averages.count }} 笔</text>
          </view>
        </view>

        <!-- 各分类的平均值 -->
        <text class="pie-title">各分类平均</text>
        <view v-if="categoryAverages.length === 0" class="card-empty">
          <text class="empty-text">{{ rangeLabel }}暂无数据</text>
        </view>
        <view v-else class="simple-list">
          <!--
            ★ 紧凑一行 ★
              去掉「笔数」和「所属一级分类」，
              右侧「日均 + 笔均」同一行显示，不显示金额。
              一级/二级两种模式长得一样，只是数据层级不同。
          -->
          <view v-for="c in categoryAverages" :key="c.id" class="simple-item cat-avg-item">
            <view class="rank-dot" :style="{ backgroundColor: c.color }" />
            <text class="simple-name">{{ c.name }}</text>
            <!-- 右侧：日均 + 笔均 同一行（小标签 + 数值并排），不显示金额 -->
            <view class="cat-avg-values">
              <view class="cat-avg-value">
                <text class="cat-avg-label">日均</text>
                <MoneyText :cents="c.avgPerDay" :type="averageStatType" :size="26" />
              </view>
              <view class="cat-avg-value">
                <text class="cat-avg-label">笔均</text>
                <MoneyText :cents="c.avgPerTxn" :type="averageStatType" :size="26" />
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- ⑦ Top 10 -->
      <view v-if="panelVisible('top')" class="card" :style="panelOrderStyle('top')">
        <view class="card-head">
          <text class="card-title">最高的 10 笔消费</text>
        </view>
        <view v-if="topExpenses.length === 0" class="card-empty">
          <text class="empty-text">暂无数据</text>
        </view>
        <view v-else class="top-list">
          <view
            v-for="(t, i) in topExpenses"
            :key="t.id"
            class="top-item"
            @click="goTxnDetail(t.id)"
          >
            <text class="top-rank" :class="{ 'top-3': i < 3 }">{{ i + 1 }}</text>
            <!-- 分类图标：与流水行共用 TxnIcon，图标样式 / 背景 / 大小跟设置 -->
            <TxnIcon
              :icon="t.category_icon"
              :name="t.category_name"
              :color="t.category_color || '#969799'"
            />
            <view class="top-info">
              <text class="top-name">{{ t.category_name || '未分类' }}</text>
              <!--
                ★ 标签直接显示在分类名下面（用户要求）★
                  和流水行的标签一致：标签色文字 + 浅色底 + 同色描边；
                  没打标签的流水不占这一行。
              -->
              <view v-if="t.tags && t.tags.length" class="top-tags">
                <text
                  v-for="tag in t.tags"
                  :key="tag.id"
                  class="top-tag"
                  :style="tagBadgeStyle(tag)"
                >{{ tag.name }}</text>
              </view>
              <!-- ★ 账户在前、备注在后（用户指定）★
                   账户名是「这笔钱从哪出」的定位信息，比备注更该先被看到；
                   备注长短不一，放前面会把账户名挤进省略号里。
                   ★ 账户被删除后 account_name 为空 —— 显示「无账户」而不是「无备注」 ★ -->
              <text class="top-sub ellipsis">{{ t.account_name || t.note || '无账户' }}</text>
            </view>
            <view class="top-right">
              <MoneyText :cents="t.amount_cents" type="expense" :size="28" :weight="500" />
              <text class="top-day">{{ shortDay(t.occurred_day) }}</text>
            </view>
          </view>
        </view>
      </view>

      <!--
        ★ 所有面板都被隐藏时的空态 ★
          否则用户取消勾选全部 7 个面板后，这页只剩一个收支摘要，
          看着像页面坏了 —— 给一句话指路回组件管理。
      -->
      <view v-if="visiblePanels.length === 0" class="card empty-panels" :style="{ order: 99 }">
        <text class="empty-text">所有面板都被隐藏了，去「我的 → 记账设置 → 统计组件管理」里打开几个</text>
      </view>

      <view class="tabbar-space" :style="{ order: 9999 }" />
      </view>
    </scroll-view>

    <!-- 圆角悬浮底栏（与首页同一份组件） -->
    <AppTabBar
      current="stats"
      :hold-enabled="settingStore.quickAddHoldAction !== 'none'"
      @single-press="onAddTap"
      @hold-end="onAddHoldEnd"
    />

    <!-- 更多筛选：与全部交易页共用同一个面板；z-index 要盖住底栏(300) -->
    <TxnFilterSheet
      v-model="showFilter"
      :filter="appliedFilter"
      :show-type="false"
      :show-category="false"
      :show-cycle="false"
      :show-keyword="false"
      :show-amount="false"
      position="bottom"
      :z-index="500"
      @apply="onFilterApply"
    />

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <!-- 弹窗宿主：外部打开 JSON 时可能在任意一页弹出，
         缺了这一行就退化成原生弹窗，样式与别处不一致 -->
    <AppDialog />
    <UpdateDialog />
  </view>
</template>

<script>
import { ref, reactive, computed, onMounted, onUnmounted, getCurrentInstance } from 'vue'
import { onShow, onHide, onBackPress } from '@dcloudio/uni-app'
import AppHeader from '@/components/AppHeader.vue'
import StatsComparePanel from '@/components/StatsComparePanel.vue'
import MoneyText from '@/components/MoneyText.vue'
import TxnIcon from '@/components/TxnIcon.vue'
import DateFilterBar from '@/components/DateFilterBar.vue'
import HeaderAction from '@/components/HeaderAction.vue'
import AppTabBar from '@/components/AppTabBar.vue'
import AppDialog from '@/components/AppDialog.vue'
import TxnFilterSheet from '@/components/TxnFilterSheet.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useUiStore } from '@/stores/ui.js'
import { gotoHomeAndAdd } from '@/utils/tabBar.js'
import { donutToDataUri } from '@/utils/donut.js'
import { clientXToChartX } from '@/utils/chart.js'
import {
  getOverviewRange, getCategoryStatsRange, getSubCategoryStatsRange,
  getAccountStatsRange, getAccountTypeStatsRange, getCategoryAveragesRange,
  getSubCategoryAveragesRange,
  getDailyTrendRange, getAveragesRange, getTopExpensesRange,
  getPeriodComparison, getEngelCoefficient, getSavingsRate, getBudgetExecution,
  PIE_PALETTE
} from '@/api/stats.js'
import { getEngelFoodIds } from '@/api/engel.js'
import { listCategories } from '@/api/category.js'
import {
  selectionToRange, defaultSelection, selectionLabel,
  customToRange, customRangeLabel, defaultCustomRange, toDayKey,
  trendBucketOf
} from '@/utils/date.js'
/*
 * 组件管理（面板排序 / 显隐）
 *
 * ★ 面板定义与顺序归一化收在 utils/statsPanels.js ★
 *   统计页与「组件管理」页必须用同一份定义 ——
 *   一边加了新面板、另一边不认识它，用户就会在管理页看到一项空白。
 */
import { visibleStatsPanels, normalizeStatsPanels } from '@/utils/statsPanels.js'
import { formatWanYuan } from '@/utils/money.js'
import {
  createEmptyTxnFilter, countActiveFilters, buildTxnFilterQuery
} from '@/utils/txnFilter.js'
import { consumeStatsPayload } from '@/utils/statsFilterNav.js'
import { getSetting } from '@/api/settings.js'
import { handleBackPress } from '@/utils/layerStack.js'
/*
 * ★ 同比 / 环比的引擎全在 components/StatsComparePanel.vue 里 ★
 *   这个页面只负责拿 comparison 数据并把组件摆上去，
 *   并不直接用 compareRange.js 的百分比文案函数。
 *   （之前这里留了一整个 import，四个名字一个都没用到 —— 已删。）
 */

export default {
  components: { AppHeader, MoneyText, TxnIcon, DateFilterBar, HeaderAction, AppTabBar, AppDialog, TxnFilterSheet, UpdateDialog, StatsComparePanel },
  setup() {
    const settingStore = useSettingStore()
    const uiStore = useUiStore()

    /** 三级联动选择：year / month / day，0 表示「全部」 */
    const dateRange = ref(defaultSelection())

    /**
     * 时间筛选方式：'period'（日/月/年三级联动）| 'custom'（自定义起止日）
     *
     * ★ 与「全部交易」页同一套 ★
     *   两个页面都从 utils/date.js 拿 customToRange，
     *   查询口径才不会一边一个样。
     */
    const dateMode = ref('period')
    const customStart = ref(defaultCustomRange().startDay)
    const customEnd = ref(defaultCustomRange().endDay)
    /** 原生 picker 的上限：未来的账还没发生，不让选 */
    const todayKey = toDayKey()

    /* ------------------------------------------------------ 更多筛选 */
    const filterBarRef = ref(null)
    const showFilter = ref(false)
    const appliedFilter = reactive(createEmptyTxnFilter())
    /** 分类全表：筛选面板按类型分组 + 查询时把一级展开成二级 */
    const allCategories = ref([])
    const filterCount = computed(() => countActiveFilters(appliedFilter))
    /** 只含筛选条件的查询字段（日期由上面的 range 单独管） */
    const filterQuery = computed(() => buildTxnFilterQuery(appliedFilter, allCategories.value))
    /**
     * 每张卡片的「支出/收入」各自独立控制。
     *
     * 之前三张卡共用一个 statType，切换分类统计的收支，
     * 账户统计也跟着变 —— 但这两者的收支对比是不同的事，
     * 用户想同时看「支出的分类」和「收入的账户」。
     */
    const categoryStatType = ref('expense')
    const accountStatType = ref('expense')
    const averageStatType = ref('expense')
    /*
     * 同比变化面板的「支出/收入」与「一级/二级」
     *
     * ★ 独立于分类统计 ★
     *   用户可能想看「支出的分类构成」同时看「收入的同比」，
     *   共用一个开关会把两件事绑死。
     */
    const comparisonType = ref('expense')
    const comparisonLevel = ref('root')

    /*
     * ★ 账户统计视图：按账户 / 按账户类别 ★
     *   两个视图合并在一个面板里，用与支出/收入同款的按钮切换。
     *   'account' = 按具体账户分（每个账户一块）
     *   'type' = 按账户类别分（网络支付、信用卡…）
     */
    const accountViewMode = ref('account')

    /*
     * ★ 分类层级：一级分类 / 二级分类 ★
     *   分类统计、平均值两个面板各有独立的切换（与支出/收入同款按钮）。
     *   'sub' = 二级分类（午餐、外卖…，默认，贴近用户实际记的）
     *   'root' = 一级分类（餐饮、居住…，统计口径）
     */
    const categoryLevel = ref('root')
    const averageLevel = ref('root')

    const categoryStats = ref([])
    const accountStats = ref([])
    const accountTypeStats = ref([])
    const categoryAverages = ref([])
    const dailyTrend = ref([])
    const averages = ref({ avgPerDay: 0, avgPerTxn: 0, count: 0, daysPassed: 0, maxDay: null })
    const topExpenses = ref([])

    /* -------------------------------------------------- 同比 / 恩格尔 */

    /** 同比对比结果（null = 还没加载完 / 该区间算不出对比） */
    const comparison = ref(null)
    /** 组件管理里的面板顺序与隐藏项（统计页只读，改动在管理页） */
    const statsPanels = ref({ order: [], hidden: [] })
    /** 恩格尔系数结果 */
    const engel = ref(null)
    /**
     * 用户选中的「算食品」的一级支出分类 id 与名字
     *
     * ★ 由用户手选，不再由 AI 判定（本轮第 3 条）★
     *   设置入口在「组件管理」页的恩格尔系数面板里，
     *   存在 setting 的 engelFoodCategories 键上。
     */
    const engelFoodIds = ref([])
    const engelFoodNames = ref([])
    const overview = ref({ expense: 0, income: 0, balance: 0 })

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    /**
     * 当前选择对应的查询区间
     *
     * ★ 自定义区间不写 monthKey ★
     *   给了 monthKey，api/stats.js 就会按 `t.month_key = ?` 走等值过滤，
     *   跨月区间会被掐成一个月。customToRange 只在「正好整月」时才回填 monthKey。
     */
    const range = computed(() => {
      const base = dateMode.value === 'custom'
        ? customToRange(customStart.value, customEnd.value)
        : selectionToRange(dateRange.value)
      /*
       * 筛选条件跟着 range 一起进 API
       *
       * ★ 为什么不另加参数 ★
       *   api/stats.js 的每个查询都从 rangeScope(range) 出发，
       *   把筛选字段并进 range，所有统计面板自动带上同一套条件，
       *   不需要逐个函数改签名。
       */
      return { ...base, ...filterQuery.value }
    })

    /** 当前选择的展示文案 */
    const rangeLabel = computed(() =>
      dateMode.value === 'custom'
        ? customRangeLabel(customStart.value, customEnd.value)
        : selectionLabel(dateRange.value)
    )

    /* -------------------------------------------------- 组件管理 */

    /**
     * 面板显隐判断
     *
     * ★ 用 key 判断而不是在模板里写 7 个 v-if="statsPanels.xxx" ★
     *   面板清单以 utils/statsPanels.js 为唯一来源，
     *   以后新增面板只要在那边加一条 + 模板里加一个 v-if="panelVisible('新key')"，
     *   管理页会自动多出一行，不需要两处各维护一份清单。
     */
    function panelVisible(key) {
      return visiblePanels.value.some((p) => p.key === key)
    }

    /**
     * 面板在统计页的排版序号（CSS flex order）
     *
     * ★ 为什么用 CSS order 而不是「按顺序渲染」★
     *   7 块面板（现在 10 块）的模板是写死在 .vue 里的，
     *   想按用户顺序渲染只能把它们抽成 10 个组件、再用 <component :is> 拼 ——
     *   改动面巨大、还容易把各自的 props 传递写错。
     *   CSS 的 `order` 正好是为「视觉排序 ≠ DOM 顺序」设计的：
     *   模板照旧写，只给每个 card 一个数字，浏览器自己排。
     *
     * ★ 数值怎么定 ★
     *   order 数组的下标 + 1（+1 是因为收支摘要占了 0）；
     *   账单摘要 order:0 永远最上，空态 99、占位块 9999 永远最下。
     *   拿不到（配置里没这个 key）时给 99 —— 宁可沉底，也不要插到用户
     *   排好的顺序中间去。
     *
     * @param {string} key 面板 key（见 utils/statsPanels.js）
     * @returns {{order:number}}
     */
    function panelOrderStyle(key) {
      const order = (statsPanels.value && statsPanels.value.order) || []
      const i = order.indexOf(key)
      return { order: i < 0 ? 99 : i + 1 }
    }

    /** 当前该显示的面板（按用户排好的顺序） */
    const visiblePanels = computed(() => visibleStatsPanels(statsPanels.value))

    /* -------------------------------------------------- 同比面板 */

    /* -------------------------------------------------- 环比面板 */

    /**
     * 环比 / 同比各自的维度状态
     *
     * ★ 为什么分成两套 ★
     *   两个面板在页面上同时存在，用户可能想看「支出的同比」+「收入的环比」。
     *   共用一个 level/type 会让两个面板互相牵制 ——
     *   切同比的「收入」，环比也跟着变，完全不符合直觉。
     */
    const momLevel = ref('root')
    const momType = ref('expense')

    /**
     * 环比数据（null = 还没加载 / 该区间算不出对比）
     *
     * ★ 与同比唯一的区别是 mode='mom' ★
     *   返回结构完全一样，所以能共用同一个展示组件。
     */
    const momComparison = ref(null)

    /** 储蓄率（null/0 收入时 rate 为 null，页面显示「—」） */
    const savings = ref({ income: 0, expense: 0, balance: 0, rate: null, savedCents: 0 })

    /**
     * 结余金额（保留负号）
     *
     * formatWanYuan() 只负责绝对值（全 App 多数地方展示的是支出/负债的绝对数），
     * 但储蓄率的「结余」是有符号的净额：花超了必须显示 -¥xxx，
     * 否则「收入 100、结余 -50」会变成「收入 100、结余 ¥50」。
     */
    function signedWanYuan(cents) {
      const n = Number(cents) || 0
      return `${n < 0 ? '-' : ''}¥${formatWanYuan(n)}`
    }
    /** 预算执行情况（hasBudget=false 显示空态） */
    const budgetExecution = ref({ hasBudget: false, limit: 0, used: 0, remaining: 0, percent: 0, over: false, items: [] })

    /**
     * 储蓄率的配色与一句人话
     *
     * ★ 三档而不是连续渐变 ★
     *   储蓄率不是越精确越好，用户要的是「我这段时间算不算会存钱」这个判断，
     *   三档（不错 / 一般 / 花超了）比一个精确到小数点的百分数更好用。
     */
    /*
     * ★ 颜色 / 文案抽成函数（本轮第 10 条需要两列）★
     *   左右两列各算一次，内联两遍就是四遍。
     *   抽出来后只改一处，两列永远一致。
     */
    function savingsColorOf(rate) {
      const r = rate
      if (r === null || r === undefined) return 'var(--app-text-3)'
      if (r >= 30) return 'var(--app-success)'
      if (r < 0) return 'var(--app-danger)'
      return 'var(--app-text-2)'
    }

    function savingsHintOf(rate) {
      const r = rate
      if (r === null || r === undefined) return '没有收入'
      if (r >= 30) return '存得不错'
      if (r < 0) return '花超了'
      return '还算稳'
    }

    const savingsColor = computed(() => savingsColorOf(savings.value.rate))

    const savingsHint = computed(() => savingsHintOf(savings.value.rate))

    /*
     * 右列：全部数据的储蓄率（本轮第 10 条）
     *
     * ★ 与 engelAll 同理：「当前区间」与「全部」必须分开存 ★
     *   共用一个 ref 的话，切日期会把两列一起改掉，对比就没了意义。
     */
    const savingsAll = ref({ income: 0, expense: 0, balance: 0, rate: null, savedCents: 0 })
    const savingsAllColor = computed(() => savingsColorOf(savingsAll.value.rate))
    const savingsAllHint = computed(() => savingsHintOf(savingsAll.value.rate))

    async function switchComparisonType(type) {
      if (comparisonType.value === type) return
      comparisonType.value = type
      await reloadComparison()
    }

    async function switchComparisonLevel(level) {
      if (comparisonLevel.value === level) return
      comparisonLevel.value = level
      await reloadComparison()
    }

    async function switchMomType(type) {
      if (momType.value === type) return
      momType.value = type
      await reloadMom()
    }

    async function switchMomLevel(level) {
      if (momLevel.value === level) return
      momLevel.value = level
      await reloadMom()
    }

    /** 重查同比（切换维度后调用，失败保持上一次的值） */
    async function reloadComparison() {
      try {
        comparison.value = await getPeriodComparison(range.value, {
          level: comparisonLevel.value,
          type: comparisonType.value
        })
      } catch (e) {
        console.warn('[stats] 同比重查失败:', e && e.message)
      }
    }

    /** 重查环比（同上） */
    async function reloadMom() {
      try {
        momComparison.value = await getPeriodComparison(range.value, {
          level: momLevel.value,
          type: momType.value,
          mode: 'mom'
        })
      } catch (e) {
        console.warn('[stats] 环比重查失败:', e && e.message)
      }
    }

    /* -------------------------------------------------- 恩格尔系数 */

    /**
     * 恩格尔等级说明
     *
     * ★ 分级用的是国内常用的几个档 ★
     *   <30% 富裕、30~40% 小康、40~50% 温饱、>50% 贫困。
     *   这套分法在学术上有争议，但对普通用户足够说明「你在食物上
     *   花的钱占比偏高还是偏低」，比只给一个百分数有用得多。
     */
    /*
     * ★ 等级 / 颜色抽成公式（本轮第 10 条需要两列）★
     *   以前只有一个结果，两个 computed 各自内联一遍。
     *   现在左右两列各算一次（本区间 / 全部），
     *   内联两遍变成四遍、且两列的分档口径会慢慢分岔。
     *   抽出来后只要改一处，两列永远一致。
     */
    function engelLevelOf(ratio) {
      const r = Number(ratio) || 0
      if (r < 30) return '富裕水平'
      if (r < 40) return '小康水平'
      if (r < 50) return '温饱水平'
      return '偏高'
    }

    function engelColorOf(ratio) {
      const r = Number(ratio) || 0
      if (r < 40) return 'var(--app-success)'
      if (r < 50) return 'var(--app-text-2)'
      return 'var(--app-danger)'
    }

    const engelLevel = computed(() => engelLevelOf(engel.value ? engel.value.ratio : 0))
    const engelColor = computed(() => engelColorOf(engel.value ? engel.value.ratio : 0))

    /*
     * 右列：全部数据的恩格尔系数（不限时间）
     *
     * ★ 为什么单独存一份、不复用 engel ★
     *   engel 是「当前选中区间」的结果，用户切日期它就变；
     *   右列是「不受日期影响的常年水平」，两者必须分开存。
     */
    const engelAll = ref({ total: 0, food: 0, ratio: 0, foodIds: [] })
    const engelAllText = computed(() => (engelAll.value.total > 0 ? engelAll.value.ratio : '—'))
    const engelAllLevel = computed(() => (engelAll.value.total > 0 ? engelLevelOf(engelAll.value.ratio) : '暂无数据'))
    const engelAllColor = computed(() => (engelAll.value.total > 0 ? engelColorOf(engelAll.value.ratio) : 'var(--app-text-3)'))

    /**
     * 趋势图该按「日」还是「月」分桶
     *
     * ★ 判据（用户指定）★
     *   自定义区间跨 1~2 个自然月（近一周、近一月都算）→ 日趋势；
     *   跨 3 个月以上（近半年、近一年、近五年）→ 月趋势。
     *   年月日筛选仍按原来的三级选择：选了日 → 日趋势，选了月/年/全部 → 月趋势。
     *
     * ★ 为什么用 monthSpan 而不是天数字面量 ★
     *   写死「≤62 天」会让 7/1~8/31（正好两个整月、62 天）卡在边界上，
     *   相邻两个月来回点会看到图表在日/月之间跳；
     *   按自然月跨度判断，用户选「月」得到的就是按月的结果。
     */
    const trendBucket = computed(() => {
      if (dateMode.value === 'custom') {
        return trendBucketOf(customStart.value, customEnd.value)
      }
      const sel = dateRange.value
      if (!sel.year || !sel.month) return 'month'
      return 'day'
    })

    /** 趋势图标题 */
    const trendTitle = computed(() => {
      if (trendBucket.value === 'day') {
        // 单日没法「按天画趋势」，只有一根柱子，标题直接说这一天的支出
        if (dateMode.value === 'period' && dateRange.value.day) return '当日支出'
        return '日趋势'
      }
      return '月趋势'
    })

    /** 趋势图副标题 */
    const trendSubtitle = computed(() => {
      if (trendBucket.value === 'day') {
        if (dateMode.value === 'period' && dateRange.value.day) return '当天支出'
        return '每日支出'
      }
      return '每月支出'
    })

    /** 趋势图坐标轴 / 极值单位 */
    const trendUnit = computed(() => (trendBucket.value === 'day' ? '日' : '月'))

    const categoryTotal = computed(() =>
      categoryStats.value.reduce((acc, c) => acc + c.amount, 0)
    )

    /** 账户合计 */
    const accountTotal = computed(() =>
      accountStats.value.reduce((acc, c) => acc + c.amount, 0)
    )

    /** 账户类别合计 */
    const accountTypeTotal = computed(() =>
      accountTypeStats.value.reduce((acc, c) => acc + c.amount, 0)
    )

    /**
     * 环形图：用 SVG 构建（扇区 + 引导线 + 文字标注），生成 data URI。
     *
     * ★ 为什么不用 conic-gradient ★
     *   需求是「环形图用引导线直接显示每个部分的名称和占比」，
     *   CSS 渐变无法在图上标注文字，所以改用 SVG（见 utils/donut.js）。
     *   文字颜色要传给纯函数，因为 SVG 是 data URI 独立文档，
     *   拿不到页面上的 CSS 变量。
     */
    const donutTextColor = computed(() => {
      /*
       * ★ 必须读 store 真正存在的字段 ★
       *   旧代码读 settingStore.theme —— store 里没有这个字段
       *   （只有 themeMode / themePreset / isDark），表达式恒为 false，
       *   深色下环图文字始终 #666，在 #1C1C1E 卡片上几乎看不清。
       */
      return settingStore.isDark ? '#9CA3AF' : '#666666'
    })

    /** 分类统计环形图（SVG data URI） */
    const categoryDonutUri = computed(() =>
      donutToDataUri(categoryStats.value, {
        total: categoryTotal.value,
        topN: 10,
        textColor: donutTextColor.value
      })
    )

    /**
     * 账户统计的列表：按视图返回账户或账户类别。
     * 统一为 { key, name, color, amount, count }，方便模板一处渲染。
     */
    const accountViewList = computed(() => {
      if (accountViewMode.value === 'type') {
        return accountTypeStats.value.map((t) => ({
          key: t.key,
          name: t.name,
          color: t.color,
          amount: t.amount,
          count: t.count
        }))
      }
      return accountStats.value.map((a, i) => ({
        key: a.id,
        name: a.name,
        color: accColor(a, i),
        amount: a.amount,
        count: a.count
      }))
    })

    /** 账户统计的环形图：按视图返回账户或账户类别的 SVG */
    const accountViewDonutUri = computed(() => {
      if (accountViewMode.value === 'type') {
        return donutToDataUri(accountTypeStats.value, {
          total: accountTypeTotal.value,
          topN: 8,
          textColor: donutTextColor.value
        })
      }
      return donutToDataUri(
        accountStats.value.map((a, i) => ({ name: a.name, amount: a.amount, color: accColor(a, i) })),
        { total: accountTotal.value, topN: 10, textColor: donutTextColor.value }
      )
    })

    /**
     * 账户配色
     *
     * ★ 统一从调色板按序取色 ★
     *   账户自带的颜色可能重复（用户建账户时颜色是可选项，
     *   很容易好几个账户都是同一个默认色），
     *   饼图上就分不开了。
     *   排行里的色点跟着饼图的色走，用同一套取色规则。
     */
    function accColor(acc, index) {
      return PIE_PALETTE[index % PIE_PALETTE.length]
    }

    const maxDailyExpense = computed(() => {
      const vals = dailyTrend.value.map((d) => d.expense)
      return Math.max(...vals, 1)
    })

    function barHeight(v) {
      if (!v) return 0
      return Math.round((v / maxDailyExpense.value) * 100)
    }

    /**
     * 柱子颜色
     *
     * ★ 没选中时与以前完全一样 ★
     *   用户要求的是「点击后显示读数」，不是把图改成另一个样子。
     *   所以默认状态下所有柱都是实心主题色，不降透明度。
     *
     * ★ 有选中时才把其他柱变淡 ★
     *   30 根柱里只靠一行小字告诉你“选了哪一天”是不够的 ——
     *   选中那根保持实心，其他降到 40%，对比一眼就出来了。
     *
     * @param {number} i 柱子下标
     * @returns {string} 颜色值
     */
    function barColor(i) {
      // 没有任何选中：全部实心，与改动前一致
      if (selectedBarIndex.value < 0) return primaryColor.value
      return selectedBarIndex.value === i ? primaryColor.value : primaryColor.value + '66'
    }

    function shortDay(dayKey) {
      if (!dayKey) return ''
      const [, m, d] = dayKey.split('-')
      return `${Number(m)}/${Number(d)}`
    }

    /**
     * Top 10 标签样式 —— 与流水行徽标完全一致
     *
     * ★ 不要在这里另调一套颜色 / 圆角 ★
     *   流水行用的是 utils/txnBadges.js 的 tintOf(color) + 本色文字 + 本色描边；
     *   Top 10 如果改用 categoryTint（暗色 30%）或不同 padding/圆角，
     *   同一枚标签在两个页面就会长得不一样（用户已反馈）。
     *   这里逐字段对齐 txnBadges.js 的标签分支。
     */
    function tagBadgeStyle(tag) {
      const c = tag && tag.color
      if (c) {
        return { backgroundColor: c + '22', color: c, borderColor: c }
      }
      return {
        backgroundColor: 'var(--app-card-2)',
        color: 'var(--app-text-2)',
        borderColor: 'var(--app-text-3)'
      }
    }

    /* ------------------------------------------------------ 加载 */

    /**
     * 加载各卡片的数据。
     *
     * ★ 每张卡片用自己的 statType ★
     *   分类统计、账户统计、账户类别统计、平均值
     *   四张卡的「支出/收入」互相独立，
     *   所以每张卡的数据要按各自的 type 单独查。
     */
    /*
     * ★ 请求序号 ★
     *   快速切日期/筛选时会有多个 loadAll 并发，晚返回的旧请求
     *   可能把新请求的结果覆盖掉。每次加载递增，回来时不是最新就丢弃。
     */
    let loadSeq = 0

    async function loadAll() {
      const r = range.value
      const seq = ++loadSeq
      /*
       * ★ 只查「当前可见」的面板 ★
       *   旧实现不管面板藏没藏，10 块面板全部查一遍。
       *   用户隐藏了一半面板，仍然白跑一半 SQL。
       */
      const show = {
        category: panelVisible('category'),
        account: panelVisible('account'),
        average: panelVisible('average'),
        trend: panelVisible('trend'),
        top: panelVisible('top')
      }
      try {
        const [ov, cats, accs, accTypes, catAvgs, daily, avg, top] = await Promise.all([
          getOverviewRange(r),
          // 分类统计：按面板的层级（一级/二级）查询
          show.category
            ? (categoryLevel.value === 'root'
                ? getCategoryStatsRange(r, categoryStatType.value)
                : getSubCategoryStatsRange(r, categoryStatType.value))
            : Promise.resolve(null),
          show.account ? getAccountStatsRange(r, accountStatType.value) : Promise.resolve(null),
          show.account ? getAccountTypeStatsRange(r, accountStatType.value) : Promise.resolve(null),
          // 平均值：按面板的层级（一级/二级）查询
          show.average
            ? (averageLevel.value === 'root'
                ? getCategoryAveragesRange(r, averageStatType.value)
                : getSubCategoryAveragesRange(r, averageStatType.value))
            : Promise.resolve(null),
          show.trend ? getDailyTrendRange(r) : Promise.resolve(null),
          show.average ? getAveragesRange(r, averageStatType.value) : Promise.resolve(null),
          show.top ? getTopExpensesRange(r, 10) : Promise.resolve(null)
        ])
        if (seq !== loadSeq) return

        overview.value = ov
        if (show.category) categoryStats.value = cats
        if (show.account) {
          accountStats.value = accs
          accountTypeStats.value = accTypes
        }
        if (show.average) {
          categoryAverages.value = catAvgs
          averages.value = avg
        }
        if (show.trend) {
          dailyTrend.value = daily
          // 换了区间 / 粒度 → 原来的下标已经指不到那根柱了，直接清掉
          clearBarPick()
        }
        if (show.top) topExpenses.value = top
        // 分类名映射由 loadExtras 的恩格尔任务统一刷新，避免重复查分类表
        if (seq !== loadSeq) return

        /*
         * ★ 同比 / 恩格尔放在主统计之后 ★
         *   恩格尔系数要用「这段区间的总支出」做分母，
         *   而那个数刚由上面的 overview 拿到 ——
         *   所以必须等主统计回来再跑，不能和它并发。
         *   两者各用各的 catch，坏了一边不拖垮另一边。
         */
        loadExtras(r, seq)
      } catch (e) {
        if (seq !== loadSeq) return
        console.error('[stats] load failed', e)
        uni.showToast({ title: e.message, icon: 'none' })
      }
    }

    /**
     * 加载「同比变化」与「恩格尔系数」两块
     *
     * ★ 为什么不并进上面那个 Promise.all ★
     *   同比较依赖窗口换算、恩格尔要查分类表，
     *   两者都可能失败；合进主链会因为一个失败把整页统计都清空。
     *   这里各自 catch，坏了就保持上一次的值。
     */
    async function loadExtras(r, seq) {
      const alive = () => seq === loadSeq
      const tasks = []

      // 1) 同比（跟着面板自己的支出/收入 与 一级/二级 走）
      if (panelVisible('comparison')) {
        tasks.push((async () => {
          try {
            const v = await getPeriodComparison(r, {
              level: comparisonLevel.value,
              type: comparisonType.value
            })
            if (alive()) comparison.value = v
          } catch (e) {
            console.warn('[stats] 同比计算失败:', e && e.message)
            // 保留上一次结果，切 tab 时不至于整块先消失再回来
          }
        })())
      }

      // 1b) 环比（同样的数据，对比窗口换成「上一周期」）
      if (panelVisible('mom')) {
        tasks.push((async () => {
          try {
            const v = await getPeriodComparison(r, {
              level: momLevel.value,
              type: momType.value,
              mode: 'mom'
            })
            if (alive()) momComparison.value = v
          } catch (e) {
            console.warn('[stats] 环比计算失败:', e && e.message)
          }
        })())
      }

      /*
       * 1c) 储蓄率（左右两列一起查）
       *   空区间 = 不限时间，与 engelAll 同一口径。
       */
      if (panelVisible('savings')) {
        tasks.push((async () => {
          try {
            const [cur, all] = await Promise.all([
              getSavingsRate(r),
              getSavingsRate({
                startDay: '', endDay: '', monthKey: '',
                ...filterQuery.value
              })
            ])
            if (!alive()) return
            savings.value = cur
            savingsAll.value = all
          } catch (e) {
            console.warn('[stats] 储蓄率计算失败:', e && e.message)
          }
        })())
      }

      /*
       * 1d) 预算执行情况
       *
       * ★ 不跟随「更多筛选」★
       *   预算额度是全局设定的，按账户/标签筛完流水后
       *   「已用」只算了一部分，再拿它和全局额度比会把剩余额度算高。
       *   所以这里只传日期区间，筛选字段剥掉。
       */
      if (panelVisible('budget')) {
        tasks.push((async () => {
          try {
            const v = await getBudgetExecution({
              startDay: r.startDay, endDay: r.endDay, monthKey: r.monthKey
            })
            if (alive()) budgetExecution.value = v
          } catch (e) {
            console.warn('[stats] 预算执行计算失败:', e && e.message)
          }
        })())
      }

      /*
       * 2) 恩格尔系数
       *
       * ★ 「哪些分类算食品」完全由用户在组件管理页手选 ★
       *   只读 setting 里的 id 数组，一次网络请求都不发。
       *   没选分类时 getEngelCoefficient 会返回 foodIds: []，
       *   卡片上显示引导文案而不是 0%。
       */
      if (panelVisible('engel')) {
        tasks.push((async () => {
          try {
            const ids = await getEngelFoodIds()
            if (!alive()) return
            engelFoodIds.value = ids
            await refreshEngelFoodNames()
            const empty = {
              startDay: '', endDay: '', monthKey: '',
              ...filterQuery.value
            }
            const [cur, all] = await Promise.all([
              getEngelCoefficient(r, ids),
              getEngelCoefficient(empty, ids)
            ])
            if (!alive()) return
            engel.value = cur
            engelAll.value = all
          } catch (e) {
            console.warn('[stats] 恩格尔系数计算失败:', e && e.message)
            if (alive()) engel.value = null
          }
        })())
      }

      /*
       * ★ 并发跑，但互不拖累 ★
       *   每块自己 catch；Promise.allSettled 保证一块失败不影响其它块。
       *   旧实现串行 await，10 块面板最慢的一块的耗时叠加了 6 次。
       */
      await Promise.allSettled(tasks)
    }

    /**
     * 用当前区间 + 已判定的食品分类重算恩格尔系数
     *
     * ★ 分类列表为空也要查 ★
     *   「一个食品分类都没判出来」和「这段时间没有支出」是两种空态，
     *   卡片上的文案不一样（见模板里的两个空态分支）。
     *   所以不在这里提前返回假数据，交给 getEngelCoefficient 给真实的 total。
     */

    /**
     * 把「吃」的分类 id 换成名字（页面下方那排标签用）
     *
     * ★ 为什么独立一个函数 ★
     *   分类名只在「分类列表」里有，而恩格尔系数接口只回 id 和金额 ——
     *   一次 listCategories 拿全表（几十条，很便宜），
     *   建个 id→name 的映射反查即可。
     *   ★ 取不到就当没有 ★
     *   标签只是「这个数是怎么来的」的辅助说明，
     *   分类表读失败不该让系数块整块消失。
     */
    async function refreshEngelFoodNames() {
      if (!engelFoodIds.value.length) {
        engelFoodNames.value = []
        return
      }
      try {
        const list = await listCategories()
        const map = {}
        list.forEach((c) => { map[c.id] = c.name })
        engelFoodNames.value = engelFoodIds.value.map((id) => map[id]).filter(Boolean)
      } catch (e) {
        engelFoodNames.value = []
      }
    }

    /** 三级联动选择变化：重新拉全部统计 */
    function onRangeChange(sel) {
      dateRange.value = { ...sel }
      loadAll()
    }

    /**
     * 切换时间筛选方式。
     *
     * ★ 切过去立刻重拉 ★
     *   两套状态各存各的，不重拉的话页面还停在上一种方式的数据上，
     *   用户会以为切换没生效（统计页所有卡片都要重算，代价比列表大，
     *   所以这里不接受「等下次操作再刷新」的偷懒做法）。
     */
    function onModeChange(mode) {
      if (dateMode.value === mode) return
      dateMode.value = mode
      loadAll()
    }

    /**
     * 自定义区间的起止日变化。
     *
     * ★ 颠倒纠正交给组件了 ★
     *   DateFilterBar 的 commit() 内部会交换起止（交易页共用同一份），
     *   这里直接采用即可，两处都判断反而容易改漏一处。
     */
    function onCustomChange({ startDay, endDay }) {
      customStart.value = startDay
      customEnd.value = endDay
      loadAll()
    }

    function goTxnDetail(id) {
      uni.navigateTo({ url: `/pages/txn/detail?id=${id}` })
    }

    /**
     * 打开「更多筛选」
     *
     * 先把日期筛选的下拉收起来，避免它和右侧筛选面板叠在一起。
     */
    function openFilter() {
      if (filterBarRef.value && typeof filterBarRef.value.collapse === 'function') {
        filterBarRef.value.collapse()
      }
      showFilter.value = true
    }

    /** 应用筛选：与全部交易页同一套语义，条件并进 range 后重算所有面板 */
    async function onFilterApply(next) {
      Object.assign(appliedFilter, next)
      showFilter.value = false
      await loadAll()
    }

    /** 分类全表（筛选面板分组 + 一级展开成二级都要用） */
    async function loadAllCategories() {
      try {
        allCategories.value = await listCategories()
      } catch (e) {
        console.warn('[stats] 分类加载失败:', e && e.message)
      }
    }

    /** 本次进入页面已经应用过详情页带来的条件（避免 onMounted/onShow 二次清空） */
    let pendingApplied = false

    /**
     * 消费从账户/标签详情带过来的筛选条件
     *
     * 账户详情传 accountId，标签详情传 tagIds；
     * 先清空旧条件再合并，避免在上一组筛选上继续叠加。
     *
     * @returns {boolean} 是否真的带进来了条件
     */
    /**
     * 时间选择回到「本月」
     *
     * 用户要求：重新进入统计页默认本月。
     * 标签详情等明确带了 selection 的导航会在之后覆盖它（如全部年月日）。
     */
    function resetDateToCurrentMonth() {
      const next = defaultSelection()
      if (dateMode.value !== 'period') dateMode.value = 'period'
      const cur = dateRange.value || {}
      if (Number(cur.year) !== next.year ||
          Number(cur.month) !== next.month ||
          Number(cur.day) !== next.day) {
        dateRange.value = next
      }
    }

    function applyPendingStatsFilter() {
      const payload = consumeStatsPayload()
      if (!payload) return false
      const pending = payload.filter || {}
      Object.assign(appliedFilter, createEmptyTxnFilter(), pending)
      appliedFilter.categoryIds = Array.isArray(pending.categoryIds)
        ? pending.categoryIds.slice()
        : []
      appliedFilter.tagIds = Array.isArray(pending.tagIds)
        ? pending.tagIds.slice()
        : []
      /*
       * 从详情页进来也默认本月：
       * 标签详情带了 selection（全部年 / 全部月 / 全部日），在下面覆盖；
       * 账户详情没带，就停在本月。
       */
      resetDateToCurrentMonth()
      if (payload.dateMode === 'period' || payload.dateMode === 'custom') {
        dateMode.value = payload.dateMode
      }
      if (payload.selection) {
        dateRange.value = {
          year: Number(payload.selection.year) || 0,
          month: Number(payload.selection.month) || 0,
          day: Number(payload.selection.day) || 0
        }
      }
      pendingApplied = true
      return true
    }

    /** 清空「更多筛选」（重新进入统计页时默认回到无筛选状态） */
    function resetAppliedFilter() {
      Object.assign(appliedFilter, createEmptyTxnFilter())
      appliedFilter.categoryIds = []
      appliedFilter.tagIds = []
    }

    /**
     * 读组件管理里的面板配置与食品分类
     *
     * ★ 两件事一起读 ★
     *   它们都只影响「显示什么」，不涉及统计查询；
     *   放在 loadAll 之前读，避免先按旧配置渲染一遍再跳一下。
     */
    async function loadPanelSettings() {
      try {
        const [cfg, foodIds] = await Promise.all([
          getSetting('statsPanels', null),
          getEngelFoodIds()
        ])
        statsPanels.value = normalizeStatsPanels(cfg)
        engelFoodIds.value = foodIds
      } catch (e) {
        console.warn('[stats] 读组件配置失败:', e && e.message)
      }
    }

    function goProfile() {
      uni.navigateTo({ url: '/pages/settings/profile' })
    }

    /* ------------------------------------------------------ 记账按钮 */

    /** 短按：记下意图并切回首页（面板只挂在首页） */
    function onAddTap() {
      gotoHomeAndAdd(settingStore.quickAddTapAction === 'manual' ? 'manual' : 'ai', uiStore)
    }

    /** 长按：同上，按长按的配置打开 */
    function onAddHoldEnd() {
      gotoHomeAndAdd(settingStore.quickAddHoldAction === 'manual' ? 'manual' : 'ai', uiStore)
    }

    /*
     * 页面级刷新闸门：
     *   · firstShow —— onMounted 已经加载过一次，首次 onShow 不再重复查
     *   · dirty     —— 别的页面改过流水/账户/预算/分类才需要重查
     *   · pageVisible —— 事件到达时页面是否在前台
     */
    let firstShow = true
    let pageVisible = false
    let dirty = false

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await loadPanelSettings()
      applyPendingStatsFilter()
      await loadAllCategories()
      await loadAll()
      dirty = false
      // 日趋势拖动选中要知道柱子区的屏幕位置，
      // 等数据渲染完了才量得准（此时 .daily-touch 已存在）
      setTimeout(measureTrend, 60)
    })

    onShow(async () => {
      pageVisible = true
      if (settingStore.loaded) {
        /*
         * ★ 每次回到本页都要重读面板配置 ★
         *   用户可能刚在「组件管理」里改了顺序、隐藏了面板、
         *   或重选了食品分类 —— 不重读就得杀进程才生效。
         *   读 setting 是纯内存/一次 KV 查询，代价可以忽略。
         */
        const panelsBefore = JSON.stringify(statsPanels.value)
        await loadPanelSettings()
        const panelsChanged = panelsBefore !== JSON.stringify(statsPanels.value)

        /*
         * ★ 重新进入统计页默认清空「更多筛选」并回到本月 ★
         *   只有从账户/标签详情带条件跳过来时才保留这次条件。
         *   pendingApplied 用来兼容 onMounted 已经消费过 pending 的情况，
         *   否则 onShow 会把刚带进来的条件又清掉。
         */
        const stateBefore = JSON.stringify({
          mode: dateMode.value,
          range: dateRange.value,
          filter: filterQuery.value
        })
        const hadPending = applyPendingStatsFilter()
        if (!hadPending && !pendingApplied) {
          resetAppliedFilter()
          resetDateToCurrentMonth()
        }
        pendingApplied = false
        const stateChanged = stateBefore !== JSON.stringify({
          mode: dateMode.value,
          range: dateRange.value,
          filter: filterQuery.value
        })

        /*
         * ★ 首次 onShow 不重复加载 ★
         *   onMounted 已经查过一遍，uni-app 紧接着还会触发一次 onShow。
         *   旧实现两次全量查询挨着跑，首屏白白多等一倍。
         */
        if (firstShow) {
          firstShow = false
        } else if (dirty || panelsChanged || stateChanged) {
          await loadAllCategories()
          await loadAll()
          dirty = false
        }
      }
      settingStore.syncSystemTheme()
      // 重刷原生 tabBar：只有 tab 页才有 tabBar 实例，
      // 主题设置页改完主题后要靠这里把颜色刷回来
      settingStore.refreshTabBar()
    })

    onHide(() => {
      pageVisible = false
    })

    /* 返回键 / 侧滑：筛选面板打开时先收起，不退出统计 tab */
    onBackPress(() => handleBackPress())

    /*
     * 周期补记完成后立刻刷新
     *
     * 竞态：App.vue onShow 里的补记是异步写库，本页 onShow 的 loadAll()
     * 不等它 —— 先按旧数据渲染，补记才落库，本月收支就少算了那几笔。
     * App.vue 补记成功且有新增时 emit 这个事件，这里重查一次。
     */
    /** 只标脏，等下次 onShow 再查（别的 tab 改数据时不必在后台白跑） */
    function markDirty() {
      dirty = true
    }

    uni.$on('txn:changed', markDirty)
    uni.$on('account:changed', markDirty)
    uni.$on('budget:changed', markDirty)
    uni.$on('category:changed', markDirty)

    /* 需要立刻可见的事件（周期补记 / 整库导入） */
    uni.$on('cycle:caughtup', onCycleCaughtUp)
    function onCycleCaughtUp() {
      dirty = true
      if (pageVisible && settingStore.loaded) loadAll()
    }

    uni.$on('data:imported', onDataImported)
    function onDataImported() {
      dirty = true
      if (pageVisible && settingStore.loaded) loadAll()
    }

    /*
     * ★ 必须解绑 ★
     *   tab 页被重建时 setup 会再注册一遍；旧监听不摘掉的话，
     *   一次事件会触发 N 次 loadAll，越用越慢。
     */
    onUnmounted(() => {
      try {
        uni.$off('txn:changed', markDirty)
        uni.$off('account:changed', markDirty)
        uni.$off('budget:changed', markDirty)
        uni.$off('category:changed', markDirty)
        uni.$off('cycle:caughtup', onCycleCaughtUp)
        uni.$off('data:imported', onDataImported)
      } catch (e) {}
    })

    /* ------------------------------------------------ 各卡片独立切换 */

    /** 分类统计：切换支出/收入（按当前层级查询） */
    async function switchCategoryType(type) {
      if (categoryStatType.value === type) return
      categoryStatType.value = type
      try {
        categoryStats.value = categoryLevel.value === 'root'
          ? await getCategoryStatsRange(range.value, type)
          : await getSubCategoryStatsRange(range.value, type)
      } catch (e) {
        console.error('[stats] 分类统计切换失败', e)
      }
    }

    /**
     * 账户统计：切换支出/收入。
     * ★ 同时加载「按账户」和「按账户类别」两个数据源 ★
     *   面板合并后，用户可能在任一视图下切换支出/收入，
     *   必须两个都更新，切回另一视图时数据才是新的。
     */
    async function switchAccountType(type) {
      if (accountStatType.value === type) return
      accountStatType.value = type
      try {
        const [accs, accTypes] = await Promise.all([
          getAccountStatsRange(range.value, type),
          getAccountTypeStatsRange(range.value, type)
        ])
        accountStats.value = accs
        accountTypeStats.value = accTypes
      } catch (e) {
        console.error('[stats] 账户统计切换失败', e)
      }
    }

    /**
     * 账户统计：切换「按账户 / 按账户类别」视图。
     * 两个数据源已在 loadAll 加载，这里只切显示，不用重新查询。
     */
    function switchAccountViewMode(mode) {
      if (accountViewMode.value === mode) return
      accountViewMode.value = mode
    }

    /** 平均值：切换支出/收入（按当前层级查询） */
    async function switchAverageType(type) {
      if (averageStatType.value === type) return
      averageStatType.value = type
      try {
        const [avgs, catAvgs] = await Promise.all([
          getAveragesRange(range.value, type),
          averageLevel.value === 'root'
            ? getCategoryAveragesRange(range.value, type)
            : getSubCategoryAveragesRange(range.value, type)
        ])
        averages.value = avgs
        categoryAverages.value = catAvgs
      } catch (e) {
        console.error('[stats] 平均值切换失败', e)
      }
    }

    /* ------------------------------------------------ 一级/二级分类切换 */

    /** 分类统计：切换一级/二级分类 */
    async function switchCategoryLevel(level) {
      if (categoryLevel.value === level) return
      categoryLevel.value = level
      try {
        categoryStats.value = categoryLevel.value === 'root'
          ? await getCategoryStatsRange(range.value, categoryStatType.value)
          : await getSubCategoryStatsRange(range.value, categoryStatType.value)
      } catch (e) {
        console.error('[stats] 分类统计层级切换失败', e)
      }
    }

    /**
     * 同比变化：切换支出/收入
     *
     * ★ 只重查同比这一块 ★
     *   这是面板自己的维度，和分类统计、账户统计都无关，
     *   为它跑一次全量 loadAll 会让整页闪一下。
     */
    async function switchComparisonType(type) {
      if (comparisonType.value === type) return
      comparisonType.value = type
      await reloadComparison()
    }

    /** 同比变化：切换一级/二级分类 */
    async function switchComparisonLevel(level) {
      if (comparisonLevel.value === level) return
      comparisonLevel.value = level
      await reloadComparison()
    }

    /** 重查同比（切换维度后调用，失败保持上一次的值） */
    async function reloadComparison() {
      try {
        comparison.value = await getPeriodComparison(range.value, {
          level: comparisonLevel.value,
          type: comparisonType.value
        })
      } catch (e) {
        console.warn('[stats] 同比重查失败:', e && e.message)
      }
    }

    /** 平均值：切换一级/二级分类 */
    async function switchAverageLevel(level) {
      if (averageLevel.value === level) return
      averageLevel.value = level
      try {
        categoryAverages.value = averageLevel.value === 'root'
          ? await getCategoryAveragesRange(range.value, averageStatType.value)
          : await getSubCategoryAveragesRange(range.value, averageStatType.value)
      } catch (e) {
        console.error('[stats] 平均值层级切换失败', e)
      }
    }

    /*
     * 日趋势里被点中的柱子下标（-1 = 没点）
     *
     * ★ 为什么存下标而不是存整个对象 ★
     *   下标能跟着数据重算自动失效；
     *   存对象的话，换了时间区间后它会指向一个不存在的日期。
     */
    const selectedBarIndex = ref(-1)

    /** 选中的那一根柱的数据（没选 / 下标越界时为 null） */
    const selectedBar = computed(() => {
      const i = selectedBarIndex.value
      if (i < 0 || i >= dailyTrend.value.length) return null
      return dailyTrend.value[i]
    })

    /** 清掉选中状态（换区间 / 切粒度 / 松手时调） */
    function clearBarPick() {
      selectedBarIndex.value = -1
    }

    /* ------------------------------------------------ 点住拖动选中 */

    /**
     * 柱子区域的位置（视口坐标）
     *
     * ★ 为什么要量它 ★
     *   touchmove 给的是**视口坐标**，而我们需要的是「手指在第几根柱上」。
     *   得先知道柱子区左边界和宽度，才能把 clientX 换算成 0~1 的比例。
     *
     * ★ 为什么缓存而不是每次现量 ★
     *   createSelectorQuery 是异步的，在 touchmove 里等它回来会慢一拍，
     *   跟手会很明显地延迟。模式与 components/SmoothLineChart.vue 一致：
     *   挂载后量一次，首次触摸时再兜底量一次（页面滚动后位置会变）。
     */
    const trendRect = ref(null)

    function measureTrend() {
      try {
        const query = uni.createSelectorQuery().in(getCurrentInstance().proxy)
        query.select('.daily-touch').boundingClientRect((r) => {
          if (r && r.width) trendRect.value = { left: r.left, width: r.width }
        }).exec()
      } catch (e) {
        // 量不到就走 clientXToChartX 的内部兜底，不报错
      }
    }

    /**
     * 把触摸点换算成柱子下标
     *
     * ★ 算法 ★
     *   每根柱平分整个宽度（.daily-bar-wrap 是 flex:1），
     *   所以下标 = floor(比例 × 总数)，越界夹到两端。
     *
     * ★ 量不到容器时怎么办 ★
     *   不能拿 {left:0, width:1} 去算 —— 那会把任何 clientX 都算成比例 1，
     *   每次按下都选中**最后一根**。
     *   这里按「窗口宽 - 页面左右各 32rpx 内边距」估算，
     *   和 components/SmoothLineChart.vue 的兜底算法一致。
     */
    function trendRectOrDefault() {
      if (trendRect.value && trendRect.value.width > 0) return trendRect.value
      let winWidth = 375
      try { winWidth = uni.getSystemInfoSync().windowWidth || 375 } catch (e) {}
      // 32rpx 在 750rpx 设计稿上换算成 px，左右各一份
      const padPx = (32 / 750) * winWidth
      return { left: padPx, width: Math.max(winWidth - padPx * 2, 1) }
    }

    function indexAtClientX(clientX) {
      const n = dailyTrend.value.length
      if (n <= 0) return -1
      const rect = trendRectOrDefault()
      // 换算成 0~1 的比例：vbWidth 传 1，得到的就是比例值
      const ratio = clientXToChartX(clientX, rect.left, rect.width, 1)
      const i = Math.floor(ratio * n)
      return Math.max(0, Math.min(n - 1, i))
    }

    function onTrendTouchStart(e) {
      const t = e.touches && e.touches[0]
      if (!t) return
      // 第一次触摸时容器可能还没量过；页面滚动后位置也变了，每次按下重量一次最稳
      measureTrend()
      selectedBarIndex.value = indexAtClientX(t.clientX)
    }

    function onTrendTouchMove(e) {
      const t = e.touches && e.touches[0]
      if (!t) return
      const i = indexAtClientX(t.clientX)
      if (i !== selectedBarIndex.value) selectedBarIndex.value = i
    }

    /**
     * 松手就不显示了（用户本轮要求）
     *
     * ★ 没有任何延时、也不保留最后一个选中项 ★
     *   用户原话「松开就不显示了」——
     *   这是一个「透视鲜卡」式的临时查看，不是选中一个固定项。
     */
    function onTrendTouchEnd() {
      selectedBarIndex.value = -1
    }

    /** 日趋势的最高/最低（含花销），无数据或全为 0 时返回 null */
    const dailyExtremes = computed(() => {
      const list = dailyTrend.value.filter((d) => Number(d.expense) > 0)
      if (list.length === 0) return null
      let max = list[0]
      let min = list[0]
      for (const d of list) {
        if (Number(d.expense) > Number(max.expense)) max = d
        if (Number(d.expense) < Number(min.expense)) min = d
      }
      return { max: { label: max.label, expense: max.expense }, min: { label: min.label, expense: min.expense } }
    })

    return {
      formatWanYuan,
      settingStore,
      dateRange, filterBarRef,
      // 更多筛选（复用全部交易页的面板）
      showFilter, appliedFilter, filterCount, openFilter, onFilterApply,
      // 时间筛选方式（日/月/年 或 自定义起止日）
      dateMode, customStart, customEnd, todayKey,
      onModeChange, onCustomChange,
      categoryStatType, accountStatType, averageStatType,
      categoryLevel, averageLevel, accountViewMode,
      categoryStats, categoryAverages,
      dailyTrend, averages, topExpenses, overview,
      primaryColor, pageStyle, rangeLabel, trendTitle, trendSubtitle, trendUnit, trendBucket,
      categoryTotal, categoryDonutUri, accountTotal, accountTypeTotal,
      accountViewList, accountViewDonutUri,
      dailyExtremes,
      selectedBarIndex, selectedBar, barColor,
      onTrendTouchStart, onTrendTouchMove, onTrendTouchEnd,
      barHeight, shortDay, tagBadgeStyle,
      // 组件管理（面板顺序与显隐）
      statsPanels, visiblePanels, panelVisible, panelOrderStyle,
      // 同比 / 环比（两块共用 components/StatsComparePanel.vue）
      comparison, comparisonType, comparisonLevel, momComparison, momLevel, momType,
      savings, savingsColor, savingsHint, savingsAll, savingsAllColor, savingsAllHint, budgetExecution,
      signedWanYuan,
      // 恩格尔系数
      engel, engelLevel, engelColor, engelFoodNames,
      engelAll, engelAllText, engelAllLevel, engelAllColor,
      onRangeChange,
      switchCategoryType, switchAccountType, switchAverageType,
      switchCategoryLevel, switchAverageLevel, switchAccountViewMode,
      switchComparisonType, switchComparisonLevel, switchMomType, switchMomLevel,
      onAddTap, onAddHoldEnd,
      goTxnDetail, goProfile
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

/*
 * 面板排序容器
 *
 * ★ 必须是 flex column ★
 *   CSS 的 `order` 只在 flex / grid 容器里生效，
 *   普通 block 容器里给子元素写 order 完全没反应 ——
 *   这就是「组件管理里排了顺序、统计页却没变」最容易踩的坑。
 *
 * ★ 只影响「谁在前谁在后」，不影响子元素自身布局 ★
 *   子元素仍是 block（.card / .ov-summary 自己定宽高），
 *   flex column 会让它们默认 stretch 到 100% 宽，正好和原来一致。
 */
.panel-flow {
  display: flex;
  flex-direction: column;
}

/* ------------------------------------------------ 储蓄率 */

/*
 * 储蓄率：左右两列（本轮用户第 10 条）
 *
 * ★ 与恩格尔同一套排版 ★
 *   两块面板都是「本区间 vs 全部」，长得一模一样才不会让人
 *   以为是两个不同的东西；用同一组类名也能共用一部分样式。
 */
.savings-split {
  display: flex;
  align-items: stretch;
  margin-top: 8rpx;
}

.savings-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
  min-width: 0;
}

/* 中间竖分隔：和恩格尔 / 不计入预算同一套视觉语言 */
.savings-split-line {
  width: 1rpx;
  background-color: var(--app-line);
  margin: 4rpx 20rpx;
  flex-shrink: 0;
}

.savings-col-label {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.savings-value {
  font-size: 52rpx;
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.savings-unit {
  font-size: 24rpx;
  font-weight: 500;
}

.savings-level {
  font-size: 22rpx;
}

/* 结余 / 收入：两行 + 占比轴（用户本轮第 3 条，与恩格尔同一套） */
.savings-costs {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  margin-top: 10rpx;
  width: 100%;
}

.savings-cost-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8rpx;
}

.savings-cost-label {
  font-size: 18rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
}

.savings-cost-value {
  font-size: 20rpx;
  color: var(--app-text-2);
  font-variant-numeric: tabular-nums;
}

/* ------------------------------------------------ 预算执行 */

.budget-top {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
  margin-bottom: 14rpx;
}

.budget-used {
  font-size: 40rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.budget-limit {
  font-size: 24rpx;
  color: var(--app-text-3);
  font-variant-numeric: tabular-nums;
  flex: 1;
}

.budget-percent {
  font-size: 26rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.budget-bar {
  position: relative;
  height: 14rpx;
  border-radius: 7rpx;
  background-color: var(--app-card-2);
  overflow: hidden;
}

.budget-bar-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 7rpx;
}

/* 逐条预算：名字 + 迷你进度条 + 百分比，一行一条 */
.budget-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 24rpx;
}

.budget-item {
  display: flex;
  align-items: center;
  gap: 12rpx;
  min-width: 0;
}

.budget-item-name {
  font-size: 24rpx;
  color: var(--app-text-2);
  width: 160rpx;
  flex-shrink: 0;
}

.budget-item-bar {
  position: relative;
  flex: 1;
  min-width: 80rpx;
  height: 10rpx;
  border-radius: 5rpx;
  background-color: var(--app-card-2);
  overflow: hidden;
}

.budget-item-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 5rpx;
}

.budget-item-pct {
  font-size: 22rpx;
  font-variant-numeric: tabular-nums;
  width: 90rpx;
  text-align: right;
  flex-shrink: 0;
}

/* ------------------------------------------------ 恩格尔系数 */

/*
 * 恩格尔：左右两列（本轮用户第 10 条）
 *
 * ★ 为什么是并排而不是上下堆 ★
 *   两个数字回答的是同一个问题（我在食物上花的占比），
 *   只是一个限定在选中区间、一个是全部数据。
 *   并排才能一眼看出「这段时间偏离了平时水平吗」。
 */
.engel-split {
  display: flex;
  align-items: stretch;
  margin-top: 8rpx;
}

.engel-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
  min-width: 0;
}

/* 中间竖分隔：和「不计入预算 ｜ 待报销」同一套视觉语言 */
.engel-split-line {
  width: 1rpx;
  background-color: var(--app-line);
  margin: 4rpx 20rpx;
  flex-shrink: 0;
}

/* 列标签：本区间 / 全部 */
.engel-col-label {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.engel-value {
  font-size: 52rpx;
  font-weight: 600;
  color: var(--app-text);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.engel-unit {
  font-size: 24rpx;
  font-weight: 400;
  color: var(--app-text-3);
  margin-left: 4rpx;
}

.engel-level {
  font-size: 22rpx;
  font-weight: 500;
}

/*
 * 食品 / 总支出：两行（用户本轮第 3 条）
 *
 * ★ 为什么从「同一行」改成两行 ★
 *   总支出的数字天生比食品支出长（数量级不同），
 *   挤在一行里时食品那个数会被压到换行，两行各自对齐才好读。
 */
.engel-costs {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  margin-top: 10rpx;
  width: 100%;
}

.engel-cost-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8rpx;
}

.engel-cost-label {
  font-size: 18rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
}

.engel-cost-value {
  font-size: 20rpx;
  color: var(--app-text-2);
  font-variant-numeric: tabular-nums;
}

/* 时间范围选择 */
/*
 * ★ 这里不能设层级 ★
 *   之前写了 `z-index: 5` 本意是让年月日筛的下拉面板别被下面的列表盖住，
 *   但 position + z-index 会创建**层叠上下文**：wd-calendar 弹层哪怕自己
 *   设了 1100，也只是在这个 5 的上下文里当老大，跟页面上的底栏（300）、
 *   「+」按钮（600）比，整棵子树还是 5 —— 于是弹层被压在下面。
 *   层叠只看同一上下文里的兄弟，所以父级一概不设 z-index，
 *   需要浮起来的自己跟页面级比。
 */
.range-picker-bar {
  flex-shrink: 0;
  position: relative;
  padding: 8rpx 32rpx 20rpx;
}

/*
 * 时间筛选（toggle + 自定义起止日）的样式已经搬进
 * components/DateFilterBar.vue —— 两页共用一份，改一处两页都变。
 */

/* 收支摘要 */
.ov-summary {
  display: flex;
  align-items: center;
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 28rpx 0;
  margin-bottom: 24rpx;
}

.ov-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.ov-label {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.ov-line {
  width: 1rpx;
  height: 48rpx;
  background-color: var(--app-line);
}

/* 卡片 */
.card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

/* 标题右侧：层级切换 + 支出/收入切换并排 */
.card-head-right {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;
}

.card-title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--app-text);
}

.card-sub {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.card-empty {
  padding: 32rpx 0;
  text-align: center;
}

.empty-text {
  font-size: 24rpx;
  color: var(--app-text-3);
}

/* AI 对话入口已抽成 components/HeaderAction.vue，四页共用同一套样式 */

/* 饼图小标题（按账户 / 按账户类别） */
.pie-title {
  font-size: 24rpx;
  color: var(--app-text-2);
  display: block;
  margin: 24rpx 0 8rpx;
}

/*
 * 卡片标题右侧的分段切换（支出/收入、一级/二级、账户/类别）
 *
 * ★ 样式在 App.vue ★
 *   .seg-toggle / .seg-item 是全局分段控件，分类管理页、时间筛选条
 *   用的是同一套 —— 以前这里还有一份 .type-toggle/.type-tag，
 *   浅色下底槽和选中块几乎同色，三处一起看不出是按钮。
 *   现在只留全局那份，本页只负责用 --sm 变体把它们塞进卡片头。
 *
 * ★ 为什么本页不能留同名局部样式 ★
 *   scoped 规则的优先级高于全局（多一个 [data-v-xxx]），
 *   留着旧规则会静默压住全局新样式，改了等于没改。
 */

/* 环形图：SVG 图（引导线+文字标注），用 image 加载 data URI */
.donut-wrap {
  position: relative;
  display: flex;
  justify-content: center;
  padding: 16rpx 0 28rpx;
}

.donut-img {
  /*
   * ★ 横向撑满卡片 ★
   *   SVG viewBox 是 300×180（5:3），mode="widthFix" 会按比例撑高，
   *   所以这里不需要写死 height —— 让它随宽度等比缩放，
   *   引导线和文字才不会变形。
   *   width: 100% 让图撑满卡片内容区（630rpx），
   *   引导线文字左右正好贴卡片内边距，视觉上横贯整张卡。
   */
  width: 100%;
}

/*
 * ★ 环形图中央：总计 ★
 *   绝对定位在环的洞中心。洞的内径 44（viewBox 300），
 *   撑满 630rpx 后洞直径约 185rpx，足够放「合计 + 金额」。
 *   left/top 用 50% 居中，再靠 flex 列排内容。
 */
.donut-center {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2rpx;
  /* 不挡住下面的列表点击（虽然图本身无点击） */
  pointer-events: none;
  /* 洞宽约 185rpx，内容最宽不能超过它 */
  max-width: 200rpx;
}

.donut-center-label {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* 排行 */
.rank-list {
  display: flex;
  flex-direction: column;
  gap: 18rpx;
}

.rank-item {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.rank-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  flex-shrink: 0;
}

/* 排行：名称列占满剩余空间，右侧依次是笔数、金额 */
.rank-name {
  font-size: 24rpx;
  color: var(--app-text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 笔数：数字 + 「笔」，右对齐到金额前面 */
.rank-count {
  display: flex;
  align-items: baseline;
  gap: 2rpx;
  flex-shrink: 0;
  margin-right: 12rpx;
  min-width: 64rpx;
  justify-content: flex-end;
}

.rank-count-num {
  font-size: 24rpx;
  color: var(--app-text-2);
  font-weight: 500;
}

.rank-count-unit {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* 金额列固定宽度：金额位数变了，右端也不漂移 */
.rank-amount {
  width: 150rpx;
  flex-shrink: 0;
  /* 用 flex 右对齐：text-align 对行内元素在 App WebView 上不可靠 */
  display: flex;
  justify-content: flex-end;
  overflow: hidden;
}

/* 简单列表 */
.simple-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.simple-item {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.simple-name {
  font-size: 26rpx;
  color: var(--app-text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 各分类平均：名称 + 日均/笔均 同一行 */
.cat-avg-item {
  gap: 14rpx;
  align-items: center;
}

/*
 * 右侧：日均、笔均横向并排（小标签 + 数值在同一行）
 *
 * ★ 两列都定宽并左对齐（用户本轮第 1 条）★
 *   用户原话：「统计页面平均值的日均和笔均要左对齐」。
 *   这两列原来是 flex-shrink:0、宽度跟着内容走 ——
 *   有的分类是「¥12.30」、有的是「¥1,234.56」，
 *   于是每一行的「日均」「笔均」小标签左右来回漂，
 *   上下几十行看起来就是一团乱。
 *   现在给列定宽：标签吃 56rpx、金额吃 150rpx，列内左对齐，
 *   整个列表天然成两根竖线。金额再长也只是在本列内右溢（不会顶到隔壁列）。
 */
.cat-avg-values {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 20rpx;
  flex-shrink: 0;
}

/* 单个值：小标签 + 数值 */
.cat-avg-value {
  display: flex;
  align-items: baseline;
  gap: 4rpx;
  flex-shrink: 0;
  text-align: left;
}

.cat-avg-label {
  font-size: 20rpx;
  color: var(--app-text-3);
  width: 44rpx;
  flex-shrink: 0;
  text-align: left;
}

/* 数值列定宽：不管金额几位，两列的左边缘都对齐 */
.cat-avg-value :deep(.money-text) {
  width: 150rpx;
  text-align: left;
}

/*
 * 标题行右侧的「点中柱」读数（替代副标题）
 *
 * ★ 为什么去掉了绝对定位 ★
 *   上一版把它放在标题行正中间，用户反馈「显示在中间有点丑」。
 *   现在它就是标题行右侧那个位置 —— 和副标题互斥，
 *   没按下时显示「每日支出」，按住时换成日期与金额。
 *   所以这里只需要普通的 flex 对齐，不再需要 left/transform。
 */
.head-pick {
  display: flex;
  align-items: baseline;
  gap: 6rpx;
  flex-shrink: 0;
}

.head-pick-day {
  font-size: 21rpx;
  color: var(--app-text-2);
  font-variant-numeric: tabular-nums;
}

.head-pick-dot {
  font-size: 21rpx;
  color: var(--app-text-3);
}

/* 日趋势 */
.daily-chart {
  padding-top: 12rpx;
}

/*
 * 柱子区的触摸层
 *
 * ★ 为什么要它包住整片柱子区 ★
 *   手指不可能每次都点在柱子上（零花销的日子柱高 0），
 *   而且跟手滑动时手指会离开柱顶。
 *   一个盖住整片区域的透明层，能接到这一片里所有的触摸。
 *
 * ★ 绝不能在这里 preventDefault / .prevent ★
 *   这个页面在 scroll-view 里，一旦把 touchmove 的默认行为阻止，
 *   整个图表区域就能不能滚页面了 ——
 *   用户想往下滑看别的面板，结果卡在这里。
 *   这里只读触摸坐标（touchstart/move 都不阻止默认）。
 *
 * ★ padding-bottom 把坐标轴上方的空白也包进来 ★
 *   否则拖到柱底下方就断了，手感不连续。
 */
.daily-touch {
  padding-bottom: 8rpx;
  /* 拖动柱子时不让浏览器去做文本选择（否则反复拖会出现蓝底） */
  user-select: none;
  -webkit-user-select: none;
}

.daily-bars {
  display: flex;
  align-items: flex-end;
  height: 160rpx;
  gap: 2rpx;
}

.daily-bar-wrap {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
}

.daily-bar {
  width: 100%;
  border-radius: 2rpx 2rpx 0 0;
  min-height: 2rpx;
}

.daily-axis {
  display: flex;
  justify-content: space-between;
  margin-top: 10rpx;
}

.axis-text {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* 日趋势下方的最高/最低日：左右两边对齐 */
.daily-extremes {
  display: flex;
  justify-content: space-between;
  margin-top: 20rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid var(--app-line);
}

.daily-extreme {
  display: flex;
  align-items: baseline;
  gap: 4rpx;
}

.extreme-label {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.extreme-value {
  font-size: 24rpx;
  color: var(--app-text-2);
  font-weight: 500;
}

/* 平均值 */
.avg-grid {
  display: flex;
  gap: 16rpx;
}

/*
 * 日均 / 笔均两块
 *
 * ★ 必须显式左对齐（用户本轮第 1 条）★
 *   用户原话：「统计页面平均值的日均和笔均要左对齐」。
 *
 *   这两个块里是「标签 + 大号金额 + 单位小字」三行，
 *   之前只写了 display:flex 没写对齐方式，在 App 的 WebView 里
 *   文本行会被 flex 的默认行为拉成整行居中/参差（不同机型表现还不一样），
 *   看起来像随手摆的。现在三个方向全部钉死：
 *     align-items: flex-start  各行的左边缘对齐
 *     text-align: left         行内文字左对齐
 *   这样「日均支出 / ¥x.xx / N 天」和「笔均支出 / ¥x.xx / N 笔」
 *   两块的行首在同一根竖线上。
 */
.avg-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 6rpx;
  padding: 20rpx;
  background-color: var(--app-card-2);
  border-radius: 16rpx;
}

.avg-label {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.avg-hint {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* Top 10 */
.top-list {
  display: flex;
  flex-direction: column;
}

.top-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 0;
  border-bottom: 1rpx solid var(--app-line);
}

/*
 * 前三名只高亮名次数字，不铺整行底色（用户要求）
 *
 * 月历里「今天 / 选中日」是一个主题色圆形 + 白字；
 * 这里 1/2/3 也用同样的圆形徽标，整行保持普通卡片底色。
 * 所有名次都占同样大小的圆位，前三名只是把圆填上主题色，
 * 这样 4~10 名的数字不会因为没背景而左右错位。
 */
.top-item:last-child {
  border-bottom: none;
}

.top-rank {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24rpx;
  color: var(--app-text-3);
  font-weight: 600;
  text-align: center;
  flex-shrink: 0;
}

.top-rank.top-3 {
  background-color: var(--app-primary);
  color: #ffffff;
}

.top-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  min-width: 0;
}

.top-name {
  font-size: 26rpx;
  color: var(--app-text);
}

.top-sub {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* Top 10 的分类标签：与流水行 .txn-tag 完全同一套尺寸 / 圆角 / 字重 */
.top-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6rpx;
}

.top-tag {
  flex-shrink: 0;
  max-width: 100%;
  padding: 4rpx 10rpx;
  border-radius: 8rpx;
  border: 1rpx solid transparent;
  font-size: 18rpx;
  line-height: 1;
  font-weight: 500;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.top-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
  flex-shrink: 0;
}

.top-day {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* 「更多筛选」角标：与全部交易页导航栏的筛选数量同一套样式 */
.filter-dot {
  font-size: 18rpx;
  color: #ffffff;
  background-color: var(--app-primary);
  border-radius: 50%;
  padding: 0 8rpx;
  margin-left: 4rpx;
}

</style>
