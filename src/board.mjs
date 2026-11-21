// 飞书多维表格看板：期数、平台发布、每日流量、知识站每日、渠道转化。中控单向写入，按 key 更新不重复。
import fs from 'node:fs'; import path from 'node:path'; import { execFile } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { db, NAMES, STATE_CN, episodes, getTasks, setMeta, getMeta } from './db.mjs';
import { config, CFG } from './feishu.mjs';
import { evaluate, withTab } from './driver.mjs';
import { SITE } from './site.mjs';
import { randomUUID } from 'node:crypto';
import { saveXiaoeLive } from './xiaoe-live.mjs';
import { fetchXiaoeSnapshot, saveXiaoeDays } from './xiaoe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const B = config.board;
const SRC = { twitter: 'X', bilibili: 'B站', douyin: '抖音', xiaohongshu: '小红书', coze: 'Coze 官方', friend: '朋友推荐', youtube: 'YouTube', ai_search: 'AI 搜索', creator: '博主推荐', offline: '线下活动', wechat: '微信', wechat_miniapp: '微信小程序', other: '其他渠道', unknown: '未填写' };

function lark(args, body) {
  const f = path.join(ROOT, 'data', `board-${process.pid}.json`);
  fs.writeFileSync(f, JSON.stringify(body));
  return new Promise((res, rej) => execFile('lark-cli', [...args, '--json', `@./data/${path.basename(f)}`, '--as', 'user'], { cwd: ROOT, maxBuffer: 20e6 }, (err, out, errOut) => {
    fs.rmSync(f, { force: true });
    let j = null; try { j = JSON.parse(out); } catch { /* 不是 JSON */ }
    if (j && j.ok) return res(j.data);
    rej(new Error((j && JSON.stringify(j.error || j).slice(0, 300)) || (errOut || (err && err.message) || '').slice(0, 300)));
  }));
}
// rows: [{key, fields}]；已有的更新，没有的新建
async function upsert(tbl, rows) {
  if (!rows.length) return 0;
  const tid = B.tables[tbl], base = ['--base-token', B.baseToken, '--table-id', tid];
  const known = new Map(db.prepare('SELECT key, record_id FROM board_records WHERE tbl=?').all(tbl).map(r => [r.key, r.record_id]));
  const news = rows.filter(r => !known.has(r.key)), olds = rows.filter(r => known.has(r.key));
  for (let i = 0; i < news.length; i += 200) {
    const part = news.slice(i, i + 200);
    const d = await lark(['base', '+record-batch-create', ...base], { create_records: part.map(r => r.fields) });
    const ids = d.record_id_list || (d.records || []).map(r => r.record_id) || [];
    if (ids.length !== part.length) throw new Error(`看板写入返回的记录数不对（${ids.length}/${part.length}）`);
    const ins = db.prepare('INSERT OR REPLACE INTO board_records (tbl, key, record_id) VALUES (?,?,?)');
    part.forEach((r, k) => ins.run(tbl, r.key, ids[k]));
  }
  for (let i = 0; i < olds.length; i += 200) {
    const part = olds.slice(i, i + 200);
    await lark(['base', '+record-batch-update', ...base], { update_records: Object.fromEntries(part.map(r => [known.get(r.key), r.fields])) });
  }
  return rows.length;
}
const ts = (d) => { const x = new Date(d); return isNaN(x) ? null : new Date(x.getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); };
const nowTs = () => ts(Date.now());
const short = (name) => name.split(/[｜|]/)[0].trim();
const campaign = (dir) => { try { const pj = JSON.parse(fs.readFileSync(path.join(dir, 'publish.json'), 'utf8')); return (JSON.stringify(pj.platforms).match(/utm_campaign=([\w-]+)/) || [])[1] || ''; } catch { return ''; } };

