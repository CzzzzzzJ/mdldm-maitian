// 假 Ego 的脚本执行进程（由同目录的 ego-browser 起，detached）。
// FAKE_EGO_SPACES：listTaskSpaces() 的返回（JSON），默认 []。
// FAKE_EGO_PROFILES：profiles() 的返回（JSON），默认 [{"id":"Profile 5"}]。
// FAKE_EGO_LOG：把 taskSpace/claimTaskSpace/finish/切前台 调用逐行追加到这个文件。
// FAKE_EGO_FRONT_MS：Page.bringToFront 要花多久（默认 0），记下开始和结束时刻，用来测前台锁。
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

const file = process.argv[2];
const src = readFileSync(file, 'utf8');
rmSync(dirname(file), { recursive: true, force: true });
// CLI 被杀后管道断了，脚本照样跑（输出丢掉），跟真 Ego 一样
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

const log = (call) => { if (process.env.FAKE_EGO_LOG) appendFileSync(process.env.FAKE_EGO_LOG, `${JSON.stringify(call)}\n`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spaces = JSON.parse(process.env.FAKE_EGO_SPACES || '[]');
const profileList = JSON.parse(process.env.FAKE_EGO_PROFILES || '[{"id":"Profile 5"}]');
const frontMs = Number(process.env.FAKE_EGO_FRONT_MS || 0);

function fakeTask(id) {
  const tabs = [{ label: 'p1', url: 'about:blank', active: true }];
  const page = (label) => ({
    label,
    async goto(url) { tabs.find((t) => t.label === label).url = url; },
    async url() { return tabs.find((t) => t.label === label)?.url; },
    async title() { return ''; },
    async close() { tabs.splice(tabs.findIndex((t) => t.label === label), 1); },
    async cdp(method) {
      if (method !== 'Page.bringToFront') return {};
      const start = Date.now();
      await sleep(frontMs);
      for (const t of tabs) t.active = t.label === label;
      log({ fn: 'bringToFront', space: id, label, pid: process.pid, start, end: Date.now() });
      return {};
    },
  });
  return {
    spaceId: id,
    async tabs() { return tabs.map((t) => ({ ...t })); },
    page,
    async newPage() { const label = `p${tabs.length + 1}`; tabs.push({ label, url: 'about:blank', active: false }); return page(label); },
    async finish(o) { log({ fn: 'finish', id, keep: o?.keep }); return { closed: true }; },
  };
}

globalThis.listTaskSpaces = async () => spaces;
globalThis.profiles = async () => profileList;
globalThis.taskSpace = async (idOrName, opts) => { log({ fn: 'taskSpace', arg: idOrName, opts }); return fakeTask(idOrName); };
globalThis.claimTaskSpace = async (id) => { log({ fn: 'claimTaskSpace', arg: id }); return fakeTask(id); };
console.log = (...a) => process.stderr.write(`${a.join(' ')}\n`);
const AsyncFunction = (async () => {}).constructor;
try { await new AsyncFunction(src)(); } catch (e) { process.stderr.write(`${e.stack}\n`); process.exit(1); }
