// ⑥ 小红书：作品列表接口和扩展字段来源。只读。等扫码：space 交给用户时直接退出。
// 跑（扫码后）：spikes/platform/run.sh spikes/platform/06-works-xhs.mjs '{"takeOver":true}'
// 1. 在笔记管理页挂钩页面自己发的请求（X-s 签名由页面生成，我们只抄回 JSON）
// 2. 再直接 page.fetch MECHANICS.md 里的两个接口，看要不要签名
// 3. 输出抓到的接口路径和键名（不打印值），字段映射靠键名定位
const L = await import(`${globalThis.SPIKE_ROOT}/spikes/platform/lib.mjs`);
const { account, openSpace, mainPage, getJson, saveRaw, sleep, installHook, captured, pathOnly, keyPaths } = L;
const args = globalThis.ARGS ?? {};

const sp = await openSpace(account('XiaoHongShu'), { takeOver: !!args.takeOver });
if (!sp.task) { console.log(JSON.stringify({ verdict: '等扫码', state: sp.state, rerun: `spikes/platform/run.sh spikes/platform/06-works-xhs.mjs '{"takeOver":true}'` })); process.exit(0); }
const page = await mainPage(sp.task);

await installHook(page);
await page.goto('https://creator.xiaohongshu.com/new/note-manager', { waitUntil: 'commit', timeout: 30000 });
await sleep(10000);
if (/\/login/.test(await page.url())) { console.log(JSON.stringify({ verdict: '等扫码', reason: '跳到登录页' })); process.exit(0); }

const hooked = (await captured(page, 'note|posted|stat|data')).map((c) => ({ path: pathOnly(c.url), keys: c.json ? [...keyPaths(c.json)].filter((k) => /note|id|time|view|like|comment|collect|share|fans|imp|expo|read|status|audit|level|finish|duration/i.test(k)).slice(0, 60) : null }));

await sleep(2000);
const direct1 = await getJson(page, '/api/galaxy/v2/creator/note/user/posted?tab=0&page=0');
await sleep(2500);
const direct2 = await getJson(page, '/api/galaxy/creator/data/note_stats/new?page=1&page_size=30&sort_by=time');

// 笔记卡片的组件数据（Vue）：data-impression 里有 noteId（麦田 metrics.mjs 的读法）
const cards = await page.evaluate(() => [...document.querySelectorAll('.note-card')].slice(0, 3).map((c) => {
  let noteId = null; try { noteId = JSON.parse(c.getAttribute('data-impression')).noteTarget.value.noteId; } catch {}
  const vue = c.__vue__ || c.__vueParentComponent;
  return { noteId, stats: [...c.querySelectorAll('.note-card__stat')].map((e) => e.innerText.trim()), hasVue: !!vue };
}));

const out = {
  hooked,
  direct: [
    { path: '/api/galaxy/v2/creator/note/user/posted', http: direct1.status, code: direct1.json?.code, n: direct1.json?.data?.notes?.length, keys: direct1.json ? [...keyPaths(direct1.json)].slice(0, 60) : null },
    { path: '/api/galaxy/creator/data/note_stats/new', http: direct2.status, code: direct2.json?.code, keys: direct2.json ? [...keyPaths(direct2.json)].slice(0, 60) : null },
  ],
  cards,
};
await saveRaw('06-xhs', out);
console.log(JSON.stringify(out, null, 1));
