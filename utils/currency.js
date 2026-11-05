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
 * ★ 统一用 ISO 三字母代码，不用货币符号（用户明确要求）★
 *   符号的问题在于歧义和辨识度：
 *     $   到底是美元、港币、新台币还是澳元？
 *     ¥   到底是人民币还是日元？
 *   而 HKD / USD / JPY 三个字母永远只有一个含义，
 *   在备注这种纯文本环境里比符号可靠得多。
 *
 * ★ 零小数位币种不加 .00 ★
 *   JPY / KRW / VND 实际流通无小数，写成「JPY 2,000.00」很怪。
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
  return `${meta.code} ${str}`
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
 * 备注开头「原币标记」的匹配模式
 *
 * ★ 必须同时兼容新旧两种格式 ★
 *   新格式：HKD 210.00 / JPY 2,000      （ISO 代码）
 *   旧格式：HK$ 210.00 / $ 50.00        （符号，早期版本写的）
 *   用户库里可能已经有旧格式的备注，
 *   编辑一次就得能认出来并替换掉，否则会越叠越长。
 *
 * 组成：可选符号/代码 + 数字（含千分位与小数）+ 可选分隔符
 */
const NOTE_TAG_RE = /^(?:[A-Z]{2,4}|HK\$|NT\$|S\$|A\$|C\$|NZ\$|[€£₩¥$₽])\s[\d,]+(\.\d{1,2})?\s*(·|-)?\s*/i

/**
 * 幂等地把原币标记写进备注
 *
 * ★ 为什么要单独处理 ★
 *   备注是用户可编辑的。编辑交易时如果无脑 append，
 *   改三次金额备注里就有三个「HKD 210」。
 *
 * 规则：
 *   1. 备注**开头**若匹配自动标记模式，先剥掉再决定
 *   2. 本币交易（tag 为 null）：剥掉旧标记，保留用户正文
 *   3. 外币交易：新标记 + 「 · 」 + 用户正文（正文为空则只有标记）
 */
export function applyNoteTag(note, tag) {
  const body = String(note || '').trim()
  const stripped = body.replace(NOTE_TAG_RE, '').trim()

  if (!tag) return stripped
  return stripped ? `${tag} · ${stripped}` : tag
}

/**
 * 从备注里识别出「自动标记剥除后」的正文 —— 编辑回显用
 * （与 applyNoteTag 的剥离规则保持一致）
 */
export function stripNoteTag(note) {
  const body = String(note || '').trim()
  return body.replace(NOTE_TAG_RE, '').trim()
}

/**
 * 备注里「没有信息量的残词」—— AI 偶尔会把动词当备注吐出来
 *
 * ★ 为什么需要这层兜底 ★
 *   「打车花了 210 港币」这种句子，AI 有时会给 note = "花了" ——
 *   因为提示词说「去掉金额和分类后剩下的部分」，
 *   而「花了」确实没被前面的规则覆盖到。
 *   提示词已经收紧，但模型不保证听话，这里再兜一层：
 *   剥掉原币标记后如果只剩这些词，就当空备注处理。
 *
 * ★ 为什么不把「打车」这类也列进来 ★
 *   那是有效信息（虽然和分类重复，但用户可能就想留）。
 *   只过滤纯动词/助词，不猜意图。
 */
const NOISE_NOTES = new Set([
  '花了', '用了', '付了', '消费', '支出', '收入', '记账', '记一笔',
  '买了', '花', '用', '付', '了', '的', '元', '块', '钱'
])

/**
 * 清理备注：剥掉原币标记，并把无信息量的残词归空
 * @param {string} note 原始备注
 * @returns {string} 清理后的备注（可能为空串）
 */
export function cleanNote(note) {
  const body = stripNoteTag(note)
  if (NOISE_NOTES.has(body)) return ''
  return body
}
