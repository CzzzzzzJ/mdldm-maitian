# 06 四平台近 30 天作品 + 指标、粉丝的读法与字段对照（给 S3）

**判定：通过。** 抖音、小红书、B站、视频号四个平台都在 Profile 5 的 space 里读到了近 30 天全部作品和指标，作品数和创作者后台页面显示的一致；粉丝总数和分日粉丝也都能读，分日数据和小V猫 11-18 导出的 `accounts-20261118.json` 逐日一致。字段缺口和换算见各平台的对照表。

2026-11-19 实测，时间窗 2026-10-20 00:00 至 2026-11-19（东八区）。

| 平台 | 作品接口 | 签名 | 近 30 天作品数：接口 / 后台页面 | 粉丝总数 | 分日粉丝 |
|---|---|---|---|---|---|
| 抖音 | `GET /janus/douyin/creator/pc/work_list` | 不要 | 14 / 14（作品管理页逐条数日期） | 295 | 30 天分日总数 + 净增 |
| 小红书 | `GET /api/galaxy/creator/datacenter/note/analyze/list` | **要** X-s/X-t，用页面自己的 `window._webmsxyw` 算 | 15 / 15（数据看板「笔记数据」近 30 天「共 15 条」） | 2568 | 30 天分日总数 + 涨 + 掉 |
| B站 | `GET /x/web/archives` + `GET /x/web/data/archive_diagnose/compare` | 不要 | 16 / 16（稿件管理「已发布 16」，账号 17 天前才开，全部在窗口内） | 101 | 30 天分日总数 |
| 视频号 | `POST /micro/statistic/.../statistic/post_list` | 不要（请求体要带 finderUsername） | 16 / 16（数据中心「单篇视频」选近 30 天「共16条视频」） | 416 | 30 天分日总数 + 增 + 减 + 净增 |

## 怎么跑

```sh
spikes/platform/run.sh spikes/platform/06-works-douyin.mjs     # 可加 '{"days":30}'
spikes/platform/run.sh spikes/platform/06-works-xhs.mjs
spikes/platform/run.sh spikes/platform/06-works-bili.mjs
spikes/platform/run.sh spikes/platform/06-works-channels.mjs
spikes/platform/run.sh spikes/platform/06-discover.mjs '{"platform":"Bili","urls":["…"]}'   # 探查用：挂钩页面请求，列接口路径和键名
```

- 每个脚本在对应平台的长期 space 里打开后台页面，在页面里发请求（同源、带 cookie），输出按目标格式（小V猫 `posts-*.json` / `accounts-*.json` 的字段名）映射好的记录。
- 翻页间隔 2.5 秒，只取近 30 天。原始响应在 `scratch/06-*-works-*.json`（已 gitignore）。
- 脱敏样例：`spikes/results/samples/06-{douyin,xhs,bili,channels}-works.json`。每份有 `request`（接口和参数）、`raw`（原始响应结构，只留 1 条，URL 去掉查询串，凭据类键整段去掉）、`mapped`（映射后的 2 条作品和账号记录）。视频号的 finderUsername 和视频号 ID 打了码。

## 下游实际读哪些字段

**`vcat-backfill/backfill.py`**（读 `posts-*.json`，不改它）只读这些字段：

| 字段 | 用途 |
|---|---|
| `postId` | 作品 id，按它找已有笔记（`post_id`）。**换了 id 体系就会重复建笔记**，见视频号 |
| `platform` | 映射中文平台名（`Douyin`/`XiaoHongShu`/`Bili`/`Channels`/…），对不上再用 `platformName` |
| `view` `like` `comment` `forward` `favorite` `fansAdd` | 6 个核心指标（views/likes/comments/shares/favorites/new_followers）。`-1`、`null`、`""` 当作没有 |
| `coin` `danmu` | 只在 B站读 |
| `love` | 只在视频号读（写成 recommends） |
| `show` | 只在小红书读（写成 exposure） |
| `homeVisit` | 只在抖音读（写成 home_visits） |
| `fullView` | 任何平台有就读，保留 2 位小数（写成 full_view_rate）。**单位是百分数**（4.8 表示 4.8%） |
| `viewTime` | 任何平台有就读，保留 1 位小数（写成 avg_view_time），秒 |
| `punish` / `punishReason` | 有值就记「已下架」 |
| `publishStatus` | `published` → 已回填，`unknown` → 异常，其它 → 待回填 |
| `postTime` | 只取前 10 位当发布日期，所以必须是东八区本地时间 `YYYY-MM-DD HH:mm:ss` |
| `account` `title` `url` | 新建笔记时写进去；视频号不写 `url` |

