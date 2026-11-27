# 麦田（mdldm-maitian）× 口播工作台：深度评估 · 对标分析 · 集成说明

> 评估日期：2026-11-27
> 评估对象：`CzzzzzzJ/mdldm-maitian`（MIT，Node ≥22.5，71.8K★）本地克隆 + 本机「口播工作台」工程
> 结论先行：**采用「左侧导航栏新增独立入口」路径**（原推荐「复用口播工作台入口」已按唯一导航契约重新评估后推翻），
> 大屏与口播工作台**同源同库、双向互通**，口播工作台现有入口与导航结构零改动。

---

## 一、麦田核心价值评估（带证据）

### 1.1 采集方案：浏览器登录态 + CDP 注入，不做 HTTP 直连

| 文件 | 职责 | 证据 |
|---|---|---|
| `src/metrics.mjs` | 9 平台发布工程流量采集，统一 `views/likes/comments/favorites/shares` | `metrics.mjs:6-12,30-101` |
| `src/account-collect.mjs` | 账号作品采集编排（B站/抖音/小红书） | `account-collect.mjs:11-36` |
| `src/account-traffic.mjs` | 账号流量数据层：事务化整批替换、失败只写 error | `account-traffic.mjs:3-12,27-41,75,79` |
| `src/account-bilibili.mjs` | B站后台 `/x/web/archives` 分页拉稿并校验 | `account-bilibili.mjs:3,5-48` |
| `src/account-douyin.mjs` | 抖音内容管理页读 React fiber 翻页 | `account-douyin.mjs:3,13-20,55-64` |
| `src/account-xhs.mjs` | 小红书 `.note-card__stat` 只读渲染内容 | `account-xhs.mjs:3,26-65` |
| `src/followers.mjs` | 9 平台粉丝采集 + 历史 backfill | `followers.mjs:8,16-72,74-97` |
| `src/driver.mjs` / `src/chrome-shim.mjs` | 驱动门面（direct/plugin 双模）、原生 CDP | `driver.mjs:8-35`；`chrome-shim.mjs:60-101` |

所有采集都是**在浏览器页面上下文里 `fetch(...,{credentials:'include'})`**（`metrics.mjs:33`、`followers.mjs:11,18,22,26`、`account-bilibili.mjs:12`），
小红书/视频号/抖音等更进一步只读 DOM（`metrics.mjs:38,40,44,52`、`followers.mjs:13,30-32`）。
因此**无法用 Node 侧 HTTP 直连复刻**，登录态是硬前提（`README.md:32,124`：登录态在专用 Chrome profile）。

### 1.2 数据层：node:sqlite 内置驱动 + 幂等 upsert

* 驱动 `node:sqlite` 的 `DatabaseSync`（`db.mjs:2,10`），`package.json:1-10` **零第三方依赖**，Node ≥22.5（`package.json:7`）。
* 13 张表（`db.mjs:14-26`）：`episodes/tasks/metrics/board_records/site_daily/site_orders/snapshots/site_campaigns/samples/site_channels/meta/logs`，
  另加 `followers`（`followers.mjs:8`）与 5 张 `account_*`（`account-traffic.mjs:4-12`）。
* 幂等写法：`INSERT ... ON CONFLICT DO UPDATE`（`db.mjs:43-46,52-56,64,68-70`）与 `INSERT OR REPLACE`（`db.mjs:67,76`、`board.mjs:36`）。
* 业务级防重：`LOCKED=['filled','awaiting_user','scheduled','published']`、`STATE_CN`（`db.mjs:40-41`）。

### 1.3 数据大屏：信息架构、零三方库图表、单一聚合接口

* 区块顺序（`board.html:395-419` 的 `render()`）：顶栏（logo/tag/状态灯/时钟）→ `.r1` 三栏（**最新一期 hero** / **粉丝合计+占比条+30 天堆叠走势图** / **数据分析 insights**）→ **各平台卡片**（粉丝、今日/7天、sparkline、本期 vs 上期）→ **站点/销售条**。
* 图表**纯手写 SVG**：`mt.js:42-58` `drawCols`、`:60-74` `drawLines`；`board.html:174-182` 粉丝堆叠、`:204-205` sparkline、`:314-317` 销售图。全仓无 echarts/chart.js/d3/CDN。
* 主题令牌：`mt.css:2-5`（`--bg/--card/--t1..--t3/--accent/--good/--warn/--crit` + 9 个 `--p-*` 平台色）。
* **单一聚合接口** `/api/overview`（`web.mjs:212-228`），大屏 `fetch('/api/overview')` + `setInterval(load,60000)`（`board.html:439,459`）。
* `mt.js` 只服务下钻页 `/p`（`pages.html:19`），大屏自带内联脚本（`board.html:19`）——两者共用 `mt.css` 与 `/api/*`。

### 1.4 发布中控：人审闸门是核心

* `config.example.json:18` `"manual":["bilibili","douyin","xhs","channels"]`；
* `hub.mjs:105` 填好后 `if (config.manual.includes(id)) { setTask(...,'awaiting_user',...); return; }` —— **直接 return，绝不自动提交**；
* `hub.mjs:131` 明确「国内平台由你自己点发布」，`SUBMIT_PAGES` 只含 X/YouTube/Instagram/Threads（`:121-126`）；
* `hub.mjs:451-456` 每 20 分钟提醒「还在等你点发布」；`checks.mjs` 全程「失败即停、不重试、不重复点」。

### 1.5 最值得借鉴的 6 点（已落到口播工作台）

| # | 麦田做法 | 证据 | 口播工作台的落地 |
|---|---|---|---|
| 1 | 单一聚合接口 `/api/overview` | `web.mjs:212` | 新增 `GET /api/koubo/board`（`koubo_board.py`），大屏一次 fetch + 60s 轮询 |
| 2 | 零三方库纯 SVG 图表 | `mt.js:42-74` | `board_spa/index.html` 的 `stackChart/spark/bars` 全部手写 SVG |
| 3 | 平台色令牌化 | `mt.css:4` | 大屏 `PC{}` 颜色表映射雷达 11 源，深浅色随父窗口主题 |
| 4 | 失败保留上次成功 + 事务整批替换 | `account-traffic.mjs:27-41,75,79` | 雷达快照与 `crawls` 落库遵循「校验通过才写」，失败不动历史值 |
| 5 | 人审闸门状态机 | `hub.mjs:105,451-456` | 口播工作台 `rewrites.confirmed/decision` + 闸门 `gate` 已有；大屏把「待确认」显式列为漏斗一环 |
| 6 | Demo 完全隔离（不碰真实库） | `demo.mjs:9-16,25` | 大屏「① 复刻版」用确定性种子在页面内生成演示数据，绝不读写 `koubo.sqlite` |

### 1.6 明确不可直接移植的 5 点

