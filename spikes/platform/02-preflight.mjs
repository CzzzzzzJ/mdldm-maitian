// ② 用 ego-shim 在每个平台 space 里跑插件 preflight（只打开上传页、判断登录；不填、不调 run、不点按钮）。
// 这是普通 Node 脚本（不经 ego-browser nodejs），每个平台通过 runEgoTask 起一个短进程。
// 跑：node spikes/platform/02-preflight.mjs            先逐个跑，再全部同时跑
//     node spikes/platform/02-preflight.mjs serial     只逐个跑
//     加 --patch-goto：在脚本里把新页面的 goto 改成 waitUntil:'commit'（对照实验）
import { runEgoTask } from '../../src/ego-runner/index.mjs';
import { writeFile, mkdir } from 'node:fs/promises';

// 插件 ORDER 里的 id → 我们的 space。插件 extra 适配器为空，公众号、微博、知识站没有对应适配器
const MAP = [
  ['bilibili', 'kinso/Bili/478358005'],
  ['xhs', 'kinso/XiaoHongShu/5944af205e87e701889da649'],
  ['douyin', 'kinso/Douyin/106707338905'],
  ['channels', 'kinso/Channels/pending'],
  ['youtube', 'kinso/YouTube/pending'],
  ['x', 'kinso/X/pending'],
  ['instagram', 'kinso/Instagram/pending'],
];

// 在 space 里：preflight([id], {keepTabs:false})；然后另开一页只看上传页结构（iframe / shadow DOM），看完关掉
const SCRIPT = `
// 实验开关：把这个 space 里新开页面的 goto 默认改成 waitUntil:'commit'（验证 ego-shim tabs.create 的超时问题，不改 src）
if (params.patchGoto) {
  const orig = task.newPage.bind(task);
  task.newPage = async (...a) => { const p = await orig(...a); const g = p.goto.bind(p); p.goto = (u, o = {}) => g(u, { waitUntil: 'commit', timeout: 30000, ...o }); return p; };
}
const { preflight, ADAPTERS } = await loadPlugin('lib/publish.js');
const t0 = Date.now();
const pre = await preflight([params.id], { keepTabs: false });
const ms = Date.now() - t0;
const r = pre[params.id] || {};
let structure = null;
if (r.ok) {
  const page = await task.newPage();
  try {
    await page.goto(ADAPTERS[params.id].url, { waitUntil: 'commit', timeout: 30000 });
    await new Promise((s) => setTimeout(s, 8000));
    structure = await page.evaluate(() => {
      const hosts = [...document.querySelectorAll('*')].filter((e) => e.shadowRoot).map((e) => e.tagName.toLowerCase());
      const inShadow = hosts.length ? [...document.querySelectorAll('*')].filter((e) => e.shadowRoot).some((e) => e.shadowRoot.querySelector('input[type=file]')) : false;
      return { iframes: [...document.querySelectorAll('iframe')].map((f) => { try { return new URL(f.src).host; } catch { return 'about:blank'; } }), shadowHosts: [...new Set(hosts)].slice(0, 8), fileInputInDocument: !!document.querySelector('input[type=file]'), fileInputInShadow: inShadow };
    });
  } finally { await page.close().catch(() => {}); }
}
const pages = (await task.tabs()).map((t) => ({ label: t.label ?? null, host: (() => { try { return new URL(t.url).host; } catch { return t.url; } })() }));
return { id: params.id, ok: r.ok, reason: r.reason ?? null, secs: r.secs ?? null, ms, structure, tabsAfter: pages };
`;

async function one(id, space, patchGoto = false) {
  const t0 = Date.now();
  const r = await runEgoTask({ space, script: SCRIPT, params: { id, patchGoto }, timeoutMs: 150_000 });
  return { id, space, patchGoto, wallMs: Date.now() - t0, ...(r.ok ? { ok: true, result: r.result } : { ok: false, reason: r.reason, error: String(r.error).slice(0, 200), tail: String((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-3).join(' / ').slice(0, 300) }) };
}

const mode = process.argv[2] || 'both';
const patch = process.argv.includes('--patch-goto');
const out = { at: new Date().toISOString(), patchGoto: patch };
if (mode !== 'parallel') {
  out.serial = [];
  for (const [id, space] of MAP) { out.serial.push(await one(id, space, patch)); await new Promise((s) => setTimeout(s, 2000)); }
}
if (mode !== 'serial') {
  const t0 = Date.now();
  out.parallel = { results: await Promise.all(MAP.map(([id, space]) => one(id, space, patch))) };
  out.parallel.totalMs = Date.now() - t0;
}
const root = new URL('../../', import.meta.url).pathname;
await mkdir(`${root}scratch`, { recursive: true });
await writeFile(`${root}scratch/02-preflight-${Date.now()}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
