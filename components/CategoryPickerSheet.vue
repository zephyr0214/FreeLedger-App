<template>
  <wd-popup
    v-model="visible"
    position="bottom"
    :z-index="110"
    :safe-area-inset-bottom="true"
    custom-style="background-color: var(--app-card); border-radius: 28rpx 28rpx 0 0;"
  >
    <view class="more-sheet">
      <view class="more-sheet-head">
        <text class="more-sheet-title">选择分类</text>
        <view class="more-sheet-actions">
          <text class="more-sheet-add" @click="openAddRoot">+ 添加分类</text>
          <text class="more-sheet-close" @click="close">关闭</text>
        </view>
      </view>

      <scroll-view class="more-sheet-scroll" scroll-y>
        <view class="more-groups">
          <view v-for="sec in sections" :key="sec.key" class="more-group">
            <!--
              一级分类的分组标题。
              ★ 没有子类的一级分类也要显示 ★
                它和有子类的父级一样需要一行「图标 + 名称」，
                否则用户看到的是孤零零一个格子，不知道它其实也能加子类。
            -->
            <view class="group-head">
              <view class="group-icon" :style="groupIconStyle(sec.parent)">
                <CategoryGlyph :icon="sec.parent.icon" :name="sec.parent.name" size="28rpx" :remote-size="60" />
              </view>
              <text class="group-name">{{ sec.parent.name }}</text>
              <!--
                ★ 右侧「添加子类」★
                  固定分类（系统分类及其固定子类）的结构锁死，不显示入口；
                  其它一级分类都可以在自己的组头里直接添加子类。
              -->
              <text
                v-if="canAddChild(sec.parent)"
                class="group-add"
                @click.stop="openAddChild(sec.parent)"
              >+ 添加子类</text>
            </view>

            <view class="more-grid">
              <view
                v-for="cat in sec.members"
                :key="cat.id"
                class="more-item"
                :class="{ active: selectedId === cat.id }"
                @click="onPick(cat)"
              >
                <view class="more-icon-wrap" :style="iconStyle(cat, selectedId === cat.id)">
                  <CategoryGlyph :icon="cat.icon" :name="cat.name" size="44rpx" :remote-size="60" />
                </view>
                <text
                  class="more-name"
                  :style="{
                    color: selectedId === cat.id ? 'var(--app-text)' : 'var(--app-text-2)'
                  }"
                >{{ cat.name }}</text>
              </view>
            </view>
          </view>
        </view>
      </scroll-view>
    </view>
  </wd-popup>

  <!-- 新建分类 / 添加子类：复用分类管理页同一个编辑弹层，叠在分类面板之上 -->
  <CategoryEditorSheet
    v-model="showEditor"
    :parent="editorParent"
    :type="editorParent ? editorParent.type : type"
    @saved="onCategorySaved"
  />
</template>

<script>
/**
 * 「更多分类」弹层 —— 按一级分类分组显示
 *
 * ★ 为什么抽成独立组件 ★
 *   记账弹层（TxnPanel）和周期弹层（CyclePanel）里的「更多分类」
 *   是同一段东西：同样的头部、同样的网格、同样的一套配色规则。
 *   以前两份各写各的，改配色要改两处、很容易改漏。
 *   抽出来以后，配色与分组规则只维护一份。
 *
 * ★ 展示形态 ★
 *   1. 按**一级分类**分组：标题是一级分类（带图标），下面是它的二级分类；
 *   2. 「没有二级」的一级分类同样显示分组标题，和父级分类一致；
 *   3. 组头右侧提供「+ 添加子类」，直接在当前面板上叠出分类编辑弹层；
 *   4. 图标配色与交易流水一致：**浅色底 + 本色图标**（见 utils/categoryIcon.js）。
 *
 * ★ 分组顺序 ★
 *   组按「组内第一个分类」在传入列表里的位置排序，
 *   而传入列表已按最近 30 天使用频率排好序 ——
 *   所以最常用的分类所在的那一组一定排在最前面。
 */
import { computed, ref, watch, onUnmounted } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import CategoryGlyph from '@/components/CategoryGlyph.vue'
import CategoryEditorSheet from '@/components/CategoryEditorSheet.vue'
import { groupCategoriesByParent } from '@/utils/categorySort.js'
import { categoryIconFullStyle, categoryGroupIconStyle } from '@/utils/categoryIcon.js'
import { isFixedCategory } from '@/api/category.js'
import { pushLayer } from '@/utils/layerStack.js'

