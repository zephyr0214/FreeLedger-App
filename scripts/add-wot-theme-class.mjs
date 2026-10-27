/**
 * 给所有页面的根节点加 wot-theme-dark / wot-theme-light 类
 *
 *   node scripts/add-wot-theme-class.mjs
 *
 * 背景：
 *   wot-design-uni 的深色样式是靠**祖先上的 class** 切换的，不是靠 CSS 变量：
 *     .wot-theme-dark { @include b(button) { ... } }   // wd-button/index.scss
 *     .wot-theme-dark { @include b(popup-wrapper) { ... } }
 *   也就是说，光注入 --wot-dark-* 变量不够，
 *   必须有一个祖先元素带 `wot-theme-dark` 这个类。
 *
 *   项目里没有渲染 <wd-config-provider>（App.vue 的 template 在 App 端不渲染），
 *   所以改成给每个页面的根节点 (.app-page) 加这个类。
 *
 * 幂等：已经加过的页面会跳过。
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname, resolve, relative } from 'path'
import { fileURLToPath } from 'url'
import { readdirSync, statSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'unpackage', '.git', 'dist', 'scripts'].includes(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

const files = walk(join(ROOT, 'pages'))
let changed = 0
let skipped = 0

for (const file of files) {
  const rel = relative(ROOT, file)
  const code = readFileSync(file, 'utf-8')

  // 已经加过就跳过
  if (code.includes(':class="settingStore.wotClass"')) {
    skipped++
    continue
  }

  // 找根节点 <view class="app-page" ...>
  const re = /<view class="app-page"([^>]*)>/
  const m = code.match(re)
  if (!m) {
    console.log(`跳过（找不到 .app-page 根节点）: ${rel}`)
    continue
  }

  const attrs = m[1]
  // 根节点上已经有 :class 就合并，否则新增
  let newAttrs
  if (/:class="/.test(attrs)) {
    newAttrs = attrs.replace(/:class="([^"]*)"/, ':class="[$1, settingStore.wotClass]"')
  } else {
    newAttrs = ` :class="settingStore.wotClass"${attrs}`
  }

  const after = code.replace(re, `<view class="app-page"${newAttrs}>`)
  writeFileSync(file, after, 'utf-8')
  changed++
  console.log(`已处理 ${rel}`)
}

console.log(`\n共修改 ${changed} 个页面，跳过 ${skipped} 个`)
