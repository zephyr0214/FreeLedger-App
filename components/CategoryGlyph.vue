<template>
  <view class="cat-glyph" :style="boxStyle">
    <!-- 特殊符号（转账 ⇄ 等）仍然用文字：它们不是分类 -->
    <text v-if="symbol" class="cat-glyph-symbol" :style="symbolStyle">{{ symbol }}</text>

    <template v-else>
      <!--
        系统 emoji 只在三种情况下显示：
          1）该样式整体加载失败（断网 / CDN 不可用）
          2）单张失败、且延迟后整个样式仍一张都没成功
          3）调用方显式 loadingFallback=true（默认已关闭）
        其余加载中 / 部分失败的情况一律留空，避免一屏系统 emoji 乱跳。
      -->
      <text
        v-if="showSystemEmoji"
        class="cat-glyph-emoji"
        :style="emojiStyle"
      >{{ char }}</text>
      <!--
        ★ :key="src" 不能省 ★
          同一个组件换了图标 / 样式时，src 会变；如果复用同一个
          <image> 节点，Android 可能在新图加载完成前继续显示旧图，
          看起来就是「分类图标串了」。强制按 URL 重建节点。
        ★ 加载完成前 opacity 为 0 ★
          不会旧图叠新图；没加载出来时保持空白，
          只有上面的系统兜底条件成立才显示 emoji。
      -->
      <image
        v-if="!offline && !failed && src"
        :key="src"
        class="cat-glyph-img"
        :style="{ opacity: loaded ? 1 : 0 }"
        :src="src"
        mode="aspectFit"
        @load="onLoad"
        @error="onError"
      />
    </template>
  </view>
</template>

<script>
/**
 * 分类图标（Noto / Twemoji / OpenMoji / Fluent 四样式）
 *
 * 用法：
 *   <CategoryGlyph :icon="cat.icon" :name="cat.name" size="80rpx" />
 *   <CategoryGlyph :icon="row.hex" size="68rpx" :remote-size="60" />
 *   <CategoryGlyph symbol="⇄" size="64rpx" />
 *
 * ★ 图片是联网的 ★
 *   utils/emoji.js 按当前样式拼 CDN 地址。
 *   ★ 全 App 统一加载策略（用户要求）★
 *     部分图片加载出来时，没加载出来的先留空；
 *     只有整套样式一张都加载不出来，才显示系统 emoji。
 *     · 单张失败后等 1.2 秒：期间任意一张成功，就保持空白
 *     · 6 次失败且 0 成功（utils/emojiLoad.js）→ 整页系统 emoji
 *     · 系统 emoji 最大 44rpx（极小档），字号不会随大图标档放大
 *
 * ★ 为什么抽组件 ★
 *   分类图标在首页、流水、详情、面板、选择页里出现，
 *   旧 key → 码点、按名字猜、联网地址、失败兜底这一套只写一份。
 *
 * ★ 尺寸单位 ★
 *   size 传字符串时原样使用（'44rpx' / '20px'）；
 *   传数字时按 rpx 处理。remote-size 只影响 Noto 请求 72 还是 128 的图；
 *   Twemoji / OpenMoji 用 SVG，本身可缩放，不区分尺寸档。
 */
import { ref, computed, watch, onUnmounted } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { categoryIconCode, categoryIconSrc, emojiChar } from '@/utils/emoji.js'
import { cachedIconPath, invalidateIcon } from '@/utils/iconCache.js'
import {
  noteEmojiLoad, emojiStyleFailed, emojiStyleHasSuccess
} from '@/utils/emojiLoad.js'

/** 系统 emoji 兜底的最大字号（对应图标配置的「极小」档 44rpx） */
const FALLBACK_EMOJI_RPX = 44

