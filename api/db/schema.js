/**
 * 建表 DDL —— v1
 *
 * 约定：
 *   - 金额一律整数「分」，字段名以 _cents 结尾
 *   - 主键统一 TEXT uuid，便于导入合并时不冲突
 *   - 时间：occurred_at (UTC 毫秒) + occurred_day / month_key / year_key 冗余键
 *   - 删除一律软删除 deleted_at，用于撤销与恢复
 */

export const SCHEMA_VERSION = 7

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

/**
 * 默认分类表（v5 起）
 *
 * ★ 为什么定义在 schema.js 而不是 api/category.js ★
 *   两处都要用这份结构：
 *     - api/category.js 的 seedDefaultCategories()（全新安装时写）
 *     - api/db/index.js 的迁移 v5（老设备重建时写）
 *   而 api/category.js 依赖 api/db/index.js，反过来 import 就成环了。
 *   schema.js 不依赖任何模块，是唯一能放「两边共用」的地方 ——
 *   和 RECONCILE_CATEGORIES 一样的思路。
 *
 * ★ icon 字段的取值必须是 utils/icons.js 里 ICON_MAP / ICON_OPTIONS 的键 ★
 *
 * ★ 结构是一级 + 二级 ★
 *   一级是「统计口径」（餐饮食品、交通出行…），二级是用户真正记的那一项
 *   （正餐、饮品、零食/小吃…）。
 *
 * ★ 二级分类有自己的图标（v6 起）★
 *   以前二级分类直接继承父级的 icon，用户没法给「早餐」单独配图标。
 *   现在 children 里每一项都是 { name, icon } 对象：
 *     - icon   独立图标
 *     - color  省略时继承父级颜色
 *   写成对象而不是纯字符串，是为了给以后「二级也自定义颜色」留口子；
 *   读取时统一用 childIcon() / childColor() 两个 helper 兜住两种写法。
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  {
    name: '餐饮食品', icon: 'food', color: '#FF976A',
    children: [
      { name: '正餐', icon: 'food' },
      { name: '饮品', icon: 'coffee' },
      { name: '零食/小吃', icon: 'snack' },
      { name: '超市/零售', icon: 'shop' }
    ]
  },
  {
    name: '交通出行', icon: 'car', color: '#1989FA',
    children: [
      { name: '公共交通/打车', icon: 'carfare' },
      { name: '火车/飞机', icon: 'travel' },
      { name: '加油/停车', icon: 'fuel' }
    ]
  },
  {
    name: '居住住房', icon: 'home', color: '#7D5FFF',
    children: [
      { name: '房租/房贷/物业', icon: 'rent' },
      { name: '水电燃气', icon: 'water' },
      { name: '话费/网费', icon: 'phone' }
    ]
  },
  {
    name: '购物消费', icon: 'shop', color: '#EE0A24',
    children: [
      { name: '日用品', icon: 'daily' },
      { name: '服饰', icon: 'clothes' },
      { name: '数码', icon: 'digital' }
    ]
  },
  {
    name: '医疗健康', icon: 'medical', color: '#FF8F1F',
    children: [
      { name: '买药/看病', icon: 'medical' },
      { name: '健身', icon: 'fitness' },
      { name: '医保/社保', icon: 'socialsec' }
    ]
  },
  {
    name: '社交娱乐', icon: 'game', color: '#07C160',
    children: [
      { name: '旅游', icon: 'travel' },
      { name: '娱乐', icon: 'game' },
      { name: '团建', icon: 'social' }
    ]
  },
  {
    name: '学校学习', icon: 'book', color: '#0A8F4A',
    children: [
      { name: '学费', icon: 'tuition' },
      { name: '书籍/课程/资料', icon: 'book' },
      { name: '文具', icon: 'stationery' }
    ]
  },
  {
    name: '人情往来', icon: 'gift', color: '#FF6B9D',
    children: [
      { name: '随份子', icon: 'party' },
      { name: '红包', icon: 'redpacket' },
      { name: '送礼', icon: 'gift' }
    ]
  },
  { name: '其他/杂项', icon: 'more', color: '#969799', children: [] }
]

export const DEFAULT_INCOME_CATEGORIES = [
  { name: '工资',     icon: 'money',  color: '#07C160', children: [] },
  { name: '奖金补贴', icon: 'bonus',  color: '#FF8F1F', children: [] },
  { name: '副业劳务', icon: 'work',   color: '#7D5FFF', children: [] },
  { name: '租金收入', icon: 'rent',   color: '#1989FA', children: [] },
  { name: '投资收益', icon: 'chart',  color: '#0A8F4A', children: [] },
  { name: '红包礼金', icon: 'gift',   color: '#FF6B9D', children: [] },
  { name: '二手出售', icon: 'more',   color: '#EE0A24', children: [] },
  { name: '退款返还', icon: 'refund', color: '#26A69A', children: [] },
  { name: '父母补贴', icon: 'money',  color: '#FFD60A', children: [] }
]

/**
 * 取二级分类的图标
 *
 * 兼容两种写法：
 *   { name: '正餐', icon: 'food' }   -> 'food'
 *   '正餐'（旧写法，继承父级）      -> parentIcon
 *
 * @param {object|string} child 二级分类定义
 * @param {string} parentIcon 父级图标（兜底）
 * @returns {string}
 */
