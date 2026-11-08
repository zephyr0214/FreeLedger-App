/**
 * 交易徽标的统一构建（顺序由用户指定）
 *
 * ★ 用户第 1 条定的顺序 ★
 *   用户标签 > 人员名称 > 待报销/已报销 > 周期 > 组合账户 > 不计收支
 *
 * ★ 为什么必须抽成一个纯函数 ★
 *   同一笔流水会出现在五个地方：首页最近流水、全部交易页、交易详情页、
 *   公共列表组件、借入借出/报销页。每处各写一份 push 顺序的话，
 *   改一次顺序要改五处，漏一处就会出现「同一笔账在首页标签顺序是 A、
 *   在全部交易页是 B」—— 用户会以为两个页面数据不一样。
 *
 * ★ 为什么用「纯函数 + 参数注入」而不是在这里读 store ★
 *   主题色、标签表都是调用方手里才有的（store / 已加载的列表），
 *   utils 层不该去 import store（会带进 Pinia 与启动顺序依赖）。
 *   纯函数还能被 node 直接单测。
 *
 * ★ 借款人员名单为什么在这里复制一份 ★
 *   不 import api/loan.js —— 那个模块会 import api/category.js →
 *   api/db/index.js，utils 层引它会在单测里拖起整条 SQLite 链路。
 *   名单本身很稳定（系统分类名），复制一份并在注释里标明来源，
 *   风险远小于引入依赖环。
 */

/** 借款相关的八个系统分类名（与 api/loan.js、api/db/schema.js 保持一致） */
export const LOAN_CATEGORY_NAMES = [
  '借出', '借款收回',
  '借入', '借款归还',
  '借出坏账', '借出利息',
  '借入未还', '借入利息'
]

/** 组合账户徽标的颜色（与各页面原先的常量一致） */
export const COMBO_BADGE_COLOR = '#8B5CF6'

/**
 * 这个分类名是不是「借款/还款」类（决定要不要把备注渲染成「人员」徽标）。
 *
 * @param {string} name 分类名
 * @returns {boolean}
 */
export function isLoanPersonName(name) {
  return !!name && LOAN_CATEGORY_NAMES.includes(name)
}

/** 把一个色值拼成 12% 透明底（徽标统一用半透明底 + 本色描边） */
function tintOf(color) {
  return color && color.startsWith('#') ? `${color}22` : 'var(--app-card-2)'
}

/**
 * 构建一笔交易的徽标数组
 *
 * @param {object} txn 交易对象（listTransactions 的返回值即可）
 * @param {object} [opt]
 * @param {string} [opt.primaryColor] 主题色（周期 / 人员徽标用）
 * @param {Object<string,{name:string,color:string}>} [opt.tagMap] 标签 id -> 标签
 * @param {string} [opt.comboColor] 组合账户徽标色
 * @returns {Array<{key:string,name:string,color:string,bg:string,border:string}>}
 */
export function buildTxnBadges(txn, opt = {}) {
  const t = txn || {}
  const primary = opt.primaryColor || 'var(--app-primary)'
  const combo = opt.comboColor || COMBO_BADGE_COLOR
  const tagMap = opt.tagMap || {}
  const list = []

  /* 1) 用户标签（排最前：用户自己起的名字最贴身） */
  const ids = Array.isArray(t.tag_ids) ? t.tag_ids : []
  for (const id of ids) {
    const tg = tagMap[id]
    if (!tg) continue
    if (tg.color) {
      list.push({ key: id, name: tg.name, color: tg.color, bg: tintOf(tg.color), border: tg.color })
    } else {
      // 没设颜色的标签：卡片浅底 + 次要文字色，和别处保持一致
      list.push({
        key: id,
        name: tg.name,
        color: 'var(--app-text-2)',
        bg: 'var(--app-card-2)',
        border: 'var(--app-text-3)'
      })
    }
  }

  /*
   * 2) 人员名称
   *
   * ★ 只有借款八类的备注才是「人」★
   *   这几类的 note 存的就是对方名字（不是描述），
   *   混在副标题「现金 · 张三」里几乎不会被注意到，提成徽标才看得见。
   *   ★ 只是显示，不写 tag 表 ★
   *     写进去会污染标签统计（一个「张三」会变成用户标签）。
   */
  if (t.note && isLoanPersonName(t.category_name)) {
    list.push({ key: '__person__', name: t.note, color: primary, bg: tintOf(primary), border: primary })
  }

  /*
   * 3) 待报销 / 已报销
   *
   * ★ 为什么单独判断而不是 import reimburseBadge ★
   *   那个函数在 utils/reimburseBadge.js 里，本文件同层可直接 import ——
   *   但它返回的是「带自己 key 的完整对象」，这里直接用它的结果即可。
   */
  const status = Number(t.reimburse_status) || 0
  if (status === 1) {
    const c = '#FF8F1F'
    list.push({ key: '__reimburse_pending__', name: '待报销', color: c, bg: tintOf(c), border: c })
  } else if (status === 2) {
    const c = '#07C160'
    list.push({ key: '__reimburse_done__', name: '已报销', color: c, bg: tintOf(c), border: c })
  }

  /* 4) 周期 */
  if (t.cycle_id) {
    list.push({ key: '__cycle__', name: '周期', color: primary, bg: tintOf(primary), border: primary })
  }

  /* 5) 组合账户（独立标记，不是标签） */
  if (t.via_combo_id) {
    list.push({ key: '__combo__', name: '组合账户', color: combo, bg: tintOf(combo), border: combo })
  }

  /* 6) 不计收支（排最后：它是最「技术性」的一条说明） */
  if (t.exclude_from_stats) {
    const c = '#969799'
    list.push({ key: '__not_counted__', name: '不计收支', color: c, bg: tintOf(c), border: c })
  }

  return list
}
