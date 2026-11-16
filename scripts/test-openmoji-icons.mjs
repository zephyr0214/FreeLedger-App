/**
 * OpenMoji 分类图标 —— 资源完整性 + 迁移映射测试
 *
 *   node scripts/test-openmoji-icons.mjs
 *
 * 守的东西：
 *   1. utils/openmojiData.js 里的每个码点，static/openmoji/ 下都有对应 SVG
 *   2. 旧 icon key（food / car…）都有 OpenMoji 目标，且目标文件存在
 *   3. 默认分类 / 系统固定分类的图标都能解析到真实文件
 *   4. 未知 key / 空 icon 会落到兜底包裹图标
 *   5. v24 迁移存在，SCHEMA_VERSION 与迁移链对得上
 */

import { existsSync, readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  OPENMOJI_ICONS, OPENMOJI_GROUPS,
  categoryIconCode, openmojiSrc, isOpenmojiCode,
  FALLBACK_OPENMOJI_CODE
} from '../utils/openmoji.js'
import { LEGACY_ICON_CODES, toOpenmojiIconCode } from '../utils/openmojiLegacy.js'
import { ICON_MAP } from '../utils/icons.js'
import {
  DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES,
  SYSTEM_PRESET_GROUPS, SYSTEM_PRESET_CHILDREN,
  SCHEMA_VERSION, childIcon
} from '../api/db/schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SVG_DIR = join(ROOT, 'static', 'openmoji')

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

function svgExists(code) {
  return existsSync(join(SVG_DIR, `${code}.svg`))
}

/* ------------------------------------------------ 1. 元数据与资源 */

console.log('=== 元数据与 SVG 资源 ===')

check('图标数量 867（五组）', OPENMOJI_ICONS.length, 867)
check('分组数量 5', OPENMOJI_GROUPS.length, 5)
check('有一个兜底图标', svgExists(FALLBACK_OPENMOJI_CODE), true)

/** 只保留的五组（用户指定） */
const KEPT_GROUPS = ['animals-nature', 'food-drink', 'travel-places', 'activities', 'objects']
const groupsInData = [...new Set(OPENMOJI_ICONS.map((r) => r[2]))]
check('只有保留的五个分组', groupsInData.sort(), [...KEPT_GROUPS].sort())
check(
  '表情 / 人物 / 组件 / 符号 / 旗帜 / 扩展都已剔除',
  OPENMOJI_ICONS.some((r) => !KEPT_GROUPS.includes(r[2])),
  false
)

const hexes = OPENMOJI_ICONS.map((r) => r[0])
check('码点不重复', new Set(hexes).size, hexes.length)

let missing = []
for (const hex of hexes) {
  if (!svgExists(hex)) missing.push(hex)
}
check('每个码点都有 SVG 文件', missing.slice(0, 5), [])
check('缺失数量为 0', missing.length, 0)

/* ------------------------------------------------ 2. 旧 key 映射 */

console.log('=== 旧 icon key 映射 ===')

const iconKeys = Object.keys(ICON_MAP)
const unmapped = iconKeys.filter((k) => !LEGACY_ICON_CODES[k])
check('ICON_MAP 的每个 key 都有 OpenMoji 目标', unmapped, [])

const codeMap = new Map(OPENMOJI_ICONS.map((r) => [r[0], r]))
const badTargets = []
for (const [key, code] of Object.entries(LEGACY_ICON_CODES)) {
  const meta = codeMap.get(code)
  if (!meta) badTargets.push(`${key}->${code}（不在元数据里）`)
  else if (!KEPT_GROUPS.includes(meta[2])) badTargets.push(`${key}->${code}（${meta[2]} 已剔除）`)
}
check('旧 key 的目标都在保留分组里', badTargets, [])
check('toOpenmojiIconCode(food)', toOpenmojiIconCode('food'), LEGACY_ICON_CODES.food)
check('toOpenmojiIconCode(码点原样)', toOpenmojiIconCode('1F35C'), '1F35C')
check('toOpenmojiIconCode(未知值)', toOpenmojiIconCode('WRONG'), '')

/* ------------------------------------------------ 3. 解析函数 */

console.log('=== 分类图标解析 ===')

check('isOpenmojiCode(food) 为 false', isOpenmojiCode('food'), false)
check('isOpenmojiCode(1F35C) 为 true', isOpenmojiCode('1F35C'), true)
check('isOpenmojiCode(已剔除组) 为 false', isOpenmojiCode('1F3CB'), false)
check('categoryIconCode(food)', categoryIconCode('food'), LEGACY_ICON_CODES.food)
check('categoryIconCode(空, 餐饮食品)', categoryIconCode('', '餐饮食品'), LEGACY_ICON_CODES.food)
check('categoryIconCode(未知, 未知)', categoryIconCode('WRONG', '不存在的分类'), FALLBACK_OPENMOJI_CODE)
check('categoryIconCode 结果总是有文件', svgExists(categoryIconCode('WRONG', '不存在的分类')), true)
check('openmojiSrc(1F35C)', openmojiSrc('1F35C'), '/static/openmoji/1F35C.svg')
check('openmojiSrc(未知) 落兜底', openmojiSrc('WRONG'), `/static/openmoji/${FALLBACK_OPENMOJI_CODE}.svg`)

/* ------------------------------------------------ 4. 默认分类 */

console.log('=== 默认分类与系统分类 ===')

const badDefaults = []
for (const list of [DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES]) {
  for (const p of list) {
    if (!svgExists(toOpenmojiIconCode(p.icon) || '')) badDefaults.push(p.name)
    for (const child of p.children) {
      const code = toOpenmojiIconCode(childIcon(child, p.icon))
      if (!code || !svgExists(code)) badDefaults.push(`${p.name}/${child.name || child}`)
    }
  }
}
check('默认分类图标都能落到真实文件', badDefaults, [])

const badPreset = []
for (const type of ['expense', 'income']) {
  const g = SYSTEM_PRESET_GROUPS[type]
  if (!svgExists(toOpenmojiIconCode(g.icon) || '')) badPreset.push(g.name)
}
for (const def of SYSTEM_PRESET_CHILDREN) {
  if (!svgExists(toOpenmojiIconCode(def.icon) || '')) badPreset.push(def.name)
}
check('系统固定分类图标都能落到真实文件', badPreset, [])

/* ------------------------------------------------ 5. 迁移 */

console.log('=== v24 迁移 ===')

const dbSrc = readFileSync(join(ROOT, 'api', 'db', 'index.js'), 'utf-8')
check('SCHEMA_VERSION 是 24', SCHEMA_VERSION, 24)
check('迁移链有 v24', /version:\s*24/.test(dbSrc), true)
check('v24 用 migrateCategoryIcons', /up:\s*migrateCategoryIcons/.test(dbSrc), true)
check('v24 只改 category.icon', /UPDATE category SET icon = \? WHERE id = \?/.test(dbSrc), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
