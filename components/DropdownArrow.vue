<template>
  <!--
    全局统一下拉箭头

    ★ 为什么单独抽组件 ★
      「全部交易 / 统计」上方的日期筛选以前用字符 `▾`，
      字符三角形在不同字体下粗细、基线都不一样，和项目里的
      线性图标放一起显得很业余；而记账面板 / 周期面板早已在用
      LineIcon 的 chevronDown。这里把「向下箭头」收成一个组件：
      尺寸、描边、深浅色取值都只有这一份，以后换样式不用到处找。

    ★ 颜色必须传真实色值 ★
      LineIcon 用 SVG data URI 渲染，拿不到外层 CSS 的 color。
      默认按深浅色取两套中性灰，展开态可传 active 用主题色。
  -->
  <LineIcon
    name="chevronDown"
    :size="size"
    :color="arrowColor"
  />
</template>

<script>
import { computed } from 'vue'
import LineIcon from '@/components/LineIcon.vue'
import { useSettingStore } from '@/stores/setting.js'

export default {
  name: 'DropdownArrow',
  components: { LineIcon },
  props: {
    /** 边长（px），与 TxnPanel 的币种箭头保持一致 */
    size: { type: [Number, String], default: 14 },
    /** 展开态：使用主题色 */
    active: { type: Boolean, default: false },
    /** 显式指定颜色（真实色值，不能传 CSS 变量） */
    color: { type: String, default: '' }
  },
  setup(props) {
    const settingStore = useSettingStore()

    const arrowColor = computed(() => {
      if (props.color) return props.color
      if (props.active) return settingStore.primaryColor
      // 与 TxnPanel / CyclePanel / stats-panels 的 iconInk 同一套灰色
      return settingStore.isDark ? '#A1A1A6' : '#646566'
    })

    return { arrowColor }
  }
}
</script>
