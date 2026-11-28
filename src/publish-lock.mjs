// 同一期发布的跨进程锁。daemon、手工 hub run、网页拉起的 hub run / hub submit 共用。
// 进程还活着且租约未过期：别的进程不能开始上传。
// 进程已经不在（崩溃、被杀死）或租约过了没人续：下一个进程可以接手，避免死锁。
import { randomUUID } from 'node:crypto';
import { db, getMeta, setMeta } from './db.mjs';

export const PUBLISH_LOCK_TTL_MS = 3 * 60 * 1000;
export const publishLockKey = (episodeId) => `publishLock:${episodeId}`;

function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try { process.kill(n, 0); return true; }
  catch (e) { return !!(e && e.code === 'EPERM'); }
}

function readLock(episodeId) {
  const raw = getMeta(publishLockKey(episodeId));
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v.owner !== 'string') return null;
    return v;
  } catch { return null; }
}

function txn(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const v = fn();
    db.exec('COMMIT');
    return v;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* 已经不在事务里 */ }
    throw e;
  }
}

export function acquirePublishLock(episodeId, { ttl = PUBLISH_LOCK_TTL_MS, owner = randomUUID(), pid = process.pid, now = Date.now() } = {}) {
  if (!episodeId) throw new Error('发布锁缺少期数 id');
  return txn(() => {
    const cur = readLock(episodeId);
    if (cur && cur.owner !== owner && cur.until > now && pidAlive(cur.pid)) {
      throw Object.assign(new Error('这一期正在别的进程里发布，这次没有上传'), { code: 'PUBLISH_LOCKED' });
    }
    const next = { owner, pid, until: now + ttl };
    setMeta(publishLockKey(episodeId), JSON.stringify(next));
    return next;
  });
}

export function renewPublishLock(episodeId, owner, { ttl = PUBLISH_LOCK_TTL_MS, now = Date.now() } = {}) {
  return txn(() => {
    const cur = readLock(episodeId);
    if (!cur || cur.owner !== owner || !(cur.until > now)) throw new Error('发布锁已过期或被接替，已停止继续上传');
    const next = { ...cur, pid: process.pid, until: now + ttl };
    setMeta(publishLockKey(episodeId), JSON.stringify(next));
    return next;
  });
}

export function releasePublishLock(episodeId, owner) {
  txn(() => {
    const cur = readLock(episodeId);
    if (cur && cur.owner === owner) setMeta(publishLockKey(episodeId), '');
  });
}

// 拿到锁并定时续约。上传可能超过租约，续约失败说明锁已被接手，调用方应停止下一批。
export function holdPublishLock(episodeId, opt = {}) {
  const ttl = opt.ttl || PUBLISH_LOCK_TTL_MS;
  const got = acquirePublishLock(episodeId, { ttl, owner: opt.owner, pid: opt.pid });
  const beat = Math.min(60_000, Math.max(250, Math.floor(ttl / 3)));
  const timer = setInterval(() => {
    try { renewPublishLock(episodeId, got.owner, { ttl }); }
    catch (e) { clearInterval(timer); if (opt.onLost) opt.onLost(e); }
  }, beat);
  if (typeof timer.unref === 'function') timer.unref();
  return {
    owner: got.owner,
    touch() { return renewPublishLock(episodeId, got.owner, { ttl }); },
    release() { clearInterval(timer); releasePublishLock(episodeId, got.owner); },
  };
}
