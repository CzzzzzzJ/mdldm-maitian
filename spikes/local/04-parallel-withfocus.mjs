// ④ 两个 space 各起一个进程，同时循环跑插件 withFocus 的同款逻辑，统计「操作时不在前台」的次数；
// 再给这一步加一把文件锁（只锁 withFocus 这一段，和开页时的切前台），看是否降到 0。先跑单进程基线。
// 用法：node spikes/local/04-parallel-withfocus.mjs [rounds] > scratch/04-parallel-withfocus.json
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { runEgoTask, finishSpace } from '../../src/ego-runner/index.mjs';

const FIXTURE = pathToFileURL(new URL('../../test/fixtures/basic.html', import.meta.url).pathname).href;
const LOCK = new URL('../../scratch/04-focus.lock', import.meta.url).pathname;
const ROUNDS = Number(process.argv[2] || 20);

// withFocus 照抄插件 lib/publish.js:78（插件没导出它）；lock=true 时整段包在文件锁里
const script = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fs = await import("node:fs");
async function withLock(fn) {
  if (!params.lock) return fn();
  for (;;) {
    try { fs.mkdirSync(params.LOCK); break; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      try { if (Date.now() - fs.statSync(params.LOCK).mtimeMs > 30000) fs.rmdirSync(params.LOCK); } catch {}
      await sleep(50);
    }
  }
  try { return await fn(); } finally { fs.rmdirSync(params.LOCK); }
}
async function withFocus(tabId, fn) {
  const tab = await chrome.tabs.get(tabId);
  const [prev] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  await chrome.tabs.update(tabId, { active: true });
  await sleep(1000);
  try { return await fn(); }
  finally { if (prev && prev.id !== tabId) await chrome.tabs.update(prev.id, { active: true }).catch(() => {}); }
}
// 开页也会切前台（active: true），加锁的那组把这一步也包进锁里
const [user, target] = await withLock(async () => {
  const u = await chrome.tabs.create({ url: params.FIXTURE + "#user-" + params.who, active: true });
  const t = await chrome.tabs.create({ url: params.FIXTURE + "#target-" + params.who, active: false });
  await chrome.tabs.update(u.id, { active: true });
  return [u, t];
});
const state = async () => {
  const r = await chrome.debugger.sendCommand({ tabId: target.id }, "Runtime.evaluate", { expression: "({ focus: document.hasFocus(), visibility: document.visibilityState })", returnByValue: true });
  const active = (await chrome.tabs.get(target.id)).active;
  return { ...r.result.value, active };
};
const bad = (s) => !s.focus || s.visibility !== "visible" || !s.active;
const rounds = [];
const t0 = Date.now();
for (let i = 0; i < params.rounds; i++) {
  const samples = await withLock(() => withFocus(target.id, async () => {
    const out = [];
    for (let k = 0; k < 3; k++) { out.push(await state()); await sleep(150); }   // 「操作」期间采样 3 次
    return out;
  }));
  const after = await chrome.tabs.query({ active: true });
  rounds.push({ i, bad: samples.some(bad), samples, restoredToUser: after.map((t) => t.id).includes(user.id) });
}
return {
  who: params.who, lock: params.lock, rounds: rounds.length, ms: Date.now() - t0,
  notForeground: rounds.filter((r) => r.bad).length,
  badSamples: rounds.flatMap((r) => r.samples).filter(bad).length,
  notRestored: rounds.filter((r) => !r.restoredToUser).length,
  firstBad: rounds.find((r) => r.bad) ?? null,
};`;

async function trial(lock, who = ['A', 'B']) {
  rmSync(LOCK, { recursive: true, force: true });
  const tag = randomBytes(3).toString('hex');
  const spaces = who.map((w) => `kinso/test/focus-${w}-${tag}`);
  const res = await Promise.all(spaces.map((space, i) => runEgoTask({
    space, script, timeoutMs: 15 * 60_000,
    params: { FIXTURE, LOCK, lock, rounds: ROUNDS, who: 'AB'[i] },
  })));
  for (const s of spaces) await finishSpace(s);
  return res.map((r) => (r.ok ? r.result : { reason: r.reason, error: r.error, output: (r.stdout + r.stderr).slice(-600) }));
}

const out = { rounds: ROUNDS, singleBaseline: await trial(false, ['A']), noLock: await trial(false), withLock: await trial(true) };
console.log(JSON.stringify(out, null, 2));
