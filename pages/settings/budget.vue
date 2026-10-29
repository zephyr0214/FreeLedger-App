<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="预算管理" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
      <!--
        ★ 层级结构 ★
          总预算（本月总支出上限）
            └─ 已分配合计（从总预算里分给各分类的额度）
                 ├─ 分类预算 A
                 ├─ 分类预算 B
                 └─ 未分配额度
        分类预算是总预算的**子额度**，不是独立额度。
      -->

      <!-- 总预算 -->
      <view class="card">
        <view class="card-head">
          <view class="card-title-row">
            <text class="card-title">总预算</text>
            <text class="card-sub">本月总支出上限</text>
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
              <text class="total-foot-num">¥{{ (totalBudget.dailyAvailable / 100).toFixed(0) }}</text>
            </view>
          </view>
        </view>

        <view v-else class="empty-hint" @click="editTotalBudget">
          <text class="empty-hint-text">未设置总预算，点击设置</text>
        </view>
      </view>

      <!-- 已分配合计（总预算的分配情况） -->
      <view v-if="allocation.hasTotal" class="card">
        <view class="card-head">
          <view class="card-title-row">
            <text class="card-title">已分配分类预算</text>
            <text class="card-sub">从总预算里分给各分类的额度</text>
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

          <text v-if="allocation.overAllocated" class="alloc-warn">
            分类预算合计已超出总预算 ¥{{ (Math.abs(allocation.unallocated) / 100).toFixed(2) }}
          </text>
          <text v-else class="alloc-tip">
            未分配额度 <text class="alloc-unallocated">¥{{ (allocation.unallocated / 100).toFixed(2) }}</text>
          </text>
        </view>
      </view>

      <!-- 分类预算（总预算的子项） -->
      <view class="card">
        <view class="card-head">
          <view class="card-title-row">
            <text class="card-title">分类预算</text>
            <text class="card-sub">{{ categorySubTitle }}</text>
          </view>
          <text class="card-action" @click="openCategoryPicker">+ 添加</text>
        </view>

        <view v-if="categoryBudgets.length === 0" class="empty-hint" @click="openCategoryPicker">
          <text class="empty-hint-text">还没有分类预算，点击添加</text>
        </view>

        <view v-else class="cat-budget-list">
          <!--
            ★ 交互约定（与分类页 / 标签页保持一致）★
              点整行    -> 进预算详情页（看额度/已用/剩余/进度条）
              右滑      -> 露出「修改」「删除」

            ★ 为什么把行内的「修改 / 删除」文字按钮换成右滑 ★
              行内按钮和右边的进度数字挤在一起，视觉很乱；
              而且小屏幕上容易误触。
              改成右滑露出操作区后，列表本身干净多了。
          -->
          <wd-swipe-action
            v-for="b in categoryBudgets"
            :key="b.id"
            v-model="swipeStates[b.id]"
            class="budget-swipe"
          >
            <view class="cat-budget" @click="goBudgetDetail(b)">
              <view class="cat-budget-head">
                <view class="cat-budget-title">
                  <view class="cat-budget-dot" :style="{ backgroundColor: primaryColor }" />
                  <text class="cat-budget-name">{{ b.name }}</text>
                </view>
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
          预算按自然月计算。分类预算是总预算下设的子额度，
          分类预算的额度从总预算里分配出去，不额外占用额度。
        </text>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 金额编辑弹层 -->
    <wd-popup v-model="showEditor" position="bottom" :safe-area-inset-bottom="true">
      <view class="editor">
        <view class="editor-head">
          <text class="editor-cancel" @click="closeEditor">取消</text>
          <text class="editor-title">{{ editorTitle }}</text>
          <text class="editor-save" @click="saveBudget">保存</text>
        </view>

        <view class="editor-body">
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
                :focus="true"
              />
            </view>
          </view>

          <view v-if="editorMode === 'category'" class="editor-row editor-row-column">
            <text class="editor-label">选择分类</text>

            <!-- 一级分类 -->
            <view class="picker-row" @click="openParentPicker">
              <text :class="['picker-value', { placeholder: !editorParentId }]">
                {{ editorParentId ? parentName(editorParentId) : '选择一级分类' }}
              </text>
              <text class="picker-arrow">▾</text>
            </view>

            <!-- 二级分类（含「全部二级分类」） -->
            <view class="picker-row" :class="{ disabled: !editorParentId }" @click="openChildPicker">
              <text :class="['picker-value', { placeholder: childIsPlaceholder }]">
                {{ childLabel }}
              </text>
              <text class="picker-arrow">▾</text>
            </view>
          </view>
        </view>

        <!--
          ★ 删除入口 ★
            用户反馈：「总预算和分类预算均没有设置删除功能，
            要在总预算的修改和分类预算的编辑中添加删除功能」。
            只在「编辑已有预算」时出现（editorBudgetId 非空），
            新建时不显示。
        -->
        <view v-if="editorBudgetId" class="editor-danger">
          <text class="danger-link" @click="onDeleteFromEditor">删除这个预算</text>
        </view>
      </view>
    </wd-popup>

    <!-- 一级分类选择 -->
    <wd-action-sheet
      v-model="showParentPicker"
      :actions="parentActions"
      title="选择一级分类"
      cancel-text="取消"
      @select="onParentSelect"
    />

    <!-- 二级分类选择（含「全部二级分类」） -->
    <wd-action-sheet
      v-model="showChildPicker"
      :actions="childActions"
      title="选择二级分类"
      cancel-text="取消"
      @select="onChildSelect"
    />

    <!-- 弹窗宿主：确定框统一用组件库样式 -->
    <AppDialog />
  </view>
