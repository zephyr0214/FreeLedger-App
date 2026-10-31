/**
 * AI 对话的图表数据 —— 模型只说「画哪张图」，数字全部由本地库取
 *
 * ★ 为什么不让模型直接给数字 ★
 *   模型可能算错、可能编、可能把「元」和「分」搞混。
 *   图表是给人看钱的，数字错了比没有图更糟。
 *
 *   所以这里的分工是：
 *     · 模型 → 只输出图表的「规格」：类型、标题、看哪个维度、对比哪个维度
 *     · 本地 → 按规格从 SQLite 取真实数据，再交给 utils/donut.js 画成 SVG
 *
 * ★ 模型能画的图只有这几种（都是本地已经有现成实现的）★
 *   donut   分类构成（环形图）
 *   bar     分类对比（横向条形）
 *   trend   每日趋势（折线）
 *
 * ★ 非法 / 不支持的规格一律忽略 ★
 *   模型偶尔会输出乱七八糟的类型或维度名，
 *   这里做严格白名单校验，取不到数据就返回空（前端不显示那张图），
 *   绝不能因为模型说错就崩掉。
 */

import {
  getCategoryStatsRange,
  getSubCategoryStatsRange,
  getDailyTrendRange
} from './stats.js'
import { monthRange, toMonthKey } from '../utils/date.js'
import { AI_CHART_PALETTE } from '../utils/aiChart.js'

/** 支持的图表类型 */
export const CHART_TYPES = ['donut', 'bar', 'trend']

/** 支持的维度（决定「按什么分组」） */
export const CHART_DIMENSIONS = ['category', 'subcategory']

/**
 * 归一化模型给的图表规格。
 *
 * @param {object} spec 模型输出的一張图规格
 * @returns {object|null} 合法则返回规范化后的规格；不合法返回 null
 */
export function normalizeChartSpec(spec) {
  if (!spec || typeof spec !== 'object') return null

  const type = String(spec.type || '').toLowerCase().trim()
  if (!CHART_TYPES.includes(type)) return null

  // 折线图只按天看，没有「维度」概念
  if (type === 'trend') {
    return {
      type,
      title: String(spec.title || '每日趋势').slice(0, 40),
      days: Math.max(7, Math.min(90, Number(spec.days) || 30))
    }
  }

  const dimension = String(spec.dimension || 'category').toLowerCase().trim()
  if (!CHART_DIMENSIONS.includes(dimension)) return null

  /*
   * limit 的夹取。
   *
   * ★ 不能写成 `Number(spec.limit) || 6` ★
   *   limit 传 0 时 `0 || 6` = 6，夹取的下限 3 就永远用不上，
   *   模型写 limit:0 会得到 6 条而不是 3 条。
   *   所以先把「没传 / 不是数字」和「传了 0」分开处理。
   */
  const rawLimit = Number(spec.limit)
  const limit = Number.isFinite(rawLimit) ? rawLimit : 6

  return {
    type,
    dimension,
    title: String(spec.title || '分类构成').slice(0, 40),
    limit: Math.max(3, Math.min(8, limit))
  }
}
/**
 * 按规格取本地真实数据。
 *
 * @param {object} spec 已经 normalize 过的规格
 * @param {object} range {monthKey} 或 {startDay,endDay}
 * @returns {Promise<{items: Array, total: number, unit: string}>}
 *   items: [{name, amount, color, icon}]，amount 单位「元」
 *   total: 合计（元）
 */
export async function fetchChartData(spec, range) {
  if (!spec) return { items: [], total: 0 }

  const scope = range && range.startDay
    ? range
    : monthRange(range && range.monthKey ? range.monthKey : toMonthKey())

  /* -------------------------------------------------- 折线：每日趋势 */
  if (spec.type === 'trend') {
    const trend = await getDailyTrendRange(scope)
    // getDailyTrendRange 返回 {bucket,label,expense,income}
    const items = (trend || []).map((t) => ({
      day: t.label,
      total: Math.round((Number(t.expense) || 0) / 100),
      income: Math.round((Number(t.income) || 0) / 100)
    }))
    const total = items.reduce((a, b) => a + b.total, 0)
    return { items, total, unit: '元' }
  }

  /* ------------------------------------- 环形 / 条形：按分类分组 */
  const rows = spec.dimension === 'subcategory'
    ? await getSubCategoryStatsRange(scope, 'expense')
    : await getCategoryStatsRange(scope, 'expense')

  const list = (rows || [])
    .filter((r) => Number(r.amount) > 0)
    .slice(0, spec.limit)
    .map((r) => ({
      name: spec.dimension === 'subcategory'
        ? (r.parentName ? `${r.parentName}/${r.name}` : r.name)
        : r.name,
      amount: Math.round((Number(r.amount) || 0) / 100),
      /*
       * ★ 颜色在这里定死 ★
       *   一级分类用自己的颜色；二级分类用统计页的调色板（PIE_PALETTE），
       *   否则同色系的深浅分不开。
       *   兜底也在这里给全 —— 这样画图和图例拿到的**一定是同一个颜色**，
       *   不会出现「色块是绿的、图例是灰的」这种对不上的情况。
       */
      color: r.color || AI_CHART_PALETTE[i % AI_CHART_PALETTE.length],
      icon: r.icon || 'more'
    }))

  const total = list.reduce((a, b) => a + b.amount, 0)
  return { items: list, total, unit: '元' }
}
