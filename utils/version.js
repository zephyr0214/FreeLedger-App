/**
 * 版本号与更新日志 —— 全 App 唯一的版本信息来源
 *
 * ★ 为什么要有这个文件 ★
 *   以前版本号散在三处手写：
 *     manifest.json 的 versionName
 *     pages/settings/about.vue 的 <text class="app-version">v1.13.0</text>
 *     pages/mine/index.vue 的「自由记 v1.13.0」
 *   改一处忘一处，就会出现「关于页显示 v1.13、我的页显示 v1.16」。
 *   现在三个地方都从 APP_VERSION 取，只改这一处。
 *
 * ★ 版本号规则（用户指定）★
 *   · 有数据库迁移（SCHEMA_VERSION 变化）→ 升次版本号，且**次版本号 == SCHEMA_VERSION**
 *     例：SCHEMA_VERSION 从 13 到 16 -> 版本号 1.13.0 -> 1.16.0
 *   · 没有迁移 → 在次版本号后面递增修订号：1.16.0 -> 1.16.1 -> 1.16.2
 *   所以这里存的是「语义化版本」字符串，manifest 里用三段式。
 *
 * ★ 更新日志怎么维护 ★
 *   RELEASES 是**倒序**数组（最新的在最前面），每个版本一个对象：
 *     { version, date, schemaVersion, sections: [{ title, items: [] }] }
 *   sections 对应「关于」页那种段落排版：
 *     title 是段落小标题（新增 / 优化 / 修复 / 数据迁移…），
 *     items 是句子列表，逐段渲染（不用手写换行，理由见 about.vue 的注释）。
 *
 * ★ schemaVersion 字段有什么用 ★
 *   它是这一版对应的数据库结构版本，写进日志里是为了：
 *     1. 一眼看出哪些版本带迁移（用户升级前知道要不要备份）
 *     2. 测试可以断言「最新一条的 schemaVersion == SCHEMA_VERSION」
 *        —— 防止改了迁移忘了更新日志
 */

/**
 * 当前版本号（展示用，**始终三段式**）
 *
 * ★ 规则（用户指定）★
 *   · 有数据库迁移 → 次版本号跟着 SCHEMA_VERSION 走：
 *     SCHEMA_VERSION = 15 时是 1.15.0，改成 16 就同步成 1.16.0
 *   · 没有迁移 → 递增修订号：1.16.0 -> 1.16.1 -> 1.16.2
 *   即使修订号是 0，也要写全三段（1.16.0 而不是 1.16），
 *   这样「我的」页、关于页、manifest 三处显示的永远同一个形状。
 *
 * ★ 改版本号只改这里 ★
 *   about.vue / mine/index.vue 都读它；
 *   scripts/test-version.mjs 会核对：
 *     manifest.json 是否同步、次版本号是否等于 SCHEMA_VERSION。
 */
export const APP_VERSION = '1.23.7'

/**
 * 三段式版本号（兜底补零）
 *
 * 现在 APP_VERSION 本身就是三段，这个函数主要给
 * 「万一有人写成 1.16」的情况兜底，保证 manifest 那边不出错。
 */
export function toSemver(version = APP_VERSION) {
  const parts = String(version).split('.').filter(Boolean)
  while (parts.length < 3) parts.push('0')
  return parts.slice(0, 3).join('.')
}

/**
 * 版本号对应的 versionCode（整数，单调递增）
 *
 * manifest.json 要求 versionCode 是整数且每次发版都必须变大，
 * 否则安卓不允许覆盖安装。规则：
 *   1.16   -> 1160
 *   1.16.1 -> 1161
 *   1.16.2 -> 1162
 *   1.16.3 -> 1163
 *   1.16.4 -> 1164
 *   1.16.5 -> 1165
 */
export function toVersionCode(version = APP_VERSION) {
  const [major = '1', minor = '16', patch = '0'] = toSemver(version).split('.')
  return Number(major) * 1000 + Number(minor) * 10 + Number(patch)
}

/**
 * 比较两个版本号（容忍 v 前缀、两段式，内部走 toSemver 补零）
 *
 * ★ 为什么不用字符串比较 ★
 *   '1.9' > '1.10' 在字典序里成立但在语义上是倒退 ——
 *   必须按数字逐段比。检查更新要用它判断「远端是否比本地新」。
 *
 * @returns {number} 1 = a 更新，-1 = b 更新，0 = 相同
 */
