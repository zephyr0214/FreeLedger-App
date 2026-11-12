<template>
  <!--
    流水的标签选择弹层（右滑「标签」/ 多选批量「标签」共用）

    ★ 为什么抽成组件 ★
      同一个弹层要在三个地方出现：首页右滑、全部交易页右滑、
      全部交易页多选批量。三处各写一份的话，
      「已勾选的标签怎么回显」「取消要不要还原」这些细节迟早三份不一样。
  -->
  <wd-popup
    v-model="visible"
    position="bottom"
    :z-index="700"
    :safe-area-inset-bottom="true"
    custom-style="background-color: var(--app-card); border-radius: 28rpx 28rpx 0 0;"
  >
    <view class="tag-sheet">
      <view class="tag-head">
        <text class="tag-title">{{ title }}</text>
        <text class="tag-clear" @click="clearAll">清空</text>
      </view>

      <!--
        ★ 批量模式给一句说明 ★
          用户勾了 12 笔流水再点「标签」，得让他知道
          「这几个标签会加到每一笔上」，而不是替换掉原有的。
      -->
      <text v-if="hint" class="tag-hint">{{ hint }}</text>

      <scroll-view class="tag-scroll" scroll-y>
        <view
          v-for="t in tags"
          :key="t.id"
          class="tag-item"
          :class="{ checked: draft.includes(t.id) }"
          @click="toggle(t.id)"
        >
          <view class="check-box" :class="{ checked: draft.includes(t.id) }">
            <text v-if="draft.includes(t.id)" class="check-tick">✓</text>
          </view>
          <view class="tag-dot" :style="{ backgroundColor: t.color || 'var(--app-text-3)' }" />
          <text class="tag-name">{{ t.name }}</text>
        </view>

        <view v-if="tags.length === 0" class="tag-empty">
          <text class="tag-empty-text">还没有标签，先去「我的 → 分类与标签」添加</text>
        </view>
      </scroll-view>

      <view class="tag-foot">
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
import { computed, ref, watch, onUnmounted } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { pushLayer } from '@/utils/layerStack.js'

export default {
  name: 'TxnTagSheet',
  props: {
    modelValue: { type: Boolean, default: false },
    /** 可选标签（listTags 的返回值） */
    tags: { type: Array, default: () => [] },
    /** 已选标签 id（打开时回显） */
    selectedIds: { type: Array, default: () => [] },
    title: { type: String, default: '选择标签' },
    /** 额外说明文案（批量模式用） */
    hint: { type: String, default: '' }
  },
  /*
   * ★ 事件名叫 picked 不叫 confirm ★
   *   confirm 是原生事件名（同 CategoryMultiPickerSheet 的说明），
   *   父组件写 @confirm 会被编译成监听根节点的原生事件，收不到。
   */
  emits: ['update:modelValue', 'picked'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const primaryColor = computed(() => settingStore.primaryColor)

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    /** 临时选择：点「确定」才回传 */
    const draft = ref([])

    let unregisterLayer = null

    watch(
      () => props.modelValue,
      (open) => {
        if (open) {
          draft.value = (props.selectedIds || []).slice()
          if (!unregisterLayer) {
            unregisterLayer = pushLayer(() => { visible.value = false }, 'txnTagSheet')
          }
          return
        }
        if (unregisterLayer) {
          unregisterLayer()
          unregisterLayer = null
        }
      }
    )

    onUnmounted(() => {
      if (unregisterLayer) unregisterLayer()
    })

    function toggle(id) {
      const list = draft.value.slice()
      const i = list.indexOf(id)
      if (i >= 0) list.splice(i, 1)
      else list.push(id)
      draft.value = list
    }

    function clearAll() {
      draft.value = []
    }

    function cancel() {
      visible.value = false
    }

    function confirm() {
      emit('picked', draft.value.slice())
      visible.value = false
    }

    return { visible, primaryColor, draft, toggle, clearAll, cancel, confirm }
  }
}
</script>

<style scoped>
.tag-sheet {
  display: flex;
  flex-direction: column;
  max-height: 70vh;
}

.tag-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx 16rpx;
}

.tag-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
}

.tag-clear {
  font-size: 26rpx;
  color: var(--app-text-3);
}

.tag-hint {
  padding: 0 32rpx 16rpx;
  font-size: 22rpx;
  line-height: 1.5;
  color: var(--app-text-3);
}

.tag-scroll {
  flex: 1;
  min-height: 200rpx;
  max-height: 46vh;
  padding: 0 32rpx;
}

.tag-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 22rpx 0;
  border-bottom: 1rpx solid var(--app-line);
}

.tag-item:last-child {
  border-bottom: none;
}

.tag-dot {
  width: 20rpx;
  height: 20rpx;
  border-radius: 50%;
  flex-shrink: 0;
}

.tag-name {
  flex: 1;
  font-size: 28rpx;
  color: var(--app-text);
}

/* 勾选框：和分类多选弹层同一套观感 */
.check-box {
  width: 40rpx;
  height: 40rpx;
  border-radius: 10rpx;
  border: 2rpx solid var(--app-line);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.check-box.checked {
  background-color: var(--app-primary);
  border-color: var(--app-primary);
}

.check-tick {
  font-size: 24rpx;
  color: #ffffff;
}

.tag-empty {
  padding: 60rpx 0;
  text-align: center;
}

.tag-empty-text {
  font-size: 26rpx;
  color: var(--app-text-3);
}

.tag-foot {
  display: flex;
  gap: 20rpx;
  padding: 20rpx 32rpx 32rpx;
}

.foot-btn {
  flex: 1;
  height: 84rpx;
  border-radius: 18rpx;
  background-color: var(--app-card-2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.foot-btn-text {
  font-size: 28rpx;
  color: var(--app-text-2);
}

.foot-btn.primary .foot-btn-text.on-primary {
  color: #ffffff;
}
</style>
