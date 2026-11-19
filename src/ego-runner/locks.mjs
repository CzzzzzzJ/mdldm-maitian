// 文件锁：space 锁（一个 space 同一时间只有一个任务进程，拿不到立即返回）和前台锁（全局一把，等待型）。
// 既在 runner 进程里用，也在 ego-browser nodejs 脚本里用（前台锁、心跳），所以只依赖 node 内置模块。
//
// 锁文件 `<锁目录>/<encodeURIComponent(名字)>.lock`，内容 JSON：
//   { token, pid, startedAt, heartbeatAt, heartbeatFile, ...meta }
// 心跳单独写在 heartbeatFile（`<锁文件>.<token>.hb`，内容 `{ at, stopped }`）：
// Ego 里的任务脚本只写这个文件、不碰锁文件，被接管后旧脚本再写也只写到它自己 token 的文件，影响不到新持有者。
// 读锁时心跳时间取锁文件 heartbeatAt 和心跳文件 at 里较晚的那个。
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_OPS_DIR = fileURLToPath(new URL('../../data/ops/', import.meta.url));
export const FOREGROUND_LOCK = 'foreground.lock';
const GUARD_STALE_MS = 10_000;   // 接管保护文件只在接管那一瞬间存在，超过这么久还在就是接管的进程崩了

/** 锁目录：`$MAITIAN_OPS_DIR/locks`，没设就是 `<仓库根>/data/ops/locks`。 */
export const locksDir = (env = process.env) => join(env.MAITIAN_OPS_DIR || DEFAULT_OPS_DIR, 'locks');
export const spaceLockPath = (dir, space) => join(dir, `${encodeURIComponent(space)}.lock`);
export const foregroundLockPath = (dir) => join(dir, FOREGROUND_LOCK);

const readJson = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};

export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

/** 读锁：不存在返回 null；心跳时间合并心跳文件。 */
export function readLock(path) {
  const lock = readJson(path);
  if (!lock) return null;
  const hb = lock.heartbeatFile ? readJson(lock.heartbeatFile) : null;
  return { ...lock, path, heartbeatAt: Math.max(lock.heartbeatAt, hb?.at ?? 0), stopped: !!hb?.stopped };
}

/**
 * 能不能接管：心跳过期（或脚本自己报了已停），而且 requireDeadPid 时持有进程已死（pid 为 null 视为已死）。
 * 前台锁的持有者在 Ego 的常驻 Node 服务里，pid 总是活的，所以前台锁只看心跳。
 */
export function isStale(holder, { staleMs, requireDeadPid = true, now = Date.now() }) {
  const quiet = holder.stopped || now - holder.heartbeatAt > staleMs;
  return quiet && (!requireDeadPid || !pidAlive(holder.pid));
}

// 原子建锁：先写好临时文件再 link 到锁文件名，锁文件一出现就是完整内容；已存在时 link 报 EEXIST。
function create(path, { pid, meta }) {
  mkdirSync(dirname(path), { recursive: true });
  const token = randomBytes(8).toString('hex');
  const now = Date.now();
  const lock = { token, pid, startedAt: now, heartbeatAt: now, heartbeatFile: `${path}.${token}.hb`, ...meta };
  const tmp = `${path}.${token}.tmp`;
  writeFileSync(tmp, JSON.stringify(lock));
  try { linkSync(tmp, path); return { ...lock, path }; }
  catch (e) { if (e.code === 'EEXIST') return null; throw e; }
  finally { rmSync(tmp, { force: true }); }
}