1. **专用 Chrome 登录态 + CDP 9333**（`chrome-shim.mjs:60-72`）：口播工作台是标准库 `urllib` 匿名直连，无浏览器 profile。
2. **闭源 Chrome 扩展「麦田发布助手」**（`plugin.mjs:8,16-20`、`driver.mjs:16-17`）：平台发布适配器在扩展里，仓库无源码。
3. **Node ≥22.5 `node:sqlite`**：口播工作台是 Python `sqlite3`（`koubo_db.py`），驱动与 API 全不同。
4. **飞书生态 + 外部 `lark-cli`**（`board.mjs:15-23`）：引入即新增外部 CLI 与账号授权。
5. **领域模型不同**：麦田 = 发布**后**监控（`episodes/tasks/metrics`）；口播工作台 = 发布**前**生产（`avatars/voices/topics/rewrites/crawls/personas/templates/hotwords`）。**只能借鉴机制，不能照搬表结构。**

---

## 二、逐项对标分析

| 维度 | 麦田 | 口播工作台现状 | 裁决 |
|---|---|---|---|
| 发现内容 | 只读自己账号后台 | **11 源匿名/访客态热榜 + B站 WBI 内容检索** | 口播更强，互补：发现用口播、发布后效果用麦田 |
| 去重 | 主键 upsert | **SimHash 64bit + 汉明≤3 近重复** | 保留口播方案 |
| 变更语义 | `active` 全量重写 | **四态 diff new/same/changed/removed** | 保留口播方案 |
| 内容质量 | 无评分卡 | **质量评分卡 + 敏感词过滤 + PII 正则脱敏** | 保留口播方案 |
| 聚合接口 | `/api/overview` | 新增 `/api/koubo/board`（对标同构） | 本轮新增 |
| 图表 | 纯 SVG | 本轮大屏纯 SVG 复刻 | 已对齐 |
| 大屏 | 独立整页 `/board` | 本轮独立入口 `/board/index.html`（同源） | 已对齐 |
| 演示隔离 | `demo/` + `MAITIAN_DB` 环境变量 | 大屏「复刻版」页面内种子数据 | 已对齐 |
| 人审闸门 | `awaiting_user` + 20min 提醒 | `confirmed/decision` + `gate`（无定时提醒） | 差异项，建议后续补 |
| 粉丝/播放真值 | 登录态可采真值 | **无自有账号数据 → 热度代理并标 proxy** | 诚实边界，禁止冒充 |

---

## 三、入口路径评估与决策（A / B 两案）

### 3.1 契约澄清（本次评估纠正了上一轮的一个误读）

`智漫6.html:128` 的注释是「口播工作台：**保留智漫6左栏作唯一导航**，隐藏其 topbar/stepper/statusbar；iframe 只填内容区」。
它的约束对象是**页面内不得再造第二套导航**，**不是**「左栏导航项数量固定」。因此在左栏新增一项并不违反该契约。

### 3.2 两案对比

| 判据 | A：左栏新增独立入口（**采纳**） | B：复用口播工作台入口（SPA 内加工作区） |
|---|---|---|
| 结构一致性 | 左栏仍是唯一导航，新增项复用 `.rnav` 既有样式（`智漫6.html:914-920`），不新增导航体系 | 也一致，但把「发布后监控」降级为 SPA 内的并列支持区 |
| 语义定位 | 麦田大屏是「发布后监控」一级视图，与「工作台/问题中心」并列更贴切 | 语义偏弱（监控变成生产流水线里的一页） |
| 数据互通 | 共用 `/api/koubo/board` + `koubo.sqlite`，**同一份数据零拷贝**，两边互为读写 | 同样同源，但大屏被关在 SPA 内 |
| 风格统一 | 独立 iframe + 同一套 `applyTheme`/postMessage 握手（`智漫6.html:2062-2064`、`koubo_spa/index.html:282-286`） | 同上 |
| 维护成本 | `智漫6.html` 改动 4 处（nav 数组、render 分支、goBoard、消息协议）+ 1 个新页面 + 1 个新聚合端点 | 只改 1 个数组 + 1 个渲染函数 |
| 破不破坏口播工作台 | **不破坏**：`koubo` 分支与 `/koubo/index.html` SPA 零改动；退出走 `goWork()` 还原 | 不破坏 |

**决策：采纳 A。** 理由：① 契约澄清后 A 同样合规；② 「监控」与「生产」并列更符合产品语义；③ 独立入口便于做成常开电视墙（麦田 `/widget` 场景）；④ 数据仍然同源同库，不产生第二份状态。

### 3.3 「不破坏口播工作台」的四条保证（已落实）

1. `koubo` 分支与 `koubo_spa/index.html` **零改动**（仅追加一条 `KOUBO_GOTO` 消息协议，用于大屏点击穿透）。
2. 大屏 iframe 内**不放第二套导航**，导航统一由智漫6 左栏负责。
3. 数据同源：两边读同一个 `koubo.sqlite`、同一组 `/api/koubo/*` 端点；大屏「刷新全网采集」写入 `crawls` 后，口播工作台爆款雷达立即可见（双向真互通）。
4. 主题与退出沿用既有协议：`KOUBO_CONFIG` / `KOUBO_EXIT` / `goWork()` 还原漫剧现场。

---

## 四、数据契约（`GET /api/koubo/board`）

一次聚合返回，口播工作台原生字段 + 麦田 `/api/overview` 兼容字段：

```jsonc
{
  "ok": true, "version": "kb-board-v1", "generated_at": 1750000000,
  "identity": { "name": "智漫6 · 口播数据大屏", "mode": "production" },
  "health":  { "db_ready": true, "tables": {...}, "radar_version": "radar-crawler-v4",
               "live_sources": 11, "need_setup_count": 7, "digital": {...}, "qa_avg": 50 },
  "counts":  { "avatars": 5, "voices": 7, "topics": 12, "rewrites": 9, "crawls": 340, ... },
  "funnel":  [ { "stage": "① 全网抓取", "count": 340, "view": "radar" }, ... ],
  "radar":   { "version": "radar-crawler-v4", "adapters": {...}, "live_sources": [...],
               "snapshot": { "count": 365, "platform_dist": {...} }, "items": [...], "need_setup": [...] },
  "topics": [...], "rewrites": [...], "crawls": [...], "jobs": [...], "publish": [...],
  "trends":  { "days": [...], "crawls": [...], "rewrites": [...],
               "by_platform": { "抖音热榜": [...] }, "heat": [...] },
  "modules": { "koubo_db": {...}, "koubo_radar": {...}, ... },
  "digital": { "summary": { "ready": 4, "partial": 3, "need_setup": 3 }, "top10": [...] },
  "need_setup": [ { "platform": "小红书", "capability": "...", "requires": [...] } ],
  "proxy_notice": "播放/粉丝类指标…标 proxy=1，不冒充真实播放量"
}
```

### 麦田侧消费方式

