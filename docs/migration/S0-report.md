# S0 麦田迁移技术验证：结论报告（KIN-314）

2026-11-19。环境：Ego Lite（`ego-browser` 0.6.3.14，chromium 156），Profile 5（Ego 的默认 profile，`isDefault: true`，名称「lee kinso 3(Edge)」）。全程只读：没有发布、没有发评论私信、没有点发送；回复框填入后都清空并读回为空。

每项的测法、证据和原始结论在 `spikes/results/`，脱敏样例在 `spikes/results/samples/` 和各结论文档的样例段落。原始响应只在 `scratch/`（已 gitignore）。

## 总表

| # | 验证项（spec 用户故事） | 判定 | 一句话 | 详情 |
|---|---|---|---|---|
| 0 | 平台 × 账号长期 space（5） | 通过 | 10 个 space 按 `kinso/<platformCode>/<uid>` 建在 Profile 5，按名字幂等复用；8 个已登录 | [00-spaces.md](../../spikes/results/00-spaces.md) |
| ② | ego-shim 下跑插件 preflight（6） | 部分 | 6 个已登录平台全部判对；未登录的 Instagram 也判对，但要等满 60 秒超时 | [02-preflight.md](../../spikes/results/02-preflight.md) |
| ③ | 跨进程找回页面（7） | 通过 | 三种结束方式都能在新进程找回；`kill -9` CLI 不会停掉 Ego 里的脚本 | [03-cross-process-recover.md](../../spikes/results/03-cross-process-recover.md) |
| ④ | 多 space 并行 + `withFocus`（8） | 不加锁不通过；加前台锁通过 | 不加锁会互抢前台；一把只锁切前台步骤的全局文件锁即可 | [04-parallel-withfocus.md](../../spikes/results/04-parallel-withfocus.md) |
| ⑤ | 视频号与公众号同 profile 互踢（9） | 通过 | 35.6 分钟、25 次检查两边都在线；期间在普通窗口各开一次也没掉线 | [05-channels-mp.md](../../spikes/results/05-channels-mp.md) |
| ⑥ | 作品列表、扩展字段、粉丝的来源（10） | 通过 | 抖音、小红书、B站、视频号近 30 天作品数与后台一致；分日粉丝与小V猫 11-18 导出逐日一致；已写成 S3 字段对照 | [06-works.md](../../spikes/results/06-works.md) |
| ⑦ | 评论页、私信页只读适配器（11） | 通过 | 三平台评论、私信都能读列表、定位回复框、填入后清空；「是否已回复」只做到部分 | [07-engage.md](../../spikes/results/07-engage.md) |
| ⑧ | 一个进程跑 2 小时以上（12） | 通过 | 126 分钟 126/126 次检查成功，RSS 稳定约 177MB | [08-long-process.md](../../spikes/results/08-long-process.md) |
| ⑬ | `Input.dispatchMouseEvent/KeyEvent`（13） | 通过 | 前台页、后台页、别的 space 的页都能点、能输入；鼠标事件会抢焦点 | [13-input-events.md](../../spikes/results/13-input-events.md) |

交付件：`src/ego-shim.mjs`（`chrome.tabs.*` / `chrome.debugger.*` → Ego task/page API）、`src/ego-runner/`（短进程运行器，最后一行 `@@RESULT <json>`）、`test/ego-shim.test.mjs`、`test/ego-runner.test.mjs`（对本地测试页的行为测试，`npm test` 25/25 通过）。插件 fork `kinsolee/mdldm-maitian-publisher` 已建、upstream 已配（11-18）；麦田 fork 已有 upstream。

## ⑥ 给 S3 的要点（最急）

负责人 11-19 停用小V猫，每日内容数据回填暂停，S3 接上后恢复。读法和逐字段对照全在 [06-works.md](../../spikes/results/06-works.md)，目标格式是小V猫的 `posts-*.json`、`accounts-*.json`，下游 `backfill.py` 不改。

