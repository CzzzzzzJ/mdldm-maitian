import './helpers/ops-dir.mjs';   // 锁目录指到临时目录
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { runEgoTask, runEgoScript, parseResult, finishSpace } from '../src/ego-runner/index.mjs';
import { EGO_SKIP, tempSpaceName } from './helpers/ego.mjs';
import { LOCKS_DIR } from './helpers/ops-dir.mjs';
import { readLock, spaceLockPath } from '../src/ego-runner/locks.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HANG_BIN = fileURLToPath(new URL('./fixtures/hang-ego-browser.mjs', import.meta.url));
const CLI = fileURLToPath(new URL('../src/ego-runner/cli.mjs', import.meta.url));

describe('parseResult（不需要 Ego Lite）', () => {
  test('最后一行 @@RESULT 解析成结果', () => {
    assert.deepEqual(parseResult('log\n@@RESULT {"a":1}\n', 0), { ok: true, result: { a: 1 } });
  });
  test('结果行后面只跟 Ego 的提示行也算最后一行', () => {
    assert.deepEqual(parseResult('@@RESULT 7\n[ego-browser:notice] update\n', 0), { ok: true, result: 7 });
  });
  test('没有 @@RESULT 行是失败', () => {
    const r = parseResult('hello\n', 0);
    assert.equal(r.ok, false); assert.equal(r.reason, 'no-result');
  });
  test('@@RESULT 后面不是最后一行是失败', () => {
    const r = parseResult('@@RESULT 1\nmore output\n', 0);
    assert.equal(r.ok, false); assert.equal(r.reason, 'no-result');
  });
  test('JSON 坏了是失败', () => {
    const r = parseResult('@@RESULT {bad\n', 0);
    assert.equal(r.ok, false); assert.equal(r.reason, 'bad-json');
  });
  test('退出码非零是失败，即使有结果行', () => {
    const r = parseResult('@@RESULT {"a":1}\n', 2);
    assert.equal(r.ok, false); assert.equal(r.reason, 'exit-code'); assert.equal(r.code, 2);
  });
});

describe('runEgoTask 参数检查（不需要 Ego Lite）', () => {
  test('Profile 6 被拒绝，不起子进程', async () => {
    const r = await runEgoTask({ space: 'kinso/test/x', profileId: 'Profile 6', script: 'return 1', egoBin: '/nonexistent/ego-browser' });
    assert.equal(r.ok, false); assert.equal(r.reason, 'profile-rejected');
  });
  test('space 名不符合 kinso/<平台>/<uid> 被拒绝', async () => {
    const r = await runEgoTask({ space: 'someone-else', script: 'return 1', egoBin: '/nonexistent/ego-browser' });
    assert.equal(r.ok, false); assert.equal(r.reason, 'bad-space-name');
  });
  test('ego-browser 起不来是失败', async () => {
    const r = await runEgoScript('console.log(1)', { egoBin: '/nonexistent/ego-browser' });
    assert.equal(r.ok, false); assert.equal(r.reason, 'spawn-failed');
  });
  test('超时是失败：杀掉 CLI，返回 reason=timeout，不留子进程', async () => {
    const t0 = Date.now();
    // 2 秒：留够 node 冷启动的时间，让假程序先打出 pid 再被杀（300ms 时冷启动偶尔来不及）
    const r = await runEgoScript('console.log(1)', { egoBin: HANG_BIN, timeoutMs: 2000 });
    assert.ok(Date.now() - t0 < 6000, '超时后应很快返回');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'timeout');
    assert.match(r.error, /超过 2000ms/);
    const pid = Number(r.stderr.match(/hang-pid (\d+)/)?.[1]);
    assert.ok(pid > 0, '假 ego-browser 应已启动');
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, '子进程应已被杀掉');
  });
});

