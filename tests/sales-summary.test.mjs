import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const NOW = Date.parse('2026-11-16T16:30:00Z');
const syncedAt = '2026-11-16T16:20:00.000Z';
const fixture = () => Array.from({ length: 32 }, (_, i) => ({ day: new Date(Date.parse('2026-10-17T00:00:00Z') + i * 86400000).toISOString().slice(0, 10), orders: 2, revenue: 10.01, refund: 0.01 }));

test('sales windows include Shanghai today and sum integer cents', async () => {
  const { buildSalesSummary } = await import('../src/sales.mjs');
  const r = buildSalesSummary({ days: fixture(), now: NOW, syncedAt, orders: [], ordersSyncedAt: syncedAt });
  assert.equal(r.today, '2026-11-17');
  assert.deepEqual(r.periods.today, { days: 1, complete: true, orders: 2, revenue: 10.01, refund: 0.01, net: 10 });
  assert.deepEqual(r.periods.week, { days: 7, complete: true, orders: 14, revenue: 70.07, refund: 0.07, net: 70 });
  assert.deepEqual(r.periods.month, { days: 30, complete: true, orders: 60, revenue: 300.3, refund: 0.3, net: 300 });
  assert.equal(r.trend.length, 30); assert.equal(r.trend[0].day, '2026-10-19');
  assert.equal(r.trend.at(-1).day, '2026-11-17');
  assert.equal(r.trend.filter(d => d.provisional).length, 1); assert.equal(r.trend.at(-1).provisional, true);
  assert.equal(r.syncedAt, syncedAt); assert.equal(r.ordersSyncedAt, syncedAt); assert.equal(r.error, '');
});
test('missing dates or fields do not become zero or partial period totals', async () => {
  const { buildSalesSummary } = await import('../src/sales.mjs');
  const days = fixture().filter(d => d.day !== '2026-11-16');
  days.find(d => d.day === '2026-11-17').refund = null;
  const r = buildSalesSummary({ days, now: NOW, syncedAt });
  assert.deepEqual(r.periods.today, { days: 1, complete: false, orders: 2, revenue: 10.01, refund: null, net: null });
  assert.deepEqual(r.periods.week, { days: 7, complete: false, orders: null, revenue: null, refund: null, net: null });
  assert.equal(r.periods.month.complete, false);
  assert.deepEqual(r.recentOrders, []); assert.equal(r.ordersSyncedAt, null);
});
test('yesterday snapshots cannot masquerade as live today even if a stale today row exists', async () => {
  const { buildSalesSummary } = await import('../src/sales.mjs');
  for (const sync of [undefined, 'invalid', '2026-11-16T15:59:00Z']) {
    const r = buildSalesSummary({ days: fixture(), now: NOW, syncedAt: sync, error: '登录过期' });
    assert.deepEqual(r.periods.today, { days: 1, complete: false, orders: null, revenue: null, refund: null, net: null });
    assert.equal(r.periods.week.revenue, null); assert.equal(r.periods.month.complete, false);
    assert.equal(r.error, '登录过期');
  }
});
test('recent order output is bounded, newest first and excludes private detail fields', async () => {
  const { buildSalesSummary } = await import('../src/sales.mjs');
  const orders = Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: '课程', amount: 19.99, status: '已支付', time: `2026-11-17 12:${String(i).padStart(2, '0')}:00`, kind: 'payment', phone: 'private', user_id: 'private' }));
  const r = buildSalesSummary({ days: [], orders, now: NOW, ordersSyncedAt: syncedAt, ordersError: '订单暂未更新' });
  assert.equal(r.recentOrders.length, 10); assert.equal(r.recentOrders[0].id, '11'); assert.equal(r.recentOrders.at(-1).id, '2');
  assert.deepEqual(Object.keys(r.recentOrders[0]).sort(), ['amount', 'id', 'kind', 'status', 'time', 'title']);
  assert.equal(r.ordersError, '订单暂未更新');
});
test('zero sales are complete and invalid numeric fields remain unknown', async () => {
  const { buildSalesSummary } = await import('../src/sales.mjs');
  const days = [{ day: '2026-11-17', orders: 0, revenue: 0, refund: 0 }];
  assert.deepEqual(buildSalesSummary({ days, now: NOW, syncedAt }).periods.today, { days: 1, complete: true, orders: 0, revenue: 0, refund: 0, net: 0 });
  days[0].orders = 0.5; days[0].revenue = Infinity;
  const r = buildSalesSummary({ days, now: NOW, syncedAt });
  assert.equal(r.periods.today.orders, null); assert.equal(r.periods.today.revenue, null); assert.equal(r.periods.today.refund, 0); assert.equal(r.periods.today.net, null);
});

