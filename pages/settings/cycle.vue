<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="周期管理" @back="goBack">
      <template #right>
        <text class="nav-add" @click="openCreate">+</text>
      </template>
    </PageNav>

    <scroll-view class="page-scroll" scroll-y>
      <!-- 本月固定支出合计 -->
      <view class="summary-card">
        <view class="summary-head">
          <text class="summary-title">本月固定支出合计</text>
          <text class="summary-sub">{{ enabledCount }} 项启用中</text>
        </view>
        <MoneyText :cents="monthlyTotalCents" :size="48" :weight="600" color="var(--app-text)" />
        <text class="summary-tip">
          按每月折算（周付 ×4.3，年付 ÷12，自定义按月数折算）
        </text>
      </view>

      <!-- 周期列表（可复用组件） -->
      <CycleList
        :cycles="cycles"
        @item-tap="onSelect"
        @item-toggle="onToggle"
        @item-edit="openEdit"
        @item-delete="onDelete"
      />

      <view class="bottom-space" />
    </scroll-view>

    <!-- 编辑弹层：风格参考 pages/settings/tag.vue -->
    <wd-popup v-model="showEditor" position="bottom" :safe-area-inset-bottom="true">
      <view class="editor">
        <view class="editor-head">
          <text class="editor-cancel" @click="showEditor = false">取消</text>
          <text class="editor-title">{{ editingId ? '编辑周期支出' : '新增周期支出' }}</text>
          <text class="editor-save" @click="onSave">保存</text>
        </view>

        <scroll-view class="editor-body" scroll-y>
          <!-- 名称 -->
          <view class="editor-row">
            <text class="editor-label">名称</text>
            <input
              v-model="form.name"
              class="editor-input"
              placeholder="如 房租 / Netflix / 话费"
              placeholder-class="editor-placeholder"
              :maxlength="20"
            />
          </view>

          <!-- 金额 -->
          <view class="editor-row">
            <text class="editor-label">金额</text>
            <view class="amount-wrap">
              <text class="amount-symbol" :style="{ color: primaryColor }">¥</text>
              <input
                v-model="form.amountYuan"
                class="amount-input"
                type="digit"
                placeholder="0.00"
                placeholder-class="editor-placeholder"
              />
            </view>
          </view>

          <!-- 图标 -->
          <view class="editor-row editor-row-column">
            <text class="editor-label">图标</text>
            <view class="icon-grid">
              <view
                v-for="ic in ICON_CHOICES"
                :key="ic"
                class="icon-cell"
                :class="{ active: form.icon === ic }"
                @click="form.icon = ic"
              >
                <text class="icon-cell-text">{{ ic }}</text>
              </view>
            </view>
          </view>

          <!-- 周期类型 -->
          <view class="editor-row editor-row-column">
            <text class="editor-label">周期类型</text>
            <view class="chip-wrap">
              <view
                v-for="t in CYCLE_TYPES"
                :key="t.key"
                class="chip"
                :class="{ active: form.cycleType === t.key }"
                @click="onCycleTypePick(t.key)"
              >
                <text class="chip-text" :style="{ color: form.cycleType === t.key ? primaryColor : 'var(--app-text-2)' }">
                  {{ t.name }}
                </text>
              </view>
            </view>
          </view>

          <!-- 每月几号 -->
          <view v-if="form.cycleType === 'monthly' || form.cycleType === 'yearly'" class="editor-row">
            <text class="editor-label">每月几号扣</text>
            <picker
              mode="selector"
              :range="dayRange"
              :value="form.dayOfMonth - 1"
              @change="onDayPick"
            >
              <text class="editor-picker">{{ form.dayOfMonth }} 号</text>
            </picker>
          </view>

          <!-- 每年几月 -->
          <view v-if="form.cycleType === 'yearly'" class="editor-row">
            <text class="editor-label">每年几月扣</text>
            <picker
              mode="selector"
              :range="monthRange"
              :value="form.monthOfYear - 1"
              @change="onMonthPick"
            >
              <text class="editor-picker">{{ form.monthOfYear }} 月</text>
            </picker>
          </view>

          <!-- 星期几 -->
          <view v-if="form.cycleType === 'weekly'" class="editor-row">
            <text class="editor-label">星期几扣</text>
            <picker
              mode="selector"
              :range="weekdayRange"
              :value="form.weekday - 1"
              @change="onWeekdayPick"
            >
              <text class="editor-picker">周{{ WEEKDAY_CN[form.weekday] }}</text>
            </picker>
          </view>

          <!-- 自定义间隔 -->
          <view v-if="form.cycleType === 'custom'" class="editor-row">
            <text class="editor-label">间隔几个月</text>
            <picker
              mode="selector"
              :range="intervalRange"
              :value="form.interval - 1"
              @change="onIntervalPick"
            >
              <text class="editor-picker">每 {{ form.interval }} 个月</text>
            </picker>
          </view>

          <!-- 下次扣款日 -->
          <view class="editor-row">
            <text class="editor-label">下次扣款日</text>
            <picker
              mode="date"
              :value="form.nextDate"
              @change="onNextDatePick"
            >
              <text class="editor-picker">{{ form.nextDate || '未设置' }}</text>
            </picker>
          </view>

          <!-- 扣款账户 -->
          <view v-if="accountStore.list.length > 0" class="editor-row">
            <text class="editor-label">扣款账户</text>
            <picker
              mode="selector"
              :range="accountNames"
              :value="accountIndex"
              @change="onAccountPick"
            >
              <text class="editor-picker">{{ currentAccountName }}</text>
            </picker>
          </view>

          <!-- 备注 -->
          <view class="editor-row">
            <text class="editor-label">备注</text>
            <input
              v-model="form.note"
              class="editor-input"
              placeholder="选填"
              placeholder-class="editor-placeholder"
              :maxlength="30"
            />
          </view>

          <!-- 启用 -->
          <view class="editor-row">
            <text class="editor-label">启用</text>
            <switch
              :checked="form.enabled"
              color="#07C160"
              @change="onEnabledChange"
            />
          </view>
        </scroll-view>
      </view>
    </wd-popup>

    <!-- 弹窗宿主：确定框统一用组件库样式 -->
    <AppDialog />
  </view>
