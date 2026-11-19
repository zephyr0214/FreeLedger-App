/**
 * 同比对比区间计算的测试
 *
 *   node scripts/test-compare-range.mjs
 *
 * ★ 为什么这块必须钉死 ★
 *   用户明确指出了「今天」和「没有数据的日子」这两类边界：
 *   「比如选中本月，应该是 11.1-今天 同比 10 月最后相同天的变化，
 *     如果选中的范围全部有收支则全部同比，以此类推」。
 *   这类「差一天就全错」的逻辑靠肉眼在 App 里点不出来，
 *   只能把每个边界写成断言。
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  shiftMonthClamped, shiftYearClamped, daySpanInclusive,
  buildCompareRange, changePercent, percentText, compareRangeLabel,
  balanceChangePercent, percentOnly
} from '../utils/compareRange.js'

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

/* ================================================= 月份 / 年份夹取 */

console.log('=== 1. 月份 / 年份平移（月末夹取）===')

check('3/31 移一个月 → 2/28', shiftMonthClamped('2026-03-31', -1), '2026-02-28')
check('闰年 3/31 移一个月 → 2/29', shiftMonthClamped('2024-03-31', -1), '2024-02-29')
check('1/15 移一个月 → 去年 12 月', shiftMonthClamped('2026-01-15', -1), '2025-12-15')
check('12/31 移一个月 → 11/30', shiftMonthClamped('2026-12-31', -1), '2026-11-30')
check('5/10 移两个月 → 3/10', shiftMonthClamped('2026-05-10', -2), '2026-03-10')
check('2/29 移一年（平年）→ 2/28', shiftYearClamped('2024-02-29', -1), '2023-02-28')
check('11/08 移一年 → 去年 11/08', shiftYearClamped('2026-11-08', -1), '2025-11-08')
check('天数含首尾：11/1~11/8 是 8 天', daySpanInclusive('2026-11-01', '2026-11-08'), 8)
check('天数含首尾：同一天是 1 天', daySpanInclusive('2026-11-08', '2026-11-08'), 1)

/* ==================================================== 同比：去年同期 */

console.log('=== 2. 同比：起止日期各往前一年 ===')
const TODAY = '2026-11-19'

{
  const cr = buildCompareRange({ startDay: '2026-10-01', endDay: '2026-10-31' }, TODAY)
  check('整月同比去年同月：起点', cr.prevStart, '2025-10-01')
  check('整月同比去年同月：终点', cr.prevEnd, '2025-10-31')
  check('对齐方式是按年', cr.align, 'year')
  check('整月不会被今天截断', cr.clipped, false)
}

{
  // 本月 1 号到今天：先截到今天，再各减一年
  const cr = buildCompareRange({ startDay: '2026-11-01', endDay: '2026-11-30' }, TODAY)
  check('本月到今天：当前终点被截到今天', cr.curEnd, '2026-11-19')
  check('本月到今天：同比去年同日起点', cr.prevStart, '2025-11-01')
  check('本月到今天：同比去年同日终点', cr.prevEnd, '2025-11-19')
  check('标记为被截断', cr.clipped, true)
  check('原始区间终点仍保留（给文案用）', cr.rangeEnd, '2026-11-30')
}

{
  // 单日同比 = 去年同一天（不是昨天）
  const cr = buildCompareRange({ startDay: '2026-11-08', endDay: '2026-11-08' }, TODAY)
  check('单日同比去年同日：起点', cr.prevStart, '2025-11-08')
  check('单日同比去年同日：终点', cr.prevEnd, '2025-11-08')
}

{
  // 月内半截同比去年同月同日，不再跳回上个月
  const cr = buildCompareRange({ startDay: '2026-01-05', endDay: '2026-01-20' }, '2026-02-10')
  check('半截月同比：起点', cr.prevStart, '2025-01-05')
  check('半截月同比：终点', cr.prevEnd, '2025-01-20')
}

{
  // 闰日
  const cr = buildCompareRange({ startDay: '2024-02-29', endDay: '2024-02-29' }, TODAY)
  check('2/29 同比平年夹到 2/28', cr.prevStart, '2023-02-28')
  check('2/29 同比终点也夹到 2/28', cr.prevEnd, '2023-02-28')
}

console.log('=== 3. 整年同比 ===')

{
  const cr = buildCompareRange({ startDay: '2025-01-01', endDay: '2025-12-31' }, TODAY)
  check('完整历史整年：起点', cr.prevStart, '2024-01-01')
  check('完整历史整年：终点', cr.prevEnd, '2024-12-31')
  check('对齐方式是按年', cr.align, 'year')
}
{
  // 当前年没过完：当前截到今天，去年同期也只到同一天
  const cr = buildCompareRange({ startDay: '2026-01-01', endDay: '2026-12-31' }, TODAY)
  check('当前整年被截断：同比起点', cr.prevStart, '2025-01-01')
  check('当前整年被截断：同比终点', cr.prevEnd, '2025-11-19')
}

