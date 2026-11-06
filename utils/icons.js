/**
 * 分类图标 —— 用 emoji 而非字体图标
 *
 * 为什么不用组件库的图标字体：
 *   wd-icons.ttf 里与消费相关的字形只有 fork / shop / home / read / video /
 *   heart / gift / wallet / creditcard 不到十个，覆盖不了餐饮、交通、医疗、
 *   教育、人情、理财等二十多个分类。硬凑会出现大量分类共用同一个图标。
 *
 * 为什么用 emoji：
 *   1. 原生渲染，Android / iOS 都自带，不需要任何图片资源
 *   2. 彩色，视觉上比单色字体图标更清晰
 *   3. 数量足够，可以给每个分类配一个贴切的
 *   4. 用户自定义分类时可以直接选，不需要我们设计新图标
 */

/** 图标键 -> emoji */
export const ICON_MAP = {
  // 支出
  food:     '🍜',   // 餐饮
  car:      '🚗',   // 交通
  shop:     '🛍️',   // 购物
  home:     '🏠',   // 居住
  game:     '🎮',   // 娱乐
  medical:  '💊',   // 医疗
  book:     '📚',   // 教育
  gift:     '🎁',   // 人情
  // 收入
  money:    '💰',   // 工资
  chart:    '📈',   // 理财
  work:     '💼',   // 兼职
  // 其他常用
  travel:   '✈️',   // 旅行
  pet:      '🐾',   // 宠物
  sport:    '⚽',   // 运动
  phone:    '📱',   // 通讯
  clothes:  '👕',   // 服饰
  beauty:   '💄',   // 美妆
  baby:     '🍼',   // 母婴
  carfare:  '🚌',   // 公交
  fuel:     '⛽',   // 加油
  rent:     '🏘️',   // 房租
  water:    '💧',   // 水电
  net:      '🌐',   // 宽带
  coffee:   '☕',   // 咖啡
  snack:    '🍿',   // 零食
  movie:    '🎬',   // 电影
  music:    '🎵',   // 音乐
  fitness:  '🏋️',  // 健身
  smoke:    '🚬',   // 烟酒
  insurance:'🛡️',  // 保险
  tax:      '🧾',   // 税费
  loan:     '🏦',   // 还款
  invest:   '💹',   // 投资
  refund:   '↩️',   // 退款
  bonus:    '🎊',   // 奖金
  card:     '💳',   // 储蓄卡
  wallet:   '👛',   // 现金
  prepaid:  '🎫',   // 充值卡
  alipay:   '🅰️',   // 支付宝
  wechat:   '💬',   // 微信
  creditcard: '💳', // 信用卡
  huabei:   '🌸',   // 花呗
  invest:   '💹',   // 投资
  // ---- 二级分类用（每个二级分类都有自己的图标） ----
  daily:      '🧴',   // 日用品
  digital:    '💻',   // 数码
  socialsec:  '🏥',   // 医保 / 社保
  social:     '🤝',   // 团建 / 聚会
  tuition:    '🎓',   // 学费
  stationery: '✏️',   // 文具
  party:      '🎊',   // 随份子
  redpacket:  '🧧',   // 红包
  // 兜底
  more:     '📦',   // 其他
  // ---- 系统预置分类（借入 / 借出） ----
  lend:     '📤',   // 借出（钱出去）
  borrow:   '📥'    // 借入（钱进来）
}

/** 供设置页选择图标用的分组列表 */
export const ICON_OPTIONS = [
  { key: 'food', label: '餐饮' },
  { key: 'coffee', label: '咖啡' },
  { key: 'snack', label: '零食' },
  { key: 'car', label: '打车' },
  { key: 'carfare', label: '公交' },
  { key: 'fuel', label: '加油' },
  { key: 'travel', label: '旅行' },
  { key: 'shop', label: '购物' },
  { key: 'clothes', label: '服饰' },
  { key: 'beauty', label: '美妆' },
  { key: 'home', label: '居住' },
  { key: 'rent', label: '房租' },
  { key: 'water', label: '水电' },
  { key: 'net', label: '宽带' },
  { key: 'game', label: '娱乐' },
  { key: 'movie', label: '电影' },
  { key: 'music', label: '音乐' },
  { key: 'fitness', label: '健身' },
  { key: 'sport', label: '运动' },
  { key: 'medical', label: '医疗' },
  { key: 'book', label: '教育' },
  { key: 'pet', label: '宠物' },
  { key: 'baby', label: '母婴' },
  { key: 'phone', label: '通讯' },
  { key: 'smoke', label: '烟酒' },
  { key: 'gift', label: '人情' },
  { key: 'money', label: '工资' },
  { key: 'bonus', label: '奖金' },
  { key: 'chart', label: '理财' },
  { key: 'invest', label: '投资' },
  { key: 'work', label: '兼职' },
  { key: 'refund', label: '退款' },
  { key: 'insurance', label: '保险' },
  { key: 'loan', label: '还款' },
  { key: 'tax', label: '税费' },
  { key: 'daily', label: '日用品' },
  { key: 'digital', label: '数码' },
  { key: 'socialsec', label: '社保' },
  { key: 'social', label: '聚会' },
  { key: 'tuition', label: '学费' },
  { key: 'stationery', label: '文具' },
  { key: 'party', label: '随份子' },
  { key: 'redpacket', label: '红包' },
  { key: 'lend', label: '借出' },
  { key: 'borrow', label: '借入' },
  { key: 'more', label: '其他' }
]

