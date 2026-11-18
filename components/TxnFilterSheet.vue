<template>
  <!--
    交易筛选面板（全部交易页 / 统计页共用）

    ★ 为什么从 pages/txn/list.vue 抽出来 ★
      统计页要新增「更多筛选」，用户明确要求复用全部交易页的筛选面板。
      继续把模板留在 list.vue 里，统计页只能复制一份，
      两边字段、分类展开规则、标签多选语义很快就会长歪。
      抽成组件后，两页传同一份 filter 对象、用同一个 buildTxnFilterQuery，
      筛选口径天然一致。

    ★ showType ★
      每个统计面板已经有自己的「支出 / 收入」切换，
      统计页再叠一层全局类型会互相打架，所以那边隐藏类型行；
      全部交易页保持原来的四段类型切换。
  -->
  <view>
    <wd-popup
      v-model="visible"
      :position="position"
      :z-index="zIndex"
      :custom-style="popupStyle"
    >
      <view class="filter-panel" :class="{ 'filter-panel--bottom': position === 'bottom' }">
        <!-- 状态栏占位：右侧全高面板才需要；下弹层不需要 -->
        <view
          v-if="position !== 'bottom'"
          class="filter-status-bar"
          :style="{ height: statusBarHeight + 'px' }"
        />

        <view class="filter-head">
          <text class="filter-title">筛选</text>
          <text class="filter-reset" @click="resetFilter">重置</text>
        </view>

        <scroll-view class="filter-body" scroll-y>
          <!-- 类型：只有 4 个选项，做成一行分段控件 -->
          <view v-if="showType" class="filter-section">
            <text class="filter-label">类型</text>
            <view class="seg">
              <view
                v-for="t in typeOptions"
                :key="t.key"
                class="seg-item"
                :class="{ active: draft.type === t.key }"
                :style="{ backgroundColor: draft.type === t.key ? primaryColor : 'transparent' }"
                @click="onTypeChange(t.key)"
              >
                <text
                  class="seg-text"
                  :style="{ color: draft.type === t.key ? '#ffffff' : 'var(--app-text-2)' }"
                >{{ t.name }}</text>
              </view>
            </view>
          </view>

          <!-- 账户 -->
          <view class="filter-section">
            <view class="filter-row" @click="showAccountPicker = true">
              <text class="filter-row-label">账户</text>
              <view class="filter-row-right">
                <text class="filter-row-value" :class="{ placeholder: !draft.accountId }">
                  {{ accountLabel }}
                </text>
                <text class="filter-row-arrow">›</text>
              </view>
            </view>
          </view>

          <!-- 分类（多选；统计页不显示） -->
          <view v-if="showCategory" class="filter-section">
            <view class="filter-row" @click="openMultiCatPicker">
              <text class="filter-row-label">分类</text>
              <view class="filter-row-right">
                <text class="filter-row-value" :class="{ placeholder: draft.categoryIds.length === 0 }">
                  {{ multiCatLabel }}
                </text>
                <text class="filter-row-arrow">›</text>
              </view>
            </view>
          </view>

          <!-- 标签（多选） -->
          <view class="filter-section">
            <view class="filter-row" @click="showTagFilter = true">
              <text class="filter-row-label">标签</text>
              <view class="filter-row-right">
                <text class="filter-row-value" :class="{ placeholder: draft.tagIds.length === 0 }">
                  {{ tagLabel }}
                </text>
                <text class="filter-row-arrow">›</text>
              </view>
            </view>
          </view>

          <!-- 周期（统计页不显示） -->
          <view v-if="showCycle" class="filter-section">
            <view class="filter-row" @click="openCyclePicker">
              <text class="filter-row-label">周期</text>
              <view class="filter-row-right">
                <text class="filter-row-value" :class="{ placeholder: !draft.cycleId }">
                  {{ cycleFilterLabel }}
                </text>
                <text class="filter-row-arrow">›</text>
              </view>
            </view>
          </view>

          <!-- 关键词（统计页不显示） -->
          <view v-if="showKeyword" class="filter-section">
            <text class="filter-label">关键词</text>
            <input
              v-model="draft.keyword"
              class="filter-input"
              placeholder="搜索备注"
              placeholder-class="filter-placeholder"
            />
          </view>

          <!-- 金额区间（统计页不显示） -->
          <view v-if="showAmount" class="filter-section">
            <text class="filter-label">金额区间（元）</text>
            <view class="range-row">
              <input
                v-model="draft.minYuan"
                class="range-input"
                type="digit"
                placeholder="最小"
                placeholder-class="filter-placeholder"
              />
              <text class="range-sep">—</text>
              <input
                v-model="draft.maxYuan"
                class="range-input"
                type="digit"
                placeholder="最大"
                placeholder-class="filter-placeholder"
              />
            </view>
          </view>
        </scroll-view>

        <view class="filter-actions">
          <!-- 自绘按钮：wd-button 的主题色不跟 --app-primary 走 -->
          <view class="filter-apply" :style="{ backgroundColor: primaryColor }" @click="applyFilter">
            <text class="filter-apply-text">应用筛选</text>
          </view>
        </view>
      </view>
    </wd-popup>

    <!-- 账户选择 -->
    <AccountPickerSheet
      v-model="showAccountPicker"
      :accounts="accountList"
      :selected-id="draft.accountId"
      title="选择账户"
      allow-all
      all-label="全部账户"
      :z-index="childZIndex"
      @picked="onAccountPicked"
    />

    <!-- 周期选择 -->
    <wd-action-sheet
      v-model="showPicker"
      title="选择周期"
      :actions="pickerActions"
      :z-index="childZIndex"
      cancel-text="取消"
      @select="onCyclePicked"
    />

    <!-- 标签筛选：复用全局标签面板，顺序也与标签管理页一致 -->
    <TxnTagSheet
      v-model="showTagFilter"
      :tags="tags"
      :selected-ids="draft.tagIds"
      title="选择标签"
      hint="可以选多个，命中任意一个标签的流水都会显示"
      @picked="onTagFilterPicked"
    />

    <!-- 分类多选 -->
    <CategoryMultiPickerSheet
      v-model="showMultiCat"
      :categories="multiCatSource"
      :selected-ids="draft.categoryIds"
      title="选择分类"
      :show-type-tabs="showCategory && draft.type === 'all'"
      :z-index="childZIndex"
      @picked="onMultiCatConfirm"
    />
  </view>