```bash
# 打印映射后的 overview（麦田大屏/下游可直接吃）
node src/koubo-bridge.mjs --base http://127.0.0.1:8790

# 落盘 / 起只读服务
node src/koubo-bridge.mjs --out data/koubo-overview.json
node src/koubo-bridge.mjs --serve --port 8789   # 暴露 http://127.0.0.1:8789/api/overview

# 契约自检（离线样例，不依赖口播工作台）
node src/koubo-bridge.mjs --selftest
```

`src/koubo-bridge.mjs` 把口播工作台的 `topics/rewrites/crawls/trends` 映射为麦田的
`episodes/tasks/metrics/followers/site_daily/site_channels/feed/health`，
并对所有播放/粉丝类字段标注 `extra.proxy=1` 与 `source='koubo-radar-proxy'`。

---

## 五、验收

| 项 | 判据 | 结果 |
|---|---|---|
| 大屏可达 | `GET /board/index.html` HTTP 200 | ✅ |
| 聚合端点 | `GET /api/koubo/board` 返回 `ok:true` 且含 funnel/trends/modules | ✅ |
| 11 源真实 | `radar.live_sources = 11` | ✅ |
| 双向互通 | 大屏点「刷新全网采集」→ `crawls` 增长 → 口播工作台雷达立即可见 | ✅ |
| 导航一致性 | 智漫6 左栏新增「📊 数据大屏」，其余 4 项与样式不变 | ✅ |
| 口播工作台不回归 | L1 47/47、L2 30/30、7 场景全 done | ✅ |
| 图表零依赖 | 大屏无任何 CDN/三方图表库，纯 SVG | ✅ |
| 诚实边界 | 播放/粉丝标 proxy；need_setup 7 项显式列出 | ✅ |

---

## 六、许可证与合规

* 麦田为 MIT（`LICENSE`），本仓库改动（`src/koubo-bridge.mjs`、`docs/koubo-integration.md`、`package.json`）
  可自由使用；本次仅**借鉴架构与公开接口事实**，未复制其闭源扩展代码，也未引入其飞书/lark-cli 依赖。
* 口播工作台侧维持原边界：不绕登录、不抓个人信息、敏感词过滤、PII 正则脱敏、每域控频。
* 两者数据均为「公开热榜/公开搜索接口」或「用户自有账号后台」；口播工作台当前只用前者。

---

## 七、麦田大屏「完整复刻」逐项评估：哪些与口播播块共享、哪些不打通

> 目标：保留麦田数据大屏的**内容主结构**（顶栏 / 三栏 / 平台卡 / 销售区），只把**与口播播块同构的域**在底层打通；
> 与播块无关的域（粉丝、发布后播放互动、收藏率、知识站与销售）**保持麦田自有数据域，独立保留，不混算、不冒充**；
> 唯一导航仍由智漫6 左栏负责（大屏内不再造第二套导航）。

### 7.1 逐项判定表

| 麦田大屏区块 / 字段 | 麦田数据来源 | 口播播块对应物 | 判定 | 本轮落地 |
|---|---|---|---|---|
| 顶栏状态灯 ×4 | 守护进程 / NAS / 专用浏览器 / 平台登录 | 服务进程 / 数据源可读 / 采集通道 / 需登录项 | **语义映射打通**（位置保留、语义按口播诚实改写） | 融合版显示「服务 运行中 · 数据源 koubo.sqlite 可读 · 匿名直连（不依赖浏览器）· 需登录 7 项」 |
| 顶栏麦田页签（大屏/流量/日历/转化/档案/系统） | 麦田站内导航 | — | **不打通**（违反唯一导航契约） | 移除；仅保留三档数据模式切换（复刻/融合/优化） |
| hero「期」episode | 一次发布工程 | **一次成片任务**（cut/gen 的 mp4 产物） | **打通（语义同构）** | `distribution.episodes` ← jobs(scene=cut/gen, artifact=.mp4) |
| hero 3D 封面 | 该期封面图 | 无封面资产 | 部分（诚实占位） | 用真实标题+期号生成 SVG 封面，不留假图 |
| hero 轮播页签 + 每期状态灯 | 每期各平台发布状态 | 每期各平台分发状态 | **打通** | `ctabs` ← episodes[].tasks[].state（ok/warn/wait 同色系） |
| hero 倒计时（还有 X 天 / 已发 X 小时） | 发布时间 | 成片完成时间 | **打通** | 任务表 ts 归一为 epoch（`koubo_board._ts_epoch`） |
| hero 状态文案（N 个平台等你点发布） | tasks.state | dry-run 回执 / 真发回执 / 无回执 | **打通** | dry-run→`awaiting_user`「待你点发布」；真发→`filled`「已提交待确认」；无→`planned`「未分发」 |
| hero 平台格子（logo/状态/回链） | 各平台 task + 已发布链接 | 各平台分发回执 | **打通** | tasks[platform].state_cn / url / dry_run |
| hero 三数（播放 / 互动 / 互动率） | 平台后台数据 | 口播**没有**播放与互动 | **不打通**，口径替换 | 融合版改为「本期分发 / 待你点发布 / 待发布占比」，全部真实 |
| hero 平台占比条 | 当日各平台播放 | 当日各平台分发条数 | **打通（口径替换）** | metrics 由真实分发台账聚合 |
| hero 近 3 天堆叠柱（发布前/缺数据） | 每日累计播放 | 每日分发条数 | **打通（口径替换）** | `barsHTML` 同实现 |
| hero 发布后累计曲线（本期实线 + 上期虚线） | samples 采样 | 逐日累计分发采样 | **打通（口径替换）** | 真实模式补 samples（逐日累计） |
| hero 同龄对比（上期同时段） | 同龄口径 | 口播无「同龄」概念 | **不打通** | 无 prev 时不渲染，不造假基准 |
| 粉丝面板：合计 / 今日·7天·30天涨幅 / 占比条 / 30 天堆叠面积图 / 发布日标记 / 净增点 | 各平台后台粉丝 | 口播**无**粉丝数据 | **不打通** | 保留麦田演示域，粉丝面板原样渲染（明确标注演示） |
| 数据分析 6 条规则（涨粉/发布日/集中度/互动/收藏/转化） | 粉丝与后台指标 | 仅「分发/质检」有对应 | **部分打通** | 粉丝类 5 条走麦田演示域；新增真实「分发」「质检」两条并标注口径 |
| 平台卡（粉丝/今日/7 天/sparkline/本期 vs 上期） | 粉丝 + 播放 | 口播无 | **不打通** | 麦田 10 张卡原样 |
| 知识站 strip（近 7 天注册/会员/订单/收入/最近动态） | 自有站点 | 无 | **不打通** | 原样 |
| 销售看板（当天/近 7 天/近 30 天 + 30 天柱图 + 订单动态） | 小鹅通 | 无 | **不打通** | 原样 |
| （麦田没有） | — | 口播生产漏斗 / 雷达快照 / 模块矩阵 / need_setup | **新增真实区块** | 优化版追加区，不挤占麦田结构 |
| （麦田没有） | — | 播块分发链表（期·成片·平台·状态·质检·闸门） | **新增真实区块** | 融合版追加区 + 「共享边界」说明块 |

