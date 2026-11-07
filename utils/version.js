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
export const APP_VERSION = '1.18.0'

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
 *   当前 SCHEMA_VERSION = 18（v17 外币记账、v18 子预算多类别），
 *   所以当前版本是 **1.18.0**。
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
    version: '1.18.0',
    date: '2026-11-07',
    schemaVersion: 18,
    sections: [
      {
        title: '新增',
        items: [
          '月预算可开启「未用完的预算结转到下一月」：没花完的额度累加到下月，超支不透支下月',
          '子预算可以自己起名字，一条子预算能同时管多个类别'
        ]
      },
      {
        title: '调整',
        items: [
          '「总预算」改叫「月预算」，「分类预算」改叫「子预算」',
          '子预算的额度合计不能超过月预算，超额会直接拦下并提示差多少',
          '还没设月预算时，不再显示添加子预算的入口'
        ]
      },
      {
        title: '修复',
        items: [
          '浅色模式下「年月日筛选 / 自定义筛选」看不出是能点的按钮',
          '分类页的「支出分类 / 收入分类」切换与筛选条样式不统一',
          '账户总览看不到借出去还没收回的钱'
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
