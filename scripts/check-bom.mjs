/**
 * 检查源码文件不能带 BOM（UTF-8 BOM）
 *
 *   node scripts/check-bom.mjs
 *
 * ★ 为什么必须查（踩过的坑）★
 *   HBuilderX 编译时用严格 JSON.parse 读 package.json：
 *     SyntaxError: Unexpected token '﻿', "﻿{" is not valid JSON
 *   BOM 在编辑器里**完全看不出来**（就是个不可见字符），
 *   但会让构建直接失败，人只会看到「HBuilderX 起不来」，
 *   根本想不到是包了 BOM。
 *
 *   BOM 通常不是手写的，而是某些工具写入时加的 ——
 *   比如 Windows PowerShell 5.1 的 `Set-Content -Encoding UTF8`
 *   会主动加 BOM（PS7 的 utf8 才不带）。
 *   脚本化批量改文件时特别容易中招。
 *
 * ★ 为什么一律不许带（而不是只禁 JSON）★
 *   · JSON / package.json：严格解析直接报错
 *   · JS / .mjs：Node 能容忍，但 `#!/usr/bin/env node` 这类
 *     shebang 场景会失效，而且多文件 diff 容易莫名「整行改动」
 *   · Vue SFC：模板最前面的 `﻿<template>` 会让编译器困惑
 *   既然一个都不能有，就统一拦掉，规则最简单。
 */

import { readdirSync, readFileSync, statSync } from 'fs'
import { join, dirname, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

/** 要检查的根目录（源码 + 配置，不含构建产物与依赖） */
const ROOTS = ['api', 'components', 'pages', 'scripts', 'stores', 'utils', '.']

/** 跳过的目录名 */
const SKIP_DIRS = new Set(['node_modules', 'unpackage', '.git', '.hbuilderx'])

/** 要检查的扩展名 */
const EXT_RE = /\.(js|mjs|cjs|vue|json)$/i

let checked = 0
const bad = []

/** 读前 3 个字节判断是否 BOM */
function hasBom(file) {
  const buf = readFileSync(file)
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
}

function walk(dir, isRoot = false) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch (e) {
    return
  }

  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)

    let st
    try {
      st = statSync(full)
    } catch (e) {
      continue
    }

    if (st.isDirectory()) {
      // 根目录只扫文件，子目录单独由 ROOTS 控制（避免重复）
      if (!isRoot) walk(full)
      continue
    }

    if (!EXT_RE.test(name)) continue

    checked++
    if (hasBom(full)) {
      bad.push(relative(ROOT, full).replace(/\\/g, '/'))
    }
  }
}

/*
 * ★ ROOTS 里同时有子目录和 '.' ★
 *   子目录走完整递归（walk(dir)），
 *   根目录 '.' 只扫它自己这一层的文件（不递归），
 *   否则会把子目录又扫一遍、同一个文件报两次。
 */
for (const r of ROOTS) {
  const full = r === '.' ? ROOT : join(ROOT, r)
  if (r === '.') walk(full, true)
  else walk(full)
}

if (bad.length > 0) {
  console.log(`❌ ${bad.length} 个文件带 UTF-8 BOM（会导致 HBuilderX 构建失败）:\n`)
  for (const f of bad) console.log(`   ${f}`)
  console.log('\n修复方式：去掉文件开头的 EF BB BF 三个字节。')
  console.log('PowerShell 下可用：')
  console.log('  $b = [IO.File]::ReadAllBytes($p); [IO.File]::WriteAllBytes($p, $b[3..($b.Length-1)])')
  console.log('★ 以后写文件优先用 write/edit 工具，或 [IO.File]::WriteAllText($p, $s, (New-Object Text.UTF8Encoding($false)))')
  process.exit(1)
}

console.log(`检查了 ${checked} 个文件的 BOM`)
console.log('✅ 没有文件带 BOM')