</template>

<script>
import { ref, reactive, computed, watch, onUnmounted } from 'vue'
import AccountPickerSheet from '@/components/AccountPickerSheet.vue'
import CategoryMultiPickerSheet from '@/components/CategoryMultiPickerSheet.vue'
import TxnTagSheet from '@/components/TxnTagSheet.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { listCategories } from '@/api/category.js'
import { listTags } from '@/api/tag.js'
import { listCycles, recurrenceLabel } from '@/api/cycle.js'
import { createEmptyTxnFilter } from '@/utils/txnFilter.js'
import { pushLayer } from '@/utils/layerStack.js'

export default {
  name: 'TxnFilterSheet',
  components: { AccountPickerSheet, CategoryMultiPickerSheet, TxnTagSheet },
  props: {
    modelValue: { type: Boolean, default: false },
    /** 已生效的筛选条件；打开时拷一份到 draft，改完点应用才提交 */
    filter: { type: Object, default: () => createEmptyTxnFilter() },
    /** 是否显示类型分段（统计页隐藏） */
    showType: { type: Boolean, default: true },
    /** 下列开关用于统计页精简成「账户 + 标签」 */
    showCategory: { type: Boolean, default: true },
    showCycle: { type: Boolean, default: true },
    showKeyword: { type: Boolean, default: true },
    showAmount: { type: Boolean, default: true },
    /** right = 右侧全高；bottom = 下弹层（统计页用） */
    position: { type: String, default: 'right' },
    /** 外层弹层层级（统计页有 z-index 300 的底栏，需要传更高值） */
    zIndex: { type: Number, default: 100 }
  },
  emits: ['update:modelValue', 'apply'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20
    const primaryColor = computed(() => settingStore.primaryColor)
    const childZIndex = computed(() => Number(props.zIndex) + 20)

    /**
     * 弹层形态
     *   right  —— 全部交易页：78vw 全高侧滑面板
     *   bottom —— 统计页：底部弹出，圆角 + 自适应高度，更轻盈
     */
    const popupStyle = computed(() => (
      props.position === 'bottom'
        ? 'width: 100%; background-color: var(--app-bg); border-radius: 28rpx 28rpx 0 0;'
        : 'width: 78vw; height: 100vh; background-color: var(--app-bg);'
    ))

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    /*
     * 登记进弹层层栈：侧滑返回 / 返回键先收起筛选面板，
     * 而不是直接退出页面或退出统计 tab。
     */
    let unregisterLayer = null
    watch(visible, (open) => {
      if (open) {
        if (!unregisterLayer) {
          unregisterLayer = pushLayer(() => { visible.value = false }, 'txnFilterSheet')
        }
        return
      }
      if (unregisterLayer) {
        unregisterLayer()
        unregisterLayer = null
      }
    })

    onUnmounted(() => {
      if (unregisterLayer) {
        unregisterLayer()
        unregisterLayer = null
      }
    })

    const draft = reactive(createEmptyTxnFilter())
    const allCategories = ref([])
    const tags = ref([])
    const cycles = ref([])

    const showAccountPicker = ref(false)
    const showTagFilter = ref(false)
    const showMultiCat = ref(false)
    const showPicker = ref(false)

    const typeOptions = [
      { key: 'all', name: '全部' },
      { key: 'expense', name: '支出' },
      { key: 'income', name: '收入' },
      { key: 'transfer', name: '转账' }
    ]

    /** 可选账户：组合账户是虚拟账户，没有自己的流水，不能用来筛选 */
    const accountList = computed(() =>
      accountStore.list.filter((a) => !a.isCombo)
    )

    /**
     * 分类选项跟着类型走
     * 支出 → 只列支出分类；收入 → 只列收入分类；转账 → 没有分类。
     */
    const pickerCategories = computed(() => {
      const type = draft.type
      if (type === 'transfer') return []
      if (type === 'expense') return allCategories.value.filter((c) => c.type === 'expense')
      if (type === 'income') return allCategories.value.filter((c) => c.type === 'income')
      return allCategories.value
    })

    const multiCatSource = computed(() =>
      pickerCategories.value.map((c) => ({
        id: c.id,
        parent_id: c.parent_id || '',
        name: c.name,
        type: c.type,
        isParent: !!c.isParent
      }))
    )

    const accountLabel = computed(() => {
      if (!draft.accountId) return '全部'
      const acc = accountStore.list.find((a) => a.id === draft.accountId)
      return acc ? acc.name : '全部'
    })

    const multiCatLabel = computed(() => {
      const ids = draft.categoryIds || []
      if (ids.length === 0) return '全部'
      if (ids.length === 1) {
        const c = allCategories.value.find((x) => x.id === ids[0])
        return c ? c.name : '全部'
      }
      return `已选中${ids.length}个分类`
    })

    const tagLabel = computed(() => {
      const ids = draft.tagIds || []
      if (ids.length === 0) return '不指定标签'
      if (ids.length === 1) {
        const t = tags.value.find((x) => x.id === ids[0])
        return t ? t.name : '不指定标签'
      }
      const CN = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十']
      return `已选中${ids.length <= 10 ? CN[ids.length] : ids.length}个标签`
    })

    function cycleLabel(c) {
      if (!c) return '周期'
      if (c.type === 'transfer') {
        const from = accountStore.list.find((a) => a.id === c.account_id)
        const to = accountStore.list.find((a) => a.id === c.to_account_id)
        return `${from ? from.name : '账户'} → ${to ? to.name : '账户'}`
      }
      const cat = allCategories.value.find((x) => x.id === c.category_id)
      return cat ? cat.name : '未分类'
    }

    const cycleFilterLabel = computed(() => {
      if (!draft.cycleId) return '不指定周期'
      const c = cycles.value.find((x) => x.id === draft.cycleId)
      if (!c) return '周期'
      return `${cycleLabel(c)} · ${recurrenceLabel(c)}`
    })

    const pickerActions = computed(() => {
      const list = [{ name: '不指定周期', value: '' }]
      for (const c of cycles.value) list.push({ name: cycleLabel(c), value: c.id })
      return list
    })

    /** 打开时把已生效条件拷进 draft，并补齐账户/分类/标签/周期 */
    watch(
      () => props.modelValue,
      async (open) => {
        if (!open) return
        const f = props.filter || {}
        Object.assign(draft, createEmptyTxnFilter(), f)
        draft.categoryIds = Array.isArray(f.categoryIds) ? f.categoryIds.slice() : []
        draft.tagIds = Array.isArray(f.tagIds) ? f.tagIds.slice() : []

        try {
          if (!accountStore.loaded) await accountStore.load()
        } catch (e) {}
        try {
          const [cats, tgs, cys] = await Promise.all([
            listCategories(),
            listTags(),
            listCycles()
          ])
          allCategories.value = cats
          tags.value = tgs
          cycles.value = cys
        } catch (e) {
          console.warn('[filter] 加载筛选选项失败:', e && e.message)
        }
      }
    )

    function onTypeChange(type) {
      draft.type = type
      // 切换类型后，原来勾的分类可能已不在候选里，清掉避免查出空列表
      if ((draft.categoryIds || []).length > 0) {
        const alive = new Set(pickerCategories.value.map((c) => c.id))
        draft.categoryIds = draft.categoryIds.filter((id) => alive.has(id))
      }
    }

    function openMultiCatPicker() {
      if (multiCatSource.value.length === 0) {
        uni.showToast({ title: '没有可选的分类', icon: 'none' })
        return
      }
      showMultiCat.value = true
    }

    function onAccountPicked(acc) {
      draft.accountId = acc && acc.id ? acc.id : ''
    }

    function onTagFilterPicked(ids) {
      draft.tagIds = Array.isArray(ids) ? ids.slice() : []
    }

    function onMultiCatConfirm(ids) {
      // 存用户勾选的原始 id，查询时再展开成「一级 + 二级」
      draft.categoryIds = Array.isArray(ids) ? ids.slice() : []
    }

    function openCyclePicker() {
      showPicker.value = true
    }

    function onCyclePicked(e) {
      const item = e && e.item ? e.item : null
      if (!item) return
      draft.cycleId = item.value || ''
    }

    function resetFilter() {
      Object.assign(draft, createEmptyTxnFilter())
    }

    function applyFilter() {
      const next = {
        ...draft,
        categoryIds: draft.categoryIds.slice(),
        tagIds: draft.tagIds.slice()
      }
      emit('apply', next)
      visible.value = false
    }

    return {
      visible, draft, statusBarHeight, primaryColor, childZIndex, popupStyle,
      typeOptions, accountList, multiCatSource, tags, cycles,
      accountLabel, multiCatLabel, tagLabel, cycleFilterLabel, pickerActions,
      showAccountPicker, showTagFilter, showMultiCat, showPicker,
      onTypeChange, openMultiCatPicker, onAccountPicked, onTagFilterPicked,
      onMultiCatConfirm, openCyclePicker, onCyclePicked, resetFilter, applyFilter
    }
  }
}
</script>

