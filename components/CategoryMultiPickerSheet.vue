<template>
  <wd-popup
    v-model="visible"
    position="bottom"
    :z-index="zIndex"
    :safe-area-inset-bottom="true"
    custom-style="background-color: var(--app-card); border-radius: 28rpx 28rpx 0 0;"
  >
    <view class="multi-sheet">
      <view class="multi-head">
        <text class="multi-title">{{ title }}</text>
        <text class="multi-clear" @click="clearAll">清空</text>
      </view>

      <text class="multi-hint">{{ hint }}</text>

      <scroll-view class="multi-scroll" scroll-y>
        <view v-for="g in groups" :key="g.key" class="multi-group">
          <!--
            分组标题：一级分类名
            自己没有二级分类的一级分类（「娱乐」这类）不显示标题 ——
            标题和下面那一项同名，重复一遍反而啰嗦。
          -->
          <!--
            ★ 分组标题可以点：一键全选 / 全不选这一组 ★
              用户想按「整个餐饮食品」筛时，不必一个个点开子类。
              只选子类也保证了查询口径统一（叶子 id 进 SQL，不会出现
              「父级 + 子级同时命中」导致同一笔支出被算两遍）。
          -->
          <view v-if="g.title" class="group-head" @click="toggleGroup(g)">
            <text class="group-name">{{ g.title }}</text>
            <text class="group-action">{{ groupAllChecked(g) ? '取消全选' : '全选' }}</text>
          </view>

          <view class="multi-list">
            <view
              v-for="opt in g.members"
              :key="opt.id"
              class="multi-item"
              :class="{ checked: draft.includes(opt.id), disabled: opt.disabled }"
              @click="toggle(opt)"
            >
              <view class="check-box" :class="{ checked: draft.includes(opt.id) }">
                <text v-if="draft.includes(opt.id)" class="check-tick">✓</text>
              </view>
              <text class="multi-label">{{ opt.label }}</text>
              <text v-if="opt.disabled" class="multi-used">已在其他预算</text>
            </view>
          </view>
        </view>

        <view v-if="groups.length === 0" class="multi-empty">
          <text class="multi-empty-text">没有可选的类别</text>
        </view>
      </scroll-view>

      <view class="multi-foot">
        <view class="foot-btn" @click="cancel">
          <text class="foot-btn-text">取消</text>
        </view>
        <view class="foot-btn primary" :style="{ backgroundColor: primaryColor }" @click="confirm">
          <text class="foot-btn-text on-primary">确定（已选 {{ draft.length }}）</text>
        </view>
      </view>
    </view>
  </wd-popup>
</template>

<script>
/**
 * 类别多选弹层
 *
 * ★ 为什么抽成独立组件 ★
 *   两个地方要用同一套多选交互：
 *     1. 预算管理页的「子预算」编辑器 —— 一条子预算可以管多个类别；
 *     2. 全部交易的筛选面板 —— 从子预算点「全部交易」跳过来时，
 *        带的是 categoryIds（多个类别），筛选面板得能原样回显。
 *   两处各写一遍的话，勾选样式、分组规则、深浅色适配都会慢慢长歪，
 *   所以只维护这一份。
 *
 * ★ 展示形态 ★
 *   - 按一级分类分组，选项文字是「一级分类名-二级分类名」；
 *     ⇒ 光看二级名（「其他」「日常」这类）分不清是哪一支；
 *   - 没有二级的一级分类（「娱乐」这类）自己就是一项，显示一级名；
 *   - 有二级的一级分类本身不作为选项 ——
 *     选了父级又要能选它下面的子级，同一笔支出就可能被算两遍
 *     （预算统计里这就是「已用翻倍」的 bug）。
 *
 * ★ 禁用项 ★
 *   预算页传 disabledIds：一个类别只能属于一条子预算，
 *   已经被别的子预算占着的现在就置灰并写明原因，
 *   而不是等用户勾完点保存才弹错误。
 */
import { computed, ref, watch, onUnmounted } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { pushLayer } from '@/utils/layerStack.js'

