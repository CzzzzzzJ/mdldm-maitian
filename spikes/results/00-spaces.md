# 00 Profile 5 平台 space 与登录状态（2026-11-19 更新）

**判定：通过。** 10 个「平台×账号」space 都在 Profile 5，可以按名字重复找到；8 个已登录，Instagram 未登录（停在账号安全验证页），知识站没有后台地址。

## 怎么测

```sh
spikes/platform/run.sh spikes/platform/spaces.mjs                          # 建或复用 space，打开后台首页，判断登录
spikes/platform/run.sh spikes/platform/spaces.mjs '{"only":["Douyin"]}'    # 只跑部分平台
spikes/platform/run.sh spikes/platform/spaces.mjs '{"handoff":true,"only":[...]}'  # 未登录的打开登录页并 handOff()
```

- `run.sh` 在脚本前面加两个全局变量（`SPIKE_ROOT`、`ARGS`），再交给 `ego-browser nodejs`。ego 的 Node 进程读不到 shell 的 cwd 和环境变量。
- 幂等：先 `listTaskSpaces()` 按名字找，有就 `taskSpace(id)` 复用，没有才 `taskSpace(name, { profileId: "Profile 5" })`。
- 同名 space 如果不在 Profile 5，脚本会抛错。交给用户的 space（`agentDelegatedToUser`）不会被抢回；复测脚本要加 `{"takeOver":true}` 才会收回。
- 不调用 `finish()`，这些 space 是长期的。
- 打开页面用 `waitUntil: "commit"` 再固定等 6 秒（抖音后台等 `domcontentloaded` 会超时）。
- 11-19 改了小红书的 uid 判断：`personal_info` 里没有 userId，改读 `/api/galaxy/user/info` 的 `data.userId`，现在能判「一致」。

## space 表（2026-11-19 15:00 左右）

| platformCode | spaceName | spaceId | 登录状态 | 证据 |
|---|---|---|---|---|
| Douyin | kinso/Douyin/106707338905 | 183 | 已登录，uid 一致 | `GET /web/api/media/user/info/` http 200，`status_code=0` |
| XiaoHongShu | kinso/XiaoHongShu/5944af205e87e701889da649 | 184 | 已登录，uid 一致 | `personal_info` `code=0`；`user/info` 的 `userId` 与登记一致 |
| Bili | kinso/Bili/478358005 | 185 | 已登录，uid 一致 | `api.bilibili.com/x/web-interface/nav` `code=0`、`isLogin=true`、`mid` 一致 |
| GongZhongHao | kinso/GongZhongHao/gh_eb2c407bc687 | **191**（原 170） | 已登录 | 05 时间线里 `/cgi-bin/home?...&f=json` 的 `base_resp.ret=0`，落地 URL 带 token |
| Weibo | kinso/Weibo/2272770294 | **192**（原 186） | 已登录，uid 一致 | 落地 `weibo.com`，页面配置里自己的 uid 与登记一致 |
| Channels | kinso/Channels/pending | 172 | 已登录 | `auth_data` `errCode=0`，有 `finderUser`。名字里的 uid 还是 `pending`；下游认的视频号 uid 是 `finderUser.uniqId`（见 06） |
| X | kinso/X/pending | 187 | 已登录 | `/home` 侧栏账号按钮，handle `@kinsolee79` |
| YouTube | kinso/YouTube/pending | 188 | 已登录 | `studio.youtube.com` 落地到 `/channel/<UC…>` |
| Instagram | kinso/Instagram/pending | 189 | **未登录** | 页面停在 `instagram.com/auth_platform/challengepicker/`（账号安全验证），既没有登录表单也没有侧栏头像，脚本判 `unknown` |
| Zhishi | kinso/Zhishi/pending | **193**（原 190） | 不适用 | 麦田 `config.json` 没配 `site.admin`，只建了 space |

所有 space 都在 Profile 5，没有用 Profile 6，没有建 profile。165 是用户自己的 space，没碰。

## 观察

- **space id 会变。** 11-18 的 66–101 到 11-19 早上已经不在，协调者重建成 170–190。11-19 下午 Orca 重启前后，170（公众号）、186（微博）、190（知识站）又不见了，脚本按名字重建成 191、192、193。消失的这三个都是当天没被脚本用过的 space，用过的（172、183–189）都还在。原因没确认（可能是 Ego 回收闲置 space）。**S3 要按名字找 space，不能写死 id**；登录态是 profile 级的 cookie，重建 space 不用重新扫码（191 新建后公众号直接就是已登录）。
- 小红书创作者中心和主站 `www.xiaohongshu.com` 共用登录态，同一个 space 两边都能用（07 的评论和私信在主站）。
- 微博 `/ajax/profile/info?uid=` 不能单独判断登录（未登录也返回 `ok=1`），要结合落地 URL 和页面配置里的自己 uid。

## 需要负责人处理

- **Instagram（189）**：账号停在 Instagram 的安全验证页（challengepicker），要本人在 Ego Lite 里切到这个 space 完成验证或重新登录。我没有动它。
- 知识站（193）：要在 `config.json` 配 `site.admin`，或告诉我后台地址。
