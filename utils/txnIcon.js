/**
 * 交易流水图标配置 —— 五档尺寸 + 五档背景形状
 *
 * ★ 为什么单独一个纯函数文件 ★
 *   store（读写设置）、主题外观页（两条滑块）、流水组件（实际渲染）
 *   都要用同一套档位，抽出来避免多处各写一遍。
 *
 * ★ 尺寸档位 ★
 *   key  名称   图标    外框
 *   xs   极小   44rpx   48rpx
 *   s    小     52rpx   56rpx
 *   m    中     60rpx   64rpx
 *   l    大     68rpx   72rpx   ← 默认
 *   xl   极大   76rpx   80rpx
 *
 * ★ 背景形状档位（0=方形，4=圆形）★
 *   0 方形 0rpx / 1 微圆 10rpx / 2 圆角 18rpx / 3 大圆 28rpx / 4 圆形 50%
 */

export const TXN_ICON_SIZES = [
  { key: 'xs', name: '极小', icon: 44, box: 48 },
  { key: 's', name: '小', icon: 52, box: 56 },
  { key: 'm', name: '中', icon: 60, box: 64 },
  { key: 'l', name: '大', icon: 68, box: 72 },
  { key: 'xl', name: '极大', icon: 76, box: 80 }
]

/**
 * 分类背景色的固定方块尺寸
 *
 * 用户要求「背景色包住图标、不随图标档位变化」。
 * 最大档图标 76rpx，固定 84rpx 能包住，同时比上一版 100rpx 小一圈。
 */
export const TXN_ICON_BG_BOX = 84

/** 五档背景形状：方形 → 圆形 */
export const TXN_ICON_ROUNDS = [
  { key: 'square', name: '方形', radius: '0rpx' },
  { key: 'soft', name: '微圆', radius: '10rpx' },
  { key: 'round', name: '圆角', radius: '18rpx' },
  { key: 'large', name: '大圆', radius: '28rpx' },
  { key: 'circle', name: '圆形', radius: '50%' }
]

const DEFAULT_KEY = 'l'
const DEFAULT_ROUND = 2

/** 设置里的尺寸值归一成合法 key */
export function normalizeTxnIconSize(key) {
  const raw = String(key || '').trim()
  return TXN_ICON_SIZES.some((s) => s.key === raw) ? raw : DEFAULT_KEY
}

/** key -> { key, name, icon, box } */
export function getTxnIconMetrics(key) {
  return TXN_ICON_SIZES.find((s) => s.key === normalizeTxnIconSize(key)) || TXN_ICON_SIZES[3]
}

/** key -> 滑块序号（0..4） */
export function txnIconSizeIndex(key) {
  const i = TXN_ICON_SIZES.findIndex((s) => s.key === normalizeTxnIconSize(key))
  return i < 0 ? 3 : i
}

/** 背景形状序号归一（0..4） */
export function normalizeTxnIconRound(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_ROUND
  return Math.max(0, Math.min(TXN_ICON_ROUNDS.length - 1, Math.round(n)))
}

/** 序号 -> 圆角值（'0rpx' / '18rpx' / '50%'） */
export function getTxnIconRadius(value) {
  return TXN_ICON_ROUNDS[normalizeTxnIconRound(value)].radius
}