| 平台 | 作品接口 | 签名 | 近 30 天：接口 / 后台 | 粉丝 |
|---|---|---|---|---|
| 抖音 | `GET /janus/douyin/creator/pc/work_list` | 不要 | 14 / 14 | 总数 + 30 天分日 |
| 小红书 | `GET /api/galaxy/creator/datacenter/note/analyze/list` | 要，用页面自带 `window._webmsxyw` | 15 / 15 | 总数 + 30 天分日 |
| B站 | `GET /x/web/archives` + `/x/web/data/archive_diagnose/compare` | 不要 | 16 / 16 | 总数 + 30 天分日 |
| 视频号 | `POST /micro/statistic/.../statistic/post_list` | 不要（请求体带 finderUsername） | 16 / 16 | 总数 + 30 天分日 |

容易错的地方：视频号 `postId` 用 `objectNonce`、uid 用 `uniqId`，`favCount` 是点赞、`likeCount` 是推荐；抖音 `forward` 取 `share_count`，`items[].id` 超过 2^53 要按字符串解析；B站没有完播率（写 `null`），`full_play_ratio` 是平均播放进度；`fullView` 统一百分数，`viewTime` 统一秒，`postTime` 统一东八区。公众号阅读和视频号分日已在 `~/code/local-tests/ego-backend/queries.mjs` 跑通，S4 搬进麦田。

## 对方案 v2 的修改建议

1. **profile**：PLAN 写的 Profile 5 就是 Ego 的默认 profile，与负责人 11-19 实测的「默认 profile 里公众号和视频号都在线」是同一个。⑤ 通过，§2.2「公众号另建 profile」不需要。
2. **space 按名字找，不写死 id**：11-18 建的 space 到 11-19 早上已不在，当天下午又有 3 个闲置 space 消失（原因未确认，疑似 Ego 回收闲置 space）。登录态是 profile 级 cookie，按名字重建后不用重新扫码。S1 的 space 表只存名字。
3. **前台锁（§2.3）**：全局一把，跨 space、跨进程，锁住所有会切前台的步骤：`withFocus` 整段、`tabs.create/update({active:true})`；插件的 `cdp.click/hover` 发真实鼠标事件也会抢焦点，同样进锁或接受抢焦点。串行代价小（20 轮从约 30 秒变约 50 秒）。
4. **space 锁由 runner 保证**：Ego 不拦两个进程同时操作同一页。普通模式下超时杀 CLI 后脚本可能还在跑，所以 runner 超时后要等心跳确认旧脚本停了，才对同一 space 起新任务；脚本自己设截止时间，浏览器调用出错就退出，不吞错。
5. **长任务用普通模式**：`--session` 的 `--timeout-ms` 上限 10 分钟，只适合登录检测、填表、回读这类短任务；长视频上传用普通模式加心跳文件。
6. **ego-shim 的 `tabs.create`**：`src/ego-shim.mjs` 的 `page.goto(url)` 默认等 `load`、15 秒超时，抖音这类长轮询 SPA 可能超时（11-18 出现过，11-19 没复现）。S2 改成 `waitUntil: "commit"` 加等待，或放宽超时。
7. **preflight 未登录判断**：插件的 `LOGIN_URL` 正则不认 Instagram 的账号验证页（`/auth_platform/challengepicker/`），未登录要等满 60 秒超时，且原因分不清是没登录还是网慢。S2 在 fork 里补这条正则。
8. **⑦ 评论私信**：优先读页面组件数据或挂钩到的接口；小红书评论列表 DOM 渲染不稳，以接口为准；小红书创作者中心没有私信页，评论和私信都在主站。「是否已回复」的判断留给 S5 再补。

## 需要负责人做的

- **Instagram**（space 189 `kinso/Instagram/pending`）：停在 Instagram 账号安全验证页，请本人在 Ego Lite 里切到这个 space 完成验证或重新登录。
- **知识站**（space 193）：麦田 `config.json` 没配 `site.admin`，请给后台地址。
- X、YouTube、视频号的 space 名里 uid 还是 `pending`，S1 登记 uid 时改名（视频号用 `finderUser.uniqId`）。
