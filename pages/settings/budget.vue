<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="预算管理" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
      <!--
        ★ 层级结构（v18 起）★
          月预算（每月总支出上限，可开启「未用完结转到下一月」）
            └─ 已分配合计（从月预算里分给各子预算的额度）
                 ├─ 子预算 A（可自定义名称，可挂多个类别）
                 ├─ 子预算 B
                 └─ 未分配额度
        子预算是月预算的**子额度**，不是独立额度；
        没有月预算时不允许设子预算（没有池子可分配）。
      -->

      <!-- 月预算 -->
      <view class="card">
        <view class="card-head">
          <view class="card-title-row">
            <text class="card-title">月预算</text>
          </view>
          <text
            class="card-action"
            :style="{ color: totalBudget ? 'var(--app-text-3)' : 'var(--app-primary)' }"
            @click="editTotalBudget"
          >{{ totalBudget ? '修改' : '设置' }}</text>
        </view>

        <view v-if="totalBudget" class="usage">
          <view class="usage-head">
            <MoneyText :cents="totalBudget.used" :size="36" :weight="600" color="var(--app-text)" />
            <text class="usage-limit">/ {{ (totalBudget.limit / 100).toFixed(0) }}</text>
            <text
              class="usage-pct"
              :style="{ color: totalBudget.over ? 'var(--app-danger)' : primaryColor }"
            >{{ totalBudget.percent }}%</text>
          </view>
          <view class="usage-bar">
            <view
              class="usage-fill"
              :style="{
                width: Math.min(totalBudget.percent, 100) + '%',
                backgroundColor: totalBudget.over ? 'var(--app-danger)' : primaryColor
              }"
            />
          </view>
          <view class="total-foot">
            <view class="total-foot-item">
              <text class="total-foot-label">剩余</text>
              <text
                class="total-foot-num"
                :style="{ color: totalBudget.remaining < 0 ? 'var(--app-danger)' : 'var(--app-text)' }"
              >¥{{ (totalBudget.remaining / 100).toFixed(2) }}</text>
            </view>
            <view class="total-foot-item">
              <text class="total-foot-label">日均可用</text>
              <text class="total-foot-num">¥{{ (totalBudget.dailyAvailable / 100).toFixed(2) }}</text>
            </view>
          </view>

        </view>

        <view v-else class="empty-hint" @click="editTotalBudget">
          <text class="empty-hint-text">未设置月预算，点击设置</text>
        </view>

      </view>

      <!-- 已分配合计（月预算的分配情况） -->
      <view v-if="allocation.hasTotal" class="card">
        <view class="card-head">
          <view class="card-title-row">
            <text class="card-title">已分配子预算</text>
          </view>
        </view>

        <view class="alloc">
          <view class="alloc-head">
            <text class="alloc-label">已分配合计</text>
            <text class="alloc-value">
              <text class="alloc-num">{{ (allocation.allocated / 100).toFixed(0) }}</text>
              <text class="alloc-total">/ {{ (allocation.totalLimit / 100).toFixed(0) }} 元</text>
            </text>
          </view>

          <view class="usage-bar">
            <view
              class="usage-fill"
              :style="{
                width: Math.min(allocation.allocatedPercent, 100) + '%',
                backgroundColor: allocation.overAllocated ? 'var(--app-danger)' : primaryColor
              }"
            />
          </view>

          <!--
            ★ 正常的「未分配额度」不再显示 ★
              用户要求删掉：这一行每天都能看到，但「还剩多少没分」只在
              添加子预算那一刻有用，平时是纯噪音。
              超额警告保留 —— 那是异常状态，老数据里可能有。
          -->
          <text v-if="allocation.overAllocated" class="alloc-warn">
            子预算合计已超出月预算 ¥{{ (Math.abs(allocation.unallocated) / 100).toFixed(2) }}
          </text>
        </view>
      </view>

      <!--
        子预算（月预算的子项）

        ★ 没有月预算时整块隐藏 ★
          用户要求「未设置月预算时，隐藏设置子预算的组件」——
          没有可分配的池子，让用户点「+ 添加」只会撞一串限制提示。
      -->
      <view v-if="allocation.hasTotal" class="card">
        <view class="card-head">
          <view class="card-title-row">
            <text class="card-title">子预算</text>
          </view>
          <text class="card-action" @click="openCategoryPicker">+ 添加</text>
        </view>

        <view v-if="subBudgets.length === 0" class="empty-hint" @click="openCategoryPicker">
          <text class="empty-hint-text">还没有子预算，点击添加</text>
        </view>

        <view v-else class="cat-budget-list">
          <!--
            ★ 交互约定（与分类页 / 标签页保持一致）★
              点整行    -> 进预算详情页（看额度/已用/剩余/进度条）
              右滑      -> 露出「修改」「删除」
          -->
          <wd-swipe-action
            v-for="b in subBudgets"
            :key="b.id"
            v-model="swipeStates[b.id]"
            class="budget-swipe"
          >
            <view class="cat-budget" @click="goBudgetDetail(b)">
              <!--
                标题行：左边名字，右边「管的类别」

                ★ 为什么类别挪到名字右边 ★
                  以前类别单独占一行放在名字下面，一条子预算是三行高度
                  （名字 / 类别 / 金额），列表一长就得滚很久。
                  挪到右侧以后行高少了一行，而且「这条预算管什么」和
                  「它叫什么」在同一视线里，扫一眼就对上。
              -->
              <view class="cat-budget-head">
                <view class="cat-budget-title">
                  <view class="cat-budget-dot" :style="{ backgroundColor: primaryColor }" />
                  <text class="cat-budget-name">{{ b.name }}</text>
                </view>
                <text class="cat-budget-cats">{{ catsLabel(b) }}</text>
              </view>
              <view class="usage-head">
                <MoneyText :cents="b.used" :size="30" :weight="500" color="var(--app-text)" />
                <text class="usage-limit">/ {{ (b.limit / 100).toFixed(0) }}</text>
                <text
                  class="usage-pct"
                  :style="{ color: b.over ? 'var(--app-danger)' : primaryColor }"
                >{{ b.percent }}%</text>
              </view>
              <view class="usage-bar">
                <view
                  class="usage-fill"
                  :style="{
                    width: Math.min(b.percent, 100) + '%',
                    backgroundColor: b.over ? 'var(--app-danger)' : primaryColor
                  }"
                />
              </view>
              <text class="cat-budget-remaining" :class="{ danger: b.remaining < 0 }">
                剩余 ¥{{ (b.remaining / 100).toFixed(2) }}
              </text>
            </view>

            <!--
              右滑操作区：修改 + 删除

              ★ 为什么两个按钮各自绑 @click.stop ★
                wd-swipe-action 的整个右滑区域只会 emit 一个
                { value: 'right' } 事件，分不出是哪个按钮。
                所以两个按钮各自绑 @click.stop，自己处理。
            -->
            <template #right>
              <view class="swipe-edit" :style="{ backgroundColor: primaryColor }" @click.stop="editCategoryBudget(b)">
                <text class="swipe-action-text">修改</text>
              </view>
              <view class="swipe-delete" style="background-color: var(--app-danger)" @click.stop="removeBudget(b)">
                <text class="swipe-action-text">删除</text>
              </view>
            </template>
          </wd-swipe-action>
        </view>
      </view>

      <view class="tip-card">
        <text class="tip-text">
          预算按自然月计算。子预算是月预算下设的子额度，
          额度从月预算里分配出去，合计不能超过月预算；
          一条子预算可以挂多个类别，名字可以自己起。
        </text>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 预算编辑弹层 -->
    <!--
      z-index 100：编辑弹层要先于别的浮层出现，
      里面的「选择类别」再叠一层多选弹层（110），否则会出现
      「点开弹层只有遮罩变暗、内容被下层盖住」。
    -->
    <wd-popup v-model="showEditor" position="bottom" :z-index="100" :safe-area-inset-bottom="true">
      <view class="editor">
        <view class="editor-head">
          <text class="editor-cancel" @click="closeEditor">取消</text>
          <text class="editor-title">{{ editorTitle }}</text>
          <text class="editor-save" @click="saveBudget">保存</text>
        </view>

        <view class="editor-body">
          <!-- 子预算名称（月预算没有名字，固定叫「月预算」） -->
          <view v-if="editorMode === 'category'" class="editor-row">
            <text class="editor-label">预算名称</text>
            <input
              v-model="editorName"
              class="name-input"
              type="text"
              :maxlength="20"
              :placeholder="defaultSubBudgetName"
              placeholder-class="name-placeholder"
            />
          </view>

          <view class="editor-row">
            <text class="editor-label">预算金额</text>
            <view class="amount-input-wrap">
              <text class="amount-symbol" :style="{ color: primaryColor }">¥</text>
              <input
                v-model="editorAmount"
                class="amount-input"
                type="digit"
                placeholder="0.00"
                placeholder-class="amount-placeholder"
                :focus="editorMode === 'total'"
              />
            </view>
          </view>

          <!--
            子预算：选择类别

            ★ 不在编辑器里直接铺一张长列表 ★
              支出分类有几十个，内联列表要么把弹层顶得比屏幕还高、
              把「保存」挤出可视区，要么缩成一个小滚动框，
              勾选时得在一个窄条里上下翻 —— 两种都很难用。
              所以改成一行「已选 N 个」的入口，点开是多选弹层：
              弹层里有整块屏幕的高度，按一级分类分组，勾完点确定回来。
          -->
          <view v-if="editorMode === 'category'" class="editor-row editor-row-column">
            <view class="pick-head">
              <text class="editor-label">选择类别</text>
              <!--
                ★ 右侧只给摘要，不罗列 ★
                  以前是把选中的类别做成一片一片的胶囊全部铺出来：
                  挂 5 个类别就占掉三四行，弹层被顶高、下面的金额和
                  「保存」都要滚出去。现在只显示「已选择 分类名 等N项」，
                  具体是哪几个点开弹层就能看，这里只需要确认「选过了」。
              -->
              <text class="pick-count">{{ catPickLabel }}</text>
            </view>

            <view class="pick-open" @click="openCatPickerSheet">
              <text class="pick-open-text">
                {{ editorCatIds.length > 0 ? '修改选择的类别' : '点这里选择类别' }}
              </text>
              <text class="picker-arrow">›</text>
            </view>
          </view>
        </view>

        <!--
          ★ 删除入口 ★
            只在「编辑已有预算」时出现（editorBudgetId 非空），新建时不显示。
        -->
        <view v-if="editorBudgetId" class="editor-danger">
          <text class="danger-link" @click="onDeleteFromEditor">删除这个预算</text>
        </view>
      </view>
    </wd-popup>

    <!--
      类别多选弹层
      ★ 与「全部交易」筛选面板用的是同一个组件 ★
        从子预算点「全部交易」跳过去时，筛选面板也要能回显多个类别，
        两边共用一套分组与勾选规则，才不会长成两种样子。
    -->
    <CategoryMultiPickerSheet
      v-model="showCatPicker"
      :z-index="110"
      :categories="expenseCategories"
      :selected-ids="editorCatIds"
      :disabled-ids="disabledCatIds"
      title="选择类别"
      @picked="onCatConfirm"
    />

    <!-- 弹窗宿主：确定框统一用组件库样式 -->
    <AppDialog />

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { onShow, onBackPress } from '@dcloudio/uni-app'
import PageNav from '@/components/PageNav.vue'
import MoneyText from '@/components/MoneyText.vue'
import CategoryMultiPickerSheet from '@/components/CategoryMultiPickerSheet.vue'
import AppDialog from '@/components/AppDialog.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { getBudgetUsage } from '@/api/stats.js'
import { createBudget, updateBudget, deleteBudget, summarizeAllocation, checkCategoryAllocation } from '@/api/budget.js'
import { listCategories } from '@/api/category.js'
import { yuanToCents } from '@/utils/money.js'
import { toMonthKey } from '@/utils/date.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'
import { pushLayer, handleBackPress } from '@/utils/layerStack.js'

