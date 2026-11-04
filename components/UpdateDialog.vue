<template>
  <!--
    更新弹窗（自绘遮罩，z-index 9 —— 项目约定低于库弹层，
    保证「下载失败」等 AppDialog 确认框能盖在它上面）

    ★ 数据来自 stores/update.js，本组件只负责呈现与转发点击 ★
      三个页面（首页 / 我的 / 更新日志）各挂一个实例、读同一份 store，
      无论从哪个入口触发检查，弹窗都出现在当前屏幕上。

    ★ 段落渲染 ★
      发行说明是多行文本，uni-app 的 <text> 会吃掉换行，
      所以按 \n 拆行 v-for（与「关于」页同款做法）。
  -->
  <view v-if="updateStore.dialogVisible" class="ud-mask" @click="dismiss">
    <view class="ud-card" @click.stop>
      <view class="ud-head">
        <text class="ud-title">发现新版本 v{{ info.version }}</text>
        <text v-if="sizeText" class="ud-size">{{ sizeText }}</text>
      </view>

      <scroll-view class="ud-notes" scroll-y>
        <text v-for="(line, i) in noteLines" :key="i" class="ud-note-line">{{ line }}</text>
      </scroll-view>

      <!-- 下载进度 -->
      <view v-if="updateStore.phase === 'downloading'" class="ud-progress">
        <view class="ud-progress-track">
          <view
            class="ud-progress-fill"
            :style="{ width: updateStore.progress + '%', backgroundColor: primaryColor }"
          />
        </view>
        <text class="ud-progress-text">正在下载 {{ updateStore.progress }}%</text>
      </view>

      <view class="ud-foot">
        <view class="ud-btn-cancel" @click="dismiss">
          {{ updateStore.phase === 'downloading' ? '取消下载' : '下次再说' }}
        </view>
        <view
          v-if="updateStore.phase === 'idle'"
          class="ud-btn-ok"
          :style="{ backgroundColor: primaryColor }"
          @click="updateStore.confirmDownload()"
        >立即下载更新</view>
        <view v-else class="ud-btn-ok ud-btn-busy">
          {{ updateStore.phase === 'installing' ? '正在安装…' : '下载中…' }}
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { computed, watch, onUnmounted } from 'vue'
import { useUpdateStore } from '@/stores/update.js'
import { useSettingStore } from '@/stores/setting.js'
import { pushLayer } from '@/utils/layerStack.js'

export default {
  name: 'UpdateDialog',
  setup() {
    const updateStore = useUpdateStore()
    const settingStore = useSettingStore()

    const primaryColor = computed(() => settingStore.primaryColor)

    const info = computed(() => updateStore.info || {})
    const sizeText = computed(() => {
      const mb = (info.value.sizeBytes || 0) / 1048576
      return mb > 0 ? mb.toFixed(1) + ' MB' : ''
    })
    const noteLines = computed(() =>
      String(info.value.notes || '').split('\n').filter((l) => l.trim().length > 0)
    )

    function dismiss() {
      updateStore.dismiss()
    }

    /*
     * 弹层栈登记：侧滑返回 / 返回键先收弹窗，不退出页面
     * （BalanceSheet 同款模式）
     */
    let unregister = null
    watch(
      () => updateStore.dialogVisible,
      (open) => {
        if (open) {
          if (!unregister) {
            unregister = pushLayer(() => { updateStore.dismiss() }, 'updateDialog')
          }
          return
        }
        if (unregister) {
          unregister()
          unregister = null
        }
      }
    )
    onUnmounted(() => {
      if (unregister) {
        unregister()
        unregister = null
      }
    })

    return { updateStore, info, sizeText, noteLines, primaryColor, dismiss }
  }
}
</script>

<style scoped>
.ud-mask {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.45);
  z-index: 9;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ud-card {
  width: 620rpx;
  max-height: 80vh;
  background-color: var(--app-card);
  border-radius: 24rpx;
  padding: 32rpx;
  display: flex;
  flex-direction: column;
}

.ud-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

.ud-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.ud-size {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.ud-notes {
  max-height: 420rpx;
  margin-bottom: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.ud-note-line {
  font-size: 26rpx;
  color: var(--app-text-2);
  line-height: 1.6;
}

/* 下载进度 */
.ud-progress {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 24rpx;
}

.ud-progress-track {
  flex: 1;
  height: 12rpx;
  border-radius: 6rpx;
  background-color: var(--app-card-2);
  overflow: hidden;
}

.ud-progress-fill {
  height: 100%;
  border-radius: 6rpx;
  transition: width 0.2s ease;
}

.ud-progress-text {
  font-size: 22rpx;
  color: var(--app-text-2);
  width: 150rpx;
  text-align: right;
  flex-shrink: 0;
}

/* 按钮 */
.ud-foot {
  display: flex;
  gap: 20rpx;
}

.ud-btn-cancel,
.ud-btn-ok {
  flex: 1;
  height: 80rpx;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: 500;
}

.ud-btn-cancel {
  background-color: var(--app-card);
  color: var(--app-text-2);
  border: 2rpx solid var(--app-line);
}

.ud-btn-ok {
  color: #ffffff;
}

.ud-btn-busy {
  opacity: 0.6;
}
</style>
