import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

test('settings, account views and background controls share the enabled target boundary', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-web-'));
  const configFile = path.join(dir, 'config.json');
  const key = 'private-dashboard-key';
  const accounts = [{ id: 'default', name: '主号', uid: '100', enabled: true }, { id: 'second', name: '副号', uid: '200', enabled: true }];
  fs.writeFileSync(configFile, JSON.stringify({ name: '测试麦田', rootPath: dir, driver: 'direct', enabledPlatforms: ['bilibili', 'douyin', 'zsz'], bilibiliAccounts: accounts,
    chromePort: 29333, chromeProfile: path.join(dir, 'chrome'), web: { port: 0, key, widgetToken: 'widget-only' }, keepAlive: ['douyin'],
    feishuWebhook: 'https://example.invalid/private-webhook', site: { name: '测试站', base: 'https://example.invalid' } }));
  process.env.MAITIAN_CONFIG = configFile; process.env.MAITIAN_DB = path.join(dir, 'hub.db');
  const data = await import('../src/db.mjs');
  const { db, upsertEpisode, setTask, saveMetric, saveSnapshot } = data;
  const { saveAccountVideos } = await import('../src/account-traffic.mjs');
  db.exec('CREATE TABLE IF NOT EXISTS followers (day TEXT, platform TEXT, total INTEGER, gain INTEGER, loss INTEGER, source TEXT, collected_at TEXT, PRIMARY KEY(day, platform))');
  const day = new Date().toLocaleDateString('sv-SE');
  const pj = { id: 'ep1', name: '测试一期', platforms: { bilibili: { title: '同一份文案', accounts: ['default', 'second'] }, douyin: { title: '抖音文案' } } };
  fs.writeFileSync(path.join(dir, 'publish.json'), JSON.stringify(pj));
  fs.mkdirSync(path.join(dir, '发布档案')); fs.writeFileSync(path.join(dir, '发布档案', 'bilibili@second.jpg'), Buffer.from('account-shot'));
  upsertEpisode({ id: 'ep1', episode: 1, name: '测试一期', dir, schedule: new Date(Date.now() - 864e5).toISOString() }); saveSnapshot('ep1', pj);
  for (const [id, views, fans] of [['bilibili', 10, 100], ['bilibili@second', 20, 200], ['douyin', 999, 999]]) {
    setTask('ep1', id, 'published'); saveMetric(day, 'ep1', id, { views });
    db.prepare('INSERT INTO followers VALUES (?,?,?,?,?,?,?)').run(day, id, fans, null, null, 'live', new Date().toISOString());
    saveAccountVideos(db, id, [{id:'video1',title:'已发布作品',url:'https://example.com/video1',views,likes:0}]);
  }
  const { startWeb } = await import('../src/web.mjs');
  const server = startWeb(); if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options = {}) => fetch(base + url, { ...options, headers: { cookie: `mt_key=${key}`, 'content-type': 'application/json', ...options.headers } });
  const put = (body) => request('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
  try {
    await t.test('settings require dashboard authentication and never return secrets', async () => {
      assert.equal((await fetch(base + '/api/settings')).status, 401);
      assert.equal((await fetch(base + '/api/settings', { method: 'PUT', body: '{}' })).status, 401);
      const res = await request('/api/settings'); assert.equal(res.status, 200);
      const body = await res.text();
      for (const secret of [key, 'private-webhook', dir, 'widget-only']) assert.ok(!body.includes(secret), `settings must not expose ${secret}`);
      assert.deepEqual(JSON.parse(body).bilibiliAccounts.map(a => a.id), ['default', 'second']);
    });
    await t.test('saving platform choices immediately filters every account data surface', async () => {
      const res = await put({ enabledPlatforms: ['bilibili'], bilibiliAccounts: accounts }); assert.equal(res.status, 200);
      const saved = JSON.parse(fs.readFileSync(configFile)); assert.equal(saved.web.key, key); assert.ok(saved.site); assert.ok(saved.feishuWebhook);
      const overview = await (await request('/api/overview?traffic=1')).json();
      assert.equal(overview.siteOn, false); assert.deepEqual(overview.targets.map(a => a.id), ['bilibili', 'bilibili@second']);
      assert.equal(overview.names['bilibili@second'], 'B站 · 副号');
      for (const prop of ['metrics', 'followers', 'samples']) assert.deepEqual([...new Set(overview[prop].map(a => a.platform))].sort(), ['bilibili', 'bilibili@second']);
      assert.equal(overview.episodes[0].views, 30); assert.equal(overview.episodes[0].tasks.length, 2);
      assert.deepEqual([...new Set(overview.accountTraffic.videos.map(v => v.platform))].sort(), ['bilibili','bilibili@second']);
      assert.deepEqual(overview.accountTraffic.statuses.map(s => s.id), ['bilibili','bilibili@second']);
      assert.deepEqual(overview.site.days, []); assert.deepEqual(overview.health.login, {});
      const detail = await (await request('/api/episode?id=ep1')).json();
      assert.equal(detail.views, 30); assert.equal(detail.metrics.length, 2);
      assert.equal(detail.tasks.find(a => a.platform === 'bilibili@second').copy.title, '同一份文案');
      assert.equal(detail.reviews[0].views, 30);
      const widget = await (await fetch(base + '/api/widget?t=widget-only')).json();
      assert.equal(widget.fans.total, 300); assert.equal(widget.latest.views, 30); assert.equal(widget.site, null);
    });
    await t.test('account screenshots preserve the full target id and reject traversal or disabled targets', async () => {
      const res = await request('/shot?id=ep1&p=bilibili%40second&full=1'); assert.equal(res.status, 200); assert.equal(await res.text(), 'account-shot');
      assert.equal((await request('/shot?id=ep1&p=..%2Fconfig&full=1')).status, 404);
      assert.equal((await request('/shot?id=ep1&p=douyin&full=1')).status, 404);
    });
    await t.test('malformed, oversized or invalid settings cannot overwrite the config', async () => {
      const before = fs.readFileSync(configFile, 'utf8');
      for (const body of ['{', 'null', '[]', '1']) assert.equal((await request('/api/settings', { method: 'PUT', body })).status, 400);
      assert.equal((await put({ enabledPlatforms: ['unknown'], bilibiliAccounts: accounts })).status, 400);
      assert.equal((await request('/api/settings', { method: 'PUT', body: ' '.repeat(65537) })).status, 413);
      assert.equal(fs.readFileSync(configFile, 'utf8'), before);
    });
    await t.test('cross-origin writes cannot change settings or start account work', async () => {
      const before = fs.readFileSync(configFile, 'utf8');
      assert.equal((await request('/api/settings', { method: 'PUT', headers: { origin: 'https://untrusted.invalid' }, body: JSON.stringify({ enabledPlatforms: ['bilibili'], bilibiliAccounts: accounts }) })).status, 403);
      assert.equal((await request('/api/action', { method: 'POST', headers: { origin: 'null' }, body: JSON.stringify({ type: 'accountLogin', accountId: 'default' }) })).status, 403);
      assert.equal(fs.readFileSync(configFile, 'utf8'), before);
    });
    await t.test('invalid account actions are rejected before any worker starts', async () => {
      for (const type of ['accountLogin', 'accountCheck']) {
        assert.equal((await request('/api/action', { method: 'POST', body: JSON.stringify({ type, accountId: '../bad' }) })).status, 400);
        assert.equal((await request('/api/action', { method: 'POST', body: JSON.stringify({ type, accountId: 'missing' }) })).status, 400);
      }
    });
    await t.test('board sync exports each enabled account and excludes disabled history', async () => {
      const { config } = await import('../src/feishu.mjs');
      fs.mkdirSync(new URL('../data', import.meta.url), { recursive: true });
      config.board = { baseToken: 'test-only', tables: { episodes: 'episodes', tasks: 'tasks', daily: 'daily' } };
      const captured = path.join(dir, 'board-calls.jsonl'), cli = path.join(dir, 'lark-cli');
      fs.writeFileSync(cli, `#!/usr/bin/env node\nconst fs = require('node:fs'); const a = process.argv.slice(2); const body = JSON.parse(fs.readFileSync(a[a.indexOf('--json') + 1].slice(1))); fs.appendFileSync(${JSON.stringify(captured)}, JSON.stringify({ table: a[a.indexOf('--table-id') + 1], body }) + '\\n'); console.log(JSON.stringify({ ok: true, data: { record_id_list: (body.create_records || []).map((_, i) => 'test-' + i) } }));\n`, { mode: 0o700 });
      const oldPath = process.env.PATH; process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
      try {
        const { boardSync } = await import('../src/board.mjs');
        const result = await boardSync({ site: false }); assert.equal(result.平台发布, 2); assert.equal(result.每日流量, 2);
        const calls = fs.readFileSync(captured, 'utf8').trim().split('\n').map(s => JSON.parse(s));
        assert.deepEqual(calls.find(c => c.table === 'tasks').body.create_records.map(r => r.平台[0]), ['B站 · 主号', 'B站 · 副号']);
        assert.equal(calls.find(c => c.table === 'episodes').body.create_records[0].全平台播放, 30);
      } finally { process.env.PATH = oldPath; delete config.board; }
    });
    await t.test('external config updates become visible without restarting the server', async () => {
      const cfg = JSON.parse(fs.readFileSync(configFile)); cfg.enabledPlatforms = [];
      fs.writeFileSync(configFile, JSON.stringify(cfg));
      const overview = await (await request('/api/overview')).json();
      assert.deepEqual(overview.targets, []); assert.deepEqual(overview.episodes[0].tasks, []); assert.equal(overview.episodes[0].views, 0);
      assert.deepEqual(overview.metrics, []); assert.deepEqual(overview.followers, []); assert.deepEqual(overview.samples, []);
      const traffic = await (await request('/api/overview?traffic=1')).json();
      assert.deepEqual(traffic.accountTraffic.videos, []); assert.deepEqual(traffic.accountTraffic.statuses, []);
    });
  } finally {
    await new Promise(resolve => server.close(resolve)); db.close();
    delete process.env.MAITIAN_CONFIG; delete process.env.MAITIAN_DB; fs.rmSync(dir, { recursive: true, force: true });
  }
});
