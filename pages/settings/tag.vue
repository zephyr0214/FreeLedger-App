<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="标签管理" @back="goBack">
      <!-- 右上角：新增标签 -->
      <template #right>
        <view class="nav-add" @click="openCreate">
          <LineIcon name="plusLine" :size="20" :color="primaryColor" />
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
            <view class="tag-main">
              <view class="tag-title-row">
                <view class="tag-dot" :style="{ backgroundColor: tag.color || primaryColor }" />
                <text class="tag-name">{{ tag.name }}</text>
              </view>
              <text class="tag-recent">{{ tagRecentText(tag) }}</text>
            </view>
            <view class="tag-right">
              <MoneyText
                :cents="tag.balance_cents || 0"
                variant="balance"
                color="var(--app-text)"
                :size="26"
                :weight="600"
              />
              <text class="tag-count">{{ tag.txn_count || 0 }} 笔</text>
            </view>
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

    <!-- 标签编辑 / 新建弹层（与标签选择面板里的「添加标签」共用） -->
    <TagEditorSheet
      v-model="showEditor"
      :tag="editingTag"
      @saved="onEditorSaved"
      @deleted="onEditorDeleted"
    />

    <!-- 弹窗宿主：确定框统一用组件库样式 -->
    <AppDialog />

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { onBackPress, onShow } from '@dcloudio/uni-app'
import PageNav from '@/components/PageNav.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppDialog from '@/components/AppDialog.vue'
import LineIcon from '@/components/LineIcon.vue'
import MoneyText from '@/components/MoneyText.vue'
import TagEditorSheet from '@/components/TagEditorSheet.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { listTags, deleteTag } from '@/api/tag.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'
import { handleBackPress } from '@/utils/layerStack.js'
import { chineseDayLabel, relativeDayFromDayKey } from '@/utils/date.js'

export default {
  components: { PageNav, EmptyState, AppDialog, LineIcon, MoneyText, TagEditorSheet, UpdateDialog },
  setup() {
    const settingStore = useSettingStore()

    const tags = ref([])
    const showEditor = ref(false)
    const editingTag = ref(null)

    /**
     * wd-swipe-action 的展开状态。
     * key 是标签 id，值是该行当前是否展开（右滑打开）。
     */
    const swipeStates = reactive({})

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
      // 笔数 / 结余 / 最近使用日都在 listTags 的聚合查询里，
      // 页面不再单独查一次 txn_tag，也不会出现两处口径不一致。
      tags.value = await listTags()
    }

    /**
     * 「最近于2026年11月17日 · 20天前」
     *
     * 没有关联流水时不给假日期，直接说明还没用过。
     */
    function tagRecentText(tag) {
      if (!tag || !tag.last_day) return '暂无交易记录'
      return `最近于${chineseDayLabel(tag.last_day)} · ${relativeDayFromDayKey(tag.last_day)}`
    }

    function openCreate() {
      editingTag.value = null
      showEditor.value = true
    }

    function openEdit(tag) {
      editingTag.value = tag
      showEditor.value = true
    }

    /** 点整行 -> 标签详情页 */
    function goDetail(tag) {
      uni.navigateTo({ url: `/pages/settings/tag-detail?id=${tag.id}` })
    }

    /** 编辑弹层保存成功：重新读标签列表 */
    async function onEditorSaved() {
      await load()
    }

    /** 编辑弹层删除成功：重新读标签列表 */
    async function onEditorDeleted() {
      await load()
    }

    function goBack() {
      uni.navigateBack()
    }

    /**
     * 编辑面板收起（取消/保存/删除/点遮罩）时，把右滑露出的「编辑」按钮也收起。
     * 否则用户关掉弹层后，行还保持着右滑展开状态，很别扭。
     *
     * ★ 编辑弹层自己的弹层栈由 TagEditorSheet 登记 ★
     *   页面这里只负责收起右滑状态。
     *
     * ★ 值必须是 'close' 而不是 false ★
     *   wd-swipe-action 的 modelValue 是字符串（'left' | 'close' | 'right'），
     *   传 false 会触发「Expected String, got Boolean」的类型警告，而且不生效。
     */
    watch(showEditor, (open) => {
      if (open) return
      const id = editingTag.value && editingTag.value.id
      if (id) swipeStates[id] = 'close'
    })

    // 侧滑返回 / 返回键：标签编辑弹层打开时先收起弹层
    onBackPress(() => handleBackPress())

    /**
     * 回到本页重新读标签
     *
     * ★ 标签顺序是「最近使用」★
     *   在别的页面给流水打了标签后返回，本页的 tags 缓存还是旧的；
     *   不重查就会看到「顺序没变」。首次 onShow 跳过（onMounted 已查）。
     */
    let shownOnce = false
    onShow(() => {
      if (!shownOnce) {
        shownOnce = true
        return
      }
      load().catch((e) => {
        console.warn('[tag] 刷新标签失败:', e && e.message)
      })
    })

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await load()
    })

    return {
      settingStore, tags, showEditor, editingTag, swipeStates,
      primaryColor, pageStyle,
      openCreate, openEdit, goDetail, onEditorSaved, onEditorDeleted, onDeleteTag, goBack,
      tagRecentText
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
  padding: 24rpx 28rpx;
  border-bottom: 1rpx solid var(--app-line);
  background-color: var(--app-card);
}

.tag-row:last-child {
  border-bottom: none;
}

/* 标签色块：小的圆角方形，只放在标签名之前 */
.tag-dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 4rpx;
  flex-shrink: 0;
}

/*
 * 中间列：第一行是「色块 + 标签名」，第二行是最近使用时间。
 * ★ 灰色小字与色块左边缘对齐 ★
 *   所以色块不能单独占一列，必须缩进到名称行内部；
 *   第二行直接从 .tag-main 的左边缘开始。
 */
.tag-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.tag-title-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  min-width: 0;
}

.tag-name {
  font-size: 28rpx;
  color: var(--app-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tag-recent {
  font-size: 22rpx;
  color: var(--app-text-3);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 右侧列：结余金额在上，总笔数在下，都靠右 */
.tag-right {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8rpx;
}

.tag-count {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.tag-arrow {
  font-size: 32rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
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
  justify-content: center;
  gap: 12rpx 8rpx;
  width: 100%;
}

/* 16 色：每行 8 个，色块 + 中文名（与分类页一致） */
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

.editor-danger {
  text-align: center;
  padding: 24rpx 0 40rpx;
}

.danger-link {
  font-size: 26rpx;
  color: var(--app-danger);
}
</style>
