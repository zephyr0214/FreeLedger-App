<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <AppHeader @avatar-click="goProfile">
      <template #right>
        <!--
          ★ 右上角入口：组件管理（本轮用户第 3 条）★
            原先是「全部交易」，用户要求改成组件管理的入口：
            在那一页可以排序、勾选显隐统计页的各个面板，
            恩格尔系数面板还能展开设置「哪些分类算食品」。
        -->
        <HeaderAction @action-click="goPanelManage">组件管理</HeaderAction>
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
                :class="{ active: categoryLevel === 'sub' }"
                @click="switchCategoryLevel('sub')"
              >二级</text>
              <text
                class="seg-item"
                :class="{ active: categoryLevel === 'root' }"
                @click="switchCategoryLevel('root')"
              >一级</text>
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
        <view class="card-head">
          <text class="card-title">{{ trendTitle }}</text>
          <text class="card-sub">{{ trendSubtitle }}</text>
        </view>
        <view class="daily-chart">
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
                  backgroundColor: d.expense > 0 ? primaryColor : 'transparent'
                }"
              />
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
          数据形状完全一样，只有对比窗口不同（同比=上月同期/去年同期，
          环比=紧邻的上一段等长区间）。UI 写两份迟早长歪。

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
          入口在统计页右上角「组件管理」→ 恩格尔系数面板的展开设置，
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
          <text class="empty-text">还没选食品分类，去右上角「组件管理」里选一下</text>
        </view>
        <view v-else-if="engel.food === 0" class="card-empty">
          <text class="empty-text">这段时间在选中的食品分类上没有支出</text>
        </view>
        <view v-else class="engel-body">
          <view class="engel-main">
            <text class="engel-value">{{ engel.ratio }}<text class="engel-unit">%</text></text>
            <text class="engel-level" :style="{ color: engelColor }">{{ engelLevel }}</text>
          </view>
          <view class="engel-rows">
            <view class="engel-row">
              <text class="engel-row-label">食品支出</text>
              <text class="engel-row-value">¥{{ (engel.food / 100).toFixed(2) }}</text>
            </view>
            <view class="engel-row">
              <text class="engel-row-label">总支出</text>
              <text class="engel-row-value">¥{{ (engel.total / 100).toFixed(2) }}</text>
            </view>
          </view>
          <!-- 用户选中的食品分类名，让人知道这个数是怎么来的 -->
          <view v-if="engelFoodNames.length" class="engel-tags">
            <text
              v-for="n in engelFoodNames"
              :key="n"
              class="engel-tag"
            >{{ n }}</text>
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

        <view v-if="savings.income === 0" class="card-empty">
          <text class="empty-text">这段时间没有收入，算不出储蓄率</text>
        </view>
        <view v-else class="savings-body">
          <view class="savings-main">
            <text class="savings-value" :style="{ color: savingsColor }">{{ savings.rate }}<text class="savings-unit">%</text></text>
            <text class="savings-level" :style="{ color: savingsColor }">{{ savingsHint }}</text>
          </view>
          <view class="savings-rows">
            <view class="savings-row">
              <text class="savings-row-label">收入</text>
              <text class="savings-row-value">¥{{ (savings.income / 100).toFixed(2) }}</text>
            </view>
            <view class="savings-row">
              <text class="savings-row-label">支出</text>
              <text class="savings-row-value">¥{{ (savings.expense / 100).toFixed(2) }}</text>
            </view>
            <view class="savings-row">
              <text class="savings-row-label">结余</text>
              <text class="savings-row-value">¥{{ (savings.balance / 100).toFixed(2) }}</text>
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
              ¥{{ (budgetExecution.used / 100).toFixed(2) }}
            </text>
            <text class="budget-limit">/ ¥{{ (budgetExecution.limit / 100).toFixed(2) }}</text>
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
                :class="{ active: averageLevel === 'sub' }"
                @click="switchAverageLevel('sub')"
              >二级</text>
              <text
                class="seg-item"
                :class="{ active: averageLevel === 'root' }"
                @click="switchAverageLevel('root')"
              >一级</text>
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
            :class="{ 'top-item-hi': i < 3 }"
            @click="goTxnDetail(t.id)"
          >
            <text class="top-rank" :class="{ 'top-3': i < 3 }">{{ i + 1 }}</text>
            <view class="top-info">
              <text class="top-name">{{ t.category_name || '未分类' }}</text>
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
        <text class="empty-text">所有面板都被隐藏了，去右上角「组件管理」里打开几个</text>
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

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <!-- 弹窗宿主：外部打开 JSON 时可能在任意一页弹出，
         缺了这一行就退化成原生弹窗，样式与别处不一致 -->
    <AppDialog />
    <UpdateDialog />
  </view>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppHeader from '@/components/AppHeader.vue'
