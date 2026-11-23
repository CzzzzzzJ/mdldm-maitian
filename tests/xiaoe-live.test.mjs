import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const live = () => ({ code: 0, data: { today_data: { income: 0, realIncome: 169900, order_count: 1, pay_count: 1, pv: 65, uv: 19 } } });
const order = (extra = {}) => ({ order_id: 'example_order_1', actual_fee: 169900, order_state: 4, pay_state: 1, create_at: '2026-11-17 16:48:20', pay_state_time: '2026-11-17 16:48:29', goods_list: [{ goods_name: '示例课程甲', aftersale_show_state: 0 }, { goods_name: '示例课程乙', aftersale_show_state: 0 }], nick_name: '私人昵称', consignee_phone: '13800000000', ...extra });
const payload = list => ({ code: 0, data: { order_list: list, paginator: { total: 100, page_size: 10 } } });
function database(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE site_daily(day TEXT PRIMARY KEY,reg INTEGER,vip INTEGER,orders INTEGER,revenue REAL,refund REAL,paid_users INTEGER,visitors INTEGER); CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE site_orders(id TEXT PRIMARY KEY,title TEXT,amount REAL,status TEXT,time TEXT,kind TEXT);');
  t.after(() => db.close()); return db;
}

test('today uses realIncome rather than historical income and keeps refund unknown', async () => {
  const { parseXiaoeLive } = await import('../src/xiaoe-live.mjs');
  assert.deepEqual(parseXiaoeLive(live(), '2026-11-17'), { day: '2026-11-17', orders: 1, revenue: 1699, refund: null, paid_users: 1, visitors: 19 });
  for (const value of [undefined, null, '', -1, .5, '1e3', Infinity]) { const p = live(); p.data.today_data.realIncome = value; assert.throws(() => parseXiaoeLive(p, '2026-11-17')); }
  for (const day of ['2026-02-30', '2026-11-17T00:00:00Z', 'invalid']) assert.throws(() => parseXiaoeLive(live(), day));
  assert.throws(() => parseXiaoeLive({ code: 401, data: {} }, '2026-11-17'));
});

test('orders expose only minimal fields and deduplicate matching items', async () => {
  const { parseXiaoeOrders } = await import('../src/xiaoe-live.mjs');
  const o = order(); o.goods_list.push({ ...o.goods_list[0] });
  assert.deepEqual(parseXiaoeOrders(payload([o, structuredClone(o)])), [{ id: 'example_order_1', title: '示例课程甲、示例课程乙', amount: 1699, status: '已支付', time: '2026-11-17 16:48:20', kind: 'paid' }]);
  assert.deepEqual(parseXiaoeOrders(payload([])), []);
  assert.throws(() => parseXiaoeOrders(payload([o, order({ actual_fee: 0 })])));
  assert.throws(() => parseXiaoeOrders(payload(Array.from({length: 11}, (_, i) => order({ order_id: 'o_'+i })))));
});

test('order status uses refund progress before payment and closed states', async () => {
  const { parseXiaoeOrders } = await import('../src/xiaoe-live.mjs');
  for (const [states, order_state, pay_state, kind, status] of [
    [[3,3], 5, 1, 'refunded', '已退款'], [[0,3], 4, 1, 'partial_refund', '部分退款'],
    [[2,0], 4, 1, 'partial_refund', '部分退款'], [[3,1], 4, 1, 'refunding', '退款中'],
    [[0,0], 5, 2, 'closed', '已关闭'], [[0,0], 4, 1, 'paid', '已支付'], [[0,0], 0, 0, 'pending', '待支付'],
  ]) {
    const goods_list = states.map((n,i) => ({ goods_name: '商品'+i, aftersale_show_state: n }));
    const result = parseXiaoeOrders(payload([order({ goods_list, order_state, pay_state })]))[0];
    assert.equal(result.kind, kind); assert.equal(result.status, status);
  }
});

test('malformed orders reject the snapshot instead of silently inventing fields', async () => {
  const { parseXiaoeOrders } = await import('../src/xiaoe-live.mjs');
  for (const mutation of [
    { actual_fee: null }, { actual_fee: -1 }, { actual_fee: 1.2 }, { order_id: '' },
    { create_at: '2026-02-30 12:00:00' }, { create_at: '2026-11-17 24:00:00' }, { order_state: 9 }, { pay_state: 8 },
    { goods_list: [] }, { goods_list: [{ goods_name: '', aftersale_show_state: 0 }] },
    { goods_list: [{ goods_name: '商品', aftersale_show_state: 9 }] },
  ]) assert.throws(() => parseXiaoeOrders(payload([order(mutation)])));
  assert.throws(() => parseXiaoeOrders({ code: 0, data: {} }));
  assert.throws(() => parseXiaoeOrders({ code: 401, data: { order_list: [] } }));
});

