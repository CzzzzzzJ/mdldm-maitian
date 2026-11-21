import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inline = file => [...fs.readFileSync(path.join(root, file), 'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x => x[1]).join('\n');
const period = (days, orders, revenue) => ({ days, complete: true, orders, revenue, refund: 2.01, net: revenue - 2.01 });
const sales = () => ({ today: '2026-11-17', syncedAt: '2026-11-17T08:00:00Z', ordersSyncedAt: '2026-11-17T08:00:00Z', error: '', ordersError: '', periods: {
  today: period(1, 2, 100.01), week: period(7, 22, 700.07), month: period(30, 88, 3000.3),
}, trend: [{ day: '2026-11-16', orders: 1, revenue: 0.01, refund: 0 }, { day: '2026-11-17', orders: 2, revenue: 100.01, refund: 2.01, provisional: true }],
recentOrders: Array.from({ length: 10 }, (_, i) => ({ id: 'o'+i, title: i === 0 ? '<script>订单</script>' : '课程订单'+i, amount: 9.01 + i, status: '已支付', time: '2026-11-17 15:00:00', kind: 'paid' })) });
const fixture = s => ({ now: '2026-11-17T08:00:00Z', siteOn: true, siteSalesOnly: true, siteName: '小鹅通', episodes: [], followers: [], actions: [], health: { login: {}, nas: true, chrome: true }, feed: [], site: { sales: s, days: [{day:'2026-11-16',orders:99,revenue:99999,refund:0}], channels: [], campaigns: [] } });

function boardContext() {
  const screen = { innerHTML: '' }, tip = { style: {} }, listeners = {};
  const ctx = vm.createContext({ console, Date, URLSearchParams, innerWidth: 1300, performance, requestAnimationFrame() {}, matchMedia: () => ({ matches: false }), fetch: () => new Promise(() => {}), setInterval() {}, clearInterval() {}, addEventListener() {}, location: { search: '' }, document: { querySelector: s => s === '#screen' ? screen : s === '#tip' ? tip : null, querySelectorAll: () => [], addEventListener: (type, fn) => (listeners[type] ||= []).push(fn), body: { classList: { add() {} } } } });
  vm.runInContext(inline('src/web/board.html'), ctx);
  return {ctx,screen,listeners};
}
function pageContext() {
  const ctx = vm.createContext({ console, Date, URLSearchParams, fetch: () => new Promise(() => {}), setInterval() {}, clearInterval() {}, addEventListener() {}, location: { hash: '#/convert' }, document: { querySelector() { return null; }, addEventListener() {}, createElement() { return {}; } } });
  vm.runInContext(fs.readFileSync(path.join(root,'src/web/mt.js'),'utf8')+'\n'+inline('src/web/pages.html'),ctx);
  return ctx;
}

test('dashboard displays canonical today, week and month values and five escaped order events', async () => {
  const {ctx,screen} = boardContext(), data=fixture(sales());
  ctx.fetch = async () => ({ok:true,json:async()=>data});
  await vm.runInContext('load()',ctx);
  const html=screen.innerHTML;
  for (const text of ['当天','近 7 天','近 30 天','进行中','¥100.01','¥700.07','¥3,000.30','订单动态','销售详情','同步小鹅通数据']) assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/99,999|<script>订单/);
  assert.match(html,/&lt;script&gt;订单&lt;\/script&gt;/);
  assert.equal((html.match(/data-sales-order=/g)||[]).length,5);
  assert.match(html,/aria-label="近 30 天支付金额趋势"/);
  assert.match(html,/data-sales-sync/);
});

test('sales page shares canonical periods and shows ten recent orders', () => {
  const ctx=pageContext();ctx.fixture=fixture(sales());
  const html=vm.runInContext('O=fixture; PN.zsz=O.siteName; vSales()',ctx);
  for (const text of ['当天','近 7 天','近 30 天','¥100.01','¥700.07','¥3,000.30','订单动态','每日销售']) assert.ok(html.includes(text),text);
  assert.equal((html.match(/data-sales-order=/g)||[]).length,10);
  assert.doesNotMatch(html,/<script>订单|99,999/);
  assert.match(html,/2026-11-17/);
});

test('unknown periods and failed order sync keep old values and visible errors without invented zeros', async () => {
  const s=sales();s.periods.today={days:1,complete:false,orders:null,revenue:null,refund:null,net:null};s.periods.month={...s.periods.today,days:30};s.ordersError='<img src=x onerror=alert(1)>';s.recentOrders=[];
  const {ctx,screen}=boardContext();ctx.fetch=async()=>({ok:true,json:async()=>fixture(s)});
  await vm.runInContext('load()',ctx);
  assert.match(screen.innerHTML,/¥700\.07/);assert.match(screen.innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(screen.innerHTML,/¥0\.00|<img src=x/);
  const page=pageContext();page.fixture=fixture(s);
  const html=vm.runInContext('O=fixture;vSales()',page);
  assert.match(html,/¥700\.07/);assert.doesNotMatch(html,/ <img src=x/);assert.doesNotMatch(html.slice(0,html.indexOf('sales-page-charts')),/¥0\.00/);
});

test('dashboard synchronization submits one board action then refreshes from its completed state', async () => {
  const {ctx,screen}=boardContext();let submitted=0;let loads=0;const s=sales();
  ctx.fetch=async (url,options)=> {
    if(url==='/api/action') { submitted++;assert.deepEqual(JSON.parse(options.body),{type:'board'});return {ok:true,json:async()=>({ok:true})}; }
    loads++;const data=fixture({...s,periods:{...s.periods,today:period(1,3,200.02)}});data.actions=[{type:'board',startedAt:'2026-11-17T08:01:00Z',done:true,ok:true}];return {ok:true,json:async()=>data};
  };
  ctx.fixture=fixture(s);vm.runInContext('O=fixture',ctx);
  await vm.runInContext('syncSales()',ctx);
  assert.equal(submitted,1);assert.ok(loads>=1);assert.match(screen.innerHTML,/¥200\.02/);assert.doesNotMatch(screen.innerHTML,/disabled[^>]*data-sales-sync/);
});


test('dashboard sync ignores previous completed actions and keeps exactly one poll until its new action finishes', async () => {
  const {ctx,screen}=boardContext();const old={type:'board',startedAt:'2026-11-17T07:00:00Z',done:true,ok:true}, current={type:'board',startedAt:'2026-11-17T08:00:00Z',done:false,ok:null};let phase=0,polls=0,cleared=0,callback;
  ctx.fixture=fixture(sales());ctx.fixture.actions=[old];vm.runInContext('O=fixture',ctx);
  ctx.setInterval=fn=>{polls++;callback=fn;return 1;};ctx.clearInterval=()=>{cleared++;};
  ctx.fetch=async url=>({ok:true,json:async()=>{
    if(url==='/api/action') return {ok:true};
    const data=fixture(sales());data.actions=phase===0?[old]:[{...current,done:phase===2,ok:phase===2},old];return data;
  }});
  await vm.runInContext('syncSales()',ctx);
  assert.equal(vm.runInContext('salesSyncing',ctx),true);assert.equal(polls,1);assert.match(screen.innerHTML,/同步中/);
  phase=1;await callback();assert.equal(vm.runInContext('salesSyncing',ctx),true);assert.equal(polls,1);assert.equal(cleared,0);
  phase=2;await callback();assert.equal(vm.runInContext('salesSyncing',ctx),false);assert.equal(polls,1);assert.equal(cleared,1);
});

test('dashboard sync releases its local lock if the server loses the queued action', async () => {
  const {ctx,screen}=boardContext();let now=Date.parse('2026-11-17T08:00:00Z'),callback,cleared=0;
  ctx.Date=class extends Date { static now() { return now; } };
  ctx.fixture=fixture(sales());vm.runInContext('O=fixture',ctx);
  ctx.setInterval=fn=>{callback=fn;return 1;};ctx.clearInterval=()=>{cleared++;};
  ctx.fetch=async url=>({ok:true,json:async()=>url==='/api/action'?{ok:true}:fixture(sales())});
  await vm.runInContext('syncSales()',ctx);assert.equal(vm.runInContext('salesSyncing',ctx),true);
  now+=120001;await callback();
  assert.equal(vm.runInContext('salesSyncing',ctx),false);assert.equal(cleared,1);assert.match(screen.innerHTML,/同步等待超时/);
});

test('sales chart omits periodic labels near the last date while preserving the last date', () => {
  const rows=Array.from({length:30},(_,i)=>({day:new Date(Date.parse('2026-10-19T00:00:00Z')+i*86400000).toISOString().slice(0,10),revenue:i+1}));
  const {ctx}=boardContext();ctx.rows=rows;
  const chart=vm.runInContext('salesChart(rows)',ctx);
  assert.match(chart,/<text[^>]*>11-17<\/text>/);
  assert.doesNotMatch(chart,/<text[^>]*>11-16<\/text>/);
  const page=pageContext();page.rows=rows;page.chart={clientWidth:480,clientHeight:200,innerHTML:''};
  vm.runInContext('drawCols(chart,rows.map(r=>({x:r.day.slice(5),y:r.revenue})),"¥")',page);
  assert.match(page.chart.innerHTML,/<text[^>]*>11-17<\/text>/);
  assert.doesNotMatch(page.chart.innerHTML,/<text[^>]*>11-16<\/text>/);
});
