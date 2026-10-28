/**
 * 备份「写进去 → 读出来」必须是一个完整的 JSON
 *
 *   node scripts/test-backup-roundtrip.mjs
 *
 * ★ 这个测试是为了锁住一个真机 bug ★
 *   用户报：「备份点击恢复时，显示备份文件不是有效的 json」。
 *
 *   现象：文件是本 App 自己写出来的，恢复时却解析失败。
 *
 *   根因（两处，都只在真机上暴露）
 *
 *   1. 覆盖已有文件时用了 writer.truncate(0) + writer.write(content)
 *      ★ truncate/seek 在 Android 上不可靠 ★
 *      DCloud 官方论坛的说法：
 *      「seek方法指定到特定位置pos后写入数据应该覆盖pos位置后的所有数据」
 *      「Android平台临时解决方法只能先删除原来文件避免」
 *      而且 createWriter 之后的**写入起始位置是未定义的**，
 *      新内容可能写在旧内容后面/中间 -> 读回来不是合法 JSON。
 *
 *   2. 读文件时只取 e.target.result
 *      不同基座/版本里 onloadend 的事件对象不一样，
 *      有的挂在 e.result 上，取错就拿到 undefined ->
 *      JSON.parse(undefined) -> 「不是有效的 JSON」。
 *
 *   另外还有 BOM：某些 ROM 的 readAsText 会带 UTF-8 BOM，
 *   JSON.parse 对 BOM 直接报错。
 *
 * 这个测试用一个模拟 plus.io 的实现把整条链路跑一遍：
 *   写 -> 读 -> 解析 -> 校验
 * 并覆盖「同名文件被覆盖写」和「带 BOM」两个场景。
 */

/* ------------------------------------------- 模拟 plus.io 的文件系统 */

class MockFile {
  constructor(name) {
    this.name = name
    this.content = ''
    this.isFile = true
  }
  /** plus.io 的 FileEntry.file(success, fail) */
  file(success) {
    success(this)
  }
  remove(success) {
    this.content = ''
    success && success(this)
  }
  createWriter(success) {
    const self = this
    success({
      onwriteend: null,
      onerror: null,
      // ★ 模拟 Android 的行为：truncate 不可靠 ★
      //   真正的 Android 上 truncate(0) 可能没效果，
      //   这里刻意模拟成「没效果」，逼实现用「删了重写」的路子。
      truncate() {},
      seek(pos) { this._pos = pos },
      write(data) {
        const pos = this._pos || 0
        // 关键：如果不先截断，新内容会覆盖开头但保留尾部
        // （HTML5+ 的 write 语义），这里按「从 pos 开始覆盖」实现
        self.content = self.content.slice(0, pos) + data + self.content.slice(pos + data.length)
        this._pos = pos + data.length
        if (this.onwriteend) this.onwriteend()
      }
    })
  }
}

class MockDir {
  constructor(name) {
    this.name = name
    this.files = {}
  }
  getFile(name, opt, success, fail) {
    if (this.files[name]) {
      success(this.files[name])
    } else if (opt && opt.create) {
      const f = new MockFile(name)
      this.files[name] = f
      success(f)
    } else {
      fail && fail(new Error('not found'))
    }
  }
  getDirectory(name, opt, success, fail) {
    if (!this.dirs) this.dirs = {}
    if (this.dirs[name]) {
      success(this.dirs[name])
    } else if (opt && opt.create) {
      const d = new MockDir(name)
      this.dirs[name] = d
      success(d)
    } else {
      fail && fail(new Error('not found'))
    }
  }
}

const root = new MockDir('_doc')

/** 按 _doc/xxx/yyy 这样的路径逐级找到目录/文件 */
function resolveMock(url) {
  const parts = String(url).replace(/^\//, '').split('/').filter(Boolean)
  if (parts[0] !== '_doc') return null

  let dir = root
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]
    const isLast = i === parts.length - 1
    if (isLast) {
      // 最后一段是文件名
      if (dir.files[p]) return dir.files[p]
      return null
    }
    if (!dir.dirs || !dir.dirs[p]) return null
    dir = dir.dirs[p]
  }
  return dir
}

