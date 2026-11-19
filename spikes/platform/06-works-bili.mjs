// ⑥ B站：近 N 天全部稿件 + 指标、粉丝总数和分日粉丝。只读。
// 跑：spikes/platform/run.sh spikes/platform/06-works-bili.mjs ['{"days":30}']
// 都在 member.bilibili.com 页面里 page.fetch，带 cookie，不用 w_rid 签名：
// 1. /x/web/archives：稿件管理列表（状态、计数），pn/ps 分页
// 2. /x/web/data/archive_diagnose/compare?size=30：数据中心「稿件对比」，单稿涨粉、掉粉、完播、平均播放时长
// 3. /x/web/data/v2/fans/stat/graph?type=all_fans&period=1：近 30 天分日粉丝总数；/x/web/data/v2/fans/stat/num 当前总数
// 原始响应存 scratch/；脱敏样例存 spikes/results/samples/。
const L = await import(`${globalThis.SPIKE_ROOT}/spikes/platform/lib.mjs`);
const { account, openSpace, mainPage, getJson, saveRaw, saveSample, scrub, sleep, cst, DAY } = L;
const args = { days: 30, ...(globalThis.ARGS ?? {}) };
const A = account('Bili');

const sp = await openSpace(A, { takeOver: !!args.takeOver });
if (!sp.task) { console.log(JSON.stringify({ verdict: '等扫码', state: sp.state })); process.exit(0); }
const page = await mainPage(sp.task);
await page.goto('https://member.bilibili.com/platform/home', { waitUntil: 'commit', timeout: 30000 });
await sleep(6000);

const nav = await getJson(page, 'https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
if (!nav.json?.data?.isLogin) { console.log(JSON.stringify({ verdict: '未登录', code: nav.json?.code })); process.exit(0); }
const now = Math.floor(Date.now() / 1000);
const since = now - args.days * DAY;

// 稿件管理：按发布时间倒序，翻到早于窗口为止
const arcPages = [];
for (let pn = 1; pn <= 5; pn++) {
  await sleep(2500);
  const r = await getJson(page, `/x/web/archives?status=is_pubing,pubed,not_pubed&pn=${pn}&ps=20&coop=1&interactive=1`);
  arcPages.push(r);
  const list = r.json?.data?.arc_audits ?? [];
  const pager = r.json?.data?.page;
  if (!list.length || list.some((x) => x.Archive.ptime > 0 && x.Archive.ptime < since) || (pager && pn * pager.ps >= pager.count)) break;
}
const arcs = arcPages.flatMap((r) => r.json?.data?.arc_audits ?? []);

await sleep(2500);
const cmp = await getJson(page, '/x/web/data/archive_diagnose/compare?size=30');
const cmpBy = new Map((cmp.json?.data?.list ?? []).map((x) => [x.bvid, x]));
await sleep(2500);
const graph = await getJson(page, '/x/web/data/v2/fans/stat/graph?type=all_fans&period=1');
await sleep(2500);
const num = await getJson(page, '/x/web/data/v2/fans/stat/num?period=1');

const STATE = { 0: ['published', '已发布'], '-6': ['reviewing', '审核中'], '-30': ['reviewing', '审核中'], '-40': ['timing', '定时发布'] };
const posts = arcs.filter((x) => x.Archive.ptime >= since || x.Archive.dtime > now).map(({ Archive: a, stat: s }) => {
  const c = cmpBy.get(a.bvid)?.stat;
  const [publishStatus, statusText] = STATE[a.state] ?? ['unknown', a.state_desc || `state=${a.state}`];
  return {
    postId: a.bvid, uid: String(a.mid), platform: 'Bili', account: nav.json.data.uname,
    title: a.title, desc: a.desc, cover: a.cover,
    postType: '视频', postTypeCode: '1', publishStatus, statusText, status: String(a.state),
    postTime: cst(a.ptime || a.dtime || a.ctime), timing: a.dtime > now ? cst(a.dtime) : null,
    url: `https://www.bilibili.com/video/${a.bvid}`,
    view: s?.view, like: s?.like, comment: s?.reply, favorite: s?.favorite, forward: s?.share, coin: s?.coin, danmu: s?.danmaku,
    fansAdd: c?.total_new_attention_cnt ?? null, fansDrop: c?.unfollow ?? null,
    // full_play_ratio 是「平均播放进度」（万分比，页面显示 38.6%），不是完播率；avg_play_time 现在恒为 0。
    // 小V猫的 viewTime 与 进度×时长 对得上（BV1aasw6xEiB：0.5801×59s≈34.2，小V猫记 35），所以这样算
    playProgress: c ? c.full_play_ratio / 100 : null, viewTime: c ? Math.round((c.full_play_ratio / 10000) * a.duration) : null,
    platformName: '哔哩哔哩',
  };
});

const tend = graph.json?.data?.tendency ?? [];
const acct = {
  uid: String(nav.json.data.mid), loginStatus: '登录有效', fans: num.json?.data?.all_fans ?? null, updateTime: cst(now),
  daily: tend.map((t, i) => ({ date: cst(t.date_key).slice(0, 10), fansTotal: t.total_inc, fansNet: i ? t.total_inc - tend[i - 1].total_inc : null })),
};

const out = {
  archives: { pages: arcPages.length, http: arcPages.map((r) => r.status), code: arcPages.map((r) => r.json?.code), class: arcPages[0]?.json?.data?.class, fetched: arcs.length, inWindow: posts.length },
  compare: { http: cmp.status, code: cmp.json?.code, n: cmpBy.size, matched: posts.filter((p) => cmpBy.has(p.postId)).length },
  states: [...new Set(arcs.map((x) => `${x.Archive.state}:${x.Archive.state_desc}`))],
  postTimes: posts.map((p) => p.postTime),
  fans: { http: [graph.status, num.status], current: acct.fans, num30: num.json?.data && { follow: num.json.data.follow, unfollow: num.json.data.unfollow }, days: acct.daily.length },
  account: { ...acct, daily: acct.daily.slice(-3) },
  sample: posts.slice(0, 2),
};
await saveRaw('06-bili-works', { archives: arcPages.map((r) => r.json), compare: cmp.json, graph: graph.json, num: num.json });
const a0 = arcPages[0]?.json;
out.sampleFile = await saveSample('06-bili-works', {
  note: 'B站 /x/web/archives + archive_diagnose/compare + fans/stat 的脱敏样例。raw 只留 1 条；mapped 是按目标格式映射后的结果',
  request: { archives: '/x/web/archives?status=is_pubing,pubed,not_pubed&pn=<n>&ps=20&coop=1&interactive=1', compare: '/x/web/data/archive_diagnose/compare?size=30', fansGraph: '/x/web/data/v2/fans/stat/graph?type=all_fans&period=1', fansNum: '/x/web/data/v2/fans/stat/num?period=1', host: 'https://member.bilibili.com（页面同源 fetch）' },
  raw: { archives: scrub({ code: a0?.code, data: { class: a0?.data?.class, page: a0?.data?.page, arc_audits: a0?.data?.arc_audits?.slice(0, 1) } }, 1), compare: scrub(cmp.json, 1), fansGraph: scrub(graph.json, 2), fansNum: num.json },
  mapped: { posts: scrub(posts.slice(0, 2)), account: scrub({ ...acct, daily: acct.daily.slice(-2) }) },
});
console.log(JSON.stringify(out, null, 1));
