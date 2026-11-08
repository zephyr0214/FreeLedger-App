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

import {
  shiftMonthClamped, shiftYearClamped, daySpanInclusive,
  buildCompareRange, changePercent, percentText, compareRangeLabel,
  balanceChangePercent, percentOnly
} from '../utils/compareRange.js'

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

/* ============================================ 整月 / 本月到今天的对齐 */

console.log('=== 2. 整月与「本月到今天」===')
const TODAY = '2026-11-08'

{
  // 本月完整（未截断，比如查历史月份）→ 上月整月，同一段号
  const cr = buildCompareRange({ startDay: '2026-10-01', endDay: '2026-10-31' }, TODAY)
  check('10 月整月对比 9 月整月：起点', cr.prevStart, '2026-09-01')
  check('10 月整月对比 9 月整月：终点', cr.prevEnd, '2026-09-30')
  check('对齐方式是按月', cr.align, 'month')
  check('整月不会被今天截断', cr.clipped, false)
}

{
  // 本月 1 号到今天（用户原话的场景）
  const cr = buildCompareRange({ startDay: '2026-11-01', endDay: '2026-11-30' }, TODAY)
  check('本月到今天：当前终点被截到今天', cr.curEnd, '2026-11-08')
  check('本月到今天：对比上月同期起点', cr.prevStart, '2026-10-01')
  check('本月到今天：对比上月同期终点', cr.prevEnd, '2026-10-08')
  check('标记为被截断', cr.clipped, true)
  check('原始区间终点仍保留（给文案用）', cr.rangeEnd, '2026-11-30')
}

{
  // 单日
  const cr = buildCompareRange({ startDay: '2026-11-08', endDay: '2026-11-08' }, TODAY)
  check('单日对比上月同日：起点', cr.prevStart, '2026-10-08')
  check('单日对比上月同日：终点', cr.prevEnd, '2026-10-08')
}

{
  // 月内半截（1/5~1/20）
  const cr = buildCompareRange({ startDay: '2026-01-05', endDay: '2026-01-20' }, '2026-02-10')
  check('跨年半截月：起点', cr.prevStart, '2025-12-05')
  check('跨年半截月：终点', cr.prevEnd, '2025-12-20')
}

{
  // 上个月只有 30 天，本区间终点是 31 号（用户可能选到 10/31 对比 9 月）
  const cr = buildCompareRange({ startDay: '2026-10-01', endDay: '2026-10-31' }, '2026-11-08')
  check('10/31 对上月 9/30 要夹取', cr.prevEnd, '2026-09-30')
}

console.log('=== 3. 整年对齐去年同期 ===')

{
  const cr = buildCompareRange({ startDay: '2026-01-01', endDay: '2026-12-31' }, TODAY)
  check('整年对比去年同期：起点', cr.prevStart, '2025-01-01')
  check('整年对比去年同期：终点（被今天截断）', cr.prevEnd, '2025-11-08')
  check('对齐方式是按年', cr.align, 'year')
}

{
  // 已过去的整年（完整）
  const cr = buildCompareRange({ startDay: '2025-01-01', endDay: '2025-12-31' }, TODAY)
  check('完整历史整年：起点', cr.prevStart, '2024-01-01')
  check('完整历史整年：终点', cr.prevEnd, '2024-12-31')
}

console.log('=== 4. 跨多月的自定义区间 ===')

{
  // 1~2 月（正好 2 个自然月）：按等长前后推，不按段号
  const cr = buildCompareRange({ startDay: '2026-01-01', endDay: '2026-02-28' }, TODAY)
  check('两个整月走等长区间', cr.align, 'span')
  check('等长区间：起点', cr.prevStart, '2025-11-03')
  check('等长区间：终点', cr.prevEnd, '2025-12-31')
  check('等长区间长度一致', daySpanInclusive(cr.prevStart, cr.prevEnd), daySpanInclusive(cr.curStart, cr.curEnd))
}

{
  // 三个多月
  const cr = buildCompareRange({ startDay: '2026-06-15', endDay: '2026-09-30' }, TODAY)
  check('多个月仍是等长区间', cr.align, 'span')
  check('等长区间不重叠', cr.prevEnd < cr.curStart, true)
}

console.log('=== 5. 边界与空态 ===')

check('不限时间没有对比', buildCompareRange({ startDay: '', endDay: '' }, TODAY), null)
check('未来区间没有对比', buildCompareRange({ startDay: '2026-12-01', endDay: '2026-12-31' }, TODAY), null)
{
  const cr = buildCompareRange({ startDay: '2026-01-01', endDay: '2026-06-30' }, '2026-03-10')
  check('区间中途的未来部分被今天截断', cr.curEnd, '2026-03-10')
  check('截断后对比区间按截断后的长度算', daySpanInclusive(cr.prevStart, cr.prevEnd), daySpanInclusive(cr.curStart, cr.curEnd))
}

