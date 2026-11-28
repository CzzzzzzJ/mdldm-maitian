// Persist the next deadline so restarting the daemon cannot repeat a clock slot.
import fs from 'node:fs';
import path from 'node:path';
import { db, getMeta, setMeta } from './db.mjs';
import { config, CFG } from './feishu.mjs';
import { normalizeSchedules, nextSlot, notifyScheduleChange, waitUntil } from './schedules.mjs';

const MIN = 60000;

function readDeadline(name, rule, now) {
  const key = 'schedule:' + name, signature = JSON.stringify(rule);
  const previous = JSON.parse(getMeta(key) || 'null');
  if (previous?.signature === signature) return previous;
  const last = name === 'sales'
    ? Math.max(Number(getMeta('siteSalesAttempt')) || 0, Date.parse(getMeta('siteLiveSyncedAt')) || 0)
    : Number(getMeta('daemonCheckAttempt'));
  const next = rule.mode === 'daily' ? nextSlot(rule, now - 1) : last ? nextSlot(rule, last) : now;
  const state = { signature, next };
  setMeta(key, JSON.stringify(state));
  return state;
}

export function scheduleDeadline(name, now = Date.now()) {
  return readDeadline(name, normalizeSchedules(config.schedules)[name], now).next;
}

export async function runIfDue(name, work, now = Date.now()) {
  const rule = normalizeSchedules(config.schedules)[name], key = 'schedule:' + name;
  let state;
  db.exec('BEGIN IMMEDIATE');
  try {
    state = readDeadline(name, rule, now);
    if (state.next > now) { db.exec('COMMIT'); return null; }
    state.next = nextSlot(rule, now);
    setMeta(key, JSON.stringify(state));
    setMeta(name === 'sales' ? 'siteSalesAttempt' : 'daemonCheckAttempt', now);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  try { return await work(); }
  finally {
    // Skip slots covered by this run, retaining the original interval phase.
    const finished = Date.now();
    if (finished >= state.next) {
      const next = rule.mode === 'daily' ? nextSlot(rule, finished)
        : state.next + (Math.floor((finished - state.next) / (rule.minutes * MIN)) + 1) * rule.minutes * MIN;
      db.prepare('UPDATE meta SET value=? WHERE key=? AND value=?')
        .run(JSON.stringify({ ...state, next }), key, JSON.stringify(state));
    }
  }
}

// Watch the parent because settings are saved with an atomic file replacement.
export function watchScheduleFile() {
  const file = path.basename(CFG);
  const reload = () => {
    try {
      const saved = JSON.parse(fs.readFileSync(CFG, 'utf8')).schedules;
      const next = normalizeSchedules(saved);
      if (JSON.stringify(config.schedules) === JSON.stringify(saved === undefined ? undefined : next)) return;
      if (saved === undefined) delete config.schedules;
      else config.schedules = next;
      notifyScheduleChange();
    } catch { console.error('无法读取守护计划配置，请检查文件格式和执行时刻'); }
  };
  const watcher = fs.watch(path.dirname(CFG), { persistent: false }, (event, name) => {
    // macOS may coalesce a rename and supply only the temporary source filename.
    if (event === 'rename' || !name || name === file) reload();
  });
  watcher.on('error', () => console.error('守护计划配置监听中断'));
  reload();
  // Cover a replacement while the OS is registering this directory watcher.
  const initialCheck = setImmediate(reload);
  watcher.once('close', () => clearImmediate(initialCheck));
  return watcher;
}

export async function watchSchedule(name, enabled, work, reportError) {
  for (;;) {
    try {
      if (!enabled()) { await waitUntil(Infinity); continue; }
      const due = scheduleDeadline(name);
      if (due > Date.now()) { await waitUntil(due); continue; }
      await runIfDue(name, () => Promise.resolve().then(work).catch(reportError));
    } catch (err) {
      reportError(err);
      // A broken config or unavailable database may fail before a deadline is saved.
      await waitUntil(Date.now() + MIN);
    }
  }
}
