# 02 用 ego-shim 跑插件 preflight

**判定：部分通过。**

- 抖音、X 两个已登录的 space：preflight 正确判断为已登录，跑完上传页关掉，没有留下多余页面。
- 抖音在不打补丁时**时好时坏**，原因是 ego-shim 的 `tabs.create` 会等 `load`，抖音上传页经常 15 秒内等不到，详见下文。
- 其余 5 个有适配器的平台，space 正交给负责人扫码，runner 按规则拒绝接管：**等扫码**。
- 公众号、微博、知识站在插件里没有适配器，不适用。

## 怎么测

```sh
git merge t3/s0-ego-shim-validation     # 77495e2，拿到 src/ego-shim.mjs 和 src/ego-runner/
node spikes/platform/02-preflight.mjs serial                 # 逐个平台，每个平台一个 runEgoTask 短进程
node spikes/platform/02-preflight.mjs parallel               # 7 个平台同时各起一个进程
node spikes/platform/02-preflight.mjs serial --patch-goto    # 对照实验：在脚本里把新页面的 goto 改成 waitUntil:'commit'
```

每个进程里依次做三件事：

1. runner 前言把 `globalThis.chrome` 设成 shim 的 chrome。
2. 跑 `loadPlugin('lib/publish.js')` 的 `preflight([id], { keepTabs: false })`。不填任何东西，不调 `run`，不点按钮。
3. 只有 preflight 判定为已登录时，另开一页打开 `ADAPTERS[id].url`，只读页面结构：有没有 iframe、shadow host、`input[type=file]` 在哪。看完关掉这一页。

原始输出在 `scratch/02-preflight-*.json`。

## 平台对照

插件的 ORDER 是 bilibili、xhs、douyin、channels、youtube、x、instagram。`lib/platforms/extra.js` 的 `adapters = {}` 是空的，所以 GongZhongHao、Weibo、Zhishi 都**对不上适配器**，没有跑。

| 插件 id | space | 00 表登录状态 | preflight 结果 | 判定对不对 | 上传页结构 | 单独跑耗时（preflight 内 / 进程总计） |
|---|---|---|---|---|---|---|
| douyin | kinso/Douyin/106707338905 | 已登录 | 不打补丁：第 1 次（逐个跑）**失败**，见问题 1；第 2 次（并发跑）`ok:true`，用时 16.3 s。打补丁：两次都 `ok:true`，9–13 s | 对（成功时） | 没有 shadow DOM；`input[type=file]` 在主文档里；页面里有 4 个字节系 iframe（`lf-zt.douyin.com` ×2、`live.douyin.com`、`www.douyin.com`，存储桥和登录桥），上传控件不在里面 | 9–16 s / 18–25 s |
| x | kinso/X/pending | 已登录 | `ok:true`，`secs` 1–2 | 对 | 没有 shadow DOM；`input[type=file]` 在主文档里；有 1 个 about:blank iframe | 2.6–3.8 s / 11–13 s |
| bilibili | kinso/Bili/478358005 | 等扫码 | runner 拒绝：`space … 现在由用户控制（ownership=agentDelegatedToUser），不接管` | — | — | 0.2 s |
| xhs | kinso/XiaoHongShu/5944af205e87e701889da649 | 等扫码 | 同上 | — | — | 0.2 s |
| channels | kinso/Channels/pending | 等扫码 | 同上 | — | — | 0.2 s |
| youtube | kinso/YouTube/pending | 等扫码 | 同上 | — | — | 0.2 s |
| instagram | kinso/Instagram/pending | 等扫码 | 同上 | — | — | 0.2 s |

preflight 返回值本身没有敏感信息，形如 `{ ok, reason, tabId, secs }`。进程总耗时比 preflight 本身多出约 8 秒，这是结构检查那一页固定等的 8 秒，再加上 ego-browser nodejs 起进程的时间。

**未登录判断还没验证。** 5 个未登录的 space 正交给用户扫码，runner 不接管，所以这次没测到 preflight 遇到未登录时能不能判对。需要两边对照时，可以等某个平台扫码前先收回，或者扫码后先登出再测。这两样都要负责人决定，我没做。

## 同时跑

| 模式 | 总耗时 | 抖音 | X | 互相干扰 |
|---|---|---|---|---|
| 不打补丁 | 25.5 s | `ok`，preflight 16.3 s | `ok`，3.8 s | 没有 |
| 打补丁 | 18.2 s | `ok`，9.1 s | `ok`，2.6 s | 没有 |

- 总耗时等于最慢的那个平台，说明不同 space 的进程确实是并发跑的。
- 跑完后每个 space 只剩自己原来的 `p1`，没有页面串到别的 space。
- 5 个被拒绝的进程在 0.25 s 内退出，不影响另外两个。
- 实际同时在浏览器里干活的只有 2 个 space，规模比较小。等扫码后再用 7 个平台测一次更有说服力。

## 发现的问题（交给 dev-1 / ego-shim，不在我的文件范围，没改 src）

1. **`tabs.create` 等 `load` 会超时。** `src/ego-shim.mjs:63` 是 `await page.goto(url)`，用的是默认的 `waitUntil: 'load'` 和 15 秒超时。抖音上传页是长轮询页面，`readyState` 常常停在 `interactive`。
   - 逐个跑时 `goto` 在 15 秒超时，`tabs.create` 抛错，preflight 返回 `ok:false`，原因是 `page.goto timed out after 15000ms waiting for load …`。
   - 抛错后插件拿不到 `tab.id`，关不掉这个页面，space 里**留下了一个多余的 `p2`**。已手动关掉。
   - Chrome 的 `chrome.tabs.create` 本来就是不等页面加载就返回的，插件自己会轮询 `ready`。
   - **建议**：shim 里改成 `page.goto(url, { waitUntil: 'commit', timeout: 30000 })`。对照实验（`--patch-goto`）里抖音 3 次全部成功，用时 9–13 s，没有留下多余页面。
2. **runner 拒绝接管时，结果里看不出原因。** `runEgoTask` 遇到用户控制的 space 时，返回的是 `reason: 'exit-code'`，真正的原因「现在由用户控制，不接管」只在 stdout/stderr 里。建议识别这种情况，返回 `reason: 'space-delegated'`，方便调用方把它和真正的错误区分开，比如标成 `awaiting_user`、跳过这个平台。
3. **公众号、微博、知识站没有插件适配器**（`extra.js` 是空的）。如果要走 preflight 和发布，得在插件 fork 里补适配器。

## 不通过时的替代路线（只记录）

在 shim 修好之前，调用方可以先用 `--patch-goto` 的办法，在任务脚本前言里包一层 `task.newPage`，把新页面的 `goto` 默认改成 `commit`。这只是临时办法，正式修复应该放在 shim 里。
