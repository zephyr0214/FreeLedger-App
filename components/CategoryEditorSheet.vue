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
        <text class="editor-title">{{ editorTitle }}</text>
        <text class="editor-save" @click="onSave">保存</text>
      </view>

      <view class="editor-body">
        <view class="editor-row">
          <text class="editor-label">名称</text>
          <input
            v-model="form.name"
            class="editor-input"
            :class="{ 'editor-input-locked': isEditingFixed }"
            placeholder="分类名称"
            placeholder-class="editor-placeholder"
            :maxlength="10"
            :disabled="isEditingFixed"
          />
        </view>

        <!--
          图标：只显示当前图标 + 名称，点击进入独立图标选择页。
          ★ 不在弹层里内嵌图标网格 ★
            图标选择器有几百个图标 + 搜索，塞进底部弹层会形成
            「弹层里再套一层滚动」；用户要求图标选择是独立页面。
        -->
        <view class="editor-row editor-row-icon" @click="openIconPicker">
          <text class="editor-label">图标</text>
          <view class="editor-icon-value">
            <view class="editor-icon-preview">
              <CategoryGlyph
                :icon="form.icon"
                size="40rpx"
                :remote-size="60"
                :loading-fallback="false"
              />
            </view>
            <text class="editor-icon-name">{{ currentIconLabel }}</text>
            <text class="editor-icon-arrow">›</text>
          </view>
        </view>

        <!-- 二级分类的颜色跟随父级，不提供颜色选择 -->
        <view v-if="!form.parent_id" class="editor-row editor-row-column">
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
        <view v-else class="editor-row">
          <text class="editor-label">颜色</text>
          <text class="editor-hint editor-hint-right">子分类颜色跟随父级「{{ parentName }}」</text>
        </view>
      </view>

      <!-- 删除入口：只在编辑已有分类、且不是系统固定分类时显示 -->
      <view v-if="canDelete" class="editor-danger">
        <text class="danger-link" @click="onDelete">删除这个分类</text>
      </view>
    </view>
  </wd-popup>
</template>

<script>
/**
 * 分类编辑 / 新建弹层（分类管理页与记账分类面板共用）
 *
 * ★ 为什么要抽成组件 ★
 *   分类管理页的「添加子分类」和记账面板分类选择器右上角的
 *   「添加子类」必须长得完全一样、调用同一套 createCategory/
 *   updateCategory/图标缓存逻辑。写两份迟早一边改了另一边忘。
 *
 * ★ create / edit 两种模式 ★
 *   · 传 category：编辑已有分类（固定分类只允许改图标/颜色）；
 *   · 传 parent：在该父类下新建子分类；
 *   · 都不传：新建一级分类。
 *
 * ★ 弹层栈 ★
 *   它经常叠在记账面板 / 分类选择面板上面，打开时登记 pushLayer，
 *   侧滑返回或安卓返回键先收起它，不会连着关掉下面两层。
 */
import { computed, reactive, watch, onUnmounted } from 'vue'
import CategoryGlyph from '@/components/CategoryGlyph.vue'
import {
  createCategory, updateCategory, deleteCategory, isFixedCategory
} from '@/api/category.js'
import { FALLBACK_EMOJI_CODE, categoryIconCode, emojiLabel } from '@/utils/emoji.js'
import { COLOR_PALETTE, DEFAULT_COLOR } from '@/utils/colorPalette.js'
import { syncCategoryIconCache } from '@/api/iconCache.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'
import { pushLayer } from '@/utils/layerStack.js'