<style scoped>
/* 筛选面板 */
.filter-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 下弹层：不要全屏高度，内容自适应，最多占屏幕 78% */
.filter-panel--bottom {
  height: auto;
  max-height: 78vh;
}

.filter-panel--bottom .filter-head {
  padding-top: 28rpx;
}

.filter-panel--bottom .filter-body {
  max-height: 52vh;
}

.filter-panel--bottom .filter-section {
  margin-bottom: 24rpx;
}

.filter-status-bar {
  flex-shrink: 0;
  width: 100%;
}

.filter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 32rpx 28rpx 20rpx;
}

.filter-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.filter-reset {
  font-size: 26rpx;
  color: var(--app-text-3);
}

.filter-body {
  flex: 1;
  padding: 0 28rpx;
}

.filter-section {
  margin-bottom: 32rpx;
}

.filter-label {
  font-size: 24rpx;
  color: var(--app-text-2);
  display: block;
  margin-bottom: 14rpx;
}

/* 类型分段控件 */
.seg {
  display: flex;
  align-items: center;
  background-color: var(--app-card);
  border-radius: 16rpx;
  padding: 6rpx;
}

.seg-item {
  flex: 1;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12rpx;
}

.seg-text {
  font-size: 26rpx;
}

/* 下拉行：左标签 + 右当前值 + 箭头 */
.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 88rpx;
  padding: 20rpx 24rpx;
  background-color: var(--app-card);
  border-radius: 16rpx;
}

