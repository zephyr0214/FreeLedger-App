/**
 * 给 4 个 tab 页面插入 tabBar 分割线
 *
 *   node scripts/add-tabbar-divider.mjs
 *
 * 分割线放在滚动区之后、浮层之前，避免被滚动内容盖住。
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const PAGES = [
  'pages/index/index.vue',
  'pages/account/index.vue',
  'pages/stats/index.vue',
  'pages/mine/index.vue'
]

const DIVIDER = `
      <!-- tabBar 上方分割线：原生 tabBar 的 borderStyle 只有 black/white，做不出浅灰 -->
      <view class="tabbar-divider" />
`

let changed = 0

for (const p of PAGES) {
  const file = join(ROOT, p)
  let code = readFileSync(file, 'utf-8')

  if (code.includes('tabbar-divider')) {
    console.log(`  skip  ${p} (已有分割线)`)
    continue
  }

  // 插到最后一个 </scroll-view> 之后
  const idx = code.lastIndexOf('</scroll-view>')
  if (idx === -1) {
    console.log(`  FAIL  ${p} (找不到 </scroll-view>)`)
    continue
  }
  const insertAt = idx + '</scroll-view>'.length
  code = code.slice(0, insertAt) + '\n' + DIVIDER + code.slice(insertAt)

  writeFileSync(file, code, 'utf-8')
  changed++
  console.log(`  ok    ${p}`)
}

console.log(`\n处理 ${changed} 个页面`)
