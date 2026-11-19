// ⑥ 视频号：近 N 天全部作品 + 指标、粉丝总数和分日粉丝。只读。
// 跑：spikes/platform/run.sh spikes/platform/06-works-channels.mjs ['{"days":30}']
// 思路照 local-tests/ego-backend/queries.mjs 的 channelsQuery：先 auth_data 拿 finderUsername，
// 再 POST /micro/statistic/cgi-bin/mmfinderassistant-bin/statistic/post_list（作品+指标）和 statistic/fans_trend（分日粉丝）。
// 不用签名，靠 cookie；请求体要带 _log_finder_id=finderUsername。用 page.fetch（page.evaluate 有 15 秒上限，连发几次会超时）。
// 原始响应存 scratch/；脱敏样例存 spikes/results/samples/（finderUsername 也打码）。
const L = await import(`${globalThis.SPIKE_ROOT}/spikes/platform/lib.mjs`);
const { account, openSpace, mainPage, saveRaw, saveSample, scrub, anon, sleep, cst, DAY } = L;
const args = { days: 30, ...(globalThis.ARGS ?? {}) };

const sp = await openSpace(account('Channels'), { takeOver: !!args.takeOver });
if (!sp.task) { console.log(JSON.stringify({ verdict: '等扫码', state: sp.state })); process.exit(0); }
const page = await mainPage(sp.task);
if (!/channels\.weixin\.qq\.com\/platform/.test(await page.url())) {
  await page.goto('https://channels.weixin.qq.com/platform', { waitUntil: 'commit', timeout: 30000 });
  await sleep(8000);
}

const pf = async (url, body) => {
  const r = await page.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), timeout: 40000 });
  try { return JSON.parse(r.body); } catch { return { http: r.status, text: String(r.body).slice(0, 200) }; }
};
const auth = await pf('/cgi-bin/mmfinderassistant-bin/auth/auth_data', { timestamp: String(Date.now()), _log_finder_uin: '', _log_finder_id: '', rawKeyBuff: '', pluginSessionId: null, scene: 7, reqScene: 7 });
const fu = auth?.data?.finderUser;
if (!fu?.finderUsername) { console.log(JSON.stringify({ verdict: '未登录', errCode: auth?.errCode })); process.exit(0); }
const base = { _log_finder_uin: '', _log_finder_id: fu.finderUsername, rawKeyBuff: '', pluginSessionId: null, scene: 7, reqScene: 7 };
const post = (path, p) => pf(`/micro/statistic/cgi-bin/mmfinderassistant-bin/${path}`, { ...p, timestamp: String(Date.now()), ...base });

// 东八区当天 0 点；post_list 的 startTime/endTime 是秒
const now = Math.floor(Date.now() / 1000);
const today = Math.floor((now + 8 * 3600) / DAY) * DAY - 8 * 3600;
const start = today - args.days * DAY;

const lists = [];
for (let p = 1; p <= 5; p++) {
  await sleep(2500);
  const r = await post('statistic/post_list', { pageSize: 20, currentPage: p, sort: 0, order: 0, startTime: start, endTime: now });
  lists.push(r);
  const d = r.data ?? {};
  if (!d.list?.length || lists.flatMap((x) => x.data?.list ?? []).length >= (d.totalCount ?? d.total ?? 0)) break;
}
const items = lists.flatMap((x) => x.data?.list ?? []);
await sleep(2500);
const trend = await post('statistic/fans_trend', { startTs: String(start), endTs: String(today), interval: 3 });

