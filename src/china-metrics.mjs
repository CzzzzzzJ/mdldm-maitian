// 创作者管理页的已渲染 DOM；不读取 Cookie、不调用平台私有接口。
export const chinaMetricPages = {
  acfun: { url: 'https://member.acfun.cn/video-history', row: '.c-content-list .c-content-item' },
  kuaishou: { url: 'https://cp.kuaishou.com/article/manage/video', row: '.works-manage .video-item' },
};

function readMetrics(document, platform, selector, { url, p, publishedAt }) {
  const text = e => (e?.innerText || '').replace(/\s+/g, ' ').trim();
  const count = e => {
    const m = text(e).replace(/[,，]/g, '').match(/^(\d+(?:\.\d+)?)\s*(万|萬|亿|億|[kKmM])?\s*(?:播放|评论|弹幕)?$/);
    if (!m) return null;
    const n = Math.round(Number(m[1]) * ({ 万:1e4, 萬:1e4, 亿:1e8, 億:1e8, k:1e3, m:1e6 }[m[2]?.toLowerCase()] || 1));
    return Number.isSafeInteger(n) ? n : null;
  };
  const rows = [...document.querySelectorAll(selector)].filter(e => e.getClientRects().length);
  const put = (obj, key, value) => { if (value != null) obj[key] = value; };
  const id = (raw, host, path) => { try {
    const u = new URL(raw);
    return u.origin === 'https://' + host ? path.exec(u.pathname)?.[1] : undefined;
  } catch { return undefined; } };
  if (platform === 'acfun') {
    const workId = raw => id(raw,'www.acfun.cn', /^\/v\/(ac\d+)\/?$/);
    const want = workId(url);
    if (!want) return null;
    const hits = rows.filter(r => workId(r.querySelector('.c-content-title')?.href) === want);
    if (hits.length !== 1) return null;
    const row = hits[0], out = {};
    put(out, 'views', count(row.querySelector('.views')));
    put(out, 'comments', count(row.querySelector('.comments')));
    const danmaku = count(row.querySelector('.danmakuSize'));
    if (danmaku != null) out.extra = { 弹幕: danmaku };
    return Object.keys(out).length ? out : null;
  }
  const workId = raw => id(raw,'www.kuaishou.com', /^\/short-video\/([\w-]+)\/?$/);
  const want = workId(url);
  const rowId = r => workId(r.querySelector('a[href*="/short-video/"]')?.href) ||
    (/^[a-z0-9]+$/i.test(r.__vue__?.$props?.videoInfo?.workId || '') ? r.__vue__.$props.videoInfo.workId : undefined);
  const minute = value => {
    const s = String(value ?? '');
    if (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d)?$/.test(s)) return s.slice(0,16).replace('T',' ');
    if (!/(?:Z|[+-]\d\d:?\d\d)$/.test(s)) return '';
    const n = Date.parse(s);
    return Number.isFinite(n) ? new Date(n + 8*3600000).toISOString().slice(0,16).replace('T',' ') : '';
  };
  const date = minute(publishedAt), caption = text({innerText: p?.published_title || p?.caption});
  let hits = want ? rows.filter(r => rowId(r) === want) : [];
  if (!hits.length && date && caption) hits = rows.filter(r =>
    (!want || !rowId(r)) && text(r.querySelector('.video-item__detail__row__title')) === caption &&
    minute(text(r.querySelector('.video-item__detail__row__date'))) === date);
  if (hits.length !== 1) return null;
  const row = hits[0];
  if (text(row.querySelector('.video-item__detail__row__status')) !== '已发布' ||
    /私密|仅自己|仅好友|不公开/.test(text(row.querySelector('.video-item__detail__row__photoStatus')))) return null;
  const out = {};
  for (const e of row.querySelectorAll('.video-item__detail__row__label')) {
    const icon = e.querySelector('img')?.getAttribute('src')?.split('/').at(-1) || '';
    const key = /^icon[-_]play[.-]/.test(icon) ? 'views' : /^icon[-_]comment[.-]/.test(icon) ? 'comments' : /^icon[-_]like[.-]/.test(icon) ? 'likes' : '';
    if (key) put(out, key, count(e));
  }
  return Object.keys(out).length ? out : null;
}

export const chinaMetricsJs = (id, options) =>
  `(${readMetrics.toString()})(document,${JSON.stringify(id)},${JSON.stringify(chinaMetricPages[id].row)},${JSON.stringify(options)})`;

