# 00 Profile 5 平台 space 与登录状态（2026-11-18）

**判定：通过（10 个 space 已建好、可重复跑）。登录状态：2 个已登录，7 个等扫码，1 个不确定。**

## 怎么测

```sh
spikes/platform/run.sh spikes/platform/spaces.mjs                          # 建或复用 space，打开后台首页，判断登录
spikes/platform/run.sh spikes/platform/spaces.mjs '{"only":["Douyin"]}'    # 只跑部分平台
spikes/platform/run.sh spikes/platform/spaces.mjs '{"handoff":true,"only":[...]}'  # 未登录的打开登录页并 handOff()
```

- `run.sh` 在脚本前面加两个全局变量（`SPIKE_ROOT`、`ARGS`），再交给 `ego-browser nodejs`。ego 的 Node 进程读不到 shell 的 cwd 和环境变量。
- 幂等：先 `listTaskSpaces()` 按名字找，有就 `taskSpace(id)` 复用，没有才 `taskSpace(name, { profileId: "Profile 5" })`。第二次跑全部显示 `created: false`，space 数量不变。
- 同名 space 如果不在 Profile 5，脚本会抛错，不会去用它。交给用户的 space（`agentDelegatedToUser`）不会被抢回；复测脚本要加 `{"takeOver":true}` 才会收回。
- 没有调用 `finish()`。这些 space 是长期的，每个 space 的 `p1` 都留着。
- 打开页面时用 `waitUntil: "commit"`，再固定等 6 秒。抖音后台是长轮询 SPA，等 `domcontentloaded` 会 30 秒超时（第一次跑就是这么失败的）。

## space 表

| platformCode | spaceName | spaceId | 登录状态 | 当前控制方 | 证据 |
|---|---|---|---|---|---|
| Douyin | kinso/Douyin/106707338905 | 66 | 已登录 | agent | `GET /web/api/media/user/info/` http 200，`status_code=0`，`user.uid` 与登记一致 |
| XiaoHongShu | kinso/XiaoHongShu/5944af205e87e701889da649 | 67 | 未登录 → 等扫码 | 用户（handOff） | `GET /api/galaxy/creator/home/personal_info` http 401，`code=-1`；页面跳到 `/login?redirectReason=401` |
| Bili | kinso/Bili/478358005 | 68 | 未登录 → 等扫码 | 用户（handOff） | `GET api.bilibili.com/x/web-interface/nav`（credentials: include）`code=-101`，`isLogin=false` |
| GongZhongHao | kinso/GongZhongHao/gh_eb2c407bc687 | 69 | 未登录 → 等扫码 | 用户（handOff） | 打开 `mp.weixin.qq.com` 后落地 URL 不带 `token` 参数 |
| Weibo | kinso/Weibo/2272770294 | 73 | 未登录 → 等扫码 | 用户（handOff） | 跳到 `weibo.com/newlogin`；`/ajax/profile/info` 能返回 `ok=1`，但未登录也能返回，所以不能单靠它判断 |
| Channels | kinso/Channels/pending | 80 | 未登录 → 等扫码 | 用户（handOff） | `POST /cgi-bin/mmfinderassistant-bin/auth/auth_data` 返回 `errCode=300330`，没有 `finderUser`；页面在 `/login.html` |
| X | kinso/X/pending | 90 | 已登录 | agent | `/home` 侧栏有账号按钮，handle 为 `@kinsolee79`（uid 待登记） |
| YouTube | kinso/YouTube/pending | 91 | 未登录 → 等扫码 | 用户（handOff） | `studio.youtube.com` 跳到 `accounts.google.com/v3/signin/accountchooser` |
| Instagram | kinso/Instagram/pending | 92 | 未登录 → 等扫码 | 用户（handOff） | 页面显示「Continue / Use another profile」，会话已过期，只记住了账号。没有点 Continue |
| Zhishi | kinso/Zhishi/pending | 101 | 不确定 | agent | 麦田 `config.json` 没配置 `site.admin`（知识站后台地址），只建了 space，没打开页面 |

所有 space 都在 Profile 5（`listTaskSpaces()` 返回的 `profileId` 字段）。没有用 Profile 6，没有建 profile，没有碰别人的 space（63、64 是原来就有的测试 space）。

## 需要负责人扫码

在 Ego Lite 里切到对应的 space（已经停在登录页，控制权在你手上）扫码登录：

- 小红书（67）
- B站（68）
- 公众号（69）
- 微博（73）
- 视频号（80）
- YouTube（91）
- Instagram（92）

另外，知识站（101）需要先在 `config.json` 里配置 `site.admin`，或者告诉我后台地址。

扫完码后复测登录：`spikes/platform/run.sh spikes/platform/spaces.mjs`。交给用户的 space 会显示 `awaiting_user`；要收回控制，在复测脚本里加 `{"takeOver":true}`（见 05/06/07）。

## 观察

- Profile 5 的国内平台大多没有登录态。PLAN §2.2 假设这些账号已经登在 Ego Lite 里，实际只有抖音和 X 在 Profile 5 里登录。
- 视频号和公众号没登录时，cookie 已经分在不同域名下，见 05。
- 微博的 `/ajax/profile/info?uid=` 不能用来判断登录（未登录也返回 `ok=1`）。改用两个信号：落地 URL 是否跳到 `newlogin`/`passport`，以及页面配置里有没有自己的 uid。
