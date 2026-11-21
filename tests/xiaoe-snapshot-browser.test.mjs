import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = { admin: 'https://admin.xiaoe-tech.com/t/merchant/index', shopName: '示例店铺', refundQuery: {
  page_id: 'pi_example', condition_data: { dimension: [{field_id:'test_date'}], metric: [{field_id:'test_amount',customizeName:'退款金额'}],
    filters: [{}, {field_id:'test_date',filter_operation:'between'}] }
} };
const P = {
  identity: '/xe.merchant-serve.shop_info.get/1.0.0', live: '/data_analysis/get_overview_data',
  history: '/data_analysis/get_core_day_trend', refund: '/xe.data.bi_data.data_query/detail/shop_view/pi_example',
  orders: '/xe.ecommerce-admin.ecommerce_b/ecommerce_b/xe.transaction.ocs.order_list/1.0.0',
};
const history = () => ({ code: 0, data: Object.fromEntries(Array.from({ length: 30 }, (_, i) => {
  const date = new Date(Date.parse('2026-10-18T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
  return [date, { date, data: { order_count: '2', pay_money: 10001, refund_money: 1201, pay_users: 1, uv: 20 } }];
})) });
const rawOrder = (i = 0) => ({ order_id: 'o_sample_'+i, actual_fee: 169900, order_state: 4, pay_state: 1, create_at: '2026-11-17 00:10:20', pay_state_time: '2026-11-17 00:10:29', order_state_time: '2026-11-17 00:10:29', goods_list: [{ goods_name: '示例课程甲', aftersale_show_state: 0, hidden_goods_value: '不应返回的商品字段' }], consignee_phone: '13800000000', consignee_name: '私人收件人', address: '私人地址', user_id: 'private-user', nick_name: '私人昵称' });

async function browser(t, { fail, shopName = site.shopName, list = [rawOrder()], refundBody } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-xiaoe-snapshot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of ['xiaoe.mjs','xiaoe-live.mjs']) fs.copyFileSync(path.join(root, 'src', file), path.join(dir, file));
  fs.writeFileSync(path.join(dir, 'driver.mjs'), `
    import vm from 'node:vm';
    export async function withTab(url, run) { globalThis.__snapshot.opened.push(url); return run(1); }
    export async function evaluate(tab, expression) {
      const output = await vm.runInNewContext(expression, globalThis.__snapshot.context, { timeout: 1000 });
      const serialized = JSON.parse(JSON.stringify(output));
      globalThis.__snapshot.outputs.push(serialized);
      return serialized;
    }
  `);
  // 16:30 UTC is already the next natural day in Shanghai.
  t.mock.method(Date, 'now', () => Date.parse('2026-11-16T16:30:00Z'));
  const calls = [], opened = [], outputs = [];
  const responses = {
    [P.identity]: { code: 0, data: { shop_name: shopName } },
    [P.live]: { code: 0, data: { today_data: { income: 0, realIncome: 169900, order_count: 1, pay_count: 1, pv: 65, uv: 19 } } },
    [P.history]: history(),
    [P.refund]: refundBody ?? { code: 0, data: { result: { dimension: [[{ field_id: 'test_date', value: '2026-11-17' }]], metric: [[{ field_id: 'test_amount', value: '12.34' }]] } } },
    [P.orders]: { code: 0, data: { order_list: list, paginator: { total: 5000 } } },
  };
  const context = {
    location: { href: site.admin, origin: 'https://admin.xiaoe-tech.com' }, AbortSignal,
    fetch: async (resource, options) => {
      calls.push({ resource, options });
      assert.ok(Object.hasOwn(responses, resource), 'unexpected endpoint: '+resource);
      return new Response(JSON.stringify(responses[resource]), { status: fail === resource ? 403 : 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
    },
  };
  globalThis.__snapshot = { context, opened, outputs };
  t.after(() => { delete globalThis.__snapshot; });
  return { ...(await import(pathToFileURL(path.join(dir, 'xiaoe.mjs')).href)), calls, opened, outputs };
}

test('full snapshot reads verified shop, real today, historical days, refunds and bounded orders', async t => {
  const b = await browser(t), s = await b.fetchXiaoeSnapshot(site);
  assert.deepEqual(b.calls.map(c => c.resource), [P.identity, P.live, P.history, P.refund, P.orders]);
  assert.deepEqual(b.opened, [site.admin]);
  for (const { options } of b.calls) {
    assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'include');
    assert.equal(options.headers['Content-Type'], 'application/json'); assert.ok(options.signal instanceof AbortSignal);
  }
  assert.deepEqual(s.today, { day: '2026-11-17', orders: 1, revenue: 1699, refund: 12.34, paid_users: 1, visitors: 19 });
  assert.equal(s.days.length, 30); assert.equal(s.days[0].day, '2026-10-18'); assert.equal(s.days.at(-1).day, '2026-11-16');
  assert.equal(s.days.at(-1).revenue, 100.01); assert.equal(s.days.at(-1).refund, 12.01);
  assert.equal(s.error, ''); assert.equal(s.ordersError, ''); assert.equal(s.orders[0].amount, 1699);
  assert.deepEqual(JSON.parse(b.calls.find(c => c.resource === P.history).options.body), { date: '2026-11-16' });
  const refund = JSON.parse(b.calls.find(c => c.resource === P.refund).options.body);
  assert.deepEqual(refund.condition_data.filters[1].filter_value, ['2026-11-17','2026-11-17']);
  const orders = JSON.parse(b.calls.find(c => c.resource === P.orders).options.body);
  assert.equal(orders.page_index, 1); assert.equal(orders.page_size, 10); assert.equal(orders.order_time, 'created_at');
  assert.equal(orders.order_time_start, '2026-10-19 00:00:00'); assert.equal(orders.order_time_end, '2026-11-17 23:59:59');
});

test('live refresh skips history and strips private fields before leaving the browser', async t => {
  const b = await browser(t), s = await b.fetchXiaoeSnapshot(site, { history: false });
  assert.deepEqual(b.calls.map(c => c.resource), [P.identity, P.live, P.refund, P.orders]);
  assert.equal(s.days, null);
  assert.deepEqual(s.orders, [{ id: 'o_sample_0', title: '示例课程甲', amount: 1699, status: '已支付', time: '2026-11-17 00:10:20', kind: 'paid' }]);
  const browserOutput = JSON.stringify(b.outputs);
  assert.doesNotMatch(browserOutput, /13800000000|私人地址|私人昵称|私人收件人|private-user|hidden_goods_value|consignee_phone|address|nick_name/);
  assert.deepEqual(Object.keys(b.outputs[0].orders.data.order_list[0]).sort(), ['actual_fee','create_at','goods_list','order_id','order_state','order_state_time','pay_state','pay_state_time']);
  assert.deepEqual(Object.keys(b.outputs[0].orders.data.order_list[0].goods_list[0]).sort(), ['aftersale_show_state','goods_name']);
});

test('orders may fail independently without discarding verified today totals', async t => {
  const b = await browser(t, { fail: P.orders }), s = await b.fetchXiaoeSnapshot(site, { history: false });
  assert.equal(s.today.revenue, 1699); assert.equal(s.today.refund, 12.34); assert.equal(s.today.orders, 1);
  assert.equal(s.orders, null); assert.ok(s.ordersError); assert.equal(s.error, '');
});

test('refund request failure and missing today refund keep null rather than inventing zero', async t => {
  for (const input of [{ fail: P.refund }, { refundBody: { code: 0, data: { result: { dimension: [], metric: [] } } } }]) await t.test(JSON.stringify(input), async t => {
    const b = await browser(t, input), s = await b.fetchXiaoeSnapshot(site, { history: false });
    assert.equal(s.today.revenue, 1699); assert.equal(s.today.refund, null); assert.ok(s.error);
    assert.equal(s.orders.length, 1); assert.equal(s.ordersError, '');
  });
});

test('wrong shop prevents all statistics and order requests', async t => {
  const b = await browser(t, { shopName: '另一家店铺' });
  await assert.rejects(b.fetchXiaoeSnapshot(site));
  assert.deepEqual(b.calls.map(c => c.resource), [P.identity]);
});

test('orders beyond the ten-row contract fail independently instead of leaking oversized payloads', async t => {
  const b = await browser(t, { list: Array.from({ length: 11 }, (_, i) => rawOrder(i)) }), s = await b.fetchXiaoeSnapshot(site, { history: false });
  assert.equal(s.today.revenue, 1699); assert.equal(s.orders, null); assert.ok(s.ordersError);
  assert.equal(b.outputs[0].orders, null);
  assert.doesNotMatch(JSON.stringify(b.outputs), /13800000000|私人地址|私人昵称/);
});
