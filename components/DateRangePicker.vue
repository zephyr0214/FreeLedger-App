<template>
  <view class="drp" :class="{ 'drp-root-inline': isInline }">
    <!-- ============ inline 模式：年 / 月 / 日 三列平铺 ============ -->
    <view v-if="isInline" class="drp-inline">
      <view class="drp-inline-head">
        <text class="drp-inline-label">{{ label }}</text>
        <text class="drp-inline-hint">年 / 月 / 日</text>
      </view>

      <view class="drp-inline-cols">
        <!-- 年 -->
        <view class="drp-inline-col">
          <text class="drp-inline-title">年</text>
          <scroll-view class="drp-col" scroll-y :scroll-into-view="yearAnchor" scroll-with-animation>
            <view class="drp-col-inner">
              <view
                v-for="it in yearItems"
                :key="'yr-' + it.v"
                :id="anchorId('yr', it.v)"
                class="drp-item"
                :class="{ active: it.v === local.year }"
                @click="pickYear(it.v)"
              >{{ it.label }}</view>
            </view>
          </scroll-view>
        </view>

        <!-- 月 -->
        <view class="drp-inline-col">
          <text class="drp-inline-title">月</text>
          <scroll-view class="drp-col" scroll-y :scroll-into-view="monthAnchor" scroll-with-animation>
            <view class="drp-col-inner">
              <view
                v-for="it in monthItems"
                :key="'mo-' + it.v"
                :id="anchorId('mo', it.v)"
                class="drp-item"
                :class="{ active: it.v === local.month }"
                @click="pickMonth(it.v)"
              >{{ it.label }}</view>
            </view>
          </scroll-view>
        </view>

        <!-- 日 -->
        <view class="drp-inline-col">
          <text class="drp-inline-title">日</text>
          <scroll-view class="drp-col" scroll-y :scroll-into-view="dayAnchor" scroll-with-animation>
            <view class="drp-col-inner">
              <view
                v-for="it in dayItems"
                :key="'dy-' + it.v"
                :id="anchorId('dy', it.v)"
                class="drp-item"
                :class="{ active: it.v === local.day }"
                @click="pickDay(it.v)"
              >{{ it.label }}</view>
            </view>
          </scroll-view>
        </view>
      </view>
    </view>

    <!-- ============ popup 模式：触发按钮 + 底部面板 ============ -->
    <template v-else>
      <!-- 触发按钮 -->
      <view class="drp-trigger" :class="triggerClass" @click="open">
        <text class="drp-value">{{ label }}</text>
        <text class="drp-arrow">▾</text>
      </view>

      <!-- 三级联动面板 -->
      <view v-if="visible" class="drp-mask" @click="close" @touchmove.stop>
        <view class="drp-panel" @click.stop @touchmove.stop>
          <!-- 顶部：当前选择 + 操作 -->
          <view class="drp-head">
            <text class="drp-head-text">{{ label }}</text>
            <text class="drp-head-done" @click="close">完成</text>
          </view>

          <!-- 三列滚轮 -->
          <view class="drp-cols">
            <!-- 年：全部 + 近 6 年 -->
            <scroll-view class="drp-col" scroll-y :scroll-into-view="yearAnchor" scroll-with-animation>
              <view class="drp-col-inner">
                <view
                  v-for="it in yearItems"
                  :key="'yr-' + it.v"
                  :id="anchorId('yr', it.v)"
                  class="drp-item"
                  :class="{ active: it.v === local.year }"
                  @click="pickYear(it.v)"
                >{{ it.label }}</view>
              </view>
            </scroll-view>

            <!-- 月：全部 + 1~12 -->
            <scroll-view class="drp-col" scroll-y :scroll-into-view="monthAnchor" scroll-with-animation>
              <view class="drp-col-inner">
                <view
                  v-for="it in monthItems"
                  :key="'mo-' + it.v"
                  :id="anchorId('mo', it.v)"
                  class="drp-item"
                  :class="{ active: it.v === local.month }"
                  @click="pickMonth(it.v)"
                >{{ it.label }}</view>
              </view>
            </scroll-view>

            <!-- 日：全部 + 当月所有日期（未选到具体月时只有「全部」） -->
            <scroll-view class="drp-col" scroll-y :scroll-into-view="dayAnchor" scroll-with-animation>
              <view class="drp-col-inner">
                <view
                  v-for="it in dayItems"
                  :key="'dy-' + it.v"
                  :id="anchorId('dy', it.v)"
                  class="drp-item"
                  :class="{ active: it.v === local.day }"
                  @click="pickDay(it.v)"
                >{{ it.label }}</view>
              </view>
            </scroll-view>
          </view>
        </view>
      </view>
    </template>
  </view>
</template>

<script>
import { ref, reactive, computed, watch, nextTick } from 'vue'

