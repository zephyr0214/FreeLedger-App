import fs from 'fs'
import path from 'path'

/**
 * 云打包前的检查清单。
 *
 * 云打包和本地编译不一样：很多东西本地跑得好好的，
 * 打包时才暴露（资源没进包、路由指向不存在的文件…）。
 * 这里把能在本地静态查出来的都查一遍。
 */

const ROOT = path.resolve(import.meta.dirname, '..')
let issues = 0
const warn = (msg) => { issues++; console.log('  ❌ ' + msg) }
const ok = (msg) => console.log('  ✅ ' + msg)

console.log('=== 1. manifest.json ===')
{
  const raw = fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')
  const clean = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  let m = null
  try { m = JSON.parse(clean) } catch (e) { warn('JSON 解析失败: ' + e.message) }

  if (m) {
    m.name ? ok(`应用名: ${m.name}`) : warn('没有应用名')
    m.appid ? ok(`appid: ${m.appid}`) : warn('★ 没有 appid，云打包会失败')

    const mods = Object.keys((m['app-plus'] || {}).modules || {})
    console.log('     modules:', mods.join(', ') || '(空)')

    /* ★ 权限重复检测（云打包失败的头号原因）★
       现象：
         Element uses-permission#android.permission.WRITE_EXTERNAL_STORAGE
         duplicated with element declared at AndroidManifest.xml:6:1-76
         Validation failed, exiting

       根因：同一条权限在两个地方各出现一次 ——
         1) 这里的 distribute.android.permissions
         2) HBuilderX「SDK 配置 -> 权限」里勾选的（会回写到同一个文件）
       Gradle 的 manifest merger 遇到同名 uses-permission 就直接失败。

       ★ 特别注意 ★
       HBuilderX 每次打包都会用界面上的勾选状态**重写** manifest.json，
       所以「在文件里删掉」是不够的 —— 必须去界面里取消勾选。
       这个检查是为了让你在打包前就能发现界面里还勾着。
    */
    const perms = (((m['app-plus'] || {}).distribute || {}).android || {}).permissions || []
    const names = perms
      .map((p) => (p.match(/android\.permission\.([A-Z_]+)/) || [])[1])
      .filter(Boolean)

    // 出现次数 > 1 的就是重复声明
    const seen = {}
    const dup = []
    names.forEach((n) => {
      seen[n] = (seen[n] || 0) + 1
      if (seen[n] === 2) dup.push(n)
    })
    dup.length
      ? warn('★ 权限重复声明（云打包会失败）: ' + dup.join(', ') +
        '。请到 HBuilderX「SDK 配置 -> 权限」里取消勾选对应的项。')
      : ok(`权限无重复（${names.length} 条）`)

    // 存储权限：导出/分享已删，用不到，别勾
    const STORAGE = ['WRITE_EXTERNAL_STORAGE', 'READ_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES', 'MANAGE_EXTERNAL_STORAGE']
    const storageOn = names.filter((n) => STORAGE.includes(n))
    storageOn.length
      ? warn('★ 声明了用不到的存储权限: ' + storageOn.join(', ') +
        '。备份只写 App 私有目录(_doc/)，不需要存储权限；' +
        '留着的另一个害处是会和 HBuilderX 界面勾选撞车。')
      : ok('没有多余的存储权限')

    console.log('     权限数:', perms.length)
    const hasInternet = perms.some((p) => p.includes('INTERNET'))
    hasInternet ? ok('有 INTERNET 权限（AI 功能需要）') : warn('★ 缺 INTERNET 权限，AI 功能会用不了')

    /* ★ 分享相关的模块/SDK 也要检查 ★
       导出/分享功能已删。如果 HBuilderX 界面还勾着「分享」，
       它会被回写进 manifest，云打包就会多打一套微信/QQ SDK 进去。
    */
    const UNUSED_MODULES = ['Share', 'File']
    const unusedMods = UNUSED_MODULES.filter((k) => mods.includes(k))
    unusedMods.length
      ? warn('★ modules 里还有用不到的: ' + unusedMods.join(', ') +
        '。导出/分享已删，请到 HBuilderX「SDK 配置」里取消勾选。')
      : ok('modules 里没有用不到的模块')

    const sdkKeys = Object.keys((((m['app-plus'] || {}).distribute || {}).sdkConfigs) || {})
    const unusedSdk = sdkKeys.filter((k) => k === 'share')
    unusedSdk.length
      ? warn('★ sdkConfigs 里还有: ' + unusedSdk.join(', ') +
        '。导出/分享已删，请到 HBuilderX「SDK 配置」里取消勾选。')
      : ok('sdkConfigs 里没有用不到的 SDK')

    // 图标
    const icons = (((m['app-plus'] || {}).distribute || {}).icons || {}).android || {}
    const iconPaths = Object.values(icons)
    if (!iconPaths.length) {
      warn('★ 没配 android 图标，打包会用默认图标')
    } else {
      const missing = iconPaths.filter((p) => !fs.existsSync(path.join(ROOT, p)))
      missing.length
        ? warn('★ 图标文件缺失: ' + missing.join(', '))
        : ok(`android 图标 ${iconPaths.length} 个都在`)
    }
  }
}

