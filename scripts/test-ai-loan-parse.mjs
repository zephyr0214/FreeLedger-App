/**
 * AI 借入借出识别的测试
 *
 *   node scripts/test-ai-loan-parse.mjs
 *
 * ★ 用户反馈的真 bug ★
 *   说「还给姐姐200元」，AI 把它判成了**转账**，
 *   而「姐姐」不是账户 -> toAccount 解析不出来 ->
 *   整条记录被丢弃，报「转账缺少目标账户」，用户什么也没记上。
 *
 * ★ 根因 ★
 *   「还给 X」这种句式看着像「A 转给 B」，
 *   但借还的对象是**人**，不是账户 —— 本质是收支，不是转账。
 *
 * ★ 两层修复（这里两层都测）★
 *   1. 提示词：明确列出借还的四种说法、type、category，
 *      并强调「对方不在账户列表里就不是转账」
 *   2. 代码兜底：detectLoanIntent() 从原句判断意图，
 *      命中就把 transfer 纠正成正确的收支方向 + 固定分类。
 *      提示词可能不被遵守，兜底是确定性的。
 */

import { detectLoanIntent, validateItem } from '../api/aiParse.js'
import { SYSTEM_PRESET_GROUP_NAME } from '../api/db/schema.js'

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

/* ------------------------------------------------------------ 测试夹具 */

/** 分类表：系统分类 + 一个普通分类，模拟真实库 */
const CATEGORIES = [
  { id: 'g_exp', parent_id: null, name: SYSTEM_PRESET_GROUP_NAME, type: 'expense' },
  { id: 'g_inc', parent_id: null, name: SYSTEM_PRESET_GROUP_NAME, type: 'income' },
  { id: 'c_lend_out', parent_id: 'g_exp', name: '借出', type: 'expense' },
  { id: 'c_borrow_back', parent_id: 'g_exp', name: '借款归还', type: 'expense' },
  { id: 'c_recon_exp', parent_id: 'g_exp', name: '对账支出', type: 'expense' },
  { id: 'c_borrow_in', parent_id: 'g_inc', name: '借入', type: 'income' },
  { id: 'c_lend_back', parent_id: 'g_inc', name: '借款收回', type: 'income' },
  { id: 'c_recon_inc', parent_id: 'g_inc', name: '对账收入', type: 'income' },
  // 普通分类（干扰项）
  { id: 'p_gift', parent_id: null, name: '人情往来', type: 'expense' },
  { id: 'c_gift', parent_id: 'p_gift', name: '送礼', type: 'expense' },
  { id: 'p_food', parent_id: null, name: '餐饮食品', type: 'expense' },
  { id: 'c_food', parent_id: 'p_food', name: '日常三餐', type: 'expense' },
  { id: 'p_other', parent_id: null, name: '其他支出', type: 'expense' }
]

const ACCOUNTS = [
  { id: 'acc_wx', name: '微信' },
  { id: 'acc_bank', name: '招商银行' }
]

function makeCtx(extra = {}) {
  return {
    categories: CATEGORIES,
    accounts: ACCOUNTS,
    tags: [],
    defaultAccountId: 'acc_wx',
    baseDate: new Date('2026-11-01T12:00:00'),
    hintText: '',
    ...extra
  }
}

/* ------------------------------------------- 1. detectLoanIntent 纯函数 */

console.log('=== 意图识别：还给（支出 / 借款归还）===')

{
  const r = detectLoanIntent('还给姐姐200元')
  check('识别出意图', !!r, true)
  check('是支出', r ? r.type : null, 'expense')
  check('分类是借款归还', r ? r.categoryName : null, '借款归还')
}

check('还同事500 -> 借款归还', detectLoanIntent('还同事500').key, 'borrowBack')
check('归还 -> 借款归还', detectLoanIntent('归还信用卡的借款').key, 'borrowBack')
check('偿还 -> 借款归还', detectLoanIntent('偿还欠款').key, 'borrowBack')

console.log('=== 意图识别：借给（支出 / 借出）===')

{
  const r = detectLoanIntent('借给姐姐200')
  check('是支出', r ? r.type : null, 'expense')
  check('分类是借出', r ? r.categoryName : null, '借出')
}

check('借钱给朋友500 -> 借出', detectLoanIntent('借钱给朋友500').key, 'lendOut')

console.log('=== 意图识别：向…借（收入 / 借入）===')

{
  const r = detectLoanIntent('向姐姐借了200')
  check('是收入', r ? r.type : null, 'income')
  check('分类是借入', r ? r.categoryName : null, '借入')
}

