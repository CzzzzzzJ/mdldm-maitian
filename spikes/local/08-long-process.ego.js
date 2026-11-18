// ⑧ 长进程 spike：一个 ego-browser nodejs 进程跑满 MINUTES 分钟，每分钟一次 evaluate + 一次 page.cdp。
// 用法：nohup ego-browser nodejs < spikes/local/08-long-process.ego.js > scratch/08-long-process.log 2>&1 &
// ego-browser nodejs 不继承环境变量、不在 shell 的工作目录里跑，所以参数都写在这里。
// stdout 重定向到文件时要等进程结束才写出，所以每行同时追加到 LOG（进程被杀也留得下）。
const MINUTES = 126;
const FIXTURE = "file:///Users/kinso/orca/workspaces/mdldm-maitian/kin-314-dev-1/test/fixtures/basic.html";
const name = `kinso/test/longrun-${Date.now().toString(36)}`;
const t0 = Date.now();
const LOG = "/Users/kinso/orca/workspaces/mdldm-maitian/kin-314-dev-1/scratch/08-long-process.jsonl";
const { appendFileSync } = await import("node:fs");
const log = (o) => {
  const line = JSON.stringify({ t: new Date().toISOString(), min: +((Date.now() - t0) / 60000).toFixed(2), ...o });
  appendFileSync(LOG, line + "\n");
  console.log(line);
};

const task = await taskSpace(name, { profileId: "Profile 5" });
const page = task.page("p1");
await page.goto(FIXTURE);
log({ event: "start", pid: process.pid, spaceId: task.spaceId, name, minutes: MINUTES });

let ok = 0, fail = 0;
for (let i = 1; i <= MINUTES; i++) {
  await new Promise((r) => setTimeout(r, 60_000));
  const rec = { event: "tick", i, rssMB: Math.round(process.memoryUsage().rss / 1048576), heapMB: Math.round(process.memoryUsage().heapUsed / 1048576) };
  try {
    rec.evaluate = await page.evaluate((n) => { document.getElementById("marker").textContent = "tick-" + n; return document.getElementById("marker").textContent; }, i);
    const r = await page.cdp("Runtime.evaluate", { expression: "document.title", returnByValue: true });
    rec.cdp = r.result.value;
    ok++;
  } catch (e) {
    rec.error = String(e && e.message || e).slice(0, 300);
    fail++;
  }
  log(rec);
}
const elapsedMin = +((Date.now() - t0) / 60000).toFixed(2);
await task.finish({ keep: [] });
log({ event: "finished", ok, fail, elapsedMin });
console.log("@@RESULT " + JSON.stringify({ ok, fail, elapsedMin, spaceId: task.spaceId }));
