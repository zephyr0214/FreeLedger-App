/**
 * 建表 DDL —— v1
 *
 * 约定：
 *   - 金额一律整数「分」，字段名以 _cents 结尾
 *   - 主键统一 TEXT uuid，便于导入合并时不冲突
 *   - 时间：occurred_at (UTC 毫秒) + occurred_day / month_key / year_key 冗余键
 *   - 删除一律软删除 deleted_at，用于撤销与恢复
 */

export const SCHEMA_VERSION = 4

/**
 * 「对账」固定分类（v4 起）
 *
 * 用户直接改账户余额时，差额必须记一笔「对账支出 / 对账收入」，
 * 这样余额公式（期初 + 收入 - 支出）才成立、账也对得上。
 *
 * 这两条是**固定的一级分类**（parent_id = NULL）：
 *   - 分类管理里不能改名、不能改图标/颜色、不能删除
 *   - expense 类型下叫「对账支出」，income 类型下叫「对账收入」
 *
 * 放在 schema.js 是为了让 api/category.js 和 api/db/index.js（迁移 v4）
 * 共用同一份定义，避免两处各写一遍、改了一处忘了另一处。
 */
export const RECONCILE_CATEGORIES = [
  { type: 'expense', name: '对账支出', icon: 'more', color: '#969799' },
  { type: 'income', name: '对账收入', icon: 'more', color: '#969799' }
]

/**
 * 旧结构的一级分类名（v3 及以前）
 *
 * 旧结构是「对账调整」一级 → 下面挂「对账支出」「对账收入」两个二级。
 * 迁移 v4 负责把它拆成两个独立的一级分类。
 */
export const RECONCILE_LEGACY_NAME = '对账调整'

export const SCHEMA_V1 = [
  // ---------------------------------------------------------------- 账户
  `CREATE TABLE IF NOT EXISTS account (
    id                    TEXT PRIMARY KEY,
    name                  TEXT    NOT NULL,
    type                  TEXT    NOT NULL DEFAULT 'cash',
    icon                  TEXT,
    color                 TEXT,
    initial_balance_cents INTEGER NOT NULL DEFAULT 0,
    balance_cents         INTEGER NOT NULL DEFAULT 0,
    include_in_total      INTEGER NOT NULL DEFAULT 1,
    credit_limit_cents    INTEGER,
    bill_day              INTEGER,
    repay_day             INTEGER,
    card_tail             TEXT,
    sort                  INTEGER NOT NULL DEFAULT 0,
    archived              INTEGER NOT NULL DEFAULT 0,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    deleted_at            INTEGER
  )`,

  // ------------------------------------------------------- 账户每日快照
  `CREATE TABLE IF NOT EXISTS account_snapshot (
    id            TEXT PRIMARY KEY,
    account_id    TEXT    NOT NULL,
    day           TEXT    NOT NULL,
    balance_cents INTEGER NOT NULL,
    created_at    INTEGER NOT NULL,
    UNIQUE (account_id, day)
  )`,

  // ---------------------------------------------------------------- 分类
  `CREATE TABLE IF NOT EXISTS category (
    id         TEXT PRIMARY KEY,
    parent_id  TEXT,
    name       TEXT    NOT NULL,
    type       TEXT    NOT NULL,
    icon       TEXT,
    color      TEXT,
    sort       INTEGER NOT NULL DEFAULT 0,
    hidden     INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`,

  // ------------------------------------------------------ 标签（= 项目）
  `CREATE TABLE IF NOT EXISTS tag (
    id         TEXT PRIMARY KEY,
    name       TEXT    NOT NULL,
    color      TEXT,
    sort       INTEGER NOT NULL DEFAULT 0,
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`,

  // ---------------------------------------------------------------- 交易
  `CREATE TABLE IF NOT EXISTS txn (
    id            TEXT PRIMARY KEY,
    type          TEXT    NOT NULL,
    amount_cents  INTEGER NOT NULL,
    account_id    TEXT    NOT NULL,
    to_account_id TEXT,
    category_id   TEXT,
    note          TEXT,
    occurred_at   INTEGER NOT NULL,
    occurred_day  TEXT    NOT NULL,
    month_key     TEXT    NOT NULL,
    year_key      TEXT    NOT NULL,
    tz_offset     INTEGER NOT NULL DEFAULT 480,
    source        TEXT    NOT NULL DEFAULT 'manual',
    raw_text      TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    deleted_at    INTEGER,
    exclude_from_budget INTEGER NOT NULL DEFAULT 0
  )`,

  // ------------------------------------------------------------ 交易-标签
  `CREATE TABLE IF NOT EXISTS txn_tag (
    txn_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (txn_id, tag_id)
  )`,

  // ---------------------------------------------------------------- 预算
  `CREATE TABLE IF NOT EXISTS budget (
    id           TEXT PRIMARY KEY,
    scope        TEXT    NOT NULL,
    category_id  TEXT,
    period       TEXT    NOT NULL DEFAULT 'month',
    amount_cents INTEGER NOT NULL,
    start_month  TEXT    NOT NULL,
    rollover     INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  )`,

  // ------------------------------------------------------------ 设置 KV
  `CREATE TABLE IF NOT EXISTS setting (
    key   TEXT PRIMARY KEY,
    value TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  )`
]

/**
 * 索引。
 * 注意：partial index（带 WHERE 子句）需要 SQLite 3.8+，
 * 而 plus.sqlite 在不同 Android 版本下内核版本不一致，
 * 因此这里全部使用普通索引，不做部分索引，避免建表静默失败。
 */
export const INDEXES_V1 = [
  `CREATE INDEX IF NOT EXISTS idx_txn_month_type ON txn(month_key, type)`,
  `CREATE INDEX IF NOT EXISTS idx_txn_acc_time   ON txn(account_id, occurred_at)`,
  `CREATE INDEX IF NOT EXISTS idx_txn_cat_month  ON txn(category_id, month_key)`,
  `CREATE INDEX IF NOT EXISTS idx_txn_day        ON txn(occurred_day)`,
  `CREATE INDEX IF NOT EXISTS idx_txn_time       ON txn(occurred_at)`,
  `CREATE INDEX IF NOT EXISTS idx_snap_acc_day   ON account_snapshot(account_id, day)`,
  `CREATE INDEX IF NOT EXISTS idx_snap_day       ON account_snapshot(day)`,
  `CREATE INDEX IF NOT EXISTS idx_cat_parent     ON category(parent_id, sort)`,
  `CREATE INDEX IF NOT EXISTS idx_budget_scope   ON budget(scope, start_month)`,
  `CREATE INDEX IF NOT EXISTS idx_txn_tag_tag    ON txn_tag(tag_id)`
]
