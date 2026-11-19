// ⑥ 抖音：近 N 天全部作品 + 指标、粉丝总数和分日粉丝。只读。
// 跑：spikes/platform/run.sh spikes/platform/06-works-douyin.mjs ['{"days":30}']
// 在 kinso/Douyin/<uid> space 里先 goto 作品管理页（同站），再 page.fetch work_list，翻到早于 N 天为止，每页间隔 2.5 秒。
// 输出按目标格式（vcat posts-*.json / accounts-*.json 的字段名）映射好的记录；原始响应存 scratch/，脱敏样例存 spikes/results/samples/。
const L = await import(`${globalThis.SPIKE_ROOT}/spikes/platform/lib.mjs`);
const { account, openSpace, mainPage, getJson, saveRaw, saveSample, scrub, sleep, cst, DAY } = L;
const args = { days: 30, maxPages: 6, ...(globalThis.ARGS ?? {}) };
const A = account('Douyin');

const sp = await openSpace(A);
if (!sp.task) { console.log(JSON.stringify({ verdict: '等扫码', state: sp.state })); process.exit(0); }
const page = await mainPage(sp.task);
await page.goto('https://creator.douyin.com/creator-micro/content/manage', { waitUntil: 'commit', timeout: 30000 });
await sleep(6000);

// 参数照页面自己的 prefetch.json（/goofy/.../manage/prefetch.json），count 改成 30
const listUrl = (cursor) => `/janus/douyin/creator/pc/work_list?status=0&count=30&max_cursor=${cursor}&scene=star_atlas&device_platform=android&aid=1128`;
// items[].id 超过 2^53，JSON.parse 会丢精度；先把它改成字符串再解析
async function fetchList(cursor) {
  const r = await page.fetch(listUrl(cursor), { timeout: 20000 });
  return { http: r.status, json: JSON.parse(String(r.body).replace(/"id":(\d{16,})/g, '"id":"$1"')) };
}

const now = Math.floor(Date.now() / 1000);
const since = now - args.days * DAY;
const pages = [];
let cursor = 0;
for (let i = 0; i < args.maxPages; i++) {
  const p = await fetchList(cursor);
  pages.push(p);
  const list = p.json.aweme_list ?? [];
  const oldest = Math.min(...list.map((a) => a.create_time));
  if (!p.json.has_more || oldest < since) break;
  cursor = p.json.max_cursor;
  await sleep(2500);
}
const aweme = pages.flatMap((p) => p.json.aweme_list ?? []);
const items = new Map(pages.flatMap((p) => p.json.items ?? []).map((x) => [String(x.id), x]));

// 账号信息和粉丝：user/info 给当前总数；dashboard/fans 给分日总数和净增（页面自己就这样请求，不带签名）
const info = await getJson(page, '/web/api/media/user/info/');
await sleep(2000);
const fans = await getJson(page, `/janus/douyin/creator/data/overview/dashboard/fans?recent_days=${args.days}`);
const metric = (name) => fans.json?.metrics?.find((m) => m.english_metric_name === name);
const totalT = metric('total_fans_cnt')?.trends ?? [];
const netT = new Map((metric('net_fans_cnt')?.trends ?? []).map((t) => [t.date_time, t.value]));
const ymd = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const user = info.json?.user ?? {};