/* ==================================================== 环比：上一周期 */

console.log('=== 4. 环比：上月同期 / 单日前一天 / 整年上一年 ===')

{
  // 完整自然月 -> 上一个完整自然月
  const cr = buildCompareRange({ startDay: '2026-10-01', endDay: '2026-10-31' }, TODAY, 'mom')
  check('整月环比：起点', cr.prevStart, '2026-09-01')
  check('整月环比：终点（9 月只有 30 天）', cr.prevEnd, '2026-09-30')
  check('对齐方式是按月', cr.align, 'month')
}

{
  // 本月 1 号到今天 -> 上月 1 号到同日
  const cr = buildCompareRange({ startDay: '2026-11-01', endDay: '2026-11-30' }, TODAY, 'mom')
  check('本月到今天环比：当前终点截到今天', cr.curEnd, '2026-11-19')
  check('本月到今天环比：上月同期起点', cr.prevStart, '2026-10-01')
  check('本月到今天环比：上月同期终点', cr.prevEnd, '2026-10-19')
  check('对齐方式是按月', cr.align, 'month')
}

{
  // 单日环比 = 前一天
  const cr = buildCompareRange({ startDay: '2026-11-08', endDay: '2026-11-08' }, TODAY, 'mom')
  check('单日环比对比昨天', cr.prevStart, '2026-11-07')
  check('单日环比终点也是昨天', cr.prevEnd, '2026-11-07')
}

{
  // 月内自定义半截（不从 1 号开始）-> 紧邻的上一段等长区间
  const cr = buildCompareRange({ startDay: '2026-01-05', endDay: '2026-01-20' }, '2026-02-10', 'mom')
  check('月内半截环比：起点', cr.prevStart, '2025-12-20')
  check('月内半截环比：终点', cr.prevEnd, '2026-01-04')
  check('首尾天数一致', daySpanInclusive(cr.prevStart, cr.prevEnd), daySpanInclusive(cr.curStart, cr.curEnd))
}

{
  // 整年环比 = 上一年整年（闰年也不按 365 天硬推）
  const cr = buildCompareRange({ startDay: '2025-01-01', endDay: '2025-12-31' }, TODAY, 'mom')
  check('整年环比：起点', cr.prevStart, '2024-01-01')
  check('整年环比：终点', cr.prevEnd, '2024-12-31')
  check('对齐方式是按年', cr.align, 'year')
}

{
  // 多个完整自然月 -> 紧挨着的前 N 个完整月
  const cr = buildCompareRange({ startDay: '2026-01-01', endDay: '2026-02-28' }, TODAY, 'mom')
  check('1~2 月环比：起点', cr.prevStart, '2025-11-01')
  check('1~2 月环比：终点', cr.prevEnd, '2025-12-31')
  check('对齐方式是按月', cr.align, 'month')
}
{
  const cr = buildCompareRange({ startDay: '2026-04-01', endDay: '2026-06-30' }, TODAY, 'mom')
  check('4~6 月环比：起点', cr.prevStart, '2026-01-01')
  check('4~6 月环比：终点', cr.prevEnd, '2026-03-31')
}

console.log('=== 5. 滚动区间与跨多月自定义 ===')

{
  // 近一周 -> 紧挨着的前 7 天
  const cr = buildCompareRange({ startDay: '2026-11-13', endDay: '2026-11-19' }, TODAY, 'mom')
  check('近一周环比：起点', cr.prevStart, '2026-11-06')
  check('近一周环比：终点', cr.prevEnd, '2026-11-12')
  check('近一周环比长度一致', daySpanInclusive(cr.prevStart, cr.prevEnd), 7)
}
{
  // 近一月（30 天）-> 紧挨着的前 30 天
  const cr = buildCompareRange({ startDay: '2026-10-21', endDay: '2026-11-19' }, TODAY, 'mom')
  check('近一月环比长度一致', daySpanInclusive(cr.prevStart, cr.prevEnd), 30)
  check('近一月环比终点', cr.prevEnd, '2026-10-20')
  check('近一月环比不重叠', cr.prevEnd < cr.curStart, true)
}
{
  // 跨多月自定义：同比仍是去年同日期，环比仍是紧邻等长区间
  const yoy = buildCompareRange({ startDay: '2026-06-15', endDay: '2026-09-30' }, TODAY)
  check('跨多月同比：起点', yoy.prevStart, '2025-06-15')
  check('跨多月同比：终点', yoy.prevEnd, '2025-09-30')
  check('跨多月同比按年', yoy.align, 'year')

  const mom = buildCompareRange({ startDay: '2026-06-15', endDay: '2026-09-30' }, TODAY, 'mom')
  check('跨多月环比：等长', mom.align, 'span')
  check('跨多月环比不重叠', mom.prevEnd < mom.curStart, true)
  check('跨多月环比长度一致', daySpanInclusive(mom.prevStart, mom.prevEnd), daySpanInclusive(mom.curStart, mom.curEnd))
}