### 7.2 三档模式定义

| 模式 | 麦田主结构 | 数据来源 | 用途 |
|---|---|---|---|
| ① 复刻版 | 100% 原样 | 麦田演示数据（确定性种子，隔离，不读写业务库） | 对照基准：证明「复刻完整」 |
| ② 融合版（默认） | 100% 原样 | **麦田域=演示**（粉丝/播放/销售）＋**播块域=真实**（期/平台分发/分发条数/质检/闸门） | 生产使用：大屏看麦田的监控面 + 口播的真实分发链 |
| ③ 优化版 | 口播看板形态 | 口播工作台真实数据（雷达/漏斗/模块矩阵/need_setup） | 口播自身全链路监控 |

### 7.3 复刻完整性核对（实现 → 麦田 board.html 行号）

* 顶栏 4 灯 + 时钟：`board.html:396-400` → 实现同构（语义按口播改写并标注）。
* hero 3D 封面 + 期号 + 平台已发布数：`board.html:247,251` → 实现同构（封面为标题生成 SVG）。
* hero 轮播页签 + 相对日期 + 状态灯：`board.html:248-250` → 实现同构（`show()` 自动轮播 1.5s、悬停暂停、点击暂停 30s）。
* hero 倒计时文案：`board.html:433-436` → 实现同构。
* hero 平台格子（on/todo/bad + tooltip + 回链）：`board.html:253` → 实现同构。
* hero 三数 + 3 天净增 + 互动率差：`board.html:72-84` → 实现同构（`numsHTML`/`dtag`）。
* hero 占比条 + 3 天堆叠柱 + 发布后累计曲线：`board.html:91-141` → 实现同构（`compHTML`/`barsHTML`/`lineHTML`）。
* hero 同龄对比：`board.html:142-154` → 实现同构。
* 粉丝面板三档涨幅 + 占比图例 + 30 天堆叠面积图（含发布日标记/净增点/tooltip/坐标轴）：`board.html:404-409,164-198` → 实现同构（`drawFans`）。
* 数据分析 ≤6 条规则：`board.html:209-239` → 实现同构（`insights`，复刻版实测满 6 条）。
* 平台卡（logo/粉丝/今日/7 天/30 天 sparkline/本期 vs 上期）：`board.html:386-393` → 实现同构。
* 知识站 strip：`board.html:416-417` → 实现同构。
* 销售三期 + 30 天柱图 + 订单动态：`board.html:294-329` → 实现同构（`salesDashboard`）。
* 交互：轮播 `board.html:291`、`countUp` `:421-428`、`tick` `:429-437`、3D 悬停 `:445-457`、标题 marquee `:266-290`、insights 高度裁剪 `:420`、tooltip `:443`、60s 轮询 `:459` → 全部实现。

### 7.4 本轮修复的真 bug（复刻不完整的根因）

1. `insights()` 互动率写成 `{...}/m.views`（对象除法 → NaN），`filter(Boolean)` 把 9 行全过滤 → 麦田「集中度/互动率/收藏率」三条规则永不触发。修为 `r:((likes+comments+favorites+shares)/views)` 后复刻版 insights 由 3 条 → **6 条满额**。
2. 漏实现麦田第 5 条规则「收藏率」→ 已补 `byF` 规则。
3. 任务表 `ts` 是字符串 `'2026-11-27 11:03:17'`，直接透传导致前端 `new Date(ts*1000)` 抛 Invalid time value → 后端新增 `_ts_epoch` 统一为 epoch 秒。
4. `buildReal` 把 `days` 传成数字导致 `stackChart` 崩溃；`renderBars` 的 `esc(...)` 少右括号；箭头函数里写 `return` → 均已修。

### 7.5 验收（真浏览器实跑）

* 融合版：37 期页签、hero 期=真实成片「cut · KJ110317041」、状态「发布中」、倒计时「已发 3 分钟」、平台格子「抖音 待你点发布」、三数「本期分发 1 / 待你点发布 1 / 100.0%」、insights 4 条（涨粉·转化=麦田演示域；分发·质检=真实）、分发链表首行 `KJ110317041 | KJ110317041_cut_1080x1920.mp4 | 抖音 | 待你点发布 | 质检 50`、麦田平台卡 10 张 + 销售三期 + 粉丝堆叠图仍在、共享边界块明示「已打通/未打通」。
* 复刻版：insights **6 条满额**、平台格子 10、平台卡 10、销售三期 + 30 天柱图 + 4 条订单动态、无分发链面板（纯演示域）。
* 优化版：11 张源卡、生产漏斗、雷达真实快照、诚实边界，均为口播真实数据。
* 端点：`GET /api/koubo/board` → `ok:true / kb-board-v1`，新增 `distribution` 段（37 期 / 9 个平台待发布 / platforms=['抖音']）。
* 不回归：L1 静态审计 **47/47**、L2 功能回归 **31/31**（7 场景全 done）。

---

## 八、轮12：100% 复刻麦田结构 + 恢复六个页签入口（2026-11-27）

### 8.1 上一轮的两个偏差（本轮修正）
1. **入口缺失**：麦田顶栏的 `nav` 槽位本应是 `大屏 / 流量 / 日历 / 转化 / 档案 / 系统` 六个页签（`board.html:397`），
   上一轮把它换成了自造的「复刻/融合/优化」模式切换按钮 → **入口被破坏**，且麦田原页签变成死链 `/p#/xxx`（本机无该页）。
2. **复刻不完整**：模式切换属于额外 UI，违背「保留麦田内容主结构」。

### 8.2 本轮修正
* **顶栏 100% 复原麦田槽位**：`logo` + `tag` + `nav`(6) + `lights`(4) + `clock`，顺序与 `board.html:396-400` 一致；
  模式切换降级为 `tag` 旁的一枚 chip（不占用 nav 槽位），且只在「系统」页提供切换控件。
* **六个页签入口全部真实可用**（hash 路由，iframe 内直接切换，不跳 404）：

| 页签 | 麦田原意 | 本实现（底层接口） | 真实来源 |
|---|---|---|---|
| 大屏 | 主看板 | 主看板（hero/粉丝/洞察/平台卡/销售） | 播块域=口播真实；粉丝/销售=麦田演示域 |
| 流量 | 各平台播放流量 | 每日抓取堆叠 + 累计曲线 + 来源状态 + 热度 Top | 口播 radar-crawler-v4 真实 |
| 日历 | 发布计划日历 | 14 天任务/成片/质检日历 + 最近任务表 | 口播任务表真实 |
| 转化 | 知识站转化 | 生产漏斗（抓取→拆解→仿写→确认→成片→质检→分发）+ 渠道转化 | 漏斗=口播真实；渠道=麦田演示域 |
| 档案 | 每期档案 | 成片产物 / 仿写稿 / 选题 / 抓取记录 / 分发回执 五个子标签 | 口播真实 |
| 系统 | 平台体检与集成 | 模块矩阵 + 采集源矩阵 + 数据源切换 + 共享边界 + 桥接命令 | 口播真实 |

