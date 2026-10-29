<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="周期管理" @back="goBack">
      <template #right>
        <view class="nav-add" @click="openCreate">
          <LineIcon name="plus" :size="20" :color="primaryColor" />
        </view>
      </template>
    </PageNav>

    <scroll-view class="page-scroll" scroll-y>
      <view class="hint-card">
        <text class="hint-text">
          周期就是会重复发生的收支，比如房租、订阅、每月工资。
          创建一个周期后，它会按「每天 / 每周 / 每月」的规则提醒你记一笔，
          已记的笔数和流水都能在这里看到。
        </text>
      </view>

      <view v-if="totalCount === 0" class="empty-wrap">
        <EmptyState
          emoji="🔁"
          title="还没有周期"
          desc="添加周期后可以按规则重复记账"
          action-text="新建周期"
          @action="openCreate"
        />
      </view>

      <template v-else>
        <!-- 支出 -->
        <view v-if="groups.expense.length" class="group">
          <text class="group-title">支出</text>
          <view class="group-list">
            <wd-swipe-action
              v-for="c in groups.expense"
              :key="c.id"
              v-model="swipeStates[c.id]"
              class="row-swipe"
            >
              <view class="row" @click="goDetail(c)">
                <view class="row-icon" :style="{ backgroundColor: (c.color || primaryColor) + '22' }">
                  <text class="row-icon-text" :style="{ color: c.color || primaryColor }">{{ c.iconChar }}</text>
                </view>
                <view class="row-info">
                  <text class="row-name">{{ c.name }}</text>
                  <text class="row-sub">{{ c.recurrenceText }}</text>
                </view>
                <text class="row-count">{{ c.count }} 笔</text>
                <text class="row-arrow">›</text>
              </view>
              <template #right>
                <view class="swipe-edit" :style="{ backgroundColor: primaryColor }" @click.stop="openEdit(c)">
                  <text class="swipe-action-text">编辑</text>
                </view>
                <view class="swipe-delete" style="background-color: var(--app-danger)" @click.stop="onDelete(c)">
                  <text class="swipe-action-text">删除</text>
                </view>
              </template>
            </wd-swipe-action>
          </view>
        </view>

        <!-- 收入 -->
        <view v-if="groups.income.length" class="group">
          <text class="group-title">收入</text>
          <view class="group-list">
            <wd-swipe-action
              v-for="c in groups.income"
              :key="c.id"
              v-model="swipeStates[c.id]"
              class="row-swipe"
            >
              <view class="row" @click="goDetail(c)">
                <view class="row-icon" :style="{ backgroundColor: (c.color || primaryColor) + '22' }">
                  <text class="row-icon-text" :style="{ color: c.color || primaryColor }">{{ c.iconChar }}</text>
                </view>
                <view class="row-info">
                  <text class="row-name">{{ c.name }}</text>
                  <text class="row-sub">{{ c.recurrenceText }}</text>
                </view>
                <text class="row-count">{{ c.count }} 笔</text>
                <text class="row-arrow">›</text>
              </view>
              <template #right>
                <view class="swipe-edit" :style="{ backgroundColor: primaryColor }" @click.stop="openEdit(c)">
                  <text class="swipe-action-text">编辑</text>
                </view>
                <view class="swipe-delete" style="background-color: var(--app-danger)" @click.stop="onDelete(c)">
                  <text class="swipe-action-text">删除</text>
                </view>
              </template>
            </wd-swipe-action>
          </view>
        </view>

        <!-- 转账 -->
        <view v-if="groups.transfer.length" class="group">
          <text class="group-title">转账</text>
          <view class="group-list">
            <wd-swipe-action
              v-for="c in groups.transfer"
              :key="c.id"
              v-model="swipeStates[c.id]"
              class="row-swipe"
            >
              <view class="row" @click="goDetail(c)">
                <view class="row-icon" :style="{ backgroundColor: (c.color || primaryColor) + '22' }">
                  <text class="row-icon-text" :style="{ color: c.color || primaryColor }">{{ c.iconChar }}</text>
                </view>
                <view class="row-info">
                  <text class="row-name">{{ c.name }}</text>
                  <text class="row-sub">{{ c.recurrenceText }}</text>
                </view>
                <text class="row-count">{{ c.count }} 笔</text>
                <text class="row-arrow">›</text>
              </view>
              <template #right>
                <view class="swipe-edit" :style="{ backgroundColor: primaryColor }" @click.stop="openEdit(c)">
                  <text class="swipe-action-text">编辑</text>
                </view>
                <view class="swipe-delete" style="background-color: var(--app-danger)" @click.stop="onDelete(c)">
                  <text class="swipe-action-text">删除</text>
                </view>
              </template>
            </wd-swipe-action>
          </view>
        </view>
      </template>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 创建 / 编辑周期弹层 -->
    <CyclePanel v-model="showPanel" :editing="editingCycle" @saved="onSaved" />

    <!-- 弹窗宿主 -->
    <AppDialog />
  </view>