import StatsComparePanel from '@/components/StatsComparePanel.vue'
import MoneyText from '@/components/MoneyText.vue'
import DateFilterBar from '@/components/DateFilterBar.vue'
import HeaderAction from '@/components/HeaderAction.vue'
import AppTabBar from '@/components/AppTabBar.vue'
import AppDialog from '@/components/AppDialog.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useUiStore } from '@/stores/ui.js'
import { gotoHomeAndAdd } from '@/utils/tabBar.js'
import { donutToDataUri } from '@/utils/donut.js'
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
import { getSetting } from '@/api/settings.js'
/*
 * 同比窗口换算与百分比文案
 * ★ 见 utils/compareRange.js：月末夹取、闰年、跨年、整年、超长区间
 *   五六个分支都在那里，且有 scripts/test-compare-range.mjs 钉着。
 */
import {
  compareRangeLabel, percentText, percentOnly, balanceChangePercent
} from '@/utils/compareRange.js'

export default {
  components: { AppHeader, MoneyText, DateFilterBar, HeaderAction, AppTabBar, AppDialog, UpdateDialog, StatsComparePanel },
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
    const comparisonLevel = ref('sub')

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
    const categoryLevel = ref('sub')
    const averageLevel = ref('sub')

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
    const range = computed(() =>
      dateMode.value === 'custom'
        ? customToRange(customStart.value, customEnd.value)
        : selectionToRange(dateRange.value)
    )

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
    const momLevel = ref('sub')
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
    /** 预算执行情况（hasBudget=false 显示空态） */
    const budgetExecution = ref({ hasBudget: false, limit: 0, used: 0, remaining: 0, percent: 0, over: false, items: [] })

    /**
     * 储蓄率的配色与一句人话
     *
     * ★ 三档而不是连续渐变 ★
     *   储蓄率不是越精确越好，用户要的是「我这段时间算不算会存钱」这个判断，
     *   三档（不错 / 一般 / 花超了）比一个精确到小数点的百分数更好用。
     */
    const savingsColor = computed(() => {
      const r = savings.value.rate
      if (r === null) return 'var(--app-text-3)'
      if (r >= 30) return 'var(--app-success)'
      if (r < 0) return 'var(--app-danger)'
      return 'var(--app-text-2)'
    })

    const savingsHint = computed(() => {
      const r = savings.value.rate
      if (r === null) return '没有收入'
      if (r >= 30) return '存得不错'
      if (r < 0) return '花超了'
      return '还算稳'
    })

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
    const engelLevel = computed(() => {
      const r = engel.value ? engel.value.ratio : 0
      if (r < 30) return '富裕水平'
      if (r < 40) return '小康水平'
      if (r < 50) return '温饱水平'
      return '偏高'
    })

    const engelColor = computed(() => {
      const r = engel.value ? engel.value.ratio : 0
      if (r < 40) return 'var(--app-success)'
      if (r < 50) return 'var(--app-text-2)'
      return 'var(--app-danger)'
    })

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
      // 深色主题用浅字，浅色主题用深字
      const isDark = /dark/i.test(settingStore.theme || '')
      return isDark ? '#9CA3AF' : '#666666'
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

    function shortDay(dayKey) {
      if (!dayKey) return ''
      const [, m, d] = dayKey.split('-')
      return `${Number(m)}/${Number(d)}`
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
    async function loadAll() {
      const r = range.value
      try {
        const [ov, cats, accs, accTypes, catAvgs, daily, avg, top] = await Promise.all([
          getOverviewRange(r),
          // 分类统计：按面板的层级（一级/二级）查询
          categoryLevel.value === 'root'
            ? getCategoryStatsRange(r, categoryStatType.value)
            : getSubCategoryStatsRange(r, categoryStatType.value),
          getAccountStatsRange(r, accountStatType.value),
          getAccountTypeStatsRange(r, accountStatType.value),
          // 平均值：按面板的层级（一级/二级）查询
          averageLevel.value === 'root'
            ? getCategoryAveragesRange(r, averageStatType.value)
            : getSubCategoryAveragesRange(r, averageStatType.value),
          getDailyTrendRange(r),
          getAveragesRange(r, averageStatType.value),
          getTopExpensesRange(r, 10)
        ])

        overview.value = ov
        categoryStats.value = cats
        accountStats.value = accs
        accountTypeStats.value = accTypes
        categoryAverages.value = catAvgs
        dailyTrend.value = daily
        averages.value = avg
        topExpenses.value = top
        // 分类名映射（恩格尔标签用）：区间/层级变化都要更新
        await refreshEngelFoodNames()

        /*
         * ★ 同比 / 恩格尔放在主统计之后 ★
         *   恩格尔系数要用「这段区间的总支出」做分母，
         *   而那个数刚由上面的 overview 拿到 ——
         *   所以必须等主统计回来再跑，不能和它并发。
         *   两者各用各的 catch，坏了一边不拖垮另一边。
         */
        loadExtras(r)
      } catch (e) {
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
    async function loadExtras(r) {
      // 1) 同比（跟着面板自己的支出/收入 与 一级/二级 走）
      try {
        comparison.value = await getPeriodComparison(r, {
          level: comparisonLevel.value,
          type: comparisonType.value
        })
      } catch (e) {
        console.warn('[stats] 同比计算失败:', e && e.message)
        comparison.value = null
      }

      /*
       * 1b) 环比（同样的数据，对比窗口换成「紧邻的上一段等长区间」）
       *
       * ★ 单独 try/catch ★
       *   和同比各坏各的：一个算不出来不该让另一个也空着。
       */
      try {
        momComparison.value = await getPeriodComparison(r, {
          level: momLevel.value,
          type: momType.value,
          mode: 'mom'
        })
      } catch (e) {
        console.warn('[stats] 环比计算失败:', e && e.message)
        momComparison.value = null
      }

      /*
       * 1c) 储蓄率（纯本地聚合，一次查询）
       *
       * ★ 放在 loadExtras 而不是主链 ★
       *   它坏了只是少一块面板，不该让整页统计白屏。
       */
      try {
        savings.value = await getSavingsRate(r)
      } catch (e) {
        console.warn('[stats] 储蓄率计算失败:', e && e.message)
        savings.value = { income: 0, expense: 0, balance: 0, rate: null, savedCents: 0 }
      }

      /*
       * 1d) 预算执行情况
       */
      try {
        budgetExecution.value = await getBudgetExecution(r)
      } catch (e) {
        console.warn('[stats] 预算执行计算失败:', e && e.message)
        budgetExecution.value = { hasBudget: false, limit: 0, used: 0, remaining: 0, percent: 0, over: false, items: [] }
      }

      /*
       * 2) 恩格尔系数
       *
       * ★ 「哪些分类算食品」完全由用户在组件管理页手选 ★
       *   本轮第 3 条明确要求删掉 AI 识别逻辑，
       *   这里只读 setting 里的 id 数组，一次网络请求都不发。
       *   没选分类时 getEngelCoefficient 会返回 foodIds: []，
       *   卡片上显示引导文案而不是 0%。
       */
      try {
        engelFoodIds.value = await getEngelFoodIds()
        await refreshEngelFoodNames()
        await refreshEngel()
      } catch (e) {
        console.warn('[stats] 恩格尔系数计算失败:', e && e.message)
        engel.value = null
      }
    }

    /**
     * 用当前区间 + 已判定的食品分类重算恩格尔系数
     *
     * ★ 分类列表为空也要查 ★
     *   「一个食品分类都没判出来」和「这段时间没有支出」是两种空态，
     *   卡片上的文案不一样（见模板里的两个空态分支）。
     *   所以不在这里提前返回假数据，交给 getEngelCoefficient 给真实的 total。
     */
    async function refreshEngel() {
      const r = await getEngelCoefficient(range.value, engelFoodIds.value)
      engel.value = r
    }

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

    /** 全部交易（右上角入口） */
    /**
     * 右上角「组件管理」入口
     *
     * ★ 原先是「全部交易」，本轮第 3 条改成组件管理 ★
     *   用户要求「统计页面右上方改成组件管理的入口」。
     */
    function goPanelManage() {
      uni.navigateTo({ url: '/pages/settings/stats-panels' })
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

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await loadPanelSettings()
      await loadAll()
    })

    onShow(async () => {
      if (settingStore.loaded) {
        /*
         * ★ 每次回到本页都要重读面板配置与食品分类 ★
         *   用户可能刚在「组件管理」里改了顺序、隐藏了面板、
         *   或重选了食品分类 —— 不重读就得杀进程才生效。
         *   读 setting 是纯内存/一次 KV 查询，代价可以忽略。
         */
        await loadPanelSettings()
        await loadAll()
      }
      settingStore.syncSystemTheme()
      // 重刷原生 tabBar：只有 tab 页才有 tabBar 实例，
      // 主题设置页改完主题后要靠这里把颜色刷回来
      settingStore.refreshTabBar()
    })

    /*
     * 周期补记完成后立刻刷新
     *
     * 竞态：App.vue onShow 里的补记是异步写库，本页 onShow 的 loadAll()
     * 不等它 —— 先按旧数据渲染，补记才落库，本月收支就少算了那几笔。
     * App.vue 补记成功且有新增时 emit 这个事件，这里重查一次。
     */
    uni.$on('cycle:caughtup', () => {
      if (settingStore.loaded) loadAll()
    })

    /*
     * 外部文件导入完成 → 整库换了，本页所有数字都要重查
     *
     * 一般情况下 App.vue 导入后会 reLaunch 回首页，本页会重建；
     * 但这条监听留着，覆盖「已经在首页、没有 reLaunch」以及
     * 以后可能改成不跳转的情况。多一次查询的代价可以忽略。
     */
    uni.$on('data:imported', () => {
      if (settingStore.loaded) loadAll()
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
      settingStore,
      dateRange,
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
      barHeight, shortDay,
      // 组件管理（面板顺序与显隐）
      statsPanels, visiblePanels, panelVisible, panelOrderStyle,
      // 同比 / 环比（两块共用 components/StatsComparePanel.vue）
      comparison, comparisonType, comparisonLevel, momComparison, momLevel, momType,
      savings, savingsColor, savingsHint, budgetExecution,
      // 恩格尔系数
      engel, engelLevel, engelColor, engelFoodNames,
      onRangeChange,
      switchCategoryType, switchAccountType, switchAverageType,
      switchCategoryLevel, switchAverageLevel, switchAccountViewMode,
      switchComparisonType, switchComparisonLevel, switchMomType, switchMomLevel,
      onAddTap, onAddHoldEnd,
      goTxnDetail, goPanelManage, goProfile
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

.savings-body {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.savings-main {
  display: flex;
  align-items: baseline;
  gap: 16rpx;
}

.savings-value {
  font-size: 64rpx;
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.savings-unit {
  font-size: 28rpx;
  font-weight: 500;
}

.savings-level {
  font-size: 24rpx;
}

.savings-rows {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid var(--app-line);
}

.savings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.savings-row-label {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.savings-row-value {
  font-size: 24rpx;
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

.engel-body {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  margin-top: 8rpx;
}

.engel-main {
  display: flex;
  align-items: baseline;
  gap: 16rpx;
}

.engel-value {
  font-size: 64rpx;
  font-weight: 600;
  color: var(--app-text);
  font-variant-numeric: tabular-nums;
}

.engel-unit {
  font-size: 28rpx;
  font-weight: 400;
  color: var(--app-text-3);
  margin-left: 4rpx;
}

.engel-level {
  font-size: 24rpx;
  font-weight: 500;
}

.engel-rows {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.engel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.engel-row-label {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.engel-row-value {
  font-size: 26rpx;
  color: var(--app-text-2);
  font-variant-numeric: tabular-nums;
}

/* 被判为「吃」的分类标签：说明这个数是怎么来的 */
.engel-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}

.engel-tag {
  font-size: 20rpx;
  color: var(--app-text-3);
  background-color: var(--app-card-2);
  border-radius: 8rpx;
  padding: 4rpx 12rpx;
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

/* 右侧：日均、笔均横向并排（小标签 + 数值在同一行） */
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
}

.cat-avg-label {
  font-size: 20rpx;
  color: var(--app-text-3);
}

/* 日趋势 */
.daily-chart {
  padding-top: 12rpx;
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

.avg-item {
  flex: 1;
  display: flex;
  flex-direction: column;
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
 * 前三名：浅浅的主题色背景
 *
 * ★ 暗色下这里原来会「透出一层白」★
 *   --app-primary-light 在暗色下是半透明色（tintOf(primary, 0.22)），
 *   直接当背景色铺在卡片上时，圆角边缘和条目间隙会和父卡片底色叠加，
 *   在深色背景上看起来像一圈发白的阴影，很突兀。
 *
 *   所以高亮块改用不透明的混合色：把主题色以 22% 混进卡片底色，
 *   得到和「半透明叠在卡片上」几乎一样的观感，但不依赖父层，
 *   圆角和间隙处也不会透出白边。
 *   --app-primary-light 仍保留给「徽标 / 胶囊」这类小面积浅底使用。
 */
.top-item-hi {
  background-color: var(
    --app-primary-light-solid,
    var(--app-primary-light)
  );
  border-radius: 12rpx;
  padding-left: 16rpx;
  padding-right: 16rpx;
  margin-bottom: 8rpx;
  /*
   * 高亮块自带圆角背景时不要再加分隔线：
   * 那根线沿着圆角边缘画过去，会在视觉上「描一圈边」。
   */
  border-bottom: none;
}

.top-item:last-child {
  border-bottom: none;
}

.top-rank {
  width: 40rpx;
  font-size: 24rpx;
  color: var(--app-text-3);
  font-weight: 600;
  text-align: center;
  flex-shrink: 0;
}

.top-rank.top-3 {
  color: var(--app-primary);
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

</style>