test('live saves upsert dates, replace bounded order snapshots and preserve history', async t => {
  const { parseXiaoeLive, parseXiaoeOrders, saveXiaoeLive } = await import('../src/xiaoe-live.mjs');
  const db = database(t), row = parseXiaoeLive(live(), '2026-11-17'), orders = parseXiaoeOrders(payload([order()]));
  db.exec("INSERT INTO site_daily VALUES('2026-11-16',NULL,NULL,2,138,0,1,34); INSERT INTO meta VALUES('siteShopName','示例店铺');");
  saveXiaoeLive(db, row, orders, '示例店铺'); saveXiaoeLive(db, { ...row, revenue: 1700, refund: 79 }, [], '示例店铺');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM site_daily').get().n, 2);
  const stored = db.prepare("SELECT * FROM site_daily WHERE day='2026-11-17'").get();
  assert.equal(stored.orders, 1); assert.equal(stored.revenue, 1700); assert.equal(stored.refund, 79); assert.equal(stored.reg, null); assert.equal(stored.vip, null);
  assert.equal(db.prepare("SELECT revenue FROM site_daily WHERE day='2026-11-16'").get().revenue, 138);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM site_orders').get().n, 0);
  for (const key of ['siteLiveSyncedAt','siteSyncedAt','siteOrdersSyncedAt']) assert.ok(db.prepare('SELECT value FROM meta WHERE key=?').get(key).value);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='siteSyncedDay'").get().value, '2026-11-17');
});

test('order failure preserves its last snapshot while accepting verified today totals', async t => {
  const { parseXiaoeLive, parseXiaoeOrders, saveXiaoeLive } = await import('../src/xiaoe-live.mjs');
  const db = database(t), row = parseXiaoeLive(live(), '2026-11-17'), orders = parseXiaoeOrders(payload([order()]));
  saveXiaoeLive(db, row, orders, '示例店铺');
  const oldOrders = db.prepare('SELECT * FROM site_orders').all(), oldTime = db.prepare("SELECT value FROM meta WHERE key='siteOrdersSyncedAt'").get().value;
  saveXiaoeLive(db, { ...row, revenue: 1800 }, null, '示例店铺', { ordersError: '订单暂未读取成功' });
  assert.deepEqual(db.prepare('SELECT * FROM site_orders').all(), oldOrders);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='siteOrdersSyncedAt'").get().value, oldTime);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='siteOrdersError'").get().value, '订单暂未读取成功');
  assert.equal(db.prepare("SELECT revenue FROM site_daily WHERE day='2026-11-17'").get().revenue, 1800);
});

test('invalid input, wrong shop and failed writes preserve all previous rows and metadata', async t => {
  const { parseXiaoeLive, parseXiaoeOrders, saveXiaoeLive } = await import('../src/xiaoe-live.mjs');
  const db = database(t), row = parseXiaoeLive(live(), '2026-11-17'), orders = parseXiaoeOrders(payload([order()]));
  saveXiaoeLive(db, row, orders, '示例店铺');
  const before = () => [db.prepare('SELECT * FROM site_daily ORDER BY day').all(), db.prepare('SELECT * FROM site_orders').all(), db.prepare('SELECT * FROM meta ORDER BY key').all()];
  const baseline = before();
  assert.throws(() => saveXiaoeLive(db, row, orders, '另一家店'));
  assert.throws(() => saveXiaoeLive(db, { ...row, orders: null }, orders, '示例店铺'));
  assert.throws(() => saveXiaoeLive(db, row, [{ ...orders[0], amount: .001 }], '示例店铺'));
  assert.deepEqual(before(), baseline);
  db.exec("CREATE TRIGGER reject_orders BEFORE INSERT ON site_orders BEGIN SELECT RAISE(ABORT,'write failed'); END;");
  assert.throws(() => saveXiaoeLive(db, { ...row, revenue: 9999 }, orders, '示例店铺'));
  assert.deepEqual(before(), baseline);
});
