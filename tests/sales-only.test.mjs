import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t, provider = 'xiaoe') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-sales-only-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'lib')); fs.writeFileSync(path.join(dir, 'lib/publish.js'), '');
  fs.writeFileSync(path.join(dir, 'lib/bundle.js'),     'export const validate = () => ({ errors: ["TEST_VALIDATION_REJECTED"], warnings: [] }), PLATFORMS = {}, len = s => s.length;');
  const calls = path.join(dir, 'calls.jsonl');
  const cfg = { site: { provider, name: '小鹅通', shopName: '示例店铺', base: 'https://admin.xiaoe-tech.com', adminPath: '/htht' },
    rootPath: dir, pluginDir: dir, chromeProfile: path.join(dir, 'chrome-profile'), batches: [['zsz']], auto: ['zsz'], manual: [], keepAlive: [] };
  const config = path.join(dir, 'config.json'); fs.writeFileSync(config, JSON.stringify(cfg));
  fs.writeFileSync(path.join(dir, 'src/driver.mjs'), `
    import fs from 'node:fs';
    const call = (name, args) => fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify({ name, args })+'\\n');
    export const mode = 'direct';
    export async function ensure() { call('ensure', []); }
    export async function close() {}
    export async function busy() { return false; }
    export async function sleep(ms) { if (ms === 300000) throw new Error('TEST_DAEMON_STOP'); }
    export async function withTab(url) { call('withTab', [url]); throw new Error('TEST_BROWSER_BLOCKED'); }
    export async function evaluate() { throw new Error('TEST_BROWSER_BLOCKED'); }
    export async function click() { throw new Error('TEST_BROWSER_BLOCKED'); }
    export async function adoptTabs() { return []; }
    export async function screenshot() { return Buffer.alloc(0); }
    export async function checkLogin(ids) {
      call('checkLogin', ids);
      const configured = JSON.parse(process.env.TEST_LOGIN_RESULTS || '{}');
      return Object.fromEntries(ids.map(id => [id, configured[id] || { ok: true }]));
    }
    export async function links(project, ids) { call('links', ids); return {}; }
    export async function openForLogin(urls) { call('openForLogin', urls); }
    export async function runBatch(project, batch) { call('runBatch', batch); return {}; }
  `);
  fs.writeFileSync(path.join(dir, 'src/board.mjs'), 'export async function boardSync() { return null; } export async function syncSalesIfDue() { return null; }');
  const env = { ...process.env, MAITIAN_CONFIG: config, MAITIAN_DB: path.join(dir, 'hub.db'), TEST_CALLS: calls, HUB_NO_WEB: '1', NODE_NO_WARNINGS: '1' };
  const run = (args) => spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8', timeout: 10000 });
  const script = (code) => run(['--input-type=module', '-e', code]);
  const init = script(`await import('./src/db.mjs');`); assert.equal(init.status, 0, init.stderr);
  const db = () => new DatabaseSync(env.MAITIAN_DB);
  return { dir, cfg, env, script, db, run: (...args) => run(['src/hub.mjs', ...args]),
    calls: () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [] };
}
function project(f, id = 'sales') {
  const dir = path.join(f.dir, id); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'publish.json'), JSON.stringify({ id, name: id, schedule: new Date(Date.now() - 600000).toISOString(), platforms: { zsz: { title: '课程' } } }));
  return dir;
}
function seedEpisode(f, dir, state = 'pending') {
  const r = f.script(`const D=await import('./src/db.mjs'); const P=JSON.parse((await import('node:fs')).readFileSync(${JSON.stringify(path.join(dir, 'publish.json'))},'utf8'));D.upsertEpisode({...P,dir:${JSON.stringify(dir)}});D.setTask(P.id,'zsz',${JSON.stringify(state)},'');D.db.close();`);
  assert.equal(r.status, 0, r.stderr);
}
function tasks(f) { const d = f.db(); try { return d.prepare('SELECT * FROM tasks').all(); } finally { d.close(); } }
const noCourseCalls = (f) => assert.deepEqual(f.calls().filter(c => ['runBatch', 'links'].includes(c.name) && c.args.includes('zsz') || c.name === 'withTab' && c.args.some(x => x.includes('xiaoe-tech'))), []);

