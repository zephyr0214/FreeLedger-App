<template>
  <wd-popup
    v-model="visible"
    position="bottom"
    :safe-area-inset-bottom="true"
    custom-style="background-color: var(--app-card); border-radius: 28rpx 28rpx 0 0;"
  >
    <view class="more-sheet">
      <view class="more-sheet-head">
        <text class="more-sheet-title">选择分类</text>
        <text class="more-sheet-close" @click="close">关闭</text>
      </view>

      <scroll-view class="more-sheet-scroll" scroll-y>
        <view class="more-groups">
          <view v-for="sec in sections" :key="sec.key" class="more-group">
            <!--
              一级分类的分组标题。
              「自己就是一组」的一级分类（如收入的「工资」）不显示标题 ——
              标题和下面那一个分类同名，重复一遍反而啰嗦。
            -->
            <view v-if="sec.title" class="group-head">
              <view class="group-icon" :style="groupIconStyle(sec.parent)">
                <text class="group-icon-text">{{ sec.icon }}</text>
              </view>
              <text class="group-name">{{ sec.title }}</text>
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
                  <text class="more-icon-text">{{ iconChar(cat) }}</text>
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
 *   2. 「没有二级」的一级分类（收入的工资/奖金等）自己就是一组，不重复显示标题；
 *   3. 图标配色与交易流水一致：**浅色底 + 本色图标**（见 utils/categoryIcon.js）。
 *
 * ★ 分组顺序 ★
 *   组按「组内第一个分类」在传入列表里的位置排序，
 *   而传入列表已按最近 30 天使用频率排好序 ——
 *   所以最常用的分类所在的那一组一定排在最前面。
 */
import { computed, watch, onUnmounted } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { iconEmoji, guessIconByName } from '@/utils/icons.js'
import { groupCategoriesByParent } from '@/utils/categorySort.js'
import { categoryIconFullStyle, categoryGroupIconStyle } from '@/utils/categoryIcon.js'
import { pushLayer } from '@/utils/layerStack.js'

export default {
  name: 'CategoryPickerSheet',
  props: {
    modelValue: { type: Boolean, default: false },
    /** 可选分类（已按使用频率排序） */
    categories: { type: Array, default: () => [] },
    /** 当前类型下的全部分类（用来找一级分类） */
    allCategories: { type: Array, default: () => [] },
    /** 当前选中的分类 id */
    selectedId: { type: String, default: '' }
  },
  emits: ['update:modelValue', 'pick-category'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const primaryColor = computed(() => settingStore.primaryColor)

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    /**
     * 分组结果。
     *
     * 每项：{ key, parent, title, icon, members }
     *   title 为空串 = 这一组不需要标题（自己就是一组的一级分类）。
     */
    const sections = computed(() =>
      groupCategoriesByParent(props.categories, props.allCategories).map((g) => {
        // 自己就是一组的一级分类（无二级）：不显示重复的分组标题
        const isSelf = g.members.length === 1 && g.members[0].id === g.parent.id
        return {
          key: g.parent.id,
          parent: g.parent,
          title: isSelf ? '' : g.parent.name,
          icon: isSelf ? '' : iconChar(g.parent),
          members: g.members
        }
      })
    )

    /** 图标 emoji */
    function iconChar(cat) {
      return cat.icon ? iconEmoji(cat.icon) : guessIconByName(cat.name)
    }

    /**
     * 分类图标的配色（未选中浅灰底；选中浅色底 + 主题色圈；图标始终是分类本色）
     *
     * ★ 选中态多一圈主题色描边 ★
     *   和记账面板 / 周期面板走同一个函数（categoryIconFullStyle），
     *   三处的选中观感完全一致。
     */
    function iconStyle(cat, active) {
      return categoryIconFullStyle(cat, primaryColor.value, active)
    }

    /** 分组标题（一级分类）的图标配色：始终是分类色的浅色底 */
    function groupIconStyle(parent) {
      return categoryGroupIconStyle(parent, primaryColor.value)
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
      iconChar, iconStyle, groupIconStyle, onPick, close
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