.filter-row.disabled {
  opacity: 0.5;
}

.filter-row-label {
  font-size: 26rpx;
  color: var(--app-text-2);
  flex-shrink: 0;
}

.filter-row-right {
  display: flex;
  align-items: center;
  gap: 8rpx;
  flex: 1;
  min-width: 0;
  justify-content: flex-end;
}

.filter-row-value {
  font-size: 26rpx;
  color: var(--app-text);
  max-width: 380rpx;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.filter-row-value.placeholder {
  color: var(--app-text-3);
}

.filter-row-arrow {
  font-size: 28rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
}

.filter-input {
  background-color: var(--app-card);
  border-radius: 12rpx;
  padding: 18rpx 20rpx;
  font-size: 26rpx;
  color: var(--app-text);
}

.filter-placeholder {
  color: var(--app-text-3);
  font-size: 26rpx;
}

.range-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.range-input {
  flex: 1;
  background-color: var(--app-card);
  border-radius: 12rpx;
  padding: 18rpx 20rpx;
  font-size: 26rpx;
  color: var(--app-text);
  text-align: center;
}

.range-sep {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.filter-actions {
  flex-shrink: 0;
  padding: 20rpx 28rpx calc(env(safe-area-inset-bottom) + 20rpx);
}

.filter-apply {
  width: 100%;
  height: 88rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 1;
  transition: opacity 0.15s;
}

.filter-apply:active {
  opacity: 0.8;
}

.filter-apply-text {
  color: #ffffff;
  font-size: 30rpx;
  font-weight: 500;
}
</style>
