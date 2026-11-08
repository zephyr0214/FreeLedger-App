/**
 * 统计页「组件管理」—— 面板定义、顺序归一化与显隐
 *
 * ★ 为什么把面板定义抽到纯函数层 ★
 *   这份清单同时被两个页面使用：
 *     · pages/stats/index.vue      —— 按这里给出的顺序渲染面板；
 *     · pages/settings/stats-panels.vue —— 组件管理页，负责排序与勾选。
 *   两边各写一份 key 的话，改一处就会漏一处：
 *   顺序变了统计页没跟上、或者某个面板能从管理页看到却永远渲染不出来。
 *   所以这里只放「纯数据 + 纯函数」，不 import uni / SQLite，node 里能直接跑单测。
 *
 * ★ 为什么默认顺序写死在代码里、设置项默认 order 是空数组 ★
 *   老用户升级后 setting 表里根本没有 statsPanels 这一行。
 *   order 为空时，normalize 必须能凭 DEFAULT_PANEL_ORDER 把 7 个面板补齐 ——
 *   否则统计页会突然空掉，或者只剩用户手动勾过的两三个面板。
 *   「空 order = 用默认顺序」就是这个意思，也是向前兼容的兜底。
 *
 * ★ 为什么 hidden 只存 key、不存面板对象 ★
 *   面板的文案（名称 / 说明）会随版本改，存对象的话用户库里会留着一份
 *   旧文案，改版后管理页显示的还是老名字。只存 key，文案永远以代码为准。
 */

/**
 * 统计页的 7 个面板。
 *
 * editable 的含义是「这个面板右方有可展开的设置区」，
 * 目前只有恩格尔系数有（手动选哪些支出分类算食品）。
 * 其它面板没有可配置项，就不显示展开箭头 ——
 * 点开一个空设置区比没有箭头更让人困惑。
 */
export const STATS_PANEL_DEFS = [
  { key: 'category',   name: '分类统计',       desc: '哪些分类花得最多',        editable: false },
  { key: 'account',    name: '账户统计',       desc: '钱从哪出、进到哪',        editable: false },
  { key: 'trend',      name: '趋势',           desc: '按天 / 按月的支出走势',   editable: false },
  { key: 'comparison', name: '同比变化',       desc: '与前一段同期对比',        editable: false },
  { key: 'engel',      name: '恩格尔系数',     desc: '食品支出占总支出的比例',  editable: true  },
  { key: 'average',    name: '平均值',         desc: '日均 / 笔均与各分类均值', editable: false },
  { key: 'top',        name: '最高的 10 笔消费', desc: '这段时间最大的几笔',    editable: false }
]

/** 默认顺序：与统计页原本的渲染顺序一致（老用户升级后观感不变） */
export const DEFAULT_PANEL_ORDER = STATS_PANEL_DEFS.map((d) => d.key)

/** 合法 key 集合，用于快速丢弃脏数据 */
const VALID_KEYS = new Set(DEFAULT_PANEL_ORDER)

/**
 * 这个 key 是不是合法的面板。
 *
 * ★ 为什么要单独给一个函数 ★
 *   normalize / move / toggle 三处都要判，写三遍 `VALID_KEYS.has(...)`
 *   容易在某一处漏掉；而且测试里也用它断言「未知 key 被丢掉」。
 */
export function isStatsPanelKey(key) {
  return VALID_KEYS.has(String(key || ''))
}

/** 按 key 取面板定义；未知 key 返回 null（调用方自己兜底） */
export function getStatsPanelDef(key) {
  return STATS_PANEL_DEFS.find((d) => d.key === key) || null
}

/**
 * 把存进库的设置归一化成可用的 { order, hidden }。
 *
 * 容错口径（这些都是真实会遇到的脏数据，不是假想）：
 *   1. raw 不是对象（null / 字符串 / 数组）→ 完全用默认值；
 *      setting 表是 KV，用户覆盖导入一份老版本的 JSON 时很容易带进这种东西；
 *   2. order 里出现未知 key（旧版本删掉的面板）→ 丢掉，不能让它出现在列表里；
 *   3. order 里重复的 key → 去重，否则 v-for 的 :key 重复会导致渲染错乱；
 *   4. order 缺 key（新版本加的面板）→ 按 DEFAULT_PANEL_ORDER 的顺序追加在尾部。
 *      ★ 为什么追加在尾部而不是插回默认位置 ★
 *        用户已经手动排过序了，插回中间会把他排好的顺序整体打乱；
 *        排到末尾至少不打乱既有顺序，用户想要再自己挪上去。
 *   5. hidden 里只保留合法 key，并且去重。
 *
 * @param {any} raw setting 里读出来的原始值
 * @returns {{order:string[], hidden:string[]}} 全新的对象（不共享引用，可安全改动）
 */