* **只接口播必要数据**：播块域（期与成片、平台分发状态、每日抓取/分发条数、质检与闸门、生产漏斗、任务与档案）走口播真实接口；
  麦田自有域（平台粉丝与涨粉、发布后播放/互动/收藏率、知识站注册与销售）口播无对应数据 → 保留麦田演示数据并在页面显式标注，不混算不冒充。

### 8.3 修掉的 bug
`koubo_board.py` 发布台账映射只取 `data.platform`，而 dry-run 回执里是 `platforms` 数组 → 档案页平台列全为「—」；
改为 `platform` 优先、缺失时取 `platforms[0]`，并把 `status` 作为 state 回传（现为「抖音 / dry-run / 结果待确认」）。

### 8.4 验收（真浏览器实跑，含 iframe 内点击）
* 从智漫6 左栏「📊 数据大屏」进入：生成 `boardFrame`（`/board/index.html`）、`koubo-immersive` 生效、`kouboFrame` 不存在（同一时刻只有一个 iframe）。
* iframe 内顶栏：logo=麦田、nav=大屏/流量/日历/转化/档案/系统、4 盏状态灯、时钟；hero=「cut · KJ110317041」、10 张平台卡、3 期销售、分发链表 10 行、洞察 4 条。
* **六个页签逐个点击**（iframe 内 hash 路由）：流量 5 KPI/2 表、日历 2 面板/1 表、转化 4 KPI/漏斗、档案 5 子标签（分发回执 10 行）、系统 5 KPI/2 表 —— 全部出真实内容，无 404。
* 端点：`/api/koubo/board` → `kb-board-v1`，`distribution` 39 期 / 10 待发布；`/board/index.html` 200（85061 B）；`probe rc=0`。
* 不回归：L1 **47/47**、L2 **31/31**（7 场景全 done）；三页面 8 个内联脚本块语法全通过。

---

## 九、轮13：彻底重构 —— 100% 复用麦田原文件，只换数据契约（2026-11-27）

### 9.1 问题诊断（用户指出"使用功能架构交互全乱了"）
上一轮我把麦田**两个页面合并成一个自造页面**，并自造了模式切换与页签内容。逐行读懂麦田源码后发现真实架构是：

| | 麦田原文件 | 角色 | 数据 | 操作 |
|---|---|---|---|---|
| 大屏 | `src/web/board.html`（462 行） | **只读电视墙**，本身不做页面切换 | `GET /api/overview` | 顶栏 nav 是**跳转到另一个页面** `/p#/xxx` |
| 操作台 | `src/web/pages.html`（549 行） | **hash 路由单页应用** | `/api/overview`、`/api/episode`、`/api/account-traffic` | `abtn` 按钮 → `POST /api/action` **真实执行** + 轮询；`#/ep/<id>` 单期详情 |

上一轮的错在于：①把大屏与操作台合成一页；②占用麦田 nav 槽位放自造的「复刻/融合/优化」切换；③自造六个页签的内容（与麦田语义对不上，如"流量"本该是每期×平台明细矩阵）；④丢掉了 `abtn` 动作执行与 `#/ep/<id>` 单期详情，导致"很多场景无法精准指向执行数据"。

### 9.2 本轮方案：UI 用麦田原文件，只做数据契约适配
**不再自造任何 UI。** 麦田的 `board.html` / `pages.html` / `mt.css` / `mt.js` **原文件直接使用**（MIT，保留 `LICENSE.maitian`），只做三类最小改写：

1. **路径适配**（不碰结构与交互）
   * 静态资源 `/static/mt.css|mts.js` → `/board/static/...`（server 新增 `/board/static/*` 路由）
   * API `/api/overview` → `/api/koubo/maitian/overview`；`/api/episode` `/api/action` `/api/account-traffic` `/api/integrations` `/api/bilibili-accounts` `/api/platform-toggle` 同理映射
   * 封面 `/cover?id=` → `/api/koubo/maitian/cover?id=`（口播无封面图 → 用真实标题生成 SVG 占位）
   * 导航改为**相对路径**（`pages.html#/traffic`），使其在智漫6 的 iframe 内切换而不跳出
2. **口径覆盖**（结构不动，只换文案取值处）：契约层返回 `labels`，前端从 `O.labels` 取值
   `views:全平台播放→分发条数`、`inter:互动→已发布`、`rate:互动率→发布率`、`fans:粉丝→采集来源`、
   `lightBrowser:专用浏览器→采集通道 匿名直连`、`lightLogin:平台登录→采集源 正常`、`tag:内容与粉丝监控→内容与分发监控 · 口播工作台`
3. **新增服务端路由**：`/board/board.html`（大屏）、`/board/pages.html`（操作台）、`/board/static/*`、`/api/koubo/maitian/*`（GET+POST）

### 9.3 数据契约映射（口播 ⇄ 麦田，字段名完全沿用麦田）
| 麦田 | 口播 | 说明 |
|---|---|---|
| `episodes[]`（发布工程） | `job(scene=cut/gen, artifact=mp4)` | 一次成片 = 一期；含 covers/nick/schedule/publishAt/createdAt |
| `episodes[].tasks[]`（某期某平台） | 发布台账 `publish/*.json` | dry-run→`awaiting_user`「待你点发布」；真发→`published`；无→`planned` |
| `metrics[]`（日×期×平台播放） | 每日每平台分发条数 | `extra.proxy=1` 标注口径=分发条数，非平台播放量 |
| `samples[]`（采样点） | 每次成片/分发动作 | 供麦田画发布后累计曲线 |
| `followers[]` | **空**（口播无粉丝） | 麦田自带空态「还没有粉丝记录」，不伪造 |
| `site{days,channels,campaigns}` | **空**，`siteOn=false` | 麦田原生引导「还没接你自己的站点」 |
| `health.platforms[]` | 11 个采集源 + 7 项 need_setup | 可达→`state=ok`；需登录→`disabled=true`（不计掉线） |
| `feed[]` | 最近任务 | 场景/状态/产物 |
| `POST /api/action` | 真实动作 | `metrics`→**真跑 radar 采集**（实测 20 条/11 源）；`followers`/`doctor`/`login`→诚实说明口播不依赖登录态；`sync`→**真跑 publish dry-run**；`mark`→诚实说明未接真发通道 |

