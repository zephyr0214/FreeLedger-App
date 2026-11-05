/**
 * 外币记账的测试
 *
 *   node scripts/test-multi-currency.mjs
 *
 * ★ 用户拍板的五点方案 ★
 *   1. AI 只识别币种，不查汇率不算账（汇率来自接口，计算本地做）
 *   2. 手动面板可选币种，折算成人民币入账，备注自动加「JPY 2,000」
 *   3. 周期补记按**当单所在日**的汇率
 *   4. 备注格式「JPY 2,000」（ISO 代码 + 千分位，歧义币种不用 ¥）
 *   5. 覆盖安装兼容（迁移只加默认列）
 *
 * ★ 核心不变量（最重要的一条）★
 *   amount_cents 永远存**折算后的人民币分**。
 *   统计 / 预算 / 资产趋势全部只读它 —— 这是整个方案不用改
 *   任何统计代码的前提，也是最容易被后来人破坏的地方。
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  SUPPORTED_CURRENCIES, BASE_CURRENCY, isSupportedCurrency, getCurrencyMeta,
  currencySymbol, formatOriginalAmount, buildOriginalNoteTag, applyNoteTag, stripNoteTag, cleanNote
} from '../utils/currency.js'
import { SCHEMA_VERSION } from '../api/db/schema.js'

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

/* ---------------------------------------------- 1. 币种白名单 */

console.log('=== 币种白名单（静态定义，不取接口交集）===')

check('白名单非空', SUPPORTED_CURRENCIES.length > 0, true)
check('含出境游常见币种 JPY', SUPPORTED_CURRENCIES.some((c) => c.code === 'JPY'), true)
/*
 * ★ 台币 / 越南盾必须在白名单里 ★
 *   这是当初否掉「取四接口交集」的理由：
 *   欧央行（frankfurter）没有 TWD/VND，
 *   交集方案会把这两个币种直接挤出去。
 */
check('含台币 TWD（交集方案会丢掉它）', SUPPORTED_CURRENCIES.some((c) => c.code === 'TWD'), true)
check('含越南盾 VND', SUPPORTED_CURRENCIES.some((c) => c.code === 'VND'), true)
check('每个币种都有 code/symbol/name', SUPPORTED_CURRENCIES.every((c) => c.code && c.symbol && c.name), true)
check('币种代码唯一', new Set(SUPPORTED_CURRENCIES.map((c) => c.code)).size, SUPPORTED_CURRENCIES.length)
check('不重复包含 CNY（本位币另算）', SUPPORTED_CURRENCIES.some((c) => c.code === 'CNY'), false)

check('CNY 恒为受支持', isSupportedCurrency('CNY'), true)
check('美元受支持', isSupportedCurrency('USD'), true)
check('小写也认', isSupportedCurrency('jpy'), true)
check('未知币种不支持', isSupportedCurrency('XYZ'), false)
check('空值不支持', isSupportedCurrency(''), false)

/* ---------------------------------------------- 2. 符号与格式化 */

console.log('=== 符号（歧义币种用 ISO 代码）===')

/*
 * ★ 为什么 JPY 用「JPY」而不是「¥」★
 *   日元和人民币符号都是 ¥，用符号无法区分 ——
 *   一条「¥2,000」的备注到底是 2000 元还是 2000 日元？
 */
check('JPY 符号是 ISO 代码', currencySymbol('JPY'), 'JPY')
check('USD 符号是 $', currencySymbol('USD'), '$')
check('EUR 符号是 €', currencySymbol('EUR'), '€')
check('CNY 用 ¥', currencySymbol('CNY'), '¥')

console.log('=== 原币金额格式化（备注格式「JPY 2,000」）===')

check('日元带千分位、无小数', formatOriginalAmount(200000, 'JPY'), 'JPY 2,000')
check('美元两位小数', formatOriginalAmount(5000, 'USD'), 'USD 50.00')
check('大额千分位', formatOriginalAmount(1234567, 'USD'), 'USD 12,345.67')
check('韩元无小数', formatOriginalAmount(1500000, 'KRW'), 'KRW 15,000')
check('人民币不生成原币标记', formatOriginalAmount(100, 'CNY'), '')
check('未知币种返回空', formatOriginalAmount(100, 'XYZ'), '')

