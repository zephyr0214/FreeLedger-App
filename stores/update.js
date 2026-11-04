/**
 * 应用内更新 —— 检查 / 弹窗 / 下载 的状态机
 *
 * ★ 为什么用 store 编排而不是页面各自实现 ★
 *   更新有三个触发点：
 *     · 开屏静默检查（App.vue onLaunch）
 *     · 「我的 → 系统设置 → 检查更新」（手动）
 *     · 更新日志页右上角「检查更新」（手动）
 *   弹窗要在「当前所在的页面」出现 —— 用 store 存状态，
 *   UpdateDialog 组件在三个页面各挂一个实例，读同一份状态，
 *   谁在屏幕上就显示在谁那里。
 *
 * ★ 状态流转 ★
 *   idle --checkForUpdate(有新版)--> 弹窗(idle)
 *   弹窗 --confirmDownload--> downloading --完成--> installing --> 系统安装器
 *   downloading --dismiss--> idle（取消下载，保留已下载文件——
 *                              plus.downloader 断点续传，重下不浪费）
 */

import { defineStore } from 'pinia'
import {
  checkUpdate as fetchCheck, downloadApk, installApk, abortDownload,
  openUnknownSourceSettings
} from '@/api/update.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'

export const useUpdateStore = defineStore('update', {
  state: () => ({
    /** 是否正在请求检查接口 */
    checking: false,
    /** 更新弹窗是否显示 */
    dialogVisible: false,
    /** checkUpdate 产出的更新信息 {version, notes, downloadUrl, sizeBytes} */
    info: null,
    /** idle | downloading | installing */
    phase: 'idle',
    /** 下载进度 0~100 */
    progress: 0
  }),

  actions: {
    /**
     * 检查更新
     * @param {boolean} silent true = 静默（开屏检查）：无新版/失败都不打扰用户
     *                         false = 手动：无新版提示「已是最新」，失败弹原因
     * @returns {Promise<boolean>} 是否发现了新版本
     */
    async checkForUpdate(silent = false) {
      if (this.checking) return false
      // 弹窗已经开着，重复检查没有意义
      if (this.dialogVisible) return true

      this.checking = true
      try {
        const res = await fetchCheck()
        if (!res || !res.hasUpdate) {
          if (!silent) uni.showToast({ title: '当前已是最新版本', icon: 'none' })
          return false
        }
        this.info = res
        this.phase = 'idle'
        this.progress = 0
        this.dialogVisible = true
        return true
      } catch (e) {
        if (!silent) {
          uni.showToast({ title: '检查更新失败：' + (e.message || '网络错误'), icon: 'none' })
        }
        return false
      } finally {
        this.checking = false
      }
    },

    /**
     * 「下次再说」/「取消下载」：收弹窗。
     * 下载中取消会 abort 任务，已下载的部分留在 _doc/update/，
     * plus.downloader 支持断点续传，下次重下不会从头开始。
     */
    dismiss() {
      if (this.phase === 'downloading') abortDownload()
      this.dialogVisible = false
      this.phase = 'idle'
      this.progress = 0
    },

    /**
     * 「立即下载更新」：下载 → 完成后自动拉起系统安装器
     *
     * ★ 安装失败中最常见的是「未授权安装未知应用」（Android 8+）★
     *   这种错误不弹普通失败框，而是引导去系统设置授权 ——
     *   授权后重新点下载，已缓存的安装包续传，几秒就能装。
     */
    async confirmDownload() {
      if (this.phase !== 'idle' || !this.info) return
      this.phase = 'downloading'
      this.progress = 0
      try {
        const name = 'FreeLedger-v' + this.info.version + '.apk'
        const local = await downloadApk(this.info.downloadUrl, name, (pct) => {
          this.progress = pct
        })
        this.phase = 'installing'
        await installApk(local)
        // install 成功 = 系统安装器已拉起，App 退到后台；这里收尾即可
        this.dismiss()
      } catch (e) {
        this.phase = 'idle'
        const msg = (e && e.message) || '未知错误'
        if (/unknown|未知|授权|安装未知|INSTALL/i.test(msg)) {
          const go = await confirmDialog({
            title: '需要授权安装',
            content: '请在系统设置中允许本应用「安装未知应用」，授权后回到 App 重新点「立即下载更新」即可（已下载的内容不会浪费）。',
            confirmText: '去设置',
            cancelText: '取消'
          })
          if (go) {
            openUnknownSourceSettings()
          }
        } else {
          await alertDialog({ title: '下载 / 安装失败', content: msg })
        }
      }
    }
  }
})