export function childIcon(child, parentIcon) {
  if (child && typeof child === 'object') {
    return child.icon || parentIcon
  }
  return parentIcon
}

/**
 * 取二级分类的颜色
 *
 * 二级默认继承父级颜色；以后要做「二级自定义颜色」时，
 * 只要在 child 上写 color 就会自动生效。
 *
 * @param {object|string} child 二级分类定义
 * @param {string} parentColor 父级颜色（兜底）
 * @returns {string}
 */
export function childColor(child, parentColor) {
  if (child && typeof child === 'object' && child.color) {
    return child.color
  }
  return parentColor
}

/**
 * 分类别名 —— 速记解析用
 *
 * ★ 键名要和上面的一级分类名对齐 ★
 *   一级分类改名后，这里的键也要跟着改，否则速记的别名就失配了。
 */
export const DEFAULT_ALIAS = {
  餐饮食品: ['吃', '吃饭', '外卖', '午饭', '晚饭', '早餐', '奶茶', '咖啡', '下馆子', '喝', '饭', '零食', '超市'],
  交通出行: ['打车', '地铁', '公交', '加油', '停车', '高铁', '飞机', '滴滴', '车费', '火车'],
  居住住房: ['房租', '房贷', '物业', '燃气', '宽带', '交租', '水费', '电费', '话费', '网费'],
  购物消费: ['买', '淘宝', '京东', '拼多多', '购物', '日用品', '服饰', '数码'],
  医疗健康: ['药', '挂号', '看病', '体检', '健身', '医保', '社保'],
  社交娱乐: ['电影', '游戏', '会员', '续费', '旅游', '唱歌', '团建', '聚会'],
  学校学习: ['书', '课程', '培训', '考试', '学费', '文具', '资料'],
  人情往来: ['红包', '礼物', '请客', '份子', '随份子', '送礼'],
  '其他/杂项': ['其他', '杂项', '别的'],
  工资: ['工资', '发工资', '月薪', '薪水', '底薪'],
  奖金补贴: ['奖金', '年终奖', '补贴', '津贴', '加班费'],
  副业劳务: ['稿费', '项目款', '外快', '兼职', '劳务'],
  租金收入: ['房租收入', '租金', '出租'],
  投资收益: ['利息', '分红', '收益', '基金', '股票'],
  红包礼金: ['收到红包', '礼金', '压岁钱'],
  二手出售: ['二手', '卖掉', '闲鱼', '转卖'],
  退款返还: ['报销', '退款', '返还', '退钱'],
  父母补贴: ['爸妈', '父母', '家里给', '家用']
}

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
