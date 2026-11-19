// ⑥ 探查：在某平台 space 里挂钩页面自己发的请求，依次打开几个后台页面，列出 JSON 接口路径和键名（不打印值）。
// 用来找作品列表、粉丝数、分日粉丝的接口。只读：只打开页面，不点任何按钮。
// 跑：spikes/platform/run.sh spikes/platform/06-discover.mjs '{"platform":"Douyin","urls":["https://creator.douyin.com/creator-micro/data-center/operation"],"filter":"fans|follow"}'
// 原始响应（含值）只存 scratch/，屏幕上只打路径、键名和命中 filter 的键。
const L = await import(`${globalThis.SPIKE_ROOT}/spikes/platform/lib.mjs`);
const { account, openSpace, mainPage, saveRaw, sleep, installHook, captured, pathOnly, keyPaths } = L;
const args = { wait: 10000, filter: 'fans|follow|subscri', ...(globalThis.ARGS ?? {}) };

const sp = await openSpace(account(args.platform));
if (!sp.task) { console.log(JSON.stringify({ verdict: '等扫码', state: sp.state })); process.exit(0); }
const page = await mainPage(sp.task);
await installHook(page);

const out = [];
const raw = [];
for (const url of args.urls) {
  await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
  await sleep(args.wait);
  const caps = await captured(page, args.urlFilter ?? '.');
  raw.push({ url, caps });
  out.push({
    url, landed: (await page.url()).split('?')[0],
    apis: caps.map((c) => {
      const keys = c.json ? [...keyPaths(c.json)] : [];
      return { path: pathOnly(c.url), nKeys: keys.length, hits: keys.filter((k) => new RegExp(args.filter, 'i').test(k)).slice(0, 30) };
    }).filter((a) => a.nKeys > 0),
  });
  await sleep(2000);
}
const file = await saveRaw(`06-discover-${args.platform}`, raw);
console.log(JSON.stringify({ out, rawSavedTo: file }, null, 1));
