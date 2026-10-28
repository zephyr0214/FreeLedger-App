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
        </view>
      </view>

      <!-- 导入 -->
      <view id="section-import" class="section">
        <text class="section-title">导入</text>
        <view class="card">
          <view class="card-row" @click="onImport">
            <view class="row-info">
              <text class="row-name">从文件导入</text>
              <text class="row-desc">浏览应用文件夹，选一个 JSON 覆盖当前数据（先自动备份）</text>
            </view>
            <text class="row-arrow">›</text>
          </view>
        </view>
      </view>

      <!-- 历史数据管理：扫描三个文件夹（_doc/_downloads/_documents）里的所有 JSON，可逐个恢复 / 删除 -->
      <view id="section-data" class="section">
        <text class="section-title">历史数据管理</text>
        <view class="card">
          <view class="card-row" @click="onOpenDataManager">
            <view class="row-info">
              <text class="row-name">备份与导出文件</text>
              <text class="row-desc">{{ dataFiles.length }} 个 JSON 文件，可恢复或删除</text>
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
          备份位于 _doc/backup/，导出位于 _doc/export/，可在「数据管理」里恢复或删除。
        </text>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 数据管理弹层：列出备份 + 导出的所有 JSON，每个可恢复 / 删除 -->
    <wd-popup v-model="showDataManager" position="bottom" :safe-area-inset-bottom="true">
      <view class="backup-panel">
        <view class="panel-head">
          <text class="panel-title">历史数据管理</text>
          <view class="panel-head-ops">
            <text class="panel-close" @click="refreshDataManager">刷新</text>
            <text class="panel-close" @click="showDataManager = false">关闭</text>
          </view>
        </view>

        <view class="panel-tip">
          <text class="panel-tip-text">扫描 _doc / _downloads / _documents 三个文件夹里的所有 JSON 文件，可逐个恢复或删除。</text>
        </view>

        <view v-if="dataFiles.length === 0" class="panel-empty">
          <text class="panel-empty-text">没有任何 JSON 文件</text>
        </view>

        <scroll-view v-else class="backup-scroll" scroll-y>
          <view
            v-for="f in dataFiles"
            :key="f.path"
            class="backup-row"
          >
            <view class="backup-info">
              <text class="backup-name">
                <text :class="['data-kind', f.kind === 'backup' ? 'data-kind-backup' : 'data-kind-export']">{{ kindLabel(f.kind) }}</text>
                {{ formatDataTime(f.time) }}
              </text>
              <text class="backup-file">{{ f.name }}</text>
            </view>
            <view class="export-ops">
              <text class="export-op" :style="{ color: primaryColor }" @click="onRestoreData(f)">恢复</text>
              <text class="export-op export-op-danger" @click="onDeleteData(f)">删除</text>
            </view>
          </view>
        </scroll-view>
      </view>
    </wd-popup>

    <!-- 导入：应用内文件浏览（系统选择器在当前基座不回调，改用 plus.io 扫描） -->
    <wd-popup v-model="showImportPicker" position="bottom" :safe-area-inset-bottom="true">
      <view class="backup-panel">
        <view class="panel-head">
          <text class="panel-title">选择要导入的文件</text>
          <text class="panel-close" @click="showImportPicker = false">关闭</text>
        </view>

        <view class="panel-tip">
          <text class="panel-tip-text">扫描的是应用可访问的文件夹（_doc / _downloads / _documents），按修改时间排序。</text>
        </view>

        <view v-if="importFiles.length === 0" class="panel-empty">
          <text class="panel-empty-text">没有找到可导入的 JSON 文件</text>
        </view>

        <scroll-view v-else class="backup-scroll" scroll-y>
          <view
            v-for="f in importFiles"
            :key="f.path"
            class="backup-row"
            @click="onPickImportFile(f)"
          >
            <view class="backup-info">
              <text class="backup-name">{{ formatImportTime(f.time) }}</text>
              <text class="backup-file">{{ f.name }}</text>
            </view>
            <text class="backup-action">导入</text>
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
  listImportableFiles, importFromFile
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
    const exportFiles = ref([])
    const importFiles = ref([])
    const showImportPicker = ref(false)
    /** 数据管理：备份 + 导出合并列表，每个 { path, name, time, kind } */
    const dataFiles = ref([])
    const showDataManager = ref(false)

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
          const r = await shareExportFile(res.path)
          uni.hideLoading()
          // 降级成文本分享时，给用户说清楚
          if (r && r.used === 'text') {
            uni.showToast({
              title: '已按文本分享（文件方式不可用）',
              icon: 'none'
            })
          }
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

    /* ------------------------------------------------------ 历史数据管理 */

    /** 根据目录判断文件类型标签 */
    function kindFromDir(dir) {
      const d = String(dir || '')
      if (/backup/.test(d)) return 'backup'
      if (/export/.test(d)) return 'export'
      if (/import/.test(d)) return 'import'
      if (/downloads?/i.test(d) || /download/i.test(d)) return 'download'
      return 'other'
    }

    /** 类型标签的显示文字 */
    function kindLabel(kind) {
      return (
        { backup: '备份', export: '导出', import: '导入', download: '下载', other: '文件' }[kind] || '文件'
      )
    }

    /**
     * 扫描三个文件夹（_doc / _downloads / _documents）里的所有 JSON。
     * ★ 和「从文件导入」用的同一个扫描函数 listImportableFiles ★
     *   _doc 里递归包含 backup / export / import，所以三个根就全覆盖了。
     */
    async function loadDataManager() {
      const files = await listImportableFiles()
      dataFiles.value = files.map((f) => ({ ...f, kind: kindFromDir(f.dir) }))
      return dataFiles.value
    }

    /** 打开「历史数据管理」弹层（顺便刷新列表） */
    async function onOpenDataManager() {
      await refreshDataManager()
      showDataManager.value = true
    }

    /** 刷新历史数据列表（弹层里的「刷新」按钮也用它） */
    async function refreshDataManager() {
      uni.showLoading({ title: '扫描…' })
      try {
        await loadDataManager()
        uni.hideLoading()
      } catch (e) {
        uni.hideLoading()
        await alertDialog({ title: '扫描失败', content: (e && e.message) || '无法读取文件列表' })
      }
    }

    /**
     * 恢复某个 JSON 文件（覆盖当前数据）。
     * 备份/导出/导入都是完整快照，恢复语义一致。
     */
    async function onRestoreData(file) {
      const ok = await confirmDialog({
        title: '用这个文件恢复数据？',
        content: `将用 ${formatDataTime(file.time)} 的${kindLabel(file.kind)}覆盖当前数据。\n当前数据会先自动备份一次，万一不对可以再恢复回来。`,
        confirmText: '恢复',
        danger: true
      })
      if (!ok) return

      showDataManager.value = false
      uni.showLoading({ title: '恢复中…' })
      try {
        const report = await restoreBackup(file.path)
        uni.hideLoading()

        clearSettingsCache()
        await settingStore.load()
        await accountStore.refresh()
        await txnStore.loadHome(true)
        await loadCounts()
        await loadDataManager()

        await alertDialog({
          title: '恢复完成',
          content: [
            `账户 ${report.accounts} 个`,
            `交易 ${report.transactions} 笔`,
            `分类 ${report.categories} 个`,
            `标签 ${report.tags} 个`
          ].join('\n')
        })
      } catch (e) {
        uni.hideLoading()
        await alertDialog({ title: '恢复失败', content: e.message })
      }
    }

    /** 删除某个 JSON 文件（不影响 App 内数据） */
    async function onDeleteData(file) {
      const ok = await confirmDialog({
        title: '删除这个文件？',
        content: `将删除 ${file.name}。不影响 App 内的数据。`,
        confirmText: '删除',
        danger: true
      })
      if (!ok) return

      try {
        await deleteExportFile(file.path)
        await loadDataManager()
        uni.showToast({ title: '已删除', icon: 'success' })
      } catch (e) {
        await alertDialog({ title: '删除失败', content: e.message })
      }
    }

    /* ------------------------------------------------------ 导入 */

    /**
     * 从应用文件夹导入。
     *
     * ★ 为什么不是系统文件选择器 ★
     *   用户实测（日志）：这个基座上 startActivityForResult 能调起，
     *   但 onActivityResult 事件从不回调，90 秒后报「系统未回调」。
     *   所以 Native.js + ACTION_GET_CONTENT 走不通。
     *
     *   官方文档对 App 端的建议是：选 _doc/_downloads/_documents 里的
     *   文件，用 plus.io API 自己做选择框。这里就照着做：
     *   扫这几个目录列出 .json，用户在应用内挑一个。
     *
     * ★ 导入是「覆盖」而不是「合并」★
     *   覆盖前 api 层会自动备份当前库，能反悔。
     */
    async function onImport() {
      const T0 = Date.now()
      const log = (tag, extra) => {
        const t = new Date(Date.now())
        const pad = (n) => String(n).padStart(2, '0')
        const stamp = `${t.getHours()}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`
        console.log(`[自由记导入页面] ${stamp} ${tag}`, extra === undefined ? '' : extra)
      }

      log('onImport 开始（应用内浏览）')
      uni.showLoading({ title: '扫描文件…' })
      try {
        importFiles.value = await listImportableFiles()
        uni.hideLoading()
        log('listImportableFiles 返回', { 数量: importFiles.value.length, 耗时ms: Date.now() - T0 })
      } catch (e) {
        uni.hideLoading()
        log('listImportableFiles 失败', (e && e.message) || '')
        await alertDialog({ title: '扫描失败', content: (e && e.message) || '无法读取文件列表' })
        return
      }
      showImportPicker.value = true
    }

    /** 用户在应用内文件列表里选中一个 */
    async function onPickImportFile(file) {
      showImportPicker.value = false
      const ok = await confirmDialog({
        title: '用这个文件覆盖当前数据？',
        content: `${file.name}\n\n导入会清空当前所有账户、交易、分类，再写入文件里的内容。\n导入前会自动备份一次，万一不对可以从备份恢复。`,
        confirmText: '导入',
        danger: true
      })
      if (!ok) return

      uni.showLoading({ title: '导入中…' })
      try {
        const report = await importFromFile(file.path)
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

    /** 数据管理里的时间显示（备份文件名解析 / 导出文件名解析 / 修改时间） */
    function formatDataTime(ts) {
      if (!ts) return '未知时间'
      const d = new Date(ts)
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    /** 可导入文件的修改时间 */
    function formatImportTime(ts) {
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
      // ★ 一进页面就扫一次，让「历史数据管理」的数量立即正确，
      //   不用等点进去才加载（之前就是只在点开时加载，首次显示 0）★
      await loadDataManager()

      // 内容加载完再滚，保证目标区块已经渲染出来
      if (pendingTab.value) {
        await applyTab(pendingTab.value)
      }
    })

    return {
      counts, autoBackupOn, backupList, exportFiles,
      importFiles, showImportPicker,
      dataFiles, showDataManager,
      primaryColor, pageStyle, scrollTarget,
      onExport,
      onImport, onPickImportFile,
      onOpenDataManager, onRestoreData, onDeleteData, refreshDataManager, kindLabel,
      onToggleAutoBackup, onManualBackup,
      onRepair, onClearAll,
      formatDataTime, formatImportTime, goBack, settingStore
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

/* 面板头部右侧的按钮组（刷新 / 关闭） */
.panel-head-ops {
  display: flex;
  align-items: center;
  gap: 28rpx;
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

/* 导入文件浏览弹层顶部的说明条 */
.panel-tip {
  padding: 12rpx 28rpx 20rpx;
}

.panel-tip-text {
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.5;
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

/* 数据管理里的类型标签：备份 / 导出 */
.data-kind {
  font-size: 20rpx;
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
  border: 1rpx solid;
  margin-right: 10rpx;
}

.data-kind-backup {
  color: var(--app-primary);
  border-color: var(--app-primary);
}

.data-kind-export {
  color: var(--app-text-2);
  border-color: var(--app-text-2);
}
</style>
