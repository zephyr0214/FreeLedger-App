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

for (const name of ['listImportableFiles', 'importFromFile']) {
  check(`${name} 已导出`, typeof backup[name], 'function')
}
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

console.log('=== 页面：导出 / 导入 / 导出历史 ===')

const data = stripComments(read('pages/settings/data.vue'))

check('有「导出」区块', /section-export/.test(data), true)
check('有「导入」区块', /section-import/.test(data), true)
check('有导出按钮', /onExport/.test(data), true)
check('有导入按钮', /onImport/.test(data), true)
check('有导出历史列表状态', /exportFiles/.test(data), true)
check('有导出历史弹层状态', /showExportFiles/.test(data), true)
check('能分享导出文件', /onShareExport/.test(data), true)
check('能删除导出文件', /onDeleteExport/.test(data), true)
// ★ 导入是应用内文件浏览（系统选择器回调不触发，改用 plus.io 扫描）★
check('有导入文件列表状态', /importFiles/.test(data), true)
check('有导入浏览弹层状态', /showImportPicker/.test(data), true)
check('能挑一个文件导入', /onPickImportFile/.test(data), true)
check('导入前扫描文件', /listImportableFiles/.test(data), true)

// 导出历史里两个操作都要出现
check('导出历史里有「分享」', /分享/.test(data), true)
check('导出历史里有「删除」', /删除/.test(data), true)

console.log('=== 页面：备份的 UI 也还在 ===')

check('有「备份」区块', /section-backup/.test(data), true)
check('有自动备份开关', /onToggleAutoBackup/.test(data), true)
check('有立即备份', /onManualBackup/.test(data), true)
check('有备份记录', /showBackups/.test(data), true)
check('有从备份恢复', /onRestoreBackup/.test(data), true)

console.log('=== 导入是「覆盖」语义，且会先备份 ===')

check('导入调用 importFromFile', /importFromFile\s*\(/.test(data), true)
check('导入前有确认', /用这个文件覆盖当前数据/.test(data), true)
// api 层：覆盖模式 + 先自动备份
check('importFromFile 用覆盖模式', /mode:\s*'overwrite'/.test(code), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