</template>

<script>
import { ref, reactive, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import PageNav from '@/components/PageNav.vue'
import MoneyText from '@/components/MoneyText.vue'
import AppDialog from '@/components/AppDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { getBudgetUsage } from '@/api/stats.js'
import { listBudgets, createBudget, updateBudget, deleteBudget, summarizeAllocation, checkCategoryAllocation } from '@/api/budget.js'
import { listCategories } from '@/api/category.js'
import { yuanToCents } from '@/utils/money.js'
import { toMonthKey } from '@/utils/date.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'

export default {
  components: { PageNav, MoneyText, AppDialog },
  setup() {
    const settingStore = useSettingStore()

    const usages = ref([])
    const categories = ref([])

    const showEditor = ref(false)
    const editorMode = ref('total')       // total | category
    const editorCategoryId = ref('')
    const editorBudgetId = ref('')
    const editorAmount = ref('')
    /** 一级分类选择（二级下拉的第一级） */
    const editorParentId = ref('')
    /** 二级分类选择：'' 未选 / '__all__' 全部二级分类 / 否则为某个二级分类 id */
    const editorChildId = ref('')
    /** 正在编辑的那条预算对应的分类 id（用于「已设预算也能选回自己」） */
    const editingCatId = ref('')
    const showParentPicker = ref(false)
    const showChildPicker = ref(false)

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
    const categoryBudgets = computed(() => usages.value.filter((b) => b.scope === 'category'))

    /**
     * 额度分配情况
     *
     * ★ 分类预算是总预算的子额度 ★
     *   已分配合计 = 所有分类预算的额度之和
     *   未分配额度 = 总预算 - 已分配合计
     *   超出时（已分配合计 > 总预算）红色提示
     */
    const allocation = computed(() => summarizeAllocation(usages.value))

    /**
     * 「分类预算」卡片的副标题
     *
     * 有总预算时说明是从总预算里分出来的；
     * 没总预算时提示先设总预算（但**不阻止**单独设分类预算）。
     */
    const categorySubTitle = computed(() => {
      if (!allocation.value.hasTotal) return '建议先设置总预算，分类额度从中分配'
      return '额度从总预算里分配'
    })

    /** 已被设过预算的分类 id 集合 */
    const budgetedIds = computed(() => new Set(categoryBudgets.value.map((b) => b.categoryId)))

    /**
     * 某个分类 id 是否「还能选」。
     * 已设过预算的不让再选；但当前正在编辑的那条要能选回自己。
     */
    function isCategorySelectable(id) {
      if (!id) return false
      if (!budgetedIds.value.has(id)) return true
      return editingCatId.value === id
    }

    /**
     * 一级分类（可设预算的父分类）。
     *
     * ★ 父分类「整棵」是否可动 ★
     *   父分类本身没被设过预算（或正在编辑它自己）才出现；
     *   若已被「全部二级分类」占用（= 父分类已设预算），
     *   它下面所有二级都已纳入，不能再单独设 —— 整棵排除。
     *   否则会重复统计。
     */
    const parentOptions = computed(() =>
      categories.value
        .filter((c) => c.isParent && c.type === 'expense')
        .filter((p) => isCategorySelectable(p.id))
    )

    const parentActions = computed(() =>
      parentOptions.value.map((p) => ({ name: p.name, value: p.id }))
    )

    /**
     * 二级分类选项：基于当前选中的一级分类。
     * 首项固定为「全部二级分类」（value='__all__'，预算落在父分类上，
     * 统计层会自动聚合它下面所有二级的支出）。
     */
    const childOptions = computed(() => {
      const p = editorParentId.value
      if (!p) return []
      const list = []
      const kids = categories.value.filter((c) => c.parent_id === p)
      // 「全部二级分类」只在该父分类下没有任何「已设预算的子分类」时提供，
      // 否则会和那些子分类的额度重复统计。
      const hasBudgetedChild = kids.some(
        (k) => budgetedIds.value.has(k.id) && k.id !== editingCatId.value
      )
      if (isCategorySelectable(p) && !hasBudgetedChild) {
        list.push({ name: '全部二级分类', value: '__all__' })
      }
      for (const k of kids) {
        if (isCategorySelectable(k.id)) list.push({ name: k.name, value: k.id })
      }
      return list
    })

    const childActions = computed(() => childOptions.value)

    function parentName(id) {
      const c = categories.value.find((x) => x.id === id)
      return c ? c.name : ''
    }

    /** 二级下拉的展示文字 */
    const childLabel = computed(() => {
      if (!editorParentId.value) return '先选择一级分类'
      if (editorChildId.value === '__all__') return '全部二级分类'
      if (editorChildId.value) return parentName(editorChildId.value)
      return '选择二级分类'
    })

    const childIsPlaceholder = computed(
      () => !editorParentId.value || editorChildId.value === ''
    )

    const editorTitle = computed(() => {
      if (editorMode.value === 'total') return '设置总预算'
      const cat = categories.value.find((c) => c.id === editorCategoryId.value)
      return cat ? `${cat.name} 预算` : '设置分类预算'
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
      editorCategoryId.value = ''
      editorParentId.value = ''
      editorChildId.value = ''
      editingCatId.value = ''
      editorAmount.value = totalBudget.value
        ? String(totalBudget.value.limit / 100)
        : ''
      showEditor.value = true
    }

    function editCategoryBudget(b) {
      editorMode.value = 'category'
      editorBudgetId.value = b.id
      editingCatId.value = b.categoryId
      const cat = categories.value.find((c) => c.id === b.categoryId)
      if (cat && cat.isParent) {
        // 「全部二级分类」：预算落在父分类上
        editorParentId.value = b.categoryId
        editorChildId.value = '__all__'
      } else {
        editorParentId.value = cat ? cat.parent_id : ''
        editorChildId.value = b.categoryId
      }
      editorCategoryId.value = b.categoryId
      editorAmount.value = String(b.limit / 100)
      showEditor.value = true
    }

    /**
     * 关闭编辑弹层
     *
     * ★ 这里要把右滑收起来 ★
     *   用户从右滑进到编辑弹层，弹层关掉后那一行不该还挂着操作区。
     */
    function closeEditor() {
      showEditor.value = false
      editingCatId.value = ''
      closeAllSwipes()
    }

    /**
     * 「+ 添加」：直接打开编辑器（不再先弹一次分类选择）。
     * 分类改在编辑器里的两级下拉里选。
     */
    function openCategoryPicker() {
      if (parentOptions.value.length === 0) {
        uni.showToast({ title: '没有可设置的分类了', icon: 'none' })
        return
      }
      editorMode.value = 'category'
      editorBudgetId.value = ''
      editingCatId.value = ''
      editorParentId.value = ''
      editorChildId.value = ''
      editorCategoryId.value = ''
      editorAmount.value = ''
      showEditor.value = true
    }

    /** 点整行 -> 预算详情页 */
    function goBudgetDetail(b) {
      uni.navigateTo({ url: `/pages/settings/budget-detail?id=${b.id}` })
    }

    function openParentPicker() {
      if (parentOptions.value.length === 0) {
        uni.showToast({ title: '没有可设置的分类了', icon: 'none' })
        return
      }
      showParentPicker.value = true
    }

    function openChildPicker() {
      if (!editorParentId.value) return
      if (childOptions.value.length === 0) {
        uni.showToast({ title: '该一级分类下没有可选分类', icon: 'none' })
        return
      }
      showChildPicker.value = true
    }

    function onParentSelect({ index }) {
      const p = parentOptions.value[index]
      if (!p) return
      editorParentId.value = p.id
      editorChildId.value = ''
      editorCategoryId.value = ''
    }

    function onChildSelect({ index }) {
      const c = childOptions.value[index]
      if (!c) return
      editorChildId.value = c.value
      editorCategoryId.value = c.value === '__all__' ? editorParentId.value : c.value
    }

    /**
     * 保存预算
     *
     * ★ 分类预算超额时只提示、不硬拦 ★
     *   分类预算是总预算的子额度，分配加起来超过总预算时
     *   应该提醒用户（「已分配合计会超出总预算」），
     *   但**不能直接拒绝保存** ——
     *   用户可能有自己的理由（先按旧额度设好，之后再调总预算）。
     *   所以弹窗问一句，用户确认就照样保存。
     */
    async function saveBudget() {
      const cents = yuanToCents(editorAmount.value)
      if (!(cents > 0)) {
        uni.showToast({ title: '请填写预算金额', icon: 'none' })
        return
      }
      if (editorMode.value === 'category' && !editorCategoryId.value) {
        uni.showToast({ title: '请选择分类', icon: 'none' })
        return
      }

      // 分类预算：检查会不会超出总预算
      if (editorMode.value === 'category') {
        const check = checkCategoryAllocation(
          usages.value,
          cents,
          editorBudgetId.value || undefined
        )
        if (check.wouldOver) {
          const ok = await confirmDialog({
            title: '分类预算会超出总预算',
            content:
              `总预算 ¥${(check.totalLimit / 100).toFixed(0)}，` +
              `已分配 ¥${(check.allocated / 100).toFixed(0)}，` +
              `这次再分配 ¥${(cents / 100).toFixed(0)}，` +
              `合计会超出 ¥${(check.overflow / 100).toFixed(0)}。\n` +
              '仍要保存吗？',
            confirmText: '仍要保存',
            cancelText: '回去改'
          })
          closeAllSwipes()
          if (!ok) return
        }
      }

      try {
        if (editorBudgetId.value) {
          // 编辑时分类也可能改（比如从「某个二级」改成「全部二级分类」），
          // 改了就直接删旧建新（updateBudget 不负责改 category_id）。
          if (editorMode.value === 'category' && editingCatId.value && editingCatId.value !== editorCategoryId.value) {
            await deleteBudget(editorBudgetId.value)
            await createBudget({
              scope: 'category',
              category_id: editorCategoryId.value,
              amount_cents: cents,
              period: 'month',
              start_month: toMonthKey()
            })
          } else {
            await updateBudget(editorBudgetId.value, { amount_cents: cents })
          }
        } else {
          await createBudget({
            scope: editorMode.value,
            category_id: editorMode.value === 'category' ? editorCategoryId.value : null,
            amount_cents: cents,
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
     * ★ 为什么总预算也要能删 ★
     *   之前只有「设置/修改」，没有删除。
     *   用户设错了一次就再也回不到「未设置」状态，
     *   只能把金额改成一个很大的数来假装没有 —— 这显然不合理。
     *
     * 总预算和分类预算都支持（editorBudgetId 指向当前编辑的那条）。
     */
    async function onDeleteFromEditor() {
      const id = editorBudgetId.value
      if (!id) return

      const isTotal = editorMode.value === 'total'
      const ok = await confirmDialog({
        title: isTotal ? '删除总预算？' : '删除这个分类预算？',
        content: isTotal
          ? '删除后本月不再有总支出上限。已产生的交易不受影响。'
          : '删除后这个分类不再单独限额。已产生的交易不受影响。',
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
      usages, categories, showEditor, editorMode, editorCategoryId, editorAmount,
      editorBudgetId, editorParentId, editorChildId,
      showParentPicker, showChildPicker, primaryColor, pageStyle, swipeStates,
      totalBudget, categoryBudgets, allocation, categorySubTitle,
      parentOptions, parentActions, childOptions, childActions,
      parentName, childLabel, childIsPlaceholder, editorTitle,
      load, editTotalBudget, editCategoryBudget, openCategoryPicker,
      goBudgetDetail, openParentPicker, openChildPicker,
      onParentSelect, onChildSelect, saveBudget, removeBudget,
      onDeleteFromEditor,
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

.usage-tip {
  font-size: 22rpx;
  color: var(--app-text-3);
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

/* 分类预算 */
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

/* 分类名前的小圆点：表示这是总预算下的一个子项 */
.cat-budget-title {
  display: flex;
  align-items: center;
  gap: 12rpx;
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

/* 两级下拉行（一级分类 / 二级分类） */
.picker-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 72rpx;
  padding: 0 24rpx;
  border-radius: 16rpx;
  background-color: var(--app-card-2);
}

.picker-row.disabled {
  opacity: 0.45;
}

.picker-value {
  font-size: 28rpx;
  color: var(--app-text);
}

.picker-value.placeholder {
  color: var(--app-text-3);
}

.picker-arrow {
  font-size: 24rpx;
  color: var(--app-text-3);
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
