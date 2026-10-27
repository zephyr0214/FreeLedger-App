/**
 * 分类固定两行 + 「更多」按钮的分配规则验证
 *
 *   node scripts/test-cat-width.mjs
 *
 * 规则：
 *   - 固定两行，每行 6 个位置（最多 12 个）
 *   - 分类 ≤ 11 个：全部直接显示，不需要「更多」
 *   - 分类 > 11 个：前 11 个直接显示，第 12 个位置是「更多」
 */

const CAT_SLOTS = 12
const PER_ROW = 6
const DIRECT_MAX = 11

/** 按规则分配，返回每行实际显示的项数（最后一项可能是「更多」占位） */
function splitRows(catCount) {
  if (catCount === 0) return [0, 0]

  const hasMore = catCount > DIRECT_MAX
  const direct = hasMore ? DIRECT_MAX : Math.min(catCount, CAT_SLOTS)

  let row1 = Math.min(direct, PER_ROW)
  let row2 = Math.max(direct - PER_ROW, 0)

  // 「更多」占第 12 个位置（第 2 行第 6 位）
  if (hasMore) row2 += 1

  return [row1, row2]
}

let fail = 0

console.log('=== 分配规则 ===')
for (const n of [0, 1, 5, 6, 9, 10, 11, 12, 15, 32, 50]) {
  const [r1, r2] = splitRows(n)
  const direct = n <= DIRECT_MAX ? n : DIRECT_MAX
  const more = n > DIRECT_MAX
  const hasMoreSlot = more && r2 > (direct - PER_ROW)

  console.log(
    `  ${String(n).padStart(2)} 个 -> 第1行 ${r1} 个, 第2行 ${r2} 个` +
    `  (直接显示 ${direct}, ${more ? '有更多按钮' : '无更多按钮'})`
  )

  // 断言 1：恒为两行结构（第二行可能为空）
  if (r1 > PER_ROW || r2 > PER_ROW) {
    console.log('    ✗ 单行超过 6 个')
    fail++
  }
  // 断言 2：直接显示的数量正确
  const shown = r1 + r2 - (hasMoreSlot ? 1 : 0)
  if (shown !== direct) {
    console.log(`    ✗ 实际显示 ${shown} 个，应为 ${direct} 个`)
    fail++
  }
  // 断言 3：总位置不超过 12
  if (r1 + r2 > CAT_SLOTS) {
    console.log('    ✗ 总位置超过 12')
    fail++
  }
  // 断言 4：超出时必须有「更多」按钮
  if (n > DIRECT_MAX && !hasMoreSlot) {
    console.log('    ✗ 分类超量但没有「更多」按钮')
    fail++
  }
  // 断言 5：未超量时不能有「更多」按钮
  if (n <= DIRECT_MAX && hasMoreSlot) {
    console.log('    ✗ 分类未超量却出现「更多」按钮')
    fail++
  }
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 处异常`)
if (fail > 0) process.exit(1)
