# ③ 跨进程找回：prepare 和 commit 分两个进程时能不能拿到同一页

**判定：通过（三种结束方式都能找回），附一个风险：`kill -9` 杀掉 CLI 不会停掉脚本。**

## 怎么测的

```sh
node spikes/local/03-cross-process-recover.mjs > scratch/03-cross-process-recover.json
node spikes/local/03b-orphan-stop.mjs > scratch/03b-orphan-stop.json   # 怎么停掉被杀 CLI 留下的脚本
```

每种情形：进程 1 经 `ego-shim` 开本地测试页（`#a` / `#b` / `#c`），往 DOM 写标记 `from-proc-1`；进程 2 用 `recoverTabs(/#x$/)` 找回，读标记。space 都是 Profile 5 的 `kinso/test/recover-*`，测完 `finish({keep: []})`。

- **A**：进程 1 正常退出，不 `finish`。
- **B**：进程 1 写完标记后每 500ms 往页面写心跳 `window.__beat`；host 在它就绪后 `kill -9` 掉 `ego-browser` CLI 进程，然后进程 2 找回。
- **C1**：进程 1 `finish({ keep: ["p1"] })` 把页交还；进程 2 经 runner 取用（runner 看到 `ownership=user` 走 `claimTaskSpace`），再 `adopt` 找回。
- **C2**：同 C1，但进程 2 之前先不认领、直接 `taskSpace(id)` 试一次（另一个 space，不影响 C1）。

## 关键输出

| 情形 | 进程 1 之后 space | 进程 2 看到的页 | 找回 | 标记 |
|---|---|---|---|---|
| A 正常退出 | `ownership=agent` | `label=p1`（label 跨进程保留） | 1 页 | `from-proc-1` |
| B `kill -9` | `ownership=agent` | `label=p1` | 1 页 | `from-proc-1` |
| C1 finish 保留 + 认领 | `ownership=user` | 无 label（要 `adopt`） | 1 页 | `from-proc-1` |
| C2 先直接 `taskSpace(id)` 再认领 | `ownership=user`（直接调用后仍是 user） | 无 label | 1 页 | `from-proc-1` |

B 的心跳：进程 2 读到 `3`，3 秒后 `9`，kill 后 5.5 秒 `13`，**进程 1 的脚本在 CLI 被杀后仍在跑**。

C2 不认领直接 `taskSpace(id)`：调用本身返回，第一个浏览器命令报 `task.listTabs: This task space is no longer assigned to the agent ... browser commands are paused`，退出码 1。另一次把这个调用包在 `try` 里时，Ego 直接停掉脚本，**退出码 0、没有输出**。runner 分别判为 `exit-code` / `no-result`，两种都是失败，不会误判成功。

补测，怎么停掉被杀 CLI 留下的脚本：

| 方式 | 结果 |
|---|---|
| 普通模式 `ego-browser nodejs`，kill CLI | 脚本继续跑 |
| 普通模式，kill CLI 后 `finish` 这个 space | 脚本仍在跑（心跳 24 → 29 → 32），只是浏览器调用开始报错（`page label not found`）；脚本里吞掉错误的循环会一直跑完 |
| `--session <id> --timeout-ms 600000`，kill CLI | 脚本随即停下（心跳停在 6） |
| `--session <id> --timeout-ms 6000`，不 kill | 6 秒时被 Ego 停下（心跳停在 12） |

原因：脚本跑在 Ego Lite 常驻的 Node 服务（`ego Helper (Node)`，所有脚本 `process.pid` 相同）里，CLI 只是转发；普通模式下 CLI 断开不会取消脚本。

## prepare / commit 分两进程该用哪条路

**用 A**：prepare 进程填完表单后正常退出、**不 `finish`**；space 仍归 agent，Page label 原样保留，commit 进程按名字 `taskSpace(id)` 后 `recoverTabs(re)` 直接拿到页（不用 adopt），commit 完再 `finish({keep: []})`。

C（`finish({keep})` 后 `claimTaskSpace`）也能用，但 `finish` 的语义是「任务结束，页交还用户」，Ego 的说明要求认领前用户明确同意，适合「prepare 完把页留给人看、人确认后再接手」的场合。若走 C，runner 已经按 ownership 自动认领。

## 风险与待定

- runner 现在用普通模式，超时会 kill CLI，**脚本可能仍在 Ego 里跑**；runner 的超时错误已写明这一点。S2 接驱动时二选一：
  1. 任务 ≤ 10 分钟的用 `--session <唯一 id> --timeout-ms`，kill 和超时都能真正停掉脚本（`--timeout-ms` 上限 600000，长视频上传不够用）；session 用完后运行时是否回收，还没测。
  2. 保留普通模式，配合 §2.3 的 space 锁：超时后不马上对同一个 space 起新任务，等旧脚本自己结束（脚本里不要吞掉浏览器调用的错误，space 被 `finish` 后第一个调用就会让它退出）。
- 同一 space 里两个进程同时操作同一页不会报错（B 里进程 2 和孤儿脚本同时在调 CDP），所以 space 锁必须由 runner 外层保证，Ego 不会拦。

## 不通过时的替代路线（只记录）

本项通过。若以后 label 不跨进程保留：一律走 C（finish 保留 + claim + adopt），`recoverTabs` 已兼容无 label 的页。
