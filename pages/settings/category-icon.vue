<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="选择图标" @back="goBack" />

    <view class="picker-body">
      <!-- 左：六个大类 + 二级分类 -->
      <scroll-view class="group-side" scroll-y>
        <!-- 全部 -->
        <view
          class="all-root"
          :class="{ active: isAllActive }"
          @click="selectAll"
        >
          <text class="all-name">全部图标</text>
          <text class="all-count">{{ totalCount }}</text>
        </view>

        <view v-for="g in groups" :key="g.key" class="group-block">
          <view
            class="group-root"
            :class="{ active: isGroupActive(g) }"
            @click="selectGroup(g)"
          >
            <view class="group-main">
              <text class="group-name">{{ g.name }}</text>
              <text class="group-count">{{ g.count }}</text>
            </view>
            <view
              class="group-toggle"
              :class="{ expanded: expanded[g.key] }"
              @click.stop="toggleGroup(g)"
            >{{ expanded[g.key] ? '−' : '+' }}</view>
          </view>

          <!-- 二级分类 -->
          <view v-if="expanded[g.key]" class="sub-list">
            <view
              v-for="sg in g.subgroups"
              :key="sg.key"
              class="sub-item"
              :class="{ active: isSubActive(g, sg) }"
              @click="selectSub(g, sg)"
            >
              <text class="sub-name">{{ sg.name }}</text>
              <text class="sub-count">{{ sg.icons.length }}</text>
            </view>
          </view>
        </view>
      </scroll-view>

      <!-- 右：搜索 + 图标网格 -->
      <view class="icon-side">
        <view class="search-row">
          <input
            v-model="query"
            class="search-input"
            type="text"
            confirm-type="search"
            placeholder="搜索图标（中文 / 码点）"
            placeholder-class="search-placeholder"
          />
          <text v-if="query" class="search-clear" @click="query = ''">×</text>
        </view>

        <view class="result-head">
          <text class="result-title">{{ resultTitle }}</text>
          <text class="result-count">{{ filtered.length }} 个</text>
        </view>

        <scroll-view
          class="icon-scroll"
          scroll-y
          :lower-threshold="120"
          @scrolltolower="loadMore"
        >
          <view v-if="filtered.length === 0" class="empty-tip">
            <text class="empty-text">没有匹配的图标</text>
          </view>

          <view v-else class="icon-grid">
            <view
              v-for="item in visibleIcons"
              :key="item.hex"
              class="icon-cell"
              :class="{ active: currentIcon === item.hex, 'icon-cell--bare': settingStore.isDark }"
              @click="choose(item.hex)"
            >
              <CategoryGlyph
                :icon="item.hex"
                :name="item.name"
                size="68rpx"
                :remote-size="60"
                :loading-fallback="false"
              />
              <text class="icon-name">{{ item.name }}</text>
            </view>
          </view>

          <view v-if="visibleIcons.length > 0" class="load-hint">
            <text class="load-text">
              {{ hasMore ? '继续下滑加载更多' : '已显示全部' }}
            </text>
          </view>
        </scroll-view>
      </view>
    </view>

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
/**
 * 选择分类图标 —— 独立页面（左侧大类/二级分类，右侧联网图标）
 *
 * ★ 图标不下载，联网读取 ★
 *   元数据只保存码点和名称（utils/emojiData.js，约 42KB），
 *   图片按码点拼当前样式的 CDN 地址，交给 <image> 按需加载。
 *   加载中 / 失败时 CategoryGlyph 会显示系统 emoji，不会出现空白。
 *
 * ★ 二级分类 ★
 *   左侧六个大类可以展开，展开后显示图库的二级分类
 *   （职业与角色、哺乳动物、陆路交通、球类…）；点二级分类只看这一组。
 *   搜索是全局的：输入关键词时忽略当前分组，搜全部 1037 个图标。
 *
 * ★ 选择结果怎么传回 ★
 *   uni.$emit('category-icon-picked', 码点) 后 navigateBack；
 *   分类管理页 onLoad 里 uni.$on 接收，编辑器弹层保持打开。
 */
import { ref, reactive, computed, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import PageNav from '@/components/PageNav.vue'
import CategoryGlyph from '@/components/CategoryGlyph.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import {
  EMOJI_GROUPS, EMOJI_LIST,
  categoryIconCode, emojiMeta, FALLBACK_EMOJI_CODE
} from '@/utils/emoji.js'

/** 每批渲染多少个图标 */
const BATCH = 40

