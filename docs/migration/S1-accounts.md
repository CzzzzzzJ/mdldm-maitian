# S1 账号表与登录检测（`hub ops`）

`hub ops` 管运营侧账号：账号表、登录检测、扫码登录、掉线提醒、能力位、写入口令。没有 `config.json` 也能跑 `accounts` 和 `tokens`（`hub.mjs` 第一个 import 就把 `ops` 转给 `src/ops/cli.mjs`，不加载飞书、麦田原库和浏览器驱动）。

## 命令

```sh
hub ops accounts import [清单文件]              # 默认 src/ops/accounts.seed.json；幂等
hub ops accounts list [--json]
hub ops accounts set-uid <platformCode> <uid>    # 给 pending 账号登记真实 uid
hub ops accounts set-cap <账号id> <能力位> <true|false>
hub ops login --check [--platform <code>] [--json]   # 只读
hub ops login <platformCode|账号id>              # 打开登录页并 handOff() 给负责人扫码，交还后自动 check
hub ops tokens init                              # 生成写入口令到 .env，不打印口令值
```

账号 id 写 `<platformCode>:<uid>`，space 名 `kinso/<platformCode>/<uid>`，一律 Profile 5。platformCode：Douyin、Channels、XiaoHongShu、Bili、GongZhongHao、Weibo、X、YouTube、Instagram、Zhishi。

## 登录检测

- 每个账号起一个 runner 任务，在 space 里打开后台首页（`waitUntil: "commit"` 再等 6 秒），按平台判断登录、读当前 uid。判断方法照搬 `spikes/platform/spaces.mjs`，代码在 `src/ops/space-check.mjs`。
- uid 是 `pending` 的账号读到真实 uid 时登记进去（视频号 `finderUser.uniqId`、X handle 去掉 `@`、YouTube `UC…`、Instagram 用户名），space 名跟着改。
- **UID 和登记的不符**：不写 ok（记 `unknown`，证据写明两个 uid），发提醒，整条命令退出码 2。
- 页面显示已登录但没读到 uid（例如公众号落地带 token 但页面里找不到 gh_ id）：不写 ok，记 `unknown`，算失败。
- runner 返回 `busy` / `user-controlled` / `profile-needed`：这个账号跳过，登录状态不改。
- 知识站没配 `site.admin`：记 `unknown` 并说明，不起任务。
- 输出和证据里不放 cookie、token（公众号只记「带 token」）。

退出码（多个账号时取最严重的：2 > 1 > 3 > 4 > 5 > 0）：

| 退出码 | 含义 |
|---|---|
| 0 | 全部检测完（结果是 out 或 unknown 也是 0，掉线看提醒和 `loginState`） |
| 2 | 有账号 UID 不符 |
| 1 | 有检测失败：runner 失败（timeout、exit-code 等）、检测结果结构不对、或页面显示已登录但没读到 uid（没法核对，记 `unknown`） |
| 3 | 有账号跳过：`profile-needed` |
| 4 | 有账号跳过：`user-controlled`（扫码登录等了 30 分钟还没交还也是 4） |
| 5 | 有账号跳过：`busy` |

## 掉线提醒

检测结果是 `out`、或 UID 不符时发飞书卡片（`src/feishu.mjs` 的 `notify`，quiet 模式，日志只写 stderr），同一账号 6 小时最多一次，上次真正发出的时间记在 `accounts.alertSentAt`。没有 `config.json` 或没配 `feishuWebhook` 时不发、不记时间，只在 stderr 说明。

uid 统一去首尾空白和前导 `@`（导入、`set-uid`、登记、检测比对都一样）；昵称只在 UID 核对通过后才写。

## 能力位

`readWorks、readComments、readDM、reply、sendDM、likeComment、pinComment、deleteComment、block、setVisibility、publish`，全部默认 false。写入类代码先调 `requireCapability(db, id, cap)`（`src/ops/accounts.mjs`），false 直接抛错。

## 写入口令

`hub ops tokens init` 用 `openssl rand -hex 32` 生成 `MAITIAN_ENGAGE_TOKEN`、`MAITIAN_PUBLISH_TOKEN`、`MAITIAN_MANAGE_TOKEN`，写进仓库根目录 `.env`（权限 600，已在 `.gitignore`），已有的不动。校验用 `checkToken(scope, provided)`（`src/ops/tokens.mjs`，scope 是 engage / publish / manage，常数时间比较，.env 里没有就拒绝）。

## 文件位置

| 文件 | 默认 | 环境变量 |
|---|---|---|
| 账号库 | `data/ops.db` | `MAITIAN_OPS_DB` |
| 写入口令 | 仓库根目录 `.env` | `MAITIAN_ENV_FILE` |
| 知识站后台地址 | `config.json` 的 `site` | `MAITIAN_CONFIG` |
| 账号清单 | `src/ops/accounts.seed.json` | 命令行参数 |
