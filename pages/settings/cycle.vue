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
                  <!-- 第一行：分类名 + 价签（金额紧跟在名字后面） -->
                  <view class="row-title">
                    <text class="row-name">{{ c.name }}</text>
                    <MoneyText
                      class="row-amount"
                      :cents="c.amount_cents"
                      :size="26"
                      :weight="600"
                      :color="c.type === 'income' ? 'var(--app-success)' : 'var(--app-text)'"
                    />
                  </view>

                  <!-- 第二行：规则 · 下次于 XX年XX月XX日
                       ★ 两个信息合成一行 ★
                         规则（每月1号）说明「多久扣一次」，
                         日期说明「下次什么时候扣」，是一组问答关系，
                         放同一行读起来连贯，也不占额外高度。 -->
                  <view class="row-meta">
                    <text class="row-sub">{{ c.recurrenceText }}</text>
                    <text v-if="c.nextYmd" class="row-sep">·</text>
                    <text
                      v-if="c.nextYmd"
                      class="row-next"
                      :class="{ 'row-next-today': c.nextIsToday }"
                    >下次于 {{ c.nextYmd }}</text>
                  </view>
                </view>

                <!-- 右侧：只留已记笔数（规则已挪到下方） -->
                <view class="row-right">
                  <text class="row-count">{{ c.count }} 笔</text>
                </view>
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
                  <!-- 第一行：分类名 + 价签（金额紧跟在名字后面） -->
                  <view class="row-title">
                    <text class="row-name">{{ c.name }}</text>
                    <MoneyText
                      class="row-amount"
                      :cents="c.amount_cents"
                      :size="26"
                      :weight="600"
                      :color="c.type === 'income' ? 'var(--app-success)' : 'var(--app-text)'"
                    />
                  </view>

                  <!-- 第二行：规则 · 下次于 XX年XX月XX日
                       ★ 两个信息合成一行 ★
                         规则（每月1号）说明「多久扣一次」，
                         日期说明「下次什么时候扣」，是一组问答关系，
                         放同一行读起来连贯，也不占额外高度。 -->
                  <view class="row-meta">
                    <text class="row-sub">{{ c.recurrenceText }}</text>
                    <text v-if="c.nextYmd" class="row-sep">·</text>
                    <text
                      v-if="c.nextYmd"
                      class="row-next"
                      :class="{ 'row-next-today': c.nextIsToday }"
                    >下次于 {{ c.nextYmd }}</text>
                  </view>
                </view>

                <!-- 右侧：只留已记笔数（规则已挪到下方） -->
                <view class="row-right">
                  <text class="row-count">{{ c.count }} 笔</text>
                </view>
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
                  <!-- 第一行：分类名 + 价签（金额紧跟在名字后面） -->
                  <view class="row-title">
                    <text class="row-name">{{ c.name }}</text>
                    <MoneyText
                      class="row-amount"
                      :cents="c.amount_cents"
                      :size="26"
                      :weight="600"
                      :color="c.type === 'income' ? 'var(--app-success)' : 'var(--app-text)'"
                    />
                  </view>

                  <!-- 第二行：规则 · 下次于 XX年XX月XX日
                       ★ 两个信息合成一行 ★
                         规则（每月1号）说明「多久扣一次」，
                         日期说明「下次什么时候扣」，是一组问答关系，
                         放同一行读起来连贯，也不占额外高度。 -->
                  <view class="row-meta">
                    <text class="row-sub">{{ c.recurrenceText }}</text>
                    <text v-if="c.nextYmd" class="row-sep">·</text>
                    <text
                      v-if="c.nextYmd"
                      class="row-next"
                      :class="{ 'row-next-today': c.nextIsToday }"
                    >下次于 {{ c.nextYmd }}</text>
                  </view>
                </view>

                <!-- 右侧：只留已记笔数（规则已挪到下方） -->
                <view class="row-right">
                  <text class="row-count">{{ c.count }} 笔</text>
                </view>
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
import { ref, reactive, computed, watch, onMounted } from 'vue'
import PageNav from '@/components/PageNav.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppDialog from '@/components/AppDialog.vue'
import LineIcon from '@/components/LineIcon.vue'
import MoneyText from '@/components/MoneyText.vue'
import CyclePanel from '@/components/CyclePanel.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { listCycles, deleteCycle, recurrenceLabel, listCycleCounts, nextOccurrence } from '@/api/cycle.js'
import { listCategories } from '@/api/category.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'
import { toDayKey } from '@/utils/date.js'

