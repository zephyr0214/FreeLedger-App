<template>
  <view class="icon-picker">
    <!-- 当前选中：图标 + 名称 + 码点 -->
    <view class="picker-head">
      <view class="selected-icon">
        <image class="selected-img" :src="selectedSrc" mode="aspectFit" />
      </view>
      <view class="selected-info">
        <text class="selected-name">{{ selectedLabel }}</text>
        <text class="selected-code">{{ modelValue || '未选择' }}</text>
      </view>
      <text class="selected-count">共 {{ filtered.length }} 个</text>
    </view>

    <!-- 搜索 -->
    <view class="search-row">
      <input
        v-model="query"
        class="search-input"
        type="text"
        confirm-type="search"
        placeholder="搜索图标（中文 / 英文 / 码点）"
        placeholder-class="search-placeholder"
      />
      <text v-if="query" class="search-clear" @click="query = ''">×</text>
    </view>

    <!-- 分组 -->
    <scroll-view class="group-scroll" scroll-x :show-scrollbar="false">
      <view class="group-row">
        <view
          v-for="g in groupTabs"
          :key="g.key"
          class="group-chip"
          :class="{ active: activeGroup === g.key }"
          @click="activeGroup = g.key"
        >
          <text class="group-chip-text">{{ g.name }}</text>
        </view>
      </view>
    </scroll-view>

    <!-- 图标网格：分批渲染，滑到底再加载下一批 -->
    <scroll-view
      class="icon-scroll"
      :style="{ height: heightText }"
      scroll-y
      :lower-threshold="120"
      @scrolltolower="loadMore"
    >
      <view v-if="visibleIcons.length === 0" class="empty-tip">
        <text class="empty-text">没有匹配的图标</text>
      </view>

      <view v-else class="icon-grid">
        <view
          v-for="row in visibleIcons"
          :key="row[0]"
          class="icon-cell"
          :class="{ active: modelValue === row[0] }"
          @click="pick(row[0])"
        >
          <image
            class="icon-img"
            :src="openmojiSrc(row[0])"
            mode="aspectFit"
            lazy-load
          />
          <text class="icon-name">{{ row[5] || row[1] }}</text>
        </view>
      </view>

      <view v-if="visibleIcons.length > 0" class="load-hint">
        <text class="load-text">
          {{ hasMore ? `继续下滑加载更多（${visibleIcons.length}/${filtered.length}）` : '已显示全部' }}
        </text>
      </view>
    </scroll-view>
  </view>
</template>

<script>
/**
 * OpenMoji 图标选择器
 *
 * ★ 为什么不用一次性渲染全部 4567 个 ★
 *   App 端 WebView 里同时挂 4567 个 <image> 会直接卡死。
 *   这里按 120 个一批渲染，滑到距底部 120rpx 时再追加一批；
 *   搜索 / 切分组时重置回第一批。
 *
 * ★ 搜索范围 ★
 *   - 码点（1F35C）
 *   - 英文名 / tags（OpenMoji annotation）
 *   - 中文名 / 中文 tags（CLDR，部分图标有）
 *   中文是 OpenMoji 上游没有的，生成脚本从 CLDR 合并进来。
 *
 * ★ 分组 ★
 *   12 个 OpenMoji 分组 + 「全部」，横向滚动。
 *   分组名做了中文翻译（见 utils/openmoji.js 的 OPENMOJI_GROUPS）。
 */
import { ref, computed, watch, onMounted } from 'vue'
import {
  OPENMOJI_ICONS, OPENMOJI_GROUPS,
  openmojiSrc, openmojiMeta, openmojiLabel,
  FALLBACK_OPENMOJI_CODE
} from '@/utils/openmoji.js'

const BATCH = 120

