# ⑬ `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` 在 `page.cdp` 上是否可用

**判定：通过**（前台页、同 space 的后台页、另一个 space 的页都能点、能输入；有一个副作用，见「注意」）。

## 怎么测的

```sh
node spikes/local/13-input-events.mjs > scratch/13-input-events.json
```

Ego Lite 2.2.1，Profile 5，两个临时 space（`kinso/test/input-*`、`kinso/test/input-other-*`），本地测试页 `test/fixtures/basic.html`。经 `ego-shim` 的 `chrome.debugger.sendCommand`（即 `page.cdp`）发：

- 鼠标：`mouseMoved` → `mousePressed` → `mouseReleased`（`button: left, clickCount: 1`），坐标取按钮中心；读回页面计数 `#count`。
- 键盘：先 `focus()` 输入框，逐字发 `keyDown` / `char` / `keyUp`（`a`、`b`、`1`）；读回 `input.value`。

三个位置：前台页（`tabs.update(active)` 切到前台）、同一 space 里没在前台的页、另一个 space 的页（本 space 的页在前台时）。每个位置之前把前台页切回原位。

## 关键输出

| 位置 | 发之前 hasFocus / visibility | 鼠标点击后计数 | 键盘输入后 value | 发之后 hasFocus |
|---|---|---|---|---|
| 前台页 | true / visible | 1 | `ab1` | true |
| 同 space 后台页 | false / visible | 1 | `ab1` | true |
| 另一个 space 的页 | false / visible | 1 | `ab1` | true |

前台变化（`task.tabs()` 的 `active`）：

- 同 space 后台页：**鼠标事件之后它变成了本 space 的 active 页**（`activeAfterMouse.thisSpace = ["bg-same-space"]`），即 Ego 在投递鼠标事件时把目标页切到了前台。
- 另一个 space 的页：两个 space 各自的 active 页都没变，但目标页之后 `hasFocus() = true`。

另外：Ego Lite 里没在前台的页 `visibilityState` 也是 `visible`（不是 `hidden`），所以只看 visibility 判断不了是否在前台，要看 `document.hasFocus()` 或 `task.tabs()` 的 `active`。

## 注意

- 鼠标事件会把同 space 的目标页切到前台、并让目标页拿到焦点。插件的 `cdp.click` / `hover` 发真实鼠标事件，**几个 space 同时点击时同样会抢焦点**，和 ④ 的 `withFocus` 是同一类问题，前台锁应该覆盖「发鼠标事件」这一步，或者接受它会抢焦点。
- 键盘 `char` 事件要带 `text`；只发 `keyDown` 不会输入字符（插件 `pressKey` 已经这样做）。

## 不通过时的替代路线（只记录）

本项通过，无需替代。若以后某个平台的按钮在后台点不动：用 `page.click()`（Ego 高层 API，带自动滚动和可见性处理）或 `withFocus` 加前台锁。