globalThis.plus = {
  io: {
    resolveLocalFileSystemURL(url, success, fail) {
      if (url === '_doc/' || url === '_doc') {
        success(root)
        return
      }
      const found = resolveMock(url)
      if (found) success(found)
      else fail && fail(new Error('not found: ' + url))
    },
    /** plus.io.FileReader */
    FileReader: class {
      constructor() {
        this.result = null
        this.onloadend = null
        this.onerror = null
      }
      readAsText(file, encoding) {
        this.result = file.content
        // 模拟「不同基座事件对象不同」的情况：
        // 这里只给 e.target.result
        if (this.onloadend) {
          this.onloadend({ target: { result: this.result } })
        }
      }
    }
  }
}

/* ------------------------------------------------------------ 跑测试 */

const { writeTextFile, readTextFile, parseJsonLoose } = await import('../api/backup.js')

let pass = 0
let fail = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++ } else {
    fail++
    console.log(`FAIL  ${name}\n      实际 ${a}\n      期望 ${e}`)
  }
}

console.log('=== 写入 -> 读取 -> 解析 ===')

{
  const content = JSON.stringify({ app: 'books', schemaVersion: 1, hello: '世界' })
  const path = await writeTextFile('_doc/backup/', 'b1.json', content)
  check('返回路径正确', path, '_doc/backup/b1.json')

  const read = await readTextFile(path)
  check('读回内容一致', read, content)

  const parsed = parseJsonLoose(read)
  check('解析出 app', parsed.app, 'books')
  check('解析出中文没乱码', parsed.hello, '世界')
}

console.log('=== 同名文件覆盖写（真机 bug 的核心场景）===')

{
  // 先写一个长的
  const long = JSON.stringify({ app: 'books', schemaVersion: 1, data: 'x'.repeat(500) })
  await writeTextFile('_doc/backup/', 'b2.json', long)
  check('第一次写入长度正确', (await readTextFile('_doc/backup/b2.json')).length, long.length)

  // 再写一个短的 —— 覆盖同一个文件
  const short = JSON.stringify({ app: 'books', schemaVersion: 1, data: 'y' })
  await writeTextFile('_doc/backup/', 'b2.json', short)

  const after = await readTextFile('_doc/backup/b2.json')
  check('覆盖后没有残留旧内容', after.length, short.length)
  check('覆盖后内容是新内容', after, short)

  // ★ 关键：覆盖后必须还是合法 JSON ★
  let parsed = null
  let ok = true
  try { parsed = JSON.parse(after) } catch (e) { ok = false }
  check('覆盖后仍是合法 JSON', ok, true)
  check('覆盖后数据正确', parsed && parsed.data, 'y')
}

console.log('=== 带 BOM 的文件也能解析 ===')

{
  const content = JSON.stringify({ app: 'books', schemaVersion: 1 })
  const withBom = '\uFEFF' + content
  let parsed = null
  let ok = true
  try { parsed = JSON.parse(withBom) } catch (e) { ok = false }
  check('原生 JSON.parse 处理 BOM 会失败（说明为什么要加容错）', ok, false)

  const loose = parseJsonLoose(withBom)
  check('parseJsonLoose 能处理 BOM', loose.app, 'books')
}

console.log('=== 首尾空白也要容错 ===')

{
  const loose = parseJsonLoose('\n\n  {"app":"books"}  \n')
  check('去掉首尾空白后能解析', loose.app, 'books')
}

console.log('=== 非法内容报错清晰 ===')

{
  let msg = ''
  try { parseJsonLoose('这不是 JSON') } catch (e) { msg = e.message }
  check('非法 JSON 抛错', msg.length > 0, true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
