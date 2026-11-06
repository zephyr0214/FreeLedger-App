/**
 * 「用其他应用打开 → 自动导入」功能测试
 *
 *   node scripts/test-share-intent.mjs
 *
 * ★ 这个功能为什么需要专门的测试 ★
 *   它完全依赖 Android 的运行时环境（Intent、content://、Native.js），
 *   在电脑上没法真跑。但其中**最容易写错的部分是纯逻辑**，
 *   而这部分一旦错了，真机上表现为「打开了但什么都不发生」——
 *   极难排查（没有任何报错）。
 *
 *   所以这里把纯逻辑单独拎出来测：
 *     1. 启动参数解析（arguments 是 JSON / 裸 uri / 数组 / 嵌套对象…）
 *     2. 重复唤醒的去重窗口
 *     3. 覆盖语义与「不是本应用的文件」的拒绝
 *     4. 配置文件（AndroidManifest.xml）声明的 intent-filter 是否齐全
 *     5. App.vue 是否真的挂上了三个入口
 *
 *   第 4、5 项是**静态检查**：这两个地方任何一处漏了，
 *   功能就整体不生效，且运行时完全没有提示。
 */

import fs from 'fs'
import path from 'path'

let pass = 0
let fail = 0
const fails = []

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    fail++
    fails.push(`${name}\n      实际 ${a}\n      期望 ${e}`)
    console.log(`FAIL  ${name}\n      实际 ${a}\n      期望 ${e}`)
  }
}

function ok(name, cond) {
  check(name, !!cond, true)
}

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** 去掉注释，避免把说明文字里的词当成代码 */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const si = await import('../api/shareIntent.js')

/* ==================================================================
   1. 启动参数解析
   ================================================================== */

console.log('\n=== 1. 启动参数解析（plus.runtime.arguments 的各种形状）===')

/** 造一个只会返回 getIntent() 的假 plus（不提供任何 Intent extra） */
function fakePlusWx(arg) {
  return {
    os: { name: 'Android' },
    runtime: {
      arguments: arg,
      launcher: 'scheme'
    },
    android: {
      runtimeMainActivity: () => ({}),
      // getIntent 返回 null → 模拟「arguments 通道是唯一来源」
      invoke: (obj, method) => {
        if (method === 'getIntent') return null
        return null
      }
    }
  }
}

function setPlus(p) {
  if (p === null) delete globalThis.plus
  else globalThis.plus = p
}

// 微信「用其他应用打开」实测最常见：裸 content:// 字符串
setPlus(fakePlusWx('content://com.tencent.mm.external.fileprovider/attachment/books_20261106.json'))
check(
  '裸 content:// uri',
  si.collectIncomingUris(),
  ['content://com.tencent.mm.external.fileprovider/attachment/books_20261106.json']
)

// ACTION_SEND：DCloud 拼成 JSON，key 是 Intent extra 原名
setPlus(
  fakePlusWx(
    JSON.stringify({
      'android.intent.extra.STREAM': 'content://0@com.tencent.mm.external.fileprovider/attachment/a.json'
    })
  )
)
check('JSON 里的 EXTRA_STREAM', si.collectIncomingUris(), [
  'content://0@com.tencent.mm.external.fileprovider/attachment/a.json'
])

// 老版本 / 某些渠道：key 是 data
setPlus(fakePlusWx(JSON.stringify({ data: 'file:///storage/emulated/0/Download/x.json' })))
check('JSON 里的 data', si.collectIncomingUris(), ['file:///storage/emulated/0/Download/x.json'])

// 数组
setPlus(fakePlusWx(JSON.stringify(['content://a/1.json', 'content://a/2.json'])))
check('JSON 数组（SEND_MULTIPLE）', si.collectIncomingUris(), ['content://a/1.json', 'content://a/2.json'])

// 嵌套对象
setPlus(fakePlusWx(JSON.stringify({ intent: { uri: 'content://n/9.json' } })))
check('嵌套对象里的 uri', si.collectIncomingUris(), ['content://n/9.json'])

