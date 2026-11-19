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
        <view class="tag-head-left">
          <text class="tag-title">{{ title }}</text>
          <!-- 添加标签：与首页「智能助手」同款胶囊，文字不加 + -->
          <HeaderAction @action-click="openAddTag">添加标签</HeaderAction>
        </view>
        <text class="tag-clear" @click="clearAll">清空</text>
      </view>

      <!--
        ★ 不显示任何说明小字 ★
          用户要求标签选择面板不要出现「可以选择多个…」这类提示；
          勾选交互本身已经足够直观。
      -->

      <scroll-view class="tag-scroll" scroll-y>
        <view
          v-for="t in localTags"
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

        <view v-if="localTags.length === 0" class="tag-empty">
          <text class="tag-empty-text">还没有标签，先新增标签</text>
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

  <!-- 新增 / 编辑标签：叠在标签选择面板之上 -->
  <TagEditorSheet
    v-model="showTagEditor"
    @saved="onTagSaved"
  />
</template>

<script>
import { computed, ref, watch, onUnmounted } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import HeaderAction from '@/components/HeaderAction.vue'
import TagEditorSheet from '@/components/TagEditorSheet.vue'
import { listTags } from '@/api/tag.js'
import { pushLayer } from '@/utils/layerStack.js'

export default {
  name: 'TxnTagSheet',
  components: { HeaderAction, TagEditorSheet },
  props: {
    modelValue: { type: Boolean, default: false },
    /** 可选标签（listTags 的返回值） */
    tags: { type: Array, default: () => [] },
    /** 已选标签 id（打开时回显） */
    selectedIds: { type: Array, default: () => [] },
    title: { type: String, default: '选择标签' }
  },
  /*
   * ★ 事件名叫 picked 不叫 confirm ★
   *   confirm 是原生事件名（同 CategoryMultiPickerSheet 的说明），
   *   父组件写 @confirm 会被编译成监听根节点的原生事件，收不到。
   */
  emits: ['update:modelValue', 'picked', 'tag-created'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const primaryColor = computed(() => settingStore.primaryColor)

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    /** 临时选择：点「确定」才回传 */
    const draft = ref([])

    /**
     * 本次打开用的标签列表
     *
     * ★ 为什么不在模板里直接用 props.tags ★
     *   页面级 tags 是缓存，用户刚给某笔账打了标签、或在另一个入口新增了标签后，
     *   缓存里的顺序/成员可能还是旧的。这里每次打开都重新查一次 listTags，
     *   保证「最近使用顺序」和新增标签立刻生效，不依赖页面 onShow 的时机。
     */
    const localTags = ref([])
    let tagsLoadToken = 0

    async function refreshTags() {
      const token = ++tagsLoadToken
      try {
        const rows = await listTags()
        if (token === tagsLoadToken) localTags.value = rows
      } catch (e) {
        // 查询失败就继续用打开时复制的那份，至少不影响选择
        console.warn('[tagSheet] 刷新标签失败:', e && e.message)
      }
    }

    /** 新增标签弹层 */
    const showTagEditor = ref(false)

    function openAddTag() {
      showTagEditor.value = true
    }

    async function onTagSaved(tag) {
      showTagEditor.value = false
      emit('tag-created', tag)
      await refreshTags()
    }

    let unregisterLayer = null

    watch(
      () => props.modelValue,
      (open) => {
        if (open) {
          draft.value = (props.selectedIds || []).slice()
          // 先用父级缓存立即渲染，再异步换成最新列表
          localTags.value = Array.isArray(props.tags) ? props.tags.slice() : []
          refreshTags()
          if (!unregisterLayer) {
            unregisterLayer = pushLayer(() => { visible.value = false }, 'txnTagSheet')
          }
          return
        }
        // 标签面板关闭时，叠在上面的新增标签弹层也一起收起
        showTagEditor.value = false
        // 让还在路上的 listTags 结果作废，避免关掉后写回
        tagsLoadToken++
        if (unregisterLayer) {
          unregisterLayer()
          unregisterLayer = null
        }
      }
    )

    onUnmounted(() => {
      tagsLoadToken++
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

    return {
      visible, primaryColor, draft, localTags, showTagEditor,
      toggle, clearAll, cancel, confirm, openAddTag, onTagSaved
    }
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

.tag-head-left {
  display: flex;
  align-items: center;
  gap: 16rpx;
  min-width: 0;
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
