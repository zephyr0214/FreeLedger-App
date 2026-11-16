/**
 * 生成 OpenMoji 元数据 —— 从上游 data/openmoji.json 生成 utils/openmojiData.js
 *
 *   node scripts/gen-openmoji.mjs <openmoji.json> [cldr-zh-annotations.json]
 *
 * 用法（开发机）：
 *   1. 克隆 OpenMoji（只需 data/ 与 color/svg/）：
 *        git clone --depth 1 --filter=blob:none --sparse https://github.com/hfg-gmuend/openmoji.git
 *        cd openmoji && git sparse-checkout set color/svg data
 *   2. 把 color/svg/*.svg 复制到 static/openmoji/
 *   3. 跑本脚本生成元数据：
 *        node scripts/gen-openmoji.mjs ../openmoji/data/openmoji.json
 *
 * ★ 为什么元数据要生成而不是运行时读 JSON ★
 *   uni-app App 端没有 fetch 本地 JSON 的简单路径（要走 plus.io），
 *   而图标选择器需要同步过滤几百条数据 —— 打包成 ESM 常量最稳。
 *
 * ★ 只保留五个分组（用户指定）★
 *   表情 / 人物 / 组件 / 符号 / 旗帜 / OpenMoji 扩展 / Unicode 扩展
 *   对「记账分类」没有实际用处，全部剔除，控制安装包体积。
 *   保留：动物自然、食物饮料、旅行地点、活动、物品。
 *   剔除分组的 SVG 文件也要从 static/openmoji/ 删掉（见 README）。
 *
 * ★ 中文字段是可选的 ★
 *   第二个参数给 CLDR 的中文 emoji 注释 JSON 时，会顺带把中文名/标签
 *   并进搜索关键词里（OpenMoji 上游只有英文）。找不到中文的图标留空。
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const srcPath = process.argv[2]
if (!srcPath) {
  console.error('用法: node scripts/gen-openmoji.mjs <openmoji.json> [cldr-zh.json]')
  process.exit(1)
}

const raw = JSON.parse(readFileSync(resolve(srcPath), 'utf-8'))
const svgDir = join(ROOT, 'static', 'openmoji')

/** 可选：CLDR 中文注释 */
let zhMap = {}
if (process.argv[3]) {
  try {
    const cldr = JSON.parse(readFileSync(resolve(process.argv[3]), 'utf-8'))
    const ann = cldr.annotations && cldr.annotations.annotations
    if (ann) {
      const hexOf = (s) =>
        [...String(s)].map((c) => c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join('-')
      const norm = (h) => String(h).split('-').filter((x) => x !== 'FE0F').join('-')
      for (const [emoji, info] of Object.entries(ann)) {
        const label = (info.default && info.default[0]) || ''
        const tags = (info.default || []).slice(1).join(' ')
        zhMap[norm(hexOf(emoji))] = { label, tags }
      }
    }
  } catch (e) {
    console.warn('中文注释读取失败，跳过:', e.message)
  }
}

const GROUP_NAMES = {
  'smileys-emotion': '表情',
  'people-body': '人物',
  component: '组件',
  'animals-nature': '动物与自然',
  'food-drink': '食物与饮料',
  'travel-places': '旅行与地点',
  activities: '活动',
  objects: '物品',
  symbols: '符号',
  flags: '旗帜',
  'extras-openmoji': 'OpenMoji 扩展',
  'extras-unicode': 'Unicode 扩展'
}

const groupOrder = []
const rows = []
let skipped = 0

/** 分类图标只用这五组（其余组剔除，见文件头说明） */
const KEPT_GROUPS = new Set([
  'animals-nature', 'food-drink', 'travel-places', 'activities', 'objects'
])

for (const item of raw) {
  // 先按分组过滤：不在白名单里的图标连元数据都不生成
  if (!KEPT_GROUPS.has(item.group)) continue

  const hex = String(item.hexcode || '').toUpperCase()
  if (!hex) continue
  // 只收有真实 SVG 文件的（避免元数据里有、资源里没有）
  if (!existsSync(join(svgDir, `${hex}.svg`))) { skipped++; continue }

  if (!groupOrder.includes(item.group)) groupOrder.push(item.group)

  const norm = hex.split('-').filter((x) => x !== 'FE0F').join('-')
  const zh = zhMap[norm] || { label: '', tags: '' }

  const tags = [
    item.tags || '',
    item.openmoji_tags || '',
    zh.label || '',
    zh.tags || ''
  ].join(' ').replace(/\s+/g, ' ').trim()

  rows.push([
    hex,
    String(item.annotation || '').trim(),
    item.group || '',
    item.subgroups || '',
    tags,
    zh.label || '',
    Number(item.order) || 0
  ])
}

// 保持上游 openmoji.json 的顺序（表情在前，扩展在后）；
// 不按 order 排 —— 扩展（E000…）的 order 都是 0，会把「全部」开头挤满扩展图标。

const groups = groupOrder.map((key) => ({
  key,
  name: GROUP_NAMES[key] || key
}))

const groupsText = groups
  .map((g) => `  { key: ${JSON.stringify(g.key)}, name: ${JSON.stringify(g.name)} }`)
  .join(',\n')

const out = `/**
 * OpenMoji 元数据 —— 由 scripts/gen-openmoji.mjs 生成，不要手改
 *
 * 上游：https://github.com/hfg-gmuend/openmoji
 * 生成时间：${new Date().toISOString().slice(0, 10)}
 *
 * OPENMOJI_ICONS 每项：
 *   [0] hexcode（也是 static/openmoji/<hexcode>.svg 的文件名）
 *   [1] 英文名（OpenMoji annotation）
 *   [2] 分组 key
 *   [3] 子分组 key
 *   [4] 搜索关键词（英文 tags + 中文注释）
 *   [5] 中文名（CLDR，可能为空）
 *   [6] 排序值
 *
 * 图标许可：CC BY-SA 4.0（见 static/openmoji/LICENSE.txt）
 */

export const OPENMOJI_GROUPS = [
${groupsText}
]

export const OPENMOJI_ICONS = [
${rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}
]
`

writeFileSync(join(ROOT, 'utils', 'openmojiData.js'), out, 'utf-8')

console.log(`生成 utils/openmojiData.js`)
console.log(`  图标 ${rows.length} 个，跳过 ${skipped} 个（无 SVG）`)
console.log(`  分组 ${groups.length} 个`)
const size = readFileSync(join(ROOT, 'utils', 'openmojiData.js'), 'utf-8').length
console.log(`  文件大小 ${(size / 1024).toFixed(0)} KB`)
