/**
 * 「导出 / 导入」功能已删除，只保留备份
 *
 *   node scripts/test-no-export-import.mjs
 *
 * ★ 这个测试锁住一次功能删除 ★
 *   用户原话：「删除导入/导出的功能及其相关代码，只留下备份」。
 *
 *   之前这两块带来了持续不断的麻烦：
 *     - 分享给微信：Android 7+ 禁 file:// 外传，
 *       要 FileProvider 换 content://，而 uni-app 的 manifest.json
 *       没暴露自定义 provider 的配置项，纯云打包做不了
 *     - 导入：uni.chooseFile 在 App 端会打开相册而不是文件管理器，
 *       只能自己用 Native.js 起 Intent，机型兼容性没保障
 *
 *   而备份在内部用的就是同一套序列化逻辑，
 *   只是落在 App 私有目录、不需要用户手工搬运文件 ——
 *   所以把「用户可见的导入导出」整个删掉，收益远大于损失。
 *
 *   这个测试防的是「以后有人又把导出/导入加回来」
 *   （或者加回来时没想清楚那堆坑）。
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

console.log('=== api/backup.js：导出/导入的函数已移除 ===')

const backup = await import('../api/backup.js')
const backupSrc = read('api/backup.js')

const REMOVED_EXPORTS = [
  'exportToFile',       // 写 _doc/export/ 的文件
  'importFromFile',     // 从文件导入
  'listExportFiles',    // 导出文件列表
  'deleteExportFile',   // 删除导出文件
  'prepareShareFile',   // 分享前的复制到公共目录
  'copyFileTo',         // 复制到目标目录
  'toAbsolutePath',     // 分享用的绝对路径
  'resolveSharePath',   // 分享路径解析
  'chooseFileFromSystem', // 系统文件选择器
  'daysSinceLastExport' // 距上次导出天数
]

for (const name of REMOVED_EXPORTS) {
  check(`${name} 不再导出`, typeof backup[name], 'undefined')
  check(`${name} 源码里没有定义`, new RegExp(`function\\s+${name}\\s*\\(`).test(backupSrc), false)
}

console.log('=== api/backup.js：备份相关的能力还在 ===')

const KEPT = [
  'buildExportPayload',  // 序列化
  'exportToJson',        // 序列化成 JSON 字符串
  'importPayload',       // 从 JSON 字符串恢复
  'autoBackup',          // 自动备份
  'listBackups',         // 备份列表
  'restoreBackup',       // 从备份恢复
  'writeTextFile',       // 写文件
  'readTextFile',        // 读文件
  'validatePayload',     // 校验
  'daysSinceLastBackup'  // 距上次备份天数
]
for (const name of KEPT) {
  check(`${name} 还在`, typeof backup[name] === 'function', true)
}

console.log('=== 命名统一为「备份」而不是「导出」 ===')

check('没有 EXPORT_APP_ID', /EXPORT_APP_ID/.test(backupSrc), false)
check('没有 EXPORT_SCHEMA_VERSION', /EXPORT_SCHEMA_VERSION/.test(backupSrc), false)
check('有 BACKUP_APP_ID', /BACKUP_APP_ID/.test(backupSrc), true)
check('有 BACKUP_SCHEMA_VERSION', /BACKUP_SCHEMA_VERSION/.test(backupSrc), true)

console.log('=== 页面：没有导入/导出的 UI ===')

const data = stripComments(read('pages/settings/data.vue'))

check('没有「导出」section', /section-export/.test(data), false)
check('没有「导入」section', /@click="onExport/.test(data), false)
check('没有 onExport 调用', /onExport/.test(data), false)
check('没有 onImport 调用', /onImport/.test(data), false)
check('没有 exportFiles 状态', /exportFiles/.test(data), false)
check('没有 showExportFiles 状态', /showExportFiles/.test(data), false)
check('没有分享相关代码', /shareFile|onShareExport|prepareShareFile/.test(data), false)
check('没有系统文件选择器', /chooseFileFromSystem/.test(data), false)

console.log('=== 页面：备份的 UI 还在 ===')

check('有「备份」section', /section-backup/.test(data), true)
check('有自动备份开关', /onToggleAutoBackup/.test(data), true)
check('有立即备份', /onManualBackup/.test(data), true)
check('有备份记录弹层', /showBackups/.test(data), true)
check('有从备份恢复', /onRestoreBackup/.test(data), true)

console.log('=== 设置项命名统一 ===')

const settings = read('api/settings.js')
const settingStore = read('stores/setting.js')
check('没有 lastExportAt', /lastExportAt/.test(settings + settingStore), false)
check('有 lastBackupAt', /lastBackupAt/.test(settings + settingStore), true)

const mine = stripComments(read('pages/mine/index.vue'))
check('我的页不再用 daysSinceLastExport', /daysSinceLastExport/.test(mine), false)
check('我的页用 daysSinceLastBackup', /daysSinceLastBackup/.test(mine), true)

console.log('=== App 名称已改为「自由记」===')

check('manifest.json 名字', /"name"\s*:\s*"自由记"/.test(read('manifest.json')), true)
check('pages.json 标题', /"navigationBarTitleText"\s*:\s*"自由记"/.test(read('pages.json')), true)
check('关于页显示自由记', /自由记/.test(read('pages/settings/about.vue')), true)
check('关于页用了 logo.png', /static\/app\/logo\.png/.test(read('pages/settings/about.vue')), true)
check('logo 文件存在', fs.existsSync(path.join(ROOT, 'static/app/logo.png')), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