export default {
  name: 'CategoryMultiPickerSheet',
  props: {
    modelValue: { type: Boolean, default: false },
    /** 可选类别（扁平列表，含 parent_id / isParent 字段） */
    categories: { type: Array, default: () => [] },
    /** 已选类别 id 数组 */
    selectedIds: { type: Array, default: () => [] },
    /** 禁用类别 id 数组（已在别处被占用） */
    disabledIds: { type: Array, default: () => [] },
    title: { type: String, default: '选择类别' },
    hint: { type: String, default: '可以选多个类别，同一笔支出只会算进一条预算' },
    /**
     * 弹层层级
     *
     * ★ 为什么必须显式给 ★
     *   wd-popup 的默认 z-index 是 10。这个弹层常常是「在另一个弹层上面」
     *   打开的（全部交易的筛选面板 100、预算编辑器 100），
     *   如果它还是 10，就会渲染在下面那一层的**背后**，
     *   用户点开只能看到遮罩变暗、内容却看不见。
     *   所以默认给 110，调用方按自己的层级再覆盖。
     */
    zIndex: { type: Number, default: 110 }
  },
  /**
   * ★ 事件名叫 picked 而不是 confirm ★
   *   confirm 是原生事件名（见 scripts/check-events.mjs 的 RESERVED_EVENTS），
   *   父组件写 @confirm 会被编译成监听根节点的原生事件，
   *   组件 emit('confirm') 父组件根本收不到 —— 表现为「点确定没反应」。
   */
  emits: ['update:modelValue', 'picked'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const primaryColor = computed(() => settingStore.primaryColor)

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    /** 弹层内的临时选择：点「确定」才回传，点「取消」不影响外面 */
    const draft = ref([])

    watch(
      () => props.modelValue,
      (open) => {
        if (open) {
          draft.value = (props.selectedIds || []).slice()
          if (!unregisterLayer) {
            unregisterLayer = pushLayer(() => { visible.value = false }, 'categoryMultiSheet')
          }
          return
        }
        if (unregisterLayer) {
          unregisterLayer()
          unregisterLayer = null
        }
      }
    )

    /**
     * 分组 + 选项文案
     *
     * 顺序沿用传入列表的顺序（分类列表本身已按 sort 排好），
     * 只把子项收拢到各自的父分组里。
     */
    const groups = computed(() => {
      const list = props.categories || []
      const disabled = new Set(props.disabledIds || [])
      const roots = list.filter((c) => !c.parent_id)
      const out = []

      for (const root of roots) {
        const kids = list.filter((c) => c.parent_id === root.id)
        if (kids.length === 0) {
          out.push({
            key: root.id,
            title: '',
            members: [{
              id: root.id,
              label: root.name,
              disabled: disabled.has(root.id)
            }]
          })
          continue
        }
        out.push({
          key: root.id,
          title: root.name,
          members: kids.map((k) => ({
            id: k.id,
            label: `${root.name}-${k.name}`,
            disabled: disabled.has(k.id)
          }))
        })
      }
      return out
    })

    /** 这一组是不是全选了 */
    function groupAllChecked(g) {
      const ids = g.members.map((m) => m.id)
      return ids.length > 0 && ids.every((id) => draft.value.includes(id))
    }

    /** 一键全选 / 全不选一组 */
    function toggleGroup(g) {
      const selectable = g.members.filter((m) => !m.disabled).map((m) => m.id)
      if (selectable.length === 0) return
      const set = new Set(draft.value)
      if (groupAllChecked(g)) {
        selectable.forEach((id) => set.delete(id))
      } else {
        selectable.forEach((id) => set.add(id))
      }
      draft.value = Array.from(set)
    }

    /** 勾选/取消一项 */
    function toggle(opt) {
      if (opt.disabled) return
      const list = draft.value.slice()
      const i = list.indexOf(opt.id)
      if (i >= 0) list.splice(i, 1)
      else list.push(opt.id)
      draft.value = list
    }

    /** 清空已选 */
    function clearAll() {
      draft.value = []
    }

    /** 取消：直接关，不改外面的选择 */
    function cancel() {
      visible.value = false
    }

    /** 确定：把临时选择回传给调用方 */
    function confirm() {
      emit('picked', draft.value.slice())
      visible.value = false
    }

    /* 弹层栈：侧滑返回/返回键先收这个弹层（与其它弹层一致） */
    let unregisterLayer = null

    onUnmounted(() => {
      if (unregisterLayer) {
        unregisterLayer()
        unregisterLayer = null
      }
    })

    return {
      visible, primaryColor, draft, groups,
      groupAllChecked, toggleGroup, toggle, clearAll, cancel, confirm
    }
  }
}
</script>

<style scoped>
.multi-sheet {
  background-color: var(--app-card);
  padding-bottom: env(safe-area-inset-bottom);
  max-height: 78vh;
  display: flex;
  flex-direction: column;
}

.multi-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx 8rpx;
}

.multi-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
}

.multi-clear {
  font-size: 26rpx;
  color: var(--app-text-3);
}

.multi-hint {
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.5;
  padding: 0 32rpx 16rpx;
}

.multi-scroll {
  max-height: 56vh;
  border-top: 1rpx solid var(--app-line);
}

/* 每个一级分类一组 */
.multi-group {
  border-bottom: 1rpx solid var(--app-line);
}

.multi-group:last-child {
  border-bottom: none;
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 32rpx 4rpx;
}

.group-name {
  font-size: 24rpx;
  color: var(--app-text-2);
  font-weight: 500;
}

.group-action {
  font-size: 22rpx;
  color: var(--app-primary);
}

.multi-list {
  padding: 4rpx 0 12rpx;
}

.multi-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 32rpx;
}

.multi-item.checked {
  background-color: var(--app-card-2);
}

.multi-item.disabled {
  opacity: 0.45;
}

.multi-label {
  flex: 1;
  font-size: 27rpx;
  color: var(--app-text);
  min-width: 0;
}

.multi-used {
  font-size: 21rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
}

/* 勾选框：自绘，深浅色都跟主题变量走 */
.check-box {
  width: 36rpx;
  height: 36rpx;
  border-radius: 10rpx;
  border: 2rpx solid var(--app-line);
  background-color: var(--app-card-2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-sizing: border-box;
}

.check-box.checked {
  border-color: var(--app-primary);
  background-color: var(--app-primary);
}

.check-tick {
  font-size: 22rpx;
  color: #ffffff;
  font-weight: 600;
  line-height: 1;
}

.multi-empty {
  padding: 60rpx 0;
  text-align: center;
}

.multi-empty-text {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.multi-foot {
  display: flex;
  gap: 20rpx;
  padding: 20rpx 32rpx 24rpx;
  border-top: 1rpx solid var(--app-line);
}

.foot-btn {
  flex: 1;
  height: 84rpx;
  border-radius: 16rpx;
  background-color: var(--app-card-2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.foot-btn-text {
  font-size: 28rpx;
  color: var(--app-text-2);
}

.foot-btn-text.on-primary {
  color: #ffffff;
  font-weight: 500;
}
</style>
