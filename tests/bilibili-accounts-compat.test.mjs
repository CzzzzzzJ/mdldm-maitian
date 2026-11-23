import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { accountsOf, getTargets } from '../src/targets.mjs';
import { accountTargets } from '../src/account-targets.mjs';

test('account management accepts the same unnamed legacy records as the collector', () => {
  const cfg = { bilibiliAccounts: [{ id: 'default', uid: '10' }, { id: 'second', uid: '20' }] };
  const names = targets => targets.filter(t => t.platform === 'bilibili').map(t => t.name);
  assert.deepEqual(names(getTargets(cfg)), names(accountTargets(cfg)));
  assert.deepEqual(accountsOf(cfg).map(a => a.name), ['默认账号', 'second']);
  assert.equal(cfg.bilibiliAccounts[1].name, undefined);
});

test('platform switches and account edits preserve legacy clients, identities and saved traffic', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mt-account-config-'));
  const file = path.join(dir, 'config.json');
  process.env.MAITIAN_CONFIG = file;
  process.env.MAITIAN_DB = path.join(dir, 'hub.db');
  const initial = { disabled: ['xhs'], unrelated: true, bilibiliAccounts: [
    { id: 'default', uid: '10' },
    { id: 'second', uid: '20', chromePort: 20300, chromeProfile: path.join(dir, 'profile'), privateField: 'retained' },
    { id: 'collected', name: '旧配置', enabled: false },
  ] };
  writeFileSync(file, JSON.stringify(initial));
  const { db } = await import('../src/db.mjs');
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const { setPlatformEnabled, saveBilibiliAccounts, bilibiliAccountView } = await import('../src/config-admin.mjs');
  const platforms = ['bilibili', 'xhs'];
  const disk = () => JSON.parse(readFileSync(file, 'utf8'));
  const activeIds = () => getTargets(disk()).filter(t => t.platform === 'bilibili').map(t => t.accountId);
  const accounts = () => bilibiliAccountView(disk());
  const edit = (rows, expectedAccounts = accounts()) => saveBilibiliAccounts({ action: 'replace', expectedAccounts, bilibiliAccounts: rows }, db);
  const assertSwitch = (on, id) => setPlatformEnabled('bilibili', on, platforms, id);
  assertSwitch(false);
  assert.deepEqual(activeIds(), []);
  assert.deepEqual(disk().bilibiliAccounts, initial.bilibiliAccounts);
  assert.deepEqual(disk().disabled, ['bilibili','xhs']);
  assertSwitch(true);
  assert.deepEqual(activeIds(), ['default','second']);
  assertSwitch(false, 'default');
  assert.deepEqual(activeIds(), ['second']);
  assertSwitch(true, 'default');
  assertSwitch(false);
  assertSwitch(false, 'default');
  assertSwitch(true, 'second');
  assert.deepEqual(activeIds(), []);
  assert.deepEqual(disk().disabled, ['bilibili','xhs']);
  assertSwitch(true);
  assert.deepEqual(activeIds(), ['second']);
  for (const params of [['bilibili' + '@second', true, platforms], ['xhs', false, platforms, 'second'], ['bilibili', false, platforms, 'missing']]) {
    assert.throws(() => setPlatformEnabled(...params));
  }

  // One identity is bound in config, the other only by its first successful collection.
  db.prepare('INSERT INTO account_traffic_identity(platform,uid) VALUES (?,?)').run('bilibili' + '@collected', '30');
  db.prepare('INSERT INTO account_traffic_state(platform,count) VALUES (?,?)').run('bilibili' + '@collected', 3);
  const previous = accounts();
  edit(previous.filter(a => a.id === 'default'));
  assert.throws(() => edit(previous, previous), /已变化/);
  const fresh = { id: '', name: '副号', uid: '20' }, collected = { id: '', name: '旧账号', uid: '30' };
  assert.throws(() => edit([...accounts(), fresh, fresh]), /重复/);
  assert.throws(() => edit([...accounts(), { ...collected, id:'different' }]), /UID/);
  edit([...accounts(), fresh, collected]);
  assert.deepEqual(accounts().map(a => a.id), ['default', 'second', 'collected']);
  const second = disk().bilibiliAccounts.find(a => a.id === 'second');
  assert.equal(second.privateField, 'retained');
  assert.equal(second.chromePort, initial.bilibiliAccounts[1].chromePort);
  assert.equal(second.chromeProfile, initial.bilibiliAccounts[1].chromeProfile);
  assert.equal(db.prepare('SELECT count FROM account_traffic_state WHERE platform=?').get('bilibili' + '@collected').count, 3);
  assert.throws(() => edit([...accounts(), fresh]), /重复|UID/);
  assert.throws(() => edit(accounts().map(a => a.id === 'collected' ? {...a,uid:'99'} : a)), /UID/);
  assert.equal(disk().unrelated, true);
});