export default {
  components: { PageNav, CategoryGlyph, UpdateDialog },
  setup() {
    const settingStore = useSettingStore()
    const pageStyle = computed(() => settingStore.cssVars)

    /** 当前已选图标（用于高亮；来自上一页传的 icon 参数） */
    const currentIcon = ref(FALLBACK_EMOJI_CODE)
    const activeGroup = ref('all')
    const activeSub = ref('')
    const query = ref('')
    const renderLimit = ref(BATCH)

    /** 左侧大类的展开状态 */
    const expanded = reactive({})
    for (const g of EMOJI_GROUPS) expanded[g.key] = false

    /** 六个大类 + 每组的图标数 */
    const groups = computed(() =>
      EMOJI_GROUPS.map((g) => ({
        ...g,
        count: g.subgroups.reduce((n, sg) => n + sg.icons.length, 0)
      }))
    )

    const totalCount = EMOJI_LIST.length

    const isAllActive = computed(() => !query.value && activeGroup.value === 'all')

    function isGroupActive(g) {
      return !query.value && activeGroup.value === g.key && !activeSub.value
    }

    function isSubActive(g, sg) {
      return !query.value && activeGroup.value === g.key && activeSub.value === sg.key
    }

    const filtered = computed(() => {
      const q = query.value.trim().toLowerCase()

      // 搜索：全局，不受左侧选择影响
      if (q) {
        return EMOJI_LIST.filter((e) => e.search.indexOf(q) !== -1)
      }

      if (activeSub.value) {
        return EMOJI_LIST.filter((e) => e.subgroup === activeSub.value)
      }

      if (activeGroup.value !== 'all') {
        return EMOJI_LIST.filter((e) => e.group === activeGroup.value)
      }

      return EMOJI_LIST
    })

    const visibleIcons = computed(() => filtered.value.slice(0, renderLimit.value))
    const hasMore = computed(() => filtered.value.length > visibleIcons.value.length)

    const resultTitle = computed(() => {
      if (query.value.trim()) return '搜索结果'

      if (activeSub.value) {
        const item = EMOJI_LIST.find((e) => e.subgroup === activeSub.value)
        return item ? item.subgroupName : '全部图标'
      }

      if (activeGroup.value !== 'all') {
        const g = groups.value.find((x) => x.key === activeGroup.value)
        return g ? g.name : '全部图标'
      }

      return '全部图标'
    })

    function selectAll() {
      activeGroup.value = 'all'
      activeSub.value = ''
      query.value = ''
      renderLimit.value = BATCH
    }

    function selectGroup(g) {
      activeGroup.value = g.key
      activeSub.value = ''
      query.value = ''
      expanded[g.key] = true
      renderLimit.value = BATCH
    }

    function toggleGroup(g) {
      const next = !expanded[g.key]
      expanded[g.key] = next

      if (next) {
        activeGroup.value = g.key
        activeSub.value = ''
        query.value = ''
      } else if (activeGroup.value === g.key) {
        // 收起时把选中退回「该大类全部」，避免选中项藏在已折叠的列表里
        activeSub.value = ''
      }
      renderLimit.value = BATCH
    }

    function selectSub(g, sg) {
      activeGroup.value = g.key
      activeSub.value = sg.key
      expanded[g.key] = true
      query.value = ''
      renderLimit.value = BATCH
    }

    // 搜索 / 切换分组时回到第一批
    watch([query, activeGroup, activeSub], () => {
      renderLimit.value = BATCH
    })

    function loadMore() {
      if (!hasMore.value) return
      renderLimit.value += BATCH
    }

    function choose(hex) {
      uni.$emit('category-icon-picked', hex)
      uni.navigateBack()
    }

    function goBack() {
      uni.navigateBack()
    }

    onLoad((options) => {
      const raw = decodeURIComponent((options && options.icon) || '')
      currentIcon.value = categoryIconCode(raw, '')
      const meta = emojiMeta(currentIcon.value)
      if (meta) {
        activeGroup.value = meta.group
        activeSub.value = meta.subgroup
        expanded[meta.group] = true
      }
    })

    return {
      settingStore, pageStyle,
      currentIcon, activeGroup, activeSub, query, expanded,
      groups, totalCount, filtered, visibleIcons, hasMore, resultTitle,
      isAllActive, isGroupActive, isSubActive,
      selectAll, selectGroup, toggleGroup, selectSub,
      loadMore, choose, goBack
    }
  }
}
</script>

