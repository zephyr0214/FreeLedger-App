# AGENTS.md

自由记 / FreeLedger：Android 本地记账 App。uni-app（Vue 3）+ Pinia + wot-design-uni，数据只存本机 `plus.sqlite`。不是 H5 / 小程序项目，目标平台是 Android App（HBuilderX 真机运行或云打包）。唯一的网络请求是用户自己配置的 AI 接口。

## 先读哪里

- `README.md`：功能、版本规则、外部 JSON 打开、云打包清单坑、目录说明。
- `agent.md`：本地协作规则（已被 `.gitignore` 忽略）：每次改完文件提交 git；不自行推送；不自行升版本号；覆盖升级必须可用；全局 UI / 深浅色统一；优先用 wot-design-uni 已有组件。
- `.team/research-share.md`：外部文件 intent / Native.js 调研（gitignored，改 `api/shareIntent.js` 前值得看）。

## 目录职责

```
api/          业务与数据层（SQLite、AI、统计、备份、分享导入）
api/db/       唯一直接使用 plus.sqlite 的地方（index.js 连接与迁移，schema.js 建表与常量）
components/   通用组件（面板、图表、弹窗、自绘 tabBar）
pages/        页面；pages/index|account|stats|mine 是 4 个 tab 页
stores/       Pinia（setting / account / transaction / ui / update）
utils/        纯函数（金额、日期、主题、图表、弹层栈…），可被 Node 直接测试
scripts/      校验 + 测试脚本（无测试框架）
App.vue       启动、主题注入、周期补记、通知安装、外部文件唤醒
AndroidManifest.xml  仅用于「用其他应用打开」的 intent-filter
```

依赖方向：`pages` → `stores` / `api` → `utils`；`api/db` 不 import 页面和组件；`api/category.js` 不反向依赖 `api/transaction.js`（避免循环引用）。除 `api/db/` 与 `scripts/` 外不要直接调 `plus.sqlite`。

## 常用命令

```bash
npm install        # 只装 devDependencies（校验/测试用）
npm run check      # BOM / 版本 / 语法 / 未定义变量 / 事件 / 模板绑定 / SQL / 资源 / 布局 / 主题 / 发布检查
npm run test       # 全部 80+ 个 node 测试脚本
npm run verify     # check + test
node scripts/check-syntax.mjs      # 单独跑某项检查
node scripts/test-money-rules.mjs  # 单独跑某个测试
npm run icons      # 重新生成 tabBar 图标（Python）
```

没有 ESLint / Prettier / 前端构建脚本。构建与真机运行走 HBuilderX 4.x（运行到 Android 真机；发行 → 原生 App 云打包）。

## 数据与账务不变量

- 金额一律整数「分」，字段名以 `_cents` 结尾；`amount_cents` 恒为正，方向由 `type` 决定。
- 转账同时影响两个账户，必须在同一个事务里重算两端余额；信用卡还款记 transfer，不记 expense。
- 时间存 `occurred_at`（UTC 毫秒）+ `occurred_day` / `month_key` / `year_key` 冗余键；日期计算在 JS 里做好再传 SQL，不用 SQLite 时区函数。
- 删除一律软删除 `deleted_at`。
- 覆盖导入前先自动备份；导入是覆盖而非合并。
- AI 只负责理解与出图表规格；所有数字由本地 SQL 取数，模型不得自造数字，分类只能落到已有分类。
- 六类结算差额（报销坏账/报销盈余、借出坏账/借出利息、借入未还/借入利息）**只计收支与统计，不计账户余额，并在所有流水列表/详情中隐藏**。判断与 SQL 片段的唯一来源是 `api/txnFilter.js`；余额重算用 `notSettlementAdjustmentSql()` 排除，列表查询传 `hideAdjustments: true`，统计查询保持默认包含。不要按分类 id 判断（id 会随导入变化）。
- 外币：`amount_cents` 永远存折算后的人民币分；原币信息只放备注。

## 数据库迁移与版本

- 结构版本唯一来源：`api/db/schema.js` 的 `SCHEMA_VERSION`（当前 25）。
- 加迁移：在 `api/db/index.js` 的 `MIGRATIONS` 数组末尾追加 `{ version, up }`，并把 `SCHEMA_VERSION` +1。
- 迁移函数内部只能用底层 `call()`，不要用 `query()` / `execute()`：后者会 `await openDb()`，与正在执行的 `openDb()` 互相等待造成死锁（回归测试见 `scripts/test-db-migration.mjs`）。
- 版本号唯一来源：`utils/version.js` 的 `APP_VERSION`；`manifest.json` 的 `versionName` / `versionCode` 必须同步；用户可见改动写进同文件 `RELEASES`（倒序、最新在前），README 与 App 内更新日志跟着改。
- 版本规则：有迁移 → 次版本号 = `SCHEMA_VERSION`（1.25.x）；无迁移 → 递增修订号。`scripts/test-version.mjs` 会核对三者一致。
- `versionCode` 公式是 `major*10000 + minor*100 + patch`（旧公式在 1.23.10 / 1.24.0 会撞车，别再改回去）。

## 分类图标（三样式，联网加载）