console.log('=== 6. 边界与空态 ===')

check('不限时间没有对比', buildCompareRange({ startDay: '', endDay: '' }, TODAY), null)
check('未来区间没有对比', buildCompareRange({ startDay: '2026-12-01', endDay: '2026-12-31' }, TODAY), null)
{
  // 区间跨到今天之后：先截断，再按同比换算
  const cr = buildCompareRange({ startDay: '2026-01-01', endDay: '2026-06-30' }, '2026-03-10')
  check('区间中途的未来部分被今天截断', cr.curEnd, '2026-03-10')
  check('同比起点同步到去年同一天', cr.prevStart, '2025-01-01')
  check('同比终点同步到去年同一天', cr.prevEnd, '2025-03-10')
  check('标记为截断', cr.clipped, true)
}

console.log('=== 7. 百分比与文案 ===')

check('上期为 0 + 本期有数 → null', changePercent(500, 0), null)
check('上期为 0 + 本期为 0 → null', changePercent(0, 0), null)
check('正常涨幅', changePercent(1500, 1000), 50)
check('正常跌幅', changePercent(800, 1000), -20)
check('保留一位小数', changePercent(1234, 1000), 23.4)
check('小数部分为 0 时不显示 .0', percentText(50, 1500), '+50%')
check('一位小数照常显示', percentText(23.4, 1234), '+23.4%')
check('跌幅带负号', percentText(-20, 800), '-20%')
check('持平', percentText(0, 1000), '0%')
/*
 * ★ 不再显示「新增」（用户本轮）★
 *   用户原话「不要显示新增了，就是上箭头100%」。
 *   所以断言从 '新增' 改成 '100%'。
 */
check('算不出且本期有数 → 100%', percentText(null, 500), '100%')
check('算不出且本期为 0 → 破折号', percentText(null, 0), '—')