/** 单张失败后等多久再判断「这个样式是不是一张都没加载出来」 */
const FALLBACK_DELAY_MS = 1200

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
     * ★ 全 App 统一为 false ★
     *   用户要求：部分图标加载出来时，没加载出来的先留空；
     *   只有整套样式一张都加载不出来时，才显示系统 emoji。
     *   这个判断由下面的 systemFallback + emojiStyleFailed 负责，
     *   不再由各页面自己传 true/false。
     */
    loadingFallback: { type: Boolean, default: false },
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

    /**
     * 本张图失败、且该样式暂时一张都没成功时，延迟显示系统 emoji
     *
     * 页面只有一个图标（详情页）时，6 次失败阈值永远达不到；
     * 这个状态让「一个都没加载出来」也能回退系统样式。
     */
    const systemFallback = ref(false)
    let fallbackTimer = null

    const sizeText = computed(() =>
      typeof props.size === 'number' ? `${props.size}rpx` : props.size
    )

    const boxStyle = computed(() => ({
      width: sizeText.value,
      height: sizeText.value
    }))

    const code = computed(() => categoryIconCode(props.icon, props.name))
    const style = computed(() => settingStore.emojiStyle)
    /** 远程 CDN 地址（未命中本地缓存时使用） */
    const remoteSrc = computed(() => categoryIconSrc(props.icon, props.name, props.remoteSize, style.value))
    /** 本地缓存路径（只对分类里用到的图标生效；选择页的候选图标不缓存） */
    const cachedSrc = computed(() => cachedIconPath(code.value, style.value))
    const src = computed(() => cachedSrc.value || remoteSrc.value)
    const usingCache = computed(() => !!cachedSrc.value)
    const char = computed(() => emojiChar(code.value))

    /** 该样式整体是否加载失败（断网 / CDN 不可用） */
    const offline = computed(() => emojiStyleFailed(style.value))

    /** 该样式是否至少成功加载过一张（响应式读取 emojiLoad 的内部状态） */
    const styleHasSuccess = computed(() => emojiStyleHasSuccess(style.value))

    /** 是否显示系统 emoji 兜底 */
    const showSystemEmoji = computed(() =>
      offline.value || systemFallback.value || (props.loadingFallback && !loaded.value)
    )

    /**
     * 系统 emoji 字号
     *
     * ★ 用户要求「系统默认样式 = 圆角背景色 + 极小」★
     *   网络图片正常时按传入 size 显示；回退系统 emoji 时
     *   最大不超过极小档 44rpx，避免大档图标断网后变成一坨。
     *   小于 44 的（分类弹层分组标题 28rpx 等）保持原尺寸。
     */
    const emojiSizeText = computed(() => {
      const m = /^([\d.]+)rpx$/.exec(sizeText.value)
      if (!m) return sizeText.value
      return `${Math.min(Number(m[1]), FALLBACK_EMOJI_RPX)}rpx`
    })

    const emojiStyle = computed(() => ({
      fontSize: emojiSizeText.value,
      lineHeight: 1
    }))

    const symbolStyle = computed(() => ({
      fontSize: sizeText.value,
      lineHeight: 1,
      color: props.color || undefined
    }))

    function clearFallbackTimer() {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer)
        fallbackTimer = null
      }
    }

    function onLoad() {
      loaded.value = true
      failed.value = false
      systemFallback.value = false
      clearFallbackTimer()
      noteEmojiLoad(style.value, true)
    }

    function onError() {
      /*
       * ★ 本地缓存坏了不要直接判死 ★
       *   App 私有目录可能被系统清理 / 用户清缓存，manifest 仍在就会
       *   指向一个不存在的文件。先失效这一条，src 会自动切回远程 URL；
       *   只有远程也失败才进入「整套样式不可用」的统计。
       */
      if (usingCache.value) {
        invalidateIcon(code.value, style.value)
        loaded.value = false
        failed.value = false
        return
      }
      failed.value = true
      loaded.value = false
      noteEmojiLoad(style.value, false)

      /*
       * ★ 单张失败后的兜底判断 ★
       *   如果 1.2 秒后这个样式仍然一张都没成功，
       *   说明不是「个别图标 404」而是整套加载不出来，显示系统 emoji。
       *   如果期间任意一张成功，styleHasSuccess 会把 systemFallback 关掉，
       *   这张图就保持空白 —— 符合「部分加载出来时，未加载出的留空」。
       */
      clearFallbackTimer()
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null
        if (!emojiStyleHasSuccess(style.value)) systemFallback.value = true
      }, FALLBACK_DELAY_MS)
    }

    // 任意一张成功后，失败的图标不再显示系统 emoji，回到空白
    watch(styleHasSuccess, (ok) => {
      if (ok) {
        systemFallback.value = false
        clearFallbackTimer()
      }
    })

    // 换图标 / 换样式 / 换图片尺寸时重新尝试加载
    // src 变化（换图标 / 换样式 / 本地缓存命中或失效）时重新走加载流程
    watch(src, () => {
      loaded.value = false
      failed.value = false
      systemFallback.value = false
      clearFallbackTimer()
    })

    onUnmounted(() => {
      clearFallbackTimer()
    })

    return {
      sizeText, boxStyle, src, showSystemEmoji, char, emojiStyle, symbolStyle, offline,
      loaded, failed, onLoad, onError
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

.cat-glyph-emoji,
.cat-glyph-symbol {
  text-align: center;
}

.cat-glyph-symbol {
  /* 颜色继承外层（转账用 --app-text-2，未知用分类色） */
  flex-shrink: 0;
}
</style>
