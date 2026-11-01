/**
 * 版本号与更新日志的一致性测试
 *
 *   node scripts/test-version.mjs
 *
 * ★ 用户要求 ★
 *   「版本迁移则更新 v1.13 到 v1.15，没有版本迁移则后续每一次 git 都 v1.15.1
 *     这样，内容列出，参考关于页面的段落排版，
 *     关于页面和我的页面底部的版本号同步更新，写进断言。」
 *
 * ★ 这个测试守什么 ★
 *   1. 版本号只有一个来源：utils/version.js 的 APP_VERSION。
 *      「关于」页和「我的」页底部必须都从它渲染 ——
 *      不能再手写 v1.x.x（以前就是两处各写一份，改一处忘一处）。
 *   2. manifest.json 的 versionName / versionCode 必须与它同步，
 *      否则打出来的包版本和界面显示的不是一回事。
 *   3. 更新日志里最新一条的版本号 == APP_VERSION，
 *      schemaVersion == SCHEMA_VERSION ——
 *      防止「加了数据库迁移却忘了写日志」。
 *   4. 更新日志的排版结构符合「关于」页那种段落形式
 *      （sections[].title + sections[].items[]），
 *      且版本按倒序排列。
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  APP_VERSION, APP_VERSION_LABEL, RELEASES, latestRelease,
  toSemver, toVersionCode
} from '../utils/version.js'
import { SCHEMA_VERSION } from '../api/db/schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8')

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

/* ------------------------------------------------------- 1. 版本号格式 */

console.log('=== 版本号格式 ===')

check('APP_VERSION 是三段式（即使是 .0 也写全）', /^\d+\.\d+\.\d+$/.test(APP_VERSION), true)
/*
 * ★ 为什么必须是三段 ★
 *   用户明确要求：「后面没有也要 1.15.0」。
 *   写成 1.15 会让 manifest 的 versionName（1.15.0）
 *   和界面显示的 v1.15 形状不一致，看着像两个版本。
 */
check('当前版本是 1.15.0（这一轮带数据库迁移，次版本号升到 15）', APP_VERSION, '1.15.0')

check('toSemver 兜底补零', toSemver('1.15'), '1.15.0')
check('toSemver 三段原样', toSemver('1.15.1'), '1.15.1')
check('toVersionCode(1.15.0) = 1150', toVersionCode('1.15.0'), 1150)
check('toVersionCode(1.15.1) = 1151', toVersionCode('1.15.1'), 1151)
check('toVersionCode(1.15.2) = 1152', toVersionCode('1.15.2'), 1152)
// 修订号递增时 versionCode 必须递增（安卓覆盖安装的硬要求）
check(
  '修订号递增时 versionCode 也递增',
  toVersionCode('1.15.2') > toVersionCode('1.15.1'),
  true
)

check('展示文案带 v 前缀', APP_VERSION_LABEL, `v${APP_VERSION}`)

/* --------------------------------------------------- 2. 两个页面已同步 */

console.log('=== 「关于」页与「我的」页都从同一处取版本号 ===')

{
  const about = read('pages/settings/about.vue')

  check('关于页引入 APP_VERSION_LABEL', /APP_VERSION_LABEL/.test(about), true)
  check('关于页模板用 {{ APP_VERSION_LABEL }}', /\{\{\s*APP_VERSION_LABEL\s*\}\}/.test(about), true)
  // ★ 关键：不能再手写版本号 ★
  check('关于页不再写死 v1.13.0', /v1\.13\.0/.test(about), false)
  check('关于页不再写死任何 v1.x.x 字面量', />\s*v1\.\d+\.\d+\s*</.test(about), false)
}

{
  const mine = read('pages/mine/index.vue')

  check('我的页引入 APP_VERSION', /import\s*\{\s*APP_VERSION\s*\}/.test(mine), true)
  check('我的页模板用 {{ APP_VERSION }}', /\{\{\s*APP_VERSION\s*\}\}/.test(mine), true)
  check('我的页不再写死 v1.13.0', /v1\.13\.0/.test(mine), false)
}

