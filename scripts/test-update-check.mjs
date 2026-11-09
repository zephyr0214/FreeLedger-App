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

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { compareVersions, APP_VERSION } from '../utils/version.js'
import { resolveUpdate } from '../api/update.js'
import { apiLevelFromOsVersion } from '../api/notifier.js'

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

console.log('=== 测试更新入口已彻底删除 ===')

{
  /*
   * ★ 这条能力的生命周期 ★
   *   加 → 删(7977238) → 按需求加回 → 再删 → 加回 → **本次最终删除**
   *
   *   用户本轮原话：「删除测试弹窗的入口及其逻辑」。
   *
   *   ★ 为什么这次要连能力一起删 ★
   *     只删 UI 条目、留着 api 的 ignoreVersion 和 store 的
   *     checkForUpdateTest，等于留了一条「跳过版本比较」的暗路。
   *     它一旦被顺手接回去，就会把当前版本当新版本弹给用户。
   *     所以下面同时钉「正常检查照样比版本」和「能力已消失」两个方向。
   */

  // 正常检查的版本比较必须完好
  check('同版本不弹', resolveUpdate(giteeFixture({ tag_name: 'v1.16.2' }), '1.16.2').hasUpdate, false)
  check('更旧版本不弹', resolveUpdate(giteeFixture({ tag_name: 'v1.16.0' }), '1.16.2').hasUpdate, false)
  check('更新版本正常弹', resolveUpdate(giteeFixture({ tag_name: 'v1.16.3' }), '1.16.2').hasUpdate, true)

  const src = read('api/update.js')
  const storeSrc = read('stores/update.js')
  const mineSrc = read('pages/mine/index.vue')
  const dlgSrc = read('components/UpdateDialog.vue')

  check('resolveUpdate 只接收 data 与 current', /export function resolveUpdate\(data, current\)/.test(src), true)
  check('checkUpdate 不再有 opt 参数', /export async function checkUpdate\(\)/.test(src), true)
  check('不再有 ignoreVersion 跳过比较', /if \(!ignoreVersion\)/.test(src), false)
  check('版本比较无条件生效', /const cmp = compareVersions/.test(src) && /if \(cmp <= 0\) return \{ hasUpdate: false \}/.test(src), true)

  check('store 没有 checkForUpdateTest', /checkForUpdateTest/.test(storeSrc), false)
  check('store 不再传 ignoreVersion', /ignoreVersion/.test(storeSrc), false)
  check('store 不再标 isTest', /isTest/.test(storeSrc), false)

  check('我的页没有「测试更新」条目', /name: '测试更新'/.test(mineSrc), false)
  check('我的页没有 updateTest 分支', /updateTest/.test(mineSrc), false)

  check('弹窗徽标固定为「新版本」', />新版本<\/text>/.test(dlgSrc), true)
  check('弹窗没有 isTest 分支', /isTest/.test(dlgSrc), false)

  // 正式入口必须完好
  check('我的页保留「检查更新」', /name: '检查更新'/.test(mineSrc), true)
  check('点击走正式 checkForUpdate', /checkForUpdate\(false\)/.test(mineSrc), true)
}

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
  /*
   * ★ z-index: 900 —— 用户实测反馈「下面的 tabbar 和 + 还是能点」★
   *   原来的 9 是「页面内自绘浮层」的约定（1~9，低于库弹层 15），
   *   但更新弹窗是**全局提示**：必须压住 AppTabBar（300）与
   *   QuickAddBar（600），否则遮罩下面那两个还能点到。
   *   又不能高过 AppDialog（1000）—— 下载失败/授权引导的确认框
   *   要能盖在它上面。900 正好夹在中间。
   *   该层级已登记进 scripts/check-layout.mjs 的 HIGH_LAYER_ALLOWLIST。
   */
  check('z-index 压住底栏与速记条（900）', /z-index:\s*900/.test(dlg), true)
  check('不再用「页面内浮层」的 9', /z-index:\s*9;/.test(dlg), false)
  check('低于 AppDialog（1000）', /z-index:\s*1000/.test(dlg), false)

  /*
   * ★ 用户反馈「弹窗太丑」，要求内部文本格式参考更新日志页 ★
   *   所以必须：解析 markdown 段落（## 标题 / - 条目），
   *   按 section + 圆点列表渲染，而不是把每行平铺成灰字。
   */
  check('解析 markdown 段落（sections）', /const sections = computed/.test(dlg), true)
  check('按段落渲染（v-for sec）', /v-for="\(sec, si\) in sections"/.test(dlg), true)
  check('段落标题样式（同更新日志 .rel-section-title）', /ud-section-title/.test(dlg), true)
  check('条目用圆点 + 正文（同更新日志 .rel-item）', /ud-dot/.test(dlg) && /ud-text/.test(dlg), true)
  check('版本号 + 主题色小标记（同更新日志 .rel-head）', /ud-version/.test(dlg) && /ud-badge/.test(dlg), true)
  // 居中卡片形态（用户要求：不是从下面弹出，要中间弹出）
  check('居中弹出（align-items: center）', /align-items:\s*center/.test(dlg), true)
  check('不再贴底（没有 flex-end）', /align-items:\s*flex-end/.test(dlg), false)
  check('左右留白的卡片宽度（不是 100%）', /\.ud-sheet\s*\{[^}]*width:\s*640rpx/.test(dlg), true)
  check('四角全圆（不是只有上方两角）', /border-radius:\s*24rpx;/.test(dlg), true)

  /*
   * ★ 用户要求「更新时不要在应用里显示更新进度，显示在通知栏」★
   *   所以弹窗内不能再有进度条，点下载后弹窗立刻关。
   */
  check('弹窗内没有进度条', /ud-progress/.test(dlg), false)
  check('提示去看通知栏', /通知栏/.test(dlg), true)

  /*
   * ★ 用户要求「更新内容过长时要能够滑动，固定滑动区域大小」★
   *
   * 但这里有个更优先的约束：**按钮不能被裁掉**
   * （用户反馈过「按钮显示不全」）。
   * 上一版把正文写成固定 height: 46vh，卡片总高 = 46vh + 头 + 尾，
   * 超出 max-height 后被 overflow:hidden 裁掉底部按钮。
   *
   * 现在的正确做法：
   *   正文 max-height（有上限、可滚动、空间紧张时优先收缩）
   *   头部 max-height 安全上限内 flex-shrink: 0（永不被压）
   */
  /*
   * ★ 断言要跳过注释 ★
   *   代码注释里会提到「旧的错误写法」做说明
   *   （例如注明 max-height 曾经是 min(88vh, 46vh + 260rpx)），
   *   直接对全文正则会把注释也算进去，误判成代码里还有旧写法。
   *   所以先剥掉 /* ... *\/ 和 // 注释再断言。
   */
  const dlgCss = dlg
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  check('滚动区域有高度上限（max-height）', /\.ud-notes\s*\{[^}]*max-height:\s*46vh/.test(dlgCss), true)
  check('滚动区域允许收缩（不写死 flex-shrink: 0）', /\.ud-notes\s*\{[^}]*flex-shrink:\s*0/.test(dlgCss), false)
  check('滚动区域有 min-height: 0（flex 里能真正收缩）', /\.ud-notes\s*\{[^}]*min-height:\s*0/.test(dlgCss), true)
  check('内容溢出可滚动（scroll-y）', /<scroll-view class="ud-notes" scroll-y>/.test(dlg), true)

  // 头尾固定：空间紧张时只让正文缩，按钮必须完整
  check('底部按钮不收缩（flex-shrink: 0）', /\.ud-foot\s*\{[^}]*flex-shrink:\s*0/.test(dlgCss), true)
  check('头部不收缩', /\.ud-head\s*\{[^}]*flex-shrink:\s*0/.test(dlgCss), true)
  /*
   * 卡片上限必须够放「正文 + 头 + 尾」。
   * 上一版是 min(88vh, 46vh + 260rpx)，余量不够（头+尾就要 274rpx），
   * 导致按钮被裁。现在改成单一 86vh。
   */
  check('卡片上限不再用不够用的 46vh + 260rpx 组合', /max-height:\s*min\(88vh, 46vh \+ 260rpx\)/.test(dlgCss), false)
  check('卡片有 86vh 硬上限', /\.ud-sheet\s*\{[^}]*max-height:\s*86vh/.test(dlgCss), true)

  /*
   * ★ 通知栏进度：Android 13+ 必须申请运行时权限 ★
   *   只在 manifest 声明不够 —— 不请求的话通知被静默丢弃。
   */
  const notifierSrc = read('api/notifier.js')
  const updateSrc = read('api/update.js')

  /*
   * ★ 源码断言必须剥掉注释 ★
   *   notifier.js 顶部详细记录了「旧的错误写法」做说明
   *   （getAttribute / Context.NOTIFICATION_SERVICE / Build.VERSION.SDK_INT 等），
   *   直接对全文正则会把注释也算成代码，误报「还有旧写法」。
   *   这里先剥掉 /* *\/ 与 // 注释，只断言真实代码。
   */
  const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // 行尾注释也要剥：`const X = 1 // 说明 Context.NOTIFICATION_SERVICE`
    // 只剥整行 // 会漏掉这种，把注释里的旧写法误判成代码
    .replace(/[ \t]\/\/[^\n]*/g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
  const notifierCode = stripComments(notifierSrc)
  const updateCode = stripComments(updateSrc)

  check('Android 13+ 请求通知权限', /POST_NOTIFICATIONS[\s\S]{0,400}requestPermissions/.test(notifierSrc), true)
  check('检查权限是否已授予', /checkSelfPermission\('android\.permission\.POST_NOTIFICATIONS'\)/.test(notifierSrc), true)
  check('通知失败有 console.warn 日志', /\[update\] 推送通知失败/.test(notifierSrc), true)
  check('小图标按名字查 drawable', /getIdentifier\(name, 'drawable', pkg\)/.test(notifierSrc), true)

  /*
   * ★★★ 不用 Java 静态字段（真机日志实测全取不到）★★★
   *   日志：sdk=0 importance=null service=null
   *     · plus.android.getAttribute(类, 字段) 对类无效，返回 null
   *     · Build.VERSION 是嵌套类，importClass('android.os.Build')
   *       不会导入它，所以 SDK_INT 永远 undefined
   *   致命后果：if (sdkInt >= 26) 恒 false -> 通知渠道从未创建
   *   -> Android 8+ 没渠道的通知被系统静默丢弃。
   *
   *   现在改用一个静态字段都不用：
   *     NOTIFICATION_SERVICE = 字符串 "notification"
   *     IMPORTANCE_LOW       = 整数 2
   *     API 级别             = plus.os.version 换算
   */
  check('有 API 级别换算函数', /export function apiLevelFromOsVersion/.test(notifierSrc), true)
  check('用 plus.os.version 取系统版本', /plus\.os\.version/.test(notifierSrc), true)
  check('NOTIFICATION_SERVICE 用字面量 "notification"', /NOTIFICATION_SERVICE = 'notification'/.test(notifierSrc), true)
  check('IMPORTANCE_LOW 用字面量 2', /IMPORTANCE_LOW = 2/.test(notifierSrc), true)
  // 不允许再出现任何静态字段反射 / 嵌套类访问
  check('没有 getAttribute 读静态字段', /plus\.android\.getAttribute\(/.test(notifierCode), false)
  check('没有 staticField 辅助', /function staticField\(/.test(notifierCode), false)
  check('没有 Build.VERSION.SDK_INT', /Build\.VERSION\.SDK_INT/.test(notifierCode), false)
  check('没有 Context.NOTIFICATION_SERVICE', /Context\.NOTIFICATION_SERVICE/.test(notifierCode), false)
  /*
   * ★ 渠道创建不能包在 sdkInt 判断里 ★
   *   旧写法 if (sdkInt >= 26) —— sdkInt 取不到就永远不建渠道。
   *   现在无条件尝试建（低版本系统会忽略该调用）。
   */
  check(
    '建渠道不依赖 sdkInt 判断',
    /try \{\s*const NotificationChannel[\s\S]{0,400}nm\.createNotificationChannel\(ch\)/.test(notifierSrc),
    true
  )

  check('有权限请求', /requestPermissions\(\['android\.permission\.POST_NOTIFICATIONS'\]/.test(notifierSrc), true)
  check('通知失败有 console.warn 日志', /\[update\] 推送通知失败/.test(notifierSrc), true)
  check('小图标按名字查 drawable', /getIdentifier\(name, 'drawable', pkg\)/.test(notifierSrc), true)
  check('用 setProgress 画进度条', /setProgress\(100, pct, false\)/.test(notifierCode), true)
  check('setOnlyAlertOnce 避免反复响', /setOnlyAlertOnce\(true\)/.test(notifierCode), true)
  check('完成通知提示点按安装', /点按通知栏即可安装/.test(notifierCode), true)
  check('失败/取消撤掉通知', /nm\.cancel\(NOTIFY_ID\)/.test(notifierCode), true)
  check('通知不可用时降级为空实现', /return \{ update\(\) \{\}, done\(\) \{\}, fail\(\) \{\} \}/.test(notifierCode), true)

  // 安装授权页的 action 也是静态常量，同样不能直接点
  check(
    'ACTION_MANAGE_UNKNOWN_APP_SOURCES 不直接点访问',
    /Settings\.ACTION_MANAGE_UNKNOWN_APP_SOURCES/.test(updateCode),
    false
  )

  const manifest = read('manifest.json')
  check('manifest 声明 POST_NOTIFICATIONS', /android\.permission\.POST_NOTIFICATIONS/.test(manifest), true)

  const store = read('stores/update.js')
  check('状态机有 downloading 阶段', /phase = 'downloading'/.test(store), true)
  check('状态机有 installing 阶段', /phase = 'installing'/.test(store), true)
  check('静默模式无新版不打扰', /if \(!silent\) uni\.showToast\(\{ title: '当前已是最新版本'/.test(store), true)
  check('避免重复检查', /if \(this\.checking\) return false/.test(store), true)
  // 下载中取消要连通知栏一起撤
  check('取消走 cancelDownload（连通知栏一起撤）', /cancelDownload\(\)/.test(store), true)
  // 点下载立刻收弹窗，不等下载完
  check('点下载后立刻关闭弹窗', /this\.dialogVisible = false/.test(store), true)
}

/* --------------------------------------------- 4. 通知栏进度 */

console.log('=== 下载进度显示在系统通知栏 ===')

{
  const api = read('api/update.js')
  const notifier = read('api/notifier.js')

  /*
   * 通知栏实现已迁到 api/notifier.js（那里用字面量常量避免静态字段反射）。
   * 本文件（update.js）只负责下载与安装编排。
   */
  check('update.js 引用 notifier 模块', /from '\.\/notifier\.js'/.test(api), true)
  check('notifier.js 有进度器', /export function createProgressNotifier/.test(notifier), true)
  check('用 Android NotificationChannel（8+ 必需）', /NotificationChannel/.test(notifier), true)
  check('渠道重要性是 LOW（不响不弹）', /IMPORTANCE_LOW = 2/.test(notifier), true)
  check('导出 clearProgressNotification', /export function clearProgressNotification/.test(notifier), true)
  check('导出 cancelDownload', /export function cancelDownload/.test(api), true)
  check('downloadApk 用 plus.downloader', /plus\.downloader\.createDownload/.test(api), true)
}


console.log('=== 弹窗挂在每一个页面上（全局最上层）===')

{
  /*
   * ★「全局上层」不只靠 z-index ★
   *   uni-app 没有跨页面的全局浮层：App.vue 不渲染模板，
   *   所以弹窗必须每个页面各挂一个实例（读同一份 store 状态，
   *   dialogVisible 是单布尔，多实例不会重复弹）。
   *
   *   用户反馈「弹窗显示在首页上方，tabbar 和 + 还能点」，
   *   除了 z-index 低于底栏，另一半原因是当时只挂了 3 个页面 ——
   *   在别的页面检查更新压根不会弹。
   */
  const pageFiles = []
  ;(function walk(dir) {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = dir + '/' + name
      const st = statSync(join(ROOT, rel))
      if (st.isDirectory()) walk(rel)
      else if (name.endsWith('.vue')) pageFiles.push(rel)
    }
  })('pages')

  /*
   * ★ 不再写死页面数量 ★
   *   以前这里钉的是 27，每加一个页面就要来改一次 ——
   *   而这句断言想表达的其实是「扫到的页面数 = pages.json 里注册的页面数」，
   *   不是「本项目永远只有 27 个页面」。
   *   改成和 pages.json 对账：漏注册的页面会被这条提前抓出来
   *   （下面的 missingMount 本来也会抓，但少了这条就分不清
   *    「少扫了文件」还是「页面真的没挂弹窗」）。
   */
  const declaredPages = JSON.parse(read('pages.json')).pages.length
  check('页面数量与 pages.json 一致', pageFiles.length, declaredPages)

  const missingMount = []
  const missingImport = []
  const missingRegister = []
  for (const rel of pageFiles) {
    const src = read(rel)
    if (!/<UpdateDialog\s*\/>/.test(src)) missingMount.push(rel)
    if (!/import UpdateDialog from '@\/components\/UpdateDialog\.vue'/.test(src)) missingImport.push(rel)
    if (!/components:\s*\{[^}]*\bUpdateDialog\b/.test(src)) missingRegister.push(rel)
  }
  check('每个页面都挂了 <UpdateDialog />', missingMount, [])
  check('每个页面都 import 了组件', missingImport, [])
  check('每个页面都注册进 components', missingRegister, [])

  // 首页：必须在 <block> 外面，否则「还没账户」那个分支上没有弹窗
  const index = read('pages/index/index.vue')
  const idxTag = index.indexOf('<UpdateDialog />')
  const idxBlockEnd = index.indexOf('</block>')
  check('首页弹窗在 <block> 外（未建账户也能弹）', idxTag > idxBlockEnd && idxBlockEnd > 0, true)
}

console.log('=== 正式检查更新入口完好无损 ===')

{
  /*
   * ★ 删完调试入口后，正式链路必须一步不少 ★
   *   很容易在删测试代码时连带把正式分支一起删掉（
   *   两者在 onMenuClick 里就是相邻的两个 if），而编译不会报错。
   */
  const mineSrc = read('pages/mine/index.vue')
  const storeSrc = read('stores/update.js')

  check('我的页保留「检查更新」', /name: '检查更新'/.test(mineSrc), true)
  check('点击走正式 checkForUpdate', /checkForUpdate\(false\)/.test(mineSrc), true)
  check(
    '正式检查仍然比版本（silent 语义未变）',
    /if \(!silent\) uni\.showToast\(\{ title: '当前已是最新版本'/.test(storeSrc),
    true
  )
  check('正式检查不传参数', /await fetchCheck\(\)/.test(storeSrc), true)
}

console.log('=== 点通知栏能拉起安装器（bug 修复）===')

{
  /*
   * ★ 用户反馈 ★
   *   「下载完成后，点击通知栏为什么不能跳转到安装页面呢」。
   *
   * ★ 根因 ★
   *   done() 发的通知没设 setContentIntent。
   *   Android 上没有 contentIntent 的通知点下去就是纯饰边：
   *   不拉起 App、不弹安装器、什么都不会发生。
   *
   * ★ 修法是一条链，任一环断都不行 ★
   *   ① notifier.done(apkPath) 带上路径
   *   ② buildContentIntent 把路径写进 Intent extra
   *   ③ b.setContentIntent(pi) 挂上去
   *   ④ api/update.js 的 consumePendingInstall 读回路径并拉安装器
   *   ⑤ App.vue 在 onLaunch / onShow / newintent 三个时机都调它
   */
  const notifierSrc = read('api/notifier.js')
  const apiSrc = read('api/update.js')
  const appSrc = read('App.vue')

  check('通知栏点击意图已构造', /function buildContentIntent\(apkPath\)/.test(notifierSrc), true)
  check('done 接收安装包路径', /done\(apkPath\)/.test(notifierSrc), true)
  check('点击意图被挂到通知上', /b\.setContentIntent\(pi\)/.test(notifierSrc), true)
  check('用 PendingIntent.getActivity', /PendingIntent\.getActivity\(/.test(notifierSrc), true)
  check('PendingIntent 用 IMMUTABLE（Android 12+ 必选）', /PI_FLAG_IMMUTABLE = 0x04000000/.test(notifierSrc), true)
  check('PendingIntent 用 UPDATE_CURRENT', /PI_FLAG_UPDATE_CURRENT/.test(notifierSrc), true)
  check('安装路径的 extra 键已导出', /export const INSTALL_EXTRA_KEY/.test(notifierSrc), true)

  /*
   * ★ 不能硬编码启动 Activity 类名 ★
   *   io.dcloud.PandoraEntry 是基座 6.x 的名字，换版本就可能变。
   *   应该向 PackageManager 要 getLaunchIntentForPackage。
   */
  check('用 getLaunchIntentForPackage 取启动意图', /getLaunchIntentForPackage/.test(notifierSrc), true)
  check('CLEAR_TOP 防重复开 App', /INTENT_FLAG_CLEAR_TOP = 0x04000000/.test(notifierSrc), true)
  check('SINGLE_TOP 防重复开 App', /INTENT_FLAG_SINGLE_TOP = 0x20000000/.test(notifierSrc), true)

  // 下载完把路径交给通知
  check('downloadApk 传路径给 done', /notifier\.done\(d\.filename\)/.test(apiSrc), true)

  // 回前台读 Intent 并装
  check('导出 consumePendingInstall', /export async function consumePendingInstall/.test(apiSrc), true)
  check('读 Intent 的 extra', /getStringExtra', INSTALL_EXTRA_KEY/.test(apiSrc), true)
  check('读完清掉 extra（防重复弹）', /removeExtra', INSTALL_EXTRA_KEY/.test(apiSrc), true)
  check('同一路径去重', /lastConsumedInstallPath/.test(apiSrc), true)
  check('读到后拉安装器', /await installApk\(path\)/.test(apiSrc), true)

  // App.vue 三个时机
  check('App.vue import consumePendingInstall', /import \{ consumePendingInstall \}/.test(appSrc), true)
  check('onLaunch 调用', /this\.consumeInstallIntent\(\)/.test(appSrc), true)
  check('onShow 也调用', /setTimeout\(\(\) => \{ this\.consumeInstallIntent\(\) \}, 300\)/.test(appSrc), true)
  check('newintent 也挂了监听', /addEventListener\('newintent', this\.onNewIntentForInstall\)/.test(appSrc), true)
}

console.log('=== 后台下载不中断（用户反馈 bug）===')

{
  /*
   * ★ 用户反馈 ★
   *   「把软件放在后台怎么下载就终止了？」
   *
   * ★ 根因两层 ★
   *   ① CPU 睡眠：App 退到后台 + 屏幕熄灭 → CPU 休眠 → 下载线程被挂起
   *   ② Promise 永不 settle：中断时回调里 status 是 undefined，
   *      旧代码 `else if (status !== undefined)` 两边不进 → phase 永迚 downloading
   *
   * ★ 修法 ★
   *   ① 下载期间持 PARTIAL_WAKE_LOCK（api/wakeLock.js）
   *   ② 除 200 外全部 reject，保证 Promise 必定结束
   *   ③ store 在 phase 卡住时自救（isDownloading 为 false 就强行复位）
   */
  const apiSrc = read('api/update.js')
  const storeSrc = read('stores/update.js')
  const wlSrc = read('api/wakeLock.js')
  /*
   * ★ 断言「不再用旧写法」前必须剥注释 ★
   *   api/update.js 里专门写了一段说明「旧写法长什么样」，
   *   不剥注释就会把那段说明当成实现。
   *   （仓库里的注释往往正好提到要被断言不存在的字符串，这是老坑了。）
   */
  const apiCode = apiSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  // ① 唤醒锁
  check('唤醒锁模块存在', /export function acquireWakeLock/.test(wlSrc), true)
  check('导出释放函数', /export function releaseWakeLock/.test(wlSrc), true)
  check('PARTIAL_WAKE_LOCK 用字面量 1', /PARTIAL_WAKE_LOCK = 1/.test(wlSrc), true)
  check('POWER_SERVICE 用字面量 "power"', /getSystemService\('power'\)/.test(wlSrc), true)
  check('关掉引用计数（防释放不掉）', /setReferenceCounted\(false\)/.test(wlSrc), true)
  check('acquire 带超时（防永久持有）', /lock\.acquire\(timeoutMs\)/.test(wlSrc), true)
  check('wakeLock 有 plus 环境守卫', /typeof plus === 'undefined'/.test(wlSrc), true)

  check('下载前获取唤醒锁', /acquireWakeLock\('FreeLedger:update'\)/.test(apiSrc), true)
  check('下载结束释放唤醒锁', /releaseWakeLock\(\)/.test(apiSrc), true)
  check('abort 也释放（覆盖取消路径）', /export function abortDownload\([\s\S]{0,400}?releaseWakeLock/.test(apiSrc), true)
  check('拿不到锁不阻断下载', /locked \? '已持有' : '未获取'/.test(apiSrc), true)

  // ② Promise 必定 settle
  check('status 为 undefined 也 reject', /status === undefined[\s\S]{0,200}?下载被中断/.test(apiSrc), true)
  check('不再用 status !== undefined 做前提', /else if \(status !== undefined\)/.test(apiCode), false)
  check('导出 isDownloading', /export function isDownloading/.test(apiSrc), true)

  // ③ store 自救
  check('store 引入 isDownloading', /isDownloading/.test(storeSrc), true)
  check('phase 卡住时强行复位', /phase === 'downloading' && !isDownloading\(\)/.test(storeSrc), true)
}

console.log('=== API 级别换算（真机日志：android=17 → api 曾算出 0）===')

{
  /*
   * ★ 真机实测出来的 bug ★
   *   日志：android=17 api=0
   *   旧实现查表只写到 Android 16，遇到 17 返回 0，
   *   于是 sdkInt >= 33 恒 false -> 权限永远不请求
   *   -> Android 13+ 通知被系统静默丢弃。
   *   查表法对「比表更新的系统」必然失效，改成公式推导。
   */
  check('Android 17 -> API 37（超出旧表的真实机型）', apiLevelFromOsVersion('17'), 37)
  check('Android 13 -> 33', apiLevelFromOsVersion('13'), 33)
  check('Android 14 -> 34', apiLevelFromOsVersion('14'), 34)
  check('Android 12 -> 31', apiLevelFromOsVersion('12'), 31)
  check('Android 11 -> 30', apiLevelFromOsVersion('11'), 30)
  check('Android 10 -> 29', apiLevelFromOsVersion('10'), 29)
  check('Android 9 -> 28', apiLevelFromOsVersion('9'), 28)
  check('Android 8 -> 26（8.1 是 27，两档判断都够）', apiLevelFromOsVersion('8'), 26)
  check('带小版本号 8.1.0', apiLevelFromOsVersion('8.1.0'), 26)
  check('Android 20 也能推（向后兼容未来系统）', apiLevelFromOsVersion('20'), 40)
  check('空串返回 0', apiLevelFromOsVersion(''), 0)
  check('非法值返回 0', apiLevelFromOsVersion('abc'), 0)

  // 公式必须保证「13 及以上都 >= 33」，否则权限请求会被跳过
  let allOk = true
  for (let v = 13; v <= 25; v++) {
    if (apiLevelFromOsVersion(String(v)) < 33) { allOk = false; break }
  }
  check('Android 13~25 全部 >= 33（保证请求通知权限）', allOk, true)
}

console.log('=== Resources 等返回对象必须 importClass（真机：getIdentifier is not a function）===')

{
  const nCode = read('api/notifier.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
  /*
   * plus.android 只给 importClass 过的对象挂方法代理。
   * main.getResources() 返回的 Resources 不 importClass 就没法调 getIdentifier，
   * 导致小图标取不到、setSmallIcon(0) 让通知被丢弃。
   */
  check('拿到 Resources 后 importClass', /const res = main\.getResources\(\)[\s\S]{0,120}importClass\(res\)/.test(nCode), true)
  check('没有有效小图标时跳过通知', /if \(!smallIcon\)[\s\S]{0,150}跳过通知栏进度/.test(nCode), true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