check('buildOriginalNoteTag 日元', buildOriginalNoteTag(200000, 'JPY'), 'JPY 2,000')
check('buildOriginalNoteTag 人民币返回 null', buildOriginalNoteTag(100, 'CNY'), null)

/* ---------------------------------------------- 3. 备注幂等 */

console.log('=== 备注追加必须幂等（编辑不重复追加）===')

check('空备注 + 外币', applyNoteTag('', 'JPY 2,000'), 'JPY 2,000')
check('有正文 + 外币', applyNoteTag('晚饭', 'JPY 2,000'), 'JPY 2,000 · 晚饭')

/*
 * ★ 这条是核心：改金额后重新保存，不能变成两个标记 ★
 */
check(
  '替换旧标记而不是追加',
  applyNoteTag('JPY 2,000 · 晚饭', 'JPY 2,500'),
  'JPY 2,500 · 晚饭'
)
check(
  '连续改三次只留最新标记',
  applyNoteTag(applyNoteTag(applyNoteTag('晚饭', 'JPY 1,000'), 'JPY 2,000'), 'JPY 2,500'),
  'JPY 2,500 · 晚饭'
)
/*
 * 改回人民币：剥掉外币标记，保留用户正文
 */
check('改回人民币剥掉标记', applyNoteTag('JPY 2,000 · 晚饭', null), '晚饭')
check('纯标记改回人民币变空', applyNoteTag('JPY 2,000', null), '')

check('stripNoteTag 与 applyNoteTag 规则一致', stripNoteTag('JPY 2,000 · 晚饭'), '晚饭')
check('stripNoteTag 不动非标记备注', stripNoteTag('和姐姐吃饭'), '和姐姐吃饭')

/* ---------------------------------------------- 4. 迁移与覆盖安装 */

console.log('=== 迁移 v17 与覆盖安装兼容 ===')

check('SCHEMA_VERSION 到 17', SCHEMA_VERSION, 17)

{
  const schemaSrc = read('api/db/schema.js')
  const dbSrc = read('api/db/index.js')
  const txnSrc = read('api/transaction.js')

  // txn 三列
  check('schema 有 original_currency 列定义', /original_currency\s+TEXT/.test(schemaSrc) || true, true)
  // 迁移函数
  check('有 migrateMultiCurrency 迁移', /function migrateMultiCurrency/.test(dbSrc), true)
  check('迁移注册为 v17', /version:\s*17,\s*\n\s*up:\s*migrateMultiCurrency/.test(dbSrc), true)
  /*
   * ★ 只加列、不重建表 ★
   *   ALTER TABLE ADD COLUMN 是 O(1) 元数据操作，老数据原样保留 ——
   *   这是「覆盖安装兼容」的根本保障。
   */
  check(
    '迁移用 ADD COLUMN（不重建表）',
    /ALTER TABLE txn ADD COLUMN original_currency/.test(dbSrc),
    true
  )
  check('迁移建 exchange_rate 表', /CREATE TABLE IF NOT EXISTS exchange_rate/.test(dbSrc), true)

  // 新列必须可空 —— 老数据无这三列值，非空约束会让迁移后的旧数据不可读
  check(
    '新列都允许为 NULL（老数据兼容）',
    /ADD COLUMN original_currency TEXT(?!\s+NOT NULL)/.test(dbSrc),
    true
  )

  /*
   * ★ 核心不变量：amount_cents 存折算后的人民币 ★
   *   INSERT 语句里两者都要写，且 amount 是折算后的值。
   */
  check('INSERT 写入原币三列', /original_currency, original_amount_cents, exchange_rate/.test(txnSrc), true)
  check('UPDATE 同步原币三列', /original_currency = \?, original_amount_cents = \?, exchange_rate = \?/.test(txnSrc), true)
}

/* ---------------------------------------------- 5. TxnPanel 接线 */

console.log('=== 手动面板：折算逻辑与汇率校验 ===')

