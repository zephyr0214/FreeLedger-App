/**
 * Emojiall 分类图标 —— 元数据完整性 + 联网地址 + 迁移映射测试
 *
 *   node scripts/test-emoji-icons.mjs
 *
 * 守的东西：
 *   1. 只有五个大类，二级分类和图标数量完整
 *   2. 每个图标都有码点 / 中文名 / emoji 字符
 *   3. 旧 icon key（food / car…）的目标都在五组内
 *   4. 联网图片地址按码点拼接，60 / 120 两种尺寸
 *   5. FE0F / 大小写会被规范化
 *   6. v24 迁移仍在，SCHEMA_VERSION 对得上
 */

import { readFileSync, existsSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  EMOJI_GROUPS, EMOJI_LIST, FALLBACK_EMOJI_CODE,
  categoryIconCode, emojiImageSrc, emojiChar, emojiMeta, isEmojiCode
} from '../utils/emoji.js'
import { LEGACY_ICON_CODES, toEmojiIconCode } from '../utils/emojiLegacy.js'
import { ICON_MAP } from '../utils/icons.js'
import {
  DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES,
  SYSTEM_PRESET_GROUPS, SYSTEM_PRESET_CHILDREN,
  SCHEMA_VERSION, childIcon
} from '../api/db/schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

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

/* ------------------------------------------------ 1. 五组与二级分类 */

console.log('=== 五个大类与二级分类 ===')

const GROUP_NAMES = ['动物与自然', '食物与饮料', '旅行与地点', '活动', '物品']

check('大类数量 5', EMOJI_GROUPS.length, 5)
check('大类名称', EMOJI_GROUPS.map((g) => g.name), GROUP_NAMES)
check('图标总数 836', EMOJI_LIST.length, 836)
check(
  '二级分类数量 49',
  EMOJI_GROUPS.reduce((n, g) => n + g.subgroups.length, 0),
  49
)

const subgroups = EMOJI_GROUPS.flatMap((g) => g.subgroups)
check('二级分类 key 不重复', new Set(subgroups.map((s) => s.key)).size, subgroups.length)
check(
  '每个二级分类都有图标',
  subgroups.some((s) => !Array.isArray(s.icons) || s.icons.length === 0),
  false
)
check(
  '每个大类都有二级分类',
  EMOJI_GROUPS.some((g) => !Array.isArray(g.subgroups) || g.subgroups.length === 0),
  false
)

const hexes = EMOJI_LIST.map((e) => e.hex)
check('码点不重复', new Set(hexes).size, hexes.length)
check(
  '每个图标都有中文名和字符',
  EMOJI_LIST.some((e) => !e.name || !e.char),
  false
)

/* ------------------------------------------------ 2. 旧 key 映射 */

console.log('=== 旧 icon key 映射 ===')

const metaMap = new Map(EMOJI_LIST.map((e) => [e.hex, e]))
const iconKeys = Object.keys(ICON_MAP)
const unmapped = iconKeys.filter((k) => !LEGACY_ICON_CODES[k])
check('ICON_MAP 的每个 key 都有目标', unmapped, [])

const badTargets = []
for (const [key, code] of Object.entries(LEGACY_ICON_CODES)) {
  if (!metaMap.has(code)) badTargets.push(`${key}->${code}`)
}
check('旧 key 的目标都在五组内', badTargets, [])
check('toEmojiIconCode(food)', toEmojiIconCode('food'), LEGACY_ICON_CODES.food)
check('toEmojiIconCode(码点原样)', toEmojiIconCode('1F35C'), '1F35C')
check('toEmojiIconCode(去掉 FE0F)', toEmojiIconCode('26FD-FE0F'), '26FD')
check('toEmojiIconCode(未知值)', toEmojiIconCode('WRONG'), '')

/* ------------------------------------------------ 3. 联网地址 */

console.log('=== 联网图片地址 ===')

check('isEmojiCode(food) 为 false', isEmojiCode('food'), false)
check('isEmojiCode(1F35C) 为 true', isEmojiCode('1F35C'), true)
check('categoryIconCode(food)', categoryIconCode('food'), LEGACY_ICON_CODES.food)
check('categoryIconCode(空, 餐饮食品)', categoryIconCode('', '餐饮食品'), LEGACY_ICON_CODES.food)
check('categoryIconCode(未知, 未知)', categoryIconCode('WRONG', '不存在的分类'), FALLBACK_EMOJI_CODE)
check(
  '120 图片地址',
  emojiImageSrc('1F35C'),
  'https://www.emojiall.com/images/120/apple/1f35c.png'
)
check(
  '60 缩略图地址',
  emojiImageSrc('1F35C', 60),
  'https://www.emojiall.com/images/60/apple/1f35c.png'
)
check(
  '多码点连字符（小写）',
  emojiImageSrc('1F415-200D-1F9BA'),
  'https://www.emojiall.com/images/120/apple/1f415-200d-1f9ba.png'
)
check('FE0F 不出现在地址里', emojiImageSrc('26FD-FE0F'), 'https://www.emojiall.com/images/120/apple/26fd.png')
check('兜底图标字符非空', !!emojiChar(FALLBACK_EMOJI_CODE), true)
check('emojiMeta 能定位二级分类', emojiMeta('1F35C').subgroupName.length > 0, true)

/* ------------------------------------------------ 4. 默认分类 */

console.log('=== 默认分类与系统分类 ===')

const badDefaults = []
for (const list of [DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES]) {
  for (const p of list) {
    if (!metaMap.has(toEmojiIconCode(p.icon))) badDefaults.push(p.name)
    for (const child of p.children) {
      const code = toEmojiIconCode(childIcon(child, p.icon))
      if (!code || !metaMap.has(code)) badDefaults.push(`${p.name}/${child.name || child}`)
    }
  }
}
check('默认分类图标都在五组内', badDefaults, [])

const badPreset = []
for (const type of ['expense', 'income']) {
  const g = SYSTEM_PRESET_GROUPS[type]
  if (!metaMap.has(toEmojiIconCode(g.icon))) badPreset.push(g.name)
}
for (const def of SYSTEM_PRESET_CHILDREN) {
  if (!metaMap.has(toEmojiIconCode(def.icon))) badPreset.push(def.name)
}
check('系统固定分类图标都在五组内', badPreset, [])

/* ------------------------------------------------ 5. 迁移与资源 */

console.log('=== v24 迁移与本地资源 ===')

const dbSrc = readFileSync(join(ROOT, 'api', 'db', 'index.js'), 'utf-8')
check('SCHEMA_VERSION 是 24', SCHEMA_VERSION, 24)
check('迁移链有 v24', /version:\s*24/.test(dbSrc), true)
check('v24 用 migrateCategoryIcons', /up:\s*migrateCategoryIcons/.test(dbSrc), true)
check('v24 只改 category.icon', /UPDATE category SET icon = \? WHERE id = \?/.test(dbSrc), true)
check('不再打包本地图标目录', existsSync(join(ROOT, 'static', 'openmoji')), false)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
