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

  const rules = [
    [['餐', '饭', '食', '外卖', '早', '午', '晚', '菜'], 'food'],
    [['咖啡', '奶茶'], 'coffee'],
    [['零食', '水果'], 'snack'],
    [['交通', '打车', '出租'], 'car'],
    [['公交', '地铁'], 'carfare'],
    [['加油', '油'], 'fuel'],
    [['旅行', '旅游', '机票'], 'travel'],
    [['购物', '买'], 'shop'],
    [['衣服', '服饰', '鞋'], 'clothes'],
    [['美妆', '化妆', '护肤'], 'beauty'],
    [['房租', '租'], 'rent'],
    [['水电', '燃气'], 'water'],
    [['宽带', '话费', '通讯'], 'net'],
    [['娱乐', '游戏'], 'game'],
    [['电影'], 'movie'],
    [['音乐', '会员'], 'music'],
    [['健身', '运动'], 'fitness'],
    [['医疗', '药', '看病', '体检'], 'medical'],
    [['教育', '书', '课程', '学'], 'book'],
    [['宠物'], 'pet'],
    [['母婴', '宝宝'], 'baby'],
    [['烟', '酒'], 'smoke'],
    [['人情', '红包', '礼物', '请客'], 'gift'],
    [['工资', '薪'], 'money'],
    [['奖金', '年终'], 'bonus'],
    [['理财', '利息', '分红'], 'chart'],
    [['投资', '基金', '股票'], 'invest'],
    [['兼职', '稿费', '外快'], 'work'],
    [['退款', '报销'], 'refund'],
    [['保险'], 'insurance'],
    [['还款', '还款'], 'loan'],
    [['借出', '借给', '外借'], 'lend'],
    [['借入', '借来', '借了'], 'borrow'],
    [['税'], 'tax']
  ]

  for (const [keywords, key] of rules) {
    if (keywords.some((k) => n.includes(k))) return ICON_MAP[key]
  }
  return ICON_MAP.more
}
