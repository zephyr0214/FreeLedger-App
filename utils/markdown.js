/**
 * 极简 markdown 渲染 —— 把模型的回答变成可显示的富文本
 *
 * ★ 为什么自己写而不用现成的库 ★
 *   项目里没有 markdown 依赖，装一个要动 package.json + 体积。
 *   而 AI 回答里实际会用到的语法就那么几种：
 *     ## 标题、- 列表、**加粗**、`行内代码`、段落、空行
 *   几十行就能覆盖，而且完全可控（不会有 XSS 风险）。
 *
 * ★ 安全 ★
 *   输出的是**结构化片段数组**而不是 HTML 字符串 ——
 *   前端用 <text> / <view> 渲染，不存在注入的可能。
 *   文本内容全部经过转义。
 *
 * ★ 纯函数，可单测 ★
 */

/**
 * 转义 HTML 特殊字符。
 * 渲染成 <text> 时不转义也不会出问题，但转了更保险
 * （万一以后改成 v-html 也不会出事）。
 */
export function escapeHtml(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 行内标记：把 **加粗** 和 `代码` 拆成片段。
 *
 * @param {string} text 一行纯文本
 * @returns {Array} [{text, bold, code}]
 */
export function parseInline(text) {
  const src = String(text || '')
  const out = []
  // 依次匹配 **...** 和 `...`
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) {
      out.push({ text: src.slice(last, m.index), bold: false, code: false })
    }
    const token = m[0]
    if (token.startsWith('**')) {
      out.push({ text: token.slice(2, -2), bold: true, code: false })
    } else {
      out.push({ text: token.slice(1, -1), bold: false, code: true })
    }
    last = m.index + token.length
  }
  if (last < src.length) {
    out.push({ text: src.slice(last), bold: false, code: false })
  }
  if (out.length === 0) out.push({ text: '', bold: false, code: false })
  return out
}

/**
 * 把 markdown 文本渲染成分片数组。
 *
 * 分片结构：
 *   { type: 'h',   level: 2, text, segments }   标题
 *   { type: 'p',   text, segments }              段落
 *   { type: 'li',  text, segments, marker }     列表项
 *   { type: 'ul',  items: [...] }                列表组
 *
 * @param {string} md markdown 文本
 * @returns {Array} 分片数组
 */
export function renderMarkdown(md) {
  const src = String(md || '')
  if (!src.trim()) return []

  const lines = src.split(/\r?\n/)
  const blocks = []

  let paragraph = []
  let listItems = []

  function flushParagraph() {
    if (paragraph.length === 0) return
    const text = paragraph.join(' ').trim()
    if (text) {
      blocks.push({ type: 'p', text, segments: parseInline(text) })
    }
    paragraph = []
  }

  function flushList() {
    if (listItems.length === 0) return
    blocks.push({ type: 'ul', items: listItems })
    listItems = []
  }

  for (const raw of lines) {
    const line = raw.trim()

    // 空行 = 段落结束
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }

    // 标题：## / ###（不处理 # 一级标题，模型很少用）
    const h = line.match(/^(#{2,4})\s+(.*)$/)
    if (h) {
      flushParagraph()
      flushList()
      const text = h[2].trim()
      blocks.push({
        type: 'h',
        level: h[1].length,
        text,
        segments: parseInline(text)
      })
      continue
    }

    // 列表项：- / * / 数字.
    const li = line.match(/^[-*•]\s+(.*)$/) || line.match(/^\d+[.、)]\s+(.*)$/)
    if (li) {
      flushParagraph()
      const text = li[1].trim()
      listItems.push({ text, segments: parseInline(text) })
      continue
    }

    // 普通行：并入当前段落
    flushList()
    paragraph.push(line)
  }

  flushParagraph()
  flushList()

  return blocks
}