backfill.py 不读：`uid`、`desc`、`cover`、`postType`、`postTypeCode`、`statusText`、`status`、`timing`、`fansDrop`、`view2s`、`view5s`、`fansViewRate`。

**`kinso-dashboard/refresh.py` 也读 `posts-*.json`**（取最新一份，按发布时间分期、算周数据），读这些字段：

| 字段 | 用途 |
|---|---|
| `platform` | 只认 `Bili`/`Douyin`/`XiaoHongShu`/`Channels`（`POST_PLATFORM`），别的平台的作品直接忽略 |
| `postTime` | `datetime.fromisoformat(p['postTime'])` 排序、分期、按周过滤。**不能是 `null` 或空串，否则整个脚本抛错**；格式 `YYYY-MM-DD HH:mm:ss` 能被 fromisoformat 解析 |
| `statusText` | `== '已发布'` 才算上线：算进播放、互动、涨粉；不是「已发布」的记为异常（`odd`），在看板上显示 `statusText` 原文。**所以 `statusText` 必须产出，已上线的作品必须正好是「已发布」** |
| `view` `like` `comment` `favorite` `forward` `fansAdd` | 播放、互动（前四个相加）、涨粉 |
| `title` `cover` `desc` | 看板上一期的标题、封面、副标题 |

四个平台映射出的 `statusText`（见各平台对照表）：

| 平台 | `statusText` 取值 |
|---|---|
| 抖音 | `status_value=102` →「已发布」；其它（如 144「不适宜公开」）→「状态未知」 |
| 小红书 | `audit_status=1` →「已发布」；其它 →「audit_status=<值>」 |
| B站 | `state=0` →「已发布」；`-6`、`-30` →「审核中」；`-40` →「定时发布」；其它 → `state_desc`，没有就「state=<值>」 |
| 视频号 | 一律「已发布」（post_list 只含已发表的）；仅自己可见的另外带 `punish: true`，backfill 记「已下架」，refresh.py 仍算上线（和小V猫一致） |

`postTime` 都来自发布时间字段，四个平台这次都没有 `null`。唯一会出空的情况是 **B站未发布的定时稿**：`Archive.ptime=0`。`06-works-bili.mjs` 已改成 `ptime` 为 0 时用定时时间 `dtime`，再没有就用投稿时间 `ctime`（`timing` 照填 `dtime`），翻页判断也跳过 `ptime=0` 的稿件。这次账号里没有定时稿，没实测到。

**`accounts-*.json` 不是 backfill.py 读的**，是 `kinso-dashboard/refresh.py` 的 `ingest_accounts` 读的：`uid`（必须和 refresh.py 里登记的一致才收）、`fans`、`updateTime`、`loginStatus`（不是「登录有效」就提示）、`daily[].date`、`daily[].fansTotal`（0 和 null 都当作没同步到）、`daily[].fansNet`。

refresh.py 登记的 uid：B站 `478358005`、抖音 `106707338905`、小红书 `5944af205e87e701889da649`、视频号 = `finderUser.uniqId`、**公众号 `3076192038`**。公众号这个 uid 不是 `gh_eb2c407bc687`（原始 ID），写 `accounts-*.json` 时必须用 `3076192038`，否则会被丢掉。公众号粉丝的读法归 S4，S3 衔接时按这个 uid 写。

下面的对照表里，「换算」一栏写的是麦田要做的处理；「← 无」表示平台拿不到，照写 `null`。

## 抖音（space 183）

### 读法

