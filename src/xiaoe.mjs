// 小鹅通后台只读汇总与近期订单；不保存浏览器凭证或客户资料。
const DAY = 86400000;
const chinaDay = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
const validDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const integer = (value, label) => {
  if ((typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) || !Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error(`小鹅通${label}格式异常，保留上次数据`);
  return Number(value);
};

export function parseXiaoeTrend(payload, endDay) {
  if (!validDay(endDay) || !payload || payload.code !== 0 || !payload.data || Array.isArray(payload.data)) throw new Error('小鹅通统计未读取成功，请检查专用 Chrome 登录');
  const entries = Object.entries(payload.data).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length !== 30 || entries.at(-1)[0] !== endDay) throw new Error('小鹅通统计日期不完整，保留上次数据');
  const rows = entries.map(([day, row], i) => {
    if (!validDay(day) || row?.date !== day || (i && Date.parse(day) - Date.parse(entries[i - 1][0]) !== DAY)) throw new Error('小鹅通统计日期异常，保留上次数据');
    const d = row.data;
    return { day, orders: integer(d?.order_count, '支付订单数'), revenue: integer(d?.pay_money, '支付金额') / 100,
      refund: integer(d?.refund_money, '成功退款金额') / 100, paid_users: integer(d?.pay_users, '支付人数'), visitors: integer(d?.uv, '访客数') };
  });
  return rows;
}

export function saveXiaoeDays(db, rows, shopName) {
  const bound = db.prepare("SELECT value FROM meta WHERE key='siteShopName'").get()?.value;
  if (!shopName || (bound && bound !== shopName) || (!bound && db.prepare('SELECT COUNT(*) n FROM site_daily').get().n)) throw new Error('销售数据库店铺不一致，请使用独立数据库，原数据未改动');
  const upsert = db.prepare(`INSERT INTO site_daily (day,reg,vip,orders,revenue,refund,paid_users,visitors) VALUES (?,NULL,NULL,?,?,?,?,?)
    ON CONFLICT(day) DO UPDATE SET reg=NULL,vip=NULL,orders=excluded.orders,revenue=excluded.revenue,refund=excluded.refund,paid_users=excluded.paid_users,visitors=excluded.visitors`);
  const meta = db.prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  db.exec('SAVEPOINT xiaoe_days');
  try {
    for (const r of rows) upsert.run(r.day, r.orders, r.revenue, r.refund, r.paid_users, r.visitors);
    meta.run('siteSyncedAt', new Date().toISOString());
    meta.run('siteSyncedDay', rows.at(-1).day);
    meta.run('siteCampaigns', 'off');
    meta.run('siteShopName', shopName);
    meta.run('siteError', '');
    db.exec('RELEASE xiaoe_days');
  } catch (e) { db.exec('ROLLBACK TO xiaoe_days; RELEASE xiaoe_days'); throw e; }
}

export async function fetchXiaoe(site) {
  const endDay = chinaDay(Date.now() - DAY);
  const payload = await readXiaoe(site, `return read('/data_analysis/get_core_day_trend', {date:${JSON.stringify(endDay)}});`);
  return parseXiaoeTrend(payload, endDay);
}

async function readXiaoe(site, expression) {
  if (new URL(site.admin).origin !== 'https://admin.xiaoe-tech.com' || !site.shopName) throw new Error('请配置小鹅通后台地址和店铺名称');
  const { withTab, evaluate } = await import('./driver.mjs');
  // shortcut: 后台统计接口可能随小鹅通升级变化，字段校验失败时停止同步并保留旧数据。
  return withTab(site.admin, (tab) => evaluate(tab, `(async()=>{
    if (location.origin !== 'https://admin.xiaoe-tech.com' || /login|chooseShop/i.test(location.href))
      throw new Error(${JSON.stringify('请在麦田专用 Chrome 登录并选择' + site.shopName + '店铺')});
    const read = async (path, body) => {
      const r = await fetch(path, {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
      if (!r.ok) throw new Error('小鹅通请求失败，请检查专用 Chrome 登录');
      // 旧统计接口实际返回 JSON，但 Content-Type 是 text/html。
      const j = await r.json().catch(()=>{throw new Error('小鹅通未返回有效统计数据，请检查专用 Chrome 登录');});
      if (j?.code !== 0) throw new Error('小鹅通接口未返回成功，保留上次数据');
      return j;
    };
    const identity = await read('/xe.merchant-serve.shop_info.get/1.0.0');
    if (identity.data?.shop_name !== ${JSON.stringify(site.shopName)}) throw new Error('麦田专用 Chrome 的当前店铺不匹配，原数据未改动');
    ${expression}
  })()`), { wait: 8000 });
}

