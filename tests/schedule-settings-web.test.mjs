import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';

test('schedule settings validate and persist atomically, preserve other settings, and reject stale edits', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-schedule-settings-'));
  const configFile = path.join(dir, 'config.json');
  const original = { web: { port: 0, key: 'fixture' }, rootPath: dir, site: { enabled: false }, disabled: ['xhs'] };
  fs.writeFileSync(configFile, JSON.stringify(original));
  process.env.MAITIAN_CONFIG = configFile;
  process.env.MAITIAN_DB = path.join(dir, 'hub.db');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { startWeb } = await import('../src/web.mjs');
  const server = startWeb();
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const url = base + '/api/schedules';
  const headers = { cookie: 'mt_key=' + original.web.key, 'content-type': 'application/json' };
  const post = (body, extra) => fetch(url, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  const get = async () => (await fetch(url, { headers })).json();
  const state = () => JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const hourly = { mode: 'interval', minutes: 60 };
  const initial = { sales: hourly, daemon: hourly };
  const daily = { mode: 'daily', times: ['08:00', '20:30'] };
  const schedules = { sales: daily, daemon: { mode: 'interval', minutes: 90 } };
  assert.equal((await fetch(url)).status, 401);
  assert.deepEqual(await get(), initial);
  assert.equal((await post({ schedules }, { origin: 'https://elsewhere.invalid' })).status, 403);
  assert.equal((await post({ schedules }, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ schedules: { ...initial, sales: { mode: 'daily', times: ['25:00'] } } })).status, 400);
  assert.equal((await post({ schedules: { sales: daily, daemon: { mode: 'interval', minutes: 0 } } })).status, 400);
  assert.deepEqual(state(), original);

  const disk = { ...original, custom: { untouched: true } };
  fs.writeFileSync(configFile, JSON.stringify(disk));
  const saved = await post({ schedules, expectedSchedules: initial });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), schedules);
  assert.deepEqual(await get(), schedules);
  assert.deepEqual((await (await fetch(base + '/api/integrations', { headers })).json()).schedules, schedules);
  assert.deepEqual(state(), { ...disk, schedules });
  assert.deepEqual(JSON.parse(fs.readFileSync(configFile + '.bak', 'utf8')), disk);
  const stale = await post({ schedules: initial, expectedSchedules: initial });
  assert.equal(stale.status, 409);
  assert.deepEqual(state(), { ...disk, schedules });

  fs.writeFileSync(configFile, JSON.stringify({ ...disk, schedules: initial }));
  assert.deepEqual(await get(), initial);
  assert.deepEqual((await (await fetch(base + '/api/integrations', { headers })).json()).schedules, initial);
  assert.equal((await post({ schedules, expectedSchedules: initial })).status, 200);

  const { config } = await import('../src/feishu.mjs');
  config.web.key = '';
  const before = state();
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await post({ schedules: initial })).status, 401);
  assert.equal(Object.hasOwn(await (await fetch(base + '/api/integrations')).json(), 'schedules'), false);
  assert.deepEqual(state(), before);
});
