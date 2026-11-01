/**
 * 「修改余额」入口位置的测试
 *
 *   node scripts/test-balance-sheet-entry.mjs
 *
 * ★ 用户要求 ★
 *   「把修改余额的这个弹层功能放置在对应的账户详情页的当前余额价钱的右下角，
 *     同时编辑页面不动」
 *
 * ★ 也就是 ★
 *   · 账户详情页：余额数字右下角有「修改」，点开是余额弹层
 *   · 账户编辑页：不再有改余额的入口（只改账户资料）
 *   · 弹层本体抽成共享组件，两处（现在只有详情页）用同一份逻辑
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

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

console.log('=== 账户详情页：余额右下角有「修改」入口 ===')

{
  const detail = read('pages/account/detail.vue')

  check('详情页引入了 BalanceSheet 组件', /import BalanceSheet from '@\/components\/BalanceSheet\.vue'/.test(detail), true)
  check('详情页注册了 BalanceSheet', /components:\s*\{[^}]*BalanceSheet/.test(detail), true)
  check('详情页模板里用了 <BalanceSheet', /<BalanceSheet\b/.test(detail), true)

  check('详情页有 showBalanceSheet 状态', /showBalanceSheet = ref\(false\)/.test(detail), true)
  check('详情页有 openBalanceSheet', /function openBalanceSheet\(\)/.test(detail), true)
  check('详情页有 onBalanceSaved 回调', /function onBalanceSaved\(\)/.test(detail), true)

  /*
   * ★ 入口必须挂在余额那一行上 ★
   *   用户明确说「放在当前余额价钱的右下角」。
   *   所以「修改」和 MoneyText 必须在同一个 .bal-amount-row 里。
   */
  check('余额行容器是 .bal-amount-row', /class="bal-amount-row"/.test(detail), true)
  check(
    '「修改」在 .bal-amount-row 内',
    /<view class="bal-amount-row">[\s\S]*?bal-edit-link[\s\S]*?<\/view>/.test(detail),
    true
  )
  check(
    '「修改」在余额 MoneyText 之后（右下角的位置感）',
    /<MoneyText[\s\S]*?bal-edit-link/.test(detail),
    true
  )

  // 组合账户没有余额，不该显示这个入口
  check('组合账户不显示「修改」', /v-if="!account\.isCombo"[\s\S]{0,80}bal-edit-link/.test(detail), true)

  // 样式：金额和按钮同排、底部对齐
  check('有 .bal-amount-row 样式', /\.bal-amount-row\s*\{/.test(detail), true)
  check(
    '余额行用 flex + 底部对齐（按钮在右下角）',
    /\.bal-amount-row\s*\{[^}]*display:\s*flex[^}]*align-items:\s*flex-end/.test(detail),
    true
  )
}

console.log('=== 账户编辑页：不再有改余额的入口 ===')

{
  const edit = read('pages/account/edit.vue')

  check('编辑页不再引入 BalanceSheet', /BalanceSheet/.test(edit), false)
  check('编辑页没有 showBalanceSheet', /showBalanceSheet/.test(edit), false)
  check('编辑页没有 openBalanceSheet', /openBalanceSheet/.test(edit), false)
  check('编辑页没有 confirmBalance', /confirmBalance/.test(edit), false)
  check('编辑页没有余额弹层的模板', /class="bs-mask"/.test(edit), false)
  check('编辑页没有余额弹层的样式', /\.bs-mask\s*\{/.test(edit), false)

  /*
   * ★ 新建账户还是要能填初始余额 ★
   *   新建时没有「当前余额」，填的是期初余额（还没有任何交易）。
   *   这条不能被一起删掉。
   */
  check('新建时仍可填初始余额', /初始余额/.test(edit), true)
  check('初始余额仍然写进 form.balanceYuan', /v-model="form\.balanceYuan"/.test(edit), true)
}

console.log('=== 弹层抽成了共享组件 ===')

{
  const sheet = read('components/BalanceSheet.vue')

  check('组件存在且命名正确', /name:\s*'BalanceSheet'/.test(sheet), true)
  check('组件有弹层的两种口径', /计入对账收支/.test(sheet) && /修改当前余额/.test(sheet), true)
  check('组件用 adjustAccountBalance 走对账口径', /adjustAccountBalance/.test(sheet), true)
  check('组件用 setAccountBalanceDirect 走直接改口径', /setAccountBalanceDirect/.test(sheet), true)
  check('组件默认口径是对账', /mode\.value = 'reconcile'/.test(sheet), true)
  check('组件有差额预览', /diffText/.test(sheet), true)

  /*
   * ★ 取消按钮必须有可见的外框 ★
   *   用户反馈「修改余额的取消按钮没有外框，和背景融为一体了」。
   *   原因：底色用的是 --app-card-2，和弹层背景 --app-bg 太接近。
   *   现在改成 --app-card 底 + 一条实色描边。
   */
  check(
    '取消按钮有实色描边',
    /\.bs-btn-cancel\s*\{[^}]*border:\s*2rpx solid var\(--app-line\)/.test(sheet),
    true
  )
  check(
    '取消按钮不再用容易和背景融掉的 --app-card-2',
    /\.bs-btn-cancel\s*\{[^}]*background-color:\s*var\(--app-card-2\)/.test(sheet),
    false
  )

  // 弹层要登记进弹层栈（侧滑返回先收弹层）
  check('组件登记进弹层栈', /pushLayer/.test(sheet), true)
  check('组件在卸载时摘掉登记', /onUnmounted/.test(sheet), true)

  // z-index 要低于库弹层（15），否则 AppDialog 的确认框会被遮住
  check(
    '弹层 z-index <= 9（低于库弹层的 15）',
    /z-index:\s*9/.test(sheet),
    true
  )
}

console.log('=== 两个口径的落库 API 都在 ===')

{
  const api = read('api/account.js')
  check('adjustAccountBalance 存在', /export async function adjustAccountBalance/.test(api), true)
  check('setAccountBalanceDirect 存在', /export async function setAccountBalanceDirect/.test(api), true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
