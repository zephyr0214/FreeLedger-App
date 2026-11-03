/**
 * AI 记账解析「失败重试」的测试
 *
 *   node scripts/test-ai-retry.mjs
 *
 * ★ 用户要求 ★
 *   「触发失败重试机制，5xx、429 这种报错直接重试，最多重试 2 次」
 *
 * ★ 实现 ★
 *   · api/ai.js 的 chat() 在 reject 时给错误挂结构化标记：
 *       err.status（HTTP 状态码）/ err.isTimeout / err.networkFail
 *     错误文案不变 —— 纯增量，不影响任何现有展示。
 *   · api/aiParse.js 的解析调用套了重试循环：
 *       isRetryableAiError(e) 为真 -> 退避 1s / 2s 再试，最多 2 次；
 *       重试耗尽后错误信息追加「（已自动重试 N 次）」。
 *
 * ★ 这里测两层 ★
 *   1. isRetryableAiError 纯函数：哪些错误该重试、哪些重试是浪费
 *   2. 源码级断言：标记确实挂在 chat() 的各 reject 点上、
 *      重试循环确实存在且上限是 2
 */

import { isRetryableAiError } from '../api/aiParse.js'

let pass = 0
let fail = 0

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    fail++
    console.log(`FAIL  ${name}\n      实际 ${a}\n      期望 ${e}`)
  }
}

/* --------------------------------------- 1. 哪些错误该重试 */

console.log('=== 可重试：临时性故障（5xx / 429 / 网络没建立）===')

check('429 限流', isRetryableAiError(errWith({ status: 429 })), true)
check('500 服务端错误', isRetryableAiError(errWith({ status: 500 })), true)
check('502 网关错误', isRetryableAiError(errWith({ status: 502 })), true)
check('503 暂不可用', isRetryableAiError(errWith({ status: 503 })), true)
check('网络故障（DNS/断网）', isRetryableAiError(errWith({ networkFail: true })), true)

function errWith(flags) {
  const e = new Error('测试错误')
  Object.assign(e, flags)
  return e
}

console.log('=== 不可重试：重试注定得到同样的结果 ===')

check('401 Key 错', isRetryableAiError(errWith({ status: 401 })), false)
check('404 地址错', isRetryableAiError(errWith({ status: 404 })), false)
check('400 参数错', isRetryableAiError(errWith({ status: 400 })), false)
/*
 * ★ 超时不重试 ★
 *   每次重试都要重新烧满整个超时预算 ——
 *   3 次 × 30 秒 = 干等 90 秒，界面根本等不起。
 *   且超时多半是「模型慢」，再快也快不过重试的代价。
 */
check('超时', isRetryableAiError(errWith({ isTimeout: true })), false)
/*
 * ★ HTTP 200 但内容不可用不重试 ★
 *   解析的 temperature 是 0 —— 同样的输入会得到同样的输出，
 *   重试一遍大概率还是抽不出 JSON，白花一次钱。
 */
check('内容为空/截断（无状态码）', isRetryableAiError(errWith({ truncated: true })), false)
check('裸 Error（无任何标记）', isRetryableAiError(new Error('未知错误')), false)
check('null', isRetryableAiError(null), false)

/* --------------------------------------- 2. 标记确实挂在 chat() 的 reject 点上 */

console.log('=== chat() 的错误必须带结构化标记 ===')

{
  const { readFileSync: rd } = await import('fs')
  const { join, dirname, resolve } = await import('path')
  const { fileURLToPath } = await import('url')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const aiCode = rd(join(ROOT, 'api', 'ai.js'), 'utf-8')

  // HTTP 非 2xx -> err.status（中间隔了一段注释，放宽窗口）
  check('非 2xx 挂 err.status', /extractError\(res\)[\s\S]{0,400}err\.status\s*=\s*res\.statusCode/.test(aiCode), true)
  // 计时器超时 -> err.isTimeout
  check('计时器超时挂 err.isTimeout', /isTimeout\s*=\s*true/.test(aiCode), true)
  // uni.request fail 且非超时 -> err.networkFail
  check('网络层失败挂 err.networkFail', /networkFail\s*=\s*true/.test(aiCode), true)
  /*
   * ★ 超时分支必须先 return，不能落到 networkFail ★
   *   否则超时会被误判成「可重试的网络故障」，
   *   3 次 × 30 秒的干等就是这么来的。
   */
  check('超时分支先 return（不会落到 networkFail）', /timeoutErr\.isTimeout\s*=\s*true\s*\n\s*reject\(timeoutErr\)\s*\n\s*return/.test(aiCode), true)
}

/* --------------------------------------- 3. 重试循环存在且上限是 2 */

console.log('=== 解析调用套了重试循环 ===')

{
  const { readFileSync: rd } = await import('fs')
  const { join, dirname, resolve } = await import('path')
  const { fileURLToPath } = await import('url')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const parseCode = rd(join(ROOT, 'api', 'aiParse.js'), 'utf-8')

  check('重试上限是 2', /MAX_PARSE_RETRIES\s*=\s*2/.test(parseCode), true)
  check('循环里用了 isRetryableAiError', /isRetryableAiError\(e\)/.test(parseCode), true)
  check('有退避等待（1 秒 × 次数递增）', /setTimeout\(resolve,\s*1000\s*\*\s*attempt\)/.test(parseCode), true)
  check('重试耗尽后提示已重试', /已自动重试/.test(parseCode), true)
  // 重试只包着 chat() 调用本身 —— 解析后续的 JSON 提取/校验失败不在重试范围
  // （temperature=0，重试解析步骤只会得到同样的结果）
  check('解析不硬编码超时（设置生效，见 test-ai-timeout）', !/timeoutMs:\s*\d/.test(parseCode), true)
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) process.exit(1)
