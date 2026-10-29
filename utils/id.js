/**
 * ID 生成 —— 使用 UUID v4，保证导入导出时跨设备不冲突
 */

const HEX = '0123456789abcdef'

function randomHex(len) {
  let out = ''
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint8Array(len)
    crypto.getRandomValues(buf)
    for (let i = 0; i < len; i++) out += HEX[buf[i] & 0x0f]
  } else {
    for (let i = 0; i < len; i++) out += HEX[Math.floor(Math.random() * 16)]
  }
  return out
}

export function uuid() {
  const d = Date.now().toString(16).padStart(12, '0')
  return [
    d.slice(-8),
    randomHex(4),
    '4' + randomHex(3),
    HEX[8 + Math.floor(Math.random() * 4)] + randomHex(3),
    randomHex(12)
  ].join('-')
}

/** 带前缀的 ID，便于调试时一眼看出类型 */
export function prefixedId(prefix) {
  return `${prefix}_${uuid()}`
}

/** 短 ID（用于本地排序锚点等非关键场景） */

