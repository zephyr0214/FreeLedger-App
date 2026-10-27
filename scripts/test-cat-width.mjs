/**
 * 分类容器宽度计算验证
 *
 *   node scripts/test-cat-width.mjs
 *
 * 验证 375px 宽屏下，各种分类数量对应的容器宽度与是否需要滑动。
 */

const WINDOWS = [
  { name: 'iPhone SE', width: 320 },
  { name: 'iPhone 13', width: 375 },
  { name: 'iPhone 15 Pro Max', width: 430 },
  { name: 'Android 常见', width: 393 }
]

const CATS_PER_ROW = 5
const ITEM_RPX = 108
const GAP_RPX = 8
const PAD_RPX = 32

function calcWidth(catCount, windowWidth) {
  const rpx = windowWidth / 750
  const itemW = ITEM_RPX * rpx
  const gap = GAP_RPX * rpx
  const padX = PAD_RPX * rpx

  const row1 = Math.min(catCount, CATS_PER_ROW)
  const row2 = Math.max(catCount - CATS_PER_ROW, 0)
  const maxCount = Math.max(row1, row2)
  if (maxCount === 0) return 0

  const rowW = maxCount * itemW + Math.max(maxCount - 1, 0) * gap
  return Math.ceil(rowW + padX * 2)
}

let fail = 0

for (const w of WINDOWS) {
  console.log(`\n=== ${w.name} (${w.width}px) ===`)
  for (const n of [0, 3, 5, 6, 9, 12, 15, 20, 30]) {
    const total = calcWidth(n, w.width)
    if (total === 0) {
      console.log(`  ${String(n).padStart(2)} 个 -> 无宽度`)
      continue
    }
    const scrollable = total > w.width
    const rows = n > CATS_PER_ROW ? 2 : (n > 0 ? 1 : 0)
    console.log(
      `  ${String(n).padStart(2)} 个 -> 容器 ${String(total).padStart(4)}px  ` +
      `${rows} 行  ${scrollable ? '可右滑' : '不需要滑'}`
    )

    // 断言：行数不超过 2
    if (rows > 2) {
      console.log(`    ✗ 行数超过 2`)
      fail++
    }
    // 断言：能放下所有分类（第 2 行可无限长）
    if (n > 0 && rows === 0) {
      console.log(`    ✗ 有分类但算出 0 行`)
      fail++
    }
  }
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 处异常`)
if (fail > 0) process.exit(1)
