import { isExtraManual } from './publish-channels.mjs';

export function accountSummaries(db, ids) {
  const read = db.prepare(`SELECT s.synced_at AS syncedAt, s.count AS videos, s.error, d.views, v.synced_at AS verifiedAt
    FROM account_traffic_state s LEFT JOIN account_traffic_daily d
      ON d.platform=s.platform AND d.collected_at=s.synced_at
    LEFT JOIN account_traffic_verified v ON v.platform=s.platform WHERE s.platform=?`);
  const out = {};
  for (const id of ids) {
    const row = read.get(id);
    if (!row) continue;
    const { verifiedAt, ...data } = row;
    const legacyZero = id === 'kuaishou' && data.videos === 0 && (!verifiedAt || data.syncedAt < verifiedAt);
    out[id] = legacyZero ? { syncedAt: null, views: null, videos: null, error: data.error || '旧记录未核实，请重新采集' } : data;
  }
  return out;
}

export function accountWorkId(platform, url) {
  if (!isExtraManual(platform) || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (u.username || u.password) return null;
    if (platform === 'acfun' && u.origin === 'https://www.acfun.cn') return /^\/v\/(ac\d+)\/?$/.exec(u.pathname)?.[1] ?? null;
    if (platform === 'kuaishou' && u.origin === 'https://www.kuaishou.com') return /^\/short-video\/([\w-]+)\/?$/.exec(u.pathname)?.[1] ?? null;
  } catch {}
  return null;
}

const columns = 'id,title,url,published_at AS publishedAt,views,likes,comments,favorites,shares,extra,collected_at AS collectedAt';
export function accountWorkForUrl(db, platform, url) {
  const id = accountWorkId(platform, url);
  return id ? db.prepare(`SELECT ${columns} FROM account_videos WHERE platform=? AND id=? AND active=1`).get(platform, id) || null : null;
}

export function workLinkedElsewhere(db, episodeId, platform, url) {
  const workId = accountWorkId(platform, url);
  return !!workId && db.prepare('SELECT url FROM tasks WHERE platform=? AND episode_id<>? AND url IS NOT NULL').all(platform, episodeId)
    .some(t => accountWorkId(platform, t.url) === workId);
}

export function inWriteTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}

const normalize = title => String(title || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
export function accountCandidates(db, platform, titles, dates = []) {
  if (!isExtraManual(platform)) return [];
  const names = [...new Set(titles.map(normalize).filter(Boolean))];
  if (!names.length) return [];
  const times = dates.map(value => Date.parse(value)).filter(Number.isFinite);
  return db.prepare('SELECT id,title,url,published_at AS publishedAt FROM account_videos WHERE platform=? AND active=1 ORDER BY published_at DESC,id').all(platform)
    .filter(row => names.includes(normalize(row.title)) && accountWorkId(platform, row.url) === row.id)
    .map(row => ({ ...row, near: !!times.some(time => Math.abs(Date.parse(row.publishedAt) - time) < 3 * 864e5) }))
    .sort((a, b) => Number(b.near) - Number(a.near))
    .slice(0, 5);
}