test('sales-only blocks direct course and registration collectors', t => {
  const f = fixture(t);
  const r = f.script(`const {SITE}=await import('./src/site.mjs');const {zszCourses}=await import('./src/checks.mjs');const {collectors}=await import('./src/metrics.mjs');const {followerCollectors}=await import('./src/followers.mjs');console.log(JSON.stringify([SITE.salesOnly,await zszCourses('课程'),await collectors.zsz({url:'',p:{title:'课程'}}),await followerCollectors.zsz()]));`);
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(JSON.parse(r.stdout), [true, [], null, null]); assert.deepEqual(f.calls(), []);
});
test('ordinary site keeps course collection', t => {
  const f = fixture(t, 'custom');
  const r = f.script(`const {zszCourses}=await import('./src/checks.mjs');try{await zszCourses('课程')}catch(e){console.log(e.message)}`);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /TEST_BROWSER_BLOCKED/); assert.equal(f.calls()[0].name, 'withTab');
});
test('explicit zsz run cannot create an upload task', t => {
  const f = fixture(t), dir = project(f);
  const r = f.run('run', dir, '--only', 'zsz');
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(tasks(f), []); assert.deepEqual(f.calls(), []);
});
test('explicit sales-only zsz does not need the publishing validator installed', t => {
  const f = fixture(t), dir = project(f);
  fs.rmSync(path.join(f.dir, 'lib/bundle.js'));
  const r = f.run('run', dir, '--only', 'zsz');
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(tasks(f), []); assert.deepEqual(f.calls(), []);
});
test('run still validates the ordinary zsz publish target', t => {
  const f = fixture(t, 'custom'), dir = project(f);
  const r = f.run('run', dir, '--only', 'zsz');
  assert.equal(r.status, 1); assert.match(r.stderr, /TEST_VALIDATION_REJECTED/);
  assert.deepEqual(tasks(f), []); assert.deepEqual(f.calls(), []);
});
test('run still validates when a publishing target is selected alongside sales-only zsz', t => {
  const f = fixture(t), dir = project(f);
  const manifest = path.join(dir, 'publish.json');
  const data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  data.platforms.bilibili = { title: '视频' };
  fs.writeFileSync(manifest, JSON.stringify(data));
  const r = f.run('run', dir, '--only', 'zsz,bilibili');
  assert.equal(r.status, 1); assert.match(r.stderr, /TEST_VALIDATION_REJECTED/);
  assert.deepEqual(tasks(f), []); assert.deepEqual(f.calls(), []);
});
test('plan and adopt do not register zsz publication tasks', t => {
  const f = fixture(t), a = project(f, 'plan'), b = project(f, 'adopt');
  assert.equal(f.run('plan', a).status, 0); assert.equal(f.run('adopt', b).status, 0);
  assert.deepEqual(tasks(f), []); assert.deepEqual(f.calls(), []);
});
test('sync leaves a stored zsz task untouched without a browser call', t => {
  const f = fixture(t), dir = project(f); seedEpisode(f, dir, 'scheduled');
  const before = tasks(f); const r = f.run('sync', 'sales', '--only', 'zsz');
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(tasks(f), before); assert.deepEqual(f.calls(), []);
});
test('doctor excludes the sales-only site from adapter preflight', t => {
  const f = fixture(t); const r = f.run('doctor'); assert.equal(r.status, 0, r.stderr);
  assert.equal(f.calls().filter(c => c.name === 'checkLogin').length, 1);
  assert.equal(f.calls().some(c => c.name === 'checkLogin' && c.args.includes('zsz')), false);
});
test('login can open only the sales admin page', t => {
  const f = fixture(t); const r = f.run('login', '--only', 'zsz'); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.calls(), [{ name: 'openForLogin', args: ['https://admin.xiaoe-tech.com/htht'] }]);
});
test('daemon ignores stored zsz pending, scheduled and waiting tasks', t => {
  const f = fixture(t);
  for (const state of ['pending', 'scheduled', 'awaiting_user']) seedEpisode(f, project(f, state), state);
  const before = tasks(f); const r = f.run('daemon'); assert.match(r.stderr, /TEST_DAEMON_STOP/);
  noCourseCalls(f); assert.deepEqual(tasks(f), before);
});
test('sales review keeps cents and excludes stale attribution and registration', t => {
  const f = fixture(t);
  const r = f.script(`
    const D=await import('./src/db.mjs');await import('./src/followers.mjs');
    if ((await import('./src/site.mjs')).SITE.salesOnly) D.setMeta('siteShopName','示例店铺');
    if(!D.db.prepare('PRAGMA table_info(site_daily)').all().some(c=>c.name==='refund'))D.db.exec('ALTER TABLE site_daily ADD COLUMN refund REAL');
    D.db.prepare('INSERT INTO site_daily(day,reg,vip,orders,revenue,refund) VALUES (?,?,?,?,?,?)').run('2026-11-11',null,null,3,123.45,12.34);
    D.upsertEpisode({id:'x',name:'内容',schedule:'2026-11-10T00:00:00+08:00',dir:'unused'});
    D.saveSnapshot('x',{platforms:{x:{text:'utm_campaign=test'}}});
    D.db.prepare('INSERT INTO site_campaigns(campaign,reg,vip,orders,revenue) VALUES (?,?,?,?,?)').run('test',999,888,77,666);
    const R=await import('./src/review.mjs');const e=D.getEpisode('x');const v=R.review(e,7);
    console.log(JSON.stringify({conv:v.conv,text:R.reviewText(v),weekly:R.weekly(Date.parse('2026-11-17T12:00:00+08:00')).text,shopName:(await import('./src/site.mjs')).SITE.shopName}));
  `);
  assert.equal(r.status, 0, r.stderr); const v = JSON.parse(r.stdout);
  assert.equal(v.conv, null);
  assert.equal(v.shopName, '示例店铺');
  for (const text of [v.text, v.weekly]) { assert.match(text, /订单 3/); assert.match(text, /123\.45/); assert.match(text, /12\.34/); assert.doesNotMatch(text, /新注册|新会员|按期归因|999|888/); }
});
test('sales weekly includes Monday and never falls back to stale registrations', t => {
  const f = fixture(t);
  const r = f.script(`
    const D=await import('./src/db.mjs');await import('./src/followers.mjs');
    if ((await import('./src/site.mjs')).SITE.salesOnly) D.setMeta('siteShopName','示例店铺');
    if(!D.db.prepare('PRAGMA table_info(site_daily)').all().some(c=>c.name==='refund'))D.db.exec('ALTER TABLE site_daily ADD COLUMN refund REAL');
    D.db.prepare('INSERT INTO site_daily(day,reg,vip,orders,revenue,refund) VALUES (?,?,?,?,?,?)').run('2026-11-09',null,null,1,19.99,0);
    const R=await import('./src/review.mjs');const now=Date.parse('2026-11-17T12:00:00+08:00');
    const full=R.weekly(now).text;D.db.exec('DELETE FROM site_daily');
    D.db.prepare('INSERT INTO site_daily(day,reg,vip) VALUES (?,?,?)').run('2026-11-11',999,888);
    const e={id:'x',name:'内容',schedule:'2026-11-10T00:00:00+08:00'};
    console.log(JSON.stringify({full,empty:R.weekly(now).text,review:R.reviewText(R.review(e,7))}));
  `);
  assert.equal(r.status, 0, r.stderr);const v=JSON.parse(r.stdout);
  assert.doesNotMatch(v.empty+v.review,/新注册|新会员|999|888/);
  assert.match(v.full,/订单 1/);assert.match(v.full,/19\.99/);
});
test('ordinary site review retains registrations and attribution', t => {
  const f = fixture(t, 'custom');
  const r = f.script(`
    const D=await import('./src/db.mjs');await import('./src/followers.mjs');
    if ((await import('./src/site.mjs')).SITE.salesOnly) D.setMeta('siteShopName','示例店铺');
    D.db.prepare('INSERT INTO site_daily(day,reg,vip,orders,revenue) VALUES (?,?,?,?,?)').run('2026-11-11',12,3,2,100);
    const R=await import('./src/review.mjs');console.log(R.weekly(Date.parse('2026-11-17T12:00:00+08:00')).text);
  `);
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/新注册 12/);assert.match(r.stdout,/新会员 3/);
});