test('overview serves bounded local sales and hides disabled site data', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-sales-api-'));
  const cfg = path.join(dir, 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ rootPath: dir, site: { provider: 'xiaoe', name: '小鹅通', shopName: '示例店铺', base: 'https://admin.xiaoe-tech.com' }, web: { port: 0, key: '' } }));
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import {once} from 'node:events'; import fs from 'node:fs'; import assert from 'node:assert/strict';
      const {db,setMeta}=await import('./src/db.mjs');
      db.exec('CREATE TABLE IF NOT EXISTS followers(day TEXT,platform TEXT,total INTEGER,gain INTEGER,loss INTEGER,source TEXT,collected_at TEXT); CREATE TABLE IF NOT EXISTS site_orders(id TEXT PRIMARY KEY,title TEXT,amount REAL,status TEXT,time TEXT,kind TEXT);');
      const now=Date.now(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
      const start=Date.parse(today+'T00:00:00Z')-40*86400000;
      const put=db.prepare('INSERT INTO site_daily(day,orders,revenue,refund) VALUES (?,?,?,?)');
      for(let i=0;i<=40;i++)put.run(new Date(start+i*86400000).toISOString().slice(0,10),1,1.01,0.01);
      const order=db.prepare('INSERT INTO site_orders VALUES (?,?,?,?,?,?)');for(let i=0;i<20;i++)order.run('o'+i,'课程',1.01,'已支付',today+' 12:'+String(i).padStart(2,'0')+':00','payment');
      setMeta('siteShopName','示例店铺');setMeta('siteLiveSyncedAt',new Date(now).toISOString());setMeta('siteOrdersSyncedAt',new Date(now).toISOString());
      const oldFetch=globalThis.fetch;globalThis.fetch=(...args)=>{if(String(args[0]).includes('xiaoe-tech'))throw new Error('overview must not contact browser or platform');return oldFetch(...args)};
      const {startWeb}=await import('./src/web.mjs');const server=startWeb();if(!server.listening)await once(server,'listening');const url='http://127.0.0.1:'+server.address().port;
      try{
        let v=await(await fetch(url+'/api/overview')).json();assert.equal(v.site.sales.periods.month.revenue,30.3);assert.equal(v.site.sales.periods.month.orders,30);assert.equal(v.site.days.length,30);assert.equal(v.site.sales.recentOrders.length,10);assert.equal(v.site.sales.recentOrders[0].id,'o19');
        setMeta('siteShopName','其他示例店铺');v=await(await fetch(url+'/api/overview')).json();assert.deepEqual(v.site.sales.recentOrders,[]);assert.deepEqual(v.site.days,[]);
        await fetch(url+'/api/integrations/site',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:false})});
        v=await(await fetch(url+'/api/overview')).json();assert.equal(v.siteOn,false);assert.deepEqual(v.site.days,[]);assert.equal(v.site.sales,undefined);
      }finally{await new Promise(r=>server.close(r));db.close()}
    `], { cwd: root, env: { ...process.env, MAITIAN_CONFIG: cfg, MAITIAN_DB: path.join(dir, 'hub.db'), NODE_NO_WARNINGS: '1' }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr + result.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
