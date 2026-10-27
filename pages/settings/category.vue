<template>
  <view class="app-page" :style="pageStyle">
    <PageNav title="分类管理" @back="goBack" />

    <!-- 类型切换 -->
    <view class="type-bar">
      <view
        v-for="t in types"
        :key="t.key"
        class="type-item"
        :class="{ active: activeType === t.key }"
        @click="switchType(t.key)"
      >
        <text
          class="type-text"
          :style="{ color: activeType === t.key ? primaryColor : 'var(--app-text-2)' }"
        >{{ t.name }}</text>
        <view
          v-if="activeType === t.key"
          class="type-indicator"
          :style="{ backgroundColor: primaryColor }"
        />
      </view>
    </view>

    <scroll-view class="page-scroll" scroll-y :style="{ height: scrollHeight }">
      <view v-if="tree.length === 0" class="empty-wrap">
        <EmptyState emoji="📂" title="还没有分类" action-text="新建分类" @action="openCreate(null)" />
      </view>

      <view v-for="parent in tree" :key="parent.id" class="cat-group">
        <view class="parent-row" @click="toggleExpand(parent.id)">
          <view class="parent-icon" :style="{ backgroundColor: (parent.color || primaryColor) + '22' }">
            <text class="parent-icon-text" :style="{ color: parent.color || primaryColor }">
              {{ parent.name.slice(0, 1) }}
            </text>
          </view>
          <text class="parent-name">{{ parent.name }}</text>
          <text class="parent-count">{{ parent.children.length }} 个子类</text>
          <text
            class="expand-icon"
            :class="{ expanded: expandedIds.includes(parent.id) }"
          >›</text>
        </view>

        <view v-if="expandedIds.includes(parent.id)" class="children">
          <view
            v-for="child in parent.children"
            :key="child.id"
            class="child-row"
            @click="openEdit(child)"
          >
            <view class="child-dot" :style="{ backgroundColor: child.color || primaryColor }" />
            <text class="child-name">{{ child.name }}</text>
            <text class="child-edit">编辑</text>
          </view>

          <view class="child-row child-add" @click="openCreate(parent)">
            <text class="child-add-text">+ 添加子分类</text>
          </view>

          <view class="child-actions">
            <text class="action-link" @click="openEdit(parent)">编辑父类</text>
            <text class="action-link action-danger" @click="onDelete(parent)">删除父类</text>
          </view>
        </view>
      </view>

      <view class="add-btn-wrap">
        <wd-button size="large" plain type="primary" @click="openCreate(null)">
          + 新建一级分类
        </wd-button>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 编辑弹层 -->
    <wd-popup v-model="showEditor" position="bottom" :safe-area-inset-bottom="true">
      <view class="editor">
        <view class="editor-head">
          <text class="editor-cancel" @click="showEditor = false">取消</text>
          <text class="editor-title">{{ editingId ? '编辑分类' : '新建分类' }}</text>
          <text class="editor-save" @click="onSaveCategory">保存</text>
        </view>

        <view class="editor-body">
          <view class="editor-row">
            <text class="editor-label">名称</text>
            <input
              v-model="editorForm.name"
              class="editor-input"
              placeholder="分类名称"
              placeholder-class="editor-placeholder"
              :maxlength="10"
            />
          </view>

          <view v-if="!editorForm.parent_id" class="editor-row editor-row-column">
            <text class="editor-label">颜色</text>
            <view class="color-grid">
              <view
                v-for="c in colors"
                :key="c"
                class="color-cell"
                :class="{ active: editorForm.color === c }"
                :style="{ backgroundColor: c }"
                @click="editorForm.color = c"
              />
            </view>
          </view>
        </view>
      </view>
    </wd-popup>
  </view>
</template>

<script>
import { ref, reactive, computed, onMounted } from 'vue'
import PageNav from '@/components/PageNav.vue'
import EmptyState from '@/components/EmptyState.vue'
import { useSettingStore } from '@/stores/setting.js'
import {
  listCategoryTree, createCategory, updateCategory, deleteCategory
} from '@/api/category.js'

