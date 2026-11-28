// 麦田下钻页的公共部分：格式化、Logo、顶栏、提示、图表
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => n == null ? '–' : Math.round(n).toLocaleString('en-US');
const sgn = (n) => (n > 0 ? '+' : '') + fmt(n);
const pad = (n) => String(n).padStart(2, '0');
const pct = (a, b, d = 0) => b ? (a / b * 100).toFixed(d) + '%' : '–';
const sum = (arr, k) => arr.reduce((s, r) => s + (r[k] || 0), 0);
const PL_ALL = ['bilibili', 'douyin', 'xhs', 'channels', 'acfun', 'kuaishou', 'wechat', 'youtube', 'x', 'instagram', 'threads', 'zsz'];
let PL = PL_ALL;
const PN = { bilibili: 'B站', douyin: '抖音', xhs: '小红书', channels: '视频号', acfun: 'A站', kuaishou: '快手', wechat: '公众号', youtube: 'YouTube', x: 'X', instagram: 'Instagram', threads: 'Threads', zsz: '知识站' };
const safeUrl = (u) => /^https?:\/\//.test(u || '') ? esc(u) : '';
const when = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? esc(iso) : `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? '刚刚' : m < 60 ? m + ' 分钟前' : m < 1440 ? Math.round(m / 60) + ' 小时前' : Math.round(m / 1440) + ' 天前'; };
const inter = (m) => m ? (m.likes || 0) + (m.comments || 0) + (m.favorites || 0) + (m.shares || 0) : 0;
const chip = (t) => `<span class="st-chip ${esc(t.state)}"><i>${({ published: '✓', scheduled: '◷', awaiting_user: '!', filled: '!', failed: '✕', not_logged_in: '✕', running: '…', planned: '◌' })[t.state] || '○'}</i>${esc(t.stateCn)}</span>`;
const delta = (a, b) => { if (!b) return '<span style="color:var(--t3)">前 7 天没有数据</span>'; const p = (a - b) / b * 100; return `<span class="pill ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '↑' : '↓'} ${Math.abs(p).toFixed(0)}%</span><span style="color:var(--t3)">较前 7 天 ${fmt(b)}</span>`; };
async function api(p) { const r = await fetch(p); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status); return r.json(); }
function toast(t, ms = 2600) { const d = document.createElement('div'); d.className = 'toast'; d.role = 'status'; d.textContent = t; document.body.append(d); setTimeout(() => d.remove(), ms); }
// 平台登录灯：只看没停用的平台；没检查过不算掉线（原来只看 keepAlive 那一家，视频号正常就报绿）
function loginLight(h) {
  const ps = (h.platforms || []).filter(p => !p.disabled);
  const bad = ps.filter(p => p.state && p.state !== 'ok').length, none = !ps.length || ps.every(p => !p.state);
  if (bad) return ['bad', `平台登录 ${bad} 家掉线`];
  if (none) return ['warn', '平台登录 还没检'];
  const unchecked = ps.filter(p => !p.state).length;
  if (unchecked) return ['warn', `平台登录 ${unchecked} 个账号待检查`];
  return ['ok', '平台登录 正常'];
}
const platformSummary = (h) => loginLight(h)[1].replace(/^平台登录 /, '');
function topbar(O, on) {
  const h = O.health, n = new Date(), [lc, lt] = loginLight(h);
  const nav = [['/', '大屏', 'board'], ['/p#/traffic', '流量', 'traffic'], ['/p#/calendar', '日历', 'calendar'], ['/p#/convert', O.siteSalesOnly ? '销售' : '转化', 'convert'], ['/p#/archive', '档案', 'archive'], ['/p#/system', '系统', 'system']];
  return `<div class="top"><a class="logo" href="/">麦<i>田</i></a><div class="tag">内容与粉丝监控</div><div class="nav">${nav.map(([u, t, k]) => `<a class="${k === on ? 'on' : ''}" href="${u}">${t}</a>`).join('')}</div>
    <div class="lights"><span class="light ok">守护进程 运行中</span><span class="light ${h.nas ? 'ok' : 'bad'}">NAS ${h.nas ? '已挂载' : '读不到'}</span><span class="light ${h.chrome ? 'ok' : 'bad'}">专用浏览器 ${h.chrome ? '在线' : '没开'}</span><span class="light ${lc}">${lt}</span></div>
    <div class="clock"><small>${n.getMonth() + 1}/${n.getDate()} 周${'日一二三四五六'[n.getDay()]}</small>${pad(n.getHours())}:${pad(n.getMinutes())}</div></div>`;
}
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1)))); const m = v / p; return (m <= 1 ? 1 : m <= 1.5 ? 1.5 : m <= 2 ? 2 : m <= 3 ? 3 : m <= 4 ? 4 : m <= 5 ? 5 : m <= 7.5 ? 7.5 : 10) * p; }
// 按天的柱图；最后 7 根更亮
function drawCols(el, rows, unit = '') {
  const w = el.clientWidth, h = el.clientHeight; if (w < 60 || h < 60 || !rows.length) return;
  const value = n => unit === '¥' ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmt(n);
  const L = 52, R = 6, T = 18, B = 20, n = rows.length, pw = w - L - R, ph = h - T - B, band = pw / n, bw = Math.min(24, Math.max(2, band - 4));
  const top = niceMax(Math.max(...rows.map(r => r.y), 1)), Y = (v) => T + ph - v / top * ph, id = 'g' + Math.random().toString(36).slice(2, 7);
  let s = `<svg width="${w}" height="${h}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0071e3"/><stop offset="1" stop-color="#0071e3" stop-opacity=".45"/></linearGradient></defs>`;
  for (const t of [0, top / 2, top]) s += `<line x1="${L}" x2="${w - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="rgba(0,0,0,.07)"/><text x="${L - 6}" y="${Y(t) + 4}" text-anchor="end">${unit}${t >= 10000 ? t / 10000 + '万' : fmt(t)}</text>`;
  rows.forEach((r, i) => {
    const x = L + i * band + (band - bw) / 2, bh = r.y / top * ph, y = Y(r.y), rr = Math.min(5, bh, bw / 2);
    if (r.y > 0) s += `<path class="bar" style="animation-delay:${i * 14}ms" opacity="${i >= n - 7 ? 1 : .42}" d="M${x.toFixed(1)},${(T + ph).toFixed(1)} V${(y + rr).toFixed(1)} q0,${-rr} ${rr},${-rr} h${(bw - 2 * rr).toFixed(1)} q${rr},0 ${rr},${rr} V${(T + ph).toFixed(1)} Z" fill="url(#${id})"/>`;
    if ((i % 5 === 0 && n - 1 - i > 4) || i === n - 1) s += `<text x="${(x + bw / 2).toFixed(1)}" y="${h - 5}" text-anchor="${i === n - 1 ? 'end' : 'middle'}">${esc(r.x)}</text>`;
    s += `<rect x="${(L + i * band).toFixed(1)}" y="${T}" width="${band.toFixed(1)}" height="${ph}" fill="transparent" data-tip="${esc(r.x)}  ${unit}${value(r.y)}"/>`;
  });
  const mx = rows.reduce((a, r, i) => r.y > rows[a].y ? i : a, 0);
  if (rows[mx].y > 0) s += `<text x="${(L + mx * band + band / 2).toFixed(1)}" y="${Y(rows[mx].y) - 5}" text-anchor="middle" style="fill:var(--t1);font-weight:600">${unit}${value(rows[mx].y)}</text>`;
  el.innerHTML = s + '</svg>';
}
// 多条线（按时间）：series = [{ name, pts: [[t, y]] }]，越靠前的线越亮
function drawLines(el, series) {
  const w = el.clientWidth, h = el.clientHeight; let all = series.flatMap(s => s.pts); if (w < 60 || h < 60) return;
  series = series.filter(s => s.pts.length >= 2); const span = all.length ? Math.max(...all.map(p => p[0])) - Math.min(...all.map(p => p[0])) : 0;
  if (!series.length || span < 3600e3) { el.innerHTML = '<div class="empty">采样还不够，攒到两次以上（间隔几小时）这里会画出每个平台的走势</div>'; return; }
  all.length = 0; all.push(...series.flatMap(s => s.pts));
  const L = 52, R = 70, T = 14, B = 22, x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0])), top = niceMax(Math.max(...all.map(p => p[1]), 1));
  const X = (t) => L + (t - x0) / (x1 - x0) * (w - L - R), Y = (v) => T + (h - T - B) - v / top * (h - T - B);
  let s = `<svg width="${w}" height="${h}">`;
  for (const t of [0, top / 2, top]) s += `<line x1="${L}" x2="${w - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="rgba(42,54,200,.2)"/><text x="${L - 6}" y="${Y(t) + 4}" text-anchor="end">${t >= 10000 ? t / 10000 + '万' : fmt(t)}</text>`;
  series.forEach((sr, i) => { if (!sr.pts.length) return; const op = Math.max(.3, 1 - i * .17), last = sr.pts[sr.pts.length - 1];
    s += `<polyline points="${sr.pts.map(p => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ')}" fill="none" stroke="var(--p-${(Object.hasOwn(PN, sr.platform) ? sr.platform : Object.keys(PN).find(k => PN[k] === sr.name))})" stroke-opacity="1" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="4" fill="var(--p-${(Object.hasOwn(PN, sr.platform) ? sr.platform : Object.keys(PN).find(k => PN[k] === sr.name))})" stroke="#fff" stroke-width="2" data-tip="${esc(sr.name)}  ${fmt(last[1])}"/><text x="${(X(last[0]) + 8).toFixed(1)}" y="${(Y(last[1]) + 4).toFixed(1)}" style="fill:var(--t2)">${esc(sr.name)}</text>`; });
  const f = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:00`; };
  s += `<text x="${L}" y="${h - 5}">${f(x0)}</text><text x="${w - R}" y="${h - 5}" text-anchor="end">${f(x1)}</text>`;
  el.innerHTML = s + '</svg>';
}
(() => {
  const tip = document.createElement('div'); tip.id = 'tip'; document.addEventListener('DOMContentLoaded', () => document.body.append(tip));
  document.addEventListener('mousemove', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (!t) { tip.style.display = 'none'; return; } tip.textContent = t.dataset.tip; tip.style.display = 'block'; tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, e.clientX + 14) + 'px'; tip.style.top = Math.max(8, e.clientY - 34) + 'px'; });
})();

const salesUpdated = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '未同步';
function salesPeriods(s) {
  return `<div class="sales-periods">${[['today', '当天'], ['week', '近 7 天'], ['month', '近 30 天']].map(([key, label]) => {
    const p = s.periods?.[key] || {};
    return `<section class="sales-period" aria-label="${label}"><h4>${label}${key === 'today' ? '<span class="sales-live">进行中</span>' : ''}</h4><dl><div class="sales-paid"><dt>支付金额</dt><dd>${salesMoney(p.revenue)}</dd></div><div><dt>支付订单</dt><dd>${fmt(p.orders)}</dd></div><div><dt>退款金额</dt><dd>${salesMoney(p.refund)}</dd></div><div><dt>支付净额</dt><dd>${salesMoney(p.net)}</dd></div></dl></section>`;
  }).join('')}</div>`;
}
function salesOrders(s, limit) {
  const orders = (s.recentOrders || []).slice(0, limit);
  return `${s.ordersError ? `<p class="sales-error" role="status">${esc(s.ordersError)}</p>` : ''}${orders.length ? `<ol class="sales-orders">${orders.map(o => `<li data-sales-order="${esc(o.id)}"><div class="sales-order-title" title="${esc(o.title)}">${esc(o.title)}</div><b>${salesMoney(o.amount)}</b><time>${esc(o.time?.slice(5, 16) || '–')}</time><span class="sales-state ${['paid','pending','closed','refunded','refunding','partial_refund'].includes(o.kind) ? o.kind : ''}">${esc(o.status)}</span></li>`).join('')}</ol>` : `<div class="sales-empty">${s.ordersSyncedAt ? '暂无订单' : '订单未同步'}</div>`}`;
}
