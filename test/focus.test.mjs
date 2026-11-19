// 全局前台锁（不需要 Ego Lite）：两个 space 各一个进程，切前台的步骤必须串行。
import { LOCKS_DIR } from './helpers/ops-dir.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEgoTask } from '../src/ego-runner/index.mjs';
import { foregroundLockPath, tryLock, releaseLock } from '../src/ego-runner/locks.mjs';

const FAKE_BIN = fileURLToPath(new URL('./fixtures/fake-ego/ego-browser', import.meta.url));
let n = 0;
const space = (tag) => `kinso/test/${tag}-${process.pid}-${n++}`;
const overlapping = (xs) => {
  const s = [...xs].sort((a, b) => a.start - b.start);
  return s.slice(1).filter((x, i) => x.start < s[i].end).map((x, i) => [s[i], x]);
};
const run = (script, opts = {}) => runEgoTask({ space: space('focus'), script, egoBin: FAKE_BIN, ...opts });
const ok = (r) => { assert.equal(r.ok, true, `${r.reason} ${r.error}\n${r.stderr}`); return r.result; };

describe('前台锁（不需要 Ego Lite）', () => {
  test('withFocus：两个进程的持锁区间不重叠', async () => {
    const script = `const out = [];
      for (let i = 0; i < 5; i++) await withFocus(async () => {
        const start = Date.now(); await new Promise((r) => setTimeout(r, 120)); out.push({ start, end: Date.now(), who: params.who });
      });
      return out;`;
    const [a, b] = await Promise.all([run(script, { params: { who: 'A' } }), run(script, { params: { who: 'B' } })]);
    const all = [...ok(a), ...ok(b)];
    assert.equal(all.length, 10);
    assert.deepEqual(overlapping(all), []);
  });

  test('tabs.create/update({active:true}) 的切前台：两个进程不重叠', async () => {
    const log = join(LOCKS_DIR, '..', `front-${process.pid}.jsonl`);
    process.env.FAKE_EGO_LOG = log;
    process.env.FAKE_EGO_FRONT_MS = '120';
    try {
      const script = `const tab = await chrome.tabs.create({ url: "about:blank#x", active: true });
        for (let i = 0; i < 4; i++) await chrome.tabs.update(tab.id, { active: true });
        return tab.id;`;
      const [a, b] = await Promise.all([run(script), run(script)]);
      ok(a); ok(b);
      const fronts = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((c) => c.fn === 'bringToFront');
      assert.equal(fronts.length, 10);
      assert.equal(new Set(fronts.map((f) => f.pid)).size, 2, '应是两个进程');
      assert.deepEqual(overlapping(fronts), []);
    } finally { delete process.env.FAKE_EGO_LOG; delete process.env.FAKE_EGO_FRONT_MS; }
  });

  test('withFocus 嵌套、里面再切前台：不死锁，用完释放', async () => {
    const r = await run(`const tab = await chrome.tabs.create({ url: "about:blank#n" });
      return await withFocus(() => withFocus(async () => { await chrome.tabs.update(tab.id, { active: true }); return "inner"; }));`, { timeoutMs: 5000 });
    assert.equal(ok(r), 'inner');
    assert.equal(existsSync(foregroundLockPath(LOCKS_DIR)), false);
  });

  test('前台锁是等待型：别人持锁时等，等超过 focusTimeoutMs 抛错', async () => {
    const held = tryLock(foregroundLockPath(LOCKS_DIR));
    try {
      const t0 = Date.now();
      const r = await run('return await withFocus(async () => 1)', { focusTimeoutMs: 800 });
      assert.equal(r.ok, false);
      assert.match(r.stderr, /等锁 .*foreground\.lock 超过 800ms/);
      assert.ok(Date.now() - t0 >= 800, '应等到超时才失败');
    } finally { releaseLock(held.lock); }
  });

  test('别人持锁一会儿就放：等到后拿到', async () => {
    const held = tryLock(foregroundLockPath(LOCKS_DIR));
    setTimeout(() => releaseLock(held.lock), 700);
    const t0 = Date.now();
    const r = await run('return await withFocus(async () => Date.now())', { focusTimeoutMs: 5000 });
    assert.ok(ok(r) - t0 >= 700, '应等到对方释放');
  });
});
