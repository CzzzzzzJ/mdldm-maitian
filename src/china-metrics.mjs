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

function readAccount(document, platform, selector, readMetrics) {
  const items = new Map();
  for (const row of document.querySelectorAll(selector)) {
    if (!row.getClientRects().length) continue;
    const text = sel => row.querySelector(sel)?.innerText?.trim() || '';
    let url, id, title, publishedAt = null, metrics;
    if (platform === 'acfun') {
      const a = row.querySelector('.c-content-title');
      url = a?.href;
      id = /^https:\/\/www\.acfun\.cn\/v\/(ac\d+)(?:[/?#]|$)/.exec(url || '')?.[1];
      if (!id) continue;
      title = a.innerText.trim();
      const date = text('.time').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (date) publishedAt = `${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`;
      metrics = readMetrics({ querySelectorAll: () => [row] }, platform, selector, { url });
    } else {
      if (text('.video-item__detail__row__status') !== '已发布' ||
        /私密|仅自己|仅好友|不公开/.test(text('.video-item__detail__row__photoStatus'))) continue;
      const p = row.__vue__?.$props?.videoInfo;
      if (typeof p?.workId !== 'string' || !/^[a-z0-9]+$/i.test(p.workId)) throw new Error('快手作品缺少稳定 ID');
      id = p.workId;
      url = 'https://www.kuaishou.com/short-video/' + id;
      title = text('.video-item__detail__row__title') || p.title;
      if (Number.isSafeInteger(p.uploadTime) && p.uploadTime > 1e12) publishedAt = new Date(p.uploadTime).toISOString();
      metrics = readMetrics({ querySelectorAll: () => [row] }, platform, selector, {url}) || {};
      for (const [key, prop] of [['views','playCount'],['likes','likeCount'],['comments','commentCount']])
        if (Number.isSafeInteger(p[prop]) && p[prop] >= 0) metrics[key] = p[prop];
    }
    if (title && metrics && Object.keys(metrics).length) items.set(id, {id,title,url,publishedAt,...metrics,extra:metrics.extra || {}});
  }
  return [...items.values()];
}

export const chinaAccountRowsJs = id =>
  `(${readAccount.toString()})(document,${JSON.stringify(id)},${JSON.stringify(chinaMetricPages[id].row)},${readMetrics.toString()})`;

function readTiles(document, type) {
  const stat = { 点赞量:'likes',评论量:'comments',分享量:'shares',收藏量:'favorites',涨粉量:'涨粉',
    平均播放时长:'平均播放秒数',完播率:'完播率', '5秒完播率':'5秒完播率', '2秒跳出率':'2秒跳出率' };
  const out = {}, extra = {};
  const fans = type !== 'detail';
  for (const tile of document.querySelectorAll(fans ? '.dc-piece-item,.tile,.tab-item' : '.tile')) {
    const label = (tile.querySelector(fans ? '.dc-piece-item-tip' : '.name')?.innerText ||
      (fans ? (tile.querySelector('.name')?.innerText || tile.querySelector('.tab-item__name')?.innerText) : '') || '').trim();
    const raw = (tile.querySelector(fans ? '.dc-piece-item-count' : '.data')?.innerText ||
      (fans ? tile.querySelector('.data')?.innerText : '') || '').trim().replace(/[,，]/g,'');
    const m = raw.match(/^(\d+(?:\.\d+)?)\s*(万|亿|%|s)?$/i);
    if (!m) continue;
    const n = Number(m[1]) * ({万:1e4,亿:1e8}[m[2]] || 1);
    if (fans) {
      if (/^(粉丝总数|粉丝总量|总粉丝数|累计粉丝数|粉丝数)$/.test(label) && m[2] !== '%' && m[2] !== 's') return { total:Math.round(n),history:[] };
      continue;
    }
    const key = stat[label];
    if (!key) continue;
    if (['likes','comments','shares','favorites'].includes(key)) out[key] ??= Math.round(n);
    else extra[key] ??= n;
  }
  if (Object.keys(extra).length) out.extra = extra;
  return Object.keys(out).length ? out : null;
}
export const chinaDetailJs = () => `(${readTiles.toString()})(document,'detail')`;
export const chinaFansJs = id => `(${readTiles.toString()})(document,${JSON.stringify(id)})`;

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