- `category.icon` 存 Unicode emoji 码点（如 `1F35C`）；用户在「主题外观」选样式：noto / twemoji / openmoji（系统样式与 Noto 在 Android 上无差别，已去掉）。图片按码点拼对应 CDN（Google Noto / jsDelivr 的 Twemoji、OpenMoji），不随包下载。旧语义 key（`food`/`car`…）由 `utils/emojiLegacy.js` 兼容，v24 迁移会改写老库。
- 显示统一用 `<CategoryGlyph :icon="x.icon" :name="x.name" size="…" />`；它自己读 `settingStore.emojiStyle`，图片加载中 / 失败会自动回退系统 emoji。流水行用 `<TxnIcon>`（尺寸五档 + 背景色开关）。
- 选择器是独立页面 `pages/settings/category-icon.vue`：左侧五个大类可展开二级分类，右侧联网图标网格 + 全局搜索 + 分批渲染；分类编辑弹层只显示当前图标，选完用 `uni.$emit('category-icon-picked')` 回传。
- `utils/emojiData.js` 是 `scripts/gen-emojiall.mjs` 抓取 Emojiall 分类页生成的（5 大类 / 49 个二级分类 / 836 个图标），不要手改；只抓元数据（分类名/二级分类），不下载图片。
- 图标图片来自 Noto / Twemoji / OpenMoji 的公开 CDN；新增网络请求必须在「关于 → 隐私说明」和 README 里披露。断网时回退系统 emoji。

## 代码约定

- 页面和组件统一是 Options API + `setup()`（没有 `<script setup>`）。模板里用到的函数/变量必须从 `setup()` 的 `return` 暴露，否则事件静默失效；`check-template-bindings.mjs` / `check-undefined.mjs` 专门守这条。
- 自定义组件事件不要用 `tap` / `click` / `finish` 等原生事件名；`emits` 要声明，`check-events.mjs` 会查。
- 组件库用 easycom：`wd-*` 自动映射到 wot-design-uni；`components/` 下的组件也可自动扫描，但页面普遍显式 import，跟随现有写法。
- 不引入 TypeScript：不新增 `.ts` / `.tsx` / `lang="ts"`。基础控件优先用 uni-app 内置组件（如原生 `slider` / `switch`）；新增 wot 组件可能触发 HBuilderX 的 `compile-typescript` 插件检查，导致运行中断。
- 源码 UTF-8 无 BOM、LF、文件末尾换行；`check-bom.mjs` 会拦截（Windows PowerShell 的 UTF8 输出容易带 BOM）。
- 注释密度高、中文解释「为什么」是项目风格，改动时保留并补充原因。

## UI / 主题硬规则

- 页面根节点统一：`<view class="app-page" :class="settingStore.wotClass" :style="pageStyle">`。
- 颜色只用 `--app-*` CSS 变量（由 `utils/theme.js` 的 `buildCssVars()` 注入）；同时适配浅色/深色。`wotClass` 是组件库深色样式所需的祖先类。
- 4 个 tab 页的 `onShow` 必须调用 `settingStore.refreshTabBar()`；tabBar 是自绘的 `components/AppTabBar.vue`，原生 tabBar 仅保留用于注册 `switchTab`，运行时隐藏。
- 读系统深浅色用 `osTheme`，不要用旧 `theme` 字段；`uni.onThemeChange` 在部分 Android 不触发，靠 `onShow` 兜底。
- 弹窗走 `utils/dialog.js` 的 `confirmDialog` / `alertDialog` / `promptDialog`，页面挂 `<AppDialog />` 作为宿主；不要直接写 `uni.showModal`（仅 `dialog.js` 内部无宿主时兜底）。
- 页面内自绘弹层（记账面板、速记条、选择器、确认框）必须 `pushLayer(close)` 登记，页面 `onBackPress(() => handleBackPress())`；这样右滑/返回键先收弹层而不是退出页面。
- 列表长按与滑动互斥用 `utils/rowPress.js` 判定，避免滑动误触长按。
- 布局用 flex：不要用 `getSystemInfoSync().windowHeight` 算高度；`scroll-view` 要有 flex 父约束；固定头部加 `flex-shrink: 0`（`check-layout.mjs`）。
- 优先复用 wot-design-uni 已有组件，保持全 App 风格统一。

## 测试与检查脚本

- 纯 Node ESM 脚本，无框架：每个文件自带 `check(name, actual, expected)` 计数，失败时最后 `process.exit(1)`。
- 可测逻辑必须留在 `api/` / `utils/` 纯函数层；测试直接 import 真实模块。DB 测试用 `node:sqlite` 的 `DatabaseSync` 建真库，或用 fake `plus.sqlite` 对象驱动 `api/db/index.js`。
- 有些测试是静态断言（读源码文本 / 常量 / pages.json），改文案或结构时可能连带失败，按要求改而不是删断言。
- 改完先跑相关单项脚本，收尾跑 `npm run verify`（或至少 `npm run check`）。
- 检查脚本覆盖的已知坑：BOM、路由与资源存在性、组件事件名、模板绑定、未定义变量、SQLite 方言（禁 `DAY()/MONTH()/YEAR()`、`GROUP_CONCAT ORDER BY`、`RETURNING`、窗口函数、JSON 函数等）、布局高度、主题变量与 tab 刷新。

## 平台 / 运行时坑

- `plus.*` 与部分 `uni.*` 只在 App 运行时存在；Node 脚本里会报未定义。平台代码用 `// #ifdef APP-PLUS` 或 try/catch 保护。
- Android 内置 SQLite 版本旧，SQL 写法先过 `check-sql.mjs`。
- 外部打开 / 分享导入：根目录 `AndroidManifest.xml` 只在云打包（或自定义调试基座）生效；安心打包（fastmode）会复用缓存母包而忽略清单改动——删 `unpackage/cache/apk/` 或改用传统打包；用 `node scripts/dump-manifest.mjs <apk>` 验证。content:// 授权是临时的，拿到 uri 要立即读取；Native.js 不能传 byte[]，用 `BufferedReader` 按行读。
- `unpackage/` 被 gitignore，但 `manifest.json` 引用其中的图标资源；图标缺失时先确认本地打包环境。
- 页面的 `onShow` 与 `App.vue` 的周期补记是两条异步流，读取数据时注意补记尚未写完的竞态（见首页 `loadAll` 的注释）。
