/**
 * 导出 / 导入 功能
 *
 *   node scripts/test-export-import.mjs
 *
 * ★ 这个测试的历史 ★
 *   前一轮用户要求「删除导入/导出的功能及其相关代码，只留下备份」，
 *   当时的测试断言这些函数**不存在**。
 *   这一轮用户又要求恢复，而且要求更具体：
 *     「数据预备份新增导出和导入功能，导出支持分享，
 *      导入要调用手机的文件选择选择文件导入，
 *      要支持对导出历史进行删除」
 *
 *   所以测试的目标变了 —— 从「确保没有」变成「确保有，而且是对的」。
 *   重点锁住这次的关键决策：
 *
 *   1. 分享必须走 uni.shareWithSystem（系统分享面板）
 *      不能走 plus.share —— 那条老路传 file:// 路径，
 *      Android 7+ 撞 FileUriExposedException，微信一律
 *      「获取资源失败」（这个坑来回折腾过三轮）。
 *
 *   2. 导入必须调**系统**文件选择器（Native.js ACTION_GET_CONTENT），
 *      不能用 uni.chooseFile —— 它在 App 端会打开**相册**。
 *
 *   3. 导出历史要能删除（用户明确要求）。
 */

import fs from 'fs'
import path from 'path'

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

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** 去掉注释，避免把说明文字里的词当成代码 */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

console.log('=== api/backup.js：导出能力 ===')

const backup = await import('../api/backup.js')
const src = read('api/backup.js')

for (const name of ['exportToFile', 'exportToJson', 'listExportFiles', 'deleteExportFile', 'toAbsolutePath']) {
  check(`${name} 已导出`, typeof backup[name], 'function')
}
check('导出目录是 _doc/export/', /EXPORT_DIR\s*=\s*'_doc\/export\/'/.test(src), true)

console.log('=== api/backup.js：分享走 Native.js + FileProvider ===')

check('shareExportFile 已导出', typeof backup.shareExportFile, 'function')

// ★ 关键：这个基座的 shareWithSystem 只支持 text/image（实测报
//   「shareWithSystem:fail 分享参数type不正确。只支持text、image」），
//   所以**不能**再传 type:'file' 给它。文件分享必须走原生。
const code = stripComments(src)

