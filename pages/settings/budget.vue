<template>
  <view class="app-page" :style="pageStyle">
    <PageNav title="预算管理" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
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
          <text class="usage-tip">
            {{ totalBudget.over
              ? `已超支 ¥${((totalBudget.used - totalBudget.limit) / 100).toFixed(2)}`
              : `剩余 ¥${(totalBudget.remaining / 100).toFixed(2)}，日均可用 ¥${(totalBudget.dailyAvailable / 100).toFixed(0)}` }}
          </text>
        </view>

        <view v-else class="empty-hint" @click="editTotalBudget">
          <text class="empty-hint-text">未设置总预算，点击设置</text>
        </view>
      </view>

      <!-- 分类预算 -->
      <view class="card">
        <view class="card-head">
          <view class="card-title-row">
            <text class="card-title">分类预算</text>
            <text class="card-sub">对特定分类单独限额</text>
          </view>
          <text class="card-action" @click="openCategoryPicker">+ 添加</text>
        </view>

        <view v-if="categoryBudgets.length === 0" class="empty-hint" @click="openCategoryPicker">
          <text class="empty-hint-text">还没有分类预算，点击添加</text>
        </view>

        <view v-else class="cat-budget-list">
          <view v-for="b in categoryBudgets" :key="b.id" class="cat-budget">
            <view class="cat-budget-head">
              <text class="cat-budget-name">{{ b.name }}</text>
              <view class="cat-budget-ops">
                <text class="cat-budget-edit" @click="editCategoryBudget(b)">修改</text>
                <text class="cat-budget-del" @click="removeBudget(b)">删除</text>
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
          </view>
        </view>
      </view>

      <view class="tip-card">
        <text class="tip-text">
          预算按自然月计算。分类预算与总预算相互独立，
          总预算已设置时，分类预算的额度不占用总预算。
        </text>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 金额编辑弹层 -->
    <wd-popup v-model="showEditor" position="bottom" :safe-area-inset-bottom="true">
      <view class="editor">
        <view class="editor-head">
          <text class="editor-cancel" @click="showEditor = false">取消</text>
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
            <view class="chip-wrap">
              <view
                v-for="c in availableCategories"
                :key="c.id"
                class="chip"
                :class="{ active: editorCategoryId === c.id }"
                @click="editorCategoryId = c.id"
              >
                <text
                  class="chip-text"
                  :style="{ color: editorCategoryId === c.id ? primaryColor : 'var(--app-text-2)' }"
                >{{ c.name }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </wd-popup>

    <!-- 分类选择 -->
    <wd-action-sheet
      v-model="showCatPicker"
      :actions="categoryActions"
      title="选择要设预算的分类"
      cancel-text="取消"
      @select="onCategorySelect"
    />
  </view>
</template>

<script>
import { ref, reactive, computed, onMounted } from 'vue'
import PageNav from '@/components/PageNav.vue'
import MoneyText from '@/components/MoneyText.vue'
import { useSettingStore } from '@/stores/setting.js'
import { getBudgetUsage } from '@/api/stats.js'
import { listBudgets, createBudget, updateBudget, deleteBudget } from '@/api/budget.js'
import { listCategories } from '@/api/category.js'
import { yuanToCents } from '@/utils/money.js'
import { toMonthKey } from '@/utils/date.js'

export default {
  components: { PageNav, MoneyText },
  setup() {
    const settingStore = useSettingStore()

    const usages = ref([])
    const categories = ref([])

    const showEditor = ref(false)
    const editorMode = ref('total')       // total | category
    const editorCategoryId = ref('')
    const editorBudgetId = ref('')
    const editorAmount = ref('')
    const showCatPicker = ref(false)

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    const totalBudget = computed(() => usages.value.find((b) => b.scope === 'total') || null)
    const categoryBudgets = computed(() => usages.value.filter((b) => b.scope === 'category'))

    /** 已被设过预算的分类不能再选 */
    const usedCategoryIds = computed(() =>
      categoryBudgets.value.map((b) => b.categoryId)
    )

    const availableCategories = computed(() =>
      categories.value.filter(
        (c) => !c.isParent && c.type === 'expense' && !usedCategoryIds.value.includes(c.id)
      )
    )

    const categoryActions = computed(() =>
      availableCategories.value.map((c) => ({ name: c.name, value: c.id }))
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
      editorAmount.value = totalBudget.value
        ? String(totalBudget.value.limit / 100)
        : ''
      showEditor.value = true
    }

    function editCategoryBudget(b) {
      editorMode.value = 'category'
      editorBudgetId.value = b.id
      editorCategoryId.value = b.categoryId
      editorAmount.value = String(b.limit / 100)
      showEditor.value = true
    }

    function openCategoryPicker() {
      if (availableCategories.value.length === 0) {
        uni.showToast({ title: '没有可设置的分类了', icon: 'none' })
        return
      }
      showCatPicker.value = true
    }

    function onCategorySelect({ index }) {
      const c = availableCategories.value[index]
      if (!c) return
      editorMode.value = 'category'
      editorBudgetId.value = ''
      editorCategoryId.value = c.id
      editorAmount.value = ''
      showCatPicker.value = false
      showEditor.value = true
    }

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

      try {
        if (editorBudgetId.value) {
          await updateBudget(editorBudgetId.value, { amount_cents: cents })
        } else {
          await createBudget({
            scope: editorMode.value,
            category_id: editorMode.value === 'category' ? editorCategoryId.value : null,
            amount_cents: cents,
            period: 'month',
            start_month: toMonthKey()
          })
        }
        showEditor.value = false
        await load()
        uni.showToast({ title: '已保存', icon: 'success' })
      } catch (e) {
        uni.showModal({ title: '保存失败', content: e.message, showCancel: false })
      }
    }

    function removeBudget(b) {
      uni.showModal({
        title: `删除「${b.name}」预算？`,
        content: '只是删除限额，已产生的交易不受影响',
        confirmText: '删除',
        confirmColor: '#ee0a24',
        success: async (res) => {
          if (!res.confirm) return
          try {
            await deleteBudget(b.id)
            await load()
            uni.showToast({ title: '已删除', icon: 'success' })
          } catch (e) {
            uni.showModal({ title: '删除失败', content: e.message, showCancel: false })
          }
        }
      })
    }

    function goBack() {
      uni.navigateBack()
    }

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await load()
    })

    return {
      usages, categories, showEditor, editorMode, editorCategoryId, editorAmount,
      showCatPicker, primaryColor, pageStyle,
      totalBudget, categoryBudgets, availableCategories, categoryActions, editorTitle,
      load, editTotalBudget, editCategoryBudget, openCategoryPicker,
      onCategorySelect, saveBudget, removeBudget, goBack
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
  gap: 28rpx;
}

.cat-budget {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.cat-budget-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cat-budget-name {
  font-size: 27rpx;
  color: var(--app-text);
  font-weight: 500;
}

.cat-budget-ops {
  display: flex;
  gap: 24rpx;
}

.cat-budget-edit {
  font-size: 23rpx;
  color: var(--app-primary);
}

.cat-budget-del {
  font-size: 23rpx;
  color: var(--app-danger);
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

.chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.chip {
  padding: 10rpx 22rpx;
  border-radius: 20rpx;
  background-color: var(--app-card-2);
}

.chip.active {
  background-color: var(--app-primary-light);
}

.chip-text {
  font-size: 24rpx;
}
</style>