1. 先 `goto https://creator.douyin.com/creator-micro/content/manage`，在这个页面里 `page.fetch`。
2. 作品：`GET /janus/douyin/creator/pc/work_list?status=0&count=30&max_cursor=<游标>&scene=star_atlas&device_platform=android&aid=1128`。第一页游标 0，之后用响应里的 `max_cursor`，`has_more=false`、空页、或这一页最早的**非置顶**作品早于窗口就停。按发布时间倒序，但置顶作品排在第一页最前（这次是 2025-05-31 那条）。置顶字段是 `aweme_list[].is_pinned`：置顶时为 `true`，**非置顶时这个键不存在**（11-19 原始响应第一页 30 条：1 条 `true`，29 条没有这个键）。算「最早一条」时排除 `is_pinned === true`；一页全是置顶时不据此停，看 `has_more`。窗口过滤用 `create_time >= 窗口起点`，置顶的老作品自然被排除。样例 `samples/06-douyin-works.json` 的 `raw.work_list.aweme_list` 留了置顶、非置顶各一条。
3. 粉丝：`GET /web/api/media/user/info/` 的 `user.follower_count` 是实时总数；`GET /janus/douyin/creator/data/overview/dashboard/fans?recent_days=30` 是分日（到昨天为止）。两个都不用签名。
4. 坑：`items[].id` 超过 2^53，要先用正则把它改成字符串再 `JSON.parse`；作品 id 用 `aweme_list[].aweme_id`（本来就是字符串）。`metrics` 的值都是字符串。

近 30 天 14 条：`total=88` 是全部作品数，和作品管理页「作品 (88)」一致；作品管理页滚到底数出 2026-10-20 以后的发布日期也是 14 个（12 条「已发布」、2 条「不适宜公开」）。小V猫 11-18 导出里有两条 11-12 的作品（`status=144`），现在接口和页面上都没有了，应该是已经删掉。

### 作品字段对照

| 目标字段 | ← 抖音字段 | 换算 |
|---|---|---|
| postId | `aweme_list[].aweme_id` | 字符串 |
| uid | `user/info` 的 `user.uid` | 字符串，`106707338905` |
| platform / platformName | — | 常量 `Douyin` / `抖音` |
| account | `user/info` 的 `user.nickname` | |
| title | `aweme_list[].item_title` | 为空时取 `desc` 第一个 ` #` 之前 |
| desc | `aweme_list[].desc` | 原样（含话题） |
| cover | `aweme_list[].video.cover.url_list[0]` | 带签名、会过期（`x-expires`），只能当时用 |
| postType / postTypeCode | `aweme_list[].aweme_type` | 实测视频是 4 →「视频」/`"1"`；图文是 68 →「图文」/`"2"`（68 没实测到） |
| status | `aweme_list[].status_value` | 转字符串。见过 102（已发布）和 144（页面显示「不适宜公开」） |
| publishStatus / statusText | `status_value` | 102 → `published`/已发布；其它 → `unknown`/状态未知（与小V猫一致，backfill 记成「异常」） |
| postTime | `aweme_list[].create_time` | 秒 → 东八区 `YYYY-MM-DD HH:mm:ss` |
| timing | `create_time` 晚于现在 | 是定时作品时填同一个时间，否则 `null` |
| url | — | 拼 `https://www.douyin.com/video/${aweme_id}` |
| view | `statistics.play_count` | 与 `items[].metrics.view_count` 相同 |
| like | `statistics.digg_count` | |
| comment | `statistics.comment_count` | |
| favorite | `statistics.collect_count` | |
| forward | `statistics.share_count` | **不是** `forward_count`（恒为 0）。和小V猫 11 条逐条对上 |
| fansAdd / fansDrop | `items[].metrics.subscribe_count` / `unsubscribe_count` | 字符串 → 数字 |
| homeVisit | `items[].metrics.homepage_visit_count` | 字符串 → 数字 |
| fullView | `items[].metrics.completion_rate` | 0–1 小数字符串 → ×100 百分数（`0.047994` → 4.7994，页面显示 4.8%） |
| view2s | `items[].metrics.bounce_rate_2s` | ×100（页面「2秒跳出率 28.2%」）。字段名是小V猫起的，值是跳出率 |
| view5s | `items[].metrics.completion_rate_5s` | ×100 |
| viewTime | `items[].metrics.avg_view_second` | 秒，字符串 → 数字 |
| fansViewRate | `items[].metrics.fan_view_proportion` | ×100（`0.017424` → 1.74，小V猫 11-18 记 1.67） |
| show（小红书专有） | ← 无 | 抖音有 `items[].metrics.cover_show`（封面曝光），小V猫没给抖音填 `show`，backfill 也不读 |

`aweme_list` 和 `items` 按 `aweme_id` = `items[].id` 对应，这次 14/14 全部对上。

### 账号字段对照