function readKuaishouCards(document, selector, readMetrics) {
  const cards = [];
  for (const row of document.querySelectorAll(selector)) {
    if (!row.getClientRects().length) continue;
    const text = sel => row.querySelector('.video-item__detail__row__' + sel)?.innerText?.trim() || '';
    const p = row.__vue__?.$props?.videoInfo;
    const publicLink = row.querySelector('a[href*="/short-video/"]')?.href || '';
    const rawId = p?.workId || /^https:\/\/www\.kuaishou\.com\/short-video\/([\w-]+)(?:[/?#]|$)/.exec(publicLink)?.[1];
    const id = typeof rawId === 'string' && /^[a-z0-9_-]+$/i.test(rawId) ? rawId : null;
    const status = text('status'), privacy = text('photoStatus');
    if (!id) { cards.push({id,state:'unknown'}); continue; }
    if (p?.photoStatus === 1 || /^(私密|仅自己可见|仅好友可见|不公开)$/.test(privacy)) { cards.push({id,state:'private'}); continue; }
    if (/^(审核中|待审核|审核失败|审核未通过|已退回|草稿|转码中|已下架|定时发布)$/.test(status)) {
      cards.push({id,state:'unpublished'}); continue;
    }
    const title = text('title') || p?.title;
    const publicVisibility = /^(公开|已公开|所有人可见)$/.test(privacy) || (!privacy && p?.photoStatus === 0);
    if (status !== '已发布' || !publicVisibility || typeof title !== 'string' || !title.trim()) {
      cards.push({id,state:'unknown'}); continue;
    }
    const url = 'https://www.kuaishou.com/short-video/' + id;
    const publishedAt = Number.isSafeInteger(p?.uploadTime) && p.uploadTime > 1e12 && p.uploadTime < 8.64e15 ?
      new Date(p.uploadTime).toISOString() : null;
    const metrics = readMetrics({querySelectorAll:()=>[row]}, 'kuaishou', selector, {url}) || {};
    for (const [key, prop] of [['views','playCount'],['likes','likeCount'],['comments','commentCount']])
      if (Number.isSafeInteger(p?.[prop]) && p[prop] >= 0) metrics[key] = p[prop];
    if (!Object.keys(metrics).length) { cards.push({id,state:'unknown'}); continue; }
    cards.push({id,state:'public',video:{id,title,url,publishedAt,...metrics,extra:metrics.extra || {}}});
  }
  return cards;
}

function readKuaishouList(document, location, selector, readCards, readMetrics) {
  if (location.origin !== 'https://cp.kuaishou.com' || location.pathname !== '/article/manage/video')
    return {login:/login|passport/.test(location.hostname+location.pathname),total:null,cards:[]};
  const list = document.querySelector('.works-manage');
  const count = list?.querySelector('.works-manage__status__count')?.innerText?.trim();
  const total = /^共\s*([\d,，]+)\s*个作品$/.exec(count || '');
  const loading = [...(list?.querySelectorAll('.el-loading-mask,[aria-busy="true"]') || [])].some(e=>e.getClientRects().length);
  const empty = [...(list?.querySelectorAll('.el-empty,[class*="empty"]') || [])]
    .some(e=>e.getClientRects().length && /^(暂无作品|暂无视频作品|还没有作品)$/.test(e.innerText?.trim()));
  return {total:total ? Number(total[1].replace(/[,，]/g,'')) : null, cards:readCards(document,selector,readMetrics),loading,empty};
}

export const kuaishouListJs = () =>
  `(${readKuaishouList.toString()})(document,location,${JSON.stringify(chinaMetricPages.kuaishou.row)},${readKuaishouCards.toString()},${readMetrics.toString()})`;

function readAccount(document, platform, selector, readMetrics) {
  const items = new Map();
  for (const row of document.querySelectorAll(selector)) {
    if (!row.getClientRects().length) continue;
    const text = sel => row.querySelector(sel)?.innerText?.trim() || '';
    let url, id, title, publishedAt = null, metrics;
    const a = row.querySelector('.c-content-title');
    url = a?.href;
    id = /^https:\/\/www\.acfun\.cn\/v\/(ac\d+)(?:[/?#]|$)/.exec(url || '')?.[1];
    if (!id) continue;
    title = a.innerText.trim();
    const date = text('.time').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (date) publishedAt = `${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`;
    metrics = readMetrics({ querySelectorAll: () => [row] }, platform, selector, { url });
    if (title && metrics && Object.keys(metrics).length) items.set(id, {id,title,url,publishedAt,...metrics,extra:metrics.extra || {}});
  }
  return [...items.values()];
}

export const chinaAccountRowsJs = id => id === 'kuaishou' ?
  `[...new Map((${readKuaishouCards.toString()})(document,${JSON.stringify(chinaMetricPages[id].row)},${readMetrics.toString()}).filter(c=>c.state==='public').map(c=>[c.id,c.video])).values()]` :
  `(${readAccount.toString()})(document,${JSON.stringify(id)},${JSON.stringify(chinaMetricPages[id].row)},${readMetrics.toString()})`;

function readTiles(document, type) {
  const stat = { 播放量:'views',点赞量:'likes',评论量:'comments',分享量:'shares',收藏量:'favorites',涨粉量:'涨粉',
    平均播放时长:'平均播放秒数',完播率:'完播率',封面点击率:'封面点击率', '5秒完播率':'5秒完播率', '2秒跳出率':'2秒跳出率' };
  const out = {}, extra = {};
  const fans = !type.startsWith('detail');
  for (const tile of document.querySelectorAll(fans ? '.dc-piece-item,.tile,.tab-item' : type === 'detail-kuaishou' ? '.core_data_container .tile' : '.tile')) {
    if (tile.getClientRects && !tile.getClientRects().length) continue;
    const label = (tile.querySelector(fans ? '.dc-piece-item-tip' : '.name')?.innerText ||
      (fans ? (tile.querySelector('.name')?.innerText || tile.querySelector('.tab-item__name')?.innerText) : '') || '').trim();
    const raw = (tile.querySelector(fans ? '.dc-piece-item-count' : '.data')?.innerText ||
      (fans ? tile.querySelector('.data')?.innerText : '') || '').trim().replace(/[,，]/g,'');
    if (!fans && label === '平均播放时长') {
      const duration = raw.match(/^(?:(\d+)\s*(?:分|m)\s*)?(\d+(?:\.\d+)?)\s*(?:秒|s)$/i);
      if (duration) extra.平均播放秒数 ??= Number(duration[1] || 0) * 60 + Number(duration[2]);
      continue;
    }
    const m = raw.match(/^(\d+(?:\.\d+)?)\s*(万|亿|%)?$/i);
    if (!m) continue;
    const n = Number(m[1]) * ({万:1e4,亿:1e8}[m[2]] || 1);
    if (fans) {
      const totals = type === 'kuaishou' ? /^(粉丝总数|粉丝总量|总粉丝数|累计粉丝数|当前粉丝数)$/ : /^(粉丝总数|粉丝总量|总粉丝数|累计粉丝数|粉丝数)$/;
      if (totals.test(label) && m[2] !== '%' && Number.isSafeInteger(Math.round(n))) return { total:Math.round(n),history:[] };
      continue;
    }
    const key = stat[label];
    if (!key) continue;
    if (['views','likes','comments','shares','favorites'].includes(key)) {
      if (m[2] !== '%' && Number.isSafeInteger(Math.round(n))) out[key] ??= Math.round(n);
    } else if ((key === '涨粉' && m[2] !== '%') || (key !== '涨粉' && m[2] === '%' && n <= 100)) extra[key] ??= n;
  }
  if (Object.keys(extra).length) out.extra = extra;
  return Object.keys(out).length ? out : null;
}
export const chinaDetailJs = id => `(${readTiles.toString()})(document,${JSON.stringify(id === 'kuaishou' ? 'detail-kuaishou' : 'detail')})`;
export const chinaFansJs = id => `(${readTiles.toString()})(document,${JSON.stringify(id)})`;

function readKuaishouFanPeriod(document) {
  const boards = [...document.querySelectorAll('.core')].filter(e=>e.getClientRects().length && e.querySelectorAll('.core-data__list .tab-item').length);
  if (boards.length !== 1) return null;
  const board = boards[0];
  const cards = [...board.querySelectorAll('.core-data__list .tab-item')].filter(e =>
    e.getClientRects().length && e.querySelector('.tab-item__name')?.innerText.trim().split(/\n/)[0] === '净增粉丝量');
  const periods = [...board.querySelectorAll('.pop_value .current')].filter(e=>e.getClientRects().length);
  if (cards.length !== 1 || periods.length !== 1) return null;
  const days = /^近\s*(\d{1,3})\s*天$/.exec(periods[0].innerText.trim());
  const value = cards[0].querySelector('.tab-item__sumCount')?.innerText?.trim().replace(/[−，]/g,s=>s==='−'?'-':',').replace(/,/g,'');
  const m = /^([+-]?\d+(?:\.\d+)?)\s*(万|亿)?$/.exec(value || '');
  const net = m ? Math.round(Number(m[1]) * ({万:1e4,亿:1e8}[m[2]] || 1)) : null;
  return days && Number(days[1]) > 0 && Number.isSafeInteger(net) ? {net,days:Number(days[1])} : null;
}
export const kuaishouFanPeriodJs = () => `(${readKuaishouFanPeriod.toString()})(document)`;

export const acfunDetailJs = `(()=>{
  const read = selector => {
    const nodes=[...document.querySelectorAll(selector)].filter(e=>e.getClientRects().length);
    if(nodes.length!==1)return null;
    const s=nodes[0].innerText.trim().replace(/[,，]/g,'');
    const m=s.match(/^(\\d+(?:\\.\\d+)?)\\s*(万|亿)?$/);
    return m ? Math.round(Number(m[1])*({万:1e4,亿:1e8}[m[2]]||1)) : null;
  };
  const likes=read('.likeCount'), favorites=read('.collectionCount'), banana=read('.bananaCount');
  return {...(likes==null?{}:{likes}),...(favorites==null?{}:{favorites}),...(banana==null?{}:{extra:{投蕉:banana}})};
})()`;
