/**
 * 生成 Emojiall 分类图标元数据 —— 只抓分类/名称，不下载任何图片
 *
 *   node scripts/gen-emojiall.mjs
 *
 * ★ 数据来源 ★
 *   https://www.emojiall.com/zh-hans/categories/D  （动物与自然）
 *   https://www.emojiall.com/zh-hans/categories/E  （食物与饮料）
 *   https://www.emojiall.com/zh-hans/categories/F  （旅行与地点）
 *   https://www.emojiall.com/zh-hans/categories/G  （活动）
 *   https://www.emojiall.com/zh-hans/categories/H  （物品）
 *
 * ★ 为什么不下载图片 ★
 *   图标显示时按码点拼 Emojiall 的 CDN 地址：
 *     https://www.emojiall.com/images/{60|120}/apple/<小写码点>.png
 *   App 里 <image> 按需加载，系统 HTTP 缓存会复用，不占安装包体积。
 *
 * ★ 只保留五个大类 ★
 *   表情 / 人物 / 肤色 / 符号 / 旗帜不在本脚本的抓取范围。
 *   二级分类（Subgroups）保留中文名，供图标选择页左侧树使用。
 */

import { writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const BASE = 'https://www.emojiall.com/zh-hans'

/**
 * 五个大类
 *
 * icon / char 是左侧分组标题上显示的代表图标（与 Emojiall 分组截图一致）：
 *   动物 🐵 / 食物 🍓 / 旅行 🚍 / 活动 ⚽ / 物品 🥤
 */
const GROUP_DEFS = [
  { key: 'D', name: '动物与自然', icon: '1F435', char: '🐵' },
  { key: 'E', name: '食物与饮料', icon: '1F353', char: '🍓' },
  { key: 'F', name: '旅行与地点', icon: '1F68D', char: '🚍' },
  { key: 'G', name: '活动', icon: '26BD', char: '⚽' },
  { key: 'H', name: '物品', icon: '1F964', char: '🥤' }
]

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

/** 简单的 HTML 实体解码（页面里的名称偶尔带 &amp; / &#x...;） */
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
}

/** emoji 字符 -> 规范化码点（去掉 FE0F / FE0E，Emojiall 图片路径不带它们） */
function hexOf(emoji) {
  return [...String(emoji)]
    .map((c) => c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'))
    .filter((x) => x !== 'FE0F' && x !== 'FE0E')
    .join('-')
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.text()
}

/**
 * 解析一个大类页面
 *
 * 页面结构（每个二级分类一块）：
 *   <div class="emoji_card_list">
 *     <h2><a href="/zh-hans/sub-categories/D1">
 *       <span class="emoji_font line">🐀</span>哺乳动物<span class="item_count">64</span>
 *     </a></h2>
 *     <div class="row ... list_table">
 *       <div class="emoji_card">
 *         <a class="emoji_font">🐵</a>
 *         <a class="emoji_name truncate">猴头</a>
 *         ...
 */
function parseGroup(html, def) {
  const blocks = html.split('<div class="emoji_card_list">').slice(1)
  const subgroups = []

  for (const block of blocks) {
    const href = (block.match(/sub-categories\/([A-Z]\d+)/) || [])[1]
    if (!href) continue

    const h2 = block.match(
      /<span class="emoji_font line">([^<]*)<\/span>([^<]*)<span class="item_count">(\d+)<\/span>/
    )
    if (!h2) continue

    const subName = decodeEntities(h2[2]).trim()
    const expected = Number(h2[3]) || 0
    const icons = []
    const seen = new Set()

    for (const m of block.matchAll(
      /class="emoji_card"><a [^>]*class="emoji_font">([^<]*)<\/a><a [^>]*class="emoji_name truncate">([^<]*)<\/a>/g
    )) {
      const char = decodeEntities(m[1]).trim()
      const name = decodeEntities(m[2]).trim()
      if (!char || !name) continue

      const hex = hexOf(char)
      if (!hex || seen.has(hex)) continue
      seen.add(hex)
      icons.push([hex, name, char])
    }

    if (icons.length !== expected) {
      console.warn(`  ! ${href} ${subName}: 页面计数 ${expected}，解析到 ${icons.length}`)
    }

    subgroups.push({ key: href, name: subName, icons })
  }

  if (subgroups.length === 0) {
    throw new Error(`${def.name} 没有解析到任何二级分类`)
  }

  return subgroups
}

const q = (v) => JSON.stringify(v)

async function main() {
  const groups = []
  let total = 0

  for (const def of GROUP_DEFS) {
    const url = `${BASE}/categories/${def.key}`
    console.log(`抓取 ${def.name} ...`)
    const html = await fetchHtml(url)
    const subgroups = parseGroup(html, def)

    // 分组代表图标只用于左侧标题，不要求一定在本组内
    // （例如「物品」用 🥤 做标题图标，但它在食物组里）
    const allHex = new Set()
    for (const sg of subgroups) for (const [hex] of sg.icons) allHex.add(hex)
    if (!allHex.has(def.icon)) {
      console.warn(`  ℹ ${def.name} 的代表图标 ${def.icon} 来自其他分组（仅作标题图标，保留）`)
    }

    const count = subgroups.reduce((n, sg) => n + sg.icons.length, 0)
    total += count
    console.log(`  ${subgroups.length} 个二级分类，${count} 个图标`)

    groups.push({ ...def, subgroups })
  }

  const groupsText = groups.map((g) => {
    const subsText = g.subgroups.map((sg) => {
      const iconsText = sg.icons
        .map(([hex, name, char]) => `          [${q(hex)}, ${q(name)}, ${q(char)}]`)
        .join(',\n')
      return `      {
        key: ${q(sg.key)},
        name: ${q(sg.name)},
        icons: [
${iconsText}
        ]
      }`
    }).join(',\n')

    return `  {
    key: ${q(g.key)},
    name: ${q(g.name)},
    icon: ${q(g.icon)},
    char: ${q(g.char)},
    subgroups: [
${subsText}
    ]
  }`
  }).join(',\n')

  const out = `/**
 * Emojiall 分类图标元数据 —— 由 scripts/gen-emojiall.mjs 生成，不要手改
 *
 * 数据来源：https://www.emojiall.com/zh-hans/categories/{D,E,F,G,H}
 * 生成时间：${new Date().toISOString().slice(0, 10)}
 *
 * ★ 只包含五个大类 ★
 *   动物与自然 / 食物与饮料 / 旅行与地点 / 活动 / 物品
 *   共 ${groups.length} 组、${groups.reduce((n, g) => n + g.subgroups.length, 0)} 个二级分类、${total} 个图标。
 *
 * ★ 图标图片不随包下载 ★
 *   运行时按码点拼：
 *     https://www.emojiall.com/images/{60|120}/apple/<小写码点>.png
 *   60 给选择页缩略图，120 给分类列表 / 流水图标。
 *
 * 每项 icons：[码点, 中文名, emoji 字符]
 */

export const EMOJI_GROUPS = [
${groupsText}
]
`

  writeFileSync(join(ROOT, 'utils', 'emojiData.js'), out, 'utf-8')

  console.log(`\n生成 utils/emojiData.js`)
  console.log(`  ${groups.length} 个大类，${groups.reduce((n, g) => n + g.subgroups.length, 0)} 个二级分类，${total} 个图标`)
  console.log(`  ${(out.length / 1024).toFixed(0)} KB`)
}

main().catch((e) => {
  console.error('生成失败:', e.message)
  process.exit(1)
})
