// finishSpace 和 cli --finish 的 profile 门禁（不需要 Ego Lite）：用 test/fixtures/fake-ego/ego-browser 代替真 CLI。
import './helpers/ops-dir.mjs';   // 锁目录指到临时目录
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finishSpace } from '../src/ego-runner/index.mjs';

const FAKE_DIR = fileURLToPath(new URL('./fixtures/fake-ego/', import.meta.url));
const FAKE_BIN = join(FAKE_DIR, 'ego-browser');
const CLI = fileURLToPath(new URL('../src/ego-runner/cli.mjs', import.meta.url));
const NAME = 'kinso/test/demo';
const dir = mkdtempSync(join(tmpdir(), 'fake-ego-'));
let logFile;
const calls = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const useSpaces = (spaces) => { process.env.FAKE_EGO_SPACES = JSON.stringify(spaces); };

describe('finishSpace profile 门禁（不需要 Ego Lite）', () => {
  beforeEach(() => { logFile = join(dir, `log-${Math.random().toString(36).slice(2)}.jsonl`); process.env.FAKE_EGO_LOG = logFile; });

  test('空 profileId 和 Profile 6 直接拒绝，不起子进程', async () => {
    for (const profileId of ['', 'Profile 6']) {
      const r = await finishSpace(NAME, { profileId, egoBin: '/nonexistent/ego-browser' });
      assert.equal(r.ok, false); assert.equal(r.reason, 'profile-rejected');
    }
  });
  test('同名 space 在 Profile 6 上：不接管、不 finish，返回 profile-mismatch', async () => {
    useSpaces([{ id: 9, name: NAME, profileId: 'Profile 6', ownership: 'agent' }]);
    const r = await finishSpace(NAME, { egoBin: FAKE_BIN });
    assert.equal(r.ok, false); assert.equal(r.reason, 'profile-mismatch');
    assert.deepEqual(calls(), []);
  });
  test('在 Profile 5 上的 agent space：taskSpace(id) 后 finish({keep:[]})', async () => {
    useSpaces([{ id: 9, name: NAME, profileId: 'Profile 5', ownership: 'agent' }]);
    const r = await finishSpace(NAME, { egoBin: FAKE_BIN });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(calls(), [{ fn: 'taskSpace', arg: 9 }, { fn: 'finish', id: 9, keep: [] }]);
  });
  test('不存在：什么都不做', async () => {
    useSpaces([]);
    const r = await finishSpace(NAME, { egoBin: FAKE_BIN });
    assert.equal(r.ok, true); assert.deepEqual(r.result, { closed: false, existed: false });
    assert.deepEqual(calls(), []);
  });
  test('cli --finish：任务因 space 在 Profile 6 上失败后，不会去关那个 space，退出码非零', () => {
    useSpaces([{ id: 9, name: NAME, profileId: 'Profile 6', ownership: 'agent' }]);
    const p = spawnSync(process.execPath, [CLI, '--space', NAME, '--finish'], {
      input: 'return 1', encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, PATH: `${FAKE_DIR}:${process.env.PATH}` },
    });
    assert.notEqual(p.status, 0, p.stdout + p.stderr);
    const out = JSON.parse(p.stdout.trim().split('\n').at(-1));
    assert.equal(out.ok, false);
    assert.equal(out.finish.reason, 'profile-mismatch');
    assert.deepEqual(calls(), []);
  });
});
