<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="组件管理" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
      <!--
        说明条
        ★ 为什么页面顶部要写这一句 ★
          「勾选框取消 = 面板不显示」这层因果关系不写出来，
          用户会以为是「这个组件被删掉了」，不敢点。
      -->
      <view class="intro-card">
        <text class="intro-text">勾选决定统计页显示哪些面板；上下箭头调整它们的先后顺序。</text>
      </view>

      <!-- ============================ 已显示 ============================ -->
      <view class="group">
        <text class="group-title">已显示（{{ shownRows.length }}）</text>
        <view class="group-list">
          <view v-for="(p, idx) in shownRows" :key="p.key" class="panel-wrap">
            <view class="panel-item">
              <!--
                自绘勾选框：与 ExcludeFlags / 预算页 / 多选弹层是同一套视觉语言
                （方框 + 主题色实底 + 白色对勾）。
                不用 wd-checkbox —— 组件库那套配色/尺寸和项目其它勾选框不一致。
              -->
              <view class="panel-box on" @click="onToggle(p.key, false)">
                <text class="panel-tick">✓</text>
              </view>

              <view class="panel-info">
                <text class="panel-name">{{ p.name }}</text>
                <text class="panel-desc">{{ p.desc }}</text>
              </view>

              <!--
                上下箭头：照组合账户「扣款顺序」那套
                ★ 首行 ↑ / 末行 ↓ 置灰并降低透明度 ★
                  置灰不只是视觉提示，点击也会被 moveStatPanel 的越界判断兜住，
                  不会把顺序弄乱。
              -->
              <view class="panel-ops">
                <text
                  class="panel-op"
                  :class="{ disabled: idx === 0 }"
                  @click="onMove(p.key, -1)"
                >↑</text>
                <text
                  class="panel-op"
                  :class="{ disabled: idx === shownRows.length - 1 }"
                  @click="onMove(p.key, 1)"
                >↓</text>
              </view>

              <!--
                展开箭头：只有 editable 的面板才有
                ★ 为什么不可编辑的面板不画箭头 ★
                  点开一个空设置区比没有箭头更让人困惑。
              -->
              <view
                v-if="p.editable"
                class="panel-expand"
                @click="toggleExpand(p.key)"
              >
                <view class="expand-icon" :class="{ open: expandedKey === p.key }">
                  <LineIcon name="chevronDown" :size="14" :color="iconInk" />
                </view>
              </view>
            </view>

            <!-- 面板设置区（目前只有恩格尔系数有） -->
            <view v-if="p.editable && expandedKey === p.key" class="panel-config">
              <view class="config-row" @click="openFoodPicker">
                <text class="config-label">食品分类</text>
                <view class="config-right">
                  <text class="config-value">{{ foodPickedText }}</text>
                  <text class="config-arrow">›</text>
                </view>
              </view>
              <text class="config-hint">
                选中的支出分类会被算作「食品支出」。恩格尔系数 = 食品支出 ÷ 总支出，
                只统计支出一级分类（选父分类即可，不用选到二级）。
              </text>
              <!--
                已选分类的标签
                ★ :key 用下标而不是分类名 ★
                  用户可以把两个一级分类起同名（「其他」很常见），
                  用名字当 key 会触发 Vue 的重复 key 警告，渲染也会错位。
              -->
              <view v-if="foodNames.length" class="config-tags">
                <text
                  v-for="(n, i) in foodNames"
                  :key="i"
                  class="config-tag"
                >{{ n }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- ============================ 未显示 ============================ -->
      <!--
        未显示分组
        ★ 为什么单独一个分组而不是直接打灰留在上面 ★
          用户要的是「取消勾选后面板落到下方不显示」，
          分组本身就是「它现在不会出现在统计页」的最直观表达。
        ★ 这里不再给上下箭头 ★
          隐藏项没有渲染顺序可言；勾回来时它会回到 order 里原来的位置
          （见 utils/statsPanels.js 的 moveStatPanel 说明），所以不需要在这里排。
      -->
      <view v-if="hiddenRows.length" class="group">
        <text class="group-title">未显示（{{ hiddenRows.length }}）</text>
        <view class="group-list">
          <view
            v-for="p in hiddenRows"
            :key="p.key"
            class="panel-item tappable"
            @click="onToggle(p.key, true)"
          >
            <view class="panel-box" />
            <view class="panel-info">
              <text class="panel-name dim">{{ p.name }}</text>
              <text class="panel-desc">{{ p.desc }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!--
      食品分类多选弹层
      ★ flat 必须传 ★
        默认形态下「有二级的一级分类本身不可选」，
        而恩格尔要选的恰恰是一级分类，所以走平铺模式。
        这个 prop 默认 false，不会影响预算页 / 全部交易筛选的现有行为。
      ★ categories 传一级分类的扁平列表 ★
        组件在 flat 模式下原样渲染传入项，不会再按 parent_id 找分组。
    -->
    <CategoryMultiPickerSheet
      v-model="showFoodPicker"
      :categories="foodPickerCategories"
      :selected-ids="foodIds"
      :flat="true"
      :z-index="110"
      title="选择食品分类"
      @picked="onFoodPicked"
    />

    <!-- 弹窗宿主：确定框统一用组件库样式 -->
    <AppDialog />

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import PageNav from '@/components/PageNav.vue'
import LineIcon from '@/components/LineIcon.vue'
import AppDialog from '@/components/AppDialog.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import CategoryMultiPickerSheet from '@/components/CategoryMultiPickerSheet.vue'
import { useSettingStore } from '@/stores/setting.js'
import { getSetting, setSetting } from '@/api/settings.js'
import { listCategories } from '@/api/category.js'
import { getEngelFoodIds, setEngelFoodIds } from '@/api/engel.js'
import {
  normalizeStatsPanels, visibleStatsPanels, hiddenStatsPanels, moveStatPanel, toggleStatPanel
} from '@/utils/statsPanels.js'
import { isInternalOnlyCategory } from '@/utils/categorySort.js'

/**
 * 统计页「组件管理」
 *
 * ★ 这个页面只做三件事 ★
 *   1. 勾选 / 取消勾选面板（对应 setting.statsPanels.hidden）；
 *   2. 上下箭头调整面板顺序（对应 setting.statsPanels.order）；
 *   3. 给 editable 面板（目前只有恩格尔系数）提供设置区。
 *
 * ★ 为什么顺序逻辑一点都没写在本文件里 ★
 *   排序 / 显隐的归一化与越界处理全在 utils/statsPanels.js，
 *   统计页渲染也读同一份函数。页面自己再写一套的话，
 *   两边对「空 order」「未知 key」的处理就会慢慢分叉。
 *
 * ★ 为什么没有「保存」按钮 ★
 *   用户每点一下都是明确的小操作，即时生效最符合直觉；
 *   加保存按钮反而会产生「点了箭头但忘了保存」的坑。
 */
export default {
  components: { PageNav, LineIcon, AppDialog, UpdateDialog, CategoryMultiPickerSheet },
  setup() {
    const settingStore = useSettingStore()

    /**
     * 面板配置（唯一真相 = setting 表）
     *
     * ★ 存的是 normalize 之后的全量结构 ★
     *   order 含隐藏项（占位），hidden 只存 key。
     *   这样「隐藏 → 勾回来」不会跳位置。
     */
    const panelState = ref(normalizeStatsPanels(null))

    /** 当前展开设置区的面板 key（同时只展开一个，避免页面被撑得很长） */
    const expandedKey = ref('')

    /** 支出全部分类（用来拼「食品分类」的名字，以及给弹层提供一级分类） */
    const categories = ref([])

    /** 用户手选的「算食品」一级支出分类 id */
    const foodIds = ref([])

    const showFoodPicker = ref(false)

    const pageStyle = computed(() => settingStore.cssVars)

    /**
     * LineIcon 用 <image> 加载 SVG data URI，
     * 独立文档里解析不了 var()，颜色必须是真实色值。
     * 与 CyclePanel / TxnPanel 的 iconInk 保持一致。
     */
    const iconInk = computed(() => (settingStore.isDark ? '#A1A1A6' : '#646566'))

    /*
     * 已显示 / 未显示两份列表
     *
     * ★ 直接复用 utils/statsPanels.js 的两个导出，不在页面里再写一遍过滤 ★
     *   「按 order 排、按 hidden 分组」这件事统计页也在做，
     *   页面各写一份的话，某天改了分组口径（比如隐藏项要不要保留占位）
     *   就会出现「管理页显示在已显示、统计页却不渲染」的错位。
     *
     * 统计页那边需要带 key 的 def 数组，这边正好也是 def 数组，
     * 模板里直接用 p.name / p.desc / p.editable。
     */
    const shownRows = computed(() => visibleStatsPanels(panelState.value))
    const hiddenRows = computed(() => hiddenStatsPanels(panelState.value))

    /**
     * 弹层数据源：只取支出的一级分类
     *
     * ★ 为什么排除内部口径分类 ★
     *   报销坏账 / 报销盈余 这些是报销流程自动写的系统分类，
     *   把它们勾成「食品」没有任何意义，只会让恩格尔系数更难解释。
     *   判断逻辑复用 utils/categorySort.js 的 isInternalOnlyCategory，
     *   与记账面板挡掉它们的规则是同一份。
     */
    const foodPickerCategories = computed(() =>
      categories.value
        .filter((c) => !c.parent_id && !isInternalOnlyCategory(c))
        .map((c) => ({
          id: c.id,
          parent_id: '',
          name: c.name,
          /*
           * ★ 这里必须强制 false ★
           *   listCategories 返回的一级分类 isParent 天然是 true；
           *   但 flat 模式下组件不读 isParent，只按传入顺序平铺，
           *   写成 false 是为了万一将来有人在 flat 分支里加了 isParent 判断时，
           *   不会突然变回「父节点不可选」。
           */
          isParent: false
        }))
    )

    /** 「食品分类」这一行右侧的文案 */
    const foodPickedText = computed(() => {
      if (foodIds.value.length === 0) return '未选择'
      return `已选 ${foodIds.value.length} 个`
    })

    /** 已选食品分类的名字（展示成标签，让用户一眼看到选了什么） */
    const foodNames = computed(() => {
      const map = {}
      for (const c of categories.value) map[c.id] = c.name
      return foodIds.value.map((id) => map[id]).filter(Boolean)
    })

    /** 读面板配置 + 食品分类 + 分类列表 */
    async function loadAll() {
      const [raw, ids, cats] = await Promise.all([
        getSetting('statsPanels', null),
        getEngelFoodIds(),
        listCategories('expense')
      ])
      panelState.value = normalizeStatsPanels(raw)
      foodIds.value = ids
      categories.value = cats
    }

    /**
     * 统一写入口
     *
     * ★ 先更新界面、再写库 ★
     *   点箭头要「立刻动」，等 SQLite 回来再重排会有肉眼可见的延迟。
     *   写失败也不回滚：这是本地 KV，失败基本只可能是库里出了大问题，
     *   此时回滚反而让用户看到「点了又弹回去」，更难理解。
     */
    async function persist(next) {
      const normalized = normalizeStatsPanels(next)
      panelState.value = normalized
      try {
        await setSetting('statsPanels', normalized)
      } catch (e) {
        console.warn('[stats-panels] 保存面板配置失败:', e && e.message)
        uni.showToast({ title: '保存失败', icon: 'none' })
      }
    }

    /** 勾选 / 取消勾选 */
    async function onToggle(key, visible) {
      await persist(toggleStatPanel(panelState.value, key, visible))
      // 收起时把它展开的设置区一并收掉，否则面板都隐藏了还挂着一块设置
      if (!visible && expandedKey.value === key) expandedKey.value = ''
      uni.showToast({ title: visible ? '已显示' : '已隐藏', icon: 'none' })
    }

    /** 上移 / 下移（越界时 moveStatPanel 原样返回，界面不动） */
    async function onMove(key, delta) {
      const next = moveStatPanel(panelState.value, key, delta)
      /*
       * ★ 先比、再写 ★
       *   首行点 ↑ / 末行点 ↓ 时 moveStatPanel 会原样返回同一个顺序。
       *   不比较就写库的话，每点一次都白写一次 KV，
       *   而且会给用户「点了有反应」的错误暗示。
       */
      if (next.order.join('|') === panelState.value.order.join('|')) return
      await persist(next)
    }

    /** 展开 / 收起某个面板的设置区 */
    function toggleExpand(key) {
      expandedKey.value = expandedKey.value === key ? '' : key
    }

    function openFoodPicker() {
      showFoodPicker.value = true
    }

    /** 多选弹层确认：存起来并回读（回读能拿到去重后的结果） */
    async function onFoodPicked(ids) {
      try {
        await setEngelFoodIds(ids)
        foodIds.value = await getEngelFoodIds()
        uni.showToast({ title: '已保存', icon: 'success' })
      } catch (e) {
        console.warn('[stats-panels] 保存食品分类失败:', e && e.message)
        uni.showToast({ title: '保存失败', icon: 'none' })
      }
    }

    function goBack() {
      uni.navigateBack()
    }

    /*
     * ★ 用 onShow 而不是 onMounted 读数据 ★
     *   从别处（比如分类管理）改完分类再回到本页时，
     *   分类名 / 可选清单需要重新拿一次 —— onShow 每次回到页面都会触发，
     *   而设置读的是内存 CACHE，成本极低。
     *
     * ★ 为什么设置 store 的 load 也放在这里、而不是 onMounted ★
     *   onShow 与 onMounted 的先后在 uni-app 各端并不统一（App 端首个页面
     *   常见 onShow 先到），把「等设置就绪」写进 onMounted 会出现
     *   「onShow 已经开始读数据、settingStore 还没 loaded」的竞态，
     *   首屏主题变量是空的。这里用 loaded 作守卫，两边谁先到都不会重复加载。
     */
    onShow(async () => {
      try {
        if (!settingStore.loaded) await settingStore.load()
        await loadAll()
      } catch (e) {
        console.warn('[stats-panels] 读取配置失败:', e && e.message)
      }
    })

    return {
      settingStore, pageStyle, iconInk,
      panelState, shownRows, hiddenRows, expandedKey,
      categories, foodIds, foodPickedText, foodNames,
      foodPickerCategories, showFoodPicker,
      onToggle, onMove, toggleExpand, openFoodPicker, onFoodPicked, goBack
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

/* 顶部说明条 */
.intro-card {
  margin-top: 20rpx;
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  background-color: var(--app-card-2);
}

.intro-text {
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--app-text-3);
}

.group {
  margin-top: 24rpx;
}

.group-title {
  display: block;
  font-size: 26rpx;
  color: var(--app-text-3);
  margin-bottom: 12rpx;
}

.group-list {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
}

/* 一个面板 = 主行 + 可能的设置区，两者共用同一张卡片的分隔线 */
.panel-wrap {
  border-bottom: 1rpx solid var(--app-line);
}

.panel-wrap:last-child {
  border-bottom: none;
}

.panel-item {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 22rpx 24rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.panel-item:last-child {
  border-bottom: none;
}

/* 设置区跟在主行后面，主行那条分隔线就多余了 */
.panel-wrap .panel-item {
  border-bottom: none;
}

/* 未显示的行：整行都可以点回来（目标更大，不用对准那个小方框） */
.panel-item.tappable {
  border-bottom: 1rpx solid var(--app-line);
}

/* 未显示列表的最后一行不画底边，否则会和卡片圆角贴出一条多余的线 */
.panel-item.tappable:last-child {
  border-bottom: none;
}

/*
 * 自绘勾选框（照 components/ExcludeFlags.vue 的 .flag-box / .flag-tick）
 * 方框 + 主题色实底 + 白色对勾，深浅色都跟主题变量走。
 */
.panel-box {
  width: 36rpx;
  height: 36rpx;
  border-radius: 8rpx;
  border: 2rpx solid var(--app-line);
  background-color: var(--app-card);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.panel-box.on {
  background-color: var(--app-primary);
  border-color: var(--app-primary);
}

.panel-tick {
  font-size: 22rpx;
  color: #ffffff;
  line-height: 1;
}

.panel-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.panel-name {
  font-size: 28rpx;
  color: var(--app-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 未显示的面板名字压暗一档，表达「现在是关掉的」 */
.panel-name.dim {
  color: var(--app-text-3);
}

.panel-desc {
  font-size: 21rpx;
  color: var(--app-text-3);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/*
 * 上下箭头
 * ★ 尺寸/圆角/底色与组合账户成员的 .member-op 一致 ★
 *   同一个 App 里「调整顺序」应当是同一套控件。
 */
.panel-ops {
  display: flex;
  align-items: center;
  gap: 4rpx;
  flex-shrink: 0;
}

.panel-op {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  color: var(--app-text-2);
  background-color: var(--app-card-2);
  border-radius: 12rpx;
}

/* 首行 ↑ / 末行 ↓：压暗，点上去也明确知道到头了 */
.panel-op.disabled {
  color: var(--app-text-3);
  opacity: 0.4;
}

/* 展开箭头：只有 editable 面板才有，和其它操作之间留一点距离 */
.panel-expand {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-left: 4rpx;
}

.expand-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.18s ease;
}

.expand-icon.open {
  transform: rotate(180deg);
}

/* 面板设置区 */
.panel-config {
  padding: 4rpx 24rpx 24rpx 78rpx;
  background-color: var(--app-card);
}

.config-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 22rpx 24rpx;
  border-radius: 14rpx;
  background-color: var(--app-card-2);
}

.config-label {
  font-size: 26rpx;
  color: var(--app-text);
}

.config-right {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.config-value {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.config-arrow {
  font-size: 30rpx;
  color: var(--app-text-3);
}

.config-hint {
  display: block;
  margin-top: 14rpx;
  font-size: 21rpx;
  line-height: 1.6;
  color: var(--app-text-3);
}

.config-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-top: 14rpx;
}

/* 已选分类标签：主题色浅底 + 主题色字，与周期/组合账户徽标同一套语言 */
.config-tag {
  font-size: 20rpx;
  line-height: 1;
  padding: 8rpx 14rpx;
  border-radius: 8rpx;
  color: var(--app-primary);
  background-color: var(--app-primary-light);
}

.bottom-space {
  height: calc(env(safe-area-inset-bottom) + 40rpx);
}
</style>
