/**
 * 打印 APK 里最终合并出来的 AndroidManifest.xml
 *
 *   node scripts/dump-manifest.mjs [apk路径]
 *
 * ★ 用途 ★
 *   「外部 JSON 用本 App 打开」这个功能，配置写在项目根目录的
 *   AndroidManifest.xml 里，**只有云打包后才生效**（官方文档原话：
 *   「清单文件配置需提交云端打包后才能生效，真机运行时请使用自定义调试基座」）。
 *   所以验证方式只有一个：把打出来的 APK 解开，看最终 manifest 里
 *   intent-filter 到底有没有合并进去、挂在哪个 activity 上。
 *
 *   默认读 unpackage/cache/apk/<appid>_cm.apk（HBuilderX 云打包缓存），
 *   也可以直接把 release 目录里的 apk 路径传进来。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import zlib from 'zlib'
import { decodeAxml, findAll } from './axml.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/* ------------------------------------------------- 极简 zip 读取 */
/**
 * 只需要读单个条目，所以不引第三方库：
 * 从结尾找 End Of Central Directory，再顺着中央目录找目标条目，
 * 拿到 localHeaderOffset 后按 local header 里的长度跳过去读压缩数据。
 */
function readZipEntry(zipBuf, entryName) {
  // 找 EOCD（0x06054b50），从尾部往前扫
  let eocd = -1
  for (let i = zipBuf.length - 22; i >= 0; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip/apk（找不到 EOCD）')

  const count = zipBuf.readUInt16LE(eocd + 10)
  let p = zipBuf.readUInt32LE(eocd + 16)

  for (let i = 0; i < count; i++) {
    if (zipBuf.readUInt32LE(p) !== 0x02014b50) break
    const method = zipBuf.readUInt16LE(p + 10)
    const compSize = zipBuf.readUInt32LE(p + 20)
    const nameLen = zipBuf.readUInt16LE(p + 28)
    const extraLen = zipBuf.readUInt16LE(p + 30)
    const commentLen = zipBuf.readUInt16LE(p + 32)
    const localOff = zipBuf.readUInt32LE(p + 42)
    const name = zipBuf.slice(p + 46, p + 46 + nameLen).toString('utf8')

    if (name === entryName) {
      // 本地文件头长度可能和中央目录不同，必须以本地头为准
      const lNameLen = zipBuf.readUInt16LE(localOff + 26)
      const lExtraLen = zipBuf.readUInt16LE(localOff + 28)
      const dataStart = localOff + 30 + lNameLen + lExtraLen
      const raw = zipBuf.slice(dataStart, dataStart + compSize)
      return method === 0 ? raw : zlib.inflateRawSync(raw)
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  throw new Error('APK 里没有 ' + entryName)
}

/* ------------------------------------------------- 输出 */

function attr(node, key) {
  return node.attrs[key] !== undefined ? node.attrs[key] : ''
}

function dumpActivity(act) {
  const name = attr(act, 'name')
  const lines = []
  lines.push(`activity  ${name}${attr(act, 'exported') !== '' ? `  exported=${attr(act, 'exported')}` : ''}${attr(act, 'launchMode') ? `  launchMode=${attr(act, 'launchMode')}` : ''}`)

  for (const f of act.children.filter((c) => c.tag === 'intent-filter')) {
    const actions = f.children.filter((c) => c.tag === 'action').map((c) => attr(c, 'name'))
    const cats = f.children.filter((c) => c.tag === 'category').map((c) => attr(c, 'name'))
    const datas = f.children.filter((c) => c.tag === 'data').map((c) => {
      const parts = []
      if (attr(c, 'scheme')) parts.push('scheme=' + attr(c, 'scheme'))
      if (attr(c, 'host')) parts.push('host=' + attr(c, 'host'))
      if (attr(c, 'mimeType')) parts.push('mimeType=' + attr(c, 'mimeType'))
      if (attr(c, 'pathPattern')) parts.push('pathPattern=' + attr(c, 'pathPattern'))
      return parts.join(' ')
    })
    lines.push('  ├ intent-filter')
    lines.push('  │   action  : ' + (actions.join(', ') || '(无)'))
    lines.push('  │   category: ' + (cats.join(', ') || '(无)'))
    lines.push('  │   data    : ' + (datas.join(' | ') || '(无)'))
  }
  for (const p of act.children.filter((c) => c.tag !== 'intent-filter')) {
    lines.push(`  └ ${p.tag} ${JSON.stringify(p.attrs)}`)
  }
  return lines.join('\n')
}

/* ------------------------------------------------- main */

const apkPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'unpackage/cache/apk/__UNI__8E8C7CE_cm.apk')

if (!fs.existsSync(apkPath)) {
  console.log('找不到 APK：' + apkPath)
  console.log('用法： node scripts/dump-manifest.mjs [某个.apk]')
  process.exit(1)
}

const zipBuf = fs.readFileSync(apkPath)
const manifestBuf = readZipEntry(zipBuf, 'AndroidManifest.xml')
const root = decodeAxml(manifestBuf)

console.log('APK: ' + apkPath)
console.log('根节点 package = ' + attr(root, 'package'))
console.log('')

const app = findAll(root, (n) => n.tag === 'application')[0]
const activities = app ? app.children.filter((c) => c.tag === 'activity') : []

console.log(`=== activity（${activities.length} 个）===`)
for (const a of activities) console.log(dumpActivity(a) + '\n')

console.log('=== 与「打开外部文件」相关的 intent-filter ===')
const RECEIVE = ['android.intent.action.VIEW', 'android.intent.action.SEND', 'android.intent.action.SEND_MULTIPLE']
let hit = 0
for (const a of activities) {
  for (const f of a.children.filter((c) => c.tag === 'intent-filter')) {
    const actions = f.children.filter((c) => c.tag === 'action').map((c) => attr(c, 'name'))
    if (actions.some((x) => RECEIVE.includes(x))) {
      hit++
      console.log(`✅ ${attr(a, 'name')}  ←  ${actions.join(' / ')}`)
      for (const d of f.children.filter((c) => c.tag === 'data')) {
        console.log('     data ' + JSON.stringify(d.attrs))
      }
    }
  }
}
if (!hit) {
  console.log('❌ 没有任何 activity 声明 VIEW / SEND ——')
  console.log('   说明项目根目录的 AndroidManifest.xml 没被合并进去（或还没云打包）。')
  console.log('   若还没打包过，先云打包一次再跑本脚本。')
  console.log('')
  console.log('   如果打过包了还是没有，八成是「安心打包」的母包缓存 ——')
  console.log('   安心打包（fastmode）不重新生成清单，只在缓存的母包上替换资源和版本号，')
  console.log('   清单改动会被整段忽略。判据：新包的 AndroidManifest.xml 与')
  console.log('   unpackage/cache/apk/<appid>_cm.apk 里的逐字节相同，只有版本号不同。')
  console.log('   解法：删掉 unpackage/cache/apk/ 后重新打包，或打包时改用「传统打包」。')
}
