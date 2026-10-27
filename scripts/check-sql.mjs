/**
 * SQL 方言检查 —— 找出会在这台设备上报错的 SQL
 *
 *   node scripts/check-sql.mjs
 *
 * 背景：
 *   Android 内置 SQLite 与桌面版/MySQL 差异很大。以下写法在某些机型上直接报
 *   "no such function" 或 "no such column"：
 *     - DAY() / MONTH() / YEAR()  → MySQL 函数，SQLite 完全没有
 *     - strftime() 的某些修饰符   → 部分编译裁剪过的内核缺失
 *     - date('now') 的时区行为    → 不可控，改用 JS 计算后传参
 *     - GROUP_CONCAT 的 ORDER BY  → 3.44+ 才支持
 *     - ON CONFLICT DO UPDATE     → 3.24+
 *     - RETURNING                 → 3.35+
 *     - 窗口函数 OVER()            → 3.25+
 *     - JSON 函数                  → 视编译选项而定
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

/** 禁用项：[正则, 说明, 建议] */
const RULES = [
  [/\bDAY\s*\(/gi,        'MySQL 的 DAY() 函数，SQLite 不存在',        "用 CAST(SUBSTR(occurred_day,9,2) AS INTEGER)"],
  [/\bMONTH\s*\(/gi,      'MySQL 的 MONTH() 函数，SQLite 不存在',      '用 SUBSTR(occurred_day,6,2)'],
  [/\bYEAR\s*\(/gi,       'MySQL 的 YEAR() 函数，SQLite 不存在',       '用 SUBSTR(occurred_day,1,4)'],
  [/\bNOW\s*\(\s*\)/gi,   'MySQL 的 NOW() 函数，SQLite 不存在',        '用参数传入 JS 计算好的时间'],
  [/\bCURDATE\s*\(/gi,    'MySQL 的 CURDATE()，SQLite 不存在',         '用参数传入 JS 计算好的日期'],
  [/DATE_FORMAT\s*\(/gi,  'MySQL 的 DATE_FORMAT()，SQLite 不存在',     '用 SUBSTR 或 JS 格式化'],
  [/\bIFNULL\s*\(/gi,     'MySQL 的 IFNULL()，SQLite 用 IFNULL 也可但建议统一 COALESCE', '用 COALESCE'],
  [/ON\s+CONFLICT[^)]*DO\s+UPDATE/gi, 'ON CONFLICT DO UPDATE 需要 SQLite 3.24+', '改为先查存在性再 INSERT/UPDATE'],
  [/\bRETURNING\b/gi,     'RETURNING 需要 SQLite 3.35+',              '改为执行后重新查询'],
  [/\bOVER\s*\(/gi,       '窗口函数需要 SQLite 3.25+',                 '改为子查询或多次聚合'],
  [/date\s*\(\s*['"]now['"]/gi, "date('now') 时区不可控",               '在 JS 里算好日期边界后作为 ? 参数传入'],
  [/GROUP_CONCAT\s*\([^)]*ORDER\s+BY/gi, 'GROUP_CONCAT 的 ORDER BY 需 3.44+', '去掉 ORDER BY，或在 JS 里排序']
]

/** 收集所有 JS 里的 SQL 字符串 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'unpackage', '.git', 'dist'].includes(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (name.endsWith('.js') || name.endsWith('.vue')) out.push(full)
  }
  return out
}

const problems = []
const files = walk(ROOT)

for (const file of files) {
  const code = readFileSync(file, 'utf-8')
  const rel = relative(ROOT, file)

  // 只检查含 SQL 关键字的部分
  const sqlBlocks = extractSqlBlocks(code)
  if (sqlBlocks.length === 0) continue

  for (const block of sqlBlocks) {
    for (const [re, desc, fix] of RULES) {
      // 重置 lastIndex，避免 g 标志的跨调用污染
      re.lastIndex = 0
      const m = re.exec(block.text)
      if (m) {
        problems.push({
          file: rel,
          line: block.line + countLines(block.text.slice(0, m.index)),
          matched: m[0].trim(),
          desc,
          fix
        })
      }
    }
  }
}

/** 从代码中抽取看起来像 SQL 的字符串块（反引号模板或单双引号） */
function extractSqlBlocks(code) {
  const blocks = []
  // 反引号模板字符串
  const templateRe = /`([^`]*)`/g
  let m
  while ((m = templateRe.exec(code)) !== null) {
    const text = m[1]
    // 跳过 SQL 注释行里出现的词（如文档注释里提到 ON CONFLICT）
    const stripped = stripSqlComments(text)
    if (looksLikeSql(stripped)) {
      blocks.push({ text: stripped, line: countLines(code.slice(0, m.index)) + 1 })
    }
  }
  // 普通引号字符串
  const quoteRe = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g
  while ((m = quoteRe.exec(code)) !== null) {
    const text = m[2]
    const stripped = stripSqlComments(text)
    if (looksLikeSql(stripped)) {
      blocks.push({ text: stripped, line: countLines(code.slice(0, m.index)) + 1 })
    }
  }
  return blocks
}

// 去掉 SQL 注释：块注释与 -- 行注释
function stripSqlComments(text) {
  const blockRe = new RegExp('/\\*[\\s\\S]*?\\*/', 'g')
  return text
    .replace(blockRe, '')
    .replace(/--[^\n]*/g, '')
    .replace(/(^|\s)\*[^\n]*/g, '$1')   // 去掉块注释续行的星号内容
}

function looksLikeSql(text) {
  return /\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|CREATE\s+(UNIQUE\s+)?INDEX|ALTER\s+TABLE|PRAGMA)\b/i.test(text)
}

function countLines(str) {
  let n = 0
  for (let i = 0; i < str.length; i++) if (str[i] === '\n') n++
  return n
}

/* ---------------------------------------------------------------- 输出 */

if (problems.length === 0) {
  console.log(`已检查 ${files.length} 个文件中的 SQL 语句`)
  console.log('✅ 未发现 SQL 方言兼容性问题')
  process.exit(0)
}

console.log(`❌ 发现 ${problems.length} 处 SQL 方言问题:\n`)
for (const p of problems) {
  console.log(`  ${p.file}:${p.line}`)
  console.log(`    匹配: ${p.matched}`)
  console.log(`    问题: ${p.desc}`)
  console.log(`    建议: ${p.fix}\n`)
}
process.exit(1)
