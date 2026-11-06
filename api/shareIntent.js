/**
 * 外部打开 —— 从微信 / 文件管理器「用其他应用打开」把 JSON 交给本应用
 *
 * ★ 用户需求 ★
 *   「比如我在微信收到一个 json，可以调用系统用其他应用打开，
 *     可以用这个软件打开，打开自动导入」
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 这条链路一共有三段，缺一段都不通 ★
 *
 *   1) 系统把本应用列进「用其他应用打开」的候选列表
 *      → 只能靠项目根目录的 AndroidManifest.xml 声明 intent-filter，
 *        manifest.json 里**没有**这个字段（官方字段表里不存在
 *        intentFilters / customManifest，云打包会把它们丢掉）。
 *        见项目根目录 AndroidManifest.xml 的注释。
 *
 *   2) 应用被拉起后，把「那个文件在哪」拿到手
 *      → 两条通道同时试，缺一条就容易踩坑：
 *          a. plus.runtime.arguments（DCloud 把第三方传来的参数拼成
 *             JSON 字符串，key 是 Intent extra 原名；URL Scheme 调用时
 *             则是裸字符串）
 *          b. Native.js 直接读 Activity.getIntent() 的
 *             action / data / type / EXTRA_STREAM / clipData
 *        云打包后有「arguments 为空」的已知 bug，所以 b 不是可选项。
 *
 *   3) 把文件内容读成文本
 *      → 微信给的是 content:// 而不是可读路径，
 *        plus.io **读不了 content://**（它只认 _doc/_www 这类虚拟路径和
 *        file:// 本地绝对路径）。
 *        所以走 Native.js 的 ContentResolver.openInputStream。
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 几个必须记住的坑（都是本项目/社区实测过的）★
 *
 *   · plus.android.importClass **不映射 Java 静态字段**，
 *     取常量要用 plus.android.getAttribute(类名, 字段名)。
 *     （api/update.js 里为 Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES
 *       踩过一次，这里直接写 extra 的字面量值更省事，
 *       反正 android.intent.extra.STREAM 的值就是这串。）
 *
 *   · 返回 byte[] 的 Java 方法在本基座上**过不了 JS 桥**
 *     （社区结论：不支持）。所以读文件不能用
 *     ByteArrayOutputStream.read(byte[]) + toString()，
 *     只能用 BufferedReader.readLine() 一行行拼字符串 ——
 *     全程只有 String 过桥。
 *
 *   · content:// 的读权限是**发送方临时授予**的，有时效。
 *     拿到就立刻读，绝对不能把 uri 存起来下次再读。
 *
 *   · plus.globalEvent 的 'newintent' 事件**回调没有参数**，
 *     要在回调里自己去读 plus.runtime.arguments / getIntent()。
 *
 *   · launchMode 是 singleTask，所以应用已在后台时再次「用其他应用打开」
 *     走的是 onNewIntent → newintent 事件，不会重新 onLaunch。
 *     但该事件在部分机型/时机上不触发，所以 onShow 里必须再兜一次。
 */

import {
  parseJsonLoose,
  importPayload
} from './backup.js'
/*
 * ★ 用相对路径而不是 '@/utils/dialog.js' ★
 *   本文件会被 scripts/test-share-intent.mjs 直接 import 做纯逻辑测试，
 *   而 node 不认识 uni-app 的 @ 别名（api/db/diagnose.js 用 @/ 没关系，
 *   它不进任何 node 测试）。相对路径两边都能解析。
 */
import { confirmDialog, waitForDialogHost } from '../utils/dialog.js'

/* ------------------------------------------------------------------ 常量 */

/** 只接受这种大小的文件（本应用的备份一般几十 KB ~ 几 MB） */
const MAX_TEXT_BYTES = 8 * 1024 * 1024

/**
 * 同一个 uri 在这个时间窗内重复出现时只处理一次（毫秒）。
 *
 * ★ 为什么需要 ★
 *   冷启动时 onLaunch 和紧接着的 onShow 会各读一次 Intent；
 *   从后台切回来 onShow 也会反复命中同一个 uri。
 *   没有去重的话「打开一次文件 → 导入三次」，每次都先备份再清库，
 *   用户看到的是「一直在转圈」。
 */
const SAME_URI_WINDOW = 8000

/** readLine 的安全上限，防止某个畸形流让循环停不下来 */
const MAX_LINES = 400000

/* ------------------------------------------------------------------ 状态 */

