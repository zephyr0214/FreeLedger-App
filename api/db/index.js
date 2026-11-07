/**
 * DAO 门面 —— 对上层只暴露 open / query / execute / transaction
 *
 * 为什么不让业务层直接用 plus.sqlite：
 *   1. plus.sqlite 全是回调式 API，业务层写下去会形成回调地狱
 *   2. 参数占位符在不同内核版本下支持程度不一致，需要统一在这里做绑定
 *   3. 事务必须手动 begin/commit，散落在业务层极易漏掉导致余额错乱
 */

import {
  SCHEMA_V1, INDEXES_V1, SCHEMA_VERSION,
  RECONCILE_CATEGORIES, RECONCILE_LEGACY_NAME,
  DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES,
  SYSTEM_PRESET_GROUPS, SYSTEM_PRESET_CHILDREN,
  SYSTEM_PRESET_GROUP_NAME, SYSTEM_PRESET_LEGACY_NAME,
  childIcon, childColor
} from './schema.js'
// ★ utils/id.js 是纯函数（不碰数据库），在迁移里用它生成 id 不会有循环依赖 ★
import { prefixedId } from '../../utils/id.js'
// ★ date.js 也是纯函数 ★
import { toDayKey } from '../../utils/date.js'

const DB_NAME = 'books'
const DB_PATH = '_doc/books.db'

let opened = false
let opening = null

/**
 * 运行时判定 SQLite 是否可用。
 *
 * ★ 不能写成模块级常量 ★
 *   ES 模块在 App 启动早期就被求值，此时 plus 可能还没注入，
 *   一旦缓存成 false 就永远 false，后面所有数据库操作都会报"仅 App 端可用"。
 *   所以每次调用都要重新读。
 */
function isSqliteReady() {
  return typeof plus !== 'undefined' && !!plus.sqlite
}

/**
 * 等待 plus 就绪。
 * 标准基座下 plus 在 onLaunch 前后才注入；云打包下也有极短的空窗。
 * 用轮询避免"明明在真机上却说不能用"。
 */
function waitForPlus(timeoutMs = 3000) {
  if (isSqliteReady()) return Promise.resolve(true)

  return new Promise((resolve, reject) => {
    const start = Date.now()
    const timer = setInterval(() => {
      if (isSqliteReady()) {
        clearInterval(timer)
        resolve(true)
        return
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer)
        reject(new Error(
          'plus.sqlite 不可用。请确认：\n' +
          '1) 运行在 App 端（不能是 H5 / 小程序）\n' +
          '2) manifest.json → App模块配置 中已勾选 SQLite\n' +
          '3) 使用标准基座或已重新云打包'
        ))
      }
    }, 50)
  })
}

/* ------------------------------------------------------------------ 工具 */

/** 把 ? 占位符替换为转义后的字面量，避免依赖内核的 prepared statement 能力 */
function bindParams(sql, params) {
  if (!params || params.length === 0) return sql
  let i = 0
  return sql.replace(/\?/g, () => {
    const v = params[i++]
    if (v === null || v === undefined) return 'NULL'
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return 'NULL'
      return String(v)
    }
    if (typeof v === 'boolean') return v ? '1' : '0'
    // 字符串：单引号转义
    return `'${String(v).replace(/'/g, "''")}'`
  })
}

/**
 * 调用 plus.sqlite 的某个方法。
 *
 * ★ 必须传方法名而不是函数引用 ★
 *   plus.sqlite.openDatabase / selectSql / executeSql 是 HTML5+ 的桥接方法，
 *   内部依赖 this.getCallbackIDByFunction。若写成 call(plus.sqlite.selectSql, ...)，
 *   方法被摘下来单独调用，this 变成 undefined，就会抛：
 *     "this.getCallbackIDByFunction is not a function"
 *   所以统一用 plus.sqlite[method](arg) 的形式，在对象上调用。
 *
 * @param {string} method 方法名，如 'selectSql'
 * @param {object} arg 参数
 */
function call(method, arg) {
  return new Promise((resolve, reject) => {
    if (!isSqliteReady()) {
      reject(new Error('plus.sqlite 不可用，请确认运行在 App 端且已勾选 SQLite 模块'))
      return
    }
    const api = plus.sqlite
    if (typeof api[method] !== 'function') {
      reject(new Error(`plus.sqlite.${method} 不存在，可能该模块未打包进基座`))
      return
    }
    api[method]({
      ...arg,
      success: resolve,
      fail: (e) => {
        const code = e && e.code !== undefined ? e.code : ''
        const msg = (e && e.message) || ''
        reject(new Error(`SQLite 执行失败${code !== '' ? ` (code ${code})` : ''}${msg ? `: ${msg}` : ''}`))
      }
    })
  })
}

/* ------------------------------------------------------------ 打开与迁移 */

async function readUserVersion() {
  try {
    const rows = await call('selectSql', {
      name: DB_NAME,
      sql: 'PRAGMA user_version'
    })
    if (rows && rows.length > 0) {
      const first = rows[0]
      return Number(first.user_version !== undefined ? first.user_version : Object.values(first)[0]) || 0
    }
  } catch (e) {
    // 库尚未建立或该语法不支持，视为 0
  }
  return 0
}

async function writeUserVersion(v) {
  try {
    await call('executeSql', { name: DB_NAME, sql: `PRAGMA user_version = ${Number(v)}` })
  } catch (e) {
    // ★ 写版本号失败不能挡住开库 ★
    //   最坏结果是下次启动再跑一遍迁移（迁移都是幂等的）。
    console.warn('[db] write user_version failed:', e && e.message)
  }
}

/** 执行建表与索引 —— 幂等，用 IF NOT EXISTS */
async function applySchemaV1() {
  for (const sql of SCHEMA_V1) {
    await call('executeSql', { name: DB_NAME, sql })
  }
  for (const sql of INDEXES_V1) {
    try {
      await call('executeSql', { name: DB_NAME, sql })
    } catch (e) {
      // 索引已存在或内核不支持该语法时不影响主流程
      console.warn('[db] index skipped:', e.message)
    }
  }
}

/**
 * 迁移表。每次结构变更追加一条，up 内只做增量 DDL。
 * 注意：SQLite 不支持 DROP COLUMN 的老版本，需要重建表，届时单独处理。
 */