console.log('\n=== 2. pages.json 路由 ===')
{
  const raw = fs.readFileSync(path.join(ROOT, 'pages.json'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const j = JSON.parse(raw)
  const missing = (j.pages || []).filter((p) => !fs.existsSync(path.join(ROOT, p.path + '.vue')))
  missing.length
    ? warn('★ 路由指向的页面不存在: ' + missing.map((p) => p.path).join(', '))
    : ok(`${(j.pages || []).length} 个页面都存在`)

  const declared = new Set((j.pages || []).map((p) => p.path))
  const badTab = (j.tabBar?.list || []).filter((t) => !declared.has(t.pagePath))
  badTab.length ? warn('★ tabBar 页面没在 pages 里声明: ' + badTab.map((t) => t.pagePath).join(', '))
                 : ok('tabBar 页面都已声明')
}

console.log('\n=== 3. tabBar 图标资源 ===')
{
  const theme = JSON.parse(fs.readFileSync(path.join(ROOT, 'theme.json'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1'))
  const paths = []
  for (const mode of ['light', 'dark']) {
    for (let i = 1; i <= 4; i++) {
      // 注意括号：?. 的优先级比 + 低，必须写成 theme[mode]['iconPath' + i]
      const p = theme[mode]?.['iconPath' + i]
      const s = theme[mode]?.['selectedIconPath' + i]
      if (p) paths.push(p)
      if (s) paths.push(s)
    }
  }
  const unique = [...new Set(paths)]
  const missing = unique.filter((p) => !fs.existsSync(path.join(ROOT, p)))
  missing.length
    ? warn('★ tabBar 图标缺失: ' + missing.join(', '))
    : ok(`tabBar 图标 ${unique.length} 个都存在`)
  if (!unique.length) warn('★ 没解析到任何 tabBar 图标路径，检查 theme.json 结构')
}

console.log('\n=== 4. static 目录里的图片资源 ===')
{
  const dir = path.join(ROOT, 'static')
  let total = 0
  const missing = []
  function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(png|jpg|jpeg|gif|svg)$/i.test(e.name)) {
        total++
        if (fs.statSync(p).size === 0) missing.push(path.relative(ROOT, p))
      }
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  missing.length
    ? warn('★ 有 0 字节的图片: ' + missing.join(', '))
    : ok(`${total} 个图片资源都正常`)
}

console.log('\n=== 5. 页面里引用的本地图片 ===')
{
  const refs = new Set()
  function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.vue')) {
        const src = fs.readFileSync(p, 'utf8')
        for (const m of src.matchAll(/(?:src|srcset)\s*=\s*["']([^"']+)["']/g)) {
          const v = m[1]
          if (v.startsWith('/') || v.startsWith('@/')) refs.add(v)
        }
      }
    }
  }
  walk(path.join(ROOT, 'pages'))
  walk(path.join(ROOT, 'components'))
  const missing = [...refs].filter((r) => {
    const rel = r.startsWith('/') ? r.slice(1) : r.replace('@/', '')
    return !fs.existsSync(path.join(ROOT, rel))
  })
  missing.length
    ? warn('★ 页面引用了不存在的图片: ' + missing.join(', '))
    : ok(`${refs.size} 个图片引用都存在`)
}

console.log('\n=== 6. 云打包注意事项 ===')
console.log('  · manifest.json 的 appid 必须保留（' + (JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).appid || '（空！）') + '）')
console.log('  · modules 里只声明了 SQLite —— 导出/分享功能已删，不需要 Share 模块')
console.log('  · 卸载应用会删除全部数据，备份只在 _doc/backup/（本机）')
console.log('  · tabBar 图标路径没变但内容变过 —— 必须重新打包才生效')

console.log('\n  ★★ HBuilderX 的「SDK 配置」面板会覆盖 manifest.json ★★')
console.log('  HBuilderX 每次打包都会用界面上勾选的配置**重写** manifest.json：')
console.log('    - 「权限」里勾了什么，distribute.android.permissions 就是什么')
console.log('    - 「模块配置」里勾了什么，modules 就是什么')
console.log('  所以光改文件没用 —— 必须在界面上取消勾选，否则每次打包都会写回来。')
console.log('')
console.log('  打包前请在 HBuilderX 里确认（manifest.json 右上角「打包」按钮旁的')
console.log('  「基础配置 / App权限配置 / App SDK配置」三个页签）：')
console.log('    ① App权限配置：取消勾选 存储/读写外部存储/相册/媒体 相关权限')
console.log('       （本应用的备份只写 App 私有目录 _doc/，完全用不到外部存储）')
console.log('    ② App SDK配置：取消勾选 分享/Share 相关的 SDK')
console.log('       （导出/分享功能已整块删掉了）')
console.log('    ③ 如果这些项之前勾着而你已取消，manifest.json 会自动被改回来，')
console.log('       本检查也会跟着报出来 —— 看到 ❌ 就是界面里还勾着。')

console.log(issues === 0 ? '\n✅ 检查通过，可以云打包' : `\n❌ 发现 ${issues} 个问题`)
process.exit(issues ? 1 : 0)
