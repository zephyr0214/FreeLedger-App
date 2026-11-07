/**
 * 账户页「设为默认账户」= 长按 -> 居中确认框（不再是右滑）
 *
 *   node scripts/test-account-default-longpress.mjs
 *
 * ★ 背景（用户需求）★
 *   用户原话：「修改账户页设置为默认账户的逻辑，不要右滑设置了，
 *   删除右滑设置及其相关代码，改成长按弹窗设置。」
 *   随后又补充：「我指的是你给我弄成中间的弹窗，询问确定要设置为默认账户吗？
 *   取消 确定两个按钮」—— 所以弹层是**居中确认框**，不是底部操作表。
 *
 *   改之前：每行外面包一层 wd-swipe-action，右滑露出「设为默认 / 已默认」色块。
 *   改之后：长按账户行 -> 居中确认框「设为默认账户？」+ 取消 / 确定。
 *
 * ★ 这个测试锁住什么 ★
 *   1. 右滑那一套代码是真的删干净了（不是留着不用）
 *   2. 长按 -> confirmDialog 的链路完整
 *   3. 长按之后不能误进详情页（平台会补发一次 tap）
 *   4. 确认框走全局那一个（AppDialog / 1000 层级），不自己再搭弹层
 *
 * 只做源码层断言：项目没有真机/浏览器运行环境，
 * 而这几条的关键都是「代码在不在、绑没绑上」，源码断言足够挡住回归。
 */

import fs from 'fs'
import path from 'path'

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

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** 去掉注释：注释里会写「右滑」「wd-swipe-action」这类词，断言前必须剥掉 */
const stripComments = (s) =>
  s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const page = read('pages/account/index.vue')