const MIGRATIONS = [
  {
    version: 1,
    up: applySchemaV1
  },
  {
    // ★ 修复历史记录的「12:00」★
    //   旧逻辑只要传了日期就把时刻写死成当天中午，
    //   所以历史数据 occurred_at 全部落在 12:00:00。
    //   这里按 created_at（记录真正被创建的时刻）回填：
    //   只有 occurred_day 等于「记录创建那天」的才回填，
    //   「补记昨天」这类本来就该是过去时刻的不动。
    //   ★ 时区换算放在 JS 里做 ★
    //     SQLite 的 strftime 按 UTC 算，直接在 SQL 里换本地日期会差一天。
    version: 2,
    up: fixNoonTimestamps
  },
  {
    // ★ txn 表加「不计入预算」标记 ★
    //   有些支出（比如一次性的大额购物、退款、报销）不该算进预算额度。
    //   用一个 0/1 字段标记，预算统计时排除掉。
    //
    //   用 ALTER TABLE ADD COLUMN 而不是改表结构重建 ——
    //   SQLite 的 ADD COLUMN 是 O(1) 的元数据操作，不动数据，
    //   而且老版本内核也支持。
    version: 3,
    up: async () => {
      try {
        await call('executeSql', {
          name: DB_NAME,
          sql: 'ALTER TABLE txn ADD COLUMN exclude_from_budget INTEGER NOT NULL DEFAULT 0'
        })
        console.log('[db] migration v3: txn.exclude_from_budget 已添加')
      } catch (e) {
        // 字段已存在（重复执行）时会报错，忽略即可
        if (e && /duplicate|already exists/i.test(e.message || '')) {
          console.log('[db] migration v3: exclude_from_budget 已存在，跳过')
        } else {
          throw e
        }
      }
    }
  },
  {
    // ★ 「对账调整」拆成两个固定的一级分类 ★
    //   旧结构：expense 下有一个一级「对账调整」，下面挂二级
    //          「对账支出」「对账收入」（income 下同理）。
    //   新结构：expense 下直接是一级「对账支出」，
    //          income 下直接是一级「对账收入」，
    //          两条都是固定分类（分类管理里不可改名/改图标/删除）。
    //
    //   详见 migrateReconcileCategories()。
    version: 4,
    up: migrateReconcileCategories
  },
  {
    // ★ 默认分类重建成新的分类表 ★
    //   老库里存的是旧结构（餐饮/交通/购物/居住/娱乐/医疗/教育/人情/其他…），
    //   用户要求换成新的分类表（餐饮食品/交通出行/居住住房/购物消费…）。
    //
    //   ★ 为什么必须靠迁移，不能靠 seedDefaultCategories ★
    //     seedDefaultCategories() 只在「分类表一条都没有」时才写，
    //     老用户库里有旧分类，走不到那里 —— 改代码对他们没有任何效果。
    //     只有全新安装才看得到新分类。这就是「改了却没生效」的原因。
    //
    //   详见 rebuildDefaultCategories()。
    version: 5,
    up: rebuildDefaultCategories
  },
  {
    // ★ 二级分类改为独立图标 ★
    //   v5 的分类表里，二级分类的 icon 直接继承了父级
    //   （「早餐」「午餐」「晚餐」全是同一个 🍜）。
    //   用户要求每个子类都能有自己的图标。
    //
    //   这里**不重建分类表** —— 重建会把用户的分类改动和历史交易引用
    //   全部打乱（v5 迁移已经干过一次那样的事，代价太大）。
    //   只按「一级分类名 + 二级分类名」把 icon 改对就行：
    //   用户自己新建的分类不受影响（名字对不上就不动）。
    //
    //   详见 applyChildCategoryIcons()。
    version: 6,
    up: applyChildCategoryIcons
  },
  {
    // ★ 周期管理 ★
    //   新建 cycle 表（周期规则），并在 txn 表加 cycle_id 列
    //   （关联「这笔流水是由哪个周期记出来的」）。
    //   用 ADD COLUMN 是 O(1) 元数据操作，不动已有数据。
    version: 7,
    up: migrateCycles
  },
  {
    // ★ 周期自动补记的游标 ★
    //   cycle 表加 last_caught_up_day（YYYY-MM-DD），
    //   catchUpCycles() 只处理晚于游标的日期，避免重复/重建已删的账。
    version: 8,
    up: migrateCycleCursor
  },
  {
    // ★ 记录「用户主动不要的那一天」★
    //   v8 的游标只能防「同一天重复补」，防不住「用户删掉了那一笔，
    //   下次进 App 又被补回来」——因为删的是 txn 行，游标已经推过去了，
    //   而 cycleHasTxnOn 查不到已软删的行，就当没记过。
    //   这张表专门记录被用户放弃的发生日，补记时跳过。
    version: 9,
    up: migrateCycleSkips
  },
  {
    // ★ 停用「来源 / 速记原文」★
    //   用户要求交易详情不再显示这两项，数据库也不再记录。
    //   老库里这两列还在（SQLite 删列要重建表，风险高），
    //   所以迁移只做「清空历史值」，新写入的代码完全不再碰它们。
    version: 10,
    up: migrateDropTxnSource
  },
  {
    // ★ 组合账户 ★
    //   新增成员表 + txn.via_combo_id（记录这笔是通过哪个组合花的，
    //   纯标记、不参与任何计算）。
    version: 11,
    up: migrateComboAccounts
  },
  {
    // ★ AI 设置调整 ★
    //   1) 超时 20s → 30s（深度思考响应慢，20 秒太紧）
    //   2) 把旧的 ai.temperature 搬到 aiChat.temperature
    //   3) 删掉从未生效的 aiCache
    version: 12,
    up: migrateAiSettings
  },
  {
    // ★ 对话 maxTokens 2000 → 8000 ★
    //   max_tokens 同时限制「思考」和「正文」——
    //   推理模型光思考就把 2000 的预算吃光了，
    //   正文一个字都写不出来（content 空 + finish_reason=length）。
    version: 13,
    up: migrateChatMaxTokens
  },
  {
    // ★ 「系统预置分类」固定分类组 ★
    //   把「对账支出 / 对账收入」从独立的一级分类收进
    //   一级分类「系统预置分类」下面，并补上「借出 / 借入」两个固定子类。
    //   详见 migrateSystemPresetCategories()。
    version: 14,
    up: migrateSystemPresetCategories
  },
  {
    // ★ 补上「借款收回 / 借款归还」★
    //   v14 只建了「借出」「借入」两个固定子类，
    //   账面上看不出「借出去的钱收回来多少」「借来的钱还了多少」。
    //   v15 把这两个反向分类补进「系统预置分类」。
    //   详见 migrateLoanReturnCategories()。
    version: 15,
    up: migrateLoanReturnCategories
  },
  {
    // ★ 分类改名：借出收回 -> 借款收回、借入归还 -> 借款归还 ★
    //   用户要求全局统一叫「借款收回 / 借款归还」。
    //   改代码只能影响新装的库，老库里那两个分类名还是旧的，
    //   所以必须走迁移把已有行改名（保留 id，历史流水的引用不断）。
    //   详见 migrateRenameLoanCategories()。
    version: 16,
    up: migrateRenameLoanCategories
  },
  {
    /*
     * ★ v17 —— 外币记账支持 ★
     *
     *   1. txn 加原币快照三列（全部可空/带默认）：
     *        original_currency       币种代码（NULL = 人民币）
     *        original_amount_cents   原币金额（分）
     *        exchange_rate           记账时汇率（1 原币 = rate CNY）
     *      ★ 核心原则：amount_cents 仍是折算后的 CNY 分 ★
     *        所有统计/预算/资产只认它，一笔不用改；
     *        原币只是快照，丢了也不影响账目（但会丢展示信息）。
     *
     *   2. 新建 exchange_rate 汇率历史表（day, currency 唯一）：
     *        周期补记要用「发生日当天」的汇率，一天一价；
     *        拉到就落表复用，离线时表里最近的汇率就是兜底。
     *
     *   老数据兼容：全部列可空，老交易原样 = 人民币交易，行为零变化。
     */
    version: 17,
    up: migrateMultiCurrency
  },
  {
    /*
     * ★ v18 —— 子预算支持「自定义名称 + 一个子预算挂多个类别」★
     *
     *   1. budget 加 name 列（可空）：子预算的名字由用户自己起；
     *      月预算（scope='total'）不用它，恒为 NULL。
     *   2. 新建 budget_category 关联表：一条子预算可以有任意多个类别。
     *      原来的 budget.category_id 保留下来当「第一个类别」的冗余列，
     *      这样万一用户回退到老版本 App，老代码还能读到一条类别，
     *      不至于整条子预算显示成「已删除分类」。
     *   3. 回填：老的「一条子预算一个类别」全部搬进关联表，
     *      不改任何金额、不改 start_month —— 升级后预算数字完全一致。
     *
     * ★ 为什么必须做迁移而不是用 setting 存 JSON ★
     *   预算要参与统计聚合（GROUP BY 类别），存 JSON 就得把预算全捞到
     *   JS 里算，多类别关联也没法 JOIN —— 数据量小的时候没事，
     *   但口径会和交易统计彻底分家，越往后越难维护。
     *
     * ★ 必须用底层 call()，不能 query()/execute()（openDb 内死锁，见 v16 注释）★
     */
    version: 18,
    up: migrateBudgetCategories
  },
  {
    /*
     * ★ v19 —— 借入借出不计入收支 + 借出结清的两个派生分类 ★
     *
     *   1. txn 加 exclude_from_stats 列（默认 0）。
     *      与 exclude_from_budget 是两个独立语义：
     *        预算只关心「这笔支出占不占额度」；
     *        收支关心「这笔钱算不算我的花销/收入」。
     *      一笔借款既不该占预算、也不该算收支，所以两个都要打标；
     *      但一笔代购/报销可能不占预算、却要算收支 —— 不能合并成一个字段。
     *
     *   2. 把四类借款流水（借出/借入/借款收回/借款归还）的回填成
     *      exclude_from_stats = 1、exclude_from_budget = 1。
     *      ★ 只回填这四类的历史数据 ★
     *        其它分类的历史流水一律不动，升级后统计数字只有
     *        「借款不再算收支」这一处变化，其余分毫不变。
     *
     *   3. 建「借出坏账」（expense）与「借出利息」（income）两个
     *      hidden=1 的派生分类，供借出管理页的「手动结清」写入。
     *
     * ★ 为什么回填要放在迁移里，而不是每次查询时 JOIN 分类名判断 ★
     *   用户可以在分类管理里给这四类改颜色/图标（名字锁死但行仍可改），
     *   而更关键的是：性能。每一条统计 SQL 都多一个 JOIN 是长期代价，
     *   一个 0/1 字段的存储代价几乎为零，查询还能走条件过滤。
     */
    version: 19,
    up: migrateLoanExcludeAndSettleCategories
  }
]

/**
 * 迁移 v13 —— 对话 maxTokens 2000 → 8000
 *
 * ★ 为什么需要单独一条迁移 ★
 *   v12 已经在有些设备上跑过了（user_version 已经写成 12），
 *   不会再执行。所以「把 maxTokens 提上去」这件事
 *   必须放在一条新的迁移里，不然老用户永远改不了。
 *
 * ★ 只改「恰好等于旧默认值 2000」的 ★
 *   用户自己设过别的数的一律不动 ——
 *   迁移只迁默认值，不覆盖用户的个性化设置。
 *
 * ★ 为什么必须用底层的 call()，不能用 query()/execute() ★
 *   query()/execute() 内部会 await openDb()，
 *   而本函数正是在 openDb() -> migrate() 里被调用的，会死锁。
 */