const posts = items.map((p) => ({
  // 小V猫的 postId 是 objectNonce（不是 objectId），用它才能和已回填的笔记按 post_id 对上
  postId: String(p.objectNonce), objectId: String(p.objectId), uid: fu.uniqId, platform: 'Channels', account: fu.nickname,
  title: p.desc?.shortTitle?.[0]?.shortTitle || (p.desc?.description || '').split('\n')[0].slice(0, 60), desc: p.desc?.description ?? null,
  cover: p.desc?.media?.[0]?.coverUrl ?? p.desc?.media?.[0]?.thumbUrl ?? null,
  postType: '视频', postTypeCode: '1', publishStatus: 'published', statusText: '已发布', status: String(p.status ?? 1),
  postTime: cst(p.createTime), timing: null,
  url: p.desc?.media?.[0]?.url ?? null,
  // 字段名和页面图标是反的：favCount 是 👍 点赞（页面 #icon-thumb 列），likeCount 是 ♡ 推荐（#icon-heart 列）；小V猫也是这样对的
  view: p.readCount, like: p.favCount, comment: p.commentCount, forward: p.forwardCount, love: p.likeCount,
  fansAdd: p.followCount, fullView: p.fullPlayRate != null ? Math.round(p.fullPlayRate * 100 * 1e4) / 1e4 : null, viewTime: p.avgPlayTimeSec ?? null,
  exportId: p.exportId ?? null,
  // 小V猫的 punish=true 对应 disableInfo.isDisabled（visibleType=3，「仅自己可见」）；backfill.py 见到 punish 记成「已下架」
  ...(p.disableInfo?.isDisabled ? { punish: true, punishReason: p.disableInfo.disableAddWording ?? null } : {}),
  platformName: '视频号',
}));

const t = trend.data ?? {};
// 小V猫和 kinso-dashboard/refresh.py 认的视频号 uid 是 finderUser.uniqId（视频号 ID），不是 finderUsername
const acct = {
  uid: fu.uniqId, loginStatus: '登录有效', fans: fu.fansCount, updateTime: cst(now),
  daily: (t.total ?? []).map((v, i) => ({ date: cst(start + i * DAY).slice(0, 10), fansTotal: Number(v), fansNet: Number(t.netAdd?.[i] ?? 0), fansAdd: Number(t.add?.[i] ?? 0), fansDrop: Number(t.reduce?.[i] ?? 0) })),
};

const out = {
  window: { start: cst(start), end: cst(now) },
  postList: { pages: lists.length, errCode: lists.map((x) => x.errCode), dataKeys: Object.keys(lists[0]?.data ?? {}), total: lists[0]?.data?.totalCount ?? lists[0]?.data?.total, got: items.length, feedsCountAllTime: fu.feedsCount },
  itemKeys: Object.keys(items[0] ?? {}),
  statuses: [...new Set(items.map((p) => p.status))],
  postTimes: posts.map((p) => p.postTime),
  fans: { current: fu.fansCount, trendErr: trend.errCode, days: acct.daily.length },
  account: { ...acct, uid: anon(acct.uid), daily: acct.daily.slice(-3) },
  sample: posts.slice(0, 2).map((p) => ({ ...p, uid: anon(p.uid), url: p.url && `${p.url.split('?')[0]}?<去掉>`, cover: p.cover && `${p.cover.split('?')[0]}?<去掉>` })),
};
await saveRaw('06-channels-works', { lists, trend, finderUser: fu });
const mask = (o) => JSON.parse(JSON.stringify(o).replaceAll(fu.finderUsername, '<finderUsername>').replaceAll(fu.uniqId, '<uniqId>'));
out.sampleFile = await saveSample('06-channels-works', mask({
  note: '视频号 statistic/post_list + statistic/fans_trend 的脱敏样例。raw 只留 1 条、URL 去掉查询串、finderUsername 和 uniqId（视频号 ID）打码；mapped 是按目标格式映射后的结果',
  request: { auth: 'POST /cgi-bin/mmfinderassistant-bin/auth/auth_data', postList: 'POST /micro/statistic/cgi-bin/mmfinderassistant-bin/statistic/post_list {pageSize,currentPage,sort:0,order:0,startTime,endTime,+base}', fansTrend: 'POST /micro/statistic/cgi-bin/mmfinderassistant-bin/statistic/fans_trend {startTs,endTs,interval:3,+base}', base: '{_log_finder_uin:"",_log_finder_id:<finderUsername>,rawKeyBuff:"",pluginSessionId:null,scene:7,reqScene:7,timestamp}' },
  raw: { postList: scrub({ ...lists[0], data: { ...lists[0]?.data, list: items.slice(0, 1) } }, 1), fansTrend: scrub({ errCode: trend.errCode, data: { add: t.add, reduce: t.reduce, netAdd: t.netAdd, total: t.total } }, 3), finderUser: { nickname: fu.nickname, fansCount: fu.fansCount, feedsCount: fu.feedsCount } },
  mapped: { posts: scrub(posts.slice(0, 2)), account: scrub({ ...acct, daily: acct.daily.slice(-2) }) },
}));
console.log(JSON.stringify(out, null, 1));
