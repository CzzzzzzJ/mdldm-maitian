import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
test('旧库补列可重复启动，后续状态更新不丢失平台时间', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-time-'));
  try {
    const code = `import { DatabaseSync } from 'node:sqlite';
const old = new DatabaseSync(process.env.MAITIAN_DB);
old.exec('CREATE TABLE tasks (episode_id TEXT, platform TEXT, state TEXT, detail TEXT, url TEXT, tab_id INTEGER, updated_at TEXT, PRIMARY KEY (episode_id, platform))'); old.close();
const a = await import('./src/db.mjs');
a.setTask('sample', 'channels', 'published', '', { publishedAt: '2026-11-20 09:05:00', publishedTitle: '短标题' });
a.setTask('sample', 'channels', 'published', '再次同步');
const row = a.getTask('sample', 'channels');
if (row.published_at !== '2026-11-20 09:05:00' || row.published_title !== '短标题') throw Error('lost metadata');
a.db.close(); const b = await import('./src/db.mjs?reload'); b.db.close();`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, env: { ...process.env, MAITIAN_DB: path.join(dir, 'hub.db') }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('平台回读时间：秒、毫秒、中文时间与带时区 ISO', () => {
  const s = fs.readFileSync(new URL('../src/hub.mjs', import.meta.url), 'utf8');
  const fn = s.slice(s.indexOf('function bjTime('), s.indexOf('// 每家平台各自记'));
  const convert = vm.runInNewContext(fn + '; bjTime');
  const unix = Date.parse('2026-11-20T01:05:00Z');
  for (const x of [unix, unix / 1000, '2026年11月20日 09:05', '2026-11-20T01:05:00Z', '2026-11-20T09:05:00+08:00']) assert.equal(convert(x), '2026-11-20 09:05:00');
  assert.equal(convert('无时间'), '');
});
