# ④ 并行 + `withFocus`：几个 space 同时切前台会不会互相抢

**判定：不通过（不加锁会抢）；加一把只锁切前台那一步的文件锁后通过。**

## 怎么测的

```sh
node spikes/local/04-parallel-withfocus.mjs 20 > scratch/04-parallel-withfocus.json
```

- 每个 space（`kinso/test/focus-A-*`、`kinso/test/focus-B-*`，Profile 5）一个 `ego-browser nodejs` 进程，各开两页：「用户页」（在前台）和「目标页」。
- 每轮照抄插件 `lib/publish.js:78` 的 `withFocus`：`tabs.get` → `tabs.query({active})` 取之前的前台页 → `tabs.update(目标, {active:true})` → 等 1 秒 → 「操作」（150ms 间隔在目标页里采样 3 次 `document.hasFocus()`、`visibilityState`，以及 `tabs.get().active`）→ 切回用户页。
- 一轮里任一采样不在前台（`hasFocus=false`、不是 `visible` 或 `active=false`）记一次「操作时不在前台」。
- 三组，每组每进程 20 轮：单进程基线；两进程同时跑不加锁；两进程同时跑加锁（`mkdir` 原子锁，`scratch/04-focus.lock`，锁住开页时的切前台和整段 `withFocus`）。

## 关键输出

| 组 | 进程 | 操作时不在前台（轮/20） | 坏采样（/60） | 切回失败 | 用时 |
|---|---|---|---|---|---|
| 单进程基线 | A | 0 | 0 | 0 | 30.4s |
| 并行不加锁 | A | **20** | 38 | 0 | 30.3s |
| 并行不加锁 | B | **20** | 60 | 0 | 30.3s |
| 并行加锁 | A | 0 | 0 | 0 | 50.6s |
| 并行加锁 | B | 0 | 0 | 0 | 45.3s |

- 不加锁时坏的是 `hasFocus`：`active` 一直是 true、`visibility` 一直是 `visible`，即标签页在本 space 里是前台，但窗口焦点被另一个 space 抢走了。所以「抢前台」发生在 space（窗口）之间，`tabs.get().active` 看不出来。
- 第一轮测试时开页那一步（`tabs.create({active:true})`）没进锁，加锁组还漏了 1 轮；把开页的切前台也放进锁之后为 0。

## 结论和建议

- 方案 §2.3 说的「前台锁」需要：全局一把（跨 space、跨进程），锁住**所有会切前台的步骤**：`withFocus` 整段、`tabs.create({active:true})`、`tabs.update({active:true})`。⑬ 测到发真实鼠标事件也会让目标页拿到焦点，插件的 `cdp.click/hover` 是否也要进锁，看平台实测：如果只是因为需要真实悬停才用 `withFocus`，锁住 `withFocus` 就够了。
- 代价：这一步串行。两个进程各 20 轮，总时间从约 30 秒变成约 50 秒。实际发布里 `withFocus` 每个平台只用几次，影响小。
- 锁的实现可以用 `mkdir` 原子锁加超时清理（本 spike 的写法），锁文件放 `ops/locks/foreground.lock`，和 §2.3 的 space 锁放在一起。

## 不通过时的替代路线（只记录）

1. 前台锁（上面已验证有效）。
2. 让需要真实悬停的步骤改用 `Emulation.setFocusEmulationEnabled` 加合成事件，不切前台（插件 `cdp.attach` 已开焦点仿真，只对 `focus()` 和键盘这类有效，对真实悬停不一定够，要按平台测）。
3. 不同平台排成队列，不同时跑需要前台的步骤。
