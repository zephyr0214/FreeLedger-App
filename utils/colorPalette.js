/**
 * 分类 / 标签通用色板 —— 16 色 + 中文名
 *
 * ★ 为什么抽成共享文件 ★
 *   分类编辑弹层和标签编辑弹层要用同一套颜色、同一套顺序、
 *   同一套名称和同一套居中布局；各写一份迟早会漂移。
 *
 * ★ 顺序按冷暖 / 明暗排 ★
 *   第一行：珊瑚橙 → 暖橘 → 明黄 → 草绿 → 收支绿 → 青碧 → 湖蓝 → 账本蓝
 *   第二行：靛蓝 → 紫罗兰 → 樱粉 → 朱砂 → 棕色 → 蓝灰 → 深绿 → 中灰
 *   颜色都取自 App 现有主题色 / 分类色系，不引入突兀的高饱和色。
 */

export const COLOR_PALETTE = [
  { value: '#FF976A', name: '珊瑚橙' },
  { value: '#FF8F1F', name: '暖橘' },
  { value: '#FFD60A', name: '明黄' },
  { value: '#8BC34A', name: '草绿' },
  { value: '#07C160', name: '收支绿' },
  { value: '#26A69A', name: '青碧' },
  { value: '#00BCD4', name: '湖蓝' },
  { value: '#1989FA', name: '账本蓝' },
  { value: '#5C6BC0', name: '靛蓝' },
  { value: '#7D5FFF', name: '紫罗兰' },
  { value: '#FF6B9D', name: '樱粉' },
  { value: '#EE0A24', name: '朱砂' },
  { value: '#8D6E63', name: '棕色' },
  { value: '#78909C', name: '蓝灰' },
  { value: '#0A8F4A', name: '深绿' },
  { value: '#969799', name: '中灰' }
]

/** 新分类 / 新标签的默认颜色（第一个） */
export const DEFAULT_COLOR = COLOR_PALETTE[0].value