describe('runEgoTask 真实 Ego Lite', { skip: EGO_SKIP ?? false }, () => {
  const space = tempSpaceName('runner');
  after(() => finishSpace(space));

  test('脚本返回值经 @@RESULT 带回，space 在 Profile 5 上', async () => {
    const r = await runEgoTask({ space, params: { n: 41 }, script: 'return { n: params.n + 1, spaceName: task.name, spaceId: task.spaceId }' });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.n, 42);
    assert.equal(r.result.spaceName, space);
    const spaces = await runEgoScript(`console.log("@@RESULT " + JSON.stringify((await listTaskSpaces()).find((s) => s.name === ${JSON.stringify(space)})))`);
    assert.equal(spaces.result.profileId, 'Profile 5');
  });
  test('同名 space 第二次运行复用同一个', async () => {
    const a = await runEgoTask({ space, script: 'return task.spaceId' });
    const b = await runEgoTask({ space, script: 'return task.spaceId' });
    assert.equal(a.ok && b.ok, true);
    assert.equal(a.result, b.result);
  });
  test('脚本没返回值（缺 @@RESULT 行）是失败', async () => {
    const r = await runEgoTask({ space, script: 'console.log("done")' });
    assert.equal(r.ok, false); assert.equal(r.reason, 'no-result');
  });
  test('脚本抛错（退出码非零）是失败', async () => {
    const r = await runEgoTask({ space, script: 'throw new Error("boom")' });
    assert.equal(r.ok, false); assert.equal(r.reason, 'exit-code');
    assert.match(r.stderr + r.stdout, /boom/);
  });
  test('process.exit(3) 是失败', async () => {
    const r = await runEgoTask({ space, script: 'console.log("@@RESULT 1"); process.exit(3)' });
    assert.equal(r.ok, false); assert.equal(r.reason, 'exit-code'); assert.equal(r.code, 3);
  });
  test('Ego 里的脚本自己写心跳文件；结束后锁释放', async () => {
    const lockPath = spaceLockPath(LOCKS_DIR, space);
    const running = runEgoTask({ space, heartbeatMs: 200, script: 'await new Promise((r) => setTimeout(r, 2000)); return 1' });
    let seen = null;
    for (let i = 0; i < 30 && !seen; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const l = readLock(lockPath);
      if (l && l.heartbeatAt > l.startedAt) seen = l;
    }
    const r = await running;
    assert.equal(r.ok, true, r.error);
    assert.ok(seen, '运行期间锁的心跳时间应由脚本更新');
    assert.equal(r.lockReleased, true);
    assert.equal(readLock(lockPath), null);
  });
  test('脚本到截止时间自己退出，reason=deadline，锁已释放', async () => {
    const t0 = Date.now();
    const r = await runEgoTask({ space, timeoutMs: 6000, script: 'await new Promise(() => {})' });
    assert.equal(r.reason, 'deadline', r.stderr + r.stdout);
    assert.ok(Date.now() - t0 < 6000);
    assert.equal(r.lockReleased, true);
  });
  test('脚本里能加载插件 lib', async () => {
    const r = await runEgoTask({ space, script: 'const cdp = await loadPlugin("lib/cdp.js"); const pub = await loadPlugin("lib/publish.js"); return { evaluate: typeof cdp.evaluate, preflight: typeof pub.preflight }' });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.result, { evaluate: 'function', preflight: 'function' });
  });
});

describe('命令行入口', () => {
  const cli = (args, input) => new Promise((resolve) => {
    const c = spawn(process.execPath, [CLI, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, json: JSON.parse(out.trim().split('\n').at(-1)) }));
    c.stdin.end(input);
  });

  test('Profile 6 被拒绝，退出码 1', async () => {
    const r = await cli(['--space', 'kinso/test/x', '--profile', 'Profile 6'], 'return 1');
    assert.equal(r.code, 1); assert.equal(r.json.reason, 'profile-rejected');
  });

  test('从 stdin 读脚本跑完并 --finish 关掉 space', { skip: EGO_SKIP ?? false }, async () => {
    const space = tempSpaceName('cli');
    const r = await cli(['--space', space, '--params', '{"x":2}', '--finish'], 'return params.x * 21');
    assert.equal(r.code, 0);
    const { finish, ...task } = r.json;
    assert.deepEqual(task, { ok: true, result: 42, code: 0, signal: null, lockReleased: true });
    assert.equal(finish.ok, true); assert.equal(finish.result.closedSpace, true);
    const left = await runEgoScript(`console.log("@@RESULT " + JSON.stringify((await listTaskSpaces()).some((s) => s.name === ${JSON.stringify(space)})))`);
    assert.equal(left.result, false);
  });
});
