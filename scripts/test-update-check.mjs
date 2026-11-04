/**
 * 检查更新功能的测试
 *
 *   node scripts/test-update-check.mjs
 *
 * ★ 用户要求 ★
 *   「我的页系统设置下方增加检查更新条目，更新日志页右上角也增加检查更新按钮，
 *     使用 gitee 检查更新，每次开屏之前也检查一次，
 *     若无新版本则无反应，若有新版本则显示弹窗，
 *     可以立即下载更新，也可下次再说。」
 *
 * ★ 这里测三层 ★
 *   1. compareVersions 纯函数 —— 版本比较必须按数字逐段比，
 *      不能掉进 '1.9' > '1.10' 的字典序陷阱
 *   2. resolveUpdate 纯函数 —— Gitee 响应归一化：
 *      必须挑出 .apk 附件（不能拿源码 zip 当安装包）、
 *      版本不比本地新时 hasUpdate=false
 *   3. 源码级接线 —— 三个触发点、弹窗挂载、Gitee 数据源
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { compareVersions, APP_VERSION } from '../utils/version.js'
import { resolveUpdate } from '../api/update.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8')

let pass = 0
let fail = 0

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    fail++
    console.log(`FAIL  ${name}\n      实际 ${a}\n      期望 ${e}`)
  }
}

/* --------------------------------------------- 1. 版本比较 */

console.log('=== 版本比较（数字逐段，不是字典序）===')

check('相同', compareVersions('1.16.2', '1.16.2'), 0)
check('新版本更大', compareVersions('1.16.3', '1.16.2'), 1)
check('旧版本更小', compareVersions('1.16.1', '1.16.2'), -1)
check('次版本号进位', compareVersions('1.17.0', '1.16.9'), 1)
check('主版本号进位', compareVersions('2.0.0', '1.99.0'), 1)

/*
 * ★ 字典序陷阱 ★
 *   字符串比较下 '1.9' > '1.10'（因为 '9' > '1'），
 *   但语义上 1.10 才是更新的。必须按数字比。
 */
check('1.10 比 1.9 新（字典序会判反）', compareVersions('1.10.0', '1.9.0'), 1)
check('1.9 比 1.10 旧', compareVersions('1.9.0', '1.10.0'), -1)

// tag 带 v 前缀、两段式都要能处理（Gitee 的 tag 形如 v1.16.3）
check('容忍 v 前缀', compareVersions('v1.16.3', '1.16.2'), 1)
check('容忍两段式', compareVersions('1.17', '1.16.9'), 1)
check('两段式 vs 三段式补零相等', compareVersions('1.16', '1.16.0'), 0)
check('v 前缀 + 两段式', compareVersions('v2.0', '1.99.9'), 1)

/* --------------------------------------------- 2. Gitee 响应归一化 */

console.log('=== Gitee 响应归一化 ===')

/** 一条典型的 Gitee /releases/latest 响应 */
function giteeFixture(overrides = {}) {
  return {
    tag_name: 'v1.16.3',
    name: 'v1.16.3',
    body: '## 新增\n- 检查更新',
    assets: [
      // Gitee 会自动附带源码包 —— 不能当安装包
      { name: 'v1.16.3.zip', browser_download_url: 'https://gitee.com/x/archive/v1.16.3.zip' },
      { name: 'v1.16.3.tar.gz', browser_download_url: 'https://gitee.com/x/archive/v1.16.3.tar.gz' },
      { name: 'FreeLedger-v1.16.3.apk', browser_download_url: 'https://gitee.com/x/releases/download/v1.16.3/FreeLedger-v1.16.3.apk', size: 15360000 }
    ],
    ...overrides
  }
}

{
  const r = resolveUpdate(giteeFixture(), '1.16.2')
  check('发现新版本', r.hasUpdate, true)
  check('版本号去掉 v 前缀', r.version, '1.16.3')
  check(
    '挑出 .apk 附件（不是源码 zip）',
    r.downloadUrl,
    'https://gitee.com/x/releases/download/v1.16.3/FreeLedger-v1.16.3.apk'
  )
  check('带上发行说明', r.notes.includes('检查更新'), true)
  check('带上大小', r.sizeBytes, 15360000)
}

console.log('=== 不比本地新时不算更新 ===')

check('版本相同', resolveUpdate(giteeFixture({ tag_name: 'v1.16.2' }), '1.16.2').hasUpdate, false)
check('远端更旧（不提示降级）', resolveUpdate(giteeFixture({ tag_name: 'v1.16.0' }), '1.16.2').hasUpdate, false)

console.log('=== 异常响应兜底 ===')