export function compareVersions(a, b) {
  const pa = toSemver(String(a).replace(/^v/i, '')).split('.').map(Number)
  const pb = toSemver(String(b).replace(/^v/i, '')).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1
    if (pa[i] < pb[i]) return -1
  }
  return 0
}

/**
 * 「自由记 v1.16」这种带前缀的展示文案
 */
export const APP_VERSION_LABEL = `v${APP_VERSION}`

/**
 * 更新日志 —— 倒序（最新版本在最前面）
 *
 * ★ 版本号怎么和 git 历史对应 ★
 *   v1.13.0 是开发者手工定的版本号，它恰好等于当时的 SCHEMA_VERSION = 13。
 *   所以规则就是：**次版本号 == 当时的数据库结构版本**。
 *
 *   当前 SCHEMA_VERSION = 23（v17 外币记账、v18 子预算多类别、
 *   v19 借款不进收支 + 结清派生分类、v20 系统分类全部可选、
 *   v21 报销台账、v22 周期的报销/预算标记、v23 报销单），
 *   所以当前版本是 **1.23.0**。
 *   ★ 这三条迁移没有拆成 1.14 / 1.15 / 1.16 三个版本 ★
 *     它们是同一天、同一批需求做出来的、一次打包发出去的，
 *     版本号直接对齐到最终的结构版本 16，中间不单独发版。
 *
 *   更早的历史（schema 1~13）按迁移边界 + 日期还原：
 *     v1.0.0  schema 1    项目骨架与可用闭环
 *     v1.1.0  schema 1    三个主页面 + 设置子页 + AI 输入
 *     v1.2.0  schema 2    资产趋势图、统计页重构、账户类型五类
 *     v1.3.0  schema 3    筛选联动、统一详情页、不计入预算
 *     v1.4.0  schema 4    默认分类表重建、组件库弹窗
 *     v1.5.0  schema 5    分类管理页重做
 *     v1.6.0  schema 6    线性图标库、记账按钮设置、删除解耦
 *     v1.7.0  schema 7    周期管理
 *     v1.8.0  schema 8    周期自动补记
 *     v1.9.0  schema 9    周期跳过日、停用速记原文字段
 *     v1.10.0 schema 10   悬浮 tabBar、账户图标预设化
 *     v1.11.0 schema 11   组合账户
 *     v1.12.0 schema 12   AI 对话改造
 *     v1.13.0 schema 13   AI 稳定性
 *     v1.16.0 schema 16   借入借出 + 系统预置分类
 *     v1.17.0 schema 17   外币记账
 *     v1.18.0 schema 18   月预算结转、子预算多类别
 *     v1.19.0 schema 19   借款不计收支、借入借出按人员管理
 *     v1.20.0 schema 20   借入借出双向结清、系统分类全部可选
 *     v1.21.0 schema 21   报销台账（待报销/已报销）
 *     v1.22.0 schema 22   周期也能勾报销/预算、报销状态徽标
 *     v1.23.0 schema 23   报销单、统计页组件管理、同比面板重做
 *     v1.23.1 schema 23   环比/储蓄率/预算执行面板、系统分类禁待报销、AI 借还方向
 *     v1.23.2 schema 23   同比环比面板重做、恩格尔与储蓄率双列、不计收支徽标
 *     v1.23.3 schema 23   徽标顺序统一、已结清标注复原、顶部渐变对齐首页
 *     v1.23.4 schema 23   人名卡/个人信息卡渐变、同比环比排版细化
 *     v1.23.5 schema 23   修复报销页多选入口、tab 样式统一、暗色卡片分层
 *     v1.23.6 schema 23   删除预算结转、预算执行口径修正、胶囊改样、首页子预算折叠
 *     v1.23.7 schema 23   报销单撤销、日趋势拖动查看、应收含待报销、借还页统一主题色
 *
 * ★ 写什么 ★
 *   只写「用户能感知到的变化」：新功能、行为改动、修掉的 bug。
 *   内部重构（改文件名、抽组件、补测试）不写进给用户看的日志。
 *
 * ★ 别把 git 提交原样搬进来 ★
 *   提交信息是写给开发看的（「fix(test): 迁移测试用 SCHEMA_VERSION」），
 *   日志是写给用户看的（「修复了…」）。
 */