export function normalizeStatsPanels(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}

  const order = []
  const rawOrder = Array.isArray(src.order) ? src.order : []
  for (const item of rawOrder) {
    const key = typeof item === 'string' ? item.trim() : ''
    if (!VALID_KEYS.has(key)) continue
    if (order.includes(key)) continue
    order.push(key)
  }
  // 补齐缺失的面板（新增面板 / 老用户从没排序过）
  for (const key of DEFAULT_PANEL_ORDER) {
    if (!order.includes(key)) order.push(key)
  }

  const hidden = []
  const rawHidden = Array.isArray(src.hidden) ? src.hidden : []
  for (const item of rawHidden) {
    const key = typeof item === 'string' ? item.trim() : ''
    if (!VALID_KEYS.has(key)) continue
    if (hidden.includes(key)) continue
    hidden.push(key)
  }

  return { order, hidden }
}

/**
 * 统计页要渲染的面板（按 order 排列、排除 hidden）。
 *
 * ★ 为什么返回 def 数组而不是 key 数组 ★
 *   统计页每块面板都要用 name 做标题，
 *   返回 def 就不用页面再自己 getStatsPanelDef 一次（少一层容易忘的空判断）。
 *
 * @param {any} raw setting 里读出来的原始值
 * @returns {Array} STATS_PANEL_DEFS 的子集，顺序 = 用户排的顺序
 */
export function visibleStatsPanels(raw) {
  const { order, hidden } = normalizeStatsPanels(raw)
  return order
    .filter((key) => !hidden.includes(key))
    .map((key) => getStatsPanelDef(key))
    .filter(Boolean)
}

/**
 * 被取消勾选的面板（组件管理页下方「未显示」分组用）。
 *
 * 顺序同样按 order 排 —— 用户在「已显示」里排好的相对位置，
 * 取消勾选后到下面也保持同样的先后，勾回来时位置不会突变。
 *
 * @param {any} raw setting 里读出来的原始值
 * @returns {Array} STATS_PANEL_DEFS 的子集（只含 hidden 里的）
 */
export function hiddenStatsPanels(raw) {
  const { order, hidden } = normalizeStatsPanels(raw)
  return order
    .filter((key) => hidden.includes(key))
    .map((key) => getStatsPanelDef(key))
    .filter(Boolean)
}

/**
 * 上移 / 下移一个面板（照组合账户成员那套：delta -1 上移、+1 下移）。
 *
 * 越界时原样返回（首行上移、末行下移都不该有任何变化）——
 * 组件管理页的箭头在首末行会置灰，但这里仍然兜一层：
 * 用户手指点在置灰箭头边缘、或者代码别处误调时，不能把数组弄乱。
 *
 * ★ 「越界」是按**同一分组内**算的，不是按 order 全量算 ★
 *   order 存的是含隐藏项的全量顺序（隐藏项也占位，勾回来不会跳位置）。
 *   于是列表里可能出现 order = [分类, 账户, 趋势]，而「账户」是隐藏的 ——
 *   这时对「趋势」点 ↑，如果按全量 swap，它会和隐藏的「账户」换位，
 *   **界面上什么都没发生**，用户只会觉得箭头坏了。
 *   所以这里跳过显隐状态不同的项，只和同组相邻项换位：
 *   上移 = 换到上一个同组项的前面，没有同组项了就是到头了。
 *
 * @param {any} raw setting 里读出来的原始值
 * @param {string} key 要移动的面板 key
 * @param {number} delta -1 上移 / +1 下移
 * @returns {{order:string[], hidden:string[]}} 新对象；越界/非法 key 时顺序不变
 */
export function moveStatPanel(raw, key, delta) {
  const state = normalizeStatsPanels(raw)
  if (!isStatsPanelKey(key)) return state

  const idx = state.order.indexOf(key)
  if (idx === -1) return state

  const step = delta < 0 ? -1 : delta > 0 ? 1 : 0
  if (step === 0) return state

  const isHidden = state.hidden.includes(key)

  // 沿 order 往目标方向找第一个「同分组」的项；找不到说明已经在该组首/尾
  let to = -1
  for (let i = idx + step; i >= 0 && i < state.order.length; i += step) {
    const other = state.order[i]
    if (state.hidden.includes(other) === isHidden) {
      to = i
      break
    }
  }
  if (to === -1) return state

  const arr = state.order.slice()
  const [item] = arr.splice(idx, 1)
  arr.splice(to, 0, item)
  state.order = arr
  return state
}

/**
 * 勾选 / 取消勾选一个面板（组件管理页的复选框）。
 *
 * visible === false → 加入 hidden；否则（true / undefined）→ 移出 hidden。
 * 这样页面里 `toggleStatPanel(raw, key, checked)` 直接把复选框的选中态传进来即可。
 *
 * @param {any} raw setting 里读出来的原始值
 * @param {string} key 面板 key
 * @param {boolean} visible 是否显示
 * @returns {{order:string[], hidden:string[]}} 新对象；非法 key 时原样返回
 */
export function toggleStatPanel(raw, key, visible) {
  const state = normalizeStatsPanels(raw)
  if (!isStatsPanelKey(key)) return state

  const arr = state.hidden.filter((k) => k !== key)
  if (visible === false) {
    // order 里必然能找到这个 key（normalize 补齐过），直接放末尾即可
    if (!arr.includes(key)) arr.push(key)
  }
  state.hidden = arr
  return state
}
