<template>
  <view class="app-page" :style="pageStyle">
    <PageNav title="数据管理" @back="goBack" />

    <scroll-view class="page-scroll" scroll-y>
      <!-- 数据概况 -->
      <view class="stat-card">
        <view class="stat-item">
          <text class="stat-num">{{ counts.transactions }}</text>
          <text class="stat-label">交易</text>
        </view>
        <view class="stat-divider" />
        <view class="stat-item">
          <text class="stat-num">{{ counts.accounts }}</text>
          <text class="stat-label">账户</text>
        </view>
        <view class="stat-divider" />
        <view class="stat-item">
          <text class="stat-num">{{ counts.categories }}</text>
          <text class="stat-label">分类</text>
        </view>
        <view class="stat-divider" />
        <view class="stat-item">
          <text class="stat-num">{{ counts.tags }}</text>
          <text class="stat-label">标签</text>
        </view>
      </view>

      <!-- 导出 -->
      <view class="section">
        <text class="section-title">导出</text>
        <view class="card">
          <view class="card-row" @click="onExport(false)">
            <view class="row-info">
              <text class="row-name">导出 JSON（不含 API Key）</text>
              <text class="row-desc">包含账户、分类、标签、交易、预算与全部设置</text>
            </view>
            <text class="row-arrow">›</text>
          </view>

          <view class="card-row" @click="onExport(true)">
            <view class="row-info">
              <text class="row-name">导出 JSON（含 API Key）</text>
              <text class="row-desc danger-desc">⚠️ 文件包含密钥，请勿分享给他人</text>
            </view>
            <text class="row-arrow">›</text>
          </view>
        </view>
      </view>

      <!-- 导入 -->
      <view class="section">
        <text class="section-title">导入</text>
        <view class="card">
          <view class="card-row" @click="onImport('merge')">
            <view class="row-info">
              <text class="row-name">合并导入</text>
              <text class="row-desc">保留现有数据，按 ID 去重后追加</text>
            </view>
            <text class="row-arrow">›</text>
          </view>

          <view class="card-row" @click="onImport('overwrite')">
            <view class="row-info">
              <text class="row-name">覆盖导入</text>
              <text class="row-desc warning-desc">⚠️ 会清空当前所有数据（自动备份）</text>
            </view>
            <text class="row-arrow">›</text>
          </view>
        </view>
      </view>

      <!-- 备份 -->
      <view class="section">
        <text class="section-title">备份</text>
        <view class="card">
          <view class="switch-row">
            <view class="row-info">
              <text class="row-name">自动备份</text>
              <text class="row-desc">每天首次启动自动备份，保留最近 5 份</text>
            </view>
            <switch
              :checked="autoBackupOn"
              :color="primaryColor"
              @change="onToggleAutoBackup"
            />
          </view>

          <view class="card-row" @click="onManualBackup">
            <view class="row-info">
              <text class="row-name">立即备份一次</text>
            </view>
            <text class="row-arrow">›</text>
          </view>

          <view class="card-row" @click="showBackups = true">
            <view class="row-info">
              <text class="row-name">查看备份记录</text>
              <text class="row-desc">{{ backupList.length }} 份备份</text>
            </view>
            <text class="row-arrow">›</text>
          </view>
        </view>
      </view>

      <!-- 维护 -->
      <view class="section">
        <text class="section-title">维护</text>
        <view class="card">
          <view class="card-row" @click="onRepair">
            <view class="row-info">
              <text class="row-name">重算所有账户余额</text>
              <text class="row-desc">如果发现余额与交易对不上，用这个修复</text>
            </view>
            <text class="row-arrow">›</text>
          </view>

          <view class="card-row" @click="onClearAll">
            <view class="row-info">
              <text class="row-name danger-name">清空所有数据</text>
              <text class="row-desc danger-desc">不可恢复，执行前会自动备份</text>
            </view>
            <text class="row-arrow">›</text>
          </view>
        </view>
      </view>

      <view class="tip-card">
        <text class="tip-text">
          数据全部保存在本机的 SQLite 数据库中，路径为 _doc/books.db。
          导出文件位于 _doc/export/，备份位于 _doc/backup/。
        </text>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 备份记录弹层 -->
    <wd-popup v-model="showBackups" position="bottom" :safe-area-inset-bottom="true">
      <view class="backup-panel">
        <view class="panel-head">
          <text class="panel-title">备份记录</text>
          <text class="panel-close" @click="showBackups = false">关闭</text>
        </view>

        <view v-if="backupList.length === 0" class="panel-empty">
          <text class="panel-empty-text">还没有备份</text>
        </view>

        <scroll-view v-else class="backup-scroll" scroll-y>
          <view
            v-for="b in backupList"
            :key="b.name"
            class="backup-row"
            @click="onRestoreBackup(b)"
          >
            <view class="backup-info">
              <text class="backup-name">{{ formatBackupTime(b.time) }}</text>
              <text class="backup-file">{{ b.name }}</text>
            </view>
            <text class="backup-action">恢复</text>
          </view>
        </scroll-view>
      </view>
    </wd-popup>
  </view>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import PageNav from '@/components/PageNav.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { queryOne } from '@/api/db/index.js'
