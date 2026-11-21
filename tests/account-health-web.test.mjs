import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import test from 'node:test';

test('system page joins account health, switches and integrations through the live HTTP routes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-system-http-'));
  const file = path.join(dir, 'config.json'), calls = path.join(dir, 'calls.jsonl');
  const hook = 'https://open.feishu.cn/open-apis/bot/v2/hook/test-only-address';
  const cfg = { rootPath: dir, enabledPlatforms: ['bilibili', 'xhs', 'zsz'], driver: 'direct',
    web: { key: 'system-test-only', port: 0 }, chromeProfile: path.join(dir, 'browser'),
    feishuWebhook: hook, bilibiliAccounts: [{ id: 'default', name: '主号' }, { id: 'second', name: '副号' }],
    site: { name: '示例站点', base: 'https://site.invalid' } };
  fs.writeFileSync(file, JSON.stringify(cfg));
  const preload = path.join(dir, 'capture-args.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + '\\n'); process.exit(0);`);
  const priorOptions = process.env.NODE_OPTIONS;
  process.env.MAITIAN_CONFIG = file; process.env.MAITIAN_DB = path.join(dir, 'hub.db');
  process.env.NODE_OPTIONS = '--import=' + preload;
  let db, server;
  t.after(async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    db?.close();
    delete process.env.MAITIAN_CONFIG; delete process.env.MAITIAN_DB;
    if (priorOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = priorOptions;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const data = await import('../src/db.mjs'); db = data.db;
  await import('../src/followers.mjs');
  data.setMeta('login:bilibili', 'ok');
  data.setMeta('login:bilibili@second', 'out');
  data.setMeta('loginReason:bilibili@second', '需要登录');
  data.setMeta('loginDay:bilibili@second', '2026/11/19');
  const { startWeb } = await import('../src/web.mjs'); server = startWeb();
  if (!server.listening) await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const http = globalThis.fetch;
  const cookie = 'mt_key=' + cfg.web.key;
  const get = route => http(base + route, { headers: { cookie } });
  const post = (route, body, headers = {}) => http(base + route, { method: 'POST', body: JSON.stringify(body), headers: { cookie, ...headers } });
  await t.test('protected settings redact the saved webhook', async () => {
    assert.equal((await http(base + '/api/integrations')).status, 401);
    const before = fs.readFileSync(file, 'utf8');
    assert.equal((await post('/api/integrations/site', { enabled: false }, { origin: 'https://other.invalid' })).status, 403);
    assert.equal((await post('/api/integrations/feishu', { webhook: 'x'.repeat(66000) })).status, 413);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    const view = await (await get('/api/integrations')).json();
    assert.equal(view.feishu.configured, true); assert.ok(!JSON.stringify(view).includes(hook));
    assert.equal((await post('/api/integrations/feishu', { login: true })).status, 200);
    assert.equal(JSON.parse(fs.readFileSync(file)).feishuWebhook, hook);
    const simulated = t.mock.method(globalThis, 'fetch', async url => {
      assert.equal(url, hook);
      return { ok: true, json: async () => ({ code: 0 }) };
    });
    try {
      assert.deepEqual(await (await post('/api/integrations/feishu/test', {})).json(), { ok: true });
      assert.equal(simulated.mock.callCount(), 1);
    } finally { simulated.mock.restore(); }
    const after = await (await get('/api/integrations')).json();
    assert.equal(after.feishu.lastTest.ok, true); assert.ok(after.feishu.lastTest.ts);
    assert.ok(!JSON.stringify(after).includes(hook));
  });
  await t.test('account rows and dispatched commands use the same full target ID', async () => {
    const overview = await (await get('/api/overview')).json();
    const rows = overview.health.platforms;
    const row = id => rows.find(p => p.id === id);
    assert.equal(row('bilibili').state, 'ok');
    assert.deepEqual(row('bilibili@second'), { id: 'bilibili@second', name: 'B站 · 副号', state: 'out', reason: '需要登录', day: '2026/11/19', disabled: false });
    assert.equal(row('instagram').disabled, true); assert.equal(row('zsz'), undefined);
    assert.equal((await post('/api/platform-toggle', { platform: 'bilibili', on: false })).status, 200);
    for (const platform of ['bilibili', 'bilibili@missing', null]) {
      assert.equal((await post('/api/action', { type: 'doctor', platform })).status, 400);
    }
    assert.equal((await post('/api/action', { type: 'doctor', platform: 'bilibili@second' })).status, 200);
    assert.equal((await post('/api/action', { type: 'login', platform: 'bilibili@second' })).status, 200);
    const commands = () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').slice(0, -1).map(JSON.parse) : [];
    for (let i = 0; i < 200 && commands().length < 2; i++) await wait(10);
    assert.deepEqual(commands().sort(), [['doctor', '--only', 'bilibili@second', '--quiet'], ['login', '--only', 'bilibili@second']]);
    assert.equal((await post('/api/platform-toggle', { platform: 'bilibili', on: true })).status, 200);
  });
});