/** 取 emoji，未知键退回 📦 */
export function iconEmoji(key) {
  return ICON_MAP[key] || ICON_MAP.more
}

/**
 * 按分类名猜一个图标（用于历史数据没有 icon 字段的情况）
 * 只做最粗的匹配，命中就返回，不命中给 📦
 */
export function guessIconByName(name) {
  if (!name) return ICON_MAP.more
  const n = String(name)

  /*
   * ★ 顺序就是优先级：从最具体的词到最泛的字 ★
   *   比如「学费学杂费」里含「学」，如果先命中 ['学']->book,
   *   它就永远拿不到 tuition；「奖学金」同理（它应该算收入类）。
   *   所以凡是带「大类字」的复合词，都排在泛字规则前面。
   */
  const rules = [
    // ---- 餐饮 ----
    // 「水果蔬菜」里有个「菜」字，必须排在 ['菜'] 这条泛规则前面
    [['水果', '蔬菜'], 'snack'],
    [['日常三餐', '早', '午', '晚', '餐', '饭', '外卖', '菜'], 'food'],
    [['奶茶', '饮料', '咖啡', '茶饮'], 'coffee'],
    [['零食', '小吃'], 'snack'],
    [['超市', '零售', '便利店'], 'shop'],
    [['快递', '邮费', '邮寄', '运费'], 'shop'],

    // ---- 交通 ----
    [['洗车', '维保', '保养', '停车', '过路', '高速'], 'car'],
    [['打车', '租车', '出租车'], 'car'],
    [['公交', '地铁', '公共交通'], 'carfare'],
    [['加油', '充电', '油费'], 'fuel'],
    [['长途', '机票', '火车', '高铁', '飞机'], 'travel'],
    [['旅游', '度假', '旅行'], 'travel'],
    [['罚款', '违章', '罚金'], 'tax'],
    // 泛字规则放最后：具体词都命中过了，剩下的「交通」才归到车
    [['交通', '出行'], 'car'],

    // ---- 居住 ----
    [['房租', '房贷', '物业'], 'rent'],
    [['水电', '水费', '电费', '燃气', '取暖', '暖气'], 'water'],
    [['洗衣', '洗澡', '热水'], 'water'],
    [['宽带', '话费', '通讯', '网费'], 'net'],
    [['家政', '维修'], 'home'],

    // ---- 购物 ----
    [['家居', '日用', '日用品'], 'daily'],
    [['衣服', '服饰', '鞋', '衣物', '鞋包'], 'clothes'],
    [['数码', '电器', '家电', '电子'], 'digital'],
    [['美妆', '化妆', '护肤', '个护'], 'beauty'],

    // ---- 医疗 / 健康 ----
    [['医保', '社保', '健康保健', '保健'], 'socialsec'],
    [['医疗', '买药', '药', '看病', '体检'], 'medical'],
    [['健身', '运动'], 'fitness'],

    // ---- 娱乐 / 学习 ----
    // 复合词先于单字：否则「休闲娱乐」会先被「休闲」抢走
    [['休闲娱乐'], 'social'],
    [['休闲玩乐', '休闲'], 'game'],
    [['社交娱乐', '娱乐', '游戏'], 'game'],
    [['社交', '聚会'], 'social'],
    [['电影'], 'movie'],
    [['音乐', '会员'], 'music'],
    // 「奖学金」要在 ['学'] 之前，否则会掉进「教育」里；
    // 「奖金补贴」又要在 ['补贴'] 之前，否则会掉进「常规补贴」的 money 里。
    [['年终', '季度奖', '项目奖金', '奖金'], 'bonus'],
    [['奖学金', '补贴', '津贴', '补助', '父母'], 'money'],
    [['学费', '学杂费', '培训', '考证'], 'tuition'],
    [['书', '文具', '课程'], 'book'],
    [['人工智能', 'AI', '智能'], 'book'],
    [['教育', '学'], 'book'],

    // ---- 人情 / 其他 ----
    [['份子'], 'party'],
    [['人情', '红包', '礼物', '送礼', '礼金', '请客'], 'gift'],
    [['捐', '公益'], 'gift'],
    [['宠物'], 'pet'],
    [['母婴', '宝宝'], 'baby'],
    [['烟', '酒'], 'smoke'],
    [['意外', '损失', '保险'], 'insurance'],

    // ---- 收入 ----
    [['工资', '薪'], 'money'],
    [['年终', '季度奖', '项目奖金', '奖金'], 'bonus'],
    [['理财', '利息', '分红', '投资收益'], 'chart'],
    [['投资', '基金', '股票'], 'invest'],
    [['兼职', '稿费', '外快', '副业', '劳务'], 'work'],
    [['租金'], 'rent'],
    [['二手', '闲置'], 'more'],
    [['押金', '返还'], 'refund'],
    [['退税'], 'tax'],
    [['退款', '退货', '报销'], 'refund'],
    [['还款'], 'loan'],
    [['借出', '借给', '外借'], 'lend'],
    [['借入', '借来', '借了'], 'borrow'],
    [['税'], 'tax'],
    // ★ 兜底用一级分类名继续猜 ★
    //   上面全是二级词，用户直接写一级名（「居住住房」「购物消费」）时
    //   不能掉到 📦，否则新建分类时图标跟名字明显不搭。
    [['居住', '住房', '家'], 'home'],
    [['购物', '消费', '买'], 'shop']
  ]

  for (const [keywords, key] of rules) {
    if (keywords.some((k) => n.includes(k))) return ICON_MAP[key]
  }
  return ICON_MAP.more
}