{
  // 同比文案：去年年份必须写出来
  const cr = buildCompareRange({ startDay: '2026-11-01', endDay: '2026-11-30' }, TODAY)
  check('同比文案显示去年同期日期', compareRangeLabel(cr), '对比 2025/11/01~2025/11/19')
}
{
  // 环比文案：同年上月只显示月/日
  const cr = buildCompareRange({ startDay: '2026-11-01', endDay: '2026-11-30' }, TODAY, 'mom')
  check('环比文案显示上月同期日期', compareRangeLabel(cr), '对比 10/01~10/19')
}
{
  const cr = buildCompareRange({ startDay: '2026-01-01', endDay: '2026-12-31' }, TODAY)
  check('整年文案带年份', /\d{4}\/\d{2}\/\d{2}/.test(compareRangeLabel(cr)), true)
  check('文案不带括号说明', /\(/.test(compareRangeLabel(cr)), false)
}

console.log('=== 8. 同比 / 环比两种模式互不影响 ===')

{
  const yoy = buildCompareRange({ startDay: '2026-11-01', endDay: '2026-11-30' }, TODAY)
  const yoy2 = buildCompareRange({ startDay: '2026-11-01', endDay: '2026-11-30' }, TODAY, 'yoy')
  check('不传 mode 时等价于 yoy', JSON.stringify(yoy), JSON.stringify(yoy2))
  check('同比对比去年同期', yoy.prevStart, '2025-11-01')
  check('同比终点也是去年同期同日', yoy.prevEnd, '2025-11-19')

  const mom = buildCompareRange({ startDay: '2026-11-01', endDay: '2026-11-30' }, TODAY, 'mom')
  check('环比对比上月同期', mom.prevStart, '2026-10-01')
  check('环比终点是上月同日', mom.prevEnd, '2026-10-19')
}

console.log('=== 9. 结余百分比的方向 ===')

/*
 * ★ 结余可以是负的，分母为负会把涨跌方向翻反 ★
 *   上期结余 -100（花超了）、本期 +50 明明是变好，
 *   套普通百分比公式会得到 -150%，用户会以为更糟。
 *   所以上期结余 <= 0 时干脆不给百分比（显示「—」）。
 */
check('上期结余为负 → 不给百分比', balanceChangePercent(500, -1000), null)
check('上期结余为 0 → 不给百分比', balanceChangePercent(500, 0), null)
check('上期结余为正、本期更多 → 正数', balanceChangePercent(2000, 1000), 100)
check('上期结余为正、本期更少 → 负数', balanceChangePercent(500, 1000), -50)
check('null 显示破折号', percentOnly(null), '—')
check('0 显示 0%', percentOnly(0), '0%')

console.log('=== 10. 徽标顺序（用户第 1 条）===')

{
  const B = await import('../utils/txnBadges.js')
  const txn = {
    tag_ids: ['t1', 't2'],
    note: '张三',
    category_name: '借出',
    reimburse_status: 1,
    cycle_id: 'cyc1',
    via_combo_id: 'combo1',
    exclude_from_stats: true
  }
  const badges = B.buildTxnBadges(txn, {
    primaryColor: '#07C160',
    tagMap: { t1: { name: '装修', color: '#FF0000' }, t2: { name: '工作', color: '' } }
  })
  check(
    '徽标顺序：用户标签 > 人员 > 报销 > 周期 > 组合账户 > 不计收支',
    badges.map((b) => b.name),
    ['装修', '工作', '张三', '待报销', '周期', '组合账户', '不计收支']
  )
  check('没有任何标记时返回空数组', B.buildTxnBadges({}, {}), [])
  check('已报销徽标文案', B.buildTxnBadges({ reimburse_status: 2 }, {}).map((b) => b.name), ['已报销'])
  check('非借款类分类的备注不当人员徽标', B.buildTxnBadges({ note: '张三', category_name: '餐饮食品' }, {}), [])
  check('借款八类名单覆盖', B.LOAN_CATEGORY_NAMES.length, 8)
}

console.log('=== 11. 四个大变化率：只显示箭头，不显示正负号 ===')

{
  const panel = read('components/StatsComparePanel.vue')

  /*
   * ★ 用户本轮要求 ★
   *   「四个大的变化率的值还是箭头和符号共存的，
   *   我要的是只保留箭头，不显示 +- 号」。
   *
   *   四个地方 = 支出变化 / 收入变化（同一个模板池）
   *          + 结余变化 + 对应的环比面板（同一组件）。
   *
   *   所以断言看两面：
   *     1) 百分比文案不能走带符号的 percentText / percentOnly；
   *     2) 两处都用 absPercentText（或同等的取绝对值写法）。
   */
  check('支出/收入变化率不带符号', /pctText: absPercentText\(pct, cur\)/.test(panel), true)
  check('不再调 percentText（带 +/-）', /pctText: percentText\(/.test(panel), false)
  check('不再调 percentOnly（带 +/-）', /pctText: percentOnly\(/.test(panel), false)
  check('结余变化率也取绝对值', /Math\.abs\(Number\(pct\)\)/.test(panel), true)
  check('箭头仍然渲染在百分比前面', /class="cmp-top-arrow"[\s\S]{0,120}?class="cmp-top-pct"/.test(panel), true)
  check('不再引入带符号的百分比工具', /percentText, percentOnly/.test(panel), false)
}

console.log('=== 12. AI 回溯日期的默认时刻 ===')

{
  const { validateItem } = await import('../api/aiParse.js')

  /*
   * ★ 用户本轮第 2 条 ★
   *   「AI 记账说之前的日期但是没有说具体时间时，
   *   添加到要求日期的 23:59」。
   *
   *   三个要点：
   *     · 昨天、没说时间 → 23:59
   *     · 今天、没说时间 → 不给（落库用「此刻」更准）
   *     · 昨天、说了时间 → 用说的那个
   */
  const ctx = {
    baseDate: new Date('2026-11-09T20:00:00'),
    categories: [{ id: 'c1', name: '餐饮', type: 'expense', parent_id: null }],
    accounts: [{ id: 'a1', name: '现金', type: 'bank' }],
    tags: []
  }

  const yesterday = validateItem(
    { type: 'expense', amount: 45, category: '餐饮', account: '现金', dayOffset: -1 },
    ctx
  )
  check('昨天没说时间 → 23:59', yesterday.item && yesterday.item.occurred_time, '23:59')

  const today = validateItem(
    { type: 'expense', amount: 45, category: '餐饮', account: '现金', dayOffset: 0 },
    ctx
  )
  check('今天没说时间 → 不给时间（用此刻）', today.item && today.item.occurred_time, null)

  const withTime = validateItem(
    { type: 'expense', amount: 45, category: '餐饮', account: '现金', dayOffset: -1, time: '12:30' },
    ctx
  )
  check('昨天说了时间 → 用说的那个', withTime.item && withTime.item.occurred_time, '12:30')
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
