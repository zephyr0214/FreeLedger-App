/**
 * 分类两行布局验证
 *
 *   node scripts/test-cat-width.mjs
 *
 * 布局规则：
 *   - 所有分类平分到两行（32 个 → 每行 16 个）
 *   - scroll-view 可视宽度只够显示 VISIBLE_PER_ROW 个（6 个）
 *   - 容器宽度 = 一行的实际数量，超过可视宽度才能右滑
 */

const WINDOWS = [
  { name: 'iPhone SE', width: 320 },
  { name: 'iPhone 13', width: 375 },
  { name: 'iPhone 15 Pro Max', width: 430 },
  { name: 'Android 常见', width: 393 }
]

const VISIBLE_PER_ROW = 6
const ITEM_RPX = 108
const GAP_RPX = 8
const PAD_RPX = 32

/** 分类平分到两行，返回每行的数量 */
function splitRows(catCount) {
  if (catCount === 0) return [0, 0]
  const half = Math.ceil(catCount / 2)
  return [half, catCount - half]
}

function calc(catCount, windowWidth) {
  const rpx = windowWidth / 750
  const itemW = ITEM_RPX * rpx
  const gap = GAP_RPX * rpx
  const padX = PAD_RPX * rpx

  const rows = splitRows(catCount)
  const maxCount = Math.max(rows[0], rows[1])
  if (maxCount === 0) {
    return { rows, container: 0, viewport: windowWidth, visible: 0, scrollable: false }
  }

  // 容器宽 = 一行的实际数量
  const rowW = maxCount * itemW + Math.max(maxCount - 1, 0) * gap
  const container = Math.ceil(rowW + padX * 2)

  // 可视宽 = 只显示 VISIBLE_PER_ROW 个
  const visibleW = VISIBLE_PER_ROW * itemW + (VISIBLE_PER_ROW - 1) * gap
  const viewport = Math.min(Math.ceil(visibleW + padX * 2), windowWidth)

  return {
    rows,
    container,
    viewport,
    visible: Math.min(VISIBLE_PER_ROW, maxCount),
    scrollable: container > viewport
  }
}

let fail = 0

for (const w of WINDOWS) {
  console.log(`\n=== ${w.name} (${w.width}px) ===`)
  for (const n of [0, 3, 9, 12, 16, 20, 32, 50]) {
    const r = calc(n, w.width)
    if (n === 0) {
      console.log('   0 个 -> 空')
      continue
    }
    const perRow = `${r.rows[0]}+${r.rows[1]}`
    console.log(
      `  ${String(n).padStart(2)} 个 -> 每行 ${perRow.padEnd(7)} ` +
      `容器 ${String(r.container).padStart(4)}px  视口 ${String(r.viewport).padStart(4)}px  ` +
      `可见 ${r.visible}  ${r.scrollable ? '可右滑' : '不需滑'}`
    )

    // 断言 1：恒为两行
    if (r.rows.length !== 2) {
      console.log('    ✗ 不是两行')
      fail++
    }
    // 断言 2：视口最多显示 6 个
    if (r.visible > VISIBLE_PER_ROW) {
      console.log(`    ✗ 视口显示了 ${r.visible} 个，超过 ${VISIBLE_PER_ROW}`)
      fail++
    }
    // 断言 3：容器必须能装下所有分类
    const perRowMax = Math.max(r.rows[0], r.rows[1])
    if (perRowMax * 2 < n) {
      console.log('    ✗ 装不下所有分类')
      fail++
    }
    // 断言 4：超过可见数就必须能滑
    if (n > VISIBLE_PER_ROW * 2 && !r.scrollable) {
      console.log('    ✗ 分类多于可见数但不能滑动')
      fail++
    }
  }
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 处异常`)
if (fail > 0) process.exit(1)
