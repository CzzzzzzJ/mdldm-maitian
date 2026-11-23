import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

test('account editor is authenticated and only saves validated Bilibili account fields', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-account-web-'));
  process.env.MAITIAN_CONFIG = path.join(tmp, 'config.json');
  process.env.MAITIAN_DB = path.join(tmp, 'data.db');
  const disk = () => JSON.parse(fs.readFileSync(process.env.MAITIAN_CONFIG, 'utf8'));
  const seed = {
    web: { port: 0, key: 'test-key' }, feishuWebhook: 'private-placeholder',
    disabled: ['xhs'], rootPath: tmp,
    bilibiliAccounts: [{ id: 'second', name: '副号', uid: '200', chromePort: 23456, chromeProfile: path.join(tmp, 'private-profile') }],
  };
  fs.writeFileSync(process.env.MAITIAN_CONFIG, JSON.stringify(seed));
  const { startWeb } = await import('../src/web.mjs');
  const server = startWeb();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/bilibili-accounts`;
  const auth = { cookie: 'mt_key=test-key' };
  const post = body => fetch(url, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: auth, body: '{}' })).status, 415);
  const initial = await (await fetch(url, { headers: auth })).json();
  assert.deepEqual(initial.bilibiliAccounts.map(a => a.id), ['default', 'second']);
  assert.doesNotMatch(JSON.stringify(initial), /private|chromePort|test-key/);

  const defaultAccount = { id: 'default', name: '主号', uid: '100', enabled: true };
  const secondAccount = { id: 'second', name: '  更新副号  ', uid: '201', enabled: false };
  const bad = await post({ action: 'replace', bilibiliAccounts: [defaultAccount, { ...secondAccount, chromeProfile: 'unexpected' }] });
  assert.equal(bad.status, 400);
  assert.equal((await post({ action: 'replace', bilibiliAccounts: [defaultAccount, { ...secondAccount, uid: '100' }] })).status, 400);
  assert.deepEqual(disk(), seed);

  const saved = await post({ action: 'replace', bilibiliAccounts: [defaultAccount, secondAccount] });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { bilibiliAccounts: [defaultAccount, { ...secondAccount, name: '更新副号' }] });
  const { bilibiliAccounts: savedAccounts, ...other } = disk();
  const { bilibiliAccounts: _, ...oldOther } = seed;
  assert.deepEqual(other, oldOther);
  assert.equal(savedAccounts[1].chromeProfile, seed.bilibiliAccounts[0].chromeProfile);
  assert.equal(savedAccounts[1].chromePort, seed.bilibiliAccounts[0].chromePort);

  const removed = await post({ action: 'replace', bilibiliAccounts: [defaultAccount] });
  assert.equal(removed.status, 200);
  assert.deepEqual((await removed.json()).bilibiliAccounts, [defaultAccount]);
  assert.equal(disk().bilibiliAccounts[1].removed, true);
  const restored = await post({ action: 'replace', bilibiliAccounts: [{ ...secondAccount, enabled: true }] });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).bilibiliAccounts.length, 2);
  const rows = disk().bilibiliAccounts;
  assert.equal(rows.find(a => a.id === 'second').chromePort, 23456);
  assert.equal(rows.find(a => a.id === 'default').name, '主号');
});
