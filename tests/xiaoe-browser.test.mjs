import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = { admin: 'https://admin.xiaoe-tech.com/htht', shopName: '示例店铺' };
const payload = () => ({ code: 0, data: Object.fromEntries(Array.from({ length: 30 }, (_, i) => {
  const day = new Date(Date.parse('2026-10-18T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
  return [day, { date: day, data: { order_count: 2, pay_money: 10001, refund_money: 1201, pay_users: 1, uv: 20 } }];
})) });

async function browser(t, { names = [], href = site.admin, metadata = { code: 0, data: { shop_name: '示例店铺' } }, metadataResponse = {}, response = {}, body = payload() } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-xiaoe-browser-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(root, 'src/xiaoe.mjs'), path.join(dir, 'xiaoe.mjs'));
  fs.writeFileSync(path.join(dir, 'driver.mjs'), `
    import vm from 'node:vm';
    export async function withTab(url, run) { globalThis.__xiaoeBrowser.opened.push(url); return run(1); }
    export async function evaluate(tab, expression) { return vm.runInNewContext(expression, globalThis.__xiaoeBrowser.context, { timeout: 1000 }); }
  `);
  t.mock.method(Date, 'now', () => Date.parse('2026-11-16T16:30:00Z'));
  const url = new URL(href), calls = [], opened = [];
  const context = {
    location: { href, origin: url.origin, pathname: url.pathname },
    document: { title: '小鹅通', body: { innerText: '示例店铺 其他店铺' }, querySelectorAll: () => names.map(n => ({ textContent: n.text, getBoundingClientRect: () => ({ width: n.width }) })) },
    AbortSignal,
    fetch: async (resource, options) => {
      calls.push({ resource, options });
      const shopInfo = resource === '/xe.merchant-serve.shop_info.get/1.0.0';
      const r = shopInfo ? metadataResponse : response;
      return new Response(r.invalidJson ? '<html>请登录</html>' : JSON.stringify(shopInfo ? metadata : body), {
        status: r.ok === false ? 403 : 200, headers: { 'Content-Type': r.contentType ?? 'application/json' },
      });
    },
  };
  globalThis.__xiaoeBrowser = { context, opened };
  t.after(() => { delete globalThis.__xiaoeBrowser; });
  return { ...(await import(pathToFileURL(path.join(dir, 'xiaoe.mjs')).href)), calls, opened };
}

test('shop metadata is authoritative and invalid metadata blocks statistics', async t => {
  for (const [name, input] of [
    ['wrong active shop', { metadata: { code: 0, data: { shop_name: '另一家店铺' } } }],
    ['same-name prefix', { metadata: { code: 0, data: { shop_name: '示例店铺测试店' } } }],
    ['metadata login error', { metadata: { code: 401, data: { shop_name: '示例店铺' } } }],
    ['missing shop name', { metadata: { code: 0, data: {} } }],
    ['metadata HTTP error', { metadataResponse: { ok: false } }],
    ['metadata HTML response', { metadataResponse: { contentType: 'text/html', invalidJson: true } }],
  ]) await t.test(name, async t => {
    const b = await browser(t, { names: [{ text: '示例店铺', width: 100 }], ...input });
    await assert.rejects(b.fetchXiaoe(site));
    assert.deepEqual(b.calls.map(c => c.resource), ['/xe.merchant-serve.shop_info.get/1.0.0']);
  });
});

test('login, shop selection and foreign origins never request sales data', async t => {
  for (const href of ['https://admin.xiaoe-tech.com/login', 'https://admin.xiaoe-tech.com/chooseShop', 'https://other.example/htht']) await t.test(href, async t => {
    const b = await browser(t, { href });
    await assert.rejects(b.fetchXiaoe(site), /登录并选择/);
    assert.equal(b.calls.length, 0);
  });
});

test('correct metadata with blank DOM reads statistics for Shanghai yesterday', async t => {
  const b = await browser(t);
  const rows = await b.fetchXiaoe(site);
  assert.deepEqual(b.opened, ['https://admin.xiaoe-tech.com/htht']);
  assert.equal(b.calls.length, 2);
  const info = b.calls[0];
  assert.equal(info.resource, '/xe.merchant-serve.shop_info.get/1.0.0');
  assert.equal(info.options.method, 'POST'); assert.equal(info.options.credentials, 'include');
  assert.equal(info.options.headers['Content-Type'], 'application/json');
  assert.equal(info.options.body, undefined);
  const { resource, options } = b.calls[1];
  assert.equal(resource, '/data_analysis/get_core_day_trend');
  assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'include');
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(options.body), { date: '2026-11-16' });
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(rows.length, 30);
  assert.deepEqual(rows.at(-1), { day: '2026-11-16', orders: 2, revenue: 100.01, refund: 12.01, paid_users: 1, visitors: 20 });
});

test('legacy statistics accept valid JSON served as text/html', async t => {
  const b = await browser(t, { response: { contentType: 'text/html; charset=UTF-8' } });
  const rows = await b.fetchXiaoe(site);
  assert.equal(rows.at(-1).orders, 2);
  assert.equal(rows.at(-1).revenue, 100.01);
});

test('bad browser responses leave existing sales and sync metadata unchanged', async t => {
  const incomplete = payload(); delete incomplete.data['2026-10-18'];
  const invalid = payload(); invalid.data['2026-11-16'].data.pay_money = null;
  for (const [name, input] of [
    ['HTTP failure', { response: { ok: false } }],
    ['HTML login response', { response: { contentType: 'text/html', invalidJson: true } }],
    ['API login failure', { body: { code: 401, data: {} } }],
    ['truncated month', { body: incomplete }],
    ['invalid final amount', { body: invalid }],
  ]) await t.test(name, async t => {
    const b = await browser(t, input), db = new DatabaseSync(':memory:'); t.after(() => db.close());
    db.exec('CREATE TABLE site_daily(day TEXT PRIMARY KEY,reg INTEGER,vip INTEGER,orders INTEGER,revenue REAL,refund REAL,paid_users INTEGER,visitors INTEGER); CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);');
    b.saveXiaoeDays(db, b.parseXiaoeTrend(payload(), '2026-11-16'), site.shopName);
    const before = db.prepare('SELECT * FROM site_daily ORDER BY day').all();
    const meta = db.prepare('SELECT * FROM meta ORDER BY key').all();
    await assert.rejects(async () => b.saveXiaoeDays(db, await b.fetchXiaoe(site), site.shopName));
    assert.deepEqual(b.calls.map(c => c.resource), ['/xe.merchant-serve.shop_info.get/1.0.0', '/data_analysis/get_core_day_trend']);
    assert.deepEqual(db.prepare('SELECT * FROM site_daily ORDER BY day').all(), before);
    assert.deepEqual(db.prepare('SELECT * FROM meta ORDER BY key').all(), meta);
  });
});