console.log('=== manifest.json 与 APP_VERSION 同步 ===')

{
  const raw = read('manifest.json')
  // manifest.json 里有注释，去掉再解析
  const clean = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const m = JSON.parse(clean)

  check('versionName 与 toSemver(APP_VERSION) 一致', m.versionName, toSemver(APP_VERSION))
  check('versionCode 与 toVersionCode(APP_VERSION) 一致', m.versionCode, String(toVersionCode(APP_VERSION)))
  check('versionCode 比 1.13.0 的 1130 大（可覆盖安装）', Number(m.versionCode) > 1130, true)
}

/* ---------------------------------------------------- 3. 更新日志本身 */

console.log('=== 更新日志结构与内容 ===')

check('至少有一条更新日志', RELEASES.length >= 2, true)
check('最新一条存在', !!latestRelease(), true)

{
  const latest = latestRelease()

  check('最新一条的版本号 == APP_VERSION', latest.version, APP_VERSION)
  check(
    '最新一条的 schemaVersion == SCHEMA_VERSION（防漏写迁移日志）',
    latest.schemaVersion,
    SCHEMA_VERSION
  )
  check('最新一版有日期', /^\d{4}-\d{2}-\d{2}$/.test(latest.date), true)
  check('最新一版有段落', Array.isArray(latest.sections) && latest.sections.length > 0, true)
}

console.log('=== 每条日志的结构（对齐「关于」页的段落排版）===')

/*
 * 「关于」页的排版是：section-title（段落小标题）+ 若干条目。
 * 更新日志沿用同一套结构：sections[].title + sections[].items[]。
 */
for (const rel of RELEASES) {
  check(`v${rel.version} 的 version 是合法版本号`, /^\d+\.\d+(\.\d+)?$/.test(rel.version), true)
  check(`v${rel.version} 有 date`, /^\d{4}-\d{2}-\d{2}$/.test(rel.date), true)
  check(`v${rel.version} 有 schemaVersion（整数）`, Number.isInteger(rel.schemaVersion), true)
  check(`v${rel.version} 有 sections 数组`, Array.isArray(rel.sections) && rel.sections.length > 0, true)

  for (const sec of rel.sections) {
    check(`v${rel.version} 的段落有 title`, typeof sec.title === 'string' && sec.title.length > 0, true)
    check(`v${rel.version}/${sec.title} 有 items 数组`, Array.isArray(sec.items) && sec.items.length > 0, true)
    // 条目必须是非空字符串，且不能自带换行（换行在 uni-app 里渲染不出来）
    for (const line of sec.items) {
      check(
        `v${rel.version}/${sec.title} 的条目非空且不含换行`,
        typeof line === 'string' && line.trim().length > 0 && !line.includes('\n'),
        true
      )
    }
  }
}

console.log('=== 版本按倒序排列（最新在最前）===')

{
  /** 把 1.15.0 / 1.15.1 转成可比较的数字数组 */
  const keyOf = (v) => toSemver(v).split('.').map(Number)

  let descending = true
  for (let i = 1; i < RELEASES.length; i++) {
    const a = keyOf(RELEASES[i - 1].version)
    const b = keyOf(RELEASES[i].version)
    for (let k = 0; k < 3; k++) {
      if (a[k] > b[k]) break
      if (a[k] < b[k]) { descending = false; break }
    }
    if (!descending) break
  }
  check('版本号倒序', descending, true)
}

