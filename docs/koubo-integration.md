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