// 状态：102 正常；144 仅自己可见/受限（小V猫记成 unknown）。其它值没见过，一律 unknown
const STATUS = { 102: ['published', '已发布'] };
const pct = (s) => (s == null || s === '' ? null : Math.round(Number(s) * 100 * 1e4) / 1e4);
const n = (s) => (s == null || s === '' ? null : Number(s));
const posts = aweme.filter((a) => a.create_time >= since).map((a) => {
  const m = items.get(a.aweme_id)?.metrics ?? {};
  const st = a.statistics ?? {};
  const [publishStatus, statusText] = STATUS[a.status_value] ?? ['unknown', '状态未知'];
  return {
    postId: a.aweme_id, uid: String(user.uid ?? A.uid), platform: 'Douyin', account: user.nickname ?? null,
    title: a.item_title || (a.desc || '').split(/\s#/)[0], desc: a.desc ?? null,
    cover: a.video?.cover?.url_list?.[0] ?? null,
    postType: a.aweme_type === 68 ? '图文' : '视频', postTypeCode: a.aweme_type === 68 ? '2' : '1',
    publishStatus, statusText, status: String(a.status_value),
    postTime: cst(a.create_time), timing: a.create_time > now ? cst(a.create_time) : null,
    url: `https://www.douyin.com/video/${a.aweme_id}`,
    view: st.play_count, like: st.digg_count, comment: st.comment_count, favorite: st.collect_count,
    // 小V猫的 forward 就是 share_count（11 条逐条对上）；forward_count 恒为 0
    forward: st.share_count,
    fansAdd: n(m.subscribe_count), fansDrop: n(m.unsubscribe_count), homeVisit: n(m.homepage_visit_count),
    fullView: pct(m.completion_rate), view2s: pct(m.bounce_rate_2s), view5s: pct(m.completion_rate_5s),
    viewTime: n(m.avg_view_second), fansViewRate: pct(m.fan_view_proportion),
    platformName: '抖音',
  };
});

const acct = {
  uid: String(user.uid ?? ''), loginStatus: info.json?.status_code === 0 ? '登录有效' : '登录失效',
  fans: user.follower_count ?? null, updateTime: cst(now),
  daily: totalT.map((t) => ({ date: ymd(t.date_time), fansTotal: t.value, fansNet: netT.get(t.date_time) ?? null })),
};

const out = {
  days: args.days,
  list: { pages: pages.length, http: pages.map((p) => p.http), status_code: pages.map((p) => p.json.status_code), fetched: aweme.length, totalAllTime: pages[0]?.json.total, inWindow: posts.length, itemsMatched: posts.filter((p) => items.has(p.postId)).length },
  statusValues: [...new Set(posts.map((p) => p.status))],
  awemeTypes: [...new Set(aweme.filter((a) => a.create_time >= since).map((a) => a.aweme_type))],
  postTimes: posts.map((p) => p.postTime),
  fans: { http: [info.status, fans.status], followerCount: user.follower_count, fansDashboardTotal: metric('total_fans_cnt')?.metric_value, dailyDays: acct.daily.length, metricNames: fans.json?.metrics?.map((m) => m.english_metric_name) },
  account: { ...acct, daily: acct.daily.slice(-3) },
  sample: posts.slice(0, 2),
};
await saveRaw('06-douyin-worklist', { pages: pages.map((p) => p.json), info: info.json, fans: fans.json });
out.sampleFile = await saveSample('06-douyin-works', {
  note: '抖音 work_list + dashboard/fans 的脱敏样例。raw 只留 1 条、URL 去掉查询串；mapped 是按目标格式（vcat posts/accounts）映射后的结果',
  request: { list: listUrl('<max_cursor>'), fans: '/janus/douyin/creator/data/overview/dashboard/fans?recent_days=30', user: '/web/api/media/user/info/' },
  // aweme 对象很大（音乐、评论、贴纸…），样例只留映射用得着的键
  raw: { work_list: scrub({ status_code: pages[0].json.status_code, total: pages[0].json.total, has_more: pages[0].json.has_more, max_cursor: pages[0].json.max_cursor,
    aweme_list: pages[0].json.aweme_list.slice(0, 1).map((a) => ({ aweme_id: a.aweme_id, item_title: a.item_title, desc: a.desc, create_time: a.create_time, aweme_type: a.aweme_type, duration: a.duration, status_value: a.status_value, status: a.status, statistics: a.statistics, video: { cover: a.video?.cover } })),
    items: pages[0].json.items.slice(0, 1) }, 1), fans: scrub(fans.json, 1) },
  mapped: { posts: scrub(posts.slice(0, 2)), account: scrub({ ...acct, daily: acct.daily.slice(-2) }) },
});
console.log(JSON.stringify(out, null, 1));
