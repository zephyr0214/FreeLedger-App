/**
 * 数据库自检 —— 逐项检查环境，把失败点精确定位到某一步
 *
 * 用法（在任意页面调用）：
 *   import { runDbDiagnostics } from '@/api/db/diagnose.js'
 *   const report = await runDbDiagnostics()
 *   console.log(report.text)
 */

import { openDb, query, DB_NAME, DB_PATH } from './index.js'
import { alertDialog } from '@/utils/dialog.js'

/**
 * @returns {Promise<{ok: boolean, steps: Array, text: string}>}
 */
export async function runDbDiagnostics() {
  const steps = []

  const add = (name, ok, detail) => {
    steps.push({ name, ok, detail: detail || '' })
  }

  // 1) 是否 App 端
  const hasPlus = typeof plus !== 'undefined'
  add('运行环境 plus 对象', hasPlus,
    hasPlus ? `已注入，版本 ${safeGet(() => plus.runtime.version) || '未知'}` : '未注入，说明不在 App 运行时')

  // 2) plus.sqlite 是否存在（模块是否勾选）
  const hasSqlite = hasPlus && !!plus.sqlite
  add('SQLite 模块', hasSqlite,
    hasSqlite
      ? '可用'
      : '不可用 → 检查 manifest.json 的 app-plus.modules 是否含 "SQLite"，改完需重新打包或重启基座')

  if (!hasSqlite) {
    return finish(steps)
  }

  // 3) 打开数据库
  let openOk = false
  let openErr = ''
  try {
    await openDb()
    openOk = true
  } catch (e) {
    openErr = e.message
  }
  add('打开数据库', openOk, openOk ? `${DB_PATH}` : openErr)

  if (!openOk) {
    return finish(steps)
  }

  // 4) 简单查询
  let queryOk = false
  let queryErr = ''
  try {
    await query('SELECT 1 AS x')
    queryOk = true
  } catch (e) {
    queryErr = e.message
  }
  add('执行查询', queryOk, queryOk ? '正常' : queryErr)

  // 5) SQLite 版本
  let version = ''
  try {
    const rows = await query('SELECT sqlite_version() AS v')
    version = rows && rows[0] ? String(rows[0].v) : ''
    add('SQLite 版本', true, version || '读取失败')
  } catch (e) {
    add('SQLite 版本', false, e.message)
  }

  // 6) 表是否建好
  let tableOk = false
  let tableDetail = ''
  try {
    const rows = await query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('account','txn','category','tag','budget','setting','account_snapshot','txn_tag','app_meta') ORDER BY name"
    )
    const names = rows.map((r) => r.name)
    tableOk = names.length >= 9
    tableDetail = `已建 ${names.length}/9 张表：${names.join(', ') || '无'}`
  } catch (e) {
    tableDetail = e.message
  }
  add('数据表', tableOk, tableDetail)

  // 7) 读写测试（用 app_meta 做一次临时写入再删掉）
  let rwOk = false
  let rwDetail = ''
  try {
    const key = '__diag__'
    await query('DELETE FROM app_meta WHERE key = ?', [key])
    await query('INSERT INTO app_meta (key, value) VALUES (?, ?)', [key, '"ok"'])
    const rows = await query('SELECT value FROM app_meta WHERE key = ?', [key])
    rwOk = rows.length > 0 && String(rows[0].value).includes('ok')
    await query('DELETE FROM app_meta WHERE key = ?', [key])
    rwDetail = rwOk ? '可读可写' : '写入后读不到'
  } catch (e) {
    rwDetail = e.message
  }
  add('读写测试', rwOk, rwDetail)

  return finish(steps)
}

function finish(steps) {
  const ok = steps.every((s) => s.ok)
  /*
   * ★ 纯文本报告（用于日志 / 复制 / 旧弹窗兜底）★
   *   每一行：✓ 1. 名称
   *               细节（缩进两格，避免长句挤在同一行末尾）
   *   细节单独成行，是因为有的 detail 很长（例如「不可用 → 检查 manifest.json…」），
   *   跟在名称后面会被折行折断，看不出是哪一项的说明。
   */
  const lines = []
  steps.forEach((s, i) => {
    lines.push(`${s.ok ? '✓' : '✗'} ${i + 1}. ${s.name}`)
    if (s.detail) lines.push(`     ${s.detail}`)
  })
  return {
    ok,
    steps,
    text: `数据库自检\n\n${lines.join('\n')}`
  }
}

function safeGet(fn) {
  try {
    return fn()
  } catch (e) {
    return ''
  }
}

/** 供页面直接调用的模态框版本 */
export async function showDbDiagnostics() {
  const report = await runDbDiagnostics()
  /*
   * ★ 用结构化列表渲染，而不是把整段文本塞进 content ★
   *   自检有 7~9 条，其中「SQLite 模块不可用 → 检查 manifest.json…」
   *   这类细节很长。原先全部堆成一段纯文本，折行后完全看不出
   *   哪一行属于哪一项 —— 这就是「排版好丑」的原因。
   *
   *   现在把 steps 直接交给弹窗：每条一个状态勾叉 + 名称，
   *   细节缩进另起一行、字号更小、颜色更淡，
   *   AppDialog 里对应 .chk-row / .chk-name / .chk-detail。
   *   同时仍保留 content（text）作为兜底 —— 万一宿主不支持 list，
   *   退回纯文本也不会什么都没有。
   */
  await alertDialog({
    title: report.ok ? '数据库正常' : '数据库异常',
    content: report.ok ? '' : '以下检查项未通过，可据此排查：',
    list: report.steps
  })
  return report
}
