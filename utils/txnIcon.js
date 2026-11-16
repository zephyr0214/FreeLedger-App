/**
 * 交易流水图标尺寸 —— 五档
 *
 * ★ 为什么单独一个纯函数文件 ★
 *   store（读写设置）、设置页（滑块）和流水组件（实际渲染）
 *   都要用同一套尺寸，抽出来避免三处各写一遍。
 *
 * ★ 档位与像素 ★
 *   key  名称   图标    外框
 *   xs   极小   40rpx   44rpx
 *   s    小     52rpx   56rpx
 *   m    中     64rpx   68rpx
 *   l    大     80rpx   84rpx   ← 默认（与 v1.24 放大后的尺寸一致）
 *   xl   极大   96rpx   100rpx
 *
 * 外框比图标大 4rpx（极大 4rpx），是为了让「分类背景色」开关打开时
 * 圆底边缘留一点内边距；关闭背景色时外框不可见，只是占位。
 */

export const TXN_ICON_SIZES = [
  { key: 'xs', name: '极小', icon: 40, box: 44 },
  { key: 's', name: '小', icon: 52, box: 56 },
  { key: 'm', name: '中', icon: 64, box: 68 },
  { key: 'l', name: '大', icon: 80, box: 84 },
  { key: 'xl', name: '极大', icon: 96, box: 100 }
]

const DEFAULT_KEY = 'l'

/** 设置里的值归一成合法 key */
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