console.log('=== 版本历史完整覆盖所有数据库迁移 ===')
/*
 * ★ 为什么查这个 ★
 *   用户要求「之前的大版本全部加上」。
 *   光「有 15 条」不够 —— 得保证**没有漏掉任何一次结构变更**：
 *   每加了一条数据库迁移，就该有一个版本承接它。
 *
 *   做法：把日志里出现过的 schemaVersion 收成一个集合，
 *   再和 1..SCHEMA_VERSION 逐一比对，缺哪个就报哪个。
 *
 * ★ 允许「多条迁移合并到一个版本」★
 *   v14 / v15 / v16 三条迁移都在同一天落地、打包成 1.15.0 一起发，
 *   所以 1.15.0 的 schemaVersion 直接写 16。
 *   判定的是「每个迁移号都被某个版本的 schemaVersion 覆盖到」
 *   （即存在某版本的 schemaVersion >= 该号），而不是要求一一对应。
 */
{
  // 每个版本声明它「到哪一版为止」的 schema；按版本从旧到新累加
  const ascending = [...RELEASES].reverse()
  let covered = 0
  for (const rel of ascending) {
    check(
      `v${rel.version} 的 schemaVersion 不倒退`,
      rel.schemaVersion >= covered || rel.version === '1.0.0',
      true
    )
    covered = Math.max(covered, rel.schemaVersion)
  }
  check('最老的版本从 schema 1 开始', ascending[0].schemaVersion, 1)
  check('最新版本的 schemaVersion 覆盖到 SCHEMA_VERSION', covered, SCHEMA_VERSION)

  // 反向：1..SCHEMA_VERSION 每一号都必须被某个版本覆盖
  for (let n = 1; n <= SCHEMA_VERSION; n++) {
    const coveredBy = RELEASES.find((r) => r.schemaVersion >= n)
    check(`数据库迁移 v${n} 有版本承接`, !!coveredBy, true)
  }
}

console.log('=== 版本号连续，不能有意外缺口 ===')

/*
 * ★ 只允许一个缺口：1.14 ★
 *   用户明确要求「版本迁移则更新 v1.13 到 v1.15」——
 *   1.13 之后直接跳 1.15，1.14 从未发布过。
 *   除此之外任何缺口都说明我漏写了一个版本。
 */
{
  const minors = RELEASES.map((r) => Number(r.version.split('.')[1]))
  const uniqueMinors = [...new Set(minors)].sort((a, b) => a - b)

  const missing = []
  for (let m = uniqueMinors[0]; m <= uniqueMinors[uniqueMinors.length - 1]; m++) {
    if (!uniqueMinors.includes(m)) missing.push(m)
  }
  check('次版本号只有 14 这一个有意缺口', missing, [14])
}

console.log('=== 每个大版本都有实质内容 ===')

for (const rel of RELEASES) {
  const total = rel.sections.reduce((n, s) => n + s.items.length, 0)
  check(`v${rel.version} 至少 1 个段落`, rel.sections.length >= 1, true)
  check(`v${rel.version} 至少 2 条内容（不是占位）`, total >= 2, true)
  // 段落标题必须是这几类之一，避免出现「其他」「备注」这种含糊标题
  const ALLOWED = ['新增', '优化', '修复', '数据迁移', '调整']
  for (const s of rel.sections) {
    check(`v${rel.version} 的段落标题「${s.title}」是规范分类`, ALLOWED.includes(s.title), true)
  }
}

console.log('=== 日志页面能渲染全部版本 ===')