const STATE = {
  /** 正在导入（防止 onLaunch / onShow / newintent 三方并发进同一份数据） */
  busy: false,
  /** uri -> 上次处理的时间戳 */
  handledAt: new Map(),
  /** 最近一次失败原因，供页面展示/排查 */
  lastError: ''
}

/** 测试用：重置内部状态 */
export function resetShareIntentState() {
  STATE.busy = false
  STATE.handledAt.clear()
  STATE.lastError = ''
}

export function getLastShareIntentError() {
  return STATE.lastError
}

/* ------------------------------------------------------ 1. 拿 intent 里的 uri */

function hasPlus() {
  return typeof plus !== 'undefined'
}

function isAndroid() {
  try {
    return hasPlus() && plus.os && plus.os.name === 'Android'
  } catch (e) {
    return false
  }
}

/** 看起来像「一个文件地址」的字符串 */
function looksLikeFileUri(s) {
  const v = String(s || '').trim()
  if (!v) return false
  if (/^(content|file):\/\//i.test(v)) return true
  if (/\.json$/i.test(v) && /^\/|^[a-zA-Z]:[\\/]/.test(v)) return true
  return false
}

/**
 * 从任意值里把文件地址挖出来。
 *
 * plus.runtime.arguments 的形状不固定：
 *   · ACTION_SEND  → JSON，key 是 Intent extra 原始名
 *                    （"android.intent.extra.STREAM"）
 *   · ACTION_VIEW  → 常见是裸 uri 字符串
 *   · URL Scheme   → "scheme://xxx?..."，带原始字符串
 * 所以这里做防御式解析，不假设任何一种。
 *
 * @param {any} raw
 * @param {string[]} out
 * @param {number} depth
 */
function digUris(raw, out, depth = 0) {
  if (raw === null || raw === undefined || depth > 4) return out

  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return out

    // 先试 JSON（arguments 大多数情况是 JSON 字符串）
    if (s.startsWith('{') || s.startsWith('[')) {
      try {
        digUris(JSON.parse(s), out, depth + 1)
        return out
      } catch (e) {
        // 不是 JSON，当普通字符串继续往下判
      }
    }

    /*
     * 从任意文本里抠出 URI。
     *
     * ★ 为什么不是「整串必须长得像 uri」★
     *   实际拿到的字符串常是混着的，例如：
     *     "share\ncontent://xxx/1.json\nfrom=wechat"
     *   用整串匹配会一个都取不到。所以先按模式抓子串。
     */
    const m = s.match(/(content|file):\/\/[^\s"'<>,]+/i)
    if (m) {
      out.push(m[0])
      return out
    }
    if (looksLikeFileUri(s)) out.push(s)
    return out
  }

  if (Array.isArray(raw)) {
    for (const v of raw) digUris(v, out, depth + 1)
    return out
  }

  if (typeof raw === 'object') {
    /*
     * 优先看这几个 key —— 它们分别对应：
     *   Intent.EXTRA_STREAM / getData() / 各家自定义的键
     * 但还是全量扫一遍，因为不同发送方 key 名字五花八门。
     */
    const PREFERRED = [
      'android.intent.extra.STREAM',
      'data',
      'uri',
      'url',
      'path',
      'file',
      'filePath',
      'stream'
    ]
    for (const k of PREFERRED) {
      if (Object.prototype.hasOwnProperty.call(raw, k)) digUris(raw[k], out, depth + 1)
    }
    for (const k of Object.keys(raw)) {
      if (PREFERRED.includes(k)) continue
      digUris(raw[k], out, depth + 1)
    }
  }
  return out
}

/**
 * 通道 a：读 plus.runtime.arguments
 * @returns {string[]}
 */
function urisFromRuntimeArguments() {
  if (!hasPlus()) return []
  try {
    const raw = plus.runtime.arguments
    if (!raw) return []
    return digUris(raw, [])
  } catch (e) {
    return []
  }
}

/** 把 Native.js 拿到的对象转成字符串（Uri/对象都能用） */
function toJsString(obj) {
  if (obj === null || obj === undefined) return ''
  if (typeof obj === 'string') return obj
  try {
    return String(plus.android.invoke(obj, 'toString'))
  } catch (e) {
    try {
      return String(obj)
    } catch (e2) {
      return ''
    }
  }
}

/**
 * 通道 b：Native.js 直接读当前 Activity 的 Intent
 *
 * @returns {string[]} 候选 uri（已去过空）
 */
function urisFromNativeIntent() {
  const out = []
  if (!hasPlus() || !plus.android) return out

  let intent = null
  try {
    const main = plus.android.runtimeMainActivity()
    intent = plus.android.invoke(main, 'getIntent')
  } catch (e) {
    return out
  }
  if (!intent) return out

  // getData()：ACTION_VIEW 的文件地址
  try {
    const data = plus.android.invoke(intent, 'getData')
    const s = toJsString(data)
    if (looksLikeFileUri(s)) out.push(s)
  } catch (e) {}

  /*
   * getParcelableExtra(EXTRA_STREAM)：ACTION_SEND 的文件地址。
   * 直接传 extra 的字面量（"android.intent.extra.STREAM"），
   * 免得去碰「静态字段不映射」那个坑。
   */
  try {
    const stream = plus.android.invoke(intent, 'getParcelableExtra', 'android.intent.extra.STREAM')
    const s = toJsString(stream)
    if (looksLikeFileUri(s)) out.push(s)
  } catch (e) {}

  // getClipData()：多选分享（SEND_MULTIPLE）时地址在 clipData 里
  try {
    const clip = plus.android.invoke(intent, 'getClipData')
    if (clip) {
      const count = Number(plus.android.invoke(clip, 'getItemCount')) || 0
      for (let i = 0; i < count; i++) {
        const item = plus.android.invoke(clip, 'getItemAt', i)
        if (!item) continue
        const uri = plus.android.invoke(item, 'getUri')
        const s = toJsString(uri)
        if (looksLikeFileUri(s)) out.push(s)
      }
    }
  } catch (e) {}

  // EXTRA_TEXT：有些 App 把路径塞在文本里（少见，但兜一下）
  try {
    const text = plus.android.invoke(intent, 'getStringExtra', 'android.intent.extra.TEXT')
    if (text) digUris(String(text), out)
  } catch (e) {}

  return out
}

/**
 * 收集本次启动/唤醒带来的所有文件地址（去重，按出现顺序）。
 *
 * @returns {string[]}
 */
export function collectIncomingUris() {
  const all = [...urisFromRuntimeArguments(), ...urisFromNativeIntent()]
  const out = []
  const seen = new Set()
  for (const u of all) {
    const v = String(u || '').trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

/** 本次是不是被文件「拉起来」的（用于决定要不要提示） */
export function hasIncomingIntent() {
  return collectIncomingUris().length > 0
}

/* ------------------------------------------------------ 2. 把地址读成文本 */

/**
 * 用 ContentResolver 打开任意 URI 的输入流，按行拼字符串。
 *
 * ★ 为什么按行读 ★
 *   Java 的 byte[] 过不了 Native.js 的桥，
 *   ByteArrayOutputStream + read(byte[]) 这条路在本基座是死的。
 *   BufferedReader.readLine() 每次只回一个 String，
 *   是唯一稳定的读法。
 *
 * @param {string} uriStr content:// 或 file://
 * @returns {string}
 */
function readTextByResolver(uriStr) {
  const main = plus.android.runtimeMainActivity()
  const resolver = plus.android.invoke(main, 'getContentResolver')
  if (!resolver) throw new Error('拿不到 ContentResolver')

  const uri = plus.android.invoke('android.net.Uri', 'parse', uriStr)
  if (!uri) throw new Error('地址无法解析：' + uriStr)

  const ins = plus.android.invoke(resolver, 'openInputStream', uri)
  if (!ins) {
    throw new Error(
      '这个文件打不开 —— 系统给的临时读取权限可能已经过期了。' +
      '请回到原来的应用，再点一次「用其他应用打开」。'
    )
  }

  /*
   * InputStreamReader 指定 UTF-8。
   * ★ 少数基座对 newObject 传 String 编码名会报错 ★
   *   那就退回默认编码再读一次 —— 至少 JSON 的 ASCII 结构还能解析，
   *   总比整个失败强。
   */
  let br = null
  try {
    const isr = plus.android.newObject('java.io.InputStreamReader', ins, 'UTF-8')
    br = plus.android.newObject('java.io.BufferedReader', isr)
  } catch (e) {
    const isr = plus.android.newObject('java.io.InputStreamReader', ins)
    br = plus.android.newObject('java.io.BufferedReader', isr)
  }
  if (!br) throw new Error('无法读取文件流')

  let out = ''
  let lines = 0
  try {
    for (;;) {
      const line = plus.android.invoke(br, 'readLine')
      // EOF 时 Java 返回 null，过桥后可能变成 null 或 undefined
      if (line === null || line === undefined) break
      out += String(line) + '\n'
      lines++
      if (lines > MAX_LINES) break
      if (out.length > MAX_TEXT_BYTES) break
    }
  } finally {
    try { plus.android.invoke(br, 'close') } catch (e) {}
  }

  if (!out) throw new Error('读到的是空文件')
  return out
}

/**
 * 读一个地址的文本内容。
 *
 * · _doc/xxx 这类 plus.io 虚拟路径 → readTextFile（只是转调，避免循环依赖，
 *   这里直接内联一份同样的实现）
 * · content:// / file:// → ContentResolver
 *
 * @param {string} uriStr
 * @returns {Promise<string>}
 */
export function readUriText(uriStr) {
  const uri = String(uriStr || '').trim()
  if (!uri) return Promise.reject(new Error('没有文件地址'))

  // 应用内相对路径（外部打开不会走到这里，但保留兼容，便于复用）
  if (!/^(content|file):\/\//i.test(uri)) {
    return readTextByPlusIo(uri)
  }

  if (!isAndroid()) {
    return Promise.reject(new Error('外部打开导入目前只支持 Android'))
  }

  return new Promise((resolve, reject) => {
    try {
      const text = readTextByResolver(uri)
      resolve(text)
    } catch (e) {
      reject(new Error((e && e.message) || '读取文件失败'))
    }
  })
}

/** plus.io 读应用目录里的文本（与 api/backup.js 的 readTextFile 同款） */
function readTextByPlusIo(path) {
  return new Promise((resolve, reject) => {
    if (!hasPlus()) {
      reject(new Error('文件读取仅在 App 端可用'))
      return
    }
    plus.io.resolveLocalFileSystemURL(
      path,
      (entry) => {
        entry.file(
          (file) => {
            const reader = new plus.io.FileReader()
            reader.onloadend = (e) => {
              const result =
                (e && e.target && e.target.result !== undefined && e.target.result) ||
                (e && e.result !== undefined && e.result) ||
                reader.result
              if (typeof result !== 'string') {
                reject(new Error('读取文件内容失败（内容不是文本）'))
                return
              }
              resolve(result)
            }
            reader.onerror = () => reject(new Error('读取文件失败'))
            reader.readAsText(file, 'utf-8')
          },
          () => reject(new Error('无法读取文件'))
        )
      },
      () => reject(new Error('文件不存在或路径无效: ' + path))
    )
  })
}

/* ------------------------------------------------------ 3. 导入 */

/**
 * 把一段文本当备份导入（导入前自动备份，由 importPayload 负责）。
 *
 * 校验交给 api/backup.js 的 importPayload —— 它会拒绝
 * 「不是本应用导出的文件」（app !== 'books'），
 * 所以随便打开一个别的 json 不会把数据清掉。
 *
 * @param {string} text
 * @param {object} opt { mode: 'merge' | 'overwrite' }
 * @returns {Promise<object>} 导入报告
 */
export async function importTextAsBackup(text, opt = {}) {
  const payload = parseJsonLoose(text)
  return importPayload(payload, { mode: opt.mode || 'overwrite' })
}

/**
 * 导入确认框的文案（外部打开与数据管理页的「预览确认框」共用）。
 *
 * ★ 抽出来是为了两边永远一致 ★
 *   数据管理页要放一个「预览确认框样式」的按钮，
 *   如果那边自己抄一份文案，以后改字就会对不上。
 */
export function buildImportConfirmOptions() {
  return {
    title: '导入这个文件？',
    content: '将清空当前全部数据，换成文件里的内容。导入前会自动备份一次，选错了还能恢复。',
    confirmText: '确定导入',
    cancelText: '我再想想',
    danger: true
  }
}

/**
 * 处理一次「外部打开」。
 *
 * 调用方：App.vue 的 onLaunch / onShow / newintent 监听。
 *
 * ★ 只弹一个确认框，不做模式选择 ★
 *   外部打开固定按「覆盖」导入（等于把这份文件当成新的账本）。
 *   破坏性操作，所以必须让用户先点「确定导入」；
 *   点「我再想想」返回 false，此时一个字节都不动。
 *   覆盖前 importPayload 会自己先 autoBackup('before-import')。
 *
 * @param {object} opt
 * @param {boolean} opt.silent  静默（失败不弹 toast，只记日志）
 * @param {boolean} opt.force   忽略同 uri 去重
 * @param {(report:object)=>Promise<void>|void} opt.onImported 导入成功后的回调
 * @returns {Promise<{handled:boolean, reason?:string, report?:object}>}
 */
export async function handleExternalOpen(opt = {}) {
  const { silent = false, force = false, onImported = null } = opt

  if (STATE.busy) return { handled: false, reason: 'busy' }

  const uris = collectIncomingUris()
  if (!uris.length) return { handled: false, reason: 'no-intent' }

  // 只挑第一个（多选分享时也只导入一份）
  const uri = uris[0]
  const now = Date.now()
  if (!force) {
    const prev = STATE.handledAt.get(uri)
    if (prev && now - prev < SAME_URI_WINDOW) {
      return { handled: false, reason: 'duplicate' }
    }
  }

  STATE.busy = true
  STATE.lastError = ''
  try {
    const text = await readUriText(uri)

    /*
     * ★ 先解析、再问人 ★
     *   顺序不能反：如果文件根本不是本应用的备份，
     *   先弹一个确认框再报错，用户会觉得被耍了。
     *   解析失败直接抛，落到下面的 catch 里。
     */
    const payload = parseJsonLoose(text)

    /*
     * ★ 等页面挂好宿主再弹窗 ★
     *   冷启动时 onLaunch 比任何页面都早，那一刻 hosts 是空的，
     *   弹窗会走 utils/dialog.js 的 1 秒兜底 → 退化成原生 showModal，
     *   样式和 App 里其它弹窗不一致。
     *   这里最多等 3 秒，等不到（极少数情况）也只能走兜底。
     */
    await waitForDialogHost(3000)

    const ok = await confirmDialog(buildImportConfirmOptions())
    // 点「我再想想」/ 点蒙层 → false，此时一个字节都不动
    if (!ok) return { handled: false, reason: 'canceled' }

    /*
     * ★ 全局统一用覆盖模式 ★
     *   外部打开的场景是「用户拿一份文件来恢复账本」，
     *   语义就是让这份文件成为新的账本。
     *   不做「合并」是刻意的：合并要先做去重/冲突处理，
     *   账目会悄悄变多，用户很难核对到底多出来什么。
     */
    const report = await importPayload(payload, { mode: 'overwrite' })
    STATE.handledAt.set(uri, Date.now())

    try {
      if (typeof onImported === 'function') await onImported(report)
    } catch (e) {
      console.warn('[share-intent] 导入后刷新失败:', e && e.message)
    }

    return { handled: true, report }
  } catch (e) {
    STATE.lastError = (e && e.message) || '导入失败'
    console.warn('[share-intent] 外部打开导入失败:', STATE.lastError)
    // 失败不记「已处理」—— 用户再点一次「用其他应用打开」应该还能重试
    if (!silent) {
      try {
        uni.showToast({ title: STATE.lastError.slice(0, 40), icon: 'none' })
      } catch (e2) {}
    }
    return { handled: false, reason: 'error', error: STATE.lastError }
  } finally {
    STATE.busy = false
  }
}

/* ------------------------------------------------------ 4. 事件挂钩 */

/**
 * 注册「应用在后台时被文件唤醒」的监听。
 *
 * ★ 为什么同时挂 newintent 和 onShow ★
 *   · newintent 是 DCloud 官方给的事件，但部分机型/时机不触发；
 *   · onShow 一定会触发，只是拿到的可能是旧 intent。
 *   两个都挂，靠 handleExternalOpen 里的 uri 去重兜住重复。
 *
 * @param {object} opt 透传给 handleExternalOpen
 * @returns {() => void} 取消监听
 */
export function installIncomingListener(opt = {}) {
  if (!hasPlus() || !plus.globalEvent) return () => {}

  const fire = (delay) => {
    // ★ 稍微等一下再读 ★
    //   系统授予 content:// 的临时读权限、以及原生层把 intent 交到 JS 侧，
    //   都可能有几十毫秒的延迟。立刻读容易拿到空。
    setTimeout(() => {
      handleExternalOpen(opt).catch(() => {})
    }, delay)
  }

  const onNewIntent = () => fire(300)
  try {
    plus.globalEvent.addEventListener('newintent', onNewIntent)
  } catch (e) {
    console.warn('[share-intent] newintent 监听失败:', e && e.message)
  }

  return () => {
    try {
      plus.globalEvent.removeEventListener('newintent', onNewIntent)
    } catch (e) {}
  }
}