| 目标字段 | ← 抖音 | 换算 |
|---|---|---|
| uid | `user/info` 的 `user.uid` | |
| loginStatus | `user/info` 的 `status_code` | 0 → 登录有效 |
| fans | `user/info` 的 `user.follower_count` | 实时；`dashboard/fans` 的 `total_fans_cnt.metric_value` 是昨天的数（294 对 295） |
| updateTime | 读取时间 | 东八区 |
| daily[].date | `dashboard/fans` 各 metric 的 `trends[].date_time` | `YYYYMMDD` → `YYYY-MM-DD` |
| daily[].fansTotal | `english_metric_name=total_fans_cnt` 的 `trends[].value` | |
| daily[].fansNet | `english_metric_name=net_fans_cnt` 的 `trends[].value` | 另有 `new_fans_cnt`（新增）、`cancel_fans_cnt`（取关） |

和小V猫 11-12 到 11-17 六天逐日对比：总数和净增全部相同。

## 小红书（space 184）

### 读法

1. 在 `creator.xiaohongshu.com` 任一页面上（脚本用笔记管理页）。
2. 作品：`GET /api/galaxy/creator/datacenter/note/analyze/list?post_begin_time=<毫秒>&post_end_time=<毫秒>&type=0&page_size=10&page_num=<n>`（数据看板「笔记数据」用的接口）。**直接 fetch 返回 406**，要带 `X-s`、`X-t` 两个请求头，值用页面自己的 `window._webmsxyw(path, undefined)` 现算（在 `page.evaluate` 里算、在页面里 fetch，签名不出页面）。`data.total` 是窗口内总数，按 `page_num` 翻到够数。
3. 状态和定时发布：`GET /api/galaxy/v2/creator/note/user/posted?tab=0&page=<n>`（笔记管理页的接口），同样要签名。page 从 0 起，响应的 `data.page` 是下一页。置顶笔记排在最前，判断「早于窗口」时跳过 `sticky=true`。
4. 粉丝：`GET /api/galaxy/creator/home/personal_info`（`data.fans_count`）、`GET /api/galaxy/creator/data/fans/overall_new`（`data.thirty`：30 天分日），`GET /api/galaxy/user/info`（`data.userId`）。这三个**不用签名**。
5. 时间窗用东八区 0 点的毫秒时间戳。页面「近 30 天」自己传的是 10-19 到 11-19，接口 total 都是 15。

近 30 天 15 条：数据看板「笔记数据」页筛选 2026-10-19 至 2026-11-19，分页栏「共 15 条，2 页」，和接口 `total=15` 一致。

### 作品字段对照

| 目标字段 | ← 小红书字段（analyze/list 的 `data.note_infos[]`，除非另注） | 换算 |
|---|---|---|
| postId | `id` | 24 位十六进制字符串 |
| uid | `user/info` 的 `data.userId` | `5944af205e87e701889da649` |
| platform / platformName | — | 常量 `XiaoHongShu` / `小红书` |
| account | `personal_info` 的 `data.name` | |
| title | `title` | |
| desc | ← 无 | 两个列表接口都没有正文。小V猫这里也是 `null` |
| cover | `cover_url` | 带图片处理参数，可去掉查询串 |
| postType / postTypeCode | `type` | 2 →「视频」/`"1"`，1 →「图文」/`"2"`（posted 接口里对应 `video` / `normal`） |
| status | `audit_status` | 转字符串。这次 15 条全是 1 |
| publishStatus / statusText | `audit_status`，加上 posted 的 `permission_code`/`permission_msg` | `audit_status=1` → `published`/已发布；其它 → `unknown`。posted 里 `permission_code≠0` 时是受限（这次全是 0） |
| postTime | `post_time` | **毫秒** → 东八区（接口有秒，小V猫只到分钟，`11:57:00`；backfill 只用日期，不影响） |
| timing | posted 的 `schedule_post_time` | 毫秒，0 表示不是定时；analyze 不含未发布的定时笔记 |
| url | — | 拼 `https://www.xiaohongshu.com/explore/${id}`。小V猫的 url 后面带 `xsec_token`。要带的话用 posted 的 `xsec_token`（**不要提交到仓库**）；不带 token 能不能打开没有测 |
| show | `imp_count` | 曝光 |
| view | `read_count` | 观看 |
| like | `like_count` | |
| comment | `comment_count` | |
| favorite | `fav_count` | |
| forward | `share_count` | |
| fansAdd | `increase_fans_count` | 页面「涨粉」 |
| viewTime | `view_time_avg` | 秒（整数，页面「人均观看时长 20s」） |
| fullView | ← 无 | 小红书数据看板没有完播率；小V猫也没给 |
| 其他可用 | `coverClickRate`（0–1，页面「封面点击率 27.20%」）、`danmaku_count` | 目标格式没有这两个字段 |

