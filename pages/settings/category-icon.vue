<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="选择图标" @back="goBack" />

    <view class="picker-body">
      <!-- 左侧：分组 -->
      <scroll-view class="group-side" scroll-y>
        <view
          v-for="g in groupTabs"
          :key="g.key"
          class="group-item"
          :class="{ active: activeGroup === g.key }"
          @click="selectGroup(g.key)"
        >
          <text class="group-name">{{ g.name }}</text>
          <text class="group-count">{{ g.count }}</text>
        </view>
      </scroll-view>

      <!-- 右侧：搜索 + 图标网格 -->
      <view class="icon-side">
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

        <view class="result-head">
          <text class="result-title">{{ activeGroupName }}</text>
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
              v-for="row in visibleIcons"
              :key="row[0]"
              class="icon-cell"
              :class="{ active: currentIcon === row[0] }"
              @click="choose(row[0])"
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
 * 选择分类图标 —— 独立页面（左侧分组 / 右侧图标）
 *
 * ★ 为什么从编辑器里搬出来 ★
 *   867 个图标塞进编辑弹层时，弹层里还要再套一层滚动区，
 *   滑动很容易和外层滚动打架；用户明确要求：
 *   「图标选择和搜索能不能是一个单独的弹层/页面，
 *     左边选择分类、右边显示图标」。
 *   现在编辑弹层只显示「当前图标 + 名称」一行，点进本页选择。
 *
 * ★ 只保留五个分组 ★
 *   表情 / 人物 / 组件 / 符号 / 旗帜 / 两个扩展组对记账分类没意义，
 *   已在生成元数据和拷贝资源时整体剔除，本页只有：
 *   动物自然、食物饮料、旅行地点、活动、物品（共 867 个）。
 *
 * ★ 选择结果怎么传回 ★
 *   本页 uni.$emit('category-icon-picked', 码点) 后 navigateBack；
 *   分类管理页 onLoad 里 uni.$on 接收，编辑器弹层保持打开。
 *
 * ★ 搜索 ★
 *   输入关键词时自动切到「全部」并全局搜索（中文名 / 英文名 / tags / 码点）；
 *   点左侧分组会清空搜索，只看该组。
 */
import { ref, computed, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import PageNav from '@/components/PageNav.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import {
  OPENMOJI_ICONS, OPENMOJI_GROUPS,
  openmojiSrc, openmojiMeta, categoryIconCode, FALLBACK_OPENMOJI_CODE
} from '@/utils/openmoji.js'

/** 每批渲染多少个图标 */
const BATCH = 100

export default {
  components: { PageNav, UpdateDialog },
  setup() {
    const settingStore = useSettingStore()
    const pageStyle = computed(() => settingStore.cssVars)

    /** 当前已选图标（用于高亮；来自上一页传的 icon 参数） */
    const currentIcon = ref(FALLBACK_OPENMOJI_CODE)
    const activeGroup = ref('all')
    const query = ref('')
    const renderLimit = ref(BATCH)

    const groupTabs = computed(() => {
      const counts = {}
      for (const r of OPENMOJI_ICONS) counts[r[2]] = (counts[r[2]] || 0) + 1
      return [
        { key: 'all', name: '全部', count: OPENMOJI_ICONS.length },
        ...OPENMOJI_GROUPS.map((g) => ({ ...g, count: counts[g.key] || 0 }))
      ]
    })

    const activeGroupName = computed(() => {
      if (query.value.trim()) return '搜索结果'
      const g = groupTabs.value.find((x) => x.key === activeGroup.value)
      return g ? g.name : '全部'
    })

    const filtered = computed(() => {
      const q = query.value.trim().toLowerCase()

      let rows = OPENMOJI_ICONS
      if (activeGroup.value !== 'all') {
        rows = rows.filter((r) => r[2] === activeGroup.value)
      }
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

    /** 切分组：清空搜索、回到第一批 */
    function selectGroup(key) {
      activeGroup.value = key
      query.value = ''
      renderLimit.value = BATCH
    }

    /*
     * 搜索是全局的：一开始输入就切到「全部」，
     * 避免用户以为只搜了左边当前分组。
     */
    watch(query, (v) => {
      renderLimit.value = BATCH
      if (v.trim() && activeGroup.value !== 'all') activeGroup.value = 'all'
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
      // 旧 key / 空值都归一成码点；空值落到包裹兜底
      currentIcon.value = categoryIconCode(raw, '')
      const meta = openmojiMeta(currentIcon.value)
      if (meta) activeGroup.value = meta.group
    })

    return {
      settingStore, pageStyle,
      currentIcon, activeGroup, query, groupTabs, activeGroupName,
      filtered, visibleIcons, hasMore,
      selectGroup, loadMore, choose, goBack, openmojiSrc
    }
  }
}
</script>

<style scoped>
/* 左侧分组 + 右侧图标 */
.picker-body {
  flex: 1;
  height: 0;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.group-side {
  width: 190rpx;
  height: 100%;
  flex-shrink: 0;
  background-color: var(--app-card);
  border-right: 1rpx solid var(--app-line);
}

.group-item {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  padding: 26rpx 16rpx 26rpx 24rpx;
  border-left: 6rpx solid transparent;
}

.group-item.active {
  background-color: var(--app-primary-light);
  border-left-color: var(--app-primary);
}

.group-name {
  font-size: 24rpx;
  color: var(--app-text-2);
  line-height: 1.3;
}

.group-item.active .group-name {
  color: var(--app-primary);
  font-weight: 600;
}

.group-count {
  font-size: 18rpx;
  color: var(--app-text-3);
}

.icon-side {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 20rpx 24rpx env(safe-area-inset-bottom);
}

/* 搜索 */
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

/* 结果标题 */
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

/* 图标网格 */
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

.icon-cell.active {
  border-color: var(--app-primary);
  background-color: var(--app-primary-light);
}

.icon-img {
  width: 68rpx;
  height: 68rpx;
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
