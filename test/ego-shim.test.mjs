// ego-shim 行为测试：在 Ego Lite Profile 5 的临时 space 里对本地测试页跑真实浏览器。
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { runEgoTask, finishSpace } from '../src/ego-runner/index.mjs';
import { EGO_SKIP, tempSpaceName, fixtureUrl, FIXTURE_DIR } from './helpers/ego.mjs';

const FIXTURE = fixtureUrl('basic.html');

async function run(space, script, params = {}) {
  const r = await runEgoTask({ space, script, params: { FIXTURE, FIXTURE_DIR, ...params } });
  assert.equal(r.ok, true, `${r.reason}: ${r.error}\n${r.stderr}\n${r.stdout}`);
  return r.result;
}

describe('ego-shim（真实 Ego Lite）', { skip: EGO_SKIP ?? false }, () => {
  const spaces = [];
  const space = (tag) => { const s = tempSpaceName(tag); spaces.push(s); return s; };
  after(async () => { for (const s of spaces) await finishSpace(s); });

  test('打开：tabs.create 后 tabs.get 读回 url 和 title', async () => {
    const r = await run(space('open'), `
      const tab = await chrome.tabs.create({ url: params.FIXTURE, active: false });
      const got = await chrome.tabs.get(tab.id);
      return { tab, got };`);
    assert.equal(typeof r.tab.id, 'number');
    assert.equal(r.got.id, r.tab.id);
    assert.equal(r.got.url, FIXTURE);
    assert.equal(r.got.title, 'Ego Shim Fixture');
    assert.equal(r.got.windowId, r.tab.windowId);
  });

  test('找回：进程 1 开页写标记后退出，进程 2 用 recoverTabs 拿到同一页', async () => {
    const s = space('recover');
    const marker = `m-${Date.now()}`;
    await run(s, `
      const tab = await chrome.tabs.create({ url: params.FIXTURE + "#recover", active: false });
      await chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.evaluate", { expression: "document.getElementById('marker').textContent = " + JSON.stringify(params.marker) });
      return tab.id;`, { marker });
    const r = await run(s, `
      const ids = await recoverTabs(/#recover$/);
      const read = [];
      for (const id of ids) read.push((await chrome.debugger.sendCommand({ tabId: id }, "Runtime.evaluate", { expression: "document.getElementById('marker').textContent", returnByValue: true })).result.value);
      return { ids, read, got: ids.length ? await chrome.tabs.get(ids[0]) : null };`);
    assert.equal(r.ids.length, 1);
    assert.deepEqual(r.read, [marker]);
    assert.equal(r.got.url, FIXTURE + '#recover');
  });

  test('找回：上一个进程 finish 保留页面后，下一个进程认领 space 再找回', async () => {
    const s = space('kept');
    await run(s, `
      const tab = await chrome.tabs.create({ url: params.FIXTURE + "#kept", active: false });
      await chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.evaluate", { expression: "document.getElementById('marker').textContent = 'kept-1'" });
      return (await task.finish({ keep: "all" })).keptManagedLabels;`);
    const r = await run(s, `
      const ids = await recoverTabs(/#kept$/);
      return { ids, marker: (await chrome.debugger.sendCommand({ tabId: ids[0] }, "Runtime.evaluate", { expression: "document.getElementById('marker').textContent", returnByValue: true })).result.value };`);
    assert.equal(r.ids.length, 1);
    assert.equal(r.marker, 'kept-1');
  });

  test('关闭：tabs.remove 后 tabs.get 抛错，space 里没有这一页', async () => {
    const r = await run(space('close'), `
      const keep = await chrome.tabs.create({ url: params.FIXTURE + "#keep", active: false });
      const tab = await chrome.tabs.create({ url: params.FIXTURE + "#close", active: false });
      const detached = [];
      chrome.debugger.onDetach.addListener((src) => detached.push(src.tabId));
      await chrome.debugger.attach({ tabId: tab.id }, "1.3");
      await chrome.tabs.remove(tab.id);
      let error = null;
      try { await chrome.tabs.get(tab.id); } catch (e) { error = e.message; }
      return { id: tab.id, error, detached, urls: (await task.tabs()).map((t) => t.url) };`);
    assert.equal(r.error, `No tab with id: ${r.id}.`);
    assert.deepEqual(r.detached, [r.id]);
    assert.ok(!r.urls.some((u) => u.endsWith('#close')), r.urls.join(','));
    assert.ok(r.urls.some((u) => u.endsWith('#keep')));
  });

  test('打开失败：tabs.create 抛错，新开的页被关掉，space 页数不变', async () => {
    const r = await run(space('create-fail'), `
      await chrome.tabs.create({ url: params.FIXTURE + "#first", active: false });   // 先用掉自带的空白 p1
      const before = (await task.tabs()).length;
      // 1 号端口没人监听：连接被拒；goto 不抛就算没测到
      let error = null;
      try { await chrome.tabs.create({ url: "http://127.0.0.1:1/", active: false }); } catch (e) { error = e.message; }
      return { error, before, after: (await task.tabs()).length, urls: (await task.tabs()).map((t) => t.url) };`);
    assert.ok(r.error, `tabs.create 应该抛错：${r.urls.join(',')}`);
    assert.equal(r.after, r.before, r.urls.join(','));
  });

  test('未知 tabId：tabs.get 和 sendCommand 抛 No tab with id', async () => {
    const r = await run(space('unknown'), `
      const out = [];
      try { await chrome.tabs.get(9999); } catch (e) { out.push(e.message); }
      try { await chrome.debugger.sendCommand({ tabId: 9999 }, "Runtime.evaluate", { expression: "1" }); } catch (e) { out.push(e.message); }
      return out;`);
    assert.deepEqual(r, ['No tab with id: 9999.', 'No tab with id: 9999.']);
  });

  test('前台：tabs.update(active) 切页，tabs.query({active}) 返回当前页', async () => {
    const r = await run(space('focus'), `
      const a = await chrome.tabs.create({ url: params.FIXTURE + "#a", active: true });
      const b = await chrome.tabs.create({ url: params.FIXTURE + "#b", active: true });
      await chrome.tabs.update(a.id, { active: true });
      const q1 = await chrome.tabs.query({ active: true, windowId: a.windowId });
      await chrome.tabs.update(b.id, { active: true });
      const q2 = await chrome.tabs.query({ active: true, windowId: a.windowId });
      const all = await chrome.tabs.query({});
      return { a: a.id, b: b.id, q1: q1.map((t) => t.id), q2: q2.map((t) => t.id), all: all.map((t) => t.id).sort(), getA: (await chrome.tabs.get(a.id)).active };`);
    assert.deepEqual(r.q1, [r.a]);
    assert.deepEqual(r.q2, [r.b]);
    assert.deepEqual(r.all, [r.a, r.b].sort());
    assert.equal(r.getA, false);
  });

  test('sendCommand：Runtime.evaluate、DOM 设文件、Input.insertText、Emulation 焦点仿真都可用', async () => {
    const upload = FIXTURE_DIR + 'upload.txt';
    const r = await run(space('cdp'), `
      const { id } = await chrome.tabs.create({ url: params.FIXTURE, active: false });
      const send = (m, p) => chrome.debugger.sendCommand({ tabId: id }, m, p);
      await chrome.debugger.attach({ tabId: id }, "1.3");
      await chrome.debugger.attach({ tabId: id }, "1.3");   // 幂等
      const focusEmu = await send("Emulation.setFocusEmulationEnabled", { enabled: true });
      const ev = await send("Runtime.evaluate", { expression: "1 + 2", returnByValue: true });
      const { root } = await send("DOM.getDocument", {});
      const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: "#file" });
      await send("DOM.setFileInputFiles", { nodeId, files: [params.upload] });
      const files = (await send("Runtime.evaluate", { expression: "[...document.getElementById('file').files].map(f => f.name)", returnByValue: true })).result.value;
      await send("Runtime.evaluate", { expression: "document.getElementById('text').focus()" });
      await send("Input.insertText", { text: "你好 ego" });
      const text = (await send("Runtime.evaluate", { expression: "document.getElementById('text').value", returnByValue: true })).result.value;
      await chrome.debugger.detach({ tabId: id });
      const after = (await chrome.tabs.get(id)).url;
      return { focusEmu, ev: ev.result.value, files, text, after };`, { upload });
    assert.deepEqual(r.focusEmu, {});
    assert.equal(r.ev, 3);
    assert.deepEqual(r.files, ['upload.txt']);
    assert.equal(r.text, '你好 ego');
    assert.equal(r.after, FIXTURE, 'detach 不关页面');
  });

  test('插件 lib/cdp.js 不改就能经垫片在本地页上生效', async () => {
    const r = await run(space('plugin'), `
      const cdp = await loadPlugin("lib/cdp.js");
      const { id } = await chrome.tabs.create({ url: params.FIXTURE, active: false });
      const title = await cdp.evaluate(id, "document.title");
      const clicked = await cdp.click(id, "document.getElementById('btn')");
      const clicked2 = await cdp.click(id, "document.getElementById('btn')");
      const count = await cdp.evaluate(id, "document.getElementById('count').textContent");
      await cdp.setValue(id, "document.getElementById('text')", "via setValue");
      const value = await cdp.evaluate(id, "document.getElementById('text').value");
      let executeScript = null;
      try { await chrome.scripting.executeScript({ target: { tabId: id }, func: () => 1 }); } catch (e) { executeScript = e.message; }
      await cdp.detach(id);
      return { title, clicked, clicked2, count, value, executeScript, runtimeId: chrome.runtime.id };`);
    assert.equal(r.title, 'Ego Shim Fixture');
    assert.equal(r.clicked && r.clicked2, true);
    assert.equal(r.count, '2');
    assert.equal(r.value, 'via setValue');
    assert.match(r.executeScript, /scripting/);
    assert.equal(typeof r.runtimeId, 'string');
  });
});
