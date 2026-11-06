/**
 * 极简 AndroidManifest.xml（二进制 AXML）解析器
 *
 *   import { decodeAxml } from './axml.mjs'
 *
 * ★ 为什么要自己写一个 ★
 *   云打包出来的 APK 里 AndroidManifest.xml 是**二进制**的，
 *   直接当文本读全是乱码，看不到 intent-filter 有没有合并进去。
 *   而这个功能（外部 JSON 用本 App 打开）是否生效，
 *   恰恰只能靠「解包 APK 看最终 manifest」来验证 ——
 *   所以必须能把它读出来。
 *
 * 只用 node 内置模块，不引第三方依赖（本项目 devDependencies 很少，
 * 不想为了一个检查脚本引入 apktool / aapt2）。
 */

/* ----------------------------------------------- 二进制读取小工具 */

function u16(buf, off) {
  return buf.readUInt16LE(off)
}
function u32(buf, off) {
  return buf.readUInt32LE(off)
}

/* ----------------------------------------------- 字符串池 */

/**
 * 解析 RES_STRING_POOL_TYPE (0x0001)
 *
 * 字符串池结构：
 *   header(8) + stringCount(4) + styleCount(4) + flags(4) + stringsStart(4) + stylesStart(4)
 *   + stringOffsets[stringCount]
 *   + 字符串数据区（UTF-8 或 UTF-16，看 flags & 0x100）
 */
function parseStringPool(buf, start) {
  const type = u16(buf, start)
  const headerSize = u16(buf, start + 2)
  const size = u32(buf, start + 4)
  const count = u32(buf, start + 8)
  const flags = u32(buf, start + 16)
  const stringsStart = u32(buf, start + 20)
  const utf8 = (flags & 0x100) !== 0

  const offsets = []
  for (let i = 0; i < count; i++) {
    offsets.push(u32(buf, start + headerSize + i * 4))
  }

  const out = []
  for (const rel of offsets) {
    let p = start + stringsStart + rel
    let len
    if (utf8) {
      // UTF-8 变长：先读 UTF-16 长度，再读 UTF-8 字节长度（各 1~2 字节）
      // 跳过第一个长度（字符数）
      if (buf[p] & 0x80) p += 2
      else p += 1
      len = buf[p]
      if (len & 0x80) {
        len = ((len & 0x7f) << 8) | buf[p + 1]
        p += 1
      }
      p += 1
      out.push(buf.slice(p, p + len).toString('utf8'))
    } else {
      len = u16(buf, p)
      p += 2
      if (len & 0x8000) {
        len = ((len & 0x7fff) << 16) | u16(buf, p)
        p += 2
      }
      out.push(buf.slice(p, p + len * 2).toString('utf16le'))
    }
  }
  return { strings: out, size }
}

/* ----------------------------------------------- 元素树 */

/**
 * 把二进制 manifest 解析成节点树
 *
 * @param {Buffer} buf APK 里 AndroidManifest.xml 的原始字节
 * @returns {{tag: string, attrs: Object, children: Array}} 根节点（manifest）
 */
export function decodeAxml(buf) {
  if (u16(buf, 0) !== 0x0003) {
    throw new Error('不是二进制 AXML（文件头不是 RES_XML_TYPE）')
  }
  const total = u32(buf, 4)

  let strings = []
  let resMap = []
  const stack = []
  let root = null

  let off = u16(buf, 2) // headerSize，正常 8
  while (off < total) {
    const type = u16(buf, off)
    const headerSize = u16(buf, off + 2)
    const size = u32(buf, off + 4)
    if (!size) break

    if (type === 0x0001) {
      const pool = parseStringPool(buf, off)
      strings = pool.strings
    } else if (type === 0x0180) {
      // 资源映射表：属性名 -> 资源 id（本项目不需要，跳过）
      const n = size / 4 - 2
      resMap = []
      for (let i = 0; i < n; i++) resMap.push(u32(buf, off + headerSize + i * 4))
    } else if (type === 0x0102) {
      // START_ELEMENT
      const body = off + headerSize
      const nameIdx = u32(buf, body + 4)
      const attrStart = u16(buf, body + 8)
      const attrSize = u16(buf, body + 10)
      const attrCount = u16(buf, body + 12)

      const attrs = {}
      for (let i = 0; i < attrCount; i++) {
        const a = body + attrStart + i * attrSize
        const nameI = u32(buf, a + 4)
        const rawVal = u32(buf, a + 8)
        const dataType = buf[a + 15]
        const data = u32(buf, a + 16)
        const key = strings[nameI]
        if (key === undefined) continue
        let val
        if (rawVal !== 0xffffffff) {
          val = strings[rawVal]
        } else if (dataType === 0x03) {
          val = strings[data]
        } else if (dataType === 0x12) {
          val = data !== 0
        } else if (dataType === 0x10) {
          val = data | 0
        } else if (dataType === 0x01) {
          val = `@ref/0x${data.toString(16)}`
        } else {
          val = data
        }
        // 属性名带命名空间前缀（android:name / tools:node…）
        attrs[key] = val
      }

      const node = { tag: strings[nameIdx], attrs, children: [] }
      if (stack.length) stack[stack.length - 1].children.push(node)
      else root = node
      stack.push(node)
    } else if (type === 0x0103) {
      // END_ELEMENT
      stack.pop()
    }

    off += size
  }

  return root
}

/** 深度优先找所有满足条件的节点 */
export function findAll(node, pred, out = []) {
  if (!node) return out
  if (pred(node)) out.push(node)
  for (const c of node.children || []) findAll(c, pred, out)
  return out
}

/** 取某个节点所有直接子元素的标签名 */
export function childTags(node) {
  return (node.children || []).map((c) => c.tag)
}
