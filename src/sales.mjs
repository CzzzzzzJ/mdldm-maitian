const DAY = 86400000;
const chinaDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
const shiftDay = (day, offset) => new Date(Date.parse(day + 'T00:00:00Z') + offset * DAY).toISOString().slice(0, 10);
const timestamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const cents = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) ? Math.round(value * 100) : null;

export function salesDateRange(now = Date.now()) {
  const today = chinaDay(new Date(now));
  return { today, start: shiftDay(today, -29) };
}

export function buildSalesSummary({ days = [], orders = [], now = Date.now(), syncedAt, ordersSyncedAt, error = '', ordersError = '' } = {}) {
  const { today, start } = salesDateRange(now);
  const synced = timestamp(syncedAt);
  const freshToday = synced && chinaDay(new Date(synced)) === today;
  const trend = days.filter(d => d.day >= start && d.day <= today).sort((a, b) => a.day.localeCompare(b.day)).map(d => {
    const valid = d.day !== today || freshToday;
    return { day: d.day, orders: valid ? count(d.orders) : null, revenue: valid && cents(d.revenue) != null ? cents(d.revenue) / 100 : null,
      refund: valid && cents(d.refund) != null ? cents(d.refund) / 100 : null, provisional: d.day === today };
  });
  const byDay = new Map(trend.map(d => [d.day, d]));
  const period = n => {
    const rows = Array.from({ length: n }, (_, i) => byDay.get(shiftDay(today, -i)));
    const total = (key, money = false) => {
      const values = rows.map(r => r && (money ? cents(r[key]) : count(r[key])));
      if (values.some(v => v == null)) return null;
      const sum = values.reduce((a, b) => a + b, 0);
      return Number.isSafeInteger(sum) ? sum / (money ? 100 : 1) : null;
    };
    const orders = total('orders'), revenue = total('revenue', true), refund = total('refund', true);
    return { days: n, complete: orders != null && revenue != null && refund != null, orders, revenue, refund,
      net: revenue != null && refund != null ? (Math.round(revenue * 100) - Math.round(refund * 100)) / 100 : null };
  };
  return { today, syncedAt: synced, error: String(error || ''), periods: { today: period(1), week: period(7), month: period(30) }, trend,
    recentOrders: [...orders].sort((a, b) => String(b.time).localeCompare(String(a.time)) || String(b.id).localeCompare(String(a.id))).slice(0, 10)
      .map(({ id, title, amount, status, time, kind }) => ({ id, title, amount: cents(amount) != null ? cents(amount) / 100 : null, status, time, kind })),
    ordersSyncedAt: timestamp(ordersSyncedAt), ordersError: String(ordersError || '') };
}
