<div align="center">

# 自由记 · FreeLedger

**隐私优先的本地记账 App · Privacy-first local bookkeeping app**

[![platform](https://img.shields.io/badge/platform-Android-green)](#) [![framework](https://img.shields.io/badge/uni--app-Vue%203-42b883)](#) [![storage](https://img.shields.io/badge/storage-SQLite-blue)](#) [![version](https://img.shields.io/badge/version-1.23.8-orange)](#)

[中文](#中文) | [English](#english)

</div>

---

<a id="中文"></a>

## 这是什么

自由记是一个跑在 Android 手机上的个人记账应用。

所有数据只存在**本机 SQLite**，没有账号、没有云端、没有上传。AI 功能由你自己填 API Key 直连模型服务商——账本数据不经过任何第三方服务器，断网也能记账、查账。

## 功能特性

**记账**
- 手动记账面板 + 数字键盘（支持四则运算）
- AI 速记：一句话自动拆成收支 / 转账 / 借还，并归类到**已有分类**（绝不自造分类名）
- 转账，以及借出 / 借款归还 / 借入 / 借款收回（系统分类，账实分离）

**账户**
- 五种真实账户 + 组合账户（一组账户按顺序自动扣款，适合「碰一碰」「自动续费」）
- 余额修改双口径：记成对账收支（留痕可查）或直接改余额
- 资产概览：净资产 / 总资产 / 负债（负债含尚未归还的借入）

**账务管理**
- 二级分类（自定义图标）、标签、预算（月预算 + 子预算，子预算支持自定义名称与多类别）
- 周期账：按天 / 周 / 月自动补记，手动删掉的日期不会被重复补上；周期也能预设「不计入预算 / 待报销」
- 报销台账：支出标记「待报销」，收到钱后一键报销，差额自动记坏账或盈余；流水上直接显示「待报销 / 已报销」徽标
- 报销单：每次报销自动生成一张单，显示报销金额、实报金额、报销时间、报销笔数，坏账/盈余也归在同一张单下
- 借入借出按人员管理：未结清 / 已结清分组，借出可手动结清（差额自动记坏账或利息）；结清过又新借的，旧账自动折叠，已结清本金标删除线并标注「已结清 · 日期」
- 流水徽标：用户标签 / 人员 / 待报销·已报销 / 周期 / 组合账户 / 不计收支，六类固定顺序，首页、全部交易、详情页、借入借出页、报销页处处一致

**统计与 AI 问答**
- SVG 自绘图表：分类构成环形图、趋势折线、月历、账户统计
- 同比 / 环比变化：本月到今天对比上月同期（同比）或紧邻的上一段（环比），百分比与金额同时给，按分类看涨跌
- 储蓄率与预算执行：赚的钱存下多少、预算额度守没守住
- 组件管理：统计页的十个面板可自定顺序与显隐，恩格尔系数的食品分类由自己选
- 涨跌一律用上下箭头表示，双向柱状图按百分比幅度绘制（金额大的分类不代表涨得凶）
- 恩格尔系数：食品支出占总支出的比例，「哪些分类算食品」由你自己勾选
- AI 对话：问账、看趋势、出图表——**数字全部由本地 SQL 取数**，模型只输出图表规格，不给它编数字的机会
- 深度思考、图表均可开关

**数据与外观**
- 每日自动备份 + JSON 导出 / 导入
- 从微信 / 文件管理器「用其他应用打开」JSON，确认后导入
- 深浅色跟随系统 + 多主题色，概览卡 / 人名栏 / 报销单卡头 / 个人信息卡统一主题色渐变（暗色下自动不显示渐变）
- 数据库结构化迁移（当前 schema v23），升级不丢数据

## 技术栈与工程化

- uni-app（Vue 3 组合式 API）+ Pinia + wot-design-uni
- 本地存储 `plus.sqlite`，自研结构化迁移
- 图表为 SVG 自绘，无第三方图表库
- 工程约定：可测逻辑全部收在 `api/`、`utils/` 纯函数层，用 Node 原生 `node:sqlite` 内存库跑测试，不依赖测试框架

```bash
npm install       # 仅安装 devDependencies（校验与测试脚本用）
npm run check     # BOM / 语法 / 模板绑定 / 未定义变量 / 页面路由 / 发布检查
npm run test      # 全部测试（20+ 个测试文件，数百条断言）
```

## 快速开始

1. 克隆本仓库
2. 用 **HBuilderX 4.x** 导入项目
3. 运行 → 运行到手机（Android 真机或模拟器）
4. AI 功能：App 内「我的 → AI 大模型」填入 OpenAI 兼容接口的 Base URL / API Key / 模型名（DeepSeek、通义、Kimi、OpenRouter 等均可）
5. 正式包：发行 → 原生 App-云打包

## 版本规则

- 有数据库迁移 → 次版本号跟随数据库结构版本（schema v23 → v1.23.x）
- 无迁移 → 递增修订号（1.17.0 → 1.17.1）
- 每个版本的用户可见变化见 App 内「我的 → 更新日志」

## 从其他应用打开

微信 / 文件管理器里长按一个 JSON → 「用其他应用打开」→ 自由记，应用被拉起后弹一个确认框，点「确定导入」或「我再想想」。

这条链路靠项目根目录的 **`AndroidManifest.xml`** 声明 intent-filter（`manifest.json` 没有这个字段）：

- 只挂 `io.dcloud.PandoraEntry`，且**不设置** theme / launchMode / configChanges 等属性（官方禁止）
- 「用其他应用打开」= `ACTION_VIEW` + `content://`，覆盖 `application/json` / `application/octet-stream` / `text/plain` 及无 mimeType 的兜底（微信给 `.json` 的 mimeType 并不可靠）
- 「分享」= `ACTION_SEND` + `EXTRA_STREAM`
- 生效需**云打包**并重装；打完后可用 `node scripts/dump-manifest.mjs <apk>` 确认 filter 已合并进去
- 导入一律是**覆盖**：清空现有数据换成文件里的内容，导入前自动备份一次。不做「合并」是因为去重/冲突处理会让账目悄悄变多，用户很难核对多出来什么
- 数据管理页的「导出」下方有一格「导入」说明，写着「在 JSON 中选用其他应用打开，选择自由记即可」——那是说明不是按钮，导入发起方永远是外部应用

### ⚠️ 打完包发现「用其他应用打开」里仍然没有自由记

先跑 `node scripts/dump-manifest.mjs <新apk>`。如果输出里 `io.dcloud.PandoraEntry` 只有 MAIN/LAUNCHER 和那条没有 data 的 VIEW，说明清单压根没被合并。

最常见的原因是**安心打包（fastmode）复用了本地缓存的母包**：它不重新生成 AndroidManifest.xml，只在缓存母包上替换 H5 资源和版本号，清单改动被整段忽略。

判据：新包的 `AndroidManifest.xml` 与 `unpackage/cache/apk/<appid>_cm.apk` 里的**逐字节相同**（只有 versionName/versionCode 那几个字节不同）。

解法二选一：

1. 删掉 `unpackage/cache/apk/` 再打包 —— 缓存没了必然走完整打包，清单会被重新生成；
2. 打包时改用**传统打包**（不勾「安心打包」）。

改完清单后第一次打包建议直接按第 1 条做。

## 目录结构

```
api/        数据与业务层（SQLite、AI 解析、统计、备份、外部打开）
components/ 通用组件（记账面板、图表、弹窗…）
pages/      页面（首页 / 账户 / 统计 / 我的 + 设置与详情页）
stores/     Pinia 状态
utils/      纯函数工具（金额 / 日期 / 图标 / 校验）
scripts/    校验与测试脚本
AndroidManifest.xml  自定义清单（仅用于外部打开，见上一节）
```

## 数据与隐私

- 账本、设置、备份全部在本机：`_doc/books.db`
- 唯一的网络请求是 AI 功能，直接从你的设备发往你自己填的模型服务商
- 卸载 App 即数据随本机沙箱销毁；换机请先用「数据与备份」导出

---

<a id="english"></a>

## What is this

FreeLedger (自由记) is a personal bookkeeping app for Android.

All data lives in **on-device SQLite** — no account, no cloud, no upload. The AI features talk directly to the model provider of your choice with your own API key; your ledger never touches any third-party server. It works fully offline for recording and browsing.

## Features

**Recording**
- Manual entry panel with a numeric keyboard (supports arithmetic)
- AI quick capture: one sentence parsed into expenses / transfers / loans, always classified into **existing categories** (never invents one)
- Transfers, plus lend out / repay / borrow / get paid back (system categories)

**Accounts**
- Five real account types + combo accounts (ordered auto-deduction, great for tap-to-pay and subscriptions)
- Balance editing with two modes: log a reconciliation entry (auditable) or set the balance directly
- Asset overview: net worth / total assets / debt (including outstanding borrows)

**Management**
- Two-level categories (custom icons), tags, budgets (total + per-category, with rollover)
- Six badge types in a fixed order (tags, person, reimbursement status, cycle, combo account, excluded-from-stats), identical on every screen
- Recurring transactions auto-posted by day / week / month; days you deliberately deleted are never re-posted — a cycle can preset "exclude from budget / to be reimbursed"
- Reimbursement ledger: mark an expense as pending, settle it in one tap, and the difference is auto-booked as bad debt or surplus; "pending / reimbursed" badges show up right in the transaction list
- Loan badges, strike-through on settled principal, "settled on <date>" markers
- Reimbursement slips: every settlement creates one slip with the original total, the actual amount received, the date and how many entries it covers (bad debt / surplus are listed under it, not counted as entries)

**Insights & AI chat**
- Hand-drawn SVG charts: category donut, trend lines, calendar heatmap, account stats
- Period-over-period and sequential comparison: this month to date vs. the same stretch of last month (or vs. the immediately preceding window), with both percentage and amount per category
- Savings rate and budget execution: how much of your income you kept, and whether budgets held
- Panel manager: reorder or hide the ten stat panels; pick which categories count as food for the Engel coefficient
- Rises and falls are shown with arrows only; the two-way bars are drawn by percentage, not by amount
- AI chat about your finances — **all numbers come from local SQL queries**; the model only outputs chart specs, so it can never make numbers up
- Deep thinking and charts are both toggleable

**Data & appearance**
- Daily auto-backup + JSON export / import
- System dark mode + multiple theme colors; overview card, person header, reimbursement slip header and profile card share one theme gradient (automatically hidden in dark mode)
- Structured database migrations (schema v23) — upgrades never lose data

## Tech & engineering

- uni-app (Vue 3 composition API) + Pinia + wot-design-uni
- Local storage via `plus.sqlite` with hand-rolled structured migrations
- Charts are hand-drawn SVG, no chart library
- All testable logic lives in pure layers (`api/`, `utils/`), tested with Node's native `node:sqlite` in-memory DB — no test framework needed

```bash
npm install       # devDependencies only (for check & test scripts)
npm run check     # BOM / syntax / template bindings / undefined vars / routes / release checks
npm run test      # full test suite (20+ files, hundreds of assertions)
```

## Getting started

1. Clone this repository
2. Import into **HBuilderX 4.x**
3. Run → Run to device (Android handset or emulator)
4. AI features: in-app *Mine → AI Model*, fill in an OpenAI-compatible Base URL / API Key / model (DeepSeek, Qwen, Kimi, OpenRouter, etc.)
5. Release build: Publish → Native App cloud packaging

## Versioning

- With a DB migration → minor version follows the schema version (schema v23 → v1.23.x)
- Without one → patch bump (1.16.2 → 1.16.3)
- User-facing changes per version: in-app *Mine → Changelog*

## Layout

```
api/        data & business layer (SQLite, AI parsing, stats, backup)
components/ shared components (entry panel, charts, dialogs…)
pages/      pages (home / accounts / stats / mine + settings & details)
stores/     Pinia stores
utils/      pure utilities (money / date / icons / validators)
scripts/    check & test scripts
```

## Data & privacy

- Ledger, settings and backups stay on-device: `_doc/books.db`
- The only network traffic is AI features, sent from your device straight to the provider you configured
- Uninstalling destroys data with the sandbox; migrate devices via export/import first
