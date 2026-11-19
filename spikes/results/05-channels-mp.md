# 05 视频号与公众号同 profile 是否互踢

**判定：等扫码。** 视频号（space 80）和公众号（space 69）在 Profile 5 里都没有登录，互踢判断不了。扫码前已经能看到的 cookie 分布写在下面，作为参考。

## 怎么测

```sh
spikes/platform/run.sh spikes/platform/05-channels-mp.mjs                      # space 在 agent 手里时
spikes/platform/run.sh spikes/platform/05-channels-mp.mjs '{"takeOver":true}'  # 扫码后：收回交给用户的两个 space 再测
spikes/platform/run.sh spikes/platform/05-channels-mp.mjs '{"takeOver":true,"waitMin":1}'  # 间隔改 1 分钟，先快速看一遍
```

步骤：

1. 读视频号 `POST /cgi-bin/mmfinderassistant-bin/auth/auth_data`，`errCode=0` 且有 `finderUser` 算已登录。
2. 打开公众号首页，看落地 URL 有没有 `token`，再读 `/cgi-bin/home?t=home/index&token=…&f=json`，看 `base_resp.ret`。
3. 再读一次视频号。
4. 两边都已登录时，等 `waitMin` 分钟（默认 10）后，两边各读一次（公众号会重新打开首页）。

最后用 `Network.getCookies` 列出两边 cookie 的 name、domain、path，只取这三项，不取值。时间线全部登录就判「通过」，有一次掉线就判「不通过」，一开始就有一边没登录就判「等扫码」。原始输出在 `scratch/05-channels-mp-*.json`。

## 这次的证据（2026-11-18 10:29，两边都未登录）

| 步骤 | 结果 |
|---|---|
| 1 视频号 | http 200，`errCode=300330`，页面 `/login.html` |
| 2 公众号 | 落地 `/`，URL 不带 token |
| 3 视频号（打开公众号后） | `errCode=300330` |

cookie 分布（只有名字）：

- 公众号的登录类 cookie（`wxuin`、`xid`、`wxtokenkey`、`poc_sid`、`uuid`、`ua_id`、`oauth_uuid` 等）都是 `mp.weixin.qq.com` 的 host-only cookie。
- 视频号未登录，`channels.weixin.qq.com` 下还没有自己的 cookie。
- 两边同名同 domain 的只有 `.qq.com` 下的统计和指纹类 cookie：`_qimei_fingerprint`、`_qimei_uuid42`、`RK`、`ptcz`、`qlogin_uid`、`_clck`。
- 没有 domain 为 `.weixin.qq.com` 的 cookie，也就是说没有挂在父域名上、两边共用的 cookie。

**初步看法（未验证）**：公众号的会话 cookie 只属于 `mp.weixin.qq.com`。如果视频号登录后，会话 cookie 也只属于 `channels.weixin.qq.com`，两边就不会互相覆盖。`.qq.com` 上的共用 cookie 是统计类的，不像会话凭据。互踢还可能发生在服务端（同一个微信号扫两个后台），这一点只能扫码后按上面的时间线实测。

## 扫码后怎么复测

1. 在 Ego Lite 里分别对 space 80（视频号）和 69（公众号）扫码登录。
2. 运行 `spikes/platform/run.sh spikes/platform/05-channels-mp.mjs '{"takeOver":true}'`，大约 11 分钟跑完。
3. 看输出的 `verdict` 和 `timeline`，有一次 `loggedIn: false` 就算会互踢。

## 不通过时的替代路线（只记录）

按 PLAN §2.2：请 Kinso 在 Ego Lite 里另建一个 profile 专门放公众号，`kinso/GongZhongHao/gh_eb2c407bc687` 改在那个 profile 下重建。脚本不建 profile。