### 账号字段对照

| 目标字段 | ← 小红书 | 换算 |
|---|---|---|
| uid | `user/info` 的 `data.userId` | |
| loginStatus | `personal_info` 的 `code` | 0 → 登录有效 |
| fans | `personal_info` 的 `data.fans_count` | 和 `overall_new` 的 `thirty.fans_count` 相同 |
| daily[].date | `thirty.fans_list[].date` | 毫秒（东八区 0 点）→ `YYYY-MM-DD` |
| daily[].fansTotal | `thirty.fans_list[].count` | |
| daily[].fansNet | `thirty.rise_fans_list[].count − thirty.leave_fans_list[].count` | 同一天对减 |

和小V猫 11-12 到 11-16 逐日对比全部相同。小V猫 11-17 那天是 `fansTotal=0, fansNet=0`（没同步到），我们读到 2567、+11。

## B站（space 185）

### 读法

1. 在 `member.bilibili.com` 页面上 `page.fetch`（同源，带 cookie，不用 `w_rid`/`wts`）。
2. 稿件：`GET /x/web/archives?status=is_pubing,pubed,not_pubed&pn=<n>&ps=20&coop=1&interactive=1`，`data.arc_audits[]`（每项 `Archive` + `stat`），`data.class` 是各状态的总数。按 `ptime` 倒序，翻到早于窗口或翻完为止。
3. 单稿涨粉、平均播放进度：`GET /x/web/data/archive_diagnose/compare?size=30`（数据中心「近期稿件对比」），按 `bvid` 对应。size 30 一次给了全部 16 条；稿件更多时要确认它能不能翻页（这次没机会测）。
4. 粉丝：`GET /x/web/data/v2/fans/stat/num?period=1`（`all_fans` 当前总数，`follow`/`unfollow` 是 30 天累计）；`GET /x/web/data/v2/fans/stat/graph?type=all_fans&period=1`（30 天分日）。`period=0` 是 7 天、`period=1` 是 30 天。
5. 数据中心是 `member.bilibili.com/york/data-center-web` 的 iframe，要探查接口直接打开这个地址（在外层页面挂钩抓不到）。

近 30 天 16 条：稿件管理页「全部稿件 16 / 已发布 16」，接口 `class.pubed=16`、`archives` 16 条、`compare` 16 条，按 bvid 16/16 对上。

### 作品字段对照

| 目标字段 | ← B站字段 | 换算 |
|---|---|---|
| postId | `Archive.bvid` | |
| uid | `Archive.mid` | 转字符串，`478358005` |
| platform / platformName | — | 常量 `Bili` / `哔哩哔哩` |
| account | `api.bilibili.com/x/web-interface/nav` 的 `data.uname` | |
| title / desc / cover | `Archive.title` / `Archive.desc` / `Archive.cover` | |
| postType / postTypeCode | — | 常量「视频」/`"1"`（图文在另一个管理页，不在本接口） |
| status | `Archive.state` | 转字符串；0 =「开放浏览」 |
| publishStatus / statusText | `Archive.state` | 0 → `published`/已发布；-6、-30 → `reviewing`/审核中；-40 → `timing`/定时发布；其它 → `unknown`，`statusText` 用 `state_desc`（没有就 `state=<值>`）。这次只见到 0 |
| postTime | `Archive.ptime` | 秒 → 东八区。**未发布的定时稿 `ptime=0`**：改用 `dtime`，再没有用 `ctime`，不能输出 `null`（refresh.py 会抛错） |
| timing | `Archive.dtime` | 晚于现在时是定时发布时间，否则 `null` |
| url | — | 拼 `https://www.bilibili.com/video/${bvid}` |
| view | `stat.view` | 稿件管理页「播放」；数据中心的 `compare.stat.play` 和它不总是同一时刻的数 |
| like / comment / favorite / forward | `stat.like` / `stat.reply` / `stat.favorite` / `stat.share` | |
| coin / danmu | `stat.coin` / `stat.danmaku` | |
| fansAdd / fansDrop | `compare` 的 `stat.total_new_attention_cnt` / `stat.unfollow` | |
| viewTime | `compare` 的 `stat.full_play_ratio` × `Archive.duration` / 10000 | `avg_play_time` 恒为 0 不能用。`full_play_ratio` 是**平均播放进度**（万分比，页面「平均播放进度 38.6%」），乘时长就是平均观看秒数。小V猫的值与此相符（`BV1aasw6xEiB`：0.5801 × 59 s ≈ 34，小V猫记 35） |
| fullView | ← 无 | B站数据中心不给完播率；`full_play_ratio` 是播放进度不是完播率，**不要填进 fullView**（小V猫也没填）。脚本另输出 `playProgress` 备查 |