check('空响应', resolveUpdate(null, '1.16.2').hasUpdate, false)
check('没有 tag_name', resolveUpdate({ assets: [] }, '1.16.2').hasUpdate, false)
check(
  '没有 apk 附件（只有源码包）',
  resolveUpdate(giteeFixture({
    assets: [{ name: 'v1.16.3.zip', browser_download_url: 'x' }]
  }), '1.16.2').hasUpdate,
  false
)
check('assets 字段缺失', resolveUpdate({ tag_name: 'v1.16.3' }, '1.16.2').hasUpdate, false)

/* --------------------------------------------- 3. 源码级接线 */

console.log('=== 数据源是 Gitee ===')

{
  const api = read('api/update.js')
  check('Gitee API 地址', /gitee\.com\/api\/v5\/repos\/all0zy\/FreeLedger-App\/releases\/latest/.test(api), true)
  check('导出 resolveUpdate', /export function resolveUpdate/.test(api), true)
  check('导出 downloadApk', /export function downloadApk/.test(api), true)
  check('导出 installApk', /export function installApk/.test(api), true)
  check('下载走 plus.downloader', /plus\.downloader\.createDownload/.test(api), true)
  check('安装走 plus.runtime\.install', /plus\.runtime\.install/.test(api), true)
  check('有「安装未知应用」授权引导', /ACTION_MANAGE_UNKNOWN_APP_SOURCES/.test(api), true)
  // 下载/安装只在 App 端有实现，H5 必须给出可读错误而不是崩
  check('非 App 端有兜底错误', /请在 App 内使用检查更新/.test(api), true)
}

console.log('=== 三个触发点 ===')

{
  // ① 开屏静默检查
  const app = read('App.vue')
  check('App.vue 引入 updateStore', /useUpdateStore/.test(app), true)
  check('开屏静默检查（silent=true）', /checkForUpdate\(true\)/.test(app), true)
  // 静默检查必须延迟，别和数据库迁移/周期补记抢首屏
  check('开屏检查延迟执行', /setTimeout\([\s\S]{0,80}checkForUpdate\(true\)/.test(app), true)

  // ② 我的页「检查更新」条目
  const mine = read('pages/mine/index.vue')
  check('我的页有「检查更新」条目', /name: '检查更新'/.test(mine), true)
  check('点击走手动检查（silent=false）', /checkForUpdate\(false\)/.test(mine), true)
  check('我的页挂了 UpdateDialog', /<UpdateDialog\s*\/>/.test(mine), true)

  // ③ 更新日志页右上角按钮
  const log = read('pages/settings/changelog.vue')
  check('更新日志页有检查更新按钮', /onCheckUpdate/.test(log), true)
  check('日志页挂了 UpdateDialog', /<UpdateDialog\s*\/>/.test(log), true)
  /*
   * ★ 必须用 HeaderAction 组件 ★
   *   首页/账户页/统计页/我的页的右上角按钮都是它（胶囊底 + 主题色文字）。
   *   用户明确要求「和四个主页面右上角按钮样式保持一致」——
   *   自己写 .nav-action 会变成另一种样式。
   */
  check('用 HeaderAction 组件（与四个主页面统一）', /<HeaderAction\b/.test(log), true)
  check('没有自己写 nav-action 文字链接', /class="nav-action"/.test(log), false)

  // 首页也要挂弹窗：开屏静默检查时用户看的正是首页
  const index = read('pages/index/index.vue')
  check('首页挂了 UpdateDialog（开屏弹窗落点）', /<UpdateDialog\s*\/>/.test(index), true)
}

console.log('=== 弹窗行为 ===')

{
  const dlg = read('components/UpdateDialog.vue')
  check('「下次再说」按钮', /下次再说/.test(dlg), true)
  check('「立即下载更新」按钮', /立即下载更新/.test(dlg), true)
  check('下载进度条', /ud-progress-fill/.test(dlg), true)
  check('段落按行渲染（uni-app 会吃掉换行）', /noteLines/.test(dlg), true)
  // z-index 约定：页面内浮层 ≤ 9，低于库弹层 15，保证失败确认框能盖上来
  check('z-index 符合项目约定（9）', /z-index:\s*9/.test(dlg), true)

  const store = read('stores/update.js')
  check('状态机有 downloading 阶段', /phase = 'downloading'/.test(store), true)
  check('状态机有 installing 阶段', /phase = 'installing'/.test(store), true)
  check('静默模式无新版不打扰', /if \(!silent\) uni\.showToast\(\{ title: '当前已是最新版本'/.test(store), true)
  check('避免重复检查', /if \(this\.checking\) return false/.test(store), true)
  check('下载中取消会 abort', /abortDownload\(\)/.test(store), true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
