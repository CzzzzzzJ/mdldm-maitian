// ③ 补测：ego-browser CLI 被 kill -9 后，脚本还在不在跑；怎么才能停掉它。
// 用法：node spikes/local/03b-orphan-stop.mjs > scratch/03b-orphan-stop.json
// 脚本每 500ms 调一次 page.evaluate 并把计数写进心跳文件（每个试验一个文件），从心跳是否还在涨判断脚本是否还活着。
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { finishSpace } from '../../src/ego-runner/index.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCRATCH = new URL('../../scratch/', import.meta.url).pathname;

async function trial(name, args, { kill = true, finishAfterKill = false } = {}) {
  const hb = `${SCRATCH}03b-hb-${name}.txt`;
  const read = () => (existsSync(hb) ? readFileSync(hb, 'utf8') : 'none');
  rmSync(hb, { force: true });
  const space = `kinso/test/orphan-${name}-${Date.now().toString(36)}`;
  const src = `const fs = await import("node:fs");
const t = await taskSpace(${JSON.stringify(space)}, { profileId: "Profile 5" });
const p = t.page("p1");
for (let i = 1; i <= 60; i++) {
  let s = "ok";
  try { await p.evaluate(() => 1); } catch (e) { s = "err:" + e.message.slice(0, 60); }
  fs.writeFileSync(${JSON.stringify(hb)}, i + " " + s);
  await new Promise((r) => setTimeout(r, 500));
}`;
  const c = spawn('ego-browser', ['nodejs', ...args], { stdio: ['pipe', 'ignore', 'ignore'] });
  c.stdin.end(src);
  await sleep(3000);
  if (kill) c.kill('SIGKILL');
  await sleep(2500);
  const r = { at5_5s: read() };
  await sleep(1500); r.at7s = read();
  await sleep(5000); r.at12s = read();
  if (finishAfterKill) { await finishSpace(space); await sleep(2500); r.afterFinish = read(); await sleep(1500); r.afterFinishPlus1_5s = read(); }
  await finishSpace(space);
  if (!kill) c.kill('SIGKILL');
  rmSync(hb, { force: true });
  return r;
}

const id = () => Date.now().toString(36);
console.log(JSON.stringify({
  plainKilledAt3sThenFinish: await trial('plain', [], { finishAfterKill: true }),
  sessionTimeout600sKilledAt3s: await trial('s1', ['--session', `orphan-a-${id()}`, '--timeout-ms', '600000']),
  sessionTimeout6sNotKilled: await trial('s2', ['--session', `orphan-b-${id()}`, '--timeout-ms', '6000'], { kill: false }),
}, null, 2));
