/**
 * 深度检查：用 @vue/compiler-sfc 解析所有 .vue 文件，
 * 并真正 parse 每个 script 的 JS 语法（比 check-syntax 的粗检严格得多）。
 *
 *   node scripts/check-deep.mjs
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

let errors = []
let okCount = 0

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'unpackage', '.git', 'dist'].includes(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (name.endsWith('.vue') || name.endsWith('.js')) out.push(full)
  }
  return out
}

async function main() {
  let sfc, babelParser
  try {
    sfc = await import('@vue/compiler-sfc')
    babelParser = await import('@babel/parser')
  } catch (e) {
    console.log('未安装 @vue/compiler-sfc / @babel/parser，跳过深度检查')
    console.log('安装命令: npm i -D @vue/compiler-sfc @babel/parser')
    process.exit(0)
  }

  const files = walk(ROOT)

  for (const file of files) {
    const code = readFileSync(file, 'utf-8')
    const rel = relative(ROOT, file)

    if (file.endsWith('.vue')) {
      // 1) SFC 结构解析
      const { descriptor, errors: sfcErrors } = sfc.parse(code, { filename: file })
      if (sfcErrors && sfcErrors.length > 0) {
        sfcErrors.forEach((e) => errors.push(`${rel}: SFC 解析错误 — ${e.message}`))
        continue
      }

      // 2) script 语法解析
      const script = descriptor.script || descriptor.scriptSetup
      if (!script) {
        errors.push(`${rel}: 缺少 <script> 块`)
        continue
      }

      const source = script.content
      const offset = script.loc.start.line - 1

      try {
        babelParser.parse(source, {
          sourceType: 'module',
          plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator']
        })
      } catch (e) {
        const line = (e.loc ? e.loc.line : 0) + offset
        errors.push(`${rel}:${line}: JS 语法错误 — ${e.message}`)
        continue
      }

      // 3) 模板编译（能发现指令、表达式错误）
      if (descriptor.template) {
        try {
          const compiled = sfc.compileTemplate({
            source: descriptor.template.content,
            filename: file,
            id: rel
          })
          if (compiled.errors && compiled.errors.length > 0) {
            compiled.errors.forEach((e) => {
              errors.push(`${rel}: 模板错误 — ${e.message || e}`)
            })
            continue
          }
        } catch (e) {
          errors.push(`${rel}: 模板编译异常 — ${e.message}`)
          continue
        }
      }

      okCount++
    } else {
      try {
        babelParser.parse(code, {
          sourceType: 'module',
          plugins: ['optionalChaining', 'nullishCoalescingOperator']
        })
        okCount++
      } catch (e) {
        errors.push(`${rel}:${e.loc ? e.loc.line : 0}: JS 语法错误 — ${e.message}`)
      }
    }
  }

  console.log(`深度检查 ${files.length} 个文件，通过 ${okCount} 个\n`)

  if (errors.length > 0) {
    console.log(`❌ 发现 ${errors.length} 个问题:`)
    errors.forEach((e) => console.log('   ' + e))
    process.exit(1)
  }
  console.log('✅ 全部通过（SFC 结构 + JS 语法 + 模板编译）')
}

main().catch((e) => {
  console.error('检查脚本异常:', e)
  process.exit(1)
})