export default {
  components: { PageNav, EmptyState, AppDialog, LineIcon, MoneyText, CyclePanel },
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

    /** 周期展示名称 / 图标 / 颜色 / 金额 / 下次扣款日 */
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

      /*
       * ★ 下次触发日 ★
       *   nextOccurrence 返回 YYYY-MM-DD（含今天）。
       *
       * ★ 格式：XX年XX月XX日，不带周几 ★
       *   不用 formatDayHeader —— 那个会输出「今天 · 10月29日 周三」，
       *   既带周几又带相对词，不符合「下次扣款于 XXXX年XX月XX日」的要求。
       *   这里自己拼，年月日三位齐全，看的人不用换算。
       */
      let next = ''
      let nextYmd = ''
      try {
        next = nextOccurrence(c)
        if (next) {
          const [y, m, d] = String(next).split('-').map(Number)
          nextYmd = `${y}年${m}月${d}日`
        }
      } catch (e) {
        next = ''
        nextYmd = ''
      }

      return {
        ...c,
        name,
        iconChar,
        color,
        recurrenceText: recurrenceLabel(c),
        count: counts.value[c.id] || 0,
        next,
        nextYmd,
        // 今天就要扣：列表里高亮一下，比纯文字提示更醒目
        nextIsToday: next === toDayKey()
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

    /**
     * 编辑面板收起（取消/保存/删除）时，把右滑露出的「编辑」按钮也收起。
     * 否则用户关掉弹层后，行还保持着右滑展开状态，很别扭。
     *
     * ★ 值必须是 'close' 而不是 false ★
     *   wd-swipe-action 的 modelValue 是字符串（'left' | 'close' | 'right'），
     *   传 false 会触发「Expected String, got Boolean」的类型警告，而且不生效。
     */
    watch(showPanel, (open) => {
      if (open) return
      const c = editingCycle.value
      if (c && c.id) swipeStates[c.id] = 'close'
    })

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
  gap: 8rpx;
}

/*
 * ★ 第一行：分类名 + 价签 ★
 *   金额紧跟在名字后面（不是推到最右边），
 *   两者之间留 16rpx 间隙，避免「餐饮¥3,200.00」黏在一起。
 *   flex-wrap 允许在极窄屏上换行，宁可换行也不要文字被压扁。
 */
.row-title {
  display: flex;
  align-items: baseline;
  gap: 16rpx;
  min-width: 0;
  flex-wrap: wrap;
}

.row-name {
  font-size: 28rpx;
  color: var(--app-text);
  /* 名字过长时省略，给金额留位置 */
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 价签：不加背景色，纯排版区分；字重比名字轻一档，主次分明 */
.row-amount {
  flex-shrink: 0;
}

/*
 * ★ 第二行：规则 · 下次于 XX年XX月XX日 ★
 *
 * 两个信息合成一行，用「·」分隔：
 *   左半是规则（每月1号 / 每周三 / 每天），说明「多久扣一次」
 *   右半是日期，说明「下次什么时候扣」
 * 它们是一组问答关系，放同一行读起来连贯，也省下一行高度。
 *
 * 用 nowrap 保证不被拆成两行 —— 这一行本来就短，
 * 「每周三 · 下次于 2026年11月4日」最宽也就 20 来个字。
 */
.row-meta {
  display: flex;
  align-items: center;
  gap: 8rpx;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.row-sub {
  font-size: 22rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
}

/* 分隔点：比两侧文字更淡，只起分隔作用，不该抢眼 */
.row-sep {
  font-size: 22rpx;
  color: var(--app-text-3);
  opacity: 0.6;
  flex-shrink: 0;
}

/* 日期：比规则深一档，因为「下次什么时候扣」更被关心 */
.row-next {
  font-size: 22rpx;
  color: var(--app-text-2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/*
 * 今天就该扣的那条：用主题色标出来。
 * 这是列表里最需要被看到的一类信息，纯灰字容易被忽略。
 */
.row-next-today {
  color: var(--app-primary);
  font-weight: 600;
}

/*
 * 右侧：只放已记笔数（规则已挪到下方那一行）。
 * 保持 flex 列布局，将来若再加内容可以直接往下排。
 */
.row-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex-shrink: 0;
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