<style scoped>
/* 左侧大类 + 右侧图标 */
.picker-body {
  flex: 1;
  height: 0;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.group-side {
  width: 240rpx;
  height: 100%;
  flex-shrink: 0;
  background-color: var(--app-card);
  border-right: 1rpx solid var(--app-line);
}

/* 全部 */
.all-root {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 18rpx 24rpx 24rpx;
  border-left: 6rpx solid transparent;
}

.all-root.active {
  background-color: var(--app-primary-light);
  border-left-color: var(--app-primary);
}

.all-name {
  font-size: 24rpx;
  color: var(--app-text-2);
  font-weight: 500;
}

.all-root.active .all-name {
  color: var(--app-primary);
}

.all-count {
  font-size: 18rpx;
  color: var(--app-text-3);
}

/* 大类 */
.group-block {
  border-top: 1rpx solid var(--app-line);
}

.group-root {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 20rpx 12rpx 20rpx 24rpx;
  border-left: 6rpx solid transparent;
}

.group-root.active {
  background-color: var(--app-primary-light);
  border-left-color: var(--app-primary);
}

.group-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2rpx;
}

.group-name {
  font-size: 24rpx;
  color: var(--app-text-2);
  line-height: 1.3;
}

.group-root.active .group-name {
  color: var(--app-primary);
  font-weight: 600;
}

.group-count {
  font-size: 18rpx;
  color: var(--app-text-3);
}

.group-toggle {
  width: 34rpx;
  height: 34rpx;
  border-radius: 50%;
  border: 1rpx solid var(--app-line);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24rpx;
  line-height: 1;
  color: var(--app-text-3);
  flex-shrink: 0;
}

.group-toggle.expanded {
  color: var(--app-primary);
  border-color: var(--app-primary);
}

/* 二级分类 */
.sub-list {
  padding: 2rpx 0 8rpx;
  background-color: var(--app-bg-2);
}

.sub-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8rpx;
  padding: 14rpx 16rpx 14rpx 48rpx;
  border-left: 6rpx solid transparent;
}

.sub-item.active {
  background-color: var(--app-primary-light);
  border-left-color: var(--app-primary);
}

.sub-name {
  font-size: 21rpx;
  color: var(--app-text-3);
  line-height: 1.3;
}

.sub-item.active .sub-name {
  color: var(--app-primary);
  font-weight: 500;
}

.sub-count {
  font-size: 17rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
}

/* 右侧 */
.icon-side {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 20rpx 24rpx env(safe-area-inset-bottom);
}

.search-row {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12rpx;
  /* 白底（暗色下是卡片色）：和页面底色拉开层次 */
  background-color: var(--app-card);
  border: 1rpx solid var(--app-line);
  border-radius: 14rpx;
  padding: 12rpx 18rpx;
}

.search-input {
  flex: 1;
  height: 40rpx;
  font-size: 24rpx;
  color: var(--app-text);
}

.search-placeholder {
  color: var(--app-text-3);
}

.search-clear {
  font-size: 32rpx;
  line-height: 1;
  color: var(--app-text-3);
  padding: 0 4rpx;
}

.result-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18rpx 4rpx 12rpx;
}

.result-title {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--app-text);
}

.result-count {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.icon-scroll {
  flex: 1;
  height: 0;
}

.icon-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  padding-bottom: 20rpx;
}

.icon-cell {
  width: calc((100% - 36rpx) / 4);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
  padding: 14rpx 4rpx;
  border-radius: 14rpx;
  background-color: var(--app-card-2);
  border: 2rpx solid transparent;
  box-sizing: border-box;
}

/*
 * ★ 暗色模式不要给每个图标铺灰底（用户要求）★
 *   深色下 --app-card-2 是一块比背景亮的灰色方块，
 *   一屏几十个图标全是灰块，很脏；改成透明，
 *   只保留选中项的淡主题色底和描边。
 */
.icon-cell--bare {
  background-color: transparent;
}

.icon-cell.active {
  border-color: var(--app-primary);
  background-color: var(--app-primary-light);
}

.icon-name {
  width: 100%;
  font-size: 16rpx;
  line-height: 1.2;
  color: var(--app-text-3);
  text-align: center;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.empty-tip {
  padding: 80rpx 0;
  text-align: center;
}

.empty-text {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.load-hint {
  padding: 20rpx 0 8rpx;
  text-align: center;
}

.load-text {
  font-size: 20rpx;
  color: var(--app-text-3);
}
</style>
