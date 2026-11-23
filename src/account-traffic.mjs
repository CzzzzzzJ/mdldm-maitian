import { randomUUID } from 'node:crypto';
// 账号作品与发布工程分开保存，采集不会创建待发布任务。
export function initAccountTraffic(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS account_videos (
    platform TEXT, id TEXT, title TEXT, url TEXT, published_at TEXT,
    views INTEGER, likes INTEGER, comments INTEGER, favorites INTEGER, shares INTEGER, extra TEXT, collected_at TEXT, active INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(platform,id));
    CREATE TABLE IF NOT EXISTS account_traffic_daily (
    day TEXT, platform TEXT, views INTEGER, videos INTEGER, collected_at TEXT, PRIMARY KEY(day,platform));
    CREATE TABLE IF NOT EXISTS account_traffic_state (platform TEXT PRIMARY KEY, synced_at TEXT, count INTEGER, error TEXT);
    CREATE TABLE IF NOT EXISTS account_traffic_identity (platform TEXT PRIMARY KEY, uid TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_traffic_lock (id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT,until INTEGER);`);
}

export function saveAccountVideos(db, platform, rows, now = new Date().toISOString(), uid = null) {
  if (!Array.isArray(rows)) throw new Error('作品列表格式不对');
  const ids = new Set(), fields = ['views', 'likes', 'comments', 'favorites', 'shares'];
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.title !== 'string' || !/^https:\/\//.test(row.url || '') || (row.publishedAt && !Number.isFinite(Date.parse(row.publishedAt)))) throw new Error('作品信息无效或重复');
    for (const key of fields) if (row[key] != null && (!Number.isSafeInteger(row[key]) || row[key] < 0)) throw new Error('作品流量数字无效');
    ids.add(row.id);
  }
  const day = new Date(Date.parse(now) + 8 * 3600e3).toISOString().slice(0, 10);
  const upsert = db.prepare(`INSERT INTO account_videos VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)
    ON CONFLICT(platform,id) DO UPDATE SET title=excluded.title,url=excluded.url,published_at=excluded.published_at,
    views=excluded.views,likes=excluded.likes,comments=excluded.comments,favorites=excluded.favorites,shares=excluded.shares,extra=excluded.extra,collected_at=excluded.collected_at,active=1`);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (uid) {
      const binding = db.prepare('SELECT uid FROM account_traffic_identity WHERE platform=?').get(platform);
      if (binding?.uid && binding.uid !== uid) throw new Error('B站登录账号与历史数据不一致，请切回原账号或新增账号');
      if (db.prepare('SELECT 1 FROM account_traffic_identity WHERE uid=? AND platform<>?').get(uid, platform)) throw new Error('B站登录账号已被另一个流量账号使用');
      db.prepare('INSERT OR IGNORE INTO account_traffic_identity(platform,uid) VALUES (?,?)').run(platform, uid);
    }
    db.prepare('UPDATE account_videos SET active=0 WHERE platform=?').run(platform);
    for (const row of rows) upsert.run(platform, row.id, row.title, row.url, row.publishedAt || null, ...fields.map(k => row[k] ?? null), JSON.stringify(row.extra || {}), now);
    const views = rows.every(r => r.views != null) ? rows.reduce((n, r) => n + r.views, 0) : null;
    db.prepare('INSERT INTO account_traffic_daily VALUES (?,?,?,?,?) ON CONFLICT(day,platform) DO UPDATE SET views=excluded.views,videos=excluded.videos,collected_at=excluded.collected_at').run(day, platform, views, rows.length, now);
    db.prepare("INSERT INTO account_traffic_state VALUES (?,?,?, '') ON CONFLICT(platform) DO UPDATE SET synced_at=excluded.synced_at,count=excluded.count,error=''").run(platform, now, rows.length);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function accountTrafficView(db, ids) {
  if (!ids.length) return { videos: [], history: [], statuses: [] };
  const placeholders = ids.map(() => '?').join(',');
  const videos = db.prepare(`SELECT platform,id,title,url,published_at AS publishedAt,views,likes,comments,favorites,shares,collected_at AS collectedAt
    FROM account_videos WHERE active=1 AND platform IN (${placeholders}) ORDER BY published_at DESC,platform,id`).all(...ids);
  const history = db.prepare(`SELECT day,platform,views,videos FROM account_traffic_daily WHERE platform IN (${placeholders}) AND day>=date('now','-30 day') ORDER BY day,platform`).all(...ids);
  const saved = db.prepare(`SELECT platform AS id,synced_at AS syncedAt,count,error FROM account_traffic_state WHERE platform IN (${placeholders})`).all(...ids);
  return { videos, history, statuses: ids.map(id => saved.find(s => s.id === id) || {id,syncedAt:null,count:0,error:''}) };
}

export async function syncAccountTraffic({ db, targets, read, currentTargets = () => targets }) {
  const owner = randomUUID(), started = Date.now(), until = started + 15 * 60000;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT until FROM account_traffic_lock WHERE id=1').get()?.until > started) throw new Error('账号流量采集正在进行');
    db.prepare('INSERT INTO account_traffic_lock VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,until=excluded.until').run(owner, until);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const result = [];
  try {
    for (const target of targets) {
      try {
        const checkTarget = async () => {
          const active = (await currentTargets()).find(t => t.id === target.id);
          if (!active || ['chromePort','chromeProfile'].some(k => active[k] !== target[k]) || target.uid !== active.uid) throw new Error('账号配置已变更，请重新采集');
        };
        await checkTarget();
        const fetched = await read(target);
        const { rows, uid = null } = Array.isArray(fetched) ? { rows: fetched } : fetched;
        await checkTarget();
        if (Date.now() >= until || db.prepare('SELECT owner FROM account_traffic_lock WHERE id=1').get()?.owner !== owner) throw new Error('采集已超时，请重试');
        saveAccountVideos(db, target.id, rows, new Date().toISOString(), uid);
        result.push({ id: target.id, count: rows.length });
      } catch (e) {
        const error = String(e?.message || e || '采集失败').slice(0, 220);
        if (Date.now() < until && db.prepare('SELECT owner FROM account_traffic_lock WHERE id=1').get()?.owner === owner) db.prepare('INSERT INTO account_traffic_state(platform,error) VALUES (?,?) ON CONFLICT(platform) DO UPDATE SET error=excluded.error').run(target.id,error);
        result.push({ id: target.id, error });
      }
    }
    return result;
  } finally { db.prepare('DELETE FROM account_traffic_lock WHERE id=1 AND owner=?').run(owner); }
}
