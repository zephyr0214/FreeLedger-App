/**
 * Emojiall 分类图标 —— 元数据完整性 + 联网地址 + 迁移映射测试
 *
 *   node scripts/test-emoji-icons.mjs
 *
 * 守的东西：
 *   1. 六个大类，二级分类和图标数量完整
 *   2. 每个图标都有码点 / 中文名 / emoji 字符
 *   3. 旧 icon key（food / car…）的目标都在六组内
 *   4. 联网图片地址按码点拼接，60 / 120 两种尺寸
 *   5. FE0F / 大小写会被规范化
 *   6. v24 迁移仍在，SCHEMA_VERSION 对得上
 */

import { readFileSync, existsSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  EMOJI_GROUPS, EMOJI_LIST, EMOJI_STYLES, FALLBACK_EMOJI_CODE,
  categoryIconCode, emojiImageSrc, emojiChar, emojiMeta, isEmojiCode,
  normalizeEmojiStyle
} from '../utils/emoji.js'
import { LEGACY_ICON_CODES, toEmojiIconCode } from '../utils/emojiLegacy.js'
import { FLUENT_MAP } from '../utils/fluentEmojiMap.js'
import {
  TXN_ICON_SIZES, TXN_ICON_BG_BOX, TXN_ICON_ROUNDS,
  getTxnIconMetrics, normalizeTxnIconSize, txnIconSizeIndex,
  normalizeTxnIconRound, getTxnIconRadius
} from '../utils/txnIcon.js'
import { noteEmojiLoad, emojiStyleFailed, resetEmojiLoad, emojiStyleHasSuccess } from '../utils/emojiLoad.js'
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

/* ------------------------------------------------ 1. 六组与二级分类 */

console.log('=== 六个大类与二级分类 ===')

const GROUP_NAMES = ['人物与身体', '动物与自然', '食物与饮料', '旅行与地点', '活动', '物品']

