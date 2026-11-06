/**
 * 建表 DDL —— v1
 *
 * 约定：
 *   - 金额一律整数「分」，字段名以 _cents 结尾
 *   - 主键统一 TEXT uuid，便于导入合并时不冲突
 *   - 时间：occurred_at (UTC 毫秒) + occurred_day / month_key / year_key 冗余键
 *   - 删除一律软删除 deleted_at，用于撤销与恢复
 */

export const SCHEMA_VERSION = 17

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
 * 「系统分类」—— 固定分类组（v14 起，v18 起改名）
 *
 * ★ 为什么要有这个父级 ★
 *   用户要求分类页里把这几个「系统自己用的、用户不能改」的分类收进
 *   一个固定的一级分类里：
 *     支出：借出、借款归还、对账支出
 *     收入：借入、借款收回、对账收入、报销收入
 *   之前「对账支出 / 对账收入」是各自独立的一级分类，
 *   和用户自己的分类混排在一起，看着像可以随便改的普通分类。
 *
 * ★ 名字从「系统预置分类」改成「系统分类」（v18 起）★
 *   名字更短、也更准确（这一组不只是「预置」，而是系统占用的）。
 *   老库里已有的旧名字由 syncDefaultCategories() 改名迁过去；
 *   api/db/index.js 里 v14 / v15 / v16 三条历史迁移仍然要能查到**旧名** ——
 *   它们面对的是还没改名老数据，只按新名查会以为这一组不存在，
 *   于是另建一条空组，把固定子类劈成两半。
 *
 * ★ 两种 type 各有一组 ★
 *   category 表用 type 区分收支，同一个父级不能同时挂两种 type 的子类，
 *   所以「系统分类」在 expense 和 income 下各是一条独立的一级分类
 *   （名字相同、type 不同），它们下面的固定子类各自归位。
 *
 * ★ 固定子类不可删改 ★
 *   「对账支出 / 对账收入」是余额对账的记账口径，
 *   「借出 / 借入」是借入借出管理的记账口径，
 *   都被 api/category.js 的 isFixedCategory() 拦住，分类管理里不能改名/删除。
 *
 * 放在 schema.js 是为了让 api/category.js（运行时兜底创建 / 名字同步）
 * 和 api/db/index.js（迁移 v14）共用同一份定义，避免两处不同步。
 */
export const SYSTEM_PRESET_GROUP_NAME = '系统分类'

/**
 * 这一组分类的**旧名字**（v14 ~ v17 用过）
 *
 * 只给「迁移 / 同步」用：老库里存的是旧名，改代码里的常量不影响已存在的数据，
 * 要靠一次 UPDATE 把旧名改成新名。
 */
export const SYSTEM_PRESET_LEGACY_NAME = '系统预置分类'

/** 「系统分类」父级（按 type 各一条） */
export const SYSTEM_PRESET_GROUPS = {
  expense: { name: SYSTEM_PRESET_GROUP_NAME, type: 'expense', icon: 'more', color: '#969799' },
  income: { name: SYSTEM_PRESET_GROUP_NAME, type: 'income', icon: 'more', color: '#969799' }
}

/**
 * 「系统分类」下的固定子类
 *
 * icon 必须是 utils/icons.js 里 ICON_MAP / ICON_OPTIONS 的键。
 *
 * ★ sort 从 900 起 —— 为什么要这么大 ★
 *   `listCategories()` 是**扁平的**一张表（一级 + 二级混在一起），
 *   按 `sort ASC, created_at ASC` 排序。而记账面板的
 *   `defaultCategoryId` 取「第一个没有二级的一级分类/二级分类」。
 *
 *   如果这里的 sort 写成 0 / 1，它们就会和用户自己的分类
 *   （也是从 0 开始编号）混在一起排到最前面 ——
 *   后果是「新建一笔支出，默认分类变成『借出』」，
 *   用户莫名其妙地把日常开销记成借出。
 *
 *   所以固定子类统一用 900+ 的大 sort：
 *   在各自父级下它们仍然按 900、901 的顺序显示（顺序不变），
 *   但在整张扁平表里永远排在用户分类后面。
 *   父级「系统分类」用 999，比子类更靠后（见 SYSTEM_PRESET_GROUPS 的用法）。
 */