### 账号字段对照

| 目标字段 | ← B站 | 换算 |
|---|---|---|
| uid | `nav` 的 `data.mid` | |
| loginStatus | `nav` 的 `data.isLogin` | true → 登录有效 |
| fans | `fans/stat/num` 的 `data.all_fans` | |
| daily[].date | `fans/stat/graph` 的 `data.tendency[].date_key` | 秒（东八区 0 点）→ 日期 |
| daily[].fansTotal | `tendency[].total_inc` | 字段名像增量，**实际是当天总数**（最后一天 99，次日 `all_fans=101`） |
| daily[].fansNet | 相邻两天 `total_inc` 相减 | 第一天没有前一天，记 `null` |

和小V猫 11-12 到 11-16 逐日对比：净增全部相同；小V猫的 `fansTotal` 一直是 `null`，我们能补上（64、66、70、77、88）。

## 视频号（space 172）

### 读法

照 `local-tests/ego-backend/queries.mjs` 的 `channelsQuery`：

1. `POST /cgi-bin/mmfinderassistant-bin/auth/auth_data`（body `{timestamp, _log_finder_uin:"", _log_finder_id:"", rawKeyBuff:"", pluginSessionId:null, scene:7, reqScene:7}`），拿 `data.finderUser`：`finderUsername`、`uniqId`（视频号 ID）、`nickname`、`fansCount`、`feedsCount`。
2. 作品：`POST /micro/statistic/cgi-bin/mmfinderassistant-bin/statistic/post_list`，body `{pageSize, currentPage, sort:0, order:0, startTime:<秒>, endTime:<秒>, timestamp, _log_finder_id:<finderUsername>, …}`。`data.totalCount` 是窗口内总数。
3. 分日粉丝：同前缀 `statistic/fans_trend`，body `{startTs:"<秒>", endTs:"<秒>", interval:3, …}`，返回 `data.add/reduce/netAdd/total` 四个等长数组，第 i 个是 `startTs + i 天`。接口名从数据中心的前端包里找到（`/statistic/fans_trend`，页面在 wujie 微前端里，挂钩抓不到）。
4. 都不用签名，靠 cookie；`_log_finder_id` 必须是 finderUsername。用 `page.fetch` 发；`page.evaluate` 里连发几个请求会碰到 15 秒上限。

近 30 天 16 条：数据中心 → 视频数据 →「单篇视频」，日期范围选「近30天」，显示「共16条视频」；接口 `totalCount=16`。全部作品 `feedsCount=61`。

### 作品字段对照

