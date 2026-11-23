import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('traffic Chrome profiles keep local tabs/sessions separate and preserve the default publishing browser', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'maitian-shim-test-'));
  const cfg = path.join(dir, 'cfg.json'), previous = process.env.MAITIAN_CONFIG;
  process.env.MAITIAN_CONFIG = cfg;
  await writeFile(cfg, JSON.stringify({ chromePort: 9333, chromeProfile: path.join(dir, 'default') }));
  t.after(async () => {
    if (previous === undefined) delete process.env.MAITIAN_CONFIG; else process.env.MAITIAN_CONFIG = previous;
    await rm(dir, { recursive:true, force:true });
  });

  const trace = [], sockets = [];
  let poison = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const u = new URL(url);
    assert.equal(u.hostname, '127.0.0.1');
    assert.equal(u.pathname, '/json/version');
    assert.equal(options.redirect, 'error');
    trace.push(['probe', u.port]);
    return { ok:true, json:async () => ({ webSocketDebuggerUrl: `ws://${poison ? 'example.com' : '127.0.0.1'}:${u.port}/devtools/browser/test` }) };
  });
  const pages = port => [
    { url:`https://example.test/${port}/adopt`, targetId:'adopt', type:'page' },
  ];
  class Socket {
    next = 0;
    constructor(url) { this.port = url.port; this.readyState = 1; this.rooms = pages(this.port); sockets.push(this); queueMicrotask(() => this.onopen()); }
    send(raw) {
      const { id, method, params, sessionId } = JSON.parse(raw);
      trace.push([this.port, method, sessionId]);
      let result = {};
      if (method === 'Target.createTarget') {
        result.targetId = String(++this.next);
        this.rooms.push({ targetId: result.targetId, type:'page', url:params.url });
      }
      if (method === 'Target.getTargets') result.targetInfos = this.rooms;
      if (method === 'Target.getTargetInfo') result.targetInfo = this.rooms.find(x => x.targetId === params.targetId);
      if (method === 'Target.attachToTarget') result.sessionId = `${this.port}:${params.targetId}`;
      if (method === 'Runtime.evaluate') result.value = sessionId;
      if (method === 'Target.closeTarget') {
        this.rooms = this.rooms.filter(x => x.targetId !== params.targetId);
        queueMicrotask(() => this.onmessage({ data:JSON.stringify({method:'Target.targetDestroyed',params:{ targetId:params.targetId }}) }));
      }
      queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, result }) }));
    }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const realWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  t.after(() => { globalThis.WebSocket = realWebSocket; });

  const { chrome, withBrowser, adoptTargets, closeConnection } = await import('../src/chrome-shim.mjs');
  const context = { chromePort:22333, chromeProfile:path.join(dir, 'secondary') };
  const create = url => chrome.tabs.create({ url });
  const [primary, secondary] = await Promise.all([
    create('https://example.test/primary'),
    withBrowser(context, () => create('https://example.test/secondary')),
  ]);
  assert.notEqual(primary.id, secondary.id);
  assert.deepEqual(await chrome.tabs.get(primary.id), { id:primary.id, url:primary.url, title:undefined, windowId:1 });
  await chrome.debugger.attach({tabId:primary.id});
  await chrome.debugger.detach({tabId:primary.id});
  assert.deepEqual(await withBrowser(context, () => chrome.debugger.sendCommand({tabId:primary.id}, 'Runtime.evaluate')), {value:'9333:1'});
  assert.deepEqual(await chrome.debugger.sendCommand({tabId:secondary.id}, 'Runtime.evaluate'), {value:'22333:1'});
  await chrome.tabs.update(primary.id, {active:true});
  assert.ok(trace.some(([port, method])=>port==='9333' && method==='Target.activateTarget'));
  const [adoptPrimary] = await adoptTargets(/\/adopt$/);
  const [adoptSecondary] = await withBrowser(context, () => adoptTargets(/\/adopt$/));
  assert.notEqual(adoptPrimary, adoptSecondary);
  assert.equal((await chrome.tabs.get(adoptPrimary)).url, 'https://example.test/9333/adopt');
  await chrome.tabs.remove(secondary.id);
  assert.throws(() => chrome.tabs.get(secondary.id), /No tab/);
  assert.equal((await chrome.tabs.get(primary.id)).url, primary.url);
  assert.deepEqual(new Set(sockets.map(s => s.port)), new Set(['9333','22333']));
  closeConnection();
  assert.ok(sockets.every(s => s.readyState === 3));
  poison = true;
  await assert.rejects(create('https://example.test/new'), /无效的本地调试地址/);
  assert.equal(sockets.length, 2, 'refuses a non-loopback CDP websocket');
});