{
  const page = read('pages/settings/changelog.vue')
  // 数据来自常量，模板 v-for 渲染 —— 不用在页面里再维护一份版本清单
  check('日志页直接引用 RELEASES', /const releases = RELEASES/.test(page), true)
  check('日志页没有在内部写死版本号', /version:\s*'1\.\d/.test(page), false)
}

console.log('=== 日志里该出现的本轮内容 ===')

{
  const allText = JSON.stringify(RELEASES)

  // 本轮做的这些事，用户应该能在日志里看到
  const EXPECT_KEYWORDS = [
    '借款归还',       // 借还识别 + 分类改名
    '借出管理',       // 新增页面入口
    '总资产趋势图',   // 趋势口径修正
    '更新日志'        // 这个页面本身
  ]
  for (const kw of EXPECT_KEYWORDS) {
    check(`日志提到「${kw}」`, allText.includes(kw), true)
  }

  /*
   * ★ 旧名字只能出现在「改名说明」里 ★
   *   「借出收回 / 借入归还」这两个旧名在 1.15.0 的修复段落里
   *   是**有意保留**的 —— 那一句就是在说明「旧名改成了新名」，
   *   不写旧名用户反而不知道改的是什么。
   *
   *   所以不能简单断言「整个日志里不含旧名」。
   *   要断言的是：除了那一条改名说明之外，旧名不再作为分类名出现。
   *   做法：把那一条豁免掉，再看剩下的文本里有没有。
   */
  const RENAME_NOTE = '「借出收回 / 借入归还」统一改名为「借款收回 / 借款归还」'
  const allItems = []
  for (const rel of RELEASES) {
    for (const sec of rel.sections) {
      for (const line of sec.items) allItems.push(line)
    }
  }
  const withoutRenameNote = allItems.filter((l) => !l.includes(RENAME_NOTE)).join('\n')

  check('找到了改名说明那一条', allItems.some((l) => l.includes(RENAME_NOTE)), true)
  check('除改名说明外，不再出现「借出收回」', withoutRenameNote.includes('借出收回'), false)
  check('除改名说明外，不再出现「借入归还」', withoutRenameNote.includes('借入归还'), false)

  // 新名字必须出现在日志里（用户能看到改名结果）
  check('日志里有「借款收回」', withoutRenameNote.includes('借款收回'), true)
  check('日志里有「借款归还」', withoutRenameNote.includes('借款归还'), true)
}

/* ------------------------------------------------ 4. 页面与路由已接好 */

console.log('=== 更新日志页面 ===')

{
  const pagePath = join(ROOT, 'pages/settings/changelog.vue')
  let exists = true
  try {
    readFileSync(pagePath)
  } catch (e) {
    exists = false
  }
  check('pages/settings/changelog.vue 存在', exists, true)

  if (exists) {
    const page = readFileSync(pagePath, 'utf-8')
    check('页面引入 RELEASES', /from\s+['"]@\/utils\/version\.js['"]/.test(page), true)
    check('页面用 v-for 渲染版本列表', /v-for="\(?rel/.test(page), true)
    check('页面用 v-for 渲染段落', /v-for="\(?sec/.test(page), true)
    check('页面用 v-for 渲染条目', /v-for="\(?line/.test(page), true)
    check('页面有 PageNav 标题「更新日志」', /title="更新日志"/.test(page), true)
  }

  // 路由已注册
  const pagesJson = read('pages.json')
  check('pages.json 注册了 changelog 路由', /"pages\/settings\/changelog"/.test(pagesJson), true)
}

console.log('=== 「关于与说明」已移入系统设置，右上角改为更新日志 ===')

{
  const mine = read('pages/mine/index.vue')

  // 右上角：更新日志
  check('我的页右上角是「更新日志」', /HeaderAction[^>]*@action-click="goChangelog"[^>]*>更新日志</.test(mine), true)
  check('我的页不再在右上角放「关于与说明」', /@action-click="goAbout"/.test(mine), false)
  check('有 goChangelog 方法', /function goChangelog\(\)/.test(mine), true)
  check('goChangelog 跳 changelog 页', /\/pages\/settings\/changelog/.test(mine), true)

  // 系统设置里出现「关于与说明」
  check('系统设置组里有「关于与说明」', /name:\s*'关于与说明'/.test(mine), true)
  check('「关于与说明」指向 about 页', /'\/pages\/settings\/about'/.test(mine), true)

  /*
   * ★ 它必须落在「系统设置」这一组里，而不是别处 ★
   *   把 menuGroups 里 title === '系统设置' 那段切出来查。
   */
  const sysGroup = /title:\s*'系统设置',[\s\S]*?\]\s*\}/.exec(mine)
  check('找到了「系统设置」分组', !!sysGroup, true)
  if (sysGroup) {
    check('「关于与说明」在系统设置分组内', sysGroup[0].includes('关于与说明'), true)
    check('系统设置里也还有主题外观', sysGroup[0].includes('主题外观'), true)
    check('系统设置里也还有数据与备份', sysGroup[0].includes('数据与备份'), true)
  }
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