export const SYSTEM_PRESET_CHILDREN = [
  // 支出方向：借出（钱借出去）、借款归还（把借来的还回去）
  { type: 'expense', name: '借出', icon: 'lend', color: '#FF8F1F', sort: 900 },
  { type: 'expense', name: '借款归还', icon: 'borrow', color: '#07C160', sort: 901 },
  { type: 'expense', name: '对账支出', icon: 'more', color: '#969799', sort: 902 },
  // 收入方向：借入（钱借进来）、借款收回（借出去的收回来）、报销收入（公司报销到账）
  { type: 'income', name: '借入', icon: 'borrow', color: '#07C160', sort: 900 },
  { type: 'income', name: '借款收回', icon: 'lend', color: '#FF8F1F', sort: 901 },
  { type: 'income', name: '对账收入', icon: 'more', color: '#969799', sort: 902 },
  /*
   * ★ 报销收入（v18 起）★
   *   垫付后公司打回来的钱，既不是工资也不是二手出售，
   *   混进普通收入分类里会污染「工资 / 副业」的统计口径。
   *   它是系统给的一笔固定收入口径，所以放进这一组。
   *   sort 排在对账收入之后，不影响前两条的顺序。
   */
  { type: 'income', name: '报销收入', icon: 'refund', color: '#26A69A', sort: 903 }
]

/**
 * 借入借出四类分类的名字（按方向配对）
 *
 * ★ 为什么按「方向」而不是按「借贷」命名 type ★
 *   一笔借出：钱从我账户出去 -> type = expense（挂在支出下）
 *   借款收回：钱回到我账户   -> type = income （挂在收入下）
 *   一笔借入：钱进我账户     -> type = income （挂在收入下）
 *   借款归还：钱从我账户出去 -> type = expense（挂在支出下）
 *
 *   所以「借出管理」页要同时看 expense 的「借出」和 income 的「借款收回」，
 *   「借入管理」页要同时看 income 的「借入」和 expense 的「借款归还」。
 *   下面这份定义就是给页面算「当前借出 / 当前借入」用的。
 */