</template>

<script>
/**
 * 周期管理 —— 周期性固定支出
 *
 * 房租、订阅、会员费、话费这类「每隔一段时间就要交一次」的钱。
 * 这里只做登记与管理（金额、频率、下次扣款日），
 * 实际记账仍走正常的「新增交易」流程。
 *
 * ★ 页面结构 ★
 *   列表部分抽到 components/CycleList.vue，
 *   这样后面把它套进详情页风格的壳子时可以直接复用。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import PageNav from '@/components/PageNav.vue'
import MoneyText from '@/components/MoneyText.vue'
import CycleList from '@/components/CycleList.vue'
import AppDialog from '@/components/AppDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { getCycles, setCycles, CYCLE_TYPES } from '@/api/settings.js'
import { yuanToCents } from '@/utils/money.js'
import { prefixedId } from '@/utils/id.js'
import { toDayKey, shiftDay, clampDayOfMonth } from '@/utils/date.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'

export default {
  components: { PageNav, MoneyText, CycleList, AppDialog },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()

    /** 可选图标（emoji） */
    const ICON_CHOICES = ['🔁', '🏠', '📺', '📱', '💻', '🎬', '💪', '☕', '🚗', '💡', '🧾', '🎵', '📚', '💳', '🅿️', '🧴']

    /** 星期几中文（1 = 周一 … 7 = 周日） */
    const WEEKDAY_CN = ['', '一', '二', '三', '四', '五', '六', '日']

    const cycles = ref([])
    const showEditor = ref(false)
    const editingId = ref('')

    const form = reactive({
      name: '',
      amountYuan: '',
      icon: '🔁',
      cycleType: 'monthly',
      interval: 1,
      dayOfMonth: 1,
      monthOfYear: 1,
      weekday: 1,
      nextDate: '',
      accountId: '',
      enabled: true,
      note: ''
    })

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    const dayRange = Array.from({ length: 31 }, (_, i) => `${i + 1} 号`)
    const monthRange = Array.from({ length: 12 }, (_, i) => `${i + 1} 月`)
    const weekdayRange = Array.from({ length: 7 }, (_, i) => `周${WEEKDAY_CN[i + 1]}`)
    const intervalRange = Array.from({ length: 24 }, (_, i) => `每 ${i + 1} 个月`)

    const accountNames = computed(() => accountStore.list.map((a) => a.name))
    const accountIndex = computed(() => {
      const i = accountStore.list.findIndex((a) => a.id === form.accountId)
      return i < 0 ? 0 : i
    })
    const currentAccountName = computed(() => {
      const a = accountStore.list.find((x) => x.id === form.accountId)
      return a ? a.name : '未指定'
    })

    /** 启用中的周期数 */
    const enabledCount = computed(() => cycles.value.filter((c) => c.enabled).length)

    /**
     * 本月固定支出合计（按月折算）
     *
     *   每月 → 原值
     *   每周 → × 4.3（一个月约 4.3 周）
     *   每年 → ÷ 12
     *   自定义 → ÷ 间隔月数
     */
    const monthlyTotalCents = computed(() => {
      let total = 0
      for (const c of cycles.value) {
        if (!c.enabled) continue
        const amt = Number(c.amountCents) || 0
        if (c.cycleType === 'weekly') total += amt * 4.3
        else if (c.cycleType === 'yearly') total += amt / 12
        else if (c.cycleType === 'custom') total += amt / Math.max(c.interval || 1, 1)
        else total += amt
      }
      return Math.round(total)
    })

    /* ------------------------------------------------------ 读写 */

    async function load() {
      cycles.value = await getCycles()
    }

    async function persist() {
      const clean = await setCycles(cycles.value)
      cycles.value = clean
    }

    /* ------------------------------------------------------ 编辑 */

    /**
     * 按周期类型推算默认的下次扣款日
     *
     *   monthly —— 本月的这几天（已过就顺延到下个月）
     *   yearly  —— 本年的这个月（已过就顺延到明年）
     *   weekly  —— 下一个指定星期几
     *   custom  —— 同 monthly（按几个月一次，扣款日仍是几号）
     */
    function defaultNextDate(type) {
      const now = new Date()
      const today = toDayKey()

      if (type === 'weekly') {
        const cur = now.getDay() === 0 ? 7 : now.getDay()
        const delta = (form.weekday - cur + 7) % 7
        // 今天正好是目标星期几 —— 就算「今天」（0 天后）
        return shiftDay(today, delta)
      }

      if (type === 'yearly') {
        const m = form.monthOfYear || 1
        const d = clampDayOfMonth(now.getFullYear(), m, form.dayOfMonth)
        const candidate = `${now.getFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        if (candidate >= today) return candidate
        // 今年已过 -> 明年
        const y2 = now.getFullYear() + 1
        const d2 = clampDayOfMonth(y2, m, form.dayOfMonth)
        return `${y2}-${String(m).padStart(2, '0')}-${String(d2).padStart(2, '0')}`
      }

      // monthly / custom
      const m = now.getMonth() + 1
      const d = clampDayOfMonth(now.getFullYear(), m, form.dayOfMonth)
      const candidate = `${now.getFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      if (candidate >= today) return candidate
      // 本月已过 -> 下个月
      const m2 = m === 12 ? 1 : m + 1
      const y2 = m === 12 ? now.getFullYear() + 1 : now.getFullYear()
      const d2 = clampDayOfMonth(y2, m2, form.dayOfMonth)
      return `${y2}-${String(m2).padStart(2, '0')}-${String(d2).padStart(2, '0')}`
    }

    function openCreate() {
      editingId.value = ''
      Object.assign(form, {
        name: '',
        amountYuan: '',
        icon: '🔁',
        cycleType: 'monthly',
        interval: 1,
        dayOfMonth: 1,
        monthOfYear: 1,
        weekday: 1,
        nextDate: defaultNextDate('monthly'),
        accountId: settingStore.settings.defaultAccountId || '',
        enabled: true,
        note: ''
      })
      showEditor.value = true
    }

    function openEdit(c) {
      editingId.value = c.id
      Object.assign(form, {
        name: c.name,
        amountYuan: c.amountCents ? String(c.amountCents / 100) : '',
        icon: c.icon || '🔁',
        cycleType: c.cycleType || 'monthly',
        interval: c.interval || 1,
        dayOfMonth: c.dayOfMonth || 1,
        monthOfYear: c.monthOfYear || 1,
        weekday: c.weekday || 1,
        nextDate: c.nextDate || '',
        accountId: c.accountId || '',
        enabled: c.enabled !== false,
        note: c.note || ''
      })
      showEditor.value = true
    }

    async function onSave() {
      if (!form.name.trim()) {
        uni.showToast({ title: '请填写名称', icon: 'none' })
        return
      }
      const amountCents = yuanToCents(form.amountYuan)
      if (!(amountCents > 0)) {
        uni.showToast({ title: '请填写金额', icon: 'none' })
        return
      }

      const item = {
        id: editingId.value || prefixedId('cyc'),
        name: form.name.trim(),
        amountCents,
        icon: form.icon,
        cycleType: form.cycleType,
        interval: form.interval,
        dayOfMonth: form.dayOfMonth,
        monthOfYear: form.monthOfYear,
        weekday: form.weekday,
        nextDate: form.nextDate,
        accountId: form.accountId,
        enabled: form.enabled,
        note: form.note.trim()
      }

      try {
        if (editingId.value) {
          const i = cycles.value.findIndex((c) => c.id === editingId.value)
          if (i >= 0) cycles.value[i] = item
        } else {
          cycles.value = cycles.value.concat([item])
        }
        await persist()
        showEditor.value = false
        uni.showToast({ title: '已保存', icon: 'success' })
      } catch (e) {
        await alertDialog({ title: '保存失败', content: e.message })
      }
    }

    async function onToggle(c) {
      const i = cycles.value.findIndex((x) => x.id === c.id)
      if (i < 0) return
      cycles.value[i] = { ...cycles.value[i], enabled: !cycles.value[i].enabled }
      await persist()
    }

    /**
     * 点整行 -> 周期详情页
     *
     * ★ 为什么整行不再直接进编辑弹层 ★
     *   周期也走统一的「详情页」结构（汇总卡 + 本月收支 + 最近流水），
     *   点条目进详情页可以看这个周期的金额、下次扣款日和历史支出。
     *   编辑仍然保留在每一行右侧的「编辑」按钮上（以及停用/删除），
     *   所以原来的编辑能力没有丢，只是不再和「看详情」抢同一个点击。
     */
    function onSelect(c) {
      uni.navigateTo({ url: `/pages/settings/cycle-detail?id=${c.id}` })
    }

    async function onDelete(c) {
      const ok = await confirmDialog({
        title: `删除「${c.name}」？`,
        content: '只是删除这条周期支出登记，已产生的交易不受影响',
        confirmText: '删除',
        danger: true
      })
      if (!ok) return
      try {
        cycles.value = cycles.value.filter((x) => x.id !== c.id)
        await persist()
        uni.showToast({ title: '已删除', icon: 'success' })
      } catch (e) {
        await alertDialog({ title: '删除失败', content: e.message })
      }
    }

    /* ------------------------------------------------------ 选择器 */

    /**
     * 换周期类型：下次扣款日要按新类型重算
     */
    function onCycleTypePick(key) {
      if (form.cycleType === key) return
      form.cycleType = key
      form.nextDate = defaultNextDate(key)
    }

    function onDayPick(e) {
      form.dayOfMonth = Number(e.detail.value) + 1
      if (form.cycleType === 'monthly' || form.cycleType === 'custom' || form.cycleType === 'yearly') {
        form.nextDate = defaultNextDate(form.cycleType)
      }
    }

    function onMonthPick(e) {
      form.monthOfYear = Number(e.detail.value) + 1
      if (form.cycleType === 'yearly') {
        form.nextDate = defaultNextDate('yearly')
      }
    }

    function onWeekdayPick(e) {
      form.weekday = Number(e.detail.value) + 1
      if (form.cycleType === 'weekly') {
        form.nextDate = defaultNextDate('weekly')
      }
    }

    function onIntervalPick(e) {
      form.interval = Number(e.detail.value) + 1
    }

    function onNextDatePick(e) {
      form.nextDate = e.detail.value
    }

    function onAccountPick(e) {
      const i = Number(e.detail.value)
      const a = accountStore.list[i]
      form.accountId = a ? a.id : ''
    }

    function onEnabledChange(e) {
      form.enabled = !!e.detail.value
    }

    function goBack() {
      uni.navigateBack()
    }

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await accountStore.load()
      await load()
    })

    return {
      settingStore, accountStore, cycles, showEditor, editingId, form,
      primaryColor, pageStyle,
      ICON_CHOICES, CYCLE_TYPES, WEEKDAY_CN,
      dayRange, monthRange, weekdayRange, intervalRange,
      accountNames, accountIndex, currentAccountName,
      enabledCount, monthlyTotalCents,
      openCreate, openEdit, onSave, onToggle, onSelect, onDelete,
      onDayPick, onMonthPick, onWeekdayPick, onIntervalPick, onNextDatePick,
      onCycleTypePick, onAccountPick, onEnabledChange, goBack
    }
  }
}
</script>