| 目标字段 | ← 视频号字段（post_list 的 `data.list[]`） | 换算 |
|---|---|---|
| postId | `objectNonce` | **不是** `objectId`。小V猫用的是 `objectNonce`（3 条逐一对上）；已回填的笔记按它存 `post_id`，换成 objectId 会全部重复建。`objectId` 另存，单篇分日接口 `feed_aggreagate_data_by_tab_type` 要用它 |
| uid | `auth_data` 的 `finderUser.uniqId` | 视频号 ID（`sph` 开头）。**不是** finderUsername；refresh.py 也按 uniqId 登记 |
| platform / platformName | — | 常量 `Channels` / `视频号` |
| account | `finderUser.nickname` | |
| title | `desc.shortTitle[0].shortTitle` | 没有短标题时取 `desc.description` 第一行（小V猫的 title 就是短标题） |
| desc | `desc.description` | |
| cover | `desc.media[0].coverUrl` | 带 `token`，会过期，不要存进仓库 |
| postType / postTypeCode | — | 「视频」/`"1"`（`objectType=0`）；图文没见到 |
| status | `status` | 转字符串，这次全是 1 |
| publishStatus / statusText | — | 一律 `published`/已发布（post_list 只含已发表的）；仅自己可见的看 `punish` |
| punish / punishReason | `disableInfo.isDisabled` / `disableInfo.disableAddWording` | 只在 `isDisabled=true` 时输出。11-09 那条是 `visibleType=3`、「仅自己可见」，小V猫同一条是 `punish=true`，backfill 记成「已下架」 |
| postTime | `createTime` | 秒 → 东八区 |
| timing | ← 无 | post_list 只含已发表的 |
| url | `desc.media[0].url` | 视频文件地址，带 token、会过期；backfill 对视频号不写 url |
| view | `readCount` | 页面「播放」 |
| like | `favCount` | **字段名和含义是反的**：`favCount` 是 👍 点赞（页面表头 `#icon-thumb` 列），和小V猫一致 |
| love | `likeCount` | ♡ 推荐（表头 `#icon-heart` 列），backfill 写成 recommends |
| comment | `commentCount` | |
| forward | `forwardCount` | 页面「分享」；另有 `forwardAllChatCount`、`forwardSnsCount`（转发聊天和朋友圈） |
| favorite | ← 无 | 视频号没有收藏数；小V猫也没给 |
| fansAdd | `followCount` | 页面「关注」 |
| fullView | `fullPlayRate` | 0–1 → ×100（0.12963 → 12.963，页面「完播率 12.96%」） |
| viewTime | `avgPlayTimeSec` | 秒（页面「平均播放时长 20.20秒」） |

### 账号字段对照

| 目标字段 | ← 视频号 | 换算 |
|---|---|---|
| uid | `finderUser.uniqId` | |
| loginStatus | `auth_data` 的 `errCode=0` 且有 `finderUser` | |
| fans | `finderUser.fansCount` | 实时 |
| daily[].date | `startTs + i 天` | |
| daily[].fansTotal / fansNet | `fans_trend` 的 `total[i]` / `netAdd[i]` | 字符串或数字，转数字；另有 `add[i]`、`reduce[i]` |

和小V猫 11-12（288、+15）、11-13（294、+6）对上。窗口最后一个点是当天（416，等于 `fansCount`）。

## 给 S3 的注意事项

1. **id 体系**：视频号 postId 用 `objectNonce`，抖音用 `aweme_id`（字符串），B站用 `bvid`，小红书用 `id`。和小V猫一致，已有笔记能按 `post_id` 接上。
2. **单位**：`fullView` 一律产出百分数（抖音、视频号 ×100）；B站、小红书没有完播率，写 `null`，不要拿 B站的「平均播放进度」顶。`viewTime` 一律秒。
3. **时间**：`postTime` 一律东八区 `YYYY-MM-DD HH:mm:ss`，**不能为空**（refresh.py 直接 fromisoformat）；抖音、B站、视频号是秒，小红书是毫秒；B站定时稿 `ptime=0` 用 `dtime`。
4. **状态**：`statusText` 必须产出，已上线的必须正好是「已发布」（refresh.py 按它判上线）。
5. **签名**：只有小红书的两个作品列表接口要签名，用页面自带的 `_webmsxyw`，所以必须在已登录的创作者中心页面里跑，不能脱离浏览器。
6. **字段名反直觉的**：视频号 `favCount`=点赞、`likeCount`=推荐；B站 `total_inc`=当天总数、`full_play_ratio`=平均播放进度；抖音 `forward`←`share_count`。
7. **会过期的 URL**：抖音 cover、视频号 cover/url 都带签名或 token，只当时有效；小红书 url 小V猫带了 `xsec_token`。这些都不要写进仓库。
8. **限频**：这次每个平台只翻 1–2 页，间隔 2.5 秒，没遇到限流或风控提示。B站 compare 接口一次要 30 条就够，不用翻页。

## 不通过时的替代路线（只记录）

- 小红书 `_webmsxyw` 改名或失效：在数据看板页挂钩页面自己发的 `analyze/list`（只能拿到页面当前页），再在页面上点分页。
- 视频号前端换接口：从 `res.wx.qq.com/t/wx_fed/finder/helper/statistic/` 的前端包里找 `/statistic/` 开头的路径表（这次 `fans_trend` 就是这么找的）。