export default {
  name: 'DateRangePicker',
  props: {
    modelValue: { type: Object, default: null },
    /** 展示风格：compact 普通圆角，pill 胶囊（仅 popup 模式用得上） */
    variant: { type: String, default: 'compact' },
    /** popup = 触发按钮 + 底部弹层；inline = 年/月/日三列平铺常驻 */
    mode: { type: String, default: 'popup' }
  },
  // 注意：事件名不能与原生事件同名（change / confirm / close ... 都在黑名单里）
  emits: ['update:modelValue', 'range-change', 'range-confirm'],
  setup(props, { emit }) {
    const visible = ref(false)

    /** 本地编辑态：0 表示「全部」 */
    const local = reactive({ year: 0, month: 0, day: 0 })

    /** 是否平铺模式 */
    const isInline = computed(() => props.mode === 'inline')

    /* ------------------------------------------------- 层级语义
     * year=0                 → 全部年：不限时间
     * year>0, month=0        → 全部月：整年
     * year>0, month>0, day=0 → 全部日：整月
     * year>0, month>0, day>0 → 具体某天
     */

    /** 当前选中的月有几号（未选到具体年月时为 0） */
    const maxDay = computed(() => {
      const y = local.year
      const m = local.month
      if (!y || !m) return 0
      return new Date(y, m, 0).getDate()
    })

    /** 年列：全部 + 近 6 年到今年 */
    const yearItems = computed(() => {
      const now = new Date().getFullYear()
      const list = [{ v: 0, label: '全部' }]
      for (let y = now; y >= now - 5; y--) list.push({ v: y, label: `${y}年` })
      return list
    })

    /** 月列：全部 + 1~12 */
    const monthItems = computed(() => {
      const list = [{ v: 0, label: '全部' }]
      for (let m = 1; m <= 12; m++) list.push({ v: m, label: `${m}月` })
      return list
    })

    /**
     * 日列
     * 未选到具体年月（year=0 或 month=0）时，跨月/跨年没有「某一天」的意义，
     * 只列出「全部」一项。
     */
    const dayItems = computed(() => {
      const list = [{ v: 0, label: '全部' }]
      const last = maxDay.value
      for (let d = 1; d <= last; d++) list.push({ v: d, label: `${d}日` })
      return list
    })

    /** 显示文案 */
    const label = computed(() => {
      const y = local.year
      const m = local.month
      const d = local.day
      if (!y) return '全部年'
      if (!m) return `${y}年`
      if (!d) return `${y}年${m}月`
      return `${y}年${m}月${d}日`
    })

    /** 触发按钮风格 */
    const triggerClass = computed(() =>
      props.variant === 'pill' ? 'drp-trigger-pill' : 'drp-trigger-compact'
    )

    /* ------------------------------------------------- 滚轮定位 */

    const yearAnchor = ref('')
    const monthAnchor = ref('')
    const dayAnchor = ref('')

    /** 锚点 id：'全部' 用 xxx-all，具体值用 xxx-<n> */
    function anchorId(prefix, v) {
      return v ? `${prefix}-${v}` : `${prefix}-all`
    }

    /**
     * 直接写锚点值（同步）。
     * 首次渲染前调用，让 scroll-view 一上来就定位到选中项。
     */
    function applyAnchors() {
      yearAnchor.value = anchorId('yr', local.year)
      monthAnchor.value = anchorId('mo', local.month)
      dayAnchor.value = anchorId('dy', local.day)
    }

    /**
     * 三列滚到当前选中项。
     *
     * scroll-into-view 只有在值「发生变化」时才会触发，
     * 所以先清空再赋值，保证重复定位同一个位置也能生效。
     */
    function scrollToSelection() {
      yearAnchor.value = ''
      monthAnchor.value = ''
      dayAnchor.value = ''
      nextTick(() => {
        applyAnchors()
      })
    }

    /* ------------------------------------------------- 交互 */

    /** 选年 */
    function pickYear(y) {
      local.year = y
      if (!y) {
        // 全部年 → 月、日都不再有意义
        local.month = 0
        local.day = 0
      } else {
        clampDay()
      }
      afterPick()
    }

    /** 选月 */
    function pickMonth(m) {
      local.month = m
      if (!m) {
        // 全部月（整年）→ 不存在具体某天
        local.day = 0
      } else {
        if (!local.year) {
          // 选到具体月就必须落到某一年，默认取今年
          local.year = new Date().getFullYear()
        }
        clampDay()
      }
      afterPick()
    }

    /** 选日 */
    function pickDay(d) {
      local.day = d
      // 防御：选的号超过当月天数时下调到当月最后一天
      clampDay()
      afterPick()
    }

    /**
     * 选中后的处理
     *   inline 模式：立即同步出去，父组件据此重新查询
     *   popup  模式：只更新本地，等点「完成」再同步
     */
    function afterPick() {
      scrollToSelection()
      if (isInline.value) syncOut(false)
    }

    /** 选中的天超过当月天数时，下调到当月最后一天（不会变成 0） */
    function clampDay() {
      const last = maxDay.value
      if (!last) {
        local.day = 0
        return
      }
      if (local.day > last) local.day = last
    }

    function open() {
      visible.value = true
      scrollToSelection()
    }

    function close() {
      visible.value = false
      // 关闭时把选择同步出去
      syncOut(true)
    }

    /**
     * 把本地选择同步到父组件
     * @param {boolean} withConfirm 是否同时 emit range-confirm（popup 点「完成」时为 true）
     */
    function syncOut(withConfirm) {
      const value = {
        year: local.year,
        month: local.month,
        day: local.day
      }
      emit('update:modelValue', value)
      emit('range-change', value)
      if (withConfirm) emit('range-confirm', value)
    }

    /** 把选择转成查询用的日期区间 */
    function toRange() {
      const y = local.year
      const m = local.month
      const d = local.day
      if (y && m && d > 0) {
        const dayKey = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        return { startDay: dayKey, endDay: dayKey, monthKey: `${y}-${String(m).padStart(2, '0')}` }
      }
      if (y && m > 0) {
        const monthKey = `${y}-${String(m).padStart(2, '0')}`
        const lastDay = new Date(y, m, 0).getDate()
        return {
          startDay: `${monthKey}-01`,
          endDay: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
          monthKey
        }
      }
      if (y) {
        return {
          startDay: `${y}-01-01`,
          endDay: `${y}-12-31`,
          monthKey: ''
        }
      }
      return { startDay: '', endDay: '', monthKey: '' }
    }

    /* ------------------------------------------------- 外部同步 */

    watch(
      () => props.modelValue,
      (v) => {
        if (!v) {
          // 外部还没给值：至少把锚点定在「全部」上
          applyAnchors()
          return
        }
        const y = Number(v.year) || 0
        const m = Number(v.month) || 0
        const d = Number(v.day) || 0
        // 全部年时，月/日没有意义
        if (y !== local.year) local.year = y
        if (m !== local.month) local.month = m
        if (d !== local.day) local.day = d
        clampDay()
        // inline 模式常驻可见：直接更新锚点即可定位；
        // popup 模式面板还没开，等 open() 时再定位
        if (visible.value) scrollToSelection()
        else applyAnchors()
      },
      { immediate: true, deep: true }
    )

    return {
      visible, local, isInline, triggerClass,
      yearItems, monthItems, dayItems, label,
      yearAnchor, monthAnchor, dayAnchor,
      anchorId, applyAnchors, pickYear, pickMonth, pickDay,
      open, close, syncOut, toRange
    }
  }
}
</script>

