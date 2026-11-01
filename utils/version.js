/**
 * 版本号与更新日志 —— 全 App 唯一的版本信息来源
 *
 * ★ 为什么要有这个文件 ★
 *   以前版本号散在三处手写：
 *     manifest.json 的 versionName
 *     pages/settings/about.vue 的 <text class="app-version">v1.13.0</text>
 *     pages/mine/index.vue 的「自由记 v1.13.0」
 *   改一处忘一处，就会出现「关于页显示 v1.13、我的页显示 v1.15」。
 *   现在三个地方都从 APP_VERSION 取，只改这一处。
 *
 * ★ 版本号规则（用户指定）★
 *   · 有数据库迁移（SCHEMA_VERSION 变化）→ 升次版本号：1.13 -> 1.15
 *   · 没有迁移 → 在次版本号后面递增修订号：1.15 -> 1.15.1 -> 1.15.2
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
 *   · 有数据库迁移（SCHEMA_VERSION 变化）→ 升次版本号：1.13.0 -> 1.15.0
 *   · 没有迁移 → 递增修订号：1.15.0 -> 1.15.1 -> 1.15.2
 *   即使修订号是 0，也要写全三段（1.15.0 而不是 1.15），
 *   这样「我的」页、关于页、manifest 三处显示的永远同一个形状。
 *
 * ★ 改版本号只改这里 ★
 *   about.vue / mine/index.vue 都读它；
 *   scripts/test-version.mjs 会核对 manifest.json 是否同步。
 */
export const APP_VERSION = '1.15.0'

/**
 * 三段式版本号（兜底补零）
 *
 * 现在 APP_VERSION 本身就是三段，这个函数主要给
 * 「万一有人写成 1.15」的情况兜底，保证 manifest 那边不出错。
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
 *   1.15   -> 1150
 *   1.15.1 -> 1151
 *   1.15.2 -> 1152
 */
export function toVersionCode(version = APP_VERSION) {
  const [major = '1', minor = '15', patch = '0'] = toSemver(version).split('.')
  return Number(major) * 1000 + Number(minor) * 10 + Number(patch)
}

/**
 * 「自由记 v1.15」这种带前缀的展示文案
 */
export const APP_VERSION_LABEL = `v${APP_VERSION}`

/**
 * 更新日志 —— 倒序（最新版本在最前面）
 *
 * ★ 写什么 ★
 *   只写「用户能感知到的变化」：新功能、行为改动、修掉的 bug。
 *   内部重构（改文件名、抽组件、补测试）不写进给用户看的日志。
 *
 * ★ 别把 git 提交原样搬进来 ★
 *   提交信息是写给开发看的（「test: 迁移测试用 SCHEMA_VERSION」），
 *   日志是写给用户看的（「修复了…」）。
 */
export const RELEASES = [
  {
    version: '1.15.0',
    date: '2026-11-01',
    // 这一版带数据库迁移：v14 系统预置分类、v15 借款收回/借款归还、v16 分类改名
    schemaVersion: 16,
    sections: [
      {
        title: '新增',
        items: [
          '借出管理 / 借入管理：在「我的 → 记账功能」进入，看当前还有多少钱在外面、还欠别人多少。',
          '「系统预置分类」固定分类组：支出下挂「借出 / 借款归还 / 对账支出」，收入下挂「借入 / 借款收回 / 对账收入」，整组不可改名删除。',
          '账户页概览拆分出「总资产」与「负债」，大数字是净资产。',
          '更新日志：就是你现在看的这个页面。'
        ]
      },
      {
        title: '优化',
        items: [
          '账户页资产趋势改为「总资产趋势图」，只统计账户里的正余额，不再把信用卡欠款算进去。',
          '改余额改为弹层：可当场选择「计入对账收支」或「修改当前余额」。',
          '记账弹层、周期弹层的分类选中项加一圈主题色描边，选中的是哪个一眼可辨。',
          'AI 速记输入框里文本过长时，现在可以左右滑动查看被遮住的部分。',
          '账户类型现在可以编辑（组合账户除外），建错类型不用删了重建。'
        ]
      },
      {
        title: '修复',
        items: [
          '「还给姐姐200元」不再被误判成转账：借还的对象是人不是账户，会说成「借款归还」。',
          '删除账户后回到账户列表，不再停在那个已经被删掉的账户详情页。',
          '负债现在包含尚未归还的借入，净资产不再虚高。',
          '「借出收回 / 借入归还」统一改名为「借款收回 / 借款归还」（分类名、页面标签一并更新）。'
        ]
      },
      {
        title: '数据迁移',
        items: [
          '新增「系统预置分类」并迁入已有对账分类，历史流水的分类引用保持不变。',
          '补上「借款收回 / 借款归还」两个固定分类，并把旧名字的分类改名（保留原 id）。',
          '升级前建议先在「数据与备份」里导出一份备份。'
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
          'AI 对话：可以追问账务问题，支持深度思考与图表。',
          '组合账户：一组账户按顺序扣款，用于「碰一碰」「自动续费」这类场景。'
        ]
      },
      {
        title: '优化',
        items: [
          'AI 设置页分区结构对齐其他设置页，请求超时放宽到 30 秒。',
          'AI 回答长度上限从 2000 提到 8000，避免推理模型的正文被截断成空。'
        ]
      },
      {
        title: '修复',
        items: [
          '修复 AI 对话「总是请求超时」。',
          '修复历史记录里的图表退出再进入不渲染。',
          '修复 AI 返回内容为空（模型输出被 max_tokens 截断）。',
          '修复暗色模式下统计页前三名高亮块透白。'
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