// 接管：先独占一个保护文件，再确认锁还是刚才判定过期的那一把（token 相同），才删旧锁、建新锁。
// 两个进程同时接管时，抢不到保护文件的直接算没拿到；绕过保护文件直接建锁的，只能在旧锁删掉之后成功，
// 这时接管方的 link 报 EEXIST，也只有一个成功。
function takeover(path, holder, info) {
  const guard = `${path}.takeover`;
  try { writeFileSync(guard, String(process.pid), { flag: 'wx' }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try { if (Date.now() - statSync(guard).mtimeMs > GUARD_STALE_MS) rmSync(guard, { force: true }); } catch { /* 刚被删掉 */ }
    return null;
  }
  try {
    const now = readLock(path);
    if (now && now.token !== holder.token) return null;
    if (now) { rmSync(now.heartbeatFile, { force: true }); rmSync(path, { force: true }); }
    return create(path, info);
  } finally { rmSync(guard, { force: true }); }
}

/**
 * 取锁，不等待。
 * @param {string} path 锁文件
 * @param {{ pid?: number|null, staleMs?: number, requireDeadPid?: boolean, meta?: object }} [opts]
 * @returns {{ ok: true, lock: object } | { ok: false, holder: object }}
 */
export function tryLock(path, { pid = process.pid, staleMs = 10_000, requireDeadPid = true, meta = {} } = {}) {
  const info = { pid, meta };
  for (let attempt = 0; attempt < 3; attempt++) {
    const lock = create(path, info);
    if (lock) return { ok: true, lock };
    const holder = readLock(path);
    if (!holder) continue;   // 刚被释放，再试
    if (!isStale(holder, { staleMs, requireDeadPid })) return { ok: false, holder };
    const taken = takeover(path, holder, info);
    if (taken) return { ok: true, lock: taken };
    const now = readLock(path);
    if (now) return { ok: false, holder: now };
  }
  return { ok: false, holder: readLock(path) };
}

/** 写心跳（锁持有者或 Ego 里的任务脚本都可以写）；stopped=true 表示脚本已经停了。 */
export function beat(lock, { stopped = false } = {}) {
  writeFileSync(lock.heartbeatFile, JSON.stringify({ at: Date.now(), stopped }));
}

const ownedBy = (lock) => readJson(lock.path)?.token === lock.token;

/** 释放：只删自己（token 相同）的锁。 */
export function releaseLock(lock) {
  rmSync(lock.heartbeatFile, { force: true });
  if (ownedBy(lock)) rmSync(lock.path, { force: true });
}

/**
 * 把锁留给 Ego 里还在跑的旧脚本：持有者 pid 改成 null，之后只要它的心跳停了，任何人都能按过期规则接管。
 * runner 进程可能是长驻的（定时任务、MCP），不清掉 pid 的话它活着这把锁就永远接管不了。
 */
export function orphanLock(lock) {
  if (!ownedBy(lock)) return;
  const tmp = `${lock.path}.${lock.token}.tmp`;
  const { path: _p, stopped: _s, ...content } = readLock(lock.path);
  writeFileSync(tmp, JSON.stringify({ ...content, pid: null, orphanedAt: Date.now() }));
  renameSync(tmp, lock.path);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 等锁的心跳安静下来（脚本报了已停，或 quietMs 内没再更新），最多等 graceMs。返回是否已安静。
 */
export async function waitQuiet(lock, { quietMs, graceMs, pollMs = 100 }) {
  const until = Date.now() + graceMs;
  for (;;) {
    const now = readLock(lock.path);
    if (!now || now.token !== lock.token) return true;
    if (now.stopped || Date.now() - now.heartbeatAt > quietMs) return true;
    if (Date.now() >= until) return false;
    await sleep(pollMs);
  }
}

/**
 * 等待型取锁（前台锁用）：拿不到就每 pollMs 再试，超过 timeoutMs 抛错（err.code='lock-timeout'）。
 * 持有期间每 staleMs/3 写一次心跳；返回的 release() 停心跳并释放。持有者心跳停了 staleMs 后别人可以接管。
 */
export async function waitLock(path, { timeoutMs, staleMs = 10_000, pollMs = 25, meta = {} } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const r = tryLock(path, { staleMs, requireDeadPid: false, meta });
    if (r.ok) {
      const timer = setInterval(() => beat(r.lock), Math.max(10, Math.floor(staleMs / 3)));
      return { lock: r.lock, release: () => { clearInterval(timer); releaseLock(r.lock); } };
    }
    if (Date.now() >= until) {
      const err = new Error(`等锁 ${path} 超过 ${timeoutMs}ms（持有者 pid ${r.holder?.pid ?? '?'}，开始于 ${r.holder ? new Date(r.holder.startedAt).toISOString() : '?'}）`);
      err.code = 'lock-timeout';
      throw err;
    }
    await sleep(pollMs);
  }
}
