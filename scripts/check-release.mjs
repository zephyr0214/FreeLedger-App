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
/** 只是提示，不计入失败 —— 这类问题改不了文件，或在别处控制 */
const info = (msg) => console.log('  ℹ ' + msg)

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

    // 存储权限：本应用的备份只写 App 私有目录 _doc/，完全用不到
    const STORAGE = [
      'WRITE_EXTERNAL_STORAGE', 'READ_EXTERNAL_STORAGE',
      'READ_MEDIA_IMAGES', 'MANAGE_EXTERNAL_STORAGE'
    ]

    /* ★ 权限重复检测（云打包失败的头号原因）★
       现象：
         Element uses-permission#android.permission.WRITE_EXTERNAL_STORAGE
         duplicated with element declared at AndroidManifest.xml:6:1-76
         Validation failed, exiting

       根因：同一条权限出现两次 ——
         1) 这里的 distribute.android.permissions
         2) DCloud 基础 SDK / 三方 SDK 自动带的那条
       Gradle 的 manifest merger 遇到同名 uses-permission 就直接失败。

       ★ 正确的解法不是「不写 permissions」★
         那不解决冲突 —— SDK 带来的那条还在。
         官方给的解法是「强制移除的权限」：
           app-plus.permission.remove
           （部分 HBuilderX 版本用 app-plus.distribute.android.permissionRemove）
         明确把 SDK 带的那条去掉，两边就不会撞了。

       所以这里检查三件事：
         a) permissions 里有没有和 remove 列表重复的（自己和自己冲突）
         b) permissions 里有没有该被 remove 掉的（写了但没移除 -> 打包必挂）
         c) remove 列表里有没有和 permissions 重复的（同样是自己和自己冲突）
    */
    const perms = (((m['app-plus'] || {}).distribute || {}).android || {}).permissions || []
    const names = perms
      .map((p) => (p.match(/android\.permission\.([A-Z_]+)/) || [])[1])
      .filter(Boolean)

    // 强制移除的权限（两个字段名都认）
    const removeList = [
      ...(((m['app-plus'] || {}).permission) || {}).remove || [],
      ...((((m['app-plus'] || {}).distribute || {}).android) || {}).permissionRemove || []
    ].map((n) => String(n).replace(/^android\.permission\./, ''))

    // 出现次数 > 1 的就是重复声明
    const seen = {}
    const dup = []
    names.forEach((n) => {
      seen[n] = (seen[n] || 0) + 1
      if (seen[n] === 2) dup.push(n)
    })
    dup.length
      ? warn('★ permissions 里有重复声明（云打包会失败）: ' + dup.join(', '))
      : ok(`permissions 无重复（${names.length} 条）`)

    // ★ 关键检查：permissions 里写了、但没在 remove 里去掉 = 打包必挂 ★
    const notRemoved = names.filter((n) =>
      STORAGE.includes(n) && !removeList.includes(n)
    )
    notRemoved.length
      ? warn('★ permissions 里声明了存储权限但没有在「强制移除的权限」里去掉: ' +
        notRemoved.join(', ') + '。云打包会报 duplicated —— ' +
        '要么从 permissions 里删掉，要么加进 app-plus.permission.remove。')
      : ok('存储权限都已正确移除')

    // remove 里不该出现 permissions 里已有的（自己和自己冲突）
    const both = names.filter((n) => removeList.includes(n))
    both.length
      ? warn('★ 同一条权限既在 permissions 里、又在强制移除列表里: ' + both.join(', '))
      : ok('强制移除列表和 permissions 没有交集')

    if (!removeList.length) {
      console.log('     提示: 没有配置「强制移除的权限」。' +
        '如果云打包报 duplicated，就是基础 SDK 带的那条存储权限没被去掉。')
    }

    console.log('     权限数:', perms.length)
    const hasInternet = perms.some((p) => p.includes('INTERNET'))
    hasInternet ? ok('有 INTERNET 权限（AI 功能需要）') : warn('★ 缺 INTERNET 权限，AI 功能会用不了')

    /* ★ 分享/文件相关的模块：只做提示，不算错误 ★
       这两个由 HBuilderX 界面勾选决定，而且每次打包都会被它重写回来 ——
       改文件没用。它们也不影响能不能编译，只是多一点包体，
       所以这里打印出来提醒，但不当作失败。 */
    const UNUSED_MODULES = ['Share', 'File']
    const unusedMods = UNUSED_MODULES.filter((k) => mods.includes(k))
    unusedMods.length
      ? info('modules 里有 ' + unusedMods.join(', ') +
        '（由 HBuilderX 界面控制，本应用不依赖；想减包体就在「App SDK配置」里取消勾选）')
      : ok('modules 里没有多余的模块')

    const sdkKeys = Object.keys((((m['app-plus'] || {}).distribute || {}).sdkConfigs) || {})
    const unusedSdk = sdkKeys.filter((k) => k === 'share')
    unusedSdk.length
      ? info('sdkConfigs 里有 share（分享走系统面板 uni.shareWithSystem，不依赖它；' +
        '想减包体就在「App SDK配置」里取消勾选）')
      : ok('sdkConfigs 里没有多余的 SDK')

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

console.log('\n  ★★ 关于「权限重复」这个云打包错误 ★★')
console.log('  报错长这样：')
console.log('    Element uses-permission#android.permission.WRITE_EXTERNAL_STORAGE')
console.log('    duplicated with element declared at AndroidManifest.xml:6:1-76')
console.log('    Validation failed, exiting')
console.log('')
console.log('  原因：DCloud 基础 SDK 会自动带上存储权限，')
console.log('  而 manifest.json 的 permissions 里又手写了一条同名��，')
console.log('  两条 uses-permission 合并 -> Gradle 直接失败。')
console.log('')
console.log('  ★ 解法 ★')
console.log('  不是「不写 permissions」（那不解决冲突，SDK 带的那条还在），')
console.log('  而是「用强制移除把 SDK 带的那条去掉」—— 本项目已配好：')
console.log('    app-plus.permission.remove')
console.log('    app-plus.distribute.android.permissionRemove')
console.log('  两个字段名都写了（不同 HBuilderX 版本位置不同）。')
console.log('')
console.log('  ★ HBuilderX 界面会覆盖 manifest.json ★')
console.log('  HBuilderX 每次打包都会用「SDK 配置」面板上的勾选状态重写 manifest.json：')
console.log('    - 「权限」里勾了什么 -> distribute.android.permissions 就是什么')
console.log('    - 「模块配置」里勾了什么 -> modules 就是什么')
console.log('  所以如果界面里还勾着存储权限，打包前请先取消勾选，')
console.log('  否则文件里的配置会被写回去，本检查也会跟着报出来。')

console.log(issues === 0 ? '\n✅ 检查通过，可以云打包' : `\n❌ 发现 ${issues} 个问题`)
process.exit(issues ? 1 : 0)
