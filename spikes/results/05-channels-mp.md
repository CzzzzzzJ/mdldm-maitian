# 05 视频号与公众号同 profile 是否互踢

**判定：通过（不互踢）。** 2026-11-19 在 Profile 5 里，视频号（space 172）和公众号（space 191）同时登录、交替刷新、读接口 35.6 分钟，共 3 + 22 次检查全部在线。期间在 Ego 默认 profile 的普通窗口里各打开了一次视频号助手和公众号后台，前后都没有一边掉线。

## 怎么测

```sh
spikes/platform/run.sh spikes/platform/05-channels-mp.mjs '{"minutes":35,"everySec":180}'   # 长时间线（本次）
spikes/platform/run.sh spikes/platform/05-channels-mp.mjs                                   # 短时间线：开头 3 步 + 隔 waitMin 分钟各读一次
```

- 判定登录：视频号 `POST /cgi-bin/mmfinderassistant-bin/auth/auth_data` 返回 `errCode=0` 且有 `finderUser`；公众号打开首页后落地 URL 带 `token`，并且 `/cgi-bin/home?t=home/index&token=…&f=json` 的 `base_resp.ret=0`。
- 开头 3 步：读视频号 → 打开公众号首页读 → 再读视频号。
- 之后每 180 秒一轮，奇数轮刷新视频号页面、只读公众号接口，偶数轮反过来（公众号重新打开首页），一直到满 35 分钟。
- 每轮结果追加到 `scratch/05-progress.jsonl`（第一次跑被 Orca 重启杀掉，什么都没留下，所以加了这一步）；完整输出在 `scratch/05-channels-mp-2026-11-19T07-25-54-131Z.json`。
- 最后用 `Network.getCookies` 列两边 cookie 的 name/domain/path，不取值。

## 时间线（东八区）

| 时间 | 步骤 | 视频号 | 公众号 |
|---|---|---|---|
| 14:50:00 | 1 读视频号 | `errCode=0` | — |
| 14:50:12 | 2 打开公众号首页 | — | 带 token，`ret=0` |
| 14:50:16 | 3 再读视频号 | `errCode=0` | — |
| 14:53:27 | r1（刷新视频号） | 在线 | 在线 |
| 14:56:42 | r2（重开公众号首页） | 在线 | 在线 |
| **14:58:35** | **普通窗口**：`open -a "ego lite"` 打开 `channels.weixin.qq.com/platform` 和 `mp.weixin.qq.com`（默认 profile = Profile 5，新开标签，不在任何 space 里） | 视频号助手标签打开 | 公众号落地 `/cgi-bin/home?…&token=…`，已登录（截图确认） |
| 14:59:53 | r3 | 在线 | 在线 |
| 15:03 – 15:22 | r4 – r10，每 3 分钟一轮 | 全部在线（`errCode=0`） | 全部在线（`ret=0`） |
| 15:25:54 | r11（35.6 分钟） | 在线 | 在线 |

另：14:37 在被杀掉的第一次时间线里也在普通窗口开过一次，那次公众号首页显示已登录（「炤见AI出海」），视频号助手标签正常打开。

## cookie 分布（只看名字）

- 视频号的会话 cookie `sessionid`、`wxuin` 是 `channels.weixin.qq.com` 的 host-only cookie。
- 公众号的会话类 cookie 都在 `mp.weixin.qq.com`（host-only）。
- 两边同名同 domain 的只有 `.qq.com` 下的统计和指纹类：`RK`、`ptcz`、`qlogin_uid`、`_qimei_fingerprint`、`_qimei_uuid42`、`_clck`、`_clsk`。
- 没有挂在 `.weixin.qq.com` 父域上、两边共用的 cookie。

所以两边的登录态在浏览器里互不覆盖；同一个微信号扫两个后台在服务端也没有互踢（35 分钟、普通窗口再开一次都没掉）。

## 局限

- 只测了 35 分钟。更长时间（比如一夜）没测；08 长进程那 126 分钟是别的平台。
- 两个后台是同一个微信号扫的。不同微信号的情况没测，也不是我们的用法。

## 不通过时的替代路线（只记录）

按 PLAN §2.2：请 Kinso 在 Ego Lite 里另建一个 profile 专门放公众号。这次不需要。
