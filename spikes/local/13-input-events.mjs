// ⑬ Input.dispatchMouseEvent / Input.dispatchKeyEvent 在 page.cdp 上是否可用，含后台页。
// 用法：node spikes/local/13-input-events.mjs > scratch/13-input-events.json
// 三种位置：前台页；同一 space 里没在前台的页；另一个 space 的页（本 space 的页在前台时）。
import { runEgoTask, finishSpace } from '../../src/ego-runner/index.mjs';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const FIXTURE = pathToFileURL(new URL('../../test/fixtures/basic.html', import.meta.url).pathname).href;
const tag = randomBytes(3).toString('hex');
const SPACE = `kinso/test/input-${tag}`;
const OTHER = `kinso/test/input-other-${tag}`;

const script = `
const other = await taskSpace(params.OTHER, { profileId: "Profile 5" });
const otherPage = other.page("p1");
await otherPage.goto(params.FIXTURE + "#other-space");

const fg = await chrome.tabs.create({ url: params.FIXTURE + "#fg", active: true });
const bg = await chrome.tabs.create({ url: params.FIXTURE + "#bg-same-space", active: false });
await chrome.tabs.update(fg.id, { active: true });

const targets = {
  foreground: (m, p) => chrome.debugger.sendCommand({ tabId: fg.id }, m, p),
  backgroundSameSpace: (m, p) => chrome.debugger.sendCommand({ tabId: bg.id }, m, p),
  otherSpace: (m, p) => otherPage.cdp(m, p),
};
const activeNow = async () => ({
  thisSpace: (await task.tabs()).filter((t) => t.active).map((t) => t.url.split("#")[1]),
  otherSpace: (await other.tabs()).filter((t) => t.active).map((t) => t.url.split("#")[1]),
});
const out = { activeAtStart: await activeNow() };
for (const [where, send] of Object.entries(targets)) {
  const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result.value;
  const r = { state: await ev("({ focus: document.hasFocus(), visibility: document.visibilityState })") };
  try {
    const rect = await ev("(() => { const b = document.getElementById('btn').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()");
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x: rect.x, y: rect.y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 });
    }
    r.mouseCount = await ev("document.getElementById('count').textContent");
    r.activeAfterMouse = await activeNow();
  } catch (e) { r.mouseError = e.message; }
  try {
    await ev("document.getElementById('text').focus()");
    r.activeAfterFocusCall = await activeNow();
    for (const ch of "ab1") {
      const code = ch.toUpperCase().charCodeAt(0);
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, windowsVirtualKeyCode: code });
      await send("Input.dispatchKeyEvent", { type: "char", key: ch, text: ch });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch, windowsVirtualKeyCode: code });
    }
    r.keyValue = await ev("document.getElementById('text').value");
    r.activeAfterKeys = await activeNow();
  } catch (e) { r.keyError = e.message; }
  r.stateAfter = await ev("({ focus: document.hasFocus(), visibility: document.visibilityState })");
  out[where] = r;
  await chrome.tabs.update(fg.id, { active: true });   // 每轮从「fg 在前台」开始
}
await other.finish({ keep: [] });
return out;`;

const r = await runEgoTask({ space: SPACE, script, params: { FIXTURE, OTHER } });
await finishSpace(SPACE);
await finishSpace(OTHER);
const { stdout, stderr, ...rest } = r;
console.log(JSON.stringify(r.ok ? rest : { ...rest, output: stdout + stderr }, null, 2));
process.exit(r.ok ? 0 : 1);