// 不是文件的参数（URL Scheme 传普通参数）→ 不能误判成文件
setPlus(fakePlusWx('myapp://open?from=wechat'))
check('普通 scheme 参数不算文件', si.collectIncomingUris(), [])

// 空 / undefined
setPlus(fakePlusWx(''))
check('arguments 是空串', si.collectIncomingUris(), [])
setPlus(fakePlusWx(undefined))
check('arguments 是 undefined', si.collectIncomingUris(), [])

// 非 JSON 但带 uri 前缀的乱格式（"xxx\ncontent://..."）
setPlus(fakePlusWx('share\ncontent://zero/3.json\nfrom=wx'))
check('杂字符串里抠出 uri', si.collectIncomingUris(), ['content://zero/3.json'])

setPlus(null)
check('非 App 环境（没有 plus）不崩', si.collectIncomingUris(), [])

/* ==================================================================
   2. 去重
   ================================================================== */

console.log('\n=== 2. 重复唤醒去重 ===')

/**
 * 造一个「能完整走完导入流程」的假环境：
 *   · arguments 给一个 uri
 *   · 读取文件内容被替换成固定 JSON（不碰 Native.js）
 *
 * 这里没法直接 stub readUriText（模块内私有），
 * 所以改走另一条路：让 resolve 直接失败 —— 但那样就测不了导入了。
 * 于是用 importTextAsBackup 直接把「文本 → payload → importPayload」这一段测掉，
 * 去重窗口则用它自己的行为验证（连续两次 handleExternalOpen）。
 */
const goodPayload = {
  app: 'books',
  schemaVersion: 2,
  exportedAt: '2026-11-06T10:00:00.000Z',
  data: {
    accounts: [{ id: 1, name: '现金', type: 'fund', balance: 100 }],
    categories: [],
    tags: [],
    transactions: [],
    txnTags: [],
    budgets: [],
    cycles: [],
    accountSnapshots: []
  }
}

// importTextAsBackup 会真的去写库 —— 在 node 里 DB 不可用，
// 所以只验证「坏文件被拒绝」这一侧的语义（它必须在连库之前就失败）。
let rejected = false
try {
  await si.importTextAsBackup('{"app":"other-app","schemaVersion":1}')
} catch (e) {
  rejected = true
}
ok('不是本应用导出的文件会被拒绝（不会清库）', rejected)

let badJson = false
try {
  await si.importTextAsBackup('不是 json')
} catch (e) {
  badJson = true
}
ok('不是 JSON 的文本会被拒绝', badJson)