check('没有把 type:file 传给 shareWithSystem', /shareWithSystem\s*\(\s*\{[^}]*type:\s*'file'/.test(code), false)
check('没有用 filePaths 分享', /filePaths/.test(code), false)

// ★ 文件分享走 FileProvider，生成 content:// URI，再起 ACTION_SEND ★
check('用 DCloud 自带 FileProvider', /io\.dcloud\.common\.util\.DCloud_FileProvider/.test(code), true)
check('authority 是 包名.dc.fileprovider', /\.dc\.fileprovider/.test(code), true)
check('用 FileProvider.getUriForFile', /getUriForFile/.test(code), true)
check('用 ACTION_SEND', /Intent\.ACTION_SEND/.test(code), true)
check('带 EXTRA_STREAM', /EXTRA_STREAM/.test(code), true)
check('授权读权限', /FLAG_GRANT_READ_URI_PERMISSION/.test(code), true)
check('调系统选择器', /createChooser/.test(code), true)

// ★ 不能再退回 plus.share ★
check('没有用 plus.share 分享文件', /plus\.share\./.test(code), false)
check('没有给路径补 file:// 前缀', /'file:\/\/'|\"file:\/\//.test(code), false)

// ★ 降级：FileProvider 失败时按文本分享，数据不至于出不去 ★
check('有文本分享降级', /shareAsText/.test(code), true)
check('文本分享用 type:text', /type:\s*'text'/.test(code), true)

console.log('=== api/backup.js：导入走应用内文件浏览 ===')

/*
  ★ 本轮变化（用户要求）★
    「数据备份里面删除从文件导入这个选项及其背后的逻辑」
    importFromFile 只服务于那个入口，入口删了它就是死代码，
    所以一并撤掉。listImportableFiles 保留 ——
    「历史数据管理」还在用它扫描文件列表。
*/
check('listImportableFiles 已导出', typeof backup.listImportableFiles, 'function')
check('importFromFile 已删除', backup.importFromFile, undefined)
// ★ 系统选择器（Native.js ACTION_GET_CONTENT + onActivityResult）在用户基座上
//   回调从不触发（实测日志：startActivityForResult 调起后 90 秒报「系统未回调」）。
//   所以导入改成 plus.io 扫描 _doc/_downloads/_documents 的应用内浏览。
//   官方文档对 App 端也这么建议：「通过 plus.io API，自己做选择框」。
check('用 plus.io 扫描可导入文件', /listImportableFiles/.test(code), true)
check('扫 _doc 目录', /_doc\//.test(code), true)
check('扫 _downloads 目录', /_downloads\//.test(code), true)
check('扫 _documents 目录', /_documents\//.test(code), true)
check('用 createReader 列目录', /createReader/.test(code), true)
check('只挑 .json 文件', code.includes('\\.json$'), true)

// ★ 不能再依赖 onActivityResult（用户基座收不到）★
check('没有依赖 ACTION_GET_CONTENT', /Intent\.ACTION_GET_CONTENT/.test(code), false)
check('没有依赖 onActivityResult', /addEventListener\('onActivityResult'/.test(code), false)
// 不能退回 uni.chooseFile（App 端会打开相册）
check('没有用 uni.chooseFile', /uni\.chooseFile/.test(code), false)

console.log('=== 备份能力没被破坏 ===')

for (const name of ['autoBackup', 'listBackups', 'restoreBackup', 'importPayload', 'parseJsonLoose']) {
  check(`${name} 还在`, typeof backup[name], 'function')
}

console.log('=== manifest：不依赖微信分享 SDK ===')

const manifest = stripComments(read('manifest.json'))
check('有 SQLite 模块', /"SQLite"\s*:/.test(manifest), true)

/*
  ★ 这里不检查「modules 里没有 Share / sdkConfigs 里没有 share」★
    HBuilderX 每次打包都会用界面勾选状态**重写** manifest.json，
    模块/SDK 是否勾着由界面决定，改文件会被冲掉。
    只要代码里不依赖 plus.share（上面已经断言），
    勾没勾 share SDK 都只是包体大小问题，不影响功能正确性。
*/
const mods = (manifest.match(/"modules"\s*:\s*\{([\s\S]*?)\n\s*\}/) || [])[1] || ''
console.log('     当前 modules:', mods.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim())

console.log('=== 页面：导出 / 导入 / 数据管理 ===')

const data = stripComments(read('pages/settings/data.vue'))

check('有「导出」区块', /section-export/.test(data), true)
check('有导出按钮', /onExport/.test(data), true)

/*
  ★ 本轮用户要求删掉的两个入口 ★
    1. 「从文件导入」区块（原 section-import 里那套扫目录 + 弹层选择）
    2. 「从其他应用打开」里的「导入刚才打开的文件」（onOpenExternalNow）
  连同背后的逻辑（onImport / onPickImportFile / importFromFile / showImportPicker）
  一起删除。

  ★ 注意：section-import 这个 id 现在又有了 ★
    用户后来要求「导出下方增加一个导入，显示从外部导入直接分享到自由记 App 即可」，
    所以那个位置换成了一个纯说明格（不是按钮，没有 @click），
    文案是「在 JSON 中选用其他应用打开，选择自由记即可」。
    所以这里断言的不能再是「id 不存在」，而是「选文件那套逻辑不存在」。
*/
check('没有 onImport', /onImport\b/.test(data), false)
check('没有 onPickImportFile', /onPickImportFile/.test(data), false)
check('没有导入浏览弹层', /showImportPicker/.test(data), false)
check('没有 onOpenExternalNow', /onOpenExternalNow/.test(data), false)
check('没有「导入刚才打开的文件」文案', /导入刚才打开的文件/.test(data), false)
check('没有底部数据库路径提示', /数据全部保存在本机|_doc\/books\.db/.test(data), false)

// 新的「导入」区块：说明怎么从外部导入，本身不可点
check('有「导入」区块', /id="section-import"/.test(data), true)
check('导入区块文案是用户指定的那句', /在 JSON 中选用其他应用打开，选择自由记即可/.test(data), true)
check('预览调试按钮已删除', /onPreviewImportDialog/.test(data), false)

/*
  区块顺序（用户指定）：导出 → 导入 → 备份 → 数据管理 → 维护
  「数据管理」原来在「备份」上面，用户要求挪到下面。
*/
{
  const order = ['section-export', 'section-import', 'section-backup', 'section-data']
    .map((id) => data.indexOf(`id="${id}"`))
  check('四个区块顺序是 导出→导入→备份→数据管理', order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), true)
}

/*
  「导入」那一格不是按钮 —— 段内不能有 @click。
  取 section-import 到下一个 section 之间的片段来判。
*/
{
  const start = data.indexOf('id="section-import"')
  const end = data.indexOf('id="section-backup"')
  const seg = start >= 0 && end > start ? data.slice(start, end) : ''
  check('导入区块不可点击（段内没有 @click）', /@click/.test(seg), false)
  check('导入区块没有箭头（不是可点行的样子）', /row-arrow/.test(seg), false)
}

// ★ 历史数据管理：扫三个文件夹（_doc/_downloads/_documents），每个 JSON 可恢复 / 删除 ★
check('有「历史数据管理」区块', /section-data/.test(data), true)
check('入口叫「历史数据管理」', /历史数据管理/.test(data), true)
check('有数据管理列表状态', /dataFiles/.test(data), true)
check('有数据管理弹层状态', /showDataManager/.test(data), true)
check('能打开数据管理', /onOpenDataManager/.test(data), true)
check('能恢复数据', /onRestoreData/.test(data), true)
check('能删除数据', /onDeleteData/.test(data), true)
// ★ 扫三个文件夹：用 listImportableFiles（它扫 _doc/_downloads/_documents）★
check('用 listImportableFiles 扫三个文件夹', /listImportableFiles\s*\(/.test(data), true)
check('有刷新按钮', /refreshDataManager/.test(data), true)
check('页面加载时就扫一次（数量立即正确）', /onMounted[\s\S]{0,400}loadDataManager\s*\(/.test(data), true)

// ★ 旧的「导出历史」「备份记录」两个入口已删除 ★
check('没有导出历史入口', /openExportFiles/.test(data), false)
check('没有 onShareExport', /onShareExport/.test(data), false)
check('没有 onDeleteExport', /onDeleteExport/.test(data), false)
check('没有查看备份记录入口', /查看备份记录/.test(data), false)
check('没有 onRestoreBackup', /onRestoreBackup/.test(data), false)
check('没有 showBackups 弹层', /showBackups/.test(data), false)
check('没有 showExportFiles 弹层', /showExportFiles/.test(data), false)

console.log('=== 页面：备份的 UI 也还在 ===')

check('有「备份」区块', /section-backup/.test(data), true)
check('有自动备份开关', /onToggleAutoBackup/.test(data), true)
check('有立即备份', /onManualBackup/.test(data), true)

console.log('=== 导入仍会先自动备份（由 importPayload 负责）===')

check('importPayload 用 overwrite 分支清库', /mode === 'overwrite'[\s\S]{0,200}truncateAll\(\)/.test(code), true)
check('importPayload 导入前 autoBackup', /autoBackup\('before-import'\)/.test(code), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
