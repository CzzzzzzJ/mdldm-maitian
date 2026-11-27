// 麦田 ↔ 口播工作台 数据桥（koubo-bridge）
// ------------------------------------------------------------------
// 目的：让「麦田」的大屏/下游逻辑能直接吃「口播工作台」的真实数据，
//       而不用在麦田里再写一套采集器（口播工作台已有 11 源匿名采集 + WBI 内容检索）。
//
// 用法：
//   node src/koubo-bridge.mjs                                  # 打印映射后的 overview JSON
//   node src/koubo-bridge.mjs --base http://127.0.0.1:8790      # 指定口播工作台地址
//   node src/koubo-bridge.mjs --out data/koubo-overview.json    # 落盘
//   node src/koubo-bridge.mjs --serve --port 8789               # 起只读服务，暴露 /api/overview
//   node src/koubo-bridge.mjs --selftest                        # 用内置样例自检映射契约
//
// 诚实边界：口播工作台没有自有账号后台数据（真实播放量/粉丝数），
//           映射结果里所有播放/粉丝类字段一律标 extra.proxy=1 / source='koubo-radar-proxy'，
//           绝不冒充真实播放量。需要真实播放量请用麦田自己的登录态 Chrome 采集链路。

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};

const BASE = arg('base', 'http://127.0.0.1:8790');
const OUT = arg('out', '');
const PORT = Number(arg('port', '8789'));

