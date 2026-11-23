const validDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const validTime = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(s) && validDay(s.slice(0, 10));
const integer = value => {
  if ((typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) || !Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error('小鹅通数值格式异常，保留上次数据');
  return Number(value);
};
const money = value => {
  const cents = Math.round(value * 100);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 1e-7) throw new Error('小鹅通金额格式异常，保留上次数据');
  return cents / 100;
};
const text = (value, max) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('小鹅通订单字段异常，保留上次数据');
  return value.trim();
};
const STATUS = { paid: '已支付', pending: '待支付', closed: '已关闭', refunded: '已退款', refunding: '退款中', partial_refund: '部分退款' };
const checkedOrder = o => {
  const id = text(o?.id, 160), title = text(o.title, 2000);
  if (!/^[\w-]+$/.test(id) || !validTime(o.time) || STATUS[o.kind] !== o.status) throw new Error('小鹅通订单状态或时间异常，保留上次数据');
  return { id, title, amount: money(o.amount), status: o.status, time: o.time, kind: o.kind };
};
const uniqueOrders = rows => {
  if (!Array.isArray(rows) || rows.length > 10) throw new Error('小鹅通订单列表异常，保留上次数据');
  const byId = new Map();
  for (const raw of rows) {
    const o = checkedOrder(raw), old = byId.get(o.id);
    if (old && JSON.stringify(old) !== JSON.stringify(o)) throw new Error('小鹅通重复订单内容不一致，保留上次数据');
    byId.set(o.id, o);
  }
  return [...byId.values()];
};

export function parseXiaoeLive(payload, today) {
  const d = payload?.data?.today_data;
  if (payload?.code !== 0 || !d || !validDay(today)) throw new Error('小鹅通当天数据未读取成功');
  // 后台当日实时面板显示 realIncome；income 在已核实的当日响应中为 0。
  return { day: today, orders: integer(d.order_count), revenue: integer(d.realIncome) / 100, refund: null, paid_users: integer(d.pay_count), visitors: integer(d.uv) };
}

export function parseXiaoeOrders(payload) {
  const list = payload?.data?.order_list;
  if (payload?.code !== 0 || !Array.isArray(list) || list.length > 10) throw new Error('小鹅通订单列表未读取成功');
  return uniqueOrders(list.map(o => {
    if (!Array.isArray(o?.goods_list) || !o.goods_list.length || o.goods_list.length > 100) throw new Error('小鹅通订单商品格式异常');
    const state = integer(o.order_state), pay = integer(o.pay_state);
    if (state > 5 || pay > 2) throw new Error('小鹅通订单出现未知状态');
    const states = o.goods_list.map(g => integer(g.aftersale_show_state));
    if (states.some(s => s > 3)) throw new Error('小鹅通订单出现未知售后状态');
    const kind = states.every(s => s === 3) ? 'refunded' : states.includes(1) ? 'refunding' : states.some(s => s === 2 || s === 3) ? 'partial_refund'
      : state === 5 ? 'closed' : pay === 1 ? 'paid' : 'pending';
    return { id: o.order_id, title: [...new Set(o.goods_list.map(g => text(g.goods_name, 500)))].join('、'), amount: integer(o.actual_fee) / 100,
      status: STATUS[kind], time: o.create_at, kind };
  }));
}

export function saveXiaoeLive(db, row, orders, shopName, { ordersError = '' } = {}) {
  if (!row || !validDay(row.day)) throw new Error('小鹅通当天日期格式异常');
  const data = { day: row.day, orders: integer(row.orders), revenue: money(row.revenue), refund: row.refund === null ? null : money(row.refund), paid_users: integer(row.paid_users), visitors: integer(row.visitors) };
  const snapshot = orders === null ? null : uniqueOrders(orders), shop = text(shopName, 100);
  const at = new Date().toISOString();
  const meta = db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  db.exec('SAVEPOINT xiaoe_live');
  try {
    const bound = db.prepare("SELECT value FROM meta WHERE key='siteShopName'").get()?.value;
    if ((bound && bound !== shop) || (!bound && db.prepare('SELECT COUNT(*) n FROM site_daily').get().n)) throw new Error('销售数据库店铺不一致，原数据未改动');
    db.prepare(`INSERT INTO site_daily(day,reg,vip,orders,revenue,refund,paid_users,visitors) VALUES(?,NULL,NULL,?,?,?,?,?)
      ON CONFLICT(day) DO UPDATE SET reg=NULL,vip=NULL,orders=excluded.orders,revenue=excluded.revenue,refund=excluded.refund,paid_users=excluded.paid_users,visitors=excluded.visitors`)
      .run(data.day, data.orders, data.revenue, data.refund, data.paid_users, data.visitors);
    if (snapshot !== null) {
      db.exec('DELETE FROM site_orders');
      const insert = db.prepare('INSERT INTO site_orders(id,title,amount,status,time,kind) VALUES(?,?,?,?,?,?)');
      for (const o of snapshot) insert.run(o.id, o.title, o.amount, o.status, o.time, o.kind);
      meta.run('siteOrdersSyncedAt', at); meta.run('siteOrdersError', '');
    } else meta.run('siteOrdersError', String(ordersError || '订单暂未读取成功').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200));
    meta.run('siteShopName', shop); meta.run('siteLiveSyncedAt', at); meta.run('siteSyncedAt', at); meta.run('siteSyncedDay', data.day); meta.run('siteError', '');
    db.exec('RELEASE xiaoe_live');
  } catch (e) { db.exec('ROLLBACK TO xiaoe_live; RELEASE xiaoe_live'); throw e; }
}
