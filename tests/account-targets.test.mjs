import test from 'node:test';
import assert from 'node:assert/strict';
import { accountTargets } from '../src/account-targets.mjs';

test('legacy config is still supported and raw Bilibili accounts use independent profiles', () => {
  const legacy = accountTargets({ chromePort: 9334, chromeProfile: '/tmp/main', disabled: ['douyin'] });
  assert.deepEqual(legacy.map(t => t.id), ['bilibili','xhs']);
  assert.ok(legacy.every(t => t.chromePort === 9334 && t.chromeProfile === '/tmp/main'));
  const mixed = accountTargets({ chromeProfile: '/tmp/main', bilibiliAccounts: [
    { id:'second', name:'副号', uid:'42' }, { id:'off', name:'停用', enabled:false }, { id:'removed', name:'已删', removed:true },
  ] });
  assert.deepEqual(mixed.map(t=>t.id), ['bilibili','bilibili@second','douyin','xhs']);
  const second = mixed.find(t=>t.id==='bilibili@second');
  assert.equal(second.chromeProfile,'/tmp/main-accounts/second');
  assert.notEqual(second.chromePort,9333);
  assert.equal(second.uid,'42');
  assert.equal(second.name,'B站 · 副号');
});
test('profile and identity collisions cannot read another configured account', () => {
  const one = { id:'one', name:'一', chromeProfile:'/tmp/one', chromePort:22000, uid:'42' };
  assert.throws(() => accountTargets({ bilibiliAccounts:[one,{...one,id:'two',uid:'43'}] }), /无效或重复/);
  assert.throws(() => accountTargets({ bilibiliAccounts:[one,{...one,id:'two',chromeProfile:'/tmp/two',chromePort:22001}] }), /UID 无效或重复/);
  assert.deepEqual(accountTargets({ disabled:['bilibili','xhs','douyin'] }), []);
});
