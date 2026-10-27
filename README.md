# 记账本

纯本地记账 App。uni-app + Vue3 + wot-design-uni + plus.sqlite，仅面向 Android / iOS App 端。

## 运行

1. 用 **HBuilderX** 打开本目录
2. `manifest.json` → 基础配置 → 填写 **AppID**（从 DCloud 开发者中心申请，云打包必需）
3. `运行 → 运行到手机或模拟器 → 运行到 Android/iOS App 基座`

> ⚠️ 本项目依赖 `plus.sqlite`，**只能在 App 端运行**。
> H5 / 小程序端会直接提示"SQLite 仅在 App 端可用"，这是预期行为。
> 语音记账不录音，用的是系统输入法的语音键，**无需麦克风权限、无需自定义基座**。

## 校验

```bash
npm install
npm run verify
```

- `npm run check` — SFC 结构 + JS 语法 + 模板编译 + 路由文件存在性
- `npm run test` — 速记解析引擎（17 例）+ 金额与日期逻辑（22 例）

## 目录

```
api/           业务层，页面不直接写 SQL
  db/          DAO 门面 / 建表 / 迁移 / 事务
  quick/       速记解析引擎（纯函数，可单测）
  account.js   账户 + 余额重算 + 每日快照
  transaction.js  交易（含转账两端余额）
  stats.js     全部统计查询
  backup.js    导出 / 导入 / 自动备份
  ai.js        大模型调用 + 结果缓存
components/    公共组件
pages/         页面（4 个 tab + 子页）
stores/        Pinia
utils/         money(分) / date(冗余键) / id / theme
scripts/       校验脚本
```

## 两条硬约束

**金额一律存整数分。** 字段名以 `_cents` 结尾，展示时才除 100。`0.1 + 0.2 !== 0.3`。

**信用卡还款记为 `transfer`，不是 `expense`。** 否则"消费 + 还款"会双算支出。这条在建表、记账面板、速记解析三处都有拦截。

## 数据

| 位置 | 内容 |
|---|---|
| `_doc/books.db` | 主数据库 |
| `_doc/export/` | 手动导出的 JSON |
| `_doc/backup/` | 自动备份（保留最近 5 份） |

卸载应用会删除全部数据。换机前请先「我的 → 数据管理 → 导出」。
