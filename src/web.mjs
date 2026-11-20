// 麦田：本地网页。播种（发布）、长势（流量）、收成（转化）、粮仓（档案）
import http from 'node:http'; import crypto from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path'; import { spawn, execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { db, NAMES, STATE_CN, episodes, getEpisode, getTasks, recentLogs, getSnapshot, getMeta, setMeta } from './db.mjs';
import { config, reloadConfig, saveSettings, testFeishu } from './feishu.mjs';
import { getTargets, settingsView } from './targets.mjs';
import { SITE } from './site.mjs';
import { saveFeishu, saveSite, setPlatformEnabled, testSite } from './config-admin.mjs';
import { learnOn, learnUrl } from './learn.mjs';
import { review } from './review.mjs';
import { accessEmail } from './access.mjs';
import { accountTrafficView } from './account-traffic.mjs';
import { initLogin, sessionOk, handleLogin } from './login.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(DIR, '..');
let W = config.web || { port: 8787, key: '' };
const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readPj = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'publish.json'), 'utf8')); } catch { return null; } };
const short = (n) => n.split(/[｜|]/)[0].trim();
const nickOf = (name, pj) => (pj && pj.nick) || (short(name).split(/[，,？?！!：:。]/)[0].trim() || short(name)).slice(0, 16);
const latest = db.prepare('SELECT * FROM metrics WHERE episode_id=? AND platform=? ORDER BY day DESC LIMIT 1');
const actions = [];   // 最近的操作（内存里）
const activeIds = () => new Set(getTargets(config).map(t => t.id));
const targetNames = () => ({ ...NAMES, ...Object.fromEntries(getTargets(config).map(t => [t.id, t.name])) });
const siteEnabled = () => !!SITE && getTargets(config).some(t => t.id === 'zsz');
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [], tooLarge = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (tooLarge) return;
      if (size > 65536) { tooLarge = true; chunks = []; reject(Object.assign(new Error('请求内容过大'), { status: 413 })); }
      else chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (tooLarge) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        resolve(body);
      } catch { reject(Object.assign(new Error('请求格式不对'), { status: 400 })); }
    });
  });
}

function episodeView(ep, full = false) {
  const snap = getSnapshot(ep.id), pj = (snap && JSON.parse(snap.project)) || readPj(ep.dir) || {};
  const active = activeIds(), names = targetNames();
  let views = 0, inter = 0;
  const tasks = getTasks(ep.id).filter(t => active.has(t.platform)).map(t => {
    const m = latest.get(ep.id, t.platform) || null;
    if (m) { views += m.views || 0; inter += (m.likes || 0) + (m.comments || 0) + (m.favorites || 0) + (m.shares || 0); }
    const platform = pj.platforms || {};
    // 旧工程可能把多个账号的共用文案放在 bilibili.accounts 下。
    const account = t.platform.startsWith('bilibili@') && t.platform.slice(9);
    const p = platform[t.platform] || (account && platform.bilibili?.accounts?.includes(account) && platform.bilibili) || {};
    return { platform: t.platform, name: names[t.platform] || t.platform, state: t.state, stateCn: STATE_CN[t.state] || t.state, detail: t.detail || '', url: t.url || '', updatedAt: t.updated_at,
      m: m && { day: m.day, views: m.views, likes: m.likes, comments: m.comments, favorites: m.favorites, shares: m.shares, extra: JSON.parse(m.extra || '{}') },
      ...(full ? { copy: { title: p.title || p.shortTitle || '', body: p.desc || p.body || p.text || p.description || '', tags: p.tags || p.topics || [], covers: p.covers || [] }, shot: fs.existsSync(path.join(ep.dir, '发布档案', `${t.platform}.jpg`)) } : {}) };
  });
  const out = { id: ep.id, episode: ep.episode, name: ep.name, short: short(ep.name), nick: nickOf(ep.name, pj), schedule: ep.schedule, createdAt: ep.created_at, dir: ep.dir,
    campaign: (JSON.stringify(pj.platforms || {}).match(/utm_campaign=([\w-]+)/) || [])[1] || '', covers: Object.keys(pj.covers || {}), durationSec: pj.durationSec || 0, tasks, views, inter };
  if (full) {
    out.logs = recentLogs(ep.id, 200).filter(l => !l.platform || active.has(l.platform));
    out.metrics = db.prepare('SELECT day, platform, views, likes, comments, favorites, shares FROM metrics WHERE episode_id=? ORDER BY day').all(ep.id).filter(m => active.has(m.platform));
    out.snapshotAt = snap && snap.taken_at;
    // 复盘：已经到了第 1/3/7 天的节点（和飞书卡片同一套算法）
    const t0 = Date.parse(ep.schedule || ep.created_at);
    out.reviews = tasks.some(t => t.state === 'published') ? [1, 3, 7].filter(a => Date.now() >= t0 + a * 864e5 || a === 1).map(a => { try { const r = review(ep, a); return { age: a, partial: Date.now() < t0 + a * 864e5, views: r.cur.views, ints: r.cur.ints, rows: r.cur.rows.map(x => ({ p: x.p, views: x.m.views, inter: x.m.likes + x.m.comments + x.m.favorites + x.m.shares })), prev: r.prev && { nick: r.prev.nick, views: r.prev.views, rows: r.prev.rows.map(x => ({ p: x.p, views: x.m.views })) }, fans: r.fans.sum, conv: r.conv || null }; } catch { return null; } }).filter(Boolean) : [];
    out.files = ['成片.mp4', '字幕.srt', '发布素材.md', 'publish.json', '发布记录.json'].filter(f => fs.existsSync(path.join(ep.dir, f)));
  }
  return out;
}

