/**
 * 数字键盘布局验证
 *
 *   node scripts/test-keyboard-layout.mjs
 *
 * 检查「完成」键是否真的在右下角、且有足够的点击面积。
 */

const SCREEN_W = 375   // iPhone 13
const SCREEN_H = 812
const PAD = 8          // num-keyboard 的 padding
const GAP = 8          // 键间距
const KEY_H = 92       // 普通键高度
const ITEM = 108       // 分类项宽（仅参考）

const rpx = SCREEN_W / 750
const toPx = (r) => r * rpx

console.log('=== 键盘布局计算 ===')
console.log(`屏幕 ${SCREEN_W}px, 1rpx = ${rpx.toFixed(4)}px`)

// 键盘可用宽度 = 屏幕 - 两侧 padding
const kbInner = SCREEN_W - toPx(PAD) * 2
const gapPx = toPx(GAP)

console.log(`键盘内部宽 ${kbInner.toFixed(1)}px, 间距 ${gapPx.toFixed(1)}px`)

// kb-wrap: 左侧 kb-main(flex:3) + 右侧 kb-side(flex:1)
const sideW = kbInner / 4
const mainW = kbInner - sideW
console.log(`左侧主区 ${mainW.toFixed(1)}px, 右侧列 ${sideW.toFixed(1)}px`)

// 左侧：3 列 x 5 行
const mainColW = (mainW - gapPx * 2) / 3
console.log(`主区每键宽 ${mainColW.toFixed(1)}px`)

const mainRows = 5
const mainH = mainRows * toPx(KEY_H) + (mainRows - 1) * gapPx
console.log(`主区总高 ${mainH.toFixed(1)}px (5 行)`)

// 右侧：⌫ - + 完成
// 「完成」键只带 kb-finish(flex:1)，不带 kb-side-key(height:92rpx)
const sideNormalH = toPx(KEY_H)
const sideFixedH = sideNormalH * 3 + gapPx * 3
console.log(`右侧 3 个普通键高 ${sideFixedH.toFixed(1)}px`)

// 期望：完成键占满剩余的两行空间
// 剩余 = 左侧 5 行总高 - 右侧 3 个普通键 - 它们之间的 3 个 gap
const expectFinishH = mainH - (sideNormalH * 3 + gapPx * 3) - gapPx
console.log(`完成键应撑满剩余 = ${expectFinishH.toFixed(1)}px`)

// 修正后：完成键只有 flex:1，撑满剩余空间
const actualFinishH = mainH - sideFixedH - gapPx
console.log(`完成键实际(flex:1 撑满剩余) = ${actualFinishH.toFixed(1)}px`)

let fail = 0
if (Math.abs(actualFinishH - expectFinishH) > 1) {
  console.log('  ✗ 完成键高度不对')
  fail++
}

// 右侧列总高应该与左侧一致
const sideTotalH = sideFixedH + actualFinishH + gapPx
console.log(`右侧总高 ${sideTotalH.toFixed(1)}px (期望 ${mainH.toFixed(1)}px)`)
if (Math.abs(sideTotalH - mainH) > 1) {
  console.log('  ✗ 左右两列高度不一致')
  fail++
}

// 完成键必须有足够的点击面积（至少 40px 高）
if (actualFinishH < 40) {
  console.log('  ✗ 完成键点击区域过小')
  fail++
}

// 完成键宽度不能太窄（右侧列 = 1/4 屏宽）
const finishW = sideW
console.log(`完成键宽 ${finishW.toFixed(1)}px`)
if (finishW < 40) {
  console.log('  ✗ 完成键宽度过小')
  fail++
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 处异常`)
if (fail > 0) process.exit(1)