check('跟同事借500 -> 借入', detectLoanIntent('跟同事借500').key, 'borrowIn')
check('找朋友借钱 -> 借入', detectLoanIntent('找朋友借钱').key, 'borrowIn')

console.log('=== 意图识别：还我（收入 / 借款收回）===')

{
  const r = detectLoanIntent('姐姐还我200')
  check('是收入', r ? r.type : null, 'income')
  check('分类是借款收回', r ? r.categoryName : null, '借款收回')
}

check('还给我300 -> 借款收回', detectLoanIntent('还给我300').key, 'lendBack')

console.log('=== ★ 方向不能弄反（最容易错的地方）===')
/*
 * 「还给我」同时含「还给」和「给我」——
 * 如果先判「归还」就会把「姐姐还我200」判成支出，方向正好反了。
 * 规则顺序必须是「收回」在「归还」之前。
 */
check('「姐姐还我200」是收入不是支出', detectLoanIntent('姐姐还我200').type, 'income')
check('「还给姐姐200」是支出不是收入', detectLoanIntent('还给姐姐200').type, 'expense')
check(
  '同一句话里「还我」优先于「还给」',
  detectLoanIntent('他昨天还我200，今天我还给他300').categoryName,
  '借款收回'
)

console.log('=== 普通记账不能被误判 ===')

check('午饭45 没有意图', detectLoanIntent('午饭45'), null)
check('打车28 没有意图', detectLoanIntent('打车28'), null)
check('空串', detectLoanIntent(''), null)
check('null', detectLoanIntent(null), null)
// 「还款」是信用卡还款，走转账，不该被借还规则吃掉
check('信用卡还款不是借款归还', detectLoanIntent('信用卡还款1000'), null)

console.log('=== ★ 「还」字陷阱：这些都不是借还 ★ ===')
/*
 * 「还」这个字极常见，放宽成「还 + 人名」才能认得出口语说法
 * （「还同事500」），但必须挡住下面这些搭配 ——
 * 否则用户随口一句「还有50」就被记成「借款归还」，
 * 比漏记更糟（账上凭空多出一笔支出）。
 *
 *   后接：还价/还是/还有/还要/还款/还能/还在/还得/还好/还行/还没
 *   前置：不还/没还/未还/别还/先还/再还/是否还
 */
const HEI_TRAPS = [
  '还价到200', '还是算了', '还有50', '还要买', '信用卡还款1000',
  '还能再买', '还在路上', '还没付', '还好没买', '还行', '还得再买',
  '不还', '没还', '未还', '别还', '先还', '再还', '是否还给',
  '想还', '还没还', '先还给', '不想还'
]
for (const t of HEI_TRAPS) {
  check(`「${t}」不识别为借还`, detectLoanIntent(t), null)
}

console.log('=== 口语化的借还说法也要认出来 ===')

check('「还同事500」', detectLoanIntent('还同事500').categoryName, '借款归还')
check('「还了300」', detectLoanIntent('还了300').categoryName, '借款归还')
check('「今天还给他300」', detectLoanIntent('今天还给他300').categoryName, '借款归还')
check('「把欠的钱还了」', detectLoanIntent('把欠的钱还了').categoryName, '借款归还')

/* --------------------------- 2. validateItem：模型误判成 transfer 的纠正 */

console.log('=== validateItem：模型判成 transfer 时被纠正 ===')

{
  /*
   * 复现用户的原始场景：
   * 模型输出 type=transfer，account=微信，toAccount=null（姐姐不是账户）
   * 修复前：返回 ok:false, reason:'转账缺少目标账户' —— 整条丢掉。
   */
  const res = validateItem(
    { amount: 200, type: 'transfer', category: null, account: '微信', toAccount: null, note: '还给姐姐' },
    makeCtx({ hintText: '还给姐姐200元' })
  )

  check('不再被丢弃', res.ok, true)
  check('不再是 transfer', res.item ? res.item.type : null, 'expense')
  check('分类挂到「借款归还」', res.item ? res.item.category_id : null, 'c_borrow_back')
  check('分类名是借款归还', res.item ? res.item.category_name : null, '借款归还')
  check('金额 200 元', res.item ? res.item.amount_cents : null, 20000)
  check('不带转入账户', res.item ? res.item.to_account_id : 'x', null)
}

console.log('=== validateItem：借给 / 向…借 / 还我 ===')

