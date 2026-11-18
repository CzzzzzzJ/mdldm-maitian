// ⑥ 抖音：作品列表接口、分页、扩展字段来源。只读。
// 跑：spikes/platform/run.sh spikes/platform/06-works-douyin.mjs
// 在 kinso/Douyin/<uid> space 里先 goto 作品管理页（同站），再 page.fetch work_list。最多翻 2 页，间隔 ≥2 秒。
const L = await import(`${globalThis.SPIKE_ROOT}/spikes/platform/lib.mjs`);
const { account, openSpace, mainPage, getJson, saveRaw, sleep } = L;

const sp = await openSpace(account('Douyin'));
if (!sp.task) { console.log(JSON.stringify({ verdict: '等扫码', state: sp.state })); process.exit(0); }
const page = await mainPage(sp.task);
await page.goto('https://creator.douyin.com/creator-micro/content/manage', { waitUntil: 'commit', timeout: 30000 });
await sleep(6000);

// 参数照页面自己的 prefetch.json（/goofy/.../manage/prefetch.json），count 改成 30
const listUrl = (cursor) => `/janus/douyin/creator/pc/work_list?status=0&count=30&max_cursor=${cursor}&scene=star_atlas&device_platform=android&aid=1128`;

// items[].id 超过 2^53，JSON.parse 会丢精度；先把它改成字符串再解析
async function fetchList(cursor) {
  const r = await page.fetch(listUrl(cursor), { timeout: 20000 });
  const body = String(r.body).replace(/"id":(\d{16,})/g, '"id":"$1"');
  return { http: r.status, json: JSON.parse(body) };
}

const p1 = await fetchList(0);
await sleep(2500);
const p2 = p1.json.has_more ? await fetchList(p1.json.max_cursor) : null;

const j = p1.json;
const byId = new Map(j.items.map((x) => [String(x.id), x]));
const sample = j.aweme_list.slice(0, 3).map((a) => {
  const it = byId.get(a.aweme_id) ?? {};
  const m = it.metrics ?? {};
  return {
    postId: a.aweme_id,
    title: (a.item_title || a.desc || '').slice(0, 20),
    postTime: new Date(a.create_time * 1000).toISOString(),
    url: `https://www.douyin.com/video/${a.aweme_id}`,
    view: a.statistics?.play_count, like: a.statistics?.digg_count, comment: a.statistics?.comment_count,
    forward: a.statistics?.share_count, favorite: a.statistics?.collect_count,
    fansAdd: m.subscribe_count, homeVisit: m.homepage_visit_count, fullView: m.completion_rate, viewTime: m.avg_view_second,
    coverShow: m.cover_show, bounce2s: m.bounce_rate_2s,
    review: it.review?.status, inReviewing: a.status?.in_reviewing, isPrivate: a.status?.is_private, prohibited: a.status?.is_prohibited,
    metricsUpdatedAt: it.metrics_offline_update_time ? new Date(it.metrics_offline_update_time * 1000).toISOString() : null,
  };
});

// items 与 aweme_list 能不能按 id 一一对上；metrics 的更新时间分布（离线指标是否滞后）
const matched = j.aweme_list.filter((a) => byId.has(a.aweme_id)).length;
const metricTimes = [...new Set(j.items.map((x) => x.metrics_offline_update_time))].map((t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : null));
const reviewStatuses = [...new Set(j.items.map((x) => JSON.stringify(x.review)))];

const out = {
  verdict: j.aweme_list.length >= 30 || !j.has_more ? '通过' : '部分',
  list: { http: p1.http, status_code: j.status_code, n: j.aweme_list.length, items: j.items.length, total: j.total, has_more: j.has_more, next_cursor_type: typeof j.max_cursor, page2: p2 && { http: p2.http, n: p2.json.aweme_list.length, has_more: p2.json.has_more, overlapWithPage1: p2.json.aweme_list.filter((a) => j.aweme_list.some((b) => b.aweme_id === a.aweme_id)).length } },
  matchedItemsToAweme: `${matched}/${j.aweme_list.length}`,
  metricsKeys: Object.keys(j.items[0]?.metrics ?? {}),
  metricsUpdateDates: metricTimes,
  reviewStatuses,
  sample,
};
await saveRaw('06-douyin-worklist', { p1: j, p2: p2?.json });
console.log(JSON.stringify(out, null, 1));
