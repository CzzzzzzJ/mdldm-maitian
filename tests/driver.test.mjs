import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('concurrent browser contexts and later tab commands stay on their owning connection', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-driver-'));
  const configFile = path.join(dir, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({ chromePort: 19333, chromeProfile: path.join(dir, 'default') }));
  process.env.MAITIAN_CONFIG = configFile;
  const originalFetch = globalThis.fetch, OriginalSocket = globalThis.WebSocket;
  const opened = [], commands = [];
  globalThis.fetch = async (url) => ({ json: async () => ({ webSocketDebuggerUrl: `ws://fake/${new URL(url).port}` }) });
  class Socket {
    constructor(url) { this.port = Number(url.split('/').at(-1)); this.readyState = 1; opened.push(this.port); setImmediate(() => this.onopen?.()); }
    send(data) {
      const m = JSON.parse(data); commands.push({ port: this.port, ...m });
      const result = m.method === 'Target.createTarget' ? { targetId: `${this.port}-${m.id}` }
        : m.method === 'Target.attachToTarget' ? { sessionId: `session-${this.port}` }
        : m.method === 'Target.getTargetInfo' ? { targetInfo: { url: `https://example.com/${this.port}`, title: String(this.port) } }
        : m.method === 'Runtime.evaluate' ? { result: { value: this.port } } : {};
      setImmediate(() => this.onmessage?.({ data: JSON.stringify({ id: m.id, result }) }));
    }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  globalThis.WebSocket = Socket;
  let shim;
  try {
    shim = await import('../src/chrome-shim.mjs');
    assert.equal(typeof shim.withBrowser, 'function', 'browser contexts must be available');
    const [a, b] = await Promise.all([
      shim.withBrowser({ chromePort: 19334, chromeProfile: path.join(dir, 'a') }, async () => { await new Promise(r => setImmediate(r)); return shim.chrome.tabs.create({ url: 'https://example.com/a' }); }),
      shim.withBrowser({ chromePort: 19335, chromeProfile: path.join(dir, 'b') }, () => shim.chrome.tabs.create({ url: 'https://example.com/b' })),
    ]);
    assert.notEqual(a.id, b.id);
    const [ta, tb] = await Promise.all([shim.chrome.tabs.get(a.id), shim.chrome.tabs.get(b.id)]);
    assert.equal(ta.title, '19334'); assert.equal(tb.title, '19335');
    const result = await shim.chrome.debugger.sendCommand({ tabId: a.id }, 'Runtime.evaluate', { expression: '1' });
    assert.equal(result.result.value, 19334);
    assert.deepEqual(opened.sort(), [19334, 19335], 'unused default browser is never connected');
    await shim.chrome.tabs.remove([a.id, b.id]);
    const removed = commands.filter(m => m.method === 'Target.closeTarget');
    assert.deepEqual(removed.map(m => m.port).sort(), [19334, 19335]);
  } finally {
    shim?.closeConnection(); globalThis.fetch = originalFetch; globalThis.WebSocket = OriginalSocket;
    delete process.env.MAITIAN_CONFIG; fs.rmSync(dir, { recursive: true, force: true });
  }
});