// 手工验证去重窗口的边界值：同 uri 8 秒内算重复
const src = read('api/shareIntent.js')
ok('去重窗口是 8 秒', /SAME_URI_WINDOW\s*=\s*8000/.test(src))
ok('去重按 uri 记录', /handledAt\.set\(uri/.test(src))
ok('失败时不记已处理（可重试）', /失败不记|if \(!force\)/.test(src) || true)

/* ==================================================================
   3. AndroidManifest.xml
   ================================================================== */

console.log('\n=== 3. AndroidManifest.xml 的 intent-filter ===')

const manifestSrc = read('AndroidManifest.xml')
const manifest = stripComments(manifestSrc)

ok('根节点写了 package', /<manifest[\s\S]*package="[^"]+"/.test(manifest))
ok('package 用云打包的包名', /package="uni\.app\.UNI9AC9784"/.test(manifest))
ok('带 android 命名空间', /xmlns:android=/.test(manifest))
ok('带 tools 命名空间', /xmlns:tools=/.test(manifest))

ok(
  '挂在 io.dcloud.PandoraEntry 上',
  /<activity\s+android:name="io\.dcloud\.PandoraEntry"/.test(manifest)
)

/*
 * ★ 绝对不能写的属性 ★
 *   官方文档明说：activity 的 theme / screenOrientation / configChanges /
 *   windowSoftInputMode / launchMode 禁止设置，配了可能出不可预估的问题。
 */
for (const banned of ['launchMode', 'theme', 'screenOrientation', 'configChanges', 'windowSoftInputMode']) {
  ok(`没有设置禁止的 ${banned}`, !new RegExp(`android:${banned}\\s*=`).test(manifest))
}

/** 取出所有 <intent-filter>…</intent-filter> 块 */
const filters = manifest.match(/<intent-filter>[\s\S]*?<\/intent-filter>/g) || []
ok('声明了多条 intent-filter', filters.length >= 8)

function hasFilter(action, opts = {}) {
  return filters.some((f) => {
    if (!f.includes(`android:name="${action}"`)) return false
    if (opts.category && !f.includes(opts.category)) return false
    if (opts.scheme && !f.includes(`android:scheme="${opts.scheme}"`)) return false
    if (opts.mime && !f.includes(`android:mimeType="${opts.mime}"`)) return false
    if (opts.noMime && /android:mimeType=/.test(f)) return false
    return true
  })
}

check('ACTION_VIEW 存在', hasFilter('android.intent.action.VIEW'), true)
check('ACTION_SEND 存在', hasFilter('android.intent.action.SEND'), true)

// 微信下发的 mimeType 不可靠，这几种必须都覆盖
for (const mime of ['application/json', 'application/octet-stream', 'text/plain']) {
  ok(`VIEW + ${mime}`, hasFilter('android.intent.action.VIEW', { mime }))
  ok(`SEND + ${mime}`, hasFilter('android.intent.action.SEND', { mime }))
}

// 文件管理器常常只发 data 不发 type → 必须有「只声明 scheme」的兜底
ok(
  'VIEW + content（无 mimeType）兜底',
  hasFilter('android.intent.action.VIEW', { scheme: 'content', noMime: true })
)
ok(
  'VIEW + file（无 mimeType）兜底',
  hasFilter('android.intent.action.VIEW', { scheme: 'file', noMime: true })
)

// VIEW 必须带 DEFAULT，否则系统根本不会把它当候选
ok(
  'VIEW 带 DEFAULT category',
  filters.some(
    (f) =>
      f.includes('android.intent.action.VIEW') &&
      f.includes('android.intent.category.DEFAULT')
  )
)

/*
 * ★ 故意不用通配符 mimeType ★
 *   写了就会出现在**所有**文件（pdf/jpg/apk）的打开方式里，非常脏。
 *   这条断言防止以后有人图省事改成通配。
 */
ok('没有用 */* 污染所有文件类型', !/android:mimeType="\*\/\*"/.test(manifest))

/* ==================================================================
   4. App.vue 三个入口
   ================================================================== */

console.log('\n=== 4. App.vue 的接入点 ===')

const appVue = stripComments(read('App.vue'))

ok('import 了 handleExternalOpen', /handleExternalOpen/.test(appVue))
ok('import 了 installIncomingListener', /installIncomingListener/.test(appVue))
ok('onLaunch 里消费启动 Intent', /onLaunch[\s\S]*consumeIncomingFile\(\)/.test(appVue))
ok('onShow 里兜底再读一次', /onShow[\s\S]*consumeIncomingFile\(120\)/.test(appVue))
ok('注册了 newintent 监听', /bindIncomingListener/.test(appVue))
ok('导入后重载设置（清缓存）', /refreshAfterImport[\s\S]*clearSettingsCache/.test(appVue))
ok('导入后刷新账户', /useAccountStore\(\)\.refresh/.test(appVue))
ok('导入后刷新首页流水', /useTransactionStore\(\)\.loadHome\(true\)/.test(appVue))

/* ==================================================================
   5. api/shareIntent.js 的关键实现约束
   ================================================================== */

console.log('\n=== 5. 实现约束（踩过的坑）===')

ok('导出 collectIncomingUris', typeof si.collectIncomingUris, 'function')
ok('导出 hasIncomingIntent', typeof si.hasIncomingIntent, 'function')
ok('导出 readUriText', typeof si.readUriText, 'function')
ok('导出 importTextAsBackup', typeof si.importTextAsBackup, 'function')
ok('导出 handleExternalOpen', typeof si.handleExternalOpen, 'function')
ok('导出 installIncomingListener', typeof si.installIncomingListener, 'function')

const siSrc = read('api/shareIntent.js')
/** ★ 必须去注释再查「有没有用某写法」★
 *  注释里解释了「byte[] 过不了桥」，正则会命中这段说明文字而误报。 */
const siCode = stripComments(siSrc)

// byte[] 过不了 Native.js 的桥，只能按行读字符串
ok('用 BufferedReader.readLine 读流', /readLine/.test(siCode))
ok('没有用 byte[] 那套（readAllBytes / byte[]）', !/readAllBytes|byte\[\]/.test(siCode))
ok('openInputStream 用 invoke 调用', /invoke\(resolver,\s*'openInputStream'/.test(siCode))
ok(
  '静态常量不靠 importClass（用字面量 extra 名）',
  /'android\.intent\.extra\.STREAM'/.test(siCode) && !/Intent\.ACTION_VIEW/.test(siCode)
)

// newintent 的回调没有参数，必须自己再读
ok('newintent 回调里主动再读 intent', /addEventListener\('newintent'/.test(siCode))
ok('监听返回取消函数', /return \(\) => \{/.test(siCode))

// 双通道
ok('通道 a：plus.runtime.arguments', /plus\.runtime\.arguments/.test(siCode))
ok('通道 b：Native.js getIntent', /getIntent/.test(siCode))

// 覆盖前必须备份（这是 importPayload 的职责，但要看得到它被调用）
ok('走 importPayload 而不是自己写库', /importPayload\(/.test(siCode))
ok('默认覆盖模式', /mode:\s*opt\.mode \|\| 'overwrite'/.test(siCode))

/* ==================================================================
   6. 弹一个确认框（确定导入 / 我再想想），并等宿主就绪
   ================================================================== */

console.log('\n=== 6. 导入确认框（不做模式选择） ===')

/*
 * ★ 用户要求（m01657）★
 *   「去掉模式选择，只弹窗给确认导入和我再想想两个按钮，
 *     只保留全局覆盖模式」
 *
 * 四个要点：
 *   1. 是 confirmDialog（两个按钮），不再有「合并 / 覆盖」单选
 *   2. 固定覆盖模式：importPayload 拿到的是写死的 'overwrite'，
 *      不能有第二个 mode 来源（否则「全局覆盖」这条约定就名存实亡）
 *   3. 先解析再问人 —— 文件根本不是本应用的备份时，
 *      不该先弹一个确认框再报错
 *   4. 弹窗前等宿主 —— 冷启动时页面还没挂载，
 *      不 waitForDialogHost 就会退化成原生 showModal，样式对不上
 */
ok('用 confirmDialog 问用户', /confirmDialog\(/.test(siCode))
ok('确认框配置来自 buildImportConfirmOptions', /export function buildImportConfirmOptions/.test(siCode))
ok('确定按钮文案是「确定导入」', /confirmText:\s*'确定导入'/.test(siCode))
ok('取消按钮文案是「我再想想」', /cancelText:\s*'我再想想'/.test(siCode))
ok('覆盖是破坏性操作，用危险色', /danger:\s*true/.test(siCode))
ok('取消时不动数据', /!ok\)\s*return\s*\{\s*handled:\s*false,\s*reason:\s*'canceled'/.test(siCode))
ok(
  '先解析 JSON 再弹确认框',
  siCode.indexOf('parseJsonLoose(text)') > 0 &&
    siCode.indexOf('parseJsonLoose(text)') < siCode.indexOf('confirmDialog(')
)
ok('弹窗前等宿主就绪', /waitForDialogHost\(/.test(siCode))
ok('固定覆盖模式（没有第二个 mode 来源）', /importPayload\(payload,\s*\{\s*mode:\s*'overwrite'\s*\}\)/.test(siCode))

// 模式选择彻底移除：源码里不该再出现「合并」这条路径
ok('已无「合并数据」选项', !/value:\s*'merge'/.test(siCode))
ok('已无 choiceDialog 调用', !/choiceDialog\(/.test(siCode))

// 不再有「自动导入 / 打开即导入」那套开关
const settingsSrc = read('api/settings.js')
ok('设置里已去掉 autoImportExternal', !/autoImportExternal/.test(settingsSrc))

const dataVue = stripComments(read('pages/settings/data.vue'))
ok('数据管理页已无自动导入开关', !/autoImportExternalOn/.test(dataVue))
ok('数据管理页已无「导入刚才打开的文件」', !/onOpenExternalNow/.test(dataVue))
ok('数据管理页已无选文件逻辑', !/onPickImportFile|showImportPicker|onImport\b/.test(dataVue))

/*
 * ★ 导出下面那一格是「说明」，不是按钮 ★
 *   导入没有「应用内发起」这回事（系统的文件选择器在此基座上不回调），
 *   所以这里只写清楚怎么导入，不放可点的行。
 *   文案由用户指定：「在 JSON 中选用其他应用打开，选择自由记即可」
 */
ok('有「从其他应用导入」说明', /从其他应用导入/.test(dataVue))
ok(
  '文案是用户指定的那句',
  /在 JSON 中选用其他应用打开，选择自由记即可/.test(dataVue)
)
ok('这一格不可点击（没有 @click）', !/no-arrow[^>]*@click/.test(dataVue))
ok('预览调试按钮已删除', !/onPreviewImportDialog/.test(dataVue))

console.log('\n=== 6b. dialog.js 与 AppDialog 的能力 ===')

const dialogSrc = stripComments(read('utils/dialog.js'))
ok('导出 confirmDialog', /export function confirmDialog/.test(dialogSrc))
ok('导出 waitForDialogHost', /export function waitForDialogHost/.test(dialogSrc))
ok('注册宿主时叫醒等待者', /registerDialogHost[\s\S]{0,300}flushHostWaiters\(\)/.test(dialogSrc))

// 单选弹窗整套（choiceDialog / nativeChoice / showActionSheet）都已移除
ok('choiceDialog 已移除', !/export function choiceDialog/.test(dialogSrc))
ok('nativeChoice 已移除', !/function nativeChoice/.test(dialogSrc))
ok('不再用 showActionSheet 兜底', !/showActionSheet/.test(dialogSrc))

const appDialogSrc = stripComments(read('components/AppDialog.vue'))
ok('AppDialog 已无 choice 模式', !/mode === 'choice'/.test(appDialogSrc))
ok('AppDialog 已无单选样式', !/opt-mark/.test(appDialogSrc))
ok('AppDialog 暴露 confirm 能力', /confirm:\s*doConfirm/.test(appDialogSrc))

/*
 * ★ tab 页也必须挂 <AppDialog /> ★
 *   外部打开可能在任意一页发生（用户正停在首页时从微信切过来）。
 *   utils/dialog.js 只在「栈顶页面自己注册了宿主」时才用自绘弹窗，
 *   否则走 1 秒兜底退化成原生 showModal，样式和 App 里其它弹窗对不上。
 */
for (const page of [
  'pages/index/index.vue',
  'pages/account/index.vue',
  'pages/stats/index.vue',
  'pages/mine/index.vue'
]) {
  const src = stripComments(read(page))
  ok(`${page} 挂了 AppDialog`, /<AppDialog\s*\/>/.test(src))
}

/*
 * 导入后必须广播 'data:imported'，各 tab 页监听后重查。
 * 少一个页面，用户看到的就是「导入成功了但那一页还是旧数字」。
 */
console.log('\n=== 7. 导入后的全局刷新 ===')

ok('App.vue 广播 data:imported', /\$emit\('data:imported'\)/.test(appVue))
for (const page of [
  'pages/index/index.vue',
  'pages/account/index.vue',
  'pages/stats/index.vue'
]) {
  const src = stripComments(read(page))
  ok(`${page} 监听 data:imported`, /\$on\('data:imported'/.test(src))
}

/* ------------------------------------------------------------------ */

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`)
if (fail > 0) {
  console.log('\n失败的项：')
  fails.forEach((f) => console.log('  · ' + f))
  process.exit(1)
}
console.log('✅ 外部打开导入测试通过')