export default {
  name: 'CategoryIconPicker',
  props: {
    modelValue: { type: String, default: '' },
    /** 网格可视高度（'560rpx' / '300px'） */
    height: { type: [String, Number], default: '560rpx' }
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const query = ref('')
    const activeGroup = ref('all')
    const renderLimit = ref(BATCH)

    const groupTabs = computed(() => [{ key: 'all', name: '全部' }, ...OPENMOJI_GROUPS])

    /**
     * 过滤后的图标
     *
     * 每条是生成时的紧凑数组：
     *   [hex, 英文名, 分组, 子分组, 搜索词, 中文名, 排序]
     */
    const filtered = computed(() => {
      const q = query.value.trim().toLowerCase()
      const group = activeGroup.value

      let rows = OPENMOJI_ICONS
      if (group !== 'all') rows = rows.filter((r) => r[2] === group)
      if (q) {
        rows = rows.filter((r) => {
          const hay = `${r[0]} ${r[1]} ${r[4]} ${r[5]}`.toLowerCase()
          return hay.indexOf(q) !== -1
        })
      }
      return rows
    })

    const visibleIcons = computed(() => filtered.value.slice(0, renderLimit.value))
    const hasMore = computed(() => filtered.value.length > visibleIcons.value.length)

    const heightText = computed(() =>
      typeof props.height === 'number' ? `${props.height}rpx` : props.height
    )

    const selectedSrc = computed(() => openmojiSrc(props.modelValue))
    const selectedLabel = computed(() => {
      const meta = openmojiMeta(props.modelValue)
      if (!meta) return '未选择图标'
      return openmojiLabel(props.modelValue) || meta.name
    })

    function loadMore() {
      if (!hasMore.value) return
      renderLimit.value += BATCH
    }

    function pick(hex) {
      emit('update:modelValue', hex)
    }

    // 搜索 / 切分组：回到第一批
    watch([query, activeGroup], () => {
      renderLimit.value = BATCH
    })

    /*
     * 外部换了一个图标（打开另一个分类的编辑弹层）：
     * 如果它不在当前分组里，自动切到它所属的组，
     * 让用户一眼看到当前图标周围的选项。
     *
     * 用户自己点选时，新图标必然在当前分组/搜索结果里，
     * 不会触发跳组。
     */
    watch(() => props.modelValue, (v) => {
      const meta = openmojiMeta(v)
      if (!meta) return
      if (activeGroup.value !== 'all' && meta.group !== activeGroup.value) {
        activeGroup.value = meta.group
        query.value = ''
      }
    })

    onMounted(() => {
      /*
       * 新建分类的默认图标就是兜底包裹，没必要把用户丢到「物品」组；
       * 编辑已有分类时，切到它所属的分组，当前图标就在附近。
       */
      const meta = openmojiMeta(props.modelValue)
      if (meta && props.modelValue !== FALLBACK_OPENMOJI_CODE) {
        activeGroup.value = meta.group
      }
    })

    return {
      query, activeGroup, groupTabs, filtered, visibleIcons, hasMore,
      heightText, selectedSrc, selectedLabel,
      openmojiSrc, loadMore, pick
    }
  }
}
</script>

<style scoped>
.icon-picker {
  width: 100%;
}

/* 当前选中 */
.picker-head {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 4rpx 0 16rpx;
}

.selected-icon {
  width: 72rpx;
  height: 72rpx;
  border-radius: 18rpx;
  background-color: var(--app-card-2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.selected-img {
  width: 48rpx;
  height: 48rpx;
}

.selected-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.selected-name {
  font-size: 24rpx;
  color: var(--app-text);
  font-weight: 500;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.selected-code {
  font-size: 18rpx;
  color: var(--app-text-3);
}

.selected-count {
  font-size: 20rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
}

/* 搜索 */
.search-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  background-color: var(--app-card-2);
  border-radius: 14rpx;
  padding: 12rpx 18rpx;
  margin-bottom: 14rpx;
}

.search-input {
  flex: 1;
  font-size: 24rpx;
  color: var(--app-text);
  height: 40rpx;
}

.search-placeholder {
  color: var(--app-text-3);
}

.search-clear {
  font-size: 32rpx;
  color: var(--app-text-3);
  padding: 0 4rpx;
  line-height: 1;
}

/* 分组横滑 */
.group-scroll {
  width: 100%;
  white-space: nowrap;
  margin-bottom: 12rpx;
}

.group-row {
  display: inline-flex;
  gap: 10rpx;
  padding: 2rpx 0;
}

.group-chip {
  flex-shrink: 0;
  padding: 8rpx 18rpx;
  border-radius: 999rpx;
  background-color: var(--app-card-2);
  border: 1rpx solid transparent;
}

.group-chip.active {
  background-color: var(--app-primary-light);
  border-color: var(--app-primary);
}

.group-chip-text {
  font-size: 20rpx;
  color: var(--app-text-2);
}

.group-chip.active .group-chip-text {
  color: var(--app-primary);
  font-weight: 500;
}

/* 网格 */
.icon-scroll {
  width: 100%;
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

.icon-img {
  width: 44rpx;
  height: 44rpx;
}

.icon-name {
  width: 100%;
  font-size: 16rpx;
  color: var(--app-text-3);
  text-align: center;
  line-height: 1.2;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.empty-tip {
  padding: 60rpx 0;
  text-align: center;
}

.empty-text {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.load-hint {
  padding: 24rpx 0 8rpx;
  text-align: center;
}

.load-text {
  font-size: 20rpx;
  color: var(--app-text-3);
}
</style>
