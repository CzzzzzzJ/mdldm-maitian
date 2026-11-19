// runner 的 space 锁、心跳、截止时间和命令行退出码（不需要 Ego Lite）：用 test/fixtures/fake-ego 代替真 CLI。
// 假 Ego 跟真的一样，杀掉 CLI 不会停掉脚本。
import { LOCKS_DIR } from './helpers/ops-dir.mjs';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEgoTask, finishSpace } from '../src/ego-runner/index.mjs';
import { tryLock, readLock, releaseLock, spaceLockPath } from '../src/ego-runner/locks.mjs';

const FAKE_DIR = fileURLToPath(new URL('./fixtures/fake-ego/', import.meta.url));
const FAKE_BIN = join(FAKE_DIR, 'ego-browser');
const CLI = fileURLToPath(new URL('../src/ego-runner/cli.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const uniqueSpace = (tag) => `kinso/test/${tag}-${process.pid}-${n++}`;

/** 起一个 CLI 进程，返回退出码、最后一行 JSON 和从起进程到退出的毫秒数。 */
function cli(args, input, env = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const c = spawn(process.execPath, [CLI, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${FAKE_DIR}:${process.env.PATH}`, ...env },
    });
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve({ code, ms: Date.now() - t0, json: JSON.parse(out.trim().split('\n').at(-1) || 'null'), err }));
    c.stdin.end(input);
  });
}

beforeEach(() => { delete process.env.FAKE_EGO_SPACES; delete process.env.FAKE_EGO_PROFILES; delete process.env.FAKE_EGO_LOG; });

describe('space 锁：runner（不需要 Ego Lite）', () => {
  test('两个进程抢同一个 space：一个拿到，另一个立即拿到 busy（退出码 5）', async () => {
    const space = uniqueSpace('race');
    const slow = 'await new Promise((r) => setTimeout(r, 2500)); return "done"';
    const [a, b] = await Promise.all([cli(['--space', space], slow), cli(['--space', space], slow)]);
    const [winner, loser] = a.code === 0 ? [a, b] : [b, a];
    assert.equal(winner.code, 0, winner.err);
    assert.equal(winner.json.result, 'done');
    assert.equal(loser.code, 5, loser.err);
    assert.equal(loser.json.reason, 'busy');
    assert.equal(typeof loser.json.holder.pid, 'number');
    assert.ok(loser.ms < winner.ms - 1500, `busy 要立即返回，不等：busy ${loser.ms}ms，持锁的 ${winner.ms}ms`);
  });

  test('不同 space 能同时跑（两个任务时间重叠）', async () => {
    const script = 'const start = Date.now(); await new Promise((r) => setTimeout(r, 1500)); return { start, end: Date.now() }';
    const [a, b] = await Promise.all([cli(['--space', uniqueSpace('par')], script), cli(['--space', uniqueSpace('par')], script)]);
    assert.equal(a.code, 0, a.err); assert.equal(b.code, 0, b.err);
    assert.ok(a.json.result.start < b.json.result.end && b.json.result.start < a.json.result.end, JSON.stringify([a.json.result, b.json.result]));
  });

  test('任务结束后锁已释放，下一个任务能拿到', async () => {
    const space = uniqueSpace('seq');
    const a = await runEgoTask({ space, script: 'return 1', egoBin: FAKE_BIN });
    assert.equal(a.ok, true, a.error); assert.equal(a.lockReleased, true);
    assert.equal(readLock(spaceLockPath(LOCKS_DIR, space)), null);
    const b = await runEgoTask({ space, script: 'return 2', egoBin: FAKE_BIN });
    assert.equal(b.result, 2);
  });

  test('脚本里浏览器调用抛错：不吞，以失败退出，锁已释放', async () => {
    const space = uniqueSpace('throw');
    const r = await runEgoTask({ space, script: 'await chrome.tabs.get(999); return 1', egoBin: FAKE_BIN });
    assert.equal(r.ok, false); assert.equal(r.reason, 'exit-code');
    assert.match(r.stderr, /No tab with id: 999/);
    assert.equal(r.lockReleased, true);
    assert.equal(existsSync(spaceLockPath(LOCKS_DIR, space)), false);
  });

  test('脚本到截止时间自己退出（比 runner 超时早），reason=deadline，心跳停、锁已释放', async () => {
    const space = uniqueSpace('deadline');
    const t0 = Date.now();
    const r = await runEgoTask({ space, script: 'await new Promise(() => {})', egoBin: FAKE_BIN, timeoutMs: 3000, heartbeatMs: 100 });
    assert.equal(r.ok, false); assert.equal(r.reason, 'deadline', r.stderr);
    assert.ok(Date.now() - t0 < 3000, '应在 runner 超时之前由脚本自己退出');
    assert.equal(r.lockReleased, true);
    assert.equal(existsSync(spaceLockPath(LOCKS_DIR, space)), false);
  });

  test('超时后旧脚本心跳没停：锁不释放，别人拿到 busy；心跳停了之后能接管', async () => {
    const space = uniqueSpace('zombie');
    const timing = { egoBin: FAKE_BIN, heartbeatMs: 100, staleMs: 600 };
    const t0 = Date.now();
    // 截止时间设得比 runner 超时晚，模拟杀掉 CLI 后脚本仍在 Ego 里跑、心跳还在跳
    const r = await runEgoTask({ space, script: 'for (;;) await new Promise((r) => setTimeout(r, 100))', timeoutMs: 1500, deadlineMs: 5000, graceMs: 1000, ...timing });
    assert.equal(r.reason, 'timeout');
    assert.equal(r.lockReleased, false);
    const held = readLock(spaceLockPath(LOCKS_DIR, space));
    assert.ok(held && Date.now() - held.heartbeatAt < 600, '旧脚本还在写心跳');

    const t1 = Date.now();
    const busy = await runEgoTask({ space, script: 'return 2', ...timing });
    assert.equal(busy.reason, 'busy');
    assert.ok(Date.now() - t1 < 500, 'busy 要立即返回');

    let next;
    while (Date.now() - t0 < 10_000) {
      next = await runEgoTask({ space, script: 'return 3', ...timing });
      if (next.reason !== 'busy') break;
      await sleep(200);
    }
    assert.equal(next.ok, true, `${next.reason} ${next.error}`);
    assert.equal(next.result, 3);
    assert.ok(Date.now() - t0 >= 5000, '旧脚本到它的截止时间才停，在那之前不能接管');
  });

  test('超时后心跳在宽限期内停了：锁释放', async () => {
    const space = uniqueSpace('quiet');
    const r = await runEgoTask({ space, script: 'for (;;) await new Promise((r) => setTimeout(r, 100))', egoBin: FAKE_BIN, timeoutMs: 1500, deadlineMs: 2000, graceMs: 3000, heartbeatMs: 100, staleMs: 600 });
    assert.equal(r.reason, 'timeout');
    assert.equal(r.lockReleased, true);
    assert.equal(existsSync(spaceLockPath(LOCKS_DIR, space)), false);
  });

  test('lock:false 不取锁（别人持锁时照样跑）', async () => {
    const space = uniqueSpace('nolock');
    const held = tryLock(spaceLockPath(LOCKS_DIR, space));
    const r = await runEgoTask({ space, script: 'return 1', egoBin: FAKE_BIN, lock: false });
    releaseLock(held.lock);
    assert.equal(r.ok, true, r.error);
  });
});

describe('命令行退出码（不需要 Ego Lite）', () => {
  test('profile 在 Ego 里不存在：reason=profile-needed，退出码 3', async () => {
    const r = await cli(['--space', uniqueSpace('prof')], 'return 1', { FAKE_EGO_PROFILES: '[{"id":"Profile 4"}]' });
    assert.equal(r.code, 3, r.err); assert.equal(r.json.reason, 'profile-needed');
  });

  test('space 正由负责人手动操作：reason=user-controlled，退出码 4，--finish 也不去关', async () => {
    const space = uniqueSpace('user');
    const log = join(LOCKS_DIR, '..', `log-${process.pid}.jsonl`);
    const r = await cli(['--space', space, '--finish'], 'return 1', {
      FAKE_EGO_SPACES: JSON.stringify([{ id: 7, name: space, profileId: 'Profile 5', ownership: 'agentDelegatedToUser' }]),
      FAKE_EGO_LOG: log,
    });
    assert.equal(r.code, 4, r.err); assert.equal(r.json.reason, 'user-controlled');
    assert.equal(r.json.finish, undefined);
    assert.equal(existsSync(log) ? readFileSync(log, 'utf8') : '', '');
  });

  test('space 锁被别的任务进程持有：reason=busy，退出码 5，带持有者', async () => {
    const space = uniqueSpace('held');
    const held = tryLock(spaceLockPath(LOCKS_DIR, space));
    const r = await cli(['--space', space], 'return 1');
    releaseLock(held.lock);
    assert.equal(r.code, 5, r.err); assert.equal(r.json.reason, 'busy');
    assert.equal(r.json.holder.pid, process.pid);
  });

  test('其余失败退出码 1', async () => {
    const r = await cli(['--space', uniqueSpace('fail')], 'throw new Error("boom")');
    assert.equal(r.code, 1); assert.equal(r.json.reason, 'exit-code');
  });
});

describe('finishSpace 尊重 space 锁（不需要 Ego Lite）', () => {
  test('别的任务持锁时不关，返回 busy', async () => {
    const space = uniqueSpace('fin');
    const log = join(LOCKS_DIR, '..', `fin-${process.pid}.jsonl`);
    process.env.FAKE_EGO_LOG = log;
    process.env.FAKE_EGO_SPACES = JSON.stringify([{ id: 9, name: space, profileId: 'Profile 5', ownership: 'agent' }]);
    const held = tryLock(spaceLockPath(LOCKS_DIR, space));
    const r = await finishSpace(space, { egoBin: FAKE_BIN });
    releaseLock(held.lock);
    assert.equal(r.ok, false); assert.equal(r.reason, 'busy');
    assert.equal(existsSync(log), false, '不应调用任何 Ego 接口');
    const after = await finishSpace(space, { egoBin: FAKE_BIN });
    assert.equal(after.ok, true, after.error);
    assert.equal(existsSync(spaceLockPath(LOCKS_DIR, space)), false);
  });
});