export default {
  components: { PageNav, MoneyText, CategoryMultiPickerSheet, AppDialog, UpdateDialog },
  setup() {
    const settingStore = useSettingStore()

    const usages = ref([])
    const categories = ref([])

    const showEditor = ref(false)
    /** 编辑对象：total 月预算 / category 子预算 */
    const editorMode = ref('total')
    const editorBudgetId = ref('')
    const editorAmount = ref('')
    /** 子预算名称（可空，空则按类别名自动命名） */
    const editorName = ref('')
    /** 子预算挂的类别 id 数组（v18 起支持多选） */
    const editorCatIds = ref([])
    /** 类别多选弹层是否打开 */
    const showCatPicker = ref(false)

    /**
     * wd-swipe-action 的展开状态。
     * key 是预算 id，值是该行当前是否展开（右滑打开）。
     */
    const swipeStates = reactive({})

    /**
     * 收起某一行（或所有行）的右滑操作区
     *
     * ★ 为什么必须手动收 ★
     *   组件自己会在滑回去时 emit 'close'，
     *   但「右滑 -> 点修改 -> 弹层打开 -> 弹层关掉」这条路径上，
     *   那一行还保持着右滑展开状态，
     *   用户看到的是「编辑完了，右边还挂着两个按钮」。
     *
     * @param {string} id 预算 id；不传则收起所有
     */
    function closeSwipe(id) {
      if (id) {
        swipeStates[id] = 'close'
        return
      }
      for (const key of Object.keys(swipeStates)) {
        swipeStates[key] = 'close'
      }
    }

    /** 收起所有行的右滑操作区 */
    function closeAllSwipes() {
      closeSwipe()
    }

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    const totalBudget = computed(() => usages.value.find((b) => b.scope === 'total') || null)
    /** 子预算列表（v18 起叫子预算；数据结构仍是 scope='category'） */
    const subBudgets = computed(() => usages.value.filter((b) => b.scope === 'category'))

    /**
     * 额度分配情况
     *
     * ★ 子预算是月预算的子额度 ★
     *   已分配合计 = 所有子预算的额度之和
     *   未分配额度 = 月预算 - 已分配合计
     *   超出时（已分配合计 > 月预算）红色提示（正常情况存不进，老数据可能）
     */
    const allocation = computed(() => summarizeAllocation(usages.value))

    /** 「子预算」卡片的副标题 */
    const categorySubTitle = computed(() => {
      const left = allocation.value.unallocated
      if (left > 0) return `还可分配 ¥${(left / 100).toFixed(2)}`
      return '额度已分完'
    })

    /** 所有已被子预算占用的类别 id（跨预算） */
    const usedCatIds = computed(() => {
      const set = new Set()
      for (const b of subBudgets.value) {
        for (const cid of b.categoryIds || []) {
          if (b.id === editorBudgetId.value) continue
          set.add(cid)
        }
      }
      return set
    })

    /**
     * 支出分类扁平列表（传给多选弹层）
     *
     * ★ 只传白名单字段 ★
     *   弹层只需要 id / parent_id / name / isParent。
     *   整个 category 行传过去会带上 icon/color/deleted_at 等无关字段，
     *   弹层里改动它们也不会同步回库里 —— 传少一点，两边责任更清楚。
     */
    const expenseCategories = computed(() =>
      categories.value
        .filter((c) => c.type === 'expense' && !c.deleted_at)
        .map((c) => ({
          id: c.id,
          parent_id: c.parent_id || '',
          name: c.name,
          isParent: !!c.isParent
        }))
    )

    /** 类别 id -> 「一级-二级」文案（已选 chip 用） */
    const catLabelMap = computed(() => {
      const map = {}
      const list = expenseCategories.value
      for (const c of list) {
        if (!c.parent_id) {
          map[c.id] = c.name
          continue
        }
        const p = list.find((x) => x.id === c.parent_id)
        map[c.id] = p ? `${p.name}-${c.name}` : c.name
      }
      return map
    })

    /**
     * 传给多选框的禁用类别（数组形式）
     *
     * ★ 为什么要转一次 ★
     *   usedCatIds 是 Set（判重方便），但组件 prop 声明的是 Array ——
     *   直接把 Set 传过去 Vue 会在开发期报「Expected Array, got Set」。
     */
    const disabledCatIds = computed(() => Array.from(usedCatIds.value))

    /** 编辑器里已选类别的 chip 列表 */
    const selectedCats = computed(() =>
      editorCatIds.value.map((id) => ({ id, label: catLabelMap.value[id] || '已删除分类' }))
    )

    /**
     * 子预算行右侧的「管哪些类别」文案
     *
     * ★ 只给第一个名字 + 等N项 ★
     *   全列出来在窄屏上会把这一行挤成两行甚至三行，
     *   而这一格只是让人确认「它管的是哪一类」，不是给用户核对清单用的。
     *   要核对就点进详情页，那里有完整列表。
     *
     * ★ 名字用「一级-二级」而不是只有二级名 ★
     *   用户要求与编辑器里的选择面板保持同一套写法。
     *   只写「日常三餐」看不出它属于餐饮食品还是别的分支，
     *   带上父级名一眼就知道归属；一级分类本身就没有父级，写自己即可。
     *
     * ★ 为什么不用后端返回的 categoryNames ★
     *   那个字段只有分类自己的名字（「日常三餐」），
     *   拿不到父级名。这里用 categoryIds 走前端已有的 catLabelMap，
     *   顺带还能处理「分类已被删除」的兜底。
     */
    function catsLabel(b) {
      const ids = b.categoryIds || []
      if (ids.length === 0) return '未关联类别'
      const names = ids.map((id) => catLabelMap.value[id]).filter(Boolean)
      if (names.length === 0) return '未关联类别'
      if (names.length === 1) return names[0]
      return `${names[0]} 等${names.length}项`
    }

    /**
     * 编辑器标题
     *
     * ★ 子预算按「子预算1、子预算2…」编号 ★
     *   用户要求。这样加第三条时标题就是「子预算3」，
     *   和列表里的顺序一一对应；只写「添加子预算」看不出这是第几条。
     *
     * 编辑已有那条时用它在列表里的序号；新增时用「现有条数 + 1」。
     */
    const editorTitle = computed(() => {
      if (editorMode.value === 'total') return '设置月预算'
      const list = subBudgets.value
      if (editorBudgetId.value) {
        const i = list.findIndex((b) => b.id === editorBudgetId.value)
        if (i >= 0) return `子预算${i + 1}`
      }
      return `子预算${list.length + 1}`
    })

    /**
     * 新建子预算时的默认名称（输入框留空时才用）
     *
     * ★ 按「子预算1、子预算2…」编号 ★
     *   用户要求「不填的话默认是这个」—— 也就是说输入框还是空的，
     *   placeholder 显示这个默认值；用户不填，保存时就用它。
     *   以前留空由后端按类别名自动命名，结果是「餐饮食品」这种，
     *   和「子预算」这个概念对不上，也看不出这是第几条。
     */
    const defaultSubBudgetName = computed(() => `子预算${subBudgets.value.length + 1}`)

    /**
     * 「选择类别」右侧的摘要
     *
     * ★ 不罗列已选的每个类别 ★
     *   用户要求「右侧显示已选择1分类名，后面加等X项」。
     *   罗列会随类别数量增加把弹层顶高，而这里只需要让用户确认
     *   「选过了、大概选了哪些」，点开弹层才是核对细节的地方。
     */
    const catPickLabel = computed(() => {
      const names = selectedCats.value.map((c) => c.label)
      if (names.length === 0) return '未选择'
      if (names.length === 1) return `已选择 ${names[0]}`
      return `已选择 ${names[0]} 等${names.length}项`
    })

    async function load() {
      try {
        const [u, cats] = await Promise.all([
          getBudgetUsage(toMonthKey()),
          listCategories('expense')
        ])
        usages.value = u
        categories.value = cats
      } catch (e) {
        console.warn('[budget] load failed', e)
      }
    }

    /* ------------------------------------------------------ 编辑 */

    function editTotalBudget() {
      editorMode.value = 'total'
      editorBudgetId.value = totalBudget.value ? totalBudget.value.id : ''
      editorCatIds.value = []
      editorName.value = ''
      // 月预算的金额填「本月原本的额度」（不含结转），否则用户点开修改
      // 会看到包含结转的更大数字，一保存就把额度抬高了。
      editorAmount.value = totalBudget.value
        ? String((totalBudget.value.monthly || totalBudget.value.limit) / 100)
        : ''
      showEditor.value = true
    }

    function editCategoryBudget(b) {
      editorMode.value = 'category'
      editorBudgetId.value = b.id
      editorName.value = b.name || ''
      editorAmount.value = String(b.limit / 100)
      editorCatIds.value = (b.categoryIds || []).slice()
      showEditor.value = true
    }

    /**
     * 关闭编辑弹层
     *
     * ★ 右滑收起交给 watch(showEditor) ★
     *   （点遮罩关闭时 v-model 也会把 showEditor 置 false，watch 一并兜住）
     */
    function closeEditor() {
      showEditor.value = false
    }

    /** 「+ 添加」：直接打开子预算编辑器 */
    function openCategoryPicker() {
      if (!allocation.value.hasTotal) {
        uni.showToast({ title: '请先设置月预算', icon: 'none' })
        return
      }
      if (expenseCategories.value.length === 0) {
        uni.showToast({ title: '没有可设置的类别了', icon: 'none' })
        return
      }
      editorMode.value = 'category'
      editorBudgetId.value = ''
      // 名称留空，placeholder 给「子预算N」；保存时留空就用这个默认名
      editorName.value = ''
      editorAmount.value = ''
      editorCatIds.value = []
      showEditor.value = true
    }

    /** 点整行 -> 预算详情页 */
    function goBudgetDetail(b) {
      uni.navigateTo({ url: `/pages/settings/budget-detail?id=${b.id}` })
    }

    /** 打开类别多选弹层 */
    function openCatPickerSheet() {
      if (expenseCategories.value.length === 0) {
        uni.showToast({ title: '没有可选的分类', icon: 'none' })
        return
      }
      showCatPicker.value = true
    }

    /** 多选弹层点「确定」：把选好的类别写回编辑器 */
    function onCatConfirm(ids) {
      editorCatIds.value = Array.isArray(ids) ? ids.slice() : []
    }

    /**
     * 保存预算
     *
     * ★ 子预算额度超月预算：直接拦，不再「问一句照样存」★
     *   用户这次明确要求「子预算总额度不能超过月预算」，
     *   所以这里先本地校验给出明确的差多少，后端的硬校验兜底。
     */
    async function saveBudget() {
      const cents = yuanToCents(editorAmount.value)
      if (!(cents > 0)) {
        uni.showToast({ title: '请填写预算金额', icon: 'none' })
        return
      }

      if (editorMode.value === 'total') {
        const existing = totalBudget.value
        try {
          if (existing) {
            await updateBudget(existing.id, { amount_cents: cents })
          } else {
            await createBudget({
              scope: 'total',
              amount_cents: cents,
              period: 'month',
              start_month: existing ? existing.start_month : toMonthKey()
            })
          }
          closeEditor()
          await load()
          uni.showToast({ title: '已保存', icon: 'success' })
        } catch (e) {
          await alertDialog({ title: '保存失败', content: e.message })
        }
        return
      }

      // 子预算
      if (editorCatIds.value.length === 0) {
        uni.showToast({ title: '请至少选择一个类别', icon: 'none' })
        return
      }

      const check = checkCategoryAllocation(usages.value, cents, editorBudgetId.value || undefined)
      if (check.wouldOver) {
        await alertDialog({
          title: '超出月预算',
          content:
            `月预算 ¥${(check.totalLimit / 100).toFixed(2)}，` +
            `已分配给其他子预算 ¥${(check.allocated / 100).toFixed(2)}，` +
            `这次还要 ¥${(cents / 100).toFixed(2)}，` +
            `超出 ¥${(check.overflow / 100).toFixed(2)}。\n` +
            '请先调大月预算，或减少其他子预算的额度。'
        })
        return
      }

      /*
       * 名字兜底：用户没填名称时用「子预算N」
       *   N = 当前条数 + 1（新增时的序号）。
       *   编辑已有子预算时如果用户把名字删空，也回落到同一个默认名 ——
       *   库里 name 为空会让列表显示成空白，比回落到默认名更难看。
       */
      const finalName = (editorName.value || '').trim() || defaultSubBudgetName.value

      try {
        if (editorBudgetId.value) {
          await updateBudget(editorBudgetId.value, {
            amount_cents: cents,
            name: finalName,
            category_ids: editorCatIds.value
          })
        } else {
          await createBudget({
            scope: 'category',
            amount_cents: cents,
            name: finalName,
            category_ids: editorCatIds.value,
            period: 'month',
            start_month: toMonthKey()
          })
        }
        closeEditor()
        await load()
        uni.showToast({ title: '已保存', icon: 'success' })
      } catch (e) {
        await alertDialog({ title: '保存失败', content: e.message })
      }
    }

    async function removeBudget(b) {
      const ok = await confirmDialog({
        title: `删除「${b.name}」预算？`,
        content: '只是删除限额，已产生的交易不受影响',
        confirmText: '删除',
        danger: true
      })
      // 确认框关掉了（不管是确认还是取消），右滑都收起来
      closeAllSwipes()
      if (!ok) return
      try {
        await deleteBudget(b.id)
        await load()
        uni.showToast({ title: '已删除', icon: 'success' })
      } catch (e) {
        await alertDialog({ title: '删除失败', content: e.message })
      }
    }

    /**
     * 从编辑弹层里删除当前这条预算。
     *
     * ★ 为什么月预算也要能删 ★
     *   之前只有「设置/修改」，没有删除。
     *   用户设错了一次就再也回不到「未设置」状态，
     *   只能把金额改成一个很大的数来假装没有 —— 这显然不合理。
     */
    async function onDeleteFromEditor() {
      const id = editorBudgetId.value
      if (!id) return

      const isTotal = editorMode.value === 'total'
      const ok = await confirmDialog({
        title: isTotal ? '删除月预算？' : '删除这个子预算？',
        content: isTotal
          ? '删除后本月不再有总支出上限，已设的子预算也会一起失效。'
          : '删除后这个子预算不再单独限额。已产生的交易不受影响。',
        confirmText: '删除',
        danger: true
      })
      if (!ok) return

      try {
        await deleteBudget(id)
        closeEditor()
        await load()
        uni.showToast({ title: '已删除', icon: 'success' })
      } catch (e) {
        await alertDialog({ title: '删除失败', content: e.message })
      }
    }

    function goBack() {
      uni.navigateBack()
    }

    /**
     * 编辑面板收起（取消/保存/删除/点遮罩关闭）时，把右滑露出的「修改」按钮也收起。
     * 否则用户关掉弹层后，行还保持着右滑展开状态，很别扭。
     *
     * ★ 值必须是 'close' 而不是 false ★
     *   wd-swipe-action 的 modelValue 是字符串（'left' | 'close' | 'right'），
     *   传 false 会触发「Expected String, got Boolean」的类型警告，而且不生效。
     *
     * ★ 月预算不是右滑行（只有子预算有右滑操作区），所以只收子预算那一行 ★
     */
    watch(showEditor, (open) => {
      if (open) {
        /*
         * ★ 预算编辑 / 子预算编辑都走这个弹层（editorMode 区分）★
         *   两者是同一个 showEditor，登记一次就覆盖两种编辑场景：
         *   侧滑返回先收起编辑弹层，不会把「预算管理」页整个退掉。
         */
        if (!unregisterLayer) {
          unregisterLayer = pushLayer(() => { showEditor.value = false }, 'budgetEditor')
        }
        return
      }
      if (unregisterLayer) {
        unregisterLayer()
        unregisterLayer = null
      }
      if (editorMode.value !== 'category') return
      const id = editorBudgetId.value
      if (id) swipeStates[id] = 'close'
    })

    /** 弹层栈注销函数 */
    let unregisterLayer = null

    onUnmounted(() => {
      if (unregisterLayer) {
        unregisterLayer()
        unregisterLayer = null
      }
    })

    // 侧滑返回 / 返回键：预算编辑弹层打开时先收起弹层
    onBackPress(() => handleBackPress())

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await load()
    })

    /**
     * 页面重新显示
     *
     * ★ 从详情页返回时要把右滑收起来 ★
     *   点分类名进详情页前那一行可能正滑着，
     *   返回后看到还挂着的操作区会以为「没退出来」。
     */
    onShow(() => {
      closeAllSwipes()
    })

    return {
      usages, categories, showEditor, editorMode, editorAmount,
      editorBudgetId, editorName, editorCatIds, showCatPicker, defaultSubBudgetName,
      primaryColor, pageStyle, swipeStates,
      totalBudget, subBudgets, allocation, categorySubTitle,
      usedCatIds, disabledCatIds, expenseCategories, selectedCats, catsLabel, editorTitle, catPickLabel,
      load, editTotalBudget, editCategoryBudget, openCategoryPicker,
      goBudgetDetail, openCatPickerSheet, onCatConfirm,
      saveBudget, removeBudget, onDeleteFromEditor,
      closeEditor, closeAllSwipes, goBack, settingStore
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

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

.card-title-row {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
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

.card-action {
  font-size: 24rpx;
  color: var(--app-primary);
}

/* 用量 */
.usage {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.usage-head {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
}

.usage-limit {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.usage-pct {
  font-size: 26rpx;
  font-weight: 600;
  margin-left: auto;
}

.usage-bar {
  height: 12rpx;
  background-color: var(--app-card-2);
  border-radius: 6rpx;
  overflow: hidden;
}

.usage-fill {
  height: 100%;
  border-radius: 6rpx;
  transition: width 0.35s ease;
}

/* 总预算底部的「剩余 / 日均可用」 */
.total-foot {
  display: flex;
  align-items: center;
  gap: 32rpx;
  margin-top: 4rpx;
}

.total-foot-item {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
}

.total-foot-label {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.total-foot-num {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--app-text);
  font-variant-numeric: tabular-nums;
}

/* 已分配合计 */
.alloc {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.alloc-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.alloc-label {
  font-size: 24rpx;
  color: var(--app-text-2);
}

.alloc-value {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
}

.alloc-num {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
  font-variant-numeric: tabular-nums;
}

.alloc-total {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.alloc-tip {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.alloc-unallocated {
  color: var(--app-primary);
  font-weight: 600;
}

.alloc-warn {
  font-size: 22rpx;
  color: var(--app-danger);
}

.empty-hint {
  padding: 32rpx 0;
  text-align: center;
}

.empty-hint-text {
  font-size: 25rpx;
  color: var(--app-text-3);
}

/* 子预算 */
.cat-budget-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

/*
  wd-swipe-action 的外层：每一行独立包一层

  ★ 为什么要 overflow: hidden ★
    这里给了圆角（border-radius），但如果不裁剪，
    右滑滑出来的「修改 / 删除」两个色块是直角，
    就会从圆角外面顶出去 —— 这就是用户说的「穿模」。
    加上 overflow: hidden 之后，操作区被裁进圆角里，边缘就干净了。

  ★ 为什么 padding 要移进 .cat-budget ★
    外层的 padding 会把右滑操作区也推进来，
    导致滑出来的按钮左边留一条底色空隙（看着像按钮没贴合）。
    把内边距放到内容行上，操作区自己贴边。
*/
.budget-swipe {
  display: block;
  border-radius: 16rpx;
  background-color: var(--app-card-2);
  overflow: hidden;
}

.cat-budget {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  padding: 16rpx 20rpx;
  background-color: var(--app-card-2);
}

.cat-budget-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* 名称前的小圆点：表示这是月预算下的一个子项 */
.cat-budget-title {
  display: flex;
  align-items: center;
  gap: 12rpx;
  min-width: 0;
  flex-shrink: 0;
}

.cat-budget-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  flex-shrink: 0;
}

.cat-budget-name {
  font-size: 27rpx;
  color: var(--app-text);
  font-weight: 500;
  /*
   * 名字允许被省略，但不能被压成 0
   * （右边还有「等N项」，主标题必须优先可读）
   */
  max-width: 300rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 这条子预算管的类别：贴在名字右边、靠右对齐
 *
 * ★ 必须能省略 ★
 *   它和名字抢同一行，类别名一长（「餐饮食品-日常三餐 等5项」）
 *   就会把名字挤出去。所以名字 flex-shrink:0 保底，
 *   这一格 flex:1 + text-align:right + 单行省略。
 */
.cat-budget-cats {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-left: 16rpx;
}

.cat-budget-remaining {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.cat-budget-remaining.danger {
  color: var(--app-danger);
}

/* 右滑操作区：修改 / 删除 */
.swipe-edit,
.swipe-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 150rpx;
  height: 100%;
}

.swipe-action-text {
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 500;
}

.tip-card {
  padding: 0 12rpx;
}

.tip-text {
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.7;
}

.bottom-space {
  height: 60rpx;
}

/* 编辑器 */
.editor {
  background-color: var(--app-card);
  padding-bottom: env(safe-area-inset-bottom);
}

.editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.editor-cancel {
  font-size: 28rpx;
  color: var(--app-text-3);
}

.editor-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
}

.editor-save {
  font-size: 28rpx;
  color: var(--app-primary);
  font-weight: 500;
}

.editor-body {
  padding: 8rpx 28rpx 32rpx;
}

/*
  编辑弹层底部的「删除这个预算」
  单独一块区域，和上面的表单用分割线隔开，
  文字用危险色 —— 和标签/分类页的删除入口同一套写法。
*/
.editor-danger {
  padding: 28rpx;
  border-top: 1rpx solid var(--app-line);
  text-align: center;
}

.danger-link {
  font-size: 28rpx;
  color: var(--app-danger);
}

.editor-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 96rpx;
  border-bottom: 1rpx solid var(--app-line);
  gap: 20rpx;
}

.editor-row-column {
  flex-direction: column;
  align-items: flex-start;
  padding: 24rpx 0;
  gap: 16rpx;
}

.editor-label {
  font-size: 28rpx;
  color: var(--app-text);
  flex-shrink: 0;
}

/* 子预算名称输入 */
.name-input {
  flex: 1;
  text-align: right;
  font-size: 28rpx;
  color: var(--app-text);
}

.name-placeholder {
  color: var(--app-text-3);
  font-size: 26rpx;
}

/* 类别多选 */
.pick-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.pick-count {
  font-size: 24rpx;
  color: var(--app-primary);
}

.pick-hint {
  font-size: 21rpx;
  color: var(--app-text-3);
  line-height: 1.5;
}

/* 「选择类别」入口：一行下拉样式，点开弹层 */
.pick-open {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 84rpx;
  padding: 0 24rpx;
  border-radius: 16rpx;
  background-color: var(--app-card-2);
  box-sizing: border-box;
}

.pick-open-text {
  font-size: 26rpx;
  color: var(--app-primary);
}

/* 「选择类别」入口右侧的尖角，和筛选面板的 .filter-row-arrow 同款 */
.picker-arrow {
  font-size: 32rpx;
  color: var(--app-text-3);
  line-height: 1;
}

.amount-input-wrap {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
  flex: 1;
  justify-content: flex-end;
}

.amount-symbol {
  font-size: 32rpx;
  font-weight: 500;
}

.amount-input {
  font-size: 40rpx;
  font-weight: 600;
  color: var(--app-text);
  text-align: right;
  flex: 1;
}

.amount-placeholder {
  color: var(--app-text-3);
  font-size: 40rpx;
  font-weight: 600;
}
</style>
