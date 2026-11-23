import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const fixture = () => ({ code: 0, data: Object.fromEntries(Array.from({ length: 30 }, (_, i) => {
  const date = new Date(Date.parse('2026-10-18T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
  return [date, { date, data: i === 29 ? { order_count: '2', pay_money: 13800, refund_money: 7900, pay_users: 1, uv: 34 }
    : { order_count: '0', pay_money: 0, refund_money: 0, pay_users: 0, uv: 20 } }];
})) });

test('preserves paid orders separately from people and converts cents exactly', async () => {
  const { parseXiaoeTrend } = await import('../src/xiaoe.mjs');
  const days = parseXiaoeTrend(fixture(), '2026-11-16');
  assert.equal(days.length, 30);
  assert.deepEqual(days.slice(-2), [
    { day: '2026-11-15', orders: 0, revenue: 0, refund: 0, paid_users: 0, visitors: 20 },
    { day: '2026-11-16', orders: 2, revenue: 138, refund: 79, paid_users: 1, visitors: 34 },
  ]);
});

test('rejects login errors, incomplete windows and invalid amounts without inventing zeros', async () => {
  const { parseXiaoeTrend } = await import('../src/xiaoe.mjs');
  assert.throws(() => parseXiaoeTrend({ code: 401, data: {} }, '2026-11-16'));
  assert.throws(() => parseXiaoeTrend({ code: 0, data: {} }, '2026-11-16'));
  assert.throws(() => parseXiaoeTrend(fixture(), '2026-11-17'));
  const truncated = fixture(); truncated.data = { '2026-11-16': truncated.data['2026-11-16'] };
  assert.throws(() => parseXiaoeTrend(truncated, '2026-11-16'));
  for (const invalid of [undefined, null, '', -1, 0.5, '1e3', Infinity]) {
    const input = fixture(); input.data['2026-11-16'].data.pay_money = invalid;
    assert.throws(() => parseXiaoeTrend(input, '2026-11-16'));
  }
  const input = fixture(); input.data['2026-11-16'].date = '2026-11-15';
  assert.throws(() => parseXiaoeTrend(input, '2026-11-16'));
});

test('upserts a complete snapshot atomically and keeps unknown registration counts null', async () => {
  const { parseXiaoeTrend, saveXiaoeDays } = await import('../src/xiaoe.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE site_daily (day TEXT PRIMARY KEY,reg INTEGER,vip INTEGER,orders INTEGER,revenue REAL,refund REAL,paid_users INTEGER,visitors INTEGER); CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT);');
  const rows = parseXiaoeTrend(fixture(), '2026-11-16');
  saveXiaoeDays(db, rows, '示例店铺');
  saveXiaoeDays(db, rows, '示例店铺');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM site_daily').get().n, 30);
  const stored = db.prepare('SELECT * FROM site_daily WHERE day=?').get('2026-11-16');
  assert.equal(stored.orders, 2); assert.equal(stored.revenue, 138); assert.equal(stored.refund, 79);
  assert.equal(stored.reg, null); assert.equal(stored.vip, null);
  assert.throws(() => saveXiaoeDays(db, rows, '另一家店铺'));
  const bad = rows.map(r => ({ ...r })); bad[29].orders = null;
  db.exec("CREATE TRIGGER reject_missing_orders BEFORE UPDATE ON site_daily WHEN NEW.orders IS NULL BEGIN SELECT RAISE(ABORT,'missing orders'); END;");
  bad[0].revenue = 999;
  assert.throws(() => saveXiaoeDays(db, bad, '示例店铺'));
  assert.equal(db.prepare('SELECT revenue FROM site_daily WHERE day=?').get('2026-10-18').revenue, 0);
  db.close();
});
