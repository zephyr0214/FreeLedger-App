<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
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

    <scroll-view class="page-scroll" scroll-y>
      <view v-if="tree.length === 0" class="empty-wrap">
        <EmptyState emoji="📂" title="还没有分类" action-text="新建分类" @action="openCreate(null)" />
      </view>

      <view v-for="parent in tree" :key="parent.id" class="cat-group">
        <!--
          ★ 交互约定（与标签管理页保持一致）★
            点父类行  -> 展开/收起
            点父类名字 -> 进分类详情页（看这个分类的流水与统计）
            点「编辑」 -> 打开编辑弹层
        -->
        <view class="parent-row" @click="toggleExpand(parent.id)">
          <view class="parent-icon" :style="{ backgroundColor: (parent.color || primaryColor) + '22' }">
            <text class="parent-emoji">{{ iconEmoji(parent.icon) }}</text>
          </view>
          <text class="parent-name" @click.stop="goDetail(parent)">{{ parent.name }}</text>
          <text v-if="isReconcile(parent)" class="parent-locked">固定分类</text>
          <text v-else class="parent-count">{{ parent.children.length }} 个子类</text>
          <text
            class="expand-icon"
            :class="{ expanded: expandedIds.includes(parent.id) }"
          >›</text>
        </view>

        <view v-if="expandedIds.includes(parent.id)" class="children">
          <!--
            点子分类名字 -> 进详情页
            点「编辑」   -> 打开编辑弹层
          -->
          <view
            v-for="child in parent.children"
            :key="child.id"
            class="child-row"
          >
            <view class="child-dot" :style="{ backgroundColor: child.color || primaryColor }" />
            <text class="child-name" @click="goDetail(child)">{{ child.name }}</text>
            <text class="child-edit" @click.stop="openEdit(child)">编辑</text>
          </view>

          <view v-if="!isReconcile(parent)" class="child-row child-add" @click="openCreate(parent)">
            <text class="child-add-text">+ 添加子分类</text>
          </view>

          <!-- 固定分类（对账支出 / 对账收入）不能编辑也不能删除 -->
          <view v-if="isReconcile(parent)" class="child-actions">
            <text class="action-lock">固定分类，不可编辑或删除</text>
          </view>
          <view v-else class="child-actions">
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
            <text class="editor-label">图标</text>
            <scroll-view class="icon-scroll" scroll-y>
              <view class="icon-grid">
                <view
                  v-for="opt in iconOptions"
                  :key="opt.key"
                  class="icon-cell"
                  :class="{ active: editorForm.icon === opt.key }"
                  @click="editorForm.icon = opt.key"
                >
                  <text class="icon-emoji">{{ iconEmoji(opt.key) }}</text>
                  <text class="icon-name">{{ opt.label }}</text>
                </view>
              </view>
            </scroll-view>
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
  listCategoryTree, createCategory, updateCategory, deleteCategory,
  isReconcileCategory
} from '@/api/category.js'
import { ICON_OPTIONS, iconEmoji } from '@/utils/icons.js'

export default {
  components: { PageNav, EmptyState },
  setup() {
    const settingStore = useSettingStore()

    const activeType = ref('expense')
    const tree = ref([])
    const expandedIds = ref([])
    const showEditor = ref(false)
    const editingId = ref('')
    const editorForm = reactive({ name: '', color: '', icon: 'more', parent_id: null })

    const iconOptions = ICON_OPTIONS

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

    /** 是不是「对账支出」「对账收入」这类固定分类（不可删改） */
    function isReconcile(cat) {
      return isReconcileCategory(cat)
    }

    function openCreate(parent) {
      // 固定分类下不能再加子分类
      if (parent && isReconcile(parent)) {
        uni.showToast({ title: '固定分类不能添加子分类', icon: 'none' })
        return
      }
      editingId.value = ''
      editorForm.name = ''
      editorForm.color = colors[0]
      // 二级分类继承父级图标与颜色
      editorForm.icon = parent ? (parent.icon || 'more') : 'more'
      if (parent && parent.color) editorForm.color = parent.color
      editorForm.parent_id = parent ? parent.id : null
      showEditor.value = true
    }

    function openEdit(cat) {
      // 固定分类不能改 —— 改名、图标、颜色都不行
      if (isReconcile(cat)) {
        uni.showToast({ title: `「${cat.name}」是固定分类，不能修改`, icon: 'none' })
        return
      }
      editingId.value = cat.id
      editorForm.name = cat.name
      editorForm.color = cat.color || colors[0]
      editorForm.icon = cat.icon || 'more'
      editorForm.parent_id = cat.parent_id
      showEditor.value = true
    }

    async function onSaveCategory() {
      if (!editorForm.name.trim()) {
        uni.showToast({ title: '请填写名称', icon: 'none' })
        return
      }

      // 编辑固定分类 -> 直接拦掉
      //   ★ 不用 flatMap ★
      //     flatMap 要 Chrome 69+/Safari 12+，老 Android WebView 上没有。
      const all = tree.value.slice()
      for (const p of tree.value) {
        for (const c of p.children) all.push(c)
      }
      if (editingId.value) {
        const target = all.find((c) => c.id === editingId.value)
        if (isReconcile(target)) {
          uni.showToast({ title: `「${target.name}」是固定分类，不能修改`, icon: 'none' })
          showEditor.value = false
          return
        }
      }

      try {
        if (editingId.value) {
          await updateCategory(editingId.value, {
            name: editorForm.name.trim(),
            color: editorForm.color,
            icon: editorForm.icon
          })
        } else {
          await createCategory({
            name: editorForm.name.trim(),
            type: activeType.value,
            color: editorForm.color,
            parent_id: editorForm.parent_id,
            icon: editorForm.icon
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
      // 固定分类不能删
      if (isReconcile(cat)) {
        uni.showToast({ title: `「${cat.name}」是固定分类，不能删除`, icon: 'none' })
        return
      }
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

    /**
     * 进分类详情页。
     *
     * ★ 和账户详情 / 标签详情 / 预算详情 / 周期详情同一套结构 ★
     *   详情页里会显示这个分类的汇总卡、本月收支和最近流水，
     *   右上角「全部 ›」会带上分类筛选条件跳到交易列表页。
     */
    function goDetail(cat) {
      if (!cat || !cat.id) return
      uni.navigateTo({ url: `/pages/settings/category-detail?id=${cat.id}` })
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
      iconOptions, iconEmoji,
      primaryColor, pageStyle,
      switchType, toggleExpand, openCreate, openEdit,
      isReconcile, goDetail,
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

.parent-emoji {
  font-size: 34rpx;
  line-height: 1;
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

/* 固定分类（对账支出 / 对账收入）的标记 */
.parent-locked {
  font-size: 20rpx;
  color: var(--app-text-3);
  background-color: var(--app-card-2);
  border-radius: 8rpx;
  padding: 2rpx 10rpx;
}

.action-lock {
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

/* 图标选择 */
.icon-scroll {
  width: 100%;
  max-height: 380rpx;
}

.icon-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.icon-cell {
  width: calc((100% - 60rpx) / 6);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4rpx;
  padding: 12rpx 4rpx;
  border-radius: 12rpx;
  background-color: var(--app-card-2);
  border: 2rpx solid transparent;
}

.icon-cell.active {
  border-color: var(--app-primary);
  background-color: var(--app-primary-light);
}

.icon-emoji {
  font-size: 36rpx;
  line-height: 1.1;
}

.icon-name {
  font-size: 16rpx;
  color: var(--app-text-3);
  text-align: center;
  line-height: 1.2;
}
</style>