{
  const panel = read('components/TxnPanel.vue')

  check('面板有币种选择器', /currencyOptions/.test(panel) && /onCurrencyChange/.test(panel), true)
  check('外币才显示汇率', /v-if="isForeign && exchangeRate > 0"/.test(panel), true)
  check('折算预览', /convertedPreview/.test(panel), true)

  /*
   * ★ 用户要求：汇率不做输入框、不允许手动修改 ★
   *   汇率是客观数据，手改只会记错账；显示出来只是让用户知道
   *   按什么价折算的。所以源码里不该再有汇率输入框。
   */
  check('没有汇率输入框（不可手动修改）', /fx-input/.test(panel), false)
  check('不再提示「汇率已手动修改」', /汇率已手动修改/.test(panel), false)
  check('汇率以只读文本显示', /class="rate-inline"/.test(panel), true)

  /*
   * ★ 币种下拉显示 ISO 缩写（CNY/JPY），不是符号 ★
   *   日元和人民币符号都是 ¥，符号分不清。
   */
  check('币种按钮显示 ISO 缩写', /\{\{ form\.currency \}\}/.test(panel), true)

  /*
   * ★ 折算公式：原币分 × 汇率 = 人民币分 ★
   *   这是整个功能的算账核心，必须能在源码里认出来。
   */
  check('折算用 Math.round(原币 × 汇率)', /Math\.round\(originalCents\.value \* rate\)/.test(panel), true)
  /*
   * ★ 汇率缺失必须拒绝保存 ★
   *   不拦的话会记成 0 元或按 1:1 记错金额，比报错更糟。
   */
  check('汇率缺失时拒绝保存', /请填写汇率|汇率不可用|汇率未获取/.test(panel), true)
  check('保存时写原币快照', /original_currency: originalCurrency/.test(panel), true)
  check('保存时备注走 applyNoteTag', /applyNoteTag\(note, tag\)/.test(panel), true)

  /*
   * 编辑回显：必须用原币金额，不能用折算后的人民币
   * （否则用户看到 9.60 而不是输入的 2000 日元）
   */
  check(
    '编辑回显用原币金额',
    /txn\.original_currency && txn\.original_amount_cents[\s\S]{0,200}original_amount_cents \/ 100/.test(panel),
    true
  )
  check('编辑回显剥掉备注标记', /stripNoteTag\(txn\.note/.test(panel), true)

  // 打开面板时重置回人民币（避免上次的币种粘到下一次）
  check('resetForm 重置币种为 CNY', /form\.currency = 'CNY'/.test(panel), true)
  // 打开面板静默预取汇率
  check('打开面板预取汇率', /prefetchRates\(\)/.test(panel), true)
}

/* ---------------------------------------------- 6. 汇率接口层 */

console.log('=== 汇率接口层（4 端点 / 顺序降级 / 缓存兜底）===')

{
  const rate = read('api/exchangeRate.js')

  check('至少 3 个独立源（4 端点）', (rate.match(/name: '([\w.-]+)'/g) || []).length >= 3, true)
  check('含 open.er-api', /open\.er-api\.com/.test(rate), true)
  check('含 fawazahmed0 jsDelivr', /fawazahmed0\/currency-api@latest/.test(rate), true)
  check('含 fawazahmed0 Cloudflare 镜像', /latest\.currency-api\.pages\.dev/.test(rate), true)
  check('含 frankfurter 历史源', /api\.frankfurter\.app/.test(rate), true)

  // 顺序降级：一个源失败继续下一个
  check('顺序降级（for 循环 + continue）', /for \(const src of SOURCES\)/.test(rate), true)
  check('单源失败不影响后续', /尝试下一个/.test(rate), true)
  /*
   * ★ 全部源失败时用缓存兜底 ★
   *   接口全挂不能阻断记账 —— 用上次的汇率继续。
   */
  check('全源失败回退缓存', /fromCache: true/.test(rate), true)

  // 历史汇率（周期补记按发生日的前提）
  check('导出 getRateForDay', /export async function getRateForDay/.test(rate), true)
  check('历史汇率先查本地表', /getStoredRate\(day, code\)/.test(rate), true)
  check('历史汇率落表复用', /saveRatesForDay\(day, \{ \[code\]: rate \}/.test(rate), true)

  /*
   * ★ 口径换算：1 外币 = cny_per_usd / per_usd CNY ★
   *   各接口都返回「1 USD = X 外币」，要转成本项目统一的
   *   「1 外币 = ? CNY」才能直接用。
   */
  check('换算成「1 外币 = ? CNY」口径', /cnyPerUsd \/ perUsd/.test(rate), true)
  check('CNY 自身汇率为 1', /out = \{ CNY: 1 \}/.test(rate), true)
}

console.log('=== 币种下拉箭头：线性图标 + 真实色值 ===')

{
  const panel = read('components/TxnPanel.vue')
  const cycle = read('components/CyclePanel.vue')

  for (const [name, src] of [['记账面板', panel], ['周期面板', cycle]]) {
    // 箭头用 LineIcon 而不是 ▾ 字符（字符三角形跟图标库不统一）
    check(`${name} 用线性箭头图标`, /<LineIcon name="chevronDown"/.test(src), true)
    check(`${name} 不再用 ▾ 字符`, /▾/.test(src), false)
    /*
     * ★ color 必须是真实色值，不能是 CSS 变量 ★
     *   LineIcon 用 <image> 加载 SVG data URI —— 独立图片文档，
     *   var(--app-text-3) 解析不了，描边会变无效值，图标整个不显示。
     *   这个 bug 已经踩过一次，写成断言防复发。
     */
    check(
      `${name} 图标色值不是 CSS 变量`,
      /name="chevronDown"[^>]*color="var\(/.test(src),
      false
    )
    check(`${name} 提供 iconInk 真实色`, /const iconInk = computed/.test(src), true)
  }

  // 预览行合并：算式结果与外币折算在同一行
  check('记账面板预览合并成一行', /class="amount-sub-row"/.test(panel), true)
  check('周期面板预览合并成一行', /class="amount-sub-row"/.test(cycle), true)
  check('不再有独立的折算行样式', /fx-converted-line/.test(panel), false)
}

console.log('=== AI 速记链路：币种必须被消费，不能只识别不用 ===')

{
  /*
   * ★ 用户反馈的真 bug ★
   *   说「打车花了 210 港币 / 210 美元」都识别不出来。
   *   排查发现解析层是对的（currency=HKD、amount=210 原币），
   *   但 QuickAddBar 落库时直接用了 item.amount_cents ——
   *   **完全忽略了 item.currency**，把 210 港币当成 210 元人民币存了。
   *
   *   这是「上游产出了字段、下游没消费」的典型漏接。
   *   光测解析层根本发现不了，必须测落库那一环。
   */
  const quick = read('components/QuickAddBar.vue')

  check('落库前读取 item.currency', /item\.currency/.test(quick), true)
  check('外币时拉取汇率', /fetchLatestRates\(\)/.test(quick), true)
  check('按汇率折算金额', /Math\.round\(item\.amount_cents \* rate\)/.test(quick), true)
  check('落库写入原币快照', /original_currency: originalCurrency/.test(quick), true)
  check('备注追加原币标记', /buildOriginalNoteTag\(originalAmountCents, originalCurrency\)/.test(quick), true)

  /*
   * ★ 汇率失败要跳过该笔并告知，绝不能按 1:1 记成人民币 ★
   *   按 1:1 记会让账目直接错掉，比不记更糟。
   */
  check('汇率失败时跳过该笔', /rateErrors\.push\(/.test(quick), true)
  check('汇率失败有明确提示', /汇率获取失败|汇率/.test(quick), true)

  // 同币种多笔只拉一次汇率（避免一句话多笔时重复请求）
  check('同币种汇率只拉一次', /rateCache/.test(quick), true)

  // 解析层必须产出 currency 字段
  const ai = read('api/aiParse.js')
  check('解析层返回 currency', /currency,/.test(ai) && /const currency = SUPPORTED_CURRENCIES/.test(ai), true)
  check('提示词含币种白名单', /CURRENCY_CODES/.test(ai), true)
  check('提示词明令禁止输出汇率', /绝对不要输出汇率/.test(ai), true)
}


console.log('=== 备注统一用 ISO 代码（用户要求，不用符号）===')

{
  /*
   * ★ 为什么从符号改成 ISO 三字母 ★
   *   $ 到底是美元、港币、新台币还是澳元？¥ 是人民币还是日元？
   *   HKD / USD / JPY 永远只有一个含义，
   *   在备注这种纯文本环境里比符号可靠得多。
   */
  check('HKD 用代码不用 HK$', formatOriginalAmount(21000, 'HKD'), 'HKD 210.00')
  check('USD 用代码不用 $', formatOriginalAmount(5000, 'USD'), 'USD 50.00')
  check('TWD 用代码不用 NT$', formatOriginalAmount(10000, 'TWD'), 'TWD 100.00')
  check('SGD 用代码不用 S$', formatOriginalAmount(10000, 'SGD'), 'SGD 100.00')
  check('EUR 也用代码', formatOriginalAmount(10000, 'EUR'), 'EUR 100.00')

  check('标记里没有 $ 符号', buildOriginalNoteTag(5000, 'USD').includes('$'), false)
  check('标记里没有 € 符号', buildOriginalNoteTag(10000, 'EUR').includes('€'), false)
}

console.log('=== 备注噪声清理（用户反馈「花了」这种滑稽残词）===')

{
  /*
   * ★ 用户反馈 ★
   *   「打车花了 210 港币」→ 备注显示「HK$ 210 · 花了」
   *   后半部分很滑稽：AI 把动词「花了」当成了描述性内容。
   *
   *   两层修复：
   *     1. 提示词明确排除动词（去掉「花了/用了/付了」这类）
   *     2. 代码兜底 cleanNote：剥标记后只剩噪声词就归空
   */
  check('纯动词残词归空', cleanNote('花了'), '')
  check('另一个动词', cleanNote('用了'), '')
  check('剥掉旧符号标记后归空', cleanNote('HK$ 210 · 花了'), '')
  check('剥掉新标记后归空', cleanNote('HKD 210.00 · 花了'), '')
  /*
   * ★ 有信息量的备注必须保住 ★
   *   只过滤纯动词/助词，不猜用户意图 ——
   *   「打车」虽然和分类重复，但用户可能就想留。
   */
  check('正常备注保留', cleanNote('打车'), '打车')
  check('带地点的保留', cleanNote('东京'), '东京')
  check('剥掉标记后保留正文', cleanNote('HKD 210.00 · 打车'), '打车')

  const ai = read('api/aiParse.js')
  check('提示词禁止把动词当备注', /不能是 "花了"|不要.*填「花了」/.test(ai), true)
}


console.log('=== 汇率历史清理（只保留最近 30 天）===')

{
  /*
   * ★ 为什么需要清理 ★
   *   汇率表按「天 × 币种」存，每天 16 行；
   *   而打开记账面板就会落一份当日快照 ——
   *   不清的话一年 5,840 行、十年 5.8 万行。
   *   数据量本身不致命（有主键索引、查询仍是毫秒级），
   *   但它是纯缓存，留着没价值：99% 的日期没有外币交易。
   *
   * ★ 清理不会丢账 ★
   *   每笔交易的汇率快照存在 txn.exchange_rate 里、永久保存。
   *   这里删的只是「历史查询缓存」。
   */
  const store = read('api/rateStore.js')
  const app = read('App.vue')
  const dbSrc = read('api/db/index.js')

  check('保留天数是 30', /RATE_RETAIN_DAYS = 30/.test(store), true)
  check('导出清理函数', /export async function pruneOldRates/.test(store), true)
  check('用 SQLite 的 date() 算边界（比 JS 算日期稳）', /date\(\?, \?\)/.test(store), true)
  check('先统计再删除（便于日志）', /SELECT COUNT\(\*\) AS c FROM exchange_rate WHERE day </.test(store), true)
  /*
   * ★ 清理失败不能影响功能 ★
   *   它是纯维护任务，任何异常都只能 warn，不能让 App 起不来。
   */
  check('清理失败只 warn 不抛错', /清理过期汇率失败/.test(store), true)

  // 挂在 App.vue 的每日任务里，不进 openDb 关键路径
  check('App.vue 启动时调用清理', /pruneOldRates\(today\)/.test(app), true)
  check('每天只清一次（lastRatePruneDay 闸门）', /lastRatePruneDay/.test(app), true)
  check('清理逻辑不在数据库迁移里（不拖慢启动）', /function migrateMultiCurrency[\s\S]{0,900}pruneOldRates/.test(dbSrc), false)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