console.log('=== 6. 百分比与文案 ===')

check('上期为 0 + 本期有数 → null', changePercent(500, 0), null)
check('上期为 0 + 本期为 0 → null', changePercent(0, 0), null)
check('正常涨幅', changePercent(1500, 1000), 50)
check('正常跌幅', changePercent(800, 1000), -20)
check('保留一位小数', changePercent(1234, 1000), 23.4)
check('小数部分为 0 时不显示 .0', percentText(50, 1500), '+50%')
check('一位小数照常显示', percentText(23.4, 1234), '+23.4%')
check('跌幅带负号', percentText(-20, 800), '-20%')
check('持平', percentText(0, 1000), '0%')
check('算不出且本期有数 → 新增', percentText(null, 500), '新增')
check('算不出且本期为 0 → 破折号', percentText(null, 0), '—')

{
  const cr = buildCompareRange({ startDay: '2026-11-01', endDay: '2026-11-30' }, TODAY)
  /*
   * ★ 括号说明已删除（本轮第 9b 条）★
   *   用户要求「对比...后面的两个括号及其内容删除」。
   */
  check('本月到今天的文案（不再带括号说明）', compareRangeLabel(cr), '对比 10/01~10/08')
}
{
  const cr = buildCompareRange({ startDay: '2026-01-01', endDay: '2026-12-31' }, TODAY)
  check('整年文案带年份', /\d{4}\/\d{2}\/\d{2}/.test(compareRangeLabel(cr)), true)
  check('整年文案也不带括号说明', /\(/.test(compareRangeLabel(cr)), false)
}

console.log('=== 8. 环比模式（紧邻等长区间）===')
{
  // 本月到今天：环比应该是「紧挨着的前 8 天」= 10/24~10/31
  const cr = buildCompareRange({ startDay: '2026-11-01', endDay: '2026-11-30' }, TODAY, 'mom')
  check('环比：当前终点截到今天', cr.curEnd, '2026-11-08')
  check('环比：对比紧邻前 8 天起点', cr.prevStart, '2026-10-24')
  check('环比：对比紧邻前 8 天终点', cr.prevEnd, '2026-10-31')
  check('环比标记为等长区间', cr.align, 'span')
  check('环比长度与当前一致', daySpanInclusive(cr.prevStart, cr.prevEnd), daySpanInclusive(cr.curStart, cr.curEnd))
}
{
  // 整年环比：紧邻的前一年同长度（不是去年同期 —— 去年同期属于同比）
  const cr = buildCompareRange({ startDay: '2025-01-01', endDay: '2025-12-31' }, TODAY, 'mom')
  check('整年环比也是等长区间', cr.align, 'span')
  /*
   * ★ 2025 是 365 天，2024 是 366 天（闰年）★
   *   等长区间往前推 365 天，终点 2024-12-31、起点就是 2024-01-02 ——
   *   这就是「等长」的定义（宁可两边差一天边界，也不让窗口长度不等）。
   *   写死成 2024-01-01 反而是错的（那样多了 366 天）。
   */
  check('整年环比紧邻前一年（闰年差一天）', cr.prevStart, '2024-01-02')
  check('整年环比终点', cr.prevEnd, '2024-12-31')
  check('整年环比长度不超当前区间', daySpanInclusive(cr.prevStart, cr.prevEnd) <= daySpanInclusive(cr.curStart, cr.curEnd), true)
}
{
  // 单日环比 = 前一天
  const cr = buildCompareRange({ startDay: '2026-11-08', endDay: '2026-11-08' }, TODAY, 'mom')
  check('单日环比对比昨天', cr.prevStart, '2026-11-07')
  check('单日环比终点也是昨天', cr.prevEnd, '2026-11-07')
}
{
  // 同比默认行为不能被影响
  const yoy = buildCompareRange({ startDay: '2026-11-01', endDay: '2026-11-30' }, TODAY)
  const yoy2 = buildCompareRange({ startDay: '2026-11-01', endDay: '2026-11-30' }, TODAY, 'yoy')
  check('不传 mode 时等价于 yoy', JSON.stringify(yoy), JSON.stringify(yoy2))
  check('yoy 仍是上月同期', yoy.prevStart, '2026-10-01')
}

console.log('=== 7. 结余百分比的方向 ===')

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

console.log('=== 9. 徽标顺序（用户第 1 条）===')

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

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