const ACT = { links: '取链接', mark: '标记', 'login-expired': '登录过期', upload: '上传', fill: '填写', submit: '提交', verify: '核对', state: '状态', 'start-batch': '开跑', plan: '登记计划', 'manual-submit': '手动提交', 'metrics-error': '采集出错', 'screenshot-error': '截图失败', 'article-job': '长文', 'deferred-run': '自动建课' };
function feed(episodeRows, n = 14) {
  const active = activeIds(), platforms = targetNames();
  const names = Object.fromEntries(episodeRows.map(e => [e.id, e.episode])), nicks = Object.fromEntries(episodeRows.map(e => [e.id, e.nick]));
  return db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(n).filter(l => !l.platform || active.has(l.platform)).map(l => {
    let r = l.result || ''; try { const j = JSON.parse(r); r = j.status || j.note || ''; } catch {}
    return { ts: l.ts, episode: names[l.episode_id] || '', nick: nicks[l.episode_id] || '', platform: platforms[l.platform] || l.platform || '', action: ACT[l.action] || l.action, result: STATE_CN[r] || String(r).slice(0, 40) };
  });
}
let chromeHealth;
function chromeUp() {
  const ports = [...new Set(getTargets(config).map(t => t.chromePort))];
  const key = ports.join(',');
  if (chromeHealth?.key === key && Date.now() < chromeHealth.until) return chromeHealth.result;
  const result = Promise.all(ports.map(async port => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } })).then(results => results.some(Boolean));
  chromeHealth = { key, until: Date.now() + 5000, result };
  return result;
}

