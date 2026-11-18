// ③ 跨进程找回：prepare 和 commit 分两个进程时，后一个进程能不能拿到前一个留下的页。
// 用法：node spikes/local/03-cross-process-recover.mjs > scratch/03-cross-process-recover.json
// 三种结束方式：A 正常退出不 finish；B 进程 1 被 kill -9；C 进程 1 finish({ keep }) 交还后再认领。
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { runEgoTask, runEgoScript, buildTaskSource, finishSpace, DEFAULT_PLUGIN_DIR } from '../../src/ego-runner/index.mjs';

const FIXTURE = pathToFileURL(new URL('../../test/fixtures/basic.html', import.meta.url).pathname).href;
const SCRATCH = new URL('../../scratch/', import.meta.url).pathname;
const tag = randomBytes(3).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spaceInfo = async (name) => (await runEgoScript(`console.log("@@RESULT " + JSON.stringify((await listTaskSpaces()).find((s) => s.name === ${JSON.stringify(name)}) ?? null))`)).result;

// 进程 2：找回 #<hash> 那一页，读进程 1 写的标记，再读两次心跳看进程 1 的脚本是否还在跑
const recoverScript = (hash) => `
const before = (await task.tabs()).map((t) => ({ label: t.label ?? null, url: t.url.split("#")[1], openedBy: t.openedBy }));
const ids = await recoverTabs(/#${hash}$/);
const read = (id, e) => chrome.debugger.sendCommand({ tabId: id }, "Runtime.evaluate", { expression: e, returnByValue: true }).then((r) => r.result.value);
const marker = ids.length ? await read(ids[0], "document.getElementById('marker').textContent") : null;
const beat1 = ids.length ? await read(ids[0], "window.__beat ?? null") : null;
await new Promise((r) => setTimeout(r, 3000));
const beat2 = ids.length ? await read(ids[0], "window.__beat ?? null") : null;
return { ownership: task.ownership, before, ids, marker, beat1, beat2 };`;

const out = {};

// A：进程 1 正常退出，不 finish（space 仍归 agent，Page label 保留）
{
  const space = `kinso/test/recover-a-${tag}`;
  const p1 = await runEgoTask({ space, params: { FIXTURE }, script: `
    const t = await chrome.tabs.create({ url: params.FIXTURE + "#a", active: false });
    await chrome.debugger.sendCommand({ tabId: t.id }, "Runtime.evaluate", { expression: "document.getElementById('marker').textContent = 'from-proc-1'" });
    return t.id;` });
  out.A = { proc1: p1.ok, spaceAfterProc1: await spaceInfo(space) };
  const p2 = await runEgoTask({ space, script: recoverScript('a') });
  out.A.proc2 = p2.ok ? p2.result : p2;
  await finishSpace(space);
}

// B：进程 1 打开页、写标记、开始心跳后被 kill -9（杀的是 ego-browser CLI 进程）
{
  const space = `kinso/test/recover-b-${tag}`;
  const ready = `${SCRATCH}03-ready-${tag}`;
  rmSync(ready, { force: true });
  const src = buildTaskSource({ space, profileId: 'Profile 5', params: { FIXTURE, ready }, pluginDir: DEFAULT_PLUGIN_DIR, script: `
    const t = await chrome.tabs.create({ url: params.FIXTURE + "#b", active: false });
    await chrome.debugger.sendCommand({ tabId: t.id }, "Runtime.evaluate", { expression: "document.getElementById('marker').textContent = 'from-proc-1'; window.__beat = 0" });
    (await import("node:fs")).writeFileSync(params.ready, "1");
    for (let i = 1; i <= 120; i++) {
      await new Promise((r) => setTimeout(r, 500));
      await chrome.debugger.sendCommand({ tabId: t.id }, "Runtime.evaluate", { expression: "window.__beat = " + i });
    }
    return "proc-1-ran-to-end";` });
  const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'ignore', 'ignore'] });
  child.stdin.end(src);
  const end = Date.now() + 30_000;
  while (!existsSync(ready) && Date.now() < end) await sleep(200);
  await sleep(1500);
  child.kill('SIGKILL');
  const killedAt = Date.now();
  await new Promise((r) => child.on('close', r));
  out.B = { readyBeforeKill: existsSync(ready), cliExitSignal: child.signalCode, spaceAfterKill: await spaceInfo(space) };
  const p2 = await runEgoTask({ space, script: recoverScript('b') });
  out.B.proc2 = p2.ok ? p2.result : { reason: p2.reason, error: p2.error, output: (p2.stdout + p2.stderr).slice(-800) };
  // 心跳在 kill 之后还在涨 => 进程 1 的脚本仍在 Ego 的 Node 服务里跑（杀 CLI 不等于停掉脚本）
  await sleep(2000);
  const p3 = await runEgoTask({ space, script: `const [id] = await recoverTabs(/#b$/); return (await chrome.debugger.sendCommand({ tabId: id }, "Runtime.evaluate", { expression: "window.__beat", returnByValue: true })).result.value;` });
  out.B.beatLater = p3.result; out.B.msSinceKill = Date.now() - killedAt;
  rmSync(ready, { force: true });
  await finishSpace(space);
}

// C：进程 1 finish({ keep }) 把页交还给用户（ownership=user）。
//   C1 进程 2 经 runner 取用（runner 看到 ownership=user 走 claimTaskSpace），再 adopt 找回；
//   C2 不认领直接 taskSpace(id)：Ego 在第一个浏览器命令时停掉脚本（退出码 0、无输出）。两种分开用两个 space，互不影响。
for (const variant of ['C1', 'C2']) {
  const space = `kinso/test/recover-${variant.toLowerCase()}-${tag}`;
  const p1 = await runEgoTask({ space, params: { FIXTURE }, script: `
    const t = await chrome.tabs.create({ url: params.FIXTURE + "#c", active: false });
    await chrome.debugger.sendCommand({ tabId: t.id }, "Runtime.evaluate", { expression: "document.getElementById('marker').textContent = 'from-proc-1'" });
    const label = (await task.tabs()).find((x) => x.url.endsWith("#c")).label;
    return await task.finish({ keep: [label] });` });
  const r = out[variant] = { proc1Finish: p1.result, ownershipAfterFinish: (await spaceInfo(space))?.ownership };
  if (variant === 'C2') {
    const id = (await spaceInfo(space)).id;
    const direct = await runEgoScript(`const t = await taskSpace(${id}); const tabs = await t.tabs(); console.log("@@RESULT " + JSON.stringify(tabs.length));`);
    r.taskSpaceWithoutClaim = { ok: direct.ok, reason: direct.reason, code: direct.code, egoSays: (direct.stdout + direct.stderr).split('\n')[0] };
    r.ownershipAfterDirect = (await spaceInfo(space))?.ownership;
  }
  const p2 = await runEgoTask({ space, script: recoverScript('c') });
  r.proc2 = p2.ok ? p2.result : p2;
  await finishSpace(space);
}

console.log(JSON.stringify(out, null, 2));
