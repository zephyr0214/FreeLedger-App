/**
 * 账户图标 —— 用大模型画 SVG
 *
 * 用户要求：「添加新的账户时，点击保存的同时，调用大模型，
 * 依据账户名称绘制一个 svg 作为账户的标识，为不是首字符」
 * （= 不是首字母，是真的图形标识）
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 为什么让模型画 SVG ★
 *   之前账户图标是「名称首字符」（招商银行 → 招），
 *   很多账户都是银行/支付，首字符重复得厉害，一眼看不出区别。
 *   让模型根据名称画一个专属图形，辨识度高得多。
 *
 * ★ 为什么不直接存 SVG 字符串 ★
 *   存进数据库的是 **data URI**（base64 或百分号编码的 SVG），
 *   界面上用 <image src="..."> 渲染。
 *   原因：uni-app 的模板**不解析 <svg> 标签**（项目踩过这个坑，
 *   scripts/check-layout.mjs 有规则专门禁止），
 *   所以只能走 <image> + data URI 这条路。
 *
 * ★ 失败怎么办 ★
 *   模型可能超时、返回垃圾、或者用户根本没配 API Key。
 *   这三种情况都**不能挡住保存账户** ——
 *   账户存下来，图标退回到「首字符」样式就行。
 */

import { chat } from './ai.js'

/**
 * 让模型画 SVG 的提示词。
 *
 * ★ 为什么要求这么严 ★
 *   模型很容易「顺手」返回带 <script>、带注释、带 markdown 代码块的 SVG，
 *   或者画一个 512x512 的大图（当图标用太重）。
 *   所以把限制写成硬要求，并在解析时再过滤一遍。
 */
const SVG_PROMPT = `你要为记账 App 画一个账户标识图标。

账户名称：{NAME}
账户类型：{TYPE}

要求：
1. 只输出 SVG 代码本身，不要 markdown 代码块（不要 \`\`\`），不要任何解释文字
2. 必须是 64x64 的 viewBox（如 viewBox="0 0 64 64"）
3. 线条描边风格（stroke），不要用大面积填充；stroke-width 在 3~4 之间
4. 线条用 round 端点，图形简洁，能一眼认出这个账户类型
5. 不要文字、不要字母、不要数字
6. 不要 <script>、不要 <style>、不要注释、不要外部引用（xlink:href / url()）

只输出 SVG，例如：
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="none" stroke="#333" stroke-width="4"/></svg>`

/**
 * 把模型返回的文本清洗成一段可用的 SVG。
 *
 * @param {string} raw 模型返回的原始文本
 * @returns {string|null} 清洗后的 SVG 字符串；不合格返回 null
 */
export function sanitizeSvg(raw) {
  if (typeof raw !== 'string') return null

  let s = raw.trim()

  // 剥掉 markdown 代码块
  s = s.replace(/```(?:svg|xml|html)?\s*/gi, '').replace(/```/g, '').trim()

  // 只要第一段 <svg>...</svg>
  const m = s.match(/<svg\b[\s\S]*?<\/svg>/i)
  if (!m) return null
  s = m[0]

  // 安全过滤：去掉 script / style / 注释 / 外部引用
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')   // onload= 之类
  s = s.replace(/(xlink:href|href)\s*=\s*("[^"]*"|'[^']*')/gi, '')
  s = s.replace(/url\s*\([^)]*\)/gi, 'none')

  // 必须有 xmlns，否则 <image> 加载不了
  if (!/xmlns\s*=\s*("http:\/\/www\.w3\.org\/2000\/svg"|'http:\/\/www\.w3\.org\/2000\/svg')/i.test(s)) {
    s = s.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  }

  // 必须有 viewBox，没有就补一个 64x64
  if (!/viewBox\s*=/i.test(s)) {
    s = s.replace(/<svg\b/i, '<svg viewBox="0 0 64 64"')
  }

  // 必须有描边 —— 全是 fill 的话基本等于没画
  if (!/stroke\s*=/i.test(s)) {
    s = s.replace(/<svg\b/i, '<svg fill="none" stroke="currentColor"')
  }

  if (!/<\/svg>\s*$/i.test(s)) return null
  return s
}

/**
 * SVG 字符串 -> data URI（给 <image src> 用）
 *
 * ★ 用百分号编码而不是 base64 ★
 *   base64 在 App 端要靠 btoa，Unicode 字符会出问题；
 *   encodeURIComponent 对中文也稳。
 *
 * @param {string} svg SVG 字符串
 * @returns {string} data URI
 */
export function svgToDataUri(svg) {
  if (!svg) return ''
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

/**
 * 调用大模型，为账户画一个 SVG 图标。
 *
 * @param {string} name 账户名称
 * @param {string} typeName 账户类型名（如「储蓄卡」）
 * @returns {Promise<string|null>} data URI；失败返回 null
 */
export async function generateAccountIcon(name, typeName) {
  const prompt = SVG_PROMPT
    .replace('{NAME}', String(name || '').slice(0, 30))
    .replace('{TYPE}', String(typeName || '账户'))

  const reply = await chat(
    [
      {
        role: 'system',
        content: '你是一个 SVG 绘图引擎。只输出符合要求的 SVG 代码，不输出任何其他内容。'
      },
      { role: 'user', content: prompt }
    ],
    { maxTokens: 400, temperature: 0.6, timeoutMs: 20000 }
  )

  const svg = sanitizeSvg(reply)
  if (!svg) return null
  return svgToDataUri(svg)
}

/**
 * 判断一个 icon 字段是不是「模型画的 SVG」。
 *
 * 之前账户图标存的是 emoji 或图标 key，
 * 新加的存的是 data URI —— 渲染时要区别对待。
 *
 * @param {string} icon icon 字段的值
 * @returns {boolean}
 */
export function isSvgIcon(icon) {
  return typeof icon === 'string' && icon.startsWith('data:image/svg+xml')
}
