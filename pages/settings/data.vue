<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="数据管理" @back="goBack" />

    <scroll-view
      class="page-scroll"
      scroll-y
      :scroll-into-view="scrollTarget"
      :scroll-with-animation="true"
    >
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

      <!--
        ★ 导出 / 导入 已删除 ★
          用户要求：「删除导入/导出的功能及其相关代码，只留下备份」。
          这两块会带来一堆麻烦（分享要 FileProvider、微信读不到
          App 私有目录、导入要调起系统文件选择器…），
          而备份在内部用的就是同一套序列化逻辑，
          只是落在 App 私有目录、不需要用户手工搬运文件。

          备份相关的一切都还在：自动备份 / 立即备份 / 备份记录 / 从备份恢复。
      -->

      <!-- 备份 -->
      <view id="section-backup" class="section">
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
          备份位于 _doc/backup/，保留最近 5 份，可在「查看备份记录」中恢复。
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

    <!-- 全局弹窗宿主（组件库重绘的确认框） -->
    <AppDialog />
  </view>
</template>

<script>
import { ref, computed, onMounted, nextTick } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import PageNav from '@/components/PageNav.vue'
import AppDialog from '@/components/AppDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { queryOne } from '@/api/db/index.js'
import { autoBackup, listBackups, restoreBackup } from '@/api/backup.js'
import { setSettings, getAllSettings, clearSettingsCache } from '@/api/settings.js'
import { recalcAllBalances } from '@/api/account.js'
import { truncateAll } from '@/api/db/index.js'
import { confirmDialog, alertDialog, promptDialog } from '@/utils/dialog.js'

export default {
  components: { PageNav, AppDialog },
  setup() {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()
    const txnStore = useTransactionStore()

    const counts = ref({ transactions: 0, accounts: 0, categories: 0, tags: 0 })
    const autoBackupEnabled = ref(true)
    const backupList = ref([])
    const showBackups = ref(false)

    /**
     * scroll-view 的滚动目标（元素 id）。
     *
     * ★ 必须是 id，不是 class ★
     *   scroll-into-view 靠 id 定位元素。
     *   （项目里踩过这个坑：AI 页写成了 class，定位不到，一直停在顶部。）
     */
    const scrollTarget = ref('')

    /** URL 上带的 tab 参数：'backup' | '' */
    const pendingTab = ref('')

    /**
     * 滚到指定区块。
     *
     * ★ 时序坑 ★
     *   内容是异步加载的（onMounted 里 await loadCounts / loadBackups），
     *   刚进页面时区块可能还没渲染出来，
     *   这时设 scroll-into-view 是无效的（元素还不存在）。
     *   所以要等 nextTick 再设，并留一个短延时兜底。
     */
    async function scrollToSection(id) {
      if (!id) return
      await nextTick()
      scrollTarget.value = ''
      // 再等一帧，确保上一次的清空已经生效
      await nextTick()
      scrollTarget.value = id
      // 兜底：如果元素仍未渲染（内容还在异步加载），再试一次
      setTimeout(() => {
        if (scrollTarget.value !== id) scrollTarget.value = id
      }, 300)
    }

    /**
     * 按 URL 参数滚到对应区块。
     *
     * 'export' → 「导出」区块
     * 'backup' → 「备份」区块
     * 其它/没有 → 保持从顶部开始
     */
    async function applyTab(tab) {
      if (tab === 'backup') {
        await scrollToSection('section-backup')
      }
    }

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


    /**
     * 分享导出的文件。
     *
     * ★ 「获取资源失败」的完整诊断历程 ★
     *   v1 补 file:// 前缀        -> 失败（私有目录无权限）
     *   v2 复制到 _downloads/     -> 失败（Android 7+ 禁 file:// 外传）
     *   v3 声明 Share 模块        -> 仍失败（模块只是让 plus.share 存在，
     *                                     传过去的还是 file://）
     *
    /**
     * 从备份文件恢复数据。
     *
     * ★ 之前这里有个 doImport(path, mode) ★
     *   它同时管「导入外部文件」和「从备份恢复」两件事。
     *   外部导入功能被删后只剩后者，
     *   所以收敛到 api/backup.js 的 restoreBackup()，页面只管调它 + 刷 UI。
     */
    async function onRestoreBackup(backup) {
      const confirmed = await confirmDialog({
        title: '从备份恢复？',
        content: `将用 ${formatBackupTime(backup.time)} 的备份覆盖当前数据。当前数据会先自动备份一次。`,
        confirmText: '恢复',
        danger: true
      })
      if (!confirmed) return

      showBackups.value = false
      uni.showLoading({ title: '恢复中…' })
      try {
        const report = await restoreBackup(backup.path)
        uni.hideLoading()

        clearSettingsCache()
        await settingStore.load()
        await accountStore.refresh()
        await txnStore.loadHome(true)
        await loadCounts()
        await loadBackups()

        const lines = [
          `账户 ${report.accounts} 个`,
          `交易 ${report.transactions} 笔`,
          `分类 ${report.categories} 个`,
          `标签 ${report.tags} 个`
        ].filter(Boolean)

        await alertDialog({
          title: '恢复完成',
          content: lines.join('\n')
        })
      } catch (e) {
        uni.hideLoading()
        await alertDialog({ title: '恢复失败', content: e.message })
      }
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
        await alertDialog({
          title: '重算完成',
          content: `已重算 ${n} 个账户的余额`
        })
      } catch (e) {
        uni.hideLoading()
        await alertDialog({ title: '重算失败', content: e.message })
      }
    }

    async function onClearAll() {
      const confirmed = await confirmDialog({
        title: '清空所有数据？',
        content: '所有账户、交易、分类、标签、预算和设置都会被删除。执行前会自动备份一份到 _doc/backup/。',
        confirmText: '继续',
        danger: true
      })
      if (!confirmed) return

      // 二次确认：输入确认字样
      const input = await promptDialog({
        title: '最后确认',
        placeholder: '请输入「确认清空」'
      })
      // ★ 取消返回 null，输入的字样不匹配也当取消 ★
      if (input === null) return
      if (String(input).trim() !== '确认清空') {
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
        await alertDialog({
          title: '已清空',
          content: '数据已全部清除。应用将重新初始化默认分类。'
        })
        uni.reLaunch({ url: '/pages/index/index' })
      } catch (e) {
        uni.hideLoading()
        await alertDialog({ title: '清空失败', content: e.message })
      }
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

    /**
     * 取路由参数 ?tab=export | ?tab=backup
     *
     * ★ 用 onLoad(options) 而不是 getCurrentPages() ★
     *   options 由框架直接给，最可靠。
     */
    onLoad((options) => {
      pendingTab.value = (options && options.tab) || ''
    })

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      const settings = await getAllSettings()
      autoBackupEnabled.value = settings.autoBackup !== false
      await loadCounts()
      await loadBackups()

      // 内容加载完再滚，保证目标区块已经渲染出来
      if (pendingTab.value) {
        await applyTab(pendingTab.value)
      }
    })

    return {
      counts, autoBackupOn, backupList, showBackups,
      primaryColor, pageStyle, scrollTarget,
      onRestoreBackup,
      onToggleAutoBackup, onManualBackup,
      onRepair, onClearAll,
      formatBackupTime, goBack, settingStore
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
