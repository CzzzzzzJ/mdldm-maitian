// ⑥ 小红书：近 N 天全部笔记 + 指标、粉丝总数和分日粉丝。只读。
// 跑：spikes/platform/run.sh spikes/platform/06-works-xhs.mjs ['{"days":30}']
// 1. 数据中心「笔记分析」接口 note/analyze/list：要 X-s/X-t 签名，用页面自己的 window._webmsxyw(path) 生成，在页面里 fetch
// 2. 笔记管理接口 note/user/posted：也要签名，只拿状态（permission_code/permission_msg/tab_status）和定时发布时间
// 3. 粉丝：fans/overall_new（30 天分日总数、涨、掉），personal_info（当前总数），user/info（userId）—— 这三个不用签名
// 原始响应存 scratch/；脱敏样例存 spikes/results/samples/。
const L = await import(`${globalThis.SPIKE_ROOT}/spikes/platform/lib.mjs`);
const { ACCOUNTS, openSpace, mainPage, getJson, saveRaw, saveSample, scrub, sleep, cst, DAY } = L;
const args = { days: 30, ...(globalThis.ARGS ?? {}) };
const A = ACCOUNTS.find((a) => a.home?.includes('xiaohongshu'));

const sp = await openSpace(A, { takeOver: !!args.takeOver });
if (!sp.task) { console.log(JSON.stringify({ verdict: '等扫码', state: sp.state })); process.exit(0); }
const page = await mainPage(sp.task);
await page.goto('https://creator.xiaohongshu.com/new/note-manager', { waitUntil: 'commit', timeout: 30000 });
await sleep(8000);
if (/\/login/.test(await page.url())) { console.log(JSON.stringify({ verdict: '等扫码', reason: '跳到登录页' })); process.exit(0); }

// 带签名的 GET：签名在页面里现算，不出页面；返回解析好的 JSON
const signedGet = (path) => page.evaluate(async (p) => {
  if (typeof window._webmsxyw !== 'function') return { error: '页面没有 _webmsxyw' };
  const s = window._webmsxyw(p, undefined);
  const r = await fetch(p, { credentials: 'include', headers: { 'X-s': s['X-s'], 'X-t': String(s['X-t']) } });
  const t = await r.text();
  try { return { http: r.status, json: JSON.parse(t) }; } catch { return { http: r.status, text: t.slice(0, 200) }; }
}, path);

// 时间窗：东八区当天 0 点往前 N 天，到今天 23:59:59（页面「近30天」就是这样传的毫秒时间戳）
const now = Date.now();
const today0 = Math.floor((now + 8 * 3600_000) / (DAY * 1000)) * DAY * 1000 - 8 * 3600_000;
const begin = today0 - args.days * DAY * 1000;
const end = today0 + DAY * 1000 - 1000;
const analyzeUrl = (n) => `/api/galaxy/creator/datacenter/note/analyze/list?post_begin_time=${begin}&post_end_time=${end}&type=0&page_size=10&page_num=${n}`;

const analyze = [];
for (let n = 1; n <= 10; n++) {
  const r = await signedGet(analyzeUrl(n));
  analyze.push(r);
  const d = r.json?.data;
  if (!d?.note_infos?.length || analyze.flatMap((x) => x.json?.data?.note_infos ?? []).length >= d.total) break;
  await sleep(2500);
}
const notes = analyze.flatMap((x) => x.json?.data?.note_infos ?? []);

// 笔记管理列表（状态、定时发布）：tab=0 全部，page 从 0 起；翻到早于窗口为止
const posted = [];
for (let n = 0; n < 5; n++) {
  await sleep(2500);
  const r = await signedGet(`/api/galaxy/v2/creator/note/user/posted?tab=0&page=${n}`);
  posted.push(r);
  const list = r.json?.data?.notes ?? [];
  if (!list.length || list.some((x) => !x.sticky && Date.parse(String(x.time).replace(' ', 'T') + '+08:00') < begin)) break;
}
const postedById = new Map(posted.flatMap((x) => x.json?.data?.notes ?? []).map((x) => [x.id, x]));

await sleep(2000);
const ui = await getJson(page, '/api/galaxy/user/info');
await sleep(2000);
const pi = await getJson(page, '/api/galaxy/creator/home/personal_info');
await sleep(2000);
const fo = await getJson(page, '/api/galaxy/creator/data/fans/overall_new');