const tpl = stripComments((page.match(/<template>([\s\S]*)<\/template>/) || [])[1] || '')
const script = stripComments((page.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '')
const style = stripComments((page.match(/<style[^>]*>([\s\S]*)<\/style>/) || [])[1] || '')

/*
 * 账户列表那一段模板。
 *
 * ★ 为什么断言要限定在这一段里 ★
 *   页面顶部 AppHeader 自己就有一个 <template #right>（右上角「+ 添加账户」按钮），
 *   整页正则去找 #right 会把它当成「右滑操作区还在」，永远误报。
 *   从 .acc-list 开始、到它闭合为止才是这次改造的范围。
 */
const accListStart = tpl.indexOf('class="acc-list"')
const accListEnd = accListStart < 0 ? -1 : tpl.indexOf('</scroll-view>', accListStart)
const accList = accListStart < 0 || accListEnd < 0 ? '' : tpl.slice(accListStart, accListEnd)

/* ------------------------------------------- 1. 右滑那一套必须删干净 */

console.log('=== 1. 右滑设置的相关代码已删除 ===')

check('模板里没有 wd-swipe-action', /wd-swipe-action/.test(tpl), false)
check('模板里没有 #right 操作区', /<template\s+#right/.test(accList), false)
check('模板里没有「已默认」色块文案', /已默认/.test(tpl), false)
check('script 里没有 swipeStates', /swipeStates/.test(script), false)
check('script 里没有 onSwipeClick', /onSwipeClick/.test(script), false)
check('样式里没有 .acc-swipe', /\.acc-swipe\b/.test(style), false)
check('样式里没有 .swipe-default', /\.swipe-default\b/.test(style), false)

// 行分隔线原来挂在 swipe 包裹层上，包裹层没了要挪到行上，否则列表会挤成一片
check(
  '行分隔线挪到了 .acc-item 上',
  /\.acc-item\s*\{[^}]*border-bottom:\s*1rpx solid var\(--app-line\)/.test(style),
  true
)
check('.acc-item 自带 bg（不再依赖外层容器）', /\.acc-item\s*\{[^}]*background-color:\s*var\(--app-card\)/.test(style), true)

/* --------------------------------------------- 2. 长按 -> 确认框链路 */

console.log('\n=== 2. 长按打开居中确认框 ===')

check(
  '账户行绑定了 @longpress',
  /<view[\s\S]{0,200}class="acc-item"[\s\S]{0,200}@longpress="onAccountLongPress\(acc\)"/.test(tpl),
  true
)
check('账户行点击走 onAccountTap（不再直连 goDetail）', /@click="onAccountTap\(acc\)"/.test(tpl), true)

// ★ 不许自己再搭一个弹层：确认框统一走 utils/dialog.js 的 confirmDialog
check('页面没有自建 wd-action-sheet', /<wd-action-sheet/.test(tpl), false)
check('页面没有自建 wd-popup 当确认框', /<wd-popup/.test(tpl), false)
check('引了全局 confirmDialog', /import\s*\{\s*confirmDialog\s*\}\s*from\s*'@\/utils\/dialog\.js'/.test(script), true)
check(
  '长按里确实弹了确认框',
  /async function onAccountLongPress\(acc\)\s*\{[\s\S]*?await confirmDialog\(\{/.test(script),
  true
)
check('确认框标题明确问「设为默认账户」', /title:\s*'设为默认账户？'/.test(script), true)
check('确认框内容带上账户名，让用户确认没长按错行', /content:\s*`[^`]*\$\{acc\.name\}/.test(script), true)
check('确认框有「确定」按钮', /confirmText:\s*'确定'/.test(script), true)
check('确认框有「取消」按钮', /cancelText:\s*'取消'/.test(script), true)
check(
  '取消时直接返回，不写库',
  /const ok = await confirmDialog\(\{[\s\S]*?\}\)\s*\n\s*if\s*\(!ok\)\s*return/.test(script),
  true
)
check('确定后调 setDefault', /if\s*\(!ok\)\s*return\s*\n\s*await setDefault\(acc\)/.test(script), true)

check('长按组合账户直接提示，不弹确认框', /组合账户不能设为默认/.test(script), true)
check(
  '已经是默认账户时直接提示，不弹确认框',
  /acc\.id === defaultAccountId\.value[\s\S]{0,80}已经是默认账户了/.test(script),
  true
)

/* --------------------------------- 3. 长按后不能误触发「进详情页」 */

console.log('\n=== 3. 长按之后的补发 tap 被挡掉 ===')

check('有长按后的点击遮蔽时间窗', /tapAfterLongPressUntil/.test(script), true)
check(
  'onAccountTap 在时间窗内直接 return',
  /function onAccountTap\(acc\)\s*\{[\s\S]{0,120}Date\.now\(\)\s*<\s*tapAfterLongPressUntil[\s\S]{0,40}return/.test(
    script
  ),
  true
)
check('长按时写入时间窗', /tapAfterLongPressUntil\s*=\s*Date\.now\(\)\s*\+/.test(script), true)

/* ------------------------------- 4. 不重复造弹层（层级/返回键交给 AppDialog） */

console.log('\n=== 4. 确认框复用全局弹窗设施 ===')

check('页面挂了 <AppDialog /> 宿主', /<AppDialog\s*\/>/.test(tpl), true)
// 自建弹层才需要手写 z-index / 弹层栈；走 confirmDialog 就都不需要了
check('没有为此手写 z-index', /:z-index=/.test(tpl), false)
check('没有为此重复登记弹层栈', /pushLayer\(/.test(script), false)
check('没有为此加 onBackPress（AppDialog 自己处理）', /onBackPress/.test(script), false)

/* ---------------------------------------- 5. 功能本体（口径没被改写） */

console.log('\n=== 5. 设为默认的逻辑仍然完整 ===')

check(
  'setDefault 仍然写 settingStore.update({ defaultAccountId })',
  /await settingStore\.update\(\{\s*defaultAccountId:\s*acc\.id\s*\}\)/.test(script),
  true
)
check('已经是默认账户时给提示，不重复写库', /已经是默认账户了/.test(script), true)
check('设置成功后 toast 带上账户名', /已设为默认：\$\{acc\.name\}/.test(script), true)
check('setDefault 里组合账户仍然被拦住', /if\s*\(acc\.isCombo\)/.test(script), true)
check('长按有轻震动反馈', /uni\.vibrateShort\(\{\s*type:\s*'medium'\s*\}\)/.test(script), true)

/* ----------------------------------------------------- 6. 样式 / 文案 */

console.log('\n=== 6. 样式与说明文案 ===')

// 深浅色统一：不许硬编码颜色（原来右滑色块里的 #ffffff 已随代码删除）
check('样式里没有硬编码 #ffffff 之类的颜色', /#[0-9a-fA-F]{3,8}\b/.test(style), false)

const about = read('pages/settings/about.vue')
check('关于页说明改成「长按」', /长按账户可设为默认/.test(about), true)
check('关于页不再说「右滑设为默认」', /右滑设为默认/.test(about), false)

/* -------------------------------------------------------------- 输出 */

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
