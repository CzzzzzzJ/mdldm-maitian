# 02 用 ego-shim 跑插件 preflight

**判定：部分通过。**

- 2026-11-19 复测：插件有适配器的 7 个平台里，6 个已登录的（B站、小红书、抖音、视频号、YouTube、X）preflight 全部判为已登录，逐个跑和 7 个同时跑都一样，跑完每个 space 只剩自己的 `p1`。
- 未登录的判断：Instagram space（189）现在停在 Instagram 的账号安全验证页（`/auth_platform/challengepicker/`），算未登录。preflight 返回 `ok:false`，**判断是对的，但要等满 60 秒**，原因写的是「上传页 60 秒没打开（可能没登录或网络慢）」，调用方分不清是没登录还是网慢。原因是插件的 `LOGIN_URL` 正则（`login|passport|signin|accounts.google.com|/i/flow/login`）不认 Instagram 的验证页路径。这是「部分」的原因。
- 公众号、微博、知识站在插件里没有适配器（`lib/platforms/extra.js` 的 `adapters = {}`），不适用。知识站（193，原 190）也没有后台地址。
- 11-18 记的「抖音上传页等 `load` 超时」这次没有复现（不打补丁逐个跑 9.9 秒、同时跑 11.7 秒），但 `src/ego-shim.mjs:63` 还是 `await page.goto(url)`（默认等 `load`、15 秒超时），问题还在，只是这次页面加载得快。

## 怎么测

```sh
node spikes/platform/02-preflight.mjs serial      # 逐个平台，每个平台一个 runEgoTask 短进程
node spikes/platform/02-preflight.mjs parallel    # 7 个平台同时各起一个进程
node spikes/platform/02-preflight.mjs serial --patch-goto    # 对照实验：新页面的 goto 改成 waitUntil:'commit'（11-18 用过，这次没跑）
```

每个进程：runner 前言把 `globalThis.chrome` 设成 shim 的 chrome → `loadPlugin('lib/publish.js')` 的 `preflight([id], { keepTabs: false })` → 只有判定已登录时另开一页打开上传页只读结构，看完关掉。不填表、不调 `run`、不点按钮。原始输出在 `scratch/02-preflight-*.json`。

space 按名字找，11-19 的 space id：B站 185、小红书 184、抖音 183、视频号 172、YouTube 188、X 187、Instagram 189。

## 结果（2026-11-19，不打补丁）

| 插件 id | 登录状态（00 表） | preflight | preflight 用时：逐个 / 同时 | 进程总耗时：逐个 / 同时 | 上传页结构 |
|---|---|---|---|---|---|
| bilibili | 已登录 | `ok:true` | 7.8 s / 6.5 s | 24.6 s / 16.6 s | 无 shadow DOM；`input[type=file]` 在主文档；iframe：`message.bilibili.com`、`s1.hdslb.com` |
| xhs | 已登录 | `ok:true` | 5.8 s / 8.1 s | 15.5 s / 18.9 s | 无 shadow DOM；`input[type=file]` 在主文档；1 个 about:blank iframe |
| douyin | 已登录 | `ok:true` | 9.9 s / 11.7 s | 20.2 s / 21.9 s | 无 shadow DOM；`input[type=file]` 在主文档；5 个字节系 iframe（`lf-zt` ×2、`live`、`www.douyin.com`、`summon.bytedance.com`），上传控件不在里面 |
| channels | 已登录 | `ok:true` | 4.2 s / 6.3 s | 13.8 s / 16.6 s | **上传控件在 `wujie-app` 的 shadowRoot 里**，主文档没有 `input[type=file]`；1 个同域 iframe（wujie 的 JS 沙箱） |
| youtube | 已登录 | `ok:true` | 5.2 s / 6.1 s | 14.8 s / 16.6 s | `input[type=file]` 在主文档；有个 `plasmo-csui` shadow host（是浏览器扩展注入的，不是 YouTube 的）；5 个 iframe |
| x | 已登录 | `ok:true` | 3.5 s / 5.4 s | 13.3 s / 16.0 s | 无 shadow DOM；`input[type=file]` 在主文档 |
| instagram | 未登录（安全验证页） | `ok:false`，「上传页 60 秒没打开（可能没登录或网络慢）」 | 61.7 s / 64.2 s | 62.9 s / 65.5 s | 没看（只在已登录时看） |

- 同时跑总耗时 65.5 秒，等于最慢的 Instagram；其余 6 个都在 22 秒内跑完，互不干扰。不算 Instagram，同时跑比逐个跑（合计约 102 秒）快得多，说明各 space 的进程确实并发。
- 已登录平台跑完后，`task.tabs()` 每个 space 只剩 `p1`。
- Instagram：两次跑完时 `tabsAfter` 里都多一个 instagram 页面（逐个跑是 `p2`，同时跑是 `p3`）。插件 `preflight` 在 `keepTabs:false` 时调 `chrome.tabs.remove` 但**故意不等它完成**（注释：有「离开此网站？」弹窗时会挂住），所以紧接着列 tab 还能看到。进程退出后再列，只剩 `p1`，页面已经关掉了，不是残留。

## 发现的问题（交给 dev-1 / ego-shim 或插件 fork，不在我的文件范围，没改）

1. **Instagram 未登录要等 60 秒才判出来，原因也不明确。** 插件 `lib/publish.js:87` 的 `LOGIN_URL` 不含 Instagram 的 `/auth_platform/`、`/challenge` 路径，轮询一直等到 60 秒超时。建议把这两个路径加进 `LOGIN_URL`，或给 instagram 适配器加 `loggedIn` 检查（有没有 `input[name=username]` 或「Continue / Use another profile」）。
2. **调用方要知道 preflight 关页面是异步的**：返回后立刻列 tab 会看到还没关掉的页面，不要据此判成残留。
3. **`tabs.create` 等 `load`**（11-18 的问题 1）：`src/ego-shim.mjs:63` 建议改成 `page.goto(url, { waitUntil: 'commit', timeout: 30000 })`。这次没复现，不代表修好了。
4. **runner 拒绝接管时 `reason` 只是 `exit-code`**（11-18 的问题 2）：这次所有 space 都在 agent 手里，没触发，建议不变。
5. 公众号、微博、知识站没有插件适配器。

## 不通过时的替代路线（只记录）

- 未登录判断慢：调用方先跑 `spaces.mjs` 那套登录检查（各平台接口，1–6 秒），未登录的平台不进 preflight。
- `tabs.create` 超时：任务脚本前言里包一层 `task.newPage`，把 goto 默认改成 `commit`（`--patch-goto` 的做法）。