check('大类数量 6', EMOJI_GROUPS.length, 6)
check('大类名称', EMOJI_GROUPS.map((g) => g.name), GROUP_NAMES)
check('图标总数 1037', EMOJI_LIST.length, 1037)
check(
  '二级分类数量 54',
  EMOJI_GROUPS.reduce((n, g) => n + g.subgroups.length, 0),
  54
)
check(
  '人物与身体只收指定的五个子类',
  EMOJI_GROUPS.find((g) => g.name === '人物与身体').subgroups.map((s) => s.name),
  ['职业与角色', '奇幻人物', '人物活动', '运动中的人', '人物休息']
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
check('旧 key 的目标都在六组内', badTargets, [])
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
check('五种图标样式', EMOJI_STYLES.map((s) => s.key), ['noto', 'twemoji', 'openmoji', 'fluent', 'fluent3d'])
check(
  '样式中文名',
  EMOJI_STYLES.map((s) => s.name),
  ['安卓原生风格图标', 'Twitter风格图标', '开源彩色风格图标', '微软扁平风格图标', '微软 3D 风格图标']
)
check(
  '英文名唯一作为备注',
  EMOJI_STYLES.map((s) => s.desc),
  ['Noto Color Emoji', 'Twemoji', 'OpenMoji', 'Microsoft Fluent', 'Microsoft Fluent 3D']
)
check('非法样式退回 noto', normalizeEmojiStyle('bad'), 'noto')
check('旧 system 样式退回 noto', normalizeEmojiStyle('system'), 'noto')
check(
  'Noto 120 地址',
  emojiImageSrc('1F35C'),
  'https://fonts.gstatic.com/s/e/notoemoji/latest/1f35c/128.png'
)
check(
  'Noto 60 缩略图地址',
  emojiImageSrc('1F35C', 60),
  'https://fonts.gstatic.com/s/e/notoemoji/latest/1f35c/72.png'
)
check(
  'Noto 多码点用下划线',
  emojiImageSrc('1F415-200D-1F9BA'),
  'https://fonts.gstatic.com/s/e/notoemoji/latest/1f415_200d_1f9ba/128.png'
)
check(
  'Twemoji 地址',
  emojiImageSrc('1F415-200D-1F9BA', 60, 'twemoji'),
  'https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/1f415-200d-1f9ba.svg'
)
check(
  'OpenMoji 用 SVG（矢量、约 2KB，不请求 618 PNG）',
  emojiImageSrc('1F35C', 120, 'openmoji'),
  'https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@17.0.0/color/svg/1F35C.svg'
)
check(
  'OpenMoji 小尺寸也用同一个 SVG',
  emojiImageSrc('1F35C', 60, 'openmoji'),
  'https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@17.0.0/color/svg/1F35C.svg'
)
check(
  '不再请求 OpenMoji black 线稿',
  /black\/(72x72|618x618)/.test(readFileSync(join(ROOT, 'utils', 'emoji.js'), 'utf-8')),
  false
)
check(
  'Fluent 用 Flat SVG',
  emojiImageSrc('1F35C', 120, 'fluent'),
  'https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@1ffb34c752ecf5d402f04cfb4b392c77f57c54bc/assets/Steaming%20bowl/Flat/steaming_bowl_flat.svg'
)
check(
  'Fluent 全部图标都有 Flat SVG',
  emojiImageSrc('1F415-200D-1F9BA', 60, 'fluent').includes('Service%20dog'),
  true
)
check('Fluent 映射覆盖 1037 个图标', Object.keys(FLUENT_MAP).length, 1037)
check('Fluent 映射全部是 SVG', Object.values(FLUENT_MAP).every((p) => p.endsWith('.svg')), true)
check(
  'Twemoji 人物组合自动补 FE0F',
  emojiImageSrc('1F9D1-200D-2695', 60, 'twemoji'),
  'https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/1f9d1-200d-2695-fe0f.svg'
)
check(
  'OpenMoji 人物组合自动补 FE0F',
  emojiImageSrc('1F9D1-200D-2695', 120, 'openmoji'),
  'https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@17.0.0/color/svg/1F9D1-200D-2695-FE0F.svg'
)
check(
  'Fluent 3D 用 256 PNG',
  emojiImageSrc('1F35C', 120, 'fluent3d'),
  'https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@1ffb34c752ecf5d402f04cfb4b392c77f57c54bc/assets/Steaming%20bowl/3D/steaming_bowl_3d.png'
)
check(
  '旧 system 设置会加载 Noto 图片',
  emojiImageSrc('1F35C', 120, 'system'),
  'https://fonts.gstatic.com/s/e/notoemoji/latest/1f35c/128.png'
)
check('FE0F 不出现在地址里', emojiImageSrc('26FD-FE0F'), 'https://fonts.gstatic.com/s/e/notoemoji/latest/26fd/128.png')
check('兜底图标字符非空', !!emojiChar(FALLBACK_EMOJI_CODE), true)
check('emojiMeta 能定位二级分类', emojiMeta('1F35C').subgroupName.length > 0, true)

/* ------------------------------------------------ 4. 流水图标尺寸 / tabBar */

console.log('=== 流水图标尺寸与 tabBar 资源 ===')

check('五档尺寸名称', TXN_ICON_SIZES.map((s) => s.name), ['极小', '小', '中', '大', '极大'])
check('默认尺寸是「中」', normalizeTxnIconSize('bad'), 'm')
check('中档 60/64', getTxnIconMetrics('m').icon, 60)
check('中档外框 64', getTxnIconMetrics('m').box, 64)
check('极小档序号 0', txnIconSizeIndex('xs'), 0)
check('极大档序号 4', txnIconSizeIndex('xl'), 4)
check(
  '背景方块固定尺寸能包住最大图标',
  TXN_ICON_BG_BOX >= TXN_ICON_SIZES[4].icon,
  true
)
check('背景方块 84rpx', TXN_ICON_BG_BOX, 84)

check('五档背景形状', TXN_ICON_ROUNDS.map((r) => r.name), ['方形', '微圆', '圆角', '大圆', '圆形'])
check('默认形状是大圆', normalizeTxnIconRound('bad'), 3)

{
  const settingsApi = readFileSync(join(ROOT, 'api', 'settings.js'), 'utf-8')
  const settingStore = readFileSync(join(ROOT, 'stores', 'setting.js'), 'utf-8')
  check('新用户默认深浅跟随系统', /themeMode: 'system'/.test(settingsApi), true)
  check('新用户默认主题色账本蓝', /themePreset: 'blue'/.test(settingsApi), true)
  check('新用户默认微软扁平图标', /emojiStyle: 'fluent'/.test(settingsApi), true)
  check('新用户默认图标大小中', /txnIconSize: 'm'/.test(settingsApi), true)
  check('新用户默认开启分类背景色', /txnIconShowBg: true/.test(settingsApi), true)
  check('新用户默认背景形状大圆', /txnIconBgRound: 3/.test(settingsApi), true)
  check('store 初始值与默认设置一致', /themePreset: 'blue'/.test(settingStore) && /emojiStyle: 'fluent'/.test(settingStore), true)
}
check('方形圆角 0', getTxnIconRadius(0), '0rpx')
check('圆形圆角 50%', getTxnIconRadius(4), '50%')

/* 图标库整体加载状态：连续 6 次失败且 0 成功才回退系统 emoji */
resetEmojiLoad('noto')
check('初始样式可用', emojiStyleFailed('noto'), false)
check('初始没有成功记录', emojiStyleHasSuccess('noto'), false)
for (let i = 0; i < 5; i++) noteEmojiLoad('noto', false)
check('五次失败仍不整体回退', emojiStyleFailed('noto'), false)
check('失败不会伪装成成功', emojiStyleHasSuccess('noto'), false)
noteEmojiLoad('noto', false)
check('六次失败且零成功 → 整体回退', emojiStyleFailed('noto'), true)
noteEmojiLoad('noto', true)
check('任意一张成功后恢复正常', emojiStyleFailed('noto'), false)
check('任意一张成功后记为有成功', emojiStyleHasSuccess('noto'), true)
resetEmojiLoad('noto')
for (const preset of ['teal', 'pink']) {
  for (const name of ['home', 'account', 'stats', 'mine']) {
    check(
      `tabBar ${name} ${preset} 选中图标存在`,
      existsSync(join(ROOT, 'static', 'tabbar', `${name}-active-${preset}-v2.png`)),
      true
    )
  }
}

/* ------------------------------------------------ 5. 默认分类 */

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
check('默认分类图标都在六组内', badDefaults, [])

const badPreset = []
for (const type of ['expense', 'income']) {
  const g = SYSTEM_PRESET_GROUPS[type]
  if (!metaMap.has(toEmojiIconCode(g.icon))) badPreset.push(g.name)
}
for (const def of SYSTEM_PRESET_CHILDREN) {
  if (!metaMap.has(toEmojiIconCode(def.icon))) badPreset.push(def.name)
}
check('系统固定分类图标都在六组内', badPreset, [])

/* ------------------------------------------------ 5. 迁移与资源 */

console.log('=== v24 迁移与本地资源 ===')

const dbSrc = readFileSync(join(ROOT, 'api', 'db', 'index.js'), 'utf-8')
check('SCHEMA_VERSION 是 25', SCHEMA_VERSION, 25)
check('迁移链有 v24', /version:\s*24/.test(dbSrc), true)
check('v24 用 migrateCategoryIcons', /up:\s*migrateCategoryIcons/.test(dbSrc), true)
check('迁移链有 v25', /version:\s*25/.test(dbSrc), true)
check('v25 用 migrateCycleExtraRules', /up:\s*migrateCycleExtraRules/.test(dbSrc), true)
check('v24 只改 category.icon', /UPDATE category SET icon = \? WHERE id = \?/.test(dbSrc), true)
check('不再打包本地图标目录', existsSync(join(ROOT, 'static', 'openmoji')), false)

/* ------------------------------------------------ 6. 图标加载与暗色配置 */

console.log('=== 图标加载：防串图 / OpenMoji SVG / 选择页无灰块 ===')

const glyph = readFileSync(join(ROOT, 'components', 'CategoryGlyph.vue'), 'utf-8')
const catPage = readFileSync(join(ROOT, 'pages', 'settings', 'category.vue'), 'utf-8')
const catEditor = readFileSync(join(ROOT, 'components', 'CategoryEditorSheet.vue'), 'utf-8')
const iconPage = readFileSync(join(ROOT, 'pages', 'settings', 'category-icon.vue'), 'utf-8')

check('图标节点按 src 重建（防止旧图串到新分类）', /:key="src"/.test(glyph), true)
check('不再有 OpenMoji 灰色描边双图层', /emojiOutlineSrc|cat-glyph-outline/.test(glyph), false)
check('不再用 invert 滤镜处理第二张图', /filter:\s*invert\(0\.5\)/.test(glyph), false)
check('全 App 默认不在加载中显示系统 emoji', /loadingFallback:\s*\{[^}]*default:\s*false/.test(glyph), true)
check('部分失败且无一张成功时延迟回退系统样式', /FALLBACK_DELAY_MS/.test(glyph) && /emojiStyleHasSuccess/.test(glyph), true)
check('系统 emoji 最大 44rpx（极小档）', /FALLBACK_EMOJI_RPX\s*=\s*44/.test(glyph), true)
check('分类管理图标加载中不用系统 emoji 占位', /:loading-fallback="false"/.test(catPage), true)
check('分类管理小图标请求 60 档', /:remote-size="60"/.test(catPage), true)
check('选择页暗色图标格去掉灰底', /icon-cell--bare/.test(iconPage), true)
check('选择页暗色灰底样式是 transparent', /\.icon-cell--bare\s*\{[^}]*background-color:\s*transparent/.test(iconPage), true)

const txnIcon = readFileSync(join(ROOT, 'components', 'TxnIcon.vue'), 'utf-8')
check('流水图标断网时强制圆角背景 + 极小档', /getTxnIconMetrics\('xs'\)/.test(txnIcon), true)
check('流水图标断网时背景仍保持 84rpx', /\{ icon: offlineIcon, box: TXN_ICON_BG_BOX \}/.test(txnIcon), true)
check('流水图标断网时强制打开背景', /offline\.value \|\| settingStore\.txnIconShowBg/.test(txnIcon), true)
check('流水图标断网时用 18rpx 圆角', /'18rpx'/.test(txnIcon), true)

/* ------------------------------------------------ 7. 本地图标缓存 */

console.log('=== 图标本地缓存：只用到的图标 / 五种样式同步 ===')

const cacheUtil = readFileSync(join(ROOT, 'utils', 'iconCache.js'), 'utf-8')
const cacheApi = readFileSync(join(ROOT, 'api', 'iconCache.js'), 'utf-8')
const appSrc = readFileSync(join(ROOT, 'App.vue'), 'utf-8')
const themeSrc = readFileSync(join(ROOT, 'pages', 'settings', 'theme.vue'), 'utf-8')

check('存在本地缓存工具', existsSync(join(ROOT, 'utils', 'iconCache.js')), true)
check('CategoryGlyph 优先用本地缓存', /cachedIconPath/.test(glyph) && /cachedSrc\.value \|\| remoteSrc\.value/.test(glyph), true)
check('本地缓存坏掉会失效并回远程', /invalidateIcon\(code\.value/.test(glyph), true)
check('主题页预览读本地缓存', /cachedIconPath\('1F35C'/.test(themeSrc), true)
check('启动后后台预热', /warmCategoryIconCache/.test(appSrc), true)
check('缓存只收集分类 + 主题预览，不扫全图库', /listCategories\(null, true\)/.test(cacheApi) && /THEME_PREVIEW_CODE/.test(cacheApi) && !/EMOJI_LIST/.test(cacheApi), true)
check('主题预览缓存五个示例图标', /\['1F35C', '1F96D', '1F68D', '1F381', '1F4B0'\]/.test(cacheApi), true)
check(
  '详情页固定图标也缓存（标签/借入/借出/报销）',
  /DETAIL_PAGE_CODES = \['1F3F7', '1F4E4', '1F4E5', '1F9FE'\]/.test(cacheApi),
  true
)
check('分类保存后同步新图标缓存', /syncCategoryIconCache\(form\.icon/.test(catEditor), true)
check('分类删除后清理旧缓存', /refreshCategoryIconCache\(\)/.test(catPage), true)
check('缓存覆盖全部五种样式', /EMOJI_STYLES\.map\(\(s\) => cacheIcon/.test(cacheUtil), true)
check('清理时会删掉已移除样式的缓存', /validStyles\.has\(style\)/.test(cacheUtil), true)
check('FxEmoji 映射文件已删除', existsSync(join(ROOT, 'utils', 'fxEmojiMap.js')), false)
check(
  '缓存文件名带样式和 URL hash（避免 Twemoji/OpenMoji 覆盖）',
  /function cacheFileName\(style, code, url\)/.test(cacheUtil) &&
    /style}-\$\{code\}-\$\{hash/.test(cacheUtil),
  true
)
check('缓存不再用 uni.saveFile 自动命名', /uni\.saveFile\(/.test(cacheUtil), false)
check('图标选择页首批 40 个', /const BATCH = 40/.test(iconPage), true)
check('流水/面板小图标请求 60 档', /:remote-size="60"/.test(txnIcon), true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