// 知识站后台的汇总数据（只读）：每日注册/会员/订单/收入，按渠道的注册和转化
export async function fetchSite({ history = true } = {}) {
  const site = SITE;
  if (!site) throw new Error('自有站点未启用');
  if (site.salesOnly) {
    const owner = randomUUID(), until = Date.now() + 120000;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (Number(getMeta('siteSyncUntil')) > Date.now()) throw new Error('销售同步正在进行');
      setMeta('siteSyncUntil', until); setMeta('siteSyncOwner', owner);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    let failure = null;
    try {
      const snapshot = await fetchXiaoeSnapshot(site, { history });
      db.exec('BEGIN IMMEDIATE');
      try {
        if (getMeta('siteSyncOwner') !== owner || Number(getMeta('siteSyncUntil')) <= Date.now()) throw new Error('销售同步租约已过期，请重试');
        const saved = JSON.parse(fs.readFileSync(CFG, 'utf8')).site;
        if (SITE !== site || !saved || saved.enabled === false || saved.provider !== 'xiaoe' || saved.shopName !== site.shopName || saved.base?.replace(/\/$/, '') !== site.base) throw new Error('销售站点配置已变更，请重新同步');
        if (snapshot.days) { saveXiaoeDays(db, snapshot.days, site.shopName); setMeta('siteHistoryDay', snapshot.today.day); }
        saveXiaoeLive(db, snapshot.today, snapshot.orders, site.shopName, { ordersError: snapshot.ordersError });
        if (snapshot.error) setMeta('siteError', snapshot.error);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      const rows = [...(snapshot.days || []), snapshot.today];
      return { days: Object.fromEntries(rows.map(({ day, ...r }) => [day, { ...r, reg: null, vip: null }])), channels: [] };
    } catch (e) { failure = e; throw e; }
    finally {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (getMeta('siteSyncOwner') === owner) {
          if (failure) setMeta('siteError', failure.message.slice(0, 200));
          setMeta('siteSyncUntil', 0); setMeta('siteSyncOwner', '');
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  }
  if (getMeta('siteShopName')) throw new Error('该数据库已绑定小鹅通店铺，请为其他站点使用独立数据库');
  const d = await withTab(SITE.admin, (t) => evaluate(t, `fetch(${JSON.stringify(SITE.dashboardApi)},{credentials:'include'}).then(r=>r.ok?r.json():null).then(x=>x&&({reg:x.registrationTrend,rev:x.revenueTrend,ch:x.channelStats,camp:x.campaignStats||null}))`), { wait: 8000 });
  if (!d) throw new Error('知识站后台数据没读到（管理员登录过期？）');
  const days = {};
  for (const r of d.reg || []) days[r.date] = { reg: r.count || 0, vip: r.vipCount || 0, orders: 0, revenue: 0 };
  for (const r of d.rev || []) Object.assign(days[r.date] ||= { reg: 0, vip: 0 }, { orders: r.count || 0, revenue: r.revenue || 0 });
  const ins = db.prepare('INSERT INTO site_daily (day, reg, vip, orders, revenue) VALUES (?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET reg=excluded.reg, vip=excluded.vip, orders=excluded.orders, revenue=excluded.revenue');
  for (const [day, v] of Object.entries(days)) ins.run(day, v.reg, v.vip, v.orders || 0, v.revenue || 0);
  const insC = db.prepare('INSERT OR REPLACE INTO site_channels (source, label, reg, vip, orders, revenue, updated_at) VALUES (?,?,?,?,?,?,?)');
  for (const c of d.ch || []) insC.run(c.source, SRC[c.source] || c.source, c.registeredCount || 0, c.vipCount || 0, c.orderCount || 0, c.revenue || 0, new Date().toISOString());
  // 按期转化：知识站部署了首次来源记录后才有这个字段
  const insK = db.prepare('INSERT OR REPLACE INTO site_campaigns (campaign, sources, reg, vip, orders, revenue, updated_at) VALUES (?,?,?,?,?,?,?)');
  for (const c of d.camp || []) insK.run(c.campaign, (c.sources || []).join(','), c.registeredCount || 0, c.vipCount || 0, c.orderCount || 0, c.revenue || 0, new Date().toISOString());
  setMeta('siteCampaigns', d.camp ? 'on' : 'off');
  return { days, channels: d.ch || [] };
}

// 实时销售复用守护循环，十分钟至多读取一次；失败也等待下个间隔，避免密集重试。
export async function syncSalesIfDue(now = Date.now()) {
  if (!SITE?.salesOnly) return null;
  const last = Math.max(Date.parse(getMeta('siteLiveSyncedAt') || '') || 0, Number(getMeta('siteSalesAttempt')) || 0);
  if (now - last < 10 * 60000) return null;
  setMeta('siteSalesAttempt', now);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return fetchSite({ history: getMeta('siteHistoryDay') !== day });
}

export async function boardSync({ site = true } = {}) {
  const localSales = site && SITE?.salesOnly ? await fetchSite() : null;
  if (!B) {
    if (!localSales) return null;
    const dates = Object.keys(localSales.days).sort();
    return { 本地站点数据: dates.length, 截止: dates.at(-1) };
  }
  const eps = episodes(), out = {};
  const latest = db.prepare('SELECT * FROM metrics WHERE episode_id=? AND platform=? ORDER BY day DESC LIMIT 1');
  const epRows = [], taskRows = [], pubDays = {};
  for (const ep of eps) {
    const tasks = getTasks(ep.id); let views = 0, inter = 0, pub = 0;
    for (const t of tasks) {
      const m = latest.get(ep.id, t.platform) || {};
      const i = (m.likes || 0) + (m.comments || 0) + (m.favorites || 0) + (m.shares || 0);
      views += m.views || 0; inter += i; if (t.state === 'published') pub++;
      taskRows.push({ key: `${ep.id}|${t.platform}`, fields: { 记录: `${ep.episode || ''} 期 · ${NAMES[t.platform]}`, 期号: ep.episode || null, 标题: short(ep.name), 平台: [NAMES[t.platform]], 状态: [STATE_CN[t.state] || '等待'], 链接: t.url || '', 播放: m.views ?? null, 点赞: m.likes ?? null, 评论: m.comments ?? null, 收藏: m.favorites ?? null, 转发: m.shares ?? null, 互动率: m.views ? Math.round(i / m.views * 10000) / 10000 : null, 备注: t.detail || '', 更新时间: nowTs() } });
    }
    const when = ep.schedule || ep.created_at; const day = ts(when) && ts(when).slice(0, 10);
    if (day) (pubDays[day] ||= []).push(`${ep.episode || ''} 期 ${short(ep.name)}`);
    epRows.push({ key: ep.id, fields: { 期: `${ep.episode || ''} 期 ${short(ep.name)}`, 期号: ep.episode || null, 标题: ep.name, 发布时间: ts(when), 引流标记: campaign(ep.dir), 全平台播放: views, 全平台互动: inter, 已发布平台数: pub, 更新时间: nowTs() } });
  }
  out.期数 = await upsert('episodes', epRows);
  out.平台发布 = await upsert('tasks', taskRows);

  const title = Object.fromEntries(eps.map(e => [e.id, e])), prev = db.prepare('SELECT views FROM metrics WHERE episode_id=? AND platform=? AND day<? ORDER BY day DESC LIMIT 1');
  out.每日流量 = await upsert('daily', db.prepare('SELECT * FROM metrics ORDER BY day').all().filter(m => title[m.episode_id]).map(m => {
    const e = title[m.episode_id], p = prev.get(m.episode_id, m.platform, m.day);
    return { key: `${m.day}|${m.episode_id}|${m.platform}`, fields: { 记录: `${m.day} · ${e.episode || ''} 期 · ${NAMES[m.platform]}`, 日期: `${m.day} 00:00`, 期号: e.episode || null, 标题: short(e.name), 平台: [NAMES[m.platform]], 播放: m.views, 播放增量: p && m.views != null && p.views != null ? m.views - p.views : null, 点赞: m.likes, 评论: m.comments, 收藏: m.favorites, 转发: m.shares } };
  }));

  if (site) {
    try {
      const s = localSales || await fetchSite();
      out.知识站每日 = await upsert('site', Object.entries(s.days).map(([day, v]) => ({ key: day, fields: { 日期文本: day, 日期: `${day} 00:00`, 新注册: v.reg, 新增会员: v.vip, 订单数: v.orders || 0, 收入: v.revenue || 0, 当天发布: (pubDays[day] || []).join('；') } })));
      out.渠道转化 = await upsert('channels', s.channels.map(c => ({ key: c.source, fields: { 渠道: SRC[c.source] || c.source, 注册数: c.registeredCount || 0, 会员数: c.vipCount || 0, 订单数: c.orderCount || 0, 收入: c.revenue || 0, 会员转化率: c.registeredCount ? Math.round((c.vipCount || 0) / c.registeredCount * 1000) / 1000 : 0, 更新时间: nowTs() } })));
    } catch (e) { out.知识站 = `没同步：${e.message}`; }
  }
  return out;
}