function widgetScript(req, file) {
  let base = `${req.headers['x-forwarded-proto'] || (req.headers['cf-visitor'] ? 'https' : 'http')}://${req.headers.host}`;
  try { base = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tunnel.json'), 'utf8')).base || base; } catch {}
  return fs.readFileSync(path.join(ROOT, 'scripts', 'widget', file), 'utf8').replace('__MAITIAN_URL__', base).replace('__WIDGET_TOKEN__', W.widgetToken);
}
const latestPublished = () => episodes().filter(e => e.schedule && Date.parse(e.schedule) <= Date.now()).sort((a, b) => Date.parse(b.schedule) - Date.parse(a.schedule))[0];
// 手机小组件：只读汇总（粉丝、涨幅、最新一期播放、站点近 7 天），用单独的 config.web.widgetToken，只能读这一个接口
function widgetData() {
  const ORDER = getTargets(config).filter(t => t.platform !== 'zsz').map(t => t.id), names = targetNames(), siteOn = siteEnabled();
  const rows = db.prepare("SELECT day, platform, total FROM followers WHERE day >= date('now','localtime','-40 day') AND total IS NOT NULL ORDER BY day").all();
  const by = {}; for (const r of rows) (by[r.platform] ||= []).push(r);
  const today = new Date().toLocaleDateString('sv-SE');
  const ago = (d, n) => { const t = new Date(d + 'T12:00:00'); t.setDate(t.getDate() - n); return t.toLocaleDateString('sv-SE'); };
  const stat = (p) => { const a = by[p]; if (!a || !a.length) return null; const last = a[a.length - 1];
    const prev = [...a].reverse().find(r => r.day < last.day), week = [...a].reverse().find(r => r.day <= ago(last.day, 7)) || (a[0] !== last ? a[0] : null);   // 记录不满 7 天就从最早一天算
    return { id: p, name: names[p] || p, total: last.total, today: last.day === today && prev ? last.total - prev.total : 0, week: week ? last.total - week.total : 0, day: last.day }; };
  const platforms = ORDER.map(stat).filter(Boolean);
  const sum = k => platforms.reduce((n, p) => n + (p[k] || 0), 0);
  const now = Date.now();
  const pub = latestPublished();
  const ev = pub && episodeView(pub);
  const days = siteOn ? db.prepare('SELECT * FROM site_daily WHERE day >= ? AND day <= ? ORDER BY day').all(ago(today, 6), today) : [];
  const zsz = stat('zsz');
  return { name: config.name || '麦田', owner: W.owner || '', avatar: !!W.avatar, fans: { total: sum('total'), today: sum('today'), week: sum('week') }, platforms,
    latest: ev && { title: ev.short, nick: ev.nick, views: ev.views, inter: ev.inter, hours: Math.round((now - Date.parse(pub.schedule)) / 36e5) },
    site: siteOn ? { name: SITE.name, users: zsz && zsz.total, reg: days.reduce((n, d) => n + (d.reg || 0), 0), vip: days.reduce((n, d) => n + (d.vip || 0), 0), revenue: days.reduce((n, d) => n + (d.revenue || 0), 0) } : null,
    metricsDay: getMeta('metricsDay') || '', now: new Date().toISOString() };
}
const tokenEq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const widgetPage = (code) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>麦田小组件</title>
<style>body{font-family:-apple-system,'PingFang SC',sans-serif;margin:0;padding:22px 18px 40px;background:#f6f1e6;color:#1c1a16;line-height:1.6}h1{font-size:24px;margin:0 0 6px}ol{padding-left:20px;font-size:15px}li{margin:6px 0}
button{width:100%;height:50px;border:0;border-radius:14px;background:#1c1a16;color:#fff;font-size:17px;font-weight:800;margin:14px 0}pre{background:#fff;border-radius:12px;padding:12px;font-size:11px;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all}
.tip{font-size:13px;color:#7a7160}</style></head><body><h1>🌾 麦田小组件</h1>
<ol><li>App Store 安装 <b>Scriptable</b>（免费）</li><li>点下面的按钮复制脚本（自动更新的加载器，只需粘贴这一次）</li><li>打开 Scriptable → 右上角 <b>＋</b> → 粘贴 → 标题改成「麦田」；已经有「麦田」脚本的，打开它全选、粘贴覆盖</li><li>长按桌面 → 左上角 <b>＋</b> → 搜 Scriptable → 选中号 → 添加；长按小组件 → 编辑小组件 → Script 选「麦田」</li><li>锁屏：长按锁屏 → 自定 → 添加小组件 → Scriptable → 同样选「麦田」</li></ol>
<button id="b">复制脚本</button><p class="tip">以后小组件改样式，手机上会自动用上新版，不用再粘贴。脚本里带着小组件口令，只能读汇总数字（粉丝、播放、站点近 7 天），打不开麦田别的页面。别发给别人；泄露了在 config.json 换一个 widgetToken 即可。</p>
<pre id="c"></pre><script>const code=${JSON.stringify(code).replace(/</g, '\\u003c')};document.getElementById('c').textContent=code;
document.getElementById('b').onclick=async()=>{try{await navigator.clipboard.writeText(code);b.textContent='已复制 ✓';}catch{const r=document.createRange();r.selectNodeContents(c);getSelection().removeAllRanges();getSelection().addRange(r);b.textContent='长按选中的文字复制';}};</script></body></html>`;

// 缩略图：macOS 自带 sips 缩放转 JPEG，按 原文件路径+修改时间+尺寸 缓存；失败返回 null（退回原图）
function thumb(f, w) {
  try {
    const st = fs.statSync(f), dir = path.join(ROOT, 'data', 'thumbs');
    const out = path.join(dir, crypto.createHash('sha1').update(`${f}|${st.mtimeMs}|${w}`).digest('hex') + '.jpg');
    if (fs.existsSync(out)) return out;
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('/usr/bin/sips', ['-Z', String(w), '-s', 'format', 'jpeg', '-s', 'formatOptions', '78', f, '--out', out], { stdio: 'ignore', timeout: 20000 });
    return fs.existsSync(out) ? out : null;
  } catch { return null; }
}

// ---------- 集成管理（飞书 / 知识站） ----------
const metaJson = (k) => { const v = getMeta(k); if (!v) return null; try { return JSON.parse(v); } catch { return null; } };
const healthMeta = db.prepare("SELECT key, value FROM meta WHERE key GLOB 'login*:*'");
function platformList() {
  const { platforms, bilibiliAccounts } = settingsView(config);
  const targets = platforms.filter(p => p.id !== 'zsz').flatMap(p => p.id !== 'bilibili' ? [p] : bilibiliAccounts.map(a => ({
    id: a.id === 'default' ? 'bilibili' : `bilibili@${a.id}`,
    name: a.name === '默认账号' ? p.name : `${p.name} · ${a.name}`, enabled: p.enabled && a.enabled,
  })));
  const meta = new Map(healthMeta.all().map(({ key, value }) => [key, value]));
  return targets.map(({ id, name, enabled }) => ({
    id, name, disabled: !enabled, state: meta.get('login:' + id) || '',
    reason: meta.get('loginReason:' + id) || '', day: meta.get('loginDay:' + id) || '',
  }));
}
function integrations() {
  const cs = config.site || {};
  const common = { enabled: siteEnabled(), name: cs.name || '', lastTest: metaJson('integrations.site.lastTest') };
  const site = {
    ...common, base: cs.base || '', adminPath: cs.adminPath || '/admin', coursesApi: cs.coursesApi || '/api/courses?admin=1',
    dashboardApi: cs.dashboardApi || '/api/admin/dashboard', coursePath: cs.coursePath || '/series/{seriesId}?courseId={id}',
    logo: cs.logo || '', summary: common.enabled ? db.prepare("SELECT COALESCE(SUM(reg),0) reg, COALESCE(SUM(revenue),0) revenue FROM site_daily WHERE day BETWEEN date('now','localtime','-6 days') AND date('now','localtime')").get() : null,
  };
  return { feishu: { configured: !!config.feishuWebhook, login: config.web?.login === 'feishu', lastTest: metaJson('integrations.feishu.lastTest') }, site };
}

async function handle(req, res) {
  reloadConfig(); W = config.web || { port: 8787, key: '' };
  const u = new URL(req.url, 'http://x');
  // 访问控制：前面挂了 Cloudflare Access（邮箱验证码）就认它的登录凭证；否则用口令（第一次带 ?key= 进来，之后用 cookie）
  if (/^\/static\/icon-\d+\.png$/.test(u.pathname)) return send(res, 200, fs.readFileSync(path.join(DIR, 'web', path.basename(u.pathname))), 'image/png', { 'cache-control': 'max-age=86400' });   // 主屏幕图标不用登录
  if (u.pathname === '/api/widget/img') {   // 小组件图片：头像（config.web.avatar）或最新一期封面缩略图，同一个只读口令
    if (!W.widgetToken || !tokenEq(u.searchParams.get('t'), W.widgetToken)) return send(res, 401, '');
    let f = null;
    if (u.searchParams.get('k') === 'avatar') f = W.avatar && path.resolve(ROOT, W.avatar);
    else { const ep = latestPublished(); const pj = ep && (readPj(ep.dir) || {}); const rel = pj && ((pj.covers || {})[u.searchParams.get('k') || '4x3'] || Object.values(pj.covers || {})[0]); f = rel && path.join(ep.dir, rel); }
    if (!f || !fs.existsSync(f)) return send(res, 404, '');
    const t = thumb(f, Math.min(800, +u.searchParams.get('w') || 400));
    return send(res, 200, fs.readFileSync(t || f), t ? 'image/jpeg' : 'image/png', { 'cache-control': 'max-age=1800' });
  }
  if (u.pathname === '/api/widget/code') return W.widgetToken && tokenEq(u.searchParams.get('t'), W.widgetToken) ? send(res, 200, widgetScript(req, 'maitian-widget.js'), 'text/javascript; charset=utf-8') : send(res, 401, '');   // 加载器每次刷新来取最新代码
  if (u.pathname === '/api/widget') return W.widgetToken && tokenEq(u.searchParams.get('t') || req.headers['x-widget-token'], W.widgetToken) ? send(res, 200, widgetData()) : send(res, 401, { error: '小组件口令不对' });
  if (u.pathname === '/manifest.webmanifest') return send(res, 200, { name: config.name || '麦田', short_name: config.name || '麦田', start_url: '/', display: 'standalone', background_color: '#efe7d8', theme_color: '#efe7d8', icons: [{ src: '/static/icon-512.png', sizes: '512x512', type: 'image/png' }] }, 'application/manifest+json');
  // 飞书验证码登录（config.web.login = "feishu"）：/login 页面和接口不需要先登录
  const LOGIN = W.login === 'feishu' && config.feishuWebhook;
  if (LOGIN && await handleLogin(req, res, u, send)) return;
  const cookieKey = ((req.headers.cookie || '').match(/mt_key=([^;]+)/) || [])[1];
  if (W.key && cookieKey !== W.key && !(LOGIN && sessionOk(req)) && !(await accessEmail(req, W.access))) {
    if (u.searchParams.get('key') === W.key) return send(res, 302, '', 'text/plain', { 'set-cookie': `mt_key=${W.key}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`, location: '/' });
    if (LOGIN) return u.pathname.startsWith('/api/') ? send(res, 401, { error: '需要登录' }) : send(res, 302, '', 'text/plain', { location: '/login' });
    return send(res, 401, '<meta charset="utf-8"><body style="font:16px system-ui;padding:40px">需要访问口令。请用带 <code>?key=…</code> 的地址打开一次。</body>', 'text/html; charset=utf-8');
  }
  if (u.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method)) {
    const origin = req.headers.origin, protocol = req.headers['x-forwarded-proto'] || (req.socket.encrypted || /https/.test(req.headers['cf-visitor'] || '') ? 'https' : 'http');
    if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== `${protocol}://${req.headers.host}`)) return send(res, 403, { error: '不接受其他网站发起的操作' });
  }
  if (u.pathname === '/api/settings') {
    if (req.method === 'GET') return send(res, 200, settingsView(config));
    if (req.method !== 'PUT') return send(res, 405, { error: '不支持的请求方法' });
    let body; try { body = await readJson(req); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
    try { return send(res, 200, saveSettings(body)); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (u.pathname.startsWith('/static/')) { const f = path.join(DIR, 'web', path.basename(u.pathname)); if (!/\.(css|js|png)$/.test(f) || !fs.existsSync(f)) return send(res, 404, ''); return send(res, 200, fs.readFileSync(f), f.endsWith('.css') ? 'text/css; charset=utf-8' : f.endsWith('.png') ? 'image/png' : 'text/javascript; charset=utf-8'); }
  if (u.pathname === '/p') return send(res, 200, fs.readFileSync(path.join(DIR, 'web', 'pages.html')), 'text/html; charset=utf-8');
  if (u.pathname === '/board') return send(res, 200, fs.readFileSync(path.join(DIR, 'web', 'board.html')), 'text/html; charset=utf-8');
  if (u.pathname === '/') return send(res, 200, fs.readFileSync(path.join(DIR, 'web', 'board.html')), 'text/html; charset=utf-8');
  if (u.pathname === '/widget') {   // 小组件安装页（已登录才能看）：脚本里填好麦田地址和小组件口令，手机上一键复制
    if (!W.widgetToken) return send(res, 404, '<meta charset="utf-8">没配 config.web.widgetToken', 'text/html; charset=utf-8');
    return send(res, 200, widgetPage(widgetScript(req, 'maitian-loader.js')), 'text/html; charset=utf-8');
  }
  if (u.pathname === '/api/overview') {
    const targets = getTargets(config), active = new Set(targets.map(t => t.id)), siteOn = siteEnabled();
    const siteDays = !siteOn ? [] : db.prepare('SELECT * FROM site_daily ORDER BY day').all();
    const episodeRows = episodes().sort((a, b) => (b.episode || 0) - (a.episode || 0)).map(e => episodeView(e));
    return send(res, 200, { name: config.name || '麦田', targets: targets.map(({ id, platform, accountId, name }) => ({ id, platform, accountId, name })), names: targetNames(), siteOn, siteNeedsSetup: !config.site?.base,
      learn: learnOn(config) ? learnUrl('maitian-board') : '', siteName: siteOn ? SITE.name : '', siteLogo: !!(siteOn && config.site.logo), board: config.board && config.board.url, driver: config.driver,
      episodes: episodeRows, actions: actions.filter((a, i) => !a.done || i >= actions.length - 8).reverse(),
      ...(u.searchParams.has('traffic') && { accountTraffic: accountTrafficView(db, targets.filter(t => ['bilibili','douyin','xhs'].includes(t.platform)).map(t => t.id)) }),
      site: { days: siteDays, channels: siteOn ? db.prepare('SELECT * FROM site_channels ORDER BY revenue DESC').all() : [],
        campaigns: siteOn ? db.prepare('SELECT * FROM site_campaigns ORDER BY reg DESC').all() : [], campaignsOn: siteOn && getMeta('siteCampaigns') === 'on' },
      metrics: db.prepare('SELECT day, episode_id, platform, views FROM metrics ORDER BY day').all().filter(r => active.has(r.platform)),
      followers: db.prepare("SELECT day, platform, total, gain, loss, source FROM followers WHERE day >= date('now','localtime','-40 day') ORDER BY day").all().filter(r => active.has(r.platform)),
      samples: db.prepare('SELECT ts, episode_id, platform, views FROM samples ORDER BY ts').all().filter(r => active.has(r.platform)),
      feed: feed(episodeRows), health: { nas: fs.existsSync(config.rootPath), chrome: await chromeUp(), metricsDay: getMeta('metricsDay') || '', doctorDay: getMeta('doctorDay') || '', platforms: platformList(), login: Object.fromEntries((config.keepAlive || []).filter(k => active.has(k)).map(k => [k, getMeta(`login:${k}`) || '']) ) }, now: new Date().toISOString() });
  }
  if (u.pathname === '/site-logo') {
    const logo = siteEnabled() && config.site.logo;
    if (!logo) return send(res, 404, '');
    const full = path.resolve(ROOT, logo);
    try {
      const f = fs.realpathSync(full), types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
      const mime = types[path.extname(f).toLowerCase()];
      if (!mime || (!path.isAbsolute(logo) && !f.startsWith(fs.realpathSync(ROOT) + path.sep)) || !fs.statSync(f).isFile()) return send(res, 404, '');
      return send(res, 200, fs.readFileSync(f), mime, { 'cache-control': 'max-age=3600', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
    } catch { return send(res, 404, ''); }
  }
  if (u.pathname === '/api/episode') { const ep = getEpisode(u.searchParams.get('id')); return ep ? send(res, 200, episodeView(ep, true)) : send(res, 404, { error: '没有这一期' }); }
  if (u.pathname === '/cover' || u.pathname === '/shot') {
    const ep = getEpisode(u.searchParams.get('id')); if (!ep) return send(res, 404, '');
    let f;
    if (u.pathname === '/shot') {
      const id = u.searchParams.get('p'); if (!activeIds().has(id)) return send(res, 404, '');
      f = path.join(ep.dir, '发布档案', `${id}.jpg`);
    }
    else { const pj = readPj(ep.dir) || {}; const rel = (pj.covers || {})[u.searchParams.get('k') || '4x3'] || Object.values(pj.covers || {})[0]; f = rel && path.join(ep.dir, rel); }
    if (!f || !f.startsWith(ep.dir) || !fs.existsSync(f)) return send(res, 404, '');
    // 远程打开时原图（每张 ~700KB）太慢：默认给缩略图（长边 ≤ w，默认 720，JPEG），缓存在 data/thumbs；?full=1 给原图
    if (!u.searchParams.get('full') && !/\.svg$/.test(f)) { const t = thumb(f, Math.min(1600, +u.searchParams.get('w') || 720)); if (t) return send(res, 200, fs.readFileSync(t), 'image/jpeg', { 'cache-control': 'max-age=3600' }); }
    return send(res, 200, fs.readFileSync(f), /\.png$/.test(f) ? 'image/png' : /\.svg$/.test(f) ? 'image/svg+xml' : 'image/jpeg', { 'cache-control': 'max-age=300' });
  }
  if (u.pathname === '/api/integrations') return req.method === 'GET' ? send(res, 200, integrations()) : send(res, 405, { error: '不支持的请求方法' });
  const integrationRoute = u.pathname.match(/^\/api\/integrations\/(feishu|site)(\/test)?$/);
  if (integrationRoute || u.pathname === '/api/platform-toggle') {
    if (req.method !== 'POST') return send(res, 405, { error: '不支持的请求方法' });
    try {
      const patch = await readJson(req);
      if (!integrationRoute) return send(res, 200, setPlatformEnabled(patch.platform, patch.on));
      const [, kind, test] = integrationRoute;
      if (test) {
        const result = kind === 'feishu' ? await testFeishu(patch.webhook === undefined ? config.feishuWebhook : patch.webhook) : await testSite(patch);
        setMeta(`integrations.${kind}.lastTest`, JSON.stringify({ ...result, ts: new Date().toISOString() }));
        return send(res, 200, result);
      }
      if (kind === 'feishu') saveFeishu(patch);
      else saveSite(patch);
      return send(res, 200, { [kind]: integrations()[kind] });
    } catch (e) {
      const status = e.status || (e.code ? 500 : 400);
      return send(res, status, { error: status === 500 ? '读写系统设置失败' : e.message });
    }
  }
  if (u.pathname === '/api/action' && req.method === 'POST') {
      let a; try { a = await readJson(req); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
      if (['doctor', 'login'].includes(a.type) && a.platform !== undefined && !getTargets(config).some(t => t.id === a.platform && t.platform !== 'zsz')) return send(res, 400, { error: '平台账号不存在或已停用' });
      const map = { sync: ['sync', a.id], metrics: a.id ? ['metrics', a.id] : ['metrics'],
        doctor: ['doctor', ...(a.platform ? ['--only', a.platform, '--quiet'] : ['--notify'])],
        login: ['login', ...(a.platform ? ['--only', a.platform] : [])], board: ['board'], followers: ['followers'],
        mark: ['mark', a.id, a.platform, a.state, a.note || '在麦田里标记', ...(a.url ? ['--url', a.url] : [])], accountLogin: ['account-login', a.accountId], accountCheck: ['account-check', a.accountId] };
      const argv = Object.hasOwn(map, a.type) && map[a.type];
      if (!argv || argv.some(x => typeof x !== 'string' || !x)) return send(res, 400, { error: '不支持的操作' });
      const target = getTargets(config).find(t => t.platform === 'bilibili' && t.accountId === a.accountId);
      if (['accountLogin', 'accountCheck'].includes(a.type) && !target) return send(res, 400, { error: '账号不存在或已停用' });
      if (a.type === 'mark' && (a.state !== 'published' || !getEpisode(a.id) || !activeIds().has(a.platform))) return send(res, 400, { error: '状态不对' });
      if (actions.some(x => !x.done && x.type !== 'mark') && !['mark', 'login'].includes(a.type)) return send(res, 409, { error: '上一个操作还在跑，等它结束' });
      const rec = { platform: a.platform || null, type: a.type, label: { sync: '取链接', metrics: '采流量', doctor: '体检', board: `同步${SITE ? SITE.name : '知识站'}数据`, followers: '采粉丝', mark: '标记状态', retry: '重跑平台', login: '打开登录页', accountLogin: '登录账号', accountCheck: '检查账号' }[a.type] + (target ? ` · ${target.name}` : a.platform ? ` · ${targetNames()[a.platform] || a.platform}` : ''), startedAt: new Date().toISOString(), done: false, ok: null, tail: '' };
      actions.push(rec);
      while (actions.length > 32 && actions[0].done) actions.shift();
      const ch = spawn(process.execPath, [path.join(DIR, 'hub.mjs'), ...argv], { cwd: ROOT, env: { ...process.env, HUB_NO_WEB: '1' } });
      const on = (d) => { rec.tail = (rec.tail + d).slice(-600); }; ch.stdout.on('data', on); ch.stderr.on('data', on);
      ch.on('close', (code) => { rec.done = true; rec.ok = code === 0; rec.endedAt = new Date().toISOString(); });
      ch.on('error', err => { rec.done = true; rec.ok = false; rec.tail = err.message; rec.endedAt = new Date().toISOString(); });
      send(res, 200, { ok: true });
    return;
  }
  send(res, 404, { error: 'not found' });
}
export function startWeb() {
  const srv = http.createServer((req, res) => { handle(req, res).catch((e) => { try { send(res, 500, { error: e.message }); } catch {} }); });
  initLogin(ROOT);
  srv.listen(W.port, '0.0.0.0', () => console.log(`麦田网页：http://localhost:${W.port}/?key=${W.key}`));
  srv.on('error', (e) => console.error('麦田网页没起来：' + e.message));
  return srv;
}