export function parseXiaoeRefund(payload, day, dateField, amountField) {
  const result = payload?.data?.result;
  if (!validDay(day) || payload?.code !== 0 || !Array.isArray(result?.dimension) || !Array.isArray(result?.metric) || result.dimension.length !== result.metric.length) throw new Error('今日退款数据格式异常');
  const i = result.dimension.findIndex(r => r.some(d => d.field_id === dateField && d.value === day));
  const value = result.metric[i]?.find(m => m.field_id === amountField)?.value;
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value) || !Number.isSafeInteger(Math.round(Number(value) * 100))) throw new Error('今日退款数据未返回，保留未知值');
  return Math.round(Number(value) * 100) / 100;
}

export async function fetchXiaoeSnapshot(site, { history = true } = {}) {
  const today = chinaDay(Date.now()), yesterday = chinaDay(Date.now() - DAY), start = chinaDay(Date.now() - 29 * DAY);
  // 报表标识由当前店铺的退款趋势查询提供，不同店铺可以使用不同报表。
  const refundQuery = structuredClone(site.refundQuery);
  const dateField = refundQuery?.condition_data?.dimension?.[0]?.field_id;
  const amountField = refundQuery?.condition_data?.metric?.find(m => m.customizeName === '退款金额')?.field_id;
  const dateFilter = refundQuery?.condition_data?.filters?.find(f => f.field_id === dateField && f.filter_operation === 'between');
  const hasRefundReport = /^pi_[a-zA-Z0-9_]+$/.test(refundQuery?.page_id) && dateField && amountField && dateFilter;
  if (hasRefundReport) dateFilter.filter_value = [today, today];
  const orderQuery = { order_search: 'third_order_id', order_search_value: '', goods_name: '', goods_type: ['-1'], order_type: [-1], order_state: -1,
    marketing_play: [-1], channel_source: -1, after_sale_show_state: -1, ship_way_choose_type: -1, is_invoice_apply: -1, pay_type: -1, use_collection: -1,
    order_tag_type: [-1], check_state: -1, order_time_start: start + ' 00:00:00', order_time_end: today + ' 23:59:59', order_time: 'created_at',
    minimum_amount: 0, maximum_amount: 9999999900, page_index: 1, page_size: 10, is_search_total: 1 };
  const payload = await readXiaoe(site, `
    const live = await read('/data_analysis/get_overview_data');
    const trend = ${history ? `await read('/data_analysis/get_core_day_trend',{date:${JSON.stringify(yesterday)}})` : 'null'};
    let refund = null, refundError = '', orders = null, ordersError = '';
    try { ${hasRefundReport ? `refund = await read(${JSON.stringify('/xe.data.bi_data.data_query/detail/shop_view/' + refundQuery.page_id)},${JSON.stringify(refundQuery)});` : ''} }
    catch { refundError = '今日退款暂未同步'; }
    try {
      const raw = await read('/xe.ecommerce-admin.ecommerce_b/ecommerce_b/xe.transaction.ocs.order_list/1.0.0',${JSON.stringify(orderQuery)});
      if (!Array.isArray(raw.data?.order_list) || raw.data.order_list.length > 10) throw new Error('订单格式异常');
      orders = {code:0,data:{order_list:raw.data.order_list.map(o=>({order_id:o.order_id,actual_fee:o.actual_fee,order_state:o.order_state,pay_state:o.pay_state,create_at:o.create_at,
        pay_state_time:o.pay_state_time,order_state_time:o.order_state_time,goods_list:o.goods_list?.map(g=>({goods_name:g.goods_name,aftersale_show_state:g.aftersale_show_state}))}))}};
    } catch { ordersError = '最近订单暂未同步'; }
    return {live,trend,refund,refundError,orders,ordersError};
  `);
  if (chinaDay(Date.now()) !== today) throw new Error('同步跨过午夜，请重新同步');
  const { parseXiaoeLive, parseXiaoeOrders } = await import('./xiaoe-live.mjs');
  const row = parseXiaoeLive(payload.live, today);
  let error = payload.refundError, ordersError = payload.ordersError, orders = null;
  try { row.refund = parseXiaoeRefund(payload.refund, today, dateField, amountField); } catch { error = '今日退款暂未同步'; }
  if (payload.orders) { try { orders = parseXiaoeOrders(payload.orders); } catch { ordersError = '最近订单格式异常，已保留上次数据'; } }
  return { days: payload.trend ? parseXiaoeTrend(payload.trend, yesterday) : null, today: row, orders, error, ordersError };
}