export const RELEASES = [
  {
    version: '1.23.7',
    date: '2026-11-09',
    schemaVersion: 23,
    sections: [
      {
        title: '新增',
        items: [
          '报销单可撤销：删掉到账 / 盈余 / 坏账三笔，流水退回待报销',
          '日趋势按住拖动就能查看任意一天的日期与金额，松手隐藏'
        ]
      },
      {
        title: '优化',
        items: [
          '账户页「应收」加入待报销金额',
          '已结清按最新在上排列，多次结清合并成一个展开按钮',
          '借入页头像、结清按钮、待归还金额统一用主题色',
          '报销单应报金额并入账户行，撤销按钮移到实报下方',
          '流水副标题改为「账户 · 日期 · 时间」',
          'AI 记账回溯日期且未说时间时，默认 23:59'
        ]
      },
      {
        title: '修复',
        items: [
          '已结清展开后收不回去',
          '同比 / 环比的变化率同时显示箭头和正负号'
        ]
      }
    ]
  },
  {
    version: '1.23.6',
    date: '2026-11-09',
    schemaVersion: 23,
    sections: [
      {
        title: '调整',
        items: [
          '删除预算结转，每月可用额度就是月预算本身',
          '预算执行情况：总额度只算月预算，明细只列子预算',
          'AI 记账的两个标记胶囊改为淡描边 + 投影',
          '首页子预算可折叠，并记住展开状态'
        ]
      }
    ]
  },
  {
    version: '1.23.5',
    date: '2026-11-08',
    schemaVersion: 23,
    sections: [
      {
        title: '新增',
        items: [
          '报销台账：每笔支出可标待报销 / 已报销，报销时自动生成一张报销单',
          '报销管理页：待报销滑动单笔报销，也可多选合并成一张单',
          '统计页新增同比变化、环比变化、恩格尔系数、储蓄率、预算执行情况五个面板',
          '统计页右上角「组件管理」：面板的顺序与显隐都能自己调',
          '借入借出按人管理：按人分组看账，支持双向手动结清',
          '子预算可自己起名、一条管多个类别'
        ]
      },
      {
        title: '优化',
        items: [
          '全部交易的筛选面板改成下拉行，分类支持一行多选',
          '流水标签统一成描边胶囊，顺序固定：用户标签 → 人员 → 待报销/已报销 → 周期 → 组合账户 → 不计收支',
          '借入借出与报销页的每一笔流水也显示这些标签',
          '报销和预算的标记改成勾选框，周期账也能直接勾上',
          '同比 / 环比：上方两项变化居中，本期/上期两行左右对齐，涨跌一律用上下箭头',
          '同比 / 环比：双向柱状图按百分比幅度绘制，不再按金额（金额大不代表涨得凶）',
          '恩格尔系数改成自己选「哪些分类算食品」，可以选到二级分类',
          '主题色渐变统一到概览卡、人名栏、报销单卡头与个人信息卡；暗色下不显示大卡片渐变',
          '借入借出与报销页、分类页的 tab 切换外观统一'
        ]
      },
      {
        title: '修复',
        items: [
          '应收 / 负债把已结清的部分也算了进去，结清后金额不归零',
          'AI 记账分不清「某某还了 30 元」与「还了某某 30 元」，现在按「还」字前后是谁来判方向',
          'AI 记账时勾了「待报销」没有生效（勾选状态在关闭输入框时被提前清空）',
          '系统分类（借出 / 借入 / 对账等）下的支出不能再标记为待报销',
          '组件管理里调整的面板顺序在统计页没生效',
          '全部交易每日的收支汇总没有排除借款、待报销等不计入收支的流水',
          '报销待报销页右上角「多选」入口不显示',
          '暗色模式下借入借出的人名栏、报销单的应报实报栏看不清',
          '统计页「预算执行情况」把子预算也加进总额度，导致额度虚高、执行率偏低；现在总额度只算月预算，下方明细只列子预算',
          '删除预算结转功能（勾选框、结转计算、「本月含上月结转」提示均已移除）'
        ]
      }
    ]
  },
  {
    version: '1.17.0',
    date: '2026-11-05',
    schemaVersion: 17,
    sections: [
      {
        title: '新增',
        items: [
          '外币记账：16 种外币可选，自动取汇率折算成人民币',
          'AI 速记能认外币，如「打车花了 210 港币」'
        ]
      },
      {
        title: '优化',
        items: [
          '外币备注带代码（HKD 210.00），不用符号避免混淆',
          '周期账按发生日汇率折算',
          '首页当日满 5 笔记账时显示全部当日'
        ]
      },
      {
        title: '修复',
        items: [
          'AI 认出的外币没折算，被当成本币记账',
          '备注出现「花了」这类残词'
        ]
      }
    ]
  },
  {
    version: '1.16.5',
    date: '2026-11-04',
    schemaVersion: 16,
    sections: [
      {
        title: '修复',
        items: [
          '通知栏下载进度不显示',
          '更新弹窗底部按钮被裁切'
        ]
      },
      {
        title: '调整',
        items: [
          '更新弹窗改为居中弹出'
        ]
      }
    ]
  },
  {
    version: '1.16.4',
    date: '2026-11-04',
    schemaVersion: 16,
    sections: [
      {
        title: '优化',
        items: [
          '更新弹窗重做：发行说明按「段落 + 圆点列表」排版，与应用其他页面风格一致',
          '下载进度改到系统通知栏显示，下载时可以随时切出去做别的事'
        ]
      }
    ]
  },
  {
    version: '1.16.3',
    date: '2026-11-04',
    schemaVersion: 16,
    sections: [
      {
        title: '新增',
        items: [
          '检查更新：设置页与更新日志页都能手动检查，开屏也会自动查一次；发现新版本可直接下载安装'
        ]
      },
      {
        title: '修复',
        items: [
          '周期自动补记后首页不立刻显示，要切页面才看得到',
          '补记后统计页本月收支、账户页余额同样滞后'
        ]
      }
    ]
  },
  {
    version: '1.16.2',
    date: '2026-11-04',
    schemaVersion: 16,
    sections: [
      {
        title: '新增',
        items: [
          'AI 记账失败自动重试：限流、服务端错误、断网这类临时故障最多重试 2 次，不用再手动重发'
        ]
      },
      {
        title: '修复',
        items: [
          'AI 设置页「记账解析超时」现在真实生效（以前填了也不起作用）',
          'AI 设置页接口地址输入框显示压扁'
        ]
      },
      {
        title: '调整',
        items: [
          '测试连通性的加载效果重做',
          '移除早已无用的速记兜底开关配置'
        ]
      }
    ]
  },
  {
    version: '1.16.1',
    date: '2026-11-01',
    schemaVersion: 16,
    sections: [
      {
        title: '优化',
        items: [
          '修改余额入口移至账户详情页',
          '取消按钮加外框',
          'AI 记账优先归类到已有分类'
        ]
      },
      {
        title: '修复',
        items: [
          '首页分组合计只算显示条目'
        ]
      }
    ]
  },
  {
    version: '1.16.0',
    date: '2026-11-01',
    schemaVersion: 16,
    sections: [
      {
        title: '新增',
        items: [
          '借出管理 / 借入管理',
          '系统预置分类组（借出 / 借款归还 / 借入 / 借款收回）',
          '账户页拆分总资产与负债',
          '更新日志'
        ]
      },
      {
        title: '优化',
        items: [
          '资产趋势改为总资产口径',
          '修改余额用弹层，可选两种口径',
          '分类选中项加主题色描边',
          'AI 输入框长文本可左右滑动',
          '账户类型可编辑'
        ]
      },
      {
        title: '修复',
        items: [
          '「还给姐姐」误判为转账',
          '删除账户后回退到账户列表',
          '负债包含未归还借入',
          '借出收回 / 借入归还改名为借款收回 / 借款归还'
        ]
      }
    ]
  },
  {
    version: '1.13.0',
    date: '2026-10-31',
    schemaVersion: 13,
    sections: [
      {
        title: '新增',
        items: [
          'AI 对话支持图表'
        ]
      },
      {
        title: '优化',
        items: [
          'AI 设置页分区',
          'AI 回答长度上限提高'
        ]
      },
      {
        title: '修复',
        items: [
          'AI 对话请求超时',
          '历史记录图表不渲染',
          'AI 返回内容为空'
        ]
      }
    ]
  },
  {
    version: '1.12.0',
    date: '2026-10-31',
    schemaVersion: 12,
    sections: [
      {
        title: '新增',
        items: [
          'AI 对话深度思考',
          '思考状态界面'
        ]
      },
      {
        title: '修复',
        items: [
          'AI 对话历史记录不渲染、图例重叠'
        ]
      }
    ]
  },
  {
    version: '1.11.0',
    date: '2026-10-31',
    schemaVersion: 11,
    sections: [
      {
        title: '新增',
        items: [
          '组合账户'
        ]
      },
      {
        title: '优化',
        items: [
          '分类图标改浅色底',
          '更多分类按一级分组'
        ]
      }
    ]
  },
  {
    version: '1.10.0',
    date: '2026-10-30',
    schemaVersion: 10,
    sections: [
      {
        title: '新增',
        items: [
          '账户图标预设选择器',
          'tabBar 改悬浮胶囊'
        ]
      },
      {
        title: '修复',
        items: [
          'tabBar 冷启动显示默认图标',
          '账户图标被压扁'
        ]
      }
    ]
  },
  {
    version: '1.9.0',
    date: '2026-10-30',
    schemaVersion: 9,
    sections: [
      {
        title: '优化',
        items: [
          '周期自动补记更稳',
          '我的页记账功能宫格'
        ]
      },
      {
        title: '修复',
        items: [
          '周期管理多个问题'
        ]
      }
    ]
  },
  {
    version: '1.8.0',
    date: '2026-10-29',
    schemaVersion: 8,
    sections: [
      {
        title: '新增',
        items: [
          '周期自动补记'
        ]
      }
    ]
  },
  {
    version: '1.7.0',
    date: '2026-10-29',
    schemaVersion: 7,
    sections: [
      {
        title: '新增',
        items: [
          '周期管理'
        ]
      }
    ]
  },
  {
    version: '1.6.0',
    date: '2026-10-28',
    schemaVersion: 6,
    sections: [
      {
        title: '新增',
        items: [
          '线性图标库',
          '记账按钮设置'
        ]
      },
      {
        title: '修复',
        items: [
          '删账户 / 删分类不因有交易而失败'
        ]
      }
    ]
  },
  {
    version: '1.5.0',
    date: '2026-10-28',
    schemaVersion: 5,
    sections: [
      {
        title: '新增',
        items: [
          '分类管理页重做'
        ]
      }
    ]
  },
  {
    version: '1.4.0',
    date: '2026-10-28',
    schemaVersion: 4,
    sections: [
      {
        title: '新增',
        items: [
          '默认分类表重建',
          '组件库弹窗'
        ]
      }
    ]
  },
  {
    version: '1.3.0',
    date: '2026-10-28',
    schemaVersion: 3,
    sections: [
      {
        title: '新增',
        items: [
          '筛选面板二级分类联动',
          '统一详情页结构'
        ]
      }
    ]
  },
  {
    version: '1.2.0',
    date: '2026-10-27',
    schemaVersion: 2,
    sections: [
      {
        title: '新增',
        items: [
          '资产趋势图',
          '账户右滑设默认'
        ]
      },
      {
        title: '优化',
        items: [
          '统计页重构',
          '账户类型精简为五种',
          '编辑账户改当前余额'
        ]
      }
    ]
  },
  {
    version: '1.1.0',
    date: '2026-10-27',
    schemaVersion: 1,
    sections: [
      {
        title: '新增',
        items: [
          '账户 / 统计 / 我的页',
          '交易列表与详情',
          '设置子页与引导',
          'AI 记账与对话'
        ]
      },
      {
        title: '优化',
        items: [
          '首页改版',
          '数字键盘支持四则运算'
        ]
      }
    ]
  },
  {
    version: '1.0.0',
    date: '2026-10-27',
    schemaVersion: 1,
    sections: [
      {
        title: '新增',
        items: [
          '首个可用版本'
        ]
      }
    ]
  }
]

/**
 * 取最新一条更新日志（当前版本）
 */
export function latestRelease() {
  return RELEASES.length > 0 ? RELEASES[0] : null
}