export default {
  name: 'CategoryPickerSheet',
  components: { CategoryGlyph, CategoryEditorSheet },
  props: {
    modelValue: { type: Boolean, default: false },
    /** 可选分类（已按使用频率排序） */
    categories: { type: Array, default: () => [] },
    /** 当前类型下的全部分类（用来找一级分类） */
    allCategories: { type: Array, default: () => [] },
    /** 当前选中的分类 id */
    selectedId: { type: String, default: '' },
    /** 新建一级分类时的收支类型 */
    type: { type: String, default: 'expense' }
  },
  emits: ['update:modelValue', 'pick-category', 'category-created'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const primaryColor = computed(() => settingStore.primaryColor)

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    /** 分类编辑弹层：parent 为空 = 新建一级分类，有值 = 添加子类 */
    const showEditor = ref(false)
    const editorParent = ref(null)

    /**
     * 分组结果。
     *
     * 每项：{ key, parent, title, icon, members }
     *   现在所有组都显示父级标题（含没有子类的一级分类）。
     */
    const sections = computed(() =>
      groupCategoriesByParent(props.categories, props.allCategories).map((g) => ({
        key: g.parent.id,
        parent: g.parent,
        title: g.parent.name,
        members: g.members
      }))
    )

    /**
     * 这个父级能不能添加子类
     *
     * 固定分类（系统分类及其固定子类）的结构锁死，不能加；
     * 二级分类不能再往下加，避免出现三级分类。
     */
    function canAddChild(parent) {
      if (!parent || parent.parent_id) return false
      return !isFixedCategory(parent)
    }

    function openAddChild(parent) {
      if (!canAddChild(parent)) return
      editorParent.value = parent
      showEditor.value = true
    }

    /** 新建一级分类 */
    function openAddRoot() {
      editorParent.value = null
      showEditor.value = true
    }

    function onCategorySaved(category) {
      showEditor.value = false
      emit('category-created', category)
    }

    /**
     * 分类图标的配色（未选中浅灰底；选中浅色底 + 主题色圈；图标始终是分类本色）
     *
     * ★ 选中态多一圈主题色描边 ★
     *   和记账面板 / 周期面板走同一个函数（categoryIconFullStyle），
     *   三处的选中观感完全一致。
     */
    function iconStyle(cat, active) {
      return categoryIconFullStyle(cat, primaryColor.value, active, settingStore.isDark)
    }

    /** 分组标题（一级分类）的图标配色：始终是分类色的浅色底 */
    function groupIconStyle(parent) {
      return categoryGroupIconStyle(parent, primaryColor.value, settingStore.isDark)
    }

    /** 选中一个分类 */
    function onPick(cat) {
      emit('pick-category', cat)
    }

    /** 关闭 */
    function close() {
      visible.value = false
    }

    /*
     * ★ 接入弹层栈 ★
     *   这个面板是叠在记账面板 / 周期面板之上的弹层，
     *   侧滑返回（全面屏右滑、安卓返回键）应该先收起它，
     *   而不是连着把记账面板一起关掉、或者直接退出页面。
     *
     *   打开时登记、关闭/卸载时摘掉，和 TxnPanel / CyclePanel
     *   里的 bindSheet 是同一套做法。
     */
    let unregisterLayer = null

    watch(
      () => props.modelValue,
      (open) => {
        if (open) {
          if (!unregisterLayer) {
            unregisterLayer = pushLayer(() => { visible.value = false }, 'categoryPickerSheet')
          }
          return
        }
        // 选择面板关闭时，叠在上面的新建 / 添加子类弹层也一起收起
        showEditor.value = false
        editorParent.value = null
        if (unregisterLayer) {
          unregisterLayer()
          unregisterLayer = null
        }
      }
    )

    onUnmounted(() => {
      if (unregisterLayer) {
        unregisterLayer()
        unregisterLayer = null
      }
    })

    return {
      visible, sections, primaryColor,
      showEditor, editorParent, canAddChild, openAddChild, openAddRoot, onCategorySaved,
      iconStyle, groupIconStyle, onPick, close
    }
  }
}
</script>

<style scoped>
.more-sheet {
  background-color: var(--app-card);
  padding-bottom: env(safe-area-inset-bottom);
  max-height: 72vh;
  display: flex;
  flex-direction: column;
}

.more-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx 20rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.more-sheet-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
}

.more-sheet-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 20rpx;
  flex-shrink: 0;
}

.more-sheet-add {
  font-size: 26rpx;
  color: var(--app-primary);
  font-weight: 500;
}

.more-sheet-close {
  font-size: 28rpx;
  color: var(--app-text-3);
}

.more-sheet-scroll {
  max-height: 54vh;
}

/* 每一组（一级分类）之间的分隔线 */
.more-group {
  padding-top: 20rpx;
  border-bottom: 1rpx solid var(--app-line);
}

/* 最后一组不要分隔线（面板底部已经有安全区留白了） */
.more-group:last-child {
  border-bottom: none;
}

/* 分组标题：一级分类的图标 + 名字 */
.group-head {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 0 32rpx 4rpx;
}

.group-icon {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.group-icon-text {
  font-size: 22rpx;
}

.group-name {
  font-size: 24rpx;
  color: var(--app-text-2);
  font-weight: 500;
}

/* 组头右侧：添加子类 */
.group-add {
  margin-left: auto;
  flex-shrink: 0;
  padding: 4rpx 0 4rpx 16rpx;
  font-size: 22rpx;
  color: var(--app-primary);
  font-weight: 500;
}

/* 组内的分类网格 */
.more-grid {
  display: flex;
  flex-wrap: wrap;
  padding: 8rpx 32rpx 20rpx;
}

.more-item {
  width: 20%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
  padding: 12rpx 0;
}

.more-icon-wrap {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  /*
   * ★ 必须 border-box ★
   *   选中态是一圈 3rpx 主题色 border（见 utils/categoryIcon.js）。
   *   默认 content-box 会把它加在 80rpx 之外，选中项比别的大一圈。
   */
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

/*
  图标文字颜色由内联样式给（分类本色，见 utils/categoryIcon.js），
  这里不写死颜色 —— 写成 #ffffff 会盖掉内联的浅色底 + 本色图标。
*/
.more-icon-text {
  font-size: 30rpx;
  font-weight: 500;
}

.more-name {
  font-size: 22rpx;
  text-align: center;
}
</style>