### 9.4 验收（真浏览器实跑，全链路）
* 从智漫6 左栏「📊 数据大屏」进入 → 麦田原版大屏渲染真实数据：hero=真实成片标题、37 期页签、平台格子「抖音 待你点发布」、三数「分发条数 10 / 已发布 0 / 发布率 0.0%」、9 张平台卡、4 盏灯「守护进程 运行中 / NAS 已挂载 / 采集通道 匿名直连 / 采集源 正常」。
* 点顶栏「档案」→ **iframe 内**切到操作台（37 张封面墙、`h1=档案`）。
* 点封面 → `#/ep/<id>` 单期详情：`第 1 期`、状态芯片「! 待你点发布」、`0/1` 已发布、三个动作按钮（取链接、对状态 / 采这一期的流量 / 我已发布）、平台表、文案快照、过程记录（真实任务日志 `11/27 11:21 queued 任务已入队…`）。
* 五个页签逐个真实出内容：流量 4 KPI/3 表、日历 28 天格、转化诚实空态、档案 37 张、系统 4 KPI/46 按钮。
* 动作按钮实测：`采流量` → 真跑 radar 采集返回「真实采集 20 条（11 源可达）」；`采粉丝` → 诚实说明「口播工作台走匿名公开源（11 源可达），不需要平台登录态，也没有粉丝数据」。
* 端点：`/api/koubo/maitian/overview` → 35 期、真实 metrics/samples、`health.platforms` 17 项；`/api/koubo/maitian/episode?id=` → 单期详情（含 7 条过程记录 + 产物路径）；`/board/board.html` 200（53503 B）、`/board/pages.html` 200（58580 B）、`/board/static/mt.css|mts.js` 200。
* 不回归：L1 **47/47**、L2 **32/32**（新增 `cap/koubo_maitian` 检查通过，因补了 `status()`）；8 个内联脚本块语法全通过。

### 9.5 本轮修掉的 bug
1. `koubo_maitian.py` 缺 `status()` → L2 `cap/koubo_maitian` 返回 None 判 FAIL（与历史同类坑：模块必须实现 status()）→ 补齐后 32/32。
2. 单期详情 `episode=0` → 显示「第 0 期」→ 改为按真实排序取期号。
3. 时间戳无时区 → 麦田 `when()` 用 `new Date(iso)` 解析，按 UTC 偏 8 小时（显示 `1/22 02:49`）→ `_iso()` 改为带时区 ISO（`+08:00`），日志/feed 同步。
4. iframe 内导航用绝对路径 → 点页签会跳出 iframe 到顶层 → 改为相对路径 `pages.html#/xxx`。

---

## 十、轮14：专用 Edge 登录态采集 + 平台图标即登录入口（2026-11-27）

### 10.1 用户诉求与结论
1. **「接 Microsoft Edge 浏览器不行吗？采集数据不能用吗？」** → 可以，且本机已装 **Edge 158.0.4370.33**（`C:/Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）。Edge 与 Chrome 同为 Chromium 内核，**CDP 完全通用**（麦田的 `chrome-shim.mjs` 就是原生 WebSocket 直连 CDP，零 npm 依赖）。
2. **「登录各平台的入口机制能否加在数据大屏当中，点击抖音图标直接弹出登录界面」** → 已实现：平台图标（`.lg`）改为可点登录入口，鼠标悬停显示「点击登录 X（专用浏览器，脚本不接触密码）」。

### 10.2 2026 年的硬约束（社区调研结论，必须遵守）
* **Chrome/Edge 136+ 对默认用户目录禁用 `--remote-debugging-port`**，必须配 **独立 `--user-data-dir`**；144+ 还需用户在 `chrome://inspect` 授权。→ 本实现用独立 profile `C:/zm6-koubo/browser/edge-profile`，与日常 Edge 完全隔离（也不碰日常浏览的 History/Login Data）。
* **不要用 `puppeteer-extra-plugin-stealth`**（2023-03 后未维护，补丁本身成为指纹）；2026 主流是 patchright / nodriver / camoufox（改驱动或改引擎）。本场景是"接管真实浏览器"，TLS/JA4 指纹天然真实，无需任何 stealth 补丁。
* 反检测层级顺序：IP 信誉 → TLS/JA4 → CDP 协议痕迹（`Runtime.enable`）→ JS 指纹 → 无头 vs 有头 → 行为关联。**有头 + 真实浏览器 + 最小化窗口**是关键。
* 安全：调试端口只绑 127.0.0.1；只关自己开的 target，**绝不 `browser.close()`**；至少保留 1 个页签；`127.0.0.1` 访问要绕开本机代理（社区常见坑：9222 被 `HTTP_PROXY` 截走返回 502）。
* 登录模型：**人负责登录（扫码/短信/滑块），脚本只负责操作**——脚本全程不接触密码。

### 10.3 落地（口播侧新增两个模块）
| 文件 | 作用 |
|---|---|
| `智漫6-orchestrator/koubo_cdp.mjs` | **零依赖 CDP 客户端**（Node 24 原生 WebSocket）：启动独立 profile 的 Edge（端口 9333）→ `Target.createTarget/attachToTarget` → `Page.navigate` → 页面上下文 `Runtime.evaluate`（带 cookie）；`detached:true` 让浏览器**脱离 Node 生命周期独立常驻**（否则 Node 一退出，Windows 作业对象会连带杀掉 Edge，人来不及扫码）；登录场景 `keepOpen=true` **保留标签页**；就绪等待用 **CDP 事件 `Page.loadEventFired`**（不用 `Runtime.evaluate` 轮询——后台 SPA 忙时 evaluate 会挂满 30s 超时） |
| `智漫6-orchestrator/koubo_browser.py` | Python 包装：`status/open_login/collect/stop`，`status_short` 带 60 秒缓存（大屏 60s 轮询不该每次起 Node） |

### 10.4 采集能力（真实登录态读取，页面上下文带 cookie）
* **B站**：`fetch('/x/web/archives?status=pubed&pn=1&ps=30',{credentials:'include'})` → 作品标题/BV/播放/赞/评/藏/转（麦田同一条接口）
* **抖音/小红书/视频号/公众号/快手/YouTube**：后台为前端渲染，读 DOM（只取已渲染内容，不逆向签名）
* **X / Instagram / Threads**：无稳定后台接口 → 诚实 `need_setup`，不伪造

### 10.5 登录态判定（四态，诚实不冒充）
| 判定 | 依据 |
|---|---|
| `logged_in` | **权威**：平台官方接口判定（B站创作中心 `/x/web-interface/nav` 的 `data.isLogin`） |
| `likely_in` | 只看到后台界面外壳（可能只是 SPA 渲染了导航），**不断言已登录** |
| `logged_out` | URL/标题命中登录特征，或页面有密码输入框 |
| `unknown` | 两者都没有 → 无法判定 |

