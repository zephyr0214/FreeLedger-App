/**
 * 账户 SVG 图标生成的测试
 *
 *   node scripts/test-account-icon.mjs
 *
 * 覆盖：
 *   1. sanitizeSvg 能从模型返回的脏文本里提取出可用的 SVG
 *   2. 安全过滤：script / style / 事件属性 / 外部引用都要去掉
 *   3. 补全 xmlns 和 viewBox
 *   4. data URI 编码
 *   5. isSvgIcon 能区分「SVG 图标」和「旧的图标 key」
 */

import { sanitizeSvg, svgToDataUri, isSvgIcon } from '../api/accountIcon.js'

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

console.log('=== 正常 SVG ===')

{
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="none" stroke="#333" stroke-width="4"/></svg>'
  const out = sanitizeSvg(svg)
  check('原样保留', out, svg)
  check('是合法 SVG', /^<svg[\s\S]*<\/svg>$/.test(out), true)
  check('有 xmlns', out.includes('xmlns'), true)
  check('有 viewBox', out.includes('viewBox'), true)
  check('有 stroke', out.includes('stroke'), true)
}

console.log('=== 模型爱加的杂质要清掉 ===')

{
  // markdown 代码块
  const out = sanitizeSvg('```svg\n<svg viewBox="0 0 64 64"><path d="M0 0"/></svg>\n```')
  check('剥掉 markdown 代码块', out.startsWith('<svg'), true)
  check('剥掉后没有反引号', out.includes('`'), false)
}

{
  // 前后有解释文字
  const out = sanitizeSvg('好的，这是图标：\n<svg viewBox="0 0 64 64"><path d="M0 0"/></svg>\n希望你喜欢')
  check('只取 <svg>...</svg> 段', out.startsWith('<svg'), true)
  check('不含解释文字', out.includes('希望你喜欢'), false)
}

{
  // script
  const out = sanitizeSvg('<svg viewBox="0 0 64 64"><script>alert(1)</script><path d="M0 0"/></svg>')
  check('去掉 script', out.includes('<script'), false)
  check('去掉 script 内容', out.includes('alert(1)'), false)
  check('保留正常内容', out.includes('<path'), true)
}

{
  // 事件属性
  const out = sanitizeSvg('<svg viewBox="0 0 64 64" onload="steal()"><path d="M0 0"/></svg>')
  check('去掉 onload', out.includes('onload'), false)
  check('去掉 onload 的内容', out.includes('steal'), false)
}

{
  // 外部引用
  const out = sanitizeSvg('<svg viewBox="0 0 64 64"><use xlink:href="http://evil.com/x#a"/><path d="M0 0"/></svg>')
  check('去掉 xlink:href', out.includes('xlink:href'), false)
  check('去掉外部地址', out.includes('evil.com'), false)
}

{
  // style 块
  const out = sanitizeSvg('<svg viewBox="0 0 64 64"><style>*{fill:red}</style><path d="M0 0"/></svg>')
  check('去掉 style', out.includes('<style'), false)
}

console.log('=== 缺属性的要补上 ===')

{
  // 没有 xmlns
  const out = sanitizeSvg('<svg viewBox="0 0 64 64"><path d="M0 0"/></svg>')
  check('补上 xmlns', out.includes('xmlns="http://www.w3.org/2000/svg"'), true)
}

{
  // 没有 viewBox
  const out = sanitizeSvg('<svg><path d="M0 0"/></svg>')
  check('补上 viewBox', out.includes('viewBox="0 0 64 64"'), true)
}

{
  // 没有 stroke —— 纯填充的图当图标看不出来
  const out = sanitizeSvg('<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="24"/></svg>')
  check('补上描边', /stroke\s*=/i.test(out), true)
}

console.log('=== 不合格的要返回 null ===')

{
  check('空字符串', sanitizeSvg(''), null)
  check('非字符串', sanitizeSvg(null), null)
  check('没有 svg 标签', sanitizeSvg('这是一段文字'), null)
  check('只有开标签', sanitizeSvg('<svg viewBox="0 0 64 64">'), null)
  check('undefined', sanitizeSvg(undefined), null)
}

console.log('=== data URI ===')

{
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M0 0"/></svg>'
  const uri = svgToDataUri(svg)
  check('以 data:image/svg+xml 开头', uri.startsWith('data:image/svg+xml;charset=utf-8,'), true)
  check('不含裸的 < >', uri.includes('<svg'), false)
  check('不含空格', uri.includes(' '), false)
  check('能被 URL 解码回来', decodeURIComponent(uri.split(',')[1]), svg)
  check('空 SVG 返回空串', svgToDataUri(''), '')
}

console.log('=== isSvgIcon ===')

{
  check('SVG data URI', isSvgIcon('data:image/svg+xml;charset=utf-8,%3Csvg%3E'), true)
  check('旧的首字符/图标 key', isSvgIcon('wallet'), false)
  check('空', isSvgIcon(''), false)
  check('null', isSvgIcon(null), false)
  check('普通图片', isSvgIcon('data:image/png;base64,xxx'), false)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
