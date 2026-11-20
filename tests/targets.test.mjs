import test from 'node:test';
import assert from 'node:assert/strict';

const model = await import('../src/targets.mjs').catch(() => ({}));
const old = { chromePort: 9333, chromeProfile: '/tmp/maitian-profile' };
const cfg = { ...old, enabledPlatforms: ['bilibili'], bilibiliAccounts: [
  { id: 'default', name: '主号', uid: '100', enabled: true },
  { id: 'second', name: '副号', uid: '200', enabled: true },
] };

test('account browsers have distinct stable resources independent of list order', () => {
  const a = model.getTargets?.(cfg), b = model.getTargets?.({ ...cfg, bilibiliAccounts: cfg.bilibiliAccounts.toReversed() });
  assert.equal(a?.[0]?.id, 'bilibili');
  assert.notEqual(a?.[0]?.chromePort, a?.[1]?.chromePort);
  assert.notEqual(a?.[0]?.chromeProfile, a?.[1]?.chromeProfile);
  assert.deepEqual(a?.find(t => t.id === 'bilibili@second'), b?.find(t => t.id === 'bilibili@second'));
});
test('shared login directories, duplicate ports and invalid account identifiers are rejected', () => {
  for (const extra of [{ chromePort: 9333 }, { chromeProfile: '/tmp/maitian-profile/../maitian-profile' }, { id: '../escape' }, { uid: '100' }]) {
    assert.throws(() => model.getTargets({ ...cfg, bilibiliAccounts: [cfg.bilibiliAccounts[0], { ...cfg.bilibiliAccounts[1], ...extra }] }), /端口|目录|账号|UID/);
  }
});
test('the site switch uses the configured service name', () => {
  const cfg = { site: { name: '课程站', base: 'https://example.org' } };
  assert.equal(model.settingsView(cfg).platforms.find(p => p.id === 'zsz').name, '课程站');
  assert.equal(model.getTargets(cfg).find(p => p.id === 'zsz').name, '课程站');
});