### 10.6 大屏接入（不改麦田结构，只加入口与口径）
* 平台图标 → 可点登录入口：`mt.js` 与 `board.html` 的 `logo(p)` 增加 `data-login`，点击 → `POST /api/koubo/maitian/action {type:'login'}` → 起专用 Edge 打开该平台登录页 → 提示「B站：未登录（登录页已保留在专用浏览器窗口，扫码后即可采集）」。
* 麦田系统页原生按钮全部真接通：`去登录`→`login`、`检查`→`doctor`（报真实浏览器路径/版本/端口）、`采流量`→`metrics`（真跑 radar）、`采账号流量`→`metrics-accounts`（登录态采集）、`采粉丝`→诚实说明口播不采粉丝。
* 顶栏状态灯改为真实口径：`专用浏览器 Edg/158.0.4370.33`、`采集源 N 项待登录`（不再写死"平台登录正常"）。

### 10.7 本轮修掉的 bug（都是实测发现的）
1. **Edge 随 Node 一起被杀**：`detached:false` → Node 退出时 Windows 作业对象连带终止浏览器 → 改 `detached:true` + `unref()`。
2. **登录页被立刻关掉**：`withPage` 收尾无条件 `Target.closeTarget` → 登录场景改 `keepOpen=true`，标签页留给用户扫码。
3. **每次调用卡 31 秒**：`CDP.send()` 的 30 秒超时定时器**成功后未清除** → 进程打印完结果仍挂 30 秒才退出（Python `subprocess.run` 等进程结束 → 端点耗时 32 秒）。修复为成功/失败都 `clearTimeout`；`withTimeout` 的 guard 定时器同样清除。→ **端点耗时 32s → 0~1.3s**。
4. **就绪等待挂满超时**：用 `Runtime.evaluate` 轮询 `document.readyState`，后台 SPA 忙时 evaluate 挂死 → 改为等待 CDP 事件 `Page.loadEventFired`。
5. **登录态假阳性**：只看 URL/标题无 "login" 就判已登录 → 改为四态判定 + B站官方接口权威判定。
6. **采集 need_login 被通用错误分支抢先** → 调整判断顺序；`status_short` 补 `port`；`_health()` 重复调用导致每次 overview 起两次 Node → 改为一次 + 60 秒缓存。

### 10.8 验收（真浏览器 + 真 Edge 实跑）
* 点大屏 B站图标 → **1.2 秒**返回「B站：未登录（登录页已保留在专用浏览器窗口，扫码后即可采集）」。
* 专用 Edge 进程实测：`msedge.exe --remote-debugging-port=9333 --user-data-dir=C:/zm6-koubo/browser/edge-profile`，CDP 端点 `Edg/158.0.4370.33`；窗口内**同时保留 3 个真实登录页**：B站「账号登录」passport.bilibili.com、视频号助手 channels.weixin.qq.com/login.html、抖音创作者中心 creator.douyin.com。
* 端点计时：`login/douyin` 1.3s、`login/bilibili` 1.0s、`doctor` 0.0s、`metrics-accounts/bilibili` 1.3s（未登录→诚实提示）。
* 端点：`/api/koubo/browser/status`、`/api/koubo/browser/login`、`/api/koubo/browser/collect`、`/api/koubo/maitian/action` 全部 200。
* 不回归：L1 **47/47**、L2 **33/33**（新增浏览器模块与相关检查）。

### 10.9 诚实边界
* 采集依赖**你本人先在专用 Edge 里完成扫码登录**；未登录时返回「尚未登录：先点该平台图标登录」，**不绕过平台风控、不逆向签名、不伪造数据**。
* 实测抖音在专用实例中弹出了自己的风控校验页（`rc-verifycenter`），这是平台侧正常风控，脚本不做对抗。
* 调试端口仅 127.0.0.1；profile 与日常浏览隔离；用完可 `node koubo_cdp.mjs stop` 断开（不关用户窗口）。

---

## 十一、轮15：两项待定事项的评估与落地做法（2026-11-27）

> 待定项：① 麦田「粉丝 / 站点转化」两域在口播无真值（现走麦田原生空态），要真数据怎么做；
> ② 是否 push 到仓库 / 开 PR。

### 11.1 项① 评估结论（结论先行）

**「粉丝」和「发布后播放」现在已经能做真数据——因为登录态通道已建成。** 原判断"口播没有粉丝数据"是在**没有浏览器通道时**的结论，现在前提变了：

| 麦田数据域 | 上一轮判断 | 现在 | 做法 |
|---|---|---|---|
| 发布后播放（每期×平台） | 只能用"分发条数代理" | **可真采** | B站创作中心 `/x/web/archives` 的 `stat.view/like/reply/favorite/share` 就是真实播放与互动（页面上下文带 cookie） |
| 平台粉丝 | 无真值 | **可真采** | 移植麦田 `followers.mjs` 的公开接口：B站 `/x/web/index/stat`（total_fans/incr_fans）+ `/x/web/data/v2/overview/stat/graph?type=fan`（90天趋势）、抖音 `/web/api/media/user/info/`（follower_count）、小红书 `/api/galaxy/creator/data/fans/overall_new`（fans_count + 30天）、视频号 shadow DOM「关注者总数 \| N」、YouTube「当前订阅人数」 |
| 站点转化（注册/会员/收入） | 无真值 | **仍无**（口播没有站点，也没有 utm_campaign 归因） | 三选一（见下） |

**已落地（本轮）**：
* `koubo_cdp.mjs` 新增 `FOLLOWERS` 采集器（B站/抖音/小红书/视频号/YouTube）与 `followers` / `collect-all` 命令；账号作品采集结果落盘缓存 `C:/zm6-koubo/browser/accounts/<platform>.json`，粉丝落盘 `followers\<platform>.json`。
* `koubo_maitian.py` 新增 `_account_cache()` / `_followers_cache()` / `_merge_account_data()`：把真实账号数据**按标题关联**回填到每一期的 `tasks[].m`（播放/赞/评/藏/转）→ 麦田「流量」页的每期×平台矩阵显示真实播放量；粉丝数据进 `followers[]` → 麦田「粉丝」面板自动有真数据。
* **口径自动切换**：有真实账号数据时标签回到麦田语义（播放量/互动/互动率/粉丝）；没有时保持诚实口径（分发条数/已发布/发布率/采集来源）。绝不把代理值当播放量展示。
* 麦田系统页「采粉丝」「采账号流量」按钮**真接通**（支持单平台与批量），未登录时逐平台如实回报「需先登录」（实测：`bilibili/xhs → need_login`，其余 `count:0`）。

**唯一前提**：你本人先在专用 Edge 里扫码登录（脚本不接触密码）。登录后点一次「采账号流量」「采粉丝」，大屏即从"分发条数代理"升级为真实播放量与真实粉丝。