async function migrateChatMaxTokens() {
  const select = async (sql, params) => {
    try {
      const rows = await call('selectSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return Array.isArray(rows) ? rows : []
    } catch (e) {
      console.warn('[db] migration v13 select failed:', e && e.message)
      return null
    }
  }

  const run = async (sql, params) => {
    try {
      await call('executeSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return true
    } catch (e) {
      console.warn('[db] migration v13 exec failed:', e && e.message)
      return false
    }
  }

  const rows = await select('SELECT value FROM setting WHERE key = ?', ['aiChat'])
  if (!rows || rows.length === 0) return

  try {
    const chat = JSON.parse(rows[0].value)
    if (!chat || typeof chat !== 'object') return
    if (Number(chat.maxTokens) !== 2000) return

    chat.maxTokens = 8000
    await run('UPDATE setting SET value = ? WHERE key = ?', [JSON.stringify(chat), 'aiChat'])
    console.log('[db] migration v13: 对话 maxTokens 2000 → 8000')
  } catch (e) {}
}

/**
 * 迁移 v12 —— AI 设置调整
 *
 * ★ 为什么需要迁移 ★
 *   之前把「AI 对话」和「AI 记账」的设置拆开了（settings.aiChat），
 *   但老用户库里只有 settings.ai 一个对象。
 *   如果不迁移：
 *     · 超时还是老的 20 秒 → 深度思考必然超时
 *     · 老用户调过的 temperature 会丢
 *
 * ★ 为什么超时只从 20 改成 30，不动别的 ★
 *   只改「恰好等于旧默认值 20000」的那些 ——
 *   用户自己手动改过超时（哪怕也填的别的数）的，一律不动。
 *   这是迁移的标准做法：只迁默认值，不覆盖用户的个性化设置。
 *
 * ★ 为什么必须用底层的 call()，不能用 query()/execute() ★
 *   query()/execute() 内部会 await openDb()，
 *   而本函数正是在 openDb() -> migrate() 里被调用的，会死锁。
 *   （v2 / v4 / v5 / v6 都踩过这个坑，见那边的注释。）
 */
async function migrateAiSettings() {
  const select = async (sql, params) => {
    try {
      const rows = await call('selectSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return Array.isArray(rows) ? rows : []
    } catch (e) {
      console.warn('[db] migration v12 select failed:', e && e.message)
      return null
    }
  }

  const run = async (sql, params) => {
    try {
      await call('executeSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return true
    } catch (e) {
      console.warn('[db] migration v12 exec failed:', e && e.message)
      return false
    }
  }

  // ---- 1) 超时：只把「旧默认值 20000」提到 30000 ----
  const rows = await select('SELECT key, value FROM setting WHERE key = ?', ['ai'])
  if (rows && rows.length > 0) {
    let ai = null
    try {
      ai = JSON.parse(rows[0].value)
    } catch (e) {
      ai = null
    }
    if (ai && typeof ai === 'object') {
      // ★ 只迁默认值：用户改过别的数就不动 ★
      if (Number(ai.timeoutMs) === 20000) {
        ai.timeoutMs = 30000
        await run(
          'UPDATE setting SET value = ? WHERE key = ?',
          [JSON.stringify(ai), 'ai']
        )
        console.log('[db] migration v12: AI 超时 20s → 30s')
      }
    }
  }

  // ---- 2) 旧的 ai.temperature → aiChat.temperature ----
  const chatRows = await select('SELECT value FROM setting WHERE key = ?', ['aiChat'])
  const hasChat = !!(chatRows && chatRows.length > 0)

  if (!hasChat) {
    // 还没有 aiChat 这一项：建一个，老用户调过的 temperature 带过去
    const aiRows = await select('SELECT value FROM setting WHERE key = ?', ['ai'])
    let legacyTemp = null
    if (aiRows && aiRows.length > 0) {
      try {
        const ai = JSON.parse(aiRows[0].value)
        if (ai && typeof ai === 'object' && ai.temperature !== undefined && ai.temperature !== null) {
          legacyTemp = Number(ai.temperature)
        }
      } catch (e) {}
    }
    const aiChat = {
      temperature: legacyTemp === null ? 0.6 : legacyTemp,
      deepThinking: true,
      showCharts: true,
      // 回答超时：深度思考 + 完整分析可能要一两分钟
      timeoutMs: 120000,
      // ★ 8000 而不是 2000 ★
      //   max_tokens 同时限制「思考」和「正文」，
      //   推理模型思考起来几千 token 就吃光了，
      //   预算给小了正文一个字都写不出来。
      maxTokens: 8000
    }
    await run(
      'INSERT OR REPLACE INTO setting (key, value) VALUES (?, ?)',
      ['aiChat', JSON.stringify(aiChat)]
    )
    console.log('[db] migration v12: 已创建 aiChat 设置')
  } else {
    /*
     * ---- 2b) aiChat 已存在：把旧的 maxTokens 提上来 ----
     *   之前默认是 2000，对开着深度思考的推理模型来说太小 ——
     *   模型光思考就把预算吃光，正文是空的
     *   （报「AI 返回内容为空：模型输出被 max_tokens 截断」）。
     *
     *   只提「恰好等于旧默认值 2000」的 ——
     *   用户自己设过别的数的不动。
     */
    try {
      const raw = chatRows[0].value
      const chat = JSON.parse(raw)
      if (chat && typeof chat === 'object' && Number(chat.maxTokens) === 2000) {
        chat.maxTokens = 8000
        await run(
          'UPDATE setting SET value = ? WHERE key = ?',
          [JSON.stringify(chat), 'aiChat']
        )
        console.log('[db] migration v12: 对话 maxTokens 2000 → 8000')
      }
    } catch (e) {}
  }

  // ---- 3) 清掉从未生效的 aiCache ----
  //   那套缓存（readCache / writeCache / hashSummary）从来没有调用方，
  //   aiCache 这一项永远是空的，属于纯垃圾数据。
  await run('DELETE FROM setting WHERE key = ?', ['aiCache'])

  // ---- 4) ai 里去掉废弃字段 ----
  const aiRows2 = await select('SELECT value FROM setting WHERE key = ?', ['ai'])
  if (aiRows2 && aiRows2.length > 0) {
    try {
      const ai = JSON.parse(aiRows2[0].value)
      if (ai && typeof ai === 'object' && ai.quickFallback !== undefined) {
        delete ai.quickFallback
        await run('UPDATE setting SET value = ? WHERE key = ?', [JSON.stringify(ai), 'ai'])
      }
    } catch (e) {}
  }
}

/**
 * 迁移 v11 —— 组合账户
 *
 * 组合账户不是一个真的账户：它没有余额、不计入总资产，
 * 记账时按顺序解析成某一个真实账户，钱实际记在真实账户名下。
 * 因此只需要两张东西：
 *
 *   1. account_combo_member 表 —— 描述「由哪些真实账户、按什么顺序组成」
 *   2. txn.via_combo_id 列     —— 这笔钱是经由哪个组合花出去的
 *
 * ★ via_combo_id 为什么值得加 ★
 *   流水本身落在真实账户上，组合的痕迹就消失了。
 *   加上这一列后，「我当时是从哪个组合付的」这个信息还在，
 *   将来想按组合维度看统计也有数据可用；它对余额/预算零影响。
 */
async function migrateComboAccounts() {
  try {
    await call('executeSql', {
      name: DB_NAME,
      sql: `CREATE TABLE IF NOT EXISTS account_combo_member (
        combo_id  TEXT    NOT NULL,
        member_id TEXT    NOT NULL,
        sort      INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (combo_id, member_id)
      )`
    })
    console.log('[db] migration v11: account_combo_member 表已创建')
  } catch (e) {
    console.warn('[db] migration v11 combo 表失败:', e && e.message)
  }

  try {
    await call('executeSql', {
      name: DB_NAME,
      sql: 'ALTER TABLE txn ADD COLUMN via_combo_id TEXT'
    })
    console.log('[db] migration v11: txn.via_combo_id 已添加')
  } catch (e) {
    // 已存在（重复迁移 / 新装库已含该列）时忽略
    console.log('[db] migration v11: txn.via_combo_id 已存在，跳过')
  }

  try {
    await call('executeSql', {
      name: DB_NAME,
      sql: 'CREATE INDEX IF NOT EXISTS idx_combo_member ON account_combo_member(combo_id, sort)'
    })
  } catch (e) {
    console.warn('[db] migration v11 索引失败:', e && e.message)
  }
}

/**
 * 迁移 v10 —— 停用 txn.source / txn.raw_text
 *
 * ★ 为什么不清退这两列，只清空值 ★
 *   SQLite 3.35 之前不支持 DROP COLUMN，而 App 端的 SQLite 版本
 *   取决于系统 WebView / 原生库，不能假设一定够新。
 *   走「建新表 → 拷数据 → 删旧表 → 改名」虽然能真正删列，
 *   但一旦中途失败，用户的账目数据就危险了。
 *
 *   这两列只是**附加信息**（来源标签、AI 速记原文），
 *   留着空列不影响任何功能，代价只是几百字节。
 *   所以这里只把历史值抹掉（保护隐私：不再留速记原文），
 *   代码侧彻底不再读写它们 —— 效果等同于「数据库里不记录」。
 */
async function migrateDropTxnSource() {
  try {
    await call('executeSql', {
      name: DB_NAME,
      sql: 'UPDATE txn SET raw_text = NULL, source = NULL'
    })
    console.log('[db] migration v10: 已清空 txn.source / txn.raw_text 历史值')
  } catch (e) {
    // 列可能本来就不存在（新装库），不算错误
    console.warn('[db] migration v10 清理失败（可忽略）:', e && e.message)
  }
}

/**
 * 迁移 v9 —— 周期「跳过日」记录表
 *
 * ★ 解决什么问题 ★
 *   用户主动做了下面任一操作后，那一天不应该再被自动补记：
 *     · 建周期时选择「本天先不记一笔」
 *     · 主动把今天已经补记的周期流水删掉
 *   原来的实现只靠 last_caught_up_day 游标：
 *   游标已经推到今天，删掉 txn 后下次进 App 时
 *   cycleHasTxnOn（只查 deleted_at IS NULL）查不到，
 *   于是认为「这天没记过」，又补一笔回来 —— 死循环。
 *
 *   所以单独记一张表：cycle_id + day 唯一，
 *   只要用户表达过「这天不要」，补记就永远跳过这一天。
 */
async function migrateCycleSkips() {
  try {
    await call('executeSql', {
      name: DB_NAME,
      sql: `CREATE TABLE IF NOT EXISTS cycle_skip (
        cycle_id TEXT NOT NULL,
        day TEXT NOT NULL,
        created_at INTEGER,
        PRIMARY KEY (cycle_id, day)
      )`
    })
    console.log('[db] migration v9: cycle_skip 表已创建')
  } catch (e) {
    console.warn('[db] migration v9 cycle_skip 失败:', e && e.message)
  }
}

/**
 * 迁移 v7 —— 周期管理
 *
 * 1) 新建 cycle 表（周期规则：每天 / 每周几 / 每月几号）。
 * 2) txn 表加 cycle_id 列，关联「这笔流水由哪个周期记出」。
 *
 * ★ 为什么用 call() 而不是 query()/execute() ★
 *   迁移在 openDb() 内部跑，走 query()/execute() 会 await openDb() 死锁。
 */
async function migrateCycles() {
  try {
    await call('executeSql', {
      name: DB_NAME,
      sql: `CREATE TABLE IF NOT EXISTS cycle (
        id            TEXT PRIMARY KEY,
        type          TEXT    NOT NULL,
        amount_cents  INTEGER NOT NULL,
        account_id    TEXT    NOT NULL,
        to_account_id TEXT,
        category_id   TEXT,
        note          TEXT,
        recurrence    TEXT    NOT NULL DEFAULT 'monthly',
        weekday       INTEGER,
        day_of_month  INTEGER,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        deleted_at    INTEGER
      )`
    })
    console.log('[db] migration v7: cycle 表已创建')
  } catch (e) {
    console.warn('[db] migration v7 cycle 表失败:', e && e.message)
  }

  try {
    await call('executeSql', {
      name: DB_NAME,
      sql: 'ALTER TABLE txn ADD COLUMN cycle_id TEXT'
    })
    console.log('[db] migration v7: txn.cycle_id 已添加')
  } catch (e) {
    // 字段已存在（重复执行）时忽略
    if (e && /duplicate|already exists/i.test(e.message || '')) {
      console.log('[db] migration v7: txn.cycle_id 已存在，跳过')
    } else {
      console.warn('[db] migration v7 txn.cycle_id 失败:', e && e.message)
    }
  }
}

/**
 * 迁移 v8 —— 周期自动补记的游标
 *
 * 给 cycle 表加 last_caught_up_day 列（游标，YYYY-MM-DD）。
 * catchUpCycles() 只处理「晚于游标的发生日」，处理完把游标推到今天，
 * 这样：
 *   - 同一天多次进 app 不会重复记；
 *   - 用户手动删掉某条自动补的账，也不会被重建（那天已经过了游标）。
 *
 * ★ 要给老周期一个合理的初始游标 ★
 *   没有游标（NULL）的周期，如果按「从建周期那天起算」会回补几百天，
 *   体验很怪。这里把它初始化成「今天」—— 老周期从今天开始自动补记，
 *   历史日期不回补（用户没要求历史也要补）。
 *
 * 用 call() 走底层，原因同 v7（迁移在 openDb() 内，不能走 query()/execute()）。
 */
async function migrateCycleCursor() {
  try {
    await call('executeSql', {
      name: DB_NAME,
      sql: 'ALTER TABLE cycle ADD COLUMN last_caught_up_day TEXT'
    })
    console.log('[db] migration v8: cycle.last_caught_up_day 已添加')
  } catch (e) {
    if (e && /duplicate|already exists/i.test(e.message || '')) {
      console.log('[db] migration v8: last_caught_up_day 已存在，跳过')
    } else {
      console.warn('[db] migration v8 last_caught_up_day 失败:', e && e.message)
    }
  }

  // 游标初始为今天（老周期不回补历史）
  try {
    const today = toDayKey()
    await call('executeSql', {
      name: DB_NAME,
      sql: `UPDATE cycle SET last_caught_up_day = '${today}' WHERE last_caught_up_day IS NULL`
    })
    console.log('[db] migration v8: 旧周期游标初始化为今天')
  } catch (e) {
    console.warn('[db] migration v8 游标初始化失败:', e && e.message)
  }
}

/**
 * 迁移 v6 —— 给二级分类补上各自的图标
 *
 * ★ 为什么不重建分类表 ★
 *   重建（v5 那种做法）会软删所有分类再新建，
 *   历史交易的 category_id 会变成悬空引用，用户的自定义分类也会没。
 *   这里只做最小改动：按名字找到对应的二级分类，把 icon 改对。
 *
 * ★ 怎么找到「对应的」二级分类 ★
 *   一级分类名 + 二级分类名 一起当 key。
 *   名字对不上（用户自己新建的、改过名的）就跳过 —— 不动用户的数据。
 *
 * ★ 为什么必须用底层的 call()，不能用 query()/execute() ★
 *   query()/execute() 内部会 await openDb()，
 *   而本函数正是在 openDb() -> migrate() 里被调用的，会死锁。
 *   （v2 / v4 / v5 都踩过这个坑，见那边的注释。）
 */
async function applyChildCategoryIcons() {
  const now = Date.now()

  const select = async (sql, params) => {
    try {
      const rows = await call('selectSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return Array.isArray(rows) ? rows : []
    } catch (e) {
      console.warn('[db] migration v6 select failed:', e && e.message)
      return null
    }
  }

  const run = async (sql, params) => {
    try {
      await call('executeSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return true
    } catch (e) {
      console.warn('[db] migration v6 exec failed:', e && e.message)
      return false
    }
  }

  let updated = 0

  for (const type of ['expense', 'income']) {
    const list = type === 'expense' ? DEFAULT_EXPENSE_CATEGORIES : DEFAULT_INCOME_CATEGORIES

    for (const parent of list) {
      // 找父级
      const parents = await select(
        'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
        [parent.name, type]
      )
      if (!parents || parents.length === 0) continue
      const parentId = parents[0].id

      for (const child of parent.children) {
        const childName = typeof child === 'string' ? child : child.name
        const icon = childIcon(child, parent.icon)

        const ok = await run(
          `UPDATE category SET icon = ?, updated_at = ?
           WHERE deleted_at IS NULL AND parent_id = ? AND name = ?`,
          [icon, now, parentId, childName]
        )
        if (ok) updated++
      }
    }
  }

  console.log(`[db] migration v6: 二级分类图标已更新（${updated} 条）`)
}

/**
 * 迁移 v4 —— 把旧的一级「对账调整」拆成两个固定的一级分类
 *
 * ★ 这里必须用底层的 call()，不能用 query()/execute() ★
 *   query()/execute() 内部会 await openDb()，
 *   而本函数正是在 openDb() -> migrate() 里被调用的，
 *   那样会等自己（opening 那个 Promise 还没 resolve），直接死锁。
 *   （v2 的 fixNoonTimestamps 已经踩过这个坑，见那边的注释。）
 *
 * ★ 目标结构 ★
 *   expense:  一级「对账支出」（parent_id = NULL）
 *   income:   一级「对账收入」（parent_id = NULL）
 *
 * ★ 处理步骤（对每个 type 各做一遍）★
 *   1. 先记下旧一级「对账调整」和它下面的二级分类
 *      ★ 必须在改名之前取 ★
 *        改名之后旧一级就叫「对账支出」了，
 *        再按旧名字去查子分类就查不到了。
 *   2. 找目标名的一级分类：
 *      - 已经有 -> 直接复用它的 id（幂等的关键）
 *      - 没有 -> 把旧的一级改名成目标名（保留 id，历史交易的引用不用改）
 *      - 旧的一级也没有 -> 新建一个
 *   3. 旧一级下面的二级分类：
 *      - 名字和目标名相同（expense 下的「对账支出」二级）-> 软删除
 *      - 引用了它的交易（txn.category_id）-> 改指向目标 id
 *   4. 直接引用旧一级 id 的交易 -> 也改指向目标 id
 *
 * ★ 幂等 ★
 *   跑第二遍时：目标一级已经存在（步骤 2 复用），
 *   旧一级已改名或已软删除（步骤 1 查不到 active 的旧一级），
 *   旧二级已软删除（步骤 3 跳过），
 *   txn.category_id 已经指向目标 id（步骤 4 已是目标）—— 结果完全一样。
 */
async function migrateReconcileCategories() {
  const now = Date.now()

  /** 底层查询（迁移里不能走 query()，会死锁） */
  const select = async (sql, params) => {
    try {
      const rows = await call('selectSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return Array.isArray(rows) ? rows : []
    } catch (e) {
      console.warn('[db] migration v4 select failed:', e && e.message)
      return null
    }
  }

  /** 底层写入（迁移里不能走 execute()，会死锁） */
  const run = async (sql, params) => {
    try {
      await call('executeSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return true
    } catch (e) {
      console.warn('[db] migration v4 exec failed:', e && e.message)
      return false
    }
  }

  for (const def of RECONCILE_CATEGORIES) {
    const type = def.type
    const targetName = def.name

    // ---- 1) 先记下旧一级和它的子分类（必须在改名之前取）----
    //     旧一级只看「没被软删除」的 —— 软删除的记录不能再被改名复活。
    const legacyRows = await select(
      'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
      [RECONCILE_LEGACY_NAME, type]
    )
    if (legacyRows === null) continue

    const legacyIds = legacyRows.map((r) => r.id).filter(Boolean)

    // 收集所有（不管有没有被软删除的）旧一级的子分类 ——
    // 历史数据里可能有「一级被软删除但二级还活着」的残留，一并收掉。
    const allLegacyRows = await select(
      'SELECT id FROM category WHERE name = ? AND type = ? AND parent_id IS NULL',
      [RECONCILE_LEGACY_NAME, type]
    )
    if (allLegacyRows === null) continue

    let childRows = []
    for (const row of allLegacyRows) {
      if (!row.id) continue
      const rows = await select(
        'SELECT id, name FROM category WHERE deleted_at IS NULL AND parent_id = ?',
        [row.id]
      )
      if (rows === null) continue
      childRows = childRows.concat(rows)
    }

    // ---- 2) 目标一级分类 ----
    const targetRows = await select(
      'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
      [targetName, type]
    )
    if (targetRows === null) continue

    let targetId = targetRows.length > 0 ? targetRows[0].id : null

    if (targetId) {
      // 目标名已经被占用（同名的一级已存在）
      // -> 旧的一级「对账调整」软删除，它下面的二级也软删除，
      //    引用它们 id 的交易在步骤 3/4 里改指到目标。
      for (const legacyId of legacyIds) {
        await run('UPDATE category SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, legacyId])
      }
    } else if (legacyIds.length > 0) {
      // 目标名没被占用 -> 把旧的一级直接改名（保留 id，历史引用不用改）
      const legacyId = legacyIds[0]
      const ok = await run(
        'UPDATE category SET name = ?, parent_id = NULL, icon = ?, color = ?, updated_at = ? WHERE id = ?',
        [targetName, def.icon, def.color, now, legacyId]
      )
      if (ok) {
        targetId = legacyId
        // 重名的旧一级（异常数据）软删除
        for (const extra of legacyIds.slice(1)) {
          await run('UPDATE category SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, extra])
        }
      }
    }

    if (!targetId) {
      // 老库里根本没有对账分类 -> 直接建一个目标一级
      const newId = prefixedId('cat')
      const ok = await run(
        `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
         VALUES (?,NULL,?,?,?,?,999,0,?,?,NULL)`,
        [newId, targetName, type, def.icon, def.color, now, now]
      )
      if (!ok) continue
      targetId = newId
    }

    // ---- 3) 旧一级下面的二级：软删除，引用改指向目标 ----
    //   旧结构里这些二级（「对账支出」「对账收入」）是挂在「对账调整」下面的，
    //   现在由目标一级直接承担，旧的二级全部软删除（软删除而不是硬删，
    //   撤销功能还能用）。
    for (const child of childRows) {
      const childId = child.id
      if (!childId || childId === targetId) continue

      await run('UPDATE category SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, childId])

      // 引用它的交易改指向目标一级
      await run('UPDATE txn SET category_id = ? WHERE category_id = ?', [targetId, childId])
    }

    // ---- 4) 直接引用旧一级 id 的交易 -> 也改指向目标 ----
    for (const legacyId of legacyIds) {
      if (legacyId === targetId) continue
      await run('UPDATE txn SET category_id = ? WHERE category_id = ?', [targetId, legacyId])
    }
  }

  console.log('[db] migration v4: 对账分类已拆分为「对账支出」「对账收入」两个一级分类')
}

/**
 * 迁移 v5 —— 把默认分类重建成新的分类表
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 背景 ★
 *   旧默认分类：餐饮/交通/购物/居住/娱乐/医疗/教育/人情/其他
 *               + 工资/理财/兼职/红包/其他
 *   新默认分类：餐饮食品/交通出行/居住住房/购物消费/医疗健康/社交娱乐/
 *               学校学习/人情往来/其他-杂项
 *               + 工资/奖金补贴/副业劳务/租金收入/投资收益/红包礼金/
 *                 二手出售/退款返还/父母补贴
 *
 * ★ 为什么必须做成「迁移」而不是改 seedDefaultCategories ★
 *   seedDefaultCategories() 只在「分类表一条都没有」时才写入。
 *   老用户库里已经有旧分类了，这个函数根本不会执行 ——
 *   改了代码对老设备完全没有效果，只有全新安装才看得到新分类。
 *   所以要让老设备也换上新分类，只能走数据库迁移。
 *
 * ★ 处理方式：清空重建 ★
 *   1. 先把旧分类全部「软删除」（deleted_at 打上时间戳）。
 *      不用硬删，是为了万一用户想撤销还能捞回来。
 *   2. 历史交易的 category_id 改指向新结构里的兜底分类
 *      （expense -> 「其他/杂项」，income -> 「父母补贴」不合适，
 *        收入这边用「其他/杂项」？收入没有这个分类，
 *        所以收入的旧交易改指向「奖金补贴」？也不对。
 *        —— 收入的兜底用「父母补贴」不合适，这里统一用
 * ★ 处理方式：清空重建 ★
 *   1. 先把旧分类全部「软删除」（deleted_at 打上时间戳）。
 *      不用硬删，是为了万一用户想撤销还能捞回来。
 *   2. 写入新分类表（一级 + 二级）。
 *   3. 历史交易的 category_id 改指向新分类里活着的那些
 *      （指向已删除分类的交易会变成「未分类」，JOIN 不到）。
 *   4. 重新建「对账支出」「对账收入」两个固定一级分类
 *      （上一步把旧分类全软删了，包括这两个，得重建）。
 *
 * ★ 分类预算怎么办 ★
 *   budget.category_id 指向的是旧分类 id，分类被软删后预算就悬空了。
 *   budget 表没有 deleted_at 字段，所以直接 DELETE ——
 *   预算只是限额，删了不影响任何交易和余额。
 *
 * ★ 幂等：靠「已经是新结构了就直接跳过」 ★
 *   跑第二遍时，如果分类表已经是新结构了（判断依据见下），
 *   就直接返回，什么都不做 ——
 *   否则会把刚建好的分类又软删一遍再重建，
 *   白白产生一批软删除记录，而且历史交易的 category_id 会指向被删的行。
 *
 *   判断依据：一个一级分类的名字 + type + parent_id IS NULL
 *   在新结构里全部存在，就认为已经是新结构了。
 *
 * ★ 这里必须用底层的 call()，不能用 query()/execute() ★
 *   query()/execute() 内部会 await openDb()，
 *   而本函数正是在 openDb() -> migrate() 里被调用的，会死锁。
 *   （v2 的 fixNoonTimestamps 已经踩过这个坑。）
 */
async function rebuildDefaultCategories() {
  const now = Date.now()

  /** 底层查询（迁移里不能走 query()，会死锁） */
  const select = async (sql, params) => {
    try {
      const rows = await call('selectSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return Array.isArray(rows) ? rows : []
    } catch (e) {
      console.warn('[db] migration v5 select failed:', e && e.message)
      return null
    }
  }

  /** 底层写入（迁移里不能走 execute()，会死锁） */
  const run = async (sql, params) => {
    try {
      await call('executeSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return true
    } catch (e) {
      console.warn('[db] migration v5 exec failed:', e && e.message)
      return false
    }
  }

  // ---- 0) 幂等检查：已经是新结构了就直接跳过 ----
  //   逐个查新结构里的一级分类（名字 + type + 一级）是否都已存在。
  //   全在 -> 说明上一轮已经建好了，别再动。
  let alreadyNew = true
  const allTop = [
    ...DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ name: c.name, type: 'expense' })),
    ...DEFAULT_INCOME_CATEGORIES.map((c) => ({ name: c.name, type: 'income' }))
  ]
  for (const t of allTop) {
    const rows = await select(
      'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
      [t.name, t.type]
    )
    if (!rows || rows.length === 0) {
      alreadyNew = false
      break
    }
  }
  if (alreadyNew) {
    console.log('[db] migration v5: 分类表已是新结构，跳过')
    return
  }

  // ---- 1) 旧分类全部软删除 ----
  await run('UPDATE category SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL', [now, now])

  // ---- 2) 写新分类表 ----
  //   用 schema.js 里的同一份定义（api/category.js 的 seedDefaultCategories
  //   也用它），保证「首次安装写的」和「迁移重建的」结构完全一致 ——
  //   改默认分类表只改一处，不会两处不同步。
  let created = 0
  for (const type of ['expense', 'income']) {
    const list = type === 'expense' ? DEFAULT_EXPENSE_CATEGORIES : DEFAULT_INCOME_CATEGORIES
    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      const parentId = prefixedId('cat')
      const ok = await run(
        `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
         VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
        [parentId, null, item.name, type, item.icon, item.color, i, now, now]
      )
      if (!ok) continue
      created++

      for (let j = 0; j < item.children.length; j++) {
        // ★ 二级分类有自己的图标（颜色继承父级）★
        //   childIcon / childColor 兼容旧写法（纯字符串），
        //   详见 api/db/schema.js 的说明。
        const child = item.children[j]
        const childName = typeof child === 'string' ? child : child.name
        const okChild = await run(
          `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
          [
            prefixedId('cat'), parentId, childName, type,
            childIcon(child, item.icon), childColor(child, item.color),
            j, now, now
          ]
        )
        if (okChild) created++
      }
    }
  }

  // ---- 3) 历史交易改指向新分类 ----
  //   旧分类已经没了，txn.category_id 还指着它们就成了悬空引用，
  //   统计时 JOIN 不到分类（会显示成「未分类」）。
  //
  //   支出交易 -> 归到「其他支出」
  //   收入交易 -> 归到「其他支出」？收入的分类表里没有「其他支出」，
  //              所以收入这边统一归到「奖金补贴」？语义不对。
  //              —— 收入里最中性的是……收入分类表里确实没有「其他」。
  //              折中做法：收入的旧交易归到「工资」显然不对。
  //
  //   所以这里不猜：收入的旧交易直接置空（category_id = NULL），
  //   界面上会显示「未分类」，用户可以自己重新归类 ——
  //   比归到一个语义不对的分类里更诚实。
  const expenseFallback = await select(
    'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
    ['其他支出', 'expense']
  )
  const fallbackId = expenseFallback && expenseFallback.length > 0 ? expenseFallback[0].id : null

  if (fallbackId) {
    await run(
      `UPDATE txn SET category_id = ?
       WHERE deleted_at IS NULL
         AND category_id IS NOT NULL
         AND category_id NOT IN (SELECT id FROM category WHERE deleted_at IS NULL)`,
      [fallbackId]
    )
  } else {
    // 连兜底分类都没有 -> 置空，至少不指向已删除的行
    await run(
      `UPDATE txn SET category_id = NULL
       WHERE deleted_at IS NULL
         AND category_id IS NOT NULL
         AND category_id NOT IN (SELECT id FROM category WHERE deleted_at IS NULL)`,
      []
    )
  }

  // ---- 4) 失效的分类预算删掉 ----
  //   budget 表没有 deleted_at 字段，直接 DELETE。
  //   预算只是限额，删掉不影响任何交易和账户余额。
  //
  //   run() 内部已经 catch 了错误并返回 false，
  //   所以这里失败也不会中断迁移（分类重建已经成功了，这只是收尾）。
  await run(
    `DELETE FROM budget
     WHERE scope = 'category' AND category_id IS NOT NULL
       AND category_id NOT IN (SELECT id FROM category WHERE deleted_at IS NULL)`,
    []
  )

  // ---- 5) 重建「系统预置分类」固定分类组 ----
  //   第 1 步把旧分类连对账分类一起软删了，得重新建。
  //
  //   ★ v14 起结构变了 ★
  //     以前是两条独立的一级分类「对账支出 / 对账收入」。
  //     现在是「系统预置分类」下面的固定子类（借出 / 对账支出、借入 / 对账收入）。
  //     v14 迁移也做同样的事，但 v5 重建分类表时如果不建，
  //     用户在新装的库上会先看不到这组分类，直到 v14 跑完 ——
  //     干脆这里就按新结构一次性建好，v14 再跑一遍是无害的幂等操作。
  //   sort = 999：排到最后，别抢用户自己分类的位置。
  for (const type of ['expense', 'income']) {
    const groupDef = SYSTEM_PRESET_GROUPS[type]
    const groupRows = await select(
      'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
      [groupDef.name, type]
    )
    if (groupRows === null) continue

    let groupId = groupRows.length > 0 ? groupRows[0].id : null
    if (!groupId) {
      groupId = prefixedId('cat')
      const ok = await run(
        `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
         VALUES (?,NULL,?,?,?,?,999,0,?,?,NULL)`,
        [groupId, groupDef.name, type, groupDef.icon, groupDef.color, now, now]
      )
      if (!ok) continue
    }

    for (const def of SYSTEM_PRESET_CHILDREN.filter((d) => d.type === type)) {
      const childRows = await select(
        'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id = ?',
        [def.name, type, groupId]
      )
      if (childRows === null) continue
      if (childRows.length > 0) continue

      // 旧结构：同名的一级分类还活着 -> 收编到组里（保留 id，历史引用不动）
      const legacyRows = await select(
        'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
        [def.name, type]
      )
      if (legacyRows === null) continue
      if (legacyRows.length > 0) {
        await run(
          'UPDATE category SET parent_id = ?, icon = ?, color = ?, sort = ?, updated_at = ? WHERE id = ?',
          [groupId, def.icon, def.color, def.sort, now, legacyRows[0].id]
        )
        continue
      }

      await run(
        `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
         VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
        [prefixedId('cat'), groupId, def.name, type, def.icon, def.color, def.sort, now, now]
      )
    }
  }

  console.log(`[db] migration v5: 默认分类已重建（${created} 条）`)
}

/**
 * 回填历史记录的时刻（12:00 -> 实际创建时刻）
 *
 * 条件：occurred_at 落在当天 12:00（±1 分钟，容忍时钟漂移）
 *       且 occurred_day 等于 created_at 的本地日期
 *
 * ★ 这里必须用底层的 call()，不能用 query()/execute() ★
 *   query()/execute() 内部会 await openDb()，
 *   而本函数正是在 openDb() -> migrate() 里被调用的，
 *   那样会等自己（opening 那个 Promise 还没 resolve），直接死锁。
 *   v1 的 applySchemaV1 也是这么绕过 openDb 的。
 */
async function fixNoonTimestamps() {
  let rows = []
  try {
    rows = await call('selectSql', {
      name: DB_NAME,
      sql: 'SELECT id, occurred_at, occurred_day, created_at FROM txn WHERE deleted_at IS NULL'
    })
  } catch (e) {
    console.warn('[db] migration v2 skip:', e.message)
    return
  }
  if (!Array.isArray(rows)) rows = []

  let fixed = 0
  for (const r of rows) {
    const occ = Number(r.occurred_at) || 0
    const created = Number(r.created_at) || 0
    if (!occ || !created) continue

    const occDate = new Date(occ)
    // 只处理「看起来就是 12:00」的记录
    if (occDate.getHours() !== 12 || occDate.getMinutes() > 1) continue

    // created_at 的本地日期必须和 occurred_day 一致
    const c = new Date(created)
    const cDay = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`
    if (cDay !== r.occurred_day) continue

    // 回填成创建时刻（保留 occurred_at 当天，时分秒用 created_at 的）
    const fixedTs = new Date(
      occDate.getFullYear(), occDate.getMonth(), occDate.getDate(),
      c.getHours(), c.getMinutes(), c.getSeconds(), 0
    ).getTime()

    try {
      await call('executeSql', {
        name: DB_NAME,
        sql: bindParams('UPDATE txn SET occurred_at = ? WHERE id = ?', [fixedTs, r.id])
      })
      fixed++
    } catch (e) {
      console.warn('[db] migration v2 update failed:', e.message)
    }
  }

  if (fixed > 0) {
    console.log(`[db] 已回填 ${fixed} 条历史记录的时刻`)
  }
}

/**
 * 迁移 v14 —— 「系统预置分类」固定分类组
 *
 * ★ 这一组从 v18 起叫「系统分类」★
 *   本文里凡是写「系统预置分类」的地方，指的都是**这条迁移跑到时**库里的名字
 *   （v14~v17 的库还叫旧名）。改名交给启动时的 syncDefaultCategories()，
 *   迁移只负责「认得出老名字、别把固定子类劈成两个组」。
 *
 * ★ 目标结构 ★
 *   一级分类「系统预置分类」（expense / income 各一条，名字相同、type 不同）
 *     支出：借出、对账支出
 *     收入：借入、对账收入
 *
 * ★ 为什么不能靠「清空重建」★
 *   「对账支出 / 对账收入」是余额对账的记账口径，
 *   历史对账流水的 txn.category_id 全指着它们。
 *   重建（软删旧行 + 新建）会让这些交易变成「未分类」——
 *   账面上那几笔「余额对账调整」就说不清了。
 *
 * ★ 做法：收编（改 parent_id），不新建 ★
 *   1. 取或建「系统预置分类」这条一级分类（sort = 999，排最后）
 *   2. 逐个固定子类：
 *      - 组下已经有同名子类 -> 顺手把图标/颜色/排序刷成定义里的（幂等）
 *      - 没有，但库里有一条活的**一级**同名分类
 *        -> 直接把它的 parent_id 改到组里（保留 id，历史引用不动）
 *      - 都没有 -> 新建一条
 *
 * ★ 为什么必须用底层的 call()，不能用 query()/execute() ★
 *   query()/execute() 内部会 await openDb()，
 *   而本函数正是在 openDb() -> migrate() 里被调用的，会死锁。
 *   （v2 / v4 / v5 / v6 都踩过这个坑，见那边的注释。）
 *
 * ★ 幂等 ★
 *   第二遍跑：组存在、每个子类都在组下 -> 只做一次无害的 UPDATE，结果完全一样。
 */
async function migrateSystemPresetCategories() {
  const now = Date.now()

  /** 底层查询（迁移里不能走 query()，会死锁） */
  const select = async (sql, params) => {
    try {
      const rows = await call('selectSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return Array.isArray(rows) ? rows : []
    } catch (e) {
      console.warn('[db] migration v14 select failed:', e && e.message)
      return null
    }
  }

  /** 底层写入（迁移里不能走 execute()，会死锁） */
  const run = async (sql, params) => {
    try {
      await call('executeSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return true
    } catch (e) {
      console.warn('[db] migration v14 exec failed:', e && e.message)
      return false
    }
  }

  let reparented = 0
  let created = 0

  for (const type of ['expense', 'income']) {
    // ---- 1) 取或建固定分类组这一条一级分类 ----
    const groupDef = SYSTEM_PRESET_GROUPS[type]
    /*
     * ★ 组名要按「新名 → 旧名」各查一遍 ★
     *   v18 起常量里的名字是「系统分类」，但跑到这条迁移的库可能还停在
     *   v14~v17（组叫「系统预置分类」）。只按常量名查会查不到，
     *   于是又建出一条同名不同 era 的组，历史子类就被劈成两半。
     */
    let groupRows = await select(
      'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
      [groupDef.name, type]
    )
    if (groupRows !== null && groupRows.length === 0) {
      groupRows = await select(
        'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
        [SYSTEM_PRESET_LEGACY_NAME, type]
      )
    }
    if (groupRows === null) continue

    let groupId = groupRows.length > 0 ? groupRows[0].id : null

    if (!groupId) {
      groupId = prefixedId('cat')
      const ok = await run(
        `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
         VALUES (?,NULL,?,?,?,?,999,0,?,?,NULL)`,
        [groupId, groupDef.name, type, groupDef.icon, groupDef.color, now, now]
      )
      // 建不出来就跳过这个 type（不阻断整个迁移）
      if (!ok) continue
      created++
    }

    // ---- 2) 逐个固定子类 ----
    const defs = SYSTEM_PRESET_CHILDREN.filter((d) => d.type === type)

    for (const def of defs) {
      // 2a) 组下已经有同名子类 -> 刷新图标/颜色/排序（幂等）
      const existing = await select(
        'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id = ?',
        [def.name, type, groupId]
      )
      if (existing === null) continue

      if (existing.length > 0) {
        await run(
          'UPDATE category SET icon = ?, color = ?, sort = ?, updated_at = ? WHERE id = ?',
          [def.icon, def.color, def.sort, now, existing[0].id]
        )
        continue
      }

      // 2b) 库里有一条活的「一级同名分类」-> 收编到组里（保留 id）
      const legacy = await select(
        'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
        [def.name, type]
      )
      if (legacy === null) continue

      if (legacy.length > 0) {
        const ok = await run(
          'UPDATE category SET parent_id = ?, icon = ?, color = ?, sort = ?, updated_at = ? WHERE id = ?',
          [groupId, def.icon, def.color, def.sort, now, legacy[0].id]
        )
        if (ok) reparented++
        // 重名的多余一级（异常数据）软删除，避免分类树里出现两条同名
        for (const extra of legacy.slice(1)) {
          await run('UPDATE category SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, extra.id])
        }
        continue
      }

      // 2c) 都没有 -> 新建
      const ok = await run(
        `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
         VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
        [prefixedId('cat'), groupId, def.name, type, def.icon, def.color, def.sort, now, now]
      )
      if (ok) created++
    }
  }

  console.log(
    `[db] migration v14: 「系统预置分类」已就绪（新建 ${created} 条，收编 ${reparented} 条）`
  )
}

/**
 * 迁移 v15 —— 补上「借款收回 / 借款归还」
 *
 * ★ 为什么需要 ★
 *   v14 只在「系统预置分类」下建了「借出」「借入」两个固定子类。
 *   可一笔借出是要还回来的：
 *     借出去 500，收回 200，当前还有 300 在外面。
 *   没有「借款收回」这个分类，收回的钱只能记成普通收入，
 *   页面就没法算出「当前借出」。借入同理（借款归还）。
 *
 * ★ 结构 ★
 *   借款收回 -> income 下（钱回到账户）
 *   借款归还 -> expense 下（钱从账户出去）
 *
 * ★ 幂等 + 收编 ★
 *   和 v14 一样的策略：先找组下有没有同名子类，没有再找有没有
 *   活的同名一级分类（收编，保留 id），都没有才新建。
 *   这样用户如果自己建过一个「借款收回」，历史流水的引用不会断。
 *
 * ★ 必须用底层 call()，不能 query()/execute() ★
 *   迁移在 openDb() 内跑，走 query()/execute() 会 await openDb() 死锁。
 */
async function migrateLoanReturnCategories() {
  const now = Date.now()

  const select = async (sql, params) => {
    try {
      const rows = await call('selectSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return Array.isArray(rows) ? rows : []
    } catch (e) {
      console.warn('[db] migration v15 select failed:', e && e.message)
      return null
    }
  }

  const run = async (sql, params) => {
    try {
      await call('executeSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return true
    } catch (e) {
      console.warn('[db] migration v15 exec failed:', e && e.message)
      return false
    }
  }

  /** 这一轮要补的两个分类（定义与 schema.js 的 SYSTEM_PRESET_CHILDREN 一致） */
  const TARGETS = [
    { type: 'expense', name: '借款归还' },
    { type: 'income', name: '借款收回' }
  ]

  let created = 0
  let reparented = 0

  for (const target of TARGETS) {
    const def = SYSTEM_PRESET_CHILDREN.find(
      (d) => d.type === target.type && d.name === target.name
    )
    if (!def) continue

    // ---- 1) 取或建固定分类组父级 ----
    const groupDef = SYSTEM_PRESET_GROUPS[target.type]
    /*
     * ★ 组名要按「新名 → 旧名」各查一遍 ★
     *   v18 起常量里的名字是「系统分类」，而这条迁移跑在 v14 之后、
     *   v18 改名之前 —— 组还叫「系统预置分类」。
     *   只按常量名查会查不到，于是新建一个空组，
     *   紧接着的「组下有没有同名子类」永远查不到，
     *   于是同一个分类被插了两条。
     */
    let groupRows = await select(
      'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
      [groupDef.name, target.type]
    )
    if (groupRows !== null && groupRows.length === 0) {
      groupRows = await select(
        'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
        [SYSTEM_PRESET_LEGACY_NAME, target.type]
      )
    }
    if (groupRows === null) continue

    let groupId = groupRows.length > 0 ? groupRows[0].id : null
    if (!groupId) {
      groupId = prefixedId('cat')
      const ok = await run(
        `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
         VALUES (?,NULL,?,?,?,?,999,0,?,?,NULL)`,
        [groupId, groupDef.name, target.type, groupDef.icon, groupDef.color, now, now]
      )
      if (!ok) continue
      created++
    }

    // ---- 2) 组下已有同名子类 -> 刷新图标/颜色/排序即可 ----
    const existing = await select(
      'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id = ?',
      [target.name, target.type, groupId]
    )
    if (existing === null) continue
    if (existing.length > 0) {
      await run(
        'UPDATE category SET icon = ?, color = ?, sort = ?, updated_at = ? WHERE id = ?',
        [def.icon, def.color, def.sort, now, existing[0].id]
      )
      continue
    }

    // ---- 3) 有活的同名一级分类 -> 收编到组里（保留 id）----
    const legacy = await select(
      'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
      [target.name, target.type]
    )
    if (legacy === null) continue
    if (legacy.length > 0) {
      const ok = await run(
        'UPDATE category SET parent_id = ?, icon = ?, color = ?, sort = ?, updated_at = ? WHERE id = ?',
        [groupId, def.icon, def.color, def.sort, now, legacy[0].id]
      )
      if (ok) reparented++
      for (const extra of legacy.slice(1)) {
        await run('UPDATE category SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, extra.id])
      }
      continue
    }

    // ---- 4) 都没有 -> 新建 ----
    const ok = await run(
      `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
       VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
      [prefixedId('cat'), groupId, target.name, target.type, def.icon, def.color, def.sort, now, now]
    )
    if (ok) created++
  }

  console.log(
    `[db] migration v15: 借入借出反向分类已就绪（新建 ${created} 条，收编 ${reparented} 条）`
  )
}

/**
 * 迁移 v16 —— 分类改名（借出收回 -> 借款收回、借入归还 -> 借款归还）
 *
 * ★ 为什么要迁移 ★
 *   改代码里的字符串只能影响**新装**的库（走 seedDefaultCategories），
 *   老库里那两行已经存成旧名字了，不迁移就永远显示旧的。
 *
 * ★ 为什么是 UPDATE name 而不是删了重建 ★
 *   历史流水挂在它们的 id 上（txn.category_id）。
 *   重建会换 id，那些流水就变成悬空引用 ——
 *   页面按分类名统计「当前借出 / 当前借入」时直接算不出。
 *   改名保留 id，引用完全不断。
 *
 * ★ 只改「系统预置分类」下面的那两条 ★
 *   用户可能在别处自己建过叫「借出收回」的分类 ——
 *   那不是系统分类，不该被我们改名。
 *   所以先定位父级「系统预置分类」，再改它下面的子类。
 *
 * ★ 目标名已存在时怎么办 ★
 *   极少见（用户手工建过同名分类）。这时不能直接改名 ——
 *   会出现两条同名同父级的子类，统计会翻倍。
 *   处理方式：把旧的那条软删除，并把它的交易改指向目标分类。
 *
 * ★ 必须用底层 call()，不能 query()/execute() ★
 *   迁移在 openDb() 内跑，走 query()/execute() 会 await openDb() 死锁。
 */
async function migrateRenameLoanCategories() {
  const now = Date.now()

  const select = async (sql, params) => {
    try {
      const rows = await call('selectSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return Array.isArray(rows) ? rows : []
    } catch (e) {
      console.warn('[db] migration v16 select failed:', e && e.message)
      return null
    }
  }

  const run = async (sql, params) => {
    try {
      await call('executeSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return true
    } catch (e) {
      console.warn('[db] migration v16 exec failed:', e && e.message)
      return false
    }
  }

  /** 旧名 -> 新名（按 type 各一条，同名不同 type 不算冲突） */
  const RENAMES = [
    { type: 'income', from: '借出收回', to: '借款收回' },
    { type: 'expense', from: '借入归还', to: '借款归还' }
  ]

  /*
   * ★ 这里故意写死旧名字面量，不要换成 SYSTEM_PRESET_GROUP_NAME ★
   *   v18 起这一组的新名是「系统分类」，但这条迁移面对的老库里
   *   存的还是「系统预置分类」。改成新名就查不到那一行，
   *   下面的「先定位父级再改子类」全部落空，旧分类名会一直留在库里。
   *   改名本身交给 syncDefaultCategories()（启动时对账），不在这里做。
   */
  const GROUP_NAME = '系统预置分类'
  let renamed = 0
  let merged = 0

  for (const item of RENAMES) {
    // ---- 1) 找「系统预置分类」父级 ----
    const groups = await select(
      'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
      [GROUP_NAME, item.type]
    )
    if (groups === null) continue
    // 父级不存在（v14 没跑成之类）：直接按名字全库兜底改，别把旧名留在库里
    const groupId = groups.length > 0 ? groups[0].id : null

    // ---- 2) 找旧名字的那条（优先在组下）----
    let oldRows = []
    if (groupId) {
      const rows = await select(
        'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id = ?',
        [item.from, item.type, groupId]
      )
      if (rows === null) continue
      oldRows = rows
    }
    if (oldRows.length === 0) {
      // 组下没有 -> 全库按名字找（兼容 v14/v15 未成功的库）
      const rows = await select(
        'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ?',
        [item.from, item.type]
      )
      if (rows === null) continue
      oldRows = rows
    }
    if (oldRows.length === 0) continue // 本来就没有这个分类，跳过

    // ---- 3) 目标名是否已存在（同 type、同父级）----
    const targetRows = groupId
      ? await select(
          'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id = ?',
          [item.to, item.type, groupId]
        )
      : await select(
          'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ?',
          [item.to, item.type]
        )
    if (targetRows === null) continue

    const targetId = targetRows.length > 0 ? targetRows[0].id : null

    for (let i = 0; i < oldRows.length; i++) {
      const oldId = oldRows[i].id

      if (!targetId) {
        // 3a) 目标不存在 -> 第一条直接改名（保留 id，历史引用不断）
        if (i === 0) {
          const ok = await run(
            'UPDATE category SET name = ?, updated_at = ? WHERE id = ?',
            [item.to, now, oldId]
          )
          if (ok) renamed++
        } else {
          // 3b) 旧名有多条（脏数据）-> 只留一条，其余软删 + 交易改指向
          await run('UPDATE category SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, oldId])
          await run('UPDATE txn SET category_id = ? WHERE category_id = ?', [oldRows[0].id, oldId])
        }
        continue
      }

      // 3c) 目标已存在 -> 旧行软删，交易改指向目标（避免同名重复统计）
      await run('UPDATE category SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, oldId])
      await run('UPDATE txn SET category_id = ? WHERE category_id = ?', [targetId, oldId])
      merged++
    }
  }

  console.log(
    `[db] migration v16: 借入借出分类已改名（改名 ${renamed} 条，合并 ${merged} 条）`
  )
}

/**
 * 迁移 v17 —— 外币记账支持
 *
 * 结构：txn 加原币快照三列 + 新建 exchange_rate 汇率历史表。
 * 设计说明见 MIGRATIONS 数组 v17 的注释与 schema.js 的表注释。
 *
 * ★ 必须用底层 call()，不能 query()/execute()（openDb 内死锁，见 v16 注释）★
 */
async function migrateMultiCurrency() {
  const run = async (sql) => {
    try {
      await call('executeSql', { name: DB_NAME, sql })
      return true
    } catch (e) {
      console.warn('[db] migration v17 exec failed:', e && e.message)
      return false
    }
  }

  // ALTER TABLE ADD COLUMN 是 O(1) 元数据操作（v3 起一直这么用）
  await run(`ALTER TABLE txn ADD COLUMN original_currency TEXT`)
  await run(`ALTER TABLE txn ADD COLUMN original_amount_cents INTEGER`)
  await run(`ALTER TABLE txn ADD COLUMN exchange_rate REAL`)

  // 汇率历史表（定义与 schema.js 的 SCHEMA_V1 保持一致）
  await run(`CREATE TABLE IF NOT EXISTS exchange_rate (
    day        TEXT    NOT NULL,
    currency   TEXT    NOT NULL,
    rate       REAL    NOT NULL,
    source     TEXT    NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (day, currency)
  )`)

  /*
   * 周期模板的外币字段
   *
   * ★ 为什么周期也要带币种 ★
   *   用户明确要求「周期补记的汇率口径 = 当单所在日的汇率」。
   *   一个「每月 15 号扣 20 美元订阅」的周期，每次补记都该按
   *   **那一天**的汇率折算，而不是创建周期时的汇率 ——
   *   否则一年下来误差会累积成实打实的金额偏差。
   *
   *   老周期全部为 NULL（= 人民币），行为完全不变。
   */
  await run(`ALTER TABLE cycle ADD COLUMN original_currency TEXT`)
  await run(`ALTER TABLE cycle ADD COLUMN original_amount_cents INTEGER`)
}

/**
 * 迁移 v18 —— 子预算的「自定义名称 + 多类别」
 *
 * ★ 这一步只做结构，不动金额 ★
 *   1. budget 加 name 列
 *   2. 建 budget_category 关联表
 *   3. 把老的 category_id 搬进关联表（一条子预算一个类别 -> 关联表里一行）
 *
 * ★ 回填为什么用 INSERT OR IGNORE ★
 *   迁移是「失败只 log、版本号照样推进」的（见 migrate()），
 *   所以同一个库可能因为上次失败而重跑这条迁移。
 *   主键是 (budget_id, category_id)，重复插入被 IGNORE 掉，天然幂等。
 *
 * ★ 为什么 category_id 列留着不删 ★
 *   SQLite 老内核不支持 DROP COLUMN；而且留着它是老版本 App 的降级退路。
 *
 * ★ 必须用底层 call()，不能 query()/execute()（openDb 内死锁，见 v16 注释）★
 */
async function migrateBudgetCategories() {
  const run = async (sql) => {
    try {
      await call('executeSql', { name: DB_NAME, sql })
      return true
    } catch (e) {
      console.warn('[db] migration v18 exec failed:', e && e.message)
      return false
    }
  }

  // 1) name 列：ALTER TABLE ADD COLUMN 是 O(1) 元数据操作，重复执行会报错，忽略
  try {
    await call('executeSql', {
      name: DB_NAME,
      sql: 'ALTER TABLE budget ADD COLUMN name TEXT'
    })
    console.log('[db] migration v18: budget.name 已添加')
  } catch (e) {
    // 字段已存在（新装库直接由 SCHEMA_V1 建出来 / 重复迁移）
    console.log('[db] migration v18: budget.name 已存在，跳过')
  }

  // 2) 关联表（DDL 与 schema.js 的 SCHEMA_V1 保持一致）
  await run(`CREATE TABLE IF NOT EXISTS budget_category (
    budget_id   TEXT NOT NULL,
    category_id TEXT NOT NULL,
    PRIMARY KEY (budget_id, category_id)
  )`)
  await run('CREATE INDEX IF NOT EXISTS idx_budget_cat_cat ON budget_category(category_id)')

  // 3) 回填老数据：一条子预算一个类别
  //
  //   ★ 只搬「分类还活着」的 ★
  //     指向已软删分类的老预算本来就没有统计意义（已用恒为 0），
  //     搬进关联表只会让统计层多算一次「已删除分类」。
  //     这类预算留着不动，界面上会显示成「已删除分类」，用户可以自己删。
  await run(`INSERT OR IGNORE INTO budget_category (budget_id, category_id)
    SELECT b.id, b.category_id FROM budget b
    JOIN category c ON c.id = b.category_id AND c.deleted_at IS NULL
    WHERE b.scope = 'category' AND b.category_id IS NOT NULL`)
}

/**
 * 迁移 v19 —— 借入借出不进收支 + 借出「手动结清」的两个派生分类
 *
 * 三件事：
 *   1. txn 加 exclude_from_stats 列（默认 0）
 *   2. 借出 / 借入 / 借款收回 / 借款归还 四类历史流水回填
 *      exclude_from_stats = 1（同时把 exclude_from_budget 也补成 1 ——
 *      这四类本来就不该占预算，老版本只支持手动勾选，多数老数据没勾）
 *   3. 建「借出坏账」（expense）/「借出利息」（income）两个 hidden 派生分类
 *
 * ★ 回填为什么放在这里，而不是查询时 JOIN 分类名 ★
 *   统计 SQL 有 20 多条，每条都加一个 JOIN 分类表是长期性能代价；
 *   而 0/1 字段既不占空间又能走索引条件。
 *   另外「不计入」是个**快照决定**：今天这笔借款不该算收支，
 *   将来用户把「借出」分类改名成别的，历史这笔仍然不该算收支 ——
 *   JOIN 名字的写法在这时会静默改变历史统计。
 *
 * ★ 回填只碰这四类，其它分类一笔不动 ★
 *   升级后用户的月度收支数字，变化只来自「借款不再算收支」这一处，
 *   可以逐笔对上，不会有「升级后统计全变了」的惊吓。
 *
 * ★ 必须用底层 call()，不能 query()/execute()（openDb 内死锁，见 v16 注释）★
 */
async function migrateLoanExcludeAndSettleCategories() {
  const now = Date.now()

  /** 底层查询（迁移里不能走 query()，会死锁） */
  const select = async (sql, params) => {
    try {
      const rows = await call('selectSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return Array.isArray(rows) ? rows : []
    } catch (e) {
      console.warn('[db] migration v19 select failed:', e && e.message)
      return null
    }
  }
  /** 底层写入（迁移里不能走 execute()，会死锁） */
  const run = async (sql, params) => {
    try {
      await call('executeSql', { name: DB_NAME, sql: bindParams(sql, params) })
      return true
    } catch (e) {
      console.warn('[db] migration v19 exec failed:', e && e.message)
      return false
    }
  }

  // ---------- 1) exclude_from_stats 列 ----------
  try {
    await call('executeSql', {
      name: DB_NAME,
      sql: 'ALTER TABLE txn ADD COLUMN exclude_from_stats INTEGER NOT NULL DEFAULT 0'
    })
    console.log('[db] migration v19: txn.exclude_from_stats 已添加')
  } catch (e) {
    // 字段已存在（新装库由 SCHEMA_V1 建出来 / 迁移重跑），忽略
    console.log('[db] migration v19: txn.exclude_from_stats 已存在，跳过')
  }

  // ---------- 2) 四类借款流水回填 ----------
  /*
   * ★ 用 IN (子查询) 而不是 JOIN 分类名 ★
   *   分类名在「系统分类」组下是唯一的，但用户可能在别处建同名分类
   *   （分类管理允许），所以再限定 parent_id 指向「系统分类」组，
   *   避免把用户自建的同名分类下的流水也一起标掉。
   */
  const loanNames = ['借出', '借入', '借款收回', '借款归还']
  const placeholders = loanNames.map(() => '?').join(',')
  await run(
    `UPDATE txn SET exclude_from_stats = 1, exclude_from_budget = 1, updated_at = ?
     WHERE deleted_at IS NULL
       AND exclude_from_stats = 0
       AND category_id IN (
         SELECT c.id FROM category c
         WHERE c.deleted_at IS NULL
           AND c.name IN (${placeholders})
           AND c.parent_id IN (
             SELECT g.id FROM category g
             WHERE g.deleted_at IS NULL AND g.parent_id IS NULL
               AND g.name IN (?, ?)
           )
       )`,
    [now, ...loanNames, SYSTEM_PRESET_GROUP_NAME, SYSTEM_PRESET_LEGACY_NAME]
  )

  // ---------- 3) 两个派生分类 ----------
  /*
   * 结构上等价于 api/category.js 的 ensurePresetCategories()，
   * 但这里不能调它（它内部用 query()/execute()，会死锁），所以抄一份最小实现。
   * 只在迁移里跑一次，后续由 syncDefaultCategories() 负责维持。
   */
  for (const type of ['expense', 'income']) {
    const groupDef = SYSTEM_PRESET_GROUPS[type]

    let groupRows = await select(
      'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
      [groupDef.name, type]
    )
    if (groupRows !== null && groupRows.length === 0) {
      groupRows = await select(
        'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id IS NULL',
        [SYSTEM_PRESET_LEGACY_NAME, type]
      )
    }
    if (groupRows === null || groupRows.length === 0) continue
    const groupId = groupRows[0].id

    const defs = SYSTEM_PRESET_CHILDREN.filter((d) => d.type === type && d.hidden === true)
    for (const def of defs) {
      const existing = await select(
        'SELECT id FROM category WHERE deleted_at IS NULL AND name = ? AND type = ? AND parent_id = ?',
        [def.name, type, groupId]
      )
      if (existing === null) continue
      if (existing.length > 0) {
        // 已存在：只把 hidden 拉回 1（防止老数据里它是可见的）
        await run(
          'UPDATE category SET hidden = 1, updated_at = ? WHERE id = ? AND hidden != 1',
          [now, existing[0].id]
        )
        continue
      }
      await run(
        `INSERT INTO category (id, parent_id, name, type, icon, color, sort, hidden, created_at, updated_at, deleted_at)
         VALUES (?,?,?,?,?,?,?,1,?,?,NULL)`,
        [prefixedId('cat'), groupId, def.name, type, def.icon, def.color, def.sort, now, now]
      )
    }
  }
}

async function migrate() {
  const current = await readUserVersion()
  if (current >= SCHEMA_VERSION) return

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    console.log(`[db] migrating -> v${m.version}`)
    try {
      await m.up()
    } catch (e) {
      // ★ 迁移失败不能挡住数据库打开 ★
      //   迁移只是「锦上添花」（建表 / 回填时刻），
      //   万一失败也必须让 App 能正常用，
      //   否则整个 App 会因为一个迁移卡在打不开库。
      console.error(`[db] migration v${m.version} failed:`, e && e.message)
    }
    await writeUserVersion(m.version)
  }
}

/**
 * ★ 仅供测试用：单独跑某一条迁移 ★
 *
 * 为什么需要它
 *   迁移之间是有顺序依赖的：
 *     v4 把「对账调整」拆成两个固定一级分类
 *     v5 把整个默认分类表重建
 *   两个测试如果都从同一个老版本号起步，
 *   v5 会在 v4 之后跑，把 v4 刚建好的分类全软删掉 ——
 *   于是 v4 的断言看着像是失败了，其实是 v5 干的。
 *
 *   有了这个函数，测试可以「只跑 v4」，互不干扰。
 *
 * @param {number} version 要跑的那条迁移的版本号
 * @returns {Promise<boolean>} 是否找到了并执行
 */
export async function runMigrationForTest(version) {
  const m = MIGRATIONS.find((x) => x.version === version)
  if (!m) return false
  await m.up()
  return true
}

/** 打开数据库（并发调用共享同一个 Promise） */
export function openDb() {
  if (opened) return Promise.resolve(true)
  if (opening) return opening

  const p = (async () => {
    await waitForPlus()

    // 已打开过同名库时 openDatabase 会失败，先尝试关闭一次（忽略错误）
    try {
      await new Promise((resolve) => {
        plus.sqlite.closeDatabase({ name: DB_NAME, success: resolve, fail: resolve })
      })
    } catch (e) {}

    await call('openDatabase', { name: DB_NAME, path: DB_PATH })

    await migrate()
    opened = true
    console.log('[db] opened', DB_PATH)
    return true
  })()

  opening = p

  // 失败后要清掉缓存的 Promise，否则后续调用会一直拿到同一个 rejected
  return p.catch((e) => {
    opening = null
    throw e
  })
}





/* ------------------------------------------------------------- 查询/执行 */

/** 查询，返回行数组 */
export async function query(sql, params = []) {
  await openDb()
  const rows = await call('selectSql', {
    name: DB_NAME,
    sql: bindParams(sql, params)
  })
  return Array.isArray(rows) ? rows : []
}

/** 查询单行，无结果返回 null */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params)
  return rows.length > 0 ? rows[0] : null
}

/** 查询单个标量值 */


/** 执行写入，返回受影响行数（拿不到时返回 true） */
export async function execute(sql, params = []) {
  await openDb()
  const res = await call('executeSql', {
    name: DB_NAME,
    sql: bindParams(sql, params)
  })
  return res
}

/**
 * 事务。所有涉及余额变动的操作必须走这里。
 * 注意：plus.sqlite 的 begin/commit 是独立调用，没有自动回滚，
 * 因此 catch 里必须显式 rollback。
 */
export async function transaction(fn) {
  await openDb()
  await call('transaction', { name: DB_NAME, operation: 'begin' })
  try {
    const result = await fn()
    await call('transaction', { name: DB_NAME, operation: 'commit' })
    return result
  } catch (e) {
    try {
      await call('transaction', { name: DB_NAME, operation: 'rollback' })
    } catch (rollbackErr) {
      console.error('[db] rollback failed', rollbackErr)
    }
    throw e
  }
}

/** 批量执行（同一事务内），用于导入 */


/**
 * 清空所有业务表（保留结构），用于「清空数据」与「覆盖导入」。
 *
 * ★ 这张清单必须覆盖库里**每一张**表 ★
 *   漏一张的表现不是报错，而是「点了清空，某块数据还在」——
 *   比如漏掉 cycle_skip，清空后新建的周期会把用户早先删掉的补记又记一遍。
 *   所以清单从「所有建表语句」里推：SCHEMA_V1 的 11 张
 *   + 只在迁移里建的 cycle（v7）/ cycle_skip（v9）/ exchange_rate（v17）。
 *   scripts/test-clear-all.mjs 会逐张断言，加了新表忘了这里会被测试挡住。
 *
 * ★ 为什么要逐表 try 住，而不是一把梭 ★
 *   迁移失败是不阻断开库的（见 migrate() 的注释），
 *   所以老设备上完全可能没有 cycle_skip / exchange_rate 这些表。
 *   那里 DELETE 会抛 "no such table"，而整段是包在 transaction 里的 ——
 *   一条语句失败就把**整笔清空回滚**，
 *   用户看到「清空失败」，其实一张表都没清掉。
 *   清空的目标是「把能清的都清掉」，缺一张表不该让整个操作作废。
 *
 * ★ 关于 app_meta 与迁移版本号 ★
 *   迁移游标是 SQLite 库头里的 PRAGMA user_version，
 *   不是 app_meta 的某一行（全仓没有代码往里写游标）。
 *   app_meta 只是 KV 草稿表，删掉它不会让 v1~v17 重跑。
 *   但「清空库却把版本号留在某个业务表里」这种设计太容易被人以后踩进去，
 *   所以这里删完之后再显式把版本号写一遍 SCHEMA_VERSION ——
 *   正常情况下是空操作，异常情况下能兜住「迁移把刚补的分类又重建一遍」。
 */
export async function truncateAll() {
  const tables = [
    'txn_tag', 'txn', 'account_snapshot', 'budget_category', 'budget',
    'cycle', 'cycle_skip',
    'category', 'tag', 'account', 'account_combo_member', 'exchange_rate',
    'setting', 'app_meta'
  ]

  return transaction(async () => {
    const missing = []
    for (const t of tables) {
      try {
        await execute(`DELETE FROM ${t}`)
      } catch (e) {
        // 表不存在（迁移没跑成）时继续清后面的，最后把名字带回去给调用方看
        if (/no such table/i.test(e && e.message ? e.message : '')) {
          missing.push(t)
          continue
        }
        throw e
      }
    }

    // 见上方注释：版本号本来就在库头，这里只是显式对齐一次，防迁移重跑
    await writeUserVersion(SCHEMA_VERSION)

    return { missing }
  })
}

/**
 * Upsert 辅助 —— 不用 ON CONFLICT DO UPDATE。
 * 原因：Android 各版本内置的 SQLite 内核版本不一致，
 * ON CONFLICT DO UPDATE 需要 3.24+，在旧内核上会直接报语法错误。
 * 这里统一退化为「先 UPDATE，若不存在则 INSERT」，兼容所有版本。
 *
 * @param {string} table
 * @param {object} row 字段名 -> 值
 * @param {string[]} keyCols 唯一键列
 */
export async function upsert(table, row, keyCols) {
  const cols = Object.keys(row)
  const where = keyCols.map((k) => `${k} = ?`).join(' AND ')
  const whereParams = keyCols.map((k) => row[k])

  const exist = await queryOne(`SELECT 1 AS x FROM ${table} WHERE ${where}`, whereParams)

  if (exist) {
    return execute(
      `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${where}`,
      cols.map((c) => row[c]).concat(whereParams)
    )
  }
  return execute(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => row[c])
  )
}

/** 调试用：列出所有表 */


export { DB_NAME, DB_PATH, bindParams }
