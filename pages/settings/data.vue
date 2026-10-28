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
        ★ 导出 / 导入 ★
          用户要求恢复：「数据预备份新增导出和导入功能，导出支持分享，
          导入要调用手机的文件选择选择文件导入，
          要支持对导出历史进行删除」。

        和之前删掉的那版相比，这次的做法变了：
          分享 —— 用 uni.shareWithSystem（系统分享面板），
                  不再走 plus.share + 微信 SDK。老版本传 file:// 路径
                  在 Android 7+ 会撞 FileUriExposedException，
                  微信一律报「获取资源失败」；系统分享面板没这个问题。
          导入 —— Android 用 Native.js 起 ACTION_GET_CONTENT，
                  真正的系统文件选择器（老版也是这么做的，能用）。
      -->

      <!-- 导出 -->
      <view id="section-export" class="section">
        <text class="section-title">导出</text>
        <view class="card">
          <view class="card-row" @click="onExport">
            <view class="row-info">
              <text class="row-name">导出为 JSON 文件</text>
              <text class="row-desc">生成一份可分享、可存到电脑的备份文件</text>
            </view>
            <text class="row-arrow">›</text>
          </view>

          <view class="card-row" @click="openExportFiles">
            <view class="row-info">
              <text class="row-name">导出历史</text>
              <text class="row-desc">{{ exportFiles.length }} 个文件，可分享或删除</text>
            </view>
            <text class="row-arrow">›</text>
          </view>
        </view>
      </view>

      <!-- 导入 -->
      <view id="section-import" class="section">
        <text class="section-title">导入</text>
        <view class="card">
          <view class="card-row" @click="onImport">
            <view class="row-info">
              <text class="row-name">从文件导入</text>
              <text class="row-desc">选一个导出的 JSON，覆盖当前数据（会先自动备份）</text>
            </view>
            <text class="row-arrow">›</text>
          </view>
        </view>
      </view>

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

    <!-- 导出历史弹层：可逐个分享或删除 -->
    <wd-popup v-model="showExportFiles" position="bottom" :safe-area-inset-bottom="true">
      <view class="backup-panel">
        <view class="panel-head">
          <text class="panel-title">导出历史</text>
          <text class="panel-close" @click="showExportFiles = false">关闭</text>
        </view>

        <view v-if="exportFiles.length === 0" class="panel-empty">
          <text class="panel-empty-text">还没有导出过文件</text>
        </view>

        <scroll-view v-else class="backup-scroll" scroll-y>
          <view
            v-for="f in exportFiles"
            :key="f.name"
            class="backup-row"
          >
            <view class="backup-info">
              <text class="backup-name">{{ formatExportTime(f.time) }}</text>
              <text class="backup-file">{{ f.name }}</text>
            </view>
            <view class="export-ops">
              <text class="export-op" :style="{ color: primaryColor }" @click="onShareExport(f)">分享</text>
              <text class="export-op export-op-danger" @click="onDeleteExport(f)">删除</text>
            </view>
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
import {
  autoBackup, listBackups, restoreBackup,
  exportToFile, listExportFiles, deleteExportFile, shareExportFile,
  chooseImportFile, importFromFile
} from '@/api/backup.js'
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
    const exportFiles = ref([])
    const showExportFiles = ref(false)

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

    async function loadExportFiles() {
      exportFiles.value = await listExportFiles()
    }

    /**
     * 导出一次。
     *
     * 只负责「生成文件」，不自动分享 ——
     * 用户可能只是想在手机上留一份，或者稍后从「导出历史」里再分享/删除。
     * 生成完直接问一句要不要分享，省得还要多点一次。
     */
    async function onExport() {
      uni.showLoading({ title: '导出中…' })
      try {
        // API Key 默认不导出（防误分享把 key 带出去）
        const res = await exportToFile({ includeApiKey: false })
        uni.hideLoading()
        await loadExportFiles()

        const wantsShare = await confirmDialog({
          title: '导出成功',
          content: `已生成 ${res.name}。要现在分享出去吗？`,
          confirmText: '分享',
          cancelText: '稍后'
        })
        if (!wantsShare) return

        uni.showLoading({ title: '打开分享…' })
        try {
          await shareExportFile(res.path)
          uni.hideLoading()
        } catch (e) {
          uni.hideLoading()
          await alertDialog({
            title: '分享没成功',
            content: `${e.message}\n\n文件已经生成，可以在「导出历史」里再试一次，或把它删掉重新导出。`
          })
        }
      } catch (e) {
        uni.hideLoading()
        await alertDialog({ title: '导出失败', content: e.message })
      }
    }

    /** 打开导出历史（顺便刷新一下列表） */
    async function openExportFiles() {
      await loadExportFiles()
      showExportFiles.value = true
    }

    /* ------------------------------------------------------ 分享 */

    /**
     * 分享「导出历史」里的某个文件。
     *
     * ★ 这次为什么能成 ★
     *   老版本走 plus.share，传 file:// 路径给微信 ——
     *   Android 7+ 的 FileUriExposedException 会直接拦掉，
     *   所以永远是「获取资源失败」。
     *   现在改用 uni.shareWithSystem（系统分享面板），
     *   新版基座内部会把路径转成 content:// URI，不再有这个坎。
     */
    async function onShareExport(file) {
      uni.showLoading({ title: '打开分享…' })
      try {
        await shareExportFile(file.path)
        uni.hideLoading()
      } catch (e) {
        uni.hideLoading()
        await alertDialog({ title: '分享没成功', content: e.message })
      }
    }

    /**
     * 删除「导出历史」里的某个文件。
     *
     * 用户要求：「要支持对导出历史进行删除」——
     * 导出目录会越攒越多，得能自己清。
     */
    async function onDeleteExport(file) {
      const ok = await confirmDialog({
        title: '删除这个导出文件？',
        content: `将删除 ${file.name}。不影响 App 内的数据。`,
        confirmText: '删除',
        danger: true
      })
      if (!ok) return

      try {
        await deleteExportFile(file.path)
        await loadExportFiles()
        uni.showToast({ title: '已删除', icon: 'success' })
      } catch (e) {
        await alertDialog({ title: '删除失败', content: e.message })
      }
    }

    /* ------------------------------------------------------ 导入 */

    /**
     * 从系统文件选择器选一个 JSON 导入。
     *
     * ★ 导入是「覆盖」而不是「合并」★
     *   合并要处理 id 冲突、updated_at 取新、重复判定……
     *   对个人记账来说，导入的目的基本就是「换手机搬数据」或「回滚」，
     *   覆盖语义更清楚。覆盖前 api 层会自动备份当前库，能反悔。
     */
    async function onImport() {
      let picked = ''
      try {
        uni.showLoading({ title: '选择文件…' })
        picked = await chooseImportFile()
        uni.hideLoading()
      } catch (e) {
        uni.hideLoading()
        // 用户主动取消不算错误，不用弹框打扰
        if (/取消/.test(e.message)) return
        await alertDialog({ title: '选择文件失败', content: e.message })
        return
      }

      const ok = await confirmDialog({
        title: '用这个文件覆盖当前数据？',
        content: '导入会清空当前所有账户、交易、分类，再写入文件里的内容。\n导入前会自动备份一次，万一不对可以从备份恢复。',
        confirmText: '导入',
        danger: true
      })
      if (!ok) return

      uni.showLoading({ title: '导入中…' })
      try {
        const report = await importFromFile(picked)
        uni.hideLoading()

        clearSettingsCache()
        await settingStore.load()
        await accountStore.refresh()
        await txnStore.loadHome(true)
        await loadCounts()
        await loadBackups()

        await alertDialog({
          title: '导入完成',
          content: [
            `账户 ${report.accounts} 个`,
            `交易 ${report.transactions} 笔`,
            `分类 ${report.categories} 个`,
            `标签 ${report.tags} 个`
          ].join('\n')
        })
      } catch (e) {
        uni.hideLoading()
        await alertDialog({ title: '导入失败', content: e.message })
      }
    }

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

    /** 导出历史里的时间显示（文件名里解析出来的，可能解析不出） */
    function formatExportTime(ts) {
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
      exportFiles, showExportFiles,
      primaryColor, pageStyle, scrollTarget,
      onExport, openExportFiles, onShareExport, onDeleteExport, onImport,
      onRestoreBackup,
      onToggleAutoBackup, onManualBackup,
      onRepair, onClearAll,
      formatBackupTime, formatExportTime, goBack, settingStore
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

/* 导出历史每行右侧的两个操作：分享 / 删除 */
.export-ops {
  display: flex;
  align-items: center;
  gap: 32rpx;
  flex-shrink: 0;
  margin-left: 16rpx;
}

.export-op {
  font-size: 24rpx;
  padding: 8rpx 0;
}

.export-op-danger {
  color: var(--app-danger);
}
</style>