import {
  exportToFile, listExportFiles, importFromFile, autoBackup,
  listBackups, importPayload
} from '@/api/backup.js'
import { setSettings, getAllSettings, clearSettingsCache } from '@/api/settings.js'
import { recalcAllBalances } from '@/api/account.js'
import { truncateAll } from '@/api/db/index.js'

export default {
  components: { PageNav },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()
    const txnStore = useTransactionStore()

    const counts = ref({ transactions: 0, accounts: 0, categories: 0, tags: 0 })
    const autoBackupEnabled = ref(true)
    const backupList = ref([])
    const showBackups = ref(false)
    const exportFiles = ref([])

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)


    const autoBackupOn = computed(() => autoBackupEnabled.value)

    async function loadCounts() {
      const [t, a, c, g] = await Promise.all([
        queryOne('SELECT COUNT(*) AS c FROM txn WHERE deleted_at IS NULL'),
        queryOne('SELECT COUNT(*) AS c FROM account WHERE deleted_at IS NULL'),
        queryOne('SELECT COUNT(*) AS c FROM category WHERE deleted_at IS NULL'),
        queryOne('SELECT COUNT(*) AS c FROM tag WHERE deleted_at IS NULL')
      ])
      counts.value = {
        transactions: Number(t ? t.c : 0),
        accounts: Number(a ? a.c : 0),
        categories: Number(c ? c.c : 0),
        tags: Number(g ? g.c : 0)
      }
    }

    async function loadBackups() {
      backupList.value = await listBackups()
    }

    /* ------------------------------------------------------ 导出 */

    async function onExport(includeApiKey) {
      if (includeApiKey) {
        const confirmed = await new Promise((resolve) => {
          uni.showModal({
            title: '包含 API Key',
            content: '导出的文件会包含你的 API Key 明文。如果你会把文件分享或上传，请不要选择此项。',
            confirmText: '仍要导出',
            confirmColor: '#ee0a24',
            success: (res) => resolve(res.confirm)
          })
        })
        if (!confirmed) return
      }

      uni.showLoading({ title: '导出中…' })
      try {
        const res = await exportToFile({ includeApiKey })
        uni.hideLoading()

        await setSettings({ lastExportAt: Date.now() })

        uni.showModal({
          title: '导出成功',
          content: `文件：${res.filename}\n大小：${(res.size / 1024).toFixed(1)} KB\n路径：${res.path}`,
          confirmText: '去分享',
          cancelText: '知道了',
          success: (modalRes) => {
            if (modalRes.confirm) shareFile(res.path)
          }
        })
      } catch (e) {
        uni.hideLoading()
        uni.showModal({ title: '导出失败', content: e.message, showCancel: false })
      }
    }

    function shareFile(path) {
      if (typeof plus === 'undefined') return
      try {
        plus.share.sendWithSystem(
          { type: 'file', filePath: path },
          () => {},
          () => {
            uni.showToast({ title: '分享不可用，文件已保存在 _doc/export/', icon: 'none' })
          }
        )
      } catch (e) {
        uni.showToast({ title: `文件在 ${path}`, icon: 'none' })
      }
    }

    /* ------------------------------------------------------ 导入 */

    async function onImport(mode) {
      // App 端 uni.chooseFile 不可用，改用固定目录方案
      const files = await listExportFiles()

      if (files.length === 0) {
        uni.showModal({
          title: '没有找到备份文件',
          content:
            '请先把要导入的 JSON 文件放到以下目录，再回到这里导入：\n\n_doc/export/\n\n可通过文件管理器访问此路径，或先用本应用导出一份文件查看位置。',
          showCancel: false
        })
        return
      }

      const title = mode === 'merge' ? '选择要合并的文件' : '选择要覆盖的文件'
      const tip =
        mode === 'merge'
          ? '保留现有数据，按 ID 去重后追加。'
          : '⚠️ 会清空当前所有数据后导入，执行前会自动备份。'

      uni.showActionSheet({
        alertText: tip,
        itemList: files.slice(0, 6).map((f) => f.name),
        success: async (res) => {
          const file = files[res.tapIndex]
          await doImport(file.path, mode)
        }
      })
    }

    async function doImport(path, mode) {
      uni.showLoading({ title: '导入中…' })
      try {
        const report = await importFromFile(path, { mode })
        uni.hideLoading()

        clearSettingsCache()
        await settingStore.load()
        await accountStore.refresh()
        await txnStore.loadHome(true)
        await loadCounts()

        const lines = [
          `账户 ${report.accounts} 个`,
          `交易 ${report.transactions} 笔`,
          `分类 ${report.categories} 个`,
          `标签 ${report.tags} 个`,
          report.skipped > 0 ? `跳过重复 ${report.skipped} 条` : '',
          report.backupPath ? `\n导入前备份：${report.backupPath}` : ''
        ].filter(Boolean)

        uni.showModal({
          title: '导入完成',
          content: lines.join('\n'),
          showCancel: false
        })
      } catch (e) {
        uni.hideLoading()
        uni.showModal({ title: '导入失败', content: e.message, showCancel: false })
      }
    }

    async function onRestoreBackup(backup) {
      const confirmed = await new Promise((resolve) => {
        uni.showModal({
          title: '从备份恢复？',
          content: `将用 ${formatBackupTime(backup.time)} 的备份覆盖当前数据。当前数据会先自动备份一次。`,
          confirmText: '恢复',
          confirmColor: '#ee0a24',
          success: (res) => resolve(res.confirm)
        })
      })
      if (!confirmed) return

      showBackups.value = false
      await doImport(backup.path, 'overwrite')
    }

    /* ------------------------------------------------------ 备份 */

    async function onToggleAutoBackup(e) {
      autoBackupEnabled.value = e.detail.value
      await setSettings({ autoBackup: e.detail.value })
    }

    async function onManualBackup() {
      uni.showLoading({ title: '备份中…' })
      try {
        const res = await autoBackup('manual')
        uni.hideLoading()
        if (res) {
          await loadBackups()
          uni.showToast({ title: '备份完成', icon: 'success' })
        } else {
          uni.showToast({ title: '备份失败', icon: 'none' })
        }
      } catch (e) {
        uni.hideLoading()
        uni.showToast({ title: e.message, icon: 'none' })
      }
    }

    /* ------------------------------------------------------ 维护 */

    async function onRepair() {
      uni.showLoading({ title: '重算中…' })
      try {
        const n = await recalcAllBalances()
        await accountStore.refresh()
        uni.hideLoading()
        uni.showModal({
          title: '重算完成',
          content: `已重算 ${n} 个账户的余额`,
          showCancel: false
        })
      } catch (e) {
        uni.hideLoading()
        uni.showModal({ title: '重算失败', content: e.message, showCancel: false })
      }
    }

    async function onClearAll() {
      const confirmed = await new Promise((resolve) => {
        uni.showModal({
          title: '清空所有数据？',
          content: '所有账户、交易、分类、标签、预算和设置都会被删除。执行前会自动备份一份到 _doc/backup/。',
          confirmText: '继续',
          confirmColor: '#ee0a24',
          success: (res) => resolve(res.confirm)
        })
      })
      if (!confirmed) return

      // 二次确认：输入确认字样
      uni.showModal({
        title: '最后确认',
        editable: true,
        placeholderText: '请输入「确认清空」',
        success: async (res) => {
          if (!res.confirm) return
          if (String(res.content).trim() !== '确认清空') {
            uni.showToast({ title: '确认字样不匹配，已取消', icon: 'none' })
            return
          }

          uni.showLoading({ title: '清理中…' })
          try {
            await autoBackup('before-clear')
            await truncateAll()
            clearSettingsCache()
            await settingStore.load()
            await accountStore.refresh()
            await txnStore.loadHome(true)
            await loadCounts()
            uni.hideLoading()
            uni.showModal({
              title: '已清空',
              content: '数据已全部清除。应用将重新初始化默认分类。',
              showCancel: false,
              success: () => {
                uni.reLaunch({ url: '/pages/index/index' })
              }
            })
          } catch (e) {
            uni.hideLoading()
            uni.showModal({ title: '清空失败', content: e.message, showCancel: false })
          }
        }
      })
    }

    /* ------------------------------------------------------ 辅助 */

    function formatBackupTime(ts) {
      if (!ts) return '未知时间'
      const d = new Date(ts)
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    function goBack() {
      uni.navigateBack()
    }

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      const settings = await getAllSettings()
      autoBackupEnabled.value = settings.autoBackup !== false
      await loadCounts()
      await loadBackups()
      exportFiles.value = await listExportFiles()
    })

    return {
      counts, autoBackupOn, backupList, showBackups, exportFiles,
      primaryColor, pageStyle,
      onExport, onImport, onRestoreBackup,
      onToggleAutoBackup, onManualBackup,
      onRepair, onClearAll,
      formatBackupTime, goBack
    }
  }
}
</script>