export default {
  components: { PageNav, EmptyState },
  setup() {
    const settingStore = useSettingStore()

    const activeType = ref('expense')
    const tree = ref([])
    const expandedIds = ref([])
    const showEditor = ref(false)
    const editingId = ref('')
    const editorForm = reactive({ name: '', color: '', parent_id: null })

    const types = [
      { key: 'expense', name: '支出分类' },
      { key: 'income', name: '收入分类' }
    ]

    const colors = [
      '#FF976A', '#1989FA', '#EE0A24', '#7D5FFF',
      '#07C160', '#FF8F1F', '#0A8F4A', '#FF6B9D',
      '#969799', '#FFD60A'
    ]

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    const scrollHeight = computed(() => {
      const info = uni.getSystemInfoSync()
      return `${info.windowHeight - (info.statusBarHeight || 20) - 44 - 56}px`
    })

    async function load() {
      tree.value = await listCategoryTree(activeType.value, true)
      // 默认展开第一个
      if (tree.value.length > 0 && expandedIds.value.length === 0) {
        expandedIds.value = [tree.value[0].id]
      }
    }

    function switchType(key) {
      activeType.value = key
      expandedIds.value = []
      load()
    }

    function toggleExpand(id) {
      if (expandedIds.value.includes(id)) {
        expandedIds.value = expandedIds.value.filter((x) => x !== id)
      } else {
        expandedIds.value.push(id)
      }
    }

    function openCreate(parent) {
      editingId.value = ''
      editorForm.name = ''
      editorForm.color = colors[0]
      editorForm.parent_id = parent ? parent.id : null
      showEditor.value = true
    }

    function openEdit(cat) {
      editingId.value = cat.id
      editorForm.name = cat.name
      editorForm.color = cat.color || colors[0]
      editorForm.parent_id = cat.parent_id
      showEditor.value = true
    }

    async function onSaveCategory() {
      if (!editorForm.name.trim()) {
        uni.showToast({ title: '请填写名称', icon: 'none' })
        return
      }

      try {
        if (editingId.value) {
          await updateCategory(editingId.value, {
            name: editorForm.name.trim(),
            color: editorForm.color
          })
        } else {
          await createCategory({
            name: editorForm.name.trim(),
            type: activeType.value,
            color: editorForm.color,
            parent_id: editorForm.parent_id,
            icon: 'more'
          })
        }
        showEditor.value = false
        await load()
        uni.showToast({ title: '已保存', icon: 'success' })
      } catch (e) {
        uni.showModal({ title: '保存失败', content: e.message, showCancel: false })
      }
    }

    function onDelete(cat) {
      uni.showModal({
        title: `删除「${cat.name}」？`,
        content: '若该分类下已有交易则无法删除',
        confirmText: '删除',
        confirmColor: '#ee0a24',
        success: async (res) => {
          if (!res.confirm) return
          try {
            await deleteCategory(cat.id)
            await load()
            uni.showToast({ title: '已删除', icon: 'success' })
          } catch (e) {
            uni.showModal({ title: '无法删除', content: e.message, showCancel: false })
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
      settingStore, activeType, tree, expandedIds,
      showEditor, editingId, editorForm, types, colors,
      primaryColor, pageStyle, scrollHeight,
      switchType, toggleExpand, openCreate, openEdit,
      onSaveCategory, onDelete, goBack
    }
  }
}
</script>

<style scoped>
.type-bar {
  display: flex;
  gap: 40rpx;
  padding: 8rpx 32rpx 16rpx;
}

.type-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  padding-bottom: 12rpx;
}

.type-text {
  font-size: 28rpx;
  font-weight: 500;
}

.type-indicator {
  position: absolute;
  bottom: 0;
  width: 32rpx;
  height: 4rpx;
  border-radius: 2rpx;
}

.page-scroll {
  padding: 0 32rpx;
}

.cat-group {
  background-color: var(--app-card);
  border-radius: 20rpx;
  margin-bottom: 16rpx;
  overflow: hidden;
}

.parent-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 26rpx 28rpx;
}

.parent-icon {
  width: 68rpx;
  height: 68rpx;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.parent-icon-text {
  font-size: 28rpx;
  font-weight: 600;
}

.parent-name {
  flex: 1;
  font-size: 28rpx;
  color: var(--app-text);
  font-weight: 500;
}

.parent-count {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.expand-icon {
  font-size: 32rpx;
  color: var(--app-text-3);
  transition: transform 0.2s;
}

.expand-icon.expanded {
  transform: rotate(90deg);
}

.children {
  border-top: 1rpx solid var(--app-line);
  padding: 8rpx 28rpx 16rpx;
}

.child-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 18rpx 0;
  border-bottom: 1rpx solid var(--app-line);
}

.child-row:last-of-type {
  border-bottom: none;
}

.child-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  flex-shrink: 0;
}

.child-name {
  flex: 1;
  font-size: 26rpx;
  color: var(--app-text-2);
}

.child-edit {
  font-size: 22rpx;
  color: var(--app-primary);
}

.child-add {
  justify-content: center;
  padding: 16rpx 0;
  border-bottom: none;
}

.child-add-text {
  font-size: 24rpx;
  color: var(--app-primary);
}

.child-actions {
  display: flex;
  gap: 32rpx;
  justify-content: center;
  padding-top: 12rpx;
}

.action-link {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.action-danger {
  color: var(--app-danger);
}

.add-btn-wrap {
  margin-top: 32rpx;
}

.empty-wrap {
  background-color: var(--app-card);
  border-radius: 20rpx;
  margin-top: 16rpx;
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
}

.editor-input {
  flex: 1;
  text-align: right;
  font-size: 28rpx;
  color: var(--app-text);
}

.editor-placeholder {
  color: var(--app-text-3);
  font-size: 28rpx;
}

.color-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  width: 100%;
}

.color-cell {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
}

.color-cell.active {
  outline: 4rpx solid var(--app-text);
  outline-offset: 2rpx;
}
</style>
