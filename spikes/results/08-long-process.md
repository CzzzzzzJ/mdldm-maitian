# ⑧ 长进程：一个 `ego-browser nodejs` 进程能不能跑满 2 小时以上

**判定：通过**（跑满 126 分钟，126 次检查全部成功，中途没有被杀，内存没有持续上涨，最后一行 `@@RESULT` 正常）。

## 怎么测的

```sh
nohup ego-browser nodejs < spikes/local/08-long-process.ego.js > scratch/08-long-process.log 2>&1 &
# 每行同时追加到 scratch/08-long-process.jsonl（CLI 的输出要等进程结束才落盘，进程被杀时靠它留痕）
```

- Ego Lite 2.2.1，Profile 5，临时 space `kinso/test/longrun-mwlhyjo2`（id 65），本地测试页 `test/fixtures/basic.html`。
- 普通模式（不带 `--session`），时间 2026-11-18 10:23:19 到 12:29:21（台湾时间）。
- 每分钟做一次 `page.evaluate`（往 DOM 写 `tick-<n>` 并读回）和一次 `page.cdp("Runtime.evaluate")`（读 `document.title`），并记下 `process.memoryUsage()`。一共 126 次，结束时 `finish({ keep: [] })`。
- 同一段时间里，这台机器上还在跑本任务的 `npm test` 和 ③④⑬ 的 spike（同一个 Ego Node 服务，其他 space）。长进程没有受到影响。

## 关键输出

| 项 | 结果 |
|---|---|
| tick 次数 | 126，成功 126，失败 0 |
| 相邻 tick 间隔 | 60003–60033 ms（没有卡顿） |
| 总时长 | 126.02 分钟 |
| `evaluate` / `cdp` 读回 | 每次都是 `tick-<n>` / `Ego Shim Fixture` |
| CLI 退出码 | 0 |
| 结束后 `kinso/test/*` space | 无残留（space 65 已由脚本 `finish` 关掉） |

RSS 曲线（MB，`process.memoryUsage().rss`；heap 一直在 5–7 MB）：

| 分钟 | 1 | 15 | 30 | 45 | 60 | 75 | 90 | 105 | 120 | 126 |
|---|---|---|---|---|---|---|---|---|---|---|
| RSS | 154 | 166 | 177 | 177 | 177 | 177 | 178 | 178 | 177 | 171 |

全程最低 153、最高 208。前 30 分钟从约 154 爬到 177 后就稳住了，没有泄漏迹象。注意：所有脚本都跑在 Ego 常驻的 Node 服务里（`process.pid` 都是 93672），所以这个 RSS 是**整个服务**的，里面还有同时段其他测试，208 的峰值就出在那时，不只是本脚本。

最后一行：

```
@@RESULT {"ok":126,"fail":0,"elapsedMin":126.02,"spaceId":65}
```

## 对 S2/S8 长视频上传的建议

1. **长任务能用普通模式。** Ego 不会主动杀掉跑了 2 小时的普通模式脚本，内存也稳定，所以长视频上传可以放进一个 `ego-browser nodejs` 进程里跑完。
2. **`--session` 不适合长任务。** 它的 `--timeout-ms` 上限是 600000 ms（10 分钟），长视频上传超过这个时间就会被 Ego 停掉。`--session` 只适合 10 分钟以内的短任务（登录检测、填表、回读）。
3. **普通模式下停不掉脚本（见 ③）。** `kill -9` 掉 CLI 后，脚本还会在 Ego 的 Node 服务里继续跑；对 space 做 `finish` 只会让后面的浏览器调用报错，吞掉错误的循环还是会跑到底。所以长任务要这样处理：
   - runner 给长任务的超时要按视频大小放宽（例如几小时），不要沿用默认 10 分钟。超时一到 runner 会杀 CLI，这时脚本可能还在跑。
   - 脚本自己设截止时间，到点自己 `throw` 退出；浏览器调用出错就退出，不要吞错后继续循环。
   - 用 §2.3 的 space 锁：上一个任务超时之后，等心跳确认它停了，才对同一个 space 起新任务。Ego 不会拦两个进程同时操作同一页（③ 里测到过）。
   - 脚本往 `scratch/`（或 `ops/` 下的日志）写心跳，runner 靠心跳判断「还在上传」还是「挂了」；不要只靠 CLI 的 stdout/stderr，它们要等进程结束才写出来。
4. **上传进度最好分段落盘。** 进程中途死掉时，按 ③ 的找回路线（同名 space + `recoverTabs`），新进程可以接着看上传页的状态，不用从头重新上传。

## 不通过时的替代路线（只记录）

本项通过，不需要替代路线。如果以后 Ego 版本开始限制普通模式的运行时长，可以把上传拆成两步：先由一个短进程触发上传（`DOM.setFileInputFiles` 交出文件路径后，上传由浏览器在页面里自己进行，不依赖脚本进程还活着），再由几个短进程按 ③ 的路线找回页面、轮询进度。
