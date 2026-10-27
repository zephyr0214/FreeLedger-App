<template>
  <view class="app-page" :style="pageStyle">
    <PageNav title="标签管理" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y :style="{ height: scrollHeight }">
      <view class="hint-card">
        <text class="hint-text">
          标签就是「项目」。一笔交易可以打多个标签，比如「2026装修」「日本旅行」，
          统计页的「项目统计」会按标签汇总。
        </text>
      </view>

      <view v-if="tags.length === 0" class="empty-wrap">
        <EmptyState
          emoji="🏷️"
          title="还没有标签"
          desc="添加标签后可以按项目统计支出"
          action-text="新建标签"
          @action="openCreate"
        />
      </view>

      <view v-else class="tag-list">
        <view v-for="tag in tags" :key="tag.id" class="tag-row" @click="openEdit(tag)">
          <view class="tag-dot" :style="{ backgroundColor: tag.color || primaryColor }" />
          <text class="tag-name">{{ tag.name }}</text>
          <text class="tag-count">{{ tag.count }} 笔</text>
          <text class="tag-arrow">›</text>
        </view>
      </view>

      <view class="add-wrap">
        <wd-button size="large" plain type="primary" @click="openCreate">
          + 新建标签
        </wd-button>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 编辑弹层 -->
    <wd-popup v-model="showEditor" position="bottom" :safe-area-inset-bottom="true">
      <view class="editor">
        <view class="editor-head">
          <text class="editor-cancel" @click="showEditor = false">取消</text>
          <text class="editor-title">{{ editingId ? '编辑标签' : '新建标签' }}</text>
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
                :key="c"
                class="color-cell"
                :class="{ active: form.color === c }"
                :style="{ backgroundColor: c }"
                @click="form.color = c"
              />
            </view>
          </view>
        </view>

        <view v-if="editingId" class="editor-danger">
          <text class="danger-link" @click="onDelete">删除这个标签</text>
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
import { listTags, createTag, updateTag, deleteTag } from '@/api/tag.js'
import { query } from '@/api/db/index.js'

export default {
  components: { PageNav, EmptyState },
  setup() {
    const settingStore = useSettingStore()

    const tags = ref([])
    const showEditor = ref(false)
    const editingId = ref('')
    const form = reactive({ name: '', color: '' })

    const colors = [
      '#1989FA', '#07C160', '#FF976A', '#7D5FFF',
      '#EE0A24', '#FF8F1F', '#0A8F4A', '#FF6B9D'
    ]

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    const scrollHeight = computed(() => {
      const info = uni.getSystemInfoSync()
      return `${info.windowHeight - (info.statusBarHeight || 20) - 44}px`
    })

    async function load() {
      const list = await listTags()
      // 附带每个标签的交易笔数
      const counts = await query(
        `SELECT tag_id, COUNT(*) AS c FROM txn_tag tt
         JOIN txn t ON t.id = tt.txn_id AND t.deleted_at IS NULL
         GROUP BY tag_id`
      )
      const countMap = {}
      counts.forEach((r) => { countMap[r.tag_id] = Number(r.c) })
      tags.value = list.map((t) => ({ ...t, count: countMap[t.id] || 0 }))
    }

    function openCreate() {
      editingId.value = ''
      form.name = ''
      form.color = colors[0]
      showEditor.value = true
    }

    function openEdit(tag) {
      editingId.value = tag.id
      form.name = tag.name
      form.color = tag.color || colors[0]
      showEditor.value = true
    }

    async function onSave() {
      if (!form.name.trim()) {
        uni.showToast({ title: '请填写名称', icon: 'none' })
        return
      }
      try {
        if (editingId.value) {
          await updateTag(editingId.value, { name: form.name.trim(), color: form.color })
        } else {
          await createTag({ name: form.name.trim(), color: form.color })
        }
        showEditor.value = false
        await load()
        uni.showToast({ title: '已保存', icon: 'success' })
      } catch (e) {
        uni.showModal({ title: '保存失败', content: e.message, showCancel: false })
      }
    }

    function onDelete() {
      uni.showModal({
        title: '删除标签？',
        content: '相关交易不会被删除，只是取消标签关联',
        confirmText: '删除',
        confirmColor: '#ee0a24',
        success: async (res) => {
          if (!res.confirm) return
          try {
            await deleteTag(editingId.value)
            showEditor.value = false
            await load()
            uni.showToast({ title: '已删除', icon: 'success' })
          } catch (e) {
            uni.showModal({ title: '删除失败', content: e.message, showCancel: false })
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
      settingStore, tags, showEditor, editingId, form, colors,
      primaryColor, pageStyle, scrollHeight,
      openCreate, openEdit, onSave, onDelete, goBack
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

.hint-card {
  background-color: var(--app-card);
  border-radius: 16rpx;
  padding: 24rpx;
  margin-top: 16rpx;
}

.hint-text {
  font-size: 23rpx;
  color: var(--app-text-3);
  line-height: 1.7;
}

.empty-wrap {
  background-color: var(--app-card);
  border-radius: 20rpx;
  margin-top: 20rpx;
}

.tag-list {
  background-color: var(--app-card);
  border-radius: 20rpx;
  margin-top: 20rpx;
  overflow: hidden;
}

.tag-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 28rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.tag-row:last-child {
  border-bottom: none;
}

.tag-dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  flex-shrink: 0;
}

.tag-name {
  flex: 1;
  font-size: 28rpx;
  color: var(--app-text);
}

.tag-count {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.tag-arrow {
  font-size: 32rpx;
  color: var(--app-text-3);
}

.add-wrap {
  margin-top: 32rpx;
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

.editor-danger {
  text-align: center;
  padding: 24rpx 0 40rpx;
}

.danger-link {
  font-size: 26rpx;
  color: var(--app-danger);
}
</style>