</template>

<script>
import { ref, reactive, computed, onMounted } from 'vue'
import PageNav from '@/components/PageNav.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppDialog from '@/components/AppDialog.vue'
import LineIcon from '@/components/LineIcon.vue'
import CyclePanel from '@/components/CyclePanel.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { listCycles, deleteCycle, recurrenceLabel, listCycleCounts } from '@/api/cycle.js'
import { listCategories } from '@/api/category.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'

export default {
  components: { PageNav, EmptyState, AppDialog, LineIcon, CyclePanel },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    const cycles = ref([])
    const counts = ref({})
    const categories = ref([])
    const showPanel = ref(false)
    const editingCycle = ref(null)
    const swipeStates = reactive({})

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    /** 周期展示名称 / 图标 / 颜色 */
    function decorate(c) {
      const cat = categories.value.find((x) => x.id === c.category_id)
      let name = '未分类'
      let iconChar = '❔'
      let color = c.color || primaryColor.value

      if (c.type === 'transfer') {
        const from = accountStore.list.find((a) => a.id === c.account_id)
        const to = accountStore.list.find((a) => a.id === c.to_account_id)
        name = `${from ? from.name : '账户'} → ${to ? to.name : '账户'}`
        iconChar = '⇄'
        color = '#7D5FFF'
      } else if (cat) {
        name = cat.name
        iconChar = cat.icon ? iconEmoji(cat.icon) : guessIconByName(cat.name)
        color = cat.color || primaryColor.value
      }

      return {
        ...c,
        name,
        iconChar,
        color,
        recurrenceText: recurrenceLabel(c),
        count: counts.value[c.id] || 0
      }
    }

    const groups = computed(() => {
      const out = { expense: [], income: [], transfer: [] }
      for (const c of cycles.value) {
        if (out[c.type]) out[c.type].push(decorate(c))
      }
      return out
    })

    const totalCount = computed(() => cycles.value.length)

    async function load() {
      const [list, cnt, cats] = await Promise.all([
        listCycles(),
        listCycleCounts(),
        listCategories()
      ])
      cycles.value = list
      counts.value = cnt
      categories.value = cats
    }

    function openCreate() {
      editingCycle.value = null
      showPanel.value = true
    }

    function openEdit(c) {
      editingCycle.value = c
      showPanel.value = true
    }

    function goDetail(c) {
      uni.navigateTo({ url: `/pages/settings/cycle-detail?id=${c.id}` })
    }

    async function onSaved() {
      await load()
    }

    async function onDelete(c) {
      const ok = await confirmDialog({
        title: `删除周期「${c.name}」？`,
        content: '已记的流水会保留，只是不再按这个周期提醒',
        confirmText: '删除',
        danger: true
      })
      if (!ok) return
      try {
        await deleteCycle(c.id)
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
      if (!accountStore.loaded) await accountStore.load()
      await load()
    })

    return {
      settingStore, cycles, groups, totalCount, showPanel, editingCycle, swipeStates,
      primaryColor, pageStyle,
      openCreate, openEdit, goDetail, onDelete, onSaved, goBack
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

.hint-card {
  background-color: var(--app-card);
  border-radius: 16rpx;
  padding: 24rpx;
  margin-top: 16rpx;
}

.hint-text {
  font-size: 23rpx;
  color: var(--app-text-3);
  line-height: 1.7;
}

.empty-wrap {
  background-color: var(--app-card);
  border-radius: 20rpx;
  margin-top: 20rpx;
}

.group {
  margin-top: 24rpx;
}

.group-title {
  font-size: 26rpx;
  color: var(--app-text-3);
  margin-bottom: 12rpx;
  display: block;
}

.group-list {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
}

.row-swipe {
  display: block;
}

.row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx 28rpx;
  border-bottom: 1rpx solid var(--app-line);
  background-color: var(--app-card);
}

.row:last-child {
  border-bottom: none;
}

.row-icon {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.row-icon-text {
  font-size: 30rpx;
  color: inherit;
  font-weight: 500;
}

.row-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.row-name {
  font-size: 28rpx;
  color: var(--app-text);
}

.row-sub {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.row-count {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.row-arrow {
  font-size: 32rpx;
  color: var(--app-text-3);
}

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

.nav-add {
  width: 60rpx;
  height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bottom-space {
  height: calc(env(safe-area-inset-bottom) + 40rpx);
}
</style>
