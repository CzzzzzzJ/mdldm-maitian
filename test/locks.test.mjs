// space 锁的接管规则（不需要 Ego Lite）：只看锁文件和进程。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tryLock, readLock, releaseLock, beat, spaceLockPath } from '../src/ego-runner/locks.mjs';

const WORKER = fileURLToPath(new URL('./fixtures/lock-worker.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freshDir = () => mkdtempSync(join(tmpdir(), 'locks-'));
// 一个已经退出的进程的 pid
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;

describe('space 锁（不需要 Ego Lite）', () => {
  test('锁文件名由 space 名转义 / 得到，同一目录下不同 space 不冲突', () => {
    const dir = freshDir();
    const a = tryLock(spaceLockPath(dir, 'kinso/Douyin/1'));
    const b = tryLock(spaceLockPath(dir, 'kinso/Douyin/2'));
    assert.equal(a.ok, true); assert.equal(b.ok, true);
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.lock')).sort(), ['kinso%2FDouyin%2F1.lock', 'kinso%2FDouyin%2F2.lock']);
  });

  test('锁文件里有 pid、开始时间、心跳时间；第二个人拿到 busy 和持有者信息', () => {
    const path = spaceLockPath(freshDir(), 'kinso/test/a');
    const a = tryLock(path, { meta: { space: 'kinso/test/a' } });
    assert.equal(a.ok, true);
    const held = readLock(path);
    assert.equal(held.pid, process.pid);
    assert.equal(held.space, 'kinso/test/a');
    assert.equal(typeof held.startedAt, 'number');
    assert.equal(typeof held.heartbeatAt, 'number');
    const b = tryLock(path);
    assert.equal(b.ok, false);
    assert.equal(b.holder.pid, process.pid);
  });

  test('释放后能再取；释放后不留锁文件和心跳文件', () => {
    const dir = freshDir();
    const path = spaceLockPath(dir, 'kinso/test/a');
    const a = tryLock(path);
    beat(a.lock);
    releaseLock(a.lock);
    assert.deepEqual(readdirSync(dir), []);
    assert.equal(tryLock(path).ok, true);
  });

  test('pid 已死且心跳过期：能接管', async () => {
    const path = spaceLockPath(freshDir(), 'kinso/test/a');
    assert.equal(tryLock(path, { pid: deadPid() }).ok, true);
    await sleep(150);
    const r = tryLock(path, { staleMs: 100 });
    assert.equal(r.ok, true);
    assert.equal(readLock(path).pid, process.pid);
  });

  test('pid 还活着：心跳过期也不能接管', async () => {
    const path = spaceLockPath(freshDir(), 'kinso/test/a');
    assert.equal(tryLock(path).ok, true);
    await sleep(150);
    assert.equal(tryLock(path, { staleMs: 100 }).ok, false);
  });

  test('pid 已死但心跳新鲜（脚本还在 Ego 里跑）：不能接管', async () => {
    const path = spaceLockPath(freshDir(), 'kinso/test/a');
    const held = tryLock(path, { pid: deadPid() });
    await sleep(150);
    beat(held.lock);
    assert.equal(tryLock(path, { staleMs: 100 }).ok, false);
  });

  test('脚本自己报了已停：pid 已死时马上能接管，不等过期', () => {
    const path = spaceLockPath(freshDir(), 'kinso/test/a');
    const held = tryLock(path, { pid: deadPid() });
    beat(held.lock, { stopped: true });
    assert.equal(tryLock(path, { staleMs: 60_000 }).ok, true);
  });

  test('几个进程同时接管同一把过期锁：只有一个成功', async () => {
    const path = spaceLockPath(freshDir(), 'kinso/test/a');
    assert.equal(tryLock(path, { pid: deadPid() }).ok, true);
    await sleep(150);
    const at = Date.now() + 800;
    const runs = Array.from({ length: 8 }, () => new Promise((resolve) => {
      const c = spawn(process.execPath, [WORKER, path, String(at), '100'], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      c.stdout.on('data', (d) => { out += d; });
      c.on('close', () => resolve(JSON.parse(out)));
    }));
    const results = await Promise.all(runs);
    const winners = results.filter((r) => r.ok);
    assert.equal(winners.length, 1, JSON.stringify(results));
    assert.equal(readLock(path).pid, winners[0].pid);
    assert.equal(existsSync(`${path}.takeover`), false, '接管用的临时保护文件不应残留');
  });
});