**「站点转化」的处理建议（三选一）**：
1. **推荐 · 保持未接入**（当前状态）：口播工作台没有站点、没有 utm 归因体系，麦田原生文案「还没接你自己的站点」就是正确表达，不造假。
2. **若你有课程站/会员站**：按麦田 `src/site.mjs` 契约提供两个**只读**接口（`coursesApi` 课程列表、`dashboardApi` 仪表盘，注册/会员/收入/渠道/按期 campaign 统计），在口播侧加一个 `site` 适配器（读同一个 `koubo_board.site`），即可让麦田「转化」页变成真实漏斗。
3. **不推荐**：用口播的"选题→成片→发布"内部计数冒充"注册/收入"——那是两回事，会把不可比的数混进转化漏斗。

### 11.2 项② 评估结论（版本管理与提交）

| 方案 | 可行性 | 判断 |
|---|---|---|
| push 到上游 `CzzzzzzJ/mdldm-maitian` | **不可行**（无权限，且是他人仓库） | 不做 |
| 在你账号下 fork → 推分支 → 开 PR | 可行，需你提供 fork 仓库地址或 token | 你点头我再做；PR 内容就是 `src/koubo-bridge.mjs` + `docs/koubo-integration.md` 两处集成 |
| **把口播工程纳入 git 管理**（推荐） | 可行，`智漫6-orchestrator` 目前**不在任何版本库**里，14 轮改动无提交记录 | **建议做**：`git init` + `.gitignore`（排除 `artifacts/`、`__pycache__`、`*.log`、`*.bak*`）+ 首次提交（源码与配置入库，产物不入库） |
| 继续现状（只本地 commit 麦田克隆） | 可行 | 已如此；但口播侧无版本保护，回滚靠人工 |

**建议执行顺序**：① 先给口播工程 `git init`（一次提交锁住当前可用状态，作为回滚基线）→ ② 你提供 fork/token 后再向麦田上游提 PR（集成代码只有两个文件，评审成本低）→ ③ 站点转化按 11.1 的方案 2 或 1 定。

### 11.3 本轮修的 bug
`collect-all` 分支被前置"未知平台"校验拦截（空 arg 直接 return，批量成为死代码）→ 放行 `cmd==='collect-all'`；批量采集结果需逐平台回报（此前 `result:{}` 空）。

### 11.4 验收
`metrics-accounts`（批量）→ 「没有已登录的平台」+ hint「以下平台需先登录：bilibili、xhs」；`followers`（批量）→「没有平台处于已登录状态：请先点平台图标登录」；`followers/bilibili`→「尚未登录：先点该平台图标登录，再采集粉丝」；`overview.account_data = {filled_tasks:0, metric_rows:0, follower_platforms:[]}`，标签仍为诚实口径「分发条数」；L1 **47/47**、L2 **33/33**。

---

## 十二、轮16：「带你点发布」交互链与麦田原结构对齐（2026-11-27）

### 12.1 用户问题
「带你点发布 —— 与麦田原交互结构一样吗？」

### 12.2 逐层核查结论（麦田原码证据）
| 环节 | 麦田原实现 | 我们此前 | 结论 |
|---|---|---|---|
| 状态产生 | `hub.mjs:105` 国内四家填好即 `setTask(...,'awaiting_user','核对后点发布')` 并 **return**（绝不自动提交） | 口播 publish 台账 dry-run 回执 → `awaiting_user`「待你点发布」 | **一致**（同一状态机语义） |
| 大屏呈现 | `board.html` hero `.plats` 格子：已发布带链接可点、待发布是 `<div>` 不可点（只显示状态） | 同（麦田原文件，未改） | **一致** |
| 操作入口 | `pages.html:229` 单期详情页 `sec('等你点发布')` 区块 → `abtn({type:'mark',id,platform,state:'published'},'我已发布','','确认「X」已经发出去了？')` | 麦田原文件自带（按钮、二次确认文案、data-act 全部原样） | **一致** |
| 动作执行 | `hub.mjs:568` `cmd==='mark'` → `setTask(ep,platform,state,'人工标记',{url})` + `log(...)` | 此前 **no-op**：诚实返回「未接真发通道，无法标记」 | **此前不一致 → 本轮补齐** |
| 状态回流 | setTask 后大屏/日历/统计立刻看到 published | 需真跑 | 本轮补齐后**一致** |

### 12.3 本轮补齐（语义与麦田完全同构）
* `koubo_publish.mark_published(video, platform, state, url, note)`：**用户自己在平台点了发布，系统只登记状态 + 留痕**，不代替用户真发、不伪造平台回执（= 麦田 `setTask` 语义）。
* 落盘：`C:/zm6-koubo/publish/marked_<期>_<平台>.json`（**按 (期,平台) 固定文件名，重复标记即覆盖**，避免台账堆积）。
* `koubo_maitian._mark_index()`：按 ts 取最新记录（修掉「旧记录覆盖新状态」）；`_tasks_for()` 应用标记 → 状态推进为 `published`，未跑过 dry-run 的平台也能被标记。
* `action({type:'mark'})` → 真调用并返回「已登记「抖音」为 已发布（人工标记，平台回执以平台为准）」。

### 12.4 实测（真浏览器点真实按钮）
1. 麦田系统页 → 档案 → 点某期封面 → `sec('等你点发布')` 区块、状态芯片「! 待你点发布」、按钮「我已发布」、二次确认「确认「抖音」已经发出去了？」——**与麦田原结构逐项一致**（这些都来自麦田原文件，我们未改）。
2. 真实点击按钮（覆盖原生 confirm 以便自动确认）→ 该期任务状态 `awaiting_user → published`（大屏格子随之变「已发布」绿态）。
3. 测试痕迹已清除（删除标记文件），状态回到原始「待你点发布」，**未改动用户真实数据**。

### 12.5 修的 bug
① `marks()` 按 mtime 倒序返回而索引遍历时「后写覆盖前写」→ 最新 published 被旧 awaiting_user 覆盖（状态推不动）；改按 ts 取最新。
② 每次标记新建时间戳文件 → 台账堆积；改为固定文件名覆盖写。
③ `mark` 动作此前是 no-op（与麦田原交互结构不一致）→ 本轮接成真动作。

### 12.6 验收
浏览器实测：按钮存在、`data-act={"type":"mark","id":"KJ213900090","platform":"douyin","state":"published"}`、`data-confirm=确认「抖音」已经发出去了？`；点击后 `douyin:published(已发布)`；清理后回到 `awaiting_user(待你点发布)`。L1 **47/47**、L2 **33/33**。

### 12.7 与麦田仍存的一处结构差异（如实说明）
麦田的「等你点发布」靠**飞书卡片**推送提醒（`hub.mjs:226,241`），口播工作台没有飞书集成 → 该提醒位目前由**大屏平台格子状态 + 单期详情页区块**承载，操作路径与麦田一致，只是提醒渠道不同（若要补飞书，需 webhook 与卡片模板，见麦田 `src/feishu.mjs`）。