const uid = ui.json?.data?.userId ?? null;
const name = pi.json?.data?.name ?? ui.json?.data?.userName ?? null;
const posts = notes.map((x) => {
  const p = postedById.get(x.id);
  return {
    postId: x.id, uid, platform: A.code, account: name,
    title: x.title, desc: null, cover: x.cover_url,
    postType: x.type === 2 ? '视频' : '图文', postTypeCode: x.type === 2 ? '1' : '2',
    publishStatus: x.audit_status === 1 ? 'published' : 'unknown', statusText: x.audit_status === 1 ? '已发布' : `audit_status=${x.audit_status}`, status: String(x.audit_status),
    postTime: cst(Math.floor(x.post_time / 1000)), timing: p?.schedule_post_time ? cst(Math.floor(p.schedule_post_time / 1000)) : null,
    url: `https://www.xiaohongshu.com/explore/${x.id}`,
    show: x.imp_count, view: x.read_count, like: x.like_count, comment: x.comment_count, favorite: x.fav_count, forward: x.share_count,
    fansAdd: x.increase_fans_count, viewTime: x.view_time_avg, coverClickRate: x.coverClickRate, danmu: x.danmaku_count,
    permission: p ? { code: p.permission_code, msg: p.permission_msg, tab: p.tab_status } : null,
    platformName: '小红书',
  };
});

const t30 = fo.json?.data?.thirty ?? {};
const ymd = (ms) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
const rise = new Map((t30.rise_fans_list ?? []).map((x) => [x.date, x.count]));
const leave = new Map((t30.leave_fans_list ?? []).map((x) => [x.date, x.count]));
const acct = {
  uid, loginStatus: pi.json?.code === 0 ? '登录有效' : '登录失效', fans: pi.json?.data?.fans_count ?? t30.fans_count ?? null, updateTime: cst(Math.floor(now / 1000)),
  daily: (t30.fans_list ?? []).map((x) => ({ date: ymd(x.date), fansTotal: x.count, fansNet: rise.has(x.date) ? rise.get(x.date) - (leave.get(x.date) ?? 0) : null, fansRise: rise.get(x.date) ?? null, fansLeave: leave.get(x.date) ?? null })),
};

const out = {
  window: { begin: cst(begin / 1000), end: cst(end / 1000) },
  analyze: { pages: analyze.length, http: analyze.map((x) => x.http), code: analyze.map((x) => x.json?.code), total: analyze[0]?.json?.data?.total, got: notes.length, error: analyze[0]?.error ?? analyze[0]?.text },
  posted: { pages: posted.length, http: posted.map((x) => x.http), got: postedById.size, matched: posts.filter((p) => p.permission).length, permissionCodes: [...new Set(posts.map((p) => JSON.stringify(p.permission)))] },
  types: [...new Set(notes.map((x) => x.type))], audit: [...new Set(notes.map((x) => x.audit_status))],
  postTimes: posts.map((p) => p.postTime),
  fans: { http: [ui.status, pi.status, fo.status], current: acct.fans, thirty: { rise: t30.rise_fans_count, leave: t30.leave_fans_count, days: acct.daily.length } },
  account: { ...acct, daily: acct.daily.slice(-3) },
  sample: posts.slice(0, 2),
};
await saveRaw('06-xhs-works', { analyze: analyze.map((x) => x.json), posted: posted.map((x) => x.json), personal_info: pi.json, fans: fo.json });
const postedSample = posted[0]?.json?.data ? { ...posted[0].json, data: { ...posted[0].json.data, notes: posted[0].json.data.notes.slice(0, 1) } } : posted[0];
out.sampleFile = await saveSample('06-xhs-works', {
  note: '小红书 note/analyze/list（要签名）+ note/user/posted（要签名）+ fans/overall_new 的脱敏样例。raw 只留 1 条、URL 去掉查询串、xsec_token 去掉；mapped 是按目标格式映射后的结果',
  request: { analyze: analyzeUrl('<page_num>'), posted: '/api/galaxy/v2/creator/note/user/posted?tab=0&page=<n>', fans: '/api/galaxy/creator/data/fans/overall_new', personal_info: '/api/galaxy/creator/home/personal_info', signing: 'X-s/X-t = window._webmsxyw(path, undefined)，在页面里算' },
  raw: { analyze: scrub(analyze[0]?.json, 1), posted: scrub(postedSample, 1), fans: scrub({ ...fo.json, data: { thirty: fo.json?.data?.thirty } }, 2), personal_info: scrub({ code: pi.json?.code, data: { name: pi.json?.data?.name, fans_count: pi.json?.data?.fans_count, follow_count: pi.json?.data?.follow_count } }) },
  mapped: { posts: scrub(posts.slice(0, 2)), account: scrub({ ...acct, daily: acct.daily.slice(-2) }) },
});
console.log(JSON.stringify(out, null, 1));
