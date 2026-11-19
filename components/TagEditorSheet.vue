<template>
  <wd-popup
    v-model="visible"
    position="bottom"
    :z-index="zIndex"
    :safe-area-inset-bottom="true"
    custom-style="background-color: var(--app-card); border-radius: 28rpx 28rpx 0 0;"
  >
    <view class="editor">
      <view class="editor-head">
        <text class="editor-cancel" @click="close">取消</text>
        <text class="editor-title">{{ isEditing ? '编辑标签' : '新建标签' }}</text>
        <text class="editor-save" @click="onSave">保存</text>
      </view>

      <view class="editor-body">
        <view class="editor-row">
          <text class="editor-label">名称</text>
          <input
            v-model="form.name"
            class="editor-input"
            placeholder="如 2026装修"
            placeholder-class="editor-placeholder"
            :maxlength="12"
          />
        </view>

        <view class="editor-row editor-row-column">
          <text class="editor-label">颜色</text>
          <view class="color-grid">
            <view
              v-for="c in colors"
              :key="c.value"
              class="color-cell"
              :class="{ active: form.color === c.value }"
              @click="form.color = c.value"
            >
              <view class="color-dot" :style="{ backgroundColor: c.value }" />
              <text class="color-name">{{ c.name }}</text>
            </view>
          </view>
        </view>
      </view>

      <view v-if="isEditing" class="editor-danger">
        <text class="danger-link" @click="onDelete">删除这个标签</text>
      </view>
    </view>
  </wd-popup>
</template>

<script>
/**
 * 标签新建 / 编辑弹层
 *
 * ★ 为什么抽成组件 ★
 *   标签管理页、记账面板、首页右滑、全部交易页、筛选面板里的
 *   「添加标签」都要弹同一套表单。写多份迟早颜色板/校验/删除确认不一致。
 *
 * ★ 与标签选择面板的关系 ★
 *   TxnTagSheet 的「添加标签」把本组件叠在标签面板之上；
 *   保存成功后由外层重新拉 listTags，当前面板立刻出现新标签。
 */
import { computed, reactive, watch, onUnmounted } from 'vue'
import { createTag, updateTag, deleteTag } from '@/api/tag.js'
import { COLOR_PALETTE, DEFAULT_COLOR } from '@/utils/colorPalette.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'
import { pushLayer } from '@/utils/layerStack.js'

export default {
  name: 'TagEditorSheet',
  props: {
    modelValue: { type: Boolean, default: false },
    /** 编辑的标签；为空表示新建 */
    tag: { type: Object, default: null },
    /** 弹层层级：要能盖在标签选择面板之上 */
    zIndex: { type: Number, default: 800 }
  },
  emits: ['update:modelValue', 'saved', 'deleted'],
  setup(props, { emit }) {
    const colors = COLOR_PALETTE

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    const form = reactive({ name: '', color: DEFAULT_COLOR })
    const isEditing = computed(() => !!props.tag)

    function resetForm() {
      const t = props.tag
      form.name = t ? (t.name || '') : ''
      form.color = (t && t.color) || DEFAULT_COLOR
    }

    function close() {
      visible.value = false
    }

    async function onSave() {
      const name = form.name.trim()
      if (!name) {
        uni.showToast({ title: '请填写名称', icon: 'none' })
        return
      }
      try {
        let saved = null
        if (isEditing.value) {
          saved = await updateTag(props.tag.id, { name, color: form.color })
        } else {
          saved = await createTag({ name, color: form.color })
        }
        close()
        emit('saved', saved)
        uni.showToast({ title: '已保存', icon: 'success' })
      } catch (e) {
        await alertDialog({ title: '保存失败', content: e.message })
      }
    }

    async function onDelete() {
      if (!isEditing.value) return
      const ok = await confirmDialog({
        title: `删除标签「${props.tag.name}」？`,
        content: '相关交易不会被删除，只是取消标签关联',
        confirmText: '删除',
        danger: true
      })
      if (!ok) return
      try {
        await deleteTag(props.tag.id)
        close()
        emit('deleted', props.tag)
        uni.showToast({ title: '已删除', icon: 'success' })
      } catch (e) {
        await alertDialog({ title: '删除失败', content: e.message })
      }
    }

    let unregisterLayer = null

    watch(
      () => props.modelValue,
      (open) => {
        if (open) {
          resetForm()
          if (!unregisterLayer) {
            unregisterLayer = pushLayer(() => { visible.value = false }, 'tagEditor')
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
      if (unregisterLayer) {
        unregisterLayer()
        unregisterLayer = null
      }
    })

    return {
      visible, colors, form, isEditing,
      close, onSave, onDelete
    }
  }
}
</script>

<style scoped>
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

.editor-danger {
  text-align: center;
  padding: 24rpx 0 40rpx;
  border-top: 1rpx solid var(--app-line);
  margin-top: 8rpx;
}

.danger-link {
  font-size: 26rpx;
  color: var(--app-danger);
}

.color-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12rpx 8rpx;
  width: 100%;
}

.color-cell {
  width: calc((100% - 56rpx) / 8);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
  padding: 4rpx 0;
}

.color-dot {
  width: 52rpx;
  height: 52rpx;
  border-radius: 50%;
  box-sizing: border-box;
}

.color-name {
  font-size: 16rpx;
  line-height: 1.2;
  color: var(--app-text-3);
  text-align: center;
  white-space: nowrap;
}

.color-cell.active .color-dot {
  box-shadow: inset 0 0 0 4rpx var(--app-text);
}

.color-cell.active .color-name {
  color: var(--app-text);
}
</style>
