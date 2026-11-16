<template>
  <view class="cat-glyph" :style="boxStyle">
    <!-- 特殊符号（转账 ⇄ 等）仍然用文字：它们不是分类 -->
    <text v-if="symbol" class="cat-glyph-symbol" :style="symbolStyle">{{ symbol }}</text>

    <template v-else>
      <!--
        系统 emoji 只在两种情况下显示：
          1）该样式整体加载失败（断网 / CDN 不可用）
          2）loadingFallback = true（列表页）且这张图还没加载好
        图标选择页把 loadingFallback 设为 false：没加载出来的先留空，
        避免一屏系统 emoji 乱跳。
      -->
      <text
        v-if="offline || (loadingFallback && !visualReady)"
        class="cat-glyph-emoji"
        :style="emojiStyle"
      >{{ char }}</text>
      <!--
        ★ :key="src" 不能省 ★
          同一个组件换了图标 / 样式时，src 会变；如果复用同一个
          <image> 节点，Android 可能在新图加载完成前继续显示旧图，
          看起来就是「分类图标串了」。强制按 URL 重建节点。
        ★ 加载完成前 opacity 为 0 ★
          配合上面的系统 emoji 占位，不会旧图叠新图；
          分类管理 / 选择页把 loadingFallback 设为 false 时显示为空白。
      -->
      <image
        v-if="!offline && !failed && src"
        :key="src"
        class="cat-glyph-img"
        :style="{ opacity: visualReady ? 1 : 0 }"
        :src="src"
        mode="aspectFit"
        @load="onLoad"
        @error="onError"
      />
      <!--
        暗色 OpenMoji：在彩色图上叠一层「灰色描边」。
        black/ 是纯黑线稿，用 invert(0.5) 变成 #808080；
        它和彩色图的线稿来自同一份 SVG，位置严格对齐，
        灰色线条正好盖住底图的黑色描边，彩色填充不受影响。
      -->
      <image
        v-if="outlineSrc && !offline && !failed"
        :key="outlineSrc"
        class="cat-glyph-img cat-glyph-outline"
        :style="{ opacity: outlineLoaded ? 1 : 0 }"
        :src="outlineSrc"
        mode="aspectFit"
        @load="onOutlineLoad"
        @error="onOutlineError"
      />
    </template>
  </view>
</template>

<script>
/**
 * 分类图标（Noto / Twemoji / OpenMoji 三样式）
 *
 * 用法：
 *   <CategoryGlyph :icon="cat.icon" :name="cat.name" size="80rpx" />
 *   <CategoryGlyph :icon="row.hex" size="68rpx" :remote-size="60" />
 *   <CategoryGlyph symbol="⇄" size="64rpx" />
 *
 * ★ 图片是联网的 ★
 *   utils/emoji.js 按当前样式拼 CDN 地址。
 *   - 列表页：图片加载中 / 单张失败时显示系统 emoji，避免空白
 *   - 选择页：loadingFallback=false，没加载出来先留空；
 *     如果整个样式一张都没加载出来（utils/emojiLoad.js），
 *     才整体回退系统 emoji。
 *
 * ★ 为什么抽组件 ★
 *   分类图标在首页、流水、详情、面板、选择页里出现，
 *   旧 key → 码点、按名字猜、联网地址、失败兜底这一套只写一份。
 *
 * ★ 暗色 OpenMoji 的灰色描边 ★
 *   彩色 OpenMoji PNG 自带黑色描边，深色背景上太重。
 *   额外叠一张 black/ 线稿 PNG（invert 滤镜变灰），
 *   灰色线稿正好盖住黑色描边；浅色模式不加载第二张图。
 *   背景色开关 / 尺寸 / 圆角仍由外层组件（TxnIcon）控制。
 *
 * ★ 尺寸单位 ★
 *   size 传字符串时原样使用（'44rpx' / '20px'）；
 *   传数字时按 rpx 处理。remote-size 只影响请求 60 还是 120 的图。
 */
import { ref, computed, watch } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { categoryIconCode, categoryIconSrc, emojiOutlineSrc, emojiChar } from '@/utils/emoji.js'
import { noteEmojiLoad, emojiStyleFailed } from '@/utils/emojiLoad.js'

