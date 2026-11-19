// openSpace 门禁（不需要 Ego Lite）：用假的 ego 全局函数覆盖各条分支。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openSpace, FORBIDDEN_PROFILE } from '../src/ego-runner/space.mjs';

const NAME = 'kinso/test/demo';
function fakeEgo(spaces, profileIds = ['Profile 5']) {
  const calls = [];
  return {
    calls,
    profiles: async () => profileIds.map((id) => ({ id })),
    listTaskSpaces: async () => spaces,
    taskSpace: async (...a) => { calls.push(['taskSpace', ...a]); return { via: 'taskSpace', a }; },
    claimTaskSpace: async (...a) => { calls.push(['claimTaskSpace', ...a]); return { via: 'claimTaskSpace', a }; },
  };
}

describe('openSpace 门禁（不需要 Ego Lite）', () => {
  test('空 profileId 抛错，不调任何接口', async () => {
    const ego = fakeEgo([]);
    await assert.rejects(openSpace(ego, { name: NAME, profileId: '' }), /不允许使用/);
    await assert.rejects(openSpace(ego, { name: NAME }), /不允许使用/);
    assert.deepEqual(ego.calls, []);
  });
  test('Profile 6 抛错，不调任何接口', async () => {
    const ego = fakeEgo([{ id: 1, name: NAME, profileId: FORBIDDEN_PROFILE, ownership: 'agent' }]);
    await assert.rejects(openSpace(ego, { name: NAME, profileId: FORBIDDEN_PROFILE }), /Profile 6/);
    assert.deepEqual(ego.calls, []);
  });
  test('同名 space 在别的 profile 上抛错，不接管', async () => {
    const ego = fakeEgo([{ id: 7, name: NAME, profileId: 'Profile 6', ownership: 'agent' }]);
    await assert.rejects(openSpace(ego, { name: NAME, profileId: 'Profile 5' }), /在 Profile 6 上，不是 Profile 5/);
    assert.deepEqual(ego.calls, []);
  });
  test('ownership=agentDelegatedToUser 抛 user-controlled，不调接管', async () => {
    const ego = fakeEgo([{ id: 7, name: NAME, profileId: 'Profile 5', ownership: 'agentDelegatedToUser' }]);
    await assert.rejects(openSpace(ego, { name: NAME, profileId: 'Profile 5' }), { code: 'user-controlled', message: /由用户控制/ });
    assert.deepEqual(ego.calls, []);
  });
  test('profile 在 Ego 里不存在：抛 profile-needed，不建 space', async () => {
    const ego = fakeEgo([], ['Profile 4']);
    await assert.rejects(openSpace(ego, { name: NAME, profileId: 'Profile 5' }), { code: 'profile-needed' });
    assert.deepEqual(ego.calls, []);
  });
  test('agent 持有：taskSpace(id)', async () => {
    const ego = fakeEgo([{ id: 7, name: NAME, profileId: 'Profile 5', ownership: 'agent' }]);
    const t = await openSpace(ego, { name: NAME, profileId: 'Profile 5' });
    assert.equal(t.via, 'taskSpace');
    assert.deepEqual(ego.calls, [['taskSpace', 7]]);
  });
  test('user 持有（上次 finish 保留了页面）：claimTaskSpace(id)', async () => {
    const ego = fakeEgo([{ id: 7, name: NAME, profileId: 'Profile 5', ownership: 'user' }]);
    await openSpace(ego, { name: NAME, profileId: 'Profile 5' });
    assert.deepEqual(ego.calls, [['claimTaskSpace', 7]]);
  });
  test('不存在：taskSpace(name, { profileId })', async () => {
    const ego = fakeEgo([{ id: 8, name: 'kinso/other/x', profileId: 'Profile 5', ownership: 'agent' }]);
    await openSpace(ego, { name: NAME, profileId: 'Profile 5' });
    assert.deepEqual(ego.calls, [['taskSpace', NAME, { profileId: 'Profile 5' }]]);
  });
});