<style scoped>
.nav-add {
  font-size: 44rpx;
  color: var(--app-primary);
  line-height: 1;
  font-weight: 300;
}

.page-scroll {
  padding: 0 32rpx;
}

/* 汇总卡 */
.summary-card {
  background: linear-gradient(135deg, var(--app-primary-light), var(--app-card));
  border-radius: 24rpx;
  padding: 32rpx;
  margin-top: 16rpx;
  box-shadow: var(--app-shadow);
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.summary-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.summary-title {
  font-size: 26rpx;
  color: var(--app-text-2);
}

.summary-sub {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.summary-tip {
  font-size: 21rpx;
  color: var(--app-text-3);
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
  max-height: 60vh;
  padding: 8rpx 28rpx 24rpx;
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

.editor-input {
  flex: 1;
  text-align: right;
  font-size: 28rpx;
  color: var(--app-text);
}

.editor-placeholder {
  font-size: 28rpx;
  color: var(--app-text-3);
}

.editor-picker {
  font-size: 28rpx;
  color: var(--app-text-2);
}

/* 金额 */
.amount-wrap {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 8rpx;
  justify-content: flex-end;
}

.amount-symbol {
  font-size: 32rpx;
  font-weight: 500;
}

.amount-input {
  font-size: 36rpx;
  font-weight: 600;
  color: var(--app-text);
  text-align: right;
  flex: 1;
}

/* 图标 */
.icon-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.icon-cell {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background-color: var(--app-card-2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-cell.active {
  background-color: var(--app-primary-light);
  outline: 2rpx solid var(--app-primary);
  outline-offset: 2rpx;
}

.icon-cell-text {
  font-size: 32rpx;
}

/* chip */
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
