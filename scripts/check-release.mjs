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

    const perms = (((m['app-plus'] || {}).distribute || {}).android || {}).permissions || []
    console.log('     权限数:', perms.length)
    const hasInternet = perms.some((p) => p.includes('INTERNET'))
    hasInternet ? ok('有 INTERNET 权限（AI 功能需要）') : warn('★ 缺 INTERNET 权限，AI 功能会用不了')

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

console.log(issues === 0 ? '\n✅ 检查通过，可以云打包' : `\n❌ 发现 ${issues} 个问题`)
process.exit(issues ? 1 : 0)