<style scoped>
.drp {
  display: inline-flex;
}

/* inline 模式占满整行 */
.drp-root-inline {
  display: flex;
  width: 100%;
}

/* ============ 触发按钮（popup 模式） ============ */

.drp-trigger {
  display: flex;
  align-items: center;
  gap: 8rpx;
  background-color: var(--app-card);
}

/* compact：普通圆角 */
.drp-trigger-compact {
  padding: 10rpx 24rpx;
  border-radius: 28rpx;
}

/* pill：胶囊 */
.drp-trigger-pill {
  padding: 12rpx 32rpx;
  border-radius: 999rpx;
}

.drp-value {
  font-size: 26rpx;
  color: var(--app-text-2);
}

.drp-arrow {
  font-size: 22rpx;
  color: var(--app-text-3);
}

/* ============ inline 模式 ============ */

.drp-inline {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.drp-inline-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 4rpx 4rpx 12rpx;
}

.drp-inline-label {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--app-text);
}

.drp-inline-hint {
  font-size: 21rpx;
  color: var(--app-text-3);
}

.drp-inline-cols {
  display: flex;
  align-items: flex-start;
}

.drp-inline-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.drp-inline-title {
  font-size: 22rpx;
  color: var(--app-text-3);
  text-align: center;
  padding-bottom: 8rpx;
}

/* ============ 面板（popup 模式） ============ */

.drp-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 700;
  background-color: var(--app-mask);
  display: flex;
  align-items: flex-end;
}

.drp-panel {
  width: 100%;
  background-color: var(--app-card);
  border-radius: 28rpx 28rpx 0 0;
  padding-bottom: env(safe-area-inset-bottom);
}

.drp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx 20rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.drp-head-text {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
}

.drp-head-done {
  font-size: 28rpx;
  color: var(--app-primary);
  padding: 8rpx 12rpx;
}

/* ============ 三列滚轮 ============ */

.drp-cols {
  display: flex;
  height: 520rpx;
}

.drp-col {
  flex: 1;
  height: 100%;
}

.drp-col-inner {
  padding: 16rpx 0;
}

.drp-item {
  padding: 22rpx 0;
  text-align: center;
  font-size: 27rpx;
  color: var(--app-text-2);
}

/* inline 模式：行距更紧凑，一屏能看到更多天 */
.drp-inline-col .drp-item {
  padding: 14rpx 0;
  font-size: 25rpx;
}

.drp-item.active {
  color: var(--app-primary);
  font-weight: 600;
}

/* inline 模式下的列高：常驻可见，比弹层矮一些，避免把下方内容顶太远 */
.drp-inline-col .drp-col {
  height: 340rpx;
}
</style>