const dayOf = (ts) => {
  const d = new Date(Number(ts || 0) * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '';
};
const isoOf = (ts) => {
  const d = new Date(Number(ts || 0) * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString() : '';
};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const PROXY_NOTE = 'koubo-radar-proxy：热度代理，非平台真实播放量';

// 口播工作台 → 麦田 episodes/tasks/metrics/followers/site_* 契约
export function mapOverview(D) {
  const topics = Array.isArray(D.topics) ? D.topics : [];
  const rewrites = Array.isArray(D.rewrites) ? D.rewrites : [];
  const crawls = Array.isArray(D.crawls) ? D.crawls : [];
  const trends = D.trends || {};
  const days = trends.days || [];
  const byPlatform = trends.by_platform || {};
  const heat = trends.heat || [];
  const health = D.health || {};

  const episodes = topics.map((t, i) => ({
    id: 'koubo-topic-' + t.id,
    episode: i + 1,
    name: t.title || ('选题 ' + t.id),
    dir: '',
    schedule: isoOf(t.ts),
    created_at: isoOf(t.ts),
  }));

  const tasks = [];
  for (const ep of episodes) {
    const platforms = Object.keys(byPlatform).length ? Object.keys(byPlatform) : ['koubo'];
    for (const p of platforms) {
      const rw = rewrites.find((r) => r.title === ep.name);
      tasks.push({
        episode_id: ep.id,
        platform: p,
        state: rw ? (rw.confirmed ? 'published' : 'awaiting_user') : 'planned',
        detail: rw ? (rw.decision || '仿写稿待确认') : '仅抓取，无仿写稿',
        url: rw ? '' : '',
        updated_at: ep.schedule,
      });
    }
  }

  const metrics = [];
  for (const ep of episodes) {
    const rw = rewrites.find((r) => r.title === ep.name);
    for (const p of Object.keys(byPlatform)) {
      const vals = byPlatform[p] || [];
      const total = vals.reduce((a, b) => a + num(b), 0);
      metrics.push({
        day: dayOf(rw?.ts) || (days.length ? days[days.length - 1] : ''),
        episode_id: ep.id,
        platform: p,
        views: total,
        likes: 0, comments: 0, favorites: 0, shares: 0,
        extra: JSON.stringify({ proxy: 1, note: PROXY_NOTE }),
        collected_at: new Date().toISOString(),
      });
    }
  }

  const followers = [];
  for (const h of heat) {
    const vals = byPlatform[h.platform] || [];
    const gain = vals.length ? num(vals[vals.length - 1]) : 0;
    followers.push({
      day: days.length ? days[days.length - 1] : dayOf(Date.now() / 1000),
      platform: h.platform,
      total: num(h.heat),
      gain, loss: 0,
      source: 'koubo-radar-proxy',
      collected_at: new Date().toISOString(),
    });
  }

  const site_daily = days.map((d, i) => ({
    day: d,
    reg: num((trends.crawls || [])[i]),
    vip: num((trends.rewrites || [])[i]),
    orders: 0,
    revenue: 0,
  }));

  const site_channels = Object.keys(byPlatform).map((p) => ({
    source: p,
    label: p,
    reg: num((byPlatform[p] || []).reduce((a, b) => a + num(b), 0)),
    vip: rewrites.filter((r) => (r.platform || '') === p).length,
    orders: 0, revenue: 0,
    updated_at: new Date().toISOString(),
  }));

  const feed = rewrites.slice(0, 8).map((r) => ({
    ts: r.ts, title: r.title, platform: r.platform,
    state: r.confirmed ? '已确认' : '待人工确认',
  }));

  const ls = Array.isArray(health.live_sources) ? health.live_sources : (health.live_source_names || []);
  return {
    episodes, tasks, metrics, followers, site_daily, site_channels,
    site_campaigns: [],
    feed,
    health: {
      nas: false,
      chrome: false,
      platforms: ls.map((p) => ({ name: p, ok: true })),
      source: 'koubo-board',
      db_ready: !!health.db_ready,
      radar_version: health.radar_version || '',
      live_source_count: Array.isArray(health.live_sources)
        ? health.live_sources.length : (Number(health.live_sources) || 0),
      need_setup: health.need_setup_count || 0,
    },
    proxy_notice: PROXY_NOTE,
    generated_at: new Date().toISOString(),
  };
}

const REQUIRED = ['episodes', 'tasks', 'metrics', 'followers', 'site_daily', 'site_channels', 'feed', 'health'];

export function selfTest() {
  const fake = {
    topics: [{ id: 1, title: '测试选题', ts: 1750000000 }],
    rewrites: [{ id: 2, title: '测试选题', platform: '抖音', confirmed: 1, decision: '采纳', ts: 1750000100 }],
    crawls: [],
    trends: { days: ['2026-11-26', '2026-11-27'], crawls: [3, 5], rewrites: [0, 1], by_platform: { '抖音热榜': [1, 2], '微博热搜': [2, 3] }, heat: [{ platform: '抖音热榜', heat: 12345 }] },
    health: { db_ready: true, live_sources: ['抖音热榜', '微博热搜'], need_setup_count: 7, radar_version: 'radar-crawler-v4' },
  };
  const out = mapOverview(fake);
  const missing = REQUIRED.filter((k) => !(k in out));
  if (missing.length) throw new Error('契约缺字段: ' + missing.join(','));
  if (!out.metrics[0].extra.includes('proxy')) throw new Error('播放量未标 proxy');
  return { ok: true, episodes: out.episodes.length, tasks: out.tasks.length, metrics: out.metrics.length, followers: out.followers.length };
}

export async function fetchBoard(base = BASE) {
  const res = await fetch(base.replace(/\/$/, '') + '/api/koubo/board');
  if (!res.ok) throw new Error('口播工作台返回 HTTP ' + res.status);
  const j = await res.json();
  if (!j || !j.ok) throw new Error('口播工作台返回异常: ' + JSON.stringify(j).slice(0, 200));
  return j;
}

if (has('--selftest')) {
  const r = selfTest();
  console.log('SELFTEST', JSON.stringify(r));
} else {
  const D = await fetchBoard(BASE);
  const mapped = mapOverview(D);
  const json = JSON.stringify(mapped, null, 2);
  if (OUT) {
    const fs = await import('node:fs');
    fs.writeFileSync(OUT, json, 'utf8');
    console.log('已写出', OUT, 'episodes=' + mapped.episodes.length, 'metrics=' + mapped.metrics.length);
  } else {
    console.log(json);
  }
  if (has('--serve')) {
    const http = await import('node:http');
    http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.url === '/api/overview') {
        try {
          const d = await fetchBoard(BASE);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(mapOverview(d)));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: String(e.message || e) }));
        }
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'not found' }));
    }).listen(PORT, () => console.log('koubo-bridge 只读服务已启动: http://127.0.0.1:' + PORT + '/api/overview'));
  }
}
