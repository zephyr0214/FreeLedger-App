/**
 * 分类页 / 预算页的交互约定测试
 *
 *   node scripts/test-settings-swipe.mjs
 *
 * ★ 为什么要有这个测试 ★
 *   这几个交互都是「用户反馈里点名要的」，很容易在后续改版时被改回去：
 *     1. 子类别默认不展开（用户说「子类别不要默认展开」）
 *     2. 子类区左边不要竖线（用户说「左边一条竖线真丑陋」）
 *     3. 编辑弹层里要能删除（用户说「编辑里面也不可以删除，这是什么逻辑」）
 *     4. 右滑操作区在弹层关闭后要自动收起（用户说「编辑结束之后是不是应该收起」）
 *     5. 预算页的分类预算行也要右滑出「修改 / 删除」
 *
 *   这里用「真的编译一遍 SFC 模板 + 读 script 源码」来验，
 *   而不是只看某个字符串在不在 —— 前者能抓到
 *   「函数定义了但没在 return 里暴露」这类静默失效。
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { parse, compileTemplate } from '@vue/compiler-sfc'

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

const CATEGORY = 'pages/settings/category.vue'
const BUDGET = 'pages/settings/budget.vue'

function readFile(rel) {
  return readFileSync(join(ROOT, rel), 'utf-8')
}

function readTemplate(rel) {
  const { descriptor } = parse(readFile(rel), { filename: rel })
  return descriptor.template ? descriptor.template.content : ''
}

function readScript(rel) {
  const { descriptor } = parse(readFile(rel), { filename: rel })
  return descriptor.script ? descriptor.script.content : ''
}

function compile(rel) {
  const { descriptor } = parse(readFile(rel), { filename: rel })
  const res = compileTemplate({
    source: descriptor.template.content,
    filename: rel,
    id: rel
  })
  if (res.errors && res.errors.length) {
    throw new Error(`${rel} 编译失败: ${res.errors.map((e) => e.message || e).join('; ')}`)
  }
  return res.code
}

console.log('=== A. 子类别默认不展开 ===')

{
  const script = readScript(CATEGORY)

  // load() 里不能再有「默认展开第一个」的逻辑
  const loadFn = /async function load\(\)\s*\{([\s\S]*?)\n    \}/.exec(script)
  check('找得到 load()', !!loadFn, true)
  if (loadFn) {
    check(
      'load() 里不自动展开任何分类',
      /expandedIds\.value\s*=\s*\[/.test(loadFn[1]),
      false
    )
  }

  // expandedIds 的初值必须是空数组
  check('expandedIds 初值为空数组', /const expandedIds = ref\(\[\]\)/.test(script), true)
  check(
    'expandedIds 不被初始化成含 id 的数组',
    /expandedIds\s*=\s*ref\(\[[^\]]+\]\)/.test(script),
    false
  )
}

console.log('=== B. 子类区不要竖线 ===')

{
  const full = readFile(CATEGORY)

  // .children 里不能再有 border-left
  const childrenCss = /\.children\s*\{([^}]*)\}/.exec(full)
  check('找得到 .children 样式', !!childrenCss, true)
  if (childrenCss) {
    check('.children 没有 border-left', /border-left/.test(childrenCss[1]), false)
    // 层级靠背景色 + 缩进表达
    check('.children 用了 card-2 背景', /var\(--app-card-2\)/.test(childrenCss[1]), true)
  }

  // 整页都不能再有 border-left（竖线就是它）
  check('页面里没有 border-left', /border-left/.test(full), false)
}

console.log('=== C. 编辑弹层里能删除 ===')

{
  const tpl = readTemplate(CATEGORY)
  const script = readScript(CATEGORY)

  // 弹层里有「删除这个分类」入口
  check('弹层里有删除入口', /删除这个分类/.test(tpl), true)
  check('删除入口绑到 onDeleteFromEditor', /@click="onDeleteFromEditor"/.test(tpl), true)

  // 只在编辑已有分类时显示（editingId 非空）
  check('删除入口有 editingId 条件', /v-if="editingId/.test(tpl), true)

  // 固定分类不显示
  check('删除入口排除了固定分类', /isEditingReconcile/.test(tpl), true)
  check('有 isEditingReconcile 的计算', /isEditingReconcile\s*=\s*computed/.test(script), true)

  // onDeleteFromEditor 必须在 return 里（否则模板绑定静默失效）
  check('onDeleteFromEditor 在 return 里', /onDeleteFromEditor/.test(script.split('return {')[1] || ''), true)
}

console.log('=== D. 右滑操作区自动收起 ===')

{
  const script = readScript(CATEGORY)
  const budgetScript = readScript(BUDGET)

  // 分类页：closeSwipe / closeAllSwipes
  check('分类页有 closeSwipe', /function closeSwipe\(/.test(script), true)
  check('分类页有 closeAllSwipes', /function closeAllSwipes\(/.test(script), true)
  check(
    '分类页 closeSwipe 在 return 里',
    /closeAllSwipes/.test(script.split('return {')[1] || ''),
    true
  )

  // 收起用的是 wd-swipe-action 的 'close' 状态
  check('收起时写入的是 close', /swipeStates\[[^\]]+\]\s*=\s*'close'/.test(script), true)

  // 四个时机都要收：
  //   1. 弹层关闭（取消）
  //   2. 保存成功
  //   3. 删除确认后
  //   4. onShow
  check('取消按钮用 closeEditor', /@click="closeEditor"/.test(readTemplate(CATEGORY)), true)
  check('closeEditor 会收起右滑', /function closeEditor\(\)\s*\{[^}]*closeAllSwipes\(\)/s.test(script), true)
  check('onSaveCategory 里有 closeEditor', /function onSaveCategory[\s\S]*?closeEditor\(\)/.test(script), true)
  check('onDelete 里有 closeAllSwipes', /function onDelete[\s\S]*?closeAllSwipes\(\)/.test(script), true)
  check('有 onShow 且会收起右滑', /onShow\(\(\)\s*=>\s*\{[^}]*closeAllSwipes\(\)/s.test(script), true)
  check('switchType 里有 closeAllSwipes', /function switchType[\s\S]*?closeAllSwipes\(\)/.test(script), true)

  // 预算页同样
  check('预算页有 closeSwipe', /function closeSwipe\(/.test(budgetScript), true)
  check('预算页有 closeAllSwipes', /function closeAllSwipes\(/.test(budgetScript), true)
  check('预算页 closeEditor 会收起右滑', /function closeEditor\(\)\s*\{[^}]*closeAllSwipes\(\)/s.test(budgetScript), true)
  check('预算页 onShow 会收起右滑', /onShow\(\(\)\s*=>\s*\{[^}]*closeAllSwipes\(\)/s.test(budgetScript), true)
  check('预算页 removeBudget 里有 closeAllSwipes', /function removeBudget[\s\S]*?closeAllSwipes\(\)/.test(budgetScript), true)
}

console.log('=== E. 预算页：分类预算行右滑出「修改 / 删除」 ===')

{
  const tpl = readTemplate(BUDGET)
  const script = readScript(BUDGET)

  check('用了 wd-swipe-action', /<wd-swipe-action/.test(tpl), true)
  check('右滑区有「修改」', /swipe-action-text">修改</.test(tpl), true)
  check('右滑区有「删除」', /swipe-action-text">删除</.test(tpl), true)
  check('修改绑到 editCategoryBudget', /@click\.stop="editCategoryBudget\(b\)"/.test(tpl), true)
  check('删除绑到 removeBudget', /@click\.stop="removeBudget\(b\)"/.test(tpl), true)
  // 点整行仍然进详情页
  check('点整行仍然进详情页', /@click="goBudgetDetail\(b\)"/.test(tpl), true)

  // 行内的「修改 / 删除」文字按钮要撤掉（换成右滑了）
  check('不再有行内修改按钮', /cat-budget-edit/.test(tpl), false)
  check('不再有行内删除按钮', /cat-budget-del/.test(tpl), false)

  check('预算页有 swipeStates', /const swipeStates = reactive\(\{\}\)/.test(script), true)
  check(
    'swipeStates 在 return 里',
    /swipeStates/.test(script.split('return {')[1] || ''),
    true
  )
}

console.log('=== 模板真的能编译 ===')

{
  /**
   * ★ 为什么要编译一遍 ★
   *   插槽内容（#right 里的东西）在编译后会被内联进组件的 children 对象里，
   *   源码里写了不等于编译后还在 —— 模板写坏了编译期就会报错。
   *   所以这里真的编译一遍，确认：
   *     1. 模板能编译（没写坏）
   *     2. 右滑区的内容确实进了产物（而不是被丢掉了）
   */
  const code1 = compile(CATEGORY)
  check('分类页模板编译产物非空', code1.length > 0, true)
  check('分类页模板里有右滑的「编辑」', /"编辑"/.test(code1), true)
  check('分类页模板里有右滑的「删除」', /"删除"/.test(code1), true)
  check('分类页模板里有 swipe-edit 类', /swipe-edit/.test(code1), true)
  check('分类页模板里有 swipe-delete 类', /swipe-delete/.test(code1), true)
  // 弹层里的删除入口也在产物里
  check('分类页模板里有「删除这个分类」', /"删除这个分类"/.test(code1), true)

  const code2 = compile(BUDGET)
  check('预算页模板编译产物非空', code2.length > 0, true)
  check('预算页模板里有右滑的「修改」', /"修改"/.test(code2), true)
  check('预算页模板里有右滑的「删除」', /"删除"/.test(code2), true)
  check('预算页模板里有 swipe-edit 类', /swipe-edit/.test(code2), true)
  check('预算页模板里有 swipe-delete 类', /swipe-delete/.test(code2), true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