export const LOAN_CATEGORY_NAMES = {
  /** 借出：钱借出去（支出） */
  lendOut: { name: '借出', type: 'expense' },
  /** 借款收回：借出去的钱收回来（收入） */
  lendBack: { name: '借款收回', type: 'income' },
  /** 借入：钱借进来（收入） */
  borrowIn: { name: '借入', type: 'income' },
  /** 借款归还：把借来的还回去（支出） */
  borrowBack: { name: '借款归还', type: 'expense' }
}

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
 *   （日常三餐、奶茶饮料、零食小吃…）。
 *
 * ★ 二级分类有自己的图标（v6 起）★
 *   以前二级分类直接继承父级的 icon，用户没法给「日常三餐」单独配图标。
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
      { name: '日常三餐', icon: 'food' },
      { name: '奶茶饮料', icon: 'coffee' },
      { name: '超市零售', icon: 'shop' },
      { name: '水果蔬菜', icon: 'snack' },
      { name: '零食小吃', icon: 'snack' }
    ]
  },
  {
    name: '交通出行', icon: 'car', color: '#1989FA',
    children: [
      { name: '公共交通', icon: 'carfare' },
      { name: '长途交通', icon: 'travel' },
      { name: '加油充电', icon: 'fuel' },
      { name: '打车租车', icon: 'car' },
      { name: '停车过路', icon: 'car' },
      { name: '洗车维保', icon: 'car' },
      { name: '罚款违章', icon: 'tax' }
    ]
  },
  {
    name: '居住住房', icon: 'home', color: '#7D5FFF',
    children: [
      { name: '房租房贷', icon: 'rent' },
      { name: '水费电费', icon: 'water' },
      { name: '通讯宽带', icon: 'net' },
      { name: '家政维修', icon: 'home' },
      { name: '燃气取暖', icon: 'water' },
      { name: '洗衣洗澡', icon: 'water' }
    ]
  },
  {
    name: '购物消费', icon: 'shop', color: '#EE0A24',
    children: [
      { name: '家居日用', icon: 'daily' },
      { name: '服饰鞋包', icon: 'clothes' },
      { name: '数码电器', icon: 'digital' },
      { name: '美妆个护', icon: 'beauty' }
    ]
  },
  {
    name: '医疗健康', icon: 'medical', color: '#FF8F1F',
    children: [
      { name: '买药看病', icon: 'medical' },
      { name: '运动健身', icon: 'fitness' },
      { name: '健康保健', icon: 'socialsec' },
      { name: '医保社保', icon: 'socialsec' }
    ]
  },
  {
    name: '社交娱乐', icon: 'game', color: '#07C160',
    children: [
      { name: '度假旅游', icon: 'travel' },
      { name: '休闲玩乐', icon: 'game' },
      { name: '休闲娱乐', icon: 'social' }
    ]
  },
  {
    name: '学校学习', icon: 'book', color: '#0A8F4A',
    children: [
      { name: '学费学杂费', icon: 'tuition' },
      { name: '书籍文具', icon: 'book' },
      { name: '培训考证', icon: 'stationery' },
      { name: '人工智能', icon: 'book' }
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
  {
    name: '其他支出', icon: 'more', color: '#969799',
    children: [
      { name: '宠物开销', icon: 'pet' },
      { name: '快递邮费', icon: 'shop' },
      { name: '意外损失', icon: 'insurance' },
      { name: '公益捐款', icon: 'gift' },
      { name: '其他支出', icon: 'more' }
    ]
  }
]

export const DEFAULT_INCOME_CATEGORIES = [
  { name: '工资',     icon: 'money',  color: '#07C160', children: [] },
  {
    name: '奖金补贴', icon: 'bonus',  color: '#FF8F1F',
    children: [
      { name: '年终/季度奖', icon: 'bonus' },
      { name: '项目奖金', icon: 'bonus' },
      { name: '常规补贴', icon: 'money' },
      { name: '奖学金', icon: 'money' }
    ]
  },
  { name: '副业劳务', icon: 'work',   color: '#7D5FFF', children: [] },
  { name: '租金收入', icon: 'rent',   color: '#1989FA', children: [] },
  { name: '投资收益', icon: 'chart',  color: '#0A8F4A', children: [] },
  { name: '红包礼金', icon: 'gift',   color: '#FF6B9D', children: [] },
  {
    name: '二手出售', icon: 'more',   color: '#EE0A24',
    children: [
      { name: '数码家电', icon: 'digital' },
      { name: '闲置衣物', icon: 'clothes' }
    ]
  },
  {
    name: '退款返还', icon: 'refund', color: '#26A69A',
    children: [
      { name: '购物退款', icon: 'refund' },
      { name: '退税', icon: 'tax' },
      { name: '押金返还', icon: 'refund' }
    ]
  },
  { name: '父母补贴', icon: 'money',  color: '#FFD60A', children: [] }
]

/**
 * 取二级分类的图标
 *
 * 兼容两种写法：
 *   { name: '日常三餐', icon: 'food' }   -> 'food'
 *   '日常三餐'（旧写法，继承父级）       -> parentIcon
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
  其他支出: ['其他', '杂项', '别的'],
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
    -- ★ 以下四列是历史遗留，业务上已不再使用 ★
    --   信用卡的「额度 / 账单日 / 还款日 / 卡号后四位」已经整套从账户体系删除
    --   （用户需求），新建账户一律写 NULL，页面也不再读。
    --   列**故意保留**：SQLite 删列要重建表，风险远大于收益，
    --   而且老账户的历史值留着比抹掉好（用户想查也查得到，只是没有界面）。
    --   将来真要清理，另开一次带备份的迁移，别顺手在这里删。
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
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    deleted_at    INTEGER,
    exclude_from_budget INTEGER NOT NULL DEFAULT 0,
    via_combo_id  TEXT
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
  )`,

  /**
   * 组合账户的成员表（v11）
   *
   * 组合账户（account.type = 'combo'）不是真实账户：
   * 它不持有余额、不计入总资产，记账时按 sort 顺序解析成下面某一个真实账户。
   * 所以这张表只描述「由哪些真实账户、按什么顺序组成」。
   *
   * ★ sort 是关键 ★
   *   扣款顺序完全由它决定；上下箭头调序就是在改这个字段。
   *   同 sort 时用 member_id 兜底排序，保证结果稳定可复现。
   */
  `CREATE TABLE IF NOT EXISTS account_combo_member (
    combo_id  TEXT    NOT NULL,
    member_id TEXT    NOT NULL,
    sort      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (combo_id, member_id)
  )`,

  /*
   * 汇率历史（v17）—— 外币记账的配套表
   *
   * 为什么按 (day, currency) 存快照：
   *   · 周期补记要用「发生日当天」的汇率，一天一价即可（记账对汇率
   *     精度的要求远低于外汇交易，日级快照完全够用）
   *   · 拉到就落表复用，同一天同一币种绝不重复请求
   *   · 离线/接口全挂时，表里最近一次的汇率就是兜底
   *
   * rate 的口径：1 单位外币 = rate 人民币元（例如 USD -> 7.24）。
   * source 记录数据来自哪个接口，排查汇率异常时用。
   */
  `CREATE TABLE IF NOT EXISTS exchange_rate (
    day        TEXT    NOT NULL,
    currency   TEXT    NOT NULL,
    rate       REAL    NOT NULL,
    source     TEXT    NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (day, currency)
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
  `CREATE INDEX IF NOT EXISTS idx_txn_tag_tag    ON txn_tag(tag_id)`,
  `CREATE INDEX IF NOT EXISTS idx_combo_member   ON account_combo_member(combo_id, sort)`
]
