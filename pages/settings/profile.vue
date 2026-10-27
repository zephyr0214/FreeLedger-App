<template>
  <view class="app-page" :style="pageStyle">
    <!-- 复用导航头 -->
    <PageNav title="个人信息" @back="goBack">
      <template #right>
        <text class="nav-save" @click="onSave">保存</text>
      </template>
    </PageNav>

    <scroll-view class="page-scroll" scroll-y :style="{ height: scrollHeight }">
      <!-- 头像 -->
      <view class="avatar-section">
        <view class="avatar-wrap" @click="pickAvatar">
          <image v-if="form.avatar" :src="form.avatar" class="avatar-img" mode="aspectFill" />
          <view v-else class="avatar-empty" :style="{ backgroundColor: primaryColor }">
            <text class="avatar-letter">{{ form.nickname ? form.nickname.slice(0, 1) : '记' }}</text>
          </view>
          <view class="avatar-edit">
            <text class="avatar-edit-text">更换</text>
          </view>
        </view>
      </view>

      <view class="form-card">
        <view class="form-row">
          <text class="form-label">昵称</text>
          <input
            v-model="form.nickname"
            class="form-input"
            placeholder="给自己起个名字"
            placeholder-class="form-placeholder"
            :maxlength="12"
          />
        </view>

        <view class="form-row">
          <text class="form-label">个性签名</text>
          <input
            v-model="form.signature"
            class="form-input"
            placeholder="写一句话"
            placeholder-class="form-placeholder"
            :maxlength="30"
          />
        </view>

        <view class="form-row">
          <text class="form-label">货币符号</text>
          <input
            v-model="form.currencySymbol"
            class="form-input"
            placeholder="¥"
            placeholder-class="form-placeholder"
            :maxlength="3"
          />
        </view>

        <view class="form-row">
          <text class="form-label">每月起始日</text>
          <picker
            mode="selector"
            :range="dayRange"
            :value="form.monthStartDay - 1"
            @change="(e) => form.monthStartDay = Number(e.detail.value) + 1"
          >
            <text class="form-picker">{{ form.monthStartDay }} 号</text>
          </picker>
        </view>
      </view>

      <view class="tip-card">
        <text class="tip-text">
          每月起始日用于统计周期划分。如果你的工资在月中发放，可以改成发薪日，这样账目会更符合实际感受。
        </text>
      </view>

      <view class="bottom-space" />
    </scroll-view>
  </view>
</template>

<script>
import { ref, reactive, computed, onMounted } from 'vue'
import PageNav from '@/components/PageNav.vue'
import { useSettingStore } from '@/stores/setting.js'

export default {
  components: { PageNav },
  setup() {
    const settingStore = useSettingStore()

    const form = reactive({
      nickname: '',
      signature: '',
      avatar: '',
      currencySymbol: '¥',
      monthStartDay: 1
    })

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    const scrollHeight = computed(() => {
      const info = uni.getSystemInfoSync()
      return `${info.windowHeight - (info.statusBarHeight || 20) - 44}px`
    })

    const dayRange = Array.from({ length: 28 }, (_, i) => `${i + 1}`)

    function pickAvatar() {
      uni.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const path = res.tempFilePaths[0]
          // 持久化到 _doc，避免临时路径失效
          saveAvatarFile(path)
        }
      })
    }

    function saveAvatarFile(tempPath) {
      if (typeof plus === 'undefined') {
        form.avatar = tempPath
        return
      }
      plus.io.resolveLocalFileSystemURL(
        '_doc/',
        (root) => {
          root.getDirectory(
            'avatar',
            { create: true },
            (dir) => {
              const filename = `avatar_${Date.now()}.jpg`
              plus.io.resolveLocalFileSystemURL(tempPath, (srcEntry) => {
                srcEntry.copyTo(
                  dir,
                  filename,
                  (newEntry) => {
                    form.avatar = newEntry.fullPath
                  },
                  () => {
                    form.avatar = tempPath
                  }
                )
              })
            },
            () => { form.avatar = tempPath }
          )
        },
        () => { form.avatar = tempPath }
      )
    }

    async function onSave() {
      try {
        await settingStore.update({
          nickname: form.nickname.trim(),
          signature: form.signature.trim(),
          avatar: form.avatar,
          currencySymbol: form.currencySymbol || '¥',
          monthStartDay: form.monthStartDay
        })
        uni.showToast({ title: '已保存', icon: 'success' })
        setTimeout(() => uni.navigateBack(), 500)
      } catch (e) {
        uni.showModal({ title: '保存失败', content: e.message, showCancel: false })
      }
    }

    function goBack() {
      uni.navigateBack()
    }

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      const s = settingStore.settings
      form.nickname = s.nickname || ''
      form.signature = s.signature || ''
      form.avatar = s.avatar || ''
      form.currencySymbol = s.currencySymbol || '¥'
      form.monthStartDay = s.monthStartDay || 1
    })

    return {
      form, primaryColor, pageStyle, scrollHeight, dayRange,
      pickAvatar, onSave, goBack
    }
  }
}
</script>

<style scoped>
.nav-save {
  font-size: 28rpx;
  color: var(--app-primary);
  font-weight: 500;
}

.page-scroll {
  padding: 0 32rpx;
}

.avatar-section {
  display: flex;
  justify-content: center;
  padding: 40rpx 0;
}

.avatar-wrap {
  position: relative;
}

.avatar-img,
.avatar-empty {
  width: 160rpx;
  height: 160rpx;
  border-radius: 50%;
  overflow: hidden;
}

.avatar-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-letter {
  color: #ffffff;
  font-size: 64rpx;
  font-weight: 600;
}

.avatar-edit {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  background-color: rgba(0, 0, 0, 0.6);
  padding: 4rpx 16rpx;
  border-radius: 16rpx;
}

.avatar-edit-text {
  color: #ffffff;
  font-size: 20rpx;
}

.form-card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 0 28rpx;
}

.form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 96rpx;
  border-bottom: 1rpx solid var(--app-line);
  gap: 20rpx;
}

.form-row:last-child {
  border-bottom: none;
}

.form-label {
  font-size: 28rpx;
  color: var(--app-text);
  flex-shrink: 0;
}

.form-input {
  flex: 1;
  text-align: right;
  font-size: 28rpx;
  color: var(--app-text);
}

.form-placeholder {
  color: var(--app-text-3);
  font-size: 28rpx;
}

.form-picker {
  font-size: 28rpx;
  color: var(--app-text-2);
}

.tip-card {
  margin-top: 20rpx;
  padding: 0 12rpx;
}

.tip-text {
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.6;
}

.bottom-space {
  height: 60rpx;
}
</style>