{
  const r1 = validateItem(
    { amount: 200, type: 'transfer', account: '微信', note: '借给姐姐' },
    makeCtx({ hintText: '借给姐姐200' })
  )
  check('借给 -> 支出', r1.item ? r1.item.type : null, 'expense')
  check('借给 -> 借出', r1.item ? r1.item.category_id : null, 'c_lend_out')

  const r2 = validateItem(
    { amount: 200, type: 'transfer', account: '微信', note: '向姐姐借的' },
    makeCtx({ hintText: '向姐姐借了200' })
  )
  check('向…借 -> 收入', r2.item ? r2.item.type : null, 'income')
  check('向…借 -> 借入', r2.item ? r2.item.category_id : null, 'c_borrow_in')

  const r3 = validateItem(
    { amount: 200, type: 'transfer', account: '微信', note: '姐姐还我' },
    makeCtx({ hintText: '姐姐还我200' })
  )
  check('还我 -> 收入', r3.item ? r3.item.type : null, 'income')
  check('还我 -> 借款收回', r3.item ? r3.item.category_id : null, 'c_lend_back')
}

console.log('=== 模型分类选错时，也被纠正到固定分类 ===')

{
  /*
   * 模型判对了 type=expense，但分类选了「人情往来/送礼」。
   * 借还意图明确 -> 应该钉到「借款归还」，否则借出借入页面统计不到。
   */
  const res = validateItem(
    { amount: 200, type: 'expense', category: '人情往来/送礼', account: '微信', note: '还给姐姐' },
    makeCtx({ hintText: '还给姐姐200元' })
  )
  check('分类被纠正为借款归还', res.item ? res.item.category_id : null, 'c_borrow_back')
  check('type 仍是支出', res.item ? res.item.type : null, 'expense')
}

console.log('=== 真正的转账不受影响 ===')

{
  /*
   * 「微信转给支付宝200」里两个名字都在账户列表吗？
   * 这里第二个账户叫「招商银行」，所以用这一句测试。
   * 关键是：不含借还关键词，且两边都是账户 -> 仍然是 transfer。
   */
  const res = validateItem(
    { amount: 200, type: 'transfer', account: '微信', toAccount: '招商银行', note: '转给自己另一张卡' },
    makeCtx({ hintText: '从微信转200到招商银行' })
  )
  check('仍是 transfer', res.item ? res.item.type : null, 'transfer')
  check('有两个账户', !!(res.item && res.item.to_account_id), true)
}

console.log('=== 分类不存在时不能塞假 id ===')

{
  /*
   * 老库还没跑迁移 / 用户删掉了「借款归还」。
   * 这时应该：类型纠正正确（支出），但分类留空 ——
   * 交给上层兜底流程挂「其他支出」，而不是塞一个不存在的 id。
   */
  const cats = CATEGORIES.filter((c) => c.name !== '借款归还')
  const res = validateItem(
    { amount: 200, type: 'transfer', account: '微信', note: '还给姐姐' },
    makeCtx({ hintText: '还给姐姐200元', categories: cats })
  )
  check('类型仍然被纠正', res.item ? res.item.type : null, 'expense')
  check('分类留空（不塞假 id）', res.item ? res.item.category_id : 'x', null)
}

/* -------------------------------------------- 3. 提示词里必须写清楚规则 */

console.log('=== 提示词内容（用户要求优化提示词）===')

{
  const { readFileSync } = await import('fs')
  const { join, dirname, resolve } = await import('path')
  const { fileURLToPath } = await import('url')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const code = readFileSync(join(ROOT, 'api', 'aiParse.js'), 'utf-8')

  // 四种借还说法都要在提示词里出现
  check('提示词提到「借出」', code.includes('借给姐姐200'), true)
  check('提示词提到「借款归还」', code.includes('还给姐姐200'), true)
  check('提示词提到「借入」', code.includes('向姐姐借了200'), true)
  check('提示词提到「借款收回」', code.includes('姐姐还我200'), true)

  // 必须明确告诉模型：对方不是账户时不能判转账
  check('有「对方是人不是账户」的说明', /对方是.{0,4}人.{0,10}不是账户|对方不在账户列表/.test(code), true)

  // 必须明确指出「还给」不等于转账
  check('明确说「还给…」不是转账', /还给.{0,6}绝不因为含「给」字就判成转账|还给姐姐200元」是\*\*支出/.test(code), true)

  // 有 type / category 对照表
  check('有 type/category 对照说明', code.includes('| type | category |'), true)

  // 借还的示例输出（让对方是人时用收支格式）
  check('有借还的 JSON 示例', /"category": "借款归还"/.test(code), true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
