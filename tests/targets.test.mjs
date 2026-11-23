import test from 'node:test';
import assert from 'node:assert/strict';
import { accountsOf, configuredPlatforms, getTarget, getTargets, matchesTarget, settingsView } from '../src/targets.mjs';

const legacy = { chromePort: 9333, chromeProfile: '/tmp/maitian-profile' };
const main = { id: 'default', name: '主号', uid: '100' };
const second = { id: 'second', name: '副号', uid: '200' };
const cfg = { ...legacy, bilibiliAccounts: [main, second] };

test('legacy configuration retains default IDs and the existing disabled switch', () => {
  const config = { ...legacy, disabled: ['douyin'] };
  assert.equal(getTarget(config, 'bilibili').accountId, 'default');
  assert.equal(getTarget(config, 'bilibili').chromePort, legacy.chromePort);
  assert.equal(getTarget(config, 'bilibili').chromeProfile, legacy.chromeProfile);
  assert.equal(configuredPlatforms(config).includes('douyin'), false);
  assert.throws(() => getTarget(config, 'douyin'), /未启用/);
  assert.deepEqual(config.disabled, ['douyin']);
});

test('disabled Bilibili excludes all of its account targets', () => {
  const config = { ...cfg, disabled: ['bilibili'] };
  assert.equal(getTargets(config).some(t => t.platform === 'bilibili'), false);
  assert.deepEqual(config.disabled, ['bilibili']);
});

test('account browsers have distinct stable resources independent of list order', () => {
  const a = getTargets(cfg).filter(t => t.platform === 'bilibili');
  const b = getTargets({ ...cfg, bilibiliAccounts: cfg.bilibiliAccounts.toReversed() });
  assert.equal(a[0].id, 'bilibili');
  assert.equal(a[1].id, 'bilibili@second');
  assert.notEqual(a[0].chromePort, a[1].chromePort);
  assert.equal(a[1].chromeProfile, '/tmp/maitian-profile-accounts/second');
  assert.deepEqual(a[1], b.find(t => t.id === 'bilibili@second'));
  assert.equal(matchesTarget(a[1].id, ['bilibili']), true);
  assert.equal(matchesTarget(a[0].id, ['bilibili@second']), false);
  assert.equal(getTarget({ ...legacy, bilibiliAccounts: [second] }, 'bilibili').accountId, 'default');
});

test('disabled secondary account stays separate from the legacy platform switch', () => {
  const config = { ...cfg, bilibiliAccounts: [main, { ...second, enabled: false }] };
  assert.equal(configuredPlatforms(config).includes('bilibili'), true);
  assert.deepEqual(getTargets(config).filter(t => t.platform === 'bilibili').map(t => t.id), ['bilibili']);
});

test('shared profiles, duplicate ports and invalid account identifiers are rejected', () => {
  for (const extra of [{ chromePort: 9333 }, { chromeProfile: '/tmp/maitian-profile/../maitian-profile' }, { id: '../escape' }, { uid: '100' }]) {
    assert.throws(() => accountsOf({ ...cfg, bilibiliAccounts: [main, { ...second, ...extra }] }), /端口|目录|账号|UID/);
  }
});

test('site target honors its own legacy switch and display name', () => {
  const config = { site: { name: '课程站', base: 'https://example.org' } };
  assert.equal(settingsView(config).platforms.find(p => p.id === 'zsz').name, '课程站');
  assert.equal(getTarget(config, 'zsz').name, '课程站');
  assert.throws(() => getTarget({ site: { ...config.site, enabled: false } }, 'zsz'), /未启用/);
});
