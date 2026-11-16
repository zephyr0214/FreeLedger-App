/**
 * 旧分类图标 key -> OpenMoji 码点
 *
 * ★ 为什么单独一个文件，不并进 utils/openmoji.js ★
 *   数据库迁移（api/db/index.js）只需要这 53 条映射，
 *   而 utils/openmoji.js 还要 import 4567 条的元数据（约 543KB）。
 *   迁移在 App 启动早期执行，没必要为了 53 条映射把整份元数据拉进内存。
 *
 * ★ 这套映射是「一次性」的 ★
 *   v24 迁移会把库里所有旧 key 改写成 OpenMoji 码点；
 *   之后新写入的 icon 都是码点。这里保留是为了：
 *     1. 迁移本身用；
 *     2. 旧备份 JSON 导入时兜底（备份里可能还是 'food' 这种旧 key）；
 *     3. 极端情况下迁移失败时，界面仍能按旧 key 显示对应图标。
 *
 * ★ 所有目标都必须在保留的五个分组里（v1.24 精简后）★
 *   表情 / 人物 / 符号 / 旗帜等组已经整体剔除，
 *   原来落在这些组的旧 key（fitness / refund / wechat / social）
 *   改用「动物自然 / 食物饮料 / 旅行地点 / 活动 / 物品」里的近义图标。
 */

export const LEGACY_ICON_CODES = {
  // 支出
  food: '1F35C',        // 餐饮：碗面
  car: '1F697',         // 交通：汽车
  shop: '1F6CD',        // 购物：购物袋
  home: '1F3E0',        // 居住：房子
  game: '1F3AE',        // 娱乐：手柄
  medical: '1F48A',     // 医疗：药丸
  book: '1F4DA',        // 教育：书
  gift: '1F381',        // 人情：礼物
  // 收入
  money: '1F4B0',       // 工资：钱袋
  chart: '1F4C8',       // 理财：上涨曲线
  work: '1F4BC',        // 兼职：公文包
  // 其他常用
  travel: '2708',       // 旅行：飞机
  pet: '1F43E',         // 宠物：爪印
  sport: '26BD',        // 运动：足球
  phone: '1F4F1',       // 通讯：手机
  clothes: '1F455',     // 服饰：T 恤
  beauty: '1F484',      // 美妆：口红
  baby: '1F37C',        // 母婴：奶瓶
  carfare: '1F68D',     // 公交：迎面驶来的公交车（正脸，不用侧身细长的 1F68C）
  fuel: '26FD',         // 加油：油泵
  rent: '1F3D8',        // 房租：房屋群
  water: '1F4A7',       // 水电：水滴
  net: '1F310',         // 宽带：地球
  coffee: '2615',       // 咖啡：热饮
  snack: '1F37F',       // 零食：爆米花
  movie: '1F3AC',       // 电影：场记板
  music: '1F3B5',       // 音乐：音符
  fitness: '1F3C5',     // 健身：运动奖牌（举重属于人物组，已剔除）
  smoke: '1F6AC',       // 烟酒：香烟
  insurance: '1F6E1',   // 保险：盾牌
  tax: '1F9FE',         // 税费：票据
  loan: '1F3E6',        // 还款：银行
  invest: '1F4B9',      // 投资：日元上涨
  refund: '1F4B5',      // 退款：钞票（回转箭头属于符号组，已剔除）
  bonus: '1F4B8',       // 奖金：飞钱
  card: '1F4B3',        // 储蓄卡：银行卡
  wallet: '1F45B',      // 现金：钱包
  prepaid: '1F3AB',     // 充值卡：票
  alipay: '1F4F2',      // 支付宝：手机支付
  wechat: '1F4F1',      // 微信：手机（对话框属于表情组，已剔除）
  creditcard: '1F4B3',  // 信用卡：银行卡
  huabei: '1F338',      // 花呗：樱花
  // 二级分类
  daily: '1F9F4',       // 日用品：乳液瓶
  digital: '1F4BB',     // 数码：笔记本电脑
  socialsec: '1F3E5',   // 医保 / 社保：医院
  social: '1F37B',      // 团建 / 聚会：干杯（握手属于人物组，已剔除）
  tuition: '1F393',     // 学费：学士帽
  stationery: '270F',   // 文具：铅笔
  party: '1F38A',       // 随份子：彩球
  redpacket: '1F9E7',   // 红包：红包
  // 兜底
  more: '1F4E6',        // 其他：包裹
  // 系统分类
  lend: '1F4E4',        // 借出：寄出
  borrow: '1F4E5'       // 借入：收件
}

/**
 * 把 icon 字段值转成 OpenMoji 码点。
 *
 * - 已经是码点（如 `1F35C`、`1F468-200D-1F373`）→ 原样返回（大写）
 * - 旧 key（如 `food`）→ 查表
 * - 空 / 未知值 → 返回空串，由调用方决定兜底
 *
 * ★ 这里不校验文件是否存在 ★
 *   迁移层不该依赖 static 目录；合法性由 utils/openmoji.js 的
 *   OPENMOJI_HEX_SET 在显示时再校验一次。
 *
 * @param {string} icon
 * @returns {string}
 */
export function toOpenmojiIconCode(icon) {
  const raw = String(icon === undefined || icon === null ? '' : icon).trim()
  if (!raw) return ''

  // 已经是码点：允许 1F35C / 1F468-200D-1F373 / 26BD 这种形式
  if (/^[0-9A-F]+(?:-[0-9A-F]+)*$/i.test(raw)) return raw.toUpperCase()

  return LEGACY_ICON_CODES[raw] || ''
}