export default {
  name: 'CategoryEditorSheet',
  components: { CategoryGlyph },
  props: {
    modelValue: { type: Boolean, default: false },
    /** 新建分类时的收支类型 */
    type: { type: String, default: 'expense' },
    /** 新建子分类时的父级；编辑子分类时也传，用于显示「颜色跟随父级」 */
    parent: { type: Object, default: null },
    /** 编辑的分类；为空表示新建 */
    category: { type: Object, default: null },
    /** 弹层层级：要在分类选择面板之上 */
    zIndex: { type: Number, default: 800 }
  },
  emits: ['update:modelValue', 'saved', 'deleted'],
  setup(props, { emit }) {
    const colors = COLOR_PALETTE

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    const form = reactive({
      name: '',
      color: DEFAULT_COLOR,
      icon: FALLBACK_EMOJI_CODE,
      parent_id: null
    })

    const isEditing = computed(() => !!props.category)
    const isEditingFixed = computed(() => isEditing.value && isFixedCategory(props.category))
    const canDelete = computed(() => isEditing.value && !isEditingFixed.value)

    const currentIconLabel = computed(() => emojiLabel(form.icon) || '选择图标')

    const parentName = computed(() => {
      if (props.parent && props.parent.name) return props.parent.name
      return ''
    })

    const editorTitle = computed(() => {
      if (isEditing.value) {
        if (isEditingFixed.value) {
          return form.parent_id ? '编辑系统子分类' : '编辑系统分类'
        }
        return form.parent_id ? '编辑子分类' : '编辑一级分类'
      }
      return form.parent_id ? '新建子分类' : '新建一级分类'
    })

    function resetForm() {
      const cat = props.category
      if (cat) {
        form.name = cat.name || ''
        form.color = cat.color || DEFAULT_COLOR
        form.icon = categoryIconCode(cat.icon, cat.name)
        form.parent_id = cat.parent_id || null
        return
      }
      const p = props.parent
      form.name = ''
      form.color = (p && p.color) || DEFAULT_COLOR
      form.icon = p
        ? categoryIconCode(p.icon, p.name)
        : FALLBACK_EMOJI_CODE
      form.parent_id = p ? p.id : null
    }

    function close() {
      visible.value = false
    }

    function openIconPicker() {
      uni.navigateTo({
        url: `/pages/settings/category-icon?icon=${encodeURIComponent(form.icon || '')}`
      })
    }

    function onIconPicked(code) {
      if (code) form.icon = code
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
          /*
           * 系统分类只允许改图标 / 颜色：名称不提交（输入框已禁用），
           * API 层还会再兜一次，防止绕过 UI。
           */
          const patch = { icon: form.icon }
          if (!isEditingFixed.value) patch.name = name
          if (!form.parent_id) patch.color = form.color
          saved = await updateCategory(props.category.id, patch)
        } else {
          saved = await createCategory({
            name,
            type: props.type === 'income' ? 'income' : 'expense',
            color: form.color,
            parent_id: form.parent_id,
            icon: form.icon
          })
        }
        // 新图标五种样式同步落到本地缓存；旧码点由 warm 里的 prune 清理
        syncCategoryIconCache(form.icon, name).catch((e) => {
          console.warn('[category] 同步图标缓存失败:', e && e.message)
        })
        close()
        emit('saved', saved)
        uni.showToast({ title: '已保存', icon: 'success' })
      } catch (e) {
        await alertDialog({ title: '保存失败', content: e.message })
      }
    }

    async function onDelete() {
      if (!canDelete.value) return
      const cat = props.category
      const isChild = !!cat.parent_id
      const ok = await confirmDialog({
        title: `删除「${cat.name}」？`,
        content: isChild
          ? '该分类下的交易会变成「无分类」，交易记录本身不会删除'
          : '该分类及其子分类下的交易会变成「无分类」，交易记录本身不会删除',
        confirmText: '删除',
        danger: true
      })
      if (!ok) return
      try {
        await deleteCategory(cat.id)
        close()
        emit('deleted', cat)
        uni.showToast({ title: '已删除', icon: 'success' })
      } catch (e) {
        await alertDialog({ title: '无法删除', content: e.message })
      }
    }

    /*
     * 打开时初始化表单 + 登记弹层栈 + 监听图标选择页的回传。
     * 关闭时摘掉监听和弹层栈；卸载时兜底清理。
     */
    let unregisterLayer = null
    let listeningIcon = false

    function startListeningIcon() {
      if (listeningIcon || typeof uni === 'undefined' || typeof uni.$on !== 'function') return
      uni.$on('category-icon-picked', onIconPicked)
      listeningIcon = true
    }

    function stopListeningIcon() {
      if (!listeningIcon || typeof uni === 'undefined' || typeof uni.$off !== 'function') return
      uni.$off('category-icon-picked', onIconPicked)
      listeningIcon = false
    }

    watch(
      () => props.modelValue,
      (open) => {
        if (open) {
          resetForm()
          startListeningIcon()
          if (!unregisterLayer) {
            unregisterLayer = pushLayer(() => { visible.value = false }, 'categoryEditor')
          }
          return
        }
        stopListeningIcon()
        if (unregisterLayer) {
          unregisterLayer()
          unregisterLayer = null
        }
      }
    )

    onUnmounted(() => {
      stopListeningIcon()
      if (unregisterLayer) {
        unregisterLayer()
        unregisterLayer = null
      }
    })

    return {
      colors, visible, form, currentIconLabel,
      parentName, isEditingFixed, editorTitle, canDelete,
      close, openIconPicker, onSave, onDelete
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
  /* 内容只有名称 / 图标 / 颜色三行，不需要滚动 */
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

.editor-icon-value {
  display: flex;
  align-items: center;
  gap: 12rpx;
  min-width: 0;
}

.editor-icon-preview {
  width: 52rpx;
  height: 52rpx;
  border-radius: 14rpx;
  background-color: var(--app-card-2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.editor-icon-name {
  max-width: 280rpx;
  font-size: 24rpx;
  color: var(--app-text-2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.editor-icon-arrow {
  font-size: 34rpx;
  line-height: 1;
  color: var(--app-text-3);
}

.editor-input {
  flex: 1;
  text-align: right;
  font-size: 28rpx;
  color: var(--app-text);
}

.editor-input-locked {
  color: var(--app-text-3);
}

.editor-placeholder {
  font-size: 28rpx;
  color: var(--app-text-3);
}

.editor-hint {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.editor-hint-right {
  flex: 1;
  min-width: 0;
  text-align: right;
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

/* 16 色：每行 8 个，色块 + 中文名 */
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
