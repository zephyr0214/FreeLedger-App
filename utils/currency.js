/**
 * 币种白名单与外币格式化 —— 纯函数，无依赖
 *
 * ★ 设计决策（与用户拍板的方案一致）★
 *   1. 支持币种是**静态白名单**，不是各接口返回的交集 ——
 *      交集会被覆盖最小的接口（欧央行 ~30 币种）锁死，
 *      台币/越南盾这类出境游常客会被挤出去，且列表随供应商改版缩水。
 *      接口只负责取数，白名单负责边界。
 *   2. 歧义币种用 ISO 代码展示（JPY/CNY 符号都是 ¥），
 *      无歧义的用符号（$ € £）。
 *   3. 所有函数零副作用、零网络 —— 可被 node 测试直接跑。
 */

/** 支持的币种（不含 CNY 本位币）—— 按出境游常见度排序 */
export const SUPPORTED_CURRENCIES = [
  { code: 'USD', symbol: '$',    name: '美元' },
  { code: 'EUR', symbol: '€',    name: '欧元' },
  { code: 'JPY', symbol: 'JPY',  name: '日元' },
  { code: 'GBP', symbol: '£',    name: '英镑' },
  { code: 'HKD', symbol: 'HK$',  name: '港币' },
  { code: 'TWD', symbol: 'NT$',  name: '新台币' },
  { code: 'KRW', symbol: '₩',    name: '韩元' },
  { code: 'THB', symbol: 'THB',  name: '泰铢' },
  { code: 'SGD', symbol: 'S$',   name: '新加坡元' },
  { code: 'MYR', symbol: 'MYR',  name: '马来西亚林吉特' },
  { code: 'AUD', symbol: 'A$',   name: '澳元' },
  { code: 'CAD', symbol: 'C$',   name: '加元' },
  { code: 'CHF', symbol: 'CHF',  name: '瑞士法郎' },
  { code: 'VND', symbol: 'VND',  name: '越南盾' },
  { code: 'RUB', symbol: '₽',    name: '俄罗斯卢布' },
  { code: 'NZD', symbol: 'NZ$',  name: '新西兰元' }
]

/** 本位币 */
export const BASE_CURRENCY = 'CNY'
export const BASE_SYMBOL = '¥'

const BY_CODE = {}
for (const c of SUPPORTED_CURRENCIES) BY_CODE[c.code] = c

/** 币种是否受支持（CNY 恒为受支持） */
export function isSupportedCurrency(code) {
  if (!code) return false
  const c = String(code).toUpperCase()
  return c === BASE_CURRENCY || !!BY_CODE[c]
}

/** 取币种信息；CNY 或未知返回 null */
export function getCurrencyMeta(code) {
  if (!code) return null
  return BY_CODE[String(code).toUpperCase()] || null
}

/** 币种符号；CNY 返回 ¥，未知返回空串 */
export function currencySymbol(code) {
  if (!code) return ''
  const c = String(code).toUpperCase()
  if (c === BASE_CURRENCY) return BASE_SYMBOL
  return BY_CODE[c] ? BY_CODE[c].symbol : ''
}

/**
 * 格式化原币金额（备注追加 / 详情展示用）
 *
 * ★ 格式规范（用户拍板）★
 *   「JPY 2,000」—— 歧义币种用 ISO 代码，千分位，不加小数点后无意义位。
 *   零小数位币种（JPY/KRW/VND）不显示 .00，其余保留两位。
 */
export function formatOriginalAmount(amountCents, code) {
  const n = Math.round(Number(amountCents) || 0)
  const meta = getCurrencyMeta(code)
  if (!meta) return ''
  // 零小数位币种：日元/韩元/越南盾实际流通无小数
  const zeroDecimal = ['JPY', 'KRW', 'VND'].includes(meta.code)
  const yuan = n / 100
  const str = zeroDecimal
    ? Math.round(yuan).toLocaleString('en-US')
    : yuan.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${meta.symbol} ${str}`
}

/**
 * 生成要追加到备注的原币标记（如「JPY 2,000」）
 *
 * ★ 返回 null 表示「无需追加」★
 *   · 没有原币信息（本币交易）
 *   · 币种是 CNY 或未知
 */
export function buildOriginalNoteTag(amountCents, currency) {
  const s = formatOriginalAmount(amountCents, currency)
  return s || null
}

/**
 * 幂等地把原币标记写进备注
 *
 * ★ 为什么要单独处理 ★
 *   备注是用户可编辑的。编辑交易时如果无脑 append，
 *   改三次金额备注里就有三个「JPY 2,000」。
 *
 * 规则：
 *   1. 备注**开头**若匹配自动标记模式（如「JPY 2,000 · 」），先剥掉再决定
 *   2. 本币交易（tag 为 null）：剥掉旧标记，保留用户正文
 *   3. 外币交易：新标记 + 「 · 」 + 用户正文（正文为空则只有标记）
 */
export function applyNoteTag(note, tag) {
  const body = String(note || '').trim()
  // 剥掉开头已存在的自动标记：「XXX 1,234」+ 可选分隔符
  const stripped = body.replace(/^[A-Z]{2,4}\s[\d,]+(\.\d{1,2})?\s*(·|-)?\s*/i, '').trim()

  if (!tag) return stripped
  return stripped ? `${tag} · ${stripped}` : tag
}

/**
 * 从备注里识别出「自动标记剥除后」的正文 —— 编辑回显用
 * （与 applyNoteTag 的剥离规则保持一致）
 */
export function stripNoteTag(note) {
  const body = String(note || '').trim()
  return body.replace(/^[A-Z]{2,4}\s[\d,]+(\.\d{1,2})?\s*(·|-)?\s*/i, '').trim()
}