<style scoped>
.page-scroll {
  padding: 0 32rpx;
}

/* 统计卡 */
.stat-card {
  display: flex;
  align-items: center;
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 32rpx 0;
  margin-top: 16rpx;
}

.stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
}

.stat-num {
  font-size: 38rpx;
  font-weight: 600;
  color: var(--app-text);
}

.stat-label {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.stat-divider {
  width: 1rpx;
  height: 44rpx;
  background-color: var(--app-line);
}

/* 区块 */
.section {
  margin-top: 32rpx;
}

.section-title {
  font-size: 24rpx;
  color: var(--app-text-3);
  padding-left: 8rpx;
  display: block;
  margin-bottom: 12rpx;
}

.card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
}

.card-row {
  display: flex;
  align-items: center;
  padding: 26rpx 28rpx;
  border-bottom: 1rpx solid var(--app-line);
  gap: 20rpx;
}

.card-row:last-child {
  border-bottom: none;
}

.row-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.row-name {
  font-size: 28rpx;
  color: var(--app-text);
}

.row-desc {
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.5;
}

.danger-name {
  color: var(--app-danger);
}

.danger-desc {
  color: var(--app-danger);
  opacity: 0.8;
}

.warning-desc {
  color: var(--app-warning);
}

.row-arrow {
  font-size: 32rpx;
  color: var(--app-text-3);
  flex-shrink: 0;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 26rpx 28rpx;
  border-bottom: 1rpx solid var(--app-line);
  gap: 20rpx;
}

.tip-card {
  margin-top: 24rpx;
  padding: 0 12rpx;
}

.tip-text {
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.7;
}

/* 备份面板 */
.backup-panel {
  background-color: var(--app-card);
  max-height: 70vh;
  padding-bottom: env(safe-area-inset-bottom);
  display: flex;
  flex-direction: column;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.panel-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
}

.panel-close {
  font-size: 26rpx;
  color: var(--app-text-3);
}

.panel-empty {
  padding: 60rpx 0;
  text-align: center;
}

.panel-empty-text {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.backup-scroll {
  max-height: 50vh;
}

.backup-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 28rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.backup-info {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.backup-name {
  font-size: 26rpx;
  color: var(--app-text);
}

.backup-file {
  font-size: 20rpx;
  color: var(--app-text-3);
}

.backup-action {
  font-size: 24rpx;
  color: var(--app-primary);
}
</style>
