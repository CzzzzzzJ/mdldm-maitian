import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { db, getEpisode, getSnapshot, getTasks, NAMES } from './db.mjs';

const select = db.prepare('SELECT edits FROM archive_notes WHERE episode_id=?');
const upsert = db.prepare('INSERT INTO archive_notes (episode_id, edits) VALUES (?,?) ON CONFLICT(episode_id) DO UPDATE SET edits=excluded.edits');
const error = (status, message) => Object.assign(new Error(message), { status });
const record = x => !!x && typeof x === 'object' && !Array.isArray(x);
const keys = (x, allowed) => record(x) && Object.keys(x).every(key => allowed.includes(key));
const text = (x, max, lines = false) => typeof x === 'string' && x.length <= max && !(lines ? /[\x00-\x08\x0b\x0c\x0e-\x1f]/ : /[\x00-\x1f]/).test(x);
const positive = x => Number.isSafeInteger(x) && x > 0;
const max = { title: 200, body: 3000, tags: 300, notes: 3000, series: 120 };

function sourceFor(episode) {
  const snapshot = getSnapshot(episode.id);
  if (snapshot) {
    try { return { project: JSON.parse(snapshot.project), source: 'snapshot' }; } catch { /* Preserve fallback for old records. */ }
  }
  if (episode.dir) {
    try {
      const file = path.join(episode.dir, 'publish.json'), stat = fs.lstatSync(file);
      if (stat.isFile() && stat.size <= 1024 * 1024) {
        const project = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (project?.id === episode.id) return { project, source: 'project' };
      }
    } catch { /* Older projects may no longer be on disk. */ }
  }
  return { project: null, source: 'record' };
}

export function readArchiveNotes(id) {
  const ep = getEpisode(id);
  if (!ep) throw error(404, '没有这一期');
  const { project, source } = sourceFor(ep);
  const saved = JSON.parse(select.get(id)?.edits || '{}');
  const defaults = {
    series: typeof project?.series === 'string' ? project.series : '',
    episode: positive(project?.episode) ? project.episode : positive(ep.episode) ? ep.episode : null,
    notes: '',
  };
  const platforms = getTasks(id).filter(t => Object.hasOwn(NAMES, t.platform)).map(t => {
    const p = project?.platforms?.[t.platform] || {};
    const original = {
      title: String(p.title ?? p.shortTitle ?? t.published_title ?? ''),
      body: String(p.desc ?? p.body ?? p.text ?? p.caption ?? p.description ?? p.digest ?? ''),
      tags: Array.isArray(p.tags ?? p.topics) ? (p.tags ?? p.topics).map(String).join('、') : '',
    };
    return { id: t.platform, name: NAMES[t.platform], original, edits: saved.platforms?.[t.platform] || {} };
  });
  const view = { source, defaults, series: saved.series ?? defaults.series, episode: Object.hasOwn(saved, 'episode') ? saved.episode : defaults.episode,
    notes: saved.notes ?? '', platforms };
  return { ...view, revision: createHash('sha256').update(JSON.stringify([id, view, saved])).digest('hex') };
}

export function saveArchiveNotes(id, request) {
  if (!keys(request, ['revision', 'changes']) || typeof request.revision !== 'string' ||
      !keys(request.changes, ['series', 'episode', 'notes', 'platforms'])) throw error(400, '档案格式不正确');
  db.exec('BEGIN IMMEDIATE');
  try {
    const view = readArchiveNotes(id), patch = request.changes;
    if (request.revision !== view.revision) throw error(409, '档案已变化，请刷新后重试');
    for (const key of ['series', 'notes']) {
      if (Object.hasOwn(patch, key) && !text(patch[key], max[key], key === 'notes')) throw error(400, '系列或备注格式不正确');
    }
    if (Object.hasOwn(patch, 'episode') && patch.episode !== null && !positive(patch.episode)) throw error(400, '期数须为空或正整数');
    const edits = JSON.parse(select.get(id)?.edits || '{}');
    if (Object.hasOwn(patch, 'platforms')) {
      if (!keys(patch.platforms, view.platforms.map(p => p.id))) throw error(400, '未知平台');
      edits.platforms ??= {};
      for (const [platform, fields] of Object.entries(patch.platforms)) {
        if (!keys(fields, ['title', 'body', 'tags'])) throw error(400, '未知文案字段');
        for (const [key, value] of Object.entries(fields)) {
          if (value !== null && !text(value, max[key], key === 'body')) throw error(400, '文案格式不正确');
          if (value === null) {
            if (edits.platforms[platform]) delete edits.platforms[platform][key];
          } else (edits.platforms[platform] ??= {})[key] = value;
        }
      }
    }
    for (const key of ['series', 'episode', 'notes']) if (Object.hasOwn(patch, key)) edits[key] = patch[key];
    upsert.run(id, JSON.stringify(edits));
    const updated = readArchiveNotes(id);
    db.exec('COMMIT');
    return updated;
  } catch (cause) {
    db.exec('ROLLBACK');
    throw cause;
  }
}