export default {
  name: 'CategoryGlyph',
  props: {
    /** 分类 icon 字段（Unicode 码点或旧 key） */
    icon: { type: String, default: '' },
    /** 分类名（icon 为空时按名字猜） */
    name: { type: String, default: '' },
    /** 显示边长 */
    size: { type: [String, Number], default: '40rpx' },
    /** 请求的远程图片尺寸：60（缩略图）或 120（列表 / 详情） */
    remoteSize: { type: Number, default: 120 },
    /**
     * 图片没加载好时是否先用系统 emoji 占位
     *
     * 列表页默认 true（避免空白）；
     * 图标选择页传 false（先留空，全部失败才整体回退系统 emoji）。
     */
    loadingFallback: { type: Boolean, default: true },
    /** 非分类图标（转账 ⇄ / 未知 ❔）用文字渲染 */
    symbol: { type: String, default: '' },
    /** 文字符号的颜色（图片本身是彩色的，不受它影响） */
    color: { type: String, default: '' }
  },
  setup(props) {
    const settingStore = useSettingStore()

    /** 图片是否已成功加载 */
    const loaded = ref(false)
    /** 图片是否加载失败 */
    const failed = ref(false)

    /** 暗色 OpenMoji 的灰色描边层是否加载完成 / 失败 */
    const outlineLoaded = ref(false)
    const outlineFailed = ref(false)

    const sizeText = computed(() =>
      typeof props.size === 'number' ? `${props.size}rpx` : props.size
    )

    const boxStyle = computed(() => ({
      width: sizeText.value,
      height: sizeText.value
    }))

    const code = computed(() => categoryIconCode(props.icon, props.name))
    const style = computed(() => settingStore.emojiStyle)
    const src = computed(() => categoryIconSrc(props.icon, props.name, props.remoteSize, style.value))
    const char = computed(() => emojiChar(code.value))

    /**
     * 暗色模式 + OpenMoji 才叠灰色描边层
     *
     * 其他样式没有独立线稿，硬套会改变图标本身；所以只在
     * 当前样式是 openmoji 且深色模式时启用。
     */
    const outlineSrc = computed(() => {
      if (!settingStore.isDark || style.value !== 'openmoji') return ''
      return emojiOutlineSrc(code.value, props.remoteSize)
    })

    /**
     * 底图是否已经可以显示
     *
     * 有描边层时，要等描边也加载完（或失败）再显示底图，
     * 否则会先闪一下黑色描边。描边失败就退回底图自带的黑描边，
     * 总比整个图标空白好。
     */
    const visualReady = computed(() =>
      loaded.value && (!outlineSrc.value || outlineLoaded.value || outlineFailed.value)
    )

    /** 该样式整体是否加载失败（断网 / CDN 不可用） */
    const offline = computed(() => emojiStyleFailed(style.value))

    const emojiStyle = computed(() => ({
      fontSize: sizeText.value,
      lineHeight: 1
    }))

    const symbolStyle = computed(() => ({
      fontSize: sizeText.value,
      lineHeight: 1,
      color: props.color || undefined
    }))

    function onLoad() {
      loaded.value = true
      failed.value = false
      noteEmojiLoad(style.value, true)
    }

    function onError() {
      failed.value = true
      loaded.value = false
      noteEmojiLoad(style.value, false)
    }

    function onOutlineLoad() {
      outlineLoaded.value = true
      outlineFailed.value = false
    }

    function onOutlineError() {
      outlineFailed.value = true
      outlineLoaded.value = false
    }

    // 换图标 / 换样式 / 换图片尺寸 / 切换深浅色时重新尝试加载
    watch([code, style, () => props.remoteSize, () => settingStore.isDark], () => {
      loaded.value = false
      failed.value = false
      outlineLoaded.value = false
      outlineFailed.value = false
    })

    return {
      sizeText, boxStyle, src, outlineSrc, visualReady, char, emojiStyle, symbolStyle, offline,
      loaded, failed, outlineLoaded, onLoad, onError, onOutlineLoad, onOutlineError
    }
  }
}
</script>

<style scoped>
.cat-glyph {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 图标不吃触摸事件，避免挡住外层整行的点击 */
  pointer-events: none;
}

.cat-glyph-img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: block;
}

/*
 * 暗色 OpenMoji 的灰色描边层
 *
 * black/ 线稿是纯黑透明底，invert(0.5) 把黑线映射成 #808080，
 * 透明区域保持透明；叠在彩色图上即可只改描边、不改填充色。
 */
.cat-glyph-outline {
  filter: invert(0.5);
}

.cat-glyph-emoji,
.cat-glyph-symbol {
  text-align: center;
}

.cat-glyph-symbol {
  /* 颜色继承外层（转账用 --app-text-2，未知用分类色） */
  flex-shrink: 0;
}
</style>
