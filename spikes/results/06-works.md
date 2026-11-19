# 06 抖音、小红书作品列表和扩展字段的来源

| 平台 | 判定 |
|---|---|
| 抖音 | **通过**：一个接口就能拿到近 30 条作品和全部扩展字段，按游标分页 |
| 小红书 | **等扫码**：space 67 未登录；探针已写好，扫码后直接跑 |

## 抖音

### 怎么测

```sh
spikes/platform/run.sh spikes/platform/06-works-douyin.mjs
```

脚本在 space 66 里先 `goto https://creator.douyin.com/creator-micro/content/manage`（同站），再用 `page.fetch` 请求作品列表，只翻 2 页，两次请求间隔 2.5 秒。原始响应存在 `scratch/06-douyin-worklist-*.json`（已 gitignore）。

接口的参数是从页面自己的 `/goofy/douyin_creator_pc/mono/prefetch/creator_content/manage/prefetch.json` 读出来的，见下文。挂钩页面请求的探查用的是一次性脚本 `scratch/discover.mjs`，没有提交。

### 作品列表接口

`GET /janus/douyin/creator/pc/work_list?status=0&count=30&max_cursor=<游标>&scene=star_atlas&device_platform=android&aid=1128`

- **不用签名**，在作品管理页上直接 `page.fetch` 就能拿到，http 200，`status_code=0`。
- 第 1 页 30 条（`total=88`），`has_more=true`。用返回的 `max_cursor` 请求第 2 页，又拿到 30 条，和第 1 页没有重复。分页确认可用。
- MECHANICS.md 推断的参数是 `status=0&count=30&max_cursor=0`，大体对。页面自己还会带 `scene=star_atlas&device_platform=android&aid=1128`，我们照抄。
- 响应里有两份并行的数组：
  - `aweme_list[]`：作品本体，含实时计数 `statistics`、状态 `status`。
  - `items[]`：同一批作品的指标，含 `metrics`、`review`。
  - 两者按 `aweme_list[].aweme_id` 和 `items[].id` 对应，30/30 全部对上。
- **坑**：`items[].id` 是超过 2^53 的数字，直接 `JSON.parse` 会丢精度（`7510302804091669771` 会变成 `7510302804091670000`）。脚本先用正则把它改成字符串再解析。作品 id 一律用 `aweme_list[].aweme_id`，它本来就是字符串。
- `metrics` 的值都是字符串，例如 `"0.045822"`，要转成数字。
- `items[].metrics_offline_update_time`：近期作品是 null，老作品是 2025-08 到 2025-09 的日期。但这 30 条的 `metrics.view_count/like_count/favorite_count` 和 `statistics` 的实时值完全相等，所以指标是随列表实时给的，这个时间只是离线回填的标记。

### 字段映射（对照 GROUNDING.md「下游依赖的数据契约」）

| vcat 字段 → 笔记字段 | 抖音字段 | 来源 |
|---|---|---|
| 作品 id | `aweme_list[].aweme_id` | work_list |
| `title` | `aweme_list[].item_title`，为空时用 `desc` | work_list |
| `postTime` | `aweme_list[].create_time`（秒） | work_list |
| `url` | `https://www.douyin.com/video/${aweme_id}`（拼出来） | — |
| `view` → views | `aweme_list[].statistics.play_count`（与 `items[].metrics.view_count` 相同） | work_list |
| `like` → likes | `statistics.digg_count` | work_list |
| `comment` → comments | `statistics.comment_count` | work_list |
| `forward` → shares | `statistics.share_count`（`forward_count` 一直是 0，不用它） | work_list |
| `favorite` → favorites | `statistics.collect_count` | work_list |
| `fansAdd` → new_followers | `items[].metrics.subscribe_count`（另有 `unsubscribe_count`） | work_list |
| `homeVisit` → home_visits | `items[].metrics.homepage_visit_count` | work_list |
| `fullView` → full_view_rate | `items[].metrics.completion_rate`，0–1 小数，例如 `0.045822`。另有 `completion_rate_5s` | work_list |
| `viewTime` → avg_view_time | `items[].metrics.avg_view_second`（秒）。另有 `avg_view_proportion` | work_list |
| `show` → exposure（小红书专有） | 抖音有 `items[].metrics.cover_show`（封面曝光），契约里没有这个字段，暂不映射 | work_list |
| `publishStatus` / `punish` | `aweme_list[].status`：`in_reviewing`、`is_private`、`self_see`、`is_prohibited`、`is_delete`；`aweme_list[].status_value`；`items[].review.status` | work_list |
| 定时发布 | `create_time` 晚于当前时间（插件 `douyin.js` 的 `links.collect` 就是这么判断的） | work_list |

`metrics` 里还有一些现在用不上的字段：`bounce_rate_2s`、`like_rate`、`comment_rate`、`share_rate`、`favorite_rate`、`subscribe_rate`、`fan_view_proportion`、`danmaku_count`、`dislike_count`、`download_count`。

状态值的实际观察：

- 29 条是 `status_value=102`，所有 `self_see=false`。
- 1 条是 `status_value=144`，`self_see=true`、`allow_share=false`、`reviewed=true`、播放 0。这一条是 2026-11-16 发的「Grok Bot 怎么用…」，看起来是「仅自己可见」或被限流。
- `items[].review.status` 30 条全是 2，区分不了状态。
- 所以 `publishStatus` 要靠 `status` 里的布尔值和 `status_value` 判断。102、144 以外的取值还没见过，建议遇到未知值记成 `unknown`。

### 脱敏样例（自己的作品，id 是公开的）

```json
{"postId":"7708984451971452170","title":"Claude又送了一张重置卡，昨天开的新","postTime":"2026-11-17T03:56:57.000Z",
 "url":"https://www.douyin.com/video/7708984451971452170","view":4708,"like":29,"comment":13,"forward":0,"favorite":10,
 "fansAdd":"2","homeVisit":"0","fullView":"0.045822","viewTime":"13.766402","coverShow":"40","bounce2s":"0.283420",
 "review":2,"inReviewing":false,"isPrivate":false,"prohibited":false}
```

### 没找到或没确认的

- 作品级的「单条涨粉」在 `subscribe_count` 里。和数据中心「作品分析」页的数字是否一致，没有对照。
- 视频号、B站的分日曲线不在本项范围。抖音单条的分日数据没有查。

## 小红书

**等扫码。** 打开 `/new/home` 时，`personal_info` 返回 401、`code=-1`，页面跳到 `/login`。

扫码后运行：

```sh
spikes/platform/run.sh spikes/platform/06-works-xhs.mjs '{"takeOver":true}'
```

脚本做三件事：

1. 在 `/new/note-manager` 挂钩页面自己发的请求。`X-s` 签名由页面生成，我们只抄回 JSON，并列出含 note/view/like/collect/fans/imp 等词的键名。
2. 直接 `page.fetch` MECHANICS 里的两个接口：`/api/galaxy/v2/creator/note/user/posted?tab=0&page=0` 和 `/api/galaxy/creator/data/note_stats/new?page=1&page_size=30&sort_by=time`，看不带签名能不能拿到数据。
3. 读笔记卡片 `.note-card` 的 `data-impression` 里的 noteId 和 `.note-card__stat`，这是麦田 `metrics.mjs` 现有的读法。

字段映射要等这一轮的输出出来再填，这里不猜。已知的缺口：小V猫的小红书涨粉也是 `-1`（GROUNDING「已知字段缺口」）。

不通过时的替代路线（只记录）：挂钩没抓到列表接口时，读笔记管理页 Vue 组件上的数据；再不行就退回 MECHANICS 说的页面文本提取。
