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

      <!-- 导出 -->
      <view id="section-export" class="section">
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

          <!-- 已导出的文件列表：可以逐个分享/删除 -->
          <view class="card-row" @click="showExportFiles = true">
            <view class="row-info">
              <text class="row-name">管理已导出的文件</text>
              <text class="row-desc">{{ exportFiles.length }} 个文件，可分享或删除</text>
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

    <!-- 已导出文件管理弹层：可逐个分享或删除 -->
    <wd-popup v-model="showExportFiles" position="bottom" :safe-area-inset-bottom="true">
      <view class="backup-panel">
        <view class="panel-head">
          <text class="panel-title">已导出的文件</text>
          <text class="panel-close" @click="showExportFiles = false">关闭</text>
        </view>

        <view v-if="exportFiles.length === 0" class="panel-empty">
          <text class="panel-empty-text">还没有导出过文件</text>
        </view>

        <scroll-view v-else class="backup-scroll" scroll-y>
          <view v-for="f in exportFiles" :key="f.name" class="backup-row export-row">
            <view class="backup-info">
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
  exportToFile, listExportFiles, importFromFile, autoBackup,
  listBackups, importPayload, toAbsolutePath, copyFileTo, resolveSharePath,
  prepareShareFile, deleteExportFile, chooseFileFromSystem
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
    const showExportFiles = ref(false)
    const exportFiles = ref([])

    /**
     * scroll-view 的滚动目标（元素 id）。
     *
     * ★ 必须是 id，不是 class ★
     *   scroll-into-view 靠 id 定位元素。
     *   （项目里踩过这个坑：AI 页写成了 class，定位不到，一直停在顶部。）
     */
    const scrollTarget = ref('')

    /** URL 上带的 tab 参数：'export' | 'backup' | '' */
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
      if (tab === 'export') {
        await scrollToSection('section-export')
      } else if (tab === 'backup') {
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

    async function onExport(includeApiKey) {
      if (includeApiKey) {
        const confirmed = await confirmDialog({
          title: '包含 API Key',
          content: '导出的文件会包含你的 API Key 明文。如果你会把文件分享或上传，请不要选择此项。',
          confirmText: '仍要导出',
          danger: true
        })
        if (!confirmed) return
      }

      uni.showLoading({ title: '导出中…' })
      try {
        const res = await exportToFile({ includeApiKey })
        uni.hideLoading()

        await setSettings({ lastExportAt: Date.now() })

        // 导出成功后给三个去处：分享 / 复制到指定文件夹 / 知道了
        const absPath = toAbsolutePath(res.path)
        const idx = await new Promise((resolve) => {
          uni.showActionSheet({
            itemList: ['分享出去', '复制到指定文件夹', '知道了'],
            success: (r) => resolve(r.tapIndex),
            fail: () => resolve(-1)
          })
        })

        if (idx === 0) {
          shareFile(res.path)
        } else if (idx === 1) {
          copyExportToFolder(res.path)
        } else {
          uni.showModal({
            title: '导出成功',
            content: `文件：${res.filename}\n大小：${(res.size / 1024).toFixed(1)} KB\n\n保存位置：\n${absPath}`,
            showCancel: false,
            confirmText: '知道了'
          })
        }
      } catch (e) {
        uni.hideLoading()
        await alertDialog({ title: '导出失败', content: e && e.message })
      }
    }

    /**
     * 分享导出的文件。
     *
     * ★ 「获取资源失败」的真正原因是分区存储，不是路径格式 ★
     *   Android 11+ 之后，App 私有目录
     *   （Android/data/<pkg>/doc/export/）下的文件只有本 App 能读。
     *   微信拿到这个 file:// 路径没有权限打开，就报「获取资源失败」。
     *
     *   所以分享前必须先把文件搬到**公共下载目录**，
     *   再分享公共目录里的那份 —— prepareShareFile() 做这件事：
     *     Android：复制到 _downloads/ 再分享
     *     iOS：沙盒文件分享时系统会临时授权，不用搬
     */
    async function shareFile(relPath, filename) {
      if (typeof plus === 'undefined') {
        uni.showToast({ title: '分享仅在 App 端可用', icon: 'none' })
        return
      }

      let absPath = ''
      uni.showLoading({ title: '准备分享…', mask: true })
      try {
        absPath = await prepareShareFile(relPath, filename)
        uni.hideLoading()
      } catch (e) {
        uni.hideLoading()
        await alertDialog({
          title: '无法分享',
          content: (e && e.message) || '导出文件不存在'
        })
        return
      }

      try {
        plus.share.sendWithSystem(
          { type: 'file', filePath: absPath },
          () => {},
          (e) => {
            uni.showModal({
              title: '分享没有完成',
              content:
                `系统分享返回：${(e && e.message) || '未知原因'}\n\n` +
                `文件已放在公共下载目录：\n${absPath}\n\n` +
                '可以用文件管理器打开下载目录，从那里发给对方。',
              showCancel: false,
              confirmText: '知道了'
            })
          }
        )
      } catch (e) {
        uni.showModal({
          title: '分享不可用',
          content: `文件已保存到：\n${absPath}`,
          showCancel: false,
          confirmText: '知道了'
        })
      }
    }

    /* -------------------------------------------- 已导出文件管理 */

    /** 分享列表里的某个文件 */
    async function onShareExport(f) {
      showExportFiles.value = false
      await shareFile(f.path, f.name)
    }

    /** 删除列表里的某个文件 */
    async function onDeleteExport(f) {
      const ok = await confirmDialog({
        title: '删除这个文件？',
        content: `${f.name}\n\n只是删掉这份导出文件，账本数据不受影响。`,
        confirmText: '删除',
        danger: true
      })
      if (!ok) return

      try {
        await deleteExportFile(f.path)
        exportFiles.value = await listExportFiles()
        uni.showToast({ title: '已删除', icon: 'success' })
      } catch (e) {
        await alertDialog({ title: '删除失败', content: e && e.message })
      }
    }

    /**
     * 复制导出文件到用户指定的位置。
     *
     * 用户要求：「导入时候设置为可自定义位置，然后复制到指定文件夹下」
     * —— 即让用户自己选一个文件夹，把导出的 JSON 复制过去，
     * 这样用文件管理器 / 微信 / 网盘都能找到。
     */
    async function copyExportToFolder(relPath) {
      if (typeof plus === 'undefined') {
        uni.showToast({ title: '仅在 App 端可用', icon: 'none' })
        return
      }

      const srcAbs = toAbsolutePath(relPath)
      const fileName = String(relPath).split('/').pop()

      // 让用户选目标文件夹。
      // ★ 这里用 plus.io 的目录选择能力 ★
      //   App 端没有标准的「选文件夹」API，
      //   所以退一步：提供几个常用目标目录让用户选（下载目录 / 文档目录），
      //   比让用户自己敲路径现实得多。
      const targets = [
        { key: '_downloads/', label: '下载目录' },
        { key: '_documents/', label: '文档目录' },
        { key: '_doc/', label: 'App 私有目录（_doc）' }
      ]

      uni.showActionSheet({
        itemList: targets.map((t) => t.label),
        success: async (res) => {
          const target = targets[res.tapIndex]
          if (!target) return

          uni.showLoading({ title: '复制中…', mask: true })
          try {
            const destAbs = await copyFileTo(srcAbs, target.key, fileName)
            uni.hideLoading()
            uni.showModal({
              title: '已复制',
              content: `文件已复制到：\n${destAbs}`,
              showCancel: false,
              confirmText: '知道了'
            })
          } catch (e) {
            uni.hideLoading()
            await alertDialog({ title: '复制失败', content: e && e.message })
          }
        }
      })
    }

    /* ------------------------------------------------------ 导入 */

    /**
     * 可扫描的导入目录。
     *
     * ★ 为什么要多个目录 ★
     *   用户把 JSON 从微信/网盘拿到手机后，通常落在「下载」目录，
     *   不会在 `_doc/export/` 里。只扫一个固定目录的话，
     *   用户会一直看到「没有找到备份文件」，根本不知道要放哪。
     *   这里把常见的几个目录都扫一遍（能扫到就列，扫不到就跳过）。
     */
    const IMPORT_DIRS = [
      { key: '_doc/export/', label: 'App 导出目录' },
      { key: '_downloads/', label: '下载目录' },
      { key: '_documents/', label: '文档目录' }
    ]

    /** 列出某个目录下的 json 文件（目录不存在就返回空数组） */
    function listJsonIn(dir) {
      return new Promise((resolve) => {
        if (typeof plus === 'undefined') {
          resolve([])
          return
        }
        plus.io.resolveLocalFileSystemURL(
          dir,
          (entry) => {
            const reader = entry.createReader()
            reader.readEntries(
              (entries) => {
                resolve(
                  entries
                    .filter((e) => e.isFile && /\.json$/i.test(e.name))
                    .map((e) => ({ name: e.name, path: `${dir}${e.name}`, dir }))
                )
              },
              () => resolve([])
            )
          },
          () => resolve([])
        )
      })
    }

    /**
     * 导入。
     *
     * ★ 用户要求：调起系统文件选择器，自己挑文件位置 ★
     *   之前是「扫几个固定目录 → 让用户从列表里选」，
     *   文件不在那几个目录里就完全没法导入 —— 体验很受限。
     *
     *   现在直接调系统文件管理器（Android 用 Native.js 起 Intent），
     *   用户可以在任意位置挑：下载、网盘、微信文件、U 盘……
     *
     * ★ 兜底 ★
     *   系统选择器调不起来（比如 iOS 没原生插件）时，
     *   退回原来的「固定目录列表」，至少还有条路能走。
     */
    async function onImport(mode) {
      const title = mode === 'merge' ? '合并导入' : '覆盖导入'
      const tip =
        mode === 'merge'
          ? '保留现有数据，按 ID 去重后追加。'
          : '⚠️ 会清空当前所有数据后导入，执行前会自动备份。'

      // 先问一句确认，避免误触
      const go = await confirmDialog({
        title,
        content: `${tip}\n\n接下来会打开系统文件选择器，请选择要导入的 .json 文件。`,
        confirmText: '选择文件'
      })
      if (!go) return

      uni.showLoading({ title: '打开文件选择…', mask: true })
      let path = ''
      try {
        path = await chooseFileFromSystem()
        uni.hideLoading()
      } catch (e) {
        uni.hideLoading()
        const msg = (e && e.message) || ''

        // 用户主动取消 —— 不用报错
        if (/取消|cancel/i.test(msg)) return

        // 调不起来 -> 退回固定目录方案
        await alertDialog({
          title: '无法打开系统文件选择',
          content: `${msg}\n\n将改用「从固定目录选择」：之后会列出 App 导出目录、下载目录里的 .json 文件。`
        })
        await importFromDirs(mode, tip)
        return
      }

      await doImport(path, mode)
    }

    /**
     * 兜底：从固定目录里选文件（旧的方案）。
     *
     * 保留它是因为 iOS 上没法免插件调起文件选择器，
     * 有这条退路至少不会完全卡死。
     */
    async function importFromDirs(mode, tip) {
      uni.showLoading({ title: '查找文件…' })
      let files = []
      try {
        const groups = await Promise.all(IMPORT_DIRS.map((d) => listJsonIn(d.key)))
        files = groups.flat()
      } finally {
        uni.hideLoading()
      }

      if (files.length === 0) {
        await alertDialog({
          title: '没有找到可导入的文件',
          content:
            '已在这几个位置查找 .json 文件：\n\n' +
            IMPORT_DIRS.map((d) => `· ${d.label}（${d.key}）`).join('\n') +
            '\n\n你可以：\n' +
            '1. 直接在「导出」里导出一份（会落到 App 导出目录）\n' +
            '2. 用文件管理器把备份文件复制到「下载」目录，再回来导入'
        })
        return
      }

      const label = (f) => {
        const d = IMPORT_DIRS.find((x) => x.key === f.dir)
        return `${f.name}（${d ? d.label : f.dir}）`
      }

      uni.showActionSheet({
        alertText: tip,
        itemList: files.slice(0, 6).map(label),
        success: async (res) => {
          const file = files[res.tapIndex]
          if (!file) return
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

        await alertDialog({
          title: '导入完成',
          content: lines.join('\n')
        })
      } catch (e) {
        uni.hideLoading()
        await alertDialog({ title: '导入失败', content: e.message })
      }
    }

    async function onRestoreBackup(backup) {
      const confirmed = await confirmDialog({
        title: '从备份恢复？',
        content: `将用 ${formatBackupTime(backup.time)} 的备份覆盖当前数据。当前数据会先自动备份一次。`,
        confirmText: '恢复',
        danger: true
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
      exportFiles.value = await listExportFiles()

      // 内容加载完再滚，保证目标区块已经渲染出来
      if (pendingTab.value) {
        await applyTab(pendingTab.value)
      }
    })

    return {
      counts, autoBackupOn, backupList, showBackups, exportFiles, showExportFiles,
      primaryColor, pageStyle, scrollTarget,
      onExport, onImport, onRestoreBackup,
      onShareExport, onDeleteExport,
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

/* 已导出文件列表：每行右侧两个操作 */
.export-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.export-ops {
  display: flex;
  align-items: center;
  gap: 24rpx;
  flex-shrink: 0;
}

.export-op {
  font-size: 26rpx;
}

.export-op-danger {
  color: var(--app-danger);
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
