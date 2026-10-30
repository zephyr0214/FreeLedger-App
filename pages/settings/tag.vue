<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="标签管理" @back="goBack">
      <!-- 右上角：新增标签 -->
      <template #right>
        <view class="nav-add" @click="openCreate">
          <LineIcon name="plus" :size="20" :color="primaryColor" />
        </view>
      </template>
    </PageNav>

    <scroll-view class="page-scroll" scroll-y>
      <view v-if="tags.length === 0" class="empty-wrap">
        <EmptyState
          emoji="🏷️"
          title="还没有标签"
          desc="添加标签后可以按标签汇总收支"
          action-text="新建标签"
          @action="openCreate"
        />
      </view>

      <view v-else class="tag-list">
        <!--
          ★ 交互约定 ★
            点整行    -> 进标签详情页（看这个标签的流水与统计）
            右滑      -> 露出「编辑」和「删除」两个操作
            点「编辑」 -> 打开编辑弹层
            点「删除」 -> 二次确认后删除

          ★ 为什么编辑改成右滑 ★
            列表右侧原本放了一个「编辑」文字按钮，
            和右侧的「›」箭头挤在一起，视觉很乱；
            而且行内按钮在小屏幕上容易误触。
            改成右滑露出操作区（和账户页的「设为默认」同一套交互），
            列表本身更干净。
        -->
        <wd-swipe-action
          v-for="tag in tags"
          :key="tag.id"
          v-model="swipeStates[tag.id]"
          class="tag-swipe"
        >
          <view class="tag-row" @click="goDetail(tag)">
            <view class="tag-dot" :style="{ backgroundColor: tag.color || primaryColor }" />
            <text class="tag-name">{{ tag.name }}</text>
            <text class="tag-count">{{ tag.count }} 笔</text>
            <text class="tag-arrow">›</text>
          </view>

          <!--
            右滑操作区：编辑 + 删除

            ★ 为什么这里用插槽内容自己的 @click.stop ★
              wd-swipe-action 的整个右滑区域只会 emit 一个
              { value: 'right' } 事件，分不出是哪个按钮 ——
              它的模板是 <view class="wd-swipe-action__right" @click="onClick('right')">
              里面放几个 view 都一样。
              所以两个按钮各自绑 @click.stop，自己处理。
              .stop 阻止冒泡到外层的 onClick('right')，避免重复触发。
          -->
          <template #right>
            <view class="swipe-edit" :style="{ backgroundColor: primaryColor }" @click.stop="openEdit(tag)">
              <text class="swipe-action-text">编辑</text>
            </view>
            <view class="swipe-delete" style="background-color: var(--app-danger)" @click.stop="onDeleteTag(tag)">
              <text class="swipe-action-text">删除</text>
            </view>
          </template>
        </wd-swipe-action>
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

    <!-- 弹窗宿主：确定框统一用组件库样式 -->
    <AppDialog />
  </view>
</template>

<script>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { onBackPress } from '@dcloudio/uni-app'
import PageNav from '@/components/PageNav.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppDialog from '@/components/AppDialog.vue'
import LineIcon from '@/components/LineIcon.vue'
import { useSettingStore } from '@/stores/setting.js'
import { listTags, createTag, updateTag, deleteTag } from '@/api/tag.js'
import { query } from '@/api/db/index.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'
import { pushLayer, handleBackPress } from '@/utils/layerStack.js'

export default {
  components: { PageNav, EmptyState, AppDialog, LineIcon },
  setup() {
    const settingStore = useSettingStore()

    const tags = ref([])
    const showEditor = ref(false)
    const editingId = ref('')
    const form = reactive({ name: '', color: '' })

    /**
     * wd-swipe-action 的展开状态。
     * key 是标签 id，值是该行当前是否展开（右滑打开）。
     */
    const swipeStates = reactive({})

    const colors = [
      '#1989FA', '#07C160', '#FF976A', '#7D5FFF',
      '#EE0A24', '#FF8F1F', '#0A8F4A', '#FF6B9D'
    ]

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    /**
     * 右滑「删除」按钮。
     *
     * 标签本身是软删除（deleted_at），
     * 相关交易不会被删，只是取消标签关联。
     */
    async function onDeleteTag(tag) {
      if (!tag || !tag.id) return
      const ok = await confirmDialog({
        title: `删除标签「${tag.name}」？`,
        content: '相关交易不会被删除，只是取消标签关联',
        confirmText: '删除',
        danger: true
      })
      if (!ok) return
      try {
        await deleteTag(tag.id)
        await load()
        uni.showToast({ title: '已删除', icon: 'success' })
      } catch (e) {
        await alertDialog({ title: '删除失败', content: e.message })
      }
    }

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

    /** 点整行 -> 标签详情页 */
    function goDetail(tag) {
      uni.navigateTo({ url: `/pages/settings/tag-detail?id=${tag.id}` })
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
        await alertDialog({ title: '保存失败', content: e.message })
      }
    }

    async function onDelete() {
      const ok = await confirmDialog({
        title: '删除标签？',
        content: '相关交易不会被删除，只是取消标签关联',
        confirmText: '删除',
        danger: true
      })
      if (!ok) return
      try {
        await deleteTag(editingId.value)
        showEditor.value = false
        await load()
        uni.showToast({ title: '已删除', icon: 'success' })
      } catch (e) {
        await alertDialog({ title: '删除失败', content: e.message })
      }
    }

    function goBack() {
      uni.navigateBack()
    }

    /**
     * 编辑面板收起（取消/保存/删除）时，把右滑露出的「编辑」按钮也收起。
     * 否则用户关掉弹层后，行还保持着右滑展开状态，很别扭。
     *
     * ★ 值必须是 'close' 而不是 false ★
     *   wd-swipe-action 的 modelValue 是字符串（'left' | 'close' | 'right'），
     *   传 false 会触发「Expected String, got Boolean」的类型警告，而且不生效。
     */
    watch(showEditor, (open) => {
      if (open) {
        // 编辑弹层打开 → 登记进弹层栈，侧滑返回先收起它而不是退出本页
        if (!unregisterLayer) {
          unregisterLayer = pushLayer(() => { showEditor.value = false }, 'tagEditor')
        }
        return
      }
      if (unregisterLayer) {
        unregisterLayer()
        unregisterLayer = null
      }
      const id = editingId.value
      if (id) swipeStates[id] = 'close'
    })

    /** 弹层栈注销函数 */
    let unregisterLayer = null

    onUnmounted(() => {
      if (unregisterLayer) {
        unregisterLayer()
        unregisterLayer = null
      }
    })

    // 侧滑返回 / 返回键：标签编辑弹层打开时先收起弹层
    onBackPress(() => handleBackPress())

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await load()
    })

    return {
      settingStore, tags, showEditor, editingId, form, colors, swipeStates,
      primaryColor, pageStyle,
      openCreate, openEdit, goDetail, onSave, onDelete, onDeleteTag, goBack
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
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

/*
  wd-swipe-action 的外层。
  组件需要知道内容区的圆角裁剪，所以外层也要跟着圆角。
*/
.tag-swipe {
  display: block;
}

.tag-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 28rpx;
  border-bottom: 1rpx solid var(--app-line);
  background-color: var(--app-card);
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

/* 右滑操作区：编辑 / 删除 */
.swipe-edit,
.swipe-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 150rpx;
  height: 100%;
}

.swipe-action-text {
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 500;
}

/* 右上角：新增（尺寸换算：20px ≈ 40rpx） */
.nav-add {
  width: 60rpx;
  height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: center;
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
